use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
    response::Response,
};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::PgPool;
use totp_rs::{Builder, Secret};
use tower::ServiceExt;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn mfa_setup_recovery_rotation_and_disable_are_protected(pool: PgPool) {
    let key = BASE64.encode([9_u8; 32]);
    let mfa = daoyun_api::MfaRuntime::from_key_material(Some(&key)).expect("MFA key must parse");
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_runtime_and_mfa(
        Database::from_pool(pool.clone()),
        config,
        daoyun_api::CacheRuntime::disabled(),
        mfa,
    );
    initialize_instance(&app).await;
    let initial_login = login(&app).await;
    let session_cookie = cookie_value(&initial_login, "daoyun_session");
    let csrf_cookie = cookie_value(&initial_login, "daoyun_csrf");
    let csrf = cookie_token(&csrf_cookie).to_owned();
    let cookies = format!("{session_cookie}; {csrf_cookie}");

    let denied = app
        .clone()
        .oneshot(state_request(
            "/api/v1/auth/mfa/totp/setup",
            &cookies,
            &csrf,
            None,
        ))
        .await
        .expect("setup route must respond");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(denied).await["error"]["code"],
        "auth.recent_auth_required"
    );

    recent_auth(&app, &cookies, &csrf).await;
    let setup = app
        .clone()
        .oneshot(state_request(
            "/api/v1/auth/mfa/totp/setup",
            &cookies,
            &csrf,
            None,
        ))
        .await
        .expect("setup route must respond");
    assert_eq!(setup.status(), StatusCode::OK);
    let setup = response_json(setup).await;
    let secret = Secret::try_from_base32(setup["data"]["secret_base32"].as_str().unwrap())
        .expect("setup secret must decode");
    let code = Builder::new()
        .with_secret(secret)
        .build()
        .expect("TOTP must build")
        .generate_current()
        .to_string();
    let enabled = app
        .clone()
        .oneshot(state_request(
            "/api/v1/auth/mfa/totp/enable",
            &cookies,
            &csrf,
            Some(json!({ "code": code })),
        ))
        .await
        .expect("enable route must respond");
    assert_eq!(enabled.status(), StatusCode::OK);
    let rotated_csrf_cookie = cookie_value(&enabled, "daoyun_csrf");
    let rotated_csrf = cookie_token(&rotated_csrf_cookie).to_owned();
    let enabled = response_json(enabled).await;
    let original_recovery_codes = enabled["data"]["recovery_codes"].as_array().unwrap();
    assert_eq!(original_recovery_codes.len(), 10);
    let challenge_code = original_recovery_codes[0].as_str().unwrap().to_owned();
    let recovery_code = original_recovery_codes[1].as_str().unwrap().to_owned();
    let rotated_cookies = format!("{session_cookie}; {rotated_csrf_cookie}");

    let logout = app
        .clone()
        .oneshot(state_request(
            "/api/v1/auth/logout",
            &rotated_cookies,
            &rotated_csrf,
            None,
        ))
        .await
        .expect("logout route must respond");
    assert_eq!(logout.status(), StatusCode::OK);
    let pending = login(&app).await;
    assert_eq!(pending.status(), StatusCode::ACCEPTED);
    let challenge_cookie = cookie_value(&pending, "daoyun_mfa_challenge");
    let pending = response_json(pending).await;
    let challenge_id = pending["data"]["challenge_id"].as_str().unwrap();
    let completed = app
        .clone()
        .oneshot(json_request_with_cookie(
            Method::POST,
            "/api/v1/auth/mfa/verify",
            json!({ "challenge_id": challenge_id, "code": challenge_code }),
            &challenge_cookie,
        ))
        .await
        .expect("MFA verification route must respond");
    assert_eq!(completed.status(), StatusCode::OK);
    let session_cookie = cookie_value(&completed, "daoyun_session");
    let rotated_csrf_cookie = cookie_value(&completed, "daoyun_csrf");
    let rotated_csrf = cookie_token(&rotated_csrf_cookie).to_owned();
    let rotated_cookies = format!("{session_cookie}; {rotated_csrf_cookie}");

    let status = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/mfa")
                .header("cookie", &rotated_cookies)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("status route must respond");
    let status = response_json(status).await;
    assert_eq!(status["data"]["enabled"], true);
    assert_eq!(status["data"]["recovery_codes_remaining"], 9);

    recent_auth(&app, &rotated_cookies, &rotated_csrf).await;
    let regenerated = app
        .clone()
        .oneshot(state_request(
            "/api/v1/auth/mfa/recovery-codes/regenerate",
            &rotated_cookies,
            &rotated_csrf,
            Some(json!({ "code": recovery_code })),
        ))
        .await
        .expect("regeneration route must respond");
    assert_eq!(regenerated.status(), StatusCode::OK);
    let next_csrf_cookie = cookie_value(&regenerated, "daoyun_csrf");
    let next_csrf = cookie_token(&next_csrf_cookie).to_owned();
    let regenerated = response_json(regenerated).await;
    let disable_code = regenerated["data"]["recovery_codes"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let next_cookies = format!("{session_cookie}; {next_csrf_cookie}");

    recent_auth(&app, &next_cookies, &next_csrf).await;
    let disabled = app
        .clone()
        .oneshot(state_request(
            "/api/v1/auth/mfa/disable",
            &next_cookies,
            &next_csrf,
            Some(json!({ "code": disable_code })),
        ))
        .await
        .expect("disable route must respond");
    assert_eq!(disabled.status(), StatusCode::OK);
    assert_eq!(response_json(disabled).await["data"]["disabled"], true);

    let audit = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM security_audit_log WHERE event_type LIKE 'auth.mfa.%'",
    )
    .fetch_one(&pool)
    .await
    .expect("MFA audit rows must query");
    assert_eq!(audit, 3);
}

