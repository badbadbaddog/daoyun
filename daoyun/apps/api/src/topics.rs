use crate::auth::{
    ApiError, AuthRuntime, authenticate_optional_session, authenticate_session,
    authenticate_state_change,
};
use api_contract::{
    ApiResponse, BoardTone, CreateReplyRequest, CreateTopicRequest, ErrorBody, ErrorCode,
    ErrorResponse, FieldErrors, GovernTopicRequest, ModerateTopicRequest, ModerationBoard,
    ModerationTopic, PageResponse, ReplyReference, ReplyRevision, RequestId, TopicAuthorSummary,
    TopicBoardSummary, TopicDetail, TopicGovernanceAction, TopicGovernanceResult,
    TopicModerationHistoryAction, TopicModerationHistoryEntry, TopicModerationHistorySource,
    TopicModerationResult, TopicModerationStatus, TopicReply, TopicRevision, TopicScope, TopicSort,
    TopicSummary, TopicTag, TopicTagInput, UpdateReplyRequest, UpdateTopicRequest, UserSummary,
    error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::{HeaderMap, StatusCode},
    routing::{get, patch},
};
use infrastructure::{
    CreateReplyError, CreateTopicError, Database, IdempotencyInput, ListModerationTopicsError,
    ListPublicRepliesError, ListPublicTopicsError, ListTopicModerationHistoryError,
    ListTopicRevisionsError, ModerationTopicFilters, NewReplyRecord, NewTagRecord, NewTopicRecord,
    PublicReplyRecord, PublicTopicDetailRecord, PublicTopicFilters, PublicTopicRecord,
    ReplyMutationError, TopicDeleteError, TopicGovernanceAction as InfrastructureGovernanceAction,
    TopicGovernanceError, TopicGovernanceInput, TopicModerationError,
    TopicSort as InfrastructureTopicSort, UpdateReplyRecord, UpdateTopicError, UpdateTopicRecord,
    permission_keys,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};
use utoipa::IntoParams;
use uuid::Uuid;

use crate::admin::authorize_capability_read;
use crate::rich_content::{redact_reply_gates, validate_and_project};

