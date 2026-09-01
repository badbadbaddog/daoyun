use crate::auth::{ApiError, AuthRuntime, authenticate_optional_session};
use api_contract::{
    ApiResponse, BoardBreadcrumbItem, BoardDetail, BoardSummary, BoardTone,
    BoardViewerCapabilities, ErrorBody, ErrorCode, ErrorResponse, PageResponse, RequestId,
    error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    routing::get,
};
use infrastructure::{BoardDetailLookupRecord, BoardRecord, Database};
use serde::Deserialize;
use time::OffsetDateTime;
use utoipa::IntoParams;
use uuid::Uuid;

const DEFAULT_LIMIT: u16 = 20;
const MAX_LIMIT: u16 = 50;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListBoardsQuery {
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

pub(crate) fn router() -> Router<Database> {
    Router::new()
        .route("/api/v1/boards", get(list))
        .route("/api/v1/boards/{slug}", get(detail))
}

#[utoipa::path(
    get,
    path = "/api/v1/boards",
    operation_id = "listBoards",
    tag = "boards",
    params(ListBoardsQuery),
    responses(
        (
            status = 200,
            description = "Public boards ordered by configured position",
            body = PageResponse<BoardSummary>,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (
            status = 422,
            description = "Invalid pagination parameters",
            body = ErrorResponse,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (
            status = 503,
            description = "The database is temporarily unavailable",
            body = ErrorResponse,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        )
    )
)]
pub(crate) async fn list(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListBoardsQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<PageResponse<BoardSummary>>), ApiError> {
    let Query(query) =
        query.map_err(|_| validation_error(request_id, "query", "分页参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);

    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(validation_error(
            request_id,
            "limit",
            "limit 必须在 1 到 50 之间",
        ));
    }

    let (session, response_headers) =
        authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
    let fetch_limit = i64::from(limit) + 1;
    let mut records = database
        .list_public_boards(
            session.map(|session| session.user.id),
            query.cursor,
            fetch_limit,
        )
        .await
        .map_err(|error| {
            tracing::warn!(
                request_id = %request_id,
                error = ?error,
                "Public board list query failed"
            );
            service_unavailable(request_id)
        })?;

    let has_next_page = records.len() > usize::from(limit);
    records.truncate(usize::from(limit));
    let next_cursor = has_next_page.then(|| {
        records
            .last()
            .expect("a full page is non-empty")
            .id
            .to_string()
    });
    let boards = records
        .into_iter()
        .map(board_summary)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| {
            tracing::error!(
                request_id = %request_id,
                "Public board record violates persistence constraints"
            );
            service_unavailable(request_id)
        })?;

    Ok((
        response_headers,
        Json(PageResponse::new(boards, request_id, next_cursor)),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/boards/{slug}",
    operation_id = "getBoard",
    tag = "boards",
    params(("slug" = String, Path, description = "Board slug")),
    responses(
        (status = 200, description = "Public board detail and viewer capabilities", body = ApiResponse<BoardDetail>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The board exists but the viewer cannot read it", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 404, description = "The board does not exist", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 422, description = "The board slug is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The database is temporarily unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn detail(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(slug): Path<String>,
) -> Result<(HeaderMap, Json<ApiResponse<BoardDetail>>), ApiError> {
    if !valid_slug(&slug) {
        return Err(validation_error(request_id, "slug", "版块标识格式不正确"));
    }
    let (session, response_headers) =
        authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
    let viewer_user_id = session.as_ref().map(|session| session.user.id);
    let record = database
        .get_board_detail_lookup(viewer_user_id, &slug)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = ?error, "Public board detail query failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| board_not_found(request_id, response_headers.clone()))?;
    if !record.can_read {
        return Err(board_forbidden(request_id, response_headers));
    }

    let children = database
        .list_public_board_children(viewer_user_id, record.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = ?error, "Public child board query failed");
            service_unavailable(request_id)
        })?
        .into_iter()
        .map(board_summary)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| service_unavailable(request_id))?;
    let breadcrumb = database
        .list_public_board_breadcrumb(viewer_user_id, record.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = ?error, "Public board breadcrumb query failed");
            service_unavailable(request_id)
        })?
        .into_iter()
        .map(|item| BoardBreadcrumbItem {
            id: item.id,
            slug: item.slug,
            name: item.name,
        })
        .collect();
    let viewer = viewer_capabilities(&database, viewer_user_id, record.id, request_id).await?;
    let board = board_detail(record, children, breadcrumb, viewer)
        .map_err(|()| service_unavailable(request_id))?;

    Ok((response_headers, Json(ApiResponse::new(board, request_id))))
}

fn board_summary(record: BoardRecord) -> Result<BoardSummary, ()> {
    let tone = match record.tone.as_str() {
        "green" => BoardTone::Green,
        "blue" => BoardTone::Blue,
        "amber" => BoardTone::Amber,
        "rose" => BoardTone::Rose,
        _ => return Err(()),
    };
    let topic_count = u64::try_from(record.topic_count).map_err(|_| ())?;

    Ok(BoardSummary {
        id: record.id,
        parent_id: record.parent_id,
        slug: record.slug,
        name: record.name,
        description: record.description,
        icon: record.icon,
        tone,
        position: record.position,
        depth: u32::try_from(record.depth).map_err(|_| ())?,
        child_count: u64::try_from(record.child_count).map_err(|_| ())?,
        topic_count,
    })
}

async fn viewer_capabilities(
    database: &Database,
    viewer_user_id: Option<Uuid>,
    board_id: Uuid,
    request_id: RequestId,
) -> Result<BoardViewerCapabilities, ApiError> {
    let Some(user_id) = viewer_user_id else {
        return Ok(BoardViewerCapabilities {
            can_read: true,
            can_create_topic: false,
            can_reply: false,
            can_upload_attachment: false,
        });
    };
    let effective_at = OffsetDateTime::now_utc();
    let access = database
        .community_access_snapshot(user_id, effective_at)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = ?error, "Board viewer capability query failed");
            service_unavailable(request_id)
        })?;
    let allowed = |permission: &str| !access.denied && access.permission_keys.contains(permission);
    let can_create_topic = allowed("topic.create")
        && !board_action_restricted(
            database,
            user_id,
            board_id,
            "topic.create",
            effective_at,
            request_id,
        )
        .await?;
    let can_reply = allowed("reply.create")
        && !board_action_restricted(
            database,
            user_id,
            board_id,
            "reply.create",
            effective_at,
            request_id,
        )
        .await?;
    let can_upload_attachment = allowed("attachment.upload")
        && !board_action_restricted(
            database,
            user_id,
            board_id,
            "attachment.upload",
            effective_at,
            request_id,
        )
        .await?;
    Ok(BoardViewerCapabilities {
        can_read: true,
        can_create_topic,
        can_reply,
        can_upload_attachment,
    })
}

