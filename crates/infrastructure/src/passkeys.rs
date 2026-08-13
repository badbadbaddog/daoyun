use serde_json::Value;
use sqlx::types::Json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Database, DatabaseError};

#[derive(Debug)]
pub enum RegisterPasskeyError {
    RecentAuthenticationRequired,
    CredentialUnavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum DeletePasskeyError {
    RecentAuthenticationRequired,
    NotFound,
    Database(DatabaseError),
}

impl From<sqlx::Error> for DeletePasskeyError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for RegisterPasskeyError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasskeyChallengeKind {
    Registration,
    Assertion,
}

impl PasskeyChallengeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Registration => "registration",
            Self::Assertion => "assertion",
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewPasskeyCredentialRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub credential_id: Vec<u8>,
    pub credential: Value,
}

#[derive(Debug, Clone)]
pub struct NewPasskeyChallengeRecord {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
    pub kind: PasskeyChallengeKind,
    pub state: Value,
}

#[derive(Debug, Clone)]
pub struct PasskeyCredentialRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub credential_id: Vec<u8>,
    pub credential: Value,
    pub created_at: OffsetDateTime,
    pub last_used_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub struct PasskeyUserRecord {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub display_name: String,
}

impl Database {
    pub async fn register_passkey_with_recent_auth(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        credential: NewPasskeyCredentialRecord,
        csrf_token_hash: Vec<u8>,
    ) -> Result<(), RegisterPasskeyError> {
        if credential.user_id != user_id {
            return Err(RegisterPasskeyError::CredentialUnavailable);
        }
        let mut transaction = self.pool.begin().await?;
        let recent_authentication = sqlx::query(
            "UPDATE recent_authentications
             SET consumed_at = CURRENT_TIMESTAMP
             WHERE user_id = $1
               AND session_id = $2
               AND operation = 'security.settings'
               AND consumed_at IS NULL
               AND expires_at > CURRENT_TIMESTAMP",
        )
        .bind(user_id)
        .bind(session_id)
        .execute(&mut *transaction)
        .await?;
        if recent_authentication.rows_affected() != 1 {
            return Err(RegisterPasskeyError::RecentAuthenticationRequired);
        }
        let inserted = sqlx::query(
            "INSERT INTO passkey_credentials (id, user_id, credential_id, credential)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (credential_id) DO NOTHING",
        )
        .bind(credential.id)
        .bind(credential.user_id)
        .bind(credential.credential_id)
        .bind(Json(credential.credential))
        .execute(&mut *transaction)
        .await?;
        if inserted.rows_affected() != 1 {
            return Err(RegisterPasskeyError::CredentialUnavailable);
        }
        let session = sqlx::query(
            "UPDATE sessions
             SET csrf_token_hash = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
        )
        .bind(csrf_token_hash)
        .bind(session_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        if session.rows_affected() != 1 {
            return Err(RegisterPasskeyError::RecentAuthenticationRequired);
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn delete_passkey_with_recent_auth(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        id: Uuid,
        csrf_token_hash: Vec<u8>,
    ) -> Result<(), DeletePasskeyError> {
        let mut transaction = self.pool.begin().await?;
        let recent_authentication = sqlx::query(
            "UPDATE recent_authentications
             SET consumed_at = CURRENT_TIMESTAMP
             WHERE user_id = $1
               AND session_id = $2
               AND operation = 'security.settings'
               AND consumed_at IS NULL
               AND expires_at > CURRENT_TIMESTAMP",
        )
        .bind(user_id)
        .bind(session_id)
        .execute(&mut *transaction)
        .await?;
        if recent_authentication.rows_affected() != 1 {
            return Err(DeletePasskeyError::RecentAuthenticationRequired);
        }
        let deleted = sqlx::query("DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(&mut *transaction)
            .await?;
        if deleted.rows_affected() != 1 {
            return Err(DeletePasskeyError::NotFound);
        }
        let session = sqlx::query(
            "UPDATE sessions
             SET csrf_token_hash = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
        )
        .bind(csrf_token_hash)
        .bind(session_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        if session.rows_affected() != 1 {
            return Err(DeletePasskeyError::RecentAuthenticationRequired);
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn list_passkey_credential_ids(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<Vec<u8>>, DatabaseError> {
        sqlx::query_scalar::<_, Vec<u8>>(
            "SELECT credential_id FROM passkey_credentials WHERE user_id = $1 ORDER BY created_at",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(DatabaseError::from)
    }

    pub async fn list_passkey_credentials(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<PasskeyCredentialRecord>, DatabaseError> {
        sqlx::query_as::<_, PasskeyCredentialRow>(
            "SELECT id, user_id, credential_id, credential, created_at, last_used_at
             FROM passkey_credentials
             WHERE user_id = $1
             ORDER BY created_at DESC, id DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(PasskeyCredentialRecord::from)
                .collect()
        })
        .map_err(DatabaseError::from)
    }

    pub async fn find_passkey_credential(
        &self,
        credential_id: &[u8],
    ) -> Result<Option<PasskeyCredentialRecord>, DatabaseError> {
        sqlx::query_as::<_, PasskeyCredentialRow>(
            "SELECT id, user_id, credential_id, credential, created_at, last_used_at
             FROM passkey_credentials
             WHERE credential_id = $1
             LIMIT 1",
        )
        .bind(credential_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(PasskeyCredentialRecord::from))
        .map_err(DatabaseError::from)
    }

    pub async fn find_passkey_user(
        &self,
        user_id: Uuid,
    ) -> Result<Option<PasskeyUserRecord>, DatabaseError> {
        sqlx::query_as::<_, PasskeyUserRow>(
            "SELECT id, username, email, display_name
             FROM users
             WHERE id = $1 AND status <> 'suspended'
             LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(PasskeyUserRecord::from))
        .map_err(DatabaseError::from)
    }

    pub async fn update_passkey_counter(
        &self,
        credential_id: &[u8],
        expected_counter: u32,
        new_counter: u32,
    ) -> Result<bool, DatabaseError> {
        let result = sqlx::query(
            "UPDATE passkey_credentials
             SET credential = jsonb_set(credential, '{counter}', to_jsonb($3::bigint), true),
                 last_used_at = CURRENT_TIMESTAMP
             WHERE credential_id = $1
               AND (credential->>'counter')::bigint = $2::bigint
               AND (($2::bigint = 0 AND $3::bigint = 0)
                    OR $3::bigint > (credential->>'counter')::bigint)",
        )
        .bind(credential_id)
        .bind(i64::from(expected_counter))
        .bind(i64::from(new_counter))
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn delete_passkey_credential(
        &self,
        user_id: Uuid,
        id: Uuid,
    ) -> Result<bool, DatabaseError> {
        let result = sqlx::query("DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn create_passkey_credential(
        &self,
        credential: NewPasskeyCredentialRecord,
    ) -> Result<(), DatabaseError> {
        sqlx::query(
            "INSERT INTO passkey_credentials (id, user_id, credential_id, credential) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(credential.id)
        .bind(credential.user_id)
        .bind(credential.credential_id)
        .bind(Json(credential.credential))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn create_passkey_challenge(
        &self,
        challenge: NewPasskeyChallengeRecord,
    ) -> Result<(), DatabaseError> {
        sqlx::query(
            "INSERT INTO passkey_challenges \
                (id, user_id, session_id, kind, state, expires_at) \
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '5 minutes')",
        )
        .bind(challenge.id)
        .bind(challenge.user_id)
        .bind(challenge.session_id)
        .bind(challenge.kind.as_str())
        .bind(Json(challenge.state))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn consume_passkey_challenge(
        &self,
        id: Uuid,
        user_id: Option<Uuid>,
        session_id: Option<Uuid>,
        kind: PasskeyChallengeKind,
    ) -> Result<Option<Value>, DatabaseError> {
        let state = sqlx::query_scalar::<_, Json<Value>>(
            "UPDATE passkey_challenges \
             SET consumed_at = CURRENT_TIMESTAMP \
             WHERE id = $1 \
               AND user_id IS NOT DISTINCT FROM $2 \
               AND session_id IS NOT DISTINCT FROM $3 \
               AND kind = $4 \
               AND consumed_at IS NULL \
               AND expires_at > CURRENT_TIMESTAMP \
             RETURNING state",
        )
        .bind(id)
        .bind(user_id)
        .bind(session_id)
        .bind(kind.as_str())
        .fetch_optional(&self.pool)
        .await?;
        Ok(state.map(|value| value.0))
    }
}

#[derive(Debug, sqlx::FromRow)]
struct PasskeyCredentialRow {
    id: Uuid,
    user_id: Uuid,
    credential_id: Vec<u8>,
    credential: Json<Value>,
    created_at: OffsetDateTime,
    last_used_at: Option<OffsetDateTime>,
}

#[derive(Debug, sqlx::FromRow)]
struct PasskeyUserRow {
    id: Uuid,
    username: String,
    email: String,
    display_name: String,
}

impl From<PasskeyCredentialRow> for PasskeyCredentialRecord {
    fn from(row: PasskeyCredentialRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            credential_id: row.credential_id,
            credential: row.credential.0,
            created_at: row.created_at,
            last_used_at: row.last_used_at,
        }
    }
}

impl From<PasskeyUserRow> for PasskeyUserRecord {
    fn from(row: PasskeyUserRow) -> Self {
        Self {
            id: row.id,
            username: row.username,
            email: row.email,
            display_name: row.display_name,
        }
    }
}
