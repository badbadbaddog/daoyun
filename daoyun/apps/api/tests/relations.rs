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
async fn bookmark_and_like_routes_enforce_auth_csrf_idempotency_and_visibility(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let reader = register(&app, "reader").await;
    let author = fixture_id(2);
    let board = fixture_id(11);
    let topic = fixture_id(101);
    let reply = fixture_id(201);
    let hidden_reply = fixture_id(202);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "relations", "public").await;
    insert_topic(&pool, topic, board, author).await;
    insert_reply(&pool, reply, topic, author, "published").await;
    insert_reply(&pool, hidden_reply, topic, author, "hidden").await;

    let bookmark_path = format!("/api/v1/topics/{topic}/bookmark");
    let anonymous = app
        .clone()
        .oneshot(state_change_request(Method::PUT, &bookmark_path, "", ""))
        .await
        .expect("anonymous bookmark request must respond");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let missing_csrf = app
        .clone()
        .oneshot(state_change_request(
            Method::PUT,
            &bookmark_path,
            &reader.cookies,
            "",
        ))
        .await
        .expect("bookmark request without CSRF must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(state_change_request(
                Method::PUT,
                &bookmark_path,
                &reader.cookies,
                &reader.csrf,
            ))
            .await
            .expect("bookmark request must respond");
        assert_eq!(response.status(), StatusCode::OK);
        let request_id = response
            .headers()
            .get("x-request-id")
            .expect("request id header must exist")
            .to_str()
            .expect("request id must be text")
            .to_owned();
        let payload = response_json(response).await;
        assert_eq!(payload["data"]["bookmarked"], true);
        assert_eq!(payload["meta"]["request_id"], request_id);
    }

    let anonymous_detail = app
        .clone()
        .oneshot(get_request(&format!("/api/v1/topics/{topic}"), ""))
        .await
        .expect("anonymous detail request must respond");
    let anonymous_payload = response_json(anonymous_detail).await;
    assert!(anonymous_payload["data"]["viewer_bookmarked"].is_null());
    assert!(anonymous_payload["data"]["viewer_liked"].is_null());

    let viewer_detail = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/topics/{topic}"),
            &reader.cookies,
        ))
        .await
        .expect("viewer detail request must respond");
    assert_eq!(
        response_json(viewer_detail).await["data"]["viewer_bookmarked"],
        true
    );

    let topic_like_path = format!("/api/v1/posts/{topic}/like");
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(state_change_request(
                Method::PUT,
                &topic_like_path,
                &reader.cookies,
                &reader.csrf,
            ))
            .await
            .expect("topic like request must respond");
        assert_eq!(response.status(), StatusCode::OK);
        let payload = response_json(response).await;
        assert_eq!(payload["data"]["liked"], true);
        assert_eq!(payload["data"]["like_count"], 1);
    }
    let viewer_feed = app
        .clone()
        .oneshot(get_request("/api/v1/topics", &reader.cookies))
        .await
        .expect("viewer topic feed request must respond");
    let viewer_feed_payload = response_json(viewer_feed).await;
    assert_eq!(viewer_feed_payload["data"][0]["viewer_bookmarked"], true);
    assert_eq!(viewer_feed_payload["data"][0]["viewer_liked"], true);

    let reply_like = app
        .clone()
        .oneshot(state_change_request(
            Method::PUT,
            &format!("/api/v1/posts/{reply}/like"),
            &reader.cookies,
            &reader.csrf,
        ))
        .await
        .expect("reply like request must respond");
    assert_eq!(reply_like.status(), StatusCode::OK);
    assert_eq!(response_json(reply_like).await["data"]["like_count"], 1);
    let viewer_replies = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/topics/{topic}/replies"),
            &reader.cookies,
        ))
        .await
        .expect("viewer replies request must respond");
    let viewer_replies_payload = response_json(viewer_replies).await;
    assert_eq!(viewer_replies_payload["data"][0]["like_count"], 1);
    assert_eq!(viewer_replies_payload["data"][0]["viewer_liked"], true);

    let unlike = app
        .clone()
        .oneshot(state_change_request(
            Method::DELETE,
            &topic_like_path,
            &reader.cookies,
            &reader.csrf,
        ))
        .await
        .expect("topic unlike request must respond");
    assert_eq!(unlike.status(), StatusCode::OK);
    assert_eq!(response_json(unlike).await["data"]["like_count"], 0);

    let hidden = app
        .clone()
        .oneshot(state_change_request(
            Method::PUT,
            &format!("/api/v1/posts/{hidden_reply}/like"),
            &reader.cookies,
            &reader.csrf,
        ))
        .await
        .expect("hidden reply like request must respond");
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(hidden).await["error"]["code"],
        "post.not_found"
    );

    let invalid_path = app
        .oneshot(state_change_request(
            Method::PUT,
            "/api/v1/posts/not-a-uuid/like",
            &reader.cookies,
            &reader.csrf,
        ))
        .await
        .expect("invalid post path request must respond");
    assert_eq!(invalid_path.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(invalid_path).await["error"]["code"],
        "request.path_invalid"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn current_user_bookmarks_are_authenticated_filtered_and_stably_paginated(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let reader = register(&app, "reader").await;
    let reader_id = Uuid::parse_str(&reader.user_id).expect("session user id must be a UUID");
    let author = fixture_id(2);
    let board = fixture_id(11);
    let older_topic = fixture_id(101);
    let newer_topic = fixture_id(102);
    let hidden_topic = fixture_id(103);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "bookmarks", "public").await;
    for topic in [older_topic, newer_topic, hidden_topic] {
        insert_topic(&pool, topic, board, author).await;
        sqlx::query(
            "INSERT INTO topic_bookmarks (user_id, topic_id, created_at) \
             VALUES ($1, $2, '2026-08-03T12:00:00Z'::timestamptz)",
        )
        .bind(reader_id)
        .bind(topic)
        .execute(&pool)
        .await
        .expect("bookmark fixture must insert");
    }
    sqlx::query("UPDATE topics SET status = 'hidden' WHERE id = $1")
        .bind(hidden_topic)
        .execute(&pool)
        .await
        .expect("hidden topic fixture must update");

    let anonymous = app
        .clone()
        .oneshot(get_request("/api/v1/users/me/bookmarks", ""))
        .await
        .expect("anonymous bookmark list request must respond");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let first = app
        .clone()
        .oneshot(get_request(
            "/api/v1/users/me/bookmarks?limit=1",
            &reader.cookies,
        ))
        .await
        .expect("first bookmark page must respond");
    assert_eq!(first.status(), StatusCode::OK);
    let first_payload = response_json(first).await;
    assert_eq!(first_payload["data"][0]["id"], newer_topic.to_string());
    assert_eq!(first_payload["data"][0]["viewer_bookmarked"], true);
    let cursor = first_payload["meta"]["next_cursor"]
        .as_str()
        .expect("full bookmark page must expose a cursor");

    let second = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/users/me/bookmarks?limit=1&cursor={cursor}"),
            &reader.cookies,
        ))
        .await
        .expect("second bookmark page must respond");
    let second_payload = response_json(second).await;
    assert_eq!(second_payload["data"][0]["id"], older_topic.to_string());
    assert!(second_payload["meta"]["next_cursor"].is_null());

    let invalid_cursor = app
        .oneshot(get_request(
            &format!("/api/v1/users/me/bookmarks?cursor={hidden_topic}"),
            &reader.cookies,
        ))
        .await
        .expect("hidden bookmark cursor request must respond");
    assert_eq!(invalid_cursor.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(invalid_cursor).await["error"]["fields"]["cursor"].is_array());
}

