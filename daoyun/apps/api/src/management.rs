use api_contract::{
    ApiResponse, BoardPostingRestrictionAction, BoardUserRestriction, ErrorBody, ErrorCode,
    ErrorResponse, PutBoardUserRestrictionRequest, RequestId, error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::{HeaderMap, StatusCode},
    routing::put,
};
use infrastructure::{
    BoardUserRestrictionAction, BoardUserRestrictionMutationError, BoardUserRestrictionRecord,
    Database, PutBoardUserRestrictionRecord,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::auth::{ApiError, AuthRuntime, authenticate_state_change};

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route(
            "/api/v1/management/boards/{board_id}/users/{user_id}/posting-restriction",
            put(put_board_user_restriction),
        )
        .layer(Extension(runtime))
}

#[utoipa::path(
    put,
    path = "/api/v1/management/boards/{board_id}/users/{user_id}/posting-restriction",
    operation_id = "putBoardUserPostingRestriction",
    tag = "management",
    params(
        ("board_id" = Uuid, Path),
        ("user_id" = Uuid, Path),
        ("x-csrf-token" = String, Header)
    ),
    request_body = PutBoardUserRestrictionRequest,
    responses(
        (status = 200, body = ApiResponse<BoardUserRestriction>, headers(("x-request-id" = String))),
        (status = 400, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn put_board_user_restriction(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    request: Result<Json<PutBoardUserRestrictionRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<BoardUserRestriction>>, ApiError> {
    let Path((board_id, user_id)) = path.map_err(|_| invalid_path(request_id))?;
    let Json(request) = request.map_err(|_| invalid_input(request_id))?;
    let starts_at = parse_timestamp(&request.starts_at).map_err(|()| invalid_input(request_id))?;
    let ends_at = request
        .ends_at
        .as_deref()
        .map(parse_timestamp)
        .transpose()
        .map_err(|()| invalid_input(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let record = database
        .put_board_user_restriction(PutBoardUserRestrictionRecord {
            board_id,
            target_user_id: user_id,
            actor_id: session.user.id,
            actions: request.actions.into_iter().map(map_action).collect(),
            starts_at,
            ends_at,
            reason: request.reason,
            expected_revision: request.expected_revision,
        })
        .await
        .map_err(|error| map_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_record(record).map_err(|()| unavailable(request_id))?,
        request_id,
    )))
}

fn parse_timestamp(value: &str) -> Result<OffsetDateTime, ()> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| ())
}

fn format_timestamp(value: OffsetDateTime) -> Result<String, ()> {
    value.format(&Rfc3339).map_err(|_| ())
}

fn map_action(action: BoardPostingRestrictionAction) -> BoardUserRestrictionAction {
    match action {
        BoardPostingRestrictionAction::TopicCreate => BoardUserRestrictionAction::TopicCreate,
        BoardPostingRestrictionAction::ReplyCreate => BoardUserRestrictionAction::ReplyCreate,
        BoardPostingRestrictionAction::AttachmentUpload => {
            BoardUserRestrictionAction::AttachmentUpload
        }
    }
}

fn parse_action(action: &str) -> Result<BoardPostingRestrictionAction, ()> {
    match action {
        "topic.create" => Ok(BoardPostingRestrictionAction::TopicCreate),
        "reply.create" => Ok(BoardPostingRestrictionAction::ReplyCreate),
        "attachment.upload" => Ok(BoardPostingRestrictionAction::AttachmentUpload),
        _ => Err(()),
    }
}

fn map_record(record: BoardUserRestrictionRecord) -> Result<BoardUserRestriction, ()> {
    Ok(BoardUserRestriction {
        id: record.id,
        board_id: record.board_id,
        user_id: record.user_id,
        actions: record
            .actions
            .iter()
            .map(|action| parse_action(action))
            .collect::<Result<Vec<_>, _>>()?,
        starts_at: format_timestamp(record.starts_at)?,
        ends_at: record.ends_at.map(format_timestamp).transpose()?,
        reason: record.reason,
        created_by: record.created_by,
        updated_by: record.updated_by,
        revision: record.revision,
        created_at: format_timestamp(record.created_at)?,
        updated_at: format_timestamp(record.updated_at)?,
    })
}

fn map_error(request_id: RequestId, error: BoardUserRestrictionMutationError) -> ApiError {
    match error {
        BoardUserRestrictionMutationError::BoardUnavailable
        | BoardUserRestrictionMutationError::TargetUnavailable => not_found(request_id),
        BoardUserRestrictionMutationError::Forbidden => error_response(
            StatusCode::FORBIDDEN,
            error_codes::BOARD_RESTRICTION_FORBIDDEN,
            "没有在该板块限制用户的权限",
            request_id,
        ),
        BoardUserRestrictionMutationError::ProtectedTarget => error_response(
            StatusCode::FORBIDDEN,
            error_codes::BOARD_RESTRICTION_PROTECTED_TARGET,
            "不能限制自己、更高保护级别用户或最后一名活跃超级管理员",
            request_id,
        ),
        BoardUserRestrictionMutationError::InvalidInput => invalid_input(request_id),
        BoardUserRestrictionMutationError::RevisionConflict => error_response(
            StatusCode::CONFLICT,
            error_codes::BOARD_RESTRICTION_CONFLICT,
            "板块用户限制已更新，请刷新后重试",
            request_id,
        ),
        BoardUserRestrictionMutationError::Database(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Board restriction write failed");
            unavailable(request_id)
        }
        BoardUserRestrictionMutationError::Outbox(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Board restriction outbox failed");
            unavailable(request_id)
        }
    }
}

fn invalid_path(request_id: RequestId) -> ApiError {
    error_response(
        StatusCode::BAD_REQUEST,
        error_codes::PATH_INVALID,
        "板块或用户路径参数格式不正确",
        request_id,
    )
}

fn invalid_input(request_id: RequestId) -> ApiError {
    error_response(
        StatusCode::UNPROCESSABLE_ENTITY,
        error_codes::BOARD_RESTRICTION_INVALID,
        "板块用户限制请求无效",
        request_id,
    )
}

fn not_found(request_id: RequestId) -> ApiError {
    error_response(
        StatusCode::NOT_FOUND,
        error_codes::BOARD_RESTRICTION_TARGET_NOT_FOUND,
        "板块或目标用户不存在",
        request_id,
    )
}

fn unavailable(request_id: RequestId) -> ApiError {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::DATABASE_UNAVAILABLE,
        "板块用户限制服务暂时不可用",
        request_id,
    )
}

fn error_response(
    status: StatusCode,
    code: &'static str,
    message: &'static str,
    request_id: RequestId,
) -> ApiError {
    (
        status,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            request_id,
        )),
    )
}
