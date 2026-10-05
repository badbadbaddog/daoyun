use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, Notification, NotificationKind,
    NotificationPageQuery, NotificationTarget, NotificationUnreadCount, PageResponse, RequestId,
    UserSummary, error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{
        Path, Query, State,
        rejection::{PathRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    routing::{get, patch},
};
use infrastructure::{
    Database, ListNotificationsError, NotificationMutationError, NotificationRecord,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::auth::{ApiError, AuthRuntime, authenticate_session, authenticate_state_change};

const DEFAULT_LIMIT: u16 = 20;
const MAX_LIMIT: u16 = 50;

struct ValidatedNotificationPageQuery {
    cursor: Option<Uuid>,
    limit: u16,
    unread: bool,
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/notifications", get(list))
        .route("/api/v1/notifications/unread-count", get(unread_count))
        .route("/api/v1/notifications/read-all", patch(read_all))
        .route(
            "/api/v1/notifications/{notification_id}/read",
            patch(read_one),
        )
        .layer(Extension(runtime))
}

#[utoipa::path(
    get,
    path = "/api/v1/notifications",
    operation_id = "listNotifications",
    tag = "notifications",
    params(NotificationPageQuery),
    responses(
        (status = 200, description = "Notifications visible to the current user under current content policies, filtered before pagination; cursors belong to the selected filter", body = PageResponse<Notification>, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 422, description = "The pagination parameters are invalid", body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 503, description = "The notification database is unavailable", body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID")))
    )
)]
pub(crate) async fn list(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<NotificationPageQuery>, QueryRejection>,
) -> Result<Json<PageResponse<Notification>>, ApiError> {
    let query = validate_query(query).map_err(|message| validation_error(request_id, message))?;
    let limit = query.limit;
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let mut records = database
        .list_filtered_notifications(session.user.id, query.cursor, i64::from(limit) + 1, query.unread)
        .await
        .map_err(|error| match error {
            ListNotificationsError::InvalidCursor => validation_error(request_id, "cursor 必须属于当前通知列表"),
            ListNotificationsError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Notification list failed");
                database_unavailable(request_id)
            }
        })?;
    let next_cursor = if records.len() > usize::from(limit) {
        records.truncate(usize::from(limit));
        records.last().map(|record| {
            if query.unread {
                format!("unread:{}", record.id)
            } else {
                record.id.to_string()
            }
        })
    } else {
        None
    };
    let notifications = records
        .into_iter()
        .map(notification)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| database_unavailable(request_id))?;
    Ok(Json(PageResponse::new(
        notifications,
        request_id,
        next_cursor,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/notifications/unread-count",
    operation_id = "countUnreadNotifications",
    tag = "notifications",
    responses(
        (status = 200, body = ApiResponse<NotificationUnreadCount>, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID")))
    )
)]
pub(crate) async fn unread_count(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<NotificationUnreadCount>>, ApiError> {
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let count = database
        .count_unread_notifications(session.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Unread notification count failed");
            database_unavailable(request_id)
        })?;
    let unread_count =
        u64::try_from(count.unread_count).map_err(|_| database_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(
        NotificationUnreadCount { unread_count },
        request_id,
    )))
}

#[utoipa::path(
    patch,
    path = "/api/v1/notifications/{notification_id}/read",
    operation_id = "markNotificationRead",
    tag = "notifications",
    params(("notification_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    responses(
        (status = 200, body = ApiResponse<Notification>, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 400, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID")))
    )
)]
pub(crate) async fn read_one(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<Notification>>, ApiError> {
    let Path(notification_id) = path.map_err(|_| path_invalid(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let record = database
        .mark_notification_read(session.user.id, notification_id)
        .await
        .map_err(|error| match error {
            NotificationMutationError::NotFound => not_found(request_id),
            NotificationMutationError::Database(_error) => database_unavailable(request_id),
        })?;
    let value = notification(record).map_err(|()| database_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(value, request_id)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/notifications/read-all",
    operation_id = "markAllNotificationsRead",
    description = "Marks only the current user notifications permitted by current content policies and visible to the server UPDATE snapshot. Events committing after the snapshot stay unread. Returns the remaining count observed in the same transaction.",
    tag = "notifications",
    params(("x-csrf-token" = String, Header)),
    responses(
        (status = 200, body = ApiResponse<NotificationUnreadCount>, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID"))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String, description = "Request correlation ID")))
    )
)]
pub(crate) async fn read_all(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<NotificationUnreadCount>>, ApiError> {
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let count = database
        .mark_all_notifications_read(session.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Mark all notifications read failed");
            database_unavailable(request_id)
        })?;
    let unread_count =
        u64::try_from(count.unread_count).map_err(|_| database_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(
        NotificationUnreadCount { unread_count },
        request_id,
    )))
}

fn validate_query(
    query: Result<Query<NotificationPageQuery>, QueryRejection>,
) -> Result<ValidatedNotificationPageQuery, &'static str> {
    let Query(query) = query.map_err(|_| "分页参数格式不正确")?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err("limit 必须在 1 到 50 之间");
    }
    let unread = query.unread.unwrap_or(false);
    let cursor = query
        .cursor
        .map(|cursor| {
            let value = if unread {
                cursor
                    .strip_prefix("unread:")
                    .ok_or("cursor 必须来自相同的通知筛选")?
            } else {
                cursor.as_str()
            };
            Uuid::parse_str(value).map_err(|_| "cursor 必须来自相同的通知筛选")
        })
        .transpose()?;
    Ok(ValidatedNotificationPageQuery {
        cursor,
        limit,
        unread,
    })
}

fn notification(record: NotificationRecord) -> Result<Notification, ()> {
    let kind = match record.kind.as_str() {
        "follow" => NotificationKind::Follow,
        "reply" => NotificationKind::Reply,
        "like" => NotificationKind::Like,
        "message" => NotificationKind::Message,
        "report" => NotificationKind::Report,
        "topic_governance" => NotificationKind::TopicGovernance,
        _ => return Err(()),
    };
    let target = match record.target_type.as_str() {
        "user" => NotificationTarget::User,
        "topic" => NotificationTarget::Topic,
        "post" => NotificationTarget::Post,
        "conversation" => NotificationTarget::Conversation,
        _ => return Err(()),
    };
    Ok(Notification {
        id: record.id,
        kind,
        actor: record.actor.map(user_summary),
        target,
        target_id: record.target_id,
        topic_id: record.topic_id,
        read_at: record.read_at.map(format_time),
        created_at: format_time(record.created_at),
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

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .expect("notification timestamp must format")
}

fn validation_error(request_id: RequestId, message: &'static str) -> ApiError {
    error(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::VALIDATION_FAILED),
            "请求参数校验失败",
        )
        .with_field("query", message),
        request_id,
    )
}

fn path_invalid(request_id: RequestId) -> ApiError {
    error(
        StatusCode::BAD_REQUEST,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::PATH_INVALID),
            "通知路径参数格式不正确",
        )
        .with_field("notification_id", "notification_id 必须是 UUID"),
        request_id,
    )
}

fn not_found(request_id: RequestId) -> ApiError {
    error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::NOTIFICATION_NOT_FOUND),
            "通知不存在或不可访问",
        ),
        request_id,
    )
}

fn database_unavailable(request_id: RequestId) -> ApiError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "通知服务暂时不可用",
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
