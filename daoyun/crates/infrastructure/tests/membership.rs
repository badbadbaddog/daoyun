use infrastructure::{
    Database, NewUserRecord, UpdateMembershipLevelRuleError, UpdateMembershipLevelRuleRecord,
    UpdateMembershipMedalRuleRecord,
};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn membership_account_is_initialized_and_ledger_is_idempotent(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    sqlx::query(
        "UPDATE system_state
         SET is_initialized = TRUE,
             initialized_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP",
    )
    .execute(&pool)
    .await
    .expect("test instance must be initialized");
    let user_id = Uuid::now_v7();
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "ledger_user".to_owned(),
            email: "ledger@example.com".to_owned(),
            display_name: "Ledger User".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("registration must initialize membership account");

    let initial = database
        .get_membership_account(user_id)
        .await
        .expect("membership account lookup must work")
        .expect("registered user must have a membership account");
    assert_eq!(initial.points_balance, 0);
    assert_eq!(initial.lifetime_points, 0);
    assert_eq!(initial.level_key, "lv_1");
    assert_eq!(initial.level_number, 1);
    assert_eq!(initial.level_display_name, "Lv1");

    let first = database
        .append_points_ledger(user_id, 25, "topic.publish", Some("event-1"))
        .await
        .expect("first ledger entry must succeed");
    assert!(first.created);
    assert_eq!(first.account.points_balance, 25);

    let replay = database
        .append_points_ledger(user_id, 25, "topic.publish", Some("event-1"))
        .await
        .expect("idempotent replay must succeed");
    assert!(!replay.created);
    assert_eq!(replay.account.points_balance, 25);

    let conflict = database
        .append_points_ledger(user_id, 30, "topic.publish", Some("event-1"))
        .await
        .expect_err("reusing a key with different content must conflict");
    assert!(matches!(
        conflict,
        infrastructure::AppendPointsLedgerError::IdempotencyConflict
    ));

    let insufficient = database
        .append_points_ledger(user_id, -26, "moderation.adjustment", Some("event-2"))
        .await
        .expect_err("the balance must not become negative");
    assert!(matches!(
        insufficient,
        infrastructure::AppendPointsLedgerError::InsufficientBalance
    ));

    let account = database
        .get_membership_account(user_id)
        .await
        .expect("membership account lookup must work")
        .expect("membership account must remain available");
    assert_eq!(account.lifetime_points, 25);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM outbox_events
             WHERE event_type = 'points.changed' AND aggregate_id = $1",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("points event count must be queryable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_grant_uses_configured_level_rules_and_records_audit(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let actor_id = insert_user(&pool, "rule_admin", "rule-admin@example.com").await;
    grant_super_admin(&pool, actor_id).await;
    let user_id = insert_user(&pool, "rule_member", "rule-member@example.com").await;

    let initial_rules = database
        .list_membership_level_rules()
        .await
        .expect("membership rules must be readable");
    assert_eq!(initial_rules.len(), 6);
    assert!(initial_rules[0].enabled);
    assert_eq!(initial_rules[0].required_lifetime_points, 0);
    assert!(initial_rules.iter().all(|rule| rule.enabled));
    assert_eq!(
        initial_rules
            .iter()
            .map(|rule| rule.level_key.as_str())
            .collect::<Vec<_>>(),
        ["lv_1", "lv_2", "lv_3", "lv_4", "lv_5", "lv_6"]
    );

    let l2 = database
        .update_membership_level_rule(
            actor_id,
            UpdateMembershipLevelRuleRecord {
                level_key: "lv_2".to_owned(),
                enabled: Some(true),
                required_lifetime_points: Some(25),
                display_name: Some("入门会员".to_owned()),
            },
        )
        .await
        .expect("L2 rule must be configurable");
    assert!(l2.enabled);
    assert_eq!(l2.required_lifetime_points, 25);
    assert_eq!(l2.level_display_name, "入门会员");

    let granted = database
        .grant_membership_points(actor_id, user_id, 25, "admin.grant", None, Some("grant-1"))
        .await
        .expect("point grant must succeed");
    assert!(granted.created);
    assert_eq!(granted.account.level_key, "lv_2");
    assert_eq!(granted.account.level_display_name, "入门会员");
    assert_eq!(granted.account.lifetime_points, 25);

    let replay = database
        .grant_membership_points(actor_id, user_id, 25, "admin.grant", None, Some("grant-1"))
        .await
        .expect("point grant replay must succeed");
    assert!(!replay.created);
    assert_eq!(replay.account.level_key, "lv_2");

    let audit_actions = sqlx::query_scalar::<_, String>(
        "SELECT action FROM admin_audit_log
         WHERE actor_id = $1 AND resource_type IN ('membership_level_rule', 'membership_account')
         ORDER BY created_at, id",
    )
    .bind(actor_id)
    .fetch_all(&pool)
    .await
    .expect("membership audit rows must be readable");
    assert_eq!(
        audit_actions,
        vec!["membership.rule.update", "membership.points.grant"]
    );

    let conflict = database
        .update_membership_level_rule(
            actor_id,
            UpdateMembershipLevelRuleRecord {
                level_key: "lv_3".to_owned(),
                enabled: Some(true),
                required_lifetime_points: Some(20),
                display_name: None,
            },
        )
        .await
        .expect_err("enabled thresholds must increase with level number");
    assert!(matches!(
        conflict,
        UpdateMembershipLevelRuleError::InvalidThresholdOrder
    ));

    let out_of_order = database
        .update_membership_level_rule(
            actor_id,
            UpdateMembershipLevelRuleRecord {
                level_key: "lv_8".to_owned(),
                enabled: Some(true),
                required_lifetime_points: Some(20_000),
                display_name: None,
            },
        )
        .await
        .expect_err("reserved levels must be opened in sequence");
    assert!(matches!(
        out_of_order,
        UpdateMembershipLevelRuleError::InvalidAppendOrder
    ));

    let opened = database
        .update_membership_level_rule(
            actor_id,
            UpdateMembershipLevelRuleRecord {
                level_key: "lv_7".to_owned(),
                enabled: Some(true),
                required_lifetime_points: Some(20_000),
                display_name: Some("成长会员".to_owned()),
            },
        )
        .await
        .expect("the next level must be appendable");
    assert_eq!(opened.level_display_name, "成长会员");
    assert_eq!(
        database
            .list_membership_level_rules()
            .await
            .expect("open levels must be listed")
            .len(),
        7
    );

    let cannot_close = database
        .update_membership_level_rule(
            actor_id,
            UpdateMembershipLevelRuleRecord {
                level_key: "lv_6".to_owned(),
                enabled: Some(false),
                required_lifetime_points: None,
                display_name: None,
            },
        )
        .await
        .expect_err("published levels must not be closed");
    assert!(matches!(
        cannot_close,
        UpdateMembershipLevelRuleError::InvalidAppendOrder
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn medals_are_idempotent_and_auto_awarded_by_points_rule(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let actor_id = insert_user(&pool, "medal_admin", "medal-admin@example.com").await;
    grant_super_admin(&pool, actor_id).await;
    let user_id = insert_user(&pool, "medal_member", "medal-member@example.com").await;
    let rule = database
        .update_membership_medal_rule(
            actor_id,
            UpdateMembershipMedalRuleRecord {
                medal_key: "medal_01".to_owned(),
                display_name: "勋章 01".to_owned(),
                asset_key: "medal_01".to_owned(),
                expected_revision: 1,
                enabled: true,
                required_lifetime_points: Some(10),
            },
        )
        .await
        .expect("medal rule must be configurable");
    assert!(rule.enabled);
    let points = database
        .append_points_ledger(user_id, 10, "topic.publish", Some("medal-points"))
        .await
        .expect("points must trigger medal rule");
    assert!(points.created);
    let medals = database
        .list_membership_medals(user_id)
        .await
        .expect("medals must be listed");
    assert_eq!(
        medals
            .iter()
            .map(|medal| medal.medal_key.as_str())
            .collect::<Vec<_>>(),
        ["medal_01"]
    );
    let first = database
        .grant_membership_medal(actor_id, user_id, "medal_02", "operator.award")
        .await
        .expect("manual award must succeed");
    assert!(first.created);
    let replay = database
        .grant_membership_medal(actor_id, user_id, "medal_02", "operator.award")
        .await
        .expect("duplicate award must be idempotent");
    assert!(!replay.created);
    assert_eq!(
        database
            .list_membership_medals(user_id)
            .await
            .unwrap()
            .len(),
        2
    );
    let invalid = database
        .grant_membership_medal(actor_id, user_id, "medal_18", "operator.award")
        .await
        .expect_err("unknown medal keys must be rejected");
    assert!(matches!(
        invalid,
        infrastructure::GrantMembershipMedalError::InvalidMedal
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn medal_catalog_crud_preserves_ownership_and_checks_revisions(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let admin = insert_user(&pool, "catalog_admin", "catalog-admin@example.com").await;
    grant_super_admin(&pool, admin).await;
    let member = insert_user(&pool, "catalog_member", "catalog-member@example.com").await;
    let input = |key: String, name: &str, revision| UpdateMembershipMedalRuleRecord {
        medal_key: key,
        display_name: name.to_owned(),
        asset_key: "medal_02".to_owned(),
        expected_revision: revision,
        enabled: true,
        required_lifetime_points: Some(10),
    };
    assert!(matches!(
        database
            .create_membership_medal_rule(member, input(String::new(), "贡献者", 1))
            .await,
        Err(infrastructure::UpdateMembershipMedalRuleError::Forbidden)
    ));
    let created = database
        .create_membership_medal_rule(admin, input(String::new(), "贡献者", 1))
        .await
        .unwrap();
    assert!(created.medal_key.len() > 9);
    assert_eq!(created.revision, 1);
    let saved = database
        .update_membership_medal_rule(admin, input(created.medal_key.clone(), "年度贡献者", 1))
        .await
        .unwrap();
    assert_eq!(saved.revision, 2);
    assert!(matches!(
        database
            .update_membership_medal_rule(admin, input(created.medal_key.clone(), "过期编辑", 1))
            .await,
        Err(infrastructure::UpdateMembershipMedalRuleError::RevisionConflict)
    ));
    database
        .grant_membership_medal(admin, member, &created.medal_key, "operator.award")
        .await
        .unwrap();
    assert!(matches!(
        database
            .delete_membership_medal_rule(admin, &created.medal_key, 1)
            .await,
        Err(infrastructure::UpdateMembershipMedalRuleError::RevisionConflict)
    ));
    database
        .delete_membership_medal_rule(admin, &created.medal_key, 2)
        .await
        .unwrap();
    assert!(
        !database
            .list_membership_medal_rules()
            .await
            .unwrap()
            .iter()
            .any(|rule| rule.medal_key == created.medal_key)
    );
    let owned = database.list_membership_medals(member).await.unwrap();
    assert_eq!(owned[0].display_name, "年度贡献者");
    assert_eq!(owned[0].asset_key, "medal_02");
    assert!(matches!(
        database
            .grant_membership_medal(admin, member, &created.medal_key, "operator.award")
            .await,
        Err(infrastructure::GrantMembershipMedalError::InvalidMedal)
    ));
    let fresh = insert_user(&pool, "catalog_new", "catalog-new@example.com").await;
    database
        .append_points_ledger(fresh, 20, "topic.publish", Some("deleted-medal"))
        .await
        .unwrap();
    assert!(
        database
            .list_membership_medals(fresh)
            .await
            .unwrap()
            .is_empty()
    );
    let operations = database
        .list_membership_medal_operations(Some(member), None, None, 25)
        .await
        .unwrap();
    assert_eq!(operations[0].medal_display_name, "年度贡献者");
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM admin_audit_log WHERE actor_id = $1 AND resource_type = 'membership_medal_rule'").bind(admin).fetch_one(&pool).await.unwrap(), 3);
}

async fn grant_super_admin(pool: &PgPool, user_id: Uuid) {
    let role_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system)
         VALUES ($1, 'test_membership_admin', 'Test membership admin', 'instance', FALSE)",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test membership role must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions
         WHERE permission_key IN (
             'membership.rules.write',
             'membership.points.grant',
             'membership.medals.rules.write',
             'membership.medals.grant'
         )",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test membership permissions must insert");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id)
         VALUES ($1, $2, $3, $2, NULL)",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test membership role must be assigned");
}

async fn insert_user(pool: &PgPool, username: &str, email: &str) -> Uuid {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name)
         VALUES ($1, $2, $3, $2)",
    )
    .bind(user_id)
    .bind(username)
    .bind(email)
    .execute(pool)
    .await
    .expect("user fixture must insert");
    sqlx::query("INSERT INTO membership_accounts (user_id) VALUES ($1)")
        .bind(user_id)
        .execute(pool)
        .await
        .expect("membership account fixture must insert");
    user_id
}
