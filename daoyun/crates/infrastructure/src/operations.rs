use serde_json::json;
use sqlx::{FromRow, Postgres, Transaction, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::{Database, DatabaseError};

#[derive(Clone, Debug, PartialEq, Eq, FromRow)]
pub struct OperationsAlertRuleRecord {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub kind: String,
    pub threshold: i64,
    pub window_seconds: i32,
    pub enabled: bool,
    pub revision: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, Eq, FromRow)]
pub struct OperationsAlertRecord {
    pub id: Uuid,
    pub rule_id: Uuid,
    pub rule_key: String,
    pub rule_name: String,
    pub rule_kind: String,
    pub status: String,
    pub observed_value: i64,
    pub threshold: i64,
    pub first_triggered_at: OffsetDateTime,
    pub last_triggered_at: OffsetDateTime,
    pub acknowledged_by_id: Option<Uuid>,
    pub acknowledged_by_username: Option<String>,
    pub acknowledged_by_display_name: Option<String>,
    pub acknowledged_by_avatar_url: Option<String>,
    pub acknowledged_at: Option<OffsetDateTime>,
    pub resolved_at: Option<OffsetDateTime>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OperationsMetricValues {
    pub http_5xx_count: u64,
    pub http_5xx_window_seconds: i32,
    pub http_p95_ms: u64,
    pub http_p95_window_seconds: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationsAlertTransitionRecord {
    pub alert_id: Uuid,
    pub rule_key: String,
    pub previous_status: Option<String>,
    pub status: String,
    pub observed_value: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OperationsSummaryRecord {
    pub database_connections: u32,
    pub database_idle_connections: u32,
    pub outbox_pending: i64,
    pub outbox_processing: i64,
    pub outbox_dead: i64,
    pub risk_alerts_open: i64,
    pub operations_alerts_open: i64,
    pub operations_alerts_acknowledged: i64,
}

#[derive(Debug)]
pub struct UpdateOperationsAlertRuleRecord {
    pub rule_id: Uuid,
    pub name: String,
    pub threshold: i64,
    pub window_seconds: i32,
    pub enabled: bool,
    pub expected_revision: i64,
}

#[derive(Debug)]
pub enum ListOperationsAlertsError {
    InvalidInput,
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum MutateOperationsAlertError {
    Forbidden,
    NotFound,
    Conflict,
    InvalidInput,
    Database(DatabaseError),
}

impl Database {
    pub async fn operations_summary(&self) -> Result<OperationsSummaryRecord, DatabaseError> {
        let counts = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64)>(
            "SELECT
                 COUNT(*) FILTER (WHERE outbox.status = 'pending'),
                 COUNT(*) FILTER (WHERE outbox.status = 'processing'),
                 COUNT(*) FILTER (WHERE outbox.status = 'dead'),
                 (SELECT COUNT(*) FROM risk_alerts WHERE status = 'open'),
                 (SELECT COUNT(*) FROM operations_alerts WHERE status = 'open'),
                 (SELECT COUNT(*) FROM operations_alerts WHERE status = 'acknowledged')
             FROM outbox_events AS outbox",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(OperationsSummaryRecord {
            database_connections: self.pool.size(),
            database_idle_connections: u32::try_from(self.pool.num_idle()).unwrap_or(u32::MAX),
            outbox_pending: counts.0,
            outbox_processing: counts.1,
            outbox_dead: counts.2,
            risk_alerts_open: counts.3,
            operations_alerts_open: counts.4,
            operations_alerts_acknowledged: counts.5,
        })
    }

    pub async fn list_operations_alert_rules(
        &self,
    ) -> Result<Vec<OperationsAlertRuleRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, OperationsAlertRuleRecord>(
            "SELECT id, key, name, kind, threshold, window_seconds, enabled, revision,
                    created_at, updated_at
             FROM operations_alert_rules
             ORDER BY key",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_operations_alerts(
        &self,
        status: Option<&str>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<OperationsAlertRecord>, ListOperationsAlertsError> {
        // The public API accepts at most 50 records and asks the repository
        // for one extra row to determine whether a next page exists.
        if !matches!(limit, 1..=51)
            || status.is_some_and(|status| !matches!(status, "open" | "acknowledged" | "resolved"))
        {
            return Err(ListOperationsAlertsError::InvalidInput);
        }
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                     SELECT 1 FROM operations_alerts
                     WHERE id = $1 AND ($2::text IS NULL OR status = $2)
                 )",
            )
            .bind(cursor)
            .bind(status)
            .fetch_one(&self.pool)
            .await?;
            if !valid {
                return Err(ListOperationsAlertsError::InvalidCursor);
            }
        }

        Ok(sqlx::query_as::<_, OperationsAlertRecord>(
            "SELECT alert.id, alert.rule_id, rule.key AS rule_key, rule.name AS rule_name,
                    rule.kind AS rule_kind, alert.status, alert.observed_value, alert.threshold,
                    alert.first_triggered_at, alert.last_triggered_at,
                    acknowledger.id AS acknowledged_by_id,
                    acknowledger.username AS acknowledged_by_username,
                    acknowledger.display_name AS acknowledged_by_display_name,
                    acknowledger.avatar_url AS acknowledged_by_avatar_url,
                    alert.acknowledged_at, alert.resolved_at
             FROM operations_alerts AS alert
             INNER JOIN operations_alert_rules AS rule ON rule.id = alert.rule_id
             LEFT JOIN users AS acknowledger ON acknowledger.id = alert.acknowledged_by
             WHERE ($1::text IS NULL OR alert.status = $1)
               AND ($2::uuid IS NULL OR (alert.last_triggered_at, alert.id) < (
                   SELECT cursor.last_triggered_at, cursor.id
                   FROM operations_alerts AS cursor
                   WHERE cursor.id = $2
               ))
             ORDER BY alert.last_triggered_at DESC, alert.id DESC
             LIMIT $3",
        )
        .bind(status)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn update_operations_alert_rule(
        &self,
        actor_id: Uuid,
        input: UpdateOperationsAlertRuleRecord,
    ) -> Result<OperationsAlertRuleRecord, MutateOperationsAlertError> {
        if !valid_rule_input(&input) {
            return Err(MutateOperationsAlertError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        authorize_operations_write(&mut transaction, actor_id).await?;
        let current_revision = sqlx::query_scalar::<_, i64>(
            "SELECT revision FROM operations_alert_rules WHERE id = $1 FOR UPDATE",
        )
        .bind(input.rule_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(MutateOperationsAlertError::NotFound)?;
        if current_revision != input.expected_revision {
            return Err(MutateOperationsAlertError::Conflict);
        }

        let rule = sqlx::query_as::<_, OperationsAlertRuleRecord>(
            "UPDATE operations_alert_rules
             SET name = $2, threshold = $3, window_seconds = $4, enabled = $5,
                 revision = revision + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id, key, name, kind, threshold, window_seconds, enabled, revision,
                       created_at, updated_at",
        )
        .bind(input.rule_id)
        .bind(&input.name)
        .bind(input.threshold)
        .bind(input.window_seconds)
        .bind(input.enabled)
        .fetch_one(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "operations.alert_rule.update",
            "operations_alert_rule",
            Some(rule.id),
            json!({
                "key": rule.key,
                "threshold": rule.threshold,
                "window_seconds": rule.window_seconds,
                "enabled": rule.enabled,
                "revision": rule.revision
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(rule)
    }

    pub async fn acknowledge_operations_alert(
        &self,
        actor_id: Uuid,
        alert_id: Uuid,
    ) -> Result<OperationsAlertRecord, MutateOperationsAlertError> {
        let mut transaction = self.pool.begin().await?;
        authorize_operations_write(&mut transaction, actor_id).await?;
        let status = sqlx::query_scalar::<_, String>(
            "SELECT status FROM operations_alerts WHERE id = $1 FOR UPDATE",
        )
        .bind(alert_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(MutateOperationsAlertError::NotFound)?;
        if status != "open" {
            return Err(MutateOperationsAlertError::Conflict);
        }
        sqlx::query(
            "UPDATE operations_alerts
             SET status = 'acknowledged', acknowledged_by = $2,
                 acknowledged_at = CURRENT_TIMESTAMP
             WHERE id = $1",
        )
        .bind(alert_id)
        .bind(actor_id)
        .execute(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "operations.alert.acknowledge",
            "operations_alert",
            Some(alert_id),
            json!({"status": "acknowledged"}),
        )
        .await?;
        let alert = fetch_operations_alert(&mut transaction, alert_id).await?;
        transaction.commit().await?;
        Ok(alert)
    }

    pub async fn evaluate_operations_alerts(
        &self,
        metrics: OperationsMetricValues,
    ) -> Result<Vec<OperationsAlertTransitionRecord>, DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        let persistent_counts = sqlx::query_as::<_, (i64, i64)>(
            "SELECT
                 (SELECT COUNT(*) FROM outbox_events WHERE status = 'dead'),
                 (SELECT COUNT(*) FROM risk_alerts WHERE status = 'open')",
        )
        .fetch_one(&mut *transaction)
        .await?;
        let rules = sqlx::query_as::<_, OperationsAlertRuleRecord>(
            "SELECT id, key, name, kind, threshold, window_seconds, enabled, revision,
                    created_at, updated_at
             FROM operations_alert_rules
             ORDER BY key
             FOR UPDATE",
        )
        .fetch_all(&mut *transaction)
        .await?;
        let mut transitions = Vec::new();
        for rule in rules {
            let observed_value = match rule.kind.as_str() {
                "http_5xx_count" if rule.window_seconds == metrics.http_5xx_window_seconds => {
                    saturating_i64(metrics.http_5xx_count)
                }
                "http_p95_ms" if rule.window_seconds == metrics.http_p95_window_seconds => {
                    saturating_i64(metrics.http_p95_ms)
                }
                "http_5xx_count" | "http_p95_ms" => continue,
                "outbox_dead_count" => persistent_counts.0,
                "risk_alert_open_count" => persistent_counts.1,
                _ => continue,
            };
            let active = sqlx::query_as::<_, (Uuid, String)>(
                "SELECT id, status FROM operations_alerts
                 WHERE rule_id = $1 AND status IN ('open', 'acknowledged')
                 FOR UPDATE",
            )
            .bind(rule.id)
            .fetch_optional(&mut *transaction)
            .await?;
            let breached = rule.enabled && observed_value > rule.threshold;
            match (breached, active) {
                (true, Some((alert_id, _))) => {
                    sqlx::query(
                        "UPDATE operations_alerts
                         SET observed_value = $2, threshold = $3,
                             last_triggered_at = CURRENT_TIMESTAMP
                         WHERE id = $1",
                    )
                    .bind(alert_id)
                    .bind(observed_value)
                    .bind(rule.threshold)
                    .execute(&mut *transaction)
                    .await?;
                }
                (true, None) => {
                    let alert_id = Uuid::now_v7();
                    sqlx::query(
                        "INSERT INTO operations_alerts
                         (id, rule_id, status, observed_value, threshold)
                         VALUES ($1, $2, 'open', $3, $4)",
                    )
                    .bind(alert_id)
                    .bind(rule.id)
                    .bind(observed_value)
                    .bind(rule.threshold)
                    .execute(&mut *transaction)
                    .await?;
                    transitions.push(OperationsAlertTransitionRecord {
                        alert_id,
                        rule_key: rule.key,
                        previous_status: None,
                        status: "open".to_owned(),
                        observed_value,
                    });
                }
                (false, Some((alert_id, previous_status))) => {
                    sqlx::query(
                        "UPDATE operations_alerts
                         SET status = 'resolved', observed_value = $2, threshold = $3,
                             resolved_at = CURRENT_TIMESTAMP
                         WHERE id = $1",
                    )
                    .bind(alert_id)
                    .bind(observed_value)
                    .bind(rule.threshold)
                    .execute(&mut *transaction)
                    .await?;
                    transitions.push(OperationsAlertTransitionRecord {
                        alert_id,
                        rule_key: rule.key,
                        previous_status: Some(previous_status),
                        status: "resolved".to_owned(),
                        observed_value,
                    });
                }
                (false, None) => {}
            }
        }
        transaction.commit().await?;
        Ok(transitions)
    }
}

async fn fetch_operations_alert(
    transaction: &mut Transaction<'_, Postgres>,
    alert_id: Uuid,
) -> Result<OperationsAlertRecord, sqlx::Error> {
    sqlx::query_as::<_, OperationsAlertRecord>(
        "SELECT alert.id, alert.rule_id, rule.key AS rule_key, rule.name AS rule_name,
                rule.kind AS rule_kind, alert.status, alert.observed_value, alert.threshold,
                alert.first_triggered_at, alert.last_triggered_at,
                acknowledger.id AS acknowledged_by_id,
                acknowledger.username AS acknowledged_by_username,
                acknowledger.display_name AS acknowledged_by_display_name,
                acknowledger.avatar_url AS acknowledged_by_avatar_url,
                alert.acknowledged_at, alert.resolved_at
         FROM operations_alerts AS alert
         INNER JOIN operations_alert_rules AS rule ON rule.id = alert.rule_id
         LEFT JOIN users AS acknowledger ON acknowledger.id = alert.acknowledged_by
         WHERE alert.id = $1",
    )
    .bind(alert_id)
    .fetch_one(&mut **transaction)
    .await
}

async fn authorize_operations_write(
    transaction: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
) -> Result<(), MutateOperationsAlertError> {
    let actor_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 FOR UPDATE)",
    )
    .bind(actor_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !actor_exists
        || !has_permission_with_executor(
            &mut *transaction,
            actor_id,
            permission_keys::OPERATIONS_ALERTS_WRITE,
            None,
        )
        .await?
    {
        return Err(MutateOperationsAlertError::Forbidden);
    }
    Ok(())
}

fn valid_rule_input(input: &UpdateOperationsAlertRuleRecord) -> bool {
    let trimmed = input.name.trim();
    input.name == trimmed
        && (1..=80).contains(&input.name.chars().count())
        && !input.name.chars().any(char::is_control)
        && (0..=1_000_000_000).contains(&input.threshold)
        && (30..=86_400).contains(&input.window_seconds)
        && input.expected_revision > 0
}

fn saturating_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

impl From<sqlx::Error> for ListOperationsAlertsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl From<sqlx::Error> for MutateOperationsAlertError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl From<DatabaseError> for MutateOperationsAlertError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}
