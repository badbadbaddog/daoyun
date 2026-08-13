use infrastructure::{
    Database, InstallPluginRecord, InstallationAdministrator, NewUserRecord, PluginInvokeError,
    PluginMutationError, UpdatePluginStatusRecord,
};
use sqlx::PgPool;
use uuid::Uuid;

async fn initialize(pool: &PgPool) -> (Database, Uuid) {
    let database = Database::from_pool(pool.clone());
    let administrator_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: administrator_id,
            username: "plugin_owner".to_owned(),
            email: "plugin_owner@example.com".to_owned(),
            display_name: "Plugin Owner".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("installation must initialize");
    (database, administrator_id)
}

fn install_record(id: Uuid) -> InstallPluginRecord {
    InstallPluginRecord {
        id,
        key: "identity_plugin".to_owned(),
        name: "Identity plugin".to_owned(),
        version: "1.0.0".to_owned(),
        description: "Test plugin".to_owned(),
        capabilities: vec!["content.transform".to_owned()],
        component_bytes: vec![0, 97, 115, 109, 13, 0, 1, 0],
        component_sha256: "0".repeat(64),
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_lifecycle_is_revisioned_capability_checked_and_audited(pool: PgPool) {
    let (database, administrator_id) = initialize(&pool).await;
    let plugin_id = Uuid::now_v7();
    let installed = database
        .install_plugin(administrator_id, install_record(plugin_id))
        .await
        .expect("administrator must install a plugin");
    assert_eq!(installed.status, "disabled");
    assert_eq!(installed.revision, 1);
    assert_eq!(installed.component_size, 8);
    assert_eq!(installed.installed_by, administrator_id);

    let conflict = database
        .install_plugin(administrator_id, install_record(Uuid::now_v7()))
        .await;
    assert!(matches!(conflict, Err(PluginMutationError::Conflict)));

    let enabled = database
        .update_plugin_status(
            administrator_id,
            UpdatePluginStatusRecord {
                plugin_id,
                status: "enabled".to_owned(),
                expected_revision: 1,
            },
        )
        .await
        .expect("administrator must enable a plugin");
    assert_eq!(enabled.status, "enabled");
    assert_eq!(enabled.revision, 2);
    assert!(matches!(
        database
            .update_plugin_status(
                administrator_id,
                UpdatePluginStatusRecord {
                    plugin_id,
                    status: "disabled".to_owned(),
                    expected_revision: 1,
                },
            )
            .await,
        Err(PluginMutationError::Conflict)
    ));

    let executable = database
        .load_plugin_for_invoke(administrator_id, plugin_id, "content.transform")
        .await
        .expect("enabled declared capability must load");
    assert_eq!(executable.component_bytes.len(), 8);
    assert_eq!(executable.key, "identity_plugin");
    assert!(matches!(
        database
            .load_plugin_for_invoke(administrator_id, plugin_id, "ui.panel")
            .await,
        Err(PluginInvokeError::CapabilityDenied)
    ));

    assert!(matches!(
        database.delete_plugin(administrator_id, plugin_id).await,
        Err(PluginMutationError::MustBeDisabled)
    ));
    let disabled = database
        .update_plugin_status(
            administrator_id,
            UpdatePluginStatusRecord {
                plugin_id,
                status: "disabled".to_owned(),
                expected_revision: 2,
            },
        )
        .await
        .expect("administrator must disable a plugin");
    assert_eq!(disabled.revision, 3);
    assert!(matches!(
        database
            .load_plugin_for_invoke(administrator_id, plugin_id, "content.transform")
            .await,
        Err(PluginInvokeError::Disabled)
    ));
    database
        .delete_plugin(administrator_id, plugin_id)
        .await
        .expect("disabled plugin must uninstall");

    let actions = sqlx::query_scalar::<_, String>(
        "SELECT action FROM admin_audit_log
         WHERE resource_type = 'plugin'
         ORDER BY created_at, id",
    )
    .fetch_all(&pool)
    .await
    .expect("plugin audit actions must load");
    assert_eq!(
        actions,
        vec![
            "plugin.install",
            "plugin.lifecycle.enable",
            "plugin.invoke",
            "plugin.lifecycle.disable",
            "plugin.uninstall",
        ]
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn plugin_permissions_and_database_constraints_fail_closed(pool: PgPool) {
    let (database, administrator_id) = initialize(&pool).await;
    let member_id = Uuid::now_v7();
    database
        .register_user(NewUserRecord {
            id: member_id,
            username: "plugin_member".to_owned(),
            email: "plugin_member@example.com".to_owned(),
            display_name: "Plugin Member".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("member must be created");
    assert!(matches!(
        database
            .install_plugin(member_id, install_record(Uuid::now_v7()))
            .await,
        Err(PluginMutationError::Forbidden)
    ));

    let permissions = sqlx::query_scalar::<_, String>(
        "SELECT permission.permission_key
         FROM roles AS role
         INNER JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
         INNER JOIN permissions AS permission ON permission.id = role_permission.permission_id
         WHERE role.key = 'super_admin' AND permission.permission_key LIKE 'plugins.%'
         ORDER BY permission.permission_key",
    )
    .fetch_all(&pool)
    .await
    .expect("plugin permissions must load");
    assert_eq!(
        permissions,
        vec![
            "plugins.install",
            "plugins.invoke",
            "plugins.lifecycle",
            "plugins.read",
        ]
    );
    assert!(
        database
            .has_permission(administrator_id, "plugins.read", None)
            .await
            .expect("permission lookup must succeed")
    );

    let invalid = sqlx::query(
        "INSERT INTO plugins
         (id, key, name, version, description, capabilities, component_bytes,
          component_sha256, status, installed_by)
         VALUES ($1, 'bad_plugin', 'Bad', '1.0.0', '', '[\"unknown\"]',
                 $2, $3, 'running', $4)",
    )
    .bind(Uuid::now_v7())
    .bind(vec![0_u8])
    .bind("g".repeat(64))
    .bind(administrator_id)
    .execute(&pool)
    .await;
    assert!(
        invalid.is_err(),
        "database constraints must reject invalid facts"
    );
}
