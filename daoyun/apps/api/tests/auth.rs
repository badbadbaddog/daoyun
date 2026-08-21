use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
    response::Response,
};
use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::time::Duration;
use tower::ServiceExt;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn registration_creates_a_cookie_session_that_can_be_refreshed_and_revoked(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize_instance(&app).await;

    let registration = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "member",
                "email": "member@example.com",
                "display_name": "社区成员",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("registration route must respond");
    assert_eq!(registration.status(), StatusCode::CREATED);
    assert_eq!(registration.headers()["cache-control"], "no-store");
    let csrf_cookie = cookie_value(&registration, "daoyun_csrf");
    let session_cookie = cookie_value(&registration, "daoyun_session");
    let csrf_token = csrf_cookie
        .split_once('=')
        .expect("CSRF cookie must contain a value")
        .1;
    assert!(
        set_cookie_values(&registration)
            .iter()
            .any(|value| value.contains("HttpOnly")
                && value.contains("SameSite=Strict")
                && value.contains("Path=/"))
    );
    let registration_payload = response_json(registration).await;
    assert_eq!(registration_payload["data"]["user"]["username"], "member");
    assert_eq!(registration_payload["data"]["csrf_token"], csrf_token);
    assert!(!registration_payload.to_string().contains("password"));
    assert!(!registration_payload.to_string().contains("token_hash"));

    let cookie_header = format!("{session_cookie}; {csrf_cookie}");
    let session_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header("cookie", &cookie_header)
                .body(Body::empty())
                .expect("session request must be valid"),
        )
        .await
        .expect("session route must respond");
    assert_eq!(session_response.status(), StatusCode::OK);
    let session_payload = response_json(session_response).await;
    assert_eq!(session_payload["data"]["csrf_token"], csrf_token);

    let logout_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/auth/logout")
                .header("cookie", &cookie_header)
                .header("x-csrf-token", csrf_token)
                .body(Body::empty())
                .expect("logout request must be valid"),
        )
        .await
        .expect("logout route must respond");
    assert_eq!(logout_response.status(), StatusCode::OK);
    assert_eq!(
        response_json(logout_response).await["data"]["logged_out"],
        true
    );
    let logout_events = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM security_audit_log WHERE event_type = 'auth.logout.succeeded'",
    )
    .fetch_one(&pool)
    .await
    .expect("logout audit event must be queryable");
    assert_eq!(logout_events, 1);
    let logout_metadata = sqlx::query_scalar::<_, Value>(
        "SELECT metadata FROM security_audit_log WHERE event_type = 'auth.logout.succeeded'",
    )
    .fetch_one(&pool)
    .await
    .expect("logout audit metadata must be queryable");
    assert_eq!(logout_metadata, json!({}));

    let after_logout = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header("cookie", &cookie_header)
                .body(Body::empty())
                .expect("session request must be valid"),
        )
        .await
        .expect("session route must respond");
    assert_eq!(after_logout.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(after_logout).await["error"]["code"],
        "auth.unauthenticated"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn registration_accepts_six_character_passwords_and_rejects_five(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize_instance(&app).await;

    let accepted = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "sixchar",
                "email": "sixchar@example.com",
                "display_name": "六位密码",
                "password": "123456"
            }),
        ))
        .await
        .expect("registration route must respond");
    assert_eq!(accepted.status(), StatusCode::CREATED);

    let rejected = app
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "fivechar",
                "email": "fivechar@example.com",
                "display_name": "五位密码",
                "password": "12345"
            }),
        ))
        .await
        .expect("registration route must respond");
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(rejected).await["error"]["fields"]["password"].is_array());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn registration_is_rejected_until_the_instance_is_initialized(pool: PgPool) {
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "member",
                "email": "member@example.com",
                "display_name": "社区成员",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("registration route must respond");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "system.not_ready"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn login_accepts_username_or_email_and_hides_credential_failure_reasons(pool: PgPool) {
    let app = daoyun_api::app(Database::from_pool(pool));
    initialize_instance(&app).await;

    for identifier in ["owner", "OWNER@example.com"] {
        let response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/api/v1/auth/login",
                json!({
                    "identifier": identifier,
                    "password": "correct horse battery staple"
                }),
            ))
            .await
            .expect("login route must respond");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response_json(response).await["data"]["user"]["username"],
            "owner"
        );
    }

    let mut failures = Vec::new();
    for (identifier, password) in [
        ("missing", "correct horse battery staple"),
        ("owner", "this password is incorrect"),
    ] {
        let response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/api/v1/auth/login",
                json!({ "identifier": identifier, "password": password }),
            ))
            .await
            .expect("login route must respond");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        failures.push(response_json(response).await["error"].clone());
    }
    assert_eq!(failures[0], failures[1]);
    assert_eq!(failures[0]["code"], "auth.invalid_credentials");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn login_records_security_outcomes_without_credentials(pool: PgPool) {
    let app = daoyun_api::app(Database::from_pool(pool.clone()));
    initialize_instance(&app).await;

    let success = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({
                "identifier": "owner",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("login route must respond");
    assert_eq!(success.status(), StatusCode::OK);

    let failure = app
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({
                "identifier": "owner",
                "password": "incorrect password"
            }),
        ))
        .await
        .expect("login route must respond");
    assert_eq!(failure.status(), StatusCode::UNAUTHORIZED);

    let events = sqlx::query_scalar::<_, String>(
        "SELECT event_type
         FROM security_audit_log
         ORDER BY created_at ASC, id ASC",
    )
    .fetch_all(&pool)
    .await
    .expect("security audit events must be queryable");
    assert!(events.iter().any(|event| event == "auth.login.succeeded"));
    assert!(events.iter().any(|event| event == "auth.login.failed"));

    let metadata = sqlx::query_scalar::<_, Value>(
        "SELECT metadata
         FROM security_audit_log
         WHERE event_type = 'auth.login.failed'
         ORDER BY created_at DESC, id DESC
         LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .expect("failed login audit metadata must be queryable");
    assert_eq!(metadata, json!({"method": "password"}));
    assert!(!metadata.to_string().contains("incorrect"));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn recent_authentication_requires_csrf_and_creates_one_time_operation_state(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize_instance(&app).await;

    let login = login(&app, "owner", "correct horse battery staple").await;
    let csrf_cookie = cookie_value(&login, "daoyun_csrf");
    let session_cookie = cookie_value(&login, "daoyun_session");
    let cookie_header = format!("{session_cookie}; {csrf_cookie}");
    let csrf_token = csrf_cookie.split_once('=').unwrap().1;

    let missing_csrf = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/auth/recent-auth")
                .header("cookie", &cookie_header)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "operation": "security.settings",
                        "password": "correct horse battery staple"
                    })
                    .to_string(),
                ))
                .expect("recent auth request must be valid"),
        )
        .await
        .expect("recent auth route must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let wrong_password = app
        .clone()
        .oneshot(recent_auth_request(
            &cookie_header,
            csrf_token,
            "security.settings",
            "incorrect password",
        ))
        .await
        .expect("recent auth route must respond");
    assert_eq!(wrong_password.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(wrong_password).await["error"]["code"],
        "auth.invalid_credentials"
    );

    let invalid_operation = app
        .clone()
        .oneshot(recent_auth_request(
            &cookie_header,
            csrf_token,
            "arbitrary.operation",
            "correct horse battery staple",
        ))
        .await
        .expect("recent auth route must respond");
    assert_eq!(invalid_operation.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let authenticated = app
        .clone()
        .oneshot(recent_auth_request(
            &cookie_header,
            csrf_token,
            "security.settings",
            "correct horse battery staple",
        ))
        .await
        .expect("recent auth route must respond");
    assert_eq!(authenticated.status(), StatusCode::OK);
    let payload = response_json(authenticated).await;
    assert_eq!(payload["data"]["authenticated"], true);
    assert!(payload["data"]["expires_at"].as_str().is_some());

    let records = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM recent_authentications WHERE operation = 'security.settings'",
    )
    .fetch_one(&pool)
    .await
    .expect("recent auth state must be queryable");
    assert_eq!(records, 1);
    let audit = sqlx::query_as::<_, (String, Value)>(
        "SELECT event_type, metadata
         FROM security_audit_log
         WHERE event_type IN ('auth.recent.failed', 'auth.recent.succeeded')
         ORDER BY created_at ASC, id ASC",
    )
    .fetch_all(&pool)
    .await
    .expect("recent auth audit events must be queryable");
    assert_eq!(audit.len(), 2);
    assert_eq!(audit[0].0, "auth.recent.failed");
    assert_eq!(audit[1].0, "auth.recent.succeeded");
    assert!(audit.iter().all(|(_, metadata)| {
        metadata["method"] == "password"
            && metadata["operation"] == "security.settings"
            && metadata.get("password").is_none()
    }));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn recent_authentication_attempts_are_rate_limited(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default()
        .with_secure_cookies(false)
        .with_attempt_limit(1);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize_instance(&app).await;

    let login = login(&app, "owner", "correct horse battery staple").await;
    let csrf_cookie = cookie_value(&login, "daoyun_csrf");
    let session_cookie = cookie_value(&login, "daoyun_session");
    let cookie_header = format!("{session_cookie}; {csrf_cookie}");
    let csrf_token = csrf_cookie.split_once('=').unwrap().1;

    let first = app
        .clone()
        .oneshot(recent_auth_request(
            &cookie_header,
            csrf_token,
            "security.settings",
            "incorrect password",
        ))
        .await
        .expect("recent auth route must respond");
    assert_eq!(first.status(), StatusCode::UNAUTHORIZED);

    let limited = app
        .oneshot(recent_auth_request(
            &cookie_header,
            csrf_token,
            "security.settings",
            "correct horse battery staple",
        ))
        .await
        .expect("recent auth route must respond");
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(limited.headers().contains_key("retry-after"));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn successful_recent_authentication_does_not_consume_failure_budget(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default()
        .with_secure_cookies(false)
        .with_attempt_limit(1);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize_instance(&app).await;

    let login = login(&app, "owner", "correct horse battery staple").await;
    let csrf_cookie = cookie_value(&login, "daoyun_csrf");
    let session_cookie = cookie_value(&login, "daoyun_session");
    let cookie_header = format!("{session_cookie}; {csrf_cookie}");
    let csrf_token = csrf_cookie.split_once('=').unwrap().1;

    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(recent_auth_request(
                &cookie_header,
                csrf_token,
                "security.settings",
                "correct horse battery staple",
            ))
            .await
            .expect("successful recent auth must respond");
        assert_eq!(response.status(), StatusCode::OK);
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn password_change_requires_recent_auth_and_rotates_current_session(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize_instance(&app).await;

    let current_login = login(&app, "owner", "correct horse battery staple").await;
    let current_session = cookie_value(&current_login, "daoyun_session");
    let current_csrf = cookie_value(&current_login, "daoyun_csrf");
    let current_csrf_token = current_csrf.split_once('=').unwrap().1;
    let current_cookies = format!("{current_session}; {current_csrf}");
    let other_login = login(&app, "owner", "correct horse battery staple").await;
    let other_session = cookie_value(&other_login, "daoyun_session");
    let other_csrf = cookie_value(&other_login, "daoyun_csrf");
    let other_cookies = format!("{other_session}; {other_csrf}");

    let anonymous = app
        .clone()
        .oneshot(change_password_request("", None, "new secure password"))
        .await
        .expect("password route must respond");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let invalid = app
        .clone()
        .oneshot(change_password_request(
            &current_cookies,
            Some(current_csrf_token),
            "12345",
        ))
        .await
        .expect("password route must respond");
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(invalid).await["error"]["fields"]["new_password"].is_array());

    let missing_csrf = app
        .clone()
        .oneshot(change_password_request(
            &current_cookies,
            None,
            "new secure password",
        ))
        .await
        .expect("password route must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let missing_recent_auth = app
        .clone()
        .oneshot(change_password_request(
            &current_cookies,
            Some(current_csrf_token),
            "new secure password",
        ))
        .await
        .expect("password route must respond");
    assert_eq!(missing_recent_auth.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(missing_recent_auth).await["error"]["code"],
        "auth.recent_auth_required"
    );

    let recent_auth = app
        .clone()
        .oneshot(recent_auth_request(
            &current_cookies,
            current_csrf_token,
            "security.settings",
            "correct horse battery staple",
        ))
        .await
        .expect("recent auth route must respond");
    assert_eq!(recent_auth.status(), StatusCode::OK);

    let changed = app
        .clone()
        .oneshot(change_password_request(
            &current_cookies,
            Some(current_csrf_token),
            "new secure password",
        ))
        .await
        .expect("password route must respond");
    assert_eq!(changed.status(), StatusCode::OK);
    assert_eq!(changed.headers()["cache-control"], "no-store");
    let new_csrf_cookie = cookie_value(&changed, "daoyun_csrf");
    let new_csrf_token = new_csrf_cookie.split_once('=').unwrap().1.to_owned();
    assert_ne!(new_csrf_token, current_csrf_token);
    let changed_payload = response_json(changed).await;
    assert_eq!(changed_payload["data"]["csrf_token"], new_csrf_token);
    assert!(!changed_payload.to_string().contains("password"));

    let old_password_login = login(&app, "owner", "correct horse battery staple").await;
    assert_eq!(old_password_login.status(), StatusCode::UNAUTHORIZED);
    let new_password_login = login(&app, "owner", "new secure password").await;
    assert_eq!(new_password_login.status(), StatusCode::OK);

    let other_session_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header("cookie", other_cookies)
                .body(Body::empty())
                .expect("session request must be valid"),
        )
        .await
        .expect("session route must respond");
    assert_eq!(other_session_response.status(), StatusCode::UNAUTHORIZED);

    let rotated_cookies = format!("{current_session}; {new_csrf_cookie}");
    let current_session_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header("cookie", &rotated_cookies)
                .body(Body::empty())
                .expect("session request must be valid"),
        )
        .await
        .expect("session route must respond");
    assert_eq!(current_session_response.status(), StatusCode::OK);

    let reused_recent_auth = app
        .oneshot(change_password_request(
            &rotated_cookies,
            Some(&new_csrf_token),
            "another secure password",
        ))
        .await
        .expect("password route must respond");
    assert_eq!(reused_recent_auth.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(reused_recent_auth).await["error"]["code"],
        "auth.recent_auth_required"
    );

    let audit_metadata = sqlx::query_scalar::<_, Value>(
        "SELECT metadata FROM security_audit_log
         WHERE event_type = 'auth.password.changed'",
    )
    .fetch_one(&pool)
    .await
    .expect("password change audit must be queryable");
    assert_eq!(audit_metadata, json!({"method": "password"}));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn duplicate_registration_does_not_reveal_which_identity_exists(pool: PgPool) {
    let app = daoyun_api::app(Database::from_pool(pool));
    initialize_instance(&app).await;

    let response = app
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "owner",
                "email": "different@example.com",
                "display_name": "重复用户",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("registration route must respond");
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let payload = response_json(response).await;
    assert_eq!(payload["error"]["code"], "auth.identity_unavailable");
    assert!(payload["error"].get("fields").is_none());
    assert!(!payload.to_string().contains("username"));
    assert!(!payload.to_string().contains("email"));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn logout_requires_the_session_bound_csrf_token(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize_instance(&app).await;
    let login = login(&app, "owner", "correct horse battery staple").await;
    let csrf_cookie = cookie_value(&login, "daoyun_csrf");
    let session_cookie = cookie_value(&login, "daoyun_session");
    let cookie_header = format!("{session_cookie}; {csrf_cookie}");

    for csrf_header in [None, Some(&"0".repeat(64))] {
        let mut request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/auth/logout")
            .header("cookie", &cookie_header);
        if let Some(csrf_header) = csrf_header {
            request = request.header("x-csrf-token", csrf_header);
        }
        let response = app
            .clone()
            .oneshot(
                request
                    .body(Body::empty())
                    .expect("logout request must be valid"),
            )
            .await
            .expect("logout route must respond");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "auth.csrf_failed"
        );
    }

    let session = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header("cookie", cookie_header)
                .body(Body::empty())
                .expect("session request must be valid"),
        )
        .await
        .expect("session route must respond");
    assert_eq!(session.status(), StatusCode::OK);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn authenticated_users_can_list_and_revoke_other_device_sessions(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize_instance(&app).await;

    let current_login = login(&app, "owner", "correct horse battery staple").await;
    let current_csrf = cookie_value(&current_login, "daoyun_csrf");
    let current_session = cookie_value(&current_login, "daoyun_session");
    let other_login = login(&app, "owner", "correct horse battery staple").await;
    let other_csrf = cookie_value(&other_login, "daoyun_csrf");
    let other_session = cookie_value(&other_login, "daoyun_session");
    let current_cookie_header = format!("{current_session}; {current_csrf}");
    let other_cookie_header = format!("{other_session}; {other_csrf}");

    let listed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/sessions")
                .header("cookie", &current_cookie_header)
                .body(Body::empty())
                .expect("session list request must be valid"),
        )
        .await
        .expect("session list route must respond");
    assert_eq!(listed.status(), StatusCode::OK);
    let sessions = response_json(listed).await["data"]
        .as_array()
        .cloned()
        .unwrap();
    assert_eq!(sessions.len(), 2);
    let current_id = sessions
        .iter()
        .find(|session| session["is_current"] == true)
        .and_then(|session| session["id"].as_str())
        .expect("the current session must be identifiable");
    let other_id = sessions
        .iter()
        .find(|session| session["is_current"] == false)
        .and_then(|session| session["id"].as_str())
        .expect("the other session must be listed");
    assert!(
        sessions
            .iter()
            .all(|session| session.get("token_hash").is_none())
    );

    let another_user = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "anothermember",
                "email": "anothermember@example.com",
                "display_name": "另一位成员",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("other user registration must respond");
    assert_eq!(another_user.status(), StatusCode::CREATED);
    let another_csrf = cookie_value(&another_user, "daoyun_csrf");
    let another_session = cookie_value(&another_user, "daoyun_session");
    let another_cookie_header = format!("{another_session}; {another_csrf}");
    let another_listed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/sessions")
                .header("cookie", another_cookie_header)
                .body(Body::empty())
                .expect("other user session list request must be valid"),
        )
        .await
        .expect("other user session list route must respond");
    let another_id = response_json(another_listed).await["data"][0]["id"]
        .as_str()
        .expect("other user session must be listed")
        .to_owned();
    let cross_account_revoke = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v1/auth/sessions/{another_id}"))
                .header("cookie", &current_cookie_header)
                .header("x-csrf-token", current_csrf.split_once('=').unwrap().1)
                .body(Body::empty())
                .expect("cross-account revoke request must be valid"),
        )
        .await
        .expect("cross-account revoke route must respond");
    assert_eq!(cross_account_revoke.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(cross_account_revoke).await["error"]["code"],
        "auth.session_not_found"
    );

    let current_revoke = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v1/auth/sessions/{current_id}"))
                .header("cookie", &current_cookie_header)
                .header("x-csrf-token", current_csrf.split_once('=').unwrap().1)
                .body(Body::empty())
                .expect("current session revoke request must be valid"),
        )
        .await
        .expect("current session revoke route must respond");
    assert_eq!(current_revoke.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(current_revoke).await["error"]["code"],
        "auth.current_session"
    );

    let missing_csrf = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v1/auth/sessions/{other_id}"))
                .header("cookie", &current_cookie_header)
                .body(Body::empty())
                .expect("missing csrf request must be valid"),
        )
        .await
        .expect("missing csrf route must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let revoked = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v1/auth/sessions/{other_id}"))
                .header("cookie", &current_cookie_header)
                .header("x-csrf-token", current_csrf.split_once('=').unwrap().1)
                .body(Body::empty())
                .expect("other session revoke request must be valid"),
        )
        .await
        .expect("other session revoke route must respond");
    assert_eq!(revoked.status(), StatusCode::OK);
    assert_eq!(response_json(revoked).await["data"]["revoked"], true);
    let revocation_events = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM security_audit_log WHERE event_type = 'auth.session.revoked'",
    )
    .fetch_one(&pool)
    .await
    .expect("session revocation audit event must be queryable");
    assert_eq!(revocation_events, 1);
    let revocation_metadata = sqlx::query_scalar::<_, Value>(
        "SELECT metadata FROM security_audit_log WHERE event_type = 'auth.session.revoked'",
    )
    .fetch_one(&pool)
    .await
    .expect("session revocation audit metadata must be queryable");
    assert_eq!(revocation_metadata, json!({}));

    let revoked_session = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header("cookie", other_cookie_header)
                .body(Body::empty())
                .expect("revoked session request must be valid"),
        )
        .await
        .expect("revoked session route must respond");
    assert_eq!(revoked_session.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn idle_expired_sessions_cannot_be_restored(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize_instance(&app).await;
    let login = login(&app, "owner", "correct horse battery staple").await;
    let csrf_cookie = cookie_value(&login, "daoyun_csrf");
    let session_cookie = cookie_value(&login, "daoyun_session");

    sqlx::query(
        "UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP - INTERVAL '2 seconds', \
         idle_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'",
    )
    .execute(&pool)
    .await
    .expect("session expiry fixture must update");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header("cookie", format!("{session_cookie}; {csrf_cookie}"))
                .body(Body::empty())
                .expect("session request must be valid"),
        )
        .await
        .expect("session route must respond");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn default_configuration_uses_secure_host_only_cookies(pool: PgPool) {
    let app = daoyun_api::app(Database::from_pool(pool));
    initialize_instance(&app).await;

    let response = login(&app, "owner", "correct horse battery staple").await;
    let cookies = set_cookie_values(&response);
    assert!(cookies.iter().any(|value| {
        value.starts_with("__Host-daoyun_session=")
            && value.contains("; Secure")
            && value.contains("; HttpOnly")
            && value.contains("; SameSite=Strict")
            && value.contains("; Path=/")
    }));
    assert!(cookies.iter().any(|value| {
        value.starts_with("__Host-daoyun_csrf=")
            && value.contains("; Secure")
            && !value.contains("; HttpOnly")
    }));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn login_attempts_are_rate_limited_with_retry_after(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_attempt_limit(1);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize_instance(&app).await;

    let first = login(&app, "owner", "this password is incorrect").await;
    assert_eq!(first.status(), StatusCode::UNAUTHORIZED);

    let second = login(&app, "owner", "this password is incorrect").await;
    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(second.headers().get("retry-after").is_some());
    assert_eq!(
        response_json(second).await["error"]["code"],
        "auth.rate_limited"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn successful_logins_do_not_consume_failure_budget(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default()
        .with_secure_cookies(false)
        .with_attempt_limit(1);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize_instance(&app).await;

    let first = login(&app, "owner", "correct horse battery staple").await;
    assert_eq!(first.status(), StatusCode::OK);
    let second = login(&app, "owner", "correct horse battery staple").await;
    assert_eq!(second.status(), StatusCode::OK);
}

#[tokio::test]
async fn auth_database_failures_are_correlated_and_do_not_leak_details() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "member",
                "email": "member@example.com",
                "display_name": "社区成员",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("registration route must respond");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let payload = response_json(response).await;
    assert_eq!(payload["meta"]["request_id"], request_id);
    assert!(!payload.to_string().contains("sqlx"));
    assert!(!payload.to_string().contains("connection"));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn unlink_external_identity_requires_recent_auth_and_rotates_csrf(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize_instance(&app).await;

    let current_login = login(&app, "owner", "correct horse battery staple").await;
    let current_session = cookie_value(&current_login, "daoyun_session");
    let current_csrf = cookie_value(&current_login, "daoyun_csrf");
    let current_csrf_token = current_csrf.split_once('=').unwrap().1;
    let current_cookies = format!("{current_session}; {current_csrf}");
    let _other_login = login(&app, "owner", "correct horse battery staple").await;
    let user_id =
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE username = 'owner'")
            .fetch_one(&pool)
            .await
            .expect("owner must be queryable");
    let identity_id = uuid::Uuid::now_v7();
    sqlx::query(
        "INSERT INTO external_identities
            (id, user_id, provider_key, subject, issuer)
         VALUES ($1, $2, 'google', 'subject', 'https://issuer.example.com')",
    )
    .bind(identity_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("identity fixture must be inserted");

    let missing_recent = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v1/auth/identities/{identity_id}/unlink"))
                .header("cookie", &current_cookies)
                .header("x-csrf-token", current_csrf_token)
                .body(Body::empty())
                .expect("unlink request must be valid"),
        )
        .await
        .expect("unlink route must respond");
    assert_eq!(missing_recent.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(missing_recent).await["error"]["code"],
        "auth.recent_auth_required"
    );

    let recent_auth = app
        .clone()
        .oneshot(recent_auth_request(
            &current_cookies,
            current_csrf_token,
            "security.settings",
            "correct horse battery staple",
        ))
        .await
        .expect("recent auth route must respond");
    assert_eq!(recent_auth.status(), StatusCode::OK);
    let unlinked = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v1/auth/identities/{identity_id}/unlink"))
                .header("cookie", &current_cookies)
                .header("x-csrf-token", current_csrf_token)
                .body(Body::empty())
                .expect("unlink request must be valid"),
        )
        .await
        .expect("unlink route must respond");
    assert_eq!(unlinked.status(), StatusCode::OK);
    let unlinked_cookies = set_cookie_values(&unlinked);
    let payload = response_json(unlinked).await;
    assert_eq!(payload["data"]["unlinked"], true);
    let rotated_csrf = payload["data"]["csrf_token"]
        .as_str()
        .expect("rotated CSRF must be returned")
        .to_owned();
    assert_ne!(rotated_csrf, current_csrf_token);
    assert!(
        unlinked_cookies
            .iter()
            .any(|value| value.starts_with("daoyun_csrf=") && value.contains(&rotated_csrf))
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM external_identities WHERE id = $1")
            .bind(identity_id)
            .fetch_one(&pool)
            .await
            .expect("identity count must be queryable"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM sessions WHERE user_id = $1 AND revoked_at IS NOT NULL",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("other session state must be queryable"),
        1
    );

    let current_cookie_header = format!("{current_session}; daoyun_csrf={rotated_csrf}");
    let fresh_recent = app
        .clone()
        .oneshot(recent_auth_request(
            &current_cookie_header,
            &rotated_csrf,
            "security.settings",
            "correct horse battery staple",
        ))
        .await
        .expect("recent auth route must respond");
    assert_eq!(fresh_recent.status(), StatusCode::OK);
    let missing_identity = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v1/auth/identities/{identity_id}/unlink"))
                .header("cookie", &current_cookie_header)
                .header("x-csrf-token", &rotated_csrf)
                .body(Body::empty())
                .expect("unlink request must be valid"),
        )
        .await
        .expect("unlink route must respond");
    assert_eq!(missing_identity.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(missing_identity).await["error"]["code"],
        "auth.identity_not_found"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn oidc_identity_binding_start_requires_csrf_recent_auth_and_an_owned_replacement_target(
    pool: PgPool,
) {
    let config = daoyun_api::AuthConfig::default()
        .with_secure_cookies(false)
        .with_oidc_provider_json(
            json!([{
                "provider_key": "google",
                "display_name": "Google",
                "issuer": "https://127.0.0.1:1",
                "client_id": "client-id",
                "client_secret": "client-secret",
                "redirect_uri": "https://community.example.com/api/v1/auth/oidc/google/callback"
            }])
            .to_string(),
        )
        .expect("OIDC provider config must be accepted");
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize_instance(&app).await;

    let current_login = login(&app, "owner", "correct horse battery staple").await;
    let current_session = cookie_value(&current_login, "daoyun_session");
    let current_csrf = cookie_value(&current_login, "daoyun_csrf");
    let current_csrf_token = current_csrf.split_once('=').unwrap().1;
    let current_cookies = format!("{current_session}; {current_csrf}");

    let listed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/identities")
                .header("cookie", &current_cookies)
                .body(Body::empty())
                .expect("identity list request must be valid"),
        )
        .await
        .expect("identity list route must respond");
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(response_json(listed).await["data"], json!([]));

    let missing_csrf = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/auth/oidc/google/bindings")
                .header("cookie", &current_cookies)
                .body(Body::empty())
                .expect("binding request must be valid"),
        )
        .await
        .expect("binding route must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(missing_csrf).await["error"]["code"],
        "auth.csrf_failed"
    );

    let missing_recent = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/auth/oidc/google/bindings")
                .header("cookie", &current_cookies)
                .header("x-csrf-token", current_csrf_token)
                .body(Body::empty())
                .expect("binding request must be valid"),
        )
        .await
        .expect("binding route must respond");
    assert_eq!(missing_recent.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(missing_recent).await["error"]["code"],
        "auth.recent_auth_required"
    );

    let recent_auth = app
        .clone()
        .oneshot(recent_auth_request(
            &current_cookies,
            current_csrf_token,
            "security.settings",
            "correct horse battery staple",
        ))
        .await
        .expect("recent authentication route must respond");
    assert_eq!(recent_auth.status(), StatusCode::OK);

    let invalid_identity = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/auth/oidc/google/bindings/not-a-uuid/replacement")
                .header("cookie", &current_cookies)
                .header("x-csrf-token", current_csrf_token)
                .body(Body::empty())
                .expect("replacement request must be valid"),
        )
        .await
        .expect("replacement route must respond");
    assert_eq!(invalid_identity.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let missing_identity = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v1/auth/oidc/google/bindings/{}/replacement",
                    uuid::Uuid::now_v7()
                ))
                .header("cookie", &current_cookies)
                .header("x-csrf-token", current_csrf_token)
                .body(Body::empty())
                .expect("replacement request must be valid"),
        )
        .await
        .expect("replacement route must respond");
    assert_eq!(missing_identity.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(missing_identity).await["error"]["code"],
        "auth.identity_not_found"
    );
}

