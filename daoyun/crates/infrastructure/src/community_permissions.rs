use std::collections::{BTreeMap, BTreeSet};
use std::{error::Error, fmt};

use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Database, DatabaseError};

const RESTRICTED_WRITE_PERMISSIONS: [&str; 9] = [
    "topic.create",
    "reply.create",
    "message.send",
    "attachment.upload",
    "topic.poll.create",
    "topic.bounty.create",
    "topic.lottery.join",
    "content.external_link.use",
    "profile.signature.use",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommunityGroupPolicy {
    pub membership_id: Uuid,
    pub group_id: Uuid,
    pub group_key: String,
    pub permission_keys: BTreeSet<String>,
    pub quotas: BTreeMap<String, i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StandardEntitlementPolicy {
    pub entitlement_id: Uuid,
    pub entitlement_key: String,
    pub type_version: i32,
    pub permission_keys: BTreeSet<String>,
    pub quotas: BTreeMap<String, i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommunityAccessSnapshot {
    pub user_id: Uuid,
    pub effective_at: OffsetDateTime,
    pub account_status: String,
    pub denied: bool,
    pub denial_reason: Option<String>,
    pub permission_keys: BTreeSet<String>,
    pub blocked_permission_keys: BTreeSet<String>,
    pub quotas: BTreeMap<String, i64>,
    pub sources: Vec<CommunityGroupPolicy>,
    pub entitlement_sources: Vec<StandardEntitlementPolicy>,
}

#[derive(Debug)]
pub enum CommunityAccessError {
    UserNotFound,
    Database(DatabaseError),
}

#[derive(Debug)]
pub(crate) enum CommunityActionError {
    PermissionDenied,
    QuotaExceeded,
    Database(sqlx::Error),
}

pub(crate) async fn verify_community_action_with_executor(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    permission_key: &str,
    effective_at: OffsetDateTime,
) -> Result<(), CommunityActionError> {
    authorize_community_action_with_executor(
        transaction,
        user_id,
        permission_key,
        None,
        None,
        effective_at,
    )
    .await
}

pub(crate) async fn authorize_community_action_with_executor(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    permission_key: &str,
    daily_quota: Option<(&str, i64)>,
    single_limit: Option<(&str, i64)>,
    effective_at: OffsetDateTime,
) -> Result<(), CommunityActionError> {
    let account_status = sqlx::query_scalar::<_, String>("SELECT status FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&mut **transaction)
        .await?
        .ok_or(CommunityActionError::PermissionDenied)?;
    if !matches!(account_status.as_str(), "active" | "restricted")
        || (account_status == "restricted" && is_restricted_write_permission(permission_key))
    {
        return Err(CommunityActionError::PermissionDenied);
    }

    let allowed = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1
             FROM community_group_memberships AS memberships
             JOIN community_groups AS groups
               ON groups.id = memberships.group_id AND groups.status = 'active'
             JOIN community_group_permissions AS permissions
               ON permissions.group_id = groups.id
              AND permissions.permission_key = $2
              AND permissions.allowed
             WHERE memberships.user_id = $1
               AND memberships.revoked_at IS NULL
               AND memberships.starts_at <= $3
               AND (memberships.ends_at IS NULL OR memberships.ends_at > $3)
             UNION ALL
             SELECT 1
             FROM user_standard_entitlements AS entitlement
             WHERE entitlement.user_id = $1
               AND entitlement.revoked_at IS NULL
               AND entitlement.starts_at <= $3
               AND (entitlement.ends_at IS NULL OR entitlement.ends_at > $3)
               AND $2 = ANY(entitlement.permission_snapshot)
         )",
    )
    .bind(user_id)
    .bind(permission_key)
    .bind(effective_at)
    .fetch_one(&mut **transaction)
    .await?;
    if !allowed {
        return Err(CommunityActionError::PermissionDenied);
    }

    if let Some((quota_key, amount)) = single_limit {
        let quota_limit =
            community_quota_limit_with_executor(transaction, user_id, quota_key, effective_at)
                .await?;
        if amount < 0 || amount > quota_limit {
            return Err(CommunityActionError::QuotaExceeded);
        }
    }

    if let Some((quota_key, amount)) = daily_quota {
        if amount < 1 {
            return Err(CommunityActionError::QuotaExceeded);
        }
        let quota_limit =
            community_quota_limit_with_executor(transaction, user_id, quota_key, effective_at)
                .await?;
        if amount > quota_limit {
            return Err(CommunityActionError::QuotaExceeded);
        }
        let consumed = sqlx::query_scalar::<_, i64>(
            "INSERT INTO community_quota_usage (
                 user_id, quota_key, window_start, used
             ) VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, quota_key, window_start) DO UPDATE
             SET used = community_quota_usage.used + EXCLUDED.used,
                 revision = community_quota_usage.revision + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE community_quota_usage.used <= $5 - EXCLUDED.used
             RETURNING used",
        )
        .bind(user_id)
        .bind(quota_key)
        .bind(effective_at.date())
        .bind(amount)
        .bind(quota_limit)
        .fetch_optional(&mut **transaction)
        .await?;
        if consumed.is_none() {
            return Err(CommunityActionError::QuotaExceeded);
        }
    }
    Ok(())
}

