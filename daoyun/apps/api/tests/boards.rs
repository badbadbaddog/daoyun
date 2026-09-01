use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::{PgPool, types::Uuid};
use std::time::Duration;
use tower::ServiceExt;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_board_list_is_correlated_filtered_and_cursor_paginated(pool: PgPool) {
    insert_board(
        &pool,
        "019fc610-0000-7000-8000-000000000001",
        "first",
        10,
        "public",
    )
    .await;
    insert_board(
        &pool,
        "019fc610-0000-7000-8000-000000000002",
        "hidden",
        15,
        "hidden",
    )
    .await;
    insert_board(
        &pool,
        "019fc610-0000-7000-8000-000000000003",
        "second",
        20,
        "public",
    )
    .await;

    let app = daoyun_api::app(Database::from_pool(pool));
    let first_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/boards?limit=1")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(first_response.status(), StatusCode::OK);
    let first_request_id = first_response.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let first_payload = response_json(first_response).await;
    assert_eq!(first_payload["meta"]["request_id"], first_request_id);
    assert_eq!(
        first_payload["data"]
            .as_array()
            .expect("data must be an array")
            .len(),
        1
    );
    assert_eq!(first_payload["data"][0]["slug"], "first");
    assert_eq!(first_payload["data"][0]["topic_count"], 0);
    assert!(first_payload["data"][0]["parent_id"].is_null());
    assert_eq!(first_payload["data"][0]["position"], 10);
    assert_eq!(first_payload["data"][0]["depth"], 0);
    assert_eq!(first_payload["data"][0]["child_count"], 0);

    let cursor = first_payload["meta"]["next_cursor"]
        .as_str()
        .expect("another page must have a cursor");
    let second_response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/boards?limit=1&cursor={cursor}"))
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(second_response.status(), StatusCode::OK);
    let second_payload = response_json(second_response).await;
    assert_eq!(second_payload["data"][0]["slug"], "second");
    assert!(second_payload["meta"]["next_cursor"].is_null());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_board_detail_returns_hierarchy_children_breadcrumb_and_viewer_permissions(
    pool: PgPool,
) {
    insert_board(
        &pool,
        "019fc610-0000-7000-8000-000000000010",
        "parent",
        10,
        "public",
    )
    .await;
    insert_board(
        &pool,
        "019fc610-0000-7000-8000-000000000011",
        "current",
        20,
        "public",
    )
    .await;
    insert_board(
        &pool,
        "019fc610-0000-7000-8000-000000000012",
        "child",
        30,
        "public",
    )
    .await;
    sqlx::query("UPDATE boards SET parent_id = $1 WHERE id IN ($2, $3)")
        .bind(Uuid::parse_str("019fc610-0000-7000-8000-000000000010").unwrap())
        .bind(Uuid::parse_str("019fc610-0000-7000-8000-000000000011").unwrap())
        .bind(Uuid::parse_str("019fc610-0000-7000-8000-000000000012").unwrap())
        .execute(&pool)
        .await
        .expect("board hierarchy must update");
    sqlx::query("UPDATE boards SET parent_id = $1 WHERE id = $2")
        .bind(Uuid::parse_str("019fc610-0000-7000-8000-000000000011").unwrap())
        .bind(Uuid::parse_str("019fc610-0000-7000-8000-000000000012").unwrap())
        .execute(&pool)
        .await
        .expect("child board hierarchy must update");

    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(
            Request::builder()
                .uri("/api/v1/boards/current")
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
    assert_eq!(payload["data"]["slug"], "current");
    assert_eq!(
        payload["data"]["parent_id"],
        "019fc610-0000-7000-8000-000000000010"
    );
    assert_eq!(payload["data"]["children"][0]["slug"], "child");
    assert_eq!(payload["data"]["breadcrumb"][0]["slug"], "parent");
    assert_eq!(payload["data"]["breadcrumb"][1]["slug"], "current");
    assert_eq!(payload["data"]["viewer"]["can_read"], true);
    assert_eq!(payload["data"]["viewer"]["can_create_topic"], false);
    assert_eq!(payload["data"]["viewer"]["can_reply"], false);
    assert_eq!(payload["data"]["viewer"]["can_upload_attachment"], false);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_board_detail_distinguishes_forbidden_and_missing_boards(pool: PgPool) {
    let board_id = Uuid::parse_str("019fc610-0000-7000-8000-000000000020").unwrap();
    insert_board(&pool, &board_id.to_string(), "members-only", 10, "public").await;
    let policy_id = Uuid::parse_str("019fc610-0000-7000-8000-000000000021").unwrap();
    sqlx::query(
        "INSERT INTO content_access_policies (id, target_type, target_id, operator) \
         VALUES ($1, 'board', $2, 'any_of')",
    )
    .bind(policy_id)
    .bind(board_id)
    .execute(&pool)
    .await
    .expect("access policy must insert");
    sqlx::query(
        "INSERT INTO content_access_policy_subjects (policy_id, subject_type) \
         VALUES ($1, 'authenticated')",
    )
    .bind(policy_id)
    .execute(&pool)
    .await
    .expect("access policy subject must insert");

    let app = daoyun_api::app(Database::from_pool(pool));
    let forbidden = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/boards/members-only")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("forbidden board request must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(forbidden).await["error"]["code"],
        "board.forbidden"
    );

    let missing = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/boards/not-found")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("missing board request must respond");
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(missing).await["error"]["code"],
        "board.not_found"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_board_list_rejects_invalid_pagination(pool: PgPool) {
    let app = daoyun_api::app(Database::from_pool(pool));

    for path in [
        "/api/v1/boards?limit=0",
        "/api/v1/boards?limit=51",
        "/api/v1/boards?cursor=not-a-uuid",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .body(Body::empty())
                    .expect("request must be valid"),
            )
            .await
            .expect("router must respond");

        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .expect("request id must be text")
            .to_owned();
        let payload = response_json(response).await;
        assert_eq!(payload["error"]["code"], "request.validation_failed");
        assert_eq!(payload["meta"]["request_id"], request_id);
    }
}

#[tokio::test]
async fn public_board_list_hides_database_errors() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(
            Request::builder()
                .uri("/api/v1/boards")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let payload = response_json(response).await;
    assert_eq!(payload["error"]["code"], "system.database_unavailable");
    assert_eq!(payload["error"]["message"], "板块暂时无法加载");
    assert!(!payload.to_string().contains("sqlx"));
    assert!(!payload.to_string().contains("connection"));
    assert_eq!(payload["meta"]["request_id"], request_id);
}

#[tokio::test]
async fn openapi_documents_the_public_board_list() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::OK);
    let document = response_json(response).await;
    let operation = &document["paths"]["/api/v1/boards"]["get"];
    assert!(operation.is_object());
    for status in ["200", "422", "503"] {
        assert!(operation["responses"][status]["headers"]["x-request-id"].is_object());
    }
    assert!(document["components"]["schemas"]["BoardSummary"].is_object());
    assert!(document["components"]["schemas"]["BoardTone"].is_object());
    let detail = &document["paths"]["/api/v1/boards/{slug}"]["get"];
    assert!(detail.is_object());
    for status in ["200", "403", "404", "422", "503"] {
        assert!(detail["responses"][status]["headers"]["x-request-id"].is_object());
    }
    assert!(document["components"]["schemas"]["BoardDetail"].is_object());
}

async fn insert_board(pool: &PgPool, id: &str, slug: &str, position: i32, visibility: &str) {
    sqlx::query(
        "INSERT INTO boards (id, slug, name, description, icon, tone, position, visibility) \
         VALUES ($1, $2, $2, '', 'messages', 'green', $3, $4)",
    )
    .bind(Uuid::parse_str(id).expect("fixture UUID must be valid"))
    .bind(slug)
    .bind(position)
    .bind(visibility)
    .execute(pool)
    .await
    .expect("board fixture must insert");
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
