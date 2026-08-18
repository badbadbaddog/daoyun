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

    let first = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "首个主题", "content": "这是正文"}),
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

    let replay = app
        .clone()
        .oneshot(json_request_with_headers_and_idempotency(
            "/api/v1/topics",
            serde_json::json!({"title": "首个主题", "content": "这是正文"}),
            &cookie_header,
            &csrf_token,
            key,
        ))
        .await
        .expect("replayed topic request must respond");
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(response_json(replay).await["data"]["id"], topic_id);

    let conflict = app
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
    assert!(invalid_payload["error"]["fields"]["title"].is_array());
    assert!(invalid_payload["error"]["fields"]["content"].is_array());

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
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT reply_count FROM topics WHERE id = $1")
            .bind(Uuid::parse_str(&topic_id).expect("topic id must be a UUID"))
            .fetch_one(&pool)
            .await
            .expect("topic reply count must be readable"),
        1
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
    assert_eq!(edited_payload["data"]["content"], "更新后的正文");
    assert_eq!(edited_payload["data"]["content_revision"], 2);
    assert_eq!(edited_payload["data"]["tags"][0]["slug"], "sqlx");

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
    assert_eq!(edited_payload["data"]["content"], "更新后的回复");
    assert_eq!(edited_payload["data"]["revision_count"], 2);

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
    assert_eq!(response_json(detail).await["data"]["reply_count"], 0);

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

    assert!(document["paths"]["/api/v1/topics"]["get"].is_object());
    assert!(document["paths"]["/api/v1/topics/{topic_id}"]["get"].is_object());
    assert!(document["paths"]["/api/v1/topics"]["post"].is_object());
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
    let reply_item_path = &document["paths"]["/api/v1/topics/{topic_id}/replies/{reply_id}"];
    assert!(reply_item_path["patch"].is_object());
    assert!(reply_item_path["delete"].is_object());
    assert!(
        document["paths"]["/api/v1/topics/{topic_id}/replies/{reply_id}/revisions"]["get"]
            .is_object()
    );
    for schema in [
        "TopicAuthorSummary",
        "TopicBoardSummary",
        "TopicDetail",
        "TopicScope",
        "TopicSort",
        "TopicSummary",
        "CreateTopicRequest",
        "CreateReplyRequest",
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
    ] {
        assert!(
            document["components"]["schemas"][schema].is_object(),
            "{schema}"
        );
    }
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
