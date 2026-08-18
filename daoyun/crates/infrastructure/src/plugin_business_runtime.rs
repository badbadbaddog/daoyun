use std::{error::Error, fmt, time::Duration};

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction, types::Json};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::notifications::insert_notification;
use crate::{
    Database, DatabaseError, GrantStandardEntitlementRecord, RevokeStandardEntitlementRecord,
};

const MAX_STORAGE_OBJECT_BYTES: usize = 64 * 1024;
const MAX_TASK_PAYLOAD_BYTES: usize = 64 * 1024;
const MAX_CLAIM_BATCH: i64 = 100;
const MAX_LEASE_SECONDS: u64 = 300;
const COMMAND_EXECUTION_LEASE_SECONDS: i64 = 90;
const COMMAND_RECEIPT_WAIT_MILLIS: u64 = 25;
const COMMAND_RECEIPT_WAIT_ATTEMPTS: usize = 200;

#[derive(Clone, Debug)]
pub struct PutPluginStorageObjectRecord {
    pub plugin_id: Uuid,
    pub key: String,
    pub value: Vec<u8>,
    pub content_type: String,
    pub expected_revision: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginStorageObjectRecord {
    pub plugin_id: Uuid,
    pub key: String,
    pub value: Vec<u8>,
    pub content_type: String,
    pub size_bytes: i32,
    pub revision: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct SchedulePluginTaskRecord {
    pub plugin_id: Uuid,
    pub task_key: String,
    pub idempotency_key: String,
    pub payload: Value,
    pub run_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PluginTaskRecord {
    pub id: Uuid,
    pub plugin_id: Uuid,
    pub task_key: String,
    pub idempotency_key: String,
    pub payload: Value,
    pub status: String,
    pub run_at: OffsetDateTime,
    pub attempts: i16,
    pub max_attempts: i16,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginQuotaSnapshot {
    pub storage_bytes_used: i64,
    pub storage_bytes_limit: i64,
    pub pending_tasks: i64,
    pub pending_task_limit: i32,
    pub command_daily_limit: i32,
    pub command_daily_used: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginCommandKind {
    PointsAppend,
    ExperienceAppend,
    EntitlementGrant,
    EntitlementRevoke,
    NotificationSend,
}

#[derive(Clone, Debug)]
pub struct ExecutePluginCommandRecord {
    pub plugin_id: Uuid,
    pub kind: PluginCommandKind,
    pub subject_id: Uuid,
    pub idempotency_key: String,
    pub payload: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PluginCommandResult {
    pub resource_id: Uuid,
    pub replayed: bool,
    pub payload: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginQueryKind {
    Site,
    Actor,
    UserBasic,
    Membership,
    Board,
}

#[derive(Clone, Debug)]
pub struct PluginBusinessExecutableRecord {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub manifest_schema_version: i16,
    pub business_api_version: String,
    pub capabilities: Vec<String>,
    pub data_scopes: Vec<String>,
    pub event_subscriptions: Vec<String>,
    pub component_bytes: Vec<u8>,
    pub component_sha256: String,
    pub revision: i64,
    pub installed_by: Uuid,
}

#[derive(Clone, Debug, PartialEq, FromRow)]
pub struct ClaimedPluginEventDelivery {
    pub plugin_id: Uuid,
    pub outbox_event_id: Uuid,
    pub event_type: String,
    pub aggregate_id: Uuid,
    pub payload: Value,
    pub payload_schema_version: i16,
    pub attempts: i16,
    pub max_attempts: i16,
    pub lock_token: Uuid,
    pub locked_until: OffsetDateTime,
    pub created_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, FromRow)]
pub struct ClaimedPluginTask {
    pub id: Uuid,
    pub plugin_id: Uuid,
    pub task_key: String,
    pub payload: Value,
    pub run_at: OffsetDateTime,
    pub attempts: i16,
    pub max_attempts: i16,
    pub lock_token: Uuid,
    pub locked_until: OffsetDateTime,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginQueueDisposition {
    Pending,
    Dead,
}

#[derive(Debug)]
pub enum PluginRuntimeError {
    NotFound,
    Disabled,
    CapabilityDenied,
    InvalidInput,
    Conflict,
    IdempotencyConflict,
    QuotaExceeded,
    Busy,
    Database(DatabaseError),
}

#[derive(FromRow)]
struct PluginStorageObjectRow {
    plugin_id: Uuid,
    storage_key: String,
    value: Vec<u8>,
    content_type: String,
    size_bytes: i32,
    revision: i64,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(FromRow)]
struct PluginTaskRow {
    id: Uuid,
    plugin_id: Uuid,
    task_key: String,
    idempotency_key: String,
    payload: Json<Value>,
    status: String,
    run_at: OffsetDateTime,
    attempts: i16,
    max_attempts: i16,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(FromRow)]
struct ExistingTaskRow {
    #[sqlx(flatten)]
    task: PluginTaskRow,
    matches_input: bool,
}

#[derive(FromRow)]
struct RuntimeAccessRow {
    key: String,
    status: String,
    business_api_version: Option<String>,
    capabilities: Json<Vec<String>>,
    data_scopes: Json<Vec<String>>,
    storage_bytes_limit: i64,
    pending_task_limit: i32,
    command_daily_limit: i32,
    installed_by: Uuid,
}

#[derive(FromRow)]
struct CommandReceiptRow {
    command_kind: String,
    subject_id: Uuid,
    payload: Json<Value>,
    status: String,
    resource_id: Option<Uuid>,
    result_payload: Option<Json<Value>>,
    locked_until: Option<OffsetDateTime>,
}

enum ValidatedPluginCommand {
    Points(PointsCommandPayload),
    Experience(ExperienceCommandPayload),
    EntitlementGrant {
        payload: EntitlementGrantCommandPayload,
        starts_at: OffsetDateTime,
        ends_at: Option<OffsetDateTime>,
    },
    EntitlementRevoke(EntitlementRevokeCommandPayload),
    Notification(NotificationCommandPayload),
}

enum CommandReservation {
    Execute {
        access: RuntimeAccessRow,
        execution_token: Uuid,
    },
    Replay(PluginCommandResult),
    Wait,
}

#[derive(FromRow)]
struct BusinessExecutableRow {
    id: Uuid,
    key: String,
    status: String,
    name: String,
    version: String,
    description: String,
    manifest_schema_version: i16,
    business_api_version: String,
    capabilities: Json<Vec<String>>,
    data_scopes: Json<Vec<String>>,
    event_subscriptions: Json<Vec<String>>,
    component_bytes: Vec<u8>,
    component_sha256: String,
    revision: i64,
    installed_by: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PointsCommandPayload {
    amount: i64,
    reason: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExperienceCommandPayload {
    amount: i64,
    reason: String,
    #[serde(default)]
    source_resource_id: Option<Uuid>,
    #[serde(default)]
    reversal_of: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EntitlementGrantCommandPayload {
    entitlement_type_id: Uuid,
    reason: String,
    starts_at_unix_ms: i64,
    #[serde(default)]
    ends_at_unix_ms: Option<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EntitlementRevokeCommandPayload {
    expected_revision: i64,
    reason: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NotificationCommandPayload {
    kind: String,
    target_type: String,
    target_id: Uuid,
}

impl Database {
    pub async fn put_plugin_storage_object(
        &self,
        input: PutPluginStorageObjectRecord,
    ) -> Result<PluginStorageObjectRecord, PluginRuntimeError> {
        if !valid_storage_key(&input.key)
            || input.value.len() > MAX_STORAGE_OBJECT_BYTES
            || !valid_content_type(&input.content_type)
            || input.expected_revision.is_some_and(|revision| revision < 1)
        {
            return Err(PluginRuntimeError::InvalidInput);
        }

        let mut transaction = self.pool.begin().await?;
        let access = lock_runtime_access(
            &mut transaction,
            input.plugin_id,
            Some("storage.read_write"),
        )
        .await?;
        let existing = sqlx::query_as::<_, (i32, i64)>(
            "SELECT size_bytes, revision
             FROM plugin_storage_objects
             WHERE plugin_id = $1 AND storage_key = $2
             FOR UPDATE",
        )
        .bind(input.plugin_id)
        .bind(&input.key)
        .fetch_optional(&mut *transaction)
        .await?;
        match (existing, input.expected_revision) {
            (None, None) => {}
            (Some((_, revision)), Some(expected)) if revision == expected => {}
            _ => return Err(PluginRuntimeError::Conflict),
        }
        let current_bytes = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(size_bytes), 0)::bigint
             FROM plugin_storage_objects WHERE plugin_id = $1",
        )
        .bind(input.plugin_id)
        .fetch_one(&mut *transaction)
        .await?;
        let previous_bytes = existing.map_or(0, |(size, _)| i64::from(size));
        let next_bytes = current_bytes - previous_bytes + input.value.len() as i64;
        if next_bytes > access.storage_bytes_limit {
            return Err(PluginRuntimeError::QuotaExceeded);
        }

        let row = if existing.is_some() {
            sqlx::query_as::<_, PluginStorageObjectRow>(
                "UPDATE plugin_storage_objects
                 SET value = $3, content_type = $4, revision = revision + 1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE plugin_id = $1 AND storage_key = $2
                 RETURNING plugin_id, storage_key, value, content_type, size_bytes,
                           revision, created_at, updated_at",
            )
            .bind(input.plugin_id)
            .bind(&input.key)
            .bind(&input.value)
            .bind(&input.content_type)
            .fetch_one(&mut *transaction)
            .await?
        } else {
            sqlx::query_as::<_, PluginStorageObjectRow>(
                "INSERT INTO plugin_storage_objects
                    (plugin_id, storage_key, value, content_type)
                 VALUES ($1, $2, $3, $4)
                 RETURNING plugin_id, storage_key, value, content_type, size_bytes,
                           revision, created_at, updated_at",
            )
            .bind(input.plugin_id)
            .bind(&input.key)
            .bind(&input.value)
            .bind(&input.content_type)
            .fetch_one(&mut *transaction)
            .await?
        };
        transaction.commit().await?;
        Ok(row.into())
    }

    pub async fn get_plugin_storage_object(
        &self,
        plugin_id: Uuid,
        key: &str,
    ) -> Result<Option<PluginStorageObjectRecord>, PluginRuntimeError> {
        if !valid_storage_key(key) {
            return Err(PluginRuntimeError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        lock_runtime_access(&mut transaction, plugin_id, Some("storage.read_write")).await?;
        let row = sqlx::query_as::<_, PluginStorageObjectRow>(
            "SELECT plugin_id, storage_key, value, content_type, size_bytes,
                    revision, created_at, updated_at
             FROM plugin_storage_objects
             WHERE plugin_id = $1 AND storage_key = $2",
        )
        .bind(plugin_id)
        .bind(key)
        .fetch_optional(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(row.map(Into::into))
    }

    pub async fn delete_plugin_storage_object(
        &self,
        plugin_id: Uuid,
        key: &str,
        expected_revision: i64,
    ) -> Result<bool, PluginRuntimeError> {
        if !valid_storage_key(key) || expected_revision < 1 {
            return Err(PluginRuntimeError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        lock_runtime_access(&mut transaction, plugin_id, Some("storage.read_write")).await?;
        let deleted = sqlx::query(
            "DELETE FROM plugin_storage_objects
             WHERE plugin_id = $1 AND storage_key = $2 AND revision = $3",
        )
        .bind(plugin_id)
        .bind(key)
        .bind(expected_revision)
        .execute(&mut *transaction)
        .await?
        .rows_affected()
            == 1;
        if !deleted {
            let exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                    SELECT 1 FROM plugin_storage_objects
                    WHERE plugin_id = $1 AND storage_key = $2
                 )",
            )
            .bind(plugin_id)
            .bind(key)
            .fetch_one(&mut *transaction)
            .await?;
            if exists {
                return Err(PluginRuntimeError::Conflict);
            }
        }
        transaction.commit().await?;
        Ok(deleted)
    }

    pub async fn schedule_plugin_task(
        &self,
        input: SchedulePluginTaskRecord,
    ) -> Result<PluginTaskRecord, PluginRuntimeError> {
        if !valid_task_key(&input.task_key)
            || !valid_idempotency_key(&input.idempotency_key)
            || input.payload.is_null()
            || !matches!(
                serde_json::to_vec(&input.payload),
                Ok(payload) if payload.len() <= MAX_TASK_PAYLOAD_BYTES
            )
        {
            return Err(PluginRuntimeError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        let access =
            lock_runtime_access(&mut transaction, input.plugin_id, Some("tasks.schedule")).await?;
        let existing = sqlx::query_as::<_, ExistingTaskRow>(
            "SELECT id, plugin_id, task_key, idempotency_key, payload, status, run_at,
                    attempts, max_attempts, created_at, updated_at,
                    task_key = $3 AND payload = $4 AND run_at = $5 AS matches_input
             FROM plugin_tasks
             WHERE plugin_id = $1 AND idempotency_key = $2",
        )
        .bind(input.plugin_id)
        .bind(&input.idempotency_key)
        .bind(&input.task_key)
        .bind(Json(&input.payload))
        .bind(input.run_at)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(existing) = existing {
            if existing.matches_input {
                transaction.commit().await?;
                return Ok(existing.task.into());
            }
            return Err(PluginRuntimeError::IdempotencyConflict);
        }
        let pending_tasks = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM plugin_tasks
             WHERE plugin_id = $1 AND status IN ('pending', 'processing')",
        )
        .bind(input.plugin_id)
        .fetch_one(&mut *transaction)
        .await?;
        if pending_tasks >= i64::from(access.pending_task_limit) {
            return Err(PluginRuntimeError::QuotaExceeded);
        }
        let row = sqlx::query_as::<_, PluginTaskRow>(
            "INSERT INTO plugin_tasks
                (id, plugin_id, task_key, idempotency_key, payload, run_at, available_at)
             VALUES ($1, $2, $3, $4, $5, $6, $6)
             RETURNING id, plugin_id, task_key, idempotency_key, payload, status, run_at,
                       attempts, max_attempts, created_at, updated_at",
        )
        .bind(Uuid::now_v7())
        .bind(input.plugin_id)
        .bind(&input.task_key)
        .bind(&input.idempotency_key)
        .bind(Json(&input.payload))
        .bind(input.run_at)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(row.into())
    }

    pub async fn plugin_quota_snapshot(
        &self,
        plugin_id: Uuid,
    ) -> Result<PluginQuotaSnapshot, PluginRuntimeError> {
        let mut transaction = self.pool.begin().await?;
        let access = lock_runtime_access(&mut transaction, plugin_id, None).await?;
        let storage_bytes_used = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(size_bytes), 0)::bigint
             FROM plugin_storage_objects WHERE plugin_id = $1",
        )
        .bind(plugin_id)
        .fetch_one(&mut *transaction)
        .await?;
        let pending_tasks = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM plugin_tasks
             WHERE plugin_id = $1 AND status IN ('pending', 'processing')",
        )
        .bind(plugin_id)
        .fetch_one(&mut *transaction)
        .await?;
        let command_daily_used = sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE((
                SELECT used FROM plugin_command_usage
                WHERE plugin_id = $1
                  AND window_start = date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                      AT TIME ZONE 'UTC'
             ), 0)",
        )
        .bind(plugin_id)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(PluginQuotaSnapshot {
            storage_bytes_used,
            storage_bytes_limit: access.storage_bytes_limit,
            pending_tasks,
            pending_task_limit: access.pending_task_limit,
            command_daily_limit: access.command_daily_limit,
            command_daily_used,
        })
    }
}

impl Database {
    pub async fn list_enabled_business_ui_plugins(
        &self,
    ) -> Result<Vec<(Uuid, String)>, PluginRuntimeError> {
        let rows = sqlx::query_as::<_, (Uuid, String)>(
            "SELECT id, key
             FROM plugins
             WHERE status = 'enabled' AND business_api_version = '0.1.0'
               AND capabilities ? 'ui.panel'
             ORDER BY key, id
             LIMIT 8",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn load_plugin_for_business_runtime(
        &self,
        plugin_id: Uuid,
    ) -> Result<PluginBusinessExecutableRecord, PluginRuntimeError> {
        let row = sqlx::query_as::<_, BusinessExecutableRow>(
            "SELECT id, key, status, name, version, description, manifest_schema_version,
                    COALESCE(business_api_version, '') AS business_api_version,
                    capabilities, data_scopes, event_subscriptions,
                    component_bytes, component_sha256, revision, installed_by
             FROM plugins
             WHERE id = $1",
        )
        .bind(plugin_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(PluginRuntimeError::NotFound)?;
        if row.status != "enabled" {
            return Err(PluginRuntimeError::Disabled);
        }
        if row.business_api_version != "0.1.0" {
            return Err(PluginRuntimeError::CapabilityDenied);
        }
        Ok(row.into())
    }

    pub async fn query_plugin_data(
        &self,
        plugin_id: Uuid,
        kind: PluginQueryKind,
        subject_id: Option<Uuid>,
    ) -> Result<Value, PluginRuntimeError> {
        let mut transaction = self.pool.begin().await?;
        let access = lock_runtime_access(&mut transaction, plugin_id, Some("core.query")).await?;
        let required_scope = match kind {
            PluginQueryKind::Site => "site.read",
            PluginQueryKind::Actor => "actor.read",
            PluginQueryKind::UserBasic => "users.read.basic",
            PluginQueryKind::Membership => "users.read.membership",
            PluginQueryKind::Board => "boards.read",
        };
        if !access
            .data_scopes
            .0
            .iter()
            .any(|scope| scope == required_scope)
        {
            return Err(PluginRuntimeError::CapabilityDenied);
        }
        let value = match kind {
            PluginQueryKind::Site => {
                sqlx::query_scalar::<_, Value>(
                    "SELECT jsonb_build_object(
                    'site_name', site_name,
                    'logo_url', logo_url,
                    'theme_preset', theme_preset,
                    'home_mode', home_mode
                 ) FROM site_branding WHERE id = 1",
                )
                .fetch_optional(&mut *transaction)
                .await?
            }
            PluginQueryKind::Actor | PluginQueryKind::UserBasic => {
                let subject_id = subject_id.ok_or(PluginRuntimeError::InvalidInput)?;
                sqlx::query_scalar::<_, Value>(
                    "SELECT jsonb_build_object(
                        'id', id,
                        'username', username,
                        'display_name', display_name,
                        'avatar_url', avatar_url
                     ) FROM users
                     WHERE id = $1 AND status IN ('active', 'restricted')",
                )
                .bind(subject_id)
                .fetch_optional(&mut *transaction)
                .await?
            }
            PluginQueryKind::Membership => {
                let subject_id = subject_id.ok_or(PluginRuntimeError::InvalidInput)?;
                sqlx::query_scalar::<_, Value>(
                    "SELECT jsonb_build_object(
                        'user_id', membership.user_id,
                        'points_balance', membership.points_balance,
                        'lifetime_points', membership.lifetime_points,
                        'membership_level', membership.level_key,
                        'experience', experience.experience,
                        'experience_level', level.internal_key
                     )
                     FROM membership_accounts AS membership
                     INNER JOIN users AS user_account
                        ON user_account.id = membership.user_id
                     INNER JOIN experience_accounts AS experience
                        ON experience.user_id = membership.user_id
                     INNER JOIN membership_levels AS level
                        ON level.id = experience.current_level_id
                     WHERE membership.user_id = $1
                       AND user_account.status IN ('active', 'restricted')",
                )
                .bind(subject_id)
                .fetch_optional(&mut *transaction)
                .await?
            }
            PluginQueryKind::Board => {
                let subject_id = subject_id.ok_or(PluginRuntimeError::InvalidInput)?;
                sqlx::query_scalar::<_, Value>(
                    "SELECT jsonb_build_object(
                        'id', id,
                        'slug', slug,
                        'name', name,
                        'description', description,
                        'visibility', visibility,
                        'topic_count', topic_count
                     ) FROM boards WHERE id = $1 AND deleted_at IS NULL",
                )
                .bind(subject_id)
                .fetch_optional(&mut *transaction)
                .await?
            }
        }
        .ok_or(PluginRuntimeError::NotFound)?;
        transaction.commit().await?;
        Ok(value)
    }

    pub async fn execute_plugin_command(
        &self,
        input: ExecutePluginCommandRecord,
    ) -> Result<PluginCommandResult, PluginRuntimeError> {
        let command = validate_plugin_command(&input)?;
        let (access, execution_token) = {
            let mut reservation = None;
            for _ in 0..COMMAND_RECEIPT_WAIT_ATTEMPTS {
                match self.reserve_plugin_command(&input).await? {
                    CommandReservation::Execute {
                        access,
                        execution_token,
                    } => {
                        reservation = Some((access, execution_token));
                        break;
                    }
                    CommandReservation::Replay(result) => return Ok(result),
                    CommandReservation::Wait => {
                        tokio::time::sleep(Duration::from_millis(COMMAND_RECEIPT_WAIT_MILLIS))
                            .await;
                    }
                }
            }
            reservation.ok_or(PluginRuntimeError::Busy)?
        };
        let core_key = core_idempotency_key(&access.key, &input.idempotency_key);
        let result = match command {
            ValidatedPluginCommand::Points(payload) => {
                let result = self
                    .grant_membership_points_from_plugin(
                        access.installed_by,
                        input.subject_id,
                        payload.amount,
                        &payload.reason,
                        Some(&core_key),
                    )
                    .await
                    .map_err(|_| PluginRuntimeError::InvalidInput)?;
                PluginCommandResult {
                    resource_id: input.subject_id,
                    replayed: !result.created,
                    payload: json!({
                        "points_balance": result.account.points_balance,
                        "lifetime_points": result.account.lifetime_points,
                        "revision": result.account.revision,
                    }),
                }
            }
            ValidatedPluginCommand::Experience(payload) => {
                let result = self
                    .append_experience(
                        input.subject_id,
                        payload.amount,
                        &payload.reason,
                        payload.source_resource_id,
                        &core_key,
                        payload.reversal_of,
                    )
                    .await
                    .map_err(|_| PluginRuntimeError::InvalidInput)?;
                PluginCommandResult {
                    resource_id: result.entry_id,
                    replayed: result.replayed,
                    payload: json!({
                        "experience": result.account.experience,
                        "level_key": result.account.internal_key,
                        "revision": result.account.revision,
                    }),
                }
            }
            ValidatedPluginCommand::EntitlementGrant {
                payload,
                starts_at,
                ends_at,
            } => {
                let result = self
                    .grant_standard_entitlement_from_plugin(GrantStandardEntitlementRecord {
                        user_id: input.subject_id,
                        entitlement_type_id: payload.entitlement_type_id,
                        actor_id: access.installed_by,
                        source: "plugin".to_owned(),
                        source_reference_id: Some(access.key.clone()),
                        reason: payload.reason,
                        starts_at,
                        ends_at,
                        idempotency_key: core_key,
                    })
                    .await
                    .map_err(map_entitlement_command_error)?;
                PluginCommandResult {
                    resource_id: result.entitlement.id,
                    replayed: result.replayed,
                    payload: json!({
                        "entitlement_key": result.entitlement.entitlement_key,
                        "revision": result.entitlement.revision,
                    }),
                }
            }
            ValidatedPluginCommand::EntitlementRevoke(payload) => {
                let result = self
                    .revoke_standard_entitlement_from_plugin(RevokeStandardEntitlementRecord {
                        entitlement_id: input.subject_id,
                        actor_id: access.installed_by,
                        expected_revision: payload.expected_revision,
                        reason: payload.reason,
                        idempotency_key: core_key,
                    })
                    .await
                    .map_err(map_entitlement_command_error)?;
                PluginCommandResult {
                    resource_id: result.entitlement.id,
                    replayed: result.replayed,
                    payload: json!({"revision": result.entitlement.revision}),
                }
            }
            ValidatedPluginCommand::Notification(payload) => {
                let mut transaction = self.pool.begin().await?;
                let created = insert_notification(
                    &mut transaction,
                    Uuid::now_v7(),
                    input.subject_id,
                    None,
                    &payload.kind,
                    &payload.target_type,
                    payload.target_id,
                    &core_key,
                )
                .await?;
                let notification = sqlx::query_as::<_, (Uuid, String, String, Uuid, Option<Uuid>)>(
                    "SELECT id, kind, target_type, target_id, actor_id FROM notifications
                     WHERE recipient_id = $1 AND aggregate_key = $2",
                )
                .bind(input.subject_id)
                .bind(&core_key)
                .fetch_one(&mut *transaction)
                .await?;
                if notification.1 != payload.kind
                    || notification.2 != payload.target_type
                    || notification.3 != payload.target_id
                    || notification.4.is_some()
                {
                    return Err(PluginRuntimeError::IdempotencyConflict);
                }
                transaction.commit().await?;
                PluginCommandResult {
                    resource_id: notification.0,
                    replayed: !created,
                    payload: json!({"notification_id": notification.0}),
                }
            }
        };
        self.complete_plugin_command_receipt(
            &access.key,
            &input.idempotency_key,
            execution_token,
            result,
        )
        .await
    }

    async fn reserve_plugin_command(
        &self,
        input: &ExecutePluginCommandRecord,
    ) -> Result<CommandReservation, PluginRuntimeError> {
        if !valid_idempotency_key(&input.idempotency_key)
            || input.payload.is_null()
            || !matches!(
                serde_json::to_vec(&input.payload),
                Ok(payload) if payload.len() <= MAX_TASK_PAYLOAD_BYTES
            )
        {
            return Err(PluginRuntimeError::InvalidInput);
        }
        let capability = command_capability(input.kind);
        let command_kind = command_kind_key(input.kind);
        let mut transaction = self.pool.begin().await?;
        let access =
            lock_runtime_access(&mut transaction, input.plugin_id, Some(capability)).await?;
        let existing = sqlx::query_as::<_, CommandReceiptRow>(
            "SELECT command_kind, subject_id, payload, status, resource_id, result_payload,
                    locked_until
             FROM plugin_command_receipts
             WHERE plugin_key = $1 AND idempotency_key = $2
             FOR UPDATE",
        )
        .bind(&access.key)
        .bind(&input.idempotency_key)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(existing) = existing {
            if existing.command_kind != command_kind
                || existing.subject_id != input.subject_id
                || existing.payload.0 != input.payload
            {
                return Err(PluginRuntimeError::IdempotencyConflict);
            }
            if existing.status == "completed" {
                let result = PluginCommandResult {
                    resource_id: existing.resource_id.ok_or_else(invalid_runtime_state)?,
                    replayed: true,
                    payload: existing.result_payload.ok_or_else(invalid_runtime_state)?.0,
                };
                transaction.commit().await?;
                return Ok(CommandReservation::Replay(result));
            }
            let locked_until = existing.locked_until.ok_or_else(invalid_runtime_state)?;
            if locked_until > OffsetDateTime::now_utc() {
                transaction.commit().await?;
                return Ok(CommandReservation::Wait);
            }
            let execution_token = Uuid::now_v7();
            sqlx::query(
                "UPDATE plugin_command_receipts
                 SET plugin_id = $3, execution_token = $4,
                     locked_until = CURRENT_TIMESTAMP + make_interval(secs => $5),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE plugin_key = $1 AND idempotency_key = $2 AND status = 'pending'",
            )
            .bind(&access.key)
            .bind(&input.idempotency_key)
            .bind(input.plugin_id)
            .bind(execution_token)
            .bind(COMMAND_EXECUTION_LEASE_SECONDS)
            .execute(&mut *transaction)
            .await?;
            transaction.commit().await?;
            return Ok(CommandReservation::Execute {
                access,
                execution_token,
            });
        }
        if access.command_daily_limit <= 0 {
            return Err(PluginRuntimeError::QuotaExceeded);
        }
        let used = sqlx::query_scalar::<_, i32>(
            "INSERT INTO plugin_command_usage (plugin_id, window_start, used)
             VALUES (
                $1,
                date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
                1
             )
             ON CONFLICT (plugin_id, window_start) DO UPDATE
             SET used = plugin_command_usage.used + 1,
                 revision = plugin_command_usage.revision + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE plugin_command_usage.used < $2
             RETURNING used",
        )
        .bind(input.plugin_id)
        .bind(access.command_daily_limit)
        .fetch_optional(&mut *transaction)
        .await?;
        if used.is_none() {
            return Err(PluginRuntimeError::QuotaExceeded);
        }
        let execution_token = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO plugin_command_receipts
                (plugin_key, plugin_id, idempotency_key, command_kind, subject_id, payload,
                 execution_token, locked_until)
             VALUES ($1, $2, $3, $4, $5, $6, $7,
                     CURRENT_TIMESTAMP + make_interval(secs => $8))",
        )
        .bind(&access.key)
        .bind(input.plugin_id)
        .bind(&input.idempotency_key)
        .bind(command_kind)
        .bind(input.subject_id)
        .bind(Json(&input.payload))
        .bind(execution_token)
        .bind(COMMAND_EXECUTION_LEASE_SECONDS)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(CommandReservation::Execute {
            access,
            execution_token,
        })
    }

    async fn complete_plugin_command_receipt(
        &self,
        plugin_key: &str,
        idempotency_key: &str,
        execution_token: Uuid,
        result: PluginCommandResult,
    ) -> Result<PluginCommandResult, PluginRuntimeError> {
        let row = sqlx::query_as::<_, (Uuid, Json<Value>)>(
            "UPDATE plugin_command_receipts
             SET status = 'completed', resource_id = $3, result_payload = $4,
                 execution_token = NULL, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE plugin_key = $1 AND idempotency_key = $2
               AND status = 'pending' AND execution_token = $5
               AND locked_until > CURRENT_TIMESTAMP
             RETURNING resource_id, result_payload",
        )
        .bind(plugin_key)
        .bind(idempotency_key)
        .bind(result.resource_id)
        .bind(Json(&result.payload))
        .bind(execution_token)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(PluginRuntimeError::Busy)?;
        Ok(PluginCommandResult {
            resource_id: row.0,
            replayed: result.replayed,
            payload: row.1.0,
        })
    }

    pub async fn try_acquire_plugin_execution_lease(
        &self,
        plugin_id: Uuid,
        lock_token: Uuid,
        lease_duration: Duration,
    ) -> Result<bool, PluginRuntimeError> {
        let lease_seconds = valid_claim_options(1, lease_duration)?;
        let mut transaction = self.pool.begin().await?;
        let executable = sqlx::query_scalar::<_, bool>(
            "SELECT TRUE
             FROM plugins
             WHERE id = $1 AND status = 'enabled' AND business_api_version = '0.1.0'
             FOR KEY SHARE",
        )
        .bind(plugin_id)
        .fetch_optional(&mut *transaction)
        .await?
        .is_some();
        if !executable {
            return Ok(false);
        }
        let acquired = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO plugin_execution_leases
                (plugin_id, lock_token, locked_until)
             VALUES ($1, $2, CURRENT_TIMESTAMP + make_interval(secs => $3))
             ON CONFLICT (plugin_id) DO UPDATE
             SET lock_token = EXCLUDED.lock_token,
                 locked_until = EXCLUDED.locked_until,
                 updated_at = CURRENT_TIMESTAMP
             WHERE plugin_execution_leases.locked_until <= CURRENT_TIMESTAMP
             RETURNING plugin_id",
        )
        .bind(plugin_id)
        .bind(lock_token)
        .bind(lease_seconds)
        .fetch_optional(&mut *transaction)
        .await?
        .is_some();
        transaction.commit().await?;
        Ok(acquired)
    }

    pub async fn release_plugin_execution_lease(
        &self,
        plugin_id: Uuid,
        lock_token: Uuid,
    ) -> Result<bool, PluginRuntimeError> {
        Ok(sqlx::query(
            "DELETE FROM plugin_execution_leases
             WHERE plugin_id = $1 AND lock_token = $2",
        )
        .bind(plugin_id)
        .bind(lock_token)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn abandon_plugin_event_delivery_claim(
        &self,
        plugin_id: Uuid,
        outbox_event_id: Uuid,
        lock_token: Uuid,
    ) -> Result<bool, PluginRuntimeError> {
        Ok(sqlx::query(
            "UPDATE plugin_event_deliveries
             SET status = 'pending', attempts = GREATEST(attempts - 1, 0),
                 lock_token = NULL, locked_until = NULL,
                 available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE plugin_id = $1 AND outbox_event_id = $2
               AND status = 'processing' AND lock_token = $3",
        )
        .bind(plugin_id)
        .bind(outbox_event_id)
        .bind(lock_token)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn abandon_plugin_task_claim(
        &self,
        task_id: Uuid,
        lock_token: Uuid,
    ) -> Result<bool, PluginRuntimeError> {
        let mut transaction = self.pool.begin().await?;
        let abandoned = sqlx::query(
            "UPDATE plugin_tasks
             SET status = 'pending', attempts = GREATEST(attempts - 1, 0),
                 lock_token = NULL, locked_until = NULL,
                 available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'processing' AND lock_token = $2",
        )
        .bind(task_id)
        .bind(lock_token)
        .execute(&mut *transaction)
        .await?
        .rows_affected()
            == 1;
        if abandoned {
            sqlx::query(
                "DELETE FROM plugin_task_attempts
                 WHERE task_id = $1 AND worker_token = $2 AND status = 'processing'",
            )
            .bind(task_id)
            .bind(lock_token)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(abandoned)
    }

    pub async fn claim_plugin_event_deliveries(
        &self,
        limit: i64,
        lease_duration: Duration,
    ) -> Result<Vec<ClaimedPluginEventDelivery>, PluginRuntimeError> {
        let lease_seconds = valid_claim_options(limit, lease_duration)?;
        let lock_token = Uuid::now_v7();
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "UPDATE plugin_event_deliveries
             SET status = 'dead', lock_token = NULL, locked_until = NULL,
                 last_error = COALESCE(last_error, 'processing lease expired'),
                 updated_at = CURRENT_TIMESTAMP
             WHERE status = 'processing' AND locked_until <= CURRENT_TIMESTAMP
               AND attempts >= max_attempts",
        )
        .execute(&mut *transaction)
        .await?;
        let deliveries = sqlx::query_as::<_, ClaimedPluginEventDelivery>(
            "WITH candidates AS (
                 SELECT delivery.plugin_id, delivery.outbox_event_id
                 FROM plugin_event_deliveries AS delivery
                 INNER JOIN plugins AS plugin ON plugin.id = delivery.plugin_id
                 INNER JOIN plugin_event_subscriptions AS subscription
                    ON subscription.plugin_id = delivery.plugin_id
                   AND subscription.event_type = delivery.event_type
                 WHERE plugin.status = 'enabled'
                   AND plugin.business_api_version = '0.1.0'
                   AND plugin.capabilities ? 'events.subscribe'
                   AND subscription.enabled
                   AND delivery.attempts < delivery.max_attempts
                   AND (
                       (delivery.status = 'pending'
                           AND delivery.available_at <= CURRENT_TIMESTAMP)
                       OR (delivery.status = 'processing'
                           AND delivery.locked_until <= CURRENT_TIMESTAMP)
                   )
                 ORDER BY delivery.available_at, delivery.created_at,
                          delivery.plugin_id, delivery.outbox_event_id
                 FOR UPDATE OF delivery SKIP LOCKED
                 LIMIT $1
             )
             UPDATE plugin_event_deliveries AS delivery
             SET status = 'processing', attempts = delivery.attempts + 1,
                 lock_token = $2,
                 locked_until = CURRENT_TIMESTAMP + make_interval(secs => $3),
                 updated_at = CURRENT_TIMESTAMP
             FROM candidates
             WHERE delivery.plugin_id = candidates.plugin_id
               AND delivery.outbox_event_id = candidates.outbox_event_id
             RETURNING delivery.plugin_id, delivery.outbox_event_id,
                       delivery.event_type, delivery.aggregate_id, delivery.payload,
                       delivery.payload_schema_version, delivery.attempts,
                       delivery.max_attempts, delivery.lock_token, delivery.locked_until,
                       delivery.created_at",
        )
        .bind(limit)
        .bind(lock_token)
        .bind(lease_seconds)
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(deliveries)
    }

    pub async fn complete_plugin_event_delivery(
        &self,
        plugin_id: Uuid,
        outbox_event_id: Uuid,
        lock_token: Uuid,
    ) -> Result<bool, PluginRuntimeError> {
        let result = sqlx::query(
            "UPDATE plugin_event_deliveries
             SET status = 'completed', lock_token = NULL, locked_until = NULL,
                 last_error = NULL, completed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE plugin_id = $1 AND outbox_event_id = $2
               AND status = 'processing' AND lock_token = $3
               AND locked_until > CURRENT_TIMESTAMP",
        )
        .bind(plugin_id)
        .bind(outbox_event_id)
        .bind(lock_token)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn fail_plugin_event_delivery(
        &self,
        plugin_id: Uuid,
        outbox_event_id: Uuid,
        lock_token: Uuid,
        error_summary: &str,
    ) -> Result<Option<PluginQueueDisposition>, PluginRuntimeError> {
        let error_summary = normalize_error_summary(error_summary);
        let mut transaction = self.pool.begin().await?;
        let state = sqlx::query_as::<_, (i16, i16)>(
            "SELECT attempts, max_attempts
             FROM plugin_event_deliveries
             WHERE plugin_id = $1 AND outbox_event_id = $2
               AND status = 'processing' AND lock_token = $3
               AND locked_until > CURRENT_TIMESTAMP
             FOR UPDATE",
        )
        .bind(plugin_id)
        .bind(outbox_event_id)
        .bind(lock_token)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some((attempts, max_attempts)) = state else {
            transaction.rollback().await?;
            return Ok(None);
        };
        let disposition = queue_disposition(attempts, max_attempts);
        let status = disposition_status(disposition);
        sqlx::query(
            "UPDATE plugin_event_deliveries
             SET status = $4, lock_token = NULL, locked_until = NULL,
                 last_error = $5,
                 available_at = CASE WHEN $4 = 'pending'
                    THEN CURRENT_TIMESTAMP + make_interval(secs => $6)
                    ELSE available_at END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE plugin_id = $1 AND outbox_event_id = $2
               AND status = 'processing' AND lock_token = $3",
        )
        .bind(plugin_id)
        .bind(outbox_event_id)
        .bind(lock_token)
        .bind(status)
        .bind(error_summary)
        .bind(retry_delay_seconds(attempts))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(disposition))
    }

    pub async fn defer_plugin_event_delivery_until_quota_reset(
        &self,
        plugin_id: Uuid,
        outbox_event_id: Uuid,
        lock_token: Uuid,
    ) -> Result<bool, PluginRuntimeError> {
        let result = sqlx::query(
            "UPDATE plugin_event_deliveries
             SET status = 'pending', attempts = GREATEST(attempts - 1, 0),
                 lock_token = NULL, locked_until = NULL,
                 last_error = 'plugin command quota exceeded; deferred',
                 available_at = (
                    date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                    + INTERVAL '1 day'
                 ) AT TIME ZONE 'UTC',
                 updated_at = CURRENT_TIMESTAMP
             WHERE plugin_id = $1 AND outbox_event_id = $2
               AND status = 'processing' AND lock_token = $3
               AND locked_until > CURRENT_TIMESTAMP",
        )
        .bind(plugin_id)
        .bind(outbox_event_id)
        .bind(lock_token)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn claim_plugin_tasks(
        &self,
        limit: i64,
        lease_duration: Duration,
    ) -> Result<Vec<ClaimedPluginTask>, PluginRuntimeError> {
        let lease_seconds = valid_claim_options(limit, lease_duration)?;
        let lock_token = Uuid::now_v7();
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "UPDATE plugin_task_attempts AS attempt
             SET status = CASE WHEN task.attempts >= task.max_attempts
                               THEN 'dead' ELSE 'failed' END,
                 finished_at = CURRENT_TIMESTAMP,
                 error_code = 'worker.lease_expired',
                 error_summary = 'processing lease expired'
             FROM plugin_tasks AS task
             WHERE attempt.task_id = task.id
               AND attempt.worker_token = task.lock_token
               AND attempt.status = 'processing'
               AND task.status = 'processing'
               AND task.locked_until <= CURRENT_TIMESTAMP",
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE plugin_tasks
             SET status = 'dead', lock_token = NULL, locked_until = NULL,
                 last_error = COALESCE(last_error, 'processing lease expired'),
                 dead_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE status = 'processing' AND locked_until <= CURRENT_TIMESTAMP
               AND attempts >= max_attempts",
        )
        .execute(&mut *transaction)
        .await?;
        let tasks = sqlx::query_as::<_, ClaimedPluginTask>(
            "WITH candidates AS (
                 SELECT task.id
                 FROM plugin_tasks AS task
                 INNER JOIN plugins AS plugin ON plugin.id = task.plugin_id
                 WHERE plugin.status = 'enabled'
                   AND plugin.business_api_version = '0.1.0'
                   AND plugin.capabilities ? 'tasks.schedule'
                   AND task.attempts < task.max_attempts
                   AND (
                       (task.status = 'pending' AND task.available_at <= CURRENT_TIMESTAMP)
                       OR (task.status = 'processing' AND task.locked_until <= CURRENT_TIMESTAMP)
                   )
                 ORDER BY task.available_at, task.created_at, task.id
                 FOR UPDATE OF task SKIP LOCKED
                 LIMIT $1
             )
             UPDATE plugin_tasks AS task
             SET status = 'processing', attempts = task.attempts + 1,
                 lock_token = $2,
                 locked_until = CURRENT_TIMESTAMP + make_interval(secs => $3),
                 last_error = NULL, updated_at = CURRENT_TIMESTAMP
             FROM candidates
             WHERE task.id = candidates.id
             RETURNING task.id, task.plugin_id, task.task_key, task.payload, task.run_at,
                       task.attempts, task.max_attempts, task.lock_token, task.locked_until",
        )
        .bind(limit)
        .bind(lock_token)
        .bind(lease_seconds)
        .fetch_all(&mut *transaction)
        .await?;
        for task in &tasks {
            sqlx::query(
                "INSERT INTO plugin_task_attempts
                    (id, task_id, attempt_no, worker_token, status, started_at, leased_until)
                 VALUES ($1, $2, $3, $4, 'processing', CURRENT_TIMESTAMP, $5)",
            )
            .bind(Uuid::now_v7())
            .bind(task.id)
            .bind(task.attempts)
            .bind(task.lock_token)
            .bind(task.locked_until)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(tasks)
    }

    pub async fn complete_plugin_task(
        &self,
        task_id: Uuid,
        lock_token: Uuid,
    ) -> Result<bool, PluginRuntimeError> {
        let mut transaction = self.pool.begin().await?;
        let completed = sqlx::query(
            "UPDATE plugin_tasks
             SET status = 'completed', lock_token = NULL, locked_until = NULL,
                 last_error = NULL, completed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'processing' AND lock_token = $2
               AND locked_until > CURRENT_TIMESTAMP",
        )
        .bind(task_id)
        .bind(lock_token)
        .execute(&mut *transaction)
        .await?
        .rows_affected()
            == 1;
        if completed {
            sqlx::query(
                "UPDATE plugin_task_attempts
                 SET status = 'completed', finished_at = CURRENT_TIMESTAMP
                 WHERE task_id = $1 AND worker_token = $2 AND status = 'processing'",
            )
            .bind(task_id)
            .bind(lock_token)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(completed)
    }

    pub async fn defer_plugin_task_until_quota_reset(
        &self,
        task_id: Uuid,
        lock_token: Uuid,
    ) -> Result<bool, PluginRuntimeError> {
        let mut transaction = self.pool.begin().await?;
        let deferred = sqlx::query(
            "UPDATE plugin_tasks
             SET status = 'pending', attempts = GREATEST(attempts - 1, 0),
                 lock_token = NULL, locked_until = NULL,
                 last_error = 'plugin command quota exceeded; deferred',
                 available_at = (
                    date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                    + INTERVAL '1 day'
                 ) AT TIME ZONE 'UTC',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'processing' AND lock_token = $2
               AND locked_until > CURRENT_TIMESTAMP",
        )
        .bind(task_id)
        .bind(lock_token)
        .execute(&mut *transaction)
        .await?
        .rows_affected()
            == 1;
        if deferred {
            sqlx::query(
                "DELETE FROM plugin_task_attempts
                 WHERE task_id = $1 AND worker_token = $2 AND status = 'processing'",
            )
            .bind(task_id)
            .bind(lock_token)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(deferred)
    }

    pub async fn fail_plugin_task(
        &self,
        task_id: Uuid,
        lock_token: Uuid,
        error_code: &str,
        error_summary: &str,
    ) -> Result<Option<PluginQueueDisposition>, PluginRuntimeError> {
        if !valid_error_code(error_code) {
            return Err(PluginRuntimeError::InvalidInput);
        }
        let error_summary = normalize_error_summary(error_summary);
        let mut transaction = self.pool.begin().await?;
        let state = sqlx::query_as::<_, (i16, i16)>(
            "SELECT attempts, max_attempts FROM plugin_tasks
             WHERE id = $1 AND status = 'processing' AND lock_token = $2
               AND locked_until > CURRENT_TIMESTAMP
             FOR UPDATE",
        )
        .bind(task_id)
        .bind(lock_token)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some((attempts, max_attempts)) = state else {
            transaction.rollback().await?;
            return Ok(None);
        };
        let disposition = queue_disposition(attempts, max_attempts);
        let status = disposition_status(disposition);
        sqlx::query(
            "UPDATE plugin_tasks
             SET status = $3, lock_token = NULL, locked_until = NULL,
                 last_error = $4,
                 available_at = CASE WHEN $3 = 'pending'
                    THEN CURRENT_TIMESTAMP + make_interval(secs => $5)
                    ELSE available_at END,
                 dead_at = CASE WHEN $3 = 'dead' THEN CURRENT_TIMESTAMP ELSE NULL END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'processing' AND lock_token = $2",
        )
        .bind(task_id)
        .bind(lock_token)
        .bind(status)
        .bind(&error_summary)
        .bind(retry_delay_seconds(attempts))
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE plugin_task_attempts
             SET status = $3, finished_at = CURRENT_TIMESTAMP,
                 error_code = $4, error_summary = $5
             WHERE task_id = $1 AND worker_token = $2 AND status = 'processing'",
        )
        .bind(task_id)
        .bind(lock_token)
        .bind(if disposition == PluginQueueDisposition::Dead {
            "dead"
        } else {
            "failed"
        })
        .bind(error_code)
        .bind(error_summary)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(disposition))
    }
}

async fn lock_runtime_access(
    transaction: &mut Transaction<'_, Postgres>,
    plugin_id: Uuid,
    capability: Option<&str>,
) -> Result<RuntimeAccessRow, PluginRuntimeError> {
    let access = sqlx::query_as::<_, RuntimeAccessRow>(
        "SELECT plugin.key, plugin.status, plugin.business_api_version, plugin.capabilities,
                plugin.data_scopes, quotas.storage_bytes_limit, quotas.pending_task_limit,
                quotas.command_daily_limit, plugin.installed_by
         FROM plugins AS plugin
         INNER JOIN plugin_runtime_quotas AS quotas ON quotas.plugin_id = plugin.id
         WHERE plugin.id = $1
         FOR UPDATE OF plugin, quotas",
    )
    .bind(plugin_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(PluginRuntimeError::NotFound)?;
    if access.status != "enabled" {
        return Err(PluginRuntimeError::Disabled);
    }
    if access.business_api_version.as_deref() != Some("0.1.0")
        || capability.is_some_and(|required| {
            !access
                .capabilities
                .0
                .iter()
                .any(|declared| declared == required)
        })
    {
        return Err(PluginRuntimeError::CapabilityDenied);
    }
    Ok(access)
}

fn valid_claim_options(limit: i64, lease_duration: Duration) -> Result<i32, PluginRuntimeError> {
    let lease_seconds = lease_duration.as_secs();
    if !(1..=MAX_CLAIM_BATCH).contains(&limit) || !(1..=MAX_LEASE_SECONDS).contains(&lease_seconds)
    {
        return Err(PluginRuntimeError::InvalidInput);
    }
    i32::try_from(lease_seconds).map_err(|_| PluginRuntimeError::InvalidInput)
}

fn validate_plugin_command(
    input: &ExecutePluginCommandRecord,
) -> Result<ValidatedPluginCommand, PluginRuntimeError> {
    if !valid_idempotency_key(&input.idempotency_key)
        || input.payload.is_null()
        || !matches!(
            serde_json::to_vec(&input.payload),
            Ok(payload) if payload.len() <= MAX_TASK_PAYLOAD_BYTES
        )
    {
        return Err(PluginRuntimeError::InvalidInput);
    }
    match input.kind {
        PluginCommandKind::PointsAppend => {
            let payload = serde_json::from_value::<PointsCommandPayload>(input.payload.clone())
                .map_err(|_| PluginRuntimeError::InvalidInput)?;
            if payload.amount == 0 || !valid_points_reason(&payload.reason) {
                return Err(PluginRuntimeError::InvalidInput);
            }
            Ok(ValidatedPluginCommand::Points(payload))
        }
        PluginCommandKind::ExperienceAppend => {
            let payload = serde_json::from_value::<ExperienceCommandPayload>(input.payload.clone())
                .map_err(|_| PluginRuntimeError::InvalidInput)?;
            if payload.amount == 0
                || (payload.amount < 0) != payload.reversal_of.is_some()
                || !valid_experience_reason(&payload.reason)
            {
                return Err(PluginRuntimeError::InvalidInput);
            }
            Ok(ValidatedPluginCommand::Experience(payload))
        }
        PluginCommandKind::EntitlementGrant => {
            let payload =
                serde_json::from_value::<EntitlementGrantCommandPayload>(input.payload.clone())
                    .map_err(|_| PluginRuntimeError::InvalidInput)?;
            let starts_at = timestamp_from_unix_ms(payload.starts_at_unix_ms)?;
            let ends_at = payload
                .ends_at_unix_ms
                .map(timestamp_from_unix_ms)
                .transpose()?;
            if !valid_entitlement_reason(&payload.reason)
                || ends_at.is_some_and(|ends_at| ends_at <= starts_at)
            {
                return Err(PluginRuntimeError::InvalidInput);
            }
            Ok(ValidatedPluginCommand::EntitlementGrant {
                payload,
                starts_at,
                ends_at,
            })
        }
        PluginCommandKind::EntitlementRevoke => {
            let payload =
                serde_json::from_value::<EntitlementRevokeCommandPayload>(input.payload.clone())
                    .map_err(|_| PluginRuntimeError::InvalidInput)?;
            if payload.expected_revision < 1 || !valid_entitlement_reason(&payload.reason) {
                return Err(PluginRuntimeError::InvalidInput);
            }
            Ok(ValidatedPluginCommand::EntitlementRevoke(payload))
        }
        PluginCommandKind::NotificationSend => {
            let payload =
                serde_json::from_value::<NotificationCommandPayload>(input.payload.clone())
                    .map_err(|_| PluginRuntimeError::InvalidInput)?;
            if !matches!(
                payload.kind.as_str(),
                "follow" | "reply" | "like" | "message"
            ) || !matches!(
                payload.target_type.as_str(),
                "user" | "topic" | "post" | "conversation"
            ) {
                return Err(PluginRuntimeError::InvalidInput);
            }
            Ok(ValidatedPluginCommand::Notification(payload))
        }
    }
}

fn valid_points_reason(value: &str) -> bool {
    (2..=64).contains(&value.len())
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

fn valid_experience_reason(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=80).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_lowercase)
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'.')
        })
}

fn valid_entitlement_reason(value: &str) -> bool {
    (1..=200).contains(&value.chars().count()) && !value.chars().any(char::is_control)
}

const fn command_capability(kind: PluginCommandKind) -> &'static str {
    match kind {
        PluginCommandKind::PointsAppend => "points.write",
        PluginCommandKind::ExperienceAppend => "experience.write",
        PluginCommandKind::EntitlementGrant | PluginCommandKind::EntitlementRevoke => {
            "entitlements.write"
        }
        PluginCommandKind::NotificationSend => "notifications.write",
    }
}

const fn command_kind_key(kind: PluginCommandKind) -> &'static str {
    match kind {
        PluginCommandKind::PointsAppend => "points.append",
        PluginCommandKind::ExperienceAppend => "experience.append",
        PluginCommandKind::EntitlementGrant => "entitlement.grant",
        PluginCommandKind::EntitlementRevoke => "entitlement.revoke",
        PluginCommandKind::NotificationSend => "notification.send",
    }
}

fn core_idempotency_key(plugin_key: &str, idempotency_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(plugin_key.as_bytes());
    hasher.update([0]);
    hasher.update(idempotency_key.as_bytes());
    format!("plugin:{:x}", hasher.finalize())
}

fn map_entitlement_command_error(
    error: crate::StandardEntitlementMutationError,
) -> PluginRuntimeError {
    match error {
        crate::StandardEntitlementMutationError::IdempotencyConflict => {
            PluginRuntimeError::IdempotencyConflict
        }
        crate::StandardEntitlementMutationError::RevisionConflict => PluginRuntimeError::Conflict,
        _ => PluginRuntimeError::InvalidInput,
    }
}

fn timestamp_from_unix_ms(value: i64) -> Result<OffsetDateTime, PluginRuntimeError> {
    i128::from(value)
        .checked_mul(1_000_000)
        .and_then(|nanoseconds| OffsetDateTime::from_unix_timestamp_nanos(nanoseconds).ok())
        .ok_or(PluginRuntimeError::InvalidInput)
}

fn invalid_runtime_state() -> PluginRuntimeError {
    PluginRuntimeError::Database(DatabaseError::from(sqlx::Error::Protocol(
        "invalid plugin command receipt state".to_owned(),
    )))
}

fn queue_disposition(attempts: i16, max_attempts: i16) -> PluginQueueDisposition {
    if attempts >= max_attempts {
        PluginQueueDisposition::Dead
    } else {
        PluginQueueDisposition::Pending
    }
}

const fn disposition_status(disposition: PluginQueueDisposition) -> &'static str {
    match disposition {
        PluginQueueDisposition::Pending => "pending",
        PluginQueueDisposition::Dead => "dead",
    }
}

fn retry_delay_seconds(attempts: i16) -> i32 {
    let exponent = u32::try_from(attempts.saturating_sub(1))
        .unwrap_or_default()
        .min(10);
    (5_i32.saturating_mul(2_i32.saturating_pow(exponent))).min(3_600)
}

fn normalize_error_summary(value: &str) -> String {
    let normalized = value
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(500)
        .collect::<String>();
    if normalized.is_empty() {
        "plugin worker failed".to_owned()
    } else {
        normalized
    }
}

fn valid_error_code(value: &str) -> bool {
    value.len() <= 80
        && value.split('.').count() >= 2
        && value.split('.').all(|segment| {
            segment
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_lowercase())
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        })
}

fn valid_storage_key(value: &str) -> bool {
    (1..=160).contains(&value.len())
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'_' | b'.' | b':' | b'-')
        })
}

