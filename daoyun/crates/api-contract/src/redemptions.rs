use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RedemptionProduct {
    pub id: Uuid,
    pub name: String,
    pub entitlement_type_id: Uuid,
    pub type_version: i32,
    pub price: i64,
    pub duration_days: i32,
    pub per_user_limit: i32,
    pub enabled: bool,
    pub revision: i64,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub unavailable_reason: Option<String>,
}
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PutRedemptionProductRequest {
    pub name: String,
    pub entitlement_type_id: Uuid,
    pub type_version: i32,
    pub price: i64,
    pub duration_days: i32,
    pub per_user_limit: i32,
    pub enabled: bool,
    pub expected_revision: Option<i64>,
}
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RedeemPointsRequest {
    pub product_id: Uuid,
    pub expected_revision: i64,
    pub idempotency_key: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RedemptionReceipt {
    pub id: Uuid,
    pub product_id: Uuid,
    pub product_revision: i64,
    pub product_name: String,
    pub price: i64,
    pub balance_after: i64,
    pub entitlement_id: Uuid,
    #[schema(value_type=String,format=DateTime)]
    pub created_at: String,
    #[schema(value_type=String,format=DateTime)]
    pub ends_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RedemptionCatalog {
    pub enabled: bool,
    pub products: Vec<RedemptionProduct>,
    pub next_cursor: Option<Uuid>,
}
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RedemptionHistory {
    pub records: Vec<RedemptionReceipt>,
    pub next_cursor: Option<Uuid>,
}
