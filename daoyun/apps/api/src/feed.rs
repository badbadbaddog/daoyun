use crate::{
    auth::{ApiError, AuthRuntime},
    topics::{self, ListTopicsQuery},
};
use api_contract::{
    ErrorBody, ErrorCode, ErrorResponse, FeedMode, PageResponse, RequestId, TopicScope, TopicSort,
    TopicSummary, error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    routing::get,
};
use infrastructure::Database;
use serde::Deserialize;
use utoipa::IntoParams;
use uuid::Uuid;

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct FeedQuery {
    mode: FeedMode,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/feed", get(list))
        .layer(Extension(runtime))
}

#[utoipa::path(
    get,
    path = "/api/v1/feed",
    operation_id = "getFeed",
    tag = "feed",
    params(FeedQuery),
    responses(
        (status = 200, description = "Posts for the selected feed mode", body = PageResponse<TopicSummary>, headers(("x-request-id" = String))),
        (status = 401, description = "The following feed requires an active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 422, description = "The feed mode or pagination parameters are invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The feed database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<FeedQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<PageResponse<TopicSummary>>), ApiError> {
    let Query(query) = query.map_err(|_| feed_validation_error(request_id))?;
    let (scope, sort) = match query.mode {
        FeedMode::Recommended => (None, Some(TopicSort::Popular)),
        FeedMode::Following => (Some(TopicScope::Following), Some(TopicSort::Latest)),
        FeedMode::Latest => (None, Some(TopicSort::Latest)),
    };
    let topics_query = ListTopicsQuery {
        board: None,
        query: None,
        tag: None,
        author: None,
        scope,
        featured: None,
        sort,
        cursor: query.cursor,
        limit: query.limit,
    };
    topics::list(
        State(database),
        Extension(request_id),
        Extension(runtime),
        headers,
        Ok(Query(topics_query)),
    )
    .await
}

fn feed_validation_error(request_id: RequestId) -> ApiError {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::VALIDATION_FAILED),
                "Feed 查询参数格式不正确",
            ),
            request_id,
        )),
    )
}
