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

    assert!(document["paths"]["/api/v1/users"]["get"].is_object());
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

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_membership_summary_separates_domains_and_preserves_read_permissions(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let app = daoyun_api::app_with_config(
        database,
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let member = register(&app, "membershiptarget", "会员档案用户").await;
    let reader = register(&app, "membershipreader", "只读账号").await;
    let owner = login(&app, "owner").await;
    let target_id: uuid::Uuid = member.user_id.parse().unwrap();
    sqlx::query("UPDATE membership_accounts SET points_balance = 77, lifetime_points = 900, level_key = 'lv_20' WHERE user_id = $1")
        .bind(target_id).execute(&pool).await.unwrap();
    sqlx::query("UPDATE experience_accounts SET experience = 120 WHERE user_id = $1")
        .bind(target_id)
        .execute(&pool)
        .await
        .unwrap();
    let uri = format!("/api/v1/admin/users/{}/membership-summary", member.user_id);
    let response = app
        .clone()
        .oneshot(get_request(&uri, &owner.cookies))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let payload = response_json(response).await;
    assert_eq!(payload["meta"]["request_id"], request_id);
    let data = &payload["data"];
    assert_eq!(data["account"]["id"], member.user_id);
    assert_eq!(data["experience"]["experience"], 120);
    assert_ne!(data["experience"]["current_level"]["level_order"], 20);
    assert_eq!(data["points"]["points_balance"], 77);
    assert!(data["points"].get("level_key").is_none());
    assert!(
        data["groups"]
            .as_array()
            .is_some_and(|groups| groups.iter().any(|g| g["membership_kind"] == "base"))
    );
    assert!(data["medals"].is_array());
    assert!(data["entitlements"].is_array());
    assert_eq!(data["readable_sections"].as_array().unwrap().len(), 5);
    for private in ["email", "password_hash", "session_token"] {
        assert!(data["account"].get(private).is_none());
    }

    // A role with only account reads must not gain domain reads through aggregation.
    let reader_id: uuid::Uuid = reader.user_id.parse().unwrap();
    let role_id = uuid::Uuid::now_v7();
    sqlx::query("INSERT INTO roles (id, key, name, scope, is_system) VALUES ($1, 'membership_reader_test', '账号读取测试', 'site', false)")
        .bind(role_id).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = 'admin.users.read'")
        .bind(role_id).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by) VALUES ($1, $2, $3, $4)",
    )
    .bind(uuid::Uuid::now_v7())
    .bind(reader_id)
    .bind(role_id)
    .bind(owner.user_id.parse::<uuid::Uuid>().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    let response = app
        .clone()
        .oneshot(get_request(&uri, &reader.cookies))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let payload = response_json(response).await;
    for section in [
        "groups",
        "experience",
        "next_level",
        "points",
        "medals",
        "entitlements",
    ] {
        assert!(payload["data"][section].is_null(), "{section}");
    }
    assert_eq!(payload["data"]["readable_sections"], serde_json::json!([]));
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = 'community.groups.read'")
        .bind(role_id).execute(&pool).await.unwrap();
    let payload = response_json(
        app.clone()
            .oneshot(get_request(&uri, &reader.cookies))
            .await
            .unwrap(),
    )
    .await;
    assert!(
        payload["data"]["groups"].is_null(),
        "catalog reads alone do not disclose memberships"
    );
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key IN ('community.memberships.read', 'membership.points.grant')")
        .bind(role_id).execute(&pool).await.unwrap();
    let payload = response_json(
        app.clone()
            .oneshot(get_request(&uri, &reader.cookies))
            .await
            .unwrap(),
    )
    .await;
    assert!(payload["data"]["groups"].is_array());
    assert_eq!(payload["data"]["points"]["points_balance"], 77);
    for section in ["experience", "next_level", "medals", "entitlements"] {
        assert!(payload["data"][section].is_null());
    }
    assert_eq!(
        payload["data"]["readable_sections"],
        serde_json::json!(["groups", "points"])
    );

    // Reads must not initialize missing domain accounts or report a synthetic zero.
    sqlx::query("DELETE FROM experience_accounts WHERE user_id = $1")
        .bind(target_id)
        .execute(&pool)
        .await
        .unwrap();
    let payload = response_json(
        app.clone()
            .oneshot(get_request(&uri, &owner.cookies))
            .await
            .unwrap(),
    )
    .await;
    assert!(payload["data"]["experience"].is_null());
    assert!(payload["data"]["next_level"].is_null());
    assert!(
        payload["data"]["readable_sections"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("experience"))
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM experience_accounts WHERE user_id = $1")
            .bind(target_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    for (path, cookies, expected) in [
        (uri.clone(), "", StatusCode::UNAUTHORIZED),
        (uri.clone(), member.cookies.as_str(), StatusCode::FORBIDDEN),
        (
            format!(
                "/api/v1/admin/users/{}/membership-summary",
                uuid::Uuid::now_v7()
            ),
            owner.cookies.as_str(),
            StatusCode::NOT_FOUND,
        ),
        (
            "/api/v1/admin/users/not-a-uuid/membership-summary".into(),
            owner.cookies.as_str(),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(get_request(&path, cookies))
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            response_json(response).await["meta"]["request_id"],
            request_id
        );
    }
}

#[tokio::test]
async fn openapi_documents_admin_membership_summary_and_domain_boundaries() {
    let document = serde_json::to_value(daoyun_api::openapi_document()).unwrap();
    let route = &document["paths"]["/api/v1/admin/users/{user_id}/membership-summary"]["get"];
    assert_eq!(route["operationId"], "getAdminUserMembershipSummary");
    for status in ["200", "401", "403", "404", "422", "503"] {
        assert!(route["responses"][status]["headers"]["x-request-id"].is_object());
    }
    let summary = &document["components"]["schemas"]["AdminUserMembershipSummary"]["properties"];
    for section in [
        "account",
        "groups",
        "experience",
        "next_level",
        "points",
        "medals",
        "entitlements",
        "readable_sections",
    ] {
        assert!(summary[section].is_object());
    }
    let points = &document["components"]["schemas"]["AdminUserPoints"]["properties"];
    assert!(points.get("level_key").is_none());
}

struct MembershipListFixture {
    alpha: SessionFixture,
    beta: SessionFixture,
    owner: SessionFixture,
    base_id: String,
    additional_id: String,
    level_id: String,
    entitlement_type_id: String,
}

async fn membership_list_fixture(app: &axum::Router, pool: &PgPool) -> MembershipListFixture {
    initialize(app).await;
    let alpha = register(app, "facetalpha", "筛选甲").await;
    let beta = register(app, "facetbeta", "筛选乙").await;
    let owner = login(app, "owner").await;
    let group = app.clone().oneshot(json_request(Method::POST, "/api/v1/admin/community/groups", serde_json::json!({ "internal_key": "facet_additional", "display_name": "摄影达人", "description": "筛选测试", "is_base": false, "display_order": 6, "permission_keys": ["attachment.upload"], "quotas": {} }), &owner.cookies, Some(&owner.csrf))).await.unwrap();
    assert_eq!(group.status(), StatusCode::CREATED);
    let additional_id = response_json(group).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    for user in [&alpha, &beta] {
        let grant = app.clone().oneshot(json_request(Method::POST, "/api/v1/admin/community/memberships", serde_json::json!({ "user_id": user.user_id, "group_id": additional_id, "membership_kind": "additional", "source": "admin", "source_reference_id": null, "reason": "筛选测试", "starts_at": "2026-01-01T00:00:00Z", "ends_at": null, "idempotency_key": format!("facet-group-{}", user.user_id) }), &owner.cookies, Some(&owner.csrf))).await.unwrap();
        assert!(
            grant.status().is_success(),
            "{}",
            response_json(grant).await
        );
    }
    let beta_id = beta.user_id.parse::<uuid::Uuid>().unwrap();
    sqlx::query("UPDATE community_group_memberships SET revoked_at = NOW(), revoked_by = $2, revocation_reason = 'fixture revoke', revoke_idempotency_key = 'fixture.revoke' WHERE user_id = $1 AND membership_kind = 'additional'").bind(beta_id).bind(owner.user_id.parse::<uuid::Uuid>().unwrap()).execute(pool).await.unwrap();
    let base_id = sqlx::query_scalar::<_, uuid::Uuid>("SELECT group_id FROM community_group_memberships WHERE user_id = $1 AND membership_kind = 'base' AND revoked_at IS NULL").bind(alpha.user_id.parse::<uuid::Uuid>().unwrap()).fetch_one(pool).await.unwrap().to_string();
    let level_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT current_level_id FROM experience_accounts WHERE user_id = $1",
    )
    .bind(alpha.user_id.parse::<uuid::Uuid>().unwrap())
    .fetch_one(pool)
    .await
    .unwrap()
    .to_string();
    let next_level = sqlx::query_as::<_, (uuid::Uuid, i64)>("SELECT id, required_experience FROM membership_levels WHERE status = 'published' AND id <> $1 ORDER BY level_order LIMIT 1").bind(level_id.parse::<uuid::Uuid>().unwrap()).fetch_one(pool).await.unwrap();
    sqlx::query(
        "UPDATE experience_accounts SET current_level_id = $2, experience = $3 WHERE user_id = $1",
    )
    .bind(beta_id)
    .bind(next_level.0)
    .bind(next_level.1)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE experience_accounts SET experience = 42 WHERE user_id = $1")
        .bind(alpha.user_id.parse::<uuid::Uuid>().unwrap())
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE membership_accounts SET points_balance = 777, lifetime_points = 900, level_key = 'lv_20' WHERE user_id = $1").bind(alpha.user_id.parse::<uuid::Uuid>().unwrap()).execute(pool).await.unwrap();
    let entitlement = app.clone().oneshot(json_request(Method::PUT, "/api/v1/admin/entitlements/types/facet_premium", serde_json::json!({ "display_name": "高级会员", "permission_keys": ["topic.create"], "quotas": { "topic.create.daily": 50 }, "expected_revision": null }), &owner.cookies, Some(&owner.csrf))).await.unwrap();
    assert!(
        entitlement.status().is_success(),
        "{}",
        response_json(entitlement).await
    );
    let entitlement_type_id = response_json(entitlement).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    for user in [&alpha, &beta] {
        let grant = app.clone().oneshot(json_request(Method::POST, "/api/v1/admin/entitlements", serde_json::json!({ "user_id": user.user_id, "entitlement_type_id": entitlement_type_id, "source": "admin", "source_reference_id": null, "reason": "筛选测试", "starts_at": "2026-01-01T00:00:00Z", "ends_at": "2030-01-01T00:00:00Z", "idempotency_key": format!("facet-entitlement-{}", user.user_id) }), &owner.cookies, Some(&owner.csrf))).await.unwrap();
        assert!(
            grant.status().is_success(),
            "{}",
            response_json(grant).await
        );
    }
    sqlx::query("UPDATE user_standard_entitlements SET starts_at = '2024-01-01', ends_at = '2025-01-01' WHERE user_id = $1").bind(beta_id).execute(pool).await.unwrap();
    MembershipListFixture {
        alpha,
        beta,
        owner,
        base_id,
        additional_id,
        level_id,
        entitlement_type_id,
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_user_list_membership_projection_uses_independent_effective_domains(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    let fixture = membership_list_fixture(&app, &pool).await;
    let response = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/users?q=facetalpha",
            &fixture.owner.cookies,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let payload = response_json(response).await;
    assert_eq!(payload["meta"]["request_id"], request_id);
    let membership = &payload["data"][0]["membership"];
    assert_eq!(membership["experience"], 42);
    assert_eq!(membership["points_balance"], 777);
    assert_eq!(membership["level"]["id"], fixture.level_id);
    assert_ne!(membership["level"]["level_order"], 20);
    assert_eq!(membership["groups"].as_array().unwrap().len(), 2);
    assert_eq!(membership["entitlements"][0]["display_name"], "高级会员");
    assert_eq!(membership["medal_count"], 0);
    let payload = response_json(
        app.clone()
            .oneshot(get_request(
                "/api/v1/admin/users?q=facetbeta",
                &fixture.owner.cookies,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(
        payload["data"][0]["membership"]["groups"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        payload["data"][0]["membership"]["entitlements"],
        serde_json::json!([])
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_user_membership_facets_scope_results_cursors_dates_and_capabilities(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    let fixture = membership_list_fixture(&app, &pool).await;
    for filter in [
        format!("additional_group_id={}", fixture.additional_id),
        format!("growth_level_id={}", fixture.level_id),
        format!("entitlement_type_id={}", fixture.entitlement_type_id),
    ] {
        let response = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/users?q=facet&{filter}"),
                &fixture.owner.cookies,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let payload = response_json(response).await;
        assert_eq!(payload["data"].as_array().unwrap().len(), 1, "{filter}");
        assert_eq!(payload["data"][0]["id"], fixture.alpha.user_id, "{filter}");
    }
    for filter in [
        format!("base_group_id={}", fixture.additional_id),
        "last_active_after=2030-01-01T00:00:00Z".into(),
        "last_active_before=2020-01-01T00:00:00Z".into(),
    ] {
        let payload = response_json(
            app.clone()
                .oneshot(get_request(
                    &format!("/api/v1/admin/users?q=facet&{filter}"),
                    &fixture.owner.cookies,
                ))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(payload["data"], serde_json::json!([]), "{filter}");
    }
    let response = app.clone().oneshot(get_request(&format!("/api/v1/admin/users?q=facet&base_group_id={}&last_active_after=2020-01-01T00:00:00Z&last_active_before=2030-01-01T00:00:00Z&limit=1", fixture.base_id), &fixture.owner.cookies)).await.unwrap();
    let first = response_json(response).await;
    assert_eq!(first["data"].as_array().unwrap().len(), 1);
    let cursor = first["meta"]["next_cursor"].as_str().unwrap();
    let second = response_json(
        app.clone()
            .oneshot(get_request(
                &format!(
                    "/api/v1/admin/users?q=facet&base_group_id={}&cursor={cursor}&limit=1",
                    fixture.base_id
                ),
                &fixture.owner.cookies,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(second["data"].as_array().unwrap().len(), 1);
    assert_ne!(first["data"][0]["id"], second["data"][0]["id"]);
    let wrong_cursor = app
        .clone()
        .oneshot(get_request(
            &format!(
                "/api/v1/admin/users?q=facet&additional_group_id={}&cursor={}",
                fixture.additional_id, fixture.beta.user_id
            ),
            &fixture.owner.cookies,
        ))
        .await
        .unwrap();
    assert_eq!(wrong_cursor.status(), StatusCode::UNPROCESSABLE_ENTITY);
    for filter in [
        "last_active_after=not-a-date",
        "last_active_after=2030-01-01T00:00:00Z&last_active_before=2020-01-01T00:00:00Z",
    ] {
        let response = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/users?{filter}"),
                &fixture.owner.cookies,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let role_id = uuid::Uuid::now_v7();
    sqlx::query("INSERT INTO roles (id, key, name, scope) VALUES ($1, 'facet_account_reader', '账号读取', 'site')").bind(role_id).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = 'admin.users.read'").bind(role_id).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by) VALUES ($1, $2, $3, $4)",
    )
    .bind(uuid::Uuid::now_v7())
    .bind(fixture.beta.user_id.parse::<uuid::Uuid>().unwrap())
    .bind(role_id)
    .bind(fixture.owner.user_id.parse::<uuid::Uuid>().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    let payload = response_json(
        app.clone()
            .oneshot(get_request(
                "/api/v1/admin/users?q=facetalpha",
                &fixture.beta.cookies,
            ))
            .await
            .unwrap(),
    )
    .await;
    let membership = &payload["data"][0]["membership"];
    assert_eq!(membership["readable_sections"], serde_json::json!([]));
    for field in [
        "groups",
        "experience",
        "level",
        "points_balance",
        "medal_count",
        "entitlements",
    ] {
        assert!(membership[field].is_null());
    }
    for filter in [
        format!("base_group_id={}", fixture.base_id),
        format!("additional_group_id={}", fixture.additional_id),
        format!("growth_level_id={}", fixture.level_id),
        format!("entitlement_type_id={}", fixture.entitlement_type_id),
    ] {
        let response = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/users?{filter}"),
                &fixture.beta.cookies,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{filter}");
    }
}

#[tokio::test]
async fn openapi_documents_admin_user_membership_list_fields_and_facets() {
    let doc = serde_json::to_value(daoyun_api::openapi_document()).unwrap();
    let params = doc["paths"]["/api/v1/admin/users"]["get"]["parameters"]
        .as_array()
        .unwrap();
    for field in [
        "base_group_id",
        "additional_group_id",
        "growth_level_id",
        "entitlement_type_id",
        "last_active_after",
        "last_active_before",
    ] {
        assert!(params.iter().any(|p| p["name"] == field), "{field}");
    }
    assert!(
        doc["components"]["schemas"]["AdminUserSummary"]["properties"]["membership"].is_object()
    );
}
