use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use daoyun_api::{
    AuthConfig, CacheRuntime, MfaRuntime, ObservabilityConfig, app_with_runtimes_and_observability,
};
use infrastructure::{Database, OperationsMetricValues};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn operations_api_returns_real_summary_and_manages_alert_lifecycle(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let observability = ObservabilityConfig::default()
        .build()
        .expect("observability runtime must build");
    let app = app_with_runtimes_and_observability(
        database.clone(),
        AuthConfig::default().with_secure_cookies(false),
        CacheRuntime::disabled(),
        MfaRuntime::disabled(),
        observability,
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app, "owner").await;

    let summary = app
        .clone()
        .oneshot(get_request("/api/v1/admin/operations/summary", &cookies))
        .await
        .expect("operations summary must respond");
    assert_eq!(summary.status(), StatusCode::OK);
    let request_id = summary
        .headers()
        .get("x-request-id")
        .expect("summary request id header must exist")
        .to_str()
        .expect("request id header must be text")
        .to_owned();
    let summary = response_json(summary).await;
    assert_eq!(summary["meta"]["request_id"], request_id);
    assert_eq!(summary["data"]["database"]["ready"], true);
    assert!(summary["data"]["http"]["total_requests"].as_u64().is_some());
    assert_eq!(summary["data"]["outbox"]["dead"], 0);

    let rules = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/operations/alert-rules",
            &cookies,
        ))
        .await
        .expect("operations rules must respond");
    assert_eq!(rules.status(), StatusCode::OK);
    let rules = response_json(rules).await;
    let rule = rules["data"]
        .as_array()
        .expect("rules must be an array")
        .iter()
        .find(|rule| rule["key"] == "api_5xx")
        .expect("5xx rule must exist");
    let rule_id = rule["id"].as_str().expect("rule id must exist");
    let revision = rule["revision"].as_u64().expect("revision must exist");

    let missing_csrf = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/operations/alert-rules/{rule_id}"),
            json!({
                "name": "API 服务器错误",
                "threshold": 3,
                "window_seconds": 300,
                "enabled": true,
                "expected_revision": revision
            }),
            &cookies,
            None,
        ))
        .await
        .expect("missing CSRF update must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let updated = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/operations/alert-rules/{rule_id}"),
            json!({
                "name": "API 服务器错误",
                "threshold": 3,
                "window_seconds": 300,
                "enabled": true,
                "expected_revision": revision
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("rule update must respond");
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(
        response_json(updated).await["data"]["revision"],
        revision + 1
    );

    database
        .evaluate_operations_alerts(OperationsMetricValues {
            http_5xx_count: 4,
            http_5xx_window_seconds: 300,
            http_p95_ms: 0,
            http_p95_window_seconds: 300,
        })
        .await
        .expect("alert fixture must evaluate");
    let alerts = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/operations/alerts?status=open&limit=50",
            &cookies,
        ))
        .await
        .expect("operations alerts must respond");
    assert_eq!(alerts.status(), StatusCode::OK);
    let alerts = response_json(alerts).await;
    let alert_id = alerts["data"][0]["id"]
        .as_str()
        .expect("open alert id must exist");
    assert_eq!(alerts["data"][0]["rule"]["kind"], "http_5xx_count");

    let acknowledged = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/operations/alerts/{alert_id}"),
            json!({"status": "acknowledged"}),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("alert acknowledgement must respond");
    assert_eq!(acknowledged.status(), StatusCode::OK);
    assert_eq!(
        response_json(acknowledged).await["data"]["status"],
        "acknowledged"
    );

    let openapi = app
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI document must respond");
    let document = response_json(openapi).await;
    assert!(document["paths"]["/api/v1/admin/operations/summary"]["get"].is_object());
    assert!(
        document["paths"]["/api/v1/admin/operations/alert-rules/{rule_id}"]["patch"].is_object()
    );
    assert!(document["paths"]["/api/v1/admin/operations/alerts/{alert_id}"]["patch"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn operations_api_separates_read_and_write_capabilities(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let app = app_with_runtimes_and_observability(
        database,
        AuthConfig::default().with_secure_cookies(false),
        CacheRuntime::disabled(),
        MfaRuntime::disabled(),
        ObservabilityConfig::default()
            .build()
            .expect("observability runtime must build"),
    );
    initialize(&app).await;

    let unauthenticated = app
        .clone()
        .oneshot(get_request("/api/v1/admin/operations/summary", ""))
        .await
        .expect("unauthenticated summary must respond");
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let registration = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "operations_reader",
                "email": "operations_reader@example.com",
                "display_name": "Operations Reader",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("reader registration must respond");
    assert_eq!(registration.status(), StatusCode::CREATED);
    let reader_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'operations_reader'")
            .fetch_one(&pool)
            .await
            .expect("reader id must load");
    let owner_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'owner'")
        .fetch_one(&pool)
        .await
        .expect("owner id must load");
    let role_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system)
         VALUES ($1, 'operations_reader', 'Operations reader', 'instance', FALSE)",
    )
    .bind(role_id)
    .execute(&pool)
    .await
    .expect("reader role must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE permission_key = 'operations.read'",
    )
    .bind(role_id)
    .execute(&pool)
    .await
    .expect("reader permission must insert");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::now_v7())
    .bind(reader_id)
    .bind(role_id)
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("reader assignment must insert");

    let (cookies, csrf) = login(&app, "operations_reader").await;
    let readable = app
        .clone()
        .oneshot(get_request("/api/v1/admin/operations/summary", &cookies))
        .await
        .expect("reader summary must respond");
    assert_eq!(readable.status(), StatusCode::OK);

    let rules = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/operations/alert-rules",
            &cookies,
        ))
        .await
        .expect("reader rules must respond");
    let rules = response_json(rules).await;
    let rule = &rules["data"][0];
    let forbidden = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!(
                "/api/v1/admin/operations/alert-rules/{}",
                rule["id"].as_str().expect("rule id must exist")
            ),
            json!({
                "name": rule["name"],
                "threshold": rule["threshold"],
                "window_seconds": rule["window_seconds"],
                "enabled": rule["enabled"],
                "expected_revision": rule["revision"]
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("reader write must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(forbidden).await["error"]["code"],
        "admin.forbidden"
    );
}

async fn initialize(app: &axum::Router) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/installation",
            json!({
                "username": "owner",
                "email": "owner@example.com",
                "display_name": "Owner",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("installation must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
}

async fn login(app: &axum::Router, identifier: &str) -> (String, String) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({"identifier": identifier, "password": "correct horse battery staple"}),
            "",
            None,
        ))
        .await
        .expect("login must respond");
    assert_eq!(response.status(), StatusCode::OK);
    session_cookies(&response)
}

