#![forbid(unsafe_code)]

mod admin;
mod attachments;
mod auth;
mod boards;
mod cache;
mod governance;
mod health;
mod installation;
mod membership;
mod messages;
mod mfa;
mod notifications;
mod observability;
mod oidc;
mod operations;
mod operations_worker;
mod plugins;
mod rejection;
mod relations;
mod restriction_worker;
mod topics;
mod users;
mod worker;

use api_contract::RequestId;
use axum::{
    Json, Router,
    extract::Request,
    http::{HeaderValue, header::HeaderName},
    middleware::{self, Next},
    response::Response,
    routing::get,
};
use infrastructure::Database;
use utoipa::OpenApi;
use uuid::Uuid;

pub use auth::AuthConfig;
pub use cache::{
    CacheConfig, CacheConfigError, CacheError, CacheRuntime, SiteBrandingCacheInvalidationHandler,
};
pub use mfa::{
    MfaConfigError, MfaRuntime, build_totp, generate_recovery_codes, generate_totp_setup,
    hash_recovery_code, verify_recovery_code, verify_totp,
};
pub use observability::{
    ObservabilityConfig, ObservabilityConfigError, ObservabilityRuntime, ObservabilityRuntimeError,
    ObservabilitySnapshot, ObservabilityWindowSnapshot,
};
pub use oidc::OidcProviderConfig;
pub use operations_worker::{
    OperationsAlertWorker, OperationsAlertWorkerConfig, OperationsAlertWorkerConfigError,
    OperationsAlertWorkerRun,
};
pub use plugin_host::PluginHostConfig;
pub use plugins::PluginRuntime;
pub use restriction_worker::{
    UserRestrictionWorker, UserRestrictionWorkerConfig, UserRestrictionWorkerConfigError,
};
pub use worker::{
    HandlerFuture, OutboxHandler, OutboxHandlerError, OutboxWorker, OutboxWorkerConfig,
    OutboxWorkerConfigError, OutboxWorkerRun,
};

const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
const CONTENT_TYPE_OPTIONS_HEADER: HeaderName = HeaderName::from_static("x-content-type-options");
const FRAME_OPTIONS_HEADER: HeaderName = HeaderName::from_static("x-frame-options");
const REFERRER_POLICY_HEADER: HeaderName = HeaderName::from_static("referrer-policy");
const CONTENT_SECURITY_POLICY_HEADER: HeaderName =
    HeaderName::from_static("content-security-policy");
const PERMISSIONS_POLICY_HEADER: HeaderName = HeaderName::from_static("permissions-policy");
const STRICT_TRANSPORT_SECURITY_HEADER: HeaderName =
    HeaderName::from_static("strict-transport-security");