async fn initialize_instance(app: &axum::Router) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/installation",
            json!({
                "username": "owner",
                "email": "owner@example.com",
                "display_name": "站点管理员",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("installation route must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
}

async fn login(app: &axum::Router) -> Response {
    app.clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({ "identifier": "owner", "password": "correct horse battery staple" }),
        ))
        .await
        .expect("login route must respond")
}

async fn recent_auth(app: &axum::Router, cookies: &str, csrf: &str) {
    let response = app
        .clone()
        .oneshot(state_request(
            "/api/v1/auth/recent-auth",
            cookies,
            csrf,
            Some(json!({
                "operation": "security.settings",
                "password": "correct horse battery staple"
            })),
        ))
        .await
        .expect("recent auth route must respond");
    assert_eq!(response.status(), StatusCode::OK);
}

fn json_request(method: Method, uri: &str, value: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(value.to_string()))
        .unwrap()
}

fn json_request_with_cookie(
    method: Method,
    uri: &str,
    value: Value,
    cookie: &str,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .body(Body::from(value.to_string()))
        .unwrap()
}

fn state_request(uri: &str, cookies: &str, csrf: &str, body: Option<Value>) -> Request<Body> {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header("cookie", cookies)
        .header("x-csrf-token", csrf);
    if body.is_some() {
        request = request.header("content-type", "application/json");
    }
    request
        .body(Body::from(
            body.map(|value| value.to_string()).unwrap_or_default(),
        ))
        .unwrap()
}

fn cookie_value(response: &Response, name: &str) -> String {
    response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(|value| {
            let (key, value) = value.split(';').next()?.split_once('=')?;
            (key == name).then(|| format!("{key}={value}"))
        })
        .unwrap_or_else(|| panic!("cookie {name} must be set"))
}

fn cookie_token(cookie: &str) -> &str {
    cookie.split_once('=').expect("cookie must have a value").1
}

async fn response_json(response: Response) -> Value {
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must read");
    serde_json::from_slice(&body).expect("response body must be JSON")
}
