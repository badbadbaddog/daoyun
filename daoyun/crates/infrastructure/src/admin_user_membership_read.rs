use crate::{Database, DatabaseError};
use serde::Deserialize;
use sqlx::types::Json;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct AdminUserGroupIdentityRecord {
    pub id: Uuid,
    pub display_name: String,
    pub membership_kind: String,
}
#[derive(Debug, Deserialize)]
pub struct AdminUserLevelIdentityRecord {
    pub id: Uuid,
    pub display_name: String,
    pub level_order: i32,
}
#[derive(Debug, Deserialize)]
pub struct AdminUserEntitlementIdentityRecord {
    pub type_id: Uuid,
    pub internal_key: String,
    pub display_name: String,
}
#[derive(Debug, sqlx::FromRow)]
pub struct AdminUserMembershipOverviewRecord {
    pub user_id: Uuid,
    pub groups: Json<Vec<AdminUserGroupIdentityRecord>>,
    pub experience: Option<i64>,
    pub level: Option<Json<AdminUserLevelIdentityRecord>>,
    pub points_balance: Option<i64>,
    pub entitlements: Json<Vec<AdminUserEntitlementIdentityRecord>>,
    pub medal_count: i64,
}

impl Database {
    /// Batch projection for a bounded page. It neither initializes accounts nor changes domain state.
    pub async fn admin_user_membership_overviews(
        &self,
        user_ids: &[Uuid],
        effective_at: OffsetDateTime,
    ) -> Result<Vec<AdminUserMembershipOverviewRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, AdminUserMembershipOverviewRecord>(
            "SELECT u.id AS user_id, ea.experience, ma.points_balance,
                CASE WHEN l.id IS NOT NULL THEN jsonb_build_object('id', l.id, 'display_name', l.display_name, 'level_order', l.level_order) END AS level,
                COALESCE((SELECT jsonb_agg(identity ORDER BY kind_order, display_name, id) FROM (
                    SELECT DISTINCT g.id, g.display_name,
                        CASE WHEN m.membership_kind = 'base' THEN 0 ELSE 1 END AS kind_order,
                        jsonb_build_object('id', g.id, 'display_name', g.display_name, 'membership_kind', m.membership_kind) AS identity
                    FROM community_group_memberships m JOIN community_groups g ON g.id = m.group_id
                    WHERE m.user_id = u.id AND m.revoked_at IS NULL AND g.status = 'active'
                        AND m.starts_at <= $2 AND (m.ends_at IS NULL OR m.ends_at > $2)
                ) identities), '[]'::jsonb) AS groups,
                COALESCE((SELECT jsonb_agg(identity ORDER BY display_name, id) FROM (
                    SELECT DISTINCT t.id, t.display_name,
                        jsonb_build_object('type_id', t.id, 'internal_key', t.internal_key, 'display_name', t.display_name) AS identity
                    FROM user_standard_entitlements e JOIN standard_entitlement_types t ON t.id = e.entitlement_type_id
                    WHERE e.user_id = u.id AND e.revoked_at IS NULL
                        AND e.starts_at <= $2 AND (e.ends_at IS NULL OR e.ends_at > $2)
                ) identities), '[]'::jsonb) AS entitlements,
                (SELECT COUNT(*) FROM membership_medals m WHERE m.user_id = u.id) AS medal_count
             FROM users u LEFT JOIN experience_accounts ea ON ea.user_id = u.id
             LEFT JOIN membership_levels l ON l.id = ea.current_level_id
             LEFT JOIN membership_accounts ma ON ma.user_id = u.id
             WHERE u.id = ANY($1)"
        ).bind(user_ids).bind(effective_at).fetch_all(&self.pool).await?)
    }
}