// Source: https://docs.rs/utoipa/5.5.0/utoipa/derive.OpenApi.html
#[derive(OpenApi)]
#[openapi(
    paths(
        admin::get_public_branding,
        admin::get_public_brand_asset,
        admin::upload_brand_asset,
        admin::delete_brand_asset,
        admin::get_admin_access,
        admin::list_admin_users,
        admin::get_admin_user,
        admin::update_admin_user_status,
        admin::list_admin_user_content,
        admin::list_admin_user_reports,
        admin::get_admin_branding,
        admin::list_audit,
        admin::list_audit_alerts,
        admin::list_authorization_permissions,
        admin::list_authorization_roles,
        admin::list_authorization_assignments,
        admin::create_authorization_role,
        admin::update_authorization_role,
        admin::delete_authorization_role,
        admin::create_authorization_assignment,
        admin::delete_authorization_assignment,
        admin::list_membership_level_rules,
        admin::update_membership_level_rule,
        admin::grant_membership_points,
        admin::list_membership_medal_rules,
        admin::update_membership_medal_rule,
        admin::grant_membership_medal,
        admin::get_governance_policy,
        admin::update_governance_policy,
        admin::list_risk_alerts,
        admin::update_risk_alert,
        admin::cleanup_attachments,
        operations::summary,
        operations::list_alert_rules,
        operations::update_alert_rule,
        operations::list_alerts,
        operations::acknowledge_alert,
        plugins::list_plugins,
        plugins::install_plugin,
        plugins::update_plugin,
        plugins::delete_plugin,
        plugins::invoke_plugin,
        admin::update_branding,
        admin::list_admin_boards,
        admin::create_board,
        admin::update_board,
        admin::delete_board,
        admin::get_board_deletion_impact,
        attachments::list,
        attachments::upload,
        attachments::download,
        governance::create_report,
        governance::list_reports,
        governance::get_report,
        governance::moderate_report,
        governance::update_report,
        governance::batch_update_reports,
        boards::list,
        auth::register,
        auth::login,
        mfa::status,
        mfa::verify_challenge,
        mfa::setup_totp,
        mfa::enable_totp,
        mfa::disable,
        mfa::regenerate_recovery_codes,
        auth::recent_authenticate,
        auth::passkey_registration_options,
        auth::passkey_registration_verify,
        auth::passkey_assertion_options,
        auth::passkey_assertion_verify,
        auth::list_passkeys,
        auth::delete_passkey,
        auth::list_oidc_providers,
        auth::get_oidc_claim,
        auth::create_oidc_claim_account,
        auth::bind_oidc_claim,
        auth::list_external_identities,
        auth::start_oidc_identity_binding,
        auth::start_oidc_identity_replacement,
        auth::start_oidc_authorization,
        auth::complete_oidc_authorization,
        auth::change_password,
        auth::current_session,
        auth::logout,
        auth::list_device_sessions,
        auth::revoke_device_session,
        auth::unlink_external_identity,
        health::live,
        health::ready,
        topics::list,
        topics::list_tags,
        topics::detail,
        topics::create,
        topics::update,
        topics::delete_topic,
        topics::moderate,
        topics::revisions,
        topics::list_replies,
        topics::create_reply,
        topics::update_reply,
        topics::reply_revisions,
        topics::delete_reply,
        relations::bookmark_topic,
        relations::unbookmark_topic,
        relations::like_post,
        relations::unlike_post,
        relations::bookmarks,
        messages::create_conversation,
        messages::list_conversations,
        messages::list_messages,
        messages::send_message,
        messages::mark_read,
        messages::archive_conversation,
        membership::catalog,
        notifications::list,
        notifications::unread_count,
        notifications::read_one,
        notifications::read_all,
        users::profile,
        users::membership,
        users::user_medals,
        users::followers,
        users::following,
        users::update_profile,
        users::follow_user,
        users::unfollow_user,
        users::block_user,
        users::unblock_user,
        installation::status,
        installation::initialize
    ),
    components(schemas(
        api_contract::ApiResponse<api_contract::HealthData>,
        api_contract::ApiResponse<api_contract::AuthenticatedSession>,
        api_contract::ApiResponse<api_contract::PasskeyRegistrationOptionsData>,
        api_contract::ApiResponse<api_contract::PasskeyAssertionOptionsData>,
        api_contract::ApiResponse<api_contract::PasskeyRegistrationData>,
        api_contract::PasskeyRegistrationVerifyRequest,
        api_contract::PasskeyAssertionVerifyRequest,
        api_contract::ApiResponse<Vec<api_contract::PasskeyCredentialSummary>>,
        api_contract::ApiResponse<api_contract::PasskeyDeleteData>,
        api_contract::ApiResponse<Vec<api_contract::ExternalIdentity>>,
        api_contract::ApiResponse<api_contract::OidcAuthorizationStartData>,
        api_contract::ApiResponse<api_contract::OidcClaimData>,
        api_contract::ApiResponse<api_contract::OidcClaimBindData>,
        api_contract::ApiResponse<api_contract::InstallationStatus>,
        api_contract::ApiResponse<api_contract::InstallationInitialization>,
        api_contract::BoardSummary,
        api_contract::BoardTone,
        api_contract::AdminBoard,
        api_contract::AdminBoardDeletionImpact,
        api_contract::AdminAuditEntry,
        api_contract::AdminCapabilityAccess,
        api_contract::AdminUserStatus,
        api_contract::AdminUserSummary,
        api_contract::AdminUserDetail,
        api_contract::AdminUserContentKind,
        api_contract::AdminUserContentItem,
        api_contract::PageResponse<api_contract::AdminUserSummary>,
        api_contract::PageResponse<api_contract::AdminUserContentItem>,
        api_contract::AuthorizationPermission,
        api_contract::AuthorizationRoleScope,
        api_contract::AuthorizationRole,
        api_contract::AuthorizationAssignedRole,
        api_contract::AuthorizationRoleAssignment,
        api_contract::CreateAuthorizationRoleRequest,
        api_contract::UpdateAuthorizationRoleRequest,
        api_contract::CreateAuthorizationAssignmentRequest,
        api_contract::GovernancePolicy,
        api_contract::UpdateGovernancePolicyRequest,
        api_contract::RiskAlert,
        api_contract::UpdateRiskAlertRequest,
        api_contract::RiskAlertKind,
        api_contract::RiskAlertSeverity,
        api_contract::RiskAlertStatus,
        api_contract::OperationsSummary,
        api_contract::OperationsHttpSummary,
        api_contract::OperationsDatabaseSummary,
        api_contract::OperationsOutboxSummary,
        api_contract::OperationsAlertCounts,
        api_contract::OperationsAlertRule,
        api_contract::OperationsAlertRuleKind,
        api_contract::OperationsAlertRuleReference,
        api_contract::OperationsAlert,
        api_contract::OperationsAlertStatus,
        api_contract::UpdateOperationsAlertRuleRequest,
        api_contract::UpdateOperationsAlertRequest,
        api_contract::Plugin,
        api_contract::PluginCapability,
        api_contract::PluginStatus,
        api_contract::PluginOperation,
        api_contract::PluginManifestRequest,
        api_contract::InstallPluginRequest,
        api_contract::UpdatePluginRequest,
        api_contract::InvokePluginRequest,
        api_contract::PluginInvocation,
        api_contract::PluginUiSchema,
        api_contract::PluginUiBlock,
        api_contract::PluginUiTone,
        api_contract::AdminBoardVisibility,
        api_contract::BrandHomeMode,
        api_contract::BrandLink,
        api_contract::BrandListDensity,
        api_contract::BrandThemePreset,
        api_contract::SiteBranding,
        api_contract::CreateAdminBoardRequest,
        api_contract::UpdateAdminBoardRequest,
        api_contract::UpdateSiteBrandingRequest,
        api_contract::HealthData,
        api_contract::HealthStatus,
        api_contract::InstallationStatus,
        api_contract::AuthenticatedSession,
        api_contract::AuthenticatedUser,
        api_contract::LoginRequest,
        api_contract::MfaStatus,
        api_contract::MfaSetupData,
        api_contract::MfaCodeRequest,
        api_contract::MfaEnableData,
        api_contract::MfaDisableData,
        api_contract::MfaRecoveryCodesData,
        api_contract::MfaChallengeData,
        api_contract::MfaVerifyRequest,
        api_contract::RecentAuthData,
        api_contract::RecentAuthRequest,
        api_contract::PasskeyRegistrationOptionsData,
        api_contract::PasskeyRegistrationOptions,
        api_contract::PasskeyAssertionOptionsData,
        api_contract::PasskeyAssertionOptions,
        api_contract::PasskeyCredentialParameter,
        api_contract::PasskeyRp,
        api_contract::PasskeyUser,
        api_contract::PasskeyCredentialDescriptor,
        api_contract::PasskeyAuthenticatorSelection,
        api_contract::PasskeyCredentialSummary,
        api_contract::PasskeyDeleteData,
        api_contract::OidcProvider,
        api_contract::ExternalIdentity,
        api_contract::OidcAuthorizationStartData,
        api_contract::OidcClaimData,
        api_contract::OidcClaimAccountRequest,
        api_contract::OidcClaimBindData,
        api_contract::ChangePasswordData,
        api_contract::ChangePasswordRequest,
        api_contract::UnlinkExternalIdentityData,
        api_contract::LogoutData,
        api_contract::RegisterRequest,
        api_contract::InitialAdministrator,
        api_contract::InitializeInstallationRequest,
        api_contract::InstallationInitialization,
        api_contract::ErrorBody,
        api_contract::ErrorCode,
        api_contract::ErrorResponse,
        api_contract::PageMeta,
        api_contract::PageResponse<api_contract::BoardSummary>,
        api_contract::PageResponse<api_contract::TopicSummary>,
        api_contract::PageResponse<api_contract::TopicReply>,
        api_contract::PageResponse<api_contract::UserSummary>,
        api_contract::PageResponse<api_contract::ConversationSummary>,
        api_contract::PageResponse<api_contract::DirectMessage>,
        api_contract::PageResponse<api_contract::Notification>,
        api_contract::ApiResponse<api_contract::Notification>,
        api_contract::ApiResponse<api_contract::NotificationUnreadCount>,
        api_contract::ApiResponse<api_contract::MembershipCatalog>,
        api_contract::ApiResponse<api_contract::MembershipAccount>,
        api_contract::ApiResponse<Vec<api_contract::MembershipLevelRule>>,
        api_contract::ApiResponse<api_contract::MembershipPointsGrant>,
        api_contract::ApiResponse<Vec<api_contract::MembershipMedal>>,
        api_contract::ApiResponse<Vec<api_contract::MembershipMedalRule>>,
        api_contract::ApiResponse<api_contract::MembershipMedalGrant>,
        api_contract::ApiResponse<api_contract::TopicDetail>,
        api_contract::ApiResponse<api_contract::TopicModerationResult>,
        api_contract::ApiResponse<api_contract::ContentReportReceipt>,
        api_contract::ApiResponse<api_contract::ContentReportDetail>,
        api_contract::ApiResponse<api_contract::ReportModerationResult>,
        api_contract::ApiResponse<api_contract::BatchReportResult>,
        api_contract::TopicAttachment,
        api_contract::AttachmentScanStatus,
        api_contract::AttachmentCleanupResult,
        api_contract::AttachmentStatus,
        api_contract::ApiResponse<api_contract::TopicReply>,
        api_contract::ApiResponse<Vec<api_contract::TopicTag>>,
        api_contract::CreateTopicRequest,
        api_contract::CreateReplyRequest,
        api_contract::UpdateReplyRequest,
        api_contract::ReplyRevision,
        api_contract::UpdateTopicRequest,
        api_contract::ModerateTopicRequest,
        api_contract::TopicModerationResult,
        api_contract::TopicModerationStatus,
        api_contract::TopicAuthorSummary,
        api_contract::TopicBoardSummary,
        api_contract::TopicDetail,
        api_contract::TopicReply,
        api_contract::TopicRevision,
        api_contract::TopicTag,
        api_contract::TopicTagInput,
        api_contract::TopicScope,
        api_contract::TopicSort,
        api_contract::ContentReport,
        api_contract::ContentReportDetail,
        api_contract::ReportContentContext,
        api_contract::ReportContextItem,
        api_contract::ReportAuthorContext,
        api_contract::ReportHistoryItem,
        api_contract::ReportHandlingRecord,
        api_contract::CreateReportModerationRequest,
        api_contract::ReportDisposition,
        api_contract::ReportContentAction,
        api_contract::ReportUserAction,
        api_contract::ReportUserActionKind,
        api_contract::ReportModerationResult,
        api_contract::ReportModerationContentResult,
        api_contract::ReportModerationUserResult,
        api_contract::CreateReportRequest,
        api_contract::UpdateReportRequest,
        api_contract::BatchUpdateReportsRequest,
        api_contract::BatchReportResult,
        api_contract::ReportReason,
        api_contract::ReportResolution,
        api_contract::ReportStatus,
        api_contract::ReportTargetType,
        api_contract::TopicSummary,
        api_contract::UserSummary,
        api_contract::UserProfileViewer,
        api_contract::UserProfile,
        api_contract::AdminUserStatus,
        api_contract::AdminUserSummary,
        api_contract::AdminUserDetail,
        api_contract::AdminUserContentKind,
        api_contract::AdminUserContentItem,
        api_contract::UpdateAdminUserStatusRequest,
        api_contract::AdminUserStatusUpdate,
        api_contract::UpdateUserProfileRequest,
        api_contract::FollowState,
        api_contract::BlockState,
        api_contract::BookmarkState,
        api_contract::PostLikeState,
        api_contract::ConversationLastMessage,
        api_contract::ConversationSummary,
        api_contract::DirectMessage,
        api_contract::ConversationReadState,
        api_contract::MembershipCatalog,
        api_contract::MembershipGroup,
        api_contract::MembershipLevel,
        api_contract::Medal,
        api_contract::MembershipAccount,
        api_contract::MembershipLevelRule,
        api_contract::UpdateMembershipLevelRuleRequest,
        api_contract::GrantMembershipPointsRequest,
        api_contract::MembershipPointsGrant,
        api_contract::MembershipMedal,
        api_contract::MembershipMedalRule,
        api_contract::MembershipMedalGrant,
        api_contract::UpdateMembershipMedalRuleRequest,
        api_contract::GrantMembershipMedalRequest,
        api_contract::CreateConversationRequest,
        api_contract::SendDirectMessageRequest,
        api_contract::MarkConversationReadRequest,
        api_contract::RequestId,
        api_contract::ResponseMeta
    )),
    tags(
        (name = "boards", description = "Public community boards"),
        (name = "admin", description = "Super administrator configuration"),
        (name = "governance", description = "Content reports and moderation actions"),
        (name = "branding", description = "Public site branding"),
        (name = "auth", description = "Registration and server-side sessions"),
        (name = "health", description = "Process health and dependency readiness"),
        (name = "installation", description = "Initial instance setup state"),
        (name = "topics", description = "Public community topics"),
        (name = "relations", description = "Bookmarks and post likes"),
        (name = "messages", description = "Private two-party direct messages"),
        (name = "notifications", description = "User notifications and read state"),
        (name = "membership", description = "Membership, level and medal resources"),
        (name = "users", description = "Public user profiles and relationships")
        ,(name = "plugins", description = "Validated WebAssembly Component plugins")
    )
)]
struct ApiDoc;