const DEFAULT_LIMIT: u16 = 20;
const MAX_LIMIT: u16 = 50;
const TOPIC_BODY_LIMIT: usize = 256 * 1024;
const REPLY_BODY_LIMIT: usize = 128 * 1024;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListTopicsQuery {
    board: Option<String>,
    query: Option<String>,
    tag: Option<String>,
    author: Option<String>,
    scope: Option<TopicScope>,
    featured: Option<bool>,
    sort: Option<TopicSort>,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListRepliesQuery {
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListModerationTopicsQuery {
    board_id: Option<Uuid>,
    query: Option<String>,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListTopicModerationHistoryQuery {
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

struct ValidatedCreateTopic {
    board_id: Option<Uuid>,
    title: String,
    content: String,
    rich_content: Option<serde_json::Value>,
    excerpt: String,
    tags: Vec<NewTagRecord>,
}

struct ValidatedCreateReply {
    content: String,
    rich_content: Option<serde_json::Value>,
    reply_to_id: Option<Uuid>,
}

struct ValidatedUpdateReply {
    base_revision: i32,
    content: String,
    rich_content: Option<serde_json::Value>,
}

struct ValidatedUpdateTopic {
    base_revision: i32,
    title: Option<String>,
    excerpt: Option<String>,
    content: Option<String>,
    rich_content: Option<serde_json::Value>,
    tags: Option<Vec<NewTagRecord>>,
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/tags", get(list_tags))
        .route("/api/v1/topics", get(list).post(create))
        .route(
            "/api/v1/admin/moderation/boards",
            get(list_moderation_boards),
        )
        .route(
            "/api/v1/admin/moderation/topics",
            get(list_moderation_topics),
        )
        .route(
            "/api/v1/admin/moderation/topics/{topic_id}/history",
            get(list_topic_moderation_history),
        )
        .route(
            "/api/v1/topics/{topic_id}",
            get(detail).patch(update).delete(delete_topic),
        )
        .route("/api/v1/topics/{topic_id}/moderation", patch(moderate))
        .route("/api/v1/topics/{topic_id}/governance", patch(govern))
        .route("/api/v1/topics/{topic_id}/revisions", get(revisions))
        .route(
            "/api/v1/topics/{topic_id}/replies",
            get(list_replies)
                .post(create_reply)
                .layer(DefaultBodyLimit::max(REPLY_BODY_LIMIT)),
        )
        // Source: https://docs.rs/axum/0.8.9/axum/routing/method_routing/struct.MethodRouter.html#method.delete
        .route(
            "/api/v1/topics/{topic_id}/replies/{reply_id}",
            patch(update_reply)
                .delete(delete_reply)
                .layer(DefaultBodyLimit::max(REPLY_BODY_LIMIT)),
        )
        .route(
            "/api/v1/topics/{topic_id}/replies/{reply_id}/revisions",
            get(reply_revisions),
        )
        .layer(DefaultBodyLimit::max(TOPIC_BODY_LIMIT))
        .layer(Extension(runtime))
}

#[utoipa::path(
    get,
    path = "/api/v1/topics",
    operation_id = "listTopics",
    tag = "topics",
    params(ListTopicsQuery),
    responses(
        (status = 200, description = "Published topics matching the public filters", body = PageResponse<TopicSummary>, headers(("x-request-id" = String))),
        (status = 401, description = "The following feed requires an active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 422, description = "Invalid topic filters or cursor", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The topic database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListTopicsQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<PageResponse<TopicSummary>>), ApiError> {
    let Query(query) = query.map_err(|_| {
        read_error(validation_error(
            request_id,
            "query",
            "主题查询参数格式不正确",
        ))
    })?;
    let mut filters = validate_query(&query)
        .map_err(|(field, message)| read_error(validation_error(request_id, field, message)))?;
    let (viewer_user_id, response_headers) = if matches!(query.scope, Some(TopicScope::Following)) {
        let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
        filters.following_user_id = Some(session.user.id);
        (Some(session.user.id), HeaderMap::new())
    } else {
        let (session, response_headers) =
            authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
        (session.map(|session| session.user.id), response_headers)
    };
    filters.viewer_user_id = viewer_user_id;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    let fetch_limit = i64::from(limit) + 1;
    let mut records = database
        .list_public_topics(&filters, query.cursor, fetch_limit)
        .await
        .map_err(|error| match error {
            ListPublicTopicsError::InvalidCursor => read_error(validation_error(
                request_id,
                "cursor",
                "cursor 不属于当前主题结果集",
            )),
            ListPublicTopicsError::Database(error) => {
                tracing::warn!(
                    request_id = %request_id,
                    error = ?error,
                    "Public topic list query failed"
                );
                read_error(service_unavailable(request_id))
            }
        })?;

    let has_next_page = records.len() > usize::from(limit);
    records.truncate(usize::from(limit));
    let next_cursor = has_next_page.then(|| {
        records
            .last()
            .expect("a full topic page is non-empty")
            .id
            .to_string()
    });
    let topics = records
        .into_iter()
        .map(topic_summary)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| read_error(invalid_record(request_id)))?;

    Ok((
        response_headers,
        Json(PageResponse::new(topics, request_id, next_cursor)),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/moderation/boards",
    operation_id = "listModerationBoards",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<Vec<ModerationBoard>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_moderation_boards(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<ModerationBoard>>>, ApiError> {
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let records = database
        .list_moderation_boards(session.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Moderation board list query failed");
            read_error(service_unavailable(request_id))
        })?;
    let boards = records
        .into_iter()
        .map(moderation_board)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| read_error(invalid_record(request_id)))?;
    Ok(Json(ApiResponse::new(boards, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/moderation/topics",
    operation_id = "listModerationTopics",
    tag = "admin",
    params(ListModerationTopicsQuery),
    responses(
        (status = 200, body = PageResponse<ModerationTopic>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_moderation_topics(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListModerationTopicsQuery>, QueryRejection>,
) -> Result<Json<PageResponse<ModerationTopic>>, ApiError> {
    let Query(query) = query.map_err(|_| {
        read_error(validation_error(
            request_id,
            "query",
            "内容治理查询参数格式不正确",
        ))
    })?;
    let filters = validate_moderation_query(&query)
        .map_err(|(field, message)| read_error(validation_error(request_id, field, message)))?;
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    let mut records = database
        .list_moderation_topics(
            session.user.id,
            &filters,
            query.cursor,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|error| match error {
            ListModerationTopicsError::InvalidCursor => read_error(validation_error(
                request_id,
                "cursor",
                "cursor 不属于当前主题结果集",
            )),
            ListModerationTopicsError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = ?error, "Moderation topic list query failed");
                read_error(service_unavailable(request_id))
            }
        })?;
    let has_next_page = records.len() > usize::from(limit);
    records.truncate(usize::from(limit));
    let next_cursor = has_next_page.then(|| {
        records
            .last()
            .expect("a full moderation topic page is non-empty")
            .id
            .to_string()
    });
    let topics = records
        .into_iter()
        .map(moderation_topic)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| read_error(invalid_record(request_id)))?;
    Ok(Json(PageResponse::new(topics, request_id, next_cursor)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/moderation/topics/{topic_id}/history",
    operation_id = "listTopicModerationHistory",
    tag = "admin",
    params(("topic_id" = Uuid, Path), ListTopicModerationHistoryQuery),
    responses(
        (status = 200, body = PageResponse<TopicModerationHistoryEntry>, headers(("x-request-id" = String))),
        (status = 400, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_topic_moderation_history(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    query: Result<Query<ListTopicModerationHistoryQuery>, QueryRejection>,
) -> Result<Json<PageResponse<TopicModerationHistoryEntry>>, ApiError> {
    let Path(topic_id) = path.map_err(|_| create_path_invalid(request_id))?;
    let Query(query) = query.map_err(|_| {
        read_error(validation_error(
            request_id,
            "query",
            "处理记录查询参数格式不正确",
        ))
    })?;
    let limit = validate_topic_moderation_history_query(&query)
        .map_err(|(field, message)| read_error(validation_error(request_id, field, message)))?;
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUDIT_READ,
    )
    .await?;
    let mut records = database
        .list_topic_moderation_history(topic_id, query.cursor, i64::from(limit) + 1)
        .await
        .map_err(|error| match error {
            ListTopicModerationHistoryError::TopicUnavailable => {
                topic_moderation_not_found(request_id)
            }
            ListTopicModerationHistoryError::InvalidCursor => read_error(validation_error(
                request_id,
                "cursor",
                "cursor 不属于当前主题处理记录",
            )),
            ListTopicModerationHistoryError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Topic moderation history query failed");
                read_error(service_unavailable(request_id))
            }
        })?;
    let has_next_page = records.len() > usize::from(limit);
    records.truncate(usize::from(limit));
    let next_cursor = has_next_page.then(|| {
        records
            .last()
            .expect("a full topic moderation history page is non-empty")
            .id
            .to_string()
    });
    let entries = records
        .into_iter()
        .map(topic_moderation_history_entry)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| read_error(invalid_record(request_id)))?;
    Ok(Json(PageResponse::new(entries, request_id, next_cursor)))
}

#[utoipa::path(
    get,
    path = "/api/v1/tags",
    operation_id = "listTags",
    tag = "topics",
    responses(
        (status = 200, description = "Tags used by public topics", body = ApiResponse<Vec<TopicTag>>, headers(("x-request-id" = String))),
        (status = 503, description = "The tag database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_tags(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<ApiResponse<Vec<TopicTag>>>, (StatusCode, Json<ErrorResponse>)> {
    let records = database.list_public_tags().await.map_err(|error| {
        tracing::warn!(request_id = %request_id, error = ?error, "Public tag list query failed");
        service_unavailable(request_id)
    })?;
    let tags = records
        .into_iter()
        .map(|tag| TopicTag {
            slug: tag.slug,
            name: tag.name,
        })
        .collect();
    Ok(Json(ApiResponse::new(tags, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/topics",
    operation_id = "createTopic",
    tag = "topics",
    params(
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token"),
        ("Idempotency-Key" = Option<String>, Header, description = "Optional idempotency key for safe retries")
    ),
    request_body = CreateTopicRequest,
    responses(
        (status = 200, description = "The idempotent replay of an existing topic", body = ApiResponse<TopicDetail>, headers(("x-request-id" = String))),
        (status = 201, description = "The published topic", body = ApiResponse<TopicDetail>, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The requested board is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The idempotency key conflicts with a previous request", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The topic fields or request body are invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The topic database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn create(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<CreateTopicRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<TopicDetail>>), ApiError> {
    let Json(request) = request.map_err(|_| malformed_create_body(request_id))?;
    let input = validate_create_request(request)
        .map_err(|fields| create_validation_error(request_id, fields))?;
    let idempotency_key = parse_idempotency_key(&headers)
        .map_err(|fields| create_validation_error(request_id, fields))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let request_hash = request_hash(&input);
    let topic_id = Uuid::now_v7();
    let stored_content = storage_content(&input.content, input.rich_content.as_ref());
    let result = database
        .create_published_topic(
            NewTopicRecord {
                id: topic_id,
                board_id: input.board_id,
                author_id: session.user.id,
                title: input.title,
                excerpt: input.excerpt,
                content: stored_content,
                rich_content: input.rich_content,
                tags: input.tags,
            },
            idempotency_key.map(|key| IdempotencyInput { key, request_hash }),
        )
        .await
        .map_err(|error| match error {
            CreateTopicError::BoardUnavailable => topic_board_unavailable(request_id),
            CreateTopicError::BoardRestricted => board_posting_restricted(request_id),
            CreateTopicError::AuthorRestricted => user_action_restricted(request_id),
            CreateTopicError::PermissionDenied => community_permission_denied(request_id),
            CreateTopicError::QuotaExceeded => community_quota_exceeded(request_id),
            CreateTopicError::IdempotencyConflict => idempotency_conflict(request_id),
            CreateTopicError::AttachmentUnavailable => rich_attachment_unavailable(request_id),
            CreateTopicError::Database(error) => {
                tracing::warn!(
                    request_id = %request_id,
                    error = %error,
                    "Topic creation transaction failed"
                );
                service_unavailable_create(request_id)
            }
        })?;
    let record = database
        .public_topic_for_viewer(result.topic_id, Some(session.user.id))
        .await
        .map_err(|error| {
            tracing::warn!(
                request_id = %request_id,
                error = %error,
                "Created topic lookup failed"
            );
            service_unavailable_create(request_id)
        })?
        .ok_or_else(|| service_unavailable_create(request_id))?;
    let topic = topic_detail(record).map_err(|()| service_unavailable_create(request_id))?;
    let status = if result.created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(ApiResponse::new(topic, request_id))))
}

#[utoipa::path(
    get,
    path = "/api/v1/topics/{topic_id}",
    operation_id = "getTopic",
    tag = "topics",
    params(("topic_id" = Uuid, Path, description = "Topic identifier")),
    responses(
        (status = 200, description = "The published topic detail", body = ApiResponse<TopicDetail>, headers(("x-request-id" = String))),
        (status = 400, description = "The topic path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The topic is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The topic database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn detail(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<TopicDetail>>), ApiError> {
    let Path(topic_id) = path.map_err(|_| read_error(path_invalid(request_id)))?;
    let (session, response_headers) =
        authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
    let record = database
        .public_topic_for_viewer(topic_id, session.map(|session| session.user.id))
        .await
        .map_err(|error| {
            tracing::warn!(
                request_id = %request_id,
                error = ?error,
                "Public topic detail query failed"
            );
            read_error(service_unavailable(request_id))
        })?;
    let record = record.ok_or_else(|| read_error(not_found(request_id)))?;
    let topic = topic_detail(record).map_err(|()| read_error(invalid_record(request_id)))?;
    Ok((response_headers, Json(ApiResponse::new(topic, request_id))))
}

#[utoipa::path(
    patch,
    path = "/api/v1/topics/{topic_id}",
    operation_id = "updateTopic",
    tag = "topics",
    params(
        ("topic_id" = Uuid, Path, description = "Topic identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    request_body = UpdateTopicRequest,
    responses(
        (status = 200, description = "The updated topic", body = ApiResponse<TopicDetail>, headers(("x-request-id" = String))),
        (status = 400, description = "The topic path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The current user cannot edit this topic", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The topic is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The topic revision is stale", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The topic update is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The topic database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<UpdateTopicRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<TopicDetail>>), ApiError> {
    let Path(topic_id) = path.map_err(|_| create_path_invalid(request_id))?;
    let Json(request) = request.map_err(|_| malformed_update_body(request_id))?;
    let input = validate_update_request(request)
        .map_err(|fields| create_validation_error(request_id, fields))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let stored_content = match (&input.content, &input.rich_content) {
        (Some(content), rich_content) => Some(storage_content(content, rich_content.as_ref())),
        (None, _) => None,
    };
    let result = database
        .update_published_topic(UpdateTopicRecord {
            topic_id,
            author_id: session.user.id,
            base_revision: input.base_revision,
            title: input.title,
            excerpt: input.excerpt,
            content: stored_content,
            rich_content: input.rich_content,
            tags: input.tags,
        })
        .await
        .map_err(|error| match error {
            UpdateTopicError::TopicUnavailable => create_not_found(request_id),
            UpdateTopicError::Forbidden => topic_edit_forbidden(request_id),
            UpdateTopicError::RevisionConflict => topic_revision_conflict(request_id),
            UpdateTopicError::AttachmentUnavailable => rich_attachment_unavailable(request_id),
            UpdateTopicError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Topic update failed");
                service_unavailable_create(request_id)
            }
        })?;
    let record = database
        .public_topic_for_viewer(result.topic_id, Some(session.user.id))
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Updated topic lookup failed");
            service_unavailable_create(request_id)
        })?
        .ok_or_else(|| service_unavailable_create(request_id))?;
    let topic = topic_detail(record).map_err(|()| service_unavailable_create(request_id))?;
    Ok((StatusCode::OK, Json(ApiResponse::new(topic, request_id))))
}

#[utoipa::path(
    delete,
    path = "/api/v1/topics/{topic_id}",
    operation_id = "deleteTopic",
    tag = "topics",
    params(("topic_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    responses(
        (status = 200, body = ApiResponse<bool>),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn delete_topic(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<bool>>, ApiError> {
    let Path(topic_id) = path.map_err(|_| create_path_invalid(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    database
        .delete_published_topic(topic_id, session.user.id)
        .await
        .map_err(|error| match error {
            TopicDeleteError::Unavailable => create_not_found(request_id),
            TopicDeleteError::Forbidden => topic_delete_forbidden(request_id),
            TopicDeleteError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Topic deletion failed");
                service_unavailable_create(request_id)
            }
        })?;
    Ok(Json(ApiResponse::new(true, request_id)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/topics/{topic_id}/moderation",
    operation_id = "moderateTopic",
    tag = "topics",
    params(("topic_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = ModerateTopicRequest,
    responses(
        (status = 200, body = ApiResponse<TopicModerationResult>, headers(("x-request-id" = String))),
        (status = 400, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn moderate(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<ModerateTopicRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<TopicModerationResult>>, ApiError> {
    let Path(topic_id) = path.map_err(|_| create_path_invalid(request_id))?;
    let Json(request) = request.map_err(|_| malformed_moderation_body(request_id))?;
    let status = moderation_status(request.status);
    if request.reason.as_deref().is_some_and(|reason| {
        !(1..=1000).contains(&reason.chars().count()) || reason.chars().any(char::is_control)
    }) {
        let mut fields = FieldErrors::new();
        add_field_error(
            &mut fields,
            "reason",
            "reason 必须为 1 到 1000 个字符且不能包含控制字符",
        );
        return Err(create_validation_error(request_id, fields));
    }
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let result = database
        .moderate_topic(topic_id, session.user.id, status, request.reason.as_deref())
        .await
        .map_err(|error| match error {
            TopicModerationError::Unavailable => topic_moderation_not_found(request_id),
            TopicModerationError::Forbidden => topic_moderation_forbidden(request_id),
            TopicModerationError::InvalidStatus => malformed_moderation_body(request_id),
            TopicModerationError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Topic moderation failed");
                service_unavailable_create(request_id)
            }
        })?;
    Ok(Json(ApiResponse::new(
        TopicModerationResult {
            topic_id: result.topic_id,
            status: match result.status.as_str() {
                "approved" => TopicModerationStatus::Approved,
                "hidden" => TopicModerationStatus::Hidden,
                "rejected" => TopicModerationStatus::Rejected,
                _ => return Err(service_unavailable_create(request_id)),
            },
        },
        request_id,
    )))
}

#[utoipa::path(
    patch,
    path = "/api/v1/topics/{topic_id}/governance",
    operation_id = "governTopic",
    tag = "topics",
    params(("topic_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = GovernTopicRequest,
    responses(
        (status = 200, body = ApiResponse<TopicGovernanceResult>, headers(("x-request-id" = String))),
        (status = 400, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn govern(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<GovernTopicRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<TopicGovernanceResult>>, ApiError> {
    let Path(topic_id) = path.map_err(|_| create_path_invalid(request_id))?;
    let Json(request) = request.map_err(|_| topic_governance_invalid(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let action = match request.action {
        TopicGovernanceAction::Pin => InfrastructureGovernanceAction::Pin,
        TopicGovernanceAction::Unpin => InfrastructureGovernanceAction::Unpin,
        TopicGovernanceAction::Feature => InfrastructureGovernanceAction::Feature,
        TopicGovernanceAction::Unfeature => InfrastructureGovernanceAction::Unfeature,
        TopicGovernanceAction::Lock => InfrastructureGovernanceAction::Lock,
        TopicGovernanceAction::Unlock => InfrastructureGovernanceAction::Unlock,
        TopicGovernanceAction::Move => InfrastructureGovernanceAction::Move,
    };
    let result = database
        .govern_topic(TopicGovernanceInput {
            topic_id,
            actor_id: session.user.id,
            action,
            expected_revision: request.expected_revision,
            target_board_id: request.target_board_id,
            reason: request.reason,
        })
        .await
        .map_err(|error| match error {
            TopicGovernanceError::Unavailable => topic_moderation_not_found(request_id),
            TopicGovernanceError::Forbidden => topic_governance_forbidden(request_id),
            TopicGovernanceError::InvalidInput => topic_governance_invalid(request_id),
            TopicGovernanceError::RevisionConflict => topic_governance_conflict(request_id),
            TopicGovernanceError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Topic governance failed");
                service_unavailable_create(request_id)
            }
            TopicGovernanceError::Outbox(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Topic governance outbox failed");
                service_unavailable_create(request_id)
            }
        })?;
    Ok(Json(ApiResponse::new(
        TopicGovernanceResult {
            topic_id: result.topic_id,
            board_id: result.board_id,
            is_pinned: result.is_pinned,
            is_featured: result.is_featured,
            is_locked: result.is_locked,
            governance_revision: result.governance_revision,
        },
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/topics/{topic_id}/revisions",
    operation_id = "listTopicRevisions",
    tag = "topics",
    params(("topic_id" = Uuid, Path, description = "Topic identifier")),
    responses(
        (status = 200, description = "The current user's topic revisions", body = ApiResponse<Vec<TopicRevision>>, headers(("x-request-id" = String))),
        (status = 400, description = "The topic path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 404, description = "The topic is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The revision database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn revisions(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<Vec<TopicRevision>>>, ApiError> {
    let Path(topic_id) = path.map_err(|_| create_path_invalid(request_id))?;
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let records = database
        .list_topic_revisions(topic_id, session.user.id)
        .await
        .map_err(|error| match error {
            ListTopicRevisionsError::TopicUnavailable => create_not_found(request_id),
            ListTopicRevisionsError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Topic revision query failed");
                service_unavailable_create(request_id)
            }
        })?
        .ok_or_else(|| create_not_found(request_id))?;
    let revisions = records
        .into_iter()
        .map(topic_revision)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| service_unavailable_create(request_id))?;
    Ok(Json(ApiResponse::new(revisions, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/topics/{topic_id}/replies",
    operation_id = "listTopicReplies",
    tag = "topics",
    params(
        ("topic_id" = Uuid, Path, description = "Topic identifier"),
        ListRepliesQuery
    ),
    responses(
        (status = 200, description = "Published replies in chronological order", body = PageResponse<TopicReply>, headers(("x-request-id" = String))),
        (status = 400, description = "The topic path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The topic is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "Invalid reply pagination parameters", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The reply database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_replies(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    query: Result<Query<ListRepliesQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<PageResponse<TopicReply>>), ApiError> {
    let Path(topic_id) = path.map_err(|_| read_error(path_invalid(request_id)))?;
    let Query(query) = query.map_err(|_| {
        read_error(validation_error(
            request_id,
            "query",
            "回复查询参数格式不正确",
        ))
    })?;
    let limit = validate_reply_query(&query)
        .map_err(|(field, message)| read_error(validation_error(request_id, field, message)))?;
    let (session, response_headers) =
        authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
    let mut records = database
        .list_public_replies_for_viewer(
            topic_id,
            session.map(|session| session.user.id),
            query.cursor,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|error| match error {
            ListPublicRepliesError::InvalidCursor => read_error(validation_error(
                request_id,
                "cursor",
                "cursor 不属于当前回复结果集",
            )),
            ListPublicRepliesError::Database(error) => {
                tracing::warn!(
                    request_id = %request_id,
                    error = ?error,
                    "Public reply list query failed"
                );
                read_error(service_unavailable(request_id))
            }
        })?
        .ok_or_else(|| read_error(not_found(request_id)))?;

    let has_next_page = records.len() > usize::from(limit);
    records.truncate(usize::from(limit));
    let next_cursor = has_next_page.then(|| {
        records
            .last()
            .expect("a full reply page is non-empty")
            .id
            .to_string()
    });
    let replies = records
        .into_iter()
        .map(topic_reply)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| read_error(invalid_record(request_id)))?;

    Ok((
        response_headers,
        Json(PageResponse::new(replies, request_id, next_cursor)),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/topics/{topic_id}/replies",
    operation_id = "createTopicReply",
    tag = "topics",
    params(
        ("topic_id" = Uuid, Path, description = "Topic identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token"),
        ("Idempotency-Key" = Option<String>, Header, description = "Optional idempotency key for safe retries")
    ),
    request_body = CreateReplyRequest,
    responses(
        (status = 200, description = "The idempotent replay of an existing reply", body = ApiResponse<TopicReply>, headers(("x-request-id" = String))),
        (status = 201, description = "The published reply", body = ApiResponse<TopicReply>, headers(("x-request-id" = String))),
        (status = 400, description = "The topic path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The topic is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The idempotency key conflicts with a previous request", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The reply content or request body is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The reply database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn create_reply(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<CreateReplyRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<TopicReply>>), ApiError> {
    let Path(topic_id) = path.map_err(|_| create_path_invalid(request_id))?;
    let Json(request) = request.map_err(|_| malformed_reply_body(request_id))?;
    let input = validate_create_reply(request)
        .map_err(|fields| create_validation_error(request_id, fields))?;
    let idempotency_key = parse_idempotency_key(&headers)
        .map_err(|fields| create_validation_error(request_id, fields))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let request_hash = reply_request_hash(topic_id, &input);
    let reply_id = Uuid::now_v7();
    let stored_content = storage_content(&input.content, input.rich_content.as_ref());
    let result = database
        .create_published_reply(
            NewReplyRecord {
                id: reply_id,
                revision_id: Uuid::now_v7(),
                topic_id,
                author_id: session.user.id,
                content: stored_content,
                rich_content: input.rich_content,
                reply_to_id: input.reply_to_id,
            },
            idempotency_key.map(|key| IdempotencyInput { key, request_hash }),
        )
        .await
        .map_err(|error| match error {
            CreateReplyError::TopicUnavailable => create_not_found(request_id),
            CreateReplyError::TopicLocked => topic_locked(request_id),
            CreateReplyError::BoardRestricted => board_posting_restricted(request_id),
            CreateReplyError::AuthorRestricted => user_action_restricted(request_id),
            CreateReplyError::PermissionDenied => community_permission_denied(request_id),
            CreateReplyError::QuotaExceeded => community_quota_exceeded(request_id),
            CreateReplyError::IdempotencyConflict => idempotency_conflict(request_id),
            CreateReplyError::InvalidReplyTarget => {
                let mut fields = FieldErrors::new();
                add_field_error(
                    &mut fields,
                    "reply_to_id",
                    "被回复楼层不存在或不属于当前主题",
                );
                create_validation_error(request_id, fields)
            }
            CreateReplyError::AttachmentUnavailable => rich_attachment_unavailable(request_id),
            CreateReplyError::Database(error) => {
                tracing::warn!(
                    request_id = %request_id,
                    error = %error,
                    "Reply creation transaction failed"
                );
                service_unavailable_create_reply(request_id)
            }
        })?;
    let record = database
        .public_reply_for_viewer(result.reply_id, Some(session.user.id))
        .await
        .map_err(|error| {
            tracing::warn!(
                request_id = %request_id,
                error = %error,
                "Created reply lookup failed"
            );
            service_unavailable_create_reply(request_id)
        })?
        .ok_or_else(|| service_unavailable_create_reply(request_id))?;
    let reply = topic_reply(record).map_err(|()| service_unavailable_create_reply(request_id))?;
    let status = if result.created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(ApiResponse::new(reply, request_id))))
}

#[utoipa::path(
    patch,
    path = "/api/v1/topics/{topic_id}/replies/{reply_id}",
    operation_id = "updateTopicReply",
    tag = "topics",
    params(
        ("topic_id" = Uuid, Path, description = "Topic identifier"),
        ("reply_id" = Uuid, Path, description = "Reply identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    request_body = UpdateReplyRequest,
    responses(
        (status = 200, description = "The updated reply", body = ApiResponse<TopicReply>, headers(("x-request-id" = String))),
        (status = 400, description = "The reply path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The reply is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The reply revision is stale", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The reply update is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The reply database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update_reply(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    request: Result<Json<UpdateReplyRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<TopicReply>>), ApiError> {
    let Path((topic_id, reply_id)) = path.map_err(|_| reply_path_invalid(request_id))?;
    let Json(request) = request.map_err(|_| malformed_reply_body(request_id))?;
    let input = validate_update_reply(request)
        .map_err(|fields| create_validation_error(request_id, fields))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let stored_content = storage_content(&input.content, input.rich_content.as_ref());
    let result = database
        .update_published_reply(UpdateReplyRecord {
            topic_id,
            reply_id,
            author_id: session.user.id,
            base_revision: input.base_revision,
            content: stored_content,
            rich_content: input.rich_content,
        })
        .await
        .map_err(|error| reply_mutation_error(error, request_id, "Reply update failed"))?;
    let record = database
        .public_reply_for_viewer(result.reply_id, Some(session.user.id))
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Updated reply lookup failed");
            service_unavailable_reply_mutation(request_id)
        })?
        .ok_or_else(|| service_unavailable_reply_mutation(request_id))?;
    let reply = topic_reply(record).map_err(|()| service_unavailable_reply_mutation(request_id))?;
    Ok((StatusCode::OK, Json(ApiResponse::new(reply, request_id))))
}

#[utoipa::path(
    get,
    path = "/api/v1/topics/{topic_id}/replies/{reply_id}/revisions",
    operation_id = "listTopicReplyRevisions",
    tag = "topics",
    params(
        ("topic_id" = Uuid, Path, description = "Topic identifier"),
        ("reply_id" = Uuid, Path, description = "Reply identifier")
    ),
    responses(
        (status = 200, description = "The current author's reply revisions", body = ApiResponse<Vec<ReplyRevision>>, headers(("x-request-id" = String))),
        (status = 400, description = "The reply path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 404, description = "The reply is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The reply revision database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn reply_revisions(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ApiResponse<Vec<ReplyRevision>>>, ApiError> {
    let Path((topic_id, reply_id)) = path.map_err(|_| reply_path_invalid(request_id))?;
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let records = database
        .list_reply_revisions(topic_id, reply_id, session.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Reply revision query failed");
            service_unavailable_reply_mutation(request_id)
        })?
        .ok_or_else(|| reply_not_found(request_id))?;
    let revisions = records
        .into_iter()
        .map(reply_revision)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| service_unavailable_reply_mutation(request_id))?;
    Ok(Json(ApiResponse::new(revisions, request_id)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/topics/{topic_id}/replies/{reply_id}",
    operation_id = "deleteTopicReply",
    tag = "topics",
    params(
        ("topic_id" = Uuid, Path, description = "Topic identifier"),
        ("reply_id" = Uuid, Path, description = "Reply identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The reply was soft deleted", body = ApiResponse<bool>, headers(("x-request-id" = String))),
        (status = 400, description = "The reply path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The reply is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The reply database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn delete_reply(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<(StatusCode, Json<ApiResponse<bool>>), ApiError> {
    let Path((topic_id, reply_id)) = path.map_err(|_| reply_path_invalid(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    database
        .delete_published_reply(topic_id, reply_id, session.user.id)
        .await
        .map_err(|error| reply_mutation_error(error, request_id, "Reply deletion failed"))?;
    Ok((StatusCode::OK, Json(ApiResponse::new(true, request_id))))
}

fn validate_query(
    query: &ListTopicsQuery,
) -> Result<PublicTopicFilters, (&'static str, &'static str)> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }

    let board_slug = query.board.as_deref().map(str::trim);
    if board_slug.is_some_and(|slug| !valid_board_slug(slug)) {
        return Err(("board", "board 必须是有效的板块 slug"));
    }

    let search = query.query.as_deref().map(str::trim);
    if search.is_some_and(|value| {
        !(1..=100).contains(&value.chars().count()) || value.chars().any(char::is_control)
    }) {
        return Err(("query", "query 必须为 1 到 100 个有效字符"));
    }

    let tag_slug = query.tag.as_deref().map(str::trim);
    if tag_slug.is_some_and(|slug| !valid_tag_slug(slug)) {
        return Err(("tag", "tag 必须是有效的标签 slug"));
    }

    let author_username = query.author.as_deref().map(str::trim);
    if author_username.is_some_and(|username| !valid_author_username(username)) {
        return Err(("author", "author 必须是有效用户名"));
    }

    let sort = match query.sort.unwrap_or_default() {
        TopicSort::Latest => InfrastructureTopicSort::Latest,
        TopicSort::Popular => InfrastructureTopicSort::Popular,
        TopicSort::Active => InfrastructureTopicSort::Active,
    };
    Ok(PublicTopicFilters {
        board_slug: board_slug.map(str::to_owned),
        search: search.map(str::to_owned),
        tag_slug: tag_slug.map(str::to_owned),
        author_username: author_username.map(str::to_owned),
        following_user_id: None,
        viewer_user_id: None,
        featured_only: query.featured.unwrap_or(false),
        sort,
    })
}

fn validate_moderation_query(
    query: &ListModerationTopicsQuery,
) -> Result<ModerationTopicFilters, (&'static str, &'static str)> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }
    let search = query.query.as_deref().map(str::trim);
    if search.is_some_and(|value| {
        !(1..=100).contains(&value.chars().count()) || value.chars().any(char::is_control)
    }) {
        return Err(("query", "query 必须为 1 到 100 个有效字符"));
    }
    Ok(ModerationTopicFilters {
        board_id: query.board_id,
        search: search.filter(|value| !value.is_empty()).map(str::to_owned),
    })
}

fn validate_topic_moderation_history_query(
    query: &ListTopicModerationHistoryQuery,
) -> Result<u16, (&'static str, &'static str)> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }
    Ok(limit)
}

fn valid_author_username(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    value.len() <= 32
        && value.len() >= 3
        && first.is_ascii_lowercase()
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn validate_reply_query(query: &ListRepliesQuery) -> Result<u16, (&'static str, &'static str)> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }
    Ok(limit)
}

fn validate_create_request(
    request: CreateTopicRequest,
) -> Result<ValidatedCreateTopic, FieldErrors> {
    let mut fields = FieldErrors::new();
    let title = request.title.trim().to_owned();
    let (content, rich_content) = validate_body_content(
        request.content,
        request.rich_content,
        1_000_000,
        "正文必须为 1 到 1,000,000 个字符且不能包含非法控制字符",
        &mut fields,
    );
    let tags = validate_tags(request.tags, &mut fields);
    if !(1..=160).contains(&title.chars().count()) || title.chars().any(char::is_control) {
        add_field_error(
            &mut fields,
            "title",
            "标题必须为 1 到 160 个字符且不能包含控制字符",
        );
    }
    if fields.is_empty() {
        let excerpt_source = rich_content
            .clone()
            .map(|document| redact_reply_gates(document, false).plain_text)
            .unwrap_or_else(|| content.clone());
        let excerpt = excerpt_source
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(500)
            .collect();
        Ok(ValidatedCreateTopic {
            board_id: request.board_id,
            title,
            content,
            rich_content,
            excerpt,
            tags,
        })
    } else {
        Err(fields)
    }
}

fn validate_tags(inputs: Vec<TopicTagInput>, fields: &mut FieldErrors) -> Vec<NewTagRecord> {
    if inputs.len() > 5 {
        add_field_error(fields, "tags", "每个主题最多 5 个标签");
    }
    let mut tags = Vec::new();
    for input in inputs.into_iter().take(5) {
        let slug = input.slug.trim().to_owned();
        let name = input.name.trim().to_owned();
        let valid_slug = valid_tag_slug(&slug);
        let valid_name =
            (1..=40).contains(&name.chars().count()) && !name.chars().any(char::is_control);
        if !valid_slug {
            add_field_error(
                fields,
                "tags",
                "标签 slug 必须为 1 到 40 位小写字母、数字或连字符",
            );
        }
        if !valid_name {
            add_field_error(
                fields,
                "tags",
                "标签名称必须为 1 到 40 个字符且不能包含控制字符",
            );
        }
        if valid_slug && valid_name {
            if tags.iter().any(|tag: &NewTagRecord| tag.slug == slug) {
                add_field_error(fields, "tags", "标签 slug 不能重复");
            } else {
                tags.push(NewTagRecord { slug, name });
            }
        }
    }
    tags
}

fn validate_create_reply(request: CreateReplyRequest) -> Result<ValidatedCreateReply, FieldErrors> {
    let mut fields = FieldErrors::new();
    let CreateReplyRequest {
        content,
        rich_content,
        reply_to_id,
    } = request;
    let (content, rich_content) = validate_body_content(
        content,
        rich_content,
        100_000,
        "回复必须为 1 到 100,000 个字符且不能包含非法控制字符",
        &mut fields,
    );
    if fields.is_empty() {
        Ok(ValidatedCreateReply {
            content,
            rich_content,
            reply_to_id,
        })
    } else {
        Err(fields)
    }
}

fn validate_update_reply(request: UpdateReplyRequest) -> Result<ValidatedUpdateReply, FieldErrors> {
    let mut fields = FieldErrors::new();
    if request.base_revision == 0 || request.base_revision > i32::MAX as u32 {
        add_field_error(&mut fields, "base_revision", "base_revision 必须是正整数");
    }
    let (content, rich_content) = validate_body_content(
        request.content,
        request.rich_content,
        100_000,
        "回复必须为 1 到 100,000 个字符且不能包含非法控制字符",
        &mut fields,
    );
    if fields.is_empty() {
        Ok(ValidatedUpdateReply {
            base_revision: request.base_revision as i32,
            content,
            rich_content,
        })
    } else {
        Err(fields)
    }
}

fn validate_update_request(
    request: UpdateTopicRequest,
) -> Result<ValidatedUpdateTopic, FieldErrors> {
    let mut fields = FieldErrors::new();
    if request.base_revision == 0 || request.base_revision > i32::MAX as u32 {
        add_field_error(&mut fields, "base_revision", "base_revision 必须是正整数");
    }
    let title = request.title.map(|value| value.trim().to_owned());
    if title.as_deref().is_some_and(|value| {
        !(1..=160).contains(&value.chars().count()) || value.chars().any(char::is_control)
    }) {
        add_field_error(
            &mut fields,
            "title",
            "标题必须为 1 到 160 个字符且不能包含控制字符",
        );
    }
    let (content, rich_content) = if let Some(rich_content) = request.rich_content {
        match validate_and_project(rich_content, 1_000_000) {
            Ok((rich_content, content)) => (Some(content), Some(rich_content)),
            Err(_) => {
                add_field_error(
                    &mut fields,
                    "rich_content",
                    "富文本正文包含不支持或不安全的内容",
                );
                (request.content.map(|value| value.trim().to_owned()), None)
            }
        }
    } else {
        let content = request.content.map(|value| value.trim().to_owned());
        if content.as_deref().is_some_and(|value| {
            !(1..=1_000_000).contains(&value.chars().count())
                || value.chars().any(disallowed_content_control)
        }) {
            add_field_error(
                &mut fields,
                "content",
                "正文必须为 1 到 1,000,000 个字符且不能包含非法控制字符",
            );
        }
        (content, None)
    };
    let tags = request
        .tags
        .map(|values| validate_tags(values, &mut fields));
    if title.is_none() && content.is_none() && tags.is_none() {
        add_field_error(&mut fields, "body", "至少需要修改标题、正文或标签");
    }
    if fields.is_empty() {
        let excerpt_source = rich_content
            .clone()
            .map(|document| redact_reply_gates(document, false).plain_text)
            .or_else(|| content.clone());
        let excerpt = excerpt_source.as_deref().map(|value| {
            value
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(500)
                .collect()
        });
        Ok(ValidatedUpdateTopic {
            base_revision: request.base_revision as i32,
            title,
            excerpt,
            content,
            rich_content,
            tags,
        })
    } else {
        Err(fields)
    }
}

fn validate_body_content(
    fallback_content: String,
    rich_content: Option<serde_json::Value>,
    max_chars: usize,
    plain_content_message: &'static str,
    fields: &mut FieldErrors,
) -> (String, Option<serde_json::Value>) {
    if let Some(rich_content) = rich_content {
        return match validate_and_project(rich_content, max_chars) {
            Ok((rich_content, content)) => (content, Some(rich_content)),
            Err(_) => {
                add_field_error(fields, "rich_content", "富文本正文包含不支持或不安全的内容");
                (fallback_content.trim().to_owned(), None)
            }
        };
    }
    let content = fallback_content.trim().to_owned();
    if !(1..=max_chars).contains(&content.chars().count())
        || content.chars().any(disallowed_content_control)
    {
        add_field_error(fields, "content", plain_content_message);
    }
    (content, None)
}

fn disallowed_content_control(character: char) -> bool {
    character.is_control() && !matches!(character, '\n' | '\r' | '\t')
}

fn parse_idempotency_key(headers: &HeaderMap) -> Result<Option<String>, FieldErrors> {
    let Some(value) = headers.get("idempotency-key") else {
        return Ok(None);
    };
    let mut fields = FieldErrors::new();
    let key = value.to_str().ok().map(str::trim).unwrap_or_default();
    if !(1..=255).contains(&key.len()) || !key.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        add_field_error(
            &mut fields,
            "idempotency_key",
            "Idempotency-Key 必须为 1 到 255 个可打印 ASCII 字符",
        );
    }
    if fields.is_empty() {
        Ok(Some(key.to_owned()))
    } else {
        Err(fields)
    }
}

fn request_hash(input: &ValidatedCreateTopic) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(input.board_id.map(|id| id.to_string()).unwrap_or_default());
    hasher.update([0]);
    hasher.update(input.title.as_bytes());
    hasher.update([0]);
    hasher.update(input.content.as_bytes());
    if let Some(rich_content) = &input.rich_content {
        hasher.update([0]);
        hasher.update(serde_json::to_vec(rich_content).expect("validated rich content is JSON"));
    }
    for tag in &input.tags {
        hasher.update([0]);
        hasher.update(tag.slug.as_bytes());
        hasher.update([0]);
        hasher.update(tag.name.as_bytes());
    }
    hasher.finalize().to_vec()
}

fn reply_request_hash(topic_id: Uuid, input: &ValidatedCreateReply) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(topic_id.as_bytes());
    hasher.update([0]);
    hasher.update(input.content.as_bytes());
    if let Some(rich_content) = &input.rich_content {
        hasher.update([0]);
        hasher.update(serde_json::to_vec(rich_content).expect("validated rich content is JSON"));
    }
    if let Some(reply_to_id) = input.reply_to_id {
        hasher.update([0]);
        hasher.update(reply_to_id.as_bytes());
    }
    hasher.finalize().to_vec()
}

fn add_field_error(fields: &mut FieldErrors, field: &'static str, message: &'static str) {
    fields
        .entry(field.to_owned())
        .or_default()
        .push(message.to_owned());
}

fn valid_board_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn valid_tag_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn topic_detail(record: PublicTopicDetailRecord) -> Result<TopicDetail, ()> {
    let (content, rich_content, has_locked_content) = redact_record_content(
        record.content,
        record.rich_content,
        record.reply_gate_unlocked,
    );
    Ok(TopicDetail {
        summary: topic_summary(record.summary)?,
        content,
        rich_content,
        has_locked_content,
        content_revision: u32::try_from(record.content_revision).map_err(|_| ())?,
    })
}

pub(crate) fn topic_summary(record: PublicTopicRecord) -> Result<TopicSummary, ()> {
    Ok(TopicSummary {
        id: record.id,
        title: record.title,
        excerpt: record.excerpt,
        author: TopicAuthorSummary {
            id: record.author_id,
            username: record.author_username,
            display_name: record.author_display_name,
            avatar_url: record.author_avatar_url,
        },
        board: TopicBoardSummary {
            id: record.board_id,
            slug: record.board_slug,
            name: record.board_name,
            tone: board_tone(&record.board_tone)?,
        },
        published_at: format_timestamp(record.published_at)?,
        last_activity_at: format_timestamp(record.last_activity_at)?,
        reply_count: u64::try_from(record.reply_count).map_err(|_| ())?,
        like_count: u64::try_from(record.like_count).map_err(|_| ())?,
        viewer_bookmarked: record.viewer_bookmarked,
        viewer_liked: record.viewer_liked,
        view_count: u64::try_from(record.view_count).map_err(|_| ())?,
        is_featured: record.is_featured,
        is_pinned: record.is_pinned,
        tags: record
            .tags
            .into_iter()
            .map(|tag| TopicTag {
                slug: tag.slug,
                name: tag.name,
            })
            .collect(),
    })
}

fn moderation_board(record: infrastructure::ModerationBoardRecord) -> Result<ModerationBoard, ()> {
    Ok(ModerationBoard {
        id: record.id,
        slug: record.slug,
        name: record.name,
        tone: board_tone(&record.tone)?,
        capability_keys: record.capability_keys,
    })
}

fn moderation_topic(record: infrastructure::ModerationTopicRecord) -> Result<ModerationTopic, ()> {
    let moderation_status = match record.moderation_status.as_str() {
        "approved" => TopicModerationStatus::Approved,
        "hidden" => TopicModerationStatus::Hidden,
        "rejected" => TopicModerationStatus::Rejected,
        _ => return Err(()),
    };
    Ok(ModerationTopic {
        id: record.id,
        title: record.title,
        excerpt: record.excerpt,
        author: TopicAuthorSummary {
            id: record.author_id,
            username: record.author_username,
            display_name: record.author_display_name,
            avatar_url: record.author_avatar_url,
        },
        board: TopicBoardSummary {
            id: record.board_id,
            slug: record.board_slug,
            name: record.board_name,
            tone: board_tone(&record.board_tone)?,
        },
        published_at: format_timestamp(record.published_at)?,
        last_activity_at: format_timestamp(record.last_activity_at)?,
        reply_count: u64::try_from(record.reply_count).map_err(|_| ())?,
        like_count: u64::try_from(record.like_count).map_err(|_| ())?,
        view_count: u64::try_from(record.view_count).map_err(|_| ())?,
        moderation_status,
        governance_revision: record.governance_revision,
        is_featured: record.is_featured,
        is_pinned: record.is_pinned,
        is_locked: record.is_locked,
    })
}

fn topic_moderation_history_entry(
    record: infrastructure::TopicModerationHistoryRecord,
) -> Result<TopicModerationHistoryEntry, ()> {
    let source = match record.source.as_str() {
        "moderation" => TopicModerationHistorySource::Moderation,
        "governance" => TopicModerationHistorySource::Governance,
        _ => return Err(()),
    };
    let action = match record.action.as_str() {
        "approved" => TopicModerationHistoryAction::Approved,
        "hidden" => TopicModerationHistoryAction::Hidden,
        "rejected" => TopicModerationHistoryAction::Rejected,
        "pin" => TopicModerationHistoryAction::Pin,
        "unpin" => TopicModerationHistoryAction::Unpin,
        "feature" => TopicModerationHistoryAction::Feature,
        "unfeature" => TopicModerationHistoryAction::Unfeature,
        "lock" => TopicModerationHistoryAction::Lock,
        "unlock" => TopicModerationHistoryAction::Unlock,
        "move" => TopicModerationHistoryAction::Move,
        _ => return Err(()),
    };
    Ok(TopicModerationHistoryEntry {
        id: record.id,
        source,
        action,
        actor: UserSummary {
            id: record.actor_id,
            username: record.actor_username,
            display_name: record.actor_display_name,
            avatar_url: record.actor_avatar_url,
        },
        reason: record.reason,
        created_at: format_timestamp(record.created_at)?,
    })
}

fn topic_reply(record: PublicReplyRecord) -> Result<TopicReply, ()> {
    let reply_to = match record.reply_to_id {
        Some(id) => {
            let is_deleted = record.reply_to_is_deleted.ok_or(())?;
            let excerpt = if is_deleted {
                None
            } else if let Some(rich_content) = record.reply_to_rich_content {
                quote_excerpt(
                    &redact_reply_gates(rich_content, record.reply_gate_unlocked).plain_text,
                )
            } else {
                record.reply_to_excerpt
            };
            Some(ReplyReference {
                id,
                floor_number: u64::try_from(record.reply_to_floor_number.ok_or(())?)
                    .map_err(|_| ())?,
                author: TopicAuthorSummary {
                    id: record.reply_to_author_id.ok_or(())?,
                    username: record.reply_to_author_username.ok_or(())?,
                    display_name: record.reply_to_author_display_name.ok_or(())?,
                    avatar_url: record.reply_to_author_avatar_url,
                },
                excerpt,
                is_deleted,
            })
        }
        None => None,
    };
    let (content, rich_content, has_locked_content) = redact_record_content(
        record.content,
        record.rich_content,
        record.reply_gate_unlocked,
    );
    Ok(TopicReply {
        id: record.id,
        topic_id: record.topic_id,
        floor_number: u64::try_from(record.floor_number).map_err(|_| ())?,
        reply_to,
        author: TopicAuthorSummary {
            id: record.author_id,
            username: record.author_username,
            display_name: record.author_display_name,
            avatar_url: record.author_avatar_url,
        },
        content,
        rich_content,
        has_locked_content,
        created_at: format_timestamp(record.created_at)?,
        updated_at: format_timestamp(record.updated_at)?,
        revision_count: u32::try_from(record.revision_count).map_err(|_| ())?,
        like_count: u64::try_from(record.like_count).map_err(|_| ())?,
        viewer_liked: record.viewer_liked,
    })
}

fn quote_excerpt(content: &str) -> Option<String> {
    let excerpt = content.chars().take(160).collect::<String>();
    (!excerpt.is_empty()).then_some(excerpt)
}

fn storage_content(content: &str, rich_content: Option<&serde_json::Value>) -> String {
    rich_content
        .cloned()
        .map(|document| redact_reply_gates(document, false).plain_text)
        .unwrap_or_else(|| content.to_owned())
}

fn redact_record_content(
    content: String,
    rich_content: Option<serde_json::Value>,
    unlocked: bool,
) -> (String, Option<serde_json::Value>, bool) {
    let Some(rich_content) = rich_content else {
        return (content, None, false);
    };
    let projection = redact_reply_gates(rich_content, unlocked);
    (
        projection.plain_text,
        Some(projection.document),
        projection.has_locked_content,
    )
}

fn topic_revision(record: infrastructure::TopicRevisionRecord) -> Result<TopicRevision, ()> {
    Ok(TopicRevision {
        id: record.id,
        topic_id: record.topic_id,
        revision_number: u32::try_from(record.revision_number).map_err(|_| ())?,
        editor: TopicAuthorSummary {
            id: record.editor_id,
            username: record.editor_username,
            display_name: record.editor_display_name,
            avatar_url: record.editor_avatar_url,
        },
        content: record.content,
        rich_content: record.rich_content,
        created_at: format_timestamp(record.created_at)?,
    })
}

fn reply_revision(record: infrastructure::ReplyRevisionRecord) -> Result<ReplyRevision, ()> {
    Ok(ReplyRevision {
        id: record.id,
        reply_id: record.reply_id,
        revision_number: u32::try_from(record.revision_number).map_err(|_| ())?,
        editor: TopicAuthorSummary {
            id: record.editor_id,
            username: record.editor_username,
            display_name: record.editor_display_name,
            avatar_url: record.editor_avatar_url,
        },
        content: record.content,
        rich_content: record.rich_content,
        created_at: format_timestamp(record.created_at)?,
    })
}

fn board_tone(value: &str) -> Result<BoardTone, ()> {
    match value {
        "green" => Ok(BoardTone::Green),
        "blue" => Ok(BoardTone::Blue),
        "amber" => Ok(BoardTone::Amber),
        "rose" => Ok(BoardTone::Rose),
        _ => Err(()),
    }
}

fn format_timestamp(value: OffsetDateTime) -> Result<String, ()> {
    value
        .to_offset(UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|_| ())
}

fn validation_error(
    request_id: RequestId,
    field: &'static str,
    message: &'static str,
) -> (StatusCode, Json<ErrorResponse>) {
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

fn read_error(error: (StatusCode, Json<ErrorResponse>)) -> ApiError {
    (error.0, HeaderMap::new(), error.1)
}

fn path_invalid(request_id: RequestId) -> (StatusCode, Json<ErrorResponse>) {
    error(
        StatusCode::BAD_REQUEST,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::PATH_INVALID),
            "主题路径参数格式不正确",
        )
        .with_field("topic_id", "topic_id 必须是 UUID"),
        request_id,
    )
}

fn create_path_invalid(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::BAD_REQUEST,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::PATH_INVALID),
            "主题路径参数格式不正确",
        )
        .with_field("topic_id", "topic_id 必须是 UUID"),
        request_id,
    )
}

fn reply_path_invalid(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::BAD_REQUEST,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::PATH_INVALID),
            "回复路径参数格式不正确",
        )
        .with_field("path", "topic_id 和 reply_id 必须是 UUID"),
        request_id,
    )
}

fn create_not_found(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_NOT_FOUND),
            "主题不存在或不可访问",
        ),
        request_id,
    )
}

fn user_action_restricted(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::USER_ACTION_RESTRICTED),
            "当前账号处于限制状态，不能发布内容",
        ),
        request_id,
    )
}

fn community_permission_denied(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::COMMUNITY_PERMISSION_DENIED),
            "当前用户组没有执行此社区操作的权限",
        ),
        request_id,
    )
}

fn community_quota_exceeded(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::TOO_MANY_REQUESTS,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::COMMUNITY_QUOTA_EXCEEDED),
            "当前用户组的社区操作额度已用尽",
        ),
        request_id,
    )
}

fn topic_edit_forbidden(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_EDIT_FORBIDDEN),
            "当前用户无权编辑该主题",
        ),
        request_id,
    )
}

fn topic_delete_forbidden(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_DELETE_FORBIDDEN),
            "只有主题作者可以删除主题",
        ),
        request_id,
    )
}

fn topic_moderation_forbidden(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_MODERATION_FORBIDDEN),
            "当前用户没有主题审核权限",
        ),
        request_id,
    )
}

fn topic_governance_forbidden(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_GOVERNANCE_FORBIDDEN),
            "当前账号没有执行该主题治理动作的权限",
        ),
        request_id,
    )
}

fn topic_governance_invalid(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_GOVERNANCE_INVALID),
            "主题治理请求无效",
        ),
        request_id,
    )
}

fn topic_governance_conflict(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_GOVERNANCE_REVISION_CONFLICT),
            "主题治理状态已更新，请刷新后重试",
        ),
        request_id,
    )
}

fn topic_locked(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_LOCKED),
            "主题已锁定，暂时不能回复",
        ),
        request_id,
    )
}

fn board_posting_restricted(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::BOARD_POSTING_RESTRICTED),
            "当前账号在该板块内已被限制发布内容",
        ),
        request_id,
    )
}

fn topic_moderation_not_found(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_MODERATION_NOT_FOUND),
            "主题不存在或不可审核",
        ),
        request_id,
    )
}

