use std::{collections::BTreeMap, fmt};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{RequestId, ResponseMeta};

pub mod error_codes {
    pub const AUTH_CSRF_FAILED: &str = "auth.csrf_failed";
    pub const AUTH_CURRENT_SESSION: &str = "auth.current_session";
    pub const AUTH_IDENTITY_UNAVAILABLE: &str = "auth.identity_unavailable";
    pub const AUTH_IDENTITY_NOT_FOUND: &str = "auth.identity_not_found";
    pub const AUTH_EMAIL_UNAVAILABLE: &str = "auth.email_unavailable";
    pub const AUTH_EMAIL_VERIFICATION_INVALID: &str = "auth.email_verification_invalid";
    pub const AUTH_INVALID_CREDENTIALS: &str = "auth.invalid_credentials";
    pub const AUTH_MFA_ALREADY_ENABLED: &str = "auth.mfa_already_enabled";
    pub const AUTH_MFA_CHALLENGE_REQUIRED: &str = "auth.mfa_challenge_required";
    pub const AUTH_MFA_INVALID: &str = "auth.mfa_invalid";
    pub const AUTH_MFA_NOT_ENABLED: &str = "auth.mfa_not_enabled";
    pub const AUTH_MFA_NOT_CONFIGURED: &str = "auth.mfa_not_configured";
    pub const AUTH_MFA_SETUP_REQUIRED: &str = "auth.mfa_setup_required";
    pub const AUTH_OIDC_FAILED: &str = "auth.oidc_failed";
    pub const AUTH_OIDC_CLAIM_REQUIRED: &str = "auth.oidc_claim_required";
    pub const AUTH_OIDC_PROVIDER_NOT_FOUND: &str = "auth.oidc_provider_not_found";
    pub const AUTH_RATE_LIMITED: &str = "auth.rate_limited";
    pub const AUTH_RECENT_AUTH_REQUIRED: &str = "auth.recent_auth_required";
    pub const AUTH_LAST_LOGIN_METHOD: &str = "auth.last_login_method";
    pub const AUTH_PASSKEY_FAILED: &str = "auth.passkey_failed";
    pub const AUTH_PASSKEY_NOT_FOUND: &str = "auth.passkey_not_found";
    pub const AUTH_SESSION_NOT_FOUND: &str = "auth.session_not_found";
    pub const AUTH_UNAUTHENTICATED: &str = "auth.unauthenticated";
    pub const ADMIN_FORBIDDEN: &str = "admin.forbidden";
    pub const ADMIN_USER_NOT_FOUND: &str = "admin.user_not_found";
    pub const ADMIN_USER_STATUS_CONFLICT: &str = "admin.user_status_conflict";
    pub const ADMIN_USER_STATUS_INVALID: &str = "admin.user_status_invalid";
    pub const ADMIN_USER_SELF_SUSPENSION_FORBIDDEN: &str = "admin.user_self_suspension_forbidden";
    pub const ADMIN_USER_LAST_SUPER_ADMIN_FORBIDDEN: &str = "admin.user_last_super_admin_forbidden";
    pub const ADMIN_BOARD_NOT_FOUND: &str = "admin.board_not_found";
    pub const ADMIN_BOARD_PARENT_INVALID: &str = "admin.board_parent_invalid";
    pub const ADMIN_BOARD_DEPTH_EXCEEDED: &str = "admin.board_depth_exceeded";
    pub const ADMIN_BOARD_HAS_CHILDREN: &str = "admin.board_has_children";
    pub const ADMIN_BOARD_STATUS_INVALID: &str = "admin.board_status_invalid";
    pub const ADMIN_BOARD_MERGE_BLOCKED: &str = "admin.board_merge_blocked";
    pub const ADMIN_BOARD_MERGE_NOT_FOUND: &str = "admin.board_merge_not_found";
    pub const ADMIN_BOARD_MERGE_ROLLBACK_EXPIRED: &str = "admin.board_merge_rollback_expired";
    pub const ADMIN_BOARD_MERGE_CONFLICT: &str = "admin.board_merge_conflict";
    pub const BRANDING_ASSET_INVALID: &str = "branding.asset_invalid";
    pub const BRANDING_ASSET_NOT_FOUND: &str = "branding.asset_not_found";
    pub const ADMIN_BOARD_CONFLICT: &str = "admin.board_conflict";
    pub const AUTHORIZATION_ROLE_NOT_FOUND: &str = "authorization.role_not_found";
    pub const AUTHORIZATION_ROLE_CONFLICT: &str = "authorization.role_conflict";
    pub const AUTHORIZATION_ROLE_SYSTEM_MANAGED: &str = "authorization.role_system_managed";
    pub const AUTHORIZATION_ROLE_IN_USE: &str = "authorization.role_in_use";
    pub const AUTHORIZATION_PERMISSION_INVALID: &str = "authorization.permission_invalid";
    pub const AUTHORIZATION_ASSIGNMENT_NOT_FOUND: &str = "authorization.assignment_not_found";
    pub const AUTHORIZATION_ASSIGNMENT_CONFLICT: &str = "authorization.assignment_conflict";
    pub const AUTHORIZATION_SCOPE_INVALID: &str = "authorization.scope_invalid";
    pub const AUTHORIZATION_USER_NOT_FOUND: &str = "authorization.user_not_found";
    pub const ATTACHMENT_INVALID: &str = "attachment.invalid";
    pub const ATTACHMENT_NOT_FOUND: &str = "attachment.not_found";
    pub const ATTACHMENT_FORBIDDEN: &str = "attachment.forbidden";
    pub const ATTACHMENT_CLEANUP_FORBIDDEN: &str = "attachment.cleanup_forbidden";
    pub const REPORT_NOT_FOUND: &str = "report.not_found";
    pub const REPORT_TARGET_NOT_FOUND: &str = "report.target_not_found";
    pub const REPORT_FORBIDDEN: &str = "report.forbidden";
    pub const REPORT_INVALID_ACTION: &str = "report.invalid_action";
    pub const GOVERNANCE_REPORT_CONFLICT: &str = "governance.report_conflict";
    pub const GOVERNANCE_REPORT_NOT_FOUND: &str = "governance.report_not_found";
    pub const GOVERNANCE_MODERATION_INVALID: &str = "governance.moderation_invalid";
    pub const GOVERNANCE_TARGET_STATE_CONFLICT: &str = "governance.target_state_conflict";
    pub const GOVERNANCE_ALERT_NOT_FOUND: &str = "governance.alert_not_found";
    pub const GOVERNANCE_ALERT_CONFLICT: &str = "governance.alert_conflict";
    pub const OPERATIONS_ALERT_NOT_FOUND: &str = "operations.alert_not_found";
    pub const OPERATIONS_ALERT_CONFLICT: &str = "operations.alert_conflict";
    pub const OPERATIONS_RULE_NOT_FOUND: &str = "operations.rule_not_found";
    pub const OPERATIONS_RULE_CONFLICT: &str = "operations.rule_conflict";
    pub const CONVERSATION_NOT_FOUND: &str = "conversation.not_found";
    pub const DATABASE_UNAVAILABLE: &str = "system.database_unavailable";
    pub const INSTALLATION_ALREADY_INITIALIZED: &str = "installation.already_initialized";
    pub const INTERNAL_ERROR: &str = "system.internal_error";
    pub const METHOD_NOT_ALLOWED: &str = "system.method_not_allowed";
    pub const MESSAGE_RATE_LIMITED: &str = "message.rate_limited";
    pub const COMMUNITY_PERMISSION_DENIED: &str = "community.permission_denied";
    pub const COMMUNITY_QUOTA_EXCEEDED: &str = "community.quota_exceeded";
    pub const COMMUNITY_GROUP_CONFLICT: &str = "community.group_conflict";
    pub const COMMUNITY_GROUP_NOT_FOUND: &str = "community.group_not_found";
    pub const COMMUNITY_GROUP_REVISION_CONFLICT: &str = "community.group_revision_conflict";
    pub const COMMUNITY_MEMBERSHIP_CONFLICT: &str = "community.membership_conflict";
    pub const COMMUNITY_MEMBERSHIP_NOT_FOUND: &str = "community.membership_not_found";
    pub const ENTITLEMENT_CONFLICT: &str = "entitlement.conflict";
    pub const ENTITLEMENT_NOT_FOUND: &str = "entitlement.not_found";
    pub const ENTITLEMENT_TYPE_NOT_FOUND: &str = "entitlement.type_not_found";
    pub const COMMUNITY_MEMBERSHIP_REVISION_CONFLICT: &str =
        "community.membership_revision_conflict";
    pub const CONTENT_ACCESS_POLICY_NOT_FOUND: &str = "content.access_policy_not_found";
    pub const CONTENT_ACCESS_POLICY_REVISION_CONFLICT: &str =
        "content.access_policy_revision_conflict";
    pub const CONTENT_ACCESS_POLICY_SUBJECT_INVALID: &str = "content.access_policy_subject_invalid";
    pub const NOTIFICATION_NOT_FOUND: &str = "notification.not_found";
    pub const TOPIC_DELETE_FORBIDDEN: &str = "topic.delete_forbidden";
    pub const TOPIC_MODERATION_FORBIDDEN: &str = "topic.moderation_forbidden";
    pub const TOPIC_MODERATION_NOT_FOUND: &str = "topic.moderation_not_found";
    pub const TOPIC_GOVERNANCE_FORBIDDEN: &str = "topic.governance_forbidden";
    pub const TOPIC_GOVERNANCE_REVISION_CONFLICT: &str = "topic.governance_revision_conflict";
    pub const TOPIC_GOVERNANCE_INVALID: &str = "topic.governance_invalid";
    pub const TOPIC_LOCKED: &str = "topic.locked";
    pub const BOARD_POSTING_RESTRICTED: &str = "board.posting_restricted";
    pub const BOARD_RESTRICTION_FORBIDDEN: &str = "board.restriction_forbidden";
    pub const BOARD_RESTRICTION_PROTECTED_TARGET: &str = "board.restriction_protected_target";
    pub const BOARD_RESTRICTION_CONFLICT: &str = "board.restriction_conflict";
    pub const BOARD_RESTRICTION_INVALID: &str = "board.restriction_invalid";
    pub const BOARD_RESTRICTION_TARGET_NOT_FOUND: &str = "board.restriction_target_not_found";
    pub const NOT_READY: &str = "system.not_ready";
    pub const PATH_INVALID: &str = "request.path_invalid";
    pub const POST_NOT_FOUND: &str = "post.not_found";
    pub const ROUTE_NOT_FOUND: &str = "system.route_not_found";
    pub const REPLY_NOT_FOUND: &str = "reply.not_found";
    pub const REPLY_REVISION_CONFLICT: &str = "reply.revision_conflict";
    pub const USER_NOT_FOUND: &str = "user.not_found";
    pub const USER_ACTION_RESTRICTED: &str = "user.action_restricted";
    pub const PROFILE_REVISION_CONFLICT: &str = "profile.revision_conflict";
    pub const MEMBERSHIP_LEVEL_CONFLICT: &str = "membership.level_conflict";
    pub const MEMBERSHIP_LEVEL_NOT_FOUND: &str = "membership.level_not_found";
    pub const MEMBERSHIP_LEVEL_REVISION_CONFLICT: &str = "membership.level_revision_conflict";
    pub const PLUGIN_INVALID_MANIFEST: &str = "plugin.invalid_manifest";
    pub const PLUGIN_INVALID_COMPONENT: &str = "plugin.invalid_component";
    pub const PLUGIN_NOT_FOUND: &str = "plugin.not_found";
    pub const PLUGIN_CONFLICT: &str = "plugin.conflict";
    pub const PLUGIN_DISABLED: &str = "plugin.disabled";
    pub const PLUGIN_CAPABILITY_DENIED: &str = "plugin.capability_denied";
    pub const PLUGIN_EXECUTION_FAILED: &str = "plugin.execution_failed";
    pub const PLUGIN_RESOURCE_EXHAUSTED: &str = "plugin.resource_exhausted";
    pub const PLUGIN_RATE_LIMITED: &str = "plugin.rate_limited";
    pub const PLUGIN_OUTPUT_INVALID: &str = "plugin.output_invalid";
    pub const RELATIONSHIP_SELF_BLOCK_NOT_ALLOWED: &str = "relationship.self_block_not_allowed";
    pub const RELATIONSHIP_SELF_FOLLOW_NOT_ALLOWED: &str = "relationship.self_follow_not_allowed";
    pub const TOPIC_NOT_FOUND: &str = "topic.not_found";
    pub const TOPIC_BOARD_UNAVAILABLE: &str = "topic.board_unavailable";
    pub const TOPIC_EDIT_FORBIDDEN: &str = "topic.edit_forbidden";
    pub const TOPIC_REVISION_CONFLICT: &str = "topic.revision_conflict";
    pub const IDEMPOTENCY_CONFLICT: &str = "request.idempotency_conflict";
    pub const VALIDATION_FAILED: &str = "request.validation_failed";
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct ErrorCode(String);

impl ErrorCode {
    pub fn from_static(value: &'static str) -> Self {
        Self(value.to_owned())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

pub type FieldErrors = BTreeMap<String, Vec<String>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ErrorBody {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: FieldErrors,
}

impl ErrorBody {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            fields: BTreeMap::new(),
        }
    }

    pub fn with_field(mut self, field: impl Into<String>, message: impl Into<String>) -> Self {
        self.fields
            .entry(field.into())
            .or_default()
            .push(message.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ErrorResponse {
    pub error: ErrorBody,
    pub meta: ResponseMeta,
}

impl ErrorResponse {
    pub fn new(error: ErrorBody, request_id: RequestId) -> Self {
        Self {
            error,
            meta: ResponseMeta::new(request_id),
        }
    }
}