#[tokio::test]
async fn openapi_documents_all_authentication_operations() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .expect("OpenAPI request must be valid"),
        )
        .await
        .expect("OpenAPI route must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let document = response_json(response).await;
    for (path, method) in [
        ("/api/v1/auth/register", "post"),
        ("/api/v1/auth/login", "post"),
        ("/api/v1/auth/recent-auth", "post"),
        ("/api/v1/auth/passkeys/registration/options", "post"),
        ("/api/v1/auth/passkeys/registration/verify", "post"),
        ("/api/v1/auth/passkeys/assertion/options", "post"),
        ("/api/v1/auth/passkeys/assertion/verify", "post"),
        ("/api/v1/auth/passkeys", "get"),
        ("/api/v1/auth/passkeys/{passkey_id}", "delete"),
        ("/api/v1/auth/providers", "get"),
        ("/api/v1/auth/oidc/claim", "get"),
        ("/api/v1/auth/oidc/claim/account", "post"),
        ("/api/v1/auth/oidc/claim/bind", "post"),
        ("/api/v1/auth/identities", "get"),
        ("/api/v1/auth/oidc/{provider}/bindings", "post"),
        (
            "/api/v1/auth/oidc/{provider}/bindings/{identity_id}/replacement",
            "post",
        ),
        ("/api/v1/auth/oidc/{provider}/start", "get"),
        ("/api/v1/auth/oidc/{provider}/callback", "get"),
        ("/api/v1/auth/password", "post"),
        ("/api/v1/auth/session", "get"),
        ("/api/v1/auth/logout", "post"),
        ("/api/v1/auth/sessions", "get"),
        ("/api/v1/auth/sessions/{session_id}", "delete"),
        ("/api/v1/auth/identities/{identity_id}/unlink", "post"),
    ] {
        assert!(document["paths"][path][method].is_object());
    }
    for schema in [
        "RegisterRequest",
        "LoginRequest",
        "RecentAuthRequest",
        "RecentAuthData",
        "PasskeyRegistrationOptionsData",
        "PasskeyRegistrationOptions",
        "PasskeyAssertionOptionsData",
        "PasskeyAssertionOptions",
        "PasskeyRegistrationData",
        "PasskeyRegistrationVerifyRequest",
        "PasskeyAssertionVerifyRequest",
        "PasskeyCredentialSummary",
        "PasskeyDeleteData",
        "OidcProvider",
        "ExternalIdentity",
        "OidcAuthorizationStartData",
        "OidcClaimData",
        "OidcClaimAccountRequest",
        "OidcClaimBindData",
        "ChangePasswordRequest",
        "ChangePasswordData",
        "AuthenticatedSession",
        "AuthenticatedUser",
        "LogoutData",
        "DeviceSession",
        "RevokeDeviceSessionData",
        "UnlinkExternalIdentityData",
    ] {
        assert!(document["components"]["schemas"][schema].is_object());
    }
    assert_eq!(
        document["components"]["schemas"]["RegisterRequest"]["properties"]["password"]["minLength"],
        6
    );
    assert_eq!(
        document["components"]["schemas"]["RegisterRequest"]["properties"]["password"]["maxLength"],
        128
    );
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

async fn login(app: &axum::Router, identifier: &str, password: &str) -> Response {
    app.clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({ "identifier": identifier, "password": password }),
        ))
        .await
        .expect("login route must respond")
}