fn topic_revision_conflict(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_REVISION_CONFLICT),
            "主题已经被其他请求更新，请刷新后重试",
        ),
        request_id,
    )
}

fn reply_not_found(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::REPLY_NOT_FOUND),
            "回复不存在或不可访问",
        ),
        request_id,
    )
}

fn reply_revision_conflict(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::REPLY_REVISION_CONFLICT),
            "回复已经被其他请求更新，请刷新后重试",
        ),
        request_id,
    )
}

fn reply_mutation_error(
    error: ReplyMutationError,
    request_id: RequestId,
    context: &'static str,
) -> ApiError {
    match error {
        ReplyMutationError::ReplyUnavailable => reply_not_found(request_id),
        ReplyMutationError::RevisionConflict => reply_revision_conflict(request_id),
        ReplyMutationError::AttachmentUnavailable => rich_attachment_unavailable(request_id),
        ReplyMutationError::Database(error) => {
            tracing::warn!(request_id = %request_id, error = %error, context, "Reply mutation failed");
            service_unavailable_reply_mutation(request_id)
        }
    }
}

fn not_found(request_id: RequestId) -> (StatusCode, Json<ErrorResponse>) {
    error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_NOT_FOUND),
            "主题不存在或不可访问",
        ),
        request_id,
    )
}

