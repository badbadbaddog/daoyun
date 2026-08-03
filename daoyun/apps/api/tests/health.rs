use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
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

    for schema in ["ErrorResponse", "PageMeta", "RequestId"] {
        assert!(document["components"]["schemas"][schema].is_object());
    }
    assert_eq!(
        document["components"]["schemas"]["RequestId"]["format"],
        "uuid"
    );
    assert!(document["components"]["schemas"]["PageMeta"]["properties"]["next_cursor"].is_object());
}

#[tokio::test]
async fn unknown_route_returns_a_correlated_error_envelope() {
    assert_error_response(
        Method::GET,
        "/api/v1/unknown",
        StatusCode::NOT_FOUND,
        "system.route_not_found",
        None,
    )
    .await;
}

#[tokio::test]
async fn unsupported_method_returns_a_correlated_error_envelope() {
    assert_error_response(
        Method::POST,
        "/api/v1/health/live",
        StatusCode::METHOD_NOT_ALLOWED,
        "system.method_not_allowed",
        Some("GET,HEAD"),
    )
    .await;
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
    let parsed_request_id = Uuid::parse_str(&request_id).expect("request id must be a UUID");
    assert_eq!(parsed_request_id.get_version_num(), 7);

    let body = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("health body must be readable");
    let payload: Value = serde_json::from_slice(&body).expect("health body must be JSON");

    assert_eq!(payload["data"]["status"], expected_status);
    assert_eq!(payload["data"]["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(payload["meta"]["request_id"], request_id);
}

async fn assert_error_response(
    method: Method,
    path: &str,
    expected_status: StatusCode,
    expected_code: &str,
    expected_allow: Option<&str>,
) {
    let response = daoyun_api::app()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), expected_status);
    assert_eq!(response.headers()["content-type"], "application/json");
    if let Some(expected_allow) = expected_allow {
        assert_eq!(response.headers()["allow"], expected_allow);
    }

    let request_id = response.headers()["x-request-id"]
        .to_str()
        .expect("x-request-id header must be text")
        .to_owned();
    let parsed_request_id = Uuid::parse_str(&request_id).expect("request id must be a UUID");
    assert_eq!(parsed_request_id.get_version_num(), 7);

    let body = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("error body must be readable");
    let payload: Value = serde_json::from_slice(&body).expect("error body must be JSON");

    assert_eq!(payload["error"]["code"], expected_code);
    assert!(payload["error"]["message"].is_string());
    assert_eq!(payload["meta"]["request_id"], request_id);
}
