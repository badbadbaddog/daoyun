use infrastructure::{Database, PutRedemptionProduct, RedemptionError};
use sqlx::PgPool;
use uuid::Uuid;

async fn fixture(pool: &PgPool) -> (Database, Uuid, Uuid, Uuid) {
    let actor = Uuid::now_v7();
    let user = Uuid::now_v7();
    for (id, name) in [(actor, "redeem_admin"), (user, "redeem_member")] {
        sqlx::query("INSERT INTO users (id, username, email, display_name, status) VALUES ($1, $2, $2 || '@example.com', $2, 'active')")
            .bind(id).bind(name).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO membership_accounts (user_id, points_balance) VALUES ($1, 100)")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }
    let role = Uuid::now_v7();
    sqlx::query("INSERT INTO roles (id, key, name, scope) VALUES ($1, 'redeem_admin', 'Redeem admin', 'instance')")
        .bind(role).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key IN ('membership.redemptions.read', 'membership.redemptions.write', 'entitlements.types.write')")
        .bind(role).execute(pool).await.unwrap();
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by) VALUES ($1, $2, $3, $2)",
    )
    .bind(Uuid::now_v7())
    .bind(actor)
    .bind(role)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO plugins (id,key,name,version,description,capabilities,component_bytes,component_sha256,status,installed_by,business_api_version,data_scopes,event_subscriptions) VALUES ($1,'official_points_redemption','Points redemption','1.0.0','','[\"membership.redemption\",\"ui.panel\"]',$2,$3,'enabled',$4,'0.1.0','[]','[]')")
        .bind(Uuid::now_v7()).bind(vec![0_u8]).bind("a".repeat(64)).bind(actor).execute(pool).await.unwrap();
    let db = Database::from_pool(pool.clone());
    let kind = db
        .put_standard_entitlement_type(
            actor,
            infrastructure::PutStandardEntitlementTypeRecord {
                internal_key: "redeem_vip".into(),
                display_name: "VIP".into(),
                permission_keys: vec!["topic.poll.create".into()],
                quotas: Default::default(),
                expected_revision: None,
            },
        )
        .await
        .unwrap();
    (db, actor, user, kind.id)
}

