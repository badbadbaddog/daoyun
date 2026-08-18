use infrastructure::MIGRATOR;
use sqlx::PgPool;
use uuid::Uuid;

const PREVIOUS_MIGRATION_VERSION: i64 = 202608150011;
const PRE_BUSINESS_MIGRATION_VERSION: i64 = 202608150009;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn database_rejects_a_component_that_mixes_legacy_and_business_abis(pool: PgPool) {
    let owner_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'mixed_abi_owner', 'mixed-abi-owner@example.com',
                 'Mixed ABI Owner', 'active')",
    )
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("plugin owner fixture must insert");

    let result = sqlx::query(
        "INSERT INTO plugins
            (id, key, name, version, business_api_version, capabilities, data_scopes,
             component_bytes, component_sha256, status, installed_by)
         VALUES ($1, 'mixed_abi', 'Mixed ABI', '1.0.0', '0.1.0',
                 '[\"content.transform\", \"core.query\"]'::jsonb, '[]'::jsonb,
                 $2, $3, 'disabled', $4)",
    )
    .bind(Uuid::now_v7())
    .bind(vec![0_u8])
    .bind("0".repeat(64))
    .bind(owner_id)
    .execute(&pool)
    .await;

    assert!(result.is_err());
}

#[sqlx::test(migrations = false)]
async fn plugin_business_runtime_migration_is_reversible_and_seeds_the_event_catalog(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");

    for table in [
        "plugin_runtime_quotas",
        "plugin_command_usage",
        "plugin_command_receipts",
        "plugin_execution_leases",
        "plugin_storage_objects",
        "plugin_event_catalog",
        "plugin_event_subscriptions",
        "plugin_event_deliveries",
        "plugin_tasks",
        "plugin_task_attempts",
    ] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("plugin business runtime table lookup must succeed");
        assert!(exists, "{table} must exist after migrations");
    }

    let event_types = sqlx::query_scalar::<_, String>(
        "SELECT event_type FROM plugin_event_catalog ORDER BY event_type",
    )
    .fetch_all(&pool)
    .await
    .expect("plugin event catalog must be queryable");
    assert_eq!(
        event_types,
        [
            "entitlement.changed",
            "experience.changed",
            "points.changed",
            "reply.created",
            "topic.published",
            "user.created",
        ]
    );

    MIGRATOR
        .undo(&pool, PREVIOUS_MIGRATION_VERSION)
        .await
        .expect("plugin business runtime migration must roll back");
    for table in [
        "plugin_task_attempts",
        "plugin_tasks",
        "plugin_event_deliveries",
        "plugin_event_subscriptions",
        "plugin_event_catalog",
        "plugin_storage_objects",
        "plugin_execution_leases",
        "plugin_command_receipts",
        "plugin_command_usage",
        "plugin_runtime_quotas",
    ] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("rolled-back plugin runtime table lookup must succeed");
        assert!(!exists, "{table} must be removed by rollback");
    }

    MIGRATOR
        .run(&pool)
        .await
        .expect("plugin business runtime migration must apply again");
}

#[sqlx::test(migrations = false)]
async fn attachment_quota_rollback_preserves_tenant_owned_values(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");
    MIGRATOR
        .undo(&pool, 202608150010)
        .await
        .expect("attachment defaults must roll back without deleting data");
    sqlx::query(
        "UPDATE community_group_quota_rules AS quota
         SET quota_value = 777
         FROM community_groups AS groups
         WHERE groups.id = quota.group_id
           AND groups.internal_key = 'registered_member'
           AND quota.quota_key = 'attachment.storage.bytes'",
    )
    .execute(&pool)
    .await
    .expect("pre-existing tenant quota must update");
    MIGRATOR
        .run(&pool)
        .await
        .expect("attachment defaults must apply around tenant values");
    sqlx::query(
        "UPDATE community_group_quota_rules AS quota
         SET quota_value = 888
         FROM community_groups AS groups
         WHERE groups.id = quota.group_id
           AND groups.internal_key = 'registered_member'
           AND quota.quota_key = 'attachment.download.bytes.daily'",
    )
    .execute(&pool)
    .await
    .expect("post-migration tenant quota must update");
    MIGRATOR
        .undo(&pool, 202608150010)
        .await
        .expect("attachment defaults must roll back again");

    let values = sqlx::query_as::<_, (String, i64)>(
        "SELECT quota.quota_key, quota.quota_value
         FROM community_group_quota_rules AS quota
         INNER JOIN community_groups AS groups ON groups.id = quota.group_id
         WHERE groups.internal_key = 'registered_member'
           AND quota.quota_key IN (
               'attachment.storage.bytes', 'attachment.download.bytes.daily'
           )
         ORDER BY quota.quota_key",
    )
    .fetch_all(&pool)
    .await
    .expect("tenant quotas must remain queryable");
    assert_eq!(
        values,
        [
            ("attachment.download.bytes.daily".to_owned(), 888),
            ("attachment.storage.bytes".to_owned(), 777),
        ]
    );
}

