use crate::{Database, DatabaseError};
use serde_json::Value;
use sqlx::{Postgres, Transaction};
use std::{error::Error, fmt, time::Duration};
use time::OffsetDateTime;
use uuid::Uuid;

const MAX_EVENT_PAYLOAD_BYTES: usize = 65_536;
const MAX_CLAIM_BATCH: i64 = 100;
const MAX_LEASE_SECONDS: u64 = 300;
const MAX_ERROR_SUMMARY_CHARS: usize = 500;

#[derive(Clone, Debug)]
pub struct NewOutboxEvent {
    pub id: Uuid,
    pub event_type: String,
    pub aggregate_type: String,
    pub aggregate_id: Uuid,
    pub dedupe_key: String,
    pub payload: Value,
    pub max_attempts: i16,
}

#[derive(Clone, Debug, PartialEq, sqlx::FromRow)]
pub struct OutboxEventRecord {
    pub id: Uuid,
    pub event_type: String,
    pub aggregate_type: String,
    pub aggregate_id: Uuid,
    pub dedupe_key: String,
    pub payload: Value,
    pub attempts: i16,
    pub max_attempts: i16,
    pub available_at: OffsetDateTime,
    pub created_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, sqlx::FromRow)]
pub struct ClaimedOutboxEvent {
    pub id: Uuid,
    pub event_type: String,
    pub aggregate_type: String,
    pub aggregate_id: Uuid,
    pub payload: Value,
    pub attempts: i16,
    pub max_attempts: i16,
    pub lock_token: Uuid,
    pub locked_until: OffsetDateTime,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutboxEventDisposition {
    Pending,
    Dead,
}

#[derive(Debug)]
pub enum OutboxError {
    InvalidInput,
    IdempotencyConflict,
    Database(DatabaseError),
}

impl fmt::Display for OutboxError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput => formatter.write_str("outbox input is invalid"),
            Self::IdempotencyConflict => {
                formatter.write_str("outbox idempotency key was reused for another event")
            }
            Self::Database(_) => formatter.write_str("outbox database operation failed"),
        }
    }
}

impl Error for OutboxError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::InvalidInput | Self::IdempotencyConflict => None,
        }
    }
}

impl From<DatabaseError> for OutboxError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

impl From<sqlx::Error> for OutboxError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

pub(crate) async fn enqueue_core_event_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
    event_type: &'static str,
    aggregate_type: &'static str,
    aggregate_id: Uuid,
    payload: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO outbox_events
         (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload)
         VALUES ($1, $2, $3, $4, $1::text, $5)",
    )
    .bind(event_id)
    .bind(event_type)
    .bind(aggregate_type)
    .bind(aggregate_id)
    .bind(payload)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

impl Database {
    pub async fn enqueue_outbox_event(
        &self,
        input: NewOutboxEvent,
    ) -> Result<OutboxEventRecord, OutboxError> {
        let mut transaction = self.pool.begin().await?;
        let event = self
            .enqueue_outbox_event_in_transaction(&mut transaction, input)
            .await?;
        transaction.commit().await?;
        Ok(event)
    }

    pub async fn enqueue_outbox_event_in_transaction(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        input: NewOutboxEvent,
    ) -> Result<OutboxEventRecord, OutboxError> {
        validate_event(&input)?;
        let inserted = sqlx::query_as::<_, OutboxEventRecord>(
            "INSERT INTO outbox_events
             (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload, max_attempts)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (event_type, dedupe_key) DO NOTHING
             RETURNING id, event_type, aggregate_type, aggregate_id, dedupe_key, payload,
                       attempts, max_attempts, available_at, created_at",
        )
        .bind(input.id)
        .bind(&input.event_type)
        .bind(&input.aggregate_type)
        .bind(input.aggregate_id)
        .bind(&input.dedupe_key)
        .bind(&input.payload)
        .bind(input.max_attempts)
        .fetch_optional(&mut **transaction)
        .await?;

        if let Some(inserted) = inserted {
            return Ok(inserted);
        }

        let existing = sqlx::query_as::<_, OutboxEventRecord>(
            "SELECT id, event_type, aggregate_type, aggregate_id, dedupe_key, payload,
                    attempts, max_attempts, available_at, created_at
             FROM outbox_events
             WHERE event_type = $1 AND dedupe_key = $2",
        )
        .bind(&input.event_type)
        .bind(&input.dedupe_key)
        .fetch_one(&mut **transaction)
        .await?;

        if existing.aggregate_type != input.aggregate_type
            || existing.aggregate_id != input.aggregate_id
            || existing.payload != input.payload
            || existing.max_attempts != input.max_attempts
        {
            return Err(OutboxError::IdempotencyConflict);
        }

        Ok(existing)
    }

