use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn profile_and_relationship_routes_enforce_visibility_revision_and_csrf(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize(&app).await;
    let member = register(&app, "member", "社区成员").await;
    let owner = login(&app, "owner").await;

    let anonymous_profile = app
        .clone()
        .oneshot(get_request("/api/v1/users/member", ""))
        .await
        .expect("anonymous profile request must respond");
    assert_eq!(anonymous_profile.status(), StatusCode::OK);
    let anonymous_payload = response_json(anonymous_profile).await;
    assert_eq!(anonymous_payload["data"]["username"], "member");
    assert!(anonymous_payload["data"]["viewer"].is_null());
    assert!(anonymous_payload["data"].get("email").is_none());

    let invalid_cookies = format!(
        "daoyun_session={}; daoyun_csrf={}",
        "a".repeat(64),
        "b".repeat(64)
    );
    let invalid_session_profile = app
        .clone()
        .oneshot(get_request("/api/v1/users/member", &invalid_cookies))
        .await
        .expect("profile request with an invalid session must respond");
    assert_eq!(invalid_session_profile.status(), StatusCode::OK);
    let cleared_cookies = invalid_session_profile
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().expect("set-cookie must be text"))
        .collect::<Vec<_>>();
    assert_eq!(cleared_cookies.len(), 2);
    assert!(
        cleared_cookies
            .iter()
            .all(|value| value.contains("Max-Age=0"))
    );
    assert!(response_json(invalid_session_profile).await["data"]["viewer"].is_null());

    let owner_profile = app
        .clone()
        .oneshot(get_request("/api/v1/users/member", &owner.cookies))
        .await
        .expect("authenticated profile request must respond");
    assert_eq!(owner_profile.status(), StatusCode::OK);
    assert_eq!(
        response_json(owner_profile).await["data"]["viewer"]["is_following"],
        false
    );

    let missing_csrf = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/users/me",
            serde_json::json!({
                "base_revision": 1,
                "display_name": "新名称",
                "bio": "简介",
                "location": null,
                "website_url": null,
                "avatar_url": null
            }),
            &member.cookies,
            None,
        ))
        .await
        .expect("profile update without CSRF must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let invalid_avatar = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/users/me",
            serde_json::json!({
                "base_revision": 1,
                "display_name": "新名称",
                "bio": "简介",
                "location": null,
                "website_url": null,
                "avatar_url": "http://example.com/avatar.png"
            }),
            &member.cookies,
            Some(&member.csrf),
        ))
        .await
        .expect("invalid avatar profile update must respond");
    assert_eq!(invalid_avatar.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(invalid_avatar).await["error"]["fields"]["avatar_url"].is_array());

    let updated = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/users/me",
            serde_json::json!({
                "base_revision": 1,
                "display_name": "新名称",
                "bio": "公开简介",
                "location": "杭州",
                "website_url": "https://example.com",
                "avatar_url": "https://example.com/avatar.png"
            }),
            &member.cookies,
            Some(&member.csrf),
        ))
        .await
        .expect("profile update must respond");
    assert_eq!(updated.status(), StatusCode::OK);
    let updated_payload = response_json(updated).await;
    assert_eq!(updated_payload["data"]["display_name"], "新名称");
    assert_eq!(updated_payload["data"]["profile_revision"], 2);

    let conflict = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/users/me",
            serde_json::json!({
                "base_revision": 1,
                "display_name": "陈旧名称",
                "bio": "",
                "location": null,
                "website_url": null,
                "avatar_url": null
            }),
            &member.cookies,
            Some(&member.csrf),
        ))
        .await
        .expect("stale profile update must respond");
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(conflict).await["error"]["code"],
        "profile.revision_conflict"
    );

    let follow_path = format!("/api/v1/users/{}/follow", member.user_id);
    for expected_count in [1, 1] {
        let followed = app
            .clone()
            .oneshot(state_change_request(
                Method::PUT,
                &follow_path,
                &owner.cookies,
                &owner.csrf,
            ))
            .await
            .expect("follow request must respond");
        assert_eq!(followed.status(), StatusCode::OK);
        let followed_payload = response_json(followed).await;
        assert_eq!(followed_payload["data"]["following"], true);
        assert_eq!(followed_payload["data"]["follower_count"], expected_count);
    }

    let followed_profile = app
        .clone()
        .oneshot(get_request("/api/v1/users/member", &owner.cookies))
        .await
        .expect("followed profile request must respond");
    assert_eq!(
        response_json(followed_profile).await["data"]["viewer"]["is_following"],
        true
    );

    let block_path = format!("/api/v1/users/{}/block", member.user_id);
    let blocked = app
        .clone()
        .oneshot(state_change_request(
            Method::PUT,
            &block_path,
            &owner.cookies,
            &owner.csrf,
        ))
        .await
        .expect("block request must respond");
    assert_eq!(blocked.status(), StatusCode::OK);
    assert_eq!(response_json(blocked).await["data"]["blocked"], true);

    let hidden_follow = app
        .clone()
        .oneshot(state_change_request(
            Method::PUT,
            &follow_path,
            &owner.cookies,
            &owner.csrf,
        ))
        .await
        .expect("blocked follow request must respond");
    assert_eq!(hidden_follow.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(hidden_follow).await["error"]["code"],
        "user.not_found"
    );

    let unblocked = app
        .clone()
        .oneshot(state_change_request(
            Method::DELETE,
            &block_path,
            &owner.cookies,
            &owner.csrf,
        ))
        .await
        .expect("unblock request must respond");
    assert_eq!(unblocked.status(), StatusCode::OK);
    assert_eq!(response_json(unblocked).await["data"]["blocked"], false);

    let self_follow_path = format!("/api/v1/users/{}/follow", member.user_id);
    let self_follow = app
        .clone()
        .oneshot(state_change_request(
            Method::PUT,
            &self_follow_path,
            &member.cookies,
            &member.csrf,
        ))
        .await
        .expect("self follow request must respond");
    assert_eq!(self_follow.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(self_follow).await["error"]["code"],
        "relationship.self_follow_not_allowed"
    );

    let missing = app
        .clone()
        .oneshot(get_request("/api/v1/users/unknown", ""))
        .await
        .expect("missing profile request must respond");
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(missing).await["error"]["code"],
        "user.not_found"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn relationship_list_routes_are_public_paginated_and_cursor_scoped(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize(&app).await;
    let first = register(&app, "first", "第一位成员").await;
    let second = register(&app, "second", "第二位成员").await;
    let outsider = register(&app, "outsider", "无关成员").await;
    let owner = login(&app, "owner").await;

    for target in [&first, &second] {
        let response = app
            .clone()
            .oneshot(state_change_request(
                Method::PUT,
                &format!("/api/v1/users/{}/follow", target.user_id),
                &owner.cookies,
                &owner.csrf,
            ))
            .await
            .expect("follow request must respond");
        assert_eq!(response.status(), StatusCode::OK);
    }

    let first_page = app
        .clone()
        .oneshot(get_request("/api/v1/users/owner/following?limit=1", ""))
        .await
        .expect("first following page must respond");
    assert_eq!(first_page.status(), StatusCode::OK);
    let first_payload = response_json(first_page).await;
    assert_eq!(first_payload["data"].as_array().map(Vec::len), Some(1));
    assert!(first_payload["data"][0].get("email").is_none());
    let cursor = first_payload["meta"]["next_cursor"]
        .as_str()
        .expect("full first page must expose a cursor");

    let second_page = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/users/owner/following?limit=1&cursor={cursor}"),
            "",
        ))
        .await
        .expect("second following page must respond");
    assert_eq!(second_page.status(), StatusCode::OK);
    let second_payload = response_json(second_page).await;
    assert_eq!(second_payload["data"].as_array().map(Vec::len), Some(1));
    assert!(second_payload["meta"]["next_cursor"].is_null());
    assert_ne!(
        first_payload["data"][0]["id"],
        second_payload["data"][0]["id"]
    );

    let follower_page = app
        .clone()
        .oneshot(get_request("/api/v1/users/first/followers", ""))
        .await
        .expect("follower page must respond");
    assert_eq!(follower_page.status(), StatusCode::OK);
    assert_eq!(
        response_json(follower_page).await["data"][0]["username"],
        "owner"
    );

    let invalid_cursor = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/users/owner/following?cursor={}", outsider.user_id),
            "",
        ))
        .await
        .expect("foreign cursor request must respond");
    assert_eq!(invalid_cursor.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(invalid_cursor).await["error"]["fields"]["cursor"].is_array());

    let missing = app
        .clone()
        .oneshot(get_request("/api/v1/users/unknown/followers", ""))
        .await
        .expect("missing relation owner request must respond");
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(missing).await["error"]["code"],
        "user.not_found"
    );
}

