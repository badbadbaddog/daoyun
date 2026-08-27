use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CommunityGroupSummary {
    pub id: Uuid,
    pub internal_key: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CommunityGroupMembership {
    pub id: Uuid,
    pub group: CommunityGroupSummary,
    pub membership_kind: String,
    pub source: String,
    #[schema(value_type = String, format = DateTime)]
    pub starts_at: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub ends_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CommunityPermissionSource {
    pub membership_id: Uuid,
    pub group_id: Uuid,
    pub group_key: String,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StandardEntitlementPermissionSource {
    pub entitlement_id: Uuid,
    pub entitlement_key: String,
    pub type_version: i32,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CommunityAccess {
    pub account_status: String,
    pub denied: bool,
    pub denial_reason: Option<String>,
    pub permission_keys: Vec<String>,
    pub blocked_permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub sources: Vec<CommunityPermissionSource>,
    #[serde(default)]
    pub entitlement_sources: Vec<StandardEntitlementPermissionSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CurrentCommunityGroups {
    pub memberships: Vec<CommunityGroupMembership>,
    pub access: CommunityAccess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CommunityGroupStatus {
    Active,
    Disabled,
    Archived,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminCommunityGroup {
    pub id: Uuid,
    pub internal_key: String,
    pub display_name: String,
    pub description: String,
    pub is_base: bool,
    pub is_default: bool,
    pub status: CommunityGroupStatus,
    pub display_order: i32,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub revision: i64,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct SetDefaultCommunityGroupRequest {
    pub group_id: Uuid,
    pub expected_default_group_id: Uuid,
    pub expected_default_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct CreateCommunityGroupRequest {
    pub internal_key: String,
    pub display_name: String,
    pub description: String,
    pub is_base: bool,
    pub display_order: i32,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateCommunityGroupRequest {
    pub expected_revision: i64,
    pub display_name: String,
    pub description: String,
    pub status: CommunityGroupStatus,
    pub display_order: i32,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminCommunityGroupMembership {
    pub id: Uuid,
    pub user_id: Uuid,
    pub group: CommunityGroupSummary,
    pub membership_kind: String,
    pub source: String,
    pub source_reference_id: Option<Uuid>,
    pub reason: String,
    #[schema(value_type = String, format = DateTime)]
    pub starts_at: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub ends_at: Option<String>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub revoked_at: Option<String>,
    pub revocation_reason: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct GrantCommunityGroupMembershipRequest {
    pub user_id: Uuid,
    pub group_id: Uuid,
    pub membership_kind: String,
    pub source: String,
    pub source_reference_id: Option<Uuid>,
    pub reason: String,
    #[schema(value_type = String, format = DateTime)]
    pub starts_at: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub ends_at: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct RevokeCommunityGroupMembershipRequest {
    pub expected_revision: i64,
    pub reason: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CommunityGroupMembershipMutation {
    pub membership: AdminCommunityGroupMembership,
    pub replayed: bool,
}
