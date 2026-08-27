use std::{error::Error, fmt};

use serde_json::json;
use sqlx::{FromRow, types::Uuid};
use time::OffsetDateTime;

use crate::{Database, DatabaseError, NewOutboxEvent, OutboxError, admin::insert_audit};

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct SmtpConfigurationRecord {
    pub host: String,
    pub port: i32,
    pub username: Option<String>,
    pub password_ciphertext: Option<Vec<u8>>,
    pub tls_mode: String,
    pub from_email: String,
    pub from_name: String,
    pub enabled: bool,
    pub registration_email_verification_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateSmtpConfigurationRecord {
    pub host: String,
    pub port: i32,
    pub username: Option<String>,
    pub password_ciphertext: Option<Option<Vec<u8>>>,
    pub tls_mode: String,
    pub from_email: String,
    pub from_name: String,
    pub enabled: bool,
    pub registration_email_verification_enabled: bool,
}

impl UpdateSmtpConfigurationRecord {
    pub fn from_record(record: &SmtpConfigurationRecord) -> Self {
        Self {
            host: record.host.clone(),
            port: record.port,
            username: record.username.clone(),
            password_ciphertext: None,
            tls_mode: record.tls_mode.clone(),
            from_email: record.from_email.clone(),
            from_name: record.from_name.clone(),
            enabled: record.enabled,
            registration_email_verification_enabled: record.registration_email_verification_enabled,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewRegistrationEmailChallenge {
    pub id: Uuid,
    pub email: String,
    pub code_hash: String,
    pub code_ciphertext: Vec<u8>,
    pub expires_at: OffsetDateTime,
    pub resend_after: OffsetDateTime,
    pub enqueue_delivery: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct RegistrationEmailChallengeRecord {
    pub id: Uuid,
    pub email: String,
    pub code_hash: String,
    pub code_ciphertext: Option<Vec<u8>>,
    pub attempts: i16,
    pub delivered_at: Option<OffsetDateTime>,
    pub expires_at: OffsetDateTime,
    pub resend_after: OffsetDateTime,
    pub consumed_at: Option<OffsetDateTime>,
}

#[derive(Debug)]
pub enum SmtpConfigurationError {
    Invalid,
    NotFound,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum RegistrationEmailChallengeError {
    RateLimited { retry_after_seconds: u64 },
    Invalid,
    Outbox(OutboxError),
    Database(DatabaseError),
}

impl fmt::Display for SmtpConfigurationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid => formatter.write_str("SMTP configuration is invalid"),
            Self::NotFound => formatter.write_str("SMTP configuration was not found"),
            Self::Database(_) => formatter.write_str("SMTP configuration operation failed"),
        }
    }
}

impl Error for SmtpConfigurationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Invalid | Self::NotFound => None,
        }
    }
}

impl fmt::Display for RegistrationEmailChallengeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RateLimited { .. } => formatter.write_str("email challenge is rate limited"),
            Self::Invalid => formatter.write_str("email challenge is invalid"),
            Self::Outbox(_) | Self::Database(_) => {
                formatter.write_str("email challenge operation failed")
            }
        }
    }
}

impl Error for RegistrationEmailChallengeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Outbox(error) => Some(error),
            Self::Database(error) => Some(error),
            Self::RateLimited { .. } | Self::Invalid => None,
        }
    }
}

