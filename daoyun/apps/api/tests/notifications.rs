use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::{PgPool, types::Uuid};
use std::time::Duration;
use tower::ServiceExt;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn notifications_filter_before_pagination_and_keep_global_counts(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let reader = register(&app, "reader").await;
    let reader_id = Uuid::parse_str(&reader.user_id).unwrap();
    for i in 1..=75 {
        sqlx::query("INSERT INTO notifications(id,recipient_id,kind,target_type,target_id,aggregate_key,created_at,read_at) VALUES($1,$2,'follow','user',$2,$1::text,'2026-08-01'::timestamptz + $3 * INTERVAL '1 second',CASE WHEN $3>55 THEN CURRENT_TIMESTAMP END)")
   .bind(fixture_id(i)).bind(reader_id).bind(i as i32).execute(&pool).await.unwrap();
    }
    let all = app
        .clone()
        .oneshot(get_request(
            "/api/v1/notifications?limit=20",
            &reader.cookies,
        ))
        .await
        .unwrap();
    assert_eq!(all.status(), StatusCode::OK);
    let all = response_json(all).await;
    assert_eq!(all["data"].as_array().unwrap().len(), 20);
    assert!(
        all["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|n| n["read_at"].is_string())
    );
    let unread = app
        .clone()
        .oneshot(get_request(
            "/api/v1/notifications?unread=true&limit=20",
            &reader.cookies,
        ))
        .await
        .unwrap();
    assert_eq!(unread.status(), StatusCode::OK);
    let unread = response_json(unread).await;
    assert!(
        unread["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|n| n["read_at"].is_null())
    );
    assert_eq!(unread["data"][0]["id"], fixture_id(55).to_string());
    let cursor = unread["meta"]["next_cursor"].as_str().unwrap();
    let second = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/notifications?unread=true&limit=20&cursor={cursor}"),
            &reader.cookies,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(second).await["data"][0]["id"],
        fixture_id(35).to_string()
    );
    for uri in [
        format!("/api/v1/notifications?cursor={cursor}"),
        format!(
            "/api/v1/notifications?unread=true&cursor={}",
            all["meta"]["next_cursor"].as_str().unwrap()
        ),
        "/api/v1/notifications?unread=invalid".to_owned(),
    ] {
        let response = app
            .clone()
            .oneshot(get_request(&uri, &reader.cookies))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        response_json(response).await;
    }
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(state_change_request(
                Method::PATCH,
                &format!("/api/v1/notifications/{}/read", fixture_id(55)),
                &reader.cookies,
                &reader.csrf,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response_json(response).await;
        let count = app
            .clone()
            .oneshot(get_request(
                "/api/v1/notifications/unread-count",
                &reader.cookies,
            ))
            .await
            .unwrap();
        assert_eq!(response_json(count).await["data"]["unread_count"], 54);
    }
    let read_cursor = app
        .clone()
        .oneshot(state_change_request(
            Method::PATCH,
            &format!("/api/v1/notifications/{}/read", fixture_id(36)),
            &reader.cookies,
            &reader.csrf,
        ))
        .await
        .unwrap();
    assert_eq!(read_cursor.status(), StatusCode::OK);
    response_json(read_cursor).await;
    let continued = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/notifications?unread=true&limit=20&cursor={cursor}"),
            &reader.cookies,
        ))
        .await
        .unwrap();
    assert_eq!(continued.status(), StatusCode::OK);
    assert_eq!(
        response_json(continued).await["data"][0]["id"],
        fixture_id(35).to_string()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn notification_routes_enforce_session_owner_csrf_and_request_id(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let reader = register(&app, "reader").await;
    let other = register(&app, "other").await;
    let reader_id = Uuid::parse_str(&reader.user_id).unwrap();
    sqlx::query("INSERT INTO notifications(id,recipient_id,kind,target_type,target_id,aggregate_key) VALUES($1,$2,'follow','user',$2,$1::text)").bind(fixture_id(1)).bind(reader_id).execute(&pool).await.unwrap();
    for uri in [
        "/api/v1/notifications?unread=true",
        "/api/v1/notifications/unread-count",
    ] {
        let response = app.clone().oneshot(get_request(uri, "")).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        response_json(response).await;
    }
    let path = format!("/api/v1/notifications/{}/read", fixture_id(1));
    for uri in [&path, "/api/v1/notifications/read-all"] {
        let response = app
            .clone()
            .oneshot(state_change_request(
                Method::PATCH,
                uri,
                &reader.cookies,
                "",
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        response_json(response).await;
    }
    let forbidden = app
        .clone()
        .oneshot(state_change_request(
            Method::PATCH,
            &path,
            &other.cookies,
            &other.csrf,
        ))
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::NOT_FOUND);
    response_json(forbidden).await;
    let cursor = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/notifications?cursor={}", fixture_id(1)),
            &other.cookies,
        ))
        .await
        .unwrap();
    assert_eq!(cursor.status(), StatusCode::UNPROCESSABLE_ENTITY);
    response_json(cursor).await;
    let response = app
        .clone()
        .oneshot(state_change_request(
            Method::PATCH,
            "/api/v1/notifications/read-all",
            &other.cookies,
            &other.csrf,
        ))
        .await
        .unwrap();
    assert_eq!(response_json(response).await["data"]["unread_count"], 0);
    assert_eq!(
        Database::from_pool(pool.clone())
            .count_unread_notifications(reader_id)
            .await
            .unwrap()
            .unread_count,
        1
    );
}

#[tokio::test]
async fn openapi_documents_notification_filter_and_existing_read_contracts() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let doc = response_json(response).await;
    for (path, method) in [
        ("/api/v1/notifications", "get"),
        ("/api/v1/notifications/unread-count", "get"),
        ("/api/v1/notifications/{notification_id}/read", "patch"),
        ("/api/v1/notifications/read-all", "patch"),
    ] {
        for response in doc["paths"][path][method]["responses"]
            .as_object()
            .unwrap()
            .values()
        {
            assert_eq!(
                response["headers"]["x-request-id"]["schema"]["type"],
                "string"
            );
        }
    }
    let list = &doc["paths"]["/api/v1/notifications"]["get"];
    assert!(
        list["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == "unread" && p["schema"]["type"] == "boolean")
    );
    for path in [
        "/api/v1/notifications/{notification_id}/read",
        "/api/v1/notifications/read-all",
    ] {
        assert!(doc["paths"][path]["patch"]["responses"]["200"].is_object());
    }
    assert!(doc["components"]["schemas"]["NotificationUnreadCount"].is_object());
    assert!(doc["components"]["schemas"]["Notification"]["properties"]["topic_id"].is_object());
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

async fn register(app: &axum::Router, username: &str) -> SessionFixture {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            serde_json::json!({
                "username": username,
                "email": format!("{username}@example.com"),
                "display_name": username,
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

fn state_change_request(method: Method, uri: &str, cookies: &str, csrf: &str) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if !cookies.is_empty() {
        builder = builder.header("cookie", cookies);
    }
    if !csrf.is_empty() {
        builder = builder.header("x-csrf-token", csrf);
    }
    builder
        .body(Body::empty())
        .expect("state change request must be valid")
}

async fn response_json(response: axum::response::Response) -> Value {
    let request_id = response
        .headers()
        .get("x-request-id")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    let value: Value = serde_json::from_slice(&body).expect("response body must be JSON");
    if value.get("meta").is_some() {
        assert_eq!(value["meta"]["request_id"], request_id);
    }
    value
}

fn unavailable_database() -> Database {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(100))
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .expect("the unavailable database URL must be valid");
    Database::from_pool(pool)
}

fn fixture_id(value: u128) -> Uuid {
    Uuid::from_u128(0x019f_cb00_0000_7000_8000_0000_0000_0000 + value)
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn reply_notification_carries_the_floor_and_parent_topic(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let author = register(&app, "author").await;
    let replier = register(&app, "replier").await;
    let created = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"content":"无标题主题正文"}),
            &author.cookies,
            Some(&author.csrf),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let topic_id = response_json(created).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let created = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!("/api/v1/topics/{topic_id}/replies"),
            serde_json::json!({"content":"通知应定位这条回复"}),
            &replier.cookies,
            Some(&replier.csrf),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let post_id = response_json(created).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let list = app
        .clone()
        .oneshot(get_request("/api/v1/notifications", &author.cookies))
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    let list = response_json(list).await;
    let notification = &list["data"][0];
    assert_eq!(notification["target"], "post");
    assert_eq!(notification["target_id"], post_id);
    assert_eq!(notification["topic_id"], topic_id);
    let read = app
        .clone()
        .oneshot(state_change_request(
            Method::PATCH,
            &format!(
                "/api/v1/notifications/{}/read",
                notification["id"].as_str().unwrap()
            ),
            &author.cookies,
            &author.csrf,
        ))
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(response_json(read).await["data"]["topic_id"], topic_id);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn existing_governance_notifications_do_not_break_the_feed(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let reader = register(&app, "reader").await;
    let reader_id = Uuid::parse_str(&reader.user_id).unwrap();
    sqlx::query("INSERT INTO notifications(id,recipient_id,kind,target_type,target_id,aggregate_key) VALUES($1,$2,'topic_governance','topic',$3,$1::text)")
        .bind(fixture_id(90)).bind(reader_id).bind(fixture_id(91)).execute(&pool).await.unwrap();
    let response = app
        .clone()
        .oneshot(get_request("/api/v1/notifications", &reader.cookies))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let list = response_json(response).await;
    assert_eq!(list["data"][0]["kind"], "topic_governance");
    assert_eq!(list["data"][0]["target"], "topic");
    let read = app
        .clone()
        .oneshot(state_change_request(
            Method::PATCH,
            &format!("/api/v1/notifications/{}/read", fixture_id(90)),
            &reader.cookies,
            &reader.csrf,
        ))
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(
        response_json(read).await["data"]["kind"],
        "topic_governance"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn restricted_reply_notifications_are_filtered_before_paging_and_read_counts(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let author = register(&app, "policy_author").await;
    let replier = register(&app, "policy_replier").await;
    let author_id = Uuid::parse_str(&author.user_id).unwrap();
    let created = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"content":"private policy regression body"}),
            &author.cookies,
            Some(&author.csrf),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let topic =
        Uuid::parse_str(response_json(created).await["data"]["id"].as_str().unwrap()).unwrap();
    let created = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!("/api/v1/topics/{topic}/replies"),
            serde_json::json!({"content":"private reply regression body"}),
            &replier.cookies,
            Some(&replier.csrf),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    response_json(created).await;
    let before = response_json(
        app.clone()
            .oneshot(get_request("/api/v1/notifications", &author.cookies))
            .await
            .unwrap(),
    )
    .await;
    let hidden_id = Uuid::parse_str(before["data"][0]["id"].as_str().unwrap()).unwrap();
    let board: Uuid = sqlx::query_scalar("SELECT board_id FROM topics WHERE id=$1")
        .bind(topic)
        .fetch_one(&pool)
        .await
        .unwrap();
    let policy = fixture_id(1000);
    sqlx::query("INSERT INTO content_access_policies(id,target_type,target_id,operator) VALUES($1,'board',$2,'any_of')").bind(policy).bind(board).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO content_access_policy_subjects(policy_id,subject_type,community_group_id) SELECT $1,'community_group',id FROM community_groups WHERE internal_key='established_member'").bind(policy).execute(&pool).await.unwrap();
    for i in 1001..=1002 {
        sqlx::query("INSERT INTO notifications(id,recipient_id,kind,target_type,target_id,aggregate_key,created_at) VALUES($1,$2,'follow','user',$2,$1::text,'2026-01-01')").bind(fixture_id(i)).bind(author_id).execute(&pool).await.unwrap();
    }
    let list = response_json(
        app.clone()
            .oneshot(get_request(
                "/api/v1/notifications?limit=1&unread=true",
                &author.cookies,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(list["data"][0]["id"], fixture_id(1002).to_string());
    let cursor = list["meta"]["next_cursor"].as_str().unwrap();
    let next = response_json(
        app.clone()
            .oneshot(get_request(
                &format!("/api/v1/notifications?limit=1&unread=true&cursor={cursor}"),
                &author.cookies,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(next["data"][0]["id"], fixture_id(1001).to_string());
    let count = response_json(
        app.clone()
            .oneshot(get_request(
                "/api/v1/notifications/unread-count",
                &author.cookies,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(count["data"]["unread_count"], 2);
    let read = app
        .clone()
        .oneshot(state_change_request(
            Method::PATCH,
            &format!("/api/v1/notifications/{hidden_id}/read"),
            &author.cookies,
            &author.csrf,
        ))
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::NOT_FOUND);
    response_json(read).await;
    let all = response_json(
        app.clone()
            .oneshot(state_change_request(
                Method::PATCH,
                "/api/v1/notifications/read-all",
                &author.cookies,
                &author.csrf,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(all["data"]["unread_count"], 0);
    let hidden_unread: bool =
        sqlx::query_scalar("SELECT read_at IS NULL FROM notifications WHERE id=$1")
            .bind(hidden_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        hidden_unread,
        "hidden notification facts must remain unread until access returns"
    );
    sqlx::query("DELETE FROM content_access_policies WHERE id=$1")
        .bind(policy)
        .execute(&pool)
        .await
        .unwrap();
    let restored = response_json(
        app.clone()
            .oneshot(get_request(
                "/api/v1/notifications?unread=true",
                &author.cookies,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(restored["data"][0]["id"], hidden_id.to_string());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn versioned_business_responses_prevent_shared_and_browser_cache_reuse(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let reader = register(&app, "cache_reader").await;
    for uri in [
        "/api/v1/feed?mode=latest",
        "/api/v1/topics?query=cache",
        "/api/v1/notifications",
        "/api/v1/notifications/unread-count",
        "/api/v1/users/me/bookmarks",
        "/api/v1/topics/00000000-0000-0000-0000-000000000001",
    ] {
        let response = app
            .clone()
            .oneshot(get_request(uri, &reader.cookies))
            .await
            .unwrap();
        assert_eq!(
            response
                .headers()
                .get("cache-control")
                .and_then(|v| v.to_str().ok()),
            Some("private, no-store"),
            "{uri}"
        );
        response_json(response).await;
    }
}
