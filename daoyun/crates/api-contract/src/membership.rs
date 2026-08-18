use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GrowthLevel {
    pub id: uuid::Uuid,
    pub internal_key: String,
    pub level_order: i32,
    pub display_name: String,
    pub required_experience: i64,
    pub icon_asset_id: Option<uuid::Uuid>,
    pub color: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ExperienceAccount {
    pub user_id: uuid::Uuid,
    pub experience: i64,
    pub current_level: GrowthLevel,
    pub revision: i64,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GrowthLevelStatus {
    Draft,
    Published,
    Disabled,
    Archived,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminGrowthLevel {
    pub id: uuid::Uuid,
    pub internal_key: String,
    pub level_order: i32,
    pub display_name: String,
    pub required_experience: i64,
    pub icon_asset_id: Option<uuid::Uuid>,
    pub color: Option<String>,
    pub description: String,
    pub status: GrowthLevelStatus,
    pub revision: i64,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub published_at: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct CreateGrowthLevelRequest {
    pub internal_key: String,
    pub level_order: i32,
    pub display_name: String,
    pub required_experience: i64,
    pub icon_asset_id: Option<uuid::Uuid>,
    pub color: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateGrowthLevelRequest {
    pub expected_revision: i64,
    pub level_order: i32,
    pub display_name: String,
    pub required_experience: i64,
    pub icon_asset_id: Option<uuid::Uuid>,
    pub color: Option<String>,
    pub description: String,
    pub status: GrowthLevelStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MembershipCatalog {
    pub member_group: MembershipGroup,
    pub levels: Vec<MembershipLevel>,
    pub medals: Vec<Medal>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MembershipGroup {
    pub key: String,
    pub display_name: String,
    pub asset_url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MembershipLevel {
    pub key: String,
    pub level_number: i16,
    pub display_name: String,
    pub asset_url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Medal {
    pub key: String,
    pub display_name: String,
    pub asset_url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MembershipMedal {
    pub key: String,
    pub display_name: String,
    pub asset_url: String,
    pub sha256: String,
    #[schema(value_type = String, format = DateTime)]
    pub granted_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MembershipMedalRule {
    pub key: String,
    pub display_name: String,
    pub enabled: bool,
    pub required_lifetime_points: Option<i64>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateMembershipMedalRuleRequest {
    pub enabled: bool,
    pub required_lifetime_points: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct GrantMembershipMedalRequest {
    pub user_id: uuid::Uuid,
    pub medal_key: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MembershipMedalGrant {
    pub medal: MembershipMedal,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MembershipAccount {
    pub user_id: uuid::Uuid,
    pub points_balance: i64,
    pub lifetime_points: i64,
    pub level_key: String,
    pub level_number: i16,
    pub level_display_name: String,
    pub revision: i64,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MembershipLevelRule {
    pub level_key: String,
    pub level_number: i16,
    pub level_display_name: String,
    pub required_lifetime_points: i64,
    pub enabled: bool,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateMembershipLevelRuleRequest {
    #[serde(default)]
    pub required_lifetime_points: Option<i64>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default, alias = "level_display_name")]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct GrantMembershipPointsRequest {
    pub user_id: uuid::Uuid,
    pub amount: i64,
    pub reason: String,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MembershipPointsGrant {
    pub account: MembershipAccount,
    pub created: bool,
}