fn service_unavailable(request_id: RequestId) -> (StatusCode, Json<ErrorResponse>) {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "主题暂时无法加载",
        ),
        request_id,
    )
}

fn invalid_record(request_id: RequestId) -> (StatusCode, Json<ErrorResponse>) {
    tracing::error!(
        request_id = %request_id,
        "Public topic record violates persistence constraints"
    );
    service_unavailable(request_id)
}

fn malformed_create_body(request_id: RequestId) -> ApiError {
    let mut fields = FieldErrors::new();
    add_field_error(&mut fields, "body", "请求体必须是小于 256 KiB 的合法 JSON");
    create_validation_error(request_id, fields)
}

fn malformed_reply_body(request_id: RequestId) -> ApiError {
    let mut fields = FieldErrors::new();
    add_field_error(&mut fields, "body", "请求体必须是小于 128 KiB 的合法 JSON");
    create_validation_error(request_id, fields)
}

fn malformed_update_body(request_id: RequestId) -> ApiError {
    let mut fields = FieldErrors::new();
    add_field_error(&mut fields, "body", "请求体必须是小于 256 KiB 的合法 JSON");
    create_validation_error(request_id, fields)
}

fn malformed_moderation_body(request_id: RequestId) -> ApiError {
    let mut fields = FieldErrors::new();
    add_field_error(&mut fields, "body", "请求体必须是合法的审核 JSON");
    create_validation_error(request_id, fields)
}

