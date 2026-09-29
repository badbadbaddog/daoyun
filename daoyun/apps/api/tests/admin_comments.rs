use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[tokio::test]
async fn admin_comment_contract_and_authentication_are_registered() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .unwrap();
    let app = daoyun_api::app(Database::from_pool(pool));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let doc: Value = serde_json::from_slice(
        &to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    for (path, method) in [
        ("/api/v1/admin/comments", "get"),
        ("/api/v1/admin/comments/{comment_id}", "get"),
        ("/api/v1/admin/comments/{comment_id}", "patch"),
    ] {
        let op = &doc["paths"][path][method];
        assert!(op.is_object(), "missing {method} {path}");
        for value in op["responses"].as_object().unwrap().values() {
            assert!(value["headers"]["x-request-id"].is_object());
        }
    }
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/admin/comments?board_id=019fc900-0000-7000-8000-000000000001")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(body["meta"]["request_id"], id);
}
