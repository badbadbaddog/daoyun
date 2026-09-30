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
async fn public_topic_list_maps_filters_and_cursor_pagination(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    insert_topic(
        &pool,
        fixture_id(101),
        board,
        author,
        "100% Rust pinned",
        "2026-08-01T10:00:00Z",
        true,
        true,
    )
    .await;
    insert_topic(
        &pool,
        fixture_id(102),
        board,
        author,
        "100% Rust newer",
        "2026-08-01T11:00:00Z",
        false,
        true,
    )
    .await;
    insert_topic(
        &pool,
        fixture_id(103),
        board,
        author,
        "not featured",
        "2026-08-01T12:00:00Z",
        false,
        false,
    )
    .await;

    let app = daoyun_api::app(Database::from_pool(pool));
    let first = app
        .clone()
        .oneshot(get_request(
            "/api/v1/topics?board=general&query=100%25&featured=true&sort=latest&limit=1",
        ))
        .await
        .expect("first topic page must respond");
    assert_eq!(first.status(), StatusCode::OK);
    let request_id = first.headers()["x-request-id"]
        .to_str()
        .expect("request ID must be text")
        .to_owned();
    let first_payload = response_json(first).await;
    assert_eq!(first_payload["meta"]["request_id"], request_id);
    assert_eq!(first_payload["data"][0]["title"], "100% Rust pinned");
    assert_eq!(first_payload["data"][0]["author"]["username"], "author");
    assert_eq!(first_payload["data"][0]["board"]["slug"], "general");
    assert_eq!(
        first_payload["data"][0]["published_at"],
        "2026-08-01T10:00:00Z"
    );
    for private_field in ["email", "status", "hot_score", "deleted_at"] {
        assert!(!first_payload.to_string().contains(private_field));
    }

    let cursor = first_payload["meta"]["next_cursor"]
        .as_str()
        .expect("full page must return a cursor");
    let second = app
        .oneshot(get_request(&format!(
            "/api/v1/topics?board=general&query=100%25&featured=true&sort=latest&limit=1&cursor={cursor}"
        )))
        .await
        .expect("second topic page must respond");
    assert_eq!(second.status(), StatusCode::OK);
    let second_payload = response_json(second).await;
    assert_eq!(second_payload["data"][0]["title"], "100% Rust newer");
    assert!(second_payload["meta"]["next_cursor"].is_null());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_list_supports_public_author_filters_and_authenticated_following_scope(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let owner_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'owner'")
        .fetch_one(&pool)
        .await
        .expect("owner fixture must exist");
    let member_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'member'")
        .fetch_one(&pool)
        .await
        .expect("member fixture must exist");
    let board_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM boards WHERE slug = 'general'")
        .fetch_one(&pool)
        .await
        .expect("default board fixture must exist");
    insert_topic(
        &pool,
        fixture_id(151),
        board_id,
        owner_id,
        "owner topic",
        "2026-08-03T10:00:00Z",
        false,
        false,
    )
    .await;
    insert_topic(
        &pool,
        fixture_id(152),
        board_id,
        member_id,
        "member topic",
        "2026-08-03T11:00:00Z",
        false,
        false,
    )
    .await;
    let followed = app
        .clone()
        .oneshot(state_change_request(
            Method::PUT,
            &format!("/api/v1/users/{owner_id}/follow"),
            &member_cookies,
            &member_csrf,
        ))
        .await
        .expect("follow request must respond");
    assert_eq!(followed.status(), StatusCode::OK);

    let author_topics = app
        .clone()
        .oneshot(get_request("/api/v1/topics?author=owner"))
        .await
        .expect("author topic list must respond");
    assert_eq!(author_topics.status(), StatusCode::OK);
    let author_payload = response_json(author_topics).await;
    assert_eq!(author_payload["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(author_payload["data"][0]["author"]["username"], "owner");

    let anonymous_following = app
        .clone()
        .oneshot(get_request("/api/v1/topics?scope=following"))
        .await
        .expect("anonymous following request must respond");
    assert_eq!(anonymous_following.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(anonymous_following).await["error"]["code"],
        "auth.unauthenticated"
    );

    let following = app
        .clone()
        .oneshot(get_request_with_headers(
            "/api/v1/topics?scope=following",
            &member_cookies,
        ))
        .await
        .expect("authenticated following request must respond");
    assert_eq!(following.status(), StatusCode::OK);
    let following_payload = response_json(following).await;
    assert_eq!(following_payload["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(following_payload["data"][0]["author"]["username"], "owner");

    for path in [
        "/api/v1/topics?author=Invalid_Name",
        "/api/v1/topics?scope=unknown",
    ] {
        let response = app
            .clone()
            .oneshot(get_request(path))
            .await
            .expect("invalid scoped topic query must respond");
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{path}"
        );
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn feed_facade_maps_recommended_following_and_latest_modes(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let owner_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'owner'")
        .fetch_one(&pool)
        .await
        .expect("owner fixture must exist");
    let member_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'member'")
        .fetch_one(&pool)
        .await
        .expect("member fixture must exist");
    let board_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM boards WHERE slug = 'general'")
        .fetch_one(&pool)
        .await
        .expect("default board fixture must exist");
    let owner_topic = fixture_id(161);
    let member_topic = fixture_id(162);
    insert_topic(
        &pool,
        owner_topic,
        board_id,
        owner_id,
        "popular owner post",
        "2026-08-03T10:00:00Z",
        false,
        false,
    )
    .await;
    insert_topic(
        &pool,
        member_topic,
        board_id,
        member_id,
        "newest member post",
        "2026-08-03T11:00:00Z",
        true,
        false,
    )
    .await;
    let liked_owner_topic = app
        .clone()
        .oneshot(state_change_request(
            Method::PUT,
            &format!("/api/v1/posts/{owner_topic}/like"),
            &member_cookies,
            &member_csrf,
        ))
        .await
        .expect("topic like request must respond");
    assert_eq!(liked_owner_topic.status(), StatusCode::OK);

    let latest = app
        .clone()
        .oneshot(get_request("/api/v1/feed?mode=latest"))
        .await
        .expect("latest feed must respond");
    assert_eq!(latest.status(), StatusCode::OK);
    assert_eq!(
        response_json(latest).await["data"][0]["id"],
        member_topic.to_string()
    );

    let recommended = app
        .clone()
        .oneshot(get_request("/api/v1/feed?mode=recommended"))
        .await
        .expect("recommended feed must respond");
    assert_eq!(recommended.status(), StatusCode::OK);
    assert_eq!(
        response_json(recommended).await["data"][0]["id"],
        owner_topic.to_string()
    );

    let anonymous_following = app
        .clone()
        .oneshot(get_request("/api/v1/feed?mode=following"))
        .await
        .expect("anonymous following feed must respond");
    assert_eq!(anonymous_following.status(), StatusCode::UNAUTHORIZED);

    let followed = app
        .clone()
        .oneshot(state_change_request(
            Method::PUT,
            &format!("/api/v1/users/{owner_id}/follow"),
            &member_cookies,
            &member_csrf,
        ))
        .await
        .expect("follow request must respond");
    assert_eq!(followed.status(), StatusCode::OK);

    let following = app
        .clone()
        .oneshot(get_request_with_headers(
            "/api/v1/feed?mode=following",
            &member_cookies,
        ))
        .await
        .expect("authenticated following feed must respond");
    assert_eq!(following.status(), StatusCode::OK);
    let following_payload = response_json(following).await;
    assert_eq!(following_payload["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(following_payload["data"][0]["author"]["username"], "owner");

    let invalid = app
        .oneshot(get_request("/api/v1/feed?mode=unknown"))
        .await
        .expect("invalid feed mode must respond");
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_detail_returns_content_and_hides_every_unavailable_variant(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    let hidden_board = fixture_id(12);
    let visible_topic = fixture_id(101);
    let hidden_topic = fixture_id(102);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    insert_board(&pool, hidden_board, "staff", "hidden").await;
    insert_topic(
        &pool,
        visible_topic,
        board,
        author,
        "visible",
        "2026-08-01T10:00:00Z",
        false,
        false,
    )
    .await;
    insert_topic(
        &pool,
        hidden_topic,
        hidden_board,
        author,
        "hidden",
        "2026-08-01T11:00:00Z",
        false,
        false,
    )
    .await;

    let app = daoyun_api::app(Database::from_pool(pool));
    let visible = app
        .clone()
        .oneshot(get_request(&format!("/api/v1/topics/{visible_topic}")))
        .await
        .expect("topic detail must respond");
    assert_eq!(visible.status(), StatusCode::OK);
    let payload = response_json(visible).await;
    assert_eq!(payload["data"]["id"], visible_topic.to_string());
    assert_eq!(payload["data"]["content"], "Content for visible");

    for topic_id in [hidden_topic, fixture_id(999)] {
        let response = app
            .clone()
            .oneshot(get_request(&format!("/api/v1/topics/{topic_id}")))
            .await
            .expect("unavailable topic lookup must respond");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "topic.not_found"
        );
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_routes_reject_invalid_query_path_and_cursor_inputs(pool: PgPool) {
    let app = daoyun_api::app(Database::from_pool(pool));

    for path in [
        "/api/v1/topics?limit=0",
        "/api/v1/topics?limit=51",
        "/api/v1/topics?sort=unknown",
        "/api/v1/topics?board=Invalid_Slug",
        "/api/v1/topics?query=",
        "/api/v1/topics?cursor=not-a-uuid",
        "/api/v1/topics?cursor=019fc800-0000-7000-8000-000000000999",
    ] {
        let response = app
            .clone()
            .oneshot(get_request(path))
            .await
            .expect("invalid topic query must respond");
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{path}"
        );
        assert_eq!(
            response_json(response).await["error"]["code"],
            "request.validation_failed",
            "{path}"
        );
    }

    let invalid_path = app
        .oneshot(get_request("/api/v1/topics/not-a-uuid"))
        .await
        .expect("invalid topic path must respond");
    assert_eq!(invalid_path.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(invalid_path).await["error"]["code"],
        "request.path_invalid"
    );
}

#[tokio::test]
async fn topic_routes_hide_database_failures() {
    let app = daoyun_api::app(unavailable_database());
    for path in [
        "/api/v1/topics",
        "/api/v1/topics/019fc800-0000-7000-8000-000000000101",
    ] {
        let response = app
            .clone()
            .oneshot(get_request(path))
            .await
            .expect("failed database request must respond");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .expect("request ID must be text")
            .to_owned();
        let payload = response_json(response).await;
        assert_eq!(payload["error"]["code"], "system.database_unavailable");
        assert_eq!(payload["meta"]["request_id"], request_id);
        assert!(!payload.to_string().contains("sqlx"));
        assert!(!payload.to_string().contains("connection"));
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn publishing_requires_authentication_and_csrf(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);

    let response = app
        .clone()
        .oneshot(json_request(
            "/api/v1/topics",
            serde_json::json!({"title": "主题", "content": "正文"}),
        ))
        .await
        .expect("unauthenticated topic request must respond");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "auth.unauthenticated"
    );

    let (cookie_header, csrf_token) = register_member(&app).await;
    let response = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "主题", "content": "正文"}),
            &cookie_header,
            None,
        ))
        .await
        .expect("missing csrf topic request must respond");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "auth.csrf_failed"
    );

    let response = app
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "主题", "content": "正文"}),
            &cookie_header,
            Some(&csrf_token),
        ))
        .await
        .expect("valid csrf topic request must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn publishing_uses_the_default_board_and_replays_idempotently(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (cookie_header, csrf_token) = register_member(&app).await;
    let key = "topic-create-001";
    let body = serde_json::json!({
        "title": "首个主题",
        "content": "客户端纯文本不会成为权威值",
        "rich_content": {
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "text": "这是正文" }]
            }]
        }
    });

    let first = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            body.clone(),
            &cookie_header,
            &csrf_token,
            key,
        ))
        .await
        .expect("first topic request must respond");
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_payload = response_json(first).await;
    let topic_id = first_payload["data"]["id"]
        .as_str()
        .expect("created topic must have an id")
        .to_owned();
    assert_eq!(first_payload["data"]["board"]["slug"], "general");
    assert_eq!(first_payload["data"]["author"]["username"], "member");
    assert_eq!(first_payload["data"]["content"], "这是正文");
    assert_eq!(first_payload["data"]["rich_content"]["type"], "doc");

    let replay = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            body,
            &cookie_header,
            &csrf_token,
            key,
        ))
        .await
        .expect("replayed topic request must respond");
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(response_json(replay).await["data"]["id"], topic_id);

    let conflict = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "同一键不同内容", "content": "正文"}),
            &cookie_header,
            &csrf_token,
            key,
        ))
        .await
        .expect("idempotency conflict must respond");
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(conflict).await["error"]["code"],
        "request.idempotency_conflict"
    );

    let topic_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topics")
        .fetch_one(&pool)
        .await
        .expect("topic count must be readable");
    let board_count =
        sqlx::query_scalar::<_, i64>("SELECT topic_count FROM boards WHERE slug = 'general'")
            .fetch_one(&pool)
            .await
            .expect("default board count must be readable");
    assert_eq!(topic_count, 1);
    assert_eq!(board_count, 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn post_facade_reuses_topic_storage_handlers_and_comment_chain(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    let (cookies, csrf) = register_member(&app).await;

    let created = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/posts",
            serde_json::json!({"content": "统一 Post 正文"}),
            &cookies,
            &csrf,
            "post-facade-create-001",
        ))
        .await
        .expect("post facade creation must respond");
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_payload = response_json(created).await;
    let post_id = created_payload["data"]["id"]
        .as_str()
        .expect("post facade must return an id")
        .to_owned();
    assert_eq!(created_payload["data"]["title"], "");
    assert_eq!(created_payload["data"]["content"], "统一 Post 正文");

    let legacy_detail = app
        .clone()
        .oneshot(get_request(&format!("/api/v1/topics/{post_id}")))
        .await
        .expect("legacy topic detail must read facade-created post");
    assert_eq!(legacy_detail.status(), StatusCode::OK);
    let legacy_payload = response_json(legacy_detail).await;
    assert_eq!(legacy_payload["data"]["id"], post_id);
    assert_eq!(legacy_payload["data"]["content"], "统一 Post 正文");

    let updated = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/posts/{post_id}"),
            serde_json::json!({
                "base_revision": 1,
                "title": "兼容 Post 标题"
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("post facade update must respond");
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(
        response_json(updated).await["data"]["topic"]["title"],
        "兼容 Post 标题"
    );

    let comment_path = format!("/api/v1/posts/{post_id}/comments");
    let comment = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &comment_path,
            serde_json::json!({"content": "兼容评论"}),
            &cookies,
            &csrf,
            "post-facade-comment-001",
        ))
        .await
        .expect("post facade comment must respond");
    assert_eq!(comment.status(), StatusCode::CREATED);

    let legacy_replies = app
        .clone()
        .oneshot(get_request(&format!("/api/v1/topics/{post_id}/replies")))
        .await
        .expect("legacy reply route must expose facade comment");
    assert_eq!(legacy_replies.status(), StatusCode::OK);
    let replies_payload = response_json(legacy_replies).await;
    assert_eq!(replies_payload["data"][0]["content"], "兼容评论");

    let deleted = app
        .clone()
        .oneshot(state_change_request(
            Method::DELETE,
            &format!("/api/v1/posts/{post_id}"),
            &cookies,
            &csrf,
        ))
        .await
        .expect("post facade deletion must respond");
    assert_eq!(deleted.status(), StatusCode::OK);

    let legacy_deleted = app
        .oneshot(get_request(&format!("/api/v1/topics/{post_id}")))
        .await
        .expect("deleted legacy detail must respond");
    assert_eq!(legacy_deleted.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn publishing_validates_fields_and_body_limit(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    let (cookie_header, csrf_token) = register_member(&app).await;

    let invalid = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": " ", "content": ""}),
            &cookie_header,
            Some(&csrf_token),
        ))
        .await
        .expect("invalid topic request must respond");
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let invalid_payload = response_json(invalid).await;
    assert!(invalid_payload["error"]["fields"]["title"].is_null());
    assert!(invalid_payload["error"]["fields"]["content"].is_array());

    let invalid_title = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "x".repeat(161), "content": "正文"}),
            &cookie_header,
            Some(&csrf_token),
        ))
        .await
        .expect("oversized title request must respond");
    assert_eq!(invalid_title.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(invalid_title).await["error"]["fields"]["title"].is_array());

    let invalid_key = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "主题", "content": "正文"}),
            &cookie_header,
            &csrf_token,
            "invalid key",
        ))
        .await
        .expect("invalid idempotency key must respond");
    assert_eq!(invalid_key.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(invalid_key).await["error"]["fields"]["idempotency_key"].is_array());

    let oversized = app
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "主题", "content": "x".repeat(270_000)}),
            &cookie_header,
            Some(&csrf_token),
        ))
        .await
        .expect("oversized topic request must respond");
    assert_eq!(oversized.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(oversized).await["error"]["fields"]["body"].is_array());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn reply_routes_list_and_publish_with_auth_csrf_and_idempotency(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (cookie_header, csrf_token) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "回复测试主题", "content": "主题正文"}),
            &cookie_header,
            &csrf_token,
            "reply-parent-topic",
        ))
        .await
        .expect("parent topic request must respond");
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("parent topic id must be text")
        .to_owned();
    let reply_path = format!("/api/v1/topics/{topic_id}/replies");

    let empty = app
        .clone()
        .oneshot(get_request(&reply_path))
        .await
        .expect("empty reply list must respond");
    assert_eq!(empty.status(), StatusCode::OK);
    assert_eq!(response_json(empty).await["data"], serde_json::json!([]));

    let unauthenticated = app
        .clone()
        .oneshot(json_request(
            &reply_path,
            serde_json::json!({"content": "回复正文"}),
        ))
        .await
        .expect("unauthenticated reply must respond");
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let first = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &reply_path,
            serde_json::json!({"content": "回复正文"}),
            &cookie_header,
            &csrf_token,
            "reply-create-001",
        ))
        .await
        .expect("first reply must respond");
    assert_eq!(first.status(), StatusCode::CREATED);
    let first_payload = response_json(first).await;
    let reply_id = first_payload["data"]["id"].clone();
    assert_eq!(first_payload["data"]["content"], "回复正文");
    assert_eq!(first_payload["data"]["revision_count"], 1);
    assert_eq!(first_payload["data"]["author"]["username"], "member");
    assert_eq!(first_payload["data"]["floor_number"], 1);
    assert!(first_payload["data"]["reply_to"].is_null());

    let replay = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &reply_path,
            serde_json::json!({"content": "回复正文"}),
            &cookie_header,
            &csrf_token,
            "reply-create-001",
        ))
        .await
        .expect("replayed reply must respond");
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(response_json(replay).await["data"]["id"], reply_id);

    let conflict = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &reply_path,
            serde_json::json!({"content": "不同回复"}),
            &cookie_header,
            &csrf_token,
            "reply-create-001",
        ))
        .await
        .expect("conflicting reply must respond");
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(conflict).await["error"]["code"],
        "request.idempotency_conflict"
    );

    let second = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &reply_path,
            serde_json::json!({
                "content": "回复一楼",
                "reply_to_id": reply_id,
            }),
            &cookie_header,
            &csrf_token,
            "reply-create-002",
        ))
        .await
        .expect("floor reply must respond");
    assert_eq!(second.status(), StatusCode::CREATED);
    let second_payload = response_json(second).await;
    assert_eq!(second_payload["data"]["floor_number"], 2);
    assert_eq!(second_payload["data"]["reply_to"]["id"], reply_id);
    assert_eq!(second_payload["data"]["reply_to"]["floor_number"], 1);
    assert_eq!(
        second_payload["data"]["reply_to"]["author"]["username"],
        "member"
    );
    assert_eq!(second_payload["data"]["reply_to"]["excerpt"], "回复正文");
    assert_eq!(second_payload["data"]["reply_to"]["is_deleted"], false);

    let listed = app
        .clone()
        .oneshot(get_request(&reply_path))
        .await
        .expect("floor reply list must respond");
    assert_eq!(listed.status(), StatusCode::OK);
    let listed_payload = response_json(listed).await;
    assert_eq!(listed_payload["data"][0]["floor_number"], 1);
    assert_eq!(listed_payload["data"][1]["floor_number"], 2);
    assert_eq!(listed_payload["data"][1]["reply_to"]["id"], reply_id);

    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT reply_count FROM topics WHERE id = $1")
            .bind(Uuid::parse_str(&topic_id).expect("topic id must be a UUID"))
            .fetch_one(&pool)
            .await
            .expect("topic reply count must be readable"),
        2
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn reply_routes_reject_invalid_paths_queries_and_bodies(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);

    for (path, status) in [
        ("/api/v1/topics/not-a-uuid/replies", StatusCode::BAD_REQUEST),
        (
            "/api/v1/topics/019fc800-0000-7000-8000-000000000999/replies",
            StatusCode::NOT_FOUND,
        ),
        (
            "/api/v1/topics/019fc800-0000-7000-8000-000000000999/replies?limit=0",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(get_request(path))
            .await
            .expect("invalid reply request must respond");
        assert_eq!(response.status(), status, "{path}");
    }

    let (cookie_header, csrf_token) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "回复校验主题", "content": "主题正文"}),
            &cookie_header,
            &csrf_token,
            "reply-validation-parent",
        ))
        .await
        .expect("parent topic request must respond");
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("parent topic id must be text")
        .to_owned();
    let reply_path = format!("/api/v1/topics/{topic_id}/replies");

    let other_topic = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "另一个主题", "content": "另一篇正文"}),
            &cookie_header,
            &csrf_token,
            "reply-validation-other-topic",
        ))
        .await
        .expect("other topic request must respond");
    let other_topic_id = response_json(other_topic).await["data"]["id"]
        .as_str()
        .expect("other topic id must be text")
        .to_owned();
    let other_reply = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &format!("/api/v1/topics/{other_topic_id}/replies"),
            serde_json::json!({"content": "其他主题回复"}),
            &cookie_header,
            &csrf_token,
            "reply-validation-other-reply",
        ))
        .await
        .expect("other topic reply must respond");
    let other_reply_id = response_json(other_reply).await["data"]["id"].clone();

    let cross_topic_target = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &reply_path,
            serde_json::json!({
                "content": "不能引用其他主题",
                "reply_to_id": other_reply_id,
            }),
            &cookie_header,
            &csrf_token,
            "reply-validation-cross-topic",
        ))
        .await
        .expect("cross-topic reply target must respond");
    assert_eq!(
        cross_topic_target.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert!(response_json(cross_topic_target).await["error"]["fields"]["reply_to_id"].is_array());

    let missing_csrf = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            &reply_path,
            serde_json::json!({"content": "回复正文"}),
            &cookie_header,
            None,
        ))
        .await
        .expect("missing csrf reply must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let empty_content = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            &reply_path,
            serde_json::json!({"content": "   "}),
            &cookie_header,
            Some(&csrf_token),
        ))
        .await
        .expect("empty reply must respond");
    assert_eq!(empty_content.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(empty_content).await["error"]["fields"]["content"].is_array());

    let invalid_key = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &reply_path,
            serde_json::json!({"content": "回复正文"}),
            &cookie_header,
            &csrf_token,
            "invalid key",
        ))
        .await
        .expect("invalid reply idempotency key must respond");
    assert_eq!(invalid_key.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(invalid_key).await["error"]["fields"]["idempotency_key"].is_array());

    let oversized = app
        .oneshot(json_request_with_headers(
            Method::POST,
            &reply_path,
            serde_json::json!({"content": "x".repeat(140_000)}),
            &cookie_header,
            Some(&csrf_token),
        ))
        .await
        .expect("oversized reply must respond");
    assert_eq!(oversized.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(oversized).await["error"]["fields"]["body"].is_array());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn reply_gated_topic_content_is_redacted_until_the_viewer_replies(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    let (author_cookies, author_csrf) = register_member(&app).await;
    let (reader_cookies, reader_csrf) =
        register_additional_member(&app, "reader", "reader@example.com", "等待读者").await;
    let (owner_cookies, _) = login_owner(&app).await;

    let created = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({
                "title": "回复后可见主题",
                "content": "客户端占位正文",
                "rich_content": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "公开开头"}]
                        },
                        {
                            "type": "replyGate",
                            "content": [{
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "隐藏答案 42"}]
                            }]
                        }
                    ]
                }
            }),
            &author_cookies,
            &author_csrf,
            "reply-gated-topic",
        ))
        .await
        .expect("gated topic creation must respond");
    assert_eq!(created.status(), StatusCode::CREATED);
    let topic_id = response_json(created).await["data"]["id"]
        .as_str()
        .expect("gated topic id must be text")
        .to_owned();
    let topic_path = format!("/api/v1/topics/{topic_id}");
    let reply_path = format!("/api/v1/topics/{topic_id}/replies");

    let gated_reply = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &reply_path,
            serde_json::json!({
                "content": "公开回复",
                "rich_content": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "公开回复"}]
                        },
                        {
                            "type": "replyGate",
                            "content": [{
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "回复中的秘密 84"}]
                            }]
                        }
                    ]
                }
            }),
            &author_cookies,
            &author_csrf,
            "reply-gated-reply",
        ))
        .await
        .expect("gated reply creation must respond");
    assert_eq!(gated_reply.status(), StatusCode::CREATED);
    let gated_reply_id = response_json(gated_reply).await["data"]["id"].clone();
    let quoted_gated_reply = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &reply_path,
            serde_json::json!({
                "content": "引用带门控的楼层",
                "reply_to_id": gated_reply_id,
            }),
            &author_cookies,
            &author_csrf,
            "quoted-reply-gated-reply",
        ))
        .await
        .expect("quoted gated reply creation must respond");
    assert_eq!(quoted_gated_reply.status(), StatusCode::CREATED);

    for request in [
        get_request(&topic_path),
        get_request_with_headers(&topic_path, &reader_cookies),
    ] {
        let locked = app
            .clone()
            .oneshot(request)
            .await
            .expect("locked topic request must respond");
        assert_eq!(locked.status(), StatusCode::OK);
        let locked_payload = response_json(locked).await;
        assert_eq!(locked_payload["data"]["has_locked_content"], true);
        assert_eq!(
            locked_payload["data"]["content"],
            "公开开头\n回复主题后可见"
        );
        assert!(!locked_payload.to_string().contains("隐藏答案 42"));
    }

    for request in [
        get_request(&reply_path),
        get_request_with_headers(&reply_path, &reader_cookies),
    ] {
        let locked = app
            .clone()
            .oneshot(request)
            .await
            .expect("locked reply list must respond");
        let locked_payload = response_json(locked).await;
        assert_eq!(locked_payload["data"][0]["has_locked_content"], true);
        assert!(!locked_payload.to_string().contains("回复中的秘密 84"));
    }

    let hidden_search = app
        .clone()
        .oneshot(get_request("/api/v1/topics?query=42"))
        .await
        .expect("hidden-text search must respond");
    assert_eq!(hidden_search.status(), StatusCode::OK);
    assert_eq!(
        response_json(hidden_search).await["data"],
        serde_json::json!([])
    );

    for cookies in [&author_cookies, &owner_cookies] {
        let unlocked = app
            .clone()
            .oneshot(get_request_with_headers(&topic_path, cookies))
            .await
            .expect("privileged topic request must respond");
        let unlocked_payload = response_json(unlocked).await;
        assert_eq!(unlocked_payload["data"]["has_locked_content"], true);
        assert!(unlocked_payload.to_string().contains("隐藏答案 42"));
    }

    let reply = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &reply_path,
            serde_json::json!({"content": "我已回复"}),
            &reader_cookies,
            &reader_csrf,
            "unlock-gated-topic",
        ))
        .await
        .expect("unlocking reply must respond");
    assert_eq!(reply.status(), StatusCode::CREATED);

    let unlocked = app
        .clone()
        .oneshot(get_request_with_headers(&topic_path, &reader_cookies))
        .await
        .expect("unlocked reader topic request must respond");
    assert!(
        response_json(unlocked)
            .await
            .to_string()
            .contains("隐藏答案 42")
    );

    let unlocked_replies = app
        .oneshot(get_request_with_headers(&reply_path, &reader_cookies))
        .await
        .expect("unlocked reply list must respond");
    assert!(
        response_json(unlocked_replies)
            .await
            .to_string()
            .contains("回复中的秘密 84")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_routes_support_tags_editing_and_author_only_revisions(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    let (cookie_header, csrf_token) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({
                "title": "标签编辑主题",
                "content": "初始正文",
                "tags": [{"slug": "rust", "name": "Rust"}]
            }),
            &cookie_header,
            &csrf_token,
            "tag-edit-parent",
        ))
        .await
        .expect("tagged topic request must respond");
    assert_eq!(topic.status(), StatusCode::CREATED);
    let topic_payload = response_json(topic).await;
    let topic_id = topic_payload["data"]["id"]
        .as_str()
        .expect("topic id must be text")
        .to_owned();
    assert_eq!(topic_payload["data"]["content_revision"], 1);
    assert_eq!(topic_payload["data"]["tags"][0]["slug"], "rust");

    let tags = app
        .clone()
        .oneshot(get_request("/api/v1/tags"))
        .await
        .expect("tag list must respond");
    assert_eq!(tags.status(), StatusCode::OK);
    assert_eq!(response_json(tags).await["data"][0]["slug"], "rust");

    let filtered = app
        .clone()
        .oneshot(get_request("/api/v1/topics?tag=rust"))
        .await
        .expect("tag filter must respond");
    assert_eq!(filtered.status(), StatusCode::OK);
    assert_eq!(response_json(filtered).await["data"][0]["id"], topic_id);

    let edited = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/topics/{topic_id}"),
            serde_json::json!({
                "base_revision": 1,
                "title": "已编辑主题",
                "content": "更新后的正文",
                "tags": [{"slug": "sqlx", "name": "SQLx"}]
            }),
            &cookie_header,
            Some(&csrf_token),
        ))
        .await
        .expect("topic edit must respond");
    assert_eq!(edited.status(), StatusCode::OK);
    let edited_payload = response_json(edited).await;
    assert_eq!(edited_payload["data"]["disposition"], "published");
    assert!(edited_payload["data"]["review_id"].is_null());
    assert_eq!(edited_payload["data"]["topic"]["content"], "更新后的正文");
    assert_eq!(edited_payload["data"]["topic"]["content_revision"], 2);
    assert_eq!(edited_payload["data"]["topic"]["tags"][0]["slug"], "sqlx");

    let conflict = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/topics/{topic_id}"),
            serde_json::json!({"base_revision": 1, "title": "过期"}),
            &cookie_header,
            Some(&csrf_token),
        ))
        .await
        .expect("stale edit must respond");
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(conflict).await["error"]["code"],
        "topic.revision_conflict"
    );

    let revisions = app
        .clone()
        .oneshot(get_request_with_headers(
            &format!("/api/v1/topics/{topic_id}/revisions"),
            &cookie_header,
        ))
        .await
        .expect("revision list must respond");
    assert_eq!(revisions.status(), StatusCode::OK);
    assert_eq!(
        response_json(revisions).await["data"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let admin_path = format!("/api/v1/admin/moderation/topics/{topic_id}/revisions");
    let anonymous = app.clone().oneshot(get_request(&admin_path)).await.unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    let forbidden = app
        .clone()
        .oneshot(get_request_with_headers(&admin_path, &cookie_header))
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let hidden = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/topics/{topic_id}/moderation"),
            serde_json::json!({"status": "hidden", "reason": "复核历史正文"}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .unwrap();
    assert_eq!(hidden.status(), StatusCode::OK);
    let history = app
        .clone()
        .oneshot(get_request_with_headers(&admin_path, &owner_cookies))
        .await
        .unwrap();
    assert_eq!(history.status(), StatusCode::OK);
    let request_id = history.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let history = response_json(history).await;
    assert_eq!(history["meta"]["request_id"], request_id);
    assert_eq!(history["data"].as_array().unwrap().len(), 2);
    assert_eq!(history["data"][0]["content"], "更新后的正文");
    assert_eq!(history["data"][0]["revision_number"], 2);
    assert_eq!(history["data"][1]["content"], "初始正文");
    assert_eq!(history["data"][1]["editor"]["username"], "member");
    let missing = app
        .oneshot(get_request_with_headers(
            &format!(
                "/api/v1/admin/moderation/topics/{}/revisions",
                fixture_id(998)
            ),
            &owner_cookies,
        ))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn reply_item_routes_support_author_edits_revisions_and_soft_delete(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    let (author_cookies, author_csrf) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "回复编辑主题", "content": "主题正文"}),
            &author_cookies,
            &author_csrf,
            "reply-edit-parent",
        ))
        .await
        .expect("parent topic request must respond");
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("parent topic id must be text")
        .to_owned();
    let reply = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &format!("/api/v1/topics/{topic_id}/replies"),
            serde_json::json!({"content": "初始回复"}),
            &author_cookies,
            &author_csrf,
            "reply-edit-child",
        ))
        .await
        .expect("reply request must respond");
    let reply_id = response_json(reply).await["data"]["id"]
        .as_str()
        .expect("reply id must be text")
        .to_owned();
    let replies_path = format!("/api/v1/topics/{topic_id}/replies");
    let child = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            &replies_path,
            serde_json::json!({
                "content": "引用首楼的回复",
                "reply_to_id": reply_id,
            }),
            &author_cookies,
            &author_csrf,
            "reply-edit-child-reference",
        ))
        .await
        .expect("child reply request must respond");
    assert_eq!(child.status(), StatusCode::CREATED);
    assert_eq!(response_json(child).await["data"]["floor_number"], 2);
    let reply_path = format!("/api/v1/topics/{topic_id}/replies/{reply_id}");

    let unauthenticated_revisions = app
        .clone()
        .oneshot(get_request(&format!("{reply_path}/revisions")))
        .await
        .expect("unauthenticated reply revisions must respond");
    assert_eq!(unauthenticated_revisions.status(), StatusCode::UNAUTHORIZED);

    let empty_content = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &reply_path,
            serde_json::json!({"base_revision": 1, "content": "   "}),
            &author_cookies,
            Some(&author_csrf),
        ))
        .await
        .expect("empty reply edit must respond");
    assert_eq!(empty_content.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(empty_content).await["error"]["fields"]["content"].is_array());

    let missing_csrf = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &reply_path,
            serde_json::json!({"base_revision": 1, "content": "更新后的回复"}),
            &author_cookies,
            None,
        ))
        .await
        .expect("missing CSRF reply edit must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let edited = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &reply_path,
            serde_json::json!({"base_revision": 1, "content": "  更新后的回复  "}),
            &author_cookies,
            Some(&author_csrf),
        ))
        .await
        .expect("reply edit must respond");
    assert_eq!(edited.status(), StatusCode::OK);
    let edited_payload = response_json(edited).await;
    assert_eq!(edited_payload["data"]["disposition"], "published");
    assert!(edited_payload["data"]["review_id"].is_null());
    assert_eq!(edited_payload["data"]["reply"]["content"], "更新后的回复");
    assert_eq!(edited_payload["data"]["reply"]["revision_count"], 2);

    let conflict = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &reply_path,
            serde_json::json!({"base_revision": 1, "content": "过期回复"}),
            &author_cookies,
            Some(&author_csrf),
        ))
        .await
        .expect("stale reply edit must respond");
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(conflict).await["error"]["code"],
        "reply.revision_conflict"
    );

    let revision_path = format!("{reply_path}/revisions");
    let revisions = app
        .clone()
        .oneshot(get_request_with_headers(&revision_path, &author_cookies))
        .await
        .expect("reply revisions must respond");
    assert_eq!(revisions.status(), StatusCode::OK);
    let revisions_payload = response_json(revisions).await;
    assert_eq!(revisions_payload["data"].as_array().unwrap().len(), 2);
    assert_eq!(revisions_payload["data"][1]["reply_id"], reply_id);
    assert_eq!(revisions_payload["data"][1]["content"], "更新后的回复");

    let (other_cookies, other_csrf) = login_owner(&app).await;
    for response in [
        app.clone()
            .oneshot(get_request_with_headers(&revision_path, &other_cookies))
            .await
            .expect("other user revision request must respond"),
        app.clone()
            .oneshot(json_request_with_headers(
                Method::PATCH,
                &reply_path,
                serde_json::json!({"base_revision": 2, "content": "越权回复"}),
                &other_cookies,
                Some(&other_csrf),
            ))
            .await
            .expect("other user edit request must respond"),
    ] {
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "reply.not_found"
        );
    }

    let delete_missing_csrf = app
        .clone()
        .oneshot(state_change_request(
            Method::DELETE,
            &reply_path,
            &author_cookies,
            "",
        ))
        .await
        .expect("reply delete without CSRF must respond");
    assert_eq!(delete_missing_csrf.status(), StatusCode::FORBIDDEN);

    let deleted = app
        .clone()
        .oneshot(state_change_request(
            Method::DELETE,
            &reply_path,
            &author_cookies,
            &author_csrf,
        ))
        .await
        .expect("reply delete must respond");
    assert_eq!(deleted.status(), StatusCode::OK);
    assert_eq!(response_json(deleted).await["data"], true);

    let detail = app
        .clone()
        .oneshot(get_request(&format!("/api/v1/topics/{topic_id}")))
        .await
        .expect("topic detail after reply delete must respond");
    assert_eq!(response_json(detail).await["data"]["reply_count"], 1);

    let remaining = app
        .clone()
        .oneshot(get_request(&replies_path))
        .await
        .expect("remaining replies must respond");
    let remaining_payload = response_json(remaining).await;
    assert_eq!(remaining_payload["data"].as_array().unwrap().len(), 1);
    assert_eq!(remaining_payload["data"][0]["floor_number"], 2);
    assert_eq!(remaining_payload["data"][0]["reply_to"]["id"], reply_id);
    assert_eq!(remaining_payload["data"][0]["reply_to"]["is_deleted"], true);
    assert!(remaining_payload["data"][0]["reply_to"]["excerpt"].is_null());

    let repeated = app
        .oneshot(state_change_request(
            Method::DELETE,
            &reply_path,
            &author_cookies,
            &author_csrf,
        ))
        .await
        .expect("repeated reply delete must respond");
    assert_eq!(repeated.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(repeated).await["error"]["code"],
        "reply.not_found"
    );
}