fn json_request(method: Method, uri: &str, value: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(value.to_string()))
        .expect("JSON request must be valid")
}

fn recent_auth_request(
    cookie_header: &str,
    csrf_token: &str,
    operation: &str,
    password: &str,
) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri("/api/v1/auth/recent-auth")
        .header("cookie", cookie_header)
        .header("x-csrf-token", csrf_token)
        .header("content-type", "application/json")
        .body(Body::from(
            json!({ "operation": operation, "password": password }).to_string(),
        ))
        .expect("recent auth request must be valid")
}

fn change_password_request(
    cookie_header: &str,
    csrf_token: Option<&str>,
    new_password: &str,
) -> Request<Body> {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/auth/password")
        .header("content-type", "application/json");
    if !cookie_header.is_empty() {
        request = request.header("cookie", cookie_header);
    }
    if let Some(csrf_token) = csrf_token {
        request = request.header("x-csrf-token", csrf_token);
    }
    request
        .body(Body::from(
            json!({ "new_password": new_password }).to_string(),
        ))
        .expect("password change request must be valid")
}

fn set_cookie_values(response: &Response) -> Vec<String> {
    response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().expect("set-cookie must be text").to_owned())
        .collect()
}

fn cookie_value(response: &Response, name: &str) -> String {
    set_cookie_values(response)
        .iter()
        .find_map(|value| {
            let pair = value.split(';').next()?;
            let (key, value) = pair.split_once('=')?;
            (key == name).then(|| format!("{key}={value}"))
        })
        .unwrap_or_else(|| panic!("cookie {name} must be set"))
}

async fn response_json(response: Response) -> Value {
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response body must be JSON")
}

fn unavailable_database() -> Database {
    let pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(100))
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .expect("unavailable database URL must be valid");
    Database::from_pool(pool)
}
