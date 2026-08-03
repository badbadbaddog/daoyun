use crate::{Database, DatabaseError};

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
}
