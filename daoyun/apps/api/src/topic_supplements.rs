use api_contract::{
    ApiResponse, CreateTopicSupplementRequest, ErrorBody, ErrorCode, ErrorResponse, RequestId,
    ResponseMeta, TopicAuthorSummary, TopicSupplement, TopicSupplementListMeta,
    TopicSupplementListResponse, TopicSupplementSettings, TopicSupplementStatus,
};
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, State,
        rejection::{JsonRejection, PathRejection},
    },
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, VARY},
    },
    routing::get,
};
use infrastructure::{
    Database, NewTopicSupplement, SupplementError, SupplementRecord, SupplementSettingsRecord,
};
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::auth::{
    ApiError, AuthRuntime, authenticate_optional_session, authenticate_session,
    authenticate_state_change,
};

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route(
            "/api/v1/topics/{topic_id}/supplements",
            get(list).post(create),
        )
        .route(
            "/api/v1/admin/topic-supplements/settings",
            get(get_settings).put(put_settings),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(Extension(runtime))
}

#[utoipa::path(
    get, path = "/api/v1/topics/{topic_id}/supplements", operation_id = "listTopicSupplements", tag = "topics",
    params(("topic_id" = Uuid, Path)),
    responses(
        (status = 200, body = TopicSupplementListResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<(HeaderMap, Json<TopicSupplementListResponse>), ApiError> {
    let topic_id = path_value(path, request_id)?;
    let (session, headers) =
        authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
    let page = database
        .list_topic_supplements(topic_id, session.map(|s| s.user.id))
        .await
        .map_err(|e| map_error(e, request_id))?;
    let mut data = Vec::with_capacity(page.records.len());
    for record in page.records {
        data.push(map_record(record, request_id)?);
    }
    Ok((
        private_headers(headers),
        Json(TopicSupplementListResponse {
            data,
            meta: TopicSupplementListMeta {
                response: ResponseMeta::new(request_id),
                enabled: page.settings.enabled,
                max_per_topic: nonnegative(page.settings.max_per_topic, request_id)?,
                used_count: u32::try_from(page.used_count)
                    .map_err(|_| invalid_record(request_id))?,
                can_submit: page.can_submit,
            },
        }),
    ))
}

#[utoipa::path(
    post, path = "/api/v1/topics/{topic_id}/supplements", operation_id = "createTopicSupplement", tag = "topics",
    params(("topic_id" = Uuid, Path), ("x-csrf-token" = String, Header), ("idempotency-key" = String, Header)),
    request_body = CreateTopicSupplementRequest,
    responses(
        (status = 200, body = ApiResponse<TopicSupplement>, headers(("x-request-id" = String))),
        (status = 201, body = ApiResponse<TopicSupplement>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 413, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn create(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<CreateTopicSupplementRequest>, JsonRejection>,
) -> Result<(StatusCode, HeaderMap, Json<ApiResponse<TopicSupplement>>), ApiError> {
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let input = body_value(body, request_id)?;
    let key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| map_error(SupplementError::InvalidInput, request_id))?;
    let (record, created) = database
        .create_topic_supplement(NewTopicSupplement {
            topic_id: path_value(path, request_id)?,
            author_id: session.user.id,
            content: input.content,
            idempotency_key: key.to_owned(),
        })
        .await
        .map_err(|e| map_error(e, request_id))?;
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        private_headers(HeaderMap::new()),
        Json(ApiResponse::new(
            map_record(record, request_id)?,
            request_id,
        )),
    ))
}

#[utoipa::path(
    get, path = "/api/v1/admin/topic-supplements/settings", operation_id = "getTopicSupplementSettings", tag = "topics",
    responses(
        (status = 200, body = ApiResponse<TopicSupplementSettings>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn get_settings(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<TopicSupplementSettings>>), ApiError> {
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let settings = database
        .topic_supplement_settings(session.user.id, None)
        .await
        .map_err(|e| map_error(e, request_id))?;
    Ok((
        private_headers(HeaderMap::new()),
        Json(ApiResponse::new(
            map_settings(settings, request_id)?,
            request_id,
        )),
    ))
}

#[utoipa::path(
    put, path = "/api/v1/admin/topic-supplements/settings", operation_id = "putTopicSupplementSettings", tag = "topics",
    params(("x-csrf-token" = String, Header)), request_body = TopicSupplementSettings,
    responses(
        (status = 200, body = ApiResponse<TopicSupplementSettings>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 413, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn put_settings(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    body: Result<Json<TopicSupplementSettings>, JsonRejection>,
) -> Result<Json<ApiResponse<TopicSupplementSettings>>, ApiError> {
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let input = body_value(body, request_id)?;
    let limit = i32::try_from(input.max_per_topic)
        .map_err(|_| map_error(SupplementError::InvalidInput, request_id))?;
    let settings = database
        .topic_supplement_settings(
            session.user.id,
            Some(SupplementSettingsRecord {
                enabled: input.enabled,
                max_per_topic: limit,
            }),
        )
        .await
        .map_err(|e| map_error(e, request_id))?;
    Ok(Json(ApiResponse::new(
        map_settings(settings, request_id)?,
        request_id,
    )))
}

#[allow(clippy::result_large_err)]
fn path_value<T>(
    path: Result<Path<T>, PathRejection>,
    request_id: RequestId,
) -> Result<T, ApiError> {
    path.map(|Path(value)| value)
        .map_err(|_| map_error(SupplementError::InvalidInput, request_id))
}

#[allow(clippy::result_large_err)]
fn body_value<T>(
    body: Result<Json<T>, JsonRejection>,
    request_id: RequestId,
) -> Result<T, ApiError> {
    body.map(|Json(value)| value).map_err(|error| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            api_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request.body_too_large",
                "请求体过大",
                request_id,
            )
        } else {
            map_error(SupplementError::InvalidInput, request_id)
        }
    })
}

fn private_headers(mut headers: HeaderMap) -> HeaderMap {
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    headers.insert(VARY, HeaderValue::from_static("Cookie"));
    headers
}

#[allow(clippy::result_large_err)]
fn nonnegative(value: i32, request_id: RequestId) -> Result<u32, ApiError> {
    u32::try_from(value).map_err(|_| invalid_record(request_id))
}

#[allow(clippy::result_large_err)]
fn map_settings(
    record: SupplementSettingsRecord,
    request_id: RequestId,
) -> Result<TopicSupplementSettings, ApiError> {
    Ok(TopicSupplementSettings {
        enabled: record.enabled,
        max_per_topic: nonnegative(record.max_per_topic, request_id)?,
    })
}

#[allow(clippy::result_large_err)]
fn map_record(
    record: SupplementRecord,
    request_id: RequestId,
) -> Result<TopicSupplement, ApiError> {
    let status = match record.status.as_str() {
        "approved" => TopicSupplementStatus::Approved,
        "hidden" => TopicSupplementStatus::Hidden,
        _ => return Err(invalid_record(request_id)),
    };
    Ok(TopicSupplement {
        id: record.id,
        topic_id: record.topic_id,
        author: TopicAuthorSummary {
            id: record.author_id,
            username: record.username,
            display_name: record.display_name,
            avatar_url: record.avatar_url,
        },
        content: record.content,
        status,
        revision: nonnegative(record.revision, request_id)?,
        created_at: record
            .created_at
            .format(&Rfc3339)
            .map_err(|_| invalid_record(request_id))?,
        updated_at: record
            .updated_at
            .format(&Rfc3339)
            .map_err(|_| invalid_record(request_id))?,
    })
}

fn invalid_record(request_id: RequestId) -> ApiError {
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "system.internal_error",
        "补充服务暂时不可用",
        request_id,
    )
}

fn map_error(error: SupplementError, request_id: RequestId) -> ApiError {
    let (status, code, message) = match error {
        SupplementError::NotFound => (
            StatusCode::NOT_FOUND,
            "topic.not_found",
            "帖子或补充不存在，或不可访问",
        ),
        SupplementError::Forbidden => (
            StatusCode::FORBIDDEN,
            "topic.supplement_forbidden",
            "当前账号无权执行此操作",
        ),
        SupplementError::Disabled => (
            StatusCode::CONFLICT,
            "topic.supplement_disabled",
            "帖子补充已停用",
        ),
        SupplementError::LimitReached => (
            StatusCode::CONFLICT,
            "topic.supplement_limit_reached",
            "该帖补充次数已达上限",
        ),
        SupplementError::Conflict => (
            StatusCode::CONFLICT,
            "request.idempotency_conflict",
            "幂等键对应的请求内容冲突",
        ),
        SupplementError::InvalidInput => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "request.validation_failed",
            "补充参数无效，请检查正文或幂等键",
        ),
        SupplementError::Database(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Topic supplement operation failed");
            return invalid_record(request_id);
        }
    };
    api_error(status, code, message, request_id)
}

fn api_error(
    status: StatusCode,
    code: &'static str,
    message: &str,
    request_id: RequestId,
) -> ApiError {
    (
        status,
        private_headers(HeaderMap::new()),
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            request_id,
        )),
    )
}
