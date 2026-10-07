use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn renewal_openapi_has_authenticated_versioned_contract_and_response_headers() {
    let schema = serde_json::to_value(daoyun_api::openapi_document()).unwrap();
    for (path, method) in [
        ("/api/v1/admin/entitlements/{entitlement_id}/renew", "post"),
        (
            "/api/v1/admin/entitlements/users/{user_id}/renewal-requests/{key}",
            "get",
        ),
    ] {
        let operation = &schema["paths"][path][method];
        assert!(operation.is_object(), "missing {path}");
        for response in operation["responses"].as_object().unwrap().values() {
            assert!(response["headers"]["x-request-id"].is_object());
        }
        assert!(operation["responses"]["422"].is_object());
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn renewal_api_is_uid_scoped_csrf_protected_and_recovers_original_receipt(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app, "owner", "correct horse battery staple").await;
    let uid: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let kind=response_json(app.clone().oneshot(json_request(Method::PUT,"/api/v1/admin/entitlements/types/renew_vip",
        json!({"display_name":"续期会员","permission_keys":["topic.poll.create"],"quotas":{},"expected_revision":null}),&cookies,Some(&csrf))).await.unwrap()).await;
    let grant=response_json(app.clone().oneshot(json_request(Method::POST,"/api/v1/admin/entitlements",
        json!({"user_id":uid,"entitlement_type_id":kind["data"]["id"],"source":"admin","source_reference_id":null,
            "reason":"原授予","starts_at":"2026-01-01T00:00:00Z","ends_at":"2090-01-01T00:00:00Z","idempotency_key":"grant"}),&cookies,Some(&csrf))).await.unwrap()).await;
    let entitlement = grant["data"]["entitlement"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/admin/entitlements/{entitlement}/renew");
    let input = json!({"user_id":uid,"expected_revision":1,"ends_at":"2091-01-01T00:00:00Z","reason":"延期","idempotency_key":"same/key"});
    for (cookie, token, status) in [
        ("", None, StatusCode::UNAUTHORIZED),
        (&cookies, None, StatusCode::FORBIDDEN),
    ] {
        let response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                &uri,
                input.clone(),
                cookie,
                token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), status);
        let header = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        assert_eq!(response_json(response).await["meta"]["request_id"], header);
    }
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &uri,
            input.clone(),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let header = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let first = response_json(response).await;
    assert_eq!(first["meta"]["request_id"], header);
    assert_eq!(first["data"]["receipt"]["request_id"], header);
    assert_eq!(first["data"]["receipt"]["revision"], 2);
    assert_eq!(first["data"]["entitlement"]["type_version"], 1);
    let lookup = format!("/api/v1/admin/entitlements/users/{uid}/renewal-requests/same%2Fkey");
    let response = app
        .clone()
        .oneshot(get_request(&lookup, &cookies))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(
        response_json(response).await["data"],
        first["data"]["receipt"]
    );
    let replay = response_json(
        app.clone()
            .oneshot(json_request(
                Method::POST,
                &uri,
                input.clone(),
                &cookies,
                Some(&csrf),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(replay["data"]["replayed"], true);
    assert_eq!(replay["data"]["receipt"], first["data"]["receipt"]);
    let mut changed = input.clone();
    changed["reason"] = json!("不同原因");
    assert_eq!(
        app.clone()
            .oneshot(json_request(
                Method::POST,
                &uri,
                changed,
                &cookies,
                Some(&csrf)
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let mut wrong = input.clone();
    wrong["user_id"] = json!(Uuid::now_v7());
    wrong["idempotency_key"] = json!("wrong-user");
    assert_eq!(
        app.clone()
            .oneshot(json_request(
                Method::POST,
                &uri,
                wrong,
                &cookies,
                Some(&csrf)
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    for path in [
        "/api/v1/admin/entitlements/bad/renew".to_owned(),
        format!("/api/v1/admin/entitlements/{entitlement}/renew"),
    ] {
        let mut invalid = input.clone();
        invalid["idempotency_key"] = json!(" ");
        let response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                &path,
                invalid,
                &cookies,
                Some(&csrf),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let header = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        assert_eq!(response_json(response).await["meta"]["request_id"], header);
    }
    let missing = format!("/api/v1/admin/entitlements/users/{uid}/renewal-requests/missing");
    assert_eq!(
        app.clone()
            .oneshot(get_request(&missing, &cookies))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
        .bind(uid)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(get_request(&lookup, &cookies))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.clone()
            .oneshot(json_request(
                Method::POST,
                &uri,
                input,
                &cookies,
                Some(&csrf)
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
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
                "display_name": "管理员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("installation must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
}

async fn login(app: &axum::Router, username: &str, password: &str) -> (String, String) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({"identifier": username, "password": password}),
            "",
            None,
        ))
        .await
        .expect("login must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let (cookies, csrf) = session_cookies(&response).await;
    (cookies, csrf)
}

async fn session_cookies(response: &axum::response::Response) -> (String, String) {
    let mut csrf_cookie = String::new();
    let mut session_cookie = String::new();
    for value in response.headers().get_all("set-cookie").iter() {
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