    pub async fn claim_outbox_events(
        &self,
        limit: i64,
        lease_duration: Duration,
    ) -> Result<Vec<ClaimedOutboxEvent>, OutboxError> {
        self.claim_outbox_events_matching(&[], limit, lease_duration)
            .await
    }

    pub async fn claim_outbox_events_for_types(
        &self,
        event_types: &[String],
        limit: i64,
        lease_duration: Duration,
    ) -> Result<Vec<ClaimedOutboxEvent>, OutboxError> {
        if event_types.is_empty()
            || event_types
                .iter()
                .any(|event_type| !valid_event_type(event_type))
        {
            return Err(OutboxError::InvalidInput);
        }
        self.claim_outbox_events_matching(event_types, limit, lease_duration)
            .await
    }

    async fn claim_outbox_events_matching(
        &self,
        event_types: &[String],
        limit: i64,
        lease_duration: Duration,
    ) -> Result<Vec<ClaimedOutboxEvent>, OutboxError> {
        let lease_seconds = lease_duration.as_secs();
        if !(1..=MAX_CLAIM_BATCH).contains(&limit)
            || !(1..=MAX_LEASE_SECONDS).contains(&lease_seconds)
        {
            return Err(OutboxError::InvalidInput);
        }
        let lease_seconds = i32::try_from(lease_seconds).map_err(|_| OutboxError::InvalidInput)?;
        let lock_token = Uuid::now_v7();
        let mut transaction = self.pool.begin().await?;

        sqlx::query(
            "UPDATE outbox_events
             SET status = 'dead', lock_token = NULL, locked_until = NULL,
                 last_error = COALESCE(last_error, 'processing lease expired'),
                 updated_at = CURRENT_TIMESTAMP
             WHERE status = 'processing'
               AND locked_until <= CURRENT_TIMESTAMP
               AND attempts >= max_attempts",
        )
        .execute(&mut *transaction)
        .await?;

        let claimed = sqlx::query_as::<_, ClaimedOutboxEvent>(
            "WITH candidates AS (
                 SELECT id
                 FROM outbox_events
                 WHERE attempts < max_attempts
                   AND (cardinality($4::text[]) = 0 OR event_type = ANY($4))
                   AND (
                       (status = 'pending' AND available_at <= CURRENT_TIMESTAMP)
                       OR (status = 'processing' AND locked_until <= CURRENT_TIMESTAMP)
                   )
                 ORDER BY available_at, created_at, id
                 FOR UPDATE SKIP LOCKED
                 LIMIT $1
             )
             UPDATE outbox_events AS event
             SET status = 'processing', attempts = event.attempts + 1,
                 lock_token = $2,
                 locked_until = CURRENT_TIMESTAMP + make_interval(secs => $3),
                 updated_at = CURRENT_TIMESTAMP
             FROM candidates
             WHERE event.id = candidates.id
             RETURNING event.id, event.event_type, event.aggregate_type, event.aggregate_id,
                       event.payload, event.attempts, event.max_attempts, event.lock_token,
                       event.locked_until",
        )
        .bind(limit)
        .bind(lock_token)
        .bind(lease_seconds)
        .bind(event_types)
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(claimed)
    }

    pub async fn complete_outbox_event(
        &self,
        event_id: Uuid,
        lock_token: Uuid,
    ) -> Result<bool, OutboxError> {
        let result = sqlx::query(
            "UPDATE outbox_events
             SET status = 'completed', lock_token = NULL, locked_until = NULL,
                 last_error = NULL, completed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'processing' AND lock_token = $2
               AND locked_until > CURRENT_TIMESTAMP",
        )
        .bind(event_id)
        .bind(lock_token)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn fail_outbox_event(
        &self,
        event_id: Uuid,
        lock_token: Uuid,
        error_summary: &str,
    ) -> Result<Option<OutboxEventDisposition>, OutboxError> {
        let error_summary = normalize_error_summary(error_summary);
        let mut transaction = self.pool.begin().await?;
        let state = sqlx::query_as::<_, (i16, i16)>(
            "SELECT attempts, max_attempts
             FROM outbox_events
             WHERE id = $1 AND status = 'processing' AND lock_token = $2
               AND locked_until > CURRENT_TIMESTAMP
             FOR UPDATE",
        )
        .bind(event_id)
        .bind(lock_token)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some((attempts, max_attempts)) = state else {
            transaction.rollback().await?;
            return Ok(None);
        };

        let disposition = if attempts >= max_attempts {
            OutboxEventDisposition::Dead
        } else {
            OutboxEventDisposition::Pending
        };
        let retry_seconds = retry_delay_seconds(attempts);
        let status = match disposition {
            OutboxEventDisposition::Pending => "pending",
            OutboxEventDisposition::Dead => "dead",
        };
        sqlx::query(
            "UPDATE outbox_events
             SET status = $3, lock_token = NULL, locked_until = NULL,
                 last_error = $4,
                 available_at = CASE
                     WHEN $3 = 'pending'
                     THEN CURRENT_TIMESTAMP + make_interval(secs => $5)
                     ELSE available_at
                 END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND lock_token = $2 AND status = 'processing'",
        )
        .bind(event_id)
        .bind(lock_token)
        .bind(status)
        .bind(error_summary)
        .bind(retry_seconds)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(disposition))
    }
}

