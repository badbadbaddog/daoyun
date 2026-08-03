use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::time::Duration;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn live_health_returns_a_correlated_success_envelope() {
    assert_health_response(test_app(), "/api/v1/health/live", "live").await;
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn ready_health_returns_a_correlated_success_envelope(pool: PgPool) {
    assert_health_response(
        daoyun_api::app(Database::from_pool(pool)),
        "/api/v1/health/ready",
        "ready",
    )
    .await;
}

#[sqlx::test(migrations = false)]
async fn ready_health_rejects_a_database_with_missing_migrations(pool: PgPool) {
    assert_error_response(
        daoyun_api::app(Database::from_pool(pool)),
        Method::GET,
        "/api/v1/health/ready",
        StatusCode::SERVICE_UNAVAILABLE,
        "system.not_ready",
        None,
    )
    .await;
}

#[tokio::test]
async fn ready_health_hides_database_connection_errors() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health/ready")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("error body must be readable");
    let payload: Value = serde_json::from_slice(&body).expect("error body must be JSON");

    assert_eq!(payload["error"]["code"], "system.not_ready");
    assert_eq!(payload["error"]["message"], "Service is not ready");
    assert!(!body.windows(4).any(|window| window == b"sqlx"));
    assert!(!body.windows(10).any(|window| window == b"connection"));
}

#[tokio::test]
async fn openapi_document_contains_both_health_operations() {
    let response = test_app()
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
    assert!(document["paths"]["/api/v1/health/ready"]["get"]["responses"]["503"].is_object());

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
        test_app(),
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
        test_app(),
        Method::POST,
        "/api/v1/health/live",
        StatusCode::METHOD_NOT_ALLOWED,
        "system.method_not_allowed",
        Some("GET,HEAD"),
    )
    .await;
}

async fn assert_health_response(app: Router, path: &str, expected_status: &str) {
    let response = app
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
    app: Router,
    method: Method,
    path: &str,
    expected_status: StatusCode,
    expected_code: &str,
    expected_allow: Option<&str>,
) {
    let response = app
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

fn test_app() -> Router {
    let pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(100))
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .expect("the unavailable database URL must be valid");
    daoyun_api::app(Database::from_pool(pool))
}
