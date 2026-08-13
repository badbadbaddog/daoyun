use daoyun_api::{
    UserRestrictionWorker, UserRestrictionWorkerConfig, UserRestrictionWorkerConfigError,
};
use infrastructure::Database;
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn restriction_worker_restores_expired_accounts_once(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users
         (id, username, email, display_name, status, restriction_reason,
          restriction_expires_at, admin_revision)
         VALUES ($1, 'expired_worker_user', 'expired-worker@example.com', 'Expired worker user',
                 'restricted', 'temporary restriction', CURRENT_TIMESTAMP - INTERVAL '1 minute', 2)",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("expired user fixture must insert");
    let worker = UserRestrictionWorker::new(
        Database::from_pool(pool.clone()),
        UserRestrictionWorkerConfig::default(),
    )
    .expect("default restriction worker config must be valid");

    assert_eq!(worker.run_once().await.expect("expiry run must succeed"), 1);
    assert_eq!(worker.run_once().await.expect("second run must succeed"), 0);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("restored status must be readable"),
        "active"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn restriction_worker_shutdown_is_prompt_and_schedule_is_bounded(pool: PgPool) {
    let invalid = UserRestrictionWorker::new(
        Database::from_pool(pool.clone()),
        UserRestrictionWorkerConfig {
            poll_interval: Duration::ZERO,
            batch_size: 100,
        },
    );
    assert!(matches!(
        invalid,
        Err(UserRestrictionWorkerConfigError::InvalidSchedule)
    ));

    let worker = UserRestrictionWorker::new(
        Database::from_pool(pool),
        UserRestrictionWorkerConfig {
            poll_interval: Duration::from_secs(60),
            batch_size: 100,
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