pub fn app(database: Database) -> Router {
    app_with_config(database, AuthConfig::default())
}

pub fn app_with_observability(
    database: Database,
    observability_runtime: ObservabilityRuntime,
) -> Router {
    app_with_runtimes_and_observability(
        database,
        AuthConfig::default(),
        CacheRuntime::disabled(),
        MfaRuntime::disabled(),
        observability_runtime,
    )
}

pub fn app_with_config(database: Database, auth_config: AuthConfig) -> Router {
    app_with_runtime(database, auth_config, CacheRuntime::disabled())
}

pub fn app_with_runtime(
    database: Database,
    auth_config: AuthConfig,
    cache_runtime: CacheRuntime,
) -> Router {
    app_with_runtime_and_mfa(database, auth_config, cache_runtime, MfaRuntime::disabled())
}

pub fn app_with_runtime_and_mfa(
    database: Database,
    auth_config: AuthConfig,
    cache_runtime: CacheRuntime,
    mfa_runtime: MfaRuntime,
) -> Router {
    app_with_runtimes_and_observability(
        database,
        auth_config,
        cache_runtime,
        mfa_runtime,
        ObservabilityRuntime::default(),
    )
}

pub fn app_with_runtimes_and_observability(
    database: Database,
    auth_config: AuthConfig,
    cache_runtime: CacheRuntime,
    mfa_runtime: MfaRuntime,
    observability_runtime: ObservabilityRuntime,
) -> Router {
    app_with_all_runtimes(
        database,
        auth_config,
        cache_runtime,
        mfa_runtime,
        observability_runtime,
        PluginRuntime::disabled(),
    )
}