impl From<sqlx::Error> for SmtpConfigurationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl From<sqlx::Error> for RegistrationEmailChallengeError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl Database {
    pub async fn get_smtp_configuration(&self) -> Result<SmtpConfigurationRecord, DatabaseError> {
        Ok(sqlx::query_as::<_, SmtpConfigurationRecord>(
            "SELECT host, port, username, password_ciphertext, tls_mode, from_email, from_name, \
                    enabled, registration_email_verification_enabled \
             FROM smtp_configuration WHERE singleton",
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn update_smtp_configuration(
        &self,
        actor_id: Uuid,
        input: UpdateSmtpConfigurationRecord,
    ) -> Result<SmtpConfigurationRecord, SmtpConfigurationError> {
        if input.password_ciphertext == Some(None) && input.registration_email_verification_enabled
        {
            return Err(SmtpConfigurationError::Invalid);
        }
        let mut transaction = self.pool.begin().await?;
        let record = sqlx::query_as::<_, SmtpConfigurationRecord>(
            "UPDATE smtp_configuration \
             SET host = $1, port = $2, username = $3, \
                 password_ciphertext = CASE WHEN $4 THEN $5 ELSE password_ciphertext END, \
                 tls_mode = $6, from_email = $7, from_name = $8, enabled = $9, \
                 registration_email_verification_enabled = $10, updated_by = $11, \
                 updated_at = CURRENT_TIMESTAMP \
             WHERE singleton \
             RETURNING host, port, username, password_ciphertext, tls_mode, from_email, from_name, \
                       enabled, registration_email_verification_enabled",
        )
        .bind(&input.host)
        .bind(input.port)
        .bind(&input.username)
        .bind(input.password_ciphertext.is_some())
        .bind(input.password_ciphertext.flatten())
        .bind(&input.tls_mode)
        .bind(&input.from_email)
        .bind(&input.from_name)
        .bind(input.enabled)
        .bind(input.registration_email_verification_enabled)
        .bind(actor_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(SmtpConfigurationError::NotFound)?;
        insert_audit(
            &mut transaction,
            actor_id,
            "smtp.update",
            "smtp_configuration",
            None,
            json!({
                "host": record.host,
                "port": record.port,
                "tls_mode": record.tls_mode,
                "from_email": record.from_email,
                "enabled": record.enabled,
                "registration_email_verification_enabled": record.registration_email_verification_enabled,
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn create_registration_email_challenge(
        &self,
        input: NewRegistrationEmailChallenge,
    ) -> Result<RegistrationEmailChallengeRecord, RegistrationEmailChallengeError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(&input.email)
            .execute(&mut *transaction)
            .await?;
        let retry_after = sqlx::query_scalar::<_, i64>(
            "SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (resend_after - CURRENT_TIMESTAMP))))::bigint \
             FROM registration_email_challenges \
             WHERE email = $1 AND consumed_at IS NULL AND resend_after > CURRENT_TIMESTAMP \
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(&input.email)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(retry_after_seconds) = retry_after {
            return Err(RegistrationEmailChallengeError::RateLimited {
                retry_after_seconds: retry_after_seconds as u64,
            });
        }

        let record = sqlx::query_as::<_, RegistrationEmailChallengeRecord>(
            "INSERT INTO registration_email_challenges \
             (id, email, code_hash, code_ciphertext, expires_at, resend_after) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             RETURNING id, email, code_hash, code_ciphertext, attempts, delivered_at, expires_at, \
                       resend_after, consumed_at",
        )
        .bind(input.id)
        .bind(&input.email)
        .bind(&input.code_hash)
        .bind(&input.code_ciphertext)
        .bind(input.expires_at)
        .bind(input.resend_after)
        .fetch_one(&mut *transaction)
        .await?;

        if input.enqueue_delivery {
            self.enqueue_outbox_event_in_transaction(
                &mut transaction,
                NewOutboxEvent {
                    id: Uuid::now_v7(),
                    event_type: "email.registration_verification_requested".to_owned(),
                    aggregate_type: "registration_email_challenge".to_owned(),
                    aggregate_id: input.id,
                    dedupe_key: input.id.to_string(),
                    payload: json!({"challenge_id": input.id}),
                    max_attempts: 8,
                },
            )
            .await
            .map_err(RegistrationEmailChallengeError::Outbox)?;
        }
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn get_registration_email_challenge(
        &self,
        challenge_id: Uuid,
    ) -> Result<Option<RegistrationEmailChallengeRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, RegistrationEmailChallengeRecord>(
            "SELECT id, email, code_hash, code_ciphertext, attempts, delivered_at, expires_at, \
                    resend_after, consumed_at \
             FROM registration_email_challenges WHERE id = $1",
        )
        .bind(challenge_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn registration_email_verification_required(&self) -> Result<bool, DatabaseError> {
        Ok(sqlx::query_scalar::<_, bool>(
            "SELECT enabled AND registration_email_verification_enabled \
             FROM smtp_configuration WHERE singleton",
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn email_is_registered(&self, email: &str) -> Result<bool, DatabaseError> {
        Ok(sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower($1))",
        )
        .bind(email)
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn record_registration_email_challenge_failure(
        &self,
        challenge_id: Uuid,
        email: &str,
    ) -> Result<bool, DatabaseError> {
        Ok(sqlx::query(
            "UPDATE registration_email_challenges \
             SET attempts = attempts + 1 \
             WHERE id = $1 AND email = $2 AND attempts < 5 AND consumed_at IS NULL \
               AND delivered_at IS NOT NULL AND expires_at > CURRENT_TIMESTAMP",
        )
        .bind(challenge_id)
        .bind(email)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn mark_registration_email_delivered(
        &self,
        challenge_id: Uuid,
    ) -> Result<bool, DatabaseError> {
        Ok(sqlx::query(
            "UPDATE registration_email_challenges \
             SET delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP), code_ciphertext = NULL \
             WHERE id = $1 AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
        )
        .bind(challenge_id)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn record_smtp_test_audit(&self, actor_id: Uuid) -> Result<(), DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "smtp.test",
            "smtp_configuration",
            None,
            json!({"sent": true}),
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }
}
