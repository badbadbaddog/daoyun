use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use api_contract::{
    ApiResponse, ConversationLastMessage, ConversationReadState, ConversationSummary,
    CreateConversationRequest, DirectMessage, ErrorBody, ErrorCode, ErrorResponse,
    MarkConversationReadRequest, PageResponse, RequestId, SendDirectMessageRequest, UserSummary,
    error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::{HeaderMap, HeaderValue, StatusCode},
    routing::{get, post},
};
use infrastructure::{
    ArchiveConversationError, ConversationSummaryRecord, CreateConversationError, Database,
    DirectMessageRecord, IdempotencyInput, ListConversationsError, ListDirectMessagesError,
    MarkConversationReadError, NewDirectMessageRecord, SendDirectMessageError,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};
use utoipa::IntoParams;
use uuid::Uuid;

use crate::auth::{ApiError, AuthRuntime, authenticate_session, authenticate_state_change};

const DEFAULT_LIMIT: u16 = 20;
const MAX_LIMIT: u16 = 50;
const MESSAGE_BODY_LIMIT: usize = 48 * 1024;
const MESSAGE_RATE_LIMIT: u32 = 30;
const MESSAGE_RATE_WINDOW: Duration = Duration::from_secs(60);

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct MessagePageQuery {
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

#[derive(Clone)]
pub(crate) struct MessageRuntime {
    windows: Arc<Mutex<HashMap<Uuid, MessageWindow>>>,
}

#[derive(Clone, Copy)]
struct MessageWindow {
    started_at: Instant,
    messages: u32,
}

pub(crate) fn router(auth_runtime: AuthRuntime) -> Router<Database> {
    let message_runtime = MessageRuntime {
        windows: Arc::new(Mutex::new(HashMap::new())),
    };
    Router::new()
        .route(
            "/api/v1/conversations",
            post(create_conversation).get(list_conversations),
        )
        .route(
            "/api/v1/conversations/{conversation_id}",
            axum::routing::delete(archive_conversation),
        )
        .route(
            "/api/v1/conversations/{conversation_id}/messages",
            get(list_messages).post(send_message),
        )
        .route(
            "/api/v1/conversations/{conversation_id}/read",
            axum::routing::patch(mark_read),
        )
        .layer(DefaultBodyLimit::max(MESSAGE_BODY_LIMIT))
        .layer(Extension(message_runtime))
        .layer(Extension(auth_runtime))
}

#[utoipa::path(
    post,
    path = "/api/v1/conversations",
    operation_id = "createDirectConversation",
    tag = "messages",
    request_body = CreateConversationRequest,
    params(("x-csrf-token" = String, Header, description = "Session-bound CSRF token")),
    responses(
        (status = 200, description = "The existing or newly created conversation", body = ApiResponse<ConversationSummary>),
        (status = 401, description = "The request has no active session", body = ErrorResponse),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse),
        (status = 404, description = "The recipient is unavailable", body = ErrorResponse),
        (status = 422, description = "The request body is invalid", body = ErrorResponse),
        (status = 503, description = "The message database is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn create_conversation(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<CreateConversationRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ConversationSummary>>, ApiError> {
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let record = database
        .create_direct_conversation(session.user.id, request.recipient_id, Uuid::now_v7())
        .await
        .map_err(|error| match error {
            CreateConversationError::Unavailable => conversation_not_found(request_id),
            CreateConversationError::Database(error) => {
                tracing::warn!(request_id = %request_id, recipient_id = %request.recipient_id, error = %error, "Conversation creation failed");
                database_unavailable(request_id)
            }
        })?;
    let conversation =
        conversation_summary(record).map_err(|()| database_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(conversation, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/conversations",
    operation_id = "listDirectConversations",
    tag = "messages",
    params(MessagePageQuery),
    responses(
        (status = 200, description = "The current user's active conversations", body = PageResponse<ConversationSummary>),
        (status = 401, description = "The request has no active session", body = ErrorResponse),
        (status = 422, description = "The pagination parameters are invalid", body = ErrorResponse),
        (status = 503, description = "The message database is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_conversations(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<MessagePageQuery>, QueryRejection>,
) -> Result<Json<PageResponse<ConversationSummary>>, ApiError> {
    let query = validate_page_query(query).map_err(|error| match error {
        PageQueryError::Malformed => validation_error(request_id, "query", "分页参数格式不正确"),
        PageQueryError::LimitOutOfRange => {
            validation_error(request_id, "limit", "limit 必须在 1 到 50 之间")
        }
    })?;
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let mut records = database
        .list_direct_conversations(session.user.id, query.cursor, i64::from(query.limit) + 1)
        .await
        .map_err(|error| match error {
            ListConversationsError::InvalidCursor => {
                validation_error(request_id, "cursor", "cursor 不属于当前会话列表")
            }
            ListConversationsError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Conversation list failed");
                database_unavailable(request_id)
            }
        })?;
    let next_cursor = truncate_page(&mut records, query.limit, |record| record.id);
    let conversations = records
        .into_iter()
        .map(conversation_summary)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| database_unavailable(request_id))?;
    Ok(Json(PageResponse::new(
        conversations,
        request_id,
        next_cursor,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/conversations/{conversation_id}/messages",
    operation_id = "listDirectMessages",
    tag = "messages",
    params(("conversation_id" = Uuid, Path), MessagePageQuery),
    responses(
        (status = 200, description = "Messages visible to the participant", body = PageResponse<DirectMessage>),
        (status = 400, description = "The conversation path is invalid", body = ErrorResponse),
        (status = 401, description = "The request has no active session", body = ErrorResponse),
        (status = 404, description = "The conversation is unavailable", body = ErrorResponse),
        (status = 422, description = "The pagination parameters are invalid", body = ErrorResponse),
        (status = 503, description = "The message database is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_messages(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    query: Result<Query<MessagePageQuery>, QueryRejection>,
) -> Result<Json<PageResponse<DirectMessage>>, ApiError> {
    let Path(conversation_id) = path.map_err(|_| path_invalid(request_id))?;
    let query = validate_page_query(query).map_err(|error| match error {
        PageQueryError::Malformed => validation_error(request_id, "query", "分页参数格式不正确"),
        PageQueryError::LimitOutOfRange => {
            validation_error(request_id, "limit", "limit 必须在 1 到 50 之间")
        }
    })?;
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let mut records = database
        .list_direct_messages(
            session.user.id,
            conversation_id,
            query.cursor,
            i64::from(query.limit) + 1,
        )
        .await
        .map_err(|error| match error {
            ListDirectMessagesError::ConversationUnavailable => conversation_not_found(request_id),
            ListDirectMessagesError::InvalidCursor => {
                validation_error(request_id, "cursor", "cursor 不属于当前会话消息")
            }
            ListDirectMessagesError::Database(error) => {
                tracing::warn!(request_id = %request_id, conversation_id = %conversation_id, error = %error, "Message list failed");
                database_unavailable(request_id)
            }
        })?;
    let next_cursor = truncate_page(&mut records, query.limit, |record| record.id);
    let messages = records
        .into_iter()
        .map(direct_message)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| database_unavailable(request_id))?;
    Ok(Json(PageResponse::new(messages, request_id, next_cursor)))
}

#[utoipa::path(
    post,
    path = "/api/v1/conversations/{conversation_id}/messages",
    operation_id = "sendDirectMessage",
    tag = "messages",
    request_body = SendDirectMessageRequest,
    params(
        ("conversation_id" = Uuid, Path),
        ("x-csrf-token" = String, Header),
        ("Idempotency-Key" = Option<String>, Header)
    ),
    responses(
        (status = 201, description = "The direct message was sent or replayed", body = ApiResponse<DirectMessage>),
        (status = 400, description = "The conversation path is invalid", body = ErrorResponse),
        (status = 401, description = "The request has no active session", body = ErrorResponse),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse),
        (status = 404, description = "The conversation is unavailable", body = ErrorResponse),
        (status = 409, description = "The idempotency key conflicts", body = ErrorResponse),
        (status = 422, description = "The message body or headers are invalid", body = ErrorResponse),
        (status = 429, description = "The sender exceeded the message rate limit", body = ErrorResponse, headers(("Retry-After" = String))),
        (status = 503, description = "The message database is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn send_message(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(message_runtime): Extension<MessageRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<SendDirectMessageRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<DirectMessage>>), ApiError> {
    let Path(conversation_id) = path.map_err(|_| path_invalid(request_id))?;
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let content = validate_content(request.content)
        .map_err(|message| validation_error(request_id, "content", message))?;
    let idempotency_key = parse_idempotency_key(&headers)
        .map_err(|message| validation_error(request_id, "idempotency_key", message))?;
    let session = authenticate_state_change(&database, &auth_runtime, &headers, request_id).await?;
    if let Some(retry_after) = message_runtime.reserve(session.user.id) {
        return Err(rate_limited(request_id, retry_after));
    }
    let request_hash = message_request_hash(conversation_id, &content);
    let result = database
        .send_direct_message(
            NewDirectMessageRecord {
                id: Uuid::now_v7(),
                conversation_id,
                sender_id: session.user.id,
                content,
            },
            idempotency_key.map(|key| IdempotencyInput { key, request_hash }),
        )
        .await;
    let result = match result {
        Ok(result) => {
            if !result.created {
                message_runtime.release(session.user.id);
            }
            result
        }
        Err(error) => {
            message_runtime.release(session.user.id);
            return Err(match error {
                SendDirectMessageError::ConversationUnavailable => {
                    conversation_not_found(request_id)
                }
                SendDirectMessageError::PermissionDenied => community_permission_denied(request_id),
                SendDirectMessageError::QuotaExceeded => community_quota_exceeded(request_id),
                SendDirectMessageError::IdempotencyConflict => idempotency_conflict(request_id),
                SendDirectMessageError::Database(error) => {
                    tracing::warn!(request_id = %request_id, conversation_id = %conversation_id, error = %error, "Direct message send failed");
                    database_unavailable(request_id)
                }
            });
        }
    };
    let message = direct_message(result.message).map_err(|()| database_unavailable(request_id))?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::new(message, request_id)),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/conversations/{conversation_id}/read",
    operation_id = "markDirectConversationRead",
    tag = "messages",
    request_body = MarkConversationReadRequest,
    params(("conversation_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    responses(
        (status = 200, description = "The participant read state", body = ApiResponse<ConversationReadState>),
        (status = 400, description = "The conversation path is invalid", body = ErrorResponse),
        (status = 401, description = "The request has no active session", body = ErrorResponse),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse),
        (status = 404, description = "The conversation or message is unavailable", body = ErrorResponse),
        (status = 422, description = "The request body is invalid", body = ErrorResponse),
        (status = 503, description = "The message database is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn mark_read(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<MarkConversationReadRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ConversationReadState>>, ApiError> {
    let Path(conversation_id) = path.map_err(|_| path_invalid(request_id))?;
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let record = database
        .mark_direct_conversation_read(session.user.id, conversation_id, request.last_read_message_id)
        .await
        .map_err(|error| match error {
            MarkConversationReadError::ConversationUnavailable
            | MarkConversationReadError::MessageUnavailable => conversation_not_found(request_id),
            MarkConversationReadError::Database(error) => {
                tracing::warn!(request_id = %request_id, conversation_id = %conversation_id, error = %error, "Conversation read update failed");
                database_unavailable(request_id)
            }
        })?;
    let unread_count =
        u64::try_from(record.unread_count).map_err(|_| database_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(
        ConversationReadState {
            conversation_id: record.conversation_id,
            last_read_message_id: record.last_read_message_id,
            unread_count,
        },
        request_id,
    )))
}

#[utoipa::path(
    delete,
    path = "/api/v1/conversations/{conversation_id}",
    operation_id = "archiveDirectConversation",
    tag = "messages",
    params(("conversation_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    responses(
        (status = 200, description = "The conversation was archived for the current user", body = ApiResponse<bool>),
        (status = 400, description = "The conversation path is invalid", body = ErrorResponse),
        (status = 401, description = "The request has no active session", body = ErrorResponse),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse),
        (status = 404, description = "The conversation is unavailable", body = ErrorResponse),
        (status = 503, description = "The message database is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn archive_conversation(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<bool>>, ApiError> {
    let Path(conversation_id) = path.map_err(|_| path_invalid(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    database
        .archive_direct_conversation(session.user.id, conversation_id)
        .await
        .map_err(|error| match error {
            ArchiveConversationError::ConversationUnavailable => conversation_not_found(request_id),
            ArchiveConversationError::Database(error) => {
                tracing::warn!(request_id = %request_id, conversation_id = %conversation_id, error = %error, "Conversation archive failed");
                database_unavailable(request_id)
            }
        })?;
    Ok(Json(ApiResponse::new(true, request_id)))
}

struct ValidatedPageQuery {
    cursor: Option<Uuid>,
    limit: u16,
}

enum PageQueryError {
    Malformed,
    LimitOutOfRange,
}

fn validate_page_query(
    query: Result<Query<MessagePageQuery>, QueryRejection>,
) -> Result<ValidatedPageQuery, PageQueryError> {
    let Query(query) = query.map_err(|_| PageQueryError::Malformed)?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(PageQueryError::LimitOutOfRange);
    }
    Ok(ValidatedPageQuery {
        cursor: query.cursor,
        limit,
    })
}

fn truncate_page<T>(records: &mut Vec<T>, limit: u16, id: impl Fn(&T) -> Uuid) -> Option<String> {
    let has_next_page = records.len() > usize::from(limit);
    records.truncate(usize::from(limit));
    has_next_page.then(|| {
        id(records
            .last()
            .expect("a full direct message page is non-empty"))
        .to_string()
    })
}

fn validate_content(content: String) -> Result<String, &'static str> {
    let content = content.trim().to_owned();
    let length = content.chars().count();
    if !(1..=10_000).contains(&length)
        || content
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err("消息正文必须为 1 到 10000 个字符且不能包含控制字符");
    }
    Ok(content)
}

fn parse_idempotency_key(headers: &HeaderMap) -> Result<Option<String>, &'static str> {
    let Some(value) = headers.get("idempotency-key") else {
        return Ok(None);
    };
    let key = value.to_str().ok().map(str::trim).unwrap_or_default();
    if !(1..=128).contains(&key.len()) || !key.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        return Err("Idempotency-Key 必须为 1 到 128 个可打印 ASCII 字符");
    }
    Ok(Some(key.to_owned()))
}

fn message_request_hash(conversation_id: Uuid, content: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(conversation_id.as_bytes());
    hasher.update([0]);
    hasher.update(content.as_bytes());
    hasher.finalize().to_vec()
}

fn conversation_summary(record: ConversationSummaryRecord) -> Result<ConversationSummary, ()> {
    Ok(ConversationSummary {
        id: record.id,
        other_user: user_summary(record.other_user),
        last_message: record
            .last_message
            .map(|message| -> Result<ConversationLastMessage, ()> {
                Ok(ConversationLastMessage {
                    id: message.id,
                    sender_id: message.sender_id,
                    content: message.content,
                    created_at: format_timestamp(message.created_at)?,
                })
            })
            .transpose()?,
        unread_count: u64::try_from(record.unread_count).map_err(|_| ())?,
        updated_at: format_timestamp(record.updated_at)?,
    })
}

fn direct_message(record: DirectMessageRecord) -> Result<DirectMessage, ()> {
    Ok(DirectMessage {
        id: record.id,
        conversation_id: record.conversation_id,
        sender: user_summary(record.sender),
        content: record.content,
        created_at: format_timestamp(record.created_at)?,
    })
}

fn user_summary(record: infrastructure::PublicUserSummaryRecord) -> UserSummary {
    UserSummary {
        id: record.id,
        username: record.username,
        display_name: record.display_name,
        avatar_url: record.avatar_url,
    }
}

fn format_timestamp(value: OffsetDateTime) -> Result<String, ()> {
    value
        .to_offset(UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|_| ())
}

impl MessageRuntime {
    fn reserve(&self, user_id: Uuid) -> Option<Duration> {
        let now = Instant::now();
        let mut windows = self
            .windows
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        windows.retain(|_, window| now.duration_since(window.started_at) < MESSAGE_RATE_WINDOW);
        let window = windows.entry(user_id).or_insert(MessageWindow {
            started_at: now,
            messages: 0,
        });
        if window.messages >= MESSAGE_RATE_LIMIT {
            return Some(MESSAGE_RATE_WINDOW.saturating_sub(now.duration_since(window.started_at)));
        }
        window.messages += 1;
        None
    }

    fn release(&self, user_id: Uuid) {
        let mut windows = self
            .windows
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(window) = windows.get_mut(&user_id) {
            window.messages = window.messages.saturating_sub(1);
        }
    }
}

fn malformed_body(request_id: RequestId) -> ApiError {
    validation_error(request_id, "body", "请求体必须是小于 48 KiB 的合法 JSON")
}

fn validation_error(request_id: RequestId, field: &'static str, message: &'static str) -> ApiError {
    error(
        StatusCode::UNPROCESSABLE_ENTITY,
        HeaderMap::new(),
        ErrorBody::new(
            ErrorCode::from_static(error_codes::VALIDATION_FAILED),
            "请求参数校验失败",
        )
        .with_field(field, message),
        request_id,
    )
}

fn path_invalid(request_id: RequestId) -> ApiError {
    error(
        StatusCode::BAD_REQUEST,
        HeaderMap::new(),
        ErrorBody::new(
            ErrorCode::from_static(error_codes::PATH_INVALID),
            "会话路径参数格式不正确",
        )
        .with_field("conversation_id", "conversation_id 必须是 UUID"),
        request_id,
    )
}

fn conversation_not_found(request_id: RequestId) -> ApiError {
    error(
        StatusCode::NOT_FOUND,
        HeaderMap::new(),
        ErrorBody::new(
            ErrorCode::from_static(error_codes::CONVERSATION_NOT_FOUND),
            "会话不存在或不可访问",
        ),
        request_id,
    )
}

fn idempotency_conflict(request_id: RequestId) -> ApiError {
    error(
        StatusCode::CONFLICT,
        HeaderMap::new(),
        ErrorBody::new(
            ErrorCode::from_static(error_codes::IDEMPOTENCY_CONFLICT),
            "幂等键已经用于其他消息",
        ),
        request_id,
    )
}

fn community_permission_denied(request_id: RequestId) -> ApiError {
    error(
        StatusCode::FORBIDDEN,
        HeaderMap::new(),
        ErrorBody::new(
            ErrorCode::from_static(error_codes::COMMUNITY_PERMISSION_DENIED),
            "当前用户组没有发送私信的权限",
        ),
        request_id,
    )
}

fn community_quota_exceeded(request_id: RequestId) -> ApiError {
    error(
        StatusCode::TOO_MANY_REQUESTS,
        HeaderMap::new(),
        ErrorBody::new(
            ErrorCode::from_static(error_codes::COMMUNITY_QUOTA_EXCEEDED),
            "当前用户组的每日私信额度已用尽",
        ),
        request_id,
    )
}

fn rate_limited(request_id: RequestId, retry_after: Duration) -> ApiError {
    let seconds = retry_after.as_secs().max(1);
    let mut headers = HeaderMap::new();
    headers.insert(
        "retry-after",
        HeaderValue::from_str(&seconds.to_string()).expect("retry delay is a valid header value"),
    );
    error(
        StatusCode::TOO_MANY_REQUESTS,
        headers,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::MESSAGE_RATE_LIMITED),
            "消息发送过于频繁，请稍后重试",
        ),
        request_id,
    )
}

fn database_unavailable(request_id: RequestId) -> ApiError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        HeaderMap::new(),
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "私信服务暂时不可用",
        ),
        request_id,
    )
}

fn error(
    status: StatusCode,
    headers: HeaderMap,
    body: ErrorBody,
    request_id: RequestId,
) -> ApiError {
    (status, headers, Json(ErrorResponse::new(body, request_id)))
}
