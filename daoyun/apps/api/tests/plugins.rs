use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
#[cfg(feature = "wasm-plugins")]
use base64::{Engine as _, engine::general_purpose::STANDARD};
#[cfg(feature = "wasm-plugins")]
use daoyun_api::PluginHostConfig;
use daoyun_api::{AuthConfig, PluginRuntime, app_with_plugin_runtime};
use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

#[cfg(feature = "wasm-plugins")]
const IDENTITY_COMPONENT: &str =
    include_str!("../../../crates/plugin-host/tests/fixtures/identity-component.wat");

#[cfg(feature = "wasm-plugins")]
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
    assert_eq!(listed["data"][0]["manifest_schema_version"], 1);
    assert!(listed["data"][0]["business_api_version"].is_null());
    assert_eq!(listed["data"][0]["data_scopes"], json!([]));
    assert_eq!(listed["data"][0]["event_subscriptions"], json!([]));
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
    assert_eq!(
        document["components"]["schemas"]["PluginBusinessApiVersion"]["enum"],
        json!(["0.1.0"])
    );
    let plugin_schema = &document["components"]["schemas"]["Plugin"];
    assert!(
        plugin_schema["required"]
            .as_array()
            .expect("plugin required properties must be an array")
            .iter()
            .any(|property| property == "business_api_version")
    );
    assert_eq!(
        plugin_schema["properties"]["event_subscriptions"]["maxItems"],
        6
    );
    for property in ["capabilities", "data_scopes", "event_subscriptions"] {
        assert_eq!(
            plugin_schema["properties"][property]["uniqueItems"], true,
            "plugin response {property} must document unique values"
        );
    }
    let manifest_schema = &document["components"]["schemas"]["BusinessPluginManifestSchema"];
    assert_eq!(
        manifest_schema["properties"]["event_subscriptions"]["maxItems"],
        6
    );
    assert_eq!(
        manifest_schema["properties"]["event_subscriptions"]["uniqueItems"],
        true
    );
    assert_eq!(
        document["components"]["schemas"]["PluginManifestRequest"]["oneOf"]
            .as_array()
            .expect("manifest contract must be a oneOf")
            .len(),
        2
    );
    assert_eq!(
        document["components"]["schemas"]["PluginSchemaVersion"]["enum"],
        json!([1])
    );
    for property in ["capabilities", "data_scopes", "event_subscriptions"] {
        assert_eq!(
            manifest_schema["properties"][property]["uniqueItems"], true,
            "{property} must reject duplicate values in the public contract"
        );
    }
    assert_eq!(
        manifest_schema["properties"]["capabilities"]["maxItems"],
        16
    );
    assert_eq!(manifest_schema["properties"]["data_scopes"]["maxItems"], 8);
    let legacy_manifest = &document["components"]["schemas"]["LegacyPluginManifestSchema"];
    assert_eq!(
        legacy_manifest["properties"]["capabilities"]["uniqueItems"],
        true
    );
    assert!(
        legacy_manifest["properties"]
            .get("business_api_version")
            .is_none()
    );
    assert_eq!(
        document["components"]["schemas"]["LegacyPluginCapability"]["enum"],
        json!(["content.transform", "ui.panel"])
    );
    assert!(
        !document["components"]["schemas"]["BusinessPluginCapability"]["enum"]
            .as_array()
            .expect("business capabilities must be an enum")
            .iter()
            .any(|capability| capability == "content.transform")
    );
}

