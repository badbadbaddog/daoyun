use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use daoyun_api::{AuthConfig, PluginHostConfig, PluginRuntime, app_with_plugin_runtime};
use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const IDENTITY_COMPONENT: &str =
    include_str!("../../../crates/plugin-host/tests/fixtures/identity-component.wat");

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_api_runs_the_validated_lifecycle_and_preserves_privacy(pool: PgPool) {
    let app = app_with_plugin_runtime(
        Database::from_pool(pool.clone()),
        AuthConfig::default().with_secure_cookies(false),
        PluginRuntime::enabled(PluginHostConfig::default()).expect("plugin runtime must configure"),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app).await;
    let component = wat::parse_str(IDENTITY_COMPONENT).expect("identity component must parse");
    let install_body = json!({
        "manifest": {
            "schema_version": 1,
            "key": "api_identity_plugin",
            "name": "API identity plugin",
            "version": "1.0.0",
            "description": "API lifecycle fixture",
            "capabilities": ["content.transform", "ui.panel"]
        },
        "component_base64": STANDARD.encode(&component)
    });

    let missing_csrf = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            install_body.clone(),
            &cookies,
            None,
        ))
        .await
        .expect("missing CSRF install must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let installed = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            install_body,
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("plugin install must respond");
    assert_eq!(installed.status(), StatusCode::CREATED);
    let request_id = installed
        .headers()
        .get("x-request-id")
        .expect("install request id must exist")
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let installed = response_json(installed).await;
    assert_eq!(installed["meta"]["request_id"], request_id);
    assert_eq!(installed["data"]["status"], "disabled");
    assert_eq!(installed["data"]["revision"], 1);
    assert!(installed.to_string().find("component_base64").is_none());
    let plugin_id = installed["data"]["id"]
        .as_str()
        .expect("plugin id must exist");

    let listed = app
        .clone()
        .oneshot(get_request("/api/v1/admin/plugins", &cookies))
        .await
        .expect("plugin list must respond");
    assert_eq!(listed.status(), StatusCode::OK);
    let listed = response_json(listed).await;
    assert_eq!(listed["data"][0]["key"], "api_identity_plugin");
    assert!(listed.to_string().find("component_bytes").is_none());

    let enabled = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/plugins/{plugin_id}"),
            json!({"status": "enabled", "expected_revision": 1}),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("plugin enable must respond");
    assert_eq!(enabled.status(), StatusCode::OK);
    assert_eq!(response_json(enabled).await["data"]["revision"], 2);

    let transformed = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!("/api/v1/admin/plugins/{plugin_id}/invoke"),
            json!({"operation": "content_transform", "payload": "hello"}),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("plugin transform must respond");
    assert_eq!(transformed.status(), StatusCode::OK);
    let transformed = response_json(transformed).await;
    assert_eq!(transformed["data"]["payload"], "hello");
    assert!(transformed["data"].get("ui_schema").is_none());

    let schema = json!({
        "schema_version": 1,
        "title": "API panel",
        "blocks": [{"kind": "status", "tone": "success", "text": "Enabled"}]
    });
    let rendered = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!("/api/v1/admin/plugins/{plugin_id}/invoke"),
            json!({"operation": "ui_render", "payload": schema.to_string()}),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("plugin UI render must respond");
    assert_eq!(rendered.status(), StatusCode::OK);
    assert_eq!(
        response_json(rendered).await["data"]["ui_schema"]["title"],
        "API panel"
    );

    let disabled = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/plugins/{plugin_id}"),
            json!({"status": "disabled", "expected_revision": 2}),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("plugin disable must respond");
    assert_eq!(disabled.status(), StatusCode::OK);

    let rejected = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!("/api/v1/admin/plugins/{plugin_id}/invoke"),
            json!({"operation": "content_transform", "payload": "hello"}),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("disabled plugin invoke must respond");
    assert_eq!(rejected.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(rejected).await["error"]["code"],
        "plugin.disabled"
    );

    let deleted = app
        .clone()
        .oneshot(json_request(
            Method::DELETE,
            &format!("/api/v1/admin/plugins/{plugin_id}"),
            json!(null),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("plugin uninstall must respond");
    assert_eq!(deleted.status(), StatusCode::OK);
    assert_eq!(response_json(deleted).await["data"], true);
    let stored = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM plugins")
        .fetch_one(&pool)
        .await
        .expect("plugin count must load");
    assert_eq!(stored, 0);

    let openapi = app
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI document must respond");
    let document = response_json(openapi).await;
    assert!(document["paths"]["/api/v1/admin/plugins"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/plugins"]["post"].is_object());
    assert!(document["paths"]["/api/v1/admin/plugins/{plugin_id}"]["patch"].is_object());
    assert!(document["paths"]["/api/v1/admin/plugins/{plugin_id}/invoke"]["post"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_api_rejects_unauthenticated_and_invalid_components_with_stable_errors(
    pool: PgPool,
) {
    let app = app_with_plugin_runtime(
        Database::from_pool(pool),
        AuthConfig::default().with_secure_cookies(false),
        PluginRuntime::enabled(PluginHostConfig::default()).expect("plugin runtime must configure"),
    );
    initialize(&app).await;
    let unauthenticated = app
        .clone()
        .oneshot(get_request("/api/v1/admin/plugins", ""))
        .await
        .expect("unauthenticated list must respond");
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let (cookies, csrf) = login(&app).await;
    let invalid = app
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            json!({
                "manifest": {
                    "schema_version": 1,
                    "key": "invalid_component",
                    "name": "Invalid component",
                    "version": "1.0.0",
                    "description": "",
                    "capabilities": ["content.transform"]
                },
                "component_base64": STANDARD.encode(b"not a component")
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("invalid component must respond");
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let request_id = invalid
        .headers()
        .get("x-request-id")
        .expect("error request id must exist")
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let invalid = response_json(invalid).await;
    assert_eq!(invalid["meta"]["request_id"], request_id);
    assert_eq!(invalid["error"]["code"], "plugin.invalid_component");
    assert!(invalid.to_string().find("Wasmtime").is_none());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_api_separates_read_install_lifecycle_and_invoke_capabilities(pool: PgPool) {
    let app = app_with_plugin_runtime(
        Database::from_pool(pool.clone()),
        AuthConfig::default().with_secure_cookies(false),
        PluginRuntime::enabled(PluginHostConfig::default()).expect("plugin runtime must configure"),
    );
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login(&app).await;
    let component = wat::parse_str(IDENTITY_COMPONENT).expect("identity component must parse");
    let installed = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            json!({
                "manifest": {
                    "schema_version": 1,
                    "key": "rbac_plugin",
                    "name": "RBAC plugin",
                    "version": "1.0.0",
                    "description": "Capability fixture",
                    "capabilities": ["content.transform"]
                },
                "component_base64": STANDARD.encode(&component)
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("owner install must respond");
    assert_eq!(installed.status(), StatusCode::CREATED);
    let plugin_id = response_json(installed).await["data"]["id"]
        .as_str()
        .expect("plugin id must exist")
        .to_owned();

    let registration = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "plugin_reader",
                "email": "plugin_reader@example.com",
                "display_name": "Plugin Reader",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("reader registration must respond");
    assert_eq!(registration.status(), StatusCode::CREATED);
    let reader_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM users WHERE username = 'plugin_reader'",
    )
    .fetch_one(&pool)
    .await
    .expect("reader id must load");
    let owner_id =
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE username = 'owner'")
            .fetch_one(&pool)
            .await
            .expect("owner id must load");
    let role_id = uuid::Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system)
         VALUES ($1, 'plugin_reader', 'Plugin reader', 'instance', FALSE)",
    )
    .bind(role_id)
    .execute(&pool)
    .await
    .expect("reader role must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE permission_key = 'plugins.read'",
    )
    .bind(role_id)
    .execute(&pool)
    .await
    .expect("reader permission must insert");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(uuid::Uuid::now_v7())
    .bind(reader_id)
    .bind(role_id)
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("reader assignment must insert");
    let (reader_cookies, reader_csrf) = login_as(&app, "plugin_reader").await;

    let readable = app
        .clone()
        .oneshot(get_request("/api/v1/admin/plugins", &reader_cookies))
        .await
        .expect("reader list must respond");
    assert_eq!(readable.status(), StatusCode::OK);

    let forbidden_install = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            json!({}),
            &reader_cookies,
            Some(&reader_csrf),
        ))
        .await
        .expect("reader install must respond");
    assert_eq!(forbidden_install.status(), StatusCode::FORBIDDEN);
    let forbidden_lifecycle = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/plugins/{plugin_id}"),
            json!({"status": "enabled", "expected_revision": 1}),
            &reader_cookies,
            Some(&reader_csrf),
        ))
        .await
        .expect("reader lifecycle must respond");
    assert_eq!(forbidden_lifecycle.status(), StatusCode::FORBIDDEN);
    let forbidden_invoke = app
        .oneshot(json_request(
            Method::POST,
            &format!("/api/v1/admin/plugins/{plugin_id}/invoke"),
            json!({"operation": "content_transform", "payload": "hello"}),
            &reader_cookies,
            Some(&reader_csrf),
        ))
        .await
        .expect("reader invoke must respond");
    assert_eq!(forbidden_invoke.status(), StatusCode::FORBIDDEN);
    for response in [forbidden_install, forbidden_lifecycle, forbidden_invoke] {
        assert_eq!(
            response_json(response).await["error"]["code"],
            "admin.forbidden"
        );
    }
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

async fn login(app: &axum::Router) -> (String, String) {
    login_as(app, "owner").await
}

async fn login_as(app: &axum::Router, username: &str) -> (String, String) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({"identifier": username, "password": "correct horse battery staple"}),
            "",
            None,
        ))
        .await
        .expect("login must respond");
    assert_eq!(response.status(), StatusCode::OK);
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
    let body = to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response must be JSON")
}
