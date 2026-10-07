use crate::admin::authorize_capability_read;
use crate::auth::{ApiError, AuthRuntime};
use api_contract::{
    AdminUserStatus, ApiResponse, AuthorizationRoleScope, AuthorizationScopeMode,
    BoardPermissionMatrix, ErrorBody, ErrorCode, ErrorResponse, PermissionCheck,
    PermissionMatrixAction, PermissionMatrixActionResult, PermissionMatrixDecision,
    PermissionMatrixQuota, PermissionMatrixRole, PermissionMatrixScenario,
    PermissionMatrixScenarioKind, PermissionMatrixSource, PermissionMatrixSourceKind, RequestId,
    error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{
        Path, Query, State,
        rejection::{PathRejection, QueryRejection},
    },
    http::{HeaderMap, HeaderValue, StatusCode},
    routing::get,
};
use infrastructure::{
    BoardPermissionMatrixRecord, Database, PermissionMatrixError, permission_keys,
};
use serde::Deserialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(crate) struct MatrixQuery {
    group_ids: Option<String>,
    user_id: Option<Uuid>,
}

pub(crate) fn router() -> Router<Database> {
    Router::new()
        .route(
            "/api/v1/admin/boards/{board_id}/permission-matrix",
            get(get_matrix),
        )
        .route("/api/v1/admin/permission-check", get(get_permission_check))
}

#[utoipa::path(get, path = "/api/v1/admin/boards/{board_id}/permission-matrix", operation_id = "getBoardPermissionMatrix", tag = "admin",
    params(("board_id" = Uuid, Path), ("group_ids" = Option<String>, Query, description = "Up to four distinct group UUIDs separated by commas"),
        ("user_id" = Option<Uuid>, Query, description = "One explicit user, requires membership, entitlement, role and assignment read capabilities")),
    responses(
        (status = 200, body = ApiResponse<BoardPermissionMatrix>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    ))]
pub(crate) async fn get_matrix(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    query: Result<Query<MatrixQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<BoardPermissionMatrix>>), ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::CONTENT_ACCESS_POLICIES_READ,
    )
    .await?;
    let Path(board_id) = path.map_err(|_| {
        failure(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::VALIDATION_FAILED,
            "版块标识格式不正确",
            request_id,
        )
    })?;
    let Query(query) = query.map_err(|_| {
        failure(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::VALIDATION_FAILED,
            "查询参数格式不正确",
            request_id,
        )
    })?;
    let group_ids = query
        .group_ids
        .map(|value| {
            if value.len() > 147 {
                return Err(());
            }
            value
                .split(',')
                .map(Uuid::parse_str)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| ())
        })
        .transpose()
        .map_err(|_| {
            failure(
                StatusCode::UNPROCESSABLE_ENTITY,
                error_codes::VALIDATION_FAILED,
                "最多选择四个不同用户组",
                request_id,
            )
        })?
        .unwrap_or_default();
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::COMMUNITY_GROUPS_READ,
    )
    .await?;
    if query.user_id.is_some() {
        for capability in [
            permission_keys::ADMIN_USERS_READ,
            permission_keys::COMMUNITY_MEMBERSHIPS_READ,
            permission_keys::ENTITLEMENT_GRANTS_READ,
            permission_keys::ENTITLEMENT_TYPES_READ,
            permission_keys::AUTHORIZATION_ASSIGNMENTS_READ,
            permission_keys::AUTHORIZATION_ROLES_READ,
        ] {
            authorize_capability_read(&database, &runtime, &headers, request_id, capability)
                .await?;
        }
    }
    let record = database.board_permission_matrix(board_id, &group_ids, query.user_id).await.map_err(|error| match error {
        PermissionMatrixError::BoardNotFound => failure(StatusCode::NOT_FOUND, error_codes::ADMIN_BOARD_NOT_FOUND, "版块不存在", request_id),
        PermissionMatrixError::SubjectNotFound => failure(StatusCode::NOT_FOUND, "permission_matrix.subject_not_found", "所选场景对象不存在", request_id),
        PermissionMatrixError::InvalidScenario => failure(StatusCode::UNPROCESSABLE_ENTITY, error_codes::VALIDATION_FAILED, "请选择最多四个不同用户组或一个具体用户", request_id),
        PermissionMatrixError::SourceLimit => failure(StatusCode::UNPROCESSABLE_ENTITY, "permission_matrix.source_limit", "该用户的有效来源超过检查上限，未生成部分权限结论", request_id),
        PermissionMatrixError::Database(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Permission matrix query failed");
            failure(StatusCode::SERVICE_UNAVAILABLE, error_codes::DATABASE_UNAVAILABLE, "权限检查暂时不可用", request_id)
        }
    })?;
    let data = map_record(record).map_err(|_| {
        failure(
            StatusCode::SERVICE_UNAVAILABLE,
            error_codes::DATABASE_UNAVAILABLE,
            "权限检查数据格式异常",
            request_id,
        )
    })?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert("cache-control", HeaderValue::from_static("no-store"));
    Ok((response_headers, Json(ApiResponse::new(data, request_id))))
}

