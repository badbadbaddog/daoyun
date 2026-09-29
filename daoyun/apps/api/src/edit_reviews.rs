use api_contract::{
    ApiResponse, EditReviewDecision, EditReviewItem, EditReviewPolicy, EditReviewStatus,
    EditReviewTargetType, ErrorBody, ErrorCode, ErrorResponse, RequestId, ResolveEditReviewRequest,
    TopicAuthorSummary, UpdateEditReviewPoliciesRequest,
};
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, VARY},
    },
    routing::get,
};
use infrastructure::{
    Database, EditReviewDecisionRecord, EditReviewError, EditReviewPolicyRecord,
    EditReviewPolicyUpdateRecord, EditReviewRecord,
};
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::auth::{ApiError, AuthRuntime, authenticate_session, authenticate_state_change};

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route(
            "/api/v1/admin/edit-review/policies",
            get(list_policies).put(update_policies),
        )
        .route("/api/v1/admin/edit-reviews", get(list_reviews))
        .route(
            "/api/v1/admin/edit-reviews/{review_id}",
            get(get_review).patch(resolve_review),
        )
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(Extension(runtime))
}

#[utoipa::path(
    get, path = "/api/v1/admin/edit-review/policies", operation_id = "listEditReviewPolicies", tag = "moderation",
    responses(
        (status = 200, body = ApiResponse<Vec<EditReviewPolicy>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_policies(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<Vec<EditReviewPolicy>>>), ApiError> {
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let records = database
        .edit_review_policies(session.user.id, None)
        .await
        .map_err(|e| map_error(e, request_id))?;
    Ok((
        private_headers(),
        Json(ApiResponse::new(
            records.into_iter().map(map_policy).collect(),
            request_id,
        )),
    ))
}

#[utoipa::path(
    put, path = "/api/v1/admin/edit-review/policies", operation_id = "updateEditReviewPolicies", tag = "moderation",
    params(("x-csrf-token" = String, Header)), request_body = UpdateEditReviewPoliciesRequest,
    responses(
        (status = 200, body = ApiResponse<Vec<EditReviewPolicy>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update_policies(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    body: Result<Json<UpdateEditReviewPoliciesRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<Vec<EditReviewPolicy>>>, ApiError> {
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let input = body_value(body, request_id)?;
    let updates = input
        .policies
        .into_iter()
        .map(|item| EditReviewPolicyUpdateRecord {
            board_id: item.board_id,
            topic_edits_require_review: item.topic_edits_require_review,
            reply_edits_require_review: item.reply_edits_require_review,
        })
        .collect();
    let records = database
        .edit_review_policies(session.user.id, Some(updates))
        .await
        .map_err(|e| map_error(e, request_id))?;
    Ok(Json(ApiResponse::new(
        records.into_iter().map(map_policy).collect(),
        request_id,
    )))
}

#[utoipa::path(
    get, path = "/api/v1/admin/edit-reviews", operation_id = "listEditReviews", tag = "moderation",
    params(("board_id" = Uuid, Query), ("status" = Option<EditReviewStatus>, Query), ("target_type" = Option<EditReviewTargetType>, Query), ("cursor" = Option<Uuid>, Query), ("limit" = Option<u16>, Query)),
    responses(
        (status = 200, body = ApiResponse<Vec<EditReviewItem>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_reviews(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<std::collections::BTreeMap<String, String>>, QueryRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<Vec<EditReviewItem>>>), ApiError> {
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let Query(query) = query.map_err(|_| map_error(EditReviewError::InvalidInput, request_id))?;
    if query.keys().any(|key| {
        !matches!(
            key.as_str(),
            "board_id" | "status" | "target_type" | "cursor" | "limit"
        )
    }) {
        return Err(map_error(EditReviewError::InvalidInput, request_id));
    }
    let board_id = query
        .get("board_id")
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| map_error(EditReviewError::InvalidInput, request_id))?;
    let status = query.get("status").map(String::as_str).unwrap_or("pending");
    let cursor = query
        .get("cursor")
        .map(|value| Uuid::parse_str(value))
        .transpose()
        .map_err(|_| map_error(EditReviewError::InvalidInput, request_id))?;
    let limit = query
        .get("limit")
        .map(|value| value.parse::<i64>())
        .transpose()
        .map_err(|_| map_error(EditReviewError::InvalidInput, request_id))?
        .unwrap_or(100);
    let records = database
        .list_edit_reviews_page(
            session.user.id,
            board_id,
            status,
            query.get("target_type").map(String::as_str),
            cursor,
            limit,
        )
        .await
        .map_err(|e| map_error(e, request_id))?;
    let mut items = Vec::with_capacity(records.len());
    for record in records {
        items.push(map_record(record, request_id)?);
    }
    Ok((private_headers(), Json(ApiResponse::new(items, request_id))))
}

#[utoipa::path(
    get, path = "/api/v1/admin/edit-reviews/{review_id}", operation_id = "getEditReview", tag = "moderation",
    params(("review_id" = Uuid, Path)),
    responses(
        (status = 200, body = ApiResponse<EditReviewItem>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn get_review(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<EditReviewItem>>), ApiError> {
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let record = database
        .get_edit_review(session.user.id, path_value(path, request_id)?)
        .await
        .map_err(|e| map_error(e, request_id))?;
    Ok((
        private_headers(),
        Json(ApiResponse::new(
            map_record(record, request_id)?,
            request_id,
        )),
    ))
}

#[utoipa::path(
    patch, path = "/api/v1/admin/edit-reviews/{review_id}", operation_id = "resolveEditReview", tag = "moderation",
    params(("review_id" = Uuid, Path), ("x-csrf-token" = String, Header)), request_body = ResolveEditReviewRequest,
    responses(
        (status = 200, body = ApiResponse<EditReviewItem>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn resolve_review(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<ResolveEditReviewRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<EditReviewItem>>, ApiError> {
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let input = body_value(body, request_id)?;
    let base_revision = i32::try_from(input.base_revision)
        .map_err(|_| map_error(EditReviewError::InvalidInput, request_id))?;
    let decision = match input.decision {
        EditReviewDecision::Approve => EditReviewDecisionRecord::Approve,
        EditReviewDecision::Reject => EditReviewDecisionRecord::Reject,
    };
    let record = database
        .resolve_edit_review(
            session.user.id,
            path_value(path, request_id)?,
            decision,
            base_revision,
            &input.reason,
        )
        .await
        .map_err(|e| map_error(e, request_id))?;
    Ok(Json(ApiResponse::new(
        map_record(record, request_id)?,
        request_id,
    )))
}

fn map_policy(record: EditReviewPolicyRecord) -> EditReviewPolicy {
    EditReviewPolicy {
        board_id: record.board_id,
        board_name: record.board_name,
        topic_edits_require_review: record.topic_edits_require_review,
        reply_edits_require_review: record.reply_edits_require_review,
    }
}

#[allow(clippy::result_large_err)]
fn map_record(record: EditReviewRecord, request_id: RequestId) -> Result<EditReviewItem, ApiError> {
    let target_type = match record.target_type.as_str() {
        "topic" => EditReviewTargetType::Topic,
        "reply" => EditReviewTargetType::Reply,
        _ => return Err(invalid_record(request_id)),
    };
    let status = match record.status.as_str() {
        "pending" => EditReviewStatus::Pending,
        "approved" => EditReviewStatus::Approved,
        "rejected" => EditReviewStatus::Rejected,
        _ => return Err(invalid_record(request_id)),
    };
    let reviewer = match (
        record.reviewer_id,
        record.reviewer_username,
        record.reviewer_display_name,
    ) {
        (Some(id), Some(username), Some(display_name)) => Some(TopicAuthorSummary {
            id,
            username,
            display_name,
            avatar_url: record.reviewer_avatar_url,
        }),
        (None, None, None) => None,
        _ => return Err(invalid_record(request_id)),
    };
    Ok(EditReviewItem {
        id: record.id,
        board_id: record.board_id,
        board_name: record.board_name,
        topic_id: record.topic_id,
        post_id: record.post_id,
        target_type,
        editor: TopicAuthorSummary {
            id: record.editor_id,
            username: record.editor_username,
            display_name: record.editor_display_name,
            avatar_url: record.editor_avatar_url,
        },
        base_revision: u32::try_from(record.base_revision)
            .map_err(|_| invalid_record(request_id))?,
        current_title: record.current_title,
        current_content: record.current_content,
        proposed_title: record.proposed_title,
        proposed_content: record.proposed_content,
        proposed_rich_content: record.proposed_rich_content,
        proposed_excerpt: record.proposed_excerpt,
        proposed_tags: record
            .proposed_tags
            .map(serde_json::from_value)
            .transpose()
            .map_err(|_| invalid_record(request_id))?,
        status,
        revision: u32::try_from(record.revision).map_err(|_| invalid_record(request_id))?,
        reviewer,
        review_reason: record.review_reason,
        created_at: record
            .created_at
            .format(&Rfc3339)
            .map_err(|_| invalid_record(request_id))?,
        reviewed_at: record
            .reviewed_at
            .map(|value| value.format(&Rfc3339))
            .transpose()
            .map_err(|_| invalid_record(request_id))?,
    })
}

#[allow(clippy::result_large_err)]
fn path_value(
    path: Result<Path<Uuid>, PathRejection>,
    request_id: RequestId,
) -> Result<Uuid, ApiError> {
    path.map(|Path(value)| value)
        .map_err(|_| map_error(EditReviewError::InvalidInput, request_id))
}

#[allow(clippy::result_large_err)]
fn body_value<T>(
    body: Result<Json<T>, JsonRejection>,
    request_id: RequestId,
) -> Result<T, ApiError> {
    body.map(|Json(value)| value)
        .map_err(|_| map_error(EditReviewError::InvalidInput, request_id))
}

fn private_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    headers.insert(VARY, HeaderValue::from_static("Cookie"));
    headers
}

fn invalid_record(request_id: RequestId) -> ApiError {
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "system.internal_error",
        "编辑审核服务暂时不可用",
        request_id,
    )
}

fn map_error(error: EditReviewError, request_id: RequestId) -> ApiError {
    match error {
        EditReviewError::NotFound => api_error(
            StatusCode::NOT_FOUND,
            "edit_review.not_found",
            "编辑审核记录不存在",
            request_id,
        ),
        EditReviewError::Forbidden => api_error(
            StatusCode::FORBIDDEN,
            "edit_review.forbidden",
            "当前账号无权执行此操作",
            request_id,
        ),
        EditReviewError::Conflict => api_error(
            StatusCode::CONFLICT,
            "edit_review.conflict",
            "公开版本或审核记录已更新，请刷新后重试",
            request_id,
        ),
        EditReviewError::InvalidInput => api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "request.validation_failed",
            "编辑审核参数无效",
            request_id,
        ),
        EditReviewError::AttachmentUnavailable => api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "attachment.unavailable",
            "待审内容包含不可用附件",
            request_id,
        ),
        EditReviewError::Database(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Edit review operation failed");
            invalid_record(request_id)
        }
    }
}

fn api_error(
    status: StatusCode,
    code: &'static str,
    message: &str,
    request_id: RequestId,
) -> ApiError {
    (
        status,
        private_headers(),
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            request_id,
        )),
    )
}
