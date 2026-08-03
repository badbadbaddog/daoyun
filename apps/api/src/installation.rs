use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, InstallationStatus, RequestId, error_codes,
};
use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::get};
use infrastructure::Database;

pub(crate) fn router() -> Router<Database> {
    // Source: https://docs.rs/axum/0.8.9/axum/struct.Router.html#method.route
    Router::new().route("/api/v1/installation", get(status))
}

// Source: https://docs.rs/utoipa/5.5.0/utoipa/attr.path.html
#[utoipa::path(
    get,
    path = "/api/v1/installation",
    operation_id = "getInstallationStatus",
    tag = "installation",
    responses(
        (
            status = 200,
            description = "Whether this DaoYun instance has completed initial setup",
            body = ApiResponse<InstallationStatus>,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (
            status = 503,
            description = "The installation state is temporarily unavailable",
            body = ErrorResponse,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        )
    )
)]
pub(crate) async fn status(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<ApiResponse<InstallationStatus>>, (StatusCode, Json<ErrorResponse>)> {
    let is_initialized = database.installation_status().await.map_err(|error| {
        tracing::warn!(
            request_id = %request_id,
            error = ?error,
            "Installation status query failed"
        );
        service_unavailable(request_id)
    })?;

    Ok(Json(ApiResponse::new(
        InstallationStatus { is_initialized },
        request_id,
    )))
}

fn service_unavailable(request_id: RequestId) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
                "安装状态暂时无法读取",
            ),
            request_id,
        )),
    )
}