#[sqlx::test(migrations = false)]
async fn full_business_contract_rollback_refuses_to_delete_installed_plugins(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");
    let owner_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'rollback_plugin_owner', 'rollback-plugin-owner@example.com',
                 'Rollback Plugin Owner', 'active')",
    )
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("rollback owner fixture must insert");
    for (key, status) in [
        ("rollback_business_enabled", "enabled"),
        ("rollback_business_disabled", "disabled"),
    ] {
        sqlx::query(
            "INSERT INTO plugins
                (id, key, name, version, business_api_version, capabilities, data_scopes,
                 event_subscriptions, component_bytes, component_sha256, status, installed_by)
             VALUES ($1, $2, $3, '1.0.0', '0.1.0',
                     '[\"events.subscribe\"]'::jsonb, '[]'::jsonb,
                     '[\"topic.published\"]'::jsonb, $4, $5, $6, $7)",
        )
        .bind(Uuid::now_v7())
        .bind(key)
        .bind(key.replace('_', " "))
        .bind(vec![0_u8])
        .bind("0".repeat(64))
        .bind(status)
        .bind(owner_id)
        .execute(&pool)
        .await
        .expect("business rollback fixture must insert");
    }
    sqlx::query(
        "INSERT INTO plugins
            (id, key, name, version, capabilities, component_bytes,
             component_sha256, status, installed_by)
         VALUES ($1, 'rollback_legacy', 'Rollback legacy', '1.0.0',
                 '[\"ui.panel\"]'::jsonb, $2, $3, 'disabled', $4)",
    )
    .bind(Uuid::now_v7())
    .bind(vec![0_u8])
    .bind("0".repeat(64))
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("legacy rollback fixture must insert");

    let rollback = MIGRATOR.undo(&pool, PRE_BUSINESS_MIGRATION_VERSION).await;
    assert!(
        rollback.is_err(),
        "rollback must refuse to delete installed business plugins"
    );
    assert_eq!(
        sqlx::query_scalar::<_, Vec<String>>(
            "SELECT array_agg(key ORDER BY key)::text[] FROM plugins",
        )
        .fetch_one(&pool)
        .await
        .expect("remaining plugin keys must load"),
        vec![
            "rollback_business_disabled".to_owned(),
            "rollback_business_enabled".to_owned(),
            "rollback_legacy".to_owned(),
        ]
    );
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT to_regclass('plugin_tasks') IS NOT NULL")
            .fetch_one(&pool)
            .await
            .expect("protected runtime schema must remain inspectable")
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)
             FROM plugin_runtime_quotas AS quotas
             INNER JOIN plugins AS plugin ON plugin.id = quotas.plugin_id
             WHERE plugin.business_api_version IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("business runtime data must remain queryable"),
        2
    );

    sqlx::query("DELETE FROM plugins WHERE business_api_version IS NOT NULL")
        .execute(&pool)
        .await
        .expect("explicit uninstall must clear business plugins before rollback");
    MIGRATOR
        .undo(&pool, PRE_BUSINESS_MIGRATION_VERSION)
        .await
        .expect("business migrations must roll back after explicit uninstall");
    assert_eq!(
        sqlx::query_scalar::<_, Vec<String>>(
            "SELECT array_agg(key ORDER BY key)::text[] FROM plugins",
        )
        .fetch_one(&pool)
        .await
        .expect("remaining legacy plugin keys must load"),
        vec!["rollback_legacy".to_owned()]
    );
    assert!(
        !sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'plugins' AND column_name = 'business_api_version'
             )",
        )
        .fetch_one(&pool)
        .await
        .expect("rolled-back plugin schema must be inspectable")
    );

    MIGRATOR
        .run(&pool)
        .await
        .expect("business migrations must apply again after full rollback");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn enabled_subscriptions_receive_new_events_and_disabled_plugins_do_not(pool: PgPool) {
    let user_id = Uuid::now_v7();
    let plugin_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'plugin_runtime_owner', 'plugin-runtime-owner@example.com',
                 'Plugin Runtime Owner', 'active')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("plugin owner fixture must insert");
    sqlx::query(
        "INSERT INTO plugins
            (id, key, name, version, description, manifest_schema_version,
             business_api_version, capabilities, data_scopes, event_subscriptions, component_bytes,
             component_sha256, status, installed_by)
         VALUES
            ($1, 'runtime_test', 'Runtime test', '1.0.0', '', 1, '0.1.0',
             '[\"events.subscribe\", \"storage.read_write\", \"tasks.schedule\"]'::jsonb,
             '[]'::jsonb, '[\"topic.published\"]'::jsonb, $2, $3, 'enabled', $4)",
    )
    .bind(plugin_id)
    .bind(vec![0_u8])
    .bind("0".repeat(64))
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("business plugin fixture must insert");

    let quotas = sqlx::query_as::<_, (i64, i32, i32)>(
        "SELECT storage_bytes_limit, pending_task_limit, command_daily_limit
         FROM plugin_runtime_quotas WHERE plugin_id = $1",
    )
    .bind(plugin_id)
    .fetch_one(&pool)
    .await
    .expect("new plugin must receive runtime quotas");
    assert_eq!(quotas, (1_048_576, 100, 1_000));

    let subscription_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM plugin_event_subscriptions
         WHERE plugin_id = $1 AND event_type = 'topic.published' AND enabled",
    )
    .bind(plugin_id)
    .fetch_one(&pool)
    .await
    .expect("declared event subscription count must be queryable");
    assert_eq!(subscription_count, 1);

    let first_event_id = Uuid::now_v7();
    insert_outbox_event(&pool, first_event_id, "enabled-delivery").await;
    let delivery_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM plugin_event_deliveries
         WHERE plugin_id = $1 AND outbox_event_id = $2",
    )
    .bind(plugin_id)
    .bind(first_event_id)
    .fetch_one(&pool)
    .await
    .expect("plugin event delivery count must be queryable");
    assert_eq!(delivery_count, 1);

    sqlx::query("UPDATE plugins SET status = 'disabled', revision = revision + 1 WHERE id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("plugin fixture must disable");
    let second_event_id = Uuid::now_v7();
    insert_outbox_event(&pool, second_event_id, "disabled-delivery").await;
    let disabled_delivery_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM plugin_event_deliveries
         WHERE plugin_id = $1 AND outbox_event_id = $2",
    )
    .bind(plugin_id)
    .bind(second_event_id)
    .fetch_one(&pool)
    .await
    .expect("disabled delivery count must be queryable");
    assert_eq!(disabled_delivery_count, 0);
}

async fn insert_outbox_event(pool: &PgPool, event_id: Uuid, dedupe_key: &str) {
    sqlx::query(
        "INSERT INTO outbox_events
            (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload)
         VALUES ($1, 'topic.published', 'topic', $2, $3, '{\"title\":\"test\"}'::jsonb)",
    )
    .bind(event_id)
    .bind(Uuid::now_v7())
    .bind(dedupe_key)
    .execute(pool)
    .await
    .expect("outbox event fixture must insert");
}
