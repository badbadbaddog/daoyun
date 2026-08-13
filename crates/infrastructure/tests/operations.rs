use infrastructure::{
    Database, InstallationAdministrator, MutateOperationsAlertError, NewUserRecord,
    OperationsMetricValues, UpdateOperationsAlertRuleRecord,
};
use sqlx::PgPool;
use uuid::Uuid;

async fn initialize(pool: &PgPool) -> (Database, Uuid) {
    let database = Database::from_pool(pool.clone());
    let administrator_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: administrator_id,
            username: "operations_owner".to_owned(),
            email: "operations_owner@example.com".to_owned(),
            display_name: "Operations Owner".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("installation must initialize");
    (database, administrator_id)
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn alert_evaluation_deduplicates_active_incidents_and_resolves_recovery(pool: PgPool) {
    let (database, _) = initialize(&pool).await;
    let rules = database
        .list_operations_alert_rules()
        .await
        .expect("alert rules must load");
    assert_eq!(rules.len(), 4);

    let transitions = database
        .evaluate_operations_alerts(OperationsMetricValues {
            http_5xx_count: 11,
            http_5xx_window_seconds: 300,
            http_p95_ms: 0,
            http_p95_window_seconds: 300,
        })
        .await
        .expect("a threshold breach must evaluate");
    assert_eq!(transitions.len(), 1);
    assert_eq!(transitions[0].rule_key, "api_5xx");
    assert_eq!(transitions[0].previous_status, None);
    assert_eq!(transitions[0].status, "open");

    let first = database
        .list_operations_alerts(Some("open"), None, 10)
        .await
        .expect("open alerts must load");
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].observed_value, 11);

    let repeated = database
        .evaluate_operations_alerts(OperationsMetricValues {
            http_5xx_count: 14,
            http_5xx_window_seconds: 300,
            http_p95_ms: 0,
            http_p95_window_seconds: 300,
        })
        .await
        .expect("a repeated breach must evaluate");
    assert!(
        repeated.is_empty(),
        "an existing open incident is not a transition"
    );
    let active_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM operations_alerts WHERE status IN ('open', 'acknowledged')",
    )
    .fetch_one(&pool)
    .await
    .expect("active alert count must load");
    assert_eq!(active_count, 1);
    let observed = sqlx::query_scalar::<_, i64>(
        "SELECT observed_value FROM operations_alerts WHERE status = 'open'",
    )
    .fetch_one(&pool)
    .await
    .expect("active alert value must load");
    assert_eq!(observed, 14);

    let recovered = database
        .evaluate_operations_alerts(OperationsMetricValues {
            http_5xx_count: 10,
            http_5xx_window_seconds: 300,
            http_p95_ms: 0,
            http_p95_window_seconds: 300,
        })
        .await
        .expect("a recovery must evaluate");
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].previous_status.as_deref(), Some("open"));
    assert_eq!(recovered[0].status, "resolved");
    assert!(
        database
            .list_operations_alerts(Some("open"), None, 10)
            .await
            .expect("open alerts must load")
            .is_empty()
    );
    let resolved = database
        .list_operations_alerts(Some("resolved"), None, 10)
        .await
        .expect("resolved alerts must load");
    assert_eq!(resolved.len(), 1);
    assert!(resolved[0].resolved_at.is_some());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn rule_updates_and_alert_acknowledgement_enforce_capability_revision_and_audit(
    pool: PgPool,
) {
    let (database, administrator_id) = initialize(&pool).await;
    let rule = database
        .list_operations_alert_rules()
        .await
        .expect("alert rules must load")
        .into_iter()
        .find(|rule| rule.key == "api_5xx")
        .expect("5xx alert rule must exist");

    let updated = database
        .update_operations_alert_rule(
            administrator_id,
            UpdateOperationsAlertRuleRecord {
                rule_id: rule.id,
                name: "API 服务器错误".to_owned(),
                threshold: 3,
                window_seconds: 300,
                enabled: true,
                expected_revision: rule.revision,
            },
        )
        .await
        .expect("administrator must update a rule");
    assert_eq!(updated.revision, rule.revision + 1);

    let stale = database
        .update_operations_alert_rule(
            administrator_id,
            UpdateOperationsAlertRuleRecord {
                rule_id: rule.id,
                name: "Stale".to_owned(),
                threshold: 4,
                window_seconds: 300,
                enabled: true,
                expected_revision: rule.revision,
            },
        )
        .await;
    assert!(matches!(stale, Err(MutateOperationsAlertError::Conflict)));

    database
        .evaluate_operations_alerts(OperationsMetricValues {
            http_5xx_count: 4,
            http_5xx_window_seconds: 300,
            http_p95_ms: 0,
            http_p95_window_seconds: 300,
        })
        .await
        .expect("updated threshold must evaluate");
    let alert = database
        .list_operations_alerts(Some("open"), None, 10)
        .await
        .expect("open alert must load")
        .into_iter()
        .next()
        .expect("open alert must exist");
    let acknowledged = database
        .acknowledge_operations_alert(administrator_id, alert.id)
        .await
        .expect("administrator must acknowledge an alert");
    assert_eq!(acknowledged.status, "acknowledged");
    assert_eq!(acknowledged.acknowledged_by_id, Some(administrator_id));
    assert!(acknowledged.acknowledged_at.is_some());

    let repeated = database
        .acknowledge_operations_alert(administrator_id, alert.id)
        .await;
    assert!(matches!(
        repeated,
        Err(MutateOperationsAlertError::Conflict)
    ));

    let member_id = Uuid::now_v7();
    database
        .register_user(NewUserRecord {
            id: member_id,
            username: "operations_member".to_owned(),
            email: "operations_member@example.com".to_owned(),
            display_name: "Operations Member".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("member must be creatable");
    let forbidden = database
        .update_operations_alert_rule(
            member_id,
            UpdateOperationsAlertRuleRecord {
                rule_id: rule.id,
                name: updated.name.clone(),
                threshold: updated.threshold,
                window_seconds: updated.window_seconds,
                enabled: updated.enabled,
                expected_revision: updated.revision,
            },
        )
        .await;
    assert!(matches!(
        forbidden,
        Err(MutateOperationsAlertError::Forbidden)
    ));

    let audit_actions = sqlx::query_scalar::<_, String>(
        "SELECT action FROM admin_audit_log WHERE resource_type LIKE 'operations_%' ORDER BY created_at, id",
    )
    .fetch_all(&pool)
    .await
    .expect("operations audit actions must load");
    assert_eq!(
        audit_actions,
        vec![
            "operations.alert_rule.update",
            "operations.alert.acknowledge"
        ]
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn operations_summary_reports_database_and_persistent_queue_state(pool: PgPool) {
    let (database, _) = initialize(&pool).await;
    let summary = database
        .operations_summary()
        .await
        .expect("operations summary must load");

    assert!(summary.database_connections >= 1);
    assert_eq!(summary.outbox_pending, 0);
    assert_eq!(summary.outbox_processing, 0);
    assert_eq!(summary.outbox_dead, 0);
    assert_eq!(summary.risk_alerts_open, 0);
    assert_eq!(summary.operations_alerts_open, 0);
    assert_eq!(summary.operations_alerts_acknowledged, 0);
}