#[tokio::test]
async fn openapi_documents_bookmark_and_like_routes() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI route must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let document = response_json(response).await;

    let bookmark = &document["paths"]["/api/v1/topics/{topic_id}/bookmark"];
    assert!(bookmark["put"].is_object());
    assert!(bookmark["delete"].is_object());
    let like = &document["paths"]["/api/v1/posts/{post_id}/like"];
    assert!(like["put"].is_object());
    assert!(like["delete"].is_object());
    assert!(document["paths"]["/api/v1/users/me/bookmarks"]["get"].is_object());
    for schema in ["BookmarkState", "PostLikeState"] {
        assert!(
            document["components"]["schemas"][schema].is_object(),
            "{schema}"
        );
    }
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
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response body must be JSON")
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

async fn insert_user(pool: &PgPool, id: Uuid, username: &str, status: &str) {
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status) \
         VALUES ($1, $2, $2 || '@example.com', $2, $3)",
    )
    .bind(id)
    .bind(username)
    .bind(status)
    .execute(pool)
    .await
    .expect("user fixture must insert");
}

async fn insert_board(pool: &PgPool, id: Uuid, slug: &str, visibility: &str) {
    sqlx::query("INSERT INTO boards (id, slug, name, visibility) VALUES ($1, $2, $2, $3)")
        .bind(id)
        .bind(slug)
        .bind(visibility)
        .execute(pool)
        .await
        .expect("board fixture must insert");
}

async fn insert_topic(pool: &PgPool, id: Uuid, board_id: Uuid, author_id: Uuid) {
    sqlx::query(
        "INSERT INTO topics (\
             id, board_id, author_id, title, excerpt, content, status, published_at, last_activity_at\
         ) VALUES (\
             $1, $2, $3, $1::text, 'Excerpt', 'Content', 'published',\
             '2026-08-03T10:00:00Z'::timestamptz, '2026-08-03T10:00:00Z'::timestamptz\
         )",
    )
    .bind(id)
    .bind(board_id)
    .bind(author_id)
    .execute(pool)
    .await
    .expect("topic fixture must insert");
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status) \
         VALUES ($1, $1, $2, 'topic', 'Content', 'published')",
    )
    .bind(id)
    .bind(author_id)
    .execute(pool)
    .await
    .expect("topic post fixture must insert");
}

async fn insert_reply(pool: &PgPool, id: Uuid, topic_id: Uuid, author_id: Uuid, status: &str) {
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status) \
         VALUES ($1, $2, $3, 'reply', 'Reply', $4)",
    )
    .bind(id)
    .bind(topic_id)
    .bind(author_id)
    .bind(status)
    .execute(pool)
    .await
    .expect("reply fixture must insert");
}
