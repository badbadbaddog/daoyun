use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[tokio::test]
async fn edit_review_openapi_registers_independent_policy_and_queue_operations() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .unwrap();
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let document: Value = serde_json::from_slice(
        &to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    for field in ["proposed_excerpt", "proposed_tags", "proposed_rich_content"] {
        assert!(
            document["components"]["schemas"]["EditReviewItem"]["properties"][field].is_object(),
            "missing {field}"
        );
    }
    let parameters = document["paths"]["/api/v1/admin/edit-reviews"]["get"]["parameters"]
        .as_array()
        .unwrap();
    for name in ["board_id", "status", "target_type", "cursor", "limit"] {
        assert!(
            parameters.iter().any(|parameter| parameter["name"] == name),
            "missing {name}"
        );
    }
    for (path, method) in [
        ("/api/v1/admin/edit-review/policies", "get"),
        ("/api/v1/admin/edit-review/policies", "put"),
        ("/api/v1/admin/edit-reviews", "get"),
        ("/api/v1/admin/edit-reviews/{review_id}", "get"),
        ("/api/v1/admin/edit-reviews/{review_id}", "patch"),
    ] {
        assert!(
            document["paths"][path][method].is_object(),
            "missing {method} {path}"
        );
    }
}