fn valid_content_type(value: &str) -> bool {
    (1..=120).contains(&value.chars().count())
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_task_key(value: &str) -> bool {
    (1..=80).contains(&value.len())
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'.')
        })
        && !value.split('.').any(str::is_empty)
}

fn valid_idempotency_key(value: &str) -> bool {
    (1..=160).contains(&value.chars().count()) && !value.chars().any(char::is_control)
}

impl From<PluginStorageObjectRow> for PluginStorageObjectRecord {
    fn from(row: PluginStorageObjectRow) -> Self {
        Self {
            plugin_id: row.plugin_id,
            key: row.storage_key,
            value: row.value,
            content_type: row.content_type,
            size_bytes: row.size_bytes,
            revision: row.revision,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

impl From<PluginTaskRow> for PluginTaskRecord {
    fn from(row: PluginTaskRow) -> Self {
        Self {
            id: row.id,
            plugin_id: row.plugin_id,
            task_key: row.task_key,
            idempotency_key: row.idempotency_key,
            payload: row.payload.0,
            status: row.status,
            run_at: row.run_at,
            attempts: row.attempts,
            max_attempts: row.max_attempts,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

impl From<BusinessExecutableRow> for PluginBusinessExecutableRecord {
    fn from(row: BusinessExecutableRow) -> Self {
        Self {
            id: row.id,
            key: row.key,
            name: row.name,
            version: row.version,
            description: row.description,
            manifest_schema_version: row.manifest_schema_version,
            business_api_version: row.business_api_version,
            capabilities: row.capabilities.0,
            data_scopes: row.data_scopes.0,
            event_subscriptions: row.event_subscriptions.0,
            component_bytes: row.component_bytes,
            component_sha256: row.component_sha256,
            revision: row.revision,
            installed_by: row.installed_by,
        }
    }
}

impl fmt::Display for PluginRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::NotFound => "plugin runtime resource was not found",
            Self::Disabled => "plugin is disabled",
            Self::CapabilityDenied => "plugin capability is denied",
            Self::InvalidInput => "plugin runtime input is invalid",
            Self::Conflict => "plugin runtime revision conflicts",
            Self::IdempotencyConflict => "plugin task idempotency key conflicts",
            Self::QuotaExceeded => "plugin runtime quota was exceeded",
            Self::Busy => "plugin runtime execution is busy",
            Self::Database(_) => "plugin runtime database operation failed",
        })
    }
}

impl Error for PluginRuntimeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            _ => None,
        }
    }
}

impl From<sqlx::Error> for PluginRuntimeError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}
