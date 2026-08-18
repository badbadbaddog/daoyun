use std::collections::{BTreeMap, BTreeSet};
use std::{error::Error, fmt};

use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::{Database, DatabaseError};

pub const COMMUNITY_PERMISSION_KEYS: [&str; 13] = [
    "board.read",
    "topic.read",
    "topic.create",
    "reply.create",
    "message.send",
    "attachment.upload",
    "attachment.download",
    "topic.poll.create",
    "topic.bounty.create",
    "topic.lottery.join",
    "content.external_link.use",
    "profile.signature.use",
    "content.pre_moderation.required",
];

pub const COMMUNITY_QUOTA_KEYS: [&str; 8] = [
    "topic.create.daily",
    "reply.create.daily",
    "message.send.daily",
    "attachment.upload.daily",
    "attachment.file.bytes",
    "attachment.storage.bytes",
    "attachment.download.bytes.daily",
    "content.external_link.daily",
];

const ACTIVE_MEMBERSHIPS_QUERY: &str =
    "SELECT memberships.id, memberships.user_id, memberships.group_id,
            groups.internal_key AS group_key, groups.display_name AS group_display_name,
            memberships.membership_kind, memberships.source,
            memberships.source_reference_id, memberships.reason, memberships.starts_at,
            memberships.ends_at, memberships.revoked_at, memberships.revoked_by,
            memberships.revocation_reason, memberships.idempotency_key,
            memberships.revoke_idempotency_key, memberships.revision,
            memberships.granted_by, memberships.created_at, memberships.updated_at
     FROM community_group_memberships AS memberships
     JOIN community_groups AS groups ON groups.id = memberships.group_id
     WHERE memberships.user_id = $1
       AND memberships.revoked_at IS NULL
       AND memberships.starts_at <= $2
       AND (memberships.ends_at IS NULL OR memberships.ends_at > $2)
       AND groups.status = 'active'
     ORDER BY
         CASE memberships.membership_kind WHEN 'base' THEN 0 ELSE 1 END,
         groups.display_order,
         memberships.id";

const MEMBERSHIP_BY_IDEMPOTENCY_QUERY: &str =
    "SELECT memberships.id, memberships.user_id, memberships.group_id,
            groups.internal_key AS group_key, groups.display_name AS group_display_name,
            memberships.membership_kind, memberships.source,
            memberships.source_reference_id, memberships.reason, memberships.starts_at,
            memberships.ends_at, memberships.revoked_at, memberships.revoked_by,
            memberships.revocation_reason, memberships.idempotency_key,
            memberships.revoke_idempotency_key, memberships.revision,
            memberships.granted_by, memberships.created_at, memberships.updated_at
     FROM community_group_memberships AS memberships
     JOIN community_groups AS groups ON groups.id = memberships.group_id
     WHERE memberships.user_id = $1 AND memberships.idempotency_key = $2";

const MEMBERSHIP_BY_ID_QUERY: &str =
    "SELECT memberships.id, memberships.user_id, memberships.group_id,
            groups.internal_key AS group_key, groups.display_name AS group_display_name,
            memberships.membership_kind, memberships.source,
            memberships.source_reference_id, memberships.reason, memberships.starts_at,
            memberships.ends_at, memberships.revoked_at, memberships.revoked_by,
            memberships.revocation_reason, memberships.idempotency_key,
            memberships.revoke_idempotency_key, memberships.revision,
            memberships.granted_by, memberships.created_at, memberships.updated_at
     FROM community_group_memberships AS memberships
     JOIN community_groups AS groups ON groups.id = memberships.group_id
     WHERE memberships.id = $1";

const MEMBERSHIP_BY_ID_FOR_UPDATE_QUERY: &str =
    "SELECT memberships.id, memberships.user_id, memberships.group_id,
            groups.internal_key AS group_key, groups.display_name AS group_display_name,
            memberships.membership_kind, memberships.source,
            memberships.source_reference_id, memberships.reason, memberships.starts_at,
            memberships.ends_at, memberships.revoked_at, memberships.revoked_by,
            memberships.revocation_reason, memberships.idempotency_key,
            memberships.revoke_idempotency_key, memberships.revision,
            memberships.granted_by, memberships.created_at, memberships.updated_at
     FROM community_group_memberships AS memberships
     JOIN community_groups AS groups ON groups.id = memberships.group_id
     WHERE memberships.id = $1
     FOR UPDATE OF memberships";

