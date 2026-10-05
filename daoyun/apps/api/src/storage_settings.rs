use crate::{
    admin::authorize_capability_read,
    auth::{ApiError, AuthRuntime},
};
use api_contract::{
    ApiResponse, AttachmentStorageConfiguration, AttachmentStorageProvider, ErrorResponse,
    RequestId,
};
use axum::{Extension, Json, Router, extract::State, http::HeaderMap, routing::get};
use infrastructure::{Database, permission_keys};

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/admin/attachments/storage", get(configuration))
        .layer(Extension(runtime))
}

#[utoipa::path(get, path = "/api/v1/admin/attachments/storage", operation_id = "getAttachmentStorageConfiguration", tag = "admin",
 responses((status = 200, body = ApiResponse<AttachmentStorageConfiguration>, headers(("x-request-id" = String))),
 (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
 (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
 (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))))]
pub(crate) async fn configuration(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<AttachmentStorageConfiguration>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ADMIN_CONFIGURATION_READ,
    )
    .await?;
    let record = database.attachment_storage_configuration();
    let provider = |value: &str| {
        if value == "s3" {
            AttachmentStorageProvider::S3
        } else {
            AttachmentStorageProvider::Local
        }
    };
    Ok(Json(ApiResponse::new(
        AttachmentStorageConfiguration {
            write_provider: provider(record.write_provider),
            legacy_provider: provider(record.legacy_provider),
            local_configured: record.local_configured,
            s3_configured: record.s3_configured,
            s3_supported: record.s3_supported,
        },
        request_id,
    )))
}