#[cfg(feature = "wasm-plugins")]
#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_api_rejects_unauthenticated_and_invalid_components_with_stable_errors(
    pool: PgPool,
) {
    let app = app_with_plugin_runtime(
        Database::from_pool(pool.clone()),
        AuthConfig::default().with_secure_cookies(false),
        PluginRuntime::enabled(PluginHostConfig::default()).expect("plugin runtime must configure"),
    );
    initialize(&app).await;
    let owner_id =
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE username = 'owner'")
            .fetch_one(&pool)
            .await
            .expect("owner id must load");
    let public_surface = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/plugin-ui/user_profile/{owner_id}"),
            "",
        ))
        .await
        .expect("public profile plugin surface must respond");
    assert_eq!(public_surface.status(), StatusCode::OK);
    assert_eq!(
        public_surface.headers()["cache-control"],
        "private, no-store"
    );
    assert_eq!(public_surface.headers()["vary"], "Cookie");
    assert_eq!(response_json(public_surface).await["data"], json!([]));
    let private_surface = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/plugin-ui/membership_panel/{owner_id}"),
            "",
        ))
        .await
        .expect("private membership plugin surface must respond");
    assert_eq!(private_surface.status(), StatusCode::UNAUTHORIZED);
    let unauthenticated = app
        .clone()
        .oneshot(get_request("/api/v1/admin/plugins", ""))
        .await
        .expect("unauthenticated list must respond");
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let (cookies, csrf) = login(&app).await;
    let mixed_component =
        wat::parse_str(IDENTITY_COMPONENT).expect("identity component must parse");
    let mixed = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            json!({
                "manifest": {
                    "schema_version": 1,
                    "key": "mixed_abi_component",
                    "name": "Mixed ABI component",
                    "version": "1.0.0",
                    "description": "",
                    "capabilities": ["content.transform", "core.query"],
                    "business_api_version": "0.1.0"
                },
                "component_base64": STANDARD.encode(mixed_component)
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("mixed ABI install must respond");
    assert_eq!(mixed.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(mixed).await["error"]["code"],
        "plugin.invalid_manifest"
    );
    let own_membership_surface = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/plugin-ui/membership_panel/{owner_id}"),
            &cookies,
        ))
        .await
        .expect("own membership plugin surface must respond");
    assert_eq!(own_membership_surface.status(), StatusCode::OK);
    assert_eq!(
        own_membership_surface.headers()["cache-control"],
        "private, no-store"
    );
    assert_eq!(own_membership_surface.headers()["vary"], "Cookie");
    let mismatched_membership_surface = app
        .clone()
        .oneshot(get_request(
            &format!(
                "/api/v1/plugin-ui/membership_panel/{}",
                uuid::Uuid::now_v7()
            ),
            &cookies,
        ))
        .await
        .expect("mismatched membership plugin surface must respond");
    assert_eq!(
        mismatched_membership_surface.status(),
        StatusCode::FORBIDDEN
    );
    let missing_action_csrf = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!(
                "/api/v1/plugin-ui/user_profile/{owner_id}/{}/actions",
                uuid::Uuid::now_v7()
            ),
            json!({
                "slot": "user_profile",
                "action_key": "profile.refresh",
                "idempotency_key": "surface-action",
                "subject_id": owner_id
            }),
            &cookies,
            None,
        ))
        .await
        .expect("surface action without CSRF must respond");
    assert_eq!(missing_action_csrf.status(), StatusCode::FORBIDDEN);
    let other_user_id = uuid::Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'plugin_action_other', 'plugin-action-other@example.com',
                 'Plugin action other', 'active')",
    )
    .bind(other_user_id)
    .execute(&pool)
    .await
    .expect("cross-user action fixture must insert");
    let cross_user_action = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!(
                "/api/v1/plugin-ui/user_profile/{other_user_id}/{}/actions",
                uuid::Uuid::now_v7()
            ),
            json!({
                "slot": "user_profile",
                "action_key": "profile.refresh",
                "idempotency_key": "surface-action-cross-user",
                "subject_id": other_user_id
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("cross-user surface action must respond");
    assert_eq!(cross_user_action.status(), StatusCode::FORBIDDEN);
    let missing_action_plugin = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!(
                "/api/v1/plugin-ui/user_profile/{owner_id}/{}/actions",
                uuid::Uuid::now_v7()
            ),
            json!({
                "slot": "user_profile",
                "action_key": "profile.refresh",
                "idempotency_key": "surface-action-missing-plugin",
                "subject_id": owner_id
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("surface action for a missing plugin must respond");
    assert_eq!(missing_action_plugin.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(missing_action_plugin).await["error"]["code"],
        "plugin.not_found"
    );
    let duplicate_manifest = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            json!({
                "manifest": {
                    "schema_version": 1,
                    "key": "duplicate_manifest",
                    "name": "Duplicate manifest",
                    "version": "1.0.0",
                    "description": "",
                    "capabilities": ["content.transform", "content.transform"]
                },
                "component_base64": STANDARD.encode(b"not reached")
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("duplicate manifest must respond");
    assert_eq!(
        duplicate_manifest.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        response_json(duplicate_manifest).await["error"]["code"],
        "plugin.invalid_manifest"
    );
    let repeated_subscriptions = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            json!({
                "manifest": {
                    "schema_version": 1,
                    "key": "repeated_subscriptions",
                    "name": "Repeated subscriptions",
                    "version": "1.0.0",
                    "description": "",
                    "capabilities": ["events.subscribe"],
                    "business_api_version": "0.1.0",
                    "data_scopes": [],
                    "event_subscriptions": [
                        "topic.published", "topic.published", "topic.published",
                        "topic.published", "topic.published", "topic.published",
                        "topic.published"
                    ]
                },
                "component_base64": STANDARD.encode(b"not reached")
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("repeated subscriptions must respond");
    assert_eq!(
        repeated_subscriptions.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let padded_manifest = format!(
        "{{\"manifest\":{{{}\"schema_version\":1,\"key\":\"padded_manifest\",\"name\":\"Padded manifest\",\"version\":\"1.0.0\",\"description\":\"\",\"capabilities\":[\"content.transform\"]}},\"component_base64\":\"AA==\"}}",
        " ".repeat(16 * 1024)
    );
    let oversized_manifest = app
        .clone()
        .oneshot(raw_json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            padded_manifest,
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("oversized manifest must respond");
    assert_eq!(
        oversized_manifest.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        response_json(oversized_manifest).await["error"]["code"],
        "plugin.invalid_manifest"
    );
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

#[cfg(feature = "wasm-plugins")]
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

#[cfg(feature = "wasm-plugins")]
fn raw_json_request(
    method: Method,
    uri: &str,
    body: String,
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
        .body(Body::from(body))
        .expect("raw JSON request must be valid")
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response must be JSON")
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn capability_snapshot_separates_native_provider_from_wasm_and_rebuilds_from_database(
    pool: PgPool,
) {
    let database = Database::from_pool(pool.clone());
    let app = app_with_plugin_runtime(
        database.clone(),
        AuthConfig::default().with_secure_cookies(false),
        PluginRuntime::disabled(),
    );
    initialize(&app).await;
    let (cookies, _) = login(&app).await;
    let provider_id = uuid::Uuid::now_v7();
    sqlx::query("INSERT INTO plugins (id, key, name, version, business_api_version, capabilities, data_scopes, component_bytes, component_sha256, status, installed_by) SELECT $1, 'snapshot_provider', 'Snapshot provider', '1.0.0', '0.1.0', '[\"topic.polls\",\"experience.write\"]'::jsonb, '[\"users.targeted\"]'::jsonb, $2, $3, 'enabled', id FROM users WHERE username = 'owner'")
        .bind(provider_id).bind(vec![0_u8]).bind("0".repeat(64)).execute(&pool).await.expect("provider fixture");
    let path = "/api/v1/admin/plugins/capabilities";
    let denied = app
        .clone()
        .oneshot(get_request(path, ""))
        .await
        .expect("anonymous response");
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    for current in [
        app.clone(),
        app_with_plugin_runtime(
            database.clone(),
            AuthConfig::default().with_secure_cookies(false),
            PluginRuntime::disabled(),
        ),
    ] {
        let response = current
            .oneshot(get_request(path, &cookies))
            .await
            .expect("capability response");
        assert_eq!(response.status(), StatusCode::OK);
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .expect("header")
            .to_owned();
        let body = response_json(response).await;
        assert_eq!(body["meta"]["request_id"], request_id);
        assert_eq!(body["data"]["wasm_runtime_enabled"], false);
        assert_eq!(
            body["data"]["wasm_supported"],
            cfg!(feature = "wasm-plugins")
        );
        assert_eq!(body["data"]["can_manage_lifecycle"], true);
        let modules = body["data"]["modules"].as_array().expect("modules");
        let polls = modules
            .iter()
            .find(|m| m["capability"] == "topic.polls")
            .expect("poll descriptor");
        assert_eq!(polls["status"], "available");
        assert_eq!(polls["execution"], "native");
        assert_eq!(polls["runtime_ready"], true);
        assert_eq!(polls["business_enabled"], true);
        assert_eq!(polls["target_authorization_required"], true);
        assert_eq!(
            modules
                .iter()
                .find(|m| m["capability"] == "experience.write")
                .expect("growth descriptor")["status"],
            if cfg!(feature = "wasm-plugins") {
                "runtime_disabled"
            } else {
                "unsupported"
            }
        );
        assert_eq!(
            modules
                .iter()
                .find(|m| m["capability"] == "membership.redemption")
                .expect("redemption descriptor")["status"],
            "not_configured"
        );
        assert!(body.to_string().find("component_bytes").is_none());
    }
    sqlx::query("UPDATE plugins SET status = 'disabled', revision = revision + 1 WHERE id = $1")
        .bind(provider_id)
        .execute(&pool)
        .await
        .expect("disable fixture");
    let body = response_json(
        app.clone()
            .oneshot(get_request(path, &cookies))
            .await
            .expect("disabled snapshot"),
    )
    .await;
    assert_eq!(
        body["data"]["modules"]
            .as_array()
            .expect("modules")
            .iter()
            .find(|m| m["capability"] == "topic.polls")
            .expect("poll descriptor")["status"],
        "disabled"
    );
    let document = response_json(
        app.oneshot(get_request("/api/v1/openapi.json", ""))
            .await
            .expect("OpenAPI"),
    )
    .await;
    assert!(document["paths"][path]["get"].is_object());
    assert!(document["components"]["schemas"]["PluginCapabilitiesSnapshot"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn builtin_modules_configure_disabled_and_use_native_lifecycle_without_wasm(pool: PgPool) {
    let app = app_with_plugin_runtime(
        Database::from_pool(pool.clone()),
        AuthConfig::default().with_secure_cookies(false),
        PluginRuntime::disabled(),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app).await;
    for key in [
        "official_polls",
        "official_points_redemption",
        "official_community_analytics",
        "official_topic_supplements",
        "official_topic_edit_review",
    ] {
        let path = format!("/api/v1/admin/plugins/builtins/{key}");
        for (cookie, token, expected) in [
            ("", None, StatusCode::UNAUTHORIZED),
            (cookies.as_str(), None, StatusCode::FORBIDDEN),
        ] {
            let response = app
                .clone()
                .oneshot(json_request(
                    Method::POST,
                    &path,
                    json!(null),
                    cookie,
                    token,
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
        let response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                &path,
                json!(null),
                &cookies,
                Some(&csrf),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        let body = response_json(response).await;
        assert_eq!(body["meta"]["request_id"], request_id);
        assert_eq!(body["data"]["execution"], "native");
        assert_eq!(body["data"]["status"], "disabled");
        assert_eq!(body["data"]["component_size"], 0);
        let id = body["data"]["id"].as_str().unwrap();
        let again = response_json(
            app.clone()
                .oneshot(json_request(
                    Method::POST,
                    &path,
                    json!(null),
                    &cookies,
                    Some(&csrf),
                ))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(again["data"], body["data"]);
        let enabled = app
            .clone()
            .oneshot(json_request(
                Method::PATCH,
                &format!("/api/v1/admin/plugins/{id}"),
                json!({"status":"enabled","expected_revision":1}),
                &cookies,
                Some(&csrf),
            ))
            .await
            .unwrap();
        assert_eq!(enabled.status(), StatusCode::OK);
        assert_eq!(response_json(enabled).await["data"]["revision"], 2);
        let stale = app
            .clone()
            .oneshot(json_request(
                Method::PATCH,
                &format!("/api/v1/admin/plugins/{id}"),
                json!({"status":"disabled","expected_revision":1}),
                &cookies,
                Some(&csrf),
            ))
            .await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::CONFLICT);
        assert!(
            Database::from_pool(pool.clone())
                .load_plugin_for_business_runtime(uuid::Uuid::parse_str(id).unwrap())
                .await
                .is_err()
        );
        let disabled = app
            .clone()
            .oneshot(json_request(
                Method::PATCH,
                &format!("/api/v1/admin/plugins/{id}"),
                json!({"status":"disabled","expected_revision":2}),
                &cookies,
                Some(&csrf),
            ))
            .await
            .unwrap();
        assert_eq!(disabled.status(), StatusCode::OK);
        let preserved = response_json(
            app.clone()
                .oneshot(json_request(
                    Method::POST,
                    &path,
                    json!(null),
                    &cookies,
                    Some(&csrf),
                ))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(preserved["data"]["status"], "disabled");
        assert_eq!(preserved["data"]["revision"], 3);
        let removal = app
            .clone()
            .oneshot(json_request(
                Method::DELETE,
                &format!("/api/v1/admin/plugins/{id}"),
                json!(null),
                &cookies,
                Some(&csrf),
            ))
            .await
            .unwrap();
        assert_eq!(removal.status(), StatusCode::CONFLICT);
    }
    let (left, right) = tokio::join!(
        app.clone().oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins/builtins/official_polls",
            json!(null),
            &cookies,
            Some(&csrf)
        )),
        app.clone().oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins/builtins/official_polls",
            json!(null),
            &cookies,
            Some(&csrf)
        ))
    );
    assert_eq!(
        response_json(left.unwrap()).await["data"],
        response_json(right.unwrap()).await["data"]
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM admin_audit_log WHERE action='plugin.builtin.configure'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        5
    );
    assert!(
        Database::from_pool(pool.clone())
            .list_enabled_business_ui_plugins()
            .await
            .unwrap()
            .is_empty()
    );
    for (caps, version) in [
        (json!(["topic.polls", "experience.write"]), Some("0.1.0")),
        (json!(["topic.polls"]), None),
    ] {
        let mut tx = pool.begin().await.unwrap();
        let denied = sqlx::query(
            "UPDATE plugins SET capabilities=$1,business_api_version=$2 WHERE key='official_polls'",
        )
        .bind(caps)
        .bind(version)
        .execute(&mut *tx)
        .await;
        assert!(
            denied.is_err(),
            "native contract cannot accept additional writes or a missing business contract"
        );
        tx.rollback().await.unwrap();
    }
    let unsupported = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins/builtins/official_growth_rewards",
            json!(null),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(unsupported.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let document = response_json(
        app.oneshot(get_request("/api/v1/openapi.json", ""))
            .await
            .unwrap(),
    )
    .await;
    assert!(document["paths"]["/api/v1/admin/plugins/builtins/{key}"]["post"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn builtin_configuration_preserves_a_conflicting_wasm_provider(pool: PgPool) {
    let app = app_with_plugin_runtime(
        Database::from_pool(pool.clone()),
        AuthConfig::default().with_secure_cookies(false),
        PluginRuntime::disabled(),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app).await;
    sqlx::query("INSERT INTO plugins(id,key,name,version,business_api_version,capabilities,component_bytes,component_sha256,status,installed_by) SELECT $1,'official_polls','Existing provider','0.1.0','0.1.0','[\"topic.polls\"]',$2,$3,'disabled',id FROM users WHERE username='owner'").bind(uuid::Uuid::now_v7()).bind(vec![0_u8]).bind("a".repeat(64)).execute(&pool).await.unwrap();
    let before: Value =
        sqlx::query_scalar("SELECT to_jsonb(p) FROM plugins p WHERE key='official_polls'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let response = app
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins/builtins/official_polls",
            json!(null),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let after: Value =
        sqlx::query_scalar("SELECT to_jsonb(p) FROM plugins p WHERE key='official_polls'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        after, before,
        "configuration must not silently replace an existing Wasm provider"
    );
}

#[cfg(not(feature = "wasm-plugins"))]
#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn base_build_preserves_wasm_history_and_rejects_execution_after_authorization(pool: PgPool) {
    let app = app_with_plugin_runtime(
        Database::from_pool(pool.clone()),
        AuthConfig::default().with_secure_cookies(false),
        PluginRuntime::disabled(),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app).await;
    let id = uuid::Uuid::now_v7();
    sqlx::query("INSERT INTO plugins (id, key, name, version, capabilities, component_bytes, component_sha256, status, installed_by) SELECT $1, 'external_history', 'External history', '1.0.0', '[\"content.transform\"]'::jsonb, $2, '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d', 'enabled', id FROM users WHERE username = 'owner'")
        .bind(id).bind(vec![0_u8]).execute(&pool).await.expect("historical Wasm fixture");
    let before: Value = sqlx::query_scalar("SELECT to_jsonb(p) FROM plugins p WHERE id = $1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let install = json!({"manifest":{"schema_version":1,"key":"new_external","name":"External","version":"1.0.0","description":"","capabilities":["content.transform"]},"component_base64":"AA=="});
    let invoke = format!("/api/v1/admin/plugins/{id}/invoke");
    for (path, body) in [
        ("/api/v1/admin/plugins", install.clone()),
        (
            invoke.as_str(),
            json!({"operation":"content_transform","payload":"input"}),
        ),
    ] {
        for (cookie, token, status) in [
            ("", None, StatusCode::UNAUTHORIZED),
            (cookies.as_str(), None, StatusCode::FORBIDDEN),
            (
                cookies.as_str(),
                Some(csrf.as_str()),
                StatusCode::SERVICE_UNAVAILABLE,
            ),
        ] {
            let response = app
                .clone()
                .oneshot(json_request(
                    Method::POST,
                    path,
                    body.clone(),
                    cookie,
                    token,
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), status);
            let request_id = response.headers()["x-request-id"]
                .to_str()
                .unwrap()
                .to_owned();
            let result = response_json(response).await;
            assert_eq!(result["meta"]["request_id"], request_id);
            if status == StatusCode::SERVICE_UNAVAILABLE {
                assert_eq!(result["error"]["code"], "plugin.execution_failed");
            }
        }
    }
    let mut invalid = install;
    invalid["manifest"]["capabilities"] = json!(["content.transform", "content.transform"]);
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/plugins",
            invalid,
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "plugin.invalid_manifest"
    );
    let response = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/plugins/{id}"),
            json!({"status":"enabled","expected_revision":1}),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let response = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/plugins/{id}/ui-contributions"),
            &cookies,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let listing = response_json(
        app.oneshot(get_request("/api/v1/admin/plugins", &cookies))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(listing["data"].as_array().unwrap().len(), 1);
    assert_eq!(listing["data"][0]["execution"], "wasm");
    assert_eq!(listing["data"][0]["status"], "enabled");
    let after: Value = sqlx::query_scalar("SELECT to_jsonb(p) FROM plugins p WHERE id = $1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, after);
}
