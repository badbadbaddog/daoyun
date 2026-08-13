use std::{error::Error, fmt};

use sqlx::{Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Database, DatabaseError};

#[derive(Debug, sqlx::FromRow)]
pub struct MfaTotpRecord {
    pub encrypted_secret: Vec<u8>,
    pub enabled: bool,
    pub setup_expires_at: Option<OffsetDateTime>,
    pub last_used_step: Option<i64>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct MfaStatusRecord {
    pub enabled: bool,
    pub setup_pending: bool,
    pub recovery_codes_remaining: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MfaRecoveryCodeRecord {
    pub id: Uuid,
    pub code_hash: String,
    pub used_at: Option<OffsetDateTime>,
}

#[derive(Debug)]
pub struct NewMfaChallengeRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_label: String,
    pub browser_token_hash: Vec<u8>,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, sqlx::FromRow)]
pub struct MfaChallengeRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_label: String,
    pub browser_token_hash: Vec<u8>,
    pub attempts: i16,
    pub expires_at: OffsetDateTime,
    pub consumed_at: Option<OffsetDateTime>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct MfaChallengeUserRecord {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug)]
pub enum MfaError {
    AlreadyEnabled,
    NotConfigured,
    SetupRequired,
    InvalidInput,
    Database(DatabaseError),
}

#[derive(Debug, Clone, Copy)]
pub enum MfaVerificationRecord {
    TotpStep(i64),
    RecoveryCode(Uuid),
}

#[derive(Debug)]
pub enum MfaSecurityMutationError {
    RecentAuthenticationRequired,
    VerificationFailed,
    NotEnabled,
    SetupRequired,
    InvalidInput,
    Database(DatabaseError),
}

impl From<DatabaseError> for MfaSecurityMutationError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

impl fmt::Display for MfaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyEnabled => {
                formatter.write_str("multi-factor authentication is already enabled")
            }
            Self::NotConfigured => {
                formatter.write_str("multi-factor authentication is not configured")
            }
            Self::SetupRequired => {
                formatter.write_str("multi-factor authentication setup is required")
            }
            Self::InvalidInput => formatter.write_str("invalid multi-factor authentication input"),
            Self::Database(_) => {
                formatter.write_str("multi-factor authentication database operation failed")
            }
        }
    }
}

impl Error for MfaError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            _ => None,
        }
    }
}

impl From<DatabaseError> for MfaError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