fn timestamp(at: OffsetDateTime) -> Result<String, time::error::Format> {
    at.format(&Rfc3339)
}
fn map_record(
    record: BoardPermissionMatrixRecord,
) -> Result<BoardPermissionMatrix, time::error::Format> {
    let mut scenarios = Vec::new();
    for scenario in record.scenarios {
        let mut sources = Vec::new();
        for source in scenario.sources {
            sources.push(PermissionMatrixSource {
                id: source.id,
                kind: match source.kind {
                    "group" => PermissionMatrixSourceKind::Group,
                    "role" => PermissionMatrixSourceKind::Role,
                    _ => PermissionMatrixSourceKind::Entitlement,
                },
                key: source.key,
                display_name: source.display_name,
                permission_keys: source.permission_keys.into_iter().collect(),
                quotas: source.quotas,
                type_version: source.type_version,
                membership_kind: source.membership_kind,
                role: source.role.map(|r| PermissionMatrixRole {
                    id: r.id,
                    revision: r.revision,
                    scope: match r.scope.as_str() {
                        "instance" => AuthorizationRoleScope::Instance,
                        "site" => AuthorizationRoleScope::Site,
                        _ => AuthorizationRoleScope::Board,
                    },
                    scope_id: r.scope_id,
                    scope_mode: if r.scope_mode == "subtree" {
                        AuthorizationScopeMode::Subtree
                    } else {
                        AuthorizationScopeMode::Exact
                    },
                    scope_matches: r.scope_matches,
                    target_scope_matches: r.target_scope_matches,
                    is_system: r.is_system,
                    assigned_by: r.assigned_by,
                }),
                starts_at: source.starts_at.map(timestamp).transpose()?,
                ends_at: source.ends_at.map(timestamp).transpose()?,
            });
        }
        scenarios.push(PermissionMatrixScenario {
            id: scenario.id,
            kind: if scenario.kind == "group" {
                PermissionMatrixScenarioKind::Group
            } else {
                PermissionMatrixScenarioKind::User
            },
            display_name: scenario.display_name,
            complete: scenario.complete,
            account_status: scenario.account_status.map(|status| match status.as_str() {
                "active" => AdminUserStatus::Active,
                "restricted" => AdminUserStatus::Restricted,
                _ => AdminUserStatus::Suspended,
            }),
            sources,
            quotas: scenario
                .quotas
                .into_iter()
                .map(|q| PermissionMatrixQuota {
                    key: q.key,
                    limit: q.limit,
                    used: q.used,
                    source_ids: q.source_ids,
                })
                .collect(),
            actions: scenario
                .actions
                .into_iter()
                .map(|a| PermissionMatrixActionResult {
                    action: match a.action {
                        "browse" => PermissionMatrixAction::Browse,
                        "topic_create" => PermissionMatrixAction::TopicCreate,
                        "reply_create" => PermissionMatrixAction::ReplyCreate,
                        "attachment_upload" => PermissionMatrixAction::AttachmentUpload,
                        "attachment_download" => PermissionMatrixAction::AttachmentDownload,
                        "moderation_browse" => PermissionMatrixAction::ModerationBrowse,
                        "topic_pin" => PermissionMatrixAction::TopicPin,
                        "topic_feature" => PermissionMatrixAction::TopicFeature,
                        "topic_lock" => PermissionMatrixAction::TopicLock,
                        "topic_move" => PermissionMatrixAction::TopicMove,
                        _ => unreachable!("unknown internal diagnostic action"),
                    },
                    decision: match a.decision {
                        "allowed" => PermissionMatrixDecision::Allowed,
                        "denied" => PermissionMatrixDecision::Denied,
                        "provided" => PermissionMatrixDecision::Provided,
                        "not_provided" => PermissionMatrixDecision::NotProvided,
                        "missing_context" => PermissionMatrixDecision::MissingContext,
                        _ => PermissionMatrixDecision::NotApplicable,
                    },
                    reason: a.reason.into(),
                    permission_provided: a.permission_provided,
                    source_ids: a.source_ids,
                })
                .collect(),
        });
    }
    Ok(BoardPermissionMatrix {
        board_id: record.board_id,
        visibility: record.visibility,
        policy_revision: record.policy_revision,
        evaluated_at: timestamp(record.evaluated_at)?,
        scenarios,
    })
}

