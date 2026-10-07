use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StandardEntitlementType {
    pub id: Uuid,
    pub internal_key: String,
    pub display_name: String,
    pub status: String,
    pub current_version: i32,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub revision: i64,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StandardEntitlementVersion {
    pub id: Uuid,
    pub entitlement_type_id: Uuid,
    pub version: i32,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub created_by: Uuid,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct PutStandardEntitlementTypeRequest {
    pub display_name: String,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub expected_revision: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminStandardEntitlement {
    pub id: Uuid,
    pub user_id: Uuid,
    pub entitlement_type_id: Uuid,
    pub entitlement_key: String,
    pub type_version: i32,
    pub permission_snapshot: Vec<String>,
    pub quota_snapshot: BTreeMap<String, i64>,
    pub source: String,
    pub source_reference_id: Option<String>,
    pub reason: String,
    #[schema(value_type = String, format = DateTime)]
    pub starts_at: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub ends_at: Option<String>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub revoked_at: Option<String>,
    pub revoked_by: Option<Uuid>,
    pub revocation_reason: Option<String>,
    pub revision: i64,
    pub granted_by: Uuid,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct GrantStandardEntitlementRequest {
    pub user_id: Uuid,
    pub entitlement_type_id: Uuid,
    pub source: String,
    pub source_reference_id: Option<String>,
    pub reason: String,
    #[schema(value_type = String, format = DateTime)]
    pub starts_at: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub ends_at: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct RevokeStandardEntitlementRequest {
    pub expected_revision: i64,
    pub reason: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StandardEntitlementMutation {
    pub entitlement: AdminStandardEntitlement,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RenewStandardEntitlementRequest {
    pub user_id: Uuid,
    #[schema(minimum = 1)]
    pub expected_revision: i64,
    #[schema(value_type = String, format = DateTime)]
    pub ends_at: String,
    pub reason: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StandardEntitlementRenewalReceipt {
    pub id: Uuid,
    pub user_id: Uuid,
    pub entitlement_id: Uuid,
    pub actor_id: Uuid,
    pub expected_revision: i64,
    #[schema(value_type = String, format = DateTime)]
    pub previous_ends_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub ends_at: String,
    pub reason: String,
    pub idempotency_key: String,
    pub revision: i64,
    pub audit_id: Uuid,
    pub request_id: Uuid,
    pub type_version: i32,
    #[schema(value_type = String, format = DateTime)]
    pub starts_at: String,
    pub permission_snapshot: Vec<String>,
    pub quota_snapshot: BTreeMap<String, i64>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StandardEntitlementRenewal {
    pub receipt: StandardEntitlementRenewalReceipt,
    pub entitlement: AdminStandardEntitlement,
    pub replayed: bool,
}
