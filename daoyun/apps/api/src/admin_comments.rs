use crate::auth::{ApiError, AuthRuntime, authenticate_session, authenticate_state_change};
use api_contract::{
    AdminComment, AdminCommentStatus, ApiResponse, ErrorBody, ErrorCode, ErrorResponse,
    ModerateAdminCommentRequest, PageResponse, RequestId, TopicAuthorSummary,
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
use infrastructure::{AdminCommentError, AdminCommentFilters, AdminCommentRecord, Database};
use serde::Deserialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::IntoParams;
use uuid::Uuid;

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/admin/comments", get(list))
        .route(
            "/api/v1/admin/comments/{comment_id}",
            get(detail).patch(moderate),
        )
        .layer(DefaultBodyLimit::max(8 * 1024))
        .layer(Extension(runtime))
}

#[derive(Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
pub(crate) struct ListCommentsQuery {
    board_id: Uuid,
    status: Option<AdminCommentStatus>,
    q: Option<String>,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

#[utoipa::path(get,path="/api/v1/admin/comments",operation_id="listAdminComments",tag="moderation",params(ListCommentsQuery),
responses((status=200,body=PageResponse<AdminComment>,headers(("x-request-id"=String))),
(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),
(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn list(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListCommentsQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<PageResponse<AdminComment>>), ApiError> {
    let (session, _) = authenticate_session(&db, &runtime, &headers, id).await?;
    let Query(query) = query.map_err(|_| map_error(AdminCommentError::InvalidInput, id))?;
    let limit = query.limit.unwrap_or(20);
    if !(1..=100).contains(&limit) {
        return Err(map_error(AdminCommentError::InvalidInput, id));
    }
    let filters = AdminCommentFilters {
        board_id: query.board_id,
        status: query.status.map(|s| status_name(s).to_owned()),
        query: query.q.unwrap_or_default().trim().to_owned(),
        cursor: query.cursor,
        limit: i64::from(limit) + 1,
    };
    let mut rows = db
        .list_admin_comments(session.user.id, &filters)
        .await
        .map_err(|e| map_error(e, id))?;
    let more = rows.len() > usize::from(limit);
    rows.truncate(usize::from(limit));
    let cursor = if more {
        rows.last().map(|r| r.id.to_string())
    } else {
        None
    };
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(map_record(row, id)?);
    }
    Ok((
        private_headers(),
        Json(PageResponse::new(items, id, cursor)),
    ))
}

#[utoipa::path(get,path="/api/v1/admin/comments/{comment_id}",operation_id="getAdminComment",tag="moderation",params(("comment_id"=Uuid,Path)),
responses((status=200,body=ApiResponse<AdminComment>,headers(("x-request-id"=String))),
(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),
(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),
(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn detail(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<AdminComment>>), ApiError> {
    let (session, _) = authenticate_session(&db, &runtime, &headers, id).await?;
    let Path(comment_id) = path.map_err(|_| map_error(AdminCommentError::InvalidInput, id))?;
    let row = db
        .get_admin_comment(session.user.id, comment_id)
        .await
        .map_err(|e| map_error(e, id))?;
    Ok((
        private_headers(),
        Json(ApiResponse::new(map_record(row, id)?, id)),
    ))
}

#[utoipa::path(patch,path="/api/v1/admin/comments/{comment_id}",operation_id="moderateAdminComment",tag="moderation",params(("comment_id"=Uuid,Path),("x-csrf-token"=String,Header)),request_body=ModerateAdminCommentRequest,
responses((status=200,body=ApiResponse<AdminComment>,headers(("x-request-id"=String))),
(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),
(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),
(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn moderate(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<ModerateAdminCommentRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<AdminComment>>), ApiError> {
    let session = authenticate_state_change(&db, &runtime, &headers, id).await?;
    let Path(comment_id) = path.map_err(|_| map_error(AdminCommentError::InvalidInput, id))?;
    let Json(input) = body.map_err(|_| map_error(AdminCommentError::InvalidInput, id))?;
    let expected = OffsetDateTime::parse(&input.expected_updated_at, &Rfc3339)
        .map_err(|_| map_error(AdminCommentError::InvalidInput, id))?;
    let row = db
        .moderate_admin_comment(
            session.user.id,
            comment_id,
            status_name(input.status),
            expected,
            &input.reason,
        )
        .await
        .map_err(|e| map_error(e, id))?;
    Ok((
        private_headers(),
        Json(ApiResponse::new(map_record(row, id)?, id)),
    ))
}

fn status_name(status: AdminCommentStatus) -> &'static str {
    match status {
        AdminCommentStatus::Published => "published",
        AdminCommentStatus::Hidden => "hidden",
    }
}
#[allow(clippy::result_large_err)]
fn map_record(row: AdminCommentRecord, id: RequestId) -> Result<AdminComment, ApiError> {
    Ok(AdminComment {
        id: row.id,
        topic_id: row.topic_id,
        topic_title: row.topic_title,
        board_id: row.board_id,
        board_name: row.board_name,
        author: TopicAuthorSummary {
            id: row.author_id,
            username: row.author_username,
            display_name: row.author_display_name,
            avatar_url: row.author_avatar_url,
        },
        content: row.content,
        content_truncated: row.content_truncated,
        status: match row.status.as_str() {
            "published" => AdminCommentStatus::Published,
            "hidden" => AdminCommentStatus::Hidden,
            _ => return Err(unavailable(id)),
        },
        created_at: row
            .created_at
            .format(&Rfc3339)
            .map_err(|_| unavailable(id))?,
        updated_at: row
            .updated_at
            .format(&Rfc3339)
            .map_err(|_| unavailable(id))?,
    })
}
fn private_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    headers.insert(VARY, HeaderValue::from_static("Cookie"));
    headers
}
fn error(status: StatusCode, code: &'static str, message: &str, id: RequestId) -> ApiError {
    (
        status,
        private_headers(),
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            id,
        )),
    )
}
fn unavailable(id: RequestId) -> ApiError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "system.internal_error",
        "评论管理暂时不可用",
        id,
    )
}
fn map_error(cause: AdminCommentError, id: RequestId) -> ApiError {
    match cause {
        AdminCommentError::Forbidden => error(
            StatusCode::FORBIDDEN,
            "comment.forbidden",
            "当前账号没有此版块的评论管理权限",
            id,
        ),
        AdminCommentError::NotFound => error(
            StatusCode::NOT_FOUND,
            "comment.not_found",
            "评论不存在或已删除",
            id,
        ),
        AdminCommentError::Conflict => error(
            StatusCode::CONFLICT,
            "comment.conflict",
            "评论已被其他人更新，请刷新后重新处理",
            id,
        ),
        AdminCommentError::InvalidInput => error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "request.validation_failed",
            "请检查筛选参数、版本和 2–500 字的处理说明",
            id,
        ),
        AdminCommentError::Database(cause) => {
            tracing::warn!(request_id=%id,error=%cause,"Admin comment operation failed");
            unavailable(id)
        }
    }
}
