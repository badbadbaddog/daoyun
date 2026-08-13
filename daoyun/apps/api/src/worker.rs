use infrastructure::{ClaimedOutboxEvent, Database, OutboxError};
use std::{
    collections::HashMap, error::Error, fmt, future::Future, pin::Pin, sync::Arc, time::Duration,
};
use tokio::sync::watch;

pub type HandlerFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), OutboxHandlerError>> + Send + 'a>>;

pub trait OutboxHandler: Send + Sync {
    fn event_type(&self) -> &'static str;

    fn handle<'a>(&'a self, event: &'a ClaimedOutboxEvent) -> HandlerFuture<'a>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutboxHandlerError {
    summary: &'static str,
}

impl OutboxHandlerError {
    pub const fn new(summary: &'static str) -> Self {
        Self { summary }
    }
}

impl fmt::Display for OutboxHandlerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.summary)
    }
}

impl Error for OutboxHandlerError {}

#[derive(Clone, Copy, Debug)]
pub struct OutboxWorkerConfig {
    pub batch_size: i64,
    pub lease_duration: Duration,
    pub poll_interval: Duration,
}

impl Default for OutboxWorkerConfig {
    fn default() -> Self {
        Self {
            batch_size: 25,
            lease_duration: Duration::from_secs(30),
            poll_interval: Duration::from_secs(1),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutboxWorkerConfigError {
    NoHandlers,
    DuplicateEventType,
    InvalidSchedule,
}

impl fmt::Display for OutboxWorkerConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoHandlers => formatter.write_str("outbox worker requires at least one handler"),
            Self::DuplicateEventType => {
                formatter.write_str("outbox worker event types must be unique")
            }
            Self::InvalidSchedule => formatter.write_str("outbox worker schedule is invalid"),
        }
    }
}

impl Error for OutboxWorkerConfigError {}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct OutboxWorkerRun {
    pub claimed: usize,
    pub completed: usize,
    pub failed: usize,
}

pub struct OutboxWorker {
    database: Database,
    handlers: HashMap<String, Arc<dyn OutboxHandler>>,
    event_types: Vec<String>,
    config: OutboxWorkerConfig,
}

impl OutboxWorker {
    pub fn new(
        database: Database,
        handlers: Vec<Arc<dyn OutboxHandler>>,
        config: OutboxWorkerConfig,
    ) -> Result<Self, OutboxWorkerConfigError> {
        if handlers.is_empty() {
            return Err(OutboxWorkerConfigError::NoHandlers);
        }
        if !(1..=100).contains(&config.batch_size)
            || config.lease_duration.is_zero()
            || config.lease_duration > Duration::from_secs(300)
            || config.poll_interval.is_zero()
        {
            return Err(OutboxWorkerConfigError::InvalidSchedule);
        }

        let mut registered = HashMap::with_capacity(handlers.len());
        for handler in handlers {
            if registered
                .insert(handler.event_type().to_owned(), handler)
                .is_some()
            {
                return Err(OutboxWorkerConfigError::DuplicateEventType);
            }
        }
        let event_types = registered.keys().cloned().collect();
        Ok(Self {
            database,
            handlers: registered,
            event_types,
            config,
        })
    }