pub fn app_with_plugin_runtime(
    database: Database,
    auth_config: AuthConfig,
    plugin_runtime: PluginRuntime,
) -> Router {
    app_with_all_runtimes(
        database,
        auth_config,
        CacheRuntime::disabled(),
        MfaRuntime::disabled(),
        ObservabilityRuntime::default(),
        plugin_runtime,
    )
}

pub fn app_with_all_runtimes(
    database: Database,
    auth_config: AuthConfig,
    cache_runtime: CacheRuntime,
    mfa_runtime: MfaRuntime,
    observability_runtime: ObservabilityRuntime,
    plugin_runtime: PluginRuntime,
) -> Router {
    let auth_runtime = auth::runtime(auth_config);
    Router::new()
        .merge(auth::router(auth_runtime.clone()))
        .merge(admin::router(auth_runtime.clone()))
        .merge(attachments::router(auth_runtime.clone()))
        .merge(governance::router(auth_runtime.clone()))
        .merge(boards::router())
        .merge(health::router())
        .merge(installation::router())
        .merge(topics::router(auth_runtime.clone()))
        .merge(relations::router(auth_runtime.clone()))
        .merge(messages::router(auth_runtime.clone()))
        .merge(membership::router())
        .merge(notifications::router(auth_runtime.clone()))
        .merge(observability::router())
        .merge(operations::router(auth_runtime.clone()))
        .merge(plugins::router(auth_runtime.clone()))
        .merge(users::router(auth_runtime))
        .route("/api/v1/openapi.json", get(openapi))
        // Source: https://docs.rs/axum/0.8.9/axum/struct.Router.html#method.fallback
        .fallback(rejection::not_found)
        // Source: https://docs.rs/axum/0.8.9/axum/struct.Router.html#method.method_not_allowed_fallback
        .method_not_allowed_fallback(rejection::method_not_allowed)
        .with_state(database)
        .layer(axum::Extension(cache_runtime))
        .layer(axum::Extension(mfa_runtime))
        .layer(axum::Extension(observability_runtime.clone()))
        .layer(axum::Extension(plugin_runtime))
        .layer(middleware::from_fn_with_state(
            observability_runtime,
            observability::observe_request,
        ))
        // Source: https://docs.rs/axum/0.8.9/axum/middleware/fn.from_fn.html
        .layer(middleware::from_fn(assign_request_id))
}