pub(crate) async fn community_quota_limit_with_executor(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    quota_key: &str,
    effective_at: OffsetDateTime,
) -> Result<i64, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, Option<i64>>(
        "SELECT MAX(source.quota_value)
         FROM (
             SELECT quotas.quota_value
             FROM community_group_memberships AS memberships
             JOIN community_groups AS groups
               ON groups.id = memberships.group_id AND groups.status = 'active'
             JOIN community_group_quota_rules AS quotas
               ON quotas.group_id = groups.id AND quotas.quota_key = $2
             WHERE memberships.user_id = $1
               AND memberships.revoked_at IS NULL
               AND memberships.starts_at <= $3
               AND (memberships.ends_at IS NULL OR memberships.ends_at > $3)
             UNION ALL
             SELECT (entitlement.quota_snapshot ->> $2)::bigint
             FROM user_standard_entitlements AS entitlement
             WHERE entitlement.user_id = $1
               AND entitlement.revoked_at IS NULL
               AND entitlement.starts_at <= $3
               AND (entitlement.ends_at IS NULL OR entitlement.ends_at > $3)
               AND entitlement.quota_snapshot ? $2
         ) AS source",
    )
    .bind(user_id)
    .bind(quota_key)
    .bind(effective_at)
    .fetch_one(&mut **transaction)
    .await?
    .unwrap_or(0))
}

