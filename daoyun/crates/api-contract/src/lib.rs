#![forbid(unsafe_code)]

mod admin;
mod attachments;
mod auth;
mod board;
mod error;
mod installation;
mod membership;
mod messages;
mod moderation;
mod notifications;
mod pagination;
mod plugins;
mod relations;
mod reports;
mod request_id;
mod topic;
mod user;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub use admin::{
    AdminAuditEntry, AdminBoard, AdminBoardDeletionImpact, AdminBoardVisibility,
    AdminCapabilityAccess, AuthorizationAssignedRole, AuthorizationPermission, AuthorizationRole,
    AuthorizationRoleAssignment, AuthorizationRoleScope, BrandHomeMode, BrandLink,
    BrandListDensity, BrandThemePreset, CreateAdminBoardRequest,
    CreateAuthorizationAssignmentRequest, CreateAuthorizationRoleRequest, GovernancePolicy,
    OperationsAlert, OperationsAlertCounts, OperationsAlertRule, OperationsAlertRuleKind,
    OperationsAlertRuleReference, OperationsAlertStatus, OperationsDatabaseSummary,
    OperationsHttpSummary, OperationsOutboxSummary, OperationsSummary, RiskAlert, RiskAlertKind,
    RiskAlertSeverity, RiskAlertStatus, SiteBranding, UpdateAdminBoardRequest,
    UpdateAuthorizationRoleRequest, UpdateGovernancePolicyRequest, UpdateOperationsAlertRequest,
    UpdateOperationsAlertRuleRequest, UpdateRiskAlertRequest, UpdateSiteBrandingRequest,
};
pub use attachments::{
    AttachmentCleanupResult, AttachmentScanStatus, AttachmentStatus, TopicAttachment,
};
pub use auth::{
    AuthenticatedSession, AuthenticatedUser, ChangePasswordData, ChangePasswordRequest,
    DeviceSession, ExternalIdentity, LoginRequest, LogoutData, MfaChallengeData, MfaCodeRequest,
    MfaDisableData, MfaEnableData, MfaRecoveryCodesData, MfaSetupData, MfaStatus, MfaVerifyRequest,
    OidcAuthorizationStartData, OidcClaimAccountRequest, OidcClaimBindData, OidcClaimData,
    OidcProvider, PasskeyAssertionOptions, PasskeyAssertionOptionsData,
    PasskeyAssertionVerifyRequest, PasskeyAuthenticatorSelection, PasskeyCredentialDescriptor,
    PasskeyCredentialParameter, PasskeyCredentialSummary, PasskeyDeleteData,
    PasskeyRegistrationData, PasskeyRegistrationOptions, PasskeyRegistrationOptionsData,
    PasskeyRegistrationVerifyRequest, PasskeyRp, PasskeyUser, RecentAuthData, RecentAuthRequest,
    RegisterRequest, RevokeDeviceSessionData, UnlinkExternalIdentityData,
};
pub use board::{BoardSummary, BoardTone};
pub use error::{ErrorBody, ErrorCode, ErrorResponse, FieldErrors, error_codes};
pub use installation::{
    InitialAdministrator, InitializeInstallationRequest, InstallationInitialization,
    InstallationStatus,
};
pub use membership::{
    GrantMembershipMedalRequest, GrantMembershipPointsRequest, Medal, MembershipAccount,
    MembershipCatalog, MembershipGroup, MembershipLevel, MembershipLevelRule, MembershipMedal,
    MembershipMedalGrant, MembershipMedalRule, MembershipPointsGrant,
    UpdateMembershipLevelRuleRequest, UpdateMembershipMedalRuleRequest,
};
pub use messages::{
    ConversationLastMessage, ConversationReadState, ConversationSummary, CreateConversationRequest,
    DirectMessage, MarkConversationReadRequest, SendDirectMessageRequest,
};
pub use moderation::{ModerateTopicRequest, TopicModerationResult, TopicModerationStatus};
pub use notifications::{
    Notification, NotificationKind, NotificationTarget, NotificationUnreadCount,
};
pub use pagination::{PageMeta, PageResponse};
pub use plugins::{
    InstallPluginRequest, InvokePluginRequest, Plugin, PluginCapability, PluginInvocation,
    PluginManifestRequest, PluginOperation, PluginStatus, PluginUiBlock, PluginUiSchema,
    PluginUiTone, UpdatePluginRequest,
};
pub use relations::{BookmarkState, PostLikeState};
pub use reports::{
    BatchReportResult, BatchUpdateReportsRequest, ContentReport, ContentReportDetail,
    ContentReportReceipt, CreateReportModerationRequest, CreateReportRequest, ReportAuthorContext,
    ReportContentAction, ReportContentContext, ReportContextItem, ReportDisposition,
    ReportHandlingRecord, ReportHistoryItem, ReportModerationContentResult, ReportModerationResult,
    ReportModerationUserResult, ReportReason, ReportResolution, ReportStatus, ReportTargetType,
    ReportUserAction, ReportUserActionKind, UpdateReportRequest,
};
pub use request_id::RequestId;
pub use topic::{
    CreateReplyRequest, CreateTopicRequest, ReplyRevision, TopicAuthorSummary, TopicBoardSummary,
    TopicDetail, TopicReply, TopicRevision, TopicScope, TopicSort, TopicSummary, TopicTag,
    TopicTagInput, UpdateReplyRequest, UpdateTopicRequest,
};
pub use user::{
    AdminUserContentItem, AdminUserContentKind, AdminUserDetail, AdminUserStatus,
    AdminUserStatusUpdate, AdminUserSummary, BlockState, FollowState, UpdateAdminUserStatusRequest,
    UpdateUserProfileRequest, UserProfile, UserProfileViewer, UserSummary,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(bound = "T: utoipa::ToSchema")]
pub struct ApiResponse<T> {
    pub data: T,
    pub meta: ResponseMeta,
}

impl<T> ApiResponse<T> {
    pub fn new(data: T, request_id: RequestId) -> Self {
        Self {
            data,
            meta: ResponseMeta::new(request_id),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ResponseMeta {
    pub request_id: RequestId,
}

impl ResponseMeta {
    pub fn new(request_id: RequestId) -> Self {
        Self { request_id }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Live,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct HealthData {
    pub status: HealthStatus,
    pub version: String,
}

impl HealthData {
    pub fn new(status: HealthStatus, version: impl Into<String>) -> Self {
        Self {
            status,
            version: version.into(),
        }
    }
}
