use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn live_health_returns_a_correlated_success_envelope() {
    assert_health_response("/api/v1/health/live", "live").await;
}

#[tokio::test]
async fn ready_health_returns_a_correlated_success_envelope() {
    assert_health_response("/api/v1/health/ready", "ready").await;
}

#[tokio::test]
async fn openapi_document_contains_both_health_operations() {
    let response = daoyun_api::app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("OpenAPI body must be readable");
    let document: Value = serde_json::from_slice(&body).expect("OpenAPI body must be JSON");

    for path in ["/api/v1/health/live", "/api/v1/health/ready"] {
        let operation = &document["paths"][path]["get"];
        assert!(operation.is_object());
        assert!(operation["responses"]["200"]["headers"]["x-request-id"].is_object());
    }
}

async fn assert_health_response(path: &str, expected_status: &str) {
    let response = daoyun_api::app()
        .oneshot(
            Request::builder()
                .uri(path)
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::OK);

    let request_id = response
        .headers()
        .get("x-request-id")
        .expect("x-request-id header must exist")
        .to_str()
        .expect("x-request-id header must be text")
        .to_owned();
    Uuid::parse_str(&request_id).expect("request id must be a UUID");

    let body = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("health body must be readable");
    let payload: Value = serde_json::from_slice(&body).expect("health body must be JSON");

    assert_eq!(payload["data"]["status"], expected_status);
    assert_eq!(payload["data"]["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(payload["meta"]["request_id"], request_id);
}
