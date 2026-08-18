use std::time::Duration;

use infrastructure::{Database, PluginQueueDisposition, SchedulePluginTaskRecord};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_event_claims_are_exclusive_and_disabled_plugins_are_not_claimed(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let plugin_id = insert_plugin(
        &pool,
        "event_queue",
        &["events.subscribe"],
        &["topic.published"],
    )
    .await;
    let event_occurred_at = OffsetDateTime::from_unix_timestamp(1_700_000_000)
        .expect("timestamp fixture must be valid");
    sqlx::query(
        "UPDATE plugin_event_catalog SET payload_schema_version = 7
         WHERE event_type = 'topic.published'",
    )
    .execute(&pool)
    .await
    .expect("event schema version fixture must update");
    let event_id = insert_event(&pool, "first-event", event_occurred_at).await;

    let (first, second) = tokio::join!(
        database.claim_plugin_event_deliveries(1, Duration::from_secs(30)),
        database.claim_plugin_event_deliveries(1, Duration::from_secs(30)),
    );
    let mut claimed = first.expect("first claim must succeed");
    claimed.extend(second.expect("second claim must succeed"));
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].outbox_event_id, event_id);
    assert_eq!(claimed[0].payload_schema_version, 7);
    assert_eq!(claimed[0].created_at, event_occurred_at);
    assert!(
        database
            .complete_plugin_event_delivery(
                claimed[0].plugin_id,
                claimed[0].outbox_event_id,
                claimed[0].lock_token,
            )
            .await
            .expect("claimed delivery completion must succeed")
    );

    insert_event(&pool, "disabled-event", OffsetDateTime::now_utc()).await;
    sqlx::query("UPDATE plugins SET status = 'disabled' WHERE id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("plugin fixture must disable");
    assert!(
        database
            .claim_plugin_event_deliveries(10, Duration::from_secs(30))
            .await
            .expect("disabled plugin claim must succeed")
            .is_empty()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn command_quota_deferral_does_not_consume_delivery_attempts(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let plugin_id = insert_plugin(
        &pool,
        "quota_queue",
        &["events.subscribe"],
        &["topic.published"],
    )
    .await;
    let event_id = insert_event(&pool, "quota-event", OffsetDateTime::now_utc()).await;
    let claimed = database
        .claim_plugin_event_deliveries(1, Duration::from_secs(30))
        .await
        .expect("delivery claim must succeed")
        .pop()
        .expect("delivery must be claimed");

    assert!(
        database
            .defer_plugin_event_delivery_until_quota_reset(plugin_id, event_id, claimed.lock_token,)
            .await
            .expect("quota deferral must persist")
    );
    let state = sqlx::query_as::<_, (String, i16, OffsetDateTime, OffsetDateTime)>(
        "SELECT status, attempts, available_at,
                (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                 + INTERVAL '1 day') AT TIME ZONE 'UTC'
         FROM plugin_event_deliveries
         WHERE plugin_id = $1 AND outbox_event_id = $2",
    )
    .bind(plugin_id)
    .bind(event_id)
    .fetch_one(&pool)
    .await
    .expect("deferred delivery state must load");
    assert_eq!(state.0, "pending");
    assert_eq!(state.1, 0);
    assert_eq!(state.2, state.3);
    assert!(
        database
            .claim_plugin_event_deliveries(1, Duration::from_secs(30))
            .await
            .expect("future delivery claim must succeed")
            .is_empty()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_tasks_record_attempts_and_reach_dead_state(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let plugin_id = insert_plugin(&pool, "task_queue", &["tasks.schedule"], &[]).await;
    let task = database
        .schedule_plugin_task(SchedulePluginTaskRecord {
            plugin_id,
            task_key: "cleanup.run".to_owned(),
            idempotency_key: "cleanup:1".to_owned(),
            payload: json!({"scope": "test"}),
            run_at: OffsetDateTime::now_utc(),
        })
        .await
        .expect("task must schedule");
    sqlx::query("UPDATE plugin_tasks SET max_attempts = 1 WHERE id = $1")
        .bind(task.id)
        .execute(&pool)
        .await
        .expect("task max attempts fixture must update");

    let claimed = database
        .claim_plugin_tasks(1, Duration::from_secs(30))
        .await
        .expect("task claim must succeed");
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, task.id);
    assert_eq!(claimed[0].attempts, 1);
    assert_eq!(
        database
            .fail_plugin_task(
                task.id,
                claimed[0].lock_token,
                "guest.execution_failed",
                "controlled failure",
            )
            .await
            .expect("task failure must persist"),
        Some(PluginQueueDisposition::Dead)
    );
    let state = sqlx::query_as::<_, (String, String)>(
        "SELECT task.status, attempt.status
         FROM plugin_tasks AS task
         INNER JOIN plugin_task_attempts AS attempt ON attempt.task_id = task.id
         WHERE task.id = $1",
    )
    .bind(task.id)
    .fetch_one(&pool)
    .await
    .expect("task and attempt states must load");
    assert_eq!(state, ("dead".to_owned(), "dead".to_owned()));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn command_quota_deferral_does_not_consume_task_attempts(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let plugin_id = insert_plugin(&pool, "task_quota_queue", &["tasks.schedule"], &[]).await;
    let task = database
        .schedule_plugin_task(SchedulePluginTaskRecord {
            plugin_id,
            task_key: "daily.run".to_owned(),
            idempotency_key: "daily:quota".to_owned(),
            payload: json!({"scope": "test"}),
            run_at: OffsetDateTime::now_utc(),
        })
        .await
        .expect("task must schedule");
    let claimed = database
        .claim_plugin_tasks(1, Duration::from_secs(30))
        .await
        .expect("task claim must succeed")
        .pop()
        .expect("task must be claimed");

    assert!(
        database
            .defer_plugin_task_until_quota_reset(task.id, claimed.lock_token)
            .await
            .expect("task quota deferral must persist")
    );
    let state = sqlx::query_as::<_, (String, i16, OffsetDateTime, OffsetDateTime, i64)>(
        "SELECT task.status, task.attempts, task.available_at,
                (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                 + INTERVAL '1 day') AT TIME ZONE 'UTC',
                (SELECT COUNT(*) FROM plugin_task_attempts AS attempt
                 WHERE attempt.task_id = task.id)
         FROM plugin_tasks AS task WHERE task.id = $1",
    )
    .bind(task.id)
    .fetch_one(&pool)
    .await
    .expect("deferred task state must load");
    assert_eq!(state.0, "pending");
    assert_eq!(state.1, 0);
    assert_eq!(state.2, state.3);
    assert_eq!(state.4, 0);
}

async fn insert_plugin(
    pool: &PgPool,
    key: &str,
    capabilities: &[&str],
    event_subscriptions: &[&str],
) -> Uuid {
    let owner_id = Uuid::now_v7();
    let plugin_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, $2, $3, $4, 'active')",
    )
    .bind(owner_id)
    .bind(format!("{key}_owner"))
    .bind(format!("{key}@example.com"))
    .bind(format!("{key} owner"))
    .execute(pool)
    .await
    .expect("plugin owner fixture must insert");
    sqlx::query(
        "INSERT INTO plugins
            (id, key, name, version, business_api_version, capabilities,
             event_subscriptions, component_bytes, component_sha256, status, installed_by)
         VALUES ($1, $2, $3, '1.0.0', '0.1.0', $4, $5, $6, $7, 'enabled', $8)",
    )
    .bind(plugin_id)
    .bind(key)
    .bind(format!("{key} plugin"))
    .bind(serde_json::to_value(capabilities).expect("capabilities must serialize"))
    .bind(serde_json::to_value(event_subscriptions).expect("subscriptions must serialize"))
    .bind(vec![0_u8])
    .bind("0".repeat(64))
    .bind(owner_id)
    .execute(pool)
    .await
    .expect("business plugin fixture must insert");
    plugin_id
}

async fn insert_event(pool: &PgPool, dedupe_key: &str, created_at: OffsetDateTime) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO outbox_events
            (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload, created_at)
         VALUES ($1, 'topic.published', 'topic', $2, $3,
                 '{\"title\":\"test\"}'::jsonb, $4)",
    )
    .bind(id)
    .bind(Uuid::now_v7())
    .bind(dedupe_key)
    .bind(created_at)
    .execute(pool)
    .await
    .expect("outbox event fixture must insert");
    id
}
