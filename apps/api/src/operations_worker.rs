use std::{error::Error, fmt, time::Duration};

use infrastructure::{Database, DatabaseError, OperationsMetricValues};
use tokio::sync::watch;

use crate::ObservabilityRuntime;

#[derive(Clone, Copy, Debug)]
pub struct OperationsAlertWorkerConfig {
    pub poll_interval: Duration,
}

impl Default for OperationsAlertWorkerConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(30),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationsAlertWorkerConfigError {
    InvalidSchedule,
}

impl fmt::Display for OperationsAlertWorkerConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("operations alert worker schedule is invalid")
    }
}

impl Error for OperationsAlertWorkerConfigError {}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct OperationsAlertWorkerRun {
    pub opened: usize,
    pub resolved: usize,
}

pub struct OperationsAlertWorker {
    database: Database,
    observability: ObservabilityRuntime,
    config: OperationsAlertWorkerConfig,
}

impl OperationsAlertWorker {
    pub fn new(
        database: Database,
        observability: ObservabilityRuntime,
        config: OperationsAlertWorkerConfig,
    ) -> Result<Self, OperationsAlertWorkerConfigError> {
        if config.poll_interval.is_zero()
            || config.poll_interval > Duration::from_secs(24 * 60 * 60)
        {
            return Err(OperationsAlertWorkerConfigError::InvalidSchedule);
        }
        Ok(Self {
            database,
            observability,
            config,
        })
    }

    pub async fn run_once(&self) -> Result<OperationsAlertWorkerRun, DatabaseError> {
        let rules = self.database.list_operations_alert_rules().await?;
        let http_5xx_window_seconds = rules
            .iter()
            .find(|rule| rule.kind == "http_5xx_count")
            .map(|rule| rule.window_seconds)
            .ok_or(DatabaseError::MigrationState)?;
        let http_p95_window_seconds = rules
            .iter()
            .find(|rule| rule.kind == "http_p95_ms")
            .map(|rule| rule.window_seconds)
            .ok_or(DatabaseError::MigrationState)?;
        let errors = self.observability.window_snapshot(Duration::from_secs(
            u64::try_from(http_5xx_window_seconds).map_err(|_| DatabaseError::MigrationState)?,
        ));
        let latency = self.observability.window_snapshot(Duration::from_secs(
            u64::try_from(http_p95_window_seconds).map_err(|_| DatabaseError::MigrationState)?,
        ));
        let transitions = self
            .database
            .evaluate_operations_alerts(OperationsMetricValues {
                http_5xx_count: errors.errors,
                http_5xx_window_seconds,
                http_p95_ms: latency.p95_ms,
                http_p95_window_seconds,
            })
            .await?;
        let mut run = OperationsAlertWorkerRun::default();
        for transition in transitions {
            match transition.status.as_str() {
                "open" => {
                    run.opened += 1;
                    tracing::warn!(
                        alert_id = %transition.alert_id,
                        rule_key = %transition.rule_key,
                        observed_value = transition.observed_value,
                        "Operations alert opened"
                    );
                }
                "resolved" => {
                    run.resolved += 1;
                    tracing::info!(
                        alert_id = %transition.alert_id,
                        rule_key = %transition.rule_key,
                        previous_status = transition.previous_status.as_deref().unwrap_or("unknown"),
                        observed_value = transition.observed_value,
                        "Operations alert resolved"
                    );
                }
                _ => tracing::error!(
                    alert_id = %transition.alert_id,
                    rule_key = %transition.rule_key,
                    status = %transition.status,
                    "Operations alert evaluator returned an invalid transition"
                ),
            }
        }
        Ok(run)
    }

    pub async fn run(&self, mut shutdown: watch::Receiver<bool>) {
        loop {
            if *shutdown.borrow() {
                break;
            }
            if let Err(error) = self.run_once().await {
                tracing::error!(error = %error, "Operations alert evaluation failed");
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
        tracing::info!("Operations alert worker stopped");
    }
}