async fn board_action_restricted(
    database: &Database,
    user_id: Uuid,
    board_id: Uuid,
    action: &str,
    effective_at: OffsetDateTime,
    request_id: RequestId,
) -> Result<bool, ApiError> {
    database
        .is_board_user_action_restricted(user_id, board_id, action, effective_at)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = ?error, "Board restriction query failed");
            service_unavailable(request_id)
        })
}

fn board_detail(
    record: BoardDetailLookupRecord,
    children: Vec<BoardSummary>,
    breadcrumb: Vec<BoardBreadcrumbItem>,
    viewer: BoardViewerCapabilities,
) -> Result<BoardDetail, ()> {
    let tone = match record.tone.as_str() {
        "green" => BoardTone::Green,
        "blue" => BoardTone::Blue,
        "amber" => BoardTone::Amber,
        "rose" => BoardTone::Rose,
        _ => return Err(()),
    };
    Ok(BoardDetail {
        id: record.id,
        slug: record.slug,
        name: record.name,
        description: record.description,
        icon: record.icon,
        tone,
        parent_id: record.parent_id,
        topic_count: u64::try_from(record.topic_count).map_err(|_| ())?,
        children,
        breadcrumb,
        viewer,
    })
}

fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value.split('-').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn validation_error(request_id: RequestId, field: &'static str, message: &'static str) -> ApiError {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::VALIDATION_FAILED),
                "请求参数校验失败",
            )
            .with_field(field, message),
            request_id,
        )),
    )
}

fn service_unavailable(request_id: RequestId) -> ApiError {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
                "板块暂时无法加载",
            ),
            request_id,
        )),
    )
}

fn board_not_found(request_id: RequestId, headers: HeaderMap) -> ApiError {
    (
        StatusCode::NOT_FOUND,
        headers,
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static("board.not_found"), "版块不存在"),
            request_id,
        )),
    )
}

fn board_forbidden(request_id: RequestId, headers: HeaderMap) -> ApiError {
    (
        StatusCode::FORBIDDEN,
        headers,
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static("board.forbidden"),
                "你没有访问这个版块的权限",
            ),
            request_id,
        )),
    )
}
