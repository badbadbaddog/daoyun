use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMatrixAction {
    Browse,
    TopicCreate,
    ReplyCreate,
    AttachmentUpload,
    AttachmentDownload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMatrixDecision {
    Allowed,
    Denied,
    Provided,
    NotProvided,
    MissingContext,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMatrixScenarioKind {
    Group,
    User,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMatrixSourceKind {
    Group,
    Entitlement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PermissionMatrixSource {
    pub id: Uuid,
    pub kind: PermissionMatrixSourceKind,
    pub key: String,
    pub display_name: String,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub type_version: Option<i32>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub starts_at: Option<String>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub ends_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PermissionMatrixQuota {
    pub key: String,
    pub limit: i64,
    pub used: Option<i64>,
    pub source_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PermissionMatrixActionResult {
    pub action: PermissionMatrixAction,
    pub decision: PermissionMatrixDecision,
    pub reason: String,
    pub permission_provided: bool,
    pub source_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PermissionMatrixScenario {
    pub id: Uuid,
    pub kind: PermissionMatrixScenarioKind,
    pub display_name: String,
    pub complete: bool,
    pub actions: Vec<PermissionMatrixActionResult>,
    pub sources: Vec<PermissionMatrixSource>,
    pub quotas: Vec<PermissionMatrixQuota>,
}

/// Advisory snapshot only. Real operations recheck their resource and consume quotas atomically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BoardPermissionMatrix {
    pub board_id: Uuid,
    pub visibility: String,
    pub policy_revision: Option<i64>,
    #[schema(value_type = String, format = DateTime)]
    pub evaluated_at: String,
    pub scenarios: Vec<PermissionMatrixScenario>,
}

/// A current, read-only user/resource snapshot. Never an authorization token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PermissionCheck {
    pub board_id: Uuid,
    pub topic_id: Option<Uuid>,
    pub attachment_id: Option<Uuid>,
    pub file_bytes: Option<i64>,
    #[schema(value_type = String, format = DateTime)]
    pub evaluated_at: String,
    pub scenario: PermissionMatrixScenario,
}
