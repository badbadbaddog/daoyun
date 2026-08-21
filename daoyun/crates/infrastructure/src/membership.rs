use std::{error::Error, fmt};

use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::outbox::enqueue_core_event_in_transaction;
use crate::{Database, DatabaseError};

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct MembershipAccountRecord {
    pub user_id: Uuid,
    pub points_balance: i64,
    pub lifetime_points: i64,
    pub level_key: String,
    pub level_number: i16,
    pub level_display_name: String,
    pub revision: i64,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipLedgerResult {
    pub account: MembershipAccountRecord,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct MembershipLevelRuleRecord {
    pub level_key: String,
    pub level_number: i16,
    pub level_display_name: String,
    pub required_lifetime_points: i64,
    pub enabled: bool,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct MembershipMedalRecord {
    pub user_id: Uuid,
    pub medal_key: String,
    pub granted_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct MembershipMedalRuleRecord {
    pub medal_key: String,
    pub enabled: bool,
    pub required_lifetime_points: Option<i64>,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct UpdateMembershipMedalRuleRecord {
    pub medal_key: String,
    pub enabled: bool,
    pub required_lifetime_points: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantMembershipMedalResult {
    pub medal: MembershipMedalRecord,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct MembershipMedalOperationRecord {
    pub id: Uuid,
    pub operation: String,
    pub user_id: Uuid,
    pub username: String,
    pub user_display_name: String,
    pub medal_key: String,
    pub reason: String,
    pub actor_id: Uuid,
    pub actor_username: String,
    pub actor_display_name: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevokeMembershipMedalResult {
    pub user_id: Uuid,
    pub medal_key: String,
    pub revoked: bool,
}

#[derive(Debug)]
pub struct UpdateMembershipLevelRuleRecord {
    pub level_key: String,
    pub required_lifetime_points: Option<i64>,
    pub enabled: Option<bool>,
    pub display_name: Option<String>,
}

#[derive(Debug)]
pub enum AppendPointsLedgerError {
    Forbidden,
    AccountNotFound,
    InvalidAmount,
    InvalidReason,
    InsufficientBalance,
    IdempotencyConflict,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum UpdateMembershipLevelRuleError {
    Forbidden,
    InvalidLevel,
    InvalidThreshold,
    InvalidThresholdOrder,
    InvalidDisplayName,
    InvalidAppendOrder,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum GrantMembershipMedalError {
    Forbidden,
    UserNotFound,
    InvalidMedal,
    InvalidReason,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListMembershipMedalOperationsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum RevokeMembershipMedalError {
    Forbidden,
    UserNotFound,
    InvalidMedal,
    InvalidReason,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum UpdateMembershipMedalRuleError {
    Forbidden,
    InvalidMedal,
    InvalidThreshold,
    Database(DatabaseError),
}

impl Database {
    pub async fn get_membership_account(
        &self,
        user_id: Uuid,
    ) -> Result<Option<MembershipAccountRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, MembershipAccountRecord>(
            "SELECT account.user_id, account.points_balance, account.lifetime_points,
                    account.level_key, rule.level_number, rule.level_display_name,
                    account.revision, account.updated_at
             FROM membership_accounts AS account
             JOIN membership_level_rules AS rule ON rule.level_key = account.level_key
             WHERE account.user_id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn append_points_ledger(
        &self,
        user_id: Uuid,
        amount: i64,
        reason: &str,
        idempotency_key: Option<&str>,
    ) -> Result<MembershipLedgerResult, AppendPointsLedgerError> {
        self.append_points_ledger_with_actor(None, user_id, amount, reason, idempotency_key, false)
            .await
    }

    pub async fn grant_membership_points(
        &self,
        actor_id: Uuid,
        user_id: Uuid,
        amount: i64,
        reason: &str,
        idempotency_key: Option<&str>,
    ) -> Result<MembershipLedgerResult, AppendPointsLedgerError> {
        self.append_points_ledger_with_actor(
            Some(actor_id),
            user_id,
            amount,
            reason,
            idempotency_key,
            true,
        )
        .await
    }

    pub(crate) async fn grant_membership_points_from_plugin(
        &self,
        actor_id: Uuid,
        user_id: Uuid,
        amount: i64,
        reason: &str,
        idempotency_key: Option<&str>,
    ) -> Result<MembershipLedgerResult, AppendPointsLedgerError> {
        self.append_points_ledger_with_actor(
            Some(actor_id),
            user_id,
            amount,
            reason,
            idempotency_key,
            false,
        )
        .await
    }

    pub async fn list_membership_level_rules(
        &self,
    ) -> Result<Vec<MembershipLevelRuleRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, MembershipLevelRuleRecord>(
            "SELECT level_key, level_number, level_display_name,
                    required_lifetime_points, enabled, updated_at
             FROM membership_level_rules
             WHERE enabled
             ORDER BY level_number",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_membership_medals(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<MembershipMedalRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, MembershipMedalRecord>(
            "SELECT user_id, medal_key, granted_at
             FROM membership_medals WHERE user_id = $1
             ORDER BY granted_at DESC, medal_key",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_membership_medal_rules(
        &self,
    ) -> Result<Vec<MembershipMedalRuleRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, MembershipMedalRuleRecord>(
            "SELECT medal_key, enabled, required_lifetime_points, updated_at
             FROM membership_medal_rules ORDER BY medal_key",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_membership_medal_operations(
        &self,
        user_id: Option<Uuid>,
        medal_key: Option<&str>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<MembershipMedalOperationRecord>, ListMembershipMedalOperationsError> {
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                     SELECT 1 FROM admin_audit_log AS audit
                     WHERE audit.id = $1
                       AND audit.resource_type = 'membership_medal'
                       AND audit.action IN (
                           'membership.medal.grant',
                           'membership.medal.auto_grant',
                           'membership.medal.revoke'
                       )
                       AND ($2::uuid IS NULL OR audit.resource_id = $2)
                       AND ($3::text IS NULL OR audit.summary ->> 'medal_key' = $3)
                 )",
            )
            .bind(cursor)
            .bind(user_id)
            .bind(medal_key)
            .fetch_one(&self.pool)
            .await?;
            if !valid {
                return Err(ListMembershipMedalOperationsError::InvalidCursor);
            }
        }

        Ok(sqlx::query_as::<_, MembershipMedalOperationRecord>(
            "SELECT audit.id,
                    CASE audit.action
                        WHEN 'membership.medal.grant' THEN 'grant'
                        WHEN 'membership.medal.auto_grant' THEN 'automatic_grant'
                        WHEN 'membership.medal.revoke' THEN 'revoke'
                    END AS operation,
                    target.id AS user_id, target.username,
                    target.display_name AS user_display_name,
                    audit.summary ->> 'medal_key' AS medal_key,
                    COALESCE(audit.summary ->> 'reason', '') AS reason,
                    actor.id AS actor_id, actor.username AS actor_username,
                    actor.display_name AS actor_display_name, audit.created_at
             FROM admin_audit_log AS audit
             INNER JOIN users AS target ON target.id = audit.resource_id
             INNER JOIN users AS actor ON actor.id = audit.actor_id
             WHERE audit.resource_type = 'membership_medal'
               AND audit.action IN (
                   'membership.medal.grant',
                   'membership.medal.auto_grant',
                   'membership.medal.revoke'
               )
               AND ($1::uuid IS NULL OR audit.resource_id = $1)
               AND ($2::text IS NULL OR audit.summary ->> 'medal_key' = $2)
               AND ($3::uuid IS NULL OR (audit.created_at, audit.id) < (
                   SELECT cursor.created_at, cursor.id
                   FROM admin_audit_log AS cursor
                   WHERE cursor.id = $3
               ))
             ORDER BY audit.created_at DESC, audit.id DESC
             LIMIT $4",
        )
        .bind(user_id)
        .bind(medal_key)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn update_membership_medal_rule(
        &self,
        actor_id: Uuid,
        input: UpdateMembershipMedalRuleRecord,
    ) -> Result<MembershipMedalRuleRecord, UpdateMembershipMedalRuleError> {
        if !medal_key_valid(&input.medal_key) {
            return Err(UpdateMembershipMedalRuleError::InvalidMedal);
        }
        if input.enabled && input.required_lifetime_points.is_none_or(|value| value < 0) {
            return Err(UpdateMembershipMedalRuleError::InvalidThreshold);
        }
        if input
            .required_lifetime_points
            .is_some_and(|value| value < 0)
        {
            return Err(UpdateMembershipMedalRuleError::InvalidThreshold);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::MEMBERSHIP_MEDAL_RULES_WRITE,
            None,
        )
        .await?
        {
            return Err(UpdateMembershipMedalRuleError::Forbidden);
        }
        let record = sqlx::query_as::<_, MembershipMedalRuleRecord>(
            "UPDATE membership_medal_rules
             SET enabled = $2, required_lifetime_points = $3,
                 updated_by = $4, updated_at = CURRENT_TIMESTAMP
             WHERE medal_key = $1
             RETURNING medal_key, enabled, required_lifetime_points, updated_at",
        )
        .bind(&input.medal_key)
        .bind(input.enabled)
        .bind(input.required_lifetime_points)
        .bind(actor_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(UpdateMembershipMedalRuleError::InvalidMedal)?;
        insert_audit(
            &mut transaction,
            actor_id,
            "membership.medal.rule.update",
            "membership_medal_rule",
            None,
            serde_json::json!({
                "medal_key": record.medal_key,
                "enabled": record.enabled,
                "required_lifetime_points": record.required_lifetime_points
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn grant_membership_medal(
        &self,
        actor_id: Uuid,
        user_id: Uuid,
        medal_key: &str,
        reason: &str,
    ) -> Result<GrantMembershipMedalResult, GrantMembershipMedalError> {
        if !medal_key_valid(medal_key) {
            return Err(GrantMembershipMedalError::InvalidMedal);
        }
        if !valid_reason(reason) {
            return Err(GrantMembershipMedalError::InvalidReason);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::MEMBERSHIP_MEDALS_GRANT,
            None,
        )
        .await?
        {
            return Err(GrantMembershipMedalError::Forbidden);
        }
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND status = 'active')",
        )
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !exists {
            return Err(GrantMembershipMedalError::UserNotFound);
        }
        let inserted = sqlx::query_as::<_, MembershipMedalRecord>(
            "INSERT INTO membership_medals (user_id, medal_key, granted_by, reason)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, medal_key) DO NOTHING
             RETURNING user_id, medal_key, granted_at",
        )
        .bind(user_id)
        .bind(medal_key)
        .bind(actor_id)
        .bind(reason)
        .fetch_optional(&mut *transaction)
        .await?;
        let (medal, created) = match inserted {
            Some(record) => (record, true),
            None => (
                sqlx::query_as::<_, MembershipMedalRecord>(
                    "SELECT user_id, medal_key, granted_at
                     FROM membership_medals WHERE user_id = $1 AND medal_key = $2",
                )
                .bind(user_id)
                .bind(medal_key)
                .fetch_one(&mut *transaction)
                .await?,
                false,
            ),
        };
        if created {
            insert_audit(
                &mut transaction,
                actor_id,
                "membership.medal.grant",
                "membership_medal",
                Some(user_id),
                serde_json::json!({ "user_id": user_id, "medal_key": medal_key, "reason": reason }),
            )
            .await?;
        }
        transaction.commit().await?;
        Ok(GrantMembershipMedalResult { medal, created })
    }

    pub async fn revoke_membership_medal(
        &self,
        actor_id: Uuid,
        user_id: Uuid,
        medal_key: &str,
        reason: &str,
    ) -> Result<RevokeMembershipMedalResult, RevokeMembershipMedalError> {
        if !medal_key_valid(medal_key) {
            return Err(RevokeMembershipMedalError::InvalidMedal);
        }
        if !valid_medal_operation_reason(reason) {
            return Err(RevokeMembershipMedalError::InvalidReason);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::MEMBERSHIP_MEDALS_GRANT,
            None,
        )
        .await?
        {
            return Err(RevokeMembershipMedalError::Forbidden);
        }
        let user_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND status = 'active')",
        )
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !user_exists {
            return Err(RevokeMembershipMedalError::UserNotFound);
        }
        let revoked =
            sqlx::query("DELETE FROM membership_medals WHERE user_id = $1 AND medal_key = $2")
                .bind(user_id)
                .bind(medal_key)
                .execute(&mut *transaction)
                .await?
                .rows_affected()
                == 1;
        if revoked {
            insert_audit(
                &mut transaction,
                actor_id,
                "membership.medal.revoke",
                "membership_medal",
                Some(user_id),
                serde_json::json!({ "user_id": user_id, "medal_key": medal_key, "reason": reason }),
            )
            .await?;
        }
        transaction.commit().await?;
        Ok(RevokeMembershipMedalResult {
            user_id,
            medal_key: medal_key.to_owned(),
            revoked,
        })
    }

    pub async fn update_membership_level_rule(
        &self,
        actor_id: Uuid,
        input: UpdateMembershipLevelRuleRecord,
    ) -> Result<MembershipLevelRuleRecord, UpdateMembershipLevelRuleError> {
        let Some(level_number) = level_number(&input.level_key) else {
            return Err(UpdateMembershipLevelRuleError::InvalidLevel);
        };
        if input
            .required_lifetime_points
            .is_some_and(|value| value < 0)
        {
            return Err(UpdateMembershipLevelRuleError::InvalidThreshold);
        }
        if input.display_name.as_deref().is_some_and(|value| {
            let value = value.trim();
            !value.is_empty() && !valid_level_display_name(value)
        }) {
            return Err(UpdateMembershipLevelRuleError::InvalidDisplayName);
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
            return Err(UpdateMembershipLevelRuleError::Forbidden);
        }
        let mut rules = sqlx::query_as::<_, MembershipLevelRuleRecord>(
            "SELECT level_key, level_number, level_display_name,
                    required_lifetime_points, enabled, updated_at
             FROM membership_level_rules ORDER BY level_number FOR UPDATE",
        )
        .fetch_all(&mut *transaction)
        .await?;
        let target_index = rules
            .iter()
            .position(|rule| rule.level_number == level_number)
            .ok_or(UpdateMembershipLevelRuleError::InvalidLevel)?;
        let current = rules[target_index].clone();
        let highest_open_level = rules
            .iter()
            .filter(|rule| rule.enabled)
            .map(|rule| rule.level_number)
            .max()
            .unwrap_or(0);
        let enabled = input.enabled.unwrap_or(current.enabled);
        let required_lifetime_points = input
            .required_lifetime_points
            .unwrap_or(current.required_lifetime_points);
        let display_name = input
            .display_name
            .map_or(current.level_display_name.clone(), |value| {
                let value = value.trim();
                if value.is_empty() {
                    default_level_display_name(level_number)
                } else {
                    value.to_owned()
                }
            });

        if level_number == 1 && (!enabled || required_lifetime_points != 0) {
            return Err(UpdateMembershipLevelRuleError::InvalidThreshold);
        }
        if level_number > 1 && enabled && required_lifetime_points <= 0 {
            return Err(UpdateMembershipLevelRuleError::InvalidThreshold);
        }
        if current.enabled && !enabled {
            return Err(UpdateMembershipLevelRuleError::InvalidAppendOrder);
        }
        if !current.enabled && (!enabled || level_number != highest_open_level.saturating_add(1)) {
            return Err(UpdateMembershipLevelRuleError::InvalidAppendOrder);
        }

        rules[target_index].enabled = enabled;
        rules[target_index].required_lifetime_points = required_lifetime_points;
        rules[target_index].level_display_name = display_name.clone();

        let mut previous_threshold = None;
        for rule in rules.iter().filter(|rule| rule.enabled) {
            if previous_threshold.is_none() && rule.level_number != 1 {
                return Err(UpdateMembershipLevelRuleError::InvalidAppendOrder);
            }
            if previous_threshold
                .is_some_and(|threshold| rule.required_lifetime_points <= threshold)
            {
                return Err(UpdateMembershipLevelRuleError::InvalidThresholdOrder);
            }
            previous_threshold = Some(rule.required_lifetime_points);
        }

        let record = sqlx::query_as::<_, MembershipLevelRuleRecord>(
            "UPDATE membership_level_rules
             SET required_lifetime_points = $2, enabled = $3, level_display_name = $4,
                 updated_by = $5,
                 updated_at = CURRENT_TIMESTAMP
             WHERE level_key = $1
             RETURNING level_key, level_number, level_display_name,
                       required_lifetime_points, enabled, updated_at",
        )
        .bind(&input.level_key)
        .bind(required_lifetime_points)
        .bind(enabled)
        .bind(&display_name)
        .bind(actor_id)
        .fetch_one(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "membership.rule.update",
            "membership_level_rule",
            None,
            serde_json::json!({
                "level_key": record.level_key,
                "level_number": record.level_number,
                "level_display_name_before": current.level_display_name,
                "level_display_name_after": record.level_display_name,
                "enabled": record.enabled,
                "required_lifetime_points": record.required_lifetime_points
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
    }

    async fn append_points_ledger_with_actor(
        &self,
        actor_id: Option<Uuid>,
        user_id: Uuid,
        amount: i64,
        reason: &str,
        idempotency_key: Option<&str>,
        enforce_admin_authorization: bool,
    ) -> Result<MembershipLedgerResult, AppendPointsLedgerError> {
        if amount == 0 {
            return Err(AppendPointsLedgerError::InvalidAmount);
        }
        if !valid_reason(reason) {
            return Err(AppendPointsLedgerError::InvalidReason);
        }
        if let Some(key) = idempotency_key
            && !valid_idempotency_key(key)
        {
            return Err(AppendPointsLedgerError::IdempotencyConflict);
        }

        let mut transaction = self.pool.begin().await?;
        if enforce_admin_authorization
            && let Some(actor_id) = actor_id
            && !has_permission_with_executor(
                &mut transaction,
                actor_id,
                permission_keys::MEMBERSHIP_POINTS_GRANT,
                None,
            )
            .await?
        {
            return Err(AppendPointsLedgerError::Forbidden);
        }
        let account = sqlx::query_as::<_, MembershipAccountRecord>(
            "SELECT account.user_id, account.points_balance, account.lifetime_points,
                    account.level_key, rule.level_number, rule.level_display_name,
                    account.revision, account.updated_at
             FROM membership_accounts AS account
             JOIN membership_level_rules AS rule ON rule.level_key = account.level_key
             WHERE account.user_id = $1
             FOR UPDATE OF account",
        )
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(AppendPointsLedgerError::AccountNotFound)?;

        if let Some(key) = idempotency_key
            && let Some(existing) = sqlx::query_as::<_, ExistingLedgerEntry>(
                "SELECT amount, reason FROM point_ledger_entries
                 WHERE user_id = $1 AND idempotency_key = $2",
            )
            .bind(user_id)
            .bind(key)
            .fetch_optional(&mut *transaction)
            .await?
        {
            if existing.amount != amount || existing.reason != reason {
                return Err(AppendPointsLedgerError::IdempotencyConflict);
            }
            transaction.commit().await?;
            return Ok(MembershipLedgerResult {
                account,
                created: false,
            });
        }

        let balance = account
            .points_balance
            .checked_add(amount)
            .ok_or(AppendPointsLedgerError::InsufficientBalance)?;
        if balance < 0 {
            return Err(AppendPointsLedgerError::InsufficientBalance);
        }
        let lifetime_points = account
            .lifetime_points
            .checked_add(amount.max(0))
            .ok_or(AppendPointsLedgerError::InsufficientBalance)?;
        let target_level = sqlx::query_scalar::<_, String>(
            "SELECT level_key FROM membership_level_rules
             WHERE enabled AND required_lifetime_points <= $1
             ORDER BY level_number DESC LIMIT 1",
        )
        .bind(lifetime_points)
        .fetch_optional(&mut *transaction)
        .await?
        .unwrap_or_else(|| account.level_key.clone());
        let level_key = if level_number(&target_level) > level_number(&account.level_key) {
            target_level
        } else {
            account.level_key.clone()
        };
        sqlx::query(
            "UPDATE membership_accounts
             SET points_balance = $2, lifetime_points = $3, level_key = $4,
                 revision = revision + 1, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1",
        )
        .bind(user_id)
        .bind(balance)
        .bind(lifetime_points)
        .bind(&level_key)
        .execute(&mut *transaction)
        .await?;
        let entry_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO point_ledger_entries
                (id, user_id, amount, reason, idempotency_key, balance_after)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(entry_id)
        .bind(user_id)
        .bind(amount)
        .bind(reason)
        .bind(idempotency_key)
        .bind(balance)
        .execute(&mut *transaction)
        .await?;
        if let Some(actor_id) = actor_id {
            insert_audit(
                &mut transaction,
                actor_id,
                "membership.points.grant",
                "membership_account",
                Some(user_id),
                serde_json::json!({
                    "amount": amount,
                    "balance_after": balance,
                    "idempotency_key": idempotency_key,
                    "level_after": level_key,
                    "level_before": account.level_key,
                    "lifetime_points": lifetime_points,
                    "reason": reason
                }),
            )
            .await?;
        }
        let automatic_medals = sqlx::query_as::<_, MembershipMedalRecord>(
            "INSERT INTO membership_medals (user_id, medal_key, reason)
             SELECT $1, medal_key, 'rule.points'
             FROM membership_medal_rules
             WHERE enabled AND required_lifetime_points IS NOT NULL
               AND required_lifetime_points <= $2
             ON CONFLICT (user_id, medal_key) DO NOTHING
             RETURNING user_id, medal_key, granted_at",
        )
        .bind(user_id)
        .bind(lifetime_points)
        .fetch_all(&mut *transaction)
        .await?;
        for medal in automatic_medals {
            insert_audit(
                &mut transaction,
                user_id,
                "membership.medal.auto_grant",
                "membership_medal",
                Some(user_id),
                serde_json::json!({ "user_id": user_id, "medal_key": medal.medal_key, "reason": "rule.points" }),
            )
            .await?;
        }
        let account = sqlx::query_as::<_, MembershipAccountRecord>(
            "SELECT account.user_id, account.points_balance, account.lifetime_points,
                    account.level_key, rule.level_number, rule.level_display_name,
                    account.revision, account.updated_at
             FROM membership_accounts AS account
             JOIN membership_level_rules AS rule ON rule.level_key = account.level_key
             WHERE account.user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        enqueue_core_event_in_transaction(
            &mut transaction,
            entry_id,
            "points.changed",
            "user",
            user_id,
            serde_json::json!({
                "user_id": user_id,
                "entry_id": entry_id,
                "amount": amount,
                "reason": reason,
                "balance_after": account.points_balance,
                "lifetime_points": account.lifetime_points,
                "level_key": account.level_key,
                "revision": account.revision,
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(MembershipLedgerResult {
            account,
            created: true,
        })
    }
}

fn level_number(value: &str) -> Option<i16> {
    let number = value.strip_prefix("lv_")?.parse::<i16>().ok()?;
    (1..=20).contains(&number).then_some(number)
}

fn default_level_display_name(number: i16) -> String {
    format!("Lv{number}")
}

fn valid_level_display_name(value: &str) -> bool {
    (1..=80).contains(&value.chars().count()) && !value.chars().any(char::is_control)
}

fn medal_key_valid(value: &str) -> bool {
    let Some(number) = value.strip_prefix("medal_") else {
        return false;
    };
    matches!(number.parse::<u8>(), Ok(value) if (1..=17).contains(&value) && number == format!("{value:02}"))
}

#[derive(Debug, FromRow)]
struct ExistingLedgerEntry {
    amount: i64,
    reason: String,
}

fn valid_reason(value: &str) -> bool {
    (2..=64).contains(&value.len())
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

fn valid_medal_operation_reason(value: &str) -> bool {
    value == value.trim()
        && (1..=64).contains(&value.chars().count())
        && !value.chars().any(char::is_control)
}

fn valid_idempotency_key(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

impl From<sqlx::Error> for AppendPointsLedgerError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for UpdateMembershipLevelRuleError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for GrantMembershipMedalError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for ListMembershipMedalOperationsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for RevokeMembershipMedalError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for UpdateMembershipMedalRuleError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for AppendPointsLedgerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("membership points mutation is forbidden"),
            Self::AccountNotFound => formatter.write_str("membership account was not found"),
            Self::InvalidAmount => formatter.write_str("points amount cannot be zero"),
            Self::InvalidReason => formatter.write_str("points reason is invalid"),
            Self::InsufficientBalance => formatter.write_str("points balance cannot be negative"),
            Self::IdempotencyConflict => formatter.write_str("points idempotency key conflicts"),
            Self::Database(_) => formatter.write_str("points ledger database operation failed"),
        }
    }
}

impl Error for AppendPointsLedgerError {}

impl fmt::Display for UpdateMembershipLevelRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("membership level rule mutation is forbidden"),
            Self::InvalidLevel => formatter.write_str("membership level is invalid"),
            Self::InvalidThreshold => formatter.write_str("membership threshold is invalid"),
            Self::InvalidThresholdOrder => {
                formatter.write_str("membership thresholds must increase by level")
            }
            Self::InvalidDisplayName => {
                formatter.write_str("membership level display name is invalid")
            }
            Self::InvalidAppendOrder => {
                formatter.write_str("membership levels must be opened in sequence")
            }
            Self::Database(_) => formatter.write_str("membership rule database operation failed"),
        }
    }
}

impl Error for UpdateMembershipLevelRuleError {}

impl fmt::Display for GrantMembershipMedalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("membership medal grant is forbidden"),
            Self::UserNotFound => formatter.write_str("medal target user was not found"),
            Self::InvalidMedal => formatter.write_str("medal key is invalid"),
            Self::InvalidReason => formatter.write_str("medal reason is invalid"),
            Self::Database(_) => formatter.write_str("medal grant database operation failed"),
        }
    }
}

impl Error for GrantMembershipMedalError {}

impl fmt::Display for ListMembershipMedalOperationsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCursor => {
                formatter.write_str("membership medal operation cursor is invalid")
            }
            Self::Database(_) => formatter.write_str("membership medal operation query failed"),
        }
    }
}

impl Error for ListMembershipMedalOperationsError {}

impl fmt::Display for RevokeMembershipMedalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("membership medal revocation is forbidden"),
            Self::UserNotFound => formatter.write_str("medal target user was not found"),
            Self::InvalidMedal => formatter.write_str("medal key is invalid"),
            Self::InvalidReason => formatter.write_str("medal revocation reason is invalid"),
            Self::Database(_) => formatter.write_str("membership medal revocation failed"),
        }
    }
}

impl Error for RevokeMembershipMedalError {}

impl fmt::Display for UpdateMembershipMedalRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("membership medal rule mutation is forbidden"),
            Self::InvalidMedal => formatter.write_str("medal key is invalid"),
            Self::InvalidThreshold => formatter.write_str("medal threshold is invalid"),
            Self::Database(_) => formatter.write_str("medal rule database operation failed"),
        }
    }
}

impl Error for UpdateMembershipMedalRuleError {}
