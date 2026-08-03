#![forbid(unsafe_code)]

mod boards;
mod installation;

use std::{error::Error, fmt, time::Duration};

use sqlx::{
    PgPool,
    migrate::{Migrate, MigrateError, Migrator},
    postgres::PgPoolOptions,
};

pub use boards::BoardRecord;

// Source: https://docs.rs/sqlx/0.9.0/sqlx/macro.migrate.html
pub static MIGRATOR: Migrator = sqlx::migrate!("../../migrations");

#[derive(Clone, Debug)]
pub struct Database {
    pool: PgPool,
}

impl Database {
    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }

    // Source: https://docs.rs/sqlx/0.9.0/sqlx/postgres/type.PgPoolOptions.html#method.connect
    pub async fn connect_and_migrate(database_url: &str) -> Result<Self, DatabaseError> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .acquire_timeout(Duration::from_secs(3))
            .connect(database_url)
            .await?;
        let database = Self::from_pool(pool);
        database.migrate().await?;
        Ok(database)
    }

    pub async fn migrate(&self) -> Result<(), DatabaseError> {
        // Source: https://docs.rs/sqlx/0.9.0/sqlx/migrate/struct.Migrator.html#method.run
        MIGRATOR.run(&self.pool).await?;
        Ok(())
    }

    pub async fn check_readiness(&self) -> Result<(), DatabaseError> {
        let mut connection = self.pool.acquire().await?;
        let migrations_table_exists =
            sqlx::query_scalar::<_, bool>("SELECT to_regclass('_sqlx_migrations') IS NOT NULL")
                .fetch_one(&mut *connection)
                .await?;

        if !migrations_table_exists {
            return Err(DatabaseError::MigrationState);
        }

        // Source: https://docs.rs/sqlx/0.9.0/sqlx/migrate/trait.Migrate.html
        if connection
            .dirty_version("_sqlx_migrations")
            .await?
            .is_some()
        {
            return Err(DatabaseError::MigrationState);
        }

        let applied = connection
            .list_applied_migrations("_sqlx_migrations")
            .await?;
        let expected = MIGRATOR
            .iter()
            .filter(|migration| migration.migration_type.is_up_migration())
            .collect::<Vec<_>>();
        let is_current = applied.len() == expected.len()
            && applied.iter().zip(expected).all(|(applied, expected)| {
                applied.version == expected.version && applied.checksum == expected.checksum
            });

        if !is_current {
            return Err(DatabaseError::MigrationState);
        }

        Ok(())
    }
}

#[derive(Debug)]
pub enum DatabaseError {
    Sqlx(sqlx::Error),
    Migration(MigrateError),
    MigrationState,
}

impl fmt::Display for DatabaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlx(_) => formatter.write_str("database operation failed"),
            Self::Migration(_) => formatter.write_str("database migration failed"),
            Self::MigrationState => formatter.write_str("database migration state is not current"),
        }
    }
}

impl Error for DatabaseError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Sqlx(error) => Some(error),
            Self::Migration(error) => Some(error),
            Self::MigrationState => None,
        }
    }
}

impl From<sqlx::Error> for DatabaseError {
    fn from(error: sqlx::Error) -> Self {
        Self::Sqlx(error)
    }
}

impl From<MigrateError> for DatabaseError {
    fn from(error: MigrateError) -> Self {
        Self::Migration(error)
    }
}