#[tokio::test]
async fn openapi_documents_public_topic_list_and_detail() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(get_request("/api/v1/openapi.json"))
        .await
        .expect("OpenAPI route must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let document = response_json(response).await;

    let summary = &document["components"]["schemas"]["TopicSummary"];
    assert_eq!(summary["properties"]["image_urls"]["maxItems"], 3);
    assert!(
        summary["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("visible_image_count"))
    );
    let detail = &document["components"]["schemas"]["TopicDetail"];
    assert!(detail["allOf"].as_array().unwrap().iter().any(|schema| {
        schema["required"]
            .as_array()
            .is_some_and(|fields| fields.contains(&serde_json::json!("media_urls")))
    }));
    let feed_path = &document["paths"]["/api/v1/feed"]["get"];
    assert!(feed_path.is_object());
    assert_eq!(feed_path["operationId"], "getFeed");
    assert!(document["paths"]["/api/v1/topics"]["get"].is_object());
    assert!(document["paths"]["/api/v1/topics/{topic_id}"]["get"].is_object());
    assert!(document["paths"]["/api/v1/topics"]["post"].is_object());
    let posts_path = &document["paths"]["/api/v1/posts"];
    assert!(posts_path["get"].is_object());
    assert!(posts_path["post"].is_object());
    assert_eq!(posts_path["get"]["operationId"], "listPosts");
    assert_eq!(posts_path["post"]["operationId"], "createPost");
    let post_path = &document["paths"]["/api/v1/posts/{post_id}"];
    assert!(post_path["get"].is_object());
    assert!(post_path["patch"].is_object());
    assert!(post_path["delete"].is_object());
    let comments_path = &document["paths"]["/api/v1/posts/{post_id}/comments"];
    assert!(comments_path["get"].is_object());
    assert!(comments_path["post"].is_object());
    assert!(document["paths"]["/api/v1/admin/moderation/boards"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/moderation/topics"]["get"].is_object());
    let list_parameters = document["paths"]["/api/v1/topics"]["get"]["parameters"]
        .as_array()
        .expect("topic list parameters must be documented");
    for parameter in ["author", "scope"] {
        assert!(
            list_parameters
                .iter()
                .any(|candidate| candidate["name"] == parameter),
            "{parameter}"
        );
    }
    assert!(document["paths"]["/api/v1/topics/{topic_id}/replies"]["get"].is_object());
    assert!(document["paths"]["/api/v1/topics/{topic_id}/replies"]["post"].is_object());
    assert!(document["paths"]["/api/v1/tags"]["get"].is_object());
    assert!(document["paths"]["/api/v1/topics/{topic_id}"]["patch"].is_object());
    assert!(document["paths"]["/api/v1/topics/{topic_id}/governance"]["patch"].is_object());
    assert!(
        document["paths"]["/api/v1/management/boards/{board_id}/users/{user_id}/posting-restriction"]
            ["put"]
            .is_object()
    );
    assert!(document["paths"]["/api/v1/topics/{topic_id}/revisions"]["get"].is_object());
    let admin_revisions =
        &document["paths"]["/api/v1/admin/moderation/topics/{topic_id}/revisions"];
    assert!(admin_revisions["get"]["responses"]["200"]["headers"]["x-request-id"].is_object());
    assert!(admin_revisions["get"]["responses"]["403"].is_object());
    assert!(admin_revisions["post"].is_null());
    assert!(admin_revisions["patch"].is_null());
    assert!(admin_revisions["delete"].is_null());
    let reply_item_path = &document["paths"]["/api/v1/topics/{topic_id}/replies/{reply_id}"];
    assert!(reply_item_path["patch"].is_object());
    assert!(reply_item_path["delete"].is_object());
    assert!(
        document["paths"]["/api/v1/topics/{topic_id}/replies/{reply_id}/revisions"]["get"]
            .is_object()
    );
    for schema in [
        "FeedMode",
        "TopicAuthorSummary",
        "TopicBoardSummary",
        "TopicDetail",
        "TopicScope",
        "TopicSort",
        "TopicSummary",
        "CreateTopicRequest",
        "CreateReplyRequest",
        "ReplyReference",
        "TopicReply",
        "TopicTag",
        "TopicTagInput",
        "UpdateTopicRequest",
        "TopicRevision",
        "UpdateReplyRequest",
        "ReplyRevision",
        "BoardPostingRestrictionAction",
        "PutBoardUserRestrictionRequest",
        "BoardUserRestriction",
        "ModerationBoard",
        "ModerationTopic",
        "PageResponse_ModerationTopic",
        "TopicModerationHistoryEntry",
        "PageResponse_TopicModerationHistoryEntry",
    ] {
        assert!(
            document["components"]["schemas"][schema].is_object(),
            "{schema}"
        );
    }
    assert!(
        document["paths"]["/api/v1/admin/moderation/topics/{topic_id}/history"]["get"].is_object()
    );
    for property in ["floor_number", "reply_to", "has_locked_content"] {
        assert!(
            document["components"]["schemas"]["TopicReply"]["properties"][property].is_object(),
            "{property}"
        );
    }
    for property in ["image_url", "image_urls"] {
        assert!(
            document["components"]["schemas"]["TopicSummary"]["properties"][property].is_object(),
            "{property}"
        );
    }
    assert!(
        document["components"]["schemas"]["CreateReplyRequest"]["properties"]["reply_to_id"]
            .is_object()
    );
    let create_topic_required = document["components"]["schemas"]["CreateTopicRequest"]["required"]
        .as_array()
        .expect("CreateTopicRequest required fields must be documented");
    assert!(create_topic_required.iter().any(|field| field == "content"));
    assert!(
        !create_topic_required.iter().any(|field| field == "title"),
        "title must remain optional for unified post creation"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn scoped_moderator_only_discovers_topics_in_assigned_boards(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, _member_csrf) = register_member(&app).await;
    let member_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'member'")
        .fetch_one(&pool)
        .await
        .expect("member fixture must exist");
    let owner_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'owner'")
        .fetch_one(&pool)
        .await
        .expect("owner fixture must exist");
    let assigned_board_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM boards WHERE slug = 'general'")
            .fetch_one(&pool)
            .await
            .expect("default board fixture must exist");
    let other_board_id = fixture_id(701);
    insert_board(&pool, other_board_id, "other", "public").await;
    let moderator_role_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM roles WHERE key = 'board_moderator'")
            .fetch_one(&pool)
            .await
            .expect("board moderator role must be seeded");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id, scope_mode)
         VALUES (gen_random_uuid(), $1, $2, $4, $3, 'exact')",
    )
    .bind(member_id)
    .bind(moderator_role_id)
    .bind(assigned_board_id)
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("scoped moderator assignment must insert");
    insert_topic(
        &pool,
        fixture_id(702),
        assigned_board_id,
        member_id,
        "assigned topic",
        "2026-08-21T10:00:00Z",
        false,
        false,
    )
    .await;
    insert_topic(
        &pool,
        fixture_id(703),
        other_board_id,
        owner_id,
        "unassigned topic",
        "2026-08-21T11:00:00Z",
        false,
        false,
    )
    .await;

    let boards = app
        .clone()
        .oneshot(get_request_with_headers(
            "/api/v1/admin/moderation/boards",
            &member_cookies,
        ))
        .await
        .expect("moderation board list must respond");
    assert_eq!(boards.status(), StatusCode::OK);
    let boards_payload = response_json(boards).await;
    assert_eq!(boards_payload["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        boards_payload["data"][0]["id"],
        assigned_board_id.to_string()
    );
    assert_eq!(
        boards_payload["data"][0]["capability_keys"][0],
        "moderation.topic"
    );

    let topics = app
        .clone()
        .oneshot(get_request_with_headers(
            "/api/v1/admin/moderation/topics?limit=20",
            &member_cookies,
        ))
        .await
        .expect("moderation topic list must respond");
    assert_eq!(topics.status(), StatusCode::OK);
    let request_id = topics.headers()["x-request-id"]
        .to_str()
        .expect("request ID must be text")
        .to_owned();
    let topics_payload = response_json(topics).await;
    assert_eq!(topics_payload["meta"]["request_id"], request_id);
    assert_eq!(topics_payload["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(topics_payload["data"][0]["title"], "assigned topic");
    assert_eq!(
        topics_payload["data"][0]["board"]["id"],
        assigned_board_id.to_string()
    );

    let invalid_cursor = app
        .oneshot(get_request_with_headers(
            &format!("/api/v1/admin/moderation/topics?cursor={}", fixture_id(703)),
            &member_cookies,
        ))
        .await
        .expect("out-of-scope moderation cursor must respond");
    assert_eq!(invalid_cursor.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(invalid_cursor).await["error"]["code"],
        "request.validation_failed"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_governance_endpoint_enforces_revision_and_lock_state(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "治理主题", "content": "主题正文"}),
            &member_cookies,
            &member_csrf,
            "governance-topic",
        ))
        .await
        .expect("topic creation must respond");
    assert_eq!(topic.status(), StatusCode::CREATED);
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("topic id must be text")
        .to_owned();
    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let governance_path = format!("/api/v1/topics/{topic_id}/governance");

    let pinned = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &governance_path,
            serde_json::json!({"action": "pin", "expected_revision": 1}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("pin request must respond");
    assert_eq!(pinned.status(), StatusCode::OK);
    let pinned = response_json(pinned).await;
    assert_eq!(pinned["data"]["is_pinned"], true);
    assert_eq!(pinned["data"]["governance_revision"], 2);

    let stale = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &governance_path,
            serde_json::json!({"action": "feature", "expected_revision": 1}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("stale governance request must respond");
    assert_eq!(stale.status(), StatusCode::CONFLICT);

    let locked = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &governance_path,
            serde_json::json!({"action": "lock", "expected_revision": 2}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("lock request must respond");
    assert_eq!(locked.status(), StatusCode::OK);
    assert_eq!(response_json(locked).await["data"]["is_locked"], true);

    let reply = app
        .oneshot(json_request_with_headers_and_idempotency(
            &format!("/api/v1/topics/{topic_id}/replies"),
            serde_json::json!({"content": "不能发送"}),
            &member_cookies,
            &member_csrf,
            "locked-reply",
        ))
        .await
        .expect("locked reply request must respond");
    assert_eq!(reply.status(), StatusCode::CONFLICT);
    assert_eq!(response_json(reply).await["error"]["code"], "topic.locked");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_moderation_history_unifies_actions_and_requires_audit_read(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let created = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "处理记录主题", "content": "主题正文"}),
            &member_cookies,
            &member_csrf,
            "moderation-history-topic",
        ))
        .await
        .expect("topic creation must respond");
    let topic_id = response_json(created).await["data"]["id"]
        .as_str()
        .expect("topic id must be text")
        .to_owned();
    let (owner_cookies, owner_csrf) = login_owner(&app).await;

    let governed = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/topics/{topic_id}/governance"),
            serde_json::json!({
                "action": "pin",
                "expected_revision": 1,
                "reason": "重要公告"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("governance request must respond");
    assert_eq!(governed.status(), StatusCode::OK);

    let moderated = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/topics/{topic_id}/moderation"),
            serde_json::json!({"status": "hidden", "reason": "内容待复核"}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("moderation request must respond");
    assert_eq!(moderated.status(), StatusCode::OK);

    let history_path = format!("/api/v1/admin/moderation/topics/{topic_id}/history?limit=1");
    let anonymous = app
        .clone()
        .oneshot(get_request(&history_path))
        .await
        .expect("anonymous history request must respond");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let forbidden = app
        .clone()
        .oneshot(get_request_with_headers(&history_path, &member_cookies))
        .await
        .expect("member history request must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let first = app
        .clone()
        .oneshot(get_request_with_headers(&history_path, &owner_cookies))
        .await
        .expect("first history page must respond");
    assert_eq!(first.status(), StatusCode::OK);
    let payload = response_json(first).await;
    assert_eq!(payload["data"][0]["source"], "moderation");
    assert_eq!(payload["data"][0]["action"], "hidden");
    assert_eq!(payload["data"][0]["reason"], "内容待复核");
    assert_eq!(payload["data"][0]["actor"]["username"], "owner");
    let cursor = payload["meta"]["next_cursor"]
        .as_str()
        .expect("first page must have a cursor");

    let second = app
        .clone()
        .oneshot(get_request_with_headers(
            &format!("{history_path}&cursor={cursor}"),
            &owner_cookies,
        ))
        .await
        .expect("second history page must respond");
    assert_eq!(second.status(), StatusCode::OK);
    let payload = response_json(second).await;
    assert_eq!(payload["data"][0]["source"], "governance");
    assert_eq!(payload["data"][0]["action"], "pin");
    assert_eq!(payload["data"][0]["reason"], "重要公告");
    assert!(payload["meta"]["next_cursor"].is_null());

    let invalid_cursor = app
        .clone()
        .oneshot(get_request_with_headers(
            &format!("{history_path}&cursor={}", fixture_id(999)),
            &owner_cookies,
        ))
        .await
        .expect("invalid history cursor must respond");
    assert_eq!(invalid_cursor.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let missing = app
        .oneshot(get_request_with_headers(
            &format!(
                "/api/v1/admin/moderation/topics/{}/history",
                fixture_id(998)
            ),
            &owner_cookies,
        ))
        .await
        .expect("missing topic history request must respond");
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn scoped_board_restriction_api_blocks_member_topic_creation(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let member_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'member'")
        .fetch_one(&pool)
        .await
        .expect("member id must load");
    let board_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM boards WHERE visibility = 'public' ORDER BY position, id LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .expect("default board id must load");
    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let restriction = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PUT,
            &format!("/api/v1/management/boards/{board_id}/users/{member_id}/posting-restriction"),
            serde_json::json!({
                "actions": ["topic_create"],
                "starts_at": "2020-01-01T00:00:00Z",
                "ends_at": "2099-01-01T00:00:00Z",
                "reason": "temporary moderation action"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("restriction request must respond");
    assert_eq!(restriction.status(), StatusCode::OK);
    assert_eq!(response_json(restriction).await["data"]["revision"], 1);

    let blocked = app
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "应被阻止", "content": "主题正文"}),
            &member_cookies,
            &member_csrf,
            "restricted-topic",
        ))
        .await
        .expect("restricted topic request must respond");
    assert_eq!(blocked.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(blocked).await["error"]["code"],
        "board.posting_restricted"
    );
}

fn get_request(uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("request must be valid")
}

fn get_request_with_headers(uri: &str, cookies: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("cookie", cookies)
        .body(Body::empty())
        .expect("authenticated GET request must be valid")
}

fn json_request(uri: &str, value: serde_json::Value) -> Request<Body> {
    json_request_with_headers(Method::POST, uri, value, "", None)
}

fn json_request_with_headers(
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

fn json_request_with_headers_and_idempotency(
    uri: &str,
    value: serde_json::Value,
    cookies: &str,
    csrf: &str,
    key: &str,
) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header("content-type", "application/json")
        .header("cookie", cookies)
        .header("x-csrf-token", csrf)
        .header("idempotency-key", key)
        .body(Body::from(value.to_string()))
        .expect("idempotent JSON request must be valid")
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

async fn register_member(app: &axum::Router) -> (String, String) {
    let initialize = app
        .clone()
        .oneshot(json_request(
            "/api/v1/installation",
            serde_json::json!({
                "username": "owner",
                "email": "owner@example.com",
                "display_name": "管理员",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("installation request must respond");
    assert_eq!(initialize.status(), StatusCode::CREATED);

    let registration = app
        .clone()
        .oneshot(json_request(
            "/api/v1/auth/register",
            serde_json::json!({
                "username": "member",
                "email": "member@example.com",
                "display_name": "社区成员",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("registration request must respond");
    assert_eq!(registration.status(), StatusCode::CREATED);
    session_cookies(&registration)
}

async fn register_additional_member(
    app: &axum::Router,
    username: &str,
    email: &str,
    display_name: &str,
) -> (String, String) {
    let registration = app
        .clone()
        .oneshot(json_request(
            "/api/v1/auth/register",
            serde_json::json!({
                "username": username,
                "email": email,
                "display_name": display_name,
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("additional registration request must respond");
    assert_eq!(registration.status(), StatusCode::CREATED);
    session_cookies(&registration)
}

async fn login_owner(app: &axum::Router) -> (String, String) {
    let login = app
        .clone()
        .oneshot(json_request(
            "/api/v1/auth/login",
            serde_json::json!({
                "identifier": "owner",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("owner login request must respond");
    assert_eq!(login.status(), StatusCode::OK);
    session_cookies(&login)
}

fn session_cookies(response: &axum::response::Response) -> (String, String) {
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
    let csrf_token = csrf_cookie
        .split_once('=')
        .expect("CSRF cookie must contain a value")
        .1
        .to_owned();
    (format!("{session_cookie}; {csrf_cookie}"), csrf_token)
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
    Uuid::from_u128(0x019f_c800_0000_7000_8000_0000_0000_0000 + value)
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

#[allow(clippy::too_many_arguments)]
async fn insert_topic(
    pool: &PgPool,
    id: Uuid,
    board_id: Uuid,
    author_id: Uuid,
    title: &str,
    published_at: &str,
    pinned: bool,
    featured: bool,
) {
    sqlx::query(
        "INSERT INTO topics (\
             id, board_id, author_id, title, excerpt, content, status, published_at,\
             last_activity_at, pinned_at, featured_at\
         ) VALUES (\
             $1, $2, $3, $4, 'Excerpt for ' || $4, 'Content for ' || $4, 'published',\
             $5::timestamptz, $5::timestamptz,\
             CASE WHEN $6 THEN $5::timestamptz END,\
             CASE WHEN $7 THEN $5::timestamptz END\
         )",
    )
    .bind(id)
    .bind(board_id)
    .bind(author_id)
    .bind(title)
    .bind(published_at)
    .bind(pinned)
    .bind(featured)
    .execute(pool)
    .await
    .expect("topic fixture must insert");
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status, created_at) \
         VALUES ($1, $1, $2, 'topic', 'Content for ' || $3, 'published', $4::timestamptz)",
    )
    .bind(id)
    .bind(author_id)
    .bind(title)
    .bind(published_at)
    .execute(pool)
    .await
    .expect("topic post fixture must insert");
    sqlx::query(
        "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content, created_at) \
         VALUES (gen_random_uuid(), $1, $2, 1, 'Content for ' || $3, $4::timestamptz)",
    )
    .bind(id)
    .bind(author_id)
    .bind(title)
    .bind(published_at)
    .execute(pool)
    .await
    .expect("topic revision fixture must insert");
}
