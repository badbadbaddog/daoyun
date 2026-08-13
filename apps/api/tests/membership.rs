use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn membership_catalog_returns_stable_keys_and_assets(pool: PgPool) {
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(
            Request::builder()
                .uri("/api/v1/membership/catalog")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::OK);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let payload = response_json(response).await;
    assert_eq!(payload["meta"]["request_id"], request_id);
    assert_eq!(payload["data"]["member_group"]["key"], "member");
    assert_eq!(payload["data"]["member_group"]["display_name"], "会员");

    let levels = payload["data"]["levels"]
        .as_array()
        .expect("levels must be an array");
    assert_eq!(levels.len(), 6);
    assert_eq!(levels[0]["key"], "lv_1");
    assert_eq!(levels[0]["level_number"], 1);
    assert_eq!(levels[0]["display_name"], "Lv1");
    assert_eq!(levels[5]["key"], "lv_6");
    assert_eq!(levels[5]["level_number"], 6);
    assert!(levels.iter().all(|level| {
        level["asset_url"]
            .as_str()
            .is_some_and(|url| url.starts_with("/assets/membership/levels/"))
    }));

    let medals = payload["data"]["medals"]
        .as_array()
        .expect("medals must be an array");
    assert_eq!(medals.len(), 17);
    assert_eq!(medals[0]["key"], "medal_01");
    assert_eq!(medals[16]["key"], "medal_17");
    assert_eq!(medals[0]["display_name"], "勋章 01");

    let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../public/assets/membership/manifest.json");
    let manifest: Value = serde_json::from_str(
        &std::fs::read_to_string(manifest_path).expect("membership manifest must be present"),
    )
    .expect("membership manifest must be valid JSON");
    for (catalog_entry, manifest_entry) in levels.iter().zip(
        manifest["levels"]
            .as_array()
            .expect("manifest levels must be an array"),
    ) {
        assert_eq!(catalog_entry["key"], manifest_entry["key"]);
        assert_eq!(catalog_entry["sha256"], manifest_entry["sha256"]);
    }
}

#[tokio::test]
async fn openapi_documents_membership_catalog() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    let document = response_json(response).await;
    let operation = &document["paths"]["/api/v1/membership/catalog"]["get"];
    assert!(operation.is_object());
    assert!(document["components"]["schemas"]["MembershipCatalog"].is_object());
    assert!(document["components"]["schemas"]["MembershipLevel"].is_object());
    assert!(document["components"]["schemas"]["Medal"].is_object());
    assert!(document["paths"]["/api/v1/users/me/membership"]["get"].is_object());
    assert!(document["components"]["schemas"]["MembershipAccount"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn membership_account_requires_session_and_returns_private_balance(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name)
         VALUES ($1, 'membership_user', 'membership@example.com', 'Membership User')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("user fixture must insert");
    sqlx::query("INSERT INTO membership_accounts (user_id) VALUES ($1)")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("membership account fixture must insert");
    sqlx::query(
        "INSERT INTO sessions
            (id, user_id, token_hash, csrf_token_hash, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '1 hour',
                 CURRENT_TIMESTAMP + INTERVAL '1 day')",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(hash_token("a".repeat(64)))
    .bind(hash_token("b".repeat(64)))
    .execute(&pool)
    .await
    .expect("session fixture must insert");

    let app = daoyun_api::app_with_config(
        Database::from_pool(pool),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    let anonymous = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/users/me/membership")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/users/me/membership")
                .header("cookie", "daoyun_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; daoyun_csrf=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let payload = response_json(response).await;
    assert_eq!(payload["data"]["user_id"], user_id.to_string());
    assert_eq!(payload["data"]["points_balance"], 0);
    assert_eq!(payload["data"]["level_key"], "lv_1");
    assert_eq!(payload["data"]["level_number"], 1);
    assert_eq!(payload["data"]["level_display_name"], "Lv1");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_membership_rules_and_points_require_capabilities_and_csrf(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login(&app, "owner", "correct horse battery staple").await;
    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "points_member",
                "email": "points-member@example.com",
                "display_name": "积分成员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("member registration must respond");
    assert_eq!(member.status(), StatusCode::CREATED);
    let (member_cookies, _) = session_cookies(&member).await;
    let member_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'points_member'")
            .fetch_one(&pool)
            .await
            .expect("member id must be queryable");

    let rules = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/membership/level-rules",
            &owner_cookies,
        ))
        .await
        .expect("membership rules must respond");
    assert_eq!(rules.status(), StatusCode::OK);
    assert_eq!(
        response_json(rules).await["data"].as_array().map(Vec::len),
        Some(6)
    );

    let l2 = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/admin/membership/level-rules/lv_2",
            json!({"enabled": true, "required_lifetime_points": 25, "display_name": "新会员"}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("membership rule update must respond");
    assert_eq!(l2.status(), StatusCode::OK);

    let grant = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/points",
            json!({
                "user_id": member_id,
                "amount": 25,
                "reason": "admin.grant",
                "idempotency_key": "points-api-1"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("membership points grant must respond");
    assert_eq!(grant.status(), StatusCode::OK);
    let grant_payload = response_json(grant).await;
    assert_eq!(grant_payload["data"]["created"], true);
    assert_eq!(grant_payload["data"]["account"]["level_key"], "lv_2");
    assert_eq!(grant_payload["data"]["account"]["level_number"], 2);
    assert_eq!(
        grant_payload["data"]["account"]["level_display_name"],
        "新会员"
    );

    let replay = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/points",
            json!({
                "user_id": member_id,
                "amount": 25,
                "reason": "admin.grant",
                "idempotency_key": "points-api-1"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("membership points replay must respond");
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(response_json(replay).await["data"]["created"], false);

    let member_forbidden = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/membership/level-rules",
            &member_cookies,
        ))
        .await
        .expect("member membership rules request must respond");
    assert_eq!(member_forbidden.status(), StatusCode::FORBIDDEN);

    let audit = app
        .oneshot(get_request(
            "/api/v1/admin/audit?resource_type=membership_account",
            &owner_cookies,
        ))
        .await
        .expect("membership audit request must respond");
    assert_eq!(audit.status(), StatusCode::OK);
    assert_eq!(
        response_json(audit).await["data"][0]["action"],
        "membership.points.grant"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_medals_are_granted_and_visible_on_public_profile(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login(&app, "owner", "correct horse battery staple").await;
    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "medal_member",
                "email": "medal-member@example.com",
                "display_name": "勋章成员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("member registration must respond");
    assert_eq!(member.status(), StatusCode::CREATED);
    let member_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'medal_member'")
            .fetch_one(&pool)
            .await
            .expect("member id must be queryable");
    let grant = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/medals",
            json!({"user_id": member_id, "medal_key": "medal_01", "reason": "operator.award"}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("medal grant must respond");
    assert_eq!(grant.status(), StatusCode::OK);
    assert_eq!(response_json(grant).await["data"]["created"], true);
    let profile = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/users/medal_member/medals")
                .body(Body::empty())
                .expect("profile medals request must be valid"),
        )
        .await
        .expect("profile medals must respond");
    assert_eq!(profile.status(), StatusCode::OK);
    assert_eq!(response_json(profile).await["data"][0]["key"], "medal_01");
}

fn hash_token(value: String) -> Vec<u8> {
    Sha256::digest(value.as_bytes()).to_vec()
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
    session_cookies(&response).await
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
