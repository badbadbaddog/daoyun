use api_contract::{ApiResponse, HealthData, HealthStatus};
use axum::{Extension, Json, Router, routing::get};

use crate::RequestId;

pub(crate) fn router() -> Router {
    Router::new()
        .route("/api/v1/health/live", get(live))
        .route("/api/v1/health/ready", get(ready))
}

#[utoipa::path(
    get,
    path = "/api/v1/health/live",
    operation_id = "getHealthLive",
    tag = "health",
    responses(
        (
            status = 200,
            description = "The API process is alive",
            body = ApiResponse<HealthData>,
            headers(
                ("x-request-id" = String, description = "Request correlation identifier")
            )
        )
    )
)]
pub(crate) async fn live(
    Extension(request_id): Extension<RequestId>,
) -> Json<ApiResponse<HealthData>> {
    Json(ApiResponse::new(
        HealthData::new(HealthStatus::Live, env!("CARGO_PKG_VERSION")),
        request_id.0,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/health/ready",
    operation_id = "getHealthReady",
    tag = "health",
    responses(
        (
            status = 200,
            description = "The API is ready to accept traffic",
            body = ApiResponse<HealthData>,
            headers(
                ("x-request-id" = String, description = "Request correlation identifier")
            )
        )
    )
)]
pub(crate) async fn ready(
    Extension(request_id): Extension<RequestId>,
) -> Json<ApiResponse<HealthData>> {
    Json(ApiResponse::new(
        HealthData::new(HealthStatus::Ready, env!("CARGO_PKG_VERSION")),
        request_id.0,
    ))
}