    pub async fn run_once(&self) -> Result<OutboxWorkerRun, OutboxError> {
        let events = self
            .database
            .claim_outbox_events_for_types(
                &self.event_types,
                self.config.batch_size,
                self.config.lease_duration,
            )
            .await?;
        if !events.is_empty() {
            tracing::info!(claimed = events.len(), "Outbox worker claimed events");
        }
        let mut run = OutboxWorkerRun {
            claimed: events.len(),
            ..OutboxWorkerRun::default()
        };

        for event in events {
            tracing::debug!(
                event_id = %event.id,
                event_type = %event.event_type,
                attempts = event.attempts,
                "Processing outbox event"
            );
            let Some(handler) = self.handlers.get(&event.event_type) else {
                tracing::error!(
                    event_id = %event.id,
                    event_type = %event.event_type,
                    "Claimed outbox event has no registered handler"
                );
                run.failed += 1;
                continue;
            };

            match handler.handle(&event).await {
                Ok(()) => match self
                    .database
                    .complete_outbox_event(event.id, event.lock_token)
                    .await
                {
                    Ok(true) => {
                        run.completed += 1;
                        tracing::info!(
                            event_id = %event.id,
                            event_type = %event.event_type,
                            "Outbox event completed"
                        );
                    }
                    Ok(false) => {
                        run.failed += 1;
                        tracing::warn!(
                            event_id = %event.id,
                            event_type = %event.event_type,
                            "Outbox event lease expired before completion"
                        );
                    }
                    Err(error) => {
                        run.failed += 1;
                        tracing::error!(
                            event_id = %event.id,
                            event_type = %event.event_type,
                            error = %error,
                            "Outbox event completion failed"
                        );
                    }
                },
                Err(error) => {
                    run.failed += 1;
                    match self
                        .database
                        .fail_outbox_event(event.id, event.lock_token, &error.to_string())
                        .await
                    {
                        Ok(Some(disposition)) => tracing::warn!(
                            event_id = %event.id,
                            event_type = %event.event_type,
                            attempts = event.attempts,
                            ?disposition,
                            error = %error,
                            "Outbox event handler failed"
                        ),
                        Ok(None) => tracing::warn!(
                            event_id = %event.id,
                            event_type = %event.event_type,
                            "Outbox event lease expired while recording failure"
                        ),
                        Err(record_error) => tracing::error!(
                            event_id = %event.id,
                            event_type = %event.event_type,
                            error = %record_error,
                            "Outbox event failure could not be recorded"
                        ),
                    }
                }
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
                tracing::error!(error = %error, "Outbox worker polling failed");
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
        tracing::info!("Outbox worker stopped");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        HandlerFuture, OutboxHandler, OutboxHandlerError, OutboxWorker, OutboxWorkerConfig,
    };
    use crate::{CacheRuntime, SiteBrandingCacheInvalidationHandler};
    use infrastructure::{ClaimedOutboxEvent, Database, NewOutboxEvent};
    use serde_json::json;
    use sqlx::{PgPool, Row};
    use std::{sync::Arc, time::Duration};
    use uuid::Uuid;

    struct SelectiveHandler {
        rejected_id: Uuid,
    }

    impl OutboxHandler for SelectiveHandler {
        fn event_type(&self) -> &'static str {
            "test.worker_event"
        }

        fn handle<'a>(&'a self, event: &'a ClaimedOutboxEvent) -> HandlerFuture<'a> {
            Box::pin(async move {
                if event.id == self.rejected_id {
                    Err(OutboxHandlerError::new("controlled handler failure"))
                } else {
                    Ok(())
                }
            })
        }
    }

    #[sqlx::test(migrator = "infrastructure::MIGRATOR")]
    async fn failed_event_does_not_stop_batch_and_unregistered_types_are_not_claimed(pool: PgPool) {
        let database = Database::from_pool(pool.clone());
        let rejected = enqueue(&database, "test.worker_event", "rejected").await;
        let completed = enqueue(&database, "test.worker_event", "completed").await;
        let ignored = enqueue(&database, "test.unregistered_event", "ignored").await;
        let worker = OutboxWorker::new(
            database,
            vec![Arc::new(SelectiveHandler {
                rejected_id: rejected,
            })],
            OutboxWorkerConfig::default(),
        )
        .expect("worker configuration must be valid");

        let run = worker.run_once().await.expect("worker run must complete");
        assert_eq!(run.claimed, 2);
        assert_eq!(run.completed, 1);
        assert_eq!(run.failed, 1);

        let rows = sqlx::query("SELECT id, status FROM outbox_events ORDER BY dedupe_key")
            .fetch_all(&pool)
            .await
            .expect("event states must be queryable");
        let states = rows
            .into_iter()
            .map(|row| (row.get::<Uuid, _>("id"), row.get::<String, _>("status")))
            .collect::<HashMap<_, _>>();
        assert_eq!(states[&rejected], "pending");
        assert_eq!(states[&completed], "completed");
        assert_eq!(states[&ignored], "pending");
    }

    #[sqlx::test(migrator = "infrastructure::MIGRATOR")]
    async fn shutdown_signal_stops_worker_without_waiting_for_the_poll_interval(pool: PgPool) {
        let database = Database::from_pool(pool);
        let marker = Uuid::now_v7();
        let worker = OutboxWorker::new(
            database,
            vec![Arc::new(SelectiveHandler {
                rejected_id: marker,
            })],
            OutboxWorkerConfig {
                poll_interval: Duration::from_secs(60),
                ..OutboxWorkerConfig::default()
            },
        )
        .expect("worker configuration must be valid");
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        let task = tokio::spawn(async move { worker.run(shutdown_rx).await });
        shutdown_tx
            .send(true)
            .expect("shutdown receiver must exist");

        tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .expect("worker must stop promptly")
            .expect("worker task must not panic");
    }

    #[sqlx::test(migrator = "infrastructure::MIGRATOR")]
    async fn real_site_branding_invalidation_event_is_consumed(pool: PgPool) {
        let database = Database::from_pool(pool.clone());
        let event = database
            .enqueue_outbox_event(NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "cache.site_branding_invalidated".to_owned(),
                aggregate_type: "site_branding".to_owned(),
                aggregate_id: Uuid::from_u128(1),
                dedupe_key: "worker-branding-invalidation".to_owned(),
                payload: json!({ "cache_key": "site_branding" }),
                max_attempts: 3,
            })
            .await
            .expect("branding invalidation event must enqueue");
        let worker = OutboxWorker::new(
            database,
            vec![Arc::new(SiteBrandingCacheInvalidationHandler::new(
                CacheRuntime::disabled(),
            ))],
            OutboxWorkerConfig::default(),
        )
        .expect("real handler registration must be valid");

        let run = worker
            .run_once()
            .await
            .expect("real event must be processed");
        assert_eq!(run.claimed, 1);
        assert_eq!(run.completed, 1);
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM outbox_events WHERE id = $1")
                .bind(event.id)
                .fetch_one(&pool)
                .await
                .expect("event status must be queryable"),
            "completed"
        );
    }

    async fn enqueue(database: &Database, event_type: &str, dedupe_key: &str) -> Uuid {
        let id = Uuid::now_v7();
        database
            .enqueue_outbox_event(NewOutboxEvent {
                id,
                event_type: event_type.to_owned(),
                aggregate_type: "worker_test".to_owned(),
                aggregate_id: Uuid::now_v7(),
                dedupe_key: dedupe_key.to_owned(),
                payload: json!({ "test": true }),
                max_attempts: 3,
            })
            .await
            .expect("test event must enqueue");
        id
    }

    use std::collections::HashMap;
}