fn validate_event(input: &NewOutboxEvent) -> Result<(), OutboxError> {
    let payload_size = serde_json::to_vec(&input.payload)
        .map_err(|_| OutboxError::InvalidInput)?
        .len();
    if !valid_event_type(&input.event_type)
        || !valid_aggregate_type(&input.aggregate_type)
        || input.dedupe_key.is_empty()
        || input.dedupe_key.chars().count() > 160
        || input.dedupe_key.chars().any(char::is_control)
        || input.payload.is_null()
        || payload_size > MAX_EVENT_PAYLOAD_BYTES
        || !(1..=25).contains(&input.max_attempts)
    {
        return Err(OutboxError::InvalidInput);
    }
    Ok(())
}

fn valid_event_type(value: &str) -> bool {
    let mut segments = value.split('.');
    let Some(first) = segments.next() else {
        return false;
    };
    let Some(second) = segments.next() else {
        return false;
    };
    valid_name_segment(first)
        && valid_name_segment(second)
        && segments.all(valid_name_segment)
        && value.len() <= 80
}

fn valid_aggregate_type(value: &str) -> bool {
    !value.is_empty() && value.len() <= 40 && valid_name_segment(value)
}

fn valid_name_segment(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase())
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn normalize_error_summary(value: &str) -> String {
    let first_line = value.lines().next().unwrap_or_default().trim();
    let normalized = first_line
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_ERROR_SUMMARY_CHARS)
        .collect::<String>();
    if normalized.is_empty() {
        "worker failed".to_owned()
    } else {
        normalized
    }
}

fn retry_delay_seconds(attempts: i16) -> i32 {
    let exponent = u32::try_from(attempts.saturating_sub(1))
        .unwrap_or_default()
        .min(10);
    (5_i32.saturating_mul(2_i32.saturating_pow(exponent))).min(3_600)
}

#[cfg(test)]
mod tests {
    use super::{normalize_error_summary, retry_delay_seconds, valid_event_type};

    #[test]
    fn event_types_and_error_summaries_are_bounded() {
        assert!(valid_event_type("topic.published"));
        assert!(valid_event_type("cache.topic_invalidated"));
        assert!(!valid_event_type("Topic.Published"));
        assert!(!valid_event_type("topic"));
        assert_eq!(
            normalize_error_summary("temporary failure\nsecret detail"),
            "temporary failure"
        );
        assert_eq!(normalize_error_summary("\n"), "worker failed");
    }

    #[test]
    fn retry_delay_is_exponential_and_capped() {
        assert_eq!(retry_delay_seconds(1), 5);
        assert_eq!(retry_delay_seconds(2), 10);
        assert_eq!(retry_delay_seconds(10), 2_560);
        assert_eq!(retry_delay_seconds(25), 3_600);
    }
}