fn moderation_status(status: TopicModerationStatus) -> &'static str {
    match status {
        TopicModerationStatus::Approved => "approved",
        TopicModerationStatus::Hidden => "hidden",
        TopicModerationStatus::Rejected => "rejected",
    }
}

fn create_validation_error(request_id: RequestId, fields: FieldErrors) -> ApiError {
    let mut body = ErrorBody::new(
        ErrorCode::from_static(error_codes::VALIDATION_FAILED),
        "请求参数校验失败",
    );
    body.fields = fields;
    create_error(StatusCode::UNPROCESSABLE_ENTITY, body, request_id)
}

fn rich_attachment_unavailable(request_id: RequestId) -> ApiError {
    let mut fields = FieldErrors::default();
    add_field_error(
        &mut fields,
        "rich_content",
        "正文图片已过期、无权使用或尚未上传完成，请重新上传",
    );
    create_validation_error(request_id, fields)
}

fn topic_board_unavailable(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::TOPIC_BOARD_UNAVAILABLE),
            "指定板块不存在或不可发布",
        ),
        request_id,
    )
}

fn idempotency_conflict(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::IDEMPOTENCY_CONFLICT),
            "幂等键已经用于其他内容",
        ),
        request_id,
    )
}

fn service_unavailable_create(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "主题暂时无法发布",
        ),
        request_id,
    )
}

fn service_unavailable_create_reply(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "回复暂时无法发布",
        ),
        request_id,
    )
}

fn service_unavailable_reply_mutation(request_id: RequestId) -> ApiError {
    create_error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "回复暂时无法更新",
        ),
        request_id,
    )
}

fn error(
    status: StatusCode,
    body: ErrorBody,
    request_id: RequestId,
) -> (StatusCode, Json<ErrorResponse>) {
    (status, Json(ErrorResponse::new(body, request_id)))
}

fn create_error(status: StatusCode, body: ErrorBody, request_id: RequestId) -> ApiError {
    (
        status,
        HeaderMap::new(),
        Json(ErrorResponse::new(body, request_id)),
    )
}
