use crate::{
    auth::{ApiError, AuthRuntime},
    topics::{self, ListRepliesQuery, ListTopicsQuery},
};
use api_contract::{
    ApiResponse, CreateReplyRequest, CreateTopicRequest, ErrorResponse, PageResponse, RequestId,
    TopicDetail, TopicEditSubmission, TopicReply, TopicSummary, UpdateTopicRequest,
};
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::{HeaderMap, StatusCode},
    routing::get,
};
use infrastructure::Database;
use uuid::Uuid;

const POST_BODY_LIMIT: usize = 256 * 1024;
const COMMENT_BODY_LIMIT: usize = 128 * 1024;

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/posts", get(list).post(create))
        .route(
            "/api/v1/posts/{post_id}",
            get(detail).patch(update).delete(delete_post),
        )
        .route(
            "/api/v1/posts/{post_id}/comments",
            get(list_comments)
                .post(create_comment)
                .layer(DefaultBodyLimit::max(COMMENT_BODY_LIMIT)),
        )
        .layer(DefaultBodyLimit::max(POST_BODY_LIMIT))
        .layer(Extension(runtime))
}

#[utoipa::path(
    get,
    path = "/api/v1/posts",
    operation_id = "listPosts",
    tag = "posts",
    params(ListTopicsQuery),
    responses(
        (status = 200, description = "Published posts matching the compatibility filters", body = PageResponse<TopicSummary>, headers(("x-request-id" = String))),
        (status = 401, description = "The following feed requires an active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 422, description = "Invalid post filters or cursor", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The post database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListTopicsQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<PageResponse<TopicSummary>>), ApiError> {
    topics::list(
        State(database),
        Extension(request_id),
        Extension(runtime),
        headers,
        query,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/v1/posts",
    operation_id = "createPost",
    tag = "posts",
    params(
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token"),
        ("Idempotency-Key" = Option<String>, Header, description = "Optional idempotency key for safe retries")
    ),
    request_body = CreateTopicRequest,
    responses(
        (status = 200, description = "The idempotent replay of an existing post", body = ApiResponse<TopicDetail>, headers(("x-request-id" = String))),
        (status = 201, description = "The published post", body = ApiResponse<TopicDetail>, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The requested community is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The idempotency key conflicts with a previous request", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The post fields or request body are invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The post database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn create(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<CreateTopicRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<TopicDetail>>), ApiError> {
    topics::create(
        State(database),
        Extension(request_id),
        Extension(runtime),
        headers,
        request,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v1/posts/{post_id}",
    operation_id = "getPost",
    tag = "posts",
    params(("post_id" = Uuid, Path, description = "Post identifier")),
    responses(
        (status = 200, description = "The published post detail", body = ApiResponse<TopicDetail>, headers(("x-request-id" = String))),
        (status = 400, description = "The post path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The post is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The post database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn detail(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<TopicDetail>>), ApiError> {
    topics::detail(
        State(database),
        Extension(request_id),
        Extension(runtime),
        headers,
        path,
    )
    .await
}

#[utoipa::path(
    patch,
    path = "/api/v1/posts/{post_id}",
    operation_id = "updatePost",
    tag = "posts",
    params(
        ("post_id" = Uuid, Path, description = "Post identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    request_body = UpdateTopicRequest,
    responses(
        (status = 200, description = "The published post and edit disposition", body = ApiResponse<TopicEditSubmission>, headers(("x-request-id" = String))),
        (status = 400, description = "The post path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The current user cannot edit this post", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The post is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The post revision is stale", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The post update is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The post database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<UpdateTopicRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<TopicEditSubmission>>), ApiError> {
    topics::update(
        State(database),
        Extension(request_id),
        Extension(runtime),
        headers,
        path,
        request,
    )
    .await
}

#[utoipa::path(
    delete,
    path = "/api/v1/posts/{post_id}",
    operation_id = "deletePost",
    tag = "posts",
    params(
        ("post_id" = Uuid, Path, description = "Post identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The post is deleted", body = ApiResponse<bool>, headers(("x-request-id" = String))),
        (status = 400, description = "The post path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The current user cannot delete this post", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The post is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The post database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn delete_post(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<bool>>, ApiError> {
    topics::delete_topic(
        State(database),
        Extension(request_id),
        Extension(runtime),
        headers,
        path,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v1/posts/{post_id}/comments",
    operation_id = "listPostComments",
    tag = "posts",
    params(
        ("post_id" = Uuid, Path, description = "Post identifier"),
        ListRepliesQuery
    ),
    responses(
        (status = 200, description = "Published comments in chronological order", body = PageResponse<TopicReply>, headers(("x-request-id" = String))),
        (status = 400, description = "The post path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The post is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "Invalid comment pagination parameters", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The comment database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_comments(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    query: Result<Query<ListRepliesQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<PageResponse<TopicReply>>), ApiError> {
    topics::list_replies(
        State(database),
        Extension(request_id),
        Extension(runtime),
        headers,
        path,
        query,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/v1/posts/{post_id}/comments",
    operation_id = "createPostComment",
    tag = "posts",
    params(
        ("post_id" = Uuid, Path, description = "Post identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token"),
        ("Idempotency-Key" = Option<String>, Header, description = "Optional idempotency key for safe retries")
    ),
    request_body = CreateReplyRequest,
    responses(
        (status = 200, description = "The idempotent replay of an existing comment", body = ApiResponse<TopicReply>, headers(("x-request-id" = String))),
        (status = 201, description = "The published comment", body = ApiResponse<TopicReply>, headers(("x-request-id" = String))),
        (status = 400, description = "The post path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The post is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The idempotency key conflicts with a previous request", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The comment content or request body is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The comment database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn create_comment(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<CreateReplyRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<TopicReply>>), ApiError> {
    topics::create_reply(
        State(database),
        Extension(request_id),
        Extension(runtime),
        headers,
        path,
        request,
    )
    .await
}