#[derive(Clone, Debug, FromRow)]
pub struct CommunityGroupMembershipRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub group_id: Uuid,
    pub group_key: String,
    pub group_display_name: String,
    pub membership_kind: String,
    pub source: String,
    pub source_reference_id: Option<Uuid>,
    pub reason: String,
    pub starts_at: OffsetDateTime,
    pub ends_at: Option<OffsetDateTime>,
    pub revoked_at: Option<OffsetDateTime>,
    pub revoked_by: Option<Uuid>,
    pub revocation_reason: Option<String>,
    pub idempotency_key: String,
    pub revoke_idempotency_key: Option<String>,
    pub revision: i64,
    pub granted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommunityGroupConfigurationRecord {
    pub id: Uuid,
    pub internal_key: String,
    pub display_name: String,
    pub description: String,
    pub is_base: bool,
    pub status: String,
    pub display_order: i32,
    pub permission_keys: BTreeSet<String>,
    pub quotas: BTreeMap<String, i64>,
    pub revision: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct CreateCommunityGroupRecord {
    pub internal_key: String,
    pub display_name: String,
    pub description: String,
    pub is_base: bool,
    pub display_order: i32,
    pub permission_keys: BTreeSet<String>,
    pub quotas: BTreeMap<String, i64>,
}

#[derive(Clone, Debug)]
pub struct UpdateCommunityGroupRecord {
    pub id: Uuid,
    pub expected_revision: i64,
    pub display_name: String,
    pub description: String,
    pub status: String,
    pub display_order: i32,
    pub permission_keys: BTreeSet<String>,
    pub quotas: BTreeMap<String, i64>,
}

#[derive(Clone, Debug)]
pub struct GrantCommunityMembershipRecord {
    pub user_id: Uuid,
    pub group_id: Uuid,
    pub membership_kind: String,
    pub source: String,
    pub source_reference_id: Option<Uuid>,
    pub reason: String,
    pub starts_at: OffsetDateTime,
    pub ends_at: Option<OffsetDateTime>,
    pub idempotency_key: String,
}

#[derive(Clone, Debug)]
pub struct CommunityMembershipMutationResult {
    pub membership: CommunityGroupMembershipRecord,
    pub replayed: bool,
}

#[derive(Debug)]
pub enum CommunityMembershipMutationError {
    Forbidden,
    UserNotFound,
    GroupNotFound,
    GroupUnavailable,
    KindMismatch,
    InvalidInput,
    ActiveMembershipConflict,
    IdempotencyConflict,
    MembershipNotFound,
    RevisionConflict,
    AlreadyRevoked,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum CommunityGroupMutationError {
    Forbidden,
    NotFound,
    Conflict,
    Duplicate,
    InvalidInput,
    InvalidTransition,
    SystemManaged,
    Database(DatabaseError),
}

impl Database {
    pub async fn list_community_group_configurations(
        &self,
    ) -> Result<Vec<CommunityGroupConfigurationRecord>, sqlx::Error> {
        let rows = sqlx::query_as::<_, CommunityGroupRow>(
            "SELECT id, internal_key, display_name, description, is_base, status,
                    display_order, revision, created_at, updated_at
             FROM community_groups
             ORDER BY display_order, id",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut groups = Vec::with_capacity(rows.len());
        for row in rows {
            groups.push(fetch_group_configuration_from_pool(&self.pool, row).await?);
        }
        Ok(groups)
    }

    pub async fn create_community_group(
        &self,
        actor_id: Uuid,
        input: CreateCommunityGroupRecord,
    ) -> Result<CommunityGroupConfigurationRecord, CommunityGroupMutationError> {
        if !valid_group_configuration(
            Some(&input.internal_key),
            &input.display_name,
            &input.description,
            input.display_order,
            &input.permission_keys,
            &input.quotas,
        ) {
            return Err(CommunityGroupMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::COMMUNITY_GROUPS_WRITE,
            None,
        )
        .await?
        {
            return Err(CommunityGroupMutationError::Forbidden);
        }
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO community_groups (
                 id, internal_key, display_name, description, is_base, status, display_order
             ) VALUES ($1, $2, $3, $4, $5, 'active', $6)",
        )
        .bind(id)
        .bind(&input.internal_key)
        .bind(&input.display_name)
        .bind(&input.description)
        .bind(input.is_base)
        .bind(input.display_order)
        .execute(&mut *transaction)
        .await
        .map_err(map_group_write_error)?;
        replace_group_rules(&mut transaction, id, &input.permission_keys, &input.quotas).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "community.group.create",
            "community_group",
            Some(id),
            serde_json::json!({
                "internal_key": input.internal_key,
                "is_base": input.is_base,
                "permission_count": input.permission_keys.len(),
                "quota_count": input.quotas.len()
            }),
        )
        .await?;
        let record = fetch_group_configuration(&mut transaction, id).await?;
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn update_community_group(
        &self,
        actor_id: Uuid,
        input: UpdateCommunityGroupRecord,
    ) -> Result<CommunityGroupConfigurationRecord, CommunityGroupMutationError> {
        if input.expected_revision < 1
            || !valid_group_status(&input.status)
            || !valid_group_configuration(
                None,
                &input.display_name,
                &input.description,
                input.display_order,
                &input.permission_keys,
                &input.quotas,
            )
        {
            return Err(CommunityGroupMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::COMMUNITY_GROUPS_WRITE,
            None,
        )
        .await?
        {
            return Err(CommunityGroupMutationError::Forbidden);
        }
        let current = sqlx::query_as::<_, CommunityGroupRow>(
            "SELECT id, internal_key, display_name, description, is_base, status,
                    display_order, revision, created_at, updated_at
             FROM community_groups
             WHERE id = $1
             FOR UPDATE",
        )
        .bind(input.id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(CommunityGroupMutationError::NotFound)?;
        if current.revision != input.expected_revision {
            return Err(CommunityGroupMutationError::Conflict);
        }
        if current.internal_key == "registered_member" && input.status != "active" {
            return Err(CommunityGroupMutationError::SystemManaged);
        }
        if !valid_group_transition(&current.status, &input.status) {
            return Err(CommunityGroupMutationError::InvalidTransition);
        }
        sqlx::query(
            "UPDATE community_groups
             SET display_name = $2, description = $3, status = $4, display_order = $5,
                 revision = revision + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1",
        )
        .bind(input.id)
        .bind(&input.display_name)
        .bind(&input.description)
        .bind(&input.status)
        .bind(input.display_order)
        .execute(&mut *transaction)
        .await
        .map_err(map_group_write_error)?;
        replace_group_rules(
            &mut transaction,
            input.id,
            &input.permission_keys,
            &input.quotas,
        )
        .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "community.group.update",
            "community_group",
            Some(input.id),
            serde_json::json!({
                "status_before": current.status,
                "status_after": input.status,
                "expected_revision": input.expected_revision,
                "permission_count": input.permission_keys.len(),
                "quota_count": input.quotas.len()
            }),
        )
        .await?;
        let record = fetch_group_configuration(&mut transaction, input.id).await?;
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn list_active_community_memberships(
        &self,
        user_id: Uuid,
        effective_at: OffsetDateTime,
    ) -> Result<Vec<CommunityGroupMembershipRecord>, sqlx::Error> {
        sqlx::query_as::<_, CommunityGroupMembershipRecord>(ACTIVE_MEMBERSHIPS_QUERY)
            .bind(user_id)
            .bind(effective_at)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn grant_community_membership(
        &self,
        actor_id: Uuid,
        input: GrantCommunityMembershipRecord,
    ) -> Result<CommunityMembershipMutationResult, CommunityMembershipMutationError> {
        if !valid_grant_input(&input) {
            return Err(CommunityMembershipMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::COMMUNITY_MEMBERSHIPS_WRITE,
            None,
        )
        .await?
        {
            return Err(CommunityMembershipMutationError::Forbidden);
        }
        let user_exists =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE id = $1 FOR UPDATE")
                .bind(input.user_id)
                .fetch_optional(&mut *transaction)
                .await?
                .is_some();
        if !user_exists {
            return Err(CommunityMembershipMutationError::UserNotFound);
        }

        let existing =
            sqlx::query_as::<_, CommunityGroupMembershipRecord>(MEMBERSHIP_BY_IDEMPOTENCY_QUERY)
                .bind(input.user_id)
                .bind(&input.idempotency_key)
                .fetch_optional(&mut *transaction)
                .await?;
        if let Some(existing) = existing {
            if !same_grant(&existing, &input) {
                return Err(CommunityMembershipMutationError::IdempotencyConflict);
            }
            transaction.commit().await?;
            return Ok(CommunityMembershipMutationResult {
                membership: existing,
                replayed: true,
            });
        }

        let group = sqlx::query_as::<_, CommunityGroupReference>(
            "SELECT internal_key, is_base, status
             FROM community_groups
             WHERE id = $1
             FOR SHARE",
        )
        .bind(input.group_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(CommunityMembershipMutationError::GroupNotFound)?;
        if group.status != "active" {
            return Err(CommunityMembershipMutationError::GroupUnavailable);
        }
        if (input.membership_kind == "base") != group.is_base {
            return Err(CommunityMembershipMutationError::KindMismatch);
        }
        if input.membership_kind == "base" {
            let unrevoked_base_exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(
                     SELECT 1 FROM community_group_memberships
                     WHERE user_id = $1 AND membership_kind = 'base' AND revoked_at IS NULL
                 )",
            )
            .bind(input.user_id)
            .fetch_one(&mut *transaction)
            .await?;
            if unrevoked_base_exists {
                return Err(CommunityMembershipMutationError::ActiveMembershipConflict);
            }
        }

        let overlaps = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
                 SELECT 1
                 FROM community_group_memberships
                 WHERE user_id = $1
                   AND revoked_at IS NULL
                   AND (group_id = $2 OR ($3 = 'base' AND membership_kind = 'base'))
                   AND starts_at < COALESCE($5, 'infinity'::timestamptz)
                   AND COALESCE(ends_at, 'infinity'::timestamptz) > $4
             )",
        )
        .bind(input.user_id)
        .bind(input.group_id)
        .bind(&input.membership_kind)
        .bind(input.starts_at)
        .bind(input.ends_at)
        .fetch_one(&mut *transaction)
        .await?;
        if overlaps {
            return Err(CommunityMembershipMutationError::ActiveMembershipConflict);
        }

        let membership_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO community_group_memberships (
                 id, user_id, group_id, membership_kind, source, source_reference_id,
                 reason, starts_at, ends_at, idempotency_key, granted_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        )
        .bind(membership_id)
        .bind(input.user_id)
        .bind(input.group_id)
        .bind(&input.membership_kind)
        .bind(&input.source)
        .bind(input.source_reference_id)
        .bind(&input.reason)
        .bind(input.starts_at)
        .bind(input.ends_at)
        .bind(&input.idempotency_key)
        .bind(actor_id)
        .execute(&mut *transaction)
        .await?;
        let membership = fetch_membership(&mut transaction, membership_id).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "community.membership.grant",
            "community_group_membership",
            Some(membership_id),
            serde_json::json!({
                "user_id": input.user_id,
                "group_id": input.group_id,
                "group_key": group.internal_key,
                "membership_kind": input.membership_kind,
                "source": input.source,
                "ends_at": input.ends_at.map(|value| value.to_string())
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(CommunityMembershipMutationResult {
            membership,
            replayed: false,
        })
    }

    pub async fn revoke_community_membership(
        &self,
        actor_id: Uuid,
        membership_id: Uuid,
        expected_revision: i64,
        reason: &str,
        idempotency_key: &str,
    ) -> Result<CommunityMembershipMutationResult, CommunityMembershipMutationError> {
        if expected_revision < 1 || !valid_reason(reason) || !valid_idempotency_key(idempotency_key)
        {
            return Err(CommunityMembershipMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::COMMUNITY_MEMBERSHIPS_WRITE,
            None,
        )
        .await?
        {
            return Err(CommunityMembershipMutationError::Forbidden);
        }
        let current =
            sqlx::query_as::<_, CommunityGroupMembershipRecord>(MEMBERSHIP_BY_ID_FOR_UPDATE_QUERY)
                .bind(membership_id)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or(CommunityMembershipMutationError::MembershipNotFound)?;

        if current.revoked_at.is_some() {
            if current.revoke_idempotency_key.as_deref() == Some(idempotency_key)
                && current.revocation_reason.as_deref() == Some(reason)
            {
                transaction.commit().await?;
                return Ok(CommunityMembershipMutationResult {
                    membership: current,
                    replayed: true,
                });
            }
            return Err(CommunityMembershipMutationError::AlreadyRevoked);
        }
        if current.revision != expected_revision {
            return Err(CommunityMembershipMutationError::RevisionConflict);
        }

        sqlx::query(
            "UPDATE community_group_memberships
             SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2, revocation_reason = $3,
                 revoke_idempotency_key = $4, revision = revision + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1",
        )
        .bind(membership_id)
        .bind(actor_id)
        .bind(reason)
        .bind(idempotency_key)
        .execute(&mut *transaction)
        .await?;
        let membership = fetch_membership(&mut transaction, membership_id).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "community.membership.revoke",
            "community_group_membership",
            Some(membership_id),
            serde_json::json!({
                "user_id": membership.user_id,
                "group_id": membership.group_id,
                "reason": reason,
                "revision": membership.revision
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(CommunityMembershipMutationResult {
            membership,
            replayed: false,
        })
    }
}

#[derive(Clone, Debug, FromRow)]
struct CommunityGroupRow {
    id: Uuid,
    internal_key: String,
    display_name: String,
    description: String,
    is_base: bool,
    status: String,
    display_order: i32,
    revision: i64,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct CommunityGroupReference {
    internal_key: String,
    is_base: bool,
    status: String,
}

async fn fetch_group_configuration_from_pool(
    pool: &sqlx::PgPool,
    row: CommunityGroupRow,
) -> Result<CommunityGroupConfigurationRecord, sqlx::Error> {
    let permission_keys = sqlx::query_scalar::<_, String>(
        "SELECT permission_key FROM community_group_permissions
         WHERE group_id = $1 AND allowed ORDER BY permission_key",
    )
    .bind(row.id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    let quotas = sqlx::query_as::<_, (String, i64)>(
        "SELECT quota_key, quota_value FROM community_group_quota_rules
         WHERE group_id = $1 ORDER BY quota_key",
    )
    .bind(row.id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    Ok(build_group_configuration(row, permission_keys, quotas))
}

async fn fetch_group_configuration(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    group_id: Uuid,
) -> Result<CommunityGroupConfigurationRecord, sqlx::Error> {
    let row = sqlx::query_as::<_, CommunityGroupRow>(
        "SELECT id, internal_key, display_name, description, is_base, status,
                display_order, revision, created_at, updated_at
         FROM community_groups WHERE id = $1",
    )
    .bind(group_id)
    .fetch_one(&mut **transaction)
    .await?;
    let permission_keys = sqlx::query_scalar::<_, String>(
        "SELECT permission_key FROM community_group_permissions
         WHERE group_id = $1 AND allowed ORDER BY permission_key",
    )
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .collect();
    let quotas = sqlx::query_as::<_, (String, i64)>(
        "SELECT quota_key, quota_value FROM community_group_quota_rules
         WHERE group_id = $1 ORDER BY quota_key",
    )
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .collect();
    Ok(build_group_configuration(row, permission_keys, quotas))
}

fn build_group_configuration(
    row: CommunityGroupRow,
    permission_keys: BTreeSet<String>,
    quotas: BTreeMap<String, i64>,
) -> CommunityGroupConfigurationRecord {
    CommunityGroupConfigurationRecord {
        id: row.id,
        internal_key: row.internal_key,
        display_name: row.display_name,
        description: row.description,
        is_base: row.is_base,
        status: row.status,
        display_order: row.display_order,
        permission_keys,
        quotas,
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

async fn replace_group_rules(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    group_id: Uuid,
    permission_keys: &BTreeSet<String>,
    quotas: &BTreeMap<String, i64>,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM community_group_permissions WHERE group_id = $1")
        .bind(group_id)
        .execute(&mut **transaction)
        .await?;
    for permission_key in permission_keys {
        sqlx::query(
            "INSERT INTO community_group_permissions (group_id, permission_key)
             VALUES ($1, $2)",
        )
        .bind(group_id)
        .bind(permission_key)
        .execute(&mut **transaction)
        .await?;
    }
    sqlx::query("DELETE FROM community_group_quota_rules WHERE group_id = $1")
        .bind(group_id)
        .execute(&mut **transaction)
        .await?;
    for (quota_key, quota_value) in quotas {
        sqlx::query(
            "INSERT INTO community_group_quota_rules (group_id, quota_key, quota_value)
             VALUES ($1, $2, $3)",
        )
        .bind(group_id)
        .bind(quota_key)
        .bind(quota_value)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn fetch_membership(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    membership_id: Uuid,
) -> Result<CommunityGroupMembershipRecord, sqlx::Error> {
    sqlx::query_as::<_, CommunityGroupMembershipRecord>(MEMBERSHIP_BY_ID_QUERY)
        .bind(membership_id)
        .fetch_one(&mut **transaction)
        .await
}

fn valid_grant_input(input: &GrantCommunityMembershipRecord) -> bool {
    matches!(input.membership_kind.as_str(), "base" | "additional")
        && valid_source(&input.source)
        && valid_reason(&input.reason)
        && valid_idempotency_key(&input.idempotency_key)
        && input
            .ends_at
            .is_none_or(|ends_at| ends_at > input.starts_at)
}

fn valid_group_configuration(
    internal_key: Option<&str>,
    display_name: &str,
    description: &str,
    display_order: i32,
    permission_keys: &BTreeSet<String>,
    quotas: &BTreeMap<String, i64>,
) -> bool {
    internal_key.is_none_or(valid_group_key)
        && display_name == display_name.trim()
        && (1..=80).contains(&display_name.chars().count())
        && !display_name.chars().any(char::is_control)
        && description.chars().count() <= 500
        && !description.chars().any(char::is_control)
        && display_order > 0
        && permission_keys
            .iter()
            .all(|key| COMMUNITY_PERMISSION_KEYS.contains(&key.as_str()))
        && quotas
            .iter()
            .all(|(key, value)| COMMUNITY_QUOTA_KEYS.contains(&key.as_str()) && *value >= 0)
}

fn valid_group_key(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=64).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_lowercase)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
}

fn valid_group_status(value: &str) -> bool {
    matches!(value, "active" | "disabled" | "archived")
}

fn valid_group_transition(current: &str, next: &str) -> bool {
    matches!(
        (current, next),
        ("active", "active" | "disabled" | "archived")
            | ("disabled", "disabled" | "active" | "archived")
    )
}

fn map_group_write_error(error: sqlx::Error) -> CommunityGroupMutationError {
    if matches!(
        &error,
        sqlx::Error::Database(database_error)
            if database_error.code().as_deref() == Some("23505")
    ) {
        CommunityGroupMutationError::Duplicate
    } else {
        CommunityGroupMutationError::Database(DatabaseError::from(error))
    }
}

fn valid_source(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=32).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_lowercase)
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'.')
        })
}

fn valid_reason(value: &str) -> bool {
    value == value.trim()
        && (3..=200).contains(&value.chars().count())
        && !value.chars().any(char::is_control)
}

fn valid_idempotency_key(value: &str) -> bool {
    (1..=128).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn same_grant(
    existing: &CommunityGroupMembershipRecord,
    input: &GrantCommunityMembershipRecord,
) -> bool {
    existing.group_id == input.group_id
        && existing.membership_kind == input.membership_kind
        && existing.source == input.source
        && existing.source_reference_id == input.source_reference_id
        && existing.reason == input.reason
        && same_timestamp(existing.starts_at, input.starts_at)
        && same_optional_timestamp(existing.ends_at, input.ends_at)
}

fn same_timestamp(left: OffsetDateTime, right: OffsetDateTime) -> bool {
    left.unix_timestamp_nanos() / 1_000 == right.unix_timestamp_nanos() / 1_000
}

fn same_optional_timestamp(left: Option<OffsetDateTime>, right: Option<OffsetDateTime>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => same_timestamp(left, right),
        (None, None) => true,
        _ => false,
    }
}

impl From<sqlx::Error> for CommunityMembershipMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for CommunityGroupMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for CommunityMembershipMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("community membership mutation is forbidden"),
            Self::UserNotFound => formatter.write_str("community membership user was not found"),
            Self::GroupNotFound => formatter.write_str("community group was not found"),
            Self::GroupUnavailable => formatter.write_str("community group is unavailable"),
            Self::KindMismatch => formatter.write_str("community membership kind is invalid"),
            Self::InvalidInput => formatter.write_str("community membership input is invalid"),
            Self::ActiveMembershipConflict => {
                formatter.write_str("community membership overlaps an active membership")
            }
            Self::IdempotencyConflict => {
                formatter.write_str("community membership idempotency key conflicts")
            }
            Self::MembershipNotFound => formatter.write_str("community membership was not found"),
            Self::RevisionConflict => {
                formatter.write_str("community membership revision conflicts")
            }
            Self::AlreadyRevoked => formatter.write_str("community membership was already revoked"),
            Self::Database(_) => formatter.write_str("community membership operation failed"),
        }
    }
}

impl Error for CommunityMembershipMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            _ => None,
        }
    }
}

impl fmt::Display for CommunityGroupMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("community group mutation is forbidden"),
            Self::NotFound => formatter.write_str("community group was not found"),
            Self::Conflict => formatter.write_str("community group revision conflicts"),
            Self::Duplicate => formatter.write_str("community group identity conflicts"),
            Self::InvalidInput => formatter.write_str("community group input is invalid"),
            Self::InvalidTransition => formatter.write_str("community group transition is invalid"),
            Self::SystemManaged => formatter.write_str("community group is system managed"),
            Self::Database(_) => formatter.write_str("community group operation failed"),
        }
    }
}

impl Error for CommunityGroupMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            _ => None,
        }
    }
}
