use std::{error::Error, fmt, str::FromStr};

use email_address::EmailAddress;
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::outbox::enqueue_core_event_in_transaction;
use crate::{Database, DatabaseError};

#[derive(Debug)]
pub struct NewUserRecord {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub display_name: String,
    pub password_hash: String,
}

#[derive(Debug)]
pub struct NewSessionRecord {
    pub id: Uuid,
    pub token_hash: Vec<u8>,
    pub csrf_token_hash: Vec<u8>,
    pub device_label: String,
}

#[derive(Debug, sqlx::FromRow)]
pub struct LoginUserRecord {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub display_name: String,
    pub password_hash: String,
    pub is_active: bool,
}

#[derive(Debug)]
pub struct SessionUserRecord {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug)]
pub struct SessionRecord {
    pub id: Uuid,
    pub user: SessionUserRecord,
    pub csrf_token_hash: Vec<u8>,
}

#[derive(Debug)]
pub struct DeviceSessionRecord {
    pub id: Uuid,
    pub device_label: String,
    pub created_at: OffsetDateTime,
    pub last_seen_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct SecurityAuditEvent {
    pub user_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
    pub event_type: String,
    pub metadata: Value,
}

#[derive(Debug)]
pub struct NewExternalIdentityRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub provider_key: String,
    pub subject: String,
    pub issuer: String,
    pub email_snapshot: Option<String>,
    pub email_verified: Option<bool>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct ExternalIdentityUserRecord {
    pub identity_id: Uuid,
    pub user_id: Uuid,
}

#[derive(Debug, sqlx::FromRow)]
pub struct ExternalIdentityRecord {
    pub id: Uuid,
    pub provider_key: String,
    pub created_at: OffsetDateTime,
    pub last_authenticated_at: Option<OffsetDateTime>,
}

#[derive(Debug)]
pub enum ExternalIdentityError {
    IdentityUnavailable,
    InvalidInput,
    Database(DatabaseError),
}

#[derive(Debug)]
pub struct RecentAuthenticationRecord {
    pub expires_at: OffsetDateTime,
}

#[derive(Debug)]
pub enum RegisterUserError {
    NotInitialized,
    IdentityUnavailable,
    EmailVerificationInvalid,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ChangePasswordError {
    RecentAuthenticationRequired,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum UnlinkExternalIdentityError {
    RecentAuthenticationRequired,
    IdentityNotFound,
    LastLoginMethodRequired,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum BindExternalIdentityError {
    RecentAuthenticationRequired,
    IdentityNotFound,
    IdentityUnavailable,
    InvalidInput,
    Database(DatabaseError),
}

impl Database {
    pub async fn insert_external_identity(
        &self,
        identity: NewExternalIdentityRecord,
    ) -> Result<(), ExternalIdentityError> {
        if !valid_external_identity_input(&identity) {
            return Err(ExternalIdentityError::InvalidInput);
        }
        let result = sqlx::query(
            "INSERT INTO external_identities
                (id, user_id, provider_key, subject, issuer, email_snapshot, email_verified)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(identity.id)
        .bind(identity.user_id)
        .bind(identity.provider_key)
        .bind(identity.subject)
        .bind(identity.issuer)
        .bind(identity.email_snapshot)
        .bind(identity.email_verified)
        .execute(&self.pool)
        .await;
        match result {
            Ok(_) => Ok(()),
            Err(error) if is_unique_violation(&error) => {
                Err(ExternalIdentityError::IdentityUnavailable)
            }
            Err(error) => Err(ExternalIdentityError::Database(DatabaseError::from(error))),
        }
    }

    pub async fn find_external_identity_user(
        &self,
        provider_key: &str,
        subject: &str,
        issuer: &str,
        email_snapshot: Option<&str>,
        email_verified: Option<bool>,
    ) -> Result<Option<ExternalIdentityUserRecord>, ExternalIdentityError> {
        if !valid_external_identity_fields(
            provider_key,
            subject,
            issuer,
            email_snapshot,
            email_verified,
        ) {
            return Err(ExternalIdentityError::InvalidInput);
        }
        let record = sqlx::query_as::<_, ExternalIdentityUserRecord>(
            "UPDATE external_identities AS identity
             SET email_snapshot = COALESCE($4, identity.email_snapshot),
                 email_verified = CASE
                     WHEN $4 IS NULL THEN identity.email_verified
                     ELSE $5
                 END,
                 last_authenticated_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             FROM users AS account
             WHERE identity.provider_key = $1
               AND identity.subject = $2
               AND identity.issuer = $3
               AND identity.user_id = account.id
               AND account.status <> 'suspended'
             RETURNING identity.id AS identity_id,
                       account.id AS user_id",
        )
        .bind(provider_key)
        .bind(subject)
        .bind(issuer)
        .bind(email_snapshot)
        .bind(email_verified)
        .fetch_optional(&self.pool)
        .await
        .map_err(DatabaseError::from)?;
        Ok(record)
    }

    pub async fn list_external_identities(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ExternalIdentityRecord>, DatabaseError> {
        sqlx::query_as::<_, ExternalIdentityRecord>(
            "SELECT id, provider_key, created_at, last_authenticated_at
             FROM external_identities
             WHERE user_id = $1
             ORDER BY created_at ASC, id ASC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn external_identity_belongs_to_user(
        &self,
        user_id: Uuid,
        identity_id: Uuid,
    ) -> Result<bool, DatabaseError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (
                 SELECT 1 FROM external_identities WHERE id = $1 AND user_id = $2
             )",
        )
        .bind(identity_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn find_password_hash(&self, user_id: Uuid) -> Result<Option<String>, DatabaseError> {
        let hash = sqlx::query_scalar::<_, String>(
            "SELECT password_hash FROM password_credentials WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(hash)
    }

    pub async fn create_recent_authentication(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        operation: &str,
        method: &str,
    ) -> Result<RecentAuthenticationRecord, DatabaseError> {
        let expires_at = sqlx::query_scalar::<_, OffsetDateTime>(
            "INSERT INTO recent_authentications
                (id, user_id, session_id, operation, method, expires_at)
             VALUES
                ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '10 minutes')
             ON CONFLICT (session_id, operation) WHERE consumed_at IS NULL
             DO UPDATE SET
                id = EXCLUDED.id,
                user_id = EXCLUDED.user_id,
                method = EXCLUDED.method,
                expires_at = EXCLUDED.expires_at,
                created_at = CURRENT_TIMESTAMP
             RETURNING expires_at",
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(session_id)
        .bind(operation)
        .bind(method)
        .fetch_one(&self.pool)
        .await?;
        Ok(RecentAuthenticationRecord { expires_at })
    }

    pub async fn has_recent_authentication(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        operation: &str,
    ) -> Result<bool, DatabaseError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (
                 SELECT 1
                 FROM recent_authentications
                 WHERE user_id = $1
                   AND session_id = $2
                   AND operation = $3
                   AND consumed_at IS NULL
                   AND expires_at > CURRENT_TIMESTAMP
             )",
        )
        .bind(user_id)
        .bind(session_id)
        .bind(operation)
        .fetch_one(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn consume_recent_authentication(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        operation: &str,
    ) -> Result<bool, DatabaseError> {
        let result = sqlx::query(
            "UPDATE recent_authentications
             SET consumed_at = CURRENT_TIMESTAMP
             WHERE user_id = $1
               AND session_id = $2
               AND operation = $3
               AND consumed_at IS NULL
               AND expires_at > CURRENT_TIMESTAMP
               AND EXISTS (
                   SELECT 1
                   FROM sessions AS session
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
        .bind(operation)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn change_password(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        password_hash: &str,
        csrf_token_hash: Vec<u8>,
    ) -> Result<(), ChangePasswordError> {
        let mut transaction = self.pool.begin().await?;
        let recent_authentication = sqlx::query(
            "UPDATE recent_authentications
             SET consumed_at = CURRENT_TIMESTAMP
             WHERE user_id = $1
               AND session_id = $2
               AND operation = 'security.settings'
               AND consumed_at IS NULL
               AND expires_at > CURRENT_TIMESTAMP
               AND EXISTS (
                   SELECT 1
                   FROM sessions AS session
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
        .execute(&mut *transaction)
        .await?;
        if recent_authentication.rows_affected() != 1 {
            return Err(ChangePasswordError::RecentAuthenticationRequired);
        }

        sqlx::query(
            "UPDATE password_credentials
             SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $2",
        )
        .bind(password_hash)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE sessions
             SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .bind(session_id)
        .execute(&mut *transaction)
        .await?;
        let current_session = sqlx::query(
            "UPDATE sessions
             SET csrf_token_hash = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
        )
        .bind(csrf_token_hash)
        .bind(session_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        if current_session.rows_affected() != 1 {
            return Err(ChangePasswordError::RecentAuthenticationRequired);
        }
        sqlx::query(
            "INSERT INTO security_audit_log (id, user_id, session_id, event_type, metadata)
             VALUES ($1, $2, $3, 'auth.password.changed', $4)",
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(session_id)
        .bind(sqlx::types::Json(serde_json::json!({"method": "password"})))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn unlink_external_identity(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        identity_id: Uuid,
        csrf_token_hash: Vec<u8>,
    ) -> Result<(), UnlinkExternalIdentityError> {
        let mut transaction = self.pool.begin().await?;
        let active_user =
            sqlx::query("SELECT id FROM users WHERE id = $1 AND status <> 'suspended' FOR UPDATE")
                .bind(user_id)
                .fetch_optional(&mut *transaction)
                .await?;
        if active_user.is_none() {
            return Err(UnlinkExternalIdentityError::IdentityNotFound);
        }

        let recent_authentication = sqlx::query(
            "UPDATE recent_authentications
             SET consumed_at = CURRENT_TIMESTAMP
             WHERE user_id = $1
               AND session_id = $2
               AND operation = 'security.settings'
               AND consumed_at IS NULL
               AND expires_at > CURRENT_TIMESTAMP
               AND EXISTS (
                   SELECT 1
                   FROM sessions AS session
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
        .execute(&mut *transaction)
        .await?;
        if recent_authentication.rows_affected() != 1 {
            return Err(UnlinkExternalIdentityError::RecentAuthenticationRequired);
        }

        let provider_key = sqlx::query_scalar::<_, String>(
            "DELETE FROM external_identities
             WHERE id = $1 AND user_id = $2
             RETURNING provider_key",
        )
        .bind(identity_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(provider_key) = provider_key else {
            return Err(UnlinkExternalIdentityError::IdentityNotFound);
        };

        let has_login_method = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (
                       SELECT 1 FROM password_credentials WHERE user_id = $1
                   )
                   OR EXISTS (
                       SELECT 1 FROM external_identities WHERE user_id = $1
                   )",
        )
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !has_login_method {
            return Err(UnlinkExternalIdentityError::LastLoginMethodRequired);
        }

        sqlx::query(
            "UPDATE sessions
             SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .bind(session_id)
        .execute(&mut *transaction)
        .await?;
        let current_session = sqlx::query(
            "UPDATE sessions
             SET csrf_token_hash = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
        )
        .bind(csrf_token_hash)
        .bind(session_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        if current_session.rows_affected() != 1 {
            return Err(UnlinkExternalIdentityError::RecentAuthenticationRequired);
        }

        sqlx::query(
            "INSERT INTO security_audit_log (id, user_id, session_id, event_type, metadata)
             VALUES ($1, $2, $3, 'auth.identity.unlinked', $4)",
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(session_id)
        .bind(sqlx::types::Json(serde_json::json!({
            "provider": provider_key,
        })))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn bind_external_identity(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        replacement_identity_id: Option<Uuid>,
        identity: NewExternalIdentityRecord,
        csrf_token_hash: Vec<u8>,
    ) -> Result<(), BindExternalIdentityError> {
        if identity.user_id != user_id || !valid_external_identity_input(&identity) {
            return Err(BindExternalIdentityError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        let active_user =
            sqlx::query("SELECT id FROM users WHERE id = $1 AND status <> 'suspended' FOR UPDATE")
                .bind(user_id)
                .fetch_optional(&mut *transaction)
                .await?;
        if active_user.is_none() {
            return Err(BindExternalIdentityError::RecentAuthenticationRequired);
        }

        if let Some(identity_id) = replacement_identity_id {
            let replaced = sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM external_identities WHERE id = $1 AND user_id = $2 FOR UPDATE",
            )
            .bind(identity_id)
            .bind(user_id)
            .fetch_optional(&mut *transaction)
            .await?;
            if replaced.is_none() {
                return Err(BindExternalIdentityError::IdentityNotFound);
            }
        }

        let recent_authentication = sqlx::query(
            "UPDATE recent_authentications
             SET consumed_at = CURRENT_TIMESTAMP
             WHERE user_id = $1
               AND session_id = $2
               AND operation = 'security.settings'
               AND consumed_at IS NULL
               AND expires_at > CURRENT_TIMESTAMP
               AND EXISTS (
                   SELECT 1
                   FROM sessions AS session
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
        .execute(&mut *transaction)
        .await?;
        if recent_authentication.rows_affected() != 1 {
            return Err(BindExternalIdentityError::RecentAuthenticationRequired);
        }

        let replaced = replacement_identity_id.is_some();
        if let Some(identity_id) = replacement_identity_id {
            sqlx::query("DELETE FROM external_identities WHERE id = $1 AND user_id = $2")
                .bind(identity_id)
                .bind(user_id)
                .execute(&mut *transaction)
                .await?;
        }

        let insert = sqlx::query(
            "INSERT INTO external_identities
                (id, user_id, provider_key, subject, issuer, email_snapshot, email_verified, last_authenticated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)",
        )
        .bind(identity.id)
        .bind(identity.user_id)
        .bind(&identity.provider_key)
        .bind(identity.subject)
        .bind(identity.issuer)
        .bind(identity.email_snapshot)
        .bind(identity.email_verified)
        .execute(&mut *transaction)
        .await;
        if let Err(error) = insert {
            return if is_unique_violation(&error) {
                Err(BindExternalIdentityError::IdentityUnavailable)
            } else {
                Err(BindExternalIdentityError::Database(DatabaseError::from(
                    error,
                )))
            };
        }

        sqlx::query(
            "UPDATE sessions
             SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .bind(session_id)
        .execute(&mut *transaction)
        .await?;
        let current_session = sqlx::query(
            "UPDATE sessions
             SET csrf_token_hash = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
        )
        .bind(csrf_token_hash)
        .bind(session_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        if current_session.rows_affected() != 1 {
            return Err(BindExternalIdentityError::RecentAuthenticationRequired);
        }

        let event_type = if replaced {
            "auth.identity.replaced"
        } else {
            "auth.identity.bound"
        };
        sqlx::query(
            "INSERT INTO security_audit_log (id, user_id, session_id, event_type, metadata)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(session_id)
        .bind(event_type)
        .bind(sqlx::types::Json(serde_json::json!({
            "provider": identity.provider_key,
        })))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn insert_security_audit(
        &self,
        event: SecurityAuditEvent,
    ) -> Result<(), DatabaseError> {
        sqlx::query(
            "INSERT INTO security_audit_log (id, user_id, session_id, event_type, metadata)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(Uuid::now_v7())
        .bind(event.user_id)
        .bind(event.session_id)
        .bind(event.event_type)
        .bind(sqlx::types::Json(event.metadata))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn register_user(&self, user: NewUserRecord) -> Result<(), RegisterUserError> {
        self.register_user_inner(user, None, None, None).await
    }

    pub async fn register_user_with_session(
        &self,
        user: NewUserRecord,
        session: NewSessionRecord,
    ) -> Result<(), RegisterUserError> {
        self.register_user_inner(user, Some(session), None, None)
            .await
    }

    pub async fn register_user_with_session_and_email_challenge(
        &self,
        user: NewUserRecord,
        session: NewSessionRecord,
        challenge_id: Uuid,
        email: String,
    ) -> Result<(), RegisterUserError> {
        self.register_user_inner(user, Some(session), None, Some((challenge_id, email)))
            .await
    }

    pub async fn register_user_with_session_and_external_identity(
        &self,
        user: NewUserRecord,
        session: NewSessionRecord,
        identity: NewExternalIdentityRecord,
    ) -> Result<(), RegisterUserError> {
        if identity.user_id != user.id || !valid_external_identity_input(&identity) {
            return Err(RegisterUserError::IdentityUnavailable);
        }
        self.register_user_inner(user, Some(session), Some(identity), None)
            .await
    }

    async fn register_user_inner(
        &self,
        user: NewUserRecord,
        session: Option<NewSessionRecord>,
        external_identity: Option<NewExternalIdentityRecord>,
        registration_email_challenge: Option<(Uuid, String)>,
    ) -> Result<(), RegisterUserError> {
        let mut transaction = self.pool.begin().await?;
        let is_initialized = sqlx::query_scalar::<_, bool>(
            "SELECT is_initialized FROM system_state WHERE singleton",
        )
        .fetch_one(&mut *transaction)
        .await?;

        if !is_initialized {
            return Err(RegisterUserError::NotInitialized);
        }

        if let Some((challenge_id, email)) = registration_email_challenge {
            let consumed = sqlx::query(
                "UPDATE registration_email_challenges \
                 SET consumed_at = CURRENT_TIMESTAMP \
                 WHERE id = $1 AND email = $2 AND delivered_at IS NOT NULL \
                   AND consumed_at IS NULL AND attempts < 5 AND expires_at > CURRENT_TIMESTAMP",
            )
            .bind(challenge_id)
            .bind(email)
            .execute(&mut *transaction)
            .await?;
            if consumed.rows_affected() != 1 {
                return Err(RegisterUserError::EmailVerificationInvalid);
            }
        }

        let insert_result = sqlx::query(
            "INSERT INTO users (id, username, email, display_name) VALUES ($1, $2, $3, $4)",
        )
        .bind(user.id)
        .bind(&user.username)
        .bind(&user.email)
        .bind(&user.display_name)
        .execute(&mut *transaction)
        .await;

        if let Err(error) = insert_result {
            if is_unique_violation(&error) {
                return Err(RegisterUserError::IdentityUnavailable);
            }
            return Err(RegisterUserError::Database(DatabaseError::from(error)));
        }

        sqlx::query("INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, $2)")
            .bind(user.id)
            .bind(&user.password_hash)
            .execute(&mut *transaction)
            .await?;

        sqlx::query("INSERT INTO membership_accounts (user_id) VALUES ($1)")
            .bind(user.id)
            .execute(&mut *transaction)
            .await?;

        let member_role_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO roles (id, key, name, scope, is_system)
             VALUES (gen_random_uuid(), 'member', 'Member', 'instance', TRUE)
             ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
             RETURNING id",
        )
        .fetch_one(&mut *transaction)
        .await?;
        let attachment_permission_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM permissions WHERE permission_key = 'attachment.create'",
        )
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(member_role_id)
        .bind(attachment_permission_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO role_assignments (id, user_id, role_id, assigned_by)
             VALUES (gen_random_uuid(), $1, $2, $1)
             ON CONFLICT DO NOTHING",
        )
        .bind(user.id)
        .bind(member_role_id)
        .execute(&mut *transaction)
        .await?;

        if let Some(identity) = external_identity {
            let provider_key = identity.provider_key.clone();
            let insert = sqlx::query(
                "INSERT INTO external_identities
                    (id, user_id, provider_key, subject, issuer, email_snapshot, email_verified, last_authenticated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)",
            )
            .bind(identity.id)
            .bind(identity.user_id)
            .bind(identity.provider_key)
            .bind(identity.subject)
            .bind(identity.issuer)
            .bind(identity.email_snapshot)
            .bind(identity.email_verified)
            .execute(&mut *transaction)
            .await;
            if let Err(error) = insert {
                if is_unique_violation(&error) {
                    return Err(RegisterUserError::IdentityUnavailable);
                }
                return Err(RegisterUserError::Database(DatabaseError::from(error)));
            }
            sqlx::query(
                "INSERT INTO security_audit_log (id, user_id, session_id, event_type, metadata)
                 VALUES ($1, $2, $3, 'auth.oidc.claim.account_created', $4)",
            )
            .bind(Uuid::now_v7())
            .bind(user.id)
            .bind(session.as_ref().map(|session| session.id))
            .bind(sqlx::types::Json(
                serde_json::json!({ "provider": provider_key }),
            ))
            .execute(&mut *transaction)
            .await?;
        }

        if let Some(session) = session {
            sqlx::query(
                "INSERT INTO sessions (\
                    id, user_id, token_hash, csrf_token_hash, device_label, idle_expires_at, absolute_expires_at\
                 ) VALUES (\
                    $1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '7 days',\
                    CURRENT_TIMESTAMP + INTERVAL '30 days'\
                 )",
            )
            .bind(session.id)
            .bind(user.id)
            .bind(session.token_hash)
            .bind(session.csrf_token_hash)
            .bind(session.device_label)
            .execute(&mut *transaction)
            .await?;
        }

        enqueue_core_event_in_transaction(
            &mut transaction,
            Uuid::now_v7(),
            "user.created",
            "user",
            user.id,
            serde_json::json!({
                "user_id": user.id,
                "username": user.username,
                "display_name": user.display_name,
            }),
        )
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    pub async fn find_login_user(
        &self,
        identifier: &str,
    ) -> Result<Option<LoginUserRecord>, DatabaseError> {
        // Source: https://docs.rs/sqlx/0.9.0/sqlx/fn.query_as.html
        let record = sqlx::query_as::<_, LoginUserRecord>(
            "SELECT u.id, u.username, u.email, u.display_name, pc.password_hash, \
             (u.status <> 'suspended') AS is_active \
             FROM users AS u \
             INNER JOIN password_credentials AS pc ON pc.user_id = u.id \
             WHERE u.username = $1 OR lower(u.email) = lower($1) \
             LIMIT 1",
        )
        .bind(identifier)
        .fetch_optional(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn create_session(
        &self,
        id: Uuid,
        user_id: Uuid,
        token_hash: Vec<u8>,
        csrf_token_hash: Vec<u8>,
        device_label: String,
    ) -> Result<(), DatabaseError> {
        sqlx::query(
            "INSERT INTO sessions (\
                id, user_id, token_hash, csrf_token_hash, device_label, idle_expires_at, absolute_expires_at\
             ) VALUES (\
                $1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '7 days',\
                CURRENT_TIMESTAMP + INTERVAL '30 days'\
             )",
        )
        .bind(id)
        .bind(user_id)
        .bind(token_hash)
        .bind(csrf_token_hash)
        .bind(device_label)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn touch_session(
        &self,
        token_hash: &[u8],
    ) -> Result<Option<SessionRecord>, DatabaseError> {
        let record = sqlx::query_as::<_, SessionRow>(
            "UPDATE sessions AS s \
             SET last_seen_at = CURRENT_TIMESTAMP, \
                 idle_expires_at = LEAST(CURRENT_TIMESTAMP + INTERVAL '7 days', s.absolute_expires_at), \
                 updated_at = CURRENT_TIMESTAMP \
             FROM users AS u \
             WHERE s.token_hash = $1 \
               AND s.user_id = u.id \
               AND s.revoked_at IS NULL \
               AND CURRENT_TIMESTAMP < s.idle_expires_at \
               AND CURRENT_TIMESTAMP < s.absolute_expires_at \
               AND u.status <> 'suspended' \
             RETURNING s.csrf_token_hash, s.id AS session_id, u.id AS user_id, \
                       u.username, u.email, u.display_name",
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?;

        Ok(record.map(SessionRecord::from))
    }

    pub async fn revoke_session(&self, token_hash: &[u8]) -> Result<bool, DatabaseError> {
        let result = sqlx::query(
            "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
             WHERE token_hash = $1 AND revoked_at IS NULL",
        )
        .bind(token_hash)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() == 1)
    }

    pub async fn list_device_sessions(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<DeviceSessionRecord>, DatabaseError> {
        let records = sqlx::query_as::<_, DeviceSessionRow>(
            "SELECT id, device_label, created_at, last_seen_at FROM sessions \
             WHERE user_id = $1 \
               AND revoked_at IS NULL \
               AND CURRENT_TIMESTAMP < idle_expires_at \
               AND CURRENT_TIMESTAMP < absolute_expires_at \
             ORDER BY last_seen_at DESC, id DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(records.into_iter().map(DeviceSessionRecord::from).collect())
    }

    pub async fn revoke_other_session(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        current_session_id: Uuid,
    ) -> Result<bool, DatabaseError> {
        let result = sqlx::query(
            "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND user_id = $2 AND id <> $3 AND revoked_at IS NULL",
        )
        .bind(session_id)
        .bind(user_id)
        .bind(current_session_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }
}

#[derive(Debug, sqlx::FromRow)]
struct SessionRow {
    csrf_token_hash: Vec<u8>,
    session_id: Uuid,
    user_id: Uuid,
    username: String,
    email: String,
    display_name: String,
}

impl From<SessionRow> for SessionRecord {
    fn from(row: SessionRow) -> Self {
        Self {
            id: row.session_id,
            user: SessionUserRecord {
                id: row.user_id,
                username: row.username,
                email: row.email,
                display_name: row.display_name,
            },
            csrf_token_hash: row.csrf_token_hash,
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct DeviceSessionRow {
    id: Uuid,
    device_label: String,
    created_at: OffsetDateTime,
    last_seen_at: OffsetDateTime,
}

impl From<DeviceSessionRow> for DeviceSessionRecord {
    fn from(row: DeviceSessionRow) -> Self {
        Self {
            id: row.id,
            device_label: row.device_label,
            created_at: row.created_at,
            last_seen_at: row.last_seen_at,
        }
    }
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(
        error,
        sqlx::Error::Database(database_error)
            if database_error.code().as_deref() == Some("23505")
    )
}

fn valid_external_identity_input(identity: &NewExternalIdentityRecord) -> bool {
    valid_external_identity_fields(
        &identity.provider_key,
        &identity.subject,
        &identity.issuer,
        identity.email_snapshot.as_deref(),
        identity.email_verified,
    )
}

fn valid_external_identity_fields(
    provider_key: &str,
    subject: &str,
    issuer: &str,
    email_snapshot: Option<&str>,
    email_verified: Option<bool>,
) -> bool {
    let provider_key_valid = (2..=32).contains(&provider_key.chars().count())
        && provider_key.starts_with(|character: char| character.is_ascii_lowercase())
        && provider_key.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '_'
                || character == '-'
        });
    let subject_valid = !subject.is_empty()
        && subject.chars().count() <= 255
        && subject.chars().all(|character| !character.is_control());
    let issuer_valid = url::Url::parse(issuer).is_ok_and(|parsed_issuer| {
        issuer.chars().count() <= 2048
            && parsed_issuer.scheme() == "https"
            && parsed_issuer.host_str().is_some()
            && parsed_issuer.username().is_empty()
            && parsed_issuer.password().is_none()
            && parsed_issuer.query().is_none()
            && parsed_issuer.fragment().is_none()
    });
    let email_valid = email_snapshot.is_none_or(|email| {
        (3..=254).contains(&email.chars().count())
            && email.chars().all(|character| !character.is_control())
            && EmailAddress::from_str(email).is_ok()
    }) && (email_snapshot.is_some() || email_verified.is_none());
    provider_key_valid && subject_valid && issuer_valid && email_valid
}

impl fmt::Display for RegisterUserError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotInitialized => formatter.write_str("instance is not initialized"),
            Self::IdentityUnavailable => formatter.write_str("username or email is unavailable"),
            Self::EmailVerificationInvalid => {
                formatter.write_str("registration email verification is invalid")
            }
            Self::Database(_) => formatter.write_str("user registration database operation failed"),
        }
    }
}

impl fmt::Display for ExternalIdentityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::IdentityUnavailable => formatter.write_str("external identity is unavailable"),
            Self::InvalidInput => formatter.write_str("external identity input is invalid"),
            Self::Database(_) => formatter.write_str("external identity database operation failed"),
        }
    }
}

impl Error for ExternalIdentityError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::IdentityUnavailable | Self::InvalidInput => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<DatabaseError> for ExternalIdentityError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

impl fmt::Display for ChangePasswordError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RecentAuthenticationRequired => {
                formatter.write_str("recent authentication is required")
            }
            Self::Database(_) => formatter.write_str("password change transaction failed"),
        }
    }
}

impl Error for ChangePasswordError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::RecentAuthenticationRequired => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<DatabaseError> for ChangePasswordError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

impl From<sqlx::Error> for ChangePasswordError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for UnlinkExternalIdentityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RecentAuthenticationRequired => {
                formatter.write_str("recent authentication is required")
            }
            Self::IdentityNotFound => formatter.write_str("external identity was not found"),
            Self::LastLoginMethodRequired => {
                formatter.write_str("another login method is required")
            }
            Self::Database(_) => formatter.write_str("external identity unlink transaction failed"),
        }
    }
}

impl Error for UnlinkExternalIdentityError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::RecentAuthenticationRequired
            | Self::IdentityNotFound
            | Self::LastLoginMethodRequired => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<DatabaseError> for UnlinkExternalIdentityError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

impl From<sqlx::Error> for UnlinkExternalIdentityError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for BindExternalIdentityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RecentAuthenticationRequired => {
                formatter.write_str("recent authentication is required")
            }
            Self::IdentityNotFound => formatter.write_str("external identity was not found"),
            Self::IdentityUnavailable => formatter.write_str("external identity is unavailable"),
            Self::InvalidInput => formatter.write_str("external identity input is invalid"),
            Self::Database(_) => {
                formatter.write_str("external identity binding transaction failed")
            }
        }
    }
}

impl Error for BindExternalIdentityError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::RecentAuthenticationRequired
            | Self::IdentityNotFound
            | Self::IdentityUnavailable
            | Self::InvalidInput => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<DatabaseError> for BindExternalIdentityError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

impl From<sqlx::Error> for BindExternalIdentityError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl Error for RegisterUserError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::NotInitialized | Self::IdentityUnavailable | Self::EmailVerificationInvalid => {
                None
            }
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for RegisterUserError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}
