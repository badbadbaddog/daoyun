use api_contract::{
    AdminUserStatus, ApiResponse, BatchReportResult, BatchUpdateReportsRequest, ContentReport,
    ContentReportDetail, ContentReportReceipt, CreateReportModerationRequest, CreateReportRequest,
    ErrorBody, ErrorCode, ErrorResponse, FieldErrors, PageResponse, ReportAuthorContext,
    ReportContentAction, ReportContentContext, ReportContextItem, ReportDisposition,
    ReportHandlingRecord, ReportHistoryItem, ReportModerationContentResult, ReportModerationResult,
    ReportModerationUserResult, ReportReason, ReportResolution, ReportStatus, ReportTargetType,
    ReportUserActionKind, RequestId, UpdateReportRequest, UserSummary, error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use infrastructure::{
    ContentReportDetailRecord, ContentReportRecord, CreateContentReportError, Database,
    GetContentReportDetailError, ListContentReportsError, ModerateContentReportError,
    ModerateContentReportRecord, ModerateReportUserRecord, NewContentReportRecord,
    ReportModerationResultRecord, UpdateContentReportError, UpdateContentReportRecord,
    permission_keys,
};
use serde::Deserialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::IntoParams;
use uuid::Uuid;

use crate::{
    admin::{authorize_capability_read, authorize_capability_write},
    auth::{ApiError, AuthRuntime, authenticate_state_change},
};

const REPORT_BODY_LIMIT: usize = 32 * 1024;
const DEFAULT_LIMIT: u16 = 20;
const MAX_LIMIT: u16 = 50;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListReportsQuery {
    status: Option<ReportStatus>,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/reports", post(create_report))
        .route("/api/v1/admin/reports", get(list_reports))
        .route("/api/v1/admin/reports/batch", post(batch_update_reports))
        .route(
            "/api/v1/admin/reports/{report_id}",
            get(get_report).patch(update_report),
        )
        .route(
            "/api/v1/admin/reports/{report_id}/moderations",
            post(moderate_report),
        )
        .layer(DefaultBodyLimit::max(REPORT_BODY_LIMIT))
        .layer(Extension(runtime))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/reports/{report_id}",
    operation_id = "getContentReport",
    tag = "governance",
    params(("report_id" = Uuid, Path)),
    responses(
        (status = 200, body = ApiResponse<ContentReportDetail>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn get_report(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<ContentReportDetail>>, ApiError> {
    let Path(report_id) = path.map_err(|_| path_invalid(request_id))?;
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::GOVERNANCE_REPORTS_READ,
    )
    .await?;
    let detail = database
        .get_content_report_detail(report_id)
        .await
        .map_err(|error| match error {
            GetContentReportDetailError::NotFound => report_not_found(request_id),
            GetContentReportDetailError::Database(error) => database_unavailable(request_id, error),
        })?;
    let detail = map_report_detail(detail).map_err(|()| {
        database_unavailable(request_id, infrastructure::DatabaseError::MigrationState)
    })?;
    Ok(Json(ApiResponse::new(detail, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/reports/{report_id}/moderations",
    operation_id = "createReportModeration",
    tag = "governance",
    params(("report_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = CreateReportModerationRequest,
    responses(
        (status = 201, body = ApiResponse<ReportModerationResult>, headers(("x-request-id" = String))),
        (status = 400, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn moderate_report(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<CreateReportModerationRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<ReportModerationResult>>), ApiError> {
    let Path(report_id) = path.map_err(|_| path_invalid(request_id))?;
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::GOVERNANCE_REPORTS_RESOLVE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input =
        validate_moderation(request).map_err(|fields| validation_fields(request_id, fields))?;
    let result = database
        .moderate_content_report(ModerateContentReportRecord {
            report_id,
            reviewer_id: session.user.id,
            disposition: report_disposition(input.disposition),
            content_action: report_content_action(input.content_action),
            user_action: input.user_action.map(|action| ModerateReportUserRecord {
                status: report_user_action_kind(action.kind),
                reason: action.reason,
                expires_at: action.expires_at,
            }),
            public_reason: input.public_reason,
            note: input.note,
            expected_revision: input.expected_revision,
        })
        .await
        .map_err(|error| moderation_error(request_id, error))?;
    let result = map_moderation_result(result).map_err(|()| {
        database_unavailable(request_id, infrastructure::DatabaseError::MigrationState)
    })?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::new(result, request_id)),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/reports",
    operation_id = "createContentReport",
    tag = "governance",
    request_body = CreateReportRequest,
    params(("x-csrf-token" = String, Header)),
    responses(
        (status = 201, description = "A new content report was created", body = ApiResponse<ContentReportReceipt>, headers(("x-request-id" = String))),
        (status = 200, description = "An existing report was returned idempotently", body = ApiResponse<ContentReportReceipt>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn create_report(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<CreateReportRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<ContentReportReceipt>>), ApiError> {
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input =
        validate_create_report(request).map_err(|fields| validation_fields(request_id, fields))?;
    let result = database
        .create_content_report(
            session.user.id,
            NewContentReportRecord {
                id: Uuid::now_v7(),
                target_type: target_type(input.target_type).to_owned(),
                target_id: input.target_id,
                reason: report_reason(input.reason).to_owned(),
                details: input.details,
            },
        )
        .await
        .map_err(|error| match error {
            CreateContentReportError::TargetUnavailable => report_target_not_found(request_id),
            CreateContentReportError::Database(error) => database_unavailable(request_id, error),
        })?;
    let status = if result.created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((
        status,
        Json(ApiResponse::new(
            ContentReportReceipt {
                id: result.id,
                created: result.created,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/reports",
    operation_id = "listContentReports",
    tag = "governance",
    params(ListReportsQuery),
    responses(
        (status = 200, body = PageResponse<ContentReport>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_reports(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListReportsQuery>, QueryRejection>,
) -> Result<Json<PageResponse<ContentReport>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::GOVERNANCE_REPORTS_READ,
    )
    .await?;
    let query = validate_query(query)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let limit = query.limit.expect("validated report limit");
    let status = query.status.map(report_status);
    let mut records = database
        .list_content_reports(status, query.cursor, i64::from(limit) + 1)
        .await
        .map_err(|error| match error {
            ListContentReportsError::InvalidCursor => {
                validation_error(request_id, "cursor", "cursor 不属于当前举报列表")
            }
            ListContentReportsError::Database(error) => database_unavailable(request_id, error),
        })?;
    let next_cursor = if records.len() > usize::from(limit) {
        records.truncate(usize::from(limit));
        records.last().map(|record| record.id.to_string())
    } else {
        None
    };
    let reports = records
        .into_iter()
        .map(map_report)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| {
            database_unavailable(request_id, infrastructure::DatabaseError::MigrationState)
        })?;
    Ok(Json(PageResponse::new(reports, request_id, next_cursor)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/reports/{report_id}",
    operation_id = "updateContentReport",
    tag = "governance",
    params(("report_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdateReportRequest,
    responses(
        (status = 200, body = ApiResponse<ContentReport>, headers(("x-request-id" = String))),
        (status = 400, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update_report(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<UpdateReportRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ContentReport>>, ApiError> {
    let Path(report_id) = path.map_err(|_| path_invalid(request_id))?;
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::GOVERNANCE_REPORTS_RESOLVE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input =
        validate_update_report(request).map_err(|fields| validation_fields(request_id, fields))?;
    let record = database
        .update_content_report(UpdateContentReportRecord {
            report_id,
            status: report_status(input.status),
            resolution: report_resolution(input.resolution),
            reviewer_id: session.user.id,
            note: input.note,
            expected_revision: Some(input.expected_revision),
        })
        .await
        .map_err(|error| match error {
            UpdateContentReportError::NotFound | UpdateContentReportError::TargetUnavailable => {
                report_not_found(request_id)
            }
            UpdateContentReportError::InvalidAction => report_invalid_action(request_id),
            UpdateContentReportError::Conflict => report_conflict(request_id),
            UpdateContentReportError::Database(error) => database_unavailable(request_id, error),
        })?;
    let report = map_report(record).map_err(|()| {
        database_unavailable(request_id, infrastructure::DatabaseError::MigrationState)
    })?;
    Ok(Json(ApiResponse::new(report, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/reports/batch",
    operation_id = "batchUpdateContentReports",
    tag = "governance",
    params(("x-csrf-token" = String, Header)),
    request_body = BatchUpdateReportsRequest,
    responses(
        (status = 200, body = ApiResponse<BatchReportResult>, headers(("x-request-id" = String))),
        (status = 400, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn batch_update_reports(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<BatchUpdateReportsRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<BatchReportResult>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::GOVERNANCE_REPORTS_RESOLVE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input = validate_batch_update_report(request)
        .map_err(|fields| validation_fields(request_id, fields))?;
    let records = database
        .update_content_reports_batch(
            &input
                .report_ids
                .iter()
                .map(|report_id| UpdateContentReportRecord {
                    report_id: *report_id,
                    status: report_status(input.status),
                    resolution: report_resolution(input.resolution),
                    reviewer_id: session.user.id,
                    note: input.note.clone(),
                    expected_revision: None,
                })
                .collect::<Vec<_>>(),
        )
        .await
        .map_err(|error| match error {
            UpdateContentReportError::NotFound | UpdateContentReportError::TargetUnavailable => {
                report_not_found(request_id)
            }
            UpdateContentReportError::InvalidAction => report_invalid_action(request_id),
            UpdateContentReportError::Conflict => report_conflict(request_id),
            UpdateContentReportError::Database(error) => database_unavailable(request_id, error),
        })?;
    Ok(Json(ApiResponse::new(
        BatchReportResult {
            updated: u32::try_from(records.len()).expect("validated batch size fits u32"),
            report_ids: records.into_iter().map(|record| record.id).collect(),
        },
        request_id,
    )))
}

struct ValidatedCreateReport {
    target_type: ReportTargetType,
    target_id: Uuid,
    reason: ReportReason,
    details: Option<String>,
}

struct ValidatedUpdateReport {
    status: ReportStatus,
    resolution: ReportResolution,
    note: Option<String>,
    expected_revision: i64,
}

struct ValidatedBatchUpdateReport {
    report_ids: Vec<Uuid>,
    status: ReportStatus,
    resolution: ReportResolution,
    note: Option<String>,
}

struct ValidatedReportUserAction {
    kind: ReportUserActionKind,
    reason: String,
    expires_at: Option<OffsetDateTime>,
}

struct ValidatedModeration {
    disposition: ReportDisposition,
    content_action: ReportContentAction,
    user_action: Option<ValidatedReportUserAction>,
    public_reason: Option<String>,
    note: String,
    expected_revision: i64,
}

fn validate_moderation(
    request: CreateReportModerationRequest,
) -> Result<ValidatedModeration, FieldErrors> {
    let mut fields = FieldErrors::new();
    let note = request.note.trim().to_owned();
    if !(2..=1000).contains(&note.chars().count()) || note.chars().any(char::is_control) {
        add_field(
            &mut fields,
            "note",
            "内部备注必须为 2 到 1000 个字符且不能包含控制字符",
        );
    }
    let public_reason = request.public_reason.map(|value| value.trim().to_owned());
    if public_reason.as_ref().is_some_and(|reason| {
        !(2..=500).contains(&reason.chars().count()) || reason.chars().any(char::is_control)
    }) {
        add_field(
            &mut fields,
            "public_reason",
            "公开原因必须为 2 到 500 个字符且不能包含控制字符",
        );
    }
    if request.expected_revision < 1 {
        add_field(
            &mut fields,
            "expected_revision",
            "expected_revision 必须大于 0",
        );
    }
    let user_action = request.user_action.map(|action| {
        let reason = action.reason.trim().to_owned();
        if !(2..=500).contains(&reason.chars().count()) || reason.chars().any(char::is_control) {
            add_field(
                &mut fields,
                "user_action.reason",
                "用户处置原因必须为 2 到 500 个字符且不能包含控制字符",
            );
        }
        let expires_at = action
            .expires_at
            .as_deref()
            .map(|value| OffsetDateTime::parse(value, &Rfc3339))
            .transpose();
        let expires_at = match expires_at {
            Ok(value) => value,
            Err(_) => {
                add_field(
                    &mut fields,
                    "user_action.expires_at",
                    "到期时间必须是 RFC 3339 时间",
                );
                None
            }
        };
        if expires_at.is_some_and(|value| value <= OffsetDateTime::now_utc()) {
            add_field(
                &mut fields,
                "user_action.expires_at",
                "到期时间必须晚于当前时间",
            );
        }
        ValidatedReportUserAction {
            kind: action.kind,
            reason,
            expires_at,
        }
    });
    let valid_combination = match request.disposition {
        ReportDisposition::Dismissed => {
            request.content_action == ReportContentAction::None && user_action.is_none()
        }
        ReportDisposition::Resolved => {
            request.content_action == ReportContentAction::Hide || user_action.is_some()
        }
    };
    if !valid_combination {
        add_field(
            &mut fields,
            "disposition",
            "驳回不能包含副作用，解决必须至少选择一项处置",
        );
    }
    if !fields.is_empty() {
        return Err(fields);
    }
    Ok(ValidatedModeration {
        disposition: request.disposition,
        content_action: request.content_action,
        user_action,
        public_reason,
        note,
        expected_revision: request.expected_revision,
    })
}

fn validate_create_report(
    request: CreateReportRequest,
) -> Result<ValidatedCreateReport, FieldErrors> {
    let mut fields = FieldErrors::new();
    let details = request.details.map(|value| value.trim().to_owned());
    if details.as_deref().is_some_and(|value| {
        value.is_empty() || value.chars().count() > 1000 || value.chars().any(char::is_control)
    }) {
        add_field(
            &mut fields,
            "details",
            "补充说明必须为 1 到 1000 个字符且不能包含控制字符",
        );
    }
    if fields.is_empty() {
        Ok(ValidatedCreateReport {
            target_type: request.target_type,
            target_id: request.target_id,
            reason: request.reason,
            details,
        })
    } else {
        Err(fields)
    }
}

fn validate_update_report(
    request: UpdateReportRequest,
) -> Result<ValidatedUpdateReport, FieldErrors> {
    let mut fields = FieldErrors::new();
    let note = request.note.map(|value| value.trim().to_owned());
    if note.as_deref().is_some_and(|value| {
        value.is_empty() || value.chars().count() > 1000 || value.chars().any(char::is_control)
    }) {
        add_field(
            &mut fields,
            "note",
            "处理备注必须为 1 到 1000 个字符且不能包含控制字符",
        );
    }
    if !valid_action(request.status, request.resolution) {
        add_field(&mut fields, "resolution", "处理状态和动作组合无效");
    }
    if request.expected_revision < 1 {
        add_field(&mut fields, "expected_revision", "版本号必须大于等于 1");
    }
    if fields.is_empty() {
        Ok(ValidatedUpdateReport {
            status: request.status,
            resolution: request.resolution,
            note,
            expected_revision: request.expected_revision,
        })
    } else {
        Err(fields)
    }
}

fn validate_batch_update_report(
    request: BatchUpdateReportsRequest,
) -> Result<ValidatedBatchUpdateReport, FieldErrors> {
    let mut fields = FieldErrors::new();
    if request.report_ids.is_empty() || request.report_ids.len() > 50 {
        add_field(&mut fields, "report_ids", "一次必须处理 1 到 50 条举报");
    }
    let mut unique = request.report_ids.clone();
    unique.sort_unstable();
    unique.dedup();
    if unique.len() != request.report_ids.len() {
        add_field(&mut fields, "report_ids", "举报 ID 不能重复");
    }
    let note = request.note.map(|value| value.trim().to_owned());
    if note.as_deref().is_some_and(|value| {
        value.is_empty() || value.chars().count() > 1000 || value.chars().any(char::is_control)
    }) {
        add_field(
            &mut fields,
            "note",
            "处理备注必须为 1 到 1000 个字符且不能包含控制字符",
        );
    }
    if !valid_action(request.status, request.resolution) {
        add_field(&mut fields, "resolution", "处理状态和动作组合无效");
    }
    if fields.is_empty() {
        Ok(ValidatedBatchUpdateReport {
            report_ids: request.report_ids,
            status: request.status,
            resolution: request.resolution,
            note,
        })
    } else {
        Err(fields)
    }
}

fn validate_query(
    query: Result<Query<ListReportsQuery>, QueryRejection>,
) -> Result<ListReportsQuery, (&'static str, &'static str)> {
    let Query(query) = query.map_err(|_| ("query", "举报查询参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }
    Ok(ListReportsQuery {
        status: query.status,
        cursor: query.cursor,
        limit: Some(limit),
    })
}

pub(crate) fn map_report(record: ContentReportRecord) -> Result<ContentReport, ()> {
    let target_author = match record.target_author_id {
        Some(id) => Some(UserSummary {
            id,
            username: record.target_author_username.ok_or(())?,
            display_name: record.target_author_display_name.ok_or(())?,
            avatar_url: record.target_author_avatar_url,
        }),
        None => None,
    };
    let reviewer = match record.reviewer_id {
        Some(id) => Some(UserSummary {
            id,
            username: record.reviewer_username.ok_or(())?,
            display_name: record.reviewer_display_name.ok_or(())?,
            avatar_url: record.reviewer_avatar_url,
        }),
        None => None,
    };
    Ok(ContentReport {
        id: record.id,
        target_type: parse_target_type(&record.target_type).ok_or(())?,
        target_id: record.target_id,
        target_topic_id: record.target_topic_id,
        target_title: record.target_title,
        target_author,
        reporter: UserSummary {
            id: record.reporter_id,
            username: record.reporter_username,
            display_name: record.reporter_display_name,
            avatar_url: record.reporter_avatar_url,
        },
        reason: parse_reason(&record.reason).ok_or(())?,
        details: record.details,
        status: parse_status(&record.status).ok_or(())?,
        resolution: parse_resolution(&record.resolution).ok_or(())?,
        resolution_note: record.resolution_note,
        reviewer,
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
        resolved_at: record.resolved_at.map(format_time),
        revision: record.revision,
    })
}

fn map_report_detail(record: ContentReportDetailRecord) -> Result<ContentReportDetail, ()> {
    let context_items = record
        .context
        .items
        .into_iter()
        .map(|item| {
            let author = match item.author_id {
                Some(id) => Some(UserSummary {
                    id,
                    username: item.author_username.ok_or(())?,
                    display_name: item.author_display_name.ok_or(())?,
                    avatar_url: item.author_avatar_url,
                }),
                None => None,
            };
            Ok(ReportContextItem {
                id: item.id,
                author,
                content: item.content,
                status: item.status,
                is_target: item.is_target,
                created_at: format_time(item.created_at),
            })
        })
        .collect::<Result<Vec<_>, ()>>()?;
    let author = record
        .author
        .map(|author| -> Result<ReportAuthorContext, ()> {
            Ok(ReportAuthorContext {
                user: UserSummary {
                    id: author.id,
                    username: author.username,
                    display_name: author.display_name,
                    avatar_url: author.avatar_url,
                },
                status: parse_admin_user_status(&author.status).ok_or(())?,
                report_count: u64::try_from(author.report_count).map_err(|_| ())?,
                revision: u64::try_from(author.revision).map_err(|_| ())?,
            })
        })
        .transpose()?;
    let related_reports = record
        .related_reports
        .into_iter()
        .map(|history| {
            Ok(ReportHistoryItem {
                id: history.id,
                reason: parse_reason(&history.reason).ok_or(())?,
                status: parse_status(&history.status).ok_or(())?,
                resolution: parse_resolution(&history.resolution).ok_or(())?,
                created_at: format_time(history.created_at),
                resolved_at: history.resolved_at.map(format_time),
            })
        })
        .collect::<Result<Vec<_>, ()>>()?;
    let handling_history = record
        .handling_history
        .into_iter()
        .map(|entry| ReportHandlingRecord {
            id: entry.id,
            action: entry.action,
            actor: UserSummary {
                id: entry.actor_id,
                username: entry.actor_username,
                display_name: entry.actor_display_name,
                avatar_url: entry.actor_avatar_url,
            },
            created_at: format_time(entry.created_at),
        })
        .collect();
    Ok(ContentReportDetail {
        report: map_report(record.report)?,
        context: ReportContentContext {
            topic_id: record.context.topic_id,
            title: record.context.title,
            items: context_items,
        },
        author,
        related_reports,
        handling_history,
    })
}

fn parse_admin_user_status(value: &str) -> Option<AdminUserStatus> {
    Some(match value {
        "active" => AdminUserStatus::Active,
        "restricted" => AdminUserStatus::Restricted,
        "suspended" => AdminUserStatus::Suspended,
        _ => return None,
    })
}

fn report_disposition(value: ReportDisposition) -> &'static str {
    match value {
        ReportDisposition::Resolved => "resolved",
        ReportDisposition::Dismissed => "dismissed",
    }
}

fn report_content_action(value: ReportContentAction) -> &'static str {
    match value {
        ReportContentAction::None => "none",
        ReportContentAction::Hide => "hide",
    }
}

fn report_user_action_kind(value: ReportUserActionKind) -> &'static str {
    match value {
        ReportUserActionKind::Restricted => "restricted",
        ReportUserActionKind::Suspended => "suspended",
    }
}

fn map_moderation_result(
    record: ReportModerationResultRecord,
) -> Result<ReportModerationResult, ()> {
    let user = record
        .user
        .map(|user| {
            Ok::<_, ()>(ReportModerationUserResult {
                user_id: user.user_id,
                status: parse_admin_user_status(&user.status).ok_or(())?,
                reason: user.reason,
                expires_at: user.expires_at.map(format_time),
                revision: u64::try_from(user.revision).map_err(|_| ())?,
            })
        })
        .transpose()?;
    Ok(ReportModerationResult {
        report: map_report(record.report)?,
        content: ReportModerationContentResult {
            action: match record.content_action.as_str() {
                "none" => ReportContentAction::None,
                "hide" => ReportContentAction::Hide,
                _ => return Err(()),
            },
            target_id: record.target_id,
            changed: record.content_changed,
        },
        user,
        audit_id: record.audit_id,
        notification_queued: record.notification_queued,
    })
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .expect("governance timestamp must format")
}

fn target_type(value: ReportTargetType) -> &'static str {
    match value {
        ReportTargetType::Topic => "topic",
        ReportTargetType::Post => "post",
    }
}

fn parse_target_type(value: &str) -> Option<ReportTargetType> {
    Some(match value {
        "topic" => ReportTargetType::Topic,
        "post" => ReportTargetType::Post,
        _ => return None,
    })
}

fn report_reason(value: ReportReason) -> &'static str {
    match value {
        ReportReason::Spam => "spam",
        ReportReason::Harassment => "harassment",
        ReportReason::Illegal => "illegal",
        ReportReason::Copyright => "copyright",
        ReportReason::Other => "other",
    }
}

fn parse_reason(value: &str) -> Option<ReportReason> {
    Some(match value {
        "spam" => ReportReason::Spam,
        "harassment" => ReportReason::Harassment,
        "illegal" => ReportReason::Illegal,
        "copyright" => ReportReason::Copyright,
        "other" => ReportReason::Other,
        _ => return None,
    })
}

fn report_status(value: ReportStatus) -> &'static str {
    match value {
        ReportStatus::Open => "open",
        ReportStatus::InReview => "in_review",
        ReportStatus::Resolved => "resolved",
        ReportStatus::Dismissed => "dismissed",
    }
}

fn parse_status(value: &str) -> Option<ReportStatus> {
    Some(match value {
        "open" => ReportStatus::Open,
        "in_review" => ReportStatus::InReview,
        "resolved" => ReportStatus::Resolved,
        "dismissed" => ReportStatus::Dismissed,
        _ => return None,
    })
}

fn report_resolution(value: ReportResolution) -> &'static str {
    match value {
        ReportResolution::None => "none",
        ReportResolution::HideTopic => "hide_topic",
        ReportResolution::HidePost => "hide_post",
        ReportResolution::SuspendAuthor => "suspend_author",
        ReportResolution::Dismiss => "dismiss",
    }
}

fn parse_resolution(value: &str) -> Option<ReportResolution> {
    Some(match value {
        "none" => ReportResolution::None,
        "hide_topic" => ReportResolution::HideTopic,
        "hide_post" => ReportResolution::HidePost,
        "suspend_author" => ReportResolution::SuspendAuthor,
        "dismiss" => ReportResolution::Dismiss,
        _ => return None,
    })
}

fn valid_action(status: ReportStatus, resolution: ReportResolution) -> bool {
    matches!(status, ReportStatus::Open | ReportStatus::InReview)
        && resolution == ReportResolution::None
}

fn add_field(fields: &mut FieldErrors, field: &'static str, message: &'static str) {
    fields
        .entry(field.to_owned())
        .or_default()
        .push(message.to_owned());
}

fn validation_error(request_id: RequestId, field: &'static str, message: &'static str) -> ApiError {
    let mut fields = FieldErrors::new();
    add_field(&mut fields, field, message);
    validation_fields(request_id, fields)
}

fn validation_fields(request_id: RequestId, fields: FieldErrors) -> ApiError {
    let mut body = ErrorBody::new(
        ErrorCode::from_static(error_codes::VALIDATION_FAILED),
        "请求参数校验失败",
    );
    body.fields = fields;
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        HeaderMap::new(),
        Json(ErrorResponse::new(body, request_id)),
    )
}

fn path_invalid(request_id: RequestId) -> ApiError {
    validation_error(request_id, "report_id", "举报路径参数必须是 UUID")
}

fn report_target_not_found(request_id: RequestId) -> ApiError {
    governance_error(
        StatusCode::NOT_FOUND,
        error_codes::REPORT_TARGET_NOT_FOUND,
        "举报目标不存在或不可访问",
        request_id,
    )
}

fn report_not_found(request_id: RequestId) -> ApiError {
    governance_error(
        StatusCode::NOT_FOUND,
        error_codes::REPORT_NOT_FOUND,
        "举报不存在或不可处理",
        request_id,
    )
}

fn report_invalid_action(request_id: RequestId) -> ApiError {
    governance_error(
        StatusCode::UNPROCESSABLE_ENTITY,
        error_codes::REPORT_INVALID_ACTION,
        "举报处理动作无效",
        request_id,
    )
}

fn report_conflict(request_id: RequestId) -> ApiError {
    governance_error(
        StatusCode::CONFLICT,
        error_codes::GOVERNANCE_REPORT_CONFLICT,
        "举报已被其他管理员更新，请刷新后重试",
        request_id,
    )
}

fn moderation_error(request_id: RequestId, error: ModerateContentReportError) -> ApiError {
    match error {
        ModerateContentReportError::NotFound => governance_error(
            StatusCode::NOT_FOUND,
            error_codes::GOVERNANCE_REPORT_NOT_FOUND,
            "举报不存在或已不可处理",
            request_id,
        ),
        ModerateContentReportError::Forbidden => governance_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号没有举报处置权限",
            request_id,
        ),
        ModerateContentReportError::Conflict => governance_error(
            StatusCode::CONFLICT,
            error_codes::GOVERNANCE_REPORT_CONFLICT,
            "举报已被其他管理员更新，请刷新后重试",
            request_id,
        ),
        ModerateContentReportError::Invalid => governance_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::GOVERNANCE_MODERATION_INVALID,
            "举报处置组合无效，请检查选择的动作",
            request_id,
        ),
        ModerateContentReportError::TargetStateConflict => governance_error(
            StatusCode::CONFLICT,
            error_codes::GOVERNANCE_TARGET_STATE_CONFLICT,
            "目标内容或作者状态已变化，请刷新详情后重试",
            request_id,
        ),
        ModerateContentReportError::Database(error) => database_unavailable(request_id, error),
        ModerateContentReportError::Outbox(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Report moderation outbox operation failed");
            governance_error(
                StatusCode::SERVICE_UNAVAILABLE,
                error_codes::DATABASE_UNAVAILABLE,
                "举报处置暂时无法完成",
                request_id,
            )
        }
    }
}

fn database_unavailable(request_id: RequestId, error: infrastructure::DatabaseError) -> ApiError {
    tracing::warn!(request_id = %request_id, error = %error, "Content governance database operation failed");
    governance_error(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::DATABASE_UNAVAILABLE,
        "内容治理服务暂时不可用",
        request_id,
    )
}

fn governance_error(
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
