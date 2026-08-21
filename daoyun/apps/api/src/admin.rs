use std::collections::BTreeSet;

use api_contract::{
    AdminAuditEntry, AdminBoard, AdminBoardDeletionImpact, AdminBoardVisibility,
    AdminCapabilityAccess, AdminCommunityGroup, AdminCommunityGroupMembership, AdminGrowthLevel,
    AdminStandardEntitlement, AdminUserContentItem, AdminUserContentKind, AdminUserDetail,
    AdminUserStatus, AdminUserStatusUpdate, AdminUserSummary, ApiResponse, AttachmentCleanupResult,
    AuthorizationAssignedRole, AuthorizationPermission, AuthorizationRole,
    AuthorizationRoleAssignment, AuthorizationRoleScope, AuthorizationScopeMode, BoardTone,
    BrandHomeMode, BrandLink, BrandListDensity, BrandThemePreset, CommunityGroupMembershipMutation,
    CommunityGroupStatus, ContentAccessOperator, ContentAccessPolicy, ContentAccessSubject,
    ContentAccessSubjectType, ContentAccessTargetType, CreateAdminBoardRequest,
    CreateAuthorizationAssignmentRequest, CreateAuthorizationRoleRequest,
    CreateCommunityGroupRequest, CreateGrowthLevelRequest, ErrorBody, ErrorCode, ErrorResponse,
    FieldErrors, GovernancePolicy, GrantCommunityGroupMembershipRequest,
    GrantMembershipMedalRequest, GrantMembershipPointsRequest, GrantStandardEntitlementRequest,
    GrowthLevelStatus, MembershipAccount, MembershipLevelRule, MembershipMedal,
    MembershipMedalGrant, MembershipMedalRule, MembershipPointsGrant, PageResponse,
    PutContentAccessPolicyRequest, PutStandardEntitlementTypeRequest, RequestId,
    RevokeCommunityGroupMembershipRequest, RevokeStandardEntitlementRequest, RiskAlert,
    RiskAlertKind, RiskAlertSeverity, RiskAlertStatus, SiteBranding, StandardEntitlementMutation,
    StandardEntitlementType, UpdateAdminBoardRequest, UpdateAdminUserStatusRequest,
    UpdateAuthorizationRoleRequest, UpdateCommunityGroupRequest, UpdateGovernancePolicyRequest,
    UpdateGrowthLevelRequest, UpdateMembershipLevelRuleRequest, UpdateMembershipMedalRuleRequest,
    UpdateRiskAlertRequest, UpdateSiteBrandingRequest, UserSummary, error_codes,
};
use axum::{
    Extension, Json, Router,
    body::{Body, Bytes},
    extract::{
        DefaultBodyLimit, Path, Query, State, rejection::JsonRejection, rejection::QueryRejection,
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
    routing::{get, patch, post, put},
};
use infrastructure::{
    AdminAuditRecord, AdminBoardDeletionImpactRecord, AdminBoardRecord, AdminConfigError,
    AdminGrowthLevelRecord, AdminUserContentRecord, AdminUserDetailRecord, AdminUserReadError,
    AdminUserStatusUpdateRecord, AdminUserSummaryRecord, AppendPointsLedgerError,
    AttachmentCleanupError, AuthorizationPermissionRecord, AuthorizationRoleAssignmentRecord,
    AuthorizationRoleRecord, BrandAssetError, BrandLinkRecord, CommunityGroupConfigurationRecord,
    CommunityGroupMembershipRecord, CommunityGroupMutationError, CommunityMembershipMutationError,
    ContentAccessPolicyMutationError, ContentAccessPolicyRecord, ContentAccessPolicySubjectRecord,
    CreateAdminBoardRecord, CreateAuthorizationAssignmentRecord, CreateAuthorizationRoleRecord,
    CreateCommunityGroupRecord, CreateGrowthLevelRecord, Database, GovernancePolicyRecord,
    GrantCommunityMembershipRecord, GrantMembershipMedalError, GrantStandardEntitlementRecord,
    ListAdminAuditError, ListAdminAuditFilter, ListAuthorizationAssignmentsError,
    ListRiskAlertsError, MembershipAccountRecord, MembershipLevelRuleRecord, MembershipMedalRecord,
    MembershipMedalRuleRecord, MutateAuthorizationAssignmentError, MutateAuthorizationRoleError,
    MutateGrowthLevelError, PutContentAccessPolicyRecord, PutStandardEntitlementTypeRecord,
    RevokeStandardEntitlementRecord, RiskAlertRecord, SiteBrandingRecord,
    StandardEntitlementMutationError, StandardEntitlementRecord, StandardEntitlementTypeRecord,
    UpdateAdminBoardRecord, UpdateAdminUserStatusError, UpdateAdminUserStatusRecord,
    UpdateAuthorizationRoleRecord, UpdateCommunityGroupRecord, UpdateGrowthLevelRecord,
    UpdateMembershipLevelRuleError, UpdateMembershipLevelRuleRecord,
    UpdateMembershipMedalRuleError, UpdateMembershipMedalRuleRecord, UpdateRiskAlertError,
    UpdateSiteBrandingRecord, permission_keys,
};
use serde::Deserialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::IntoParams;
use uuid::Uuid;

use crate::CacheRuntime;
use crate::auth::{ApiError, AuthRuntime, authenticate_session, authenticate_state_change};

const ADMIN_BODY_LIMIT: usize = 32 * 1024;
const MAX_BRAND_ASSET_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_AUDIT_LIMIT: u16 = 20;
const MAX_AUDIT_LIMIT: u16 = 50;
const DEFAULT_ALERT_LIMIT: u16 = 20;
const MAX_ALERT_LIMIT: u16 = 50;
const DEFAULT_ASSIGNMENT_LIMIT: u16 = 20;
const MAX_ASSIGNMENT_LIMIT: u16 = 50;
const DEFAULT_USER_LIMIT: u16 = 20;
const MAX_USER_LIMIT: u16 = 50;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListAdminUsersQuery {
    q: Option<String>,
    status: Option<AdminUserStatus>,
    role_id: Option<Uuid>,
    registered_after: Option<String>,
    registered_before: Option<String>,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListAdminUserItemsQuery {
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

struct ValidatedAdminUserStatusRequest {
    status: AdminUserStatus,
    reason: String,
    expires_at: Option<OffsetDateTime>,
    expected_revision: i64,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListAuditQuery {
    actor_id: Option<Uuid>,
    action: Option<String>,
    resource_type: Option<String>,
    resource_id: Option<Uuid>,
    user_id: Option<Uuid>,
    report_id: Option<Uuid>,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListRiskAlertsQuery {
    status: Option<RiskAlertStatus>,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct AttachmentCleanupQuery {
    limit: Option<u16>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListAuthorizationAssignmentsQuery {
    username: Option<String>,
    role_id: Option<Uuid>,
    scope_id: Option<Uuid>,
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    let asset_routes = Router::new()
        .route(
            "/api/v1/site-branding/assets/{kind}",
            get(get_public_brand_asset),
        )
        .route(
            "/api/v1/admin/site-branding/assets/{kind}",
            put(upload_brand_asset).delete(delete_brand_asset),
        )
        .layer(DefaultBodyLimit::max(MAX_BRAND_ASSET_BYTES + 1));

    Router::new()
        .route("/api/v1/site-branding", get(get_public_branding))
        .route("/api/v1/admin/access", get(get_admin_access))
        .route("/api/v1/admin/users", get(list_admin_users))
        .route("/api/v1/admin/users/{user_id}", get(get_admin_user))
        .route(
            "/api/v1/admin/users/{user_id}/status",
            patch(update_admin_user_status),
        )
        .route(
            "/api/v1/admin/users/{user_id}/content",
            get(list_admin_user_content),
        )
        .route(
            "/api/v1/admin/users/{user_id}/reports",
            get(list_admin_user_reports),
        )
        .route(
            "/api/v1/admin/site-branding",
            get(get_admin_branding).patch(update_branding),
        )
        .route(
            "/api/v1/admin/boards",
            get(list_admin_boards).post(create_board),
        )
        .route(
            "/api/v1/admin/boards/{board_id}",
            patch(update_board).delete(delete_board),
        )
        .route(
            "/api/v1/admin/boards/{board_id}/deletion-impact",
            get(get_board_deletion_impact),
        )
        .route("/api/v1/admin/audit", get(list_audit))
        .route("/api/v1/admin/audit/alerts", get(list_audit_alerts))
        .route(
            "/api/v1/admin/authorization/permissions",
            get(list_authorization_permissions),
        )
        .route(
            "/api/v1/admin/authorization/roles",
            get(list_authorization_roles).post(create_authorization_role),
        )
        .route(
            "/api/v1/admin/authorization/roles/{role_id}",
            patch(update_authorization_role).delete(delete_authorization_role),
        )
        .route(
            "/api/v1/admin/authorization/assignments",
            get(list_authorization_assignments).post(create_authorization_assignment),
        )
        .route(
            "/api/v1/admin/authorization/assignments/{assignment_id}",
            axum::routing::delete(delete_authorization_assignment),
        )
        .route(
            "/api/v1/admin/membership/level-rules",
            get(list_membership_level_rules),
        )
        .route(
            "/api/v1/admin/membership/level-rules/{level_key}",
            patch(update_membership_level_rule),
        )
        .route(
            "/api/v1/admin/membership/levels",
            get(list_growth_levels).post(create_growth_level),
        )
        .route(
            "/api/v1/admin/membership/levels/{level_id}",
            patch(update_growth_level),
        )
        .route(
            "/api/v1/admin/community/groups",
            get(list_community_groups).post(create_community_group),
        )
        .route(
            "/api/v1/admin/community/groups/{group_id}",
            patch(update_community_group),
        )
        .route(
            "/api/v1/admin/community/memberships",
            post(grant_community_membership),
        )
        .route(
            "/api/v1/admin/community/memberships/{membership_id}/revoke",
            post(revoke_community_membership),
        )
        .route(
            "/api/v1/admin/entitlements/types/{internal_key}",
            put(put_standard_entitlement_type),
        )
        .route(
            "/api/v1/admin/entitlements",
            post(grant_standard_entitlement),
        )
        .route(
            "/api/v1/admin/entitlements/{entitlement_id}/revoke",
            post(revoke_standard_entitlement),
        )
        .route(
            "/api/v1/admin/content-access-policies/{target_type}/{target_id}",
            get(get_content_access_policy).put(put_content_access_policy),
        )
        .route(
            "/api/v1/admin/membership/points",
            post(grant_membership_points),
        )
        .route(
            "/api/v1/admin/membership/medal-rules",
            get(list_membership_medal_rules),
        )
        .route(
            "/api/v1/admin/membership/medal-rules/{medal_key}",
            patch(update_membership_medal_rule),
        )
        .route(
            "/api/v1/admin/membership/medals",
            post(grant_membership_medal),
        )
        .route(
            "/api/v1/admin/governance/policy",
            get(get_governance_policy).patch(update_governance_policy),
        )
        .route("/api/v1/admin/risk-alerts", get(list_risk_alerts))
        .route(
            "/api/v1/admin/risk-alerts/{alert_id}",
            patch(update_risk_alert),
        )
        .route(
            "/api/v1/admin/attachments/cleanup",
            post(cleanup_attachments),
        )
        .merge(asset_routes)
        .layer(DefaultBodyLimit::max(ADMIN_BODY_LIMIT))
        .layer(Extension(runtime))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/access",
    operation_id = "getAdminAccess",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<AdminCapabilityAccess>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn get_admin_access(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<AdminCapabilityAccess>>, ApiError> {
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let capability_keys = database
        .list_global_permission_keys(session.user.id)
        .await
        .map_err(|error| database_error(request_id, error, "管理能力查询失败"))?;
    Ok(Json(ApiResponse::new(
        AdminCapabilityAccess { capability_keys },
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/users",
    operation_id = "listAdminUsers",
    tag = "admin",
    params(ListAdminUsersQuery),
    responses(
        (status = 200, body = PageResponse<AdminUserSummary>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_admin_users(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListAdminUsersQuery>, QueryRejection>,
) -> Result<Json<PageResponse<AdminUserSummary>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ADMIN_USERS_READ,
    )
    .await?;
    let query = validate_admin_users_query(query)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let limit = query.limit.expect("validated user limit");
    let status = query.status.map(admin_user_status_value);
    let mut records = database
        .list_admin_users(
            query.q.as_deref(),
            status,
            query.role_id,
            query
                .registered_after
                .as_deref()
                .map(parse_admin_time)
                .transpose()
                .map_err(|_| {
                    validation_error(
                        request_id,
                        "registered_after",
                        "registered_after 必须是 RFC 3339 时间",
                    )
                })?,
            query
                .registered_before
                .as_deref()
                .map(parse_admin_time)
                .transpose()
                .map_err(|_| {
                    validation_error(
                        request_id,
                        "registered_before",
                        "registered_before 必须是 RFC 3339 时间",
                    )
                })?,
            query.cursor,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|error| admin_user_read_error(request_id, error))?;
    let next_cursor = if records.len() > usize::from(limit) {
        records.truncate(usize::from(limit));
        records.last().map(|record| record.id.to_string())
    } else {
        None
    };
    let users = records
        .into_iter()
        .map(map_admin_user_summary)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(PageResponse::new(users, request_id, next_cursor)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/users/{user_id}",
    operation_id = "getAdminUser",
    tag = "admin",
    params(("user_id" = Uuid, Path)),
    responses(
        (status = 200, body = ApiResponse<AdminUserDetail>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn get_admin_user(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ApiResponse<AdminUserDetail>>, ApiError> {
    let Path(user_id) = path.map_err(|_| path_invalid(request_id))?;
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ADMIN_USERS_READ,
    )
    .await?;
    let record = database
        .admin_user_detail(user_id)
        .await
        .map_err(|error| database_error(request_id, error, "用户详情查询失败"))?
        .ok_or_else(|| admin_user_not_found(request_id))?;
    let user = map_admin_user_detail(record).map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(user, request_id)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/users/{user_id}/status",
    operation_id = "updateAdminUserStatus",
    tag = "admin",
    params(
        ("user_id" = Uuid, Path),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    request_body = UpdateAdminUserStatusRequest,
    responses(
        (status = 200, body = ApiResponse<AdminUserStatusUpdate>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update_admin_user_status(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    request: Result<Json<UpdateAdminUserStatusRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<AdminUserStatusUpdate>>, ApiError> {
    let Path(user_id) = path.map_err(|_| path_invalid(request_id))?;
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ADMIN_USERS_MODERATE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input = validate_admin_user_status_request(request)
        .map_err(|fields| validation_fields(request_id, fields))?;
    let record = database
        .update_admin_user_status(UpdateAdminUserStatusRecord {
            actor_id: session.user.id,
            target_user_id: user_id,
            status: admin_user_status_value(input.status).to_owned(),
            reason: input.reason,
            expires_at: input.expires_at,
            expected_revision: input.expected_revision,
        })
        .await
        .map_err(|error| admin_user_status_update_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_admin_user_status_update(record).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/users/{user_id}/content",
    operation_id = "listAdminUserContent",
    tag = "admin",
    params(("user_id" = Uuid, Path), ListAdminUserItemsQuery),
    responses(
        (status = 200, body = PageResponse<AdminUserContentItem>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_admin_user_content(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    query: Result<Query<ListAdminUserItemsQuery>, QueryRejection>,
) -> Result<Json<PageResponse<AdminUserContentItem>>, ApiError> {
    let Path(user_id) = path.map_err(|_| path_invalid(request_id))?;
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ADMIN_USERS_READ,
    )
    .await?;
    ensure_admin_user_exists(&database, user_id, request_id).await?;
    let query = validate_admin_user_items_query(query)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let limit = query.limit.expect("validated user content limit");
    let mut records = database
        .list_admin_user_content(user_id, query.cursor, i64::from(limit) + 1)
        .await
        .map_err(|error| admin_user_read_error(request_id, error))?;
    let next_cursor = page_next_cursor(&mut records, limit, |record| record.id);
    Ok(Json(PageResponse::new(
        records.into_iter().map(map_admin_user_content).collect(),
        request_id,
        next_cursor,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/users/{user_id}/reports",
    operation_id = "listAdminUserReports",
    tag = "admin",
    params(("user_id" = Uuid, Path), ListAdminUserItemsQuery),
    responses(
        (status = 200, body = PageResponse<api_contract::ContentReport>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_admin_user_reports(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    query: Result<Query<ListAdminUserItemsQuery>, QueryRejection>,
) -> Result<Json<PageResponse<api_contract::ContentReport>>, ApiError> {
    let Path(user_id) = path.map_err(|_| path_invalid(request_id))?;
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ADMIN_USERS_READ,
    )
    .await?;
    ensure_admin_user_exists(&database, user_id, request_id).await?;
    let query = validate_admin_user_items_query(query)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let limit = query.limit.expect("validated user report limit");
    let mut records = database
        .list_admin_user_reports(user_id, query.cursor, i64::from(limit) + 1)
        .await
        .map_err(|error| admin_user_read_error(request_id, error))?;
    let next_cursor = page_next_cursor(&mut records, limit, |record| record.id);
    let reports = records
        .into_iter()
        .map(crate::governance::map_report)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(PageResponse::new(reports, request_id, next_cursor)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/authorization/permissions",
    operation_id = "listAuthorizationPermissions",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<Vec<AuthorizationPermission>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_authorization_permissions(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<AuthorizationPermission>>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUTHORIZATION_ROLES_READ,
    )
    .await?;
    let permissions = database
        .list_authorization_permissions()
        .await
        .map_err(|error| database_error(request_id, error, "权限目录查询失败"))?
        .into_iter()
        .map(map_authorization_permission)
        .collect();
    Ok(Json(ApiResponse::new(permissions, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/authorization/roles",
    operation_id = "listAuthorizationRoles",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<Vec<AuthorizationRole>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_authorization_roles(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<AuthorizationRole>>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUTHORIZATION_ROLES_READ,
    )
    .await?;
    let roles = database
        .list_authorization_roles()
        .await
        .map_err(|error| database_error(request_id, error, "角色目录查询失败"))?
        .into_iter()
        .map(map_authorization_role)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(roles, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/authorization/assignments",
    operation_id = "listAuthorizationAssignments",
    tag = "admin",
    params(ListAuthorizationAssignmentsQuery),
    responses(
        (status = 200, body = PageResponse<AuthorizationRoleAssignment>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_authorization_assignments(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListAuthorizationAssignmentsQuery>, QueryRejection>,
) -> Result<Json<PageResponse<AuthorizationRoleAssignment>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUTHORIZATION_ASSIGNMENTS_READ,
    )
    .await?;
    let query = validate_authorization_assignments_query(query)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let limit = query.limit.expect("validated assignment limit");
    let mut records = database
        .list_authorization_role_assignments(
            query.username.as_deref(),
            query.role_id,
            query.scope_id,
            query.cursor,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|error| match error {
            ListAuthorizationAssignmentsError::InvalidCursor => {
                validation_error(request_id, "cursor", "cursor 不属于当前角色授权列表")
            }
            ListAuthorizationAssignmentsError::Database(error) => {
                database_error(request_id, error, "角色授权查询失败")
            }
        })?;
    let next_cursor = if records.len() > usize::from(limit) {
        records.truncate(usize::from(limit));
        records.last().map(|record| record.id.to_string())
    } else {
        None
    };
    let assignments = records
        .into_iter()
        .map(map_authorization_assignment)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(PageResponse::new(
        assignments,
        request_id,
        next_cursor,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/authorization/roles",
    operation_id = "createAuthorizationRole",
    tag = "admin",
    request_body = CreateAuthorizationRoleRequest,
    responses(
        (status = 201, body = ApiResponse<AuthorizationRole>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn create_authorization_role(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<CreateAuthorizationRoleRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<AuthorizationRole>>), ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUTHORIZATION_ROLES_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input = validate_create_authorization_role(request)
        .map_err(|fields| validation_fields(request_id, fields))?;
    let role = database
        .create_authorization_role(
            session.user.id,
            CreateAuthorizationRoleRecord {
                id: Uuid::now_v7(),
                key: input.key,
                name: input.name,
                scope: input.scope,
                permission_keys: input.permission_keys,
            },
        )
        .await
        .map_err(|error| authorization_role_error(request_id, error))?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::new(
            map_authorization_role(role).map_err(|()| invalid_record(request_id))?,
            request_id,
        )),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/authorization/roles/{role_id}",
    operation_id = "updateAuthorizationRole",
    tag = "admin",
    params(("role_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdateAuthorizationRoleRequest,
    responses(
        (status = 200, body = ApiResponse<AuthorizationRole>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update_authorization_role(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(role_id): Path<Uuid>,
    request: Result<Json<UpdateAuthorizationRoleRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<AuthorizationRole>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUTHORIZATION_ROLES_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input = validate_update_authorization_role(request)
        .map_err(|fields| validation_fields(request_id, fields))?;
    let role = database
        .update_authorization_role(
            session.user.id,
            UpdateAuthorizationRoleRecord {
                role_id,
                name: input.name,
                permission_keys: input.permission_keys,
                expected_revision: input.expected_revision,
            },
        )
        .await
        .map_err(|error| authorization_role_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_authorization_role(role).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/authorization/roles/{role_id}",
    operation_id = "deleteAuthorizationRole",
    tag = "admin",
    params(("role_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    responses(
        (status = 200, body = ApiResponse<bool>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn delete_authorization_role(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(role_id): Path<Uuid>,
) -> Result<Json<ApiResponse<bool>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUTHORIZATION_ROLES_WRITE,
    )
    .await?;
    database
        .delete_authorization_role(session.user.id, role_id)
        .await
        .map_err(|error| authorization_role_error(request_id, error))?;
    Ok(Json(ApiResponse::new(true, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/authorization/assignments",
    operation_id = "createAuthorizationAssignment",
    tag = "admin",
    request_body = CreateAuthorizationAssignmentRequest,
    params(("x-csrf-token" = String, Header)),
    responses(
        (status = 201, body = ApiResponse<AuthorizationRoleAssignment>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn create_authorization_assignment(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<CreateAuthorizationAssignmentRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<AuthorizationRoleAssignment>>), ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUTHORIZATION_ASSIGNMENTS_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let username = request.username.trim().to_owned();
    if !valid_assignment_username(&username) {
        return Err(validation_error(request_id, "username", "用户名格式不正确"));
    }
    let assignment = database
        .create_authorization_assignment(
            session.user.id,
            CreateAuthorizationAssignmentRecord {
                id: Uuid::now_v7(),
                username,
                role_id: request.role_id,
                scope_id: request.scope_id,
                scope_mode: authorization_scope_mode_key(request.scope_mode).to_owned(),
            },
        )
        .await
        .map_err(|error| authorization_assignment_error(request_id, error))?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::new(
            map_authorization_assignment(assignment).map_err(|()| invalid_record(request_id))?,
            request_id,
        )),
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/authorization/assignments/{assignment_id}",
    operation_id = "deleteAuthorizationAssignment",
    tag = "admin",
    params(("assignment_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    responses(
        (status = 200, body = ApiResponse<bool>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn delete_authorization_assignment(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(assignment_id): Path<Uuid>,
) -> Result<Json<ApiResponse<bool>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUTHORIZATION_ASSIGNMENTS_WRITE,
    )
    .await?;
    database
        .delete_authorization_assignment(session.user.id, assignment_id)
        .await
        .map_err(|error| authorization_assignment_error(request_id, error))?;
    Ok(Json(ApiResponse::new(true, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/community/groups",
    operation_id = "listCommunityGroups",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<Vec<AdminCommunityGroup>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn list_community_groups(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<AdminCommunityGroup>>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::COMMUNITY_GROUPS_READ,
    )
    .await?;
    let groups = database
        .list_community_group_configurations()
        .await
        .map_err(|error| {
            database_error(
                request_id,
                infrastructure::DatabaseError::from(error),
                "社区用户组查询失败",
            )
        })?
        .into_iter()
        .map(map_admin_community_group)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(groups, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/community/groups",
    operation_id = "createCommunityGroup",
    tag = "admin",
    params(("x-csrf-token" = String, Header)),
    request_body = CreateCommunityGroupRequest,
    responses(
        (status = 201, body = ApiResponse<AdminCommunityGroup>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 409, body = ErrorResponse), (status = 422, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn create_community_group(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<CreateCommunityGroupRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<AdminCommunityGroup>>), ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::COMMUNITY_GROUPS_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let record = database
        .create_community_group(
            session.user.id,
            CreateCommunityGroupRecord {
                internal_key: request.internal_key,
                display_name: request.display_name,
                description: request.description,
                is_base: request.is_base,
                display_order: request.display_order,
                permission_keys: request.permission_keys.into_iter().collect(),
                quotas: request.quotas,
            },
        )
        .await
        .map_err(|error| community_group_error(request_id, error))?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::new(
            map_admin_community_group(record).map_err(|()| invalid_record(request_id))?,
            request_id,
        )),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/community/groups/{group_id}",
    operation_id = "updateCommunityGroup",
    tag = "admin",
    params(("group_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdateCommunityGroupRequest,
    responses(
        (status = 200, body = ApiResponse<AdminCommunityGroup>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn update_community_group(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(group_id): Path<Uuid>,
    request: Result<Json<UpdateCommunityGroupRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<AdminCommunityGroup>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::COMMUNITY_GROUPS_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let record = database
        .update_community_group(
            session.user.id,
            UpdateCommunityGroupRecord {
                id: group_id,
                expected_revision: request.expected_revision,
                display_name: request.display_name,
                description: request.description,
                status: community_group_status_key(request.status).to_owned(),
                display_order: request.display_order,
                permission_keys: request.permission_keys.into_iter().collect(),
                quotas: request.quotas,
            },
        )
        .await
        .map_err(|error| community_group_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_admin_community_group(record).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/community/memberships",
    operation_id = "grantCommunityGroupMembership",
    tag = "admin",
    params(("x-csrf-token" = String, Header)),
    request_body = GrantCommunityGroupMembershipRequest,
    responses(
        (status = 200, body = ApiResponse<CommunityGroupMembershipMutation>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn grant_community_membership(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<GrantCommunityGroupMembershipRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<CommunityGroupMembershipMutation>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::COMMUNITY_MEMBERSHIPS_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let starts_at = parse_admin_timestamp(&request.starts_at)
        .map_err(|()| validation_error(request_id, "starts_at", "开始时间必须是 RFC 3339"))?;
    let ends_at = request
        .ends_at
        .as_deref()
        .map(parse_admin_timestamp)
        .transpose()
        .map_err(|()| validation_error(request_id, "ends_at", "结束时间必须是 RFC 3339"))?;
    let result = database
        .grant_community_membership(
            session.user.id,
            GrantCommunityMembershipRecord {
                user_id: request.user_id,
                group_id: request.group_id,
                membership_kind: request.membership_kind,
                source: request.source,
                source_reference_id: request.source_reference_id,
                reason: request.reason,
                starts_at,
                ends_at,
                idempotency_key: request.idempotency_key,
            },
        )
        .await
        .map_err(|error| community_membership_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        CommunityGroupMembershipMutation {
            membership: map_admin_community_membership(result.membership)
                .map_err(|()| invalid_record(request_id))?,
            replayed: result.replayed,
        },
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/community/memberships/{membership_id}/revoke",
    operation_id = "revokeCommunityGroupMembership",
    tag = "admin",
    params(("membership_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = RevokeCommunityGroupMembershipRequest,
    responses(
        (status = 200, body = ApiResponse<CommunityGroupMembershipMutation>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn revoke_community_membership(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(membership_id): Path<Uuid>,
    request: Result<Json<RevokeCommunityGroupMembershipRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<CommunityGroupMembershipMutation>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::COMMUNITY_MEMBERSHIPS_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let result = database
        .revoke_community_membership(
            session.user.id,
            membership_id,
            request.expected_revision,
            &request.reason,
            &request.idempotency_key,
        )
        .await
        .map_err(|error| community_membership_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        CommunityGroupMembershipMutation {
            membership: map_admin_community_membership(result.membership)
                .map_err(|()| invalid_record(request_id))?,
            replayed: result.replayed,
        },
        request_id,
    )))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/entitlements/types/{internal_key}",
    operation_id = "putStandardEntitlementType",
    tag = "admin",
    params(("internal_key" = String, Path), ("x-csrf-token" = String, Header)),
    request_body = PutStandardEntitlementTypeRequest,
    responses(
        (status = 200, body = ApiResponse<StandardEntitlementType>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn put_standard_entitlement_type(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(internal_key): Path<String>,
    request: Result<Json<PutStandardEntitlementTypeRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<StandardEntitlementType>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ENTITLEMENT_TYPES_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let record = database
        .put_standard_entitlement_type(
            session.user.id,
            PutStandardEntitlementTypeRecord {
                internal_key,
                display_name: request.display_name,
                permission_keys: request.permission_keys,
                quotas: request.quotas,
                expected_revision: request.expected_revision,
            },
        )
        .await
        .map_err(|error| standard_entitlement_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_standard_entitlement_type(record),
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/entitlements",
    operation_id = "grantStandardEntitlement",
    tag = "admin",
    params(("x-csrf-token" = String, Header)),
    request_body = GrantStandardEntitlementRequest,
    responses(
        (status = 200, body = ApiResponse<StandardEntitlementMutation>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn grant_standard_entitlement(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<GrantStandardEntitlementRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<StandardEntitlementMutation>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ENTITLEMENT_GRANTS_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let starts_at = parse_admin_timestamp(&request.starts_at)
        .map_err(|()| validation_error(request_id, "starts_at", "开始时间必须是 RFC 3339"))?;
    let ends_at = request
        .ends_at
        .as_deref()
        .map(parse_admin_timestamp)
        .transpose()
        .map_err(|()| validation_error(request_id, "ends_at", "结束时间必须是 RFC 3339"))?;
    let result = database
        .grant_standard_entitlement(GrantStandardEntitlementRecord {
            user_id: request.user_id,
            entitlement_type_id: request.entitlement_type_id,
            actor_id: session.user.id,
            source: request.source,
            source_reference_id: request.source_reference_id,
            reason: request.reason,
            starts_at,
            ends_at,
            idempotency_key: request.idempotency_key,
        })
        .await
        .map_err(|error| standard_entitlement_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        StandardEntitlementMutation {
            entitlement: map_standard_entitlement(result.entitlement),
            replayed: result.replayed,
        },
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/entitlements/{entitlement_id}/revoke",
    operation_id = "revokeStandardEntitlement",
    tag = "admin",
    params(("entitlement_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = RevokeStandardEntitlementRequest,
    responses(
        (status = 200, body = ApiResponse<StandardEntitlementMutation>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn revoke_standard_entitlement(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(entitlement_id): Path<Uuid>,
    request: Result<Json<RevokeStandardEntitlementRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<StandardEntitlementMutation>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ENTITLEMENT_GRANTS_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let result = database
        .revoke_standard_entitlement(RevokeStandardEntitlementRecord {
            entitlement_id,
            actor_id: session.user.id,
            expected_revision: request.expected_revision,
            reason: request.reason,
            idempotency_key: request.idempotency_key,
        })
        .await
        .map_err(|error| standard_entitlement_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        StandardEntitlementMutation {
            entitlement: map_standard_entitlement(result.entitlement),
            replayed: result.replayed,
        },
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/content-access-policies/{target_type}/{target_id}",
    operation_id = "getContentAccessPolicy",
    tag = "admin",
    params(
        ("target_type" = String, Path),
        ("target_id" = Uuid, Path)
    ),
    responses(
        (status = 200, body = ApiResponse<ContentAccessPolicy>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 422, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn get_content_access_policy(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path((target_type, target_id)): Path<(String, Uuid)>,
) -> Result<Json<ApiResponse<ContentAccessPolicy>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::CONTENT_ACCESS_POLICIES_READ,
    )
    .await?;
    let target_type = parse_content_access_target_type(&target_type)
        .ok_or_else(|| validation_error(request_id, "target_type", "访问策略目标类型无效"))?;
    let record = database
        .content_access_policy(content_access_target_type_key(target_type), target_id)
        .await
        .map_err(|error| database_error(request_id, error, "内容访问策略查询失败"))?
        .ok_or_else(|| {
            admin_error(
                StatusCode::NOT_FOUND,
                error_codes::CONTENT_ACCESS_POLICY_NOT_FOUND,
                "内容访问策略不存在",
                request_id,
            )
        })?;
    Ok(Json(ApiResponse::new(
        map_content_access_policy(record).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/content-access-policies/{target_type}/{target_id}",
    operation_id = "putContentAccessPolicy",
    tag = "admin",
    params(
        ("target_type" = String, Path),
        ("target_id" = Uuid, Path),
        ("x-csrf-token" = String, Header)
    ),
    request_body = PutContentAccessPolicyRequest,
    responses(
        (status = 200, body = ApiResponse<ContentAccessPolicy>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn put_content_access_policy(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path((target_type, target_id)): Path<(String, Uuid)>,
    request: Result<Json<PutContentAccessPolicyRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ContentAccessPolicy>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::CONTENT_ACCESS_POLICIES_WRITE,
    )
    .await?;
    let target_type = parse_content_access_target_type(&target_type)
        .ok_or_else(|| validation_error(request_id, "target_type", "访问策略目标类型无效"))?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let record = database
        .put_content_access_policy(
            session.user.id,
            PutContentAccessPolicyRecord {
                target_type: content_access_target_type_key(target_type).to_owned(),
                target_id,
                operator: content_access_operator_key(request.operator).to_owned(),
                subjects: request
                    .subjects
                    .into_iter()
                    .map(|subject| ContentAccessPolicySubjectRecord {
                        subject_type: content_access_subject_type_key(subject.subject_type)
                            .to_owned(),
                        community_group_id: subject.community_group_id,
                        subject_key: subject.subject_key,
                    })
                    .collect(),
                expected_revision: request.expected_revision,
            },
        )
        .await
        .map_err(|error| content_access_policy_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_content_access_policy(record).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/membership/levels",
    operation_id = "listAdminMembershipGrowthLevels",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<Vec<AdminGrowthLevel>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn list_growth_levels(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<AdminGrowthLevel>>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::MEMBERSHIP_RULES_READ,
    )
    .await?;
    let levels = database
        .list_admin_growth_levels()
        .await
        .map_err(|error| {
            database_error(
                request_id,
                infrastructure::DatabaseError::from(error),
                "动态等级查询失败",
            )
        })?
        .into_iter()
        .map(map_admin_growth_level)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(levels, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/membership/levels",
    operation_id = "createMembershipGrowthLevel",
    tag = "admin",
    params(("x-csrf-token" = String, Header)),
    request_body = CreateGrowthLevelRequest,
    responses(
        (status = 201, body = ApiResponse<AdminGrowthLevel>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn create_growth_level(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<CreateGrowthLevelRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<AdminGrowthLevel>>), ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::MEMBERSHIP_RULES_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    validate_growth_level_create(&request)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let record = database
        .create_growth_level(
            session.user.id,
            CreateGrowthLevelRecord {
                internal_key: request.internal_key,
                level_order: request.level_order,
                display_name: request.display_name,
                required_experience: request.required_experience,
                icon_asset_id: request.icon_asset_id,
                color: request.color,
                description: request.description,
            },
        )
        .await
        .map_err(|error| growth_level_error(request_id, error))?;
    let level = map_admin_growth_level(record).map_err(|()| invalid_record(request_id))?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::new(level, request_id)),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/membership/levels/{level_id}",
    operation_id = "updateMembershipGrowthLevel",
    tag = "admin",
    params(("level_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdateGrowthLevelRequest,
    responses(
        (status = 200, body = ApiResponse<AdminGrowthLevel>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn update_growth_level(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(level_id): Path<Uuid>,
    request: Result<Json<UpdateGrowthLevelRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<AdminGrowthLevel>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::MEMBERSHIP_RULES_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    validate_growth_level_update(&request)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let record = database
        .update_growth_level(
            session.user.id,
            UpdateGrowthLevelRecord {
                id: level_id,
                expected_revision: request.expected_revision,
                level_order: request.level_order,
                display_name: request.display_name,
                required_experience: request.required_experience,
                icon_asset_id: request.icon_asset_id,
                color: request.color,
                description: request.description,
                status: growth_level_status_key(request.status).to_owned(),
            },
        )
        .await
        .map_err(|error| growth_level_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_admin_growth_level(record).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/membership/level-rules",
    operation_id = "listMembershipLevelRules",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<Vec<MembershipLevelRule>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn list_membership_level_rules(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<MembershipLevelRule>>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::MEMBERSHIP_RULES_READ,
    )
    .await?;
    let rules = database
        .list_membership_level_rules()
        .await
        .map_err(|error| database_error(request_id, error, "会员等级规则查询失败"))?
        .into_iter()
        .map(map_membership_level_rule)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(rules, request_id)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/membership/level-rules/{level_key}",
    operation_id = "updateMembershipLevelRule",
    tag = "admin",
    params(("level_key" = String, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdateMembershipLevelRuleRequest,
    responses(
        (status = 200, body = ApiResponse<MembershipLevelRule>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update_membership_level_rule(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<String>, axum::extract::rejection::PathRejection>,
    request: Result<Json<UpdateMembershipLevelRuleRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<MembershipLevelRule>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::MEMBERSHIP_RULES_WRITE,
    )
    .await?;
    let Path(level_key) =
        path.map_err(|_| validation_error(request_id, "level_key", "等级键必须是 lv_1 至 lv_20"))?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    validate_membership_level_rule(&level_key, &request)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let record = database
        .update_membership_level_rule(
            session.user.id,
            UpdateMembershipLevelRuleRecord {
                level_key,
                required_lifetime_points: request.required_lifetime_points,
                enabled: request.enabled,
                display_name: request.display_name,
            },
        )
        .await
        .map_err(|error| match error {
            UpdateMembershipLevelRuleError::Forbidden => admin_error(
                StatusCode::FORBIDDEN,
                error_codes::ADMIN_FORBIDDEN,
                "当前账号已失去会员等级规则写入权限",
                request_id,
            ),
            UpdateMembershipLevelRuleError::InvalidLevel => {
                validation_error(request_id, "level_key", "等级键必须是 lv_1 至 lv_20")
            }
            UpdateMembershipLevelRuleError::InvalidThreshold => validation_error(
                request_id,
                "required_lifetime_points",
                "启用的 lv_2 至 lv_20 阈值必须是正数，lv_1 必须为 0",
            ),
            UpdateMembershipLevelRuleError::InvalidThresholdOrder => validation_error(
                request_id,
                "required_lifetime_points",
                "启用等级的积分阈值必须随等级递增",
            ),
            UpdateMembershipLevelRuleError::InvalidDisplayName => validation_error(
                request_id,
                "display_name",
                "等级展示名称必须为 1 到 80 个字符且不能包含控制字符",
            ),
            UpdateMembershipLevelRuleError::InvalidAppendOrder => validation_error(
                request_id,
                "level_key",
                "等级必须从当前最高等级的下一个序号按顺序开放",
            ),
            UpdateMembershipLevelRuleError::Database(error) => {
                database_error(request_id, error, "会员等级规则保存失败")
            }
        })?;
    Ok(Json(ApiResponse::new(
        map_membership_level_rule(record).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/membership/points",
    operation_id = "grantMembershipPoints",
    tag = "admin",
    params(("x-csrf-token" = String, Header)),
    request_body = GrantMembershipPointsRequest,
    responses(
        (status = 200, body = ApiResponse<MembershipPointsGrant>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 422, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn grant_membership_points(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<GrantMembershipPointsRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<MembershipPointsGrant>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::MEMBERSHIP_POINTS_GRANT,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    validate_points_grant(&request)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let result = database
        .grant_membership_points(
            session.user.id,
            request.user_id,
            request.amount,
            &request.reason,
            request.idempotency_key.as_deref(),
        )
        .await
        .map_err(|error| map_points_grant_error(request_id, error))?;
    let account =
        map_membership_account(result.account).map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(
        MembershipPointsGrant {
            account,
            created: result.created,
        },
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/membership/medal-rules",
    operation_id = "listMembershipMedalRules",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<Vec<MembershipMedalRule>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn list_membership_medal_rules(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<MembershipMedalRule>>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::MEMBERSHIP_MEDALS_READ,
    )
    .await?;
    let rules = database
        .list_membership_medal_rules()
        .await
        .map_err(|error| database_error(request_id, error, "勋章运营规则查询失败"))?
        .into_iter()
        .map(map_membership_medal_rule)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(rules, request_id)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/membership/medal-rules/{medal_key}",
    operation_id = "updateMembershipMedalRule",
    tag = "admin",
    params(("medal_key" = String, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdateMembershipMedalRuleRequest,
    responses(
        (status = 200, body = ApiResponse<MembershipMedalRule>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 422, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn update_membership_medal_rule(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<String>, axum::extract::rejection::PathRejection>,
    request: Result<Json<UpdateMembershipMedalRuleRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<MembershipMedalRule>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::MEMBERSHIP_MEDAL_RULES_WRITE,
    )
    .await?;
    let Path(medal_key) = path.map_err(|_| {
        validation_error(request_id, "medal_key", "勋章键必须是 medal_01 至 medal_17")
    })?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    validate_membership_medal_rule(&medal_key, &request)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let record = database
        .update_membership_medal_rule(
            session.user.id,
            UpdateMembershipMedalRuleRecord {
                medal_key,
                enabled: request.enabled,
                required_lifetime_points: request.required_lifetime_points,
            },
        )
        .await
        .map_err(|error| match error {
            UpdateMembershipMedalRuleError::Forbidden => admin_error(
                StatusCode::FORBIDDEN,
                error_codes::ADMIN_FORBIDDEN,
                "当前账号已失去勋章规则写入权限",
                request_id,
            ),
            UpdateMembershipMedalRuleError::InvalidMedal => {
                validation_error(request_id, "medal_key", "勋章键必须是 medal_01 至 medal_17")
            }
            UpdateMembershipMedalRuleError::InvalidThreshold => validation_error(
                request_id,
                "required_lifetime_points",
                "启用规则必须配置非负积分阈值",
            ),
            UpdateMembershipMedalRuleError::Database(error) => {
                database_error(request_id, error, "勋章运营规则保存失败")
            }
        })?;
    Ok(Json(ApiResponse::new(
        map_membership_medal_rule(record).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/membership/medals",
    operation_id = "grantMembershipMedal",
    tag = "admin",
    params(("x-csrf-token" = String, Header)),
    request_body = GrantMembershipMedalRequest,
    responses(
        (status = 200, body = ApiResponse<MembershipMedalGrant>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 422, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn grant_membership_medal(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<GrantMembershipMedalRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<MembershipMedalGrant>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::MEMBERSHIP_MEDALS_GRANT,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    validate_membership_medal_grant(&request)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let result = database
        .grant_membership_medal(
            session.user.id,
            request.user_id,
            &request.medal_key,
            &request.reason,
        )
        .await
        .map_err(|error| match error {
            GrantMembershipMedalError::Forbidden => admin_error(
                StatusCode::FORBIDDEN,
                error_codes::ADMIN_FORBIDDEN,
                "当前账号已失去勋章授予权限",
                request_id,
            ),
            GrantMembershipMedalError::UserNotFound => admin_error(
                StatusCode::NOT_FOUND,
                error_codes::USER_NOT_FOUND,
                "目标用户不存在",
                request_id,
            ),
            GrantMembershipMedalError::InvalidMedal | GrantMembershipMedalError::InvalidReason => {
                validation_error(request_id, "request", "勋章授予请求无效")
            }
            GrantMembershipMedalError::Database(error) => {
                database_error(request_id, error, "勋章授予失败")
            }
        })?;
    let medal = map_membership_medal(result.medal).map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(
        MembershipMedalGrant {
            medal,
            created: result.created,
        },
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/audit",
    operation_id = "listAdminAudit",
    tag = "admin",
    params(ListAuditQuery),
    responses(
        (status = 200, body = PageResponse<AdminAuditEntry>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_audit(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListAuditQuery>, QueryRejection>,
) -> Result<Json<PageResponse<AdminAuditEntry>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUDIT_READ,
    )
    .await?;
    let query = validate_audit_query(query)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let limit = query.limit.expect("validated audit limit");
    let mut records = database
        .list_admin_audit(
            ListAdminAuditFilter {
                actor_id: query.actor_id,
                action: query.action.as_deref(),
                resource_type: query.resource_type.as_deref(),
                resource_id: query.resource_id,
                user_id: query.user_id,
                report_id: query.report_id,
            },
            query.cursor,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|error| match error {
            ListAdminAuditError::InvalidCursor => {
                validation_error(request_id, "cursor", "cursor 不属于当前审计列表")
            }
            ListAdminAuditError::Database(error) => {
                database_error(request_id, error, "审计查询失败")
            }
        })?;
    let next_cursor = if records.len() > usize::from(limit) {
        records.truncate(usize::from(limit));
        records.last().map(|record| record.id.to_string())
    } else {
        None
    };
    let entries = records
        .into_iter()
        .map(map_audit)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(PageResponse::new(entries, request_id, next_cursor)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/audit/alerts",
    operation_id = "listRiskAlertAudit",
    tag = "admin",
    params(ListAuditQuery),
    responses(
        (status = 200, body = PageResponse<AdminAuditEntry>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
async fn list_audit_alerts(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListAuditQuery>, QueryRejection>,
) -> Result<Json<PageResponse<AdminAuditEntry>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::AUDIT_READ,
    )
    .await?;
    let mut query = validate_audit_query(query)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    if query
        .resource_type
        .as_deref()
        .is_some_and(|value| value != "risk_alert")
    {
        return Err(validation_error(
            request_id,
            "resource_type",
            "审计告警仅支持 risk_alert 资源",
        ));
    }
    query.resource_type = Some("risk_alert".to_owned());
    let limit = query.limit.expect("validated audit limit");
    let mut records = database
        .list_admin_audit(
            ListAdminAuditFilter {
                actor_id: query.actor_id,
                action: query.action.as_deref(),
                resource_type: query.resource_type.as_deref(),
                resource_id: query.resource_id,
                user_id: query.user_id,
                report_id: query.report_id,
            },
            query.cursor,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|error| match error {
            ListAdminAuditError::InvalidCursor => {
                validation_error(request_id, "cursor", "cursor 不属于当前审计告警列表")
            }
            ListAdminAuditError::Database(error) => {
                database_error(request_id, error, "审计告警查询失败")
            }
        })?;
    let next_cursor = if records.len() > usize::from(limit) {
        records.truncate(usize::from(limit));
        records.last().map(|record| record.id.to_string())
    } else {
        None
    };
    let entries = records
        .into_iter()
        .map(map_audit)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(PageResponse::new(entries, request_id, next_cursor)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/governance/policy",
    operation_id = "getGovernancePolicy",
    tag = "admin",
    responses(
        (status = 200, body = ApiResponse<GovernancePolicy>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
async fn get_governance_policy(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<GovernancePolicy>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::GOVERNANCE_POLICY_READ,
    )
    .await?;
    let policy = database
        .get_governance_policy()
        .await
        .map_err(|error| database_error(request_id, error, "风控策略读取失败"))?;
    Ok(Json(ApiResponse::new(map_policy(policy), request_id)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/governance/policy",
    operation_id = "updateGovernancePolicy",
    tag = "admin",
    params(("x-csrf-token" = String, Header)),
    request_body = UpdateGovernancePolicyRequest,
    responses(
        (status = 200, body = ApiResponse<GovernancePolicy>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 422, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
async fn update_governance_policy(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<UpdateGovernancePolicyRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<GovernancePolicy>>, ApiError> {
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::GOVERNANCE_POLICY_WRITE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input = validate_governance_policy(request)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let policy = database
        .update_governance_policy(
            session.user.id,
            input.enabled,
            input.alert_score_threshold,
            input.reporter_window_minutes,
            input.reporter_alert_limit,
        )
        .await
        .map_err(|error| database_error(request_id, error, "风控策略保存失败"))?;
    Ok(Json(ApiResponse::new(map_policy(policy), request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/risk-alerts",
    operation_id = "listRiskAlerts",
    tag = "admin",
    params(ListRiskAlertsQuery),
    responses(
        (status = 200, body = PageResponse<RiskAlert>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 422, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
async fn list_risk_alerts(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<ListRiskAlertsQuery>, QueryRejection>,
) -> Result<Json<PageResponse<RiskAlert>>, ApiError> {
    authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::GOVERNANCE_ALERTS_READ,
    )
    .await?;
    let query = validate_risk_alert_query(query)
        .map_err(|(field, message)| validation_error(request_id, field, message))?;
    let limit = query.limit.expect("validated risk alert limit");
    let status = query.status.map(risk_alert_status);
    let mut records = database
        .list_risk_alerts(status, query.cursor, i64::from(limit) + 1)
        .await
        .map_err(|error| match error {
            ListRiskAlertsError::InvalidCursor => {
                validation_error(request_id, "cursor", "cursor 不属于当前告警列表")
            }
            ListRiskAlertsError::Database(error) => {
                database_error(request_id, error, "风险告警查询失败")
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
        .map(map_risk_alert)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(PageResponse::new(alerts, request_id, next_cursor)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/risk-alerts/{alert_id}",
    operation_id = "updateRiskAlert",
    tag = "admin",
    params(("alert_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdateRiskAlertRequest,
    responses(
        (status = 200, body = ApiResponse<RiskAlert>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 422, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
async fn update_risk_alert(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    request: Result<Json<UpdateRiskAlertRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<RiskAlert>>, ApiError> {
    let Path(alert_id) =
        path.map_err(|_| validation_error(request_id, "alert_id", "告警路径参数必须是 UUID"))?;
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::GOVERNANCE_ALERTS_RESOLVE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let status = match request.status {
        RiskAlertStatus::Acknowledged => "acknowledged",
        RiskAlertStatus::Dismissed => "dismissed",
        RiskAlertStatus::Open => {
            return Err(validation_error(request_id, "status", "告警只能确认或驳回"));
        }
    };
    let record = database
        .update_risk_alert(session.user.id, alert_id, status)
        .await
        .map_err(|error| match error {
            UpdateRiskAlertError::Forbidden => admin_error(
                StatusCode::FORBIDDEN,
                error_codes::ADMIN_FORBIDDEN,
                "当前账号已失去风险告警处理权限",
                request_id,
            ),
            UpdateRiskAlertError::NotFound => admin_error(
                StatusCode::NOT_FOUND,
                error_codes::GOVERNANCE_ALERT_NOT_FOUND,
                "风险告警不存在",
                request_id,
            ),
            UpdateRiskAlertError::Conflict => admin_error(
                StatusCode::CONFLICT,
                error_codes::GOVERNANCE_ALERT_CONFLICT,
                "风险告警已被其他管理员处理，请刷新后重试",
                request_id,
            ),
            UpdateRiskAlertError::InvalidStatus => {
                validation_error(request_id, "status", "告警状态无效")
            }
            UpdateRiskAlertError::Database(error) => {
                database_error(request_id, error, "风险告警更新失败")
            }
        })?;
    Ok(Json(ApiResponse::new(
        map_risk_alert(record).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/attachments/cleanup",
    operation_id = "cleanupAttachments",
    tag = "admin",
    params(AttachmentCleanupQuery, ("x-csrf-token" = String, Header)),
    responses(
        (status = 200, body = ApiResponse<AttachmentCleanupResult>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 422, body = ErrorResponse),
        (status = 503, body = ErrorResponse)
    )
)]
async fn cleanup_attachments(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<AttachmentCleanupQuery>, QueryRejection>,
) -> Result<Json<ApiResponse<AttachmentCleanupResult>>, ApiError> {
    authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::ATTACHMENT_CLEANUP,
    )
    .await?;
    let Query(query) =
        query.map_err(|_| validation_error(request_id, "query", "清理参数格式不正确"))?;
    let limit = query.limit.unwrap_or(100);
    if !(1..=500).contains(&limit) {
        return Err(validation_error(
            request_id,
            "limit",
            "limit 必须在 1 到 500 之间",
        ));
    }
    let result = database
        .cleanup_attachments(i64::from(limit))
        .await
        .map_err(|error| match error {
            AttachmentCleanupError::Storage(error) => {
                tracing::warn!(request_id = %request_id, error = ?error, "Attachment cleanup storage failed");
                database_error(
                    request_id,
                    infrastructure::DatabaseError::MigrationState,
                    "附件清理失败",
                )
            }
            AttachmentCleanupError::Database(error) => {
                database_error(request_id, error, "附件清理失败")
            }
        })?;
    Ok(Json(ApiResponse::new(
        AttachmentCleanupResult {
            deleted_records: result.deleted_records,
            deleted_objects: result.deleted_objects,
            failed_objects: result.failed_objects,
        },
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/site-branding",
    operation_id = "getSiteBranding",
    tag = "branding",
    responses(
        (status = 200, description = "Current public site branding", body = ApiResponse<SiteBranding>),
        (status = 503, description = "Branding is unavailable", body = ErrorResponse)
    )
)]
async fn get_public_branding(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(cache): Extension<CacheRuntime>,
) -> Result<Json<ApiResponse<SiteBranding>>, ApiError> {
    match cache.get_site_branding().await {
        Ok(Some(branding)) => return Ok(Json(ApiResponse::new(branding, request_id))),
        Ok(None) => {}
        Err(error) => tracing::warn!(
            request_id = %request_id,
            error = %error,
            "Site branding cache lookup failed"
        ),
    }
    let branding = database
        .get_site_branding()
        .await
        .map_err(|error| database_error(request_id, error, "Branding lookup failed"))?;
    let branding = map_branding(branding).map_err(|()| invalid_record(request_id))?;
    if let Err(error) = cache.set_site_branding(&branding).await {
        tracing::warn!(
            request_id = %request_id,
            error = %error,
            "Site branding cache population failed"
        );
    }
    Ok(Json(ApiResponse::new(branding, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/site-branding/assets/{kind}",
    operation_id = "getPublicBrandAsset",
    tag = "branding",
    params(("kind" = String, Path, description = "Brand asset kind: logo or favicon")),
    responses(
        (status = 200, description = "Current brand asset bytes", content_type = "application/octet-stream", headers(("x-request-id" = String), ("cache-control" = String), ("x-content-type-options" = String))),
        (status = 404, description = "Brand asset is unavailable", body = ErrorResponse),
        (status = 503, description = "Brand asset storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn get_public_brand_asset(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Path(kind): Path<String>,
) -> Result<Response, ApiError> {
    let (record, bytes) = database
        .read_brand_asset(&kind)
        .await
        .map_err(|error| brand_asset_error(request_id, error))?;
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&record.mime_type).expect("validated brand MIME must be a header"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300, must-revalidate"),
    );
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/site-branding/assets/{kind}",
    operation_id = "uploadBrandAsset",
    tag = "admin",
    params(
        ("kind" = String, Path, description = "Brand asset kind: logo or favicon"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    request_body(content = Vec<u8>, content_type = "application/octet-stream"),
    responses(
        (status = 200, description = "Brand asset uploaded", body = ApiResponse<SiteBranding>),
        (status = 401, description = "Authentication is required", body = ErrorResponse),
        (status = 403, description = "Brand configuration write access is required", body = ErrorResponse),
        (status = 422, description = "Brand asset bytes or MIME are invalid", body = ErrorResponse),
        (status = 503, description = "Brand asset storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn upload_brand_asset(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    Path(kind): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<ApiResponse<SiteBranding>>, ApiError> {
    let session = authorize_admin_write(&database, &runtime, &headers, request_id).await?;
    let mime_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| brand_asset_invalid(request_id))?;
    let branding = database
        .upload_brand_asset(session.user.id, &kind, mime_type, body.to_vec())
        .await
        .map_err(|error| brand_asset_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_branding(branding).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/site-branding/assets/{kind}",
    operation_id = "deleteBrandAsset",
    tag = "admin",
    params(
        ("kind" = String, Path, description = "Brand asset kind: logo or favicon"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "Brand asset deleted or already absent", body = ApiResponse<SiteBranding>),
        (status = 401, description = "Authentication is required", body = ErrorResponse),
        (status = 403, description = "Brand configuration write access is required", body = ErrorResponse),
        (status = 422, description = "Brand asset kind is invalid", body = ErrorResponse),
        (status = 503, description = "Brand asset storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn delete_brand_asset(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    Path(kind): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<SiteBranding>>, ApiError> {
    let session = authorize_admin_write(&database, &runtime, &headers, request_id).await?;
    let branding = database
        .delete_brand_asset(session.user.id, &kind)
        .await
        .map_err(|error| brand_asset_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_branding(branding).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/site-branding",
    operation_id = "getAdminSiteBranding",
    tag = "admin",
    responses(
        (status = 200, description = "Current site branding for administrators", body = ApiResponse<SiteBranding>),
        (status = 401, description = "Authentication is required", body = ErrorResponse),
        (status = 403, description = "Super administrator access is required", body = ErrorResponse),
        (status = 503, description = "Branding is unavailable", body = ErrorResponse)
    )
)]
async fn get_admin_branding(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<SiteBranding>>, ApiError> {
    authorize_admin_read(&database, &runtime, &headers, request_id).await?;
    let branding = database
        .get_site_branding()
        .await
        .map_err(|error| database_error(request_id, error, "Branding lookup failed"))?;
    Ok(Json(ApiResponse::new(
        map_branding(branding).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/site-branding",
    operation_id = "updateSiteBranding",
    tag = "admin",
    request_body = UpdateSiteBrandingRequest,
    responses(
        (status = 200, description = "Site branding updated", body = ApiResponse<SiteBranding>),
        (status = 401, description = "Authentication is required", body = ErrorResponse),
        (status = 403, description = "Super administrator access is required", body = ErrorResponse),
        (status = 422, description = "Branding fields are invalid", body = ErrorResponse),
        (status = 503, description = "Branding is unavailable", body = ErrorResponse)
    )
)]
async fn update_branding(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<UpdateSiteBrandingRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<SiteBranding>>, ApiError> {
    let session = authorize_admin_write(&database, &runtime, &headers, request_id).await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input =
        validate_branding(request).map_err(|fields| validation_fields(request_id, fields))?;
    let branding = database
        .update_site_branding(
            session.user.id,
            UpdateSiteBrandingRecord {
                site_name: input.site_name,
                logo_url: input.logo_url,
                favicon_url: input.favicon_url,
                default_cover_url: input.default_cover_url,
                navigation_links: input.navigation_links,
                footer_text: input.footer_text,
                footer_links: input.footer_links,
                primary_color: input.primary_color,
                accent_color: input.accent_color,
                theme_preset: input.theme_preset,
                list_density: input.list_density,
                home_mode: input.home_mode,
            },
        )
        .await
        .map_err(|error| admin_mutation_error(request_id, error, "品牌配置更新失败"))?;
    Ok(Json(ApiResponse::new(
        map_branding(branding).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/boards",
    operation_id = "listAdminBoards",
    tag = "admin",
    responses(
        (status = 200, description = "Active boards for administrators", body = ApiResponse<Vec<AdminBoard>>),
        (status = 401, description = "Authentication is required", body = ErrorResponse),
        (status = 403, description = "Super administrator access is required", body = ErrorResponse),
        (status = 503, description = "Boards are unavailable", body = ErrorResponse)
    )
)]
async fn list_admin_boards(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<AdminBoard>>>, ApiError> {
    authorize_admin_read(&database, &runtime, &headers, request_id).await?;
    let boards = database
        .list_admin_boards()
        .await
        .map_err(|error| database_error(request_id, error, "Board lookup failed"))?;
    let boards = boards
        .into_iter()
        .map(map_board)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(boards, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/boards",
    operation_id = "createAdminBoard",
    tag = "admin",
    request_body = CreateAdminBoardRequest,
    responses(
        (status = 201, description = "Board created", body = ApiResponse<AdminBoard>),
        (status = 401, description = "Authentication is required", body = ErrorResponse),
        (status = 403, description = "Super administrator access is required", body = ErrorResponse),
        (status = 409, description = "Board slug is already in use", body = ErrorResponse),
        (status = 422, description = "Board fields, parent, or hierarchy depth are invalid", body = ErrorResponse),
        (status = 503, description = "Boards are unavailable", body = ErrorResponse)
    )
)]
async fn create_board(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<CreateAdminBoardRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<AdminBoard>>), ApiError> {
    let session = authorize_admin_write(&database, &runtime, &headers, request_id).await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input = validate_board(request).map_err(|fields| validation_fields(request_id, fields))?;
    let board = database
        .create_admin_board(
            session.user.id,
            CreateAdminBoardRecord {
                id: Uuid::now_v7(),
                parent_id: input.parent_id,
                slug: input.slug,
                name: input.name,
                description: input.description,
                icon: input.icon,
                tone: input.tone,
                position: input.position,
                visibility: input.visibility,
            },
        )
        .await
        .map_err(|error| admin_mutation_error(request_id, error, "板块创建失败"))?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::new(
            map_board(board).map_err(|()| invalid_record(request_id))?,
            request_id,
        )),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/boards/{board_id}",
    operation_id = "updateAdminBoard",
    tag = "admin",
    request_body = UpdateAdminBoardRequest,
    responses(
        (status = 200, description = "Board updated", body = ApiResponse<AdminBoard>),
        (status = 401, description = "Authentication is required", body = ErrorResponse),
        (status = 403, description = "Super administrator access is required", body = ErrorResponse),
        (status = 404, description = "Board was not found", body = ErrorResponse),
        (status = 409, description = "Board slug is already in use", body = ErrorResponse),
        (status = 422, description = "Board fields, parent, cycle, or hierarchy depth are invalid", body = ErrorResponse),
        (status = 503, description = "Boards are unavailable", body = ErrorResponse)
    )
)]
async fn update_board(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(board_id): Path<Uuid>,
    request: Result<Json<UpdateAdminBoardRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<AdminBoard>>, ApiError> {
    let session = authorize_admin_write(&database, &runtime, &headers, request_id).await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let input =
        validate_board_update(request).map_err(|fields| validation_fields(request_id, fields))?;
    let board = database
        .update_admin_board(
            session.user.id,
            UpdateAdminBoardRecord {
                id: board_id,
                parent_id: input.parent_id,
                slug: input.slug,
                name: input.name,
                description: input.description,
                icon: input.icon,
                tone: input.tone,
                position: input.position,
                visibility: input.visibility,
                expected_revision: input
                    .expected_revision
                    .expect("validated board update must carry a revision"),
            },
        )
        .await
        .map_err(|error| admin_mutation_error(request_id, error, "板块更新失败"))?;
    Ok(Json(ApiResponse::new(
        map_board(board).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/boards/{board_id}/deletion-impact",
    operation_id = "getAdminBoardDeletionImpact",
    tag = "admin",
    responses(
        (status = 200, description = "Board deletion impact", body = ApiResponse<AdminBoardDeletionImpact>),
        (status = 401, description = "Authentication is required", body = ErrorResponse),
        (status = 403, description = "Administrator access is required", body = ErrorResponse),
        (status = 404, description = "Board was not found", body = ErrorResponse),
        (status = 503, description = "Boards are unavailable", body = ErrorResponse)
    )
)]
async fn get_board_deletion_impact(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(board_id): Path<Uuid>,
) -> Result<Json<ApiResponse<AdminBoardDeletionImpact>>, ApiError> {
    authorize_admin_read(&database, &runtime, &headers, request_id).await?;
    let impact = database
        .get_admin_board_deletion_impact(board_id)
        .await
        .map_err(|error| admin_mutation_error(request_id, error, "版块删除影响读取失败"))?;
    Ok(Json(ApiResponse::new(
        map_board_deletion_impact(impact).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/boards/{board_id}",
    operation_id = "deleteAdminBoard",
    tag = "admin",
    responses(
        (status = 200, description = "Board soft-deleted", body = ApiResponse<bool>),
        (status = 401, description = "Authentication is required", body = ErrorResponse),
        (status = 403, description = "Super administrator access is required", body = ErrorResponse),
        (status = 404, description = "Board was not found", body = ErrorResponse),
        (status = 409, description = "Boards with children or topics cannot be deleted", body = ErrorResponse),
        (status = 503, description = "Boards are unavailable", body = ErrorResponse)
    )
)]
async fn delete_board(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    Path(board_id): Path<Uuid>,
) -> Result<Json<ApiResponse<bool>>, ApiError> {
    let session = authorize_admin_write(&database, &runtime, &headers, request_id).await?;
    database
        .delete_admin_board(session.user.id, board_id)
        .await
        .map_err(|error| admin_mutation_error(request_id, error, "板块删除失败"))?;
    Ok(Json(ApiResponse::new(true, request_id)))
}

struct ValidatedBranding {
    site_name: String,
    logo_url: Option<String>,
    favicon_url: Option<String>,
    default_cover_url: Option<Option<String>>,
    navigation_links: Option<Vec<BrandLinkRecord>>,
    footer_text: Option<Option<String>>,
    footer_links: Option<Vec<BrandLinkRecord>>,
    primary_color: String,
    accent_color: String,
    theme_preset: String,
    list_density: String,
    home_mode: String,
}

struct ValidatedBoard {
    parent_id: Option<Uuid>,
    slug: String,
    name: String,
    description: String,
    icon: String,
    tone: String,
    position: i32,
    visibility: String,
    expected_revision: Option<i64>,
}

fn validate_branding(request: UpdateSiteBrandingRequest) -> Result<ValidatedBranding, FieldErrors> {
    let mut fields = FieldErrors::new();
    let site_name = request.site_name.trim().to_owned();
    if !(1..=80).contains(&site_name.chars().count()) || site_name.chars().any(char::is_control) {
        add_field(
            &mut fields,
            "site_name",
            "站点名称必须为 1 到 80 个字符且不能包含控制字符",
        );
    }
    let logo_url = validate_asset_url(request.logo_url, "logo_url", "logo", &mut fields);
    let favicon_url =
        validate_asset_url(request.favicon_url, "favicon_url", "favicon", &mut fields);
    let default_cover_url = request
        .default_cover_url
        .map(|value| validate_url(value, "default_cover_url", &mut fields));
    let navigation_links = request
        .navigation_links
        .map(|links| validate_brand_links(links, "navigation_links", 8, &mut fields));
    let footer_text = request.footer_text.map(|value| {
        let value = value.map(|item| item.trim().to_owned());
        if value.as_deref().is_some_and(|item| {
            !(1..=200).contains(&item.chars().count()) || item.chars().any(char::is_control)
        }) {
            add_field(
                &mut fields,
                "footer_text",
                "页脚文本必须为 1 到 200 个字符且不能包含控制字符",
            );
        }
        value
    });
    let footer_links = request
        .footer_links
        .map(|links| validate_brand_links(links, "footer_links", 8, &mut fields));
    if !valid_hex_color(&request.primary_color) {
        add_field(&mut fields, "primary_color", "主色必须是 6 位十六进制颜色");
    }
    if !valid_hex_color(&request.accent_color) {
        add_field(&mut fields, "accent_color", "强调色必须是 6 位十六进制颜色");
    }
    if fields.is_empty() {
        Ok(ValidatedBranding {
            site_name,
            logo_url,
            favicon_url,
            default_cover_url,
            navigation_links,
            footer_text,
            footer_links,
            primary_color: request.primary_color,
            accent_color: request.accent_color,
            theme_preset: theme_preset(request.theme_preset),
            list_density: list_density(request.list_density),
            home_mode: home_mode(request.home_mode),
        })
    } else {
        Err(fields)
    }
}

struct ValidatedAuthorizationRoleCreate {
    key: String,
    name: String,
    scope: String,
    permission_keys: Vec<String>,
}

struct ValidatedAuthorizationRoleUpdate {
    name: String,
    permission_keys: Vec<String>,
    expected_revision: i64,
}

fn validate_create_authorization_role(
    request: CreateAuthorizationRoleRequest,
) -> Result<ValidatedAuthorizationRoleCreate, FieldErrors> {
    let mut fields = FieldErrors::new();
    let key = request.key.trim().to_owned();
    let name = request.name.trim().to_owned();
    if !valid_role_key(&key) {
        add_field(
            &mut fields,
            "key",
            "角色键必须是 2 到 64 位小写字母、数字或下划线",
        );
    }
    validate_role_name(&name, &mut fields);
    let permission_keys = validate_permission_keys(request.permission_keys, &mut fields);
    if fields.is_empty() {
        Ok(ValidatedAuthorizationRoleCreate {
            key,
            name,
            scope: authorization_role_scope(request.scope),
            permission_keys,
        })
    } else {
        Err(fields)
    }
}

fn validate_update_authorization_role(
    request: UpdateAuthorizationRoleRequest,
) -> Result<ValidatedAuthorizationRoleUpdate, FieldErrors> {
    let mut fields = FieldErrors::new();
    let name = request.name.trim().to_owned();
    validate_role_name(&name, &mut fields);
    let permission_keys = validate_permission_keys(request.permission_keys, &mut fields);
    let expected_revision = i64::try_from(request.expected_revision).unwrap_or(0);
    if expected_revision < 1 {
        add_field(
            &mut fields,
            "expected_revision",
            "expected_revision 必须是正整数",
        );
    }
    if fields.is_empty() {
        Ok(ValidatedAuthorizationRoleUpdate {
            name,
            permission_keys,
            expected_revision,
        })
    } else {
        Err(fields)
    }
}

fn validate_role_name(name: &str, fields: &mut FieldErrors) {
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        add_field(
            fields,
            "name",
            "角色名称必须是 1 到 80 个字符且不能包含控制字符",
        );
    }
}

fn validate_permission_keys(values: Vec<String>, fields: &mut FieldErrors) -> Vec<String> {
    let values = values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .collect::<Vec<_>>();
    let unique = values.iter().collect::<BTreeSet<_>>();
    if values.is_empty()
        || unique.len() != values.len()
        || values.len() > 64
        || values.iter().any(|value| !valid_permission_key(value))
    {
        add_field(
            fields,
            "permission_keys",
            "权限键必须包含 1 到 64 个不重复的合法 capability",
        );
    }
    values
}

fn valid_role_key(value: &str) -> bool {
    (2..=64).contains(&value.len())
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn valid_permission_key(value: &str) -> bool {
    (2..=96).contains(&value.len())
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_')
        })
}

fn valid_assignment_username(username: &str) -> bool {
    let mut characters = username.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    let length = 1 + characters.clone().count();
    (3..=32).contains(&length)
        && first.is_ascii_lowercase()
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn authorization_role_scope(value: AuthorizationRoleScope) -> String {
    match value {
        AuthorizationRoleScope::Instance => "instance",
        AuthorizationRoleScope::Site => "site",
        AuthorizationRoleScope::Board => "board",
    }
    .to_owned()
}

fn validate_board(request: CreateAdminBoardRequest) -> Result<ValidatedBoard, FieldErrors> {
    let mut fields = FieldErrors::new();
    let slug = request.slug.trim().to_owned();
    let name = request.name.trim().to_owned();
    let description = request.description.trim().to_owned();
    let icon = request.icon.trim().to_owned();
    if !valid_slug(&slug, 80) {
        add_field(
            &mut fields,
            "slug",
            "slug 必须是 1 到 80 位小写字母、数字或短横线",
        );
    }
    if !(1..=80).contains(&name.chars().count()) || name.chars().any(char::is_control) {
        add_field(
            &mut fields,
            "name",
            "名称必须为 1 到 80 个字符且不能包含控制字符",
        );
    }
    if description.chars().count() > 280 || description.chars().any(char::is_control) {
        add_field(
            &mut fields,
            "description",
            "描述不能超过 280 个字符且不能包含控制字符",
        );
    }
    if !valid_slug(&icon, 32) {
        add_field(&mut fields, "icon", "图标必须是小写 slug");
    }
    if request.position < 0 {
        add_field(&mut fields, "position", "排序位置不能小于 0");
    }
    if fields.is_empty() {
        Ok(ValidatedBoard {
            parent_id: request.parent_id,
            slug,
            name,
            description,
            icon,
            tone: board_tone(request.tone),
            position: request.position,
            visibility: visibility(request.visibility),
            expected_revision: None,
        })
    } else {
        Err(fields)
    }
}

fn validate_board_update(request: UpdateAdminBoardRequest) -> Result<ValidatedBoard, FieldErrors> {
    if request.expected_revision <= 0 {
        let mut fields = FieldErrors::new();
        add_field(
            &mut fields,
            "expected_revision",
            "期望版本必须是大于 0 的整数",
        );
        return Err(fields);
    }
    let expected_revision = request.expected_revision;
    let mut board = validate_board(CreateAdminBoardRequest {
        parent_id: request.parent_id,
        slug: request.slug,
        name: request.name,
        description: request.description,
        icon: request.icon,
        tone: request.tone,
        position: request.position,
        visibility: request.visibility,
    })?;
    board.expected_revision = Some(expected_revision);
    Ok(board)
}

pub(crate) async fn authorize_admin_read(
    database: &Database,
    runtime: &AuthRuntime,
    headers: &HeaderMap,
    request_id: RequestId,
) -> Result<infrastructure::SessionRecord, ApiError> {
    authorize_capability_read(
        database,
        runtime,
        headers,
        request_id,
        permission_keys::ADMIN_CONFIGURATION_READ,
    )
    .await
}

pub(crate) async fn authorize_admin_write(
    database: &Database,
    runtime: &AuthRuntime,
    headers: &HeaderMap,
    request_id: RequestId,
) -> Result<infrastructure::SessionRecord, ApiError> {
    authorize_capability_write(
        database,
        runtime,
        headers,
        request_id,
        permission_keys::ADMIN_CONFIGURATION_WRITE,
    )
    .await
}

pub(crate) async fn authorize_capability_read(
    database: &Database,
    runtime: &AuthRuntime,
    headers: &HeaderMap,
    request_id: RequestId,
    permission_key: &str,
) -> Result<infrastructure::SessionRecord, ApiError> {
    let (session, _) = authenticate_session(database, runtime, headers, request_id).await?;
    authorize_capability(database, session, permission_key, request_id).await
}

pub(crate) async fn authorize_capability_write(
    database: &Database,
    runtime: &AuthRuntime,
    headers: &HeaderMap,
    request_id: RequestId,
    permission_key: &str,
) -> Result<infrastructure::SessionRecord, ApiError> {
    let session = authenticate_state_change(database, runtime, headers, request_id).await?;
    authorize_capability(database, session, permission_key, request_id).await
}

async fn authorize_capability(
    database: &Database,
    session: infrastructure::SessionRecord,
    permission_key: &str,
    request_id: RequestId,
) -> Result<infrastructure::SessionRecord, ApiError> {
    let allowed = database
        .has_permission(session.user.id, permission_key, None)
        .await
        .map_err(|error| database_error(request_id, error, "管理员权限查询失败"))?;
    if !allowed {
        return Err(admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号没有执行此管理操作的权限",
            request_id,
        ));
    }
    Ok(session)
}

fn map_authorization_permission(record: AuthorizationPermissionRecord) -> AuthorizationPermission {
    AuthorizationPermission {
        key: record.key,
        name: record.name,
        description: record.description,
    }
}

fn map_admin_community_group(
    record: CommunityGroupConfigurationRecord,
) -> Result<AdminCommunityGroup, ()> {
    Ok(AdminCommunityGroup {
        id: record.id,
        internal_key: record.internal_key,
        display_name: record.display_name,
        description: record.description,
        is_base: record.is_base,
        status: match record.status.as_str() {
            "active" => CommunityGroupStatus::Active,
            "disabled" => CommunityGroupStatus::Disabled,
            "archived" => CommunityGroupStatus::Archived,
            _ => return Err(()),
        },
        display_order: record.display_order,
        permission_keys: record.permission_keys.into_iter().collect(),
        quotas: record.quotas,
        revision: record.revision,
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
    })
}

fn map_admin_community_membership(
    record: CommunityGroupMembershipRecord,
) -> Result<AdminCommunityGroupMembership, ()> {
    if record.membership_kind != "base" && record.membership_kind != "additional" {
        return Err(());
    }
    Ok(AdminCommunityGroupMembership {
        id: record.id,
        user_id: record.user_id,
        group: api_contract::CommunityGroupSummary {
            id: record.group_id,
            internal_key: record.group_key,
            display_name: record.group_display_name,
        },
        membership_kind: record.membership_kind,
        source: record.source,
        source_reference_id: record.source_reference_id,
        reason: record.reason,
        starts_at: format_time(record.starts_at),
        ends_at: record.ends_at.map(format_time),
        revoked_at: record.revoked_at.map(format_time),
        revocation_reason: record.revocation_reason,
        revision: record.revision,
    })
}

fn map_standard_entitlement_type(record: StandardEntitlementTypeRecord) -> StandardEntitlementType {
    StandardEntitlementType {
        id: record.id,
        internal_key: record.internal_key,
        display_name: record.display_name,
        status: record.status,
        current_version: record.current_version,
        permission_keys: record.permission_keys,
        quotas: record.quotas,
        revision: record.revision,
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
    }
}

fn map_standard_entitlement(record: StandardEntitlementRecord) -> AdminStandardEntitlement {
    AdminStandardEntitlement {
        id: record.id,
        user_id: record.user_id,
        entitlement_type_id: record.entitlement_type_id,
        entitlement_key: record.entitlement_key,
        type_version: record.type_version,
        permission_snapshot: record.permission_snapshot,
        quota_snapshot: record.quota_snapshot,
        source: record.source,
        source_reference_id: record.source_reference_id,
        reason: record.reason,
        starts_at: format_time(record.starts_at),
        ends_at: record.ends_at.map(format_time),
        revoked_at: record.revoked_at.map(format_time),
        revoked_by: record.revoked_by,
        revocation_reason: record.revocation_reason,
        revision: record.revision,
        granted_by: record.granted_by,
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
    }
}

fn map_content_access_policy(record: ContentAccessPolicyRecord) -> Result<ContentAccessPolicy, ()> {
    Ok(ContentAccessPolicy {
        id: record.id,
        target_type: parse_content_access_target_type(&record.target_type).ok_or(())?,
        target_id: record.target_id,
        operator: match record.operator.as_str() {
            "any_of" => ContentAccessOperator::AnyOf,
            "all_of" => ContentAccessOperator::AllOf,
            _ => return Err(()),
        },
        subjects: record
            .subjects
            .into_iter()
            .map(|subject| {
                Ok(ContentAccessSubject {
                    subject_type: match subject.subject_type.as_str() {
                        "public" => ContentAccessSubjectType::Public,
                        "authenticated" => ContentAccessSubjectType::Authenticated,
                        "community_group" => ContentAccessSubjectType::CommunityGroup,
                        "entitlement" => ContentAccessSubjectType::Entitlement,
                        "governance" => ContentAccessSubjectType::Governance,
                        _ => return Err(()),
                    },
                    community_group_id: subject.community_group_id,
                    subject_key: subject.subject_key,
                })
            })
            .collect::<Result<Vec<_>, _>>()?,
        revision: record.revision,
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
    })
}

fn parse_content_access_target_type(value: &str) -> Option<ContentAccessTargetType> {
    match value {
        "board" => Some(ContentAccessTargetType::Board),
        "topic" => Some(ContentAccessTargetType::Topic),
        "post" => Some(ContentAccessTargetType::Post),
        "attachment" => Some(ContentAccessTargetType::Attachment),
        _ => None,
    }
}

fn content_access_target_type_key(value: ContentAccessTargetType) -> &'static str {
    match value {
        ContentAccessTargetType::Board => "board",
        ContentAccessTargetType::Topic => "topic",
        ContentAccessTargetType::Post => "post",
        ContentAccessTargetType::Attachment => "attachment",
    }
}

fn content_access_operator_key(value: ContentAccessOperator) -> &'static str {
    match value {
        ContentAccessOperator::AnyOf => "any_of",
        ContentAccessOperator::AllOf => "all_of",
    }
}

fn content_access_subject_type_key(value: ContentAccessSubjectType) -> &'static str {
    match value {
        ContentAccessSubjectType::Public => "public",
        ContentAccessSubjectType::Authenticated => "authenticated",
        ContentAccessSubjectType::CommunityGroup => "community_group",
        ContentAccessSubjectType::Entitlement => "entitlement",
        ContentAccessSubjectType::Governance => "governance",
    }
}

fn community_group_status_key(status: CommunityGroupStatus) -> &'static str {
    match status {
        CommunityGroupStatus::Active => "active",
        CommunityGroupStatus::Disabled => "disabled",
        CommunityGroupStatus::Archived => "archived",
    }
}

fn parse_admin_timestamp(value: &str) -> Result<OffsetDateTime, ()> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| ())
}

fn map_admin_user_summary(record: AdminUserSummaryRecord) -> Result<AdminUserSummary, ()> {
    Ok(AdminUserSummary {
        id: record.id,
        username: record.username,
        display_name: record.display_name,
        avatar_url: record.avatar_url,
        status: parse_admin_user_status(&record.status).ok_or(())?,
        primary_role: record.primary_role,
        topic_count: u64::try_from(record.topic_count).map_err(|_| ())?,
        post_count: u64::try_from(record.post_count).map_err(|_| ())?,
        report_count: u64::try_from(record.report_count).map_err(|_| ())?,
        created_at: format_time(record.created_at),
        last_seen_at: record.last_seen_at.map(format_time),
    })
}

fn map_admin_user_detail(record: AdminUserDetailRecord) -> Result<AdminUserDetail, ()> {
    Ok(AdminUserDetail {
        summary: map_admin_user_summary(record.summary)?,
        bio: record.bio,
        location: record.location,
        website_url: record.website_url,
        follower_count: u64::try_from(record.follower_count).map_err(|_| ())?,
        following_count: u64::try_from(record.following_count).map_err(|_| ())?,
        roles: record
            .roles
            .into_iter()
            .map(|role| {
                Ok(AuthorizationAssignedRole {
                    id: role.id,
                    key: role.key,
                    name: role.name,
                    scope: parse_authorization_role_scope(&role.scope).ok_or(())?,
                    is_system: role.is_system,
                    revision: u64::try_from(role.revision).map_err(|_| ())?,
                })
            })
            .collect::<Result<Vec<_>, ()>>()?,
        restriction_reason: record.restriction_reason,
        restriction_expires_at: record.restriction_expires_at.map(format_time),
        revision: u64::try_from(record.revision).map_err(|_| ())?,
    })
}

fn map_admin_user_content(record: AdminUserContentRecord) -> AdminUserContentItem {
    AdminUserContentItem {
        id: record.id,
        kind: if record.kind == "topic" {
            AdminUserContentKind::Topic
        } else {
            AdminUserContentKind::Reply
        },
        topic_id: record.topic_id,
        title: record.title,
        excerpt: record.excerpt,
        status: record.status,
        created_at: format_time(record.created_at),
    }
}

fn map_admin_user_status_update(
    record: AdminUserStatusUpdateRecord,
) -> Result<AdminUserStatusUpdate, ()> {
    Ok(AdminUserStatusUpdate {
        user_id: record.user_id,
        status: parse_admin_user_status(&record.status).ok_or(())?,
        reason: record.reason,
        expires_at: record.expires_at.map(format_time),
        revision: u64::try_from(record.revision).map_err(|_| ())?,
        audit_id: record.audit_id,
        actor: UserSummary {
            id: record.actor.id,
            username: record.actor.username,
            display_name: record.actor.display_name,
            avatar_url: record.actor.avatar_url,
        },
        changed_at: format_time(record.changed_at),
    })
}

fn admin_user_status_value(status: AdminUserStatus) -> &'static str {
    match status {
        AdminUserStatus::Active => "active",
        AdminUserStatus::Restricted => "restricted",
        AdminUserStatus::Suspended => "suspended",
    }
}

fn parse_admin_user_status(status: &str) -> Option<AdminUserStatus> {
    Some(match status {
        "active" => AdminUserStatus::Active,
        "restricted" => AdminUserStatus::Restricted,
        "suspended" => AdminUserStatus::Suspended,
        _ => return None,
    })
}

fn map_authorization_role(record: AuthorizationRoleRecord) -> Result<AuthorizationRole, ()> {
    Ok(AuthorizationRole {
        id: record.id,
        key: record.key,
        name: record.name,
        scope: parse_authorization_role_scope(&record.scope).ok_or(())?,
        is_system: record.is_system,
        permission_keys: record.permission_keys,
        assignment_count: u64::try_from(record.assignment_count).map_err(|_| ())?,
        revision: u64::try_from(record.revision).map_err(|_| ())?,
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
    })
}

fn map_authorization_assignment(
    record: AuthorizationRoleAssignmentRecord,
) -> Result<AuthorizationRoleAssignment, ()> {
    Ok(AuthorizationRoleAssignment {
        id: record.id,
        user: UserSummary {
            id: record.user_id,
            username: record.user_username,
            display_name: record.user_display_name,
            avatar_url: record.user_avatar_url,
        },
        role: AuthorizationAssignedRole {
            id: record.role_id,
            key: record.role_key,
            name: record.role_name,
            scope: parse_authorization_role_scope(&record.role_scope).ok_or(())?,
            is_system: record.role_is_system,
            revision: u64::try_from(record.role_revision).map_err(|_| ())?,
        },
        scope_id: record.scope_id,
        scope_mode: match record.scope_mode.as_str() {
            "exact" => AuthorizationScopeMode::Exact,
            "subtree" => AuthorizationScopeMode::Subtree,
            _ => return Err(()),
        },
        assigned_by: UserSummary {
            id: record.assigned_by_id,
            username: record.assigned_by_username,
            display_name: record.assigned_by_display_name,
            avatar_url: record.assigned_by_avatar_url,
        },
        created_at: format_time(record.created_at),
    })
}

fn parse_authorization_role_scope(value: &str) -> Option<AuthorizationRoleScope> {
    Some(match value {
        "instance" => AuthorizationRoleScope::Instance,
        "site" => AuthorizationRoleScope::Site,
        "board" => AuthorizationRoleScope::Board,
        _ => return None,
    })
}

fn authorization_scope_mode_key(value: AuthorizationScopeMode) -> &'static str {
    match value {
        AuthorizationScopeMode::Exact => "exact",
        AuthorizationScopeMode::Subtree => "subtree",
    }
}

fn map_branding(record: SiteBrandingRecord) -> Result<SiteBranding, ()> {
    Ok(SiteBranding {
        site_name: record.site_name,
        logo_url: record.logo_url,
        favicon_url: record.favicon_url,
        default_cover_url: record.default_cover_url,
        navigation_links: record
            .navigation_links
            .0
            .into_iter()
            .map(map_brand_link)
            .collect(),
        footer_text: record.footer_text,
        footer_links: record
            .footer_links
            .0
            .into_iter()
            .map(map_brand_link)
            .collect(),
        primary_color: record.primary_color,
        accent_color: record.accent_color,
        theme_preset: parse_theme_preset(&record.theme_preset).ok_or(())?,
        list_density: parse_list_density(&record.list_density).ok_or(())?,
        home_mode: parse_home_mode(&record.home_mode).ok_or(())?,
    })
}

fn map_brand_link(record: BrandLinkRecord) -> BrandLink {
    BrandLink {
        label: record.label,
        url: record.url,
    }
}

fn map_board(record: AdminBoardRecord) -> Result<AdminBoard, ()> {
    let visibility = match record.visibility.as_str() {
        "public" => AdminBoardVisibility::Public,
        "hidden" => AdminBoardVisibility::Hidden,
        _ => return Err(()),
    };
    let topic_count = u64::try_from(record.topic_count).map_err(|_| ())?;
    Ok(AdminBoard {
        id: record.id,
        parent_id: record.parent_id,
        slug: record.slug,
        name: record.name,
        description: record.description,
        icon: record.icon,
        tone: parse_board_tone(&record.tone).ok_or(())?,
        position: record.position,
        visibility,
        topic_count,
        revision: record.revision,
    })
}

fn map_board_deletion_impact(
    record: AdminBoardDeletionImpactRecord,
) -> Result<AdminBoardDeletionImpact, ()> {
    let child_count = u64::try_from(record.child_count).map_err(|_| ())?;
    let topic_count = u64::try_from(record.topic_count).map_err(|_| ())?;
    let reply_count = u64::try_from(record.reply_count).map_err(|_| ())?;
    Ok(AdminBoardDeletionImpact {
        board_id: record.board_id,
        child_count,
        topic_count,
        reply_count,
        can_delete: child_count == 0 && topic_count == 0,
    })
}

fn map_membership_level_rule(record: MembershipLevelRuleRecord) -> Result<MembershipLevelRule, ()> {
    if !valid_level_key(&record.level_key)
        || Some(record.level_number) != level_number(&record.level_key)
        || record.level_display_name.is_empty()
    {
        return Err(());
    }
    Ok(MembershipLevelRule {
        level_key: record.level_key.clone(),
        level_number: record.level_number,
        level_display_name: record.level_display_name,
        required_lifetime_points: record.required_lifetime_points,
        enabled: record.enabled,
        updated_at: format_time(record.updated_at),
    })
}

fn map_membership_account(record: MembershipAccountRecord) -> Result<MembershipAccount, ()> {
    if !valid_level_key(&record.level_key) {
        return Err(());
    }
    Ok(MembershipAccount {
        user_id: record.user_id,
        points_balance: record.points_balance,
        lifetime_points: record.lifetime_points,
        level_key: record.level_key.clone(),
        level_number: record.level_number,
        level_display_name: record.level_display_name,
        revision: record.revision,
        updated_at: format_time(record.updated_at),
    })
}

fn map_admin_growth_level(record: AdminGrowthLevelRecord) -> Result<AdminGrowthLevel, ()> {
    Ok(AdminGrowthLevel {
        id: record.id,
        internal_key: record.internal_key,
        level_order: record.level_order,
        display_name: record.display_name,
        required_experience: record.required_experience,
        icon_asset_id: record.icon_asset_id,
        color: record.color,
        description: record.description,
        status: parse_growth_level_status(&record.status).ok_or(())?,
        revision: record.revision,
        published_at: record.published_at.map(format_time),
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
    })
}

fn parse_growth_level_status(value: &str) -> Option<GrowthLevelStatus> {
    match value {
        "draft" => Some(GrowthLevelStatus::Draft),
        "published" => Some(GrowthLevelStatus::Published),
        "disabled" => Some(GrowthLevelStatus::Disabled),
        "archived" => Some(GrowthLevelStatus::Archived),
        _ => None,
    }
}

fn growth_level_status_key(value: GrowthLevelStatus) -> &'static str {
    match value {
        GrowthLevelStatus::Draft => "draft",
        GrowthLevelStatus::Published => "published",
        GrowthLevelStatus::Disabled => "disabled",
        GrowthLevelStatus::Archived => "archived",
    }
}

fn validate_growth_level_create(
    request: &CreateGrowthLevelRequest,
) -> Result<(), (&'static str, &'static str)> {
    validate_growth_level_fields(
        Some(&request.internal_key),
        request.level_order,
        &request.display_name,
        request.required_experience,
        request.color.as_deref(),
        &request.description,
    )
}

fn validate_growth_level_update(
    request: &UpdateGrowthLevelRequest,
) -> Result<(), (&'static str, &'static str)> {
    if request.expected_revision < 1 {
        return Err(("expected_revision", "期望版本必须是大于 0 的整数"));
    }
    validate_growth_level_fields(
        None,
        request.level_order,
        &request.display_name,
        request.required_experience,
        request.color.as_deref(),
        &request.description,
    )
}

fn validate_growth_level_fields(
    internal_key: Option<&str>,
    level_order: i32,
    display_name: &str,
    required_experience: i64,
    color: Option<&str>,
    description: &str,
) -> Result<(), (&'static str, &'static str)> {
    if internal_key.is_some_and(|value| {
        let bytes = value.as_bytes();
        !(3..=64).contains(&bytes.len())
            || bytes.first().is_none_or(|byte| !byte.is_ascii_lowercase())
            || !bytes
                .iter()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
    }) {
        return Err((
            "internal_key",
            "内部键必须是 3 到 64 位小写字母、数字或下划线且以字母开头",
        ));
    }
    if level_order < 1 {
        return Err(("level_order", "等级顺序必须是大于 0 的整数"));
    }
    if display_name != display_name.trim()
        || !(1..=80).contains(&display_name.chars().count())
        || display_name.chars().any(char::is_control)
    {
        return Err(("display_name", "展示名称必须是 1 到 80 个有效字符"));
    }
    if required_experience < 0 {
        return Err(("required_experience", "经验阈值不能为负数"));
    }
    if color.is_some_and(|value| {
        value.len() != 7
            || !value.starts_with('#')
            || !value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return Err(("color", "颜色必须是 #RRGGBB 格式或 null"));
    }
    if description.chars().count() > 500 || description.chars().any(char::is_control) {
        return Err(("description", "描述最多为 500 个有效字符"));
    }
    Ok(())
}

fn map_membership_medal_rule(record: MembershipMedalRuleRecord) -> Result<MembershipMedalRule, ()> {
    if !valid_medal_key(&record.medal_key) {
        return Err(());
    }
    Ok(MembershipMedalRule {
        key: record.medal_key.clone(),
        display_name: medal_display_name(&record.medal_key),
        enabled: record.enabled,
        required_lifetime_points: record.required_lifetime_points,
        updated_at: format_time(record.updated_at),
    })
}

fn map_membership_medal(record: MembershipMedalRecord) -> Result<MembershipMedal, ()> {
    let (filename, sha256) = crate::membership::medal_asset_metadata(&record.medal_key).ok_or(())?;
    Ok(MembershipMedal {
        key: record.medal_key.clone(),
        display_name: medal_display_name(&record.medal_key),
        asset_url: format!("/assets/membership/medals/{filename}"),
        sha256: sha256.to_owned(),
        granted_at: format_time(record.granted_at),
    })
}

fn validate_membership_medal_rule(
    medal_key: &str,
    request: &UpdateMembershipMedalRuleRequest,
) -> Result<(), (&'static str, &'static str)> {
    if !valid_medal_key(medal_key) {
        return Err(("medal_key", "勋章键必须是 medal_01 至 medal_17"));
    }
    if request.enabled && request.required_lifetime_points.is_none() {
        return Err(("required_lifetime_points", "启用规则必须配置非负积分阈值"));
    }
    if request
        .required_lifetime_points
        .is_some_and(|value| value < 0)
    {
        return Err(("required_lifetime_points", "积分阈值不能为负数"));
    }
    Ok(())
}

fn validate_membership_medal_grant(
    request: &GrantMembershipMedalRequest,
) -> Result<(), (&'static str, &'static str)> {
    if !valid_medal_key(&request.medal_key) {
        return Err(("medal_key", "勋章键必须是 medal_01 至 medal_17"));
    }
    if !(2..=64).contains(&request.reason.len())
        || request
            .reason
            .as_bytes()
            .first()
            .is_none_or(|byte| !byte.is_ascii_lowercase())
        || !request.reason.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
    {
        return Err((
            "reason",
            "理由必须是 2 到 64 位小写字母、数字、点、下划线或连字符",
        ));
    }
    Ok(())
}

fn valid_medal_key(value: &str) -> bool {
    let Some(number) = value.strip_prefix("medal_") else {
        return false;
    };
    matches!(number.parse::<u8>(), Ok(value) if (1..=17).contains(&value) && number == format!("{value:02}"))
}

fn medal_display_name(key: &str) -> String {
    key.strip_prefix("medal_")
        .map_or_else(|| "勋章".to_owned(), |number| format!("勋章 {number}"))
}

fn validate_membership_level_rule(
    level_key: &str,
    request: &UpdateMembershipLevelRuleRequest,
) -> Result<(), (&'static str, &'static str)> {
    let Some(level_number) = level_number(level_key) else {
        return Err(("level_key", "等级键必须是 lv_1 至 lv_20"));
    };
    if request
        .required_lifetime_points
        .is_some_and(|value| value < 0)
    {
        return Err(("required_lifetime_points", "累计积分阈值不能为负数"));
    }
    if request.display_name.as_deref().is_some_and(|value| {
        let value = value.trim();
        !value.is_empty() && (value.chars().count() > 80 || value.chars().any(char::is_control))
    }) {
        return Err((
            "display_name",
            "等级展示名称必须为 1 到 80 个字符且不能包含控制字符",
        ));
    }
    if level_number == 1
        && (request.enabled == Some(false)
            || request
                .required_lifetime_points
                .is_some_and(|value| value != 0))
    {
        return Err(("level_key", "lv_1 必须保持启用且阈值为 0"));
    }
    if level_number > 1
        && request.enabled == Some(true)
        && request.required_lifetime_points == Some(0)
    {
        return Err((
            "required_lifetime_points",
            "启用的 lv_2 至 lv_20 阈值必须大于 0",
        ));
    }
    Ok(())
}

fn validate_points_grant(
    request: &GrantMembershipPointsRequest,
) -> Result<(), (&'static str, &'static str)> {
    if !(1..=1_000_000).contains(&request.amount) {
        return Err(("amount", "授予积分必须在 1 到 1000000 之间"));
    }
    if !(2..=64).contains(&request.reason.len())
        || request
            .reason
            .as_bytes()
            .first()
            .is_none_or(|byte| !byte.is_ascii_lowercase())
        || !request.reason.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
    {
        return Err((
            "reason",
            "理由必须是 2 到 64 位小写字母、数字、点、下划线或连字符",
        ));
    }
    if let Some(key) = &request.idempotency_key
        && (!(1..=128).contains(&key.len())
            || !key.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-')
            }))
    {
        return Err(("idempotency_key", "幂等键必须是 1 到 128 位安全字符"));
    }
    Ok(())
}

fn map_points_grant_error(request_id: RequestId, error: AppendPointsLedgerError) -> ApiError {
    match error {
        AppendPointsLedgerError::Forbidden => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号已失去积分授予权限",
            request_id,
        ),
        AppendPointsLedgerError::AccountNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::USER_NOT_FOUND,
            "会员账号不存在",
            request_id,
        ),
        AppendPointsLedgerError::InvalidAmount
        | AppendPointsLedgerError::InvalidReason
        | AppendPointsLedgerError::InsufficientBalance
        | AppendPointsLedgerError::IdempotencyConflict => {
            validation_error(request_id, "request", "积分授予请求无效")
        }
        AppendPointsLedgerError::Database(error) => {
            database_error(request_id, error, "积分授予失败")
        }
    }
}

fn valid_level_key(value: &str) -> bool {
    level_number(value).is_some()
}

fn level_number(value: &str) -> Option<i16> {
    let number = value.strip_prefix("lv_")?.parse::<i16>().ok()?;
    (1..=20).contains(&number).then_some(number)
}

fn validate_url(
    value: Option<String>,
    field: &'static str,
    fields: &mut FieldErrors,
) -> Option<String> {
    let value = value.map(|item| item.trim().to_owned());
    if value.as_deref().is_some_and(|item| {
        item.len() > 2048 || !item.starts_with("https://") || item.chars().any(char::is_control)
    }) {
        add_field(fields, field, "URL 必须是 2048 字符以内的 HTTPS 地址");
    }
    value
}

fn validate_asset_url(
    value: Option<String>,
    field: &'static str,
    kind: &'static str,
    fields: &mut FieldErrors,
) -> Option<String> {
    let value = value.map(|item| item.trim().to_owned());
    let internal = format!("/api/v1/site-branding/assets/{kind}");
    if value.as_deref().is_some_and(|item| {
        item.len() > 2048
            || item.chars().any(char::is_control)
            || (!item.starts_with("https://") && item != internal)
    }) {
        add_field(
            fields,
            field,
            "品牌资产 URL 必须是 HTTPS 地址或服务端生成的同源地址",
        );
    }
    value
}

fn validate_brand_links(
    links: Vec<BrandLink>,
    field: &'static str,
    max_links: usize,
    fields: &mut FieldErrors,
) -> Vec<BrandLinkRecord> {
    if links.len() > max_links {
        add_field(fields, field, "品牌链接最多允许 8 项");
    }
    links
        .into_iter()
        .filter_map(|link| {
            let label = link.label.trim().to_owned();
            let url = link.url.trim().to_owned();
            let valid_label =
                (1..=40).contains(&label.chars().count()) && !label.chars().any(char::is_control);
            let valid_internal =
                (url.starts_with('/') && !url.starts_with("//")) || url.starts_with('#');
            let valid_url = !url.is_empty()
                && url.len() <= 2048
                && !url.contains('\\')
                && !url.chars().any(char::is_control)
                && (url.starts_with("https://") || valid_internal);
            if !valid_label || !valid_url {
                add_field(
                    fields,
                    field,
                    "链接名称必须为 1 到 40 个字符，地址必须为 HTTPS 或安全站内地址",
                );
                None
            } else {
                Some(BrandLinkRecord { label, url })
            }
        })
        .collect()
}

fn valid_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

fn valid_slug(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
}

fn theme_preset(value: BrandThemePreset) -> String {
    match value {
        BrandThemePreset::Default => "default",
        BrandThemePreset::Dark => "dark",
        BrandThemePreset::Compact => "compact",
        BrandThemePreset::HighContrast => "high_contrast",
    }
    .to_owned()
}

fn parse_theme_preset(value: &str) -> Option<BrandThemePreset> {
    Some(match value {
        "default" => BrandThemePreset::Default,
        "dark" => BrandThemePreset::Dark,
        "compact" => BrandThemePreset::Compact,
        "high_contrast" => BrandThemePreset::HighContrast,
        _ => return None,
    })
}

fn list_density(value: BrandListDensity) -> String {
    match value {
        BrandListDensity::Comfortable => "comfortable",
        BrandListDensity::Compact => "compact",
    }
    .to_owned()
}

fn parse_list_density(value: &str) -> Option<BrandListDensity> {
    Some(match value {
        "comfortable" => BrandListDensity::Comfortable,
        "compact" => BrandListDensity::Compact,
        _ => return None,
    })
}

fn home_mode(value: BrandHomeMode) -> String {
    match value {
        BrandHomeMode::Latest => "latest",
        BrandHomeMode::Hot => "hot",
        BrandHomeMode::Featured => "featured",
    }
    .to_owned()
}

fn parse_home_mode(value: &str) -> Option<BrandHomeMode> {
    Some(match value {
        "latest" => BrandHomeMode::Latest,
        "hot" => BrandHomeMode::Hot,
        "featured" => BrandHomeMode::Featured,
        _ => return None,
    })
}

fn visibility(value: AdminBoardVisibility) -> String {
    match value {
        AdminBoardVisibility::Public => "public",
        AdminBoardVisibility::Hidden => "hidden",
    }
    .to_owned()
}

fn board_tone(value: BoardTone) -> String {
    match value {
        BoardTone::Green => "green",
        BoardTone::Blue => "blue",
        BoardTone::Amber => "amber",
        BoardTone::Rose => "rose",
    }
    .to_owned()
}

fn parse_board_tone(value: &str) -> Option<BoardTone> {
    Some(match value {
        "green" => BoardTone::Green,
        "blue" => BoardTone::Blue,
        "amber" => BoardTone::Amber,
        "rose" => BoardTone::Rose,
        _ => return None,
    })
}

fn validate_audit_query(
    query: Result<Query<ListAuditQuery>, QueryRejection>,
) -> Result<ListAuditQuery, (&'static str, &'static str)> {
    let Query(query) = query.map_err(|_| ("query", "审计查询参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_AUDIT_LIMIT);
    if !(1..=MAX_AUDIT_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }
    let action = validate_audit_filter(query.action, 64, "action")?;
    let resource_type = validate_audit_filter(query.resource_type, 32, "resource_type")?;
    Ok(ListAuditQuery {
        actor_id: query.actor_id,
        action,
        resource_type,
        resource_id: query.resource_id,
        user_id: query.user_id,
        report_id: query.report_id,
        cursor: query.cursor,
        limit: Some(limit),
    })
}

fn validate_admin_users_query(
    query: Result<Query<ListAdminUsersQuery>, QueryRejection>,
) -> Result<ListAdminUsersQuery, (&'static str, &'static str)> {
    let Query(query) = query.map_err(|_| ("query", "用户查询参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_USER_LIMIT);
    if !(1..=MAX_USER_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }
    let q = query
        .q
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if q.as_ref()
        .is_some_and(|value| value.chars().count() > 80 || value.chars().any(char::is_control))
    {
        return Err(("q", "搜索词最多 80 个字符且不能包含控制字符"));
    }
    let registered_after = query.registered_after.map(|value| value.trim().to_owned());
    let registered_before = query.registered_before.map(|value| value.trim().to_owned());
    let after = registered_after
        .as_deref()
        .map(parse_admin_time)
        .transpose()
        .map_err(|_| ("registered_after", "registered_after 必须是 RFC 3339 时间"))?;
    let before = registered_before
        .as_deref()
        .map(parse_admin_time)
        .transpose()
        .map_err(|_| {
            (
                "registered_before",
                "registered_before 必须是 RFC 3339 时间",
            )
        })?;
    if matches!((after, before), (Some(after), Some(before)) if after >= before) {
        return Err((
            "registered_before",
            "registered_before 必须晚于 registered_after",
        ));
    }
    Ok(ListAdminUsersQuery {
        q,
        status: query.status,
        role_id: query.role_id,
        registered_after,
        registered_before,
        cursor: query.cursor,
        limit: Some(limit),
    })
}

fn validate_admin_user_items_query(
    query: Result<Query<ListAdminUserItemsQuery>, QueryRejection>,
) -> Result<ListAdminUserItemsQuery, (&'static str, &'static str)> {
    let Query(query) = query.map_err(|_| ("query", "用户子资源查询参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_USER_LIMIT);
    if !(1..=MAX_USER_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }
    Ok(ListAdminUserItemsQuery {
        cursor: query.cursor,
        limit: Some(limit),
    })
}

fn validate_admin_user_status_request(
    request: UpdateAdminUserStatusRequest,
) -> Result<ValidatedAdminUserStatusRequest, FieldErrors> {
    let mut fields = FieldErrors::new();
    let reason = request.reason.trim().to_owned();
    let reason_length = reason.chars().count();
    if request.status != AdminUserStatus::Active && !(2..=500).contains(&reason_length) {
        fields
            .entry("reason".to_owned())
            .or_default()
            .push("限制或暂停原因必须为 2 到 500 个字符".to_owned());
    }
    if reason.chars().any(char::is_control) {
        fields
            .entry("reason".to_owned())
            .or_default()
            .push("原因不能包含控制字符".to_owned());
    }
    let expires_at = request
        .expires_at
        .as_deref()
        .map(parse_admin_time)
        .transpose()
        .map_err(|_| {
            let mut errors = FieldErrors::new();
            errors
                .entry("expires_at".to_owned())
                .or_default()
                .push("到期时间必须是 RFC 3339 时间".to_owned());
            errors
        })?;
    if request.status == AdminUserStatus::Active && expires_at.is_some() {
        fields
            .entry("expires_at".to_owned())
            .or_default()
            .push("恢复正常状态不能设置到期时间".to_owned());
    }
    if request.status != AdminUserStatus::Active
        && expires_at.is_some_and(|value| value <= OffsetDateTime::now_utc())
    {
        fields
            .entry("expires_at".to_owned())
            .or_default()
            .push("到期时间必须晚于当前时间".to_owned());
    }
    let expected_revision = i64::try_from(request.expected_revision).unwrap_or(0);
    if expected_revision < 1 {
        fields
            .entry("expected_revision".to_owned())
            .or_default()
            .push("expected_revision 必须大于 0".to_owned());
    }
    if !fields.is_empty() {
        return Err(fields);
    }
    Ok(ValidatedAdminUserStatusRequest {
        status: request.status,
        reason,
        expires_at,
        expected_revision,
    })
}

fn parse_admin_time(value: &str) -> Result<OffsetDateTime, ()> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| ())
}

fn page_next_cursor<T, F>(records: &mut Vec<T>, limit: u16, id: F) -> Option<String>
where
    F: Fn(&T) -> Uuid,
{
    if records.len() > usize::from(limit) {
        records.truncate(usize::from(limit));
        records.last().map(|record| id(record).to_string())
    } else {
        None
    }
}

async fn ensure_admin_user_exists(
    database: &Database,
    user_id: Uuid,
    request_id: RequestId,
) -> Result<(), ApiError> {
    let exists = database
        .admin_user_exists(user_id)
        .await
        .map_err(|error| database_error(request_id, error, "用户查询失败"))?;
    if exists {
        Ok(())
    } else {
        Err(admin_user_not_found(request_id))
    }
}

fn admin_user_not_found(request_id: RequestId) -> ApiError {
    admin_error(
        StatusCode::NOT_FOUND,
        error_codes::ADMIN_USER_NOT_FOUND,
        "用户不存在或不可管理",
        request_id,
    )
}

fn admin_user_read_error(request_id: RequestId, error: AdminUserReadError) -> ApiError {
    match error {
        AdminUserReadError::InvalidCursor => {
            validation_error(request_id, "cursor", "cursor 不属于当前用户列表")
        }
        AdminUserReadError::Database(error) => {
            database_error(request_id, error, "用户管理数据查询失败")
        }
    }
}

fn admin_user_status_update_error(
    request_id: RequestId,
    error: UpdateAdminUserStatusError,
) -> ApiError {
    match error {
        UpdateAdminUserStatusError::Forbidden => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号没有执行此管理操作的权限",
            request_id,
        ),
        UpdateAdminUserStatusError::NotFound => admin_user_not_found(request_id),
        UpdateAdminUserStatusError::Conflict => admin_error(
            StatusCode::CONFLICT,
            error_codes::ADMIN_USER_STATUS_CONFLICT,
            "用户状态已被其他管理员更新，请刷新后重试",
            request_id,
        ),
        UpdateAdminUserStatusError::Invalid => admin_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::ADMIN_USER_STATUS_INVALID,
            "用户状态、原因或期限不符合要求",
            request_id,
        ),
        UpdateAdminUserStatusError::SelfSuspension => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_USER_SELF_SUSPENSION_FORBIDDEN,
            "不能暂停当前正在操作的账号",
            request_id,
        ),
        UpdateAdminUserStatusError::LastSuperAdmin => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_USER_LAST_SUPER_ADMIN_FORBIDDEN,
            "必须保留至少一个状态正常的超级管理员",
            request_id,
        ),
        UpdateAdminUserStatusError::Database(error) => {
            database_error(request_id, error, "用户状态更新失败")
        }
        UpdateAdminUserStatusError::Outbox(error) => database_error_response(
            request_id,
            match error {
                infrastructure::OutboxError::InvalidInput
                | infrastructure::OutboxError::IdempotencyConflict
                | infrastructure::OutboxError::Database(_) => "用户状态事件暂时无法写入",
            },
        ),
    }
}

fn validate_authorization_assignments_query(
    query: Result<Query<ListAuthorizationAssignmentsQuery>, QueryRejection>,
) -> Result<ListAuthorizationAssignmentsQuery, (&'static str, &'static str)> {
    let Query(query) = query.map_err(|_| ("query", "角色授权查询参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_ASSIGNMENT_LIMIT);
    if !(1..=MAX_ASSIGNMENT_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }
    let username = validate_audit_filter(query.username, 32, "username")?;
    Ok(ListAuthorizationAssignmentsQuery {
        username,
        role_id: query.role_id,
        scope_id: query.scope_id,
        cursor: query.cursor,
        limit: Some(limit),
    })
}

struct ValidatedGovernancePolicy {
    enabled: bool,
    alert_score_threshold: i16,
    reporter_window_minutes: i16,
    reporter_alert_limit: i16,
}

fn validate_governance_policy(
    request: UpdateGovernancePolicyRequest,
) -> Result<ValidatedGovernancePolicy, (&'static str, &'static str)> {
    if !(1..=100).contains(&request.alert_score_threshold) {
        return Err(("alert_score_threshold", "告警阈值必须在 1 到 100 之间"));
    }
    if !(1..=1440).contains(&request.reporter_window_minutes) {
        return Err((
            "reporter_window_minutes",
            "举报窗口必须在 1 到 1440 分钟之间",
        ));
    }
    if !(1..=100).contains(&request.reporter_alert_limit) {
        return Err(("reporter_alert_limit", "举报次数阈值必须在 1 到 100 之间"));
    }
    Ok(ValidatedGovernancePolicy {
        enabled: request.enabled,
        alert_score_threshold: i16::try_from(request.alert_score_threshold)
            .expect("threshold fits"),
        reporter_window_minutes: i16::try_from(request.reporter_window_minutes)
            .expect("window fits"),
        reporter_alert_limit: i16::try_from(request.reporter_alert_limit).expect("limit fits"),
    })
}

fn map_policy(record: GovernancePolicyRecord) -> GovernancePolicy {
    GovernancePolicy {
        enabled: record.enabled,
        alert_score_threshold: u16::try_from(record.alert_score_threshold)
            .expect("policy threshold is positive"),
        reporter_window_minutes: u16::try_from(record.reporter_window_minutes)
            .expect("policy window is positive"),
        reporter_alert_limit: u16::try_from(record.reporter_alert_limit)
            .expect("policy limit is positive"),
    }
}

fn validate_risk_alert_query(
    query: Result<Query<ListRiskAlertsQuery>, QueryRejection>,
) -> Result<ListRiskAlertsQuery, (&'static str, &'static str)> {
    let Query(query) = query.map_err(|_| ("query", "风险告警查询参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_ALERT_LIMIT);
    if !(1..=MAX_ALERT_LIMIT).contains(&limit) {
        return Err(("limit", "limit 必须在 1 到 50 之间"));
    }
    Ok(ListRiskAlertsQuery {
        status: query.status,
        cursor: query.cursor,
        limit: Some(limit),
    })
}

fn risk_alert_status(value: RiskAlertStatus) -> &'static str {
    match value {
        RiskAlertStatus::Open => "open",
        RiskAlertStatus::Acknowledged => "acknowledged",
        RiskAlertStatus::Dismissed => "dismissed",
    }
}

fn map_risk_alert(record: RiskAlertRecord) -> Result<RiskAlert, ()> {
    let acknowledged_by = match record.acknowledged_by_id {
        Some(id) => Some(UserSummary {
            id,
            username: record.acknowledged_by_username.ok_or(())?,
            display_name: record.acknowledged_by_display_name.ok_or(())?,
            avatar_url: record.acknowledged_by_avatar_url,
        }),
        None => None,
    };
    Ok(RiskAlert {
        id: record.id,
        kind: match record.kind.as_str() {
            "high_risk_report" => RiskAlertKind::HighRiskReport,
            "reporter_spike" => RiskAlertKind::ReporterSpike,
            _ => return Err(()),
        },
        severity: match record.severity.as_str() {
            "medium" => RiskAlertSeverity::Medium,
            "high" => RiskAlertSeverity::High,
            "critical" => RiskAlertSeverity::Critical,
            _ => return Err(()),
        },
        score: u16::try_from(record.score).map_err(|_| ())?,
        target_type: record.target_type,
        target_id: record.target_id,
        reporter_id: record.reporter_id,
        report_id: record.report_id,
        status: match record.status.as_str() {
            "open" => RiskAlertStatus::Open,
            "acknowledged" => RiskAlertStatus::Acknowledged,
            "dismissed" => RiskAlertStatus::Dismissed,
            _ => return Err(()),
        },
        details: record.details.0,
        acknowledged_by,
        created_at: format_time(record.created_at),
        acknowledged_at: record.acknowledged_at.map(format_time),
    })
}

fn validate_audit_filter(
    value: Option<String>,
    max_chars: usize,
    field: &'static str,
) -> Result<Option<String>, (&'static str, &'static str)> {
    let value = value.map(|item| item.trim().to_owned());
    if value.as_deref().is_some_and(|item| {
        item.is_empty() || item.chars().count() > max_chars || item.chars().any(char::is_control)
    }) {
        return Err((field, "过滤条件长度无效或包含控制字符"));
    }
    Ok(value)
}

fn map_audit(record: AdminAuditRecord) -> Result<AdminAuditEntry, ()> {
    Ok(AdminAuditEntry {
        id: record.id,
        actor: UserSummary {
            id: record.actor_id,
            username: record.actor_username,
            display_name: record.actor_display_name,
            avatar_url: record.actor_avatar_url,
        },
        action: record.action,
        resource_type: record.resource_type,
        resource_id: record.resource_id,
        summary: record.summary.0,
        created_at: format_time(record.created_at),
    })
}

fn format_time(value: OffsetDateTime) -> String {
    value.format(&Rfc3339).expect("audit timestamp must format")
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

fn path_invalid(request_id: RequestId) -> ApiError {
    admin_error(
        StatusCode::UNPROCESSABLE_ENTITY,
        error_codes::PATH_INVALID,
        "路径参数格式不正确",
        request_id,
    )
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

fn authorization_role_error(
    request_id: RequestId,
    error: MutateAuthorizationRoleError,
) -> ApiError {
    match error {
        MutateAuthorizationRoleError::Forbidden => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号没有管理角色的权限",
            request_id,
        ),
        MutateAuthorizationRoleError::NotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::AUTHORIZATION_ROLE_NOT_FOUND,
            "角色不存在",
            request_id,
        ),
        MutateAuthorizationRoleError::Conflict => admin_error(
            StatusCode::CONFLICT,
            error_codes::AUTHORIZATION_ROLE_CONFLICT,
            "角色键已存在或角色版本已变化",
            request_id,
        ),
        MutateAuthorizationRoleError::SystemManaged => admin_error(
            StatusCode::CONFLICT,
            error_codes::AUTHORIZATION_ROLE_SYSTEM_MANAGED,
            "系统角色不能通过管理接口修改",
            request_id,
        ),
        MutateAuthorizationRoleError::InUse => admin_error(
            StatusCode::CONFLICT,
            error_codes::AUTHORIZATION_ROLE_IN_USE,
            "仍有用户授权的角色不能删除",
            request_id,
        ),
        MutateAuthorizationRoleError::PermissionInvalid => admin_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::AUTHORIZATION_PERMISSION_INVALID,
            "权限不存在、重复或超出当前账号的授权范围",
            request_id,
        ),
        MutateAuthorizationRoleError::Database(error) => {
            database_error(request_id, error, "角色写入失败")
        }
    }
}

fn authorization_assignment_error(
    request_id: RequestId,
    error: MutateAuthorizationAssignmentError,
) -> ApiError {
    match error {
        MutateAuthorizationAssignmentError::Forbidden => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号没有管理用户授权的权限",
            request_id,
        ),
        MutateAuthorizationAssignmentError::UserNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::AUTHORIZATION_USER_NOT_FOUND,
            "用户不存在或不可授权",
            request_id,
        ),
        MutateAuthorizationAssignmentError::RoleNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::AUTHORIZATION_ROLE_NOT_FOUND,
            "角色不存在",
            request_id,
        ),
        MutateAuthorizationAssignmentError::AssignmentNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::AUTHORIZATION_ASSIGNMENT_NOT_FOUND,
            "角色授权不存在",
            request_id,
        ),
        MutateAuthorizationAssignmentError::Conflict => admin_error(
            StatusCode::CONFLICT,
            error_codes::AUTHORIZATION_ASSIGNMENT_CONFLICT,
            "用户已拥有相同作用域的角色授权",
            request_id,
        ),
        MutateAuthorizationAssignmentError::SystemManaged => admin_error(
            StatusCode::CONFLICT,
            error_codes::AUTHORIZATION_ROLE_SYSTEM_MANAGED,
            "系统角色授权不能通过管理接口修改",
            request_id,
        ),
        MutateAuthorizationAssignmentError::ScopeInvalid => admin_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::AUTHORIZATION_SCOPE_INVALID,
            "角色与资源作用域不匹配",
            request_id,
        ),
        MutateAuthorizationAssignmentError::PermissionInvalid => admin_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::AUTHORIZATION_PERMISSION_INVALID,
            "角色权限超出当前账号的授权范围",
            request_id,
        ),
        MutateAuthorizationAssignmentError::Database(error) => {
            database_error(request_id, error, "角色授权写入失败")
        }
    }
}

fn admin_mutation_error(
    request_id: RequestId,
    error: AdminConfigError,
    message: &'static str,
) -> ApiError {
    match error {
        AdminConfigError::NotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::ADMIN_BOARD_NOT_FOUND,
            "板块不存在",
            request_id,
        ),
        AdminConfigError::Conflict => admin_error(
            StatusCode::CONFLICT,
            error_codes::ADMIN_BOARD_CONFLICT,
            message,
            request_id,
        ),
        AdminConfigError::RevisionConflict => admin_error(
            StatusCode::CONFLICT,
            error_codes::ADMIN_BOARD_CONFLICT,
            "版块已被其他管理员修改，请刷新后重试",
            request_id,
        ),
        AdminConfigError::ParentInvalid => admin_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::ADMIN_BOARD_PARENT_INVALID,
            "父版块无效，请选择其他版块",
            request_id,
        ),
        AdminConfigError::DepthExceeded => admin_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::ADMIN_BOARD_DEPTH_EXCEEDED,
            "版块最多支持三级，请选择更高层级的父版块",
            request_id,
        ),
        AdminConfigError::HasChildren => admin_error(
            StatusCode::CONFLICT,
            error_codes::ADMIN_BOARD_HAS_CHILDREN,
            "该版块仍有子版块，请先移动或删除子版块",
            request_id,
        ),
        AdminConfigError::Outbox(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "{message}");
            admin_error(
                StatusCode::SERVICE_UNAVAILABLE,
                error_codes::DATABASE_UNAVAILABLE,
                "管理配置暂时不可用",
                request_id,
            )
        }
        AdminConfigError::Database(error) => database_error(request_id, error, message),
    }
}

fn brand_asset_invalid(request_id: RequestId) -> ApiError {
    admin_error(
        StatusCode::UNPROCESSABLE_ENTITY,
        error_codes::BRANDING_ASSET_INVALID,
        "品牌资产内容或类型无效",
        request_id,
    )
}

fn brand_asset_error(request_id: RequestId, error: BrandAssetError) -> ApiError {
    match error {
        BrandAssetError::Invalid => brand_asset_invalid(request_id),
        BrandAssetError::NotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::BRANDING_ASSET_NOT_FOUND,
            "品牌资产不存在",
            request_id,
        ),
        BrandAssetError::Storage(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Brand asset storage failed");
            database_error_response(request_id, "品牌资产服务暂时不可用")
        }
        BrandAssetError::Outbox(error) => {
            tracing::warn!(request_id = %request_id, error = ?error, "Brand asset outbox failed");
            database_error_response(request_id, "品牌资产服务暂时不可用")
        }
        BrandAssetError::Database(error) => {
            database_error(request_id, error, "Brand asset database operation failed")
        }
    }
}

fn database_error_response(request_id: RequestId, message: &'static str) -> ApiError {
    admin_error(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::DATABASE_UNAVAILABLE,
        message,
        request_id,
    )
}

fn database_error(
    request_id: RequestId,
    error: infrastructure::DatabaseError,
    context: &'static str,
) -> ApiError {
    tracing::warn!(request_id = %request_id, error = %error, "{context}");
    admin_error(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::DATABASE_UNAVAILABLE,
        "管理配置暂时不可用",
        request_id,
    )
}

fn growth_level_error(request_id: RequestId, error: MutateGrowthLevelError) -> ApiError {
    match error {
        MutateGrowthLevelError::Forbidden => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号已失去动态等级写入权限",
            request_id,
        ),
        MutateGrowthLevelError::NotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::MEMBERSHIP_LEVEL_NOT_FOUND,
            "动态等级不存在",
            request_id,
        ),
        MutateGrowthLevelError::Conflict => admin_error(
            StatusCode::CONFLICT,
            error_codes::MEMBERSHIP_LEVEL_REVISION_CONFLICT,
            "动态等级已被其他请求更新，请刷新后重试",
            request_id,
        ),
        MutateGrowthLevelError::Duplicate => admin_error(
            StatusCode::CONFLICT,
            error_codes::MEMBERSHIP_LEVEL_CONFLICT,
            "内部键或等级顺序已经存在",
            request_id,
        ),
        MutateGrowthLevelError::InvalidInput => {
            validation_error(request_id, "body", "动态等级参数不正确")
        }
        MutateGrowthLevelError::InvalidTransition => {
            validation_error(request_id, "status", "动态等级状态流转不正确")
        }
        MutateGrowthLevelError::InvalidThresholdOrder => validation_error(
            request_id,
            "required_experience",
            "已发布等级必须从 0 开始且经验阈值随等级顺序严格递增",
        ),
        MutateGrowthLevelError::Database(error) => {
            database_error(request_id, error, "动态等级保存失败")
        }
    }
}

fn community_group_error(request_id: RequestId, error: CommunityGroupMutationError) -> ApiError {
    match error {
        CommunityGroupMutationError::Forbidden => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号已失去社区用户组写入权限",
            request_id,
        ),
        CommunityGroupMutationError::NotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::COMMUNITY_GROUP_NOT_FOUND,
            "社区用户组不存在",
            request_id,
        ),
        CommunityGroupMutationError::Conflict | CommunityGroupMutationError::Duplicate => {
            admin_error(
                StatusCode::CONFLICT,
                error_codes::COMMUNITY_GROUP_CONFLICT,
                "社区用户组键或排序已存在",
                request_id,
            )
        }
        CommunityGroupMutationError::InvalidInput => {
            validation_error(request_id, "body", "社区用户组参数不正确")
        }
        CommunityGroupMutationError::InvalidTransition => {
            validation_error(request_id, "status", "社区用户组状态流转不正确")
        }
        CommunityGroupMutationError::SystemManaged => admin_error(
            StatusCode::CONFLICT,
            error_codes::COMMUNITY_GROUP_CONFLICT,
            "系统管理的社区用户组不能执行此操作",
            request_id,
        ),
        CommunityGroupMutationError::Database(error) => {
            database_error(request_id, error, "社区用户组保存失败")
        }
    }
}

fn community_membership_error(
    request_id: RequestId,
    error: CommunityMembershipMutationError,
) -> ApiError {
    match error {
        CommunityMembershipMutationError::Forbidden => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号已失去社区成员关系写入权限",
            request_id,
        ),
        CommunityMembershipMutationError::UserNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::USER_NOT_FOUND,
            "目标用户不存在",
            request_id,
        ),
        CommunityMembershipMutationError::GroupNotFound
        | CommunityMembershipMutationError::MembershipNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::COMMUNITY_MEMBERSHIP_NOT_FOUND,
            "社区用户组或成员关系不存在",
            request_id,
        ),
        CommunityMembershipMutationError::RevisionConflict => admin_error(
            StatusCode::CONFLICT,
            error_codes::COMMUNITY_MEMBERSHIP_REVISION_CONFLICT,
            "成员关系已被其他请求更新，请刷新后重试",
            request_id,
        ),
        CommunityMembershipMutationError::ActiveMembershipConflict
        | CommunityMembershipMutationError::IdempotencyConflict
        | CommunityMembershipMutationError::AlreadyRevoked => admin_error(
            StatusCode::CONFLICT,
            error_codes::COMMUNITY_MEMBERSHIP_CONFLICT,
            "成员关系与现有状态冲突",
            request_id,
        ),
        CommunityMembershipMutationError::GroupUnavailable
        | CommunityMembershipMutationError::KindMismatch
        | CommunityMembershipMutationError::InvalidInput => {
            validation_error(request_id, "body", "社区成员关系参数不正确")
        }
        CommunityMembershipMutationError::Database(error) => {
            database_error(request_id, error, "社区成员关系保存失败")
        }
    }
}

fn standard_entitlement_error(
    request_id: RequestId,
    error: StandardEntitlementMutationError,
) -> ApiError {
    match error {
        StandardEntitlementMutationError::Forbidden => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号已失去标准权益写入权限",
            request_id,
        ),
        StandardEntitlementMutationError::TypeNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::ENTITLEMENT_TYPE_NOT_FOUND,
            "标准权益类型不存在或不可发放",
            request_id,
        ),
        StandardEntitlementMutationError::EntitlementNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::ENTITLEMENT_NOT_FOUND,
            "用户标准权益不存在",
            request_id,
        ),
        StandardEntitlementMutationError::UserNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::USER_NOT_FOUND,
            "目标用户或操作人不存在",
            request_id,
        ),
        StandardEntitlementMutationError::RevisionConflict
        | StandardEntitlementMutationError::IdempotencyConflict => admin_error(
            StatusCode::CONFLICT,
            error_codes::ENTITLEMENT_CONFLICT,
            "标准权益已更新或幂等请求与原请求不一致",
            request_id,
        ),
        StandardEntitlementMutationError::InvalidBenefits => validation_error(
            request_id,
            "benefits",
            "标准权益只能包含普通社区权限和允许的配额",
        ),
        StandardEntitlementMutationError::InvalidInput => {
            validation_error(request_id, "body", "标准权益参数不正确")
        }
        StandardEntitlementMutationError::Database(error) => {
            database_error(request_id, error, "标准权益保存失败")
        }
        StandardEntitlementMutationError::Outbox(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "Standard entitlement outbox failed");
            database_error_response(request_id, "标准权益服务暂时不可用")
        }
    }
}

fn content_access_policy_error(
    request_id: RequestId,
    error: ContentAccessPolicyMutationError,
) -> ApiError {
    match error {
        ContentAccessPolicyMutationError::Forbidden => admin_error(
            StatusCode::FORBIDDEN,
            error_codes::ADMIN_FORBIDDEN,
            "当前账号已失去内容访问策略写入权限",
            request_id,
        ),
        ContentAccessPolicyMutationError::TargetNotFound => admin_error(
            StatusCode::NOT_FOUND,
            error_codes::CONTENT_ACCESS_POLICY_NOT_FOUND,
            "内容访问策略目标不存在",
            request_id,
        ),
        ContentAccessPolicyMutationError::RevisionConflict => admin_error(
            StatusCode::CONFLICT,
            error_codes::CONTENT_ACCESS_POLICY_REVISION_CONFLICT,
            "内容访问策略已被其他请求更新，请刷新后重试",
            request_id,
        ),
        ContentAccessPolicyMutationError::SubjectUnavailable => admin_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            error_codes::CONTENT_ACCESS_POLICY_SUBJECT_INVALID,
            "内容访问策略主体不存在或不可用于访问控制",
            request_id,
        ),
        ContentAccessPolicyMutationError::InvalidInput => {
            validation_error(request_id, "body", "内容访问策略参数不正确")
        }
        ContentAccessPolicyMutationError::Database(error) => {
            database_error(request_id, error, "内容访问策略保存失败")
        }
    }
}

fn invalid_record(request_id: RequestId) -> ApiError {
    admin_error(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::DATABASE_UNAVAILABLE,
        "管理配置暂时不可用",
        request_id,
    )
}

fn admin_error(
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
