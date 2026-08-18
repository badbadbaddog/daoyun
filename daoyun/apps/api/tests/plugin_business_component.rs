use std::{fs, path::PathBuf, time::Duration};

use daoyun_api::{
    PluginBusinessWorker, PluginBusinessWorkerConfig, PluginHostConfig, PluginRuntime,
};
use infrastructure::{Database, InstallationAdministrator, NewUserRecord};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
#[ignore = "run after building plugins/official-growth-rewards for wasm32-wasip2"]
async fn official_growth_component_runs_from_outbox_through_worker_to_ledger(pool: PgPool) {
    let component_path = PathBuf::from(
        std::env::var_os("DAOYUN_OFFICIAL_GROWTH_COMPONENT")
            .expect("DAOYUN_OFFICIAL_GROWTH_COMPONENT must point to the built Wasm component"),
    );
    let component = fs::read(&component_path).expect("official growth component must be readable");
    let component_sha256 = format!("{:x}", Sha256::digest(&component));
    let database = Database::from_pool(pool.clone());
    let user_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: user_id,
            username: "growth_component_target".to_owned(),
            email: "growth-component-target@example.com".to_owned(),
            display_name: "Growth Component Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("growth component target must initialize");
    let plugin_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO plugins
            (id, key, name, version, description, manifest_schema_version,
             business_api_version, capabilities, data_scopes, event_subscriptions,
             component_bytes, component_sha256, status, installed_by)
         VALUES ($1, 'official_growth_rewards', 'Official Growth Rewards', '0.1.0',
                 'Real component integration fixture', 1, '0.1.0',
                 '[\"events.subscribe\", \"experience.write\"]'::jsonb,
                 '[\"users.targeted\"]'::jsonb,
                 '[\"topic.published\", \"reply.created\"]'::jsonb,
                 $2, $3, 'enabled', $4)",
    )
    .bind(plugin_id)
    .bind(&component)
    .bind(component_sha256)
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("official growth plugin must install");
    sqlx::query("UPDATE plugin_runtime_quotas SET command_daily_limit = 10 WHERE plugin_id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("command quota fixture must update");
    let second_user_id = Uuid::now_v7();
    database
        .register_user(NewUserRecord {
            id: second_user_id,
            username: "growth_component_second".to_owned(),
            email: "growth-component-second@example.com".to_owned(),
            display_name: "Growth Component Second".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("second growth target must register");

    let occurred_at = OffsetDateTime::from_unix_timestamp(1_700_000_000)
        .expect("event time fixture must be valid");
    for index in 0..2 {
        let event_id = Uuid::now_v7();
        let topic_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO outbox_events
                (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload, created_at)
             VALUES ($1, 'topic.published', 'topic', $2, $3, $4, $5)",
        )
        .bind(event_id)
        .bind(topic_id)
        .bind(format!("official-growth-topic-{index}"))
        .bind(json!({
            "topic_id": topic_id,
            "board_id": Uuid::now_v7(),
            "author_id": user_id,
        }))
        .bind(occurred_at + time::Duration::seconds(index))
        .execute(&pool)
        .await
        .expect("topic event must fan out to the official plugin");
    }
    for index in 0..2 {
        let event_id = Uuid::now_v7();
        let reply_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO outbox_events
                (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload, created_at)
             VALUES ($1, 'reply.created', 'post', $2, $3, $4, $5)",
        )
        .bind(event_id)
        .bind(reply_id)
        .bind(format!("official-growth-reply-{index}"))
        .bind(json!({
            "reply_id": reply_id,
            "topic_id": Uuid::now_v7(),
            "board_id": Uuid::now_v7(),
            "author_id": user_id,
        }))
        .bind(occurred_at + time::Duration::minutes(1) + time::Duration::seconds(index))
        .execute(&pool)
        .await
        .expect("reply event must fan out to the official plugin");
    }
    let next_day_topic_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO outbox_events
            (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload, created_at)
         VALUES ($1, 'topic.published', 'topic', $2, 'official-growth-next-day', $3, $4)",
    )
    .bind(Uuid::now_v7())
    .bind(next_day_topic_id)
    .bind(json!({
        "topic_id": next_day_topic_id,
        "board_id": Uuid::now_v7(),
        "author_id": user_id,
    }))
    .bind(occurred_at + time::Duration::days(1))
    .execute(&pool)
    .await
    .expect("next-day topic event must fan out to the official plugin");

    let runtime =
        PluginRuntime::enabled(PluginHostConfig::default()).expect("plugin runtime must configure");
    let worker = PluginBusinessWorker::new(
        database.clone(),
        runtime,
        PluginBusinessWorkerConfig {
            batch_size: 10,
            lease_duration: Duration::from_secs(120),
            poll_interval: Duration::from_secs(1),
        },
    )
    .expect("plugin worker must configure");
    let run = worker
        .run_once()
        .await
        .expect("plugin worker run must succeed");

    assert_eq!(run.claimed_events, 5);
    assert_eq!(run.completed_events, 5);
    assert_eq!(run.failed_events, 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT experience FROM experience_accounts WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("experience account must load"),
        23
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM experience_ledger_entries
             WHERE user_id = $1 AND reason = 'growth.topic_first_daily'",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("growth ledger count must load"),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM experience_ledger_entries
             WHERE user_id = $1 AND reason = 'growth.reply_first_daily'",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("reply growth ledger count must load"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i32>(
            "SELECT used FROM plugin_command_usage
             WHERE plugin_id = $1
             ORDER BY window_start DESC LIMIT 1",
        )
        .bind(plugin_id)
        .fetch_one(&pool)
        .await
        .expect("plugin command usage must load"),
        3
    );

    sqlx::query(
        "UPDATE plugin_event_catalog SET payload_schema_version = 2
         WHERE event_type = 'topic.published'",
    )
    .execute(&pool)
    .await
    .expect("schema v2 fixture must update the catalog");
    let schema_v2_event_id = Uuid::now_v7();
    let schema_v2_topic_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO outbox_events
            (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload, created_at)
         VALUES ($1, 'topic.published', 'topic', $2, 'official-growth-schema-v2', $3, $4)",
    )
    .bind(schema_v2_event_id)
    .bind(schema_v2_topic_id)
    .bind(json!({
        "topic_id": schema_v2_topic_id,
        "board_id": Uuid::now_v7(),
        "author_id": second_user_id,
    }))
    .bind(occurred_at + time::Duration::minutes(2))
    .execute(&pool)
    .await
    .expect("schema v2 event must fan out");
    sqlx::query(
        "UPDATE plugin_event_catalog SET payload_schema_version = 1
         WHERE event_type = 'topic.published'",
    )
    .execute(&pool)
    .await
    .expect("event catalog fixture must restore v1");
    let schema_v2_run = worker
        .run_once()
        .await
        .expect("schema v2 worker run must persist a controlled failure");
    assert_eq!(schema_v2_run.claimed_events, 1);
    assert_eq!(schema_v2_run.completed_events, 0);
    assert_eq!(schema_v2_run.failed_events, 1);
    assert_eq!(
        sqlx::query_as::<_, (String, i16, i16)>(
            "SELECT status, attempts, payload_schema_version
             FROM plugin_event_deliveries
             WHERE plugin_id = $1 AND outbox_event_id = $2",
        )
        .bind(plugin_id)
        .bind(schema_v2_event_id)
        .fetch_one(&pool)
        .await
        .expect("schema v2 delivery state must load"),
        ("pending".to_owned(), 1, 2)
    );

    sqlx::query("UPDATE plugin_runtime_quotas SET command_daily_limit = 3 WHERE plugin_id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("exhausted command quota fixture must update");

    let quota_event_id = Uuid::now_v7();
    let quota_topic_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO outbox_events
            (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload, created_at)
         VALUES ($1, 'topic.published', 'topic', $2, 'official-growth-quota', $3, $4)",
    )
    .bind(quota_event_id)
    .bind(quota_topic_id)
    .bind(json!({
        "topic_id": quota_topic_id,
        "board_id": Uuid::now_v7(),
        "author_id": second_user_id,
    }))
    .bind(occurred_at + time::Duration::minutes(1))
    .execute(&pool)
    .await
    .expect("quota event must fan out");
    let quota_run = worker
        .run_once()
        .await
        .expect("quota worker run must succeed");
    assert_eq!(quota_run.claimed_events, 1);
    assert_eq!(quota_run.completed_events, 0);
    assert_eq!(quota_run.failed_events, 1);
    assert_eq!(
        sqlx::query_as::<_, (String, i16)>(
            "SELECT status, attempts FROM plugin_event_deliveries
             WHERE plugin_id = $1 AND outbox_event_id = $2",
        )
        .bind(plugin_id)
        .bind(quota_event_id)
        .fetch_one(&pool)
        .await
        .expect("quota delivery state must load"),
        ("pending".to_owned(), 0)
    );

    sqlx::query("DELETE FROM plugin_command_usage WHERE plugin_id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("quota window fixture must reset");
    sqlx::query(
        "UPDATE plugin_event_deliveries SET available_at = CURRENT_TIMESTAMP
         WHERE plugin_id = $1 AND outbox_event_id = $2",
    )
    .bind(plugin_id)
    .bind(quota_event_id)
    .execute(&pool)
    .await
    .expect("deferred delivery fixture must become available");
    let resumed = worker
        .run_once()
        .await
        .expect("resumed worker run must succeed");
    assert_eq!(resumed.completed_events, 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT experience FROM experience_accounts WHERE user_id = $1",
        )
        .bind(second_user_id)
        .fetch_one(&pool)
        .await
        .expect("second experience account must load"),
        10
    );
}
