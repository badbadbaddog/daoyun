use crate::auth::{ApiError, AuthRuntime, authenticate_session, authenticate_state_change};
use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, MemberDraft, MemberDraftPage, RequestId,
    SaveDraftRequest,
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
use infrastructure::{Database, DraftError, DraftRecord};
use serde::Deserialize;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;
type Reply<T> = Result<(HeaderMap, Json<ApiResponse<T>>), ApiError>;
pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/users/me/drafts", get(list))
        .route(
            "/api/v1/users/me/drafts/{draft_id}",
            get(detail).put(save).delete(remove),
        )
        .layer(DefaultBodyLimit::max(2_097_152))
        .layer(Extension(runtime))
}
#[derive(Deserialize)]
pub(crate) struct PageQuery {
    cursor: Option<Uuid>,
    limit: Option<i64>,
}
#[derive(Deserialize)]
pub(crate) struct DeleteQuery {
    revision: i64,
}
#[utoipa::path(get,path="/api/v1/users/me/drafts",operation_id="listMyDrafts",tag="drafts",params(("cursor"=Option<Uuid>,Query),("limit"=Option<i64>,Query)),responses((status=200,body=ApiResponse<MemberDraftPage>,headers(("x-request-id"=String))),(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
// Keep the shared API error envelope in DTO conversion closures.
#[allow(clippy::result_large_err)]
pub(crate) async fn list(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Reply<MemberDraftPage> {
    let (session, _) = authenticate_session(&db, &runtime, &headers, id).await?;
    let Query(query) = query.map_err(|_| error(DraftError::InvalidInput, id))?;
    let limit = query.limit.unwrap_or(20);
    if !(1..=50).contains(&limit) {
        return Err(error(DraftError::InvalidInput, id));
    }
    let mut rows = db
        .list_drafts(session.user.id, query.cursor, limit + 1)
        .await
        .map_err(|e| error(e, id))?;
    let next_cursor = if rows.len() > limit as usize {
        rows.truncate(limit as usize);
        rows.last().map(|r| r.id)
    } else {
        None
    };
    reply(
        MemberDraftPage {
            drafts: rows
                .into_iter()
                .map(|r| map(r, id))
                .collect::<Result<_, _>>()?,
            next_cursor,
        },
        id,
    )
}
#[utoipa::path(get,path="/api/v1/users/me/drafts/{draft_id}",operation_id="getMyDraft",tag="drafts",params(("draft_id"=Uuid,Path)),responses((status=200,body=ApiResponse<MemberDraft>,headers(("x-request-id"=String))),(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn detail(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Reply<MemberDraft> {
    let (session, _) = authenticate_session(&db, &runtime, &headers, id).await?;
    let Path(draft) = path.map_err(|_| error(DraftError::InvalidInput, id))?;
    reply(
        map(
            db.draft(session.user.id, draft)
                .await
                .map_err(|e| error(e, id))?,
            id,
        )?,
        id,
    )
}
#[utoipa::path(put,path="/api/v1/users/me/drafts/{draft_id}",operation_id="saveMyDraft",tag="drafts",request_body=SaveDraftRequest,params(("draft_id"=Uuid,Path),("x-csrf-token"=String,Header)),responses((status=200,body=ApiResponse<MemberDraft>,headers(("x-request-id"=String))),(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn save(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<SaveDraftRequest>, JsonRejection>,
) -> Reply<MemberDraft> {
    let session = authenticate_state_change(&db, &runtime, &headers, id).await?;
    let Path(draft) = path.map_err(|_| error(DraftError::InvalidInput, id))?;
    let Json(input) = body.map_err(|e| {
        if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
            api_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request.body_too_large",
                "草稿不能超过 2 MB",
                id,
            )
        } else {
            error(DraftError::InvalidInput, id)
        }
    })?;
    if input.content.title.chars().count() > 160
        || input.content.images.len()
            + crate::rich_content::image_node_count(&input.content.rich_content)
            > crate::rich_content::MAX_IMAGES
        || input
            .content
            .images
            .iter()
            .any(|i| i.file_name.len() > 1024)
    {
        return Err(error(DraftError::InvalidInput, id));
    }
    let payload =
        serde_json::to_value(input.content).map_err(|_| error(DraftError::InvalidInput, id))?;
    reply(
        map(
            db.save_draft(session.user.id, draft, input.expected_revision, payload)
                .await
                .map_err(|e| error(e, id))?,
            id,
        )?,
        id,
    )
}
#[utoipa::path(delete,path="/api/v1/users/me/drafts/{draft_id}",operation_id="deleteMyDraft",tag="drafts",params(("draft_id"=Uuid,Path),("revision"=i64,Query),("x-csrf-token"=String,Header)),responses((status=200,body=ApiResponse<bool>,headers(("x-request-id"=String))),(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn remove(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    query: Result<Query<DeleteQuery>, QueryRejection>,
) -> Reply<bool> {
    let session = authenticate_state_change(&db, &runtime, &headers, id).await?;
    let Path(draft) = path.map_err(|_| error(DraftError::InvalidInput, id))?;
    let Query(query) = query.map_err(|_| error(DraftError::InvalidInput, id))?;
    db.delete_draft(session.user.id, draft, query.revision)
        .await
        .map_err(|e| error(e, id))?;
    reply(true, id)
}
#[allow(clippy::result_large_err)]
fn map(row: DraftRecord, id: RequestId) -> Result<MemberDraft, ApiError> {
    Ok(MemberDraft {
        id: row.id,
        revision: row.revision,
        content: serde_json::from_value(row.payload).map_err(|_| unavailable(id))?,
        updated_at: row
            .updated_at
            .format(&Rfc3339)
            .map_err(|_| unavailable(id))?,
    })
}
#[allow(clippy::result_large_err)]
fn reply<T>(data: T, id: RequestId) -> Reply<T> {
    Ok((private_headers(), Json(ApiResponse::new(data, id))))
}
fn private_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    h.insert(VARY, HeaderValue::from_static("Cookie"));
    h
}
fn error(e: DraftError, id: RequestId) -> ApiError {
    let (status, code, message) = match e {
        DraftError::NotFound => (
            StatusCode::NOT_FOUND,
            "draft.not_found",
            "草稿不存在或已发布、删除",
        ),
        DraftError::Conflict => (
            StatusCode::CONFLICT,
            "draft.conflict",
            "另一设备已更新草稿，请查看服务器版或另存副本",
        ),
        DraftError::Forbidden => (
            StatusCode::FORBIDDEN,
            "draft.forbidden",
            "当前账号不能保存草稿",
        ),
        DraftError::LimitReached => (
            StatusCode::CONFLICT,
            "draft.limit_reached",
            "最多保存 50 篇草稿，请先删除不再需要的草稿",
        ),
        DraftError::InvalidInput => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "request.validation_failed",
            "草稿格式或大小无效",
        ),
        DraftError::AttachmentUnavailable => (
            StatusCode::CONFLICT,
            "draft.attachment_unavailable",
            "图片已过期、已发布或不属于当前账号，请重新上传",
        ),
        DraftError::Database(_) => {
            tracing::warn!(request_id=%id,"Draft database operation failed");
            return unavailable(id);
        }
    };
    api_error(status, code, message, id)
}
fn unavailable(id: RequestId) -> ApiError {
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "system.internal_error",
        "草稿服务暂时不可用",
        id,
    )
}
fn api_error(status: StatusCode, code: &'static str, message: &str, id: RequestId) -> ApiError {
    (
        status,
        private_headers(),
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            id,
        )),
    )
}
