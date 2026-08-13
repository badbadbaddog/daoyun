use daoyun_api::{
    ObservabilityConfig, OperationsAlertWorker, OperationsAlertWorkerConfig,
    OperationsAlertWorkerConfigError,
};
use infrastructure::Database;
use serde_json::json;
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn operations_worker_evaluates_persistent_signals_and_deduplicates_alerts(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    sqlx::query("UPDATE operations_alert_rules SET threshold = 0 WHERE key = 'outbox_dead'")
        .execute(&pool)
        .await
        .expect("outbox rule threshold must update");
    sqlx::query(
        "INSERT INTO outbox_events
         (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload,
          status, attempts, max_attempts, last_error)
         VALUES ($1, 'test.operations_dead', 'operations', $2, 'operations-dead', $3,
                 'dead', 1, 1, 'controlled test failure')",
    )
    .bind(Uuid::now_v7())
    .bind(Uuid::now_v7())
    .bind(json!({"safe": true}))
    .execute(&pool)
    .await
    .expect("dead outbox fixture must insert");
    let worker = OperationsAlertWorker::new(
        database,
        ObservabilityConfig::default()
            .build()
            .expect("observability runtime must build"),
        OperationsAlertWorkerConfig::default(),
    )
    .expect("default operations worker config must be valid");

    let first = worker.run_once().await.expect("first evaluation must run");
    assert_eq!(first.opened, 1);
    assert_eq!(first.resolved, 0);
    let second = worker.run_once().await.expect("second evaluation must run");
    assert_eq!(second.opened, 0);
    assert_eq!(second.resolved, 0);
    let active = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM operations_alerts WHERE status = 'open'",
    )
    .fetch_one(&pool)
    .await
    .expect("active alert count must load");
    assert_eq!(active, 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn operations_worker_shutdown_is_prompt_and_schedule_is_bounded(pool: PgPool) {
    let invalid = OperationsAlertWorker::new(
        Database::from_pool(pool.clone()),
        ObservabilityConfig::default()
            .build()
            .expect("observability runtime must build"),
        OperationsAlertWorkerConfig {
            poll_interval: Duration::ZERO,
        },
    );
    assert!(matches!(
        invalid,
        Err(OperationsAlertWorkerConfigError::InvalidSchedule)
    ));

    let worker = OperationsAlertWorker::new(
        Database::from_pool(pool),
        ObservabilityConfig::default()
            .build()
            .expect("observability runtime must build"),
        OperationsAlertWorkerConfig {
            poll_interval: Duration::from_secs(60),
        },
    )
    .expect("long polling interval must be valid");
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let task = tokio::spawn(async move { worker.run(shutdown_rx).await });
    shutdown_tx
        .send(true)
        .expect("worker shutdown receiver must exist");
    tokio::time::timeout(Duration::from_secs(1), task)
        .await
        .expect("worker must stop without waiting for poll interval")
        .expect("worker task must not panic");
}
