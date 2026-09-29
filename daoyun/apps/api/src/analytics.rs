use crate::auth::{ApiError, AuthRuntime, authenticate_session};
use api_contract::{
    ApiResponse, CommunityAnalytics, CommunityAnalyticsBoard, CommunityAnalyticsDay, ErrorBody,
    ErrorCode, ErrorResponse, RequestId,
};
use axum::{
    Extension, Json, Router,
    extract::{Query, State, rejection::QueryRejection},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, VARY},
    },
    routing::get,
};
use infrastructure::{AnalyticsError, Database};
use serde::Deserialize;
use time::format_description::well_known::Rfc3339;

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/admin/community-analytics", get(report))
        .layer(Extension(runtime))
}
#[derive(Deserialize)]
pub(crate) struct ReportQuery {
    days: Option<i32>,
}
#[utoipa::path(get,path="/api/v1/admin/community-analytics",operation_id="getCommunityAnalytics",tag="admin",
 params(("days"=Option<i32>,Query,description="UTC natural days: 7, 30 or 90")),
 responses((status=200,body=ApiResponse<CommunityAnalytics>,headers(("x-request-id"=String))),
 (status=401,body=ErrorResponse,headers(("x-request-id"=String))),
 (status=403,body=ErrorResponse,headers(("x-request-id"=String))),
 (status=409,body=ErrorResponse,headers(("x-request-id"=String))),
 (status=422,body=ErrorResponse,headers(("x-request-id"=String))),
 (status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn report(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ReportQuery>, QueryRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<CommunityAnalytics>>), ApiError> {
    let (session, _) = authenticate_session(&db, &runtime, &headers, id).await?;
    let Query(query) = query.map_err(|_| error(AnalyticsError::InvalidWindow, id))?;
    let r = db
        .community_analytics(session.user.id, query.days.unwrap_or(30))
        .await
        .map_err(|e| error(e, id))?;
    let pending_gap = runtime.analytics.pending_gap();
    let data = CommunityAnalytics {
        started_at: r.started_at.format(&Rfc3339).map_err(|_| unavailable(id))?,
        from: r.from.to_string(),
        through: r.through.to_string(),
        activity_complete: r.activity_complete && !pending_gap,
        content_complete: r.content_complete,
        new_users: r.new_users,
        active_users: r.active_users,
        topics: r.topics,
        replies: r.replies,
        points_issued: r.points_issued,
        points_spent: r.points_spent,
        retention_eligible: if pending_gap { 0 } else { r.retention_eligible },
        retention_returned: if pending_gap { 0 } else { r.retention_returned },
        days: r
            .days
            .into_iter()
            .map(|d| CommunityAnalyticsDay {
                day: d.day.to_string(),
                activity_complete: d.activity_complete && !pending_gap,
                content_complete: d.content_complete,
                new_users: d.new_users,
                active_users: d.active_users,
                topics: d.topics,
                replies: d.replies,
                points_issued: d.points_issued,
                points_spent: d.points_spent,
            })
            .collect(),
        boards: r
            .boards
            .into_iter()
            .map(|b| CommunityAnalyticsBoard {
                board_id: b.board_id,
                name: b.name,
                topics: b.topics,
                replies: b.replies,
                participants: b.participants,
            })
            .collect(),
    };
    Ok((private_headers(), Json(ApiResponse::new(data, id))))
}
fn private_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    h.insert(VARY, HeaderValue::from_static("Cookie"));
    h
}
fn error(e: AnalyticsError, id: RequestId) -> ApiError {
    let (status, code, message) = match e {
        AnalyticsError::Forbidden => (
            StatusCode::FORBIDDEN,
            "analytics.forbidden",
            "没有运营数据读取权限",
        ),
        AnalyticsError::Disabled => (
            StatusCode::CONFLICT,
            "analytics.disabled",
            "请先在插件管理安装并启用运营报表",
        ),
        AnalyticsError::InvalidWindow => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "request.validation_failed",
            "统计范围只支持 7、30、90 天",
        ),
        AnalyticsError::Database(_) => return unavailable(id),
    };
    (
        status,
        private_headers(),
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            id,
        )),
    )
}
fn unavailable(id: RequestId) -> ApiError {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        private_headers(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static("system.internal_error"),
                "运营数据暂时无法读取",
            ),
            id,
        )),
    )
}
