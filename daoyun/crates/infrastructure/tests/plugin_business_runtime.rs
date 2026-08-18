use infrastructure::{
    Database, ExecutePluginCommandRecord, InstallationAdministrator, PluginCommandKind,
    PluginRuntimeError, PutPluginStorageObjectRecord, PutStandardEntitlementTypeRecord,
    SchedulePluginTaskRecord,
};
use serde_json::json;
use sqlx::PgPool;
use std::collections::BTreeMap;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn only_ui_capable_business_plugins_are_listed_for_ui_surfaces(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let last = insert_plugin(&pool, "surface_zeta", &["core.query"]).await;
    let first = insert_plugin(&pool, "surface_alpha", &["ui.panel", "core.query"]).await;
    let _non_ui = insert_plugin(&pool, "surface_background", &["core.query"]).await;
    sqlx::query("UPDATE plugins SET status = 'disabled' WHERE id = $1")
        .bind(last)
        .execute(&pool)
        .await
        .expect("disabled fixture must update");

    let plugins = database
        .list_enabled_business_ui_plugins()
        .await
        .expect("enabled business plugins must load");

    assert_eq!(
        plugins.iter().map(|plugin| plugin.0).collect::<Vec<_>>(),
        vec![first]
    );
    assert_eq!(plugins[0].1, "surface_alpha");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn basic_user_scope_cannot_read_private_membership_accounts(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let target_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: target_id,
            username: "membership_query_target".to_owned(),
            email: "membership-query-target@example.com".to_owned(),
            display_name: "Membership Query Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("membership target fixture must initialize");
    let plugin_id = insert_plugin(&pool, "basic_user_reader", &["core.query"]).await;
    sqlx::query("UPDATE plugins SET data_scopes = '[\"users.read.basic\"]' WHERE id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("basic user scope fixture must update");

    assert!(matches!(
        database
            .query_plugin_data(
                plugin_id,
                infrastructure::PluginQueryKind::Membership,
                Some(target_id)
            )
            .await,
        Err(PluginRuntimeError::CapabilityDenied)
    ));

    sqlx::query("UPDATE plugins SET data_scopes = '[\"users.read.membership\"]' WHERE id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("membership account scope fixture must update");
    let membership = database
        .query_plugin_data(
            plugin_id,
            infrastructure::PluginQueryKind::Membership,
            Some(target_id),
        )
        .await
        .expect("explicit membership scope must read the account");
    assert_eq!(membership["user_id"], target_id.to_string());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_storage_is_isolated_revisioned_and_quota_limited(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let first_plugin = insert_plugin(&pool, "storage_first", &["storage.read_write"]).await;
    let second_plugin = insert_plugin(&pool, "storage_second", &["storage.read_write"]).await;

    let created = database
        .put_plugin_storage_object(PutPluginStorageObjectRecord {
            plugin_id: first_plugin,
            key: "profile.settings".to_owned(),
            value: b"one".to_vec(),
            content_type: "application/json".to_owned(),
            expected_revision: None,
        })
        .await
        .expect("enabled plugin must write isolated storage");
    assert_eq!(created.revision, 1);
    assert_eq!(created.size_bytes, 3);

    let loaded = database
        .get_plugin_storage_object(first_plugin, "profile.settings")
        .await
        .expect("enabled plugin storage read must succeed")
        .expect("stored object must exist");
    assert_eq!(loaded.value, b"one");
    assert!(
        database
            .get_plugin_storage_object(second_plugin, "profile.settings")
            .await
            .expect("another plugin storage read must succeed")
            .is_none(),
        "storage keys must be isolated by plugin identity"
    );

    assert!(matches!(
        database
            .put_plugin_storage_object(PutPluginStorageObjectRecord {
                plugin_id: first_plugin,
                key: "profile.settings".to_owned(),
                value: b"two".to_vec(),
                content_type: "application/json".to_owned(),
                expected_revision: None,
            })
            .await,
        Err(PluginRuntimeError::Conflict)
    ));
    let updated = database
        .put_plugin_storage_object(PutPluginStorageObjectRecord {
            plugin_id: first_plugin,
            key: "profile.settings".to_owned(),
            value: b"four".to_vec(),
            content_type: "application/json".to_owned(),
            expected_revision: Some(1),
        })
        .await
        .expect("matching revision must update storage");
    assert_eq!(updated.revision, 2);

    sqlx::query("UPDATE plugin_runtime_quotas SET storage_bytes_limit = 4 WHERE plugin_id = $1")
        .bind(first_plugin)
        .execute(&pool)
        .await
        .expect("storage quota fixture must update");
    assert!(matches!(
        database
            .put_plugin_storage_object(PutPluginStorageObjectRecord {
                plugin_id: first_plugin,
                key: "another.key".to_owned(),
                value: vec![1],
                content_type: "application/octet-stream".to_owned(),
                expected_revision: None,
            })
            .await,
        Err(PluginRuntimeError::QuotaExceeded)
    ));

    let quota = database
        .plugin_quota_snapshot(first_plugin)
        .await
        .expect("plugin quota snapshot must load");
    assert_eq!(quota.storage_bytes_used, 4);
    assert_eq!(quota.storage_bytes_limit, 4);

    sqlx::query("UPDATE plugins SET status = 'disabled' WHERE id = $1")
        .bind(first_plugin)
        .execute(&pool)
        .await
        .expect("plugin fixture must disable");
    assert!(matches!(
        database
            .get_plugin_storage_object(first_plugin, "profile.settings")
            .await,
        Err(PluginRuntimeError::Disabled)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_task_scheduling_is_idempotent_and_pending_quota_is_atomic(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let plugin_id = insert_plugin(&pool, "task_plugin", &["tasks.schedule"]).await;
    sqlx::query("UPDATE plugin_runtime_quotas SET pending_task_limit = 1 WHERE plugin_id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("task quota fixture must update");
    let run_at = OffsetDateTime::now_utc() + Duration::minutes(5);
    let input = SchedulePluginTaskRecord {
        plugin_id,
        task_key: "membership.expire".to_owned(),
        idempotency_key: "membership:42:expire".to_owned(),
        payload: json!({"membership_id": 42}),
        run_at,
    };

    let scheduled = database
        .schedule_plugin_task(input.clone())
        .await
        .expect("enabled plugin must schedule a task");
    let replayed = database
        .schedule_plugin_task(input)
        .await
        .expect("identical idempotency replay must return the same task");
    assert_eq!(replayed.id, scheduled.id);

    assert!(matches!(
        database
            .schedule_plugin_task(SchedulePluginTaskRecord {
                plugin_id,
                task_key: "membership.expire".to_owned(),
                idempotency_key: "membership:42:expire".to_owned(),
                payload: json!({"membership_id": 43}),
                run_at,
            })
            .await,
        Err(PluginRuntimeError::IdempotencyConflict)
    ));
    assert!(matches!(
        database
            .schedule_plugin_task(SchedulePluginTaskRecord {
                plugin_id,
                task_key: "membership.expire".to_owned(),
                idempotency_key: "membership:43:expire".to_owned(),
                payload: json!({"membership_id": 43}),
                run_at,
            })
            .await,
        Err(PluginRuntimeError::QuotaExceeded)
    ));

    let quota = database
        .plugin_quota_snapshot(plugin_id)
        .await
        .expect("plugin quota snapshot must load");
    assert_eq!(quota.pending_tasks, 1);
    assert_eq!(quota.pending_task_limit, 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_commands_are_capability_checked_idempotent_and_daily_limited(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let user_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: user_id,
            username: "command_target".to_owned(),
            email: "command-target@example.com".to_owned(),
            display_name: "Command Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("command target fixture must initialize");
    let plugin_id = insert_plugin(&pool, "command_plugin", &["points.write"]).await;
    sqlx::query("UPDATE plugins SET data_scopes = '[\"users.targeted\"]' WHERE id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("targeted scope fixture must update");
    sqlx::query("UPDATE plugin_runtime_quotas SET command_daily_limit = 1 WHERE plugin_id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("command quota fixture must update");
    let input = ExecutePluginCommandRecord {
        plugin_id,
        kind: PluginCommandKind::PointsAppend,
        subject_id: user_id,
        idempotency_key: "points:user:once".to_owned(),
        payload: json!({"amount": 5, "reason": "plugin.official_test"}),
    };

    let first = database
        .execute_plugin_command(input.clone())
        .await
        .expect("declared command must execute");
    let replay = database
        .execute_plugin_command(input)
        .await
        .expect("identical command must replay");
    assert!(!first.replayed);
    assert!(replay.replayed);
    assert_eq!(first.resource_id, replay.resource_id);
    assert_eq!(
        database
            .get_membership_account(user_id)
            .await
            .expect("membership account lookup must succeed")
            .expect("membership account must exist")
            .points_balance,
        5
    );
    assert!(matches!(
        database
            .execute_plugin_command(ExecutePluginCommandRecord {
                plugin_id,
                kind: PluginCommandKind::PointsAppend,
                subject_id: user_id,
                idempotency_key: "points:user:twice".to_owned(),
                payload: json!({"amount": 1, "reason": "plugin.over_quota"}),
            })
            .await,
        Err(PluginRuntimeError::QuotaExceeded)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn invalid_command_payloads_do_not_consume_receipts_or_daily_quota(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let user_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: user_id,
            username: "invalid_command_target".to_owned(),
            email: "invalid-command-target@example.com".to_owned(),
            display_name: "Invalid Command Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("command target fixture must initialize");
    let plugin_id = insert_plugin(&pool, "invalid_command_plugin", &["points.write"]).await;
    sqlx::query("UPDATE plugin_runtime_quotas SET command_daily_limit = 1 WHERE plugin_id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("command quota fixture must update");

    assert!(matches!(
        database
            .execute_plugin_command(ExecutePluginCommandRecord {
                plugin_id,
                kind: PluginCommandKind::PointsAppend,
                subject_id: user_id,
                idempotency_key: "invalid:payload".to_owned(),
                payload: json!({"amount": 0, "reason": "plugin.invalid"}),
            })
            .await,
        Err(PluginRuntimeError::InvalidInput)
    ));
    database
        .execute_plugin_command(ExecutePluginCommandRecord {
            plugin_id,
            kind: PluginCommandKind::PointsAppend,
            subject_id: user_id,
            idempotency_key: "valid:payload".to_owned(),
            payload: json!({"amount": 1, "reason": "plugin.valid"}),
        })
        .await
        .expect("valid command must retain the full quota");
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM plugin_command_receipts WHERE plugin_key = 'invalid_command_plugin'",
        )
        .fetch_one(&pool)
        .await
        .expect("receipt count must load"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn stable_command_namespace_rejects_a_different_subject_after_reinstall(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let first_user_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: first_user_id,
            username: "stable_namespace_first".to_owned(),
            email: "stable-namespace-first@example.com".to_owned(),
            display_name: "Stable Namespace First".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("first target fixture must initialize");
    let second_user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'stable_namespace_second', 'stable-namespace-second@example.com',
                 'Stable Namespace Second', 'active')",
    )
    .bind(second_user_id)
    .execute(&pool)
    .await
    .expect("second target fixture must insert");
    let plugin_key = "stable_command_namespace";
    let first_plugin_id = insert_plugin(&pool, plugin_key, &["points.write"]).await;
    let owner_id = plugin_owner(&pool, first_plugin_id).await;
    let command = |plugin_id, subject_id| ExecutePluginCommandRecord {
        plugin_id,
        kind: PluginCommandKind::PointsAppend,
        subject_id,
        idempotency_key: "stable:once".to_owned(),
        payload: json!({"amount": 5, "reason": "plugin.stable"}),
    };
    database
        .execute_plugin_command(command(first_plugin_id, first_user_id))
        .await
        .expect("first command must execute");
    uninstall_plugin(&pool, first_plugin_id).await;
    let replacement_id =
        insert_reinstalled_plugin(&pool, plugin_key, &["points.write"], owner_id).await;

    assert!(matches!(
        database
            .execute_plugin_command(command(replacement_id, second_user_id))
            .await,
        Err(PluginRuntimeError::IdempotencyConflict)
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM point_ledger_entries WHERE user_id = $1",
        )
        .bind(second_user_id)
        .fetch_one(&pool)
        .await
        .expect("second target ledger count must load"),
        0
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_execution_leases_are_cross_process_and_owner_checked(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let plugin_id = insert_plugin(&pool, "execution_lease_plugin", &["core.query"]).await;
    let first_token = Uuid::now_v7();
    let second_token = Uuid::now_v7();

    assert!(
        database
            .try_acquire_plugin_execution_lease(
                plugin_id,
                first_token,
                std::time::Duration::from_secs(120),
            )
            .await
            .expect("first execution lease must acquire")
    );
    assert!(
        !database
            .try_acquire_plugin_execution_lease(
                plugin_id,
                second_token,
                std::time::Duration::from_secs(120),
            )
            .await
            .expect("second execution lease lookup must succeed")
    );
    assert!(
        !database
            .release_plugin_execution_lease(plugin_id, second_token)
            .await
            .expect("non-owner release must be checked")
    );
    assert!(
        database
            .release_plugin_execution_lease(plugin_id, first_token)
            .await
            .expect("owner release must succeed")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_plugin_experience_claims_create_one_ledger_entry(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let user_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: user_id,
            username: "experience_target".to_owned(),
            email: "experience-target@example.com".to_owned(),
            display_name: "Experience Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("experience target fixture must initialize");
    let plugin_id = insert_plugin(&pool, "experience_plugin", &["experience.write"]).await;
    let source_resource_id = Uuid::now_v7();
    let input = ExecutePluginCommandRecord {
        plugin_id,
        kind: PluginCommandKind::ExperienceAppend,
        subject_id: user_id,
        idempotency_key: format!("growth:growth.topic_first_daily:{user_id}:19675"),
        payload: json!({
            "amount": 10,
            "reason": "growth.topic_first_daily",
            "source_resource_id": source_resource_id,
        }),
    };

    let (first, second) = tokio::join!(
        database.execute_plugin_command(input.clone()),
        database.execute_plugin_command(input),
    );
    let first = first.expect("first concurrent claim must execute");
    let second = second.expect("second concurrent claim must replay");

    assert_ne!(first.replayed, second.replayed);
    assert_eq!(first.resource_id, second.resource_id);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT experience FROM experience_accounts WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("experience account must load"),
        10
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM experience_ledger_entries
             WHERE user_id = $1 AND reason = 'growth.topic_first_daily'
               AND source_resource_id = $2",
        )
        .bind(user_id)
        .bind(source_resource_id)
        .fetch_one(&pool)
        .await
        .expect("experience ledger count must load"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn reinstalling_the_same_plugin_key_cannot_repeat_a_growth_claim(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let user_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: user_id,
            username: "reinstall_growth_target".to_owned(),
            email: "reinstall-growth-target@example.com".to_owned(),
            display_name: "Reinstall Growth Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("growth target fixture must initialize");
    let plugin_id = insert_plugin(&pool, "growth_reinstall", &["experience.write"]).await;
    let owner_id = sqlx::query_scalar::<_, Uuid>("SELECT installed_by FROM plugins WHERE id = $1")
        .bind(plugin_id)
        .fetch_one(&pool)
        .await
        .expect("plugin owner must load");
    let idempotency_key = format!("growth:growth.topic_first_daily:{user_id}:19675");
    let source_resource_id = Uuid::now_v7();
    let command = |plugin_id| ExecutePluginCommandRecord {
        plugin_id,
        kind: PluginCommandKind::ExperienceAppend,
        subject_id: user_id,
        idempotency_key: idempotency_key.clone(),
        payload: json!({
            "amount": 10,
            "reason": "growth.topic_first_daily",
            "source_resource_id": source_resource_id,
        }),
    };

    database
        .execute_plugin_command(command(plugin_id))
        .await
        .expect("first installation must grant the claim");
    sqlx::query("DELETE FROM plugins WHERE id = $1")
        .bind(plugin_id)
        .execute(&pool)
        .await
        .expect("disabled installation fixture must uninstall");
    let replacement_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO plugins
            (id, key, name, version, business_api_version, capabilities, data_scopes,
             component_bytes, component_sha256, status, installed_by)
         VALUES ($1, 'growth_reinstall', 'Growth reinstall plugin', '1.0.0', '0.1.0',
                 '[\"experience.write\"]'::jsonb, '[\"users.targeted\"]'::jsonb,
                 $2, $3, 'enabled', $4)",
    )
    .bind(replacement_id)
    .bind(vec![0_u8])
    .bind("0".repeat(64))
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("same-key replacement installation must insert");

    let replay = database
        .execute_plugin_command(command(replacement_id))
        .await
        .expect("same-key replacement must safely replay the claim");
    assert!(replay.replayed);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT experience FROM experience_accounts WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("experience account must load"),
        10
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM experience_ledger_entries
             WHERE user_id = $1 AND reason = 'growth.topic_first_daily'",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("growth ledger count must load"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_notifications_do_not_impersonate_the_human_installer(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let recipient_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: recipient_id,
            username: "plugin_notification_target".to_owned(),
            email: "plugin-notification-target@example.com".to_owned(),
            display_name: "Plugin Notification Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("notification target fixture must initialize");
    let plugin_id = insert_plugin(&pool, "notification_sender", &["notifications.write"]).await;

    database
        .execute_plugin_command(ExecutePluginCommandRecord {
            plugin_id,
            kind: PluginCommandKind::NotificationSend,
            subject_id: recipient_id,
            idempotency_key: "notification:system:once".to_owned(),
            payload: json!({
                "kind": "message",
                "target_type": "user",
                "target_id": recipient_id,
            }),
        })
        .await
        .expect("declared notification command must execute");

    assert_eq!(
        sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT actor_id FROM notifications
             WHERE recipient_id = $1 AND kind = 'message'",
        )
        .bind(recipient_id)
        .fetch_one(&pool)
        .await
        .expect("plugin notification actor must load"),
        None
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn maximum_length_plugin_keys_use_bounded_core_idempotency_keys(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let user_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: user_id,
            username: "long_key_target".to_owned(),
            email: "long-key-target@example.com".to_owned(),
            display_name: "Long Key Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("long key target fixture must initialize");
    let plugin_id = insert_plugin(&pool, &"p".repeat(64), &["points.write"]).await;

    database
        .execute_plugin_command(ExecutePluginCommandRecord {
            plugin_id,
            kind: PluginCommandKind::PointsAppend,
            subject_id: user_id,
            idempotency_key: "maximum-key-command".to_owned(),
            payload: json!({"amount": 1, "reason": "plugin.long_key"}),
        })
        .await
        .expect("maximum-length plugin key must execute a core command");

    let core_key = sqlx::query_scalar::<_, String>(
        "SELECT idempotency_key FROM point_ledger_entries WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("core ledger key must load");
    assert_eq!(core_key.len(), 71);
    assert!(core_key.starts_with("plugin:"));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn reinstalling_notification_commands_replay_or_conflict_by_original_input(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let recipient_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: recipient_id,
            username: "notification_reinstall_target".to_owned(),
            email: "notification-reinstall-target@example.com".to_owned(),
            display_name: "Notification Reinstall Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("notification target fixture must initialize");
    let plugin_key = "notification_reinstall";
    let first_id = insert_plugin(&pool, plugin_key, &["notifications.write"]).await;
    let owner_id = plugin_owner(&pool, first_id).await;
    let first_target = Uuid::now_v7();
    let command = |plugin_id, target_id| ExecutePluginCommandRecord {
        plugin_id,
        kind: PluginCommandKind::NotificationSend,
        subject_id: recipient_id,
        idempotency_key: "notification:stable:once".to_owned(),
        payload: json!({
            "kind": "message",
            "target_type": "user",
            "target_id": target_id,
        }),
    };
    let first = database
        .execute_plugin_command(command(first_id, first_target))
        .await
        .expect("first notification must execute");

    uninstall_plugin(&pool, first_id).await;
    let second_id =
        insert_reinstalled_plugin(&pool, plugin_key, &["notifications.write"], owner_id).await;
    let replay = database
        .execute_plugin_command(command(second_id, first_target))
        .await
        .expect("same notification input after reinstall must replay");
    assert!(replay.replayed);
    assert_eq!(replay.resource_id, first.resource_id);

    uninstall_plugin(&pool, second_id).await;
    let third_id =
        insert_reinstalled_plugin(&pool, plugin_key, &["notifications.write"], owner_id).await;
    assert!(matches!(
        database
            .execute_plugin_command(command(third_id, Uuid::now_v7()))
            .await,
        Err(PluginRuntimeError::IdempotencyConflict)
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM notifications WHERE recipient_id = $1",)
            .bind(recipient_id)
            .fetch_one(&pool)
            .await
            .expect("notification count must load"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn reinstalling_entitlement_grants_uses_the_stable_plugin_key_as_source(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let user_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: user_id,
            username: "entitlement_reinstall_target".to_owned(),
            email: "entitlement-reinstall-target@example.com".to_owned(),
            display_name: "Entitlement Reinstall Target".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("entitlement target fixture must initialize");
    let plugin_key = "entitlement_reinstall";
    let first_id = insert_plugin(&pool, plugin_key, &["entitlements.write"]).await;
    let owner_id = plugin_owner(&pool, first_id).await;
    grant_super_admin(&pool, owner_id).await;
    let entitlement_type = database
        .put_standard_entitlement_type(
            owner_id,
            PutStandardEntitlementTypeRecord {
                internal_key: "plugin_reinstall_access".to_owned(),
                display_name: "Plugin Reinstall Access".to_owned(),
                permission_keys: vec!["topic.poll.create".to_owned()],
                quotas: BTreeMap::new(),
                expected_revision: None,
            },
        )
        .await
        .expect("entitlement type must be created");
    let now = OffsetDateTime::now_utc();
    let command = |plugin_id, reason: &str| ExecutePluginCommandRecord {
        plugin_id,
        kind: PluginCommandKind::EntitlementGrant,
        subject_id: user_id,
        idempotency_key: "entitlement:stable:once".to_owned(),
        payload: json!({
            "entitlement_type_id": entitlement_type.id,
            "reason": reason,
            "starts_at_unix_ms": now.unix_timestamp_nanos() / 1_000_000,
            "ends_at_unix_ms": (now + Duration::days(1)).unix_timestamp_nanos() / 1_000_000,
        }),
    };
    let first = database
        .execute_plugin_command(command(first_id, "plugin.stable_grant"))
        .await
        .expect("first entitlement grant must execute");

    uninstall_plugin(&pool, first_id).await;
    let second_id =
        insert_reinstalled_plugin(&pool, plugin_key, &["entitlements.write"], owner_id).await;
    let replay = database
        .execute_plugin_command(command(second_id, "plugin.stable_grant"))
        .await
        .expect("same entitlement input after reinstall must replay");
    assert!(replay.replayed);
    assert_eq!(replay.resource_id, first.resource_id);

    uninstall_plugin(&pool, second_id).await;
    let third_id =
        insert_reinstalled_plugin(&pool, plugin_key, &["entitlements.write"], owner_id).await;
    assert!(matches!(
        database
            .execute_plugin_command(command(third_id, "plugin.changed_grant"))
            .await,
        Err(PluginRuntimeError::IdempotencyConflict)
    ));
    assert_eq!(
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT source_reference_id FROM user_standard_entitlements WHERE id = $1",
        )
        .bind(first.resource_id)
        .fetch_one(&pool)
        .await
        .expect("entitlement source must load"),
        Some(plugin_key.to_owned())
    );
}

async fn insert_plugin(pool: &PgPool, key: &str, capabilities: &[&str]) -> Uuid {
    let owner_id = Uuid::now_v7();
    let plugin_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, $2, $3, $4, 'active')",
    )
    .bind(owner_id)
    .bind(format!("plugin_{}", &plugin_id.simple().to_string()[..12]))
    .bind(format!("{}@example.com", plugin_id.simple()))
    .bind(format!(
        "Plugin owner {}",
        &plugin_id.simple().to_string()[..8]
    ))
    .execute(pool)
    .await
    .expect("plugin owner fixture must insert");
    sqlx::query(
        "INSERT INTO plugins
            (id, key, name, version, business_api_version, capabilities, data_scopes,
             component_bytes, component_sha256, status, installed_by)
         VALUES ($1, $2, $3, '1.0.0', '0.1.0', $4, $5, $6, $7, 'enabled', $8)",
    )
    .bind(plugin_id)
    .bind(key)
    .bind(format!("{key} plugin"))
    .bind(serde_json::to_value(capabilities).expect("capabilities must serialize"))
    .bind(
        if capabilities.iter().any(|capability| {
            matches!(
                *capability,
                "points.write" | "experience.write" | "entitlements.write" | "notifications.write"
            )
        }) {
            json!(["users.targeted"])
        } else {
            json!([])
        },
    )
    .bind(vec![0_u8])
    .bind("0".repeat(64))
    .bind(owner_id)
    .execute(pool)
    .await
    .expect("business plugin fixture must insert");
    plugin_id
}

async fn grant_super_admin(pool: &PgPool, user_id: Uuid) {
    let role_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system)
         VALUES ($1, 'test_plugin_fixture_admin', 'Test plugin fixture admin', 'instance', FALSE)",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test plugin fixture role must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE permission_key = 'entitlements.types.write'",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test plugin fixture permission must insert");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id)
         VALUES ($1, $2, $3, $2, NULL)",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test plugin fixture role must be assigned");
}

async fn plugin_owner(pool: &PgPool, plugin_id: Uuid) -> Uuid {
    sqlx::query_scalar("SELECT installed_by FROM plugins WHERE id = $1")
        .bind(plugin_id)
        .fetch_one(pool)
        .await
        .expect("plugin owner must load")
}

async fn uninstall_plugin(pool: &PgPool, plugin_id: Uuid) {
    sqlx::query("DELETE FROM plugins WHERE id = $1")
        .bind(plugin_id)
        .execute(pool)
        .await
        .expect("plugin fixture must uninstall");
}

async fn insert_reinstalled_plugin(
    pool: &PgPool,
    key: &str,
    capabilities: &[&str],
    owner_id: Uuid,
) -> Uuid {
    let plugin_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO plugins
            (id, key, name, version, business_api_version, capabilities, data_scopes,
             component_bytes, component_sha256, status, installed_by)
         VALUES ($1, $2, $3, '1.0.0', '0.1.0', $4, '[\"users.targeted\"]'::jsonb,
                 $5, $6, 'enabled', $7)",
    )
    .bind(plugin_id)
    .bind(key)
    .bind(format!("{key} plugin"))
    .bind(serde_json::to_value(capabilities).expect("capabilities must serialize"))
    .bind(vec![0_u8])
    .bind("0".repeat(64))
    .bind(owner_id)
    .execute(pool)
    .await
    .expect("replacement business plugin fixture must insert");
    plugin_id
}
