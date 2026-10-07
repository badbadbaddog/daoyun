use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::AuthorizationAssignedRole;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UserSummary {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdminUserStatus {
    Active,
    Restricted,
    Suspended,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserSummary {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub status: AdminUserStatus,
    pub primary_role: Option<String>,
    /// Compact membership read model for admin lists; never inferred from governance roles.
    pub membership: Option<AdminUserMembershipOverview>,
    pub topic_count: u64,
    pub post_count: u64,
    pub report_count: u64,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub last_seen_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserDetail {
    #[serde(flatten)]
    #[schema(inline)]
    pub summary: AdminUserSummary,
    pub bio: String,
    pub location: Option<String>,
    pub website_url: Option<String>,
    pub follower_count: u64,
    pub following_count: u64,
    pub roles: Vec<AuthorizationAssignedRole>,
    pub restriction_reason: Option<String>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub restriction_expires_at: Option<String>,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct UpdateAdminUserStatusRequest {
    pub status: AdminUserStatus,
    pub reason: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub expires_at: Option<String>,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserStatusUpdate {
    pub user_id: Uuid,
    pub status: AdminUserStatus,
    pub reason: Option<String>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub expires_at: Option<String>,
    pub revision: u64,
    pub audit_id: Uuid,
    pub actor: UserSummary,
    #[schema(value_type = String, format = DateTime)]
    pub changed_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdminUserContentKind {
    Topic,
    Reply,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserContentItem {
    pub id: Uuid,
    pub kind: AdminUserContentKind,
    pub topic_id: Uuid,
    pub title: Option<String>,
    pub excerpt: String,
    pub status: String,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UserProfileViewer {
    pub is_self: bool,
    pub is_following: bool,
    pub is_blocked_by_viewer: bool,
    pub can_message: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UserProfile {
    #[serde(flatten)]
    #[schema(inline)]
    pub user: UserSummary,
    pub bio: String,
    pub location: Option<String>,
    pub website_url: Option<String>,
    pub profile_revision: u32,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    pub topic_count: u64,
    pub follower_count: u64,
    pub following_count: u64,
    pub viewer: Option<UserProfileViewer>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateUserProfileRequest {
    pub base_revision: u32,
    pub display_name: String,
    pub bio: String,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub website_url: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct FollowState {
    pub user_id: Uuid,
    pub following: bool,
    pub follower_count: u64,
    pub following_count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BlockState {
    pub user_id: Uuid,
    pub blocked: bool,
}

/// Admin read model. Null sections are distinguished from uninitialized accounts by readable_sections.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserMembershipSummary {
    pub account: AdminUserDetail,
    pub groups: Option<Vec<crate::AdminCommunityGroupMembership>>,
    pub experience: Option<crate::ExperienceAccount>,
    pub next_level: Option<crate::GrowthLevel>,
    pub points: Option<AdminUserPoints>,
    pub medals: Option<Vec<crate::MembershipMedal>>,
    /// Includes expired and revoked grants for domain history; snapshots remain immutable.
    pub entitlements: Option<Vec<crate::AdminStandardEntitlement>>,
    pub readable_sections: Vec<AdminUserMembershipSection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdminUserMembershipSection {
    Groups,
    Experience,
    Points,
    Medals,
    Entitlements,
}

/// Points are independent of EXP. Legacy points-derived level fields are intentionally absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserPoints {
    pub user_id: Uuid,
    pub points_balance: i64,
    pub lifetime_points: i64,
    pub revision: i64,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserMembershipOverview {
    pub groups: Option<Vec<AdminUserGroupIdentity>>,
    pub experience: Option<i64>,
    pub level: Option<AdminUserLevelIdentity>,
    pub points_balance: Option<i64>,
    pub entitlements: Option<Vec<AdminUserEntitlementIdentity>>,
    pub medal_count: Option<i64>,
    pub readable_sections: Vec<AdminUserMembershipSection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserGroupIdentity {
    pub id: Uuid,
    pub display_name: String,
    pub membership_kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserLevelIdentity {
    pub id: Uuid,
    pub display_name: String,
    pub level_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminUserEntitlementIdentity {
    pub type_id: Uuid,
    pub internal_key: String,
    pub display_name: String,
}
