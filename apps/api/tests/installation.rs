use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::PgPool;
use std::time::Duration;
use tower::ServiceExt;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_status_returns_a_correlated_success_envelope(pool: PgPool) {
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(
            Request::builder()
                .uri("/api/v1/installation")
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

    assert_eq!(payload["data"]["is_initialized"], false);
    assert_eq!(payload["meta"]["request_id"], request_id);
}

#[tokio::test]
async fn installation_status_hides_database_errors() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(
            Request::builder()
                .uri("/api/v1/installation")
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
    assert_eq!(payload["error"]["message"], "安装状态暂时无法读取");
    assert_eq!(payload["meta"]["request_id"], request_id);
    assert!(!payload.to_string().contains("sqlx"));
    assert!(!payload.to_string().contains("connection"));
}

#[tokio::test]
async fn openapi_documents_the_installation_status() {
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
    let operation = &document["paths"]["/api/v1/installation"]["get"];

    assert!(operation.is_object());
    for status in ["200", "503"] {
        assert!(operation["responses"][status]["headers"]["x-request-id"].is_object());
    }
    assert!(document["components"]["schemas"]["InstallationStatus"].is_object());
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
