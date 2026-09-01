use std::{collections::BTreeMap, error::Error, fmt};

use serde_json::{Value, json};
use sqlx::{FromRow, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::community_groups::{COMMUNITY_PERMISSION_KEYS, COMMUNITY_QUOTA_KEYS};
use crate::{Database, DatabaseError, NewOutboxEvent, OutboxError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutStandardEntitlementTypeRecord {
    pub internal_key: String,
    pub display_name: String,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub expected_revision: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandardEntitlementTypeRecord {
    pub id: Uuid,
    pub internal_key: String,
    pub display_name: String,
    pub status: String,
    pub current_version: i32,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub revision: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandardEntitlementVersionRecord {
    pub id: Uuid,
    pub entitlement_type_id: Uuid,
    pub version: i32,
    pub permission_keys: Vec<String>,
    pub quotas: BTreeMap<String, i64>,
    pub created_by: Uuid,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantStandardEntitlementRecord {
    pub user_id: Uuid,
    pub entitlement_type_id: Uuid,
    pub actor_id: Uuid,
    pub source: String,
    pub source_reference_id: Option<String>,
    pub reason: String,
    pub starts_at: OffsetDateTime,
    pub ends_at: Option<OffsetDateTime>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevokeStandardEntitlementRecord {
    pub entitlement_id: Uuid,
    pub actor_id: Uuid,
    pub expected_revision: i64,
    pub reason: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct StandardEntitlementRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub entitlement_type_id: Uuid,
    pub entitlement_key: String,
    pub type_version: i32,
    pub permission_snapshot: Vec<String>,
    #[sqlx(skip)]
    pub quota_snapshot: BTreeMap<String, i64>,
    pub source: String,
    pub source_reference_id: Option<String>,
    pub reason: String,
    pub starts_at: OffsetDateTime,
    pub ends_at: Option<OffsetDateTime>,
    pub revoked_at: Option<OffsetDateTime>,
    pub revoked_by: Option<Uuid>,
    pub revocation_reason: Option<String>,
    pub revision: i64,
    pub granted_by: Uuid,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandardEntitlementGrantResult {
    pub entitlement: StandardEntitlementRecord,
    pub replayed: bool,
}

#[derive(Debug)]
pub enum StandardEntitlementMutationError {
    Forbidden,
    TypeNotFound,
    EntitlementNotFound,
    UserNotFound,
    InvalidBenefits,
    InvalidInput,
    RevisionConflict,
    IdempotencyConflict,
    Database(DatabaseError),
    Outbox(OutboxError),
}

impl Database {
    pub async fn put_standard_entitlement_type(
        &self,
        actor_id: Uuid,
        input: PutStandardEntitlementTypeRecord,
    ) -> Result<StandardEntitlementTypeRecord, StandardEntitlementMutationError> {
        let permission_keys = normalize_permissions(&input.permission_keys)
            .ok_or(StandardEntitlementMutationError::InvalidBenefits)?;
        if !valid_quotas(&input.quotas) {
            return Err(StandardEntitlementMutationError::InvalidBenefits);
        }
        if !valid_internal_key(&input.internal_key)
            || input.display_name.trim() != input.display_name
            || !(1..=80).contains(&input.display_name.chars().count())
        {
            return Err(StandardEntitlementMutationError::InvalidInput);
        }
        let quota_value = serde_json::to_value(&input.quotas)
            .map_err(|_| StandardEntitlementMutationError::InvalidBenefits)?;
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::ENTITLEMENT_TYPES_WRITE,
            None,
        )
        .await?
        {
            return Err(StandardEntitlementMutationError::Forbidden);
        }
        let actor_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND status <> 'suspended')",
        )
        .bind(actor_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !actor_exists {
            return Err(StandardEntitlementMutationError::UserNotFound);
        }
        let existing = sqlx::query_as::<_, EntitlementTypeStateRow>(
            "SELECT id, current_version, revision
             FROM standard_entitlement_types WHERE internal_key = $1 FOR UPDATE",
        )
        .bind(&input.internal_key)
        .fetch_optional(&mut *transaction)
        .await?;
        let (type_id, version) = match (existing, input.expected_revision) {
            (None, None) => {
                let type_id = Uuid::now_v7();
                sqlx::query(
                    "INSERT INTO standard_entitlement_types
                        (id, internal_key, display_name)
                     VALUES ($1, $2, $3)",
                )
                .bind(type_id)
                .bind(&input.internal_key)
                .bind(&input.display_name)
                .execute(&mut *transaction)
                .await?;
                (type_id, 1)
            }
            (Some(existing), Some(expected_revision)) if existing.revision == expected_revision => {
                let version = existing.current_version + 1;
                sqlx::query(
                    "UPDATE standard_entitlement_types
                     SET display_name = $2, current_version = $3,
                         revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1",
                )
                .bind(existing.id)
                .bind(&input.display_name)
                .bind(version)
                .execute(&mut *transaction)
                .await?;
                (existing.id, version)
            }
            (None, Some(_)) => return Err(StandardEntitlementMutationError::TypeNotFound),
            _ => return Err(StandardEntitlementMutationError::RevisionConflict),
        };
        sqlx::query(
            "INSERT INTO standard_entitlement_versions
                (id, entitlement_type_id, version, permission_keys, quotas, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(Uuid::now_v7())
        .bind(type_id)
        .bind(version)
        .bind(&permission_keys)
        .bind(&quota_value)
        .bind(actor_id)
        .execute(&mut *transaction)
        .await?;
        let record = fetch_entitlement_type(&mut transaction, type_id).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "standard_entitlement.type.put",
            "standard_entitlement_type",
            Some(type_id),
            json!({
                "internal_key": record.internal_key,
                "current_version": record.current_version,
                "permission_keys": record.permission_keys,
                "quotas": record.quotas,
                "revision": record.revision,
            }),
        )
        .await?;
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "standard_entitlement.type_published".to_owned(),
                aggregate_type: "standard_entitlement_type".to_owned(),
                aggregate_id: type_id,
                dedupe_key: format!("{type_id}:{version}"),
                payload: json!({
                    "entitlement_type_id": type_id,
                    "internal_key": record.internal_key,
                    "version": version,
                    "revision": record.revision,
                }),
                max_attempts: 10,
            },
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
    }
}

impl Database {
    pub async fn list_standard_entitlement_types(
        &self,
    ) -> Result<Vec<StandardEntitlementTypeRecord>, DatabaseError> {
        let rows = sqlx::query_as::<_, EntitlementTypeRow>(
            "SELECT entitlement_type.id, entitlement_type.internal_key,
                    entitlement_type.display_name, entitlement_type.status,
                    entitlement_type.current_version, version.permission_keys,
                    version.quotas, entitlement_type.revision,
                    entitlement_type.created_at, entitlement_type.updated_at
             FROM standard_entitlement_types AS entitlement_type
             INNER JOIN standard_entitlement_versions AS version
               ON version.entitlement_type_id = entitlement_type.id
              AND version.version = entitlement_type.current_version
             ORDER BY entitlement_type.internal_key",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(map_type_row)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| {
                DatabaseError::from(sqlx::Error::Protocol(
                    "invalid entitlement type projection".to_owned(),
                ))
            })
    }

    pub async fn list_standard_entitlement_versions(
        &self,
        internal_key: &str,
    ) -> Result<Vec<StandardEntitlementVersionRecord>, DatabaseError> {
        let rows = sqlx::query_as::<_, EntitlementVersionRow>(
            "SELECT version.id, version.entitlement_type_id, version.version,
                    version.permission_keys, version.quotas, version.created_by,
                    version.created_at
             FROM standard_entitlement_versions AS version
             INNER JOIN standard_entitlement_types AS entitlement_type
               ON entitlement_type.id = version.entitlement_type_id
             WHERE entitlement_type.internal_key = $1
             ORDER BY version.version DESC",
        )
        .bind(internal_key)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(map_version_row)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| {
                DatabaseError::from(sqlx::Error::Protocol(
                    "invalid entitlement version projection".to_owned(),
                ))
            })
    }

    pub async fn list_standard_entitlements_for_admin(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<StandardEntitlementRecord>, DatabaseError> {
        let rows = sqlx::query_as::<_, EntitlementRow>(
            "SELECT id, user_id, entitlement_type_id, entitlement_key, type_version,
                    permission_snapshot, quota_snapshot, source, source_reference_id,
                    reason, starts_at, ends_at, revoked_at, revoked_by,
                    revocation_reason, revoke_idempotency_key, revision, granted_by,
                    created_at, updated_at
             FROM user_standard_entitlements WHERE user_id = $1
             ORDER BY created_at DESC, id DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(map_entitlement_row)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| {
                DatabaseError::from(sqlx::Error::Protocol(
                    "invalid entitlement projection".to_owned(),
                ))
            })
    }

    pub async fn standard_entitlement_subject(
        &self,
        entitlement_id: Uuid,
    ) -> Result<Option<Uuid>, DatabaseError> {
        Ok(sqlx::query_scalar::<_, Uuid>(
            "SELECT user_id FROM user_standard_entitlements WHERE id = $1",
        )
        .bind(entitlement_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn grant_standard_entitlement(
        &self,
        input: GrantStandardEntitlementRecord,
    ) -> Result<StandardEntitlementGrantResult, StandardEntitlementMutationError> {
        self.grant_standard_entitlement_with_authorization(input, true)
            .await
    }

    pub(crate) async fn grant_standard_entitlement_from_plugin(
        &self,
        input: GrantStandardEntitlementRecord,
    ) -> Result<StandardEntitlementGrantResult, StandardEntitlementMutationError> {
        self.grant_standard_entitlement_with_authorization(input, false)
            .await
    }

    async fn grant_standard_entitlement_with_authorization(
        &self,
        input: GrantStandardEntitlementRecord,
        enforce_admin_authorization: bool,
    ) -> Result<StandardEntitlementGrantResult, StandardEntitlementMutationError> {
        if !valid_source(&input.source)
            || input
                .source_reference_id
                .as_ref()
                .is_some_and(|value| value.is_empty() || value.len() > 128)
            || !(1..=200).contains(&input.reason.chars().count())
            || input.reason.chars().any(char::is_control)
            || input.idempotency_key.is_empty()
            || input.idempotency_key.len() > 128
            || input
                .ends_at
                .is_some_and(|ends_at| ends_at <= input.starts_at)
        {
            return Err(StandardEntitlementMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if enforce_admin_authorization
            && !has_permission_with_executor(
                &mut transaction,
                input.actor_id,
                permission_keys::ENTITLEMENT_GRANTS_WRITE,
                None,
            )
            .await?
        {
            return Err(StandardEntitlementMutationError::Forbidden);
        }
        let users_exist = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM users
             WHERE id = ANY($1) AND status IN ('active', 'restricted')",
        )
        .bind(vec![input.user_id, input.actor_id])
        .fetch_one(&mut *transaction)
        .await?;
        let expected_users = if input.user_id == input.actor_id {
            1
        } else {
            2
        };
        if users_exist != expected_users {
            return Err(StandardEntitlementMutationError::UserNotFound);
        }

        let existing = fetch_entitlement_by_idempotency(
            &mut transaction,
            input.user_id,
            &input.idempotency_key,
        )
        .await?;
        if let Some(existing) = existing {
            if existing.entitlement_type_id == input.entitlement_type_id
                && existing.source == input.source
                && existing.source_reference_id == input.source_reference_id
                && existing.reason == input.reason
                && same_postgres_timestamp(existing.starts_at, input.starts_at)
                && same_optional_postgres_timestamp(existing.ends_at, input.ends_at)
            {
                transaction.commit().await?;
                return Ok(StandardEntitlementGrantResult {
                    entitlement: existing,
                    replayed: true,
                });
            }
            return Err(StandardEntitlementMutationError::IdempotencyConflict);
        }

        let entitlement_type = sqlx::query_as::<_, GrantTypeRow>(
            "SELECT entitlement_type.id, entitlement_type.internal_key,
                    entitlement_type.current_version, version.permission_keys, version.quotas
             FROM standard_entitlement_types AS entitlement_type
             INNER JOIN standard_entitlement_versions AS version
               ON version.entitlement_type_id = entitlement_type.id
              AND version.version = entitlement_type.current_version
             WHERE entitlement_type.id = $1 AND entitlement_type.status = 'active'
             FOR SHARE OF entitlement_type, version",
        )
        .bind(input.entitlement_type_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(StandardEntitlementMutationError::TypeNotFound)?;
        let entitlement_id = Uuid::now_v7();
        let record = sqlx::query_as::<_, EntitlementRow>(
            "INSERT INTO user_standard_entitlements
                (id, user_id, entitlement_type_id, entitlement_key, type_version,
                 permission_snapshot, quota_snapshot, source, source_reference_id,
                 reason, starts_at, ends_at, idempotency_key, granted_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id, user_id, entitlement_type_id, entitlement_key, type_version,
                       permission_snapshot, quota_snapshot, source, source_reference_id,
                       reason, starts_at, ends_at, revoked_at, revoked_by,
                       revocation_reason, revoke_idempotency_key, revision, granted_by,
                       created_at, updated_at",
        )
        .bind(entitlement_id)
        .bind(input.user_id)
        .bind(entitlement_type.id)
        .bind(&entitlement_type.internal_key)
        .bind(entitlement_type.current_version)
        .bind(&entitlement_type.permission_keys)
        .bind(&entitlement_type.quotas)
        .bind(&input.source)
        .bind(&input.source_reference_id)
        .bind(&input.reason)
        .bind(input.starts_at)
        .bind(input.ends_at)
        .bind(&input.idempotency_key)
        .bind(input.actor_id)
        .fetch_one(&mut *transaction)
        .await?;
        let record = map_entitlement_row(record)?;
        insert_audit(
            &mut transaction,
            input.actor_id,
            "standard_entitlement.grant",
            "standard_entitlement",
            Some(record.id),
            json!({
                "user_id": record.user_id,
                "entitlement_type_id": record.entitlement_type_id,
                "entitlement_key": record.entitlement_key,
                "type_version": record.type_version,
                "source": record.source,
                "starts_at_unix": record.starts_at.unix_timestamp(),
                "ends_at_unix": record.ends_at.map(OffsetDateTime::unix_timestamp),
                "revision": record.revision,
            }),
        )
        .await?;
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "standard_entitlement.granted".to_owned(),
                aggregate_type: "standard_entitlement".to_owned(),
                aggregate_id: record.id,
                dedupe_key: input.idempotency_key.clone(),
                payload: json!({
                    "entitlement_id": record.id,
                    "user_id": record.user_id,
                    "entitlement_key": record.entitlement_key,
                    "type_version": record.type_version,
                    "permission_snapshot": record.permission_snapshot,
                    "quota_snapshot": record.quota_snapshot,
                    "starts_at_unix": record.starts_at.unix_timestamp(),
                    "ends_at_unix": record.ends_at.map(OffsetDateTime::unix_timestamp),
                    "revision": record.revision,
                }),
                max_attempts: 10,
            },
        )
        .await?;
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "entitlement.changed".to_owned(),
                aggregate_type: "user".to_owned(),
                aggregate_id: record.user_id,
                dedupe_key: input.idempotency_key,
                payload: json!({
                    "operation": "granted",
                    "entitlement_id": record.id,
                    "user_id": record.user_id,
                    "entitlement_key": record.entitlement_key,
                    "type_version": record.type_version,
                    "starts_at_unix": record.starts_at.unix_timestamp(),
                    "ends_at_unix": record.ends_at.map(OffsetDateTime::unix_timestamp),
                    "revision": record.revision,
                }),
                max_attempts: 10,
            },
        )
        .await?;
        transaction.commit().await?;
        Ok(StandardEntitlementGrantResult {
            entitlement: record,
            replayed: false,
        })
    }

    pub async fn list_active_standard_entitlements(
        &self,
        user_id: Uuid,
        effective_at: OffsetDateTime,
    ) -> Result<Vec<StandardEntitlementRecord>, DatabaseError> {
        let rows = sqlx::query_as::<_, EntitlementRow>(
            "SELECT id, user_id, entitlement_type_id, entitlement_key, type_version,
                    permission_snapshot, quota_snapshot, source, source_reference_id,
                    reason, starts_at, ends_at, revoked_at, revoked_by,
                    revocation_reason, revoke_idempotency_key, revision, granted_by,
                    created_at, updated_at
             FROM user_standard_entitlements
             WHERE user_id = $1 AND revoked_at IS NULL
               AND starts_at <= $2 AND (ends_at IS NULL OR ends_at > $2)
             ORDER BY entitlement_key, starts_at, id",
        )
        .bind(user_id)
        .bind(effective_at)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(map_entitlement_row)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| match error {
                StandardEntitlementMutationError::Database(error) => error,
                _ => DatabaseError::from(sqlx::Error::Protocol(
                    "invalid standard entitlement projection".to_owned(),
                )),
            })
    }

    pub async fn revoke_standard_entitlement(
        &self,
        input: RevokeStandardEntitlementRecord,
    ) -> Result<StandardEntitlementGrantResult, StandardEntitlementMutationError> {
        self.revoke_standard_entitlement_with_authorization(input, true)
            .await
    }

    pub(crate) async fn revoke_standard_entitlement_from_plugin(
        &self,
        input: RevokeStandardEntitlementRecord,
    ) -> Result<StandardEntitlementGrantResult, StandardEntitlementMutationError> {
        self.revoke_standard_entitlement_with_authorization(input, false)
            .await
    }

    async fn revoke_standard_entitlement_with_authorization(
        &self,
        input: RevokeStandardEntitlementRecord,
        enforce_admin_authorization: bool,
    ) -> Result<StandardEntitlementGrantResult, StandardEntitlementMutationError> {
        if input.expected_revision < 1
            || !(1..=200).contains(&input.reason.chars().count())
            || input.reason.chars().any(char::is_control)
            || input.idempotency_key.is_empty()
            || input.idempotency_key.len() > 128
        {
            return Err(StandardEntitlementMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if enforce_admin_authorization
            && !has_permission_with_executor(
                &mut transaction,
                input.actor_id,
                permission_keys::ENTITLEMENT_GRANTS_WRITE,
                None,
            )
            .await?
        {
            return Err(StandardEntitlementMutationError::Forbidden);
        }
        let actor_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
                 SELECT 1 FROM users WHERE id = $1 AND status IN ('active', 'restricted')
             )",
        )
        .bind(input.actor_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !actor_exists {
            return Err(StandardEntitlementMutationError::UserNotFound);
        }
        let row = sqlx::query_as::<_, EntitlementRow>(
            "SELECT id, user_id, entitlement_type_id, entitlement_key, type_version,
                    permission_snapshot, quota_snapshot, source, source_reference_id,
                    reason, starts_at, ends_at, revoked_at, revoked_by,
                    revocation_reason, revoke_idempotency_key, revision, granted_by,
                    created_at, updated_at
             FROM user_standard_entitlements WHERE id = $1 FOR UPDATE",
        )
        .bind(input.entitlement_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(StandardEntitlementMutationError::EntitlementNotFound)?;
        if row.revoked_at.is_some() {
            if row.revocation_reason.as_deref() == Some(input.reason.as_str())
                && row.revoke_idempotency_key.as_deref() == Some(input.idempotency_key.as_str())
            {
                transaction.commit().await?;
                return Ok(StandardEntitlementGrantResult {
                    entitlement: map_entitlement_row(row)?,
                    replayed: true,
                });
            }
            return Err(StandardEntitlementMutationError::RevisionConflict);
        }
        if row.revision != input.expected_revision {
            return Err(StandardEntitlementMutationError::RevisionConflict);
        }
        let row = sqlx::query_as::<_, EntitlementRow>(
            "UPDATE user_standard_entitlements
             SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2,
                 revocation_reason = $3, revoke_idempotency_key = $4,
                 revision = revision + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id, user_id, entitlement_type_id, entitlement_key, type_version,
                       permission_snapshot, quota_snapshot, source, source_reference_id,
                       reason, starts_at, ends_at, revoked_at, revoked_by,
                       revocation_reason, revoke_idempotency_key, revision, granted_by,
                       created_at, updated_at",
        )
        .bind(input.entitlement_id)
        .bind(input.actor_id)
        .bind(&input.reason)
        .bind(&input.idempotency_key)
        .fetch_one(&mut *transaction)
        .await?;
        let record = map_entitlement_row(row)?;
        insert_audit(
            &mut transaction,
            input.actor_id,
            "standard_entitlement.revoke",
            "standard_entitlement",
            Some(record.id),
            json!({
                "user_id": record.user_id,
                "entitlement_key": record.entitlement_key,
                "revision": record.revision,
            }),
        )
        .await?;
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "standard_entitlement.revoked".to_owned(),
                aggregate_type: "standard_entitlement".to_owned(),
                aggregate_id: record.id,
                dedupe_key: input.idempotency_key.clone(),
                payload: json!({
                    "entitlement_id": record.id,
                    "user_id": record.user_id,
                    "entitlement_key": record.entitlement_key,
                    "revision": record.revision,
                }),
                max_attempts: 10,
            },
        )
        .await?;
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "entitlement.changed".to_owned(),
                aggregate_type: "user".to_owned(),
                aggregate_id: record.user_id,
                dedupe_key: input.idempotency_key,
                payload: json!({
                    "operation": "revoked",
                    "entitlement_id": record.id,
                    "user_id": record.user_id,
                    "entitlement_key": record.entitlement_key,
                    "revision": record.revision,
                }),
                max_attempts: 10,
            },
        )
        .await?;
        transaction.commit().await?;
        Ok(StandardEntitlementGrantResult {
            entitlement: record,
            replayed: false,
        })
    }
}

#[derive(Debug, FromRow)]
struct EntitlementTypeStateRow {
    id: Uuid,
    current_version: i32,
    revision: i64,
}

#[derive(Debug, FromRow)]
struct EntitlementTypeRow {
    id: Uuid,
    internal_key: String,
    display_name: String,
    status: String,
    current_version: i32,
    permission_keys: Vec<String>,
    quotas: Value,
    revision: i64,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct EntitlementVersionRow {
    id: Uuid,
    entitlement_type_id: Uuid,
    version: i32,
    permission_keys: Vec<String>,
    quotas: Value,
    created_by: Uuid,
    created_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct GrantTypeRow {
    id: Uuid,
    internal_key: String,
    current_version: i32,
    permission_keys: Vec<String>,
    quotas: Value,
}

#[derive(Debug, FromRow)]
struct EntitlementRow {
    id: Uuid,
    user_id: Uuid,
    entitlement_type_id: Uuid,
    entitlement_key: String,
    type_version: i32,
    permission_snapshot: Vec<String>,
    quota_snapshot: Value,
    source: String,
    source_reference_id: Option<String>,
    reason: String,
    starts_at: OffsetDateTime,
    ends_at: Option<OffsetDateTime>,
    revoked_at: Option<OffsetDateTime>,
    revoked_by: Option<Uuid>,
    revocation_reason: Option<String>,
    revoke_idempotency_key: Option<String>,
    revision: i64,
    granted_by: Uuid,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

async fn fetch_entitlement_type(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    type_id: Uuid,
) -> Result<StandardEntitlementTypeRecord, StandardEntitlementMutationError> {
    let row = sqlx::query_as::<_, EntitlementTypeRow>(
        "SELECT entitlement_type.id, entitlement_type.internal_key,
                entitlement_type.display_name, entitlement_type.status,
                entitlement_type.current_version, version.permission_keys,
                version.quotas, entitlement_type.revision,
                entitlement_type.created_at, entitlement_type.updated_at
         FROM standard_entitlement_types AS entitlement_type
         INNER JOIN standard_entitlement_versions AS version
           ON version.entitlement_type_id = entitlement_type.id
          AND version.version = entitlement_type.current_version
         WHERE entitlement_type.id = $1",
    )
    .bind(type_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(StandardEntitlementMutationError::TypeNotFound)?;
    map_type_row(row)
}

fn map_type_row(
    row: EntitlementTypeRow,
) -> Result<StandardEntitlementTypeRecord, StandardEntitlementMutationError> {
    Ok(StandardEntitlementTypeRecord {
        id: row.id,
        internal_key: row.internal_key,
        display_name: row.display_name,
        status: row.status,
        current_version: row.current_version,
        permission_keys: row.permission_keys,
        quotas: quotas_from_value(row.quotas)?,
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn map_version_row(
    row: EntitlementVersionRow,
) -> Result<StandardEntitlementVersionRecord, StandardEntitlementMutationError> {
    Ok(StandardEntitlementVersionRecord {
        id: row.id,
        entitlement_type_id: row.entitlement_type_id,
        version: row.version,
        permission_keys: row.permission_keys,
        quotas: quotas_from_value(row.quotas)?,
        created_by: row.created_by,
        created_at: row.created_at,
    })
}

fn normalize_permissions(permission_keys: &[String]) -> Option<Vec<String>> {
    let mut values = permission_keys.to_vec();
    values.sort();
    values.dedup();
    (values.len() == permission_keys.len()
        && values
            .iter()
            .all(|key| COMMUNITY_PERMISSION_KEYS.contains(&key.as_str())))
    .then_some(values)
}

fn valid_quotas(quotas: &BTreeMap<String, i64>) -> bool {
    quotas
        .iter()
        .all(|(key, value)| *value >= 0 && COMMUNITY_QUOTA_KEYS.contains(&key.as_str()))
}

fn valid_internal_key(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase() || (index > 0 && (byte.is_ascii_digit() || byte == b'_'))
        })
}

fn valid_source(value: &str) -> bool {
    (2..=64).contains(&value.len())
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || (index > 0 && (byte.is_ascii_digit() || matches!(byte, b':' | b'_' | b'-')))
        })
}

fn same_postgres_timestamp(left: OffsetDateTime, right: OffsetDateTime) -> bool {
    left.unix_timestamp_nanos() / 1_000 == right.unix_timestamp_nanos() / 1_000
}

fn same_optional_postgres_timestamp(
    left: Option<OffsetDateTime>,
    right: Option<OffsetDateTime>,
) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => same_postgres_timestamp(left, right),
        (None, None) => true,
        _ => false,
    }
}

async fn fetch_entitlement_by_idempotency(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    idempotency_key: &str,
) -> Result<Option<StandardEntitlementRecord>, StandardEntitlementMutationError> {
    sqlx::query_as::<_, EntitlementRow>(
        "SELECT id, user_id, entitlement_type_id, entitlement_key, type_version,
                permission_snapshot, quota_snapshot, source, source_reference_id,
                reason, starts_at, ends_at, revoked_at, revoked_by,
                revocation_reason, revoke_idempotency_key, revision, granted_by,
                created_at, updated_at
         FROM user_standard_entitlements
         WHERE user_id = $1 AND idempotency_key = $2
         FOR UPDATE",
    )
    .bind(user_id)
    .bind(idempotency_key)
    .fetch_optional(&mut **transaction)
    .await?
    .map(map_entitlement_row)
    .transpose()
}

fn map_entitlement_row(
    row: EntitlementRow,
) -> Result<StandardEntitlementRecord, StandardEntitlementMutationError> {
    Ok(StandardEntitlementRecord {
        id: row.id,
        user_id: row.user_id,
        entitlement_type_id: row.entitlement_type_id,
        entitlement_key: row.entitlement_key,
        type_version: row.type_version,
        permission_snapshot: row.permission_snapshot,
        quota_snapshot: quotas_from_value(row.quota_snapshot)?,
        source: row.source,
        source_reference_id: row.source_reference_id,
        reason: row.reason,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        revoked_at: row.revoked_at,
        revoked_by: row.revoked_by,
        revocation_reason: row.revocation_reason,
        revision: row.revision,
        granted_by: row.granted_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn quotas_from_value(
    value: Value,
) -> Result<BTreeMap<String, i64>, StandardEntitlementMutationError> {
    serde_json::from_value(value).map_err(|_| {
        StandardEntitlementMutationError::Database(DatabaseError::from(sqlx::Error::Protocol(
            "invalid standard entitlement quota snapshot".to_owned(),
        )))
    })
}

impl From<sqlx::Error> for StandardEntitlementMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl From<OutboxError> for StandardEntitlementMutationError {
    fn from(error: OutboxError) -> Self {
        Self::Outbox(error)
    }
}

impl fmt::Display for StandardEntitlementMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("standard entitlement mutation is forbidden"),
            Self::TypeNotFound => formatter.write_str("standard entitlement type was not found"),
            Self::EntitlementNotFound => formatter.write_str("standard entitlement was not found"),
            Self::UserNotFound => formatter.write_str("standard entitlement user was not found"),
            Self::InvalidBenefits => {
                formatter.write_str("standard entitlement benefits are invalid")
            }
            Self::InvalidInput => formatter.write_str("standard entitlement input is invalid"),
            Self::RevisionConflict => {
                formatter.write_str("standard entitlement revision conflicts")
            }
            Self::IdempotencyConflict => {
                formatter.write_str("standard entitlement idempotency conflicts")
            }
            Self::Database(_) => {
                formatter.write_str("standard entitlement database operation failed")
            }
            Self::Outbox(_) => formatter.write_str("standard entitlement outbox operation failed"),
        }
    }
}

impl Error for StandardEntitlementMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Outbox(error) => Some(error),
            Self::Forbidden
            | Self::TypeNotFound
            | Self::EntitlementNotFound
            | Self::UserNotFound
            | Self::InvalidBenefits
            | Self::InvalidInput
            | Self::RevisionConflict
            | Self::IdempotencyConflict => None,
        }
    }
}
