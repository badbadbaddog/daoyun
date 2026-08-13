use std::{error::Error, fmt};

use uuid::Uuid;

use crate::{Database, DatabaseError};

pub struct InstallationAdministrator {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub display_name: String,
    pub password_hash: String,
}

#[derive(Debug)]
pub enum InitializeInstallationError {
    AlreadyInitialized,
    Database(DatabaseError),
}

impl Database {
    pub async fn installation_status(&self) -> Result<bool, DatabaseError> {
        // Source: https://docs.rs/sqlx/0.9.0/sqlx/fn.query_scalar.html
        let is_initialized = sqlx::query_scalar::<_, bool>(
            "SELECT is_initialized FROM system_state WHERE singleton",
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(is_initialized)
    }

    pub async fn initialize_installation(
        &self,
        administrator: InstallationAdministrator,
    ) -> Result<(), InitializeInstallationError> {
        // Source: https://docs.rs/sqlx/0.9.0/sqlx/struct.Transaction.html
        // An uncommitted transaction rolls back when dropped on every error path below.
        let mut transaction = self.pool.begin().await?;
        let is_initialized = sqlx::query_scalar::<_, bool>(
            "SELECT is_initialized FROM system_state WHERE singleton FOR UPDATE",
        )
        .fetch_one(&mut *transaction)
        .await?;

        if is_initialized {
            return Err(InitializeInstallationError::AlreadyInitialized);
        }

        sqlx::query(
            "INSERT INTO users (id, username, email, display_name) VALUES ($1, $2, $3, $4)",
        )
        .bind(administrator.id)
        .bind(&administrator.username)
        .bind(&administrator.email)
        .bind(&administrator.display_name)
        .execute(&mut *transaction)
        .await?;

        sqlx::query("INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, $2)")
            .bind(administrator.id)
            .bind(&administrator.password_hash)
            .execute(&mut *transaction)
            .await?;

        sqlx::query("INSERT INTO membership_accounts (user_id) VALUES ($1)")
            .bind(administrator.id)
            .execute(&mut *transaction)
            .await?;

        let role_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO roles (id, key, name, scope, is_system)
             VALUES ($1, 'super_admin', '超级管理员', 'instance', TRUE)
             ON CONFLICT (key) DO UPDATE SET
                 name = EXCLUDED.name,
                 scope = EXCLUDED.scope,
                 is_system = TRUE,
                 updated_at = CURRENT_TIMESTAMP
             RETURNING id",
        )
        .bind(Uuid::now_v7())
        .fetch_one(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id)
             SELECT $1, id FROM permissions
             ON CONFLICT DO NOTHING",
        )
        .bind(role_id)
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO role_assignments (id, user_id, role_id, assigned_by) \
             VALUES ($1, $2, $3, $2)",
        )
        .bind(Uuid::now_v7())
        .bind(administrator.id)
        .bind(role_id)
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO boards (id, slug, name, description, icon, tone, position, visibility) \
             VALUES ($1, 'general', '社区广场', '分享想法、作品与日常', 'messages', 'green', 0, 'public')",
        )
        .bind(Uuid::now_v7())
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "UPDATE system_state \
             SET is_initialized = TRUE, initialized_at = CURRENT_TIMESTAMP, \
                 updated_at = CURRENT_TIMESTAMP \
             WHERE singleton",
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(())
    }
}

impl fmt::Display for InitializeInstallationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyInitialized => formatter.write_str("installation is already initialized"),
            Self::Database(_) => formatter.write_str("installation database transaction failed"),
        }
    }
}

impl Error for InitializeInstallationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::AlreadyInitialized => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for InitializeInstallationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}