async fn openapi() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

async fn assign_request_id(mut request: Request, next: Next) -> Response {
    // Source: https://docs.rs/uuid/1.24.0/uuid/struct.Uuid.html#method.now_v7
    let request_id = RequestId::from(Uuid::now_v7());
    request.extensions_mut().insert(request_id);

    let mut response = next.run(request).await;
    let header_value =
        HeaderValue::from_str(&request_id.to_string()).expect("UUIDs are valid HTTP header values");
    response
        .headers_mut()
        .insert(REQUEST_ID_HEADER, header_value);
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE_OPTIONS_HEADER,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(FRAME_OPTIONS_HEADER, HeaderValue::from_static("DENY"));
    headers.insert(
        REFERRER_POLICY_HEADER,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        CONTENT_SECURITY_POLICY_HEADER,
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
    );
    headers.insert(
        PERMISSIONS_POLICY_HEADER,
        HeaderValue::from_static("camera=(), geolocation=(), microphone=()"),
    );
    if hsts_enabled() {
        headers.insert(
            STRICT_TRANSPORT_SECURITY_HEADER,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        );
    }
    response
}

fn hsts_enabled() -> bool {
    matches!(
        std::env::var("DAOYUN_HSTS").as_deref(),
        Ok("true") | Ok("1")
    )
}
