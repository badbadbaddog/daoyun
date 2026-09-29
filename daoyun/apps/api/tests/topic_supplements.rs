use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[tokio::test]
async fn supplement_openapi_registers_operations_and_correlated_errors() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .unwrap();
    let app = daoyun_api::app(Database::from_pool(pool));
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("x-request-id"));
    let document: Value = serde_json::from_slice(
        &to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    for (path, method) in [
        ("/api/v1/topics/{topic_id}/supplements", "get"),
        ("/api/v1/topics/{topic_id}/supplements", "post"),
        ("/api/v1/admin/topic-supplements/settings", "get"),
        ("/api/v1/admin/topic-supplements/settings", "put"),
    ] {
        let operation = &document["paths"][path][method];
        assert!(operation.is_object(), "missing {method} {path}");
        for response in operation["responses"].as_object().unwrap().values() {
            assert!(response["headers"]["x-request-id"].is_object());
        }
    }
    for path in [
        "/api/v1/topics/{topic_id}/supplements/{supplement_id}/moderation",
        "/api/v1/admin/moderation/boards/{board_id}/supplements",
        "/api/v1/admin/boards/{board_id}/supplement-policy",
    ] {
        assert!(
            document["paths"].get(path).is_none(),
            "obsolete review route {path}"
        );
    }
    let schema = &document["components"]["schemas"];
    assert!(schema["TopicSupplement"]["properties"]["revision"].is_object());
    assert!(
        schema["TopicSupplementListMeta"]["properties"]["can_submit"].is_object()
            || schema["TopicSupplementListMeta"]["allOf"].is_array()
    );
    let meta = schema["TopicSupplementListMeta"].to_string();
    assert!(!meta.contains("can_moderate"));
    assert!(!meta.contains("requires_review"));
}