impl Database {
    pub async fn community_access_snapshot(
        &self,
        user_id: Uuid,
        effective_at: OffsetDateTime,
    ) -> Result<CommunityAccessSnapshot, CommunityAccessError> {
        let account_status =
            sqlx::query_scalar::<_, String>("SELECT status FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?
                .ok_or(CommunityAccessError::UserNotFound)?;

        if account_status == "suspended" || account_status == "deleted" {
            return Ok(merge_community_group_policies(
                user_id,
                effective_at,
                &account_status,
                Vec::new(),
            ));
        }

        let entitlement_sources = self
            .list_active_standard_entitlements(user_id, effective_at)
            .await
            .map_err(CommunityAccessError::Database)?
            .into_iter()
            .map(|entitlement| StandardEntitlementPolicy {
                entitlement_id: entitlement.id,
                entitlement_key: entitlement.entitlement_key,
                type_version: entitlement.type_version,
                permission_keys: entitlement.permission_snapshot.into_iter().collect(),
                quotas: entitlement.quota_snapshot,
            })
            .collect::<Vec<_>>();

        let memberships = self
            .list_active_community_memberships(user_id, effective_at)
            .await?;
        let group_ids = memberships
            .iter()
            .map(|membership| membership.group_id)
            .collect::<Vec<_>>();
        let permission_rules = if group_ids.is_empty() {
            Vec::new()
        } else {
            sqlx::query_as::<_, CommunityPermissionRuleRecord>(
                "SELECT group_id, permission_key
                 FROM community_group_permissions
                 WHERE group_id = ANY($1) AND allowed
                 ORDER BY group_id, permission_key",
            )
            .bind(&group_ids)
            .fetch_all(&self.pool)
            .await?
        };
        let quota_rules = if group_ids.is_empty() {
            Vec::new()
        } else {
            sqlx::query_as::<_, CommunityQuotaRuleRecord>(
                "SELECT group_id, quota_key, quota_value
                 FROM community_group_quota_rules
                 WHERE group_id = ANY($1)
                 ORDER BY group_id, quota_key",
            )
            .bind(&group_ids)
            .fetch_all(&self.pool)
            .await?
        };

        let mut policies = memberships
            .into_iter()
            .map(|membership| {
                (
                    membership.group_id,
                    CommunityGroupPolicy {
                        membership_id: membership.id,
                        group_id: membership.group_id,
                        group_key: membership.group_key,
                        permission_keys: BTreeSet::new(),
                        quotas: BTreeMap::new(),
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        for rule in permission_rules {
            if let Some(policy) = policies.get_mut(&rule.group_id) {
                policy.permission_keys.insert(rule.permission_key);
            }
        }
        for rule in quota_rules {
            if let Some(policy) = policies.get_mut(&rule.group_id) {
                policy.quotas.insert(rule.quota_key, rule.quota_value);
            }
        }

        Ok(merge_community_access_policies(
            user_id,
            effective_at,
            &account_status,
            policies.into_values().collect(),
            entitlement_sources,
        ))
    }
}

pub fn merge_community_group_policies(
    user_id: Uuid,
    effective_at: OffsetDateTime,
    account_status: &str,
    sources: Vec<CommunityGroupPolicy>,
) -> CommunityAccessSnapshot {
    merge_community_access_policies(user_id, effective_at, account_status, sources, Vec::new())
}

pub fn merge_community_access_policies(
    user_id: Uuid,
    effective_at: OffsetDateTime,
    account_status: &str,
    mut sources: Vec<CommunityGroupPolicy>,
    mut entitlement_sources: Vec<StandardEntitlementPolicy>,
) -> CommunityAccessSnapshot {
    sources.sort_by(|left, right| {
        left.group_key
            .cmp(&right.group_key)
            .then(left.membership_id.cmp(&right.membership_id))
    });
    entitlement_sources.sort_by(|left, right| {
        left.entitlement_key
            .cmp(&right.entitlement_key)
            .then(left.entitlement_id.cmp(&right.entitlement_id))
    });

    if !matches!(account_status, "active" | "restricted") {
        return CommunityAccessSnapshot {
            user_id,
            effective_at,
            account_status: account_status.to_owned(),
            denied: true,
            denial_reason: Some(format!("account.{account_status}")),
            permission_keys: BTreeSet::new(),
            blocked_permission_keys: BTreeSet::new(),
            quotas: BTreeMap::new(),
            sources,
            entitlement_sources,
        };
    }

    let mut permission_keys = BTreeSet::new();
    let mut quotas = BTreeMap::<String, i64>::new();
    for source in &sources {
        permission_keys.extend(source.permission_keys.iter().cloned());
        for (key, value) in &source.quotas {
            quotas
                .entry(key.clone())
                .and_modify(|current| *current = (*current).max(*value))
                .or_insert(*value);
        }
    }
    for source in &entitlement_sources {
        permission_keys.extend(source.permission_keys.iter().cloned());
        for (key, value) in &source.quotas {
            quotas
                .entry(key.clone())
                .and_modify(|current| *current = (*current).max(*value))
                .or_insert(*value);
        }
    }

    let mut blocked_permission_keys = BTreeSet::new();
    if account_status == "restricted" {
        for permission in RESTRICTED_WRITE_PERMISSIONS {
            if permission_keys.remove(permission) {
                blocked_permission_keys.insert(permission.to_owned());
            }
        }
    }

    CommunityAccessSnapshot {
        user_id,
        effective_at,
        account_status: account_status.to_owned(),
        denied: false,
        denial_reason: None,
        permission_keys,
        blocked_permission_keys,
        quotas,
        sources,
        entitlement_sources,
    }
}

fn is_restricted_write_permission(permission_key: &str) -> bool {
    RESTRICTED_WRITE_PERMISSIONS.contains(&permission_key)
}

#[derive(Debug, FromRow)]
struct CommunityPermissionRuleRecord {
    group_id: Uuid,
    permission_key: String,
}

#[derive(Debug, FromRow)]
struct CommunityQuotaRuleRecord {
    group_id: Uuid,
    quota_key: String,
    quota_value: i64,
}

impl From<sqlx::Error> for CommunityAccessError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for CommunityAccessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UserNotFound => formatter.write_str("community access user was not found"),
            Self::Database(_) => formatter.write_str("community access evaluation failed"),
        }
    }
}

impl Error for CommunityAccessError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::UserNotFound => None,
        }
    }
}

impl From<sqlx::Error> for CommunityActionError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}
