use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, FieldErrors, OperationsAlert,
    OperationsAlertCounts, OperationsAlertRule, OperationsAlertRuleKind,
    OperationsAlertRuleReference, OperationsAlertStatus, OperationsDatabaseSummary,
    OperationsHttpSummary, OperationsOutboxSummary, OperationsSummary, PageResponse, RequestId,
    UpdateOperationsAlertRequest, UpdateOperationsAlertRuleRequest, UserSummary, error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State, rejection::JsonRejection, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    routing::{get, patch},
};
use infrastructure::{
    Database, ListOperationsAlertsError, MutateOperationsAlertError, OperationsAlertRecord,
    OperationsAlertRuleRecord, UpdateOperationsAlertRuleRecord, permission_keys,
};
use serde::Deserialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::IntoParams;
use uuid::Uuid;

use crate::admin::{authorize_capability_read, authorize_capability_write};
use crate::auth::{ApiError, AuthRuntime};
use crate::observability::ObservabilityRuntime;

const DEFAULT_ALERT_LIMIT: u16 = 20;
const MAX_ALERT_LIMIT: u16 = 50;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListOperationsAlertsQuery {
    status: Option<OperationsAlertStatus>,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/admin/operations/summary", get(summary))
        .route(
            "/api/v1/admin/operations/alert-rules",
            get(list_alert_rules),
        )
        .route(
            "/api/v1/admin/operations/alert-rules/{rule_id}",
            patch(update_alert_rule),
        )
        .route("/api/v1/admin/operations/alerts", get(list_alerts))
        .route(
            "/api/v1/admin/operations/alerts/{alert_id}",
            patch(acknowledge_alert),
        )
        .layer(Extension(runtime))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/operations/summary",
    operation_id = "getOperationsSummary",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<OperationsSummary>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn summary(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(observability): Extension<ObservabilityRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<OperationsSummary>>, ApiError> {
    authorize_capability_read(
        &database,
        &auth_runtime,
        &headers,
        request_id,
        permission_keys::OPERATIONS_READ,
    )
    .await?;
    database
        .check_readiness()
        .await
        .map_err(|error| database_error(request_id, error, "Operations readiness query failed"))?;
    let persistent = database
        .operations_summary()
        .await
        .map_err(|error| database_error(request_id, error, "Operations summary query failed"))?;
    let snapshot = observability.snapshot();
    let data = OperationsSummary {
        observed_at: format_time(OffsetDateTime::now_utc()),
        uptime_seconds: snapshot.uptime_seconds,
        http: OperationsHttpSummary {
            total_requests: snapshot.total_requests,
            in_flight_requests: snapshot.in_flight_requests,
            errors_5m: snapshot.errors_5m,
            p95_ms_5m: snapshot.p95_ms_5m,
        },
        database: OperationsDatabaseSummary {
            ready: true,
            connections: persistent.database_connections,
            idle_connections: persistent.database_idle_connections,
        },
        outbox: OperationsOutboxSummary {
            pending: nonnegative(persistent.outbox_pending)
                .map_err(|()| invalid_record(request_id))?,
            processing: nonnegative(persistent.outbox_processing)
                .map_err(|()| invalid_record(request_id))?,
            dead: nonnegative(persistent.outbox_dead).map_err(|()| invalid_record(request_id))?,
        },
        risk_alerts_open: nonnegative(persistent.risk_alerts_open)
            .map_err(|()| invalid_record(request_id))?,
        alerts: OperationsAlertCounts {
            open: nonnegative(persistent.operations_alerts_open)
                .map_err(|()| invalid_record(request_id))?,
            acknowledged: nonnegative(persistent.operations_alerts_acknowledged)
                .map_err(|()| invalid_record(request_id))?,
        },
    };
    Ok(Json(ApiResponse::new(data, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/operations/alert-rules",
    operation_id = "listOperationsAlertRules",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<Vec<OperationsAlertRule>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_alert_rules(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<OperationsAlertRule>>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::OPERATIONS_READ,
    )
    .await?;
    let rules = database
        .list_operations_alert_rules()
        .await
        .map_err(|error| database_error(request_id, error, "Operations rules query failed"))?
        .into_iter()
        .map(map_alert_rule)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(rules, request_id)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/operations/alert-rules/{rule_id}",
    operation_id = "updateOperationsAlertRule",
    tag = "admin",
    params(("rule_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdateOperationsAlertRuleRequest,
    responses(
        (status = 200, body = ApiResponse<OperationsAlertRule>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update_alert_rule(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    request: Result<Json<UpdateOperationsAlertRuleRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<OperationsAlertRule>>, ApiError> {
    let Path(rule_id) =
        path.map_err(|_| validation_error(request_id, "rule_id", "规则路径参数必须是 UUID"))?;
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::OPERATIONS_ALERTS_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input = validate_rule_request(rule_id, request)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let rule = database
        .update_operations_alert_rule(session.user.id, input)
        .await
        .map_err(|error| mutation_error(request_id, error, true))?;
    Ok(Json(ApiResponse::new(
        map_alert_rule(rule).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/operations/alerts",
    operation_id = "listOperationsAlerts",
    tag = "admin",
    params(ListOperationsAlertsQuery),
    responses(
        (status = 200, body = PageResponse<OperationsAlert>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_alerts(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListOperationsAlertsQuery>, QueryRejection>,
) -> Result<Json<PageResponse<OperationsAlert>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::OPERATIONS_READ,
    )
    .await?;
    let Query(query) =
        query.map_err(|_| validation_error(request_id, "query", "告警查询参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_ALERT_LIMIT);
    if !(1..=MAX_ALERT_LIMIT).contains(&limit) {
        return Err(validation_error(
            request_id,
            "limit",
            "limit 必须在 1 到 50 之间",
        ));
    }
    let status = query.status.map(alert_status_value);
    let mut records = database
        .list_operations_alerts(status, query.cursor, i64::from(limit) + 1)
        .await
        .map_err(|error| match error {
            ListOperationsAlertsError::InvalidInput => {
                validation_error(request_id, "query", "告警查询参数无效")
            }
            ListOperationsAlertsError::InvalidCursor => {
                validation_error(request_id, "cursor", "cursor 不属于当前运营告警列表")
            }
            ListOperationsAlertsError::Database(error) => {
                database_error(request_id, error, "Operations alerts query failed")
            }
        })?;
    let next_cursor = if records.len() > usize::from(limit) {
        records.truncate(usize::from(limit));
        records.last().map(|record| record.id.to_string())
    } else {
        None
    };
    let alerts = records
        .into_iter()
        .map(map_alert)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(PageResponse::new(alerts, request_id, next_cursor)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/operations/alerts/{alert_id}",
    operation_id = "acknowledgeOperationsAlert",
    tag = "admin",
    params(("alert_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdateOperationsAlertRequest,
    responses(
        (status = 200, body = ApiResponse<OperationsAlert>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn acknowledge_alert(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    request: Result<Json<UpdateOperationsAlertRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<OperationsAlert>>, ApiError> {
    let Path(alert_id) =
        path.map_err(|_| validation_error(request_id, "alert_id", "告警路径参数必须是 UUID"))?;
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::OPERATIONS_ALERTS_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    if request.status != OperationsAlertStatus::Acknowledged {
        return Err(validation_error(request_id, "status", "运营告警只能确认"));
    }
    let alert = database
        .acknowledge_operations_alert(session.user.id, alert_id)
        .await
        .map_err(|error| mutation_error(request_id, error, false))?;
    Ok(Json(ApiResponse::new(
        map_alert(alert).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

fn validate_rule_request(
    rule_id: Uuid,
    request: UpdateOperationsAlertRuleRequest,
) -> Result<UpdateOperationsAlertRuleRecord, (&'static str, &'static str)> {
    let name = request.name.trim().to_owned();
    if !(1..=80).contains(&name.chars().count()) || name.chars().any(char::is_control) {
        return Err(("name", "规则名称必须为 1 到 80 个字符且不能包含控制字符"));
    }
    if request.threshold > 1_000_000_000 {
        return Err(("threshold", "threshold 必须在 0 到 1000000000 之间"));
    }
    if !(30..=86_400).contains(&request.window_seconds) {
        return Err(("window_seconds", "window_seconds 必须在 30 到 86400 之间"));
    }
    if request.expected_revision == 0 || request.expected_revision > i64::MAX as u64 {
        return Err(("expected_revision", "expected_revision 必须为正整数"));
    }
    Ok(UpdateOperationsAlertRuleRecord {
        rule_id,
        name,
        threshold: i64::try_from(request.threshold).map_err(|_| ("threshold", "threshold 无效"))?,
        window_seconds: i32::try_from(request.window_seconds)
            .map_err(|_| ("window_seconds", "window_seconds 无效"))?,
        enabled: request.enabled,
        expected_revision: i64::try_from(request.expected_revision)
            .map_err(|_| ("expected_revision", "expected_revision 无效"))?,
    })
}

fn map_alert_rule(record: OperationsAlertRuleRecord) -> Result<OperationsAlertRule, ()> {
    Ok(OperationsAlertRule {
        id: record.id,
        key: record.key,
        name: record.name,
        kind: parse_rule_kind(&record.kind).ok_or(())?,
        threshold: nonnegative(record.threshold)?,
        window_seconds: u32::try_from(record.window_seconds).map_err(|_| ())?,
        enabled: record.enabled,
        revision: nonnegative(record.revision)?,
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
    })
}

fn map_alert(record: OperationsAlertRecord) -> Result<OperationsAlert, ()> {
    let acknowledged_by = match (
        record.acknowledged_by_id,
        record.acknowledged_by_username,
        record.acknowledged_by_display_name,
    ) {
        (Some(id), Some(username), Some(display_name)) => Some(UserSummary {
            id,
            username,
            display_name,
            avatar_url: record.acknowledged_by_avatar_url,
        }),
        (None, None, None) => None,
        _ => return Err(()),
    };
    Ok(OperationsAlert {
        id: record.id,
        rule: OperationsAlertRuleReference {
            id: record.rule_id,
            key: record.rule_key,
            name: record.rule_name,
            kind: parse_rule_kind(&record.rule_kind).ok_or(())?,
        },
        status: parse_alert_status(&record.status).ok_or(())?,
        observed_value: nonnegative(record.observed_value)?,
        threshold: nonnegative(record.threshold)?,
        first_triggered_at: format_time(record.first_triggered_at),
        last_triggered_at: format_time(record.last_triggered_at),
        acknowledged_by,
        acknowledged_at: record.acknowledged_at.map(format_time),
        resolved_at: record.resolved_at.map(format_time),
    })
}

fn parse_rule_kind(value: &str) -> Option<OperationsAlertRuleKind> {
    Some(match value {
        "http_5xx_count" => OperationsAlertRuleKind::Http5xxCount,
        "http_p95_ms" => OperationsAlertRuleKind::HttpP95Ms,
        "outbox_dead_count" => OperationsAlertRuleKind::OutboxDeadCount,
        "risk_alert_open_count" => OperationsAlertRuleKind::RiskAlertOpenCount,
        _ => return None,
    })
}

fn parse_alert_status(value: &str) -> Option<OperationsAlertStatus> {
    Some(match value {
        "open" => OperationsAlertStatus::Open,
        "acknowledged" => OperationsAlertStatus::Acknowledged,
        "resolved" => OperationsAlertStatus::Resolved,
        _ => return None,
    })
}

fn alert_status_value(status: OperationsAlertStatus) -> &'static str {
    match status {
        OperationsAlertStatus::Open => "open",
        OperationsAlertStatus::Acknowledged => "acknowledged",
        OperationsAlertStatus::Resolved => "resolved",
    }
}

fn mutation_error(
    request_id: RequestId,
    error: MutateOperationsAlertError,
    is_rule: bool,
) -> ApiError {
    match error {
        MutateOperationsAlertError::Forbidden => error_response(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号没有管理运营告警的权限",
            request_id,
        ),
        MutateOperationsAlertError::NotFound => error_response(
            StatusCode::NOT_FOUND,
            if is_rule {
                error_codes::OPERATIONS_RULE_NOT_FOUND
            } else {
                error_codes::OPERATIONS_ALERT_NOT_FOUND
            },
            if is_rule {
                "运营告警规则不存在"
            } else {
                "运营告警不存在"
            },
            request_id,
        ),
        MutateOperationsAlertError::Conflict => error_response(
            StatusCode::CONFLICT,
            if is_rule {
                error_codes::OPERATIONS_RULE_CONFLICT
            } else {
                error_codes::OPERATIONS_ALERT_CONFLICT
            },
            if is_rule {
                "运营告警规则版本已变化"
            } else {
                "运营告警状态已变化"
            },
            request_id,
        ),
        MutateOperationsAlertError::InvalidInput => {
            validation_error(request_id, "request", "运营告警请求无效")
        }
        MutateOperationsAlertError::Database(error) => {
            database_error(request_id, error, "Operations alert mutation failed")
        }
    }
}

fn validation_error(request_id: RequestId, field: &'static str, message: &'static str) -> ApiError {
    let mut fields = FieldErrors::new();
    fields.insert(field.to_owned(), vec![message.to_owned()]);
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

fn database_error(
    request_id: RequestId,
    error: infrastructure::DatabaseError,
    context: &'static str,
) -> ApiError {
    tracing::warn!(request_id = %request_id, error = %error, "{context}");
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::DATABASE_UNAVAILABLE,
        "运营监控暂时不可用",
        request_id,
    )
}

fn invalid_record(request_id: RequestId) -> ApiError {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::DATABASE_UNAVAILABLE,
        "运营监控暂时不可用",
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

fn nonnegative(value: i64) -> Result<u64, ()> {
    u64::try_from(value).map_err(|_| ())
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .expect("operations timestamp must format")
}