fn product(kind: Uuid, id: Uuid) -> PutRedemptionProduct {
    PutRedemptionProduct {
        id,
        name: "七日权益".into(),
        entitlement_type_id: kind,
        type_version: 1,
        price: 60,
        duration_days: 7,
        per_user_limit: 1,
        enabled: true,
        expected_revision: None,
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn redemption_is_atomic_and_concurrent_retries_return_one_receipt(pool: PgPool) {
    let (db, actor, user, kind) = fixture(&pool).await;
    let item = db
        .put_redemption_product(actor, product(kind, Uuid::now_v7()))
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        db.redeem_points(user, item.id, item.revision, "same"),
        db.redeem_points(user, item.id, item.revision, "same"),
    );
    let (a, ac) = a.unwrap();
    let (b, bc) = b.unwrap();
    assert_eq!(a.id, b.id);
    assert_ne!(ac, bc);
    assert_eq!(a.balance_after, 40);
    assert_eq!(
        db.get_membership_account(user)
            .await
            .unwrap()
            .unwrap()
            .points_balance,
        40
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM user_standard_entitlements WHERE user_id=$1")
            .bind(user)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
    assert!(matches!(
        db.redeem_points(user, item.id, item.revision, "other")
            .await,
        Err(RedemptionError::AlreadyEntitled)
    ));
    sqlx::query("UPDATE plugins SET status='disabled'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(db.list_redemptions(user, None, 20).await.unwrap().len(), 1);
    assert_eq!(
        db.redeem_points(user, item.id, item.revision, "same")
            .await
            .unwrap()
            .0
            .id,
        a.id
    );
    assert!(matches!(
        db.redeem_points(actor, item.id, item.revision, "new").await,
        Err(RedemptionError::Disabled)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn redemption_rejects_price_changes_and_rolls_back_on_audit_failure(pool: PgPool) {
    let (db, actor, user, kind) = fixture(&pool).await;
    let id = Uuid::now_v7();
    let original = db
        .put_redemption_product(actor, product(kind, id))
        .await
        .unwrap();
    let mut update = product(kind, id);
    update.expected_revision = Some(original.revision);
    update.price = 70;
    let updated = db.put_redemption_product(actor, update).await.unwrap();
    assert!(matches!(
        db.redeem_points(user, id, original.revision, "old").await,
        Err(RedemptionError::Conflict)
    ));
    sqlx::query("ALTER TABLE admin_audit_log ADD CONSTRAINT fail_redemption_audit CHECK (action <> 'membership.redemption.create')")
        .execute(&pool).await.unwrap();
    assert!(matches!(
        db.redeem_points(user, id, updated.revision, "fail").await,
        Err(RedemptionError::Database(_))
    ));
    assert_eq!(
        db.get_membership_account(user)
            .await
            .unwrap()
            .unwrap()
            .points_balance,
        100
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM user_standard_entitlements")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query("ALTER TABLE admin_audit_log DROP CONSTRAINT fail_redemption_audit")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        db.redeem_points(user, id, updated.revision, "fail")
            .await
            .unwrap()
            .0
            .balance_after,
        30
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn redemption_enforces_balance_account_status_and_management_permission(pool: PgPool) {
    let (db, actor, user, kind) = fixture(&pool).await;
    assert!(matches!(
        db.put_redemption_product(user, product(kind, Uuid::now_v7()))
            .await,
        Err(RedemptionError::Forbidden)
    ));
    let mut input = product(kind, Uuid::now_v7());
    input.price = 101;
    let item = db.put_redemption_product(actor, input).await.unwrap();
    assert!(matches!(
        db.redeem_points(user, item.id, item.revision, "poor").await,
        Err(RedemptionError::InsufficientBalance)
    ));
    sqlx::query("UPDATE users SET status='restricted' WHERE id=$1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.redeem_points(user, item.id, item.revision, "restricted")
            .await,
        Err(RedemptionError::Forbidden)
    ));
    assert!(matches!(
        db.list_redemption_products(Some(user), true, None, 20)
            .await,
        Err(RedemptionError::Forbidden)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn outbox_failure_rolls_back_redemption_and_expiry_does_not_reset_lifetime_limit(
    pool: PgPool,
) {
    let (db, actor, user, kind) = fixture(&pool).await;
    let item = db
        .put_redemption_product(actor, product(kind, Uuid::now_v7()))
        .await
        .unwrap();
    sqlx::query("ALTER TABLE outbox_events ADD CONSTRAINT fail_redemption_event CHECK(event_type<>'entitlement.changed')").execute(&pool).await.unwrap();
    assert!(
        db.redeem_points(user, item.id, item.revision, "outbox-failure")
            .await
            .is_err()
    );
    assert_eq!(
        db.get_membership_account(user)
            .await
            .unwrap()
            .unwrap()
            .points_balance,
        100
    );
    assert!(
        db.list_redemptions(user, None, 20)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM user_standard_entitlements")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    sqlx::query("ALTER TABLE outbox_events DROP CONSTRAINT fail_redemption_event")
        .execute(&pool)
        .await
        .unwrap();
    db.redeem_points(user, item.id, item.revision, "outbox-failure")
        .await
        .unwrap();
    sqlx::query("UPDATE user_standard_entitlements SET starts_at=CURRENT_TIMESTAMP-INTERVAL '10 days',ends_at=CURRENT_TIMESTAMP-INTERVAL '1 day' WHERE user_id=$1").bind(user).execute(&pool).await.unwrap();
    assert!(matches!(
        db.redeem_points(user, item.id, item.revision, "over-limit")
            .await,
        Err(RedemptionError::LimitReached)
    ));
}
