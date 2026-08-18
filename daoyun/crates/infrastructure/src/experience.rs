use std::{error::Error, fmt};

use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::outbox::enqueue_core_event_in_transaction;
use crate::{Database, DatabaseError};

#[derive(Clone, Debug, FromRow)]
pub struct ExperienceAccountRecord {
    pub user_id: Uuid,
    pub experience: i64,
    pub current_level_id: Uuid,
    pub internal_key: String,
    pub level_order: i32,
    pub display_name: String,
    pub required_experience: i64,
    pub icon_asset_id: Option<Uuid>,
    pub color: Option<String>,
    pub description: String,
    pub revision: i64,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug, FromRow)]
pub struct GrowthLevelRecord {
    pub id: Uuid,
    pub internal_key: String,
    pub level_order: i32,
    pub display_name: String,
    pub required_experience: i64,
    pub icon_asset_id: Option<Uuid>,
    pub color: Option<String>,
    pub description: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AdminGrowthLevelRecord {
    pub id: Uuid,
    pub internal_key: String,
    pub level_order: i32,
    pub display_name: String,
    pub required_experience: i64,
    pub icon_asset_id: Option<Uuid>,
    pub color: Option<String>,
    pub description: String,
    pub status: String,
    pub revision: i64,
    pub published_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct CreateGrowthLevelRecord {
    pub internal_key: String,
    pub level_order: i32,
    pub display_name: String,
    pub required_experience: i64,
    pub icon_asset_id: Option<Uuid>,
    pub color: Option<String>,
    pub description: String,
}

#[derive(Clone, Debug)]
pub struct UpdateGrowthLevelRecord {
    pub id: Uuid,
    pub expected_revision: i64,
    pub level_order: i32,
    pub display_name: String,
    pub required_experience: i64,
    pub icon_asset_id: Option<Uuid>,
    pub color: Option<String>,
    pub description: String,
    pub status: String,
}

#[derive(Debug)]
pub enum MutateGrowthLevelError {
    Forbidden,
    NotFound,
    Conflict,
    Duplicate,
    InvalidInput,
    InvalidTransition,
    InvalidThresholdOrder,
    Database(DatabaseError),
}

#[derive(Clone, Debug)]
pub struct ExperienceLedgerResult {
    pub account: ExperienceAccountRecord,
    pub entry_id: Uuid,
    pub replayed: bool,
}

#[derive(Debug)]
pub enum AppendExperienceError {
    InvalidAmount,
    InvalidReason,
    InvalidIdempotencyKey,
    InvalidReversal,
    AccountNotFound,
    InsufficientExperience,
    ReversalNotFound,
    ReversalConflict,
    IdempotencyConflict,
    Sqlx(sqlx::Error),
}

impl Database {
    pub async fn list_admin_growth_levels(
        &self,
    ) -> Result<Vec<AdminGrowthLevelRecord>, sqlx::Error> {
        sqlx::query_as::<_, AdminGrowthLevelRecord>(
            "SELECT id, internal_key, level_order, display_name, required_experience,
                    icon_asset_id, color, description, status, revision, published_at,
                    created_at, updated_at
             FROM membership_levels
             ORDER BY level_order ASC",
        )
        .fetch_all(&self.pool)
        .await
    }

    pub async fn create_growth_level(
        &self,
        actor_id: Uuid,
        input: CreateGrowthLevelRecord,
    ) -> Result<AdminGrowthLevelRecord, MutateGrowthLevelError> {
        if !valid_growth_level_input(
            &input.internal_key,
            input.level_order,
            &input.display_name,
            input.required_experience,
            input.color.as_deref(),
            &input.description,
        ) {
            return Err(MutateGrowthLevelError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::MEMBERSHIP_RULES_WRITE,
            None,
        )
        .await?
        {
            return Err(MutateGrowthLevelError::Forbidden);
        }
        let id = Uuid::now_v7();
        let record = sqlx::query_as::<_, AdminGrowthLevelRecord>(
            "INSERT INTO membership_levels (
                 id, internal_key, level_order, display_name, required_experience,
                 icon_asset_id, color, description, status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
             RETURNING id, internal_key, level_order, display_name, required_experience,
                       icon_asset_id, color, description, status, revision, published_at,
                       created_at, updated_at",
        )
        .bind(id)
        .bind(&input.internal_key)
        .bind(input.level_order)
        .bind(&input.display_name)
        .bind(input.required_experience)
        .bind(input.icon_asset_id)
        .bind(&input.color)
        .bind(&input.description)
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_growth_level_write_error)?;
        insert_audit(
            &mut transaction,
            actor_id,
            "membership.level.create",
            "membership_level",
            Some(record.id),
            serde_json::json!({
                "internal_key": record.internal_key,
                "level_order": record.level_order,
                "status": record.status
            }),
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(map_growth_level_write_error)?;
        Ok(record)
    }

    pub async fn update_growth_level(
        &self,
        actor_id: Uuid,
        input: UpdateGrowthLevelRecord,
    ) -> Result<AdminGrowthLevelRecord, MutateGrowthLevelError> {
        if input.expected_revision < 1
            || !valid_growth_level_input(
                "valid_key",
                input.level_order,
                &input.display_name,
                input.required_experience,
                input.color.as_deref(),
                &input.description,
            )
            || !valid_growth_level_status(&input.status)
        {
            return Err(MutateGrowthLevelError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::MEMBERSHIP_RULES_WRITE,
            None,
        )
        .await?
        {
            return Err(MutateGrowthLevelError::Forbidden);
        }
        let current = sqlx::query_as::<_, AdminGrowthLevelRecord>(
            "SELECT id, internal_key, level_order, display_name, required_experience,
                    icon_asset_id, color, description, status, revision, published_at,
                    created_at, updated_at
             FROM membership_levels
             WHERE id = $1
             FOR UPDATE",
        )
        .bind(input.id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(MutateGrowthLevelError::NotFound)?;
        if current.revision != input.expected_revision {
            return Err(MutateGrowthLevelError::Conflict);
        }
        if !valid_growth_level_transition(&current.status, &input.status) {
            return Err(MutateGrowthLevelError::InvalidTransition);
        }

        let record = sqlx::query_as::<_, AdminGrowthLevelRecord>(
            "UPDATE membership_levels
             SET level_order = $2, display_name = $3, required_experience = $4,
                 icon_asset_id = $5, color = $6, description = $7, status = $8,
                 published_at = CASE
                     WHEN $8 IN ('published', 'disabled', 'archived')
                         THEN COALESCE(published_at, CURRENT_TIMESTAMP)
                     ELSE NULL
                 END,
                 revision = revision + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id, internal_key, level_order, display_name, required_experience,
                       icon_asset_id, color, description, status, revision, published_at,
                       created_at, updated_at",
        )
        .bind(input.id)
        .bind(input.level_order)
        .bind(&input.display_name)
        .bind(input.required_experience)
        .bind(input.icon_asset_id)
        .bind(&input.color)
        .bind(&input.description)
        .bind(&input.status)
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_growth_level_write_error)?;
        insert_audit(
            &mut transaction,
            actor_id,
            "membership.level.update",
            "membership_level",
            Some(record.id),
            serde_json::json!({
                "status_before": current.status,
                "status_after": record.status,
                "revision": record.revision
            }),
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(map_growth_level_write_error)?;
        Ok(record)
    }

    pub async fn list_published_growth_levels(
        &self,
    ) -> Result<Vec<GrowthLevelRecord>, sqlx::Error> {
        sqlx::query_as::<_, GrowthLevelRecord>(
            "SELECT id, internal_key, level_order, display_name, required_experience,
                    icon_asset_id, color, description
             FROM membership_levels
             WHERE status = 'published'
             ORDER BY level_order ASC",
        )
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_experience_account(
        &self,
        user_id: Uuid,
    ) -> Result<ExperienceAccountRecord, sqlx::Error> {
        sqlx::query_as::<_, ExperienceAccountRecord>(
            "SELECT account.user_id, account.experience, account.current_level_id,
                    level.internal_key, level.level_order, level.display_name,
                    level.required_experience, level.icon_asset_id, level.color,
                    level.description, account.revision, account.updated_at
             FROM experience_accounts AS account
             JOIN membership_levels AS level ON level.id = account.current_level_id
             WHERE account.user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn append_experience(
        &self,
        user_id: Uuid,
        amount: i64,
        reason: &str,
        source_resource_id: Option<Uuid>,
        idempotency_key: &str,
        reversal_of: Option<Uuid>,
    ) -> Result<ExperienceLedgerResult, AppendExperienceError> {
        if amount == 0 {
            return Err(AppendExperienceError::InvalidAmount);
        }
        if !valid_reason(reason) {
            return Err(AppendExperienceError::InvalidReason);
        }
        if !valid_idempotency_key(idempotency_key) {
            return Err(AppendExperienceError::InvalidIdempotencyKey);
        }
        if (amount < 0) != reversal_of.is_some() {
            return Err(AppendExperienceError::InvalidReversal);
        }

        let mut transaction = self.pool.begin().await?;
        let account = sqlx::query_as::<_, ExperienceAccountRecord>(
            "SELECT account.user_id, account.experience, account.current_level_id,
                    level.internal_key, level.level_order, level.display_name,
                    level.required_experience, level.icon_asset_id, level.color,
                    level.description, account.revision, account.updated_at
             FROM experience_accounts AS account
             JOIN membership_levels AS level ON level.id = account.current_level_id
             WHERE account.user_id = $1
             FOR UPDATE OF account",
        )
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(AppendExperienceError::AccountNotFound)?;

        if let Some(existing) = sqlx::query_as::<_, ExistingExperienceEntry>(
            "SELECT id, amount, reason, source_resource_id, reversal_of
             FROM experience_ledger_entries
             WHERE user_id = $1 AND idempotency_key = $2",
        )
        .bind(user_id)
        .bind(idempotency_key)
        .fetch_optional(&mut *transaction)
        .await?
        {
            if existing.amount != amount
                || existing.reason != reason
                || existing.source_resource_id != source_resource_id
                || existing.reversal_of != reversal_of
            {
                return Err(AppendExperienceError::IdempotencyConflict);
            }
            transaction.commit().await?;
            return Ok(ExperienceLedgerResult {
                account,
                entry_id: existing.id,
                replayed: true,
            });
        }

        if let Some(original_id) = reversal_of {
            let original_amount = sqlx::query_scalar::<_, i64>(
                "SELECT amount FROM experience_ledger_entries
                 WHERE id = $1 AND user_id = $2",
            )
            .bind(original_id)
            .bind(user_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(AppendExperienceError::ReversalNotFound)?;

            if original_amount.checked_neg() != Some(amount) {
                return Err(AppendExperienceError::InvalidReversal);
            }

            let already_reversed = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(
                     SELECT 1 FROM experience_ledger_entries WHERE reversal_of = $1
                 )",
            )
            .bind(original_id)
            .fetch_one(&mut *transaction)
            .await?;
            if already_reversed {
                return Err(AppendExperienceError::ReversalConflict);
            }
        }

        let experience = account
            .experience
            .checked_add(amount)
            .ok_or(AppendExperienceError::InsufficientExperience)?;
        if experience < 0 {
            return Err(AppendExperienceError::InsufficientExperience);
        }

        let next_level_id = if amount > 0 {
            let target = sqlx::query_as::<_, LevelReference>(
                "SELECT id, level_order
                 FROM membership_levels
                 WHERE status = 'published' AND required_experience <= $1
                 ORDER BY required_experience DESC, level_order DESC
                 LIMIT 1",
            )
            .bind(experience)
            .fetch_optional(&mut *transaction)
            .await?;

            target
                .filter(|level| level.level_order > account.level_order)
                .map_or(account.current_level_id, |level| level.id)
        } else {
            account.current_level_id
        };

        sqlx::query(
            "UPDATE experience_accounts
             SET experience = $2, current_level_id = $3, revision = revision + 1,
                 updated_at = now()
             WHERE user_id = $1",
        )
        .bind(user_id)
        .bind(experience)
        .bind(next_level_id)
        .execute(&mut *transaction)
        .await?;

        let entry_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO experience_ledger_entries (
                 id, user_id, amount, reason, source_resource_id, idempotency_key,
                 reversal_of, balance_after
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(entry_id)
        .bind(user_id)
        .bind(amount)
        .bind(reason)
        .bind(source_resource_id)
        .bind(idempotency_key)
        .bind(reversal_of)
        .bind(experience)
        .execute(&mut *transaction)
        .await?;

        let updated = sqlx::query_as::<_, ExperienceAccountRecord>(
            "SELECT account.user_id, account.experience, account.current_level_id,
                    level.internal_key, level.level_order, level.display_name,
                    level.required_experience, level.icon_asset_id, level.color,
                    level.description, account.revision, account.updated_at
             FROM experience_accounts AS account
             JOIN membership_levels AS level ON level.id = account.current_level_id
             WHERE account.user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;

        enqueue_core_event_in_transaction(
            &mut transaction,
            entry_id,
            "experience.changed",
            "user",
            user_id,
            serde_json::json!({
                "user_id": user_id,
                "entry_id": entry_id,
                "amount": amount,
                "reason": reason,
                "source_resource_id": source_resource_id,
                "reversal_of": reversal_of,
                "experience_after": updated.experience,
                "level_key": updated.internal_key,
                "level_order": updated.level_order,
                "revision": updated.revision,
            }),
        )
        .await?;

        transaction.commit().await?;
        Ok(ExperienceLedgerResult {
            account: updated,
            entry_id,
            replayed: false,
        })
    }
}

#[derive(Debug, FromRow)]
struct ExistingExperienceEntry {
    id: Uuid,
    amount: i64,
    reason: String,
    source_resource_id: Option<Uuid>,
    reversal_of: Option<Uuid>,
}

#[derive(Debug, FromRow)]
struct LevelReference {
    id: Uuid,
    level_order: i32,
}

fn valid_reason(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=80).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_lowercase)
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'.')
        })
}

fn valid_idempotency_key(value: &str) -> bool {
    (1..=128).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn valid_growth_level_input(
    internal_key: &str,
    level_order: i32,
    display_name: &str,
    required_experience: i64,
    color: Option<&str>,
    description: &str,
) -> bool {
    let key = internal_key.as_bytes();
    (3..=64).contains(&key.len())
        && key.first().is_some_and(u8::is_ascii_lowercase)
        && key
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
        && level_order > 0
        && display_name == display_name.trim()
        && (1..=80).contains(&display_name.chars().count())
        && !display_name.chars().any(char::is_control)
        && required_experience >= 0
        && color.is_none_or(valid_hex_color)
        && description.chars().count() <= 500
        && !description.chars().any(char::is_control)
}

fn valid_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_growth_level_status(value: &str) -> bool {
    matches!(value, "draft" | "published" | "disabled" | "archived")
}

fn valid_growth_level_transition(current: &str, next: &str) -> bool {
    matches!(
        (current, next),
        ("draft", "draft" | "published" | "archived")
            | ("published", "published" | "disabled" | "archived")
            | ("disabled", "disabled" | "published" | "archived")
    )
}

fn map_growth_level_write_error(error: sqlx::Error) -> MutateGrowthLevelError {
    if let sqlx::Error::Database(database_error) = &error {
        match database_error.code().as_deref() {
            Some("23505") => return MutateGrowthLevelError::Duplicate,
            Some("23514") => return MutateGrowthLevelError::InvalidThresholdOrder,
            _ => {}
        }
    }
    MutateGrowthLevelError::Database(DatabaseError::from(error))
}

impl From<sqlx::Error> for MutateGrowthLevelError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for AppendExperienceError {
    fn from(error: sqlx::Error) -> Self {
        Self::Sqlx(error)
    }
}

impl fmt::Display for AppendExperienceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidAmount => formatter.write_str("experience amount is invalid"),
            Self::InvalidReason => formatter.write_str("experience reason is invalid"),
            Self::InvalidIdempotencyKey => {
                formatter.write_str("experience idempotency key is invalid")
            }
            Self::InvalidReversal => formatter.write_str("experience reversal is invalid"),
            Self::AccountNotFound => formatter.write_str("experience account was not found"),
            Self::InsufficientExperience => {
                formatter.write_str("experience balance is insufficient")
            }
            Self::ReversalNotFound => formatter.write_str("experience entry was not found"),
            Self::ReversalConflict => formatter.write_str("experience entry was already reversed"),
            Self::IdempotencyConflict => {
                formatter.write_str("experience idempotency key conflicts")
            }
            Self::Sqlx(_) => formatter.write_str("experience operation failed"),
        }
    }
}

impl Error for AppendExperienceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Sqlx(error) => Some(error),
            _ => None,
        }
    }
}

impl fmt::Display for MutateGrowthLevelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("growth level mutation is forbidden"),
            Self::NotFound => formatter.write_str("growth level was not found"),
            Self::Conflict => formatter.write_str("growth level revision conflicts"),
            Self::Duplicate => formatter.write_str("growth level identity conflicts"),
            Self::InvalidInput => formatter.write_str("growth level input is invalid"),
            Self::InvalidTransition => formatter.write_str("growth level transition is invalid"),
            Self::InvalidThresholdOrder => {
                formatter.write_str("growth level thresholds are invalid")
            }
            Self::Database(_) => formatter.write_str("growth level operation failed"),
        }
    }
}

impl Error for MutateGrowthLevelError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            _ => None,
        }
    }
}