fn session_cookies(response: &axum::response::Response) -> (String, String) {
    let mut csrf_cookie = String::new();
    let mut session_cookie = String::new();
    for value in response.headers().get_all("set-cookie") {
        let value = value.to_str().expect("set-cookie must be text");
        let pair = value.split(';').next().expect("cookie pair must exist");
        if pair.starts_with("daoyun_csrf=") {
            csrf_cookie = pair.to_owned();
        } else if pair.starts_with("daoyun_session=") {
            session_cookie = pair.to_owned();
        }
    }
    let csrf = csrf_cookie
        .split_once('=')
        .expect("CSRF cookie value must exist")
        .1
        .to_owned();
    (format!("{session_cookie}; {csrf_cookie}"), csrf)
}

fn get_request(uri: &str, cookies: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("cookie", cookies)
        .body(Body::empty())
        .expect("GET request must be valid")
}

fn json_request(
    method: Method,
    uri: &str,
    value: Value,
    cookies: &str,
    csrf: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if !cookies.is_empty() {
        builder = builder.header("cookie", cookies);
    }
    if let Some(csrf) = csrf {
        builder = builder.header("x-csrf-token", csrf);
    }
    builder
        .body(Body::from(value.to_string()))
        .expect("JSON request must be valid")
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response must be JSON")
}