fn failure(
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CheckQuery {
    user_id: Uuid,
    board_id: Uuid,
    action: PermissionMatrixAction,
    topic_id: Option<Uuid>,
    attachment_id: Option<Uuid>,
    file_bytes: Option<i64>,
    target_board_id: Option<Uuid>,
}

#[utoipa::path(get, path = "/api/v1/admin/permission-check", operation_id = "getPermissionCheck", tag = "admin",
    params(("board_id" = Uuid, Query), ("user_id" = Uuid, Query), ("action" = PermissionMatrixAction, Query),
        ("topic_id" = Option<Uuid>, Query), ("attachment_id" = Option<Uuid>, Query),
        ("target_board_id" = Option<Uuid>, Query, description = "Destination board for topic_move only; both board scopes are checked"),
        ("file_bytes" = Option<i64>, Query, description = "Positive upload size up to 50 MiB; checks size without sending file content")),
    responses(
        (status = 200, body = ApiResponse<PermissionCheck>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    ))]
pub(crate) async fn get_permission_check(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<CheckQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<PermissionCheck>>), ApiError> {
    // Authorize before parsing or looking up subjects/resources; errors disclose no sources.
    for capability in [
        permission_keys::CONTENT_ACCESS_POLICIES_READ,
        permission_keys::COMMUNITY_GROUPS_READ,
        permission_keys::ADMIN_USERS_READ,
        permission_keys::COMMUNITY_MEMBERSHIPS_READ,
        permission_keys::ENTITLEMENT_GRANTS_READ,
        permission_keys::ENTITLEMENT_TYPES_READ,
        permission_keys::AUTHORIZATION_ASSIGNMENTS_READ,
        permission_keys::AUTHORIZATION_ROLES_READ,
    ] {
        authorize_capability_read(&database, &runtime, &headers, request_id, capability).await?;
    }
    let Query(query) = query.map_err(|_| {
        failure(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::VALIDATION_FAILED,
            "检查条件格式不正确",
            request_id,
        )
    })?;
    let action = match query.action {
        PermissionMatrixAction::Browse => "browse",
        PermissionMatrixAction::TopicCreate => "topic_create",
        PermissionMatrixAction::ReplyCreate => "reply_create",
        PermissionMatrixAction::AttachmentUpload => "attachment_upload",
        PermissionMatrixAction::AttachmentDownload => "attachment_download",
        PermissionMatrixAction::ModerationBrowse => "moderation_browse",
        PermissionMatrixAction::TopicPin => "topic_pin",
        PermissionMatrixAction::TopicFeature => "topic_feature",
        PermissionMatrixAction::TopicLock => "topic_lock",
        PermissionMatrixAction::TopicMove => "topic_move",
    };
    let record = database.permission_check(query.board_id, query.user_id, action, query.topic_id, query.attachment_id, query.file_bytes, query.target_board_id).await.map_err(|error| match error {
        PermissionMatrixError::BoardNotFound => failure(StatusCode::NOT_FOUND, error_codes::ADMIN_BOARD_NOT_FOUND, "版块不存在", request_id),
        PermissionMatrixError::SubjectNotFound => failure(StatusCode::NOT_FOUND, "permission_check.subject_not_found", "所选用户不存在", request_id),
        PermissionMatrixError::InvalidScenario => failure(StatusCode::UNPROCESSABLE_ENTITY, error_codes::VALIDATION_FAILED, "检查条件不匹配或文件大小超出服务上限", request_id),
        PermissionMatrixError::SourceLimit => failure(StatusCode::UNPROCESSABLE_ENTITY, "permission_check.source_limit", "该用户的有效来源超过检查上限，未生成部分权限结论", request_id),
        PermissionMatrixError::Database(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Permission check query failed");
            failure(StatusCode::SERVICE_UNAVAILABLE, error_codes::DATABASE_UNAVAILABLE, "权限检查暂时不可用", request_id)
        }
    })?;
    let topic_revision = record.topic_revision;
    let mut matrix = map_record(record).map_err(|_| {
        failure(
            StatusCode::SERVICE_UNAVAILABLE,
            error_codes::DATABASE_UNAVAILABLE,
            "检查数据格式异常",
            request_id,
        )
    })?;
    let scenario = matrix.scenarios.pop().ok_or_else(|| {
        failure(
            StatusCode::SERVICE_UNAVAILABLE,
            error_codes::DATABASE_UNAVAILABLE,
            "检查数据格式异常",
            request_id,
        )
    })?;
    let data = PermissionCheck {
        board_id: query.board_id,
        topic_id: query.topic_id,
        attachment_id: query.attachment_id,
        file_bytes: query.file_bytes,
        target_board_id: query.target_board_id,
        policy_revision: matrix.policy_revision,
        topic_revision,
        evaluated_at: matrix.evaluated_at,
        scenario,
    };
    let mut response_headers = HeaderMap::new();
    response_headers.insert("cache-control", HeaderValue::from_static("no-store"));
    Ok((response_headers, Json(ApiResponse::new(data, request_id))))
}
