use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, HealthData, HealthStatus, RequestId,
    error_codes,
};
use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::get};
use infrastructure::Database;

pub(crate) fn router() -> Router<Database> {
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
        request_id,
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
        ),
        (
            status = 503,
            description = "A required dependency is unavailable or not migrated",
            body = ErrorResponse,
            headers(
                ("x-request-id" = String, description = "Request correlation identifier")
            )
        )
    )
)]
pub(crate) async fn ready(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<ApiResponse<HealthData>>, (StatusCode, Json<ErrorResponse>)> {
    match database.check_readiness().await {
        Ok(()) => Ok(Json(ApiResponse::new(
            HealthData::new(HealthStatus::Ready, env!("CARGO_PKG_VERSION")),
            request_id,
        ))),
        Err(error) => {
            tracing::warn!(
                request_id = %request_id,
                error = ?error,
                "DaoYun readiness check failed"
            );
            Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse::new(
                    ErrorBody::new(
                        ErrorCode::from_static(error_codes::NOT_READY),
                        "Service is not ready",
                    ),
                    request_id,
                )),
            ))
        }
    }
}