#[tokio::test]
async fn openapi_documents_user_profile_and_relationship_routes() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI route must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let document = response_json(response).await;

    assert!(document["paths"]["/api/v1/users/{username}"]["get"].is_object());
    assert!(document["paths"]["/api/v1/users/me"]["patch"].is_object());
    assert!(document["paths"]["/api/v1/users/{username}/followers"]["get"].is_object());
    assert!(document["paths"]["/api/v1/users/{username}/following"]["get"].is_object());
    for action in ["follow", "block"] {
        let path = format!("/api/v1/users/{{user_id}}/{action}");
        assert!(document["paths"][&path]["put"].is_object());
        assert!(document["paths"][&path]["delete"].is_object());
    }
    for schema in [
        "UserSummary",
        "UserProfileViewer",
        "UserProfile",
        "UpdateUserProfileRequest",
        "FollowState",
        "BlockState",
        "AdminUserStatus",
        "AdminUserSummary",
        "AdminUserDetail",
        "UpdateAdminUserStatusRequest",
        "AdminUserStatusUpdate",
        "AdminUserContentKind",
        "AdminUserContentItem",
    ] {
        assert!(
            document["components"]["schemas"][schema].is_object(),
            "{schema}"
        );
    }
    for path in [
        "/api/v1/admin/users",
        "/api/v1/admin/users/{user_id}",
        "/api/v1/admin/users/{user_id}/content",
        "/api/v1/admin/users/{user_id}/reports",
    ] {
        assert!(document["paths"][path]["get"].is_object(), "{path}");
    }
    assert!(document["paths"]["/api/v1/admin/users/{user_id}/status"]["patch"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_user_routes_require_capability_and_exclude_private_identity_fields(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize(&app).await;
    let member = register(&app, "manageduser", "受管用户").await;
    let owner = login(&app, "owner").await;

    let forbidden = app
        .clone()
        .oneshot(get_request("/api/v1/admin/users", &member.cookies))
        .await
        .expect("forbidden admin user request must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(forbidden).await["error"]["code"],
        "admin.forbidden"
    );

    let list = app
        .clone()
        .oneshot(get_request("/api/v1/admin/users?q=受管", &owner.cookies))
        .await
        .expect("admin user list must respond");
    assert_eq!(list.status(), StatusCode::OK);
    let request_id = list.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let payload = response_json(list).await;
    assert_eq!(payload["meta"]["request_id"], request_id);
    assert_eq!(payload["data"][0]["id"], member.user_id);
    let serialized = payload["data"][0].to_string();
    for private_field in ["email", "password", "session", "token", "external_identity"] {
        assert!(!serialized.contains(private_field));
    }

    for suffix in ["", "/content", "/reports"] {
        let response = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/users/{}{}", member.user_id, suffix),
                &owner.cookies,
            ))
            .await
            .expect("admin user detail request must respond");
        assert_eq!(response.status(), StatusCode::OK, "{suffix}");
    }

    let invalid_limit = app
        .clone()
        .oneshot(get_request("/api/v1/admin/users?limit=0", &owner.cookies))
        .await
        .expect("invalid user query must respond");
    assert_eq!(invalid_limit.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_user_status_route_enforces_csrf_revision_rules_and_restricted_session_behavior(
    pool: PgPool,
) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize(&app).await;
    let member = register(&app, "statusmember", "状态成员").await;
    let owner = login(&app, "owner").await;
    let uri = format!("/api/v1/admin/users/{}/status", member.user_id);
    let expires_at = (time::OffsetDateTime::now_utc() + time::Duration::days(1))
        .format(&time::format_description::well_known::Rfc3339)
        .expect("future expiry must format as RFC 3339");
    let restriction = serde_json::json!({
        "status": "restricted",
        "reason": "等待内容复核",
        "expires_at": expires_at,
        "expected_revision": 1
    });

    let no_csrf = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &uri,
            restriction.clone(),
            &owner.cookies,
            None,
        ))
        .await
        .expect("missing csrf request must respond");
    assert_eq!(no_csrf.status(), StatusCode::FORBIDDEN);

    let forbidden = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &uri,
            restriction.clone(),
            &member.cookies,
            Some(&member.csrf),
        ))
        .await
        .expect("unprivileged status request must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let updated = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &uri,
            restriction.clone(),
            &owner.cookies,
            Some(&owner.csrf),
        ))
        .await
        .expect("status update must respond");
    assert_eq!(updated.status(), StatusCode::OK);
    let request_id = updated.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let payload = response_json(updated).await;
    assert_eq!(payload["meta"]["request_id"], request_id);
    assert_eq!(payload["data"]["status"], "restricted");
    assert_eq!(payload["data"]["revision"], 2);
    assert_eq!(payload["data"]["actor"]["username"], "owner");
    assert!(payload["data"]["audit_id"].is_string());

    let stale = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &uri,
            restriction,
            &owner.cookies,
            Some(&owner.csrf),
        ))
        .await
        .expect("stale status request must respond");
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(stale).await["error"]["code"],
        "admin.user_status_conflict"
    );

    let restricted_session = app
        .clone()
        .oneshot(get_request("/api/v1/auth/session", &member.cookies))
        .await
        .expect("restricted session request must respond");
    assert_eq!(restricted_session.status(), StatusCode::OK);

    let publish = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/topics")
        .header("content-type", "application/json")
        .header("cookie", &member.cookies)
        .header("x-csrf-token", &member.csrf)
        .header("idempotency-key", "restricted-user-publish")
        .body(Body::from(
            serde_json::json!({"title": "不应发布", "content": "受限账号内容"}).to_string(),
        ))
        .expect("topic publish request must be valid");
    let rejected_publish = app
        .clone()
        .oneshot(publish)
        .await
        .expect("restricted publish request must respond");
    assert_eq!(rejected_publish.status(), StatusCode::FORBIDDEN);

    let self_suspend = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/users/{}/status", owner.user_id),
            serde_json::json!({
                "status": "suspended",
                "reason": "错误的自我暂停",
                "expires_at": null,
                "expected_revision": 1
            }),
            &owner.cookies,
            Some(&owner.csrf),
        ))
        .await
        .expect("self suspension request must respond");
    assert_eq!(self_suspend.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(self_suspend).await["error"]["code"],
        "admin.user_self_suspension_forbidden"
    );
}

