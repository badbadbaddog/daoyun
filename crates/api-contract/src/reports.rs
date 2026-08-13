use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{AdminUserStatus, UserSummary};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReportTargetType {
    Topic,
    Post,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReportReason {
    Spam,
    Harassment,
    Illegal,
    Copyright,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReportStatus {
    Open,
    InReview,
    Resolved,
    Dismissed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReportResolution {
    None,
    HideTopic,
    HidePost,
    SuspendAuthor,
    Dismiss,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct CreateReportRequest {
    pub target_type: ReportTargetType,
    pub target_id: Uuid,
    pub reason: ReportReason,
    #[serde(default)]
    pub details: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ContentReportReceipt {
    pub id: Uuid,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateReportRequest {
    pub status: ReportStatus,
    pub resolution: ReportResolution,
    #[serde(default)]
    pub note: Option<String>,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct BatchUpdateReportsRequest {
    pub report_ids: Vec<Uuid>,
    pub status: ReportStatus,
    pub resolution: ReportResolution,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BatchReportResult {
    pub updated: u32,
    pub report_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ContentReport {
    pub id: Uuid,
    pub target_type: ReportTargetType,
    pub target_id: Uuid,
    pub target_topic_id: Option<Uuid>,
    pub target_title: Option<String>,
    pub target_author: Option<UserSummary>,
    pub reporter: UserSummary,
    pub reason: ReportReason,
    pub details: Option<String>,
    pub status: ReportStatus,
    pub resolution: ReportResolution,
    pub resolution_note: Option<String>,
    pub reviewer: Option<UserSummary>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
    pub resolved_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReportContextItem {
    pub id: Uuid,
    pub author: Option<UserSummary>,
    #[schema(max_length = 2000)]
    pub content: String,
    pub status: String,
    pub is_target: bool,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReportContentContext {
    pub topic_id: Uuid,
    pub title: String,
    pub items: Vec<ReportContextItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReportAuthorContext {
    pub user: UserSummary,
    pub status: AdminUserStatus,
    pub report_count: u64,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReportHistoryItem {
    pub id: Uuid,
    pub reason: ReportReason,
    pub status: ReportStatus,
    pub resolution: ReportResolution,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReportHandlingRecord {
    pub id: Uuid,
    pub action: String,
    pub actor: UserSummary,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ContentReportDetail {
    pub report: ContentReport,
    pub context: ReportContentContext,
    pub author: Option<ReportAuthorContext>,
    pub related_reports: Vec<ReportHistoryItem>,
    pub handling_history: Vec<ReportHandlingRecord>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReportDisposition {
    Resolved,
    Dismissed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReportContentAction {
    None,
    Hide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReportUserActionKind {
    Restricted,
    Suspended,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReportUserAction {
    pub kind: ReportUserActionKind,
    pub reason: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct CreateReportModerationRequest {
    pub disposition: ReportDisposition,
    pub content_action: ReportContentAction,
    pub user_action: Option<ReportUserAction>,
    pub public_reason: Option<String>,
    pub note: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReportModerationContentResult {
    pub action: ReportContentAction,
    pub target_id: Uuid,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReportModerationUserResult {
    pub user_id: Uuid,
    pub status: AdminUserStatus,
    pub reason: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub expires_at: Option<String>,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReportModerationResult {
    pub report: ContentReport,
    pub content: ReportModerationContentResult,
    pub user: Option<ReportModerationUserResult>,
    pub audit_id: Uuid,
    pub notification_queued: bool,
}
