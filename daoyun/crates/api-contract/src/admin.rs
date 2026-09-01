use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{BoardTone, UserSummary};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminCapabilityAccess {
    pub capability_keys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthorizationPermission {
    pub key: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizationRoleScope {
    Instance,
    Site,
    Board,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizationScopeMode {
    #[default]
    Exact,
    Subtree,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthorizationRole {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub scope: AuthorizationRoleScope,
    pub is_system: bool,
    pub permission_keys: Vec<String>,
    pub assignment_count: u64,
    pub revision: u64,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthorizationAssignedRole {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub scope: AuthorizationRoleScope,
    pub is_system: bool,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthorizationRoleAssignment {
    pub id: Uuid,
    pub user: UserSummary,
    pub role: AuthorizationAssignedRole,
    pub scope_id: Option<Uuid>,
    pub scope_mode: AuthorizationScopeMode,
    pub assigned_by: UserSummary,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct CreateAuthorizationRoleRequest {
    pub key: String,
    pub name: String,
    pub scope: AuthorizationRoleScope,
    pub permission_keys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateAuthorizationRoleRequest {
    pub name: String,
    pub permission_keys: Vec<String>,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct CreateAuthorizationAssignmentRequest {
    pub username: String,
    pub role_id: Uuid,
    pub scope_id: Option<Uuid>,
    #[serde(default)]
    pub scope_mode: AuthorizationScopeMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminAuditEntry {
    pub id: Uuid,
    pub actor: UserSummary,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub summary: serde_json::Value,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BrandThemePreset {
    Default,
    Dark,
    Compact,
    HighContrast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BrandListDensity {
    Comfortable,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BrandHomeMode {
    Latest,
    Hot,
    Featured,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BrandLink {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SiteBranding {
    pub site_name: String,
    pub logo_url: Option<String>,
    pub favicon_url: Option<String>,
    pub default_cover_url: Option<String>,
    pub navigation_links: Vec<BrandLink>,
    pub footer_text: Option<String>,
    pub footer_links: Vec<BrandLink>,
    pub primary_color: String,
    pub accent_color: String,
    pub theme_preset: BrandThemePreset,
    pub list_density: BrandListDensity,
    pub home_mode: BrandHomeMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateSiteBrandingRequest {
    pub site_name: String,
    pub logo_url: Option<String>,
    pub favicon_url: Option<String>,
    pub default_cover_url: Option<Option<String>>,
    pub navigation_links: Option<Vec<BrandLink>>,
    pub footer_text: Option<Option<String>>,
    pub footer_links: Option<Vec<BrandLink>>,
    pub primary_color: String,
    pub accent_color: String,
    pub theme_preset: BrandThemePreset,
    pub list_density: BrandListDensity,
    pub home_mode: BrandHomeMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SmtpTlsMode {
    Tls,
    Starttls,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SmtpSettings {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password_configured: bool,
    pub tls_mode: SmtpTlsMode,
    pub from_email: String,
    pub from_name: String,
    pub enabled: bool,
    pub registration_email_verification_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateSmtpSettingsRequest {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    #[schema(value_type = Option<String>, format = Password)]
    pub password: Option<String>,
    #[serde(default)]
    pub clear_password: bool,
    pub tls_mode: SmtpTlsMode,
    pub from_email: String,
    pub from_name: String,
    pub enabled: bool,
    pub registration_email_verification_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct TestSmtpSettingsRequest {
    pub recipient_email: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdminBoardVisibility {
    Public,
    Hidden,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdminBoardStatus {
    #[default]
    Open,
    ReadOnly,
    Hidden,
    Archived,
    Merged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminBoard {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: BoardTone,
    pub position: i32,
    pub visibility: AdminBoardVisibility,
    pub status: AdminBoardStatus,
    pub merged_into_board_id: Option<Uuid>,
    pub topic_count: u64,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct CreateAdminBoardRequest {
    pub parent_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: BoardTone,
    pub position: i32,
    pub visibility: AdminBoardVisibility,
    #[serde(default)]
    pub status: Option<AdminBoardStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateAdminBoardRequest {
    pub parent_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: BoardTone,
    pub position: i32,
    pub visibility: AdminBoardVisibility,
    #[serde(default)]
    pub status: Option<AdminBoardStatus>,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminBoardDeletionImpact {
    pub board_id: Uuid,
    pub child_count: u64,
    pub topic_count: u64,
    pub reply_count: u64,
    pub can_delete: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdminBoardMergeBlockedReason {
    SameBoard,
    TargetDescendant,
    SourceHasChildren,
    TopicLimitExceeded,
    SourceUnavailable,
    TargetUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminBoardMergeImpact {
    pub source_board_id: Uuid,
    pub target_board_id: Uuid,
    pub source_revision: i64,
    pub target_revision: i64,
    pub topic_count: u64,
    pub reply_count: u64,
    pub child_count: u64,
    pub topic_limit: u64,
    pub can_merge: bool,
    pub blocked_reason: Option<AdminBoardMergeBlockedReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct MergeAdminBoardRequest {
    pub target_board_id: Uuid,
    pub expected_source_revision: i64,
    pub expected_target_revision: i64,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct RollbackAdminBoardMergeRequest {
    pub audit_id: Uuid,
    pub expected_source_revision: i64,
    pub expected_target_revision: i64,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminBoardMergeMutation {
    pub audit_id: Uuid,
    pub source_board_id: Uuid,
    pub target_board_id: Uuid,
    pub moved_topic_count: u64,
    pub source_revision: i64,
    pub target_revision: i64,
    #[schema(value_type = String, format = DateTime)]
    pub rollback_deadline: String,
    pub rolled_back: bool,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GovernancePolicy {
    pub enabled: bool,
    pub alert_score_threshold: u16,
    pub reporter_window_minutes: u16,
    pub reporter_alert_limit: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateGovernancePolicyRequest {
    pub enabled: bool,
    pub alert_score_threshold: u16,
    pub reporter_window_minutes: u16,
    pub reporter_alert_limit: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RiskAlertKind {
    HighRiskReport,
    ReporterSpike,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RiskAlertSeverity {
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RiskAlertStatus {
    Open,
    Acknowledged,
    Dismissed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RiskAlert {
    pub id: Uuid,
    pub kind: RiskAlertKind,
    pub severity: RiskAlertSeverity,
    pub score: u16,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub reporter_id: Option<Uuid>,
    pub report_id: Option<Uuid>,
    pub status: RiskAlertStatus,
    pub details: serde_json::Value,
    pub acknowledged_by: Option<UserSummary>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub acknowledged_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateRiskAlertRequest {
    pub status: RiskAlertStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OperationsSummary {
    #[schema(value_type = String, format = DateTime)]
    pub observed_at: String,
    pub uptime_seconds: u64,
    pub http: OperationsHttpSummary,
    pub database: OperationsDatabaseSummary,
    pub outbox: OperationsOutboxSummary,
    pub risk_alerts_open: u64,
    pub alerts: OperationsAlertCounts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OperationsHttpSummary {
    pub total_requests: u64,
    pub in_flight_requests: u64,
    pub errors_5m: u64,
    pub p95_ms_5m: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OperationsDatabaseSummary {
    pub ready: bool,
    pub connections: u32,
    pub idle_connections: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OperationsOutboxSummary {
    pub pending: u64,
    pub processing: u64,
    pub dead: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OperationsAlertCounts {
    pub open: u64,
    pub acknowledged: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OperationsAlertRuleKind {
    #[serde(rename = "http_5xx_count")]
    Http5xxCount,
    #[serde(rename = "http_p95_ms")]
    HttpP95Ms,
    #[serde(rename = "outbox_dead_count")]
    OutboxDeadCount,
    #[serde(rename = "risk_alert_open_count")]
    RiskAlertOpenCount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OperationsAlertRule {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub kind: OperationsAlertRuleKind,
    pub threshold: u64,
    pub window_seconds: u32,
    pub enabled: bool,
    pub revision: u64,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OperationsAlertRuleReference {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub kind: OperationsAlertRuleKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OperationsAlertStatus {
    Open,
    Acknowledged,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OperationsAlert {
    pub id: Uuid,
    pub rule: OperationsAlertRuleReference,
    pub status: OperationsAlertStatus,
    pub observed_value: u64,
    pub threshold: u64,
    #[schema(value_type = String, format = DateTime)]
    pub first_triggered_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub last_triggered_at: String,
    pub acknowledged_by: Option<UserSummary>,
    #[schema(value_type = String, format = DateTime)]
    pub acknowledged_at: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateOperationsAlertRuleRequest {
    pub name: String,
    pub threshold: u64,
    pub window_seconds: u32,
    pub enabled: bool,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateOperationsAlertRequest {
    pub status: OperationsAlertStatus,
}
