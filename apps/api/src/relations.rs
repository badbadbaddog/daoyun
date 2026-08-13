use crate::{
    auth::{ApiError, AuthRuntime, authenticate_session, authenticate_state_change},
    topics::topic_summary,
};
use api_contract::{
    ApiResponse, BookmarkState, ErrorBody, ErrorCode, ErrorResponse, PageResponse, PostLikeState,
    RequestId, TopicSummary, error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State, rejection::PathRejection, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    routing::{get, put},
};
use infrastructure::{
    BookmarkMutationError, BookmarkStateRecord, Database, ListBookmarksError,
    PostLikeMutationError, PostLikeStateRecord,
};
use serde::Deserialize;
use utoipa::IntoParams;
use uuid::Uuid;

const DEFAULT_LIMIT: u16 = 20;
const MAX_LIMIT: u16 = 50;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListBookmarksQuery {
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route(
            "/api/v1/topics/{topic_id}/bookmark",
            put(bookmark_topic).delete(unbookmark_topic),
        )
        .route(
            "/api/v1/posts/{post_id}/like",
            put(like_post).delete(unlike_post),
        )
        .route("/api/v1/users/me/bookmarks", get(bookmarks))
        .layer(Extension(runtime))
}

#[utoipa::path(
    put,
    path = "/api/v1/topics/{topic_id}/bookmark",
    operation_id = "bookmarkTopic",
    tag = "relations",
    params(
        ("topic_id" = Uuid, Path, description = "Topic identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The topic is bookmarked", body = ApiResponse<BookmarkState>, headers(("x-request-id" = String))),
        (status = 400, description = "The topic path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The topic is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The bookmark database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn bookmark_topic(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<BookmarkState>>, ApiError> {
    set_bookmark(database, runtime, request_id, headers, path, true).await
}

#[utoipa::path(
    delete,
    path = "/api/v1/topics/{topic_id}/bookmark",
    operation_id = "unbookmarkTopic",
    tag = "relations",
    params(
        ("topic_id" = Uuid, Path, description = "Topic identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The topic bookmark is removed", body = ApiResponse<BookmarkState>, headers(("x-request-id" = String))),
        (status = 400, description = "The topic path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The topic is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The bookmark database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn unbookmark_topic(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<BookmarkState>>, ApiError> {
    set_bookmark(database, runtime, request_id, headers, path, false).await
}

#[utoipa::path(
    put,
    path = "/api/v1/posts/{post_id}/like",
    operation_id = "likePost",
    tag = "relations",
    params(
        ("post_id" = Uuid, Path, description = "Post identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The post is liked", body = ApiResponse<PostLikeState>, headers(("x-request-id" = String))),
        (status = 400, description = "The post path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The post is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The like database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn like_post(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<PostLikeState>>, ApiError> {
    set_like(database, runtime, request_id, headers, path, true).await
}

#[utoipa::path(
    delete,
    path = "/api/v1/posts/{post_id}/like",
    operation_id = "unlikePost",
    tag = "relations",
    params(
        ("post_id" = Uuid, Path, description = "Post identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The post like is removed", body = ApiResponse<PostLikeState>, headers(("x-request-id" = String))),
        (status = 400, description = "The post path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The post is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The like database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn unlike_post(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<PostLikeState>>, ApiError> {
    set_like(database, runtime, request_id, headers, path, false).await
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/bookmarks",
    operation_id = "listCurrentUserBookmarks",
    tag = "relations",
    params(ListBookmarksQuery),
    responses(
        (status = 200, description = "The current user's visible bookmarked topics", body = PageResponse<TopicSummary>, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 422, description = "The bookmark pagination parameters are invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The bookmark database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn bookmarks(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListBookmarksQuery>, QueryRejection>,
) -> Result<Json<PageResponse<TopicSummary>>, ApiError> {
    let Query(query) = query
        .map_err(|_| bookmark_validation_error(request_id, "query", "收藏分页参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(bookmark_validation_error(
            request_id,
            "limit",
            "limit 必须在 1 到 50 之间",
        ));
    }
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let mut records = database
        .list_user_bookmarks(session.user.id, query.cursor, i64::from(limit) + 1)
        .await
        .map_err(|error| match error {
            ListBookmarksError::InvalidCursor => bookmark_validation_error(
                request_id,
                "cursor",
                "cursor 不属于当前收藏结果集",
            ),
            ListBookmarksError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Bookmark list query failed");
                database_unavailable(request_id)
            }
        })?;
    let has_next_page = records.len() > usize::from(limit);
    records.truncate(usize::from(limit));
    let next_cursor = has_next_page.then(|| {
        records
            .last()
            .expect("a full bookmark page is non-empty")
            .id
            .to_string()
    });
    let topics = records
        .into_iter()
        .map(topic_summary)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| database_unavailable(request_id))?;
    Ok(Json(PageResponse::new(topics, request_id, next_cursor)))
}

async fn set_bookmark(
    database: Database,
    runtime: AuthRuntime,
    request_id: RequestId,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    bookmarked: bool,
) -> Result<Json<ApiResponse<BookmarkState>>, ApiError> {
    let Path(topic_id) = path.map_err(|_| interaction_path_invalid(request_id, "topic_id"))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let record = database
        .set_topic_bookmarked(session.user.id, topic_id, bookmarked)
        .await
        .map_err(|error| match error {
            BookmarkMutationError::TopicUnavailable => topic_not_found(request_id),
            BookmarkMutationError::Database(error) => {
                tracing::warn!(request_id = %request_id, topic_id = %topic_id, error = %error, "Bookmark mutation failed");
                database_unavailable(request_id)
            }
        })?;
    Ok(Json(ApiResponse::new(bookmark_state(record), request_id)))
}

async fn set_like(
    database: Database,
    runtime: AuthRuntime,
    request_id: RequestId,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    liked: bool,
) -> Result<Json<ApiResponse<PostLikeState>>, ApiError> {
    let Path(post_id) = path.map_err(|_| interaction_path_invalid(request_id, "post_id"))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let record = database
        .set_post_liked(session.user.id, post_id, liked)
        .await
        .map_err(|error| match error {
            PostLikeMutationError::PostUnavailable => post_not_found(request_id),
            PostLikeMutationError::Database(error) => {
                tracing::warn!(request_id = %request_id, post_id = %post_id, error = %error, "Post like mutation failed");
                database_unavailable(request_id)
            }
        })?;
    let state = post_like_state(record).map_err(|()| database_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(state, request_id)))
}

fn bookmark_state(record: BookmarkStateRecord) -> BookmarkState {
    BookmarkState {
        topic_id: record.topic_id,
        bookmarked: record.bookmarked,
    }
}

fn post_like_state(record: PostLikeStateRecord) -> Result<PostLikeState, ()> {
    Ok(PostLikeState {
        post_id: record.post_id,
        liked: record.liked,
        like_count: u64::try_from(record.like_count).map_err(|_| ())?,
    })
}

fn interaction_path_invalid(request_id: RequestId, field: &'static str) -> ApiError {
    error(
        StatusCode::BAD_REQUEST,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::PATH_INVALID),
            "互动路径参数格式不正确",
        )
        .with_field(field, format!("{field} 必须是 UUID")),
        request_id,
    )
}

fn bookmark_validation_error(
    request_id: RequestId,
    field: &'static str,
    message: &'static str,
) -> ApiError {
    error(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::VALIDATION_FAILED),
            "请求参数校验失败",
        )
        .with_field(field, message),
        request_id,
    )
}

fn topic_not_found(request_id: RequestId) -> ApiError {
    error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_NOT_FOUND),
            "主题不存在或不可访问",
        ),
        request_id,
    )
}

fn post_not_found(request_id: RequestId) -> ApiError {
    error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::POST_NOT_FOUND),
            "帖子不存在或不可访问",
        ),
        request_id,
    )
}

fn database_unavailable(request_id: RequestId) -> ApiError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "互动服务暂时不可用",
        ),
        request_id,
    )
}

fn error(status: StatusCode, body: ErrorBody, request_id: RequestId) -> ApiError {
    (
        status,
        HeaderMap::new(),
        Json(ErrorResponse::new(body, request_id)),
    )
}
