use crate::auth::{
    ApiError, AuthRuntime, authenticate_optional_session, authenticate_state_change,
};
use api_contract::{
    ApiResponse, AttachmentScanStatus, AttachmentStatus, ErrorBody, ErrorCode, ErrorResponse,
    RequestId, TopicAttachment, error_codes,
};
use axum::{
    Extension, Json, Router,
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
    routing::get,
};
use infrastructure::{
    AttachmentError, AttachmentRecord, CreateAttachmentInput, Database, ListAttachmentsError,
    MAX_ATTACHMENT_BYTES,
};
use uuid::Uuid;

const MAX_NAME_BYTES: usize = 255;

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route(
            "/api/v1/topics/{topic_id}/attachments",
            get(list).post(upload),
        )
        .route("/api/v1/attachments/{attachment_id}", get(download))
        .route(
            "/api/v1/attachments/{attachment_id}/thumbnail",
            get(download_thumbnail),
        )
        .layer(DefaultBodyLimit::max(MAX_ATTACHMENT_BYTES + 1))
        .layer(Extension(runtime))
}

#[utoipa::path(
    post,
    path = "/api/v1/topics/{topic_id}/attachments",
    operation_id = "uploadTopicAttachment",
    tag = "topics",
    params(
        ("topic_id" = Uuid, Path, description = "Topic identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token"),
        ("x-file-name" = String, Header, description = "Original file name")
    ),
    responses(
        (status = 201, description = "The stored attachment metadata", body = ApiResponse<TopicAttachment>, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse),
        (status = 403, description = "The CSRF token or upload capability is invalid", body = ErrorResponse),
        (status = 404, description = "The topic is unavailable", body = ErrorResponse),
        (status = 422, description = "The file headers or content are invalid", body = ErrorResponse),
        (status = 503, description = "The attachment service is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn upload(
    State(database): State<Database>,
    Extension(runtime): Extension<AuthRuntime>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Path(topic_id): Path<Uuid>,
    body: Bytes,
) -> Result<(StatusCode, Json<ApiResponse<TopicAttachment>>), ApiError> {
    let file_name = headers
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= MAX_NAME_BYTES)
        .ok_or_else(|| invalid(request_id, "x-file-name", "文件名无效"))?;
    let mime_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(request_id, "content_type", "MIME 类型无效"))?;
    if body.len() > MAX_ATTACHMENT_BYTES {
        return Err(invalid(request_id, "body", "附件不能超过 50 MiB"));
    }
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let record = database
        .create_topic_attachment(CreateAttachmentInput {
            id: Uuid::now_v7(),
            topic_id,
            uploader_id: session.user.id,
            original_name: file_name.to_owned(),
            mime_type: mime_type.to_owned(),
            bytes: body.to_vec(),
        })
        .await
        .map_err(|error| map_upload_error(request_id, error))?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::new(to_contract(record), request_id)),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/topics/{topic_id}/attachments",
    operation_id = "listTopicAttachments",
    tag = "topics",
    params(("topic_id" = Uuid, Path, description = "Topic identifier")),
    responses(
        (status = 200, description = "Public topic attachments", body = ApiResponse<Vec<TopicAttachment>>, headers(("x-request-id" = String))),
        (status = 404, description = "The topic is unavailable", body = ErrorResponse),
        (status = 503, description = "The attachment service is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list(
    State(database): State<Database>,
    Extension(runtime): Extension<AuthRuntime>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Path(topic_id): Path<Uuid>,
) -> Result<(HeaderMap, Json<ApiResponse<Vec<TopicAttachment>>>), ApiError> {
    let (session, response_headers) =
        authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
    let records = database
        .list_topic_attachments(topic_id, session.map(|session| session.user.id))
        .await
        .map_err(|error| match error {
            ListAttachmentsError::TopicUnavailable => not_found(request_id),
            ListAttachmentsError::Forbidden => forbidden(request_id),
            ListAttachmentsError::QuotaExceeded => quota_exceeded(request_id),
            ListAttachmentsError::Storage(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Attachment list storage failed");
                unavailable(request_id)
            }
            ListAttachmentsError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Attachment list failed");
                unavailable(request_id)
            }
        })?;
    Ok((
        response_headers,
        Json(ApiResponse::new(
            records.into_iter().map(to_contract).collect(),
            request_id,
        )),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/attachments/{attachment_id}",
    operation_id = "downloadAttachment",
    tag = "topics",
    params(("attachment_id" = Uuid, Path, description = "Attachment identifier")),
    responses(
        (status = 200, description = "Attachment bytes", content_type = "application/octet-stream"),
        (status = 403, description = "Attachment download is not allowed", body = ErrorResponse),
        (status = 404, description = "The attachment is unavailable", body = ErrorResponse),
        (status = 429, description = "Attachment download quota exceeded", body = ErrorResponse)
    )
)]
pub(crate) async fn download(
    State(database): State<Database>,
    Extension(runtime): Extension<AuthRuntime>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Path(attachment_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let (session, response_headers) =
        authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
    read_response(
        &database,
        attachment_id,
        false,
        session.map(|session| session.user.id),
        response_headers,
        request_id,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v1/attachments/{attachment_id}/thumbnail",
    operation_id = "downloadAttachmentThumbnail",
    tag = "topics",
    params(("attachment_id" = Uuid, Path, description = "Attachment identifier")),
    responses((status = 200, description = "Attachment thumbnail bytes", content_type = "image/webp"), (status = 404, description = "The thumbnail is unavailable", body = ErrorResponse))
)]
pub(crate) async fn download_thumbnail(
    State(database): State<Database>,
    Extension(runtime): Extension<AuthRuntime>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Path(attachment_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let (session, response_headers) =
        authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
    read_response(
        &database,
        attachment_id,
        true,
        session.map(|session| session.user.id),
        response_headers,
        request_id,
    )
    .await
}

async fn read_response(
    database: &Database,
    attachment_id: Uuid,
    thumbnail: bool,
    viewer_user_id: Option<Uuid>,
    response_headers: HeaderMap,
    request_id: RequestId,
) -> Result<Response, ApiError> {
    let (record, bytes) = database
        .read_attachment(attachment_id, thumbnail, viewer_user_id)
        .await
        .map_err(|error| match error {
            ListAttachmentsError::TopicUnavailable => not_found(request_id),
            ListAttachmentsError::Forbidden => forbidden(request_id),
            ListAttachmentsError::QuotaExceeded => quota_exceeded(request_id),
            ListAttachmentsError::Storage(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Attachment read storage failed");
                unavailable(request_id)
            }
            ListAttachmentsError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Attachment read failed");
                unavailable(request_id)
            }
        })?;
    let content_type = if thumbnail {
        "image/webp"
    } else {
        &record.mime_type
    };
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(content_type).expect("validated MIME must be a header value"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response.headers_mut().extend(response_headers);
    Ok(response)
}

fn to_contract(record: AttachmentRecord) -> TopicAttachment {
    let id = record.id;
    TopicAttachment {
        id,
        topic_id: record.topic_id,
        original_name: record.original_name,
        mime_type: record.mime_type,
        size_bytes: u64::try_from(record.size_bytes).expect("database size is non-negative"),
        sha256: hex(&record.sha256),
        status: match record.status.as_str() {
            "pending" => AttachmentStatus::Pending,
            "rejected" => AttachmentStatus::Rejected,
            _ => AttachmentStatus::Ready,
        },
        scan_status: match record.scan_status.as_str() {
            "pending" => AttachmentScanStatus::Pending,
            "infected" => AttachmentScanStatus::Infected,
            "error" => AttachmentScanStatus::Error,
            _ => AttachmentScanStatus::Clean,
        },
        created_at: record
            .created_at
            .format(&time::format_description::well_known::Rfc3339)
            .expect("database timestamp must format"),
        download_url: format!("/api/v1/attachments/{id}"),
        thumbnail_url: record
            .thumbnail_key
            .map(|_| format!("/api/v1/attachments/{id}/thumbnail")),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn map_upload_error(request_id: RequestId, error: AttachmentError) -> ApiError {
    match error {
        AttachmentError::TopicUnavailable => not_found(request_id),
        AttachmentError::Forbidden => forbidden(request_id),
        AttachmentError::BoardRestricted => board_posting_restricted(request_id),
        AttachmentError::QuotaExceeded => quota_exceeded(request_id),
        AttachmentError::Invalid | AttachmentError::Image(_) => {
            invalid(request_id, "file", "附件内容或类型无效")
        }
        AttachmentError::MalwareDetected => invalid(request_id, "file", "附件未通过安全扫描"),
        AttachmentError::Storage(error) => {
            tracing::warn!(request_id = %request_id, error = ?error, "Attachment storage failed");
            unavailable(request_id)
        }
        AttachmentError::Database(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Attachment database write failed");
            unavailable(request_id)
        }
    }
}

fn invalid(request_id: RequestId, field: &str, message: &str) -> ApiError {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::ATTACHMENT_INVALID),
                "附件请求无效",
            )
            .with_field(field, message),
            request_id,
        )),
    )
}

fn forbidden(request_id: RequestId) -> ApiError {
    (
        StatusCode::FORBIDDEN,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::ATTACHMENT_FORBIDDEN),
                "没有上传附件的权限",
            ),
            request_id,
        )),
    )
}

fn board_posting_restricted(request_id: RequestId) -> ApiError {
    (
        StatusCode::FORBIDDEN,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::BOARD_POSTING_RESTRICTED),
                "当前账号在该板块内已被限制上传附件",
            ),
            request_id,
        )),
    )
}

fn quota_exceeded(request_id: RequestId) -> ApiError {
    (
        StatusCode::TOO_MANY_REQUESTS,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::COMMUNITY_QUOTA_EXCEEDED),
                "当前用户组的附件上传额度已用尽或文件过大",
            ),
            request_id,
        )),
    )
}

fn not_found(request_id: RequestId) -> ApiError {
    (
        StatusCode::NOT_FOUND,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::ATTACHMENT_NOT_FOUND),
                "附件或主题不存在",
            ),
            request_id,
        )),
    )
}

fn unavailable(request_id: RequestId) -> ApiError {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
                "附件服务暂时不可用",
            ),
            request_id,
        )),
    )
}
