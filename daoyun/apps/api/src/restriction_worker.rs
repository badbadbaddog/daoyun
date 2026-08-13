use std::{error::Error, fmt, time::Duration};

use infrastructure::{Database, DatabaseError};
use tokio::sync::watch;

#[derive(Clone, Copy, Debug)]
pub struct UserRestrictionWorkerConfig {
    pub poll_interval: Duration,
    pub batch_size: i64,
}

impl Default for UserRestrictionWorkerConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(30),
            batch_size: 100,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UserRestrictionWorkerConfigError {
    InvalidSchedule,
    InvalidBatchSize,
}

impl fmt::Display for UserRestrictionWorkerConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSchedule => {
                formatter.write_str("user restriction worker schedule is invalid")
            }
            Self::InvalidBatchSize => {
                formatter.write_str("user restriction worker batch size is invalid")
            }
        }
    }
}

impl Error for UserRestrictionWorkerConfigError {}

pub struct UserRestrictionWorker {
    database: Database,
    config: UserRestrictionWorkerConfig,
}

impl UserRestrictionWorker {
    pub fn new(
        database: Database,
        config: UserRestrictionWorkerConfig,
    ) -> Result<Self, UserRestrictionWorkerConfigError> {
        if config.poll_interval.is_zero()
            || config.poll_interval > Duration::from_secs(24 * 60 * 60)
        {
            return Err(UserRestrictionWorkerConfigError::InvalidSchedule);
        }
        if !(1..=500).contains(&config.batch_size) {
            return Err(UserRestrictionWorkerConfigError::InvalidBatchSize);
        }
        Ok(Self { database, config })
    }

    pub async fn run_once(&self) -> Result<usize, DatabaseError> {
        self.database
            .expire_admin_user_statuses(self.config.batch_size)
            .await
    }

    pub async fn run(&self, mut shutdown: watch::Receiver<bool>) {
        loop {
            if *shutdown.borrow() {
                break;
            }
            match self.run_once().await {
                Ok(restored) if restored > 0 => {
                    tracing::info!(restored, "Expired user restrictions restored");
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::error!(error = %error, "User restriction expiry sweep failed");
                }
            }
            tokio::select! {
                () = tokio::time::sleep(self.config.poll_interval) => {}
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break;
                    }
                }
            }
        }
        tracing::info!("User restriction worker stopped");
    }
}