struct SessionFixture {
    user_id: String,
    cookies: String,
    csrf: String,
}

async fn initialize(app: &axum::Router) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/installation",
            serde_json::json!({
                "username": "owner",
                "email": "owner@example.com",
                "display_name": "管理员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("installation request must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
}

async fn register(app: &axum::Router, username: &str, display_name: &str) -> SessionFixture {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            serde_json::json!({
                "username": username,
                "email": format!("{username}@example.com"),
                "display_name": display_name,
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("registration request must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
    session_fixture(response).await
}

async fn login(app: &axum::Router, identifier: &str) -> SessionFixture {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            serde_json::json!({
                "identifier": identifier,
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("login request must respond");
    assert_eq!(response.status(), StatusCode::OK);
    session_fixture(response).await
}

async fn session_fixture(response: axum::response::Response) -> SessionFixture {
    let csrf_cookie = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|value| {
            let value = value.to_str().ok()?;
            let (pair, _) = value.split_once(';')?;
            pair.starts_with("daoyun_csrf=").then(|| pair.to_owned())
        })
        .expect("CSRF cookie must be set");
    let session_cookie = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|value| {
            let value = value.to_str().ok()?;
            let (pair, _) = value.split_once(';')?;
            pair.starts_with("daoyun_session=").then(|| pair.to_owned())
        })
        .expect("session cookie must be set");
    let csrf = csrf_cookie
        .split_once('=')
        .expect("CSRF cookie must contain a value")
        .1
        .to_owned();
    let payload = response_json(response).await;
    SessionFixture {
        user_id: payload["data"]["user"]["id"]
            .as_str()
            .expect("session user id must be text")
            .to_owned(),
        cookies: format!("{session_cookie}; {csrf_cookie}"),
        csrf,
    }
}

fn get_request(uri: &str, cookies: &str) -> Request<Body> {
    let mut builder = Request::builder().uri(uri);
    if !cookies.is_empty() {
        builder = builder.header("cookie", cookies);
    }
    builder
        .body(Body::empty())
        .expect("GET request must be valid")
}

fn json_request(
    method: Method,
    uri: &str,
    value: serde_json::Value,
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

fn state_change_request(method: Method, uri: &str, cookies: &str, csrf: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", cookies)
        .header("x-csrf-token", csrf)
        .body(Body::empty())
        .expect("state change request must be valid")
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response body must be JSON")
}

fn unavailable_database() -> Database {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .expect("the unavailable database URL must be valid");
    Database::from_pool(pool)
}