impl Database {
    pub async fn create_mfa_challenge(
        &self,
        challenge: NewMfaChallengeRecord,
    ) -> Result<(), DatabaseError> {
        if challenge.browser_token_hash.len() != 32
            || challenge.device_label.is_empty()
            || challenge.device_label.len() > 80
            || challenge.expires_at <= OffsetDateTime::now_utc()
        {
            return Err(DatabaseError::Sqlx(sqlx::Error::Protocol(
                "invalid MFA challenge input".to_owned(),
            )));
        }
        sqlx::query(
            "INSERT INTO mfa_challenges
                (id, user_id, device_label, browser_token_hash, expires_at)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(challenge.id)
        .bind(challenge.user_id)
        .bind(challenge.device_label)
        .bind(challenge.browser_token_hash)
        .bind(challenge.expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn consume_mfa_challenge(
        &self,
        id: Uuid,
        browser_token_hash: Vec<u8>,
    ) -> Result<Option<MfaChallengeRecord>, DatabaseError> {
        if browser_token_hash.len() != 32 {
            return Ok(None);
        }
        sqlx::query_as::<_, MfaChallengeRecord>(
            "UPDATE mfa_challenges
             SET consumed_at = CURRENT_TIMESTAMP
             WHERE id = $1
               AND browser_token_hash = $2
               AND consumed_at IS NULL
               AND attempts < 5
               AND expires_at > CURRENT_TIMESTAMP
             RETURNING id, user_id, device_label, browser_token_hash,
                       attempts, expires_at, consumed_at",
        )
        .bind(id)
        .bind(browser_token_hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn get_mfa_challenge(
        &self,
        id: Uuid,
        browser_token_hash: Vec<u8>,
    ) -> Result<Option<MfaChallengeRecord>, DatabaseError> {
        if browser_token_hash.len() != 32 {
            return Ok(None);
        }
        sqlx::query_as::<_, MfaChallengeRecord>(
            "SELECT id, user_id, device_label, browser_token_hash, attempts, expires_at, consumed_at
             FROM mfa_challenges
             WHERE id = $1 AND browser_token_hash = $2 AND consumed_at IS NULL
               AND attempts < 5 AND expires_at > CURRENT_TIMESTAMP",
        )
        .bind(id)
        .bind(browser_token_hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn record_mfa_challenge_failure(
        &self,
        id: Uuid,
        browser_token_hash: Vec<u8>,
    ) -> Result<bool, DatabaseError> {
        if browser_token_hash.len() != 32 {
            return Ok(false);
        }
        let result = sqlx::query(
            "UPDATE mfa_challenges SET attempts = attempts + 1
             WHERE id = $1 AND browser_token_hash = $2 AND consumed_at IS NULL
               AND attempts < 5 AND expires_at > CURRENT_TIMESTAMP",
        )
        .bind(id)
        .bind(browser_token_hash)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn get_mfa_challenge_user(
        &self,
        user_id: Uuid,
    ) -> Result<Option<MfaChallengeUserRecord>, DatabaseError> {
        sqlx::query_as::<_, MfaChallengeUserRecord>(
            "SELECT id, username, email, display_name
             FROM users WHERE id = $1 AND status <> 'suspended'",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn complete_mfa_challenge(
        &self,
        id: Uuid,
        browser_token_hash: Vec<u8>,
        verification: MfaVerificationRecord,
    ) -> Result<Option<MfaChallengeRecord>, DatabaseError> {
        if browser_token_hash.len() != 32 {
            return Ok(None);
        }
        let mut transaction = self.pool.begin().await?;
        let challenge = sqlx::query_as::<_, MfaChallengeRecord>(
            "UPDATE mfa_challenges
             SET consumed_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND browser_token_hash = $2 AND consumed_at IS NULL
               AND attempts < 5 AND expires_at > CURRENT_TIMESTAMP
             RETURNING id, user_id, device_label, browser_token_hash,
                       attempts, expires_at, consumed_at",
        )
        .bind(id)
        .bind(browser_token_hash)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(challenge) = challenge else {
            transaction.rollback().await?;
            return Ok(None);
        };
        let verification_ok = match verification {
            MfaVerificationRecord::TotpStep(step) if step >= 0 => {
                sqlx::query(
                    "UPDATE mfa_totp SET last_used_step = $2, updated_at = CURRENT_TIMESTAMP
                     WHERE user_id = $1 AND enabled = TRUE
                       AND (last_used_step IS NULL OR last_used_step < $2)",
                )
                .bind(challenge.user_id)
                .bind(step)
                .execute(&mut *transaction)
                .await?
                .rows_affected()
                    == 1
            }
            MfaVerificationRecord::RecoveryCode(code_id) => {
                sqlx::query(
                    "UPDATE mfa_recovery_codes SET used_at = CURRENT_TIMESTAMP
                     WHERE id = $1 AND user_id = $2 AND used_at IS NULL",
                )
                .bind(code_id)
                .bind(challenge.user_id)
                .execute(&mut *transaction)
                .await?
                .rows_affected()
                    == 1
            }
            _ => false,
        };
        if !verification_ok {
            transaction.rollback().await?;
            return Ok(None);
        }
        transaction.commit().await?;
        Ok(Some(challenge))
    }

    pub async fn get_mfa_status(&self, user_id: Uuid) -> Result<MfaStatusRecord, DatabaseError> {
        sqlx::query_as::<_, MfaStatusRecord>(
            "SELECT
                EXISTS (
                    SELECT 1 FROM mfa_totp
                    WHERE user_id = $1 AND enabled = TRUE
                ) AS enabled,
                EXISTS (
                    SELECT 1 FROM mfa_totp
                    WHERE user_id = $1 AND enabled = FALSE
                      AND setup_expires_at > CURRENT_TIMESTAMP
                ) AS setup_pending,
                COALESCE((
                    SELECT count(*)
                    FROM mfa_recovery_codes
                    WHERE user_id = $1 AND used_at IS NULL
                ), 0)::bigint AS recovery_codes_remaining",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn get_mfa_totp(
        &self,
        user_id: Uuid,
    ) -> Result<Option<MfaTotpRecord>, DatabaseError> {
        sqlx::query_as::<_, MfaTotpRecord>(
            "SELECT secret_ciphertext AS encrypted_secret, enabled, setup_expires_at, last_used_step
             FROM mfa_totp WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn upsert_mfa_totp_setup(
        &self,
        user_id: Uuid,
        encrypted_secret: Vec<u8>,
        setup_expires_at: OffsetDateTime,
    ) -> Result<(), MfaError> {
        if !(32..=256).contains(&encrypted_secret.len())
            || setup_expires_at <= OffsetDateTime::now_utc()
        {
            return Err(MfaError::InvalidInput);
        }
        let result = sqlx::query(
            "INSERT INTO mfa_totp (user_id, secret_ciphertext, enabled, setup_expires_at, last_used_step)
             VALUES ($1, $2, FALSE, $3, NULL)
             ON CONFLICT (user_id) DO UPDATE SET
                 secret_ciphertext = EXCLUDED.secret_ciphertext,
                 enabled = FALSE,
                 setup_expires_at = EXCLUDED.setup_expires_at,
                 last_used_step = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE mfa_totp.enabled = FALSE",
        )
        .bind(user_id)
        .bind(encrypted_secret)
        .bind(setup_expires_at)
        .execute(&self.pool)
        .await
        .map_err(DatabaseError::from)?;
        if result.rows_affected() != 1 {
            return Err(MfaError::AlreadyEnabled);
        }
        Ok(())
    }

    pub async fn enable_mfa_totp(
        &self,
        user_id: Uuid,
        matched_step: i64,
        recovery_codes: &[(Uuid, String)],
    ) -> Result<(), MfaError> {
        if matched_step < 0 || recovery_codes.is_empty() || recovery_codes.len() > 10 {
            return Err(MfaError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await.map_err(DatabaseError::from)?;
        let updated = sqlx::query(
            "UPDATE mfa_totp
             SET enabled = TRUE, setup_expires_at = NULL, last_used_step = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND enabled = FALSE
               AND setup_expires_at > CURRENT_TIMESTAMP
               AND (last_used_step IS NULL OR last_used_step < $2)",
        )
        .bind(user_id)
        .bind(matched_step)
        .execute(&mut *transaction)
        .await
        .map_err(DatabaseError::from)?;
        if updated.rows_affected() != 1 {
            return Err(MfaError::SetupRequired);
        }
        for (id, code_hash) in recovery_codes {
            sqlx::query(
                "INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES ($1, $2, $3)",
            )
            .bind(*id)
            .bind(user_id)
            .bind(code_hash)
            .execute(&mut *transaction)
            .await
            .map_err(DatabaseError::from)?;
        }
        transaction.commit().await.map_err(DatabaseError::from)?;
        Ok(())
    }

    pub async fn consume_mfa_totp_step(
        &self,
        user_id: Uuid,
        matched_step: i64,
    ) -> Result<bool, DatabaseError> {
        if matched_step < 0 {
            return Ok(false);
        }
        let result = sqlx::query(
            "UPDATE mfa_totp
             SET last_used_step = $2, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND enabled = TRUE
               AND (last_used_step IS NULL OR last_used_step < $2)",
        )
        .bind(user_id)
        .bind(matched_step)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn list_unused_mfa_recovery_codes(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<MfaRecoveryCodeRecord>, DatabaseError> {
        sqlx::query_as::<_, MfaRecoveryCodeRecord>(
            "SELECT id, code_hash, used_at
             FROM mfa_recovery_codes
             WHERE user_id = $1 AND used_at IS NULL
             ORDER BY created_at ASC, id ASC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn consume_mfa_recovery_code(
        &self,
        user_id: Uuid,
        code_id: Uuid,
    ) -> Result<bool, DatabaseError> {
        let result = sqlx::query(
            "UPDATE mfa_recovery_codes
             SET used_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND user_id = $2 AND used_at IS NULL",
        )
        .bind(code_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn enable_mfa_totp_for_session(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        matched_step: i64,
        recovery_codes: &[(Uuid, String)],
        csrf_token_hash: Vec<u8>,
    ) -> Result<(), MfaSecurityMutationError> {
        if matched_step < 0 || recovery_codes.len() != 10 || csrf_token_hash.len() != 32 {
            return Err(MfaSecurityMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await.map_err(DatabaseError::from)?;
        consume_recent_authentication(&mut transaction, user_id, session_id).await?;
        let updated = sqlx::query(
            "UPDATE mfa_totp
             SET enabled = TRUE, setup_expires_at = NULL, last_used_step = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND enabled = FALSE
               AND setup_expires_at > CURRENT_TIMESTAMP
               AND (last_used_step IS NULL OR last_used_step < $2)",
        )
        .bind(user_id)
        .bind(matched_step)
        .execute(&mut *transaction)
        .await
        .map_err(DatabaseError::from)?;
        if updated.rows_affected() != 1 {
            return Err(MfaSecurityMutationError::SetupRequired);
        }
        replace_recovery_codes(&mut transaction, user_id, recovery_codes).await?;
        rotate_security_sessions(&mut transaction, user_id, session_id, csrf_token_hash).await?;
        insert_mfa_audit(&mut transaction, user_id, session_id, "auth.mfa.enabled").await?;
        transaction.commit().await.map_err(DatabaseError::from)?;
        Ok(())
    }

    pub async fn regenerate_mfa_recovery_codes_for_session(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        verification: MfaVerificationRecord,
        recovery_codes: &[(Uuid, String)],
        csrf_token_hash: Vec<u8>,
    ) -> Result<(), MfaSecurityMutationError> {
        if recovery_codes.len() != 10 || csrf_token_hash.len() != 32 {
            return Err(MfaSecurityMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await.map_err(DatabaseError::from)?;
        ensure_mfa_enabled(&mut transaction, user_id).await?;
        consume_mfa_verification(&mut transaction, user_id, verification).await?;
        consume_recent_authentication(&mut transaction, user_id, session_id).await?;
        replace_recovery_codes(&mut transaction, user_id, recovery_codes).await?;
        rotate_security_sessions(&mut transaction, user_id, session_id, csrf_token_hash).await?;
        insert_mfa_audit(
            &mut transaction,
            user_id,
            session_id,
            "auth.mfa.recovery_codes.regenerated",
        )
        .await?;
        transaction.commit().await.map_err(DatabaseError::from)?;
        Ok(())
    }

    pub async fn disable_mfa_for_session(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        verification: MfaVerificationRecord,
        csrf_token_hash: Vec<u8>,
    ) -> Result<(), MfaSecurityMutationError> {
        if csrf_token_hash.len() != 32 {
            return Err(MfaSecurityMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await.map_err(DatabaseError::from)?;
        ensure_mfa_enabled(&mut transaction, user_id).await?;
        consume_mfa_verification(&mut transaction, user_id, verification).await?;
        consume_recent_authentication(&mut transaction, user_id, session_id).await?;
        sqlx::query("DELETE FROM mfa_recovery_codes WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *transaction)
            .await
            .map_err(DatabaseError::from)?;
        sqlx::query("DELETE FROM mfa_totp WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *transaction)
            .await
            .map_err(DatabaseError::from)?;
        rotate_security_sessions(&mut transaction, user_id, session_id, csrf_token_hash).await?;
        insert_mfa_audit(&mut transaction, user_id, session_id, "auth.mfa.disabled").await?;
        transaction.commit().await.map_err(DatabaseError::from)?;
        Ok(())
    }
}

async fn ensure_mfa_enabled(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<(), MfaSecurityMutationError> {
    let enabled =
        sqlx::query_scalar::<_, bool>("SELECT enabled FROM mfa_totp WHERE user_id = $1 FOR UPDATE")
            .bind(user_id)
            .fetch_optional(&mut **transaction)
            .await
            .map_err(DatabaseError::from)?;
    if enabled != Some(true) {
        return Err(MfaSecurityMutationError::NotEnabled);
    }
    Ok(())
}

async fn consume_mfa_verification(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    verification: MfaVerificationRecord,
) -> Result<(), MfaSecurityMutationError> {
    let rows = match verification {
        MfaVerificationRecord::TotpStep(step) if step >= 0 => sqlx::query(
            "UPDATE mfa_totp SET last_used_step = $2, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND enabled = TRUE
               AND (last_used_step IS NULL OR last_used_step < $2)",
        )
        .bind(user_id)
        .bind(step)
        .execute(&mut **transaction)
        .await
        .map_err(DatabaseError::from)?
        .rows_affected(),
        MfaVerificationRecord::RecoveryCode(code_id) => sqlx::query(
            "UPDATE mfa_recovery_codes SET used_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND user_id = $2 AND used_at IS NULL",
        )
        .bind(code_id)
        .bind(user_id)
        .execute(&mut **transaction)
        .await
        .map_err(DatabaseError::from)?
        .rows_affected(),
        _ => 0,
    };
    if rows != 1 {
        return Err(MfaSecurityMutationError::VerificationFailed);
    }
    Ok(())
}

async fn consume_recent_authentication(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    session_id: Uuid,
) -> Result<(), MfaSecurityMutationError> {
    let result = sqlx::query(
        "UPDATE recent_authentications
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND session_id = $2
           AND operation = 'security.settings'
           AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
           AND EXISTS (
               SELECT 1 FROM sessions AS session
               INNER JOIN users AS account ON account.id = session.user_id
               WHERE session.id = recent_authentications.session_id
                 AND session.user_id = recent_authentications.user_id
                 AND session.revoked_at IS NULL
                 AND CURRENT_TIMESTAMP < session.idle_expires_at
                 AND CURRENT_TIMESTAMP < session.absolute_expires_at
                 AND account.status <> 'suspended'
           )",
    )
    .bind(user_id)
    .bind(session_id)
    .execute(&mut **transaction)
    .await
    .map_err(DatabaseError::from)?;
    if result.rows_affected() != 1 {
        return Err(MfaSecurityMutationError::RecentAuthenticationRequired);
    }
    Ok(())
}

async fn replace_recovery_codes(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    recovery_codes: &[(Uuid, String)],
) -> Result<(), MfaSecurityMutationError> {
    sqlx::query("DELETE FROM mfa_recovery_codes WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut **transaction)
        .await
        .map_err(DatabaseError::from)?;
    for (id, code_hash) in recovery_codes {
        sqlx::query("INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES ($1, $2, $3)")
            .bind(*id)
            .bind(user_id)
            .bind(code_hash)
            .execute(&mut **transaction)
            .await
            .map_err(DatabaseError::from)?;
    }
    Ok(())
}

async fn rotate_security_sessions(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    session_id: Uuid,
    csrf_token_hash: Vec<u8>,
) -> Result<(), MfaSecurityMutationError> {
    sqlx::query(
        "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .bind(session_id)
    .execute(&mut **transaction)
    .await
    .map_err(DatabaseError::from)?;
    let current = sqlx::query(
        "UPDATE sessions SET csrf_token_hash = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
    )
    .bind(csrf_token_hash)
    .bind(session_id)
    .bind(user_id)
    .execute(&mut **transaction)
    .await
    .map_err(DatabaseError::from)?;
    if current.rows_affected() != 1 {
        return Err(MfaSecurityMutationError::RecentAuthenticationRequired);
    }
    Ok(())
}

async fn insert_mfa_audit(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    session_id: Uuid,
    event_type: &str,
) -> Result<(), MfaSecurityMutationError> {
    sqlx::query(
        "INSERT INTO security_audit_log (id, user_id, session_id, event_type, metadata)
         VALUES ($1, $2, $3, $4, '{}'::jsonb)",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(session_id)
    .bind(event_type)
    .execute(&mut **transaction)
    .await
    .map_err(DatabaseError::from)?;
    Ok(())
}
