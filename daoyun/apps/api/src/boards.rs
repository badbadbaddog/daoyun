use crate::auth::{ApiError, AuthRuntime, authenticate_optional_session};
use api_contract::{
    BoardSummary, BoardTone, ErrorBody, ErrorCode, ErrorResponse, PageResponse, RequestId,
    error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    routing::get,
};
use infrastructure::{BoardRecord, Database};
use serde::Deserialize;
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
    Router::new().route("/api/v1/boards", get(list))
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
        slug: record.slug,
        name: record.name,
        description: record.description,
        icon: record.icon,
        tone,
        topic_count,
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
