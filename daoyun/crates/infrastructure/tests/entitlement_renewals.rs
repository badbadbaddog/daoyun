use infrastructure::{
    Database, GrantStandardEntitlementRecord, PutStandardEntitlementTypeRecord,
    RenewStandardEntitlementRecord, RevokeStandardEntitlementRecord,
    StandardEntitlementMutationError,
};
use sqlx::{PgPool, types::Uuid};
use std::collections::BTreeMap;
use time::{Duration, OffsetDateTime};

async fn fixture(pool: &PgPool) -> (Database, Uuid, GrantStandardEntitlementRecord) {
    let actor = Uuid::now_v7();
    let user = Uuid::now_v7();
    for (id, name) in [(actor, "renew_admin"), (user, "renew_member")] {
        sqlx::query("INSERT INTO users (id,username,email,display_name,status) VALUES ($1,$2,$2||'@example.com',$2,'active')")
            .bind(id).bind(name).execute(pool).await.unwrap();
    }
    let role = Uuid::now_v7();
    sqlx::query("INSERT INTO roles (id,key,name,scope,is_system) VALUES ($1,'renew_admin','Renew admin','instance',FALSE)")
        .bind(role).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO role_permissions (role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key IN ('entitlements.types.write','entitlements.grants.write')")
        .bind(role).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO role_assignments (id,user_id,role_id,assigned_by,scope_id) VALUES ($1,$2,$3,$2,NULL)")
        .bind(Uuid::now_v7()).bind(actor).bind(role).execute(pool).await.unwrap();
    let db = Database::from_pool(pool.clone());
    let kind = db
        .put_standard_entitlement_type(
            actor,
            PutStandardEntitlementTypeRecord {
                internal_key: "renew_vip".into(),
                display_name: "续期会员".into(),
                permission_keys: vec!["topic.poll.create".into()],
                quotas: BTreeMap::from([("attachment.file.bytes".into(), 1024)]),
                expected_revision: None,
            },
        )
        .await
        .unwrap();
    let now = OffsetDateTime::now_utc();
    (
        db,
        actor,
        GrantStandardEntitlementRecord {
            user_id: user,
            entitlement_type_id: kind.id,
            actor_id: actor,
            source: "admin".into(),
            source_reference_id: None,
            reason: "原授予原因".into(),
            starts_at: now,
            ends_at: Some(now + Duration::days(1)),
            idempotency_key: "original-grant".into(),
        },
    )
}
fn command(
    grant: &infrastructure::StandardEntitlementRecord,
    actor: Uuid,
) -> RenewStandardEntitlementRecord {
    RenewStandardEntitlementRecord {
        user_id: grant.user_id,
        entitlement_id: grant.id,
        actor_id: actor,
        expected_revision: grant.revision,
        ends_at: grant.ends_at.unwrap() + Duration::days(1),
        reason: "延长一天".into(),
        idempotency_key: "renew-once".into(),
        request_id: Uuid::now_v7(),
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn renewal_preserves_snapshot_and_original_grant_replay_after_revocation(pool: PgPool) {
    let (db, actor, original) = fixture(&pool).await;
    let grant = db
        .grant_standard_entitlement(original.clone())
        .await
        .unwrap()
        .entitlement;
    db.put_standard_entitlement_type(
        actor,
        PutStandardEntitlementTypeRecord {
            internal_key: "renew_vip".into(),
            display_name: "新会员".into(),
            permission_keys: vec!["board.read".into()],
            quotas: BTreeMap::new(),
            expected_revision: Some(1),
        },
    )
    .await
    .unwrap();
    let input = command(&grant, actor);
    let renewed = db.renew_standard_entitlement(input.clone()).await.unwrap();
    assert!(!renewed.replayed);
    assert_eq!(renewed.entitlement.id, grant.id);
    assert_eq!(renewed.entitlement.type_version, 1);
    assert_eq!(
        renewed.entitlement.permission_snapshot,
        grant.permission_snapshot
    );
    assert_eq!(renewed.entitlement.quota_snapshot, grant.quota_snapshot);
    assert_eq!(renewed.entitlement.starts_at, grant.starts_at);
    assert_eq!(renewed.entitlement.reason, grant.reason);
    assert_eq!(renewed.receipt.revision, 2);
    assert_eq!(renewed.receipt.request_id, input.request_id);
    assert_eq!(renewed.receipt.previous_ends_at, grant.ends_at.unwrap());
    let replay_grant = db.grant_standard_entitlement(original).await.unwrap();
    assert!(replay_grant.replayed);
    assert_eq!(
        replay_grant.entitlement.ends_at,
        renewed.entitlement.ends_at
    );
    let revoked = db
        .revoke_standard_entitlement(RevokeStandardEntitlementRecord {
            entitlement_id: grant.id,
            actor_id: actor,
            expected_revision: 2,
            reason: "撤销".into(),
            idempotency_key: "revoke-after-renew".into(),
        })
        .await
        .unwrap();
    let mut retry = input.clone();
    retry.request_id = Uuid::now_v7();
    let replay = db.renew_standard_entitlement(retry).await.unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.receipt, renewed.receipt);
    assert_eq!(replay.entitlement, revoked.entitlement);
    let receipt = db
        .get_standard_entitlement_renewal_request(grant.user_id, &input.idempotency_key)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(receipt, renewed.receipt);
    assert!(
        db.get_standard_entitlement_renewal_request(actor, &input.idempotency_key)
            .await
            .unwrap()
            .is_none()
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM admin_audit_log WHERE action='standard_entitlement.renew'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox_events WHERE event_type='standard_entitlement.renewed'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn renewal_rejects_wrong_uid_shortening_expired_permanent_and_revoked_state(pool: PgPool) {
    let (db, actor, original) = fixture(&pool).await;
    let grant = db
        .grant_standard_entitlement(original.clone())
        .await
        .unwrap()
        .entitlement;
    let mut input = command(&grant, actor);
    input.user_id = actor;
    assert!(matches!(
        db.renew_standard_entitlement(input).await,
        Err(StandardEntitlementMutationError::EntitlementNotFound)
    ));
    let mut input = command(&grant, actor);
    input.ends_at = grant.ends_at.unwrap();
    assert!(matches!(
        db.renew_standard_entitlement(input).await,
        Err(StandardEntitlementMutationError::InvalidInput)
    ));
    let mut input = command(&grant, actor);
    input.expected_revision = 99;
    assert!(matches!(
        db.renew_standard_entitlement(input).await,
        Err(StandardEntitlementMutationError::RevisionConflict)
    ));
    for (key, starts, ends) in [
        (
            "expired",
            OffsetDateTime::now_utc() - Duration::days(2),
            Some(OffsetDateTime::now_utc() - Duration::days(1)),
        ),
        ("permanent", OffsetDateTime::now_utc(), None),
    ] {
        let mut request = original.clone();
        request.idempotency_key = key.into();
        request.starts_at = starts;
        request.ends_at = ends;
        let target = db
            .grant_standard_entitlement(request)
            .await
            .unwrap()
            .entitlement;
        let input = RenewStandardEntitlementRecord {
            user_id: target.user_id,
            entitlement_id: target.id,
            actor_id: actor,
            expected_revision: target.revision,
            ends_at: OffsetDateTime::now_utc() + Duration::days(3),
            reason: "不可续期".into(),
            idempotency_key: format!("renew-{key}"),
            request_id: Uuid::now_v7(),
        };
        assert!(matches!(
            db.renew_standard_entitlement(input).await,
            Err(StandardEntitlementMutationError::RevisionConflict)
        ));
    }
    db.revoke_standard_entitlement(RevokeStandardEntitlementRecord {
        entitlement_id: grant.id,
        actor_id: actor,
        expected_revision: 1,
        reason: "撤销".into(),
        idempotency_key: "revoked".into(),
    })
    .await
    .unwrap();
    let mut input = command(&grant, actor);
    input.expected_revision = 2;
    assert!(matches!(
        db.renew_standard_entitlement(input).await,
        Err(StandardEntitlementMutationError::RevisionConflict)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_identical_renewals_commit_once_and_changed_input_conflicts(pool: PgPool) {
    let (db, actor, original) = fixture(&pool).await;
    let grant = db
        .grant_standard_entitlement(original)
        .await
        .unwrap()
        .entitlement;
    let input = command(&grant, actor);
    let (a, b) = tokio::join!(
        db.renew_standard_entitlement(input.clone()),
        db.renew_standard_entitlement(input.clone())
    );
    let a = a.unwrap();
    let b = b.unwrap();
    assert_ne!(a.replayed, b.replayed);
    assert_eq!(a.receipt, b.receipt);
    let mut changed = input.clone();
    changed.reason = "不同原因".into();
    assert!(matches!(
        db.renew_standard_entitlement(changed).await,
        Err(StandardEntitlementMutationError::IdempotencyConflict)
    ));
    let mut changed = input.clone();
    changed.expected_revision = 2;
    assert!(matches!(
        db.renew_standard_entitlement(changed).await,
        Err(StandardEntitlementMutationError::IdempotencyConflict)
    ));
    let mut changed = input.clone();
    changed.idempotency_key = "new-key-old-revision".into();
    assert!(matches!(
        db.renew_standard_entitlement(changed).await,
        Err(StandardEntitlementMutationError::RevisionConflict)
    ));
    sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
        .bind(actor)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.renew_standard_entitlement(input).await,
        Err(StandardEntitlementMutationError::Forbidden)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn renewal_audit_failure_rolls_back_entitlement_receipt_and_outbox(pool: PgPool) {
    let (db, actor, original) = fixture(&pool).await;
    let grant = db
        .grant_standard_entitlement(original)
        .await
        .unwrap()
        .entitlement;
    sqlx::raw_sql("CREATE FUNCTION reject_renewal_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='standard_entitlement.renew' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_renewal BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_renewal_audit();").execute(&pool).await.unwrap();
    assert!(
        db.renew_standard_entitlement(command(&grant, actor))
            .await
            .is_err()
    );
    assert!(
        db.get_standard_entitlement_renewal_request(grant.user_id, "renew-once")
            .await
            .unwrap()
            .is_none()
    );
    let current = db
        .list_standard_entitlements_for_admin(grant.user_id)
        .await
        .unwrap();
    assert_eq!(current[0], grant);
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox_events WHERE event_type='standard_entitlement.renewed'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn renewal_and_revocation_compete_for_one_revision(pool: PgPool) {
    let (db, actor, original) = fixture(&pool).await;
    let grant = db
        .grant_standard_entitlement(original)
        .await
        .unwrap()
        .entitlement;
    let (renewed, revoked) = tokio::join!(
        db.renew_standard_entitlement(command(&grant, actor)),
        db.revoke_standard_entitlement(RevokeStandardEntitlementRecord {
            entitlement_id: grant.id,
            actor_id: actor,
            expected_revision: 1,
            reason: "竞争撤销".into(),
            idempotency_key: "racing-revoke".into(),
        })
    );
    assert_ne!(renewed.is_ok(), revoked.is_ok());
    assert!(
        matches!(
            renewed,
            Err(StandardEntitlementMutationError::RevisionConflict)
        ) || matches!(
            revoked,
            Err(StandardEntitlementMutationError::RevisionConflict)
        )
    );
    let current = db
        .list_standard_entitlements_for_admin(grant.user_id)
        .await
        .unwrap();
    assert_eq!(current[0].revision, 2);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM admin_audit_log WHERE action IN ('standard_entitlement.renew','standard_entitlement.revoke')")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);
}

async fn wait_for_row_lock(pool: &PgPool) {
    for _ in 0..200 {
        let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%' AND pid<>pg_backend_pid())")
            .fetch_one(pool).await.unwrap();
        if waiting {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("renewal did not reach the expected row lock");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn renewal_serializes_permission_revocation_and_rejects_the_next_replay(pool: PgPool) {
    let (db, actor, original) = fixture(&pool).await;
    let grant = db
        .grant_standard_entitlement(original)
        .await
        .unwrap()
        .entitlement;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(grant.user_id)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let input = command(&grant, actor);
    let renewed_db = db.clone();
    let renewed_input = input.clone();
    let renewal =
        tokio::spawn(async move { renewed_db.renew_standard_entitlement(renewed_input).await });
    wait_for_row_lock(&pool).await;
    let revoke_pool = pool.clone();
    let mut permission_revoke = tokio::spawn(async move {
        sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
            .bind(actor)
            .execute(&revoke_pool)
            .await
    });
    // The permission engine holds SHARE locks through commit, so revocation must wait.
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            &mut permission_revoke
        )
        .await
        .is_err()
    );
    blocker.commit().await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(5), renewal)
            .await
            .unwrap()
            .unwrap()
            .is_ok()
    );
    permission_revoke.await.unwrap().unwrap();
    assert!(matches!(
        db.renew_standard_entitlement(input).await,
        Err(StandardEntitlementMutationError::Forbidden)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn renewal_uses_actual_time_after_lock_wait_instead_of_transaction_start(pool: PgPool) {
    let (db, actor, mut original) = fixture(&pool).await;
    original.ends_at = Some(OffsetDateTime::now_utc() + Duration::seconds(2));
    let grant = db
        .grant_standard_entitlement(original)
        .await
        .unwrap()
        .entitlement;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(grant.user_id)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let input = command(&grant, actor);
    let task = tokio::spawn(async move { db.renew_standard_entitlement(input).await });
    wait_for_row_lock(&pool).await;
    sqlx::query("SELECT pg_sleep(2.1)")
        .execute(&pool)
        .await
        .unwrap();
    blocker.commit().await.unwrap();
    assert!(matches!(
        task.await.unwrap(),
        Err(StandardEntitlementMutationError::RevisionConflict)
    ));
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM standard_entitlement_renewal_receipts")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn scheduled_finite_entitlement_renews_without_changing_its_start(pool: PgPool) {
    let (db, actor, mut original) = fixture(&pool).await;
    original.starts_at = OffsetDateTime::now_utc() + Duration::days(1);
    original.ends_at = Some(original.starts_at + Duration::days(1));
    let grant = db
        .grant_standard_entitlement(original)
        .await
        .unwrap()
        .entitlement;
    let renewed = db
        .renew_standard_entitlement(command(&grant, actor))
        .await
        .unwrap();
    assert_eq!(renewed.entitlement.starts_at, grant.starts_at);
    assert_eq!(renewed.entitlement.type_version, grant.type_version);
    assert_eq!(renewed.receipt.starts_at, grant.starts_at);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn original_end_metadata_covers_all_producers_and_receipts_are_immutable(pool: PgPool) {
    let (db, actor, original) = fixture(&pool).await;
    let grant = db
        .grant_standard_entitlement(original)
        .await
        .unwrap()
        .entitlement;
    for source in ["plugin:test", "points_redemption"] {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO user_standard_entitlements (id,user_id,entitlement_type_id,entitlement_key,type_version,permission_snapshot,quota_snapshot,source,reason,starts_at,ends_at,granted_by,idempotency_key) SELECT $1,user_id,entitlement_type_id,entitlement_key,type_version,permission_snapshot,quota_snapshot,$2,reason,starts_at,ends_at,granted_by,$2 FROM user_standard_entitlements WHERE id=$3")
            .bind(id).bind(source).bind(grant.id).execute(&pool).await.unwrap();
        let original_end: Option<OffsetDateTime> = sqlx::query_scalar(
            "SELECT granted_ends_at FROM user_standard_entitlements WHERE id=$1",
        )
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(original_end, grant.ends_at);
    }
    let renewed = db
        .renew_standard_entitlement(command(&grant, actor))
        .await
        .unwrap();
    assert!(
        sqlx::query(
            "UPDATE standard_entitlement_renewal_receipts SET reason='changed' WHERE id=$1"
        )
        .bind(renewed.receipt.id)
        .execute(&pool)
        .await
        .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM standard_entitlement_renewal_receipts WHERE id=$1")
            .bind(renewed.receipt.id)
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE user_standard_entitlements SET granted_ends_at=ends_at WHERE id=$1")
            .bind(grant.id)
            .execute(&pool)
            .await
            .is_err()
    );
    assert_eq!(
        db.get_standard_entitlement_renewal_request(grant.user_id, "renew-once")
            .await
            .unwrap()
            .unwrap(),
        renewed.receipt
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn migration_down_up_preserves_actual_end_and_audit_but_cannot_restore_original_receipts(
    pool: PgPool,
) {
    let (db, actor, original) = fixture(&pool).await;
    let grant = db
        .grant_standard_entitlement(original)
        .await
        .unwrap()
        .entitlement;
    let renewed = db
        .renew_standard_entitlement(command(&grant, actor))
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610070001_add_entitlement_renewals.down.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        db.list_standard_entitlements_for_admin(grant.user_id)
            .await
            .unwrap()[0],
        renewed.entitlement
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM admin_audit_log WHERE action='standard_entitlement.renew'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox_events WHERE event_type='standard_entitlement.renewed'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610070001_add_entitlement_renewals.up.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        db.get_standard_entitlement_renewal_request(grant.user_id, "renew-once")
            .await
            .unwrap()
            .is_none()
    );
    let original_end: Option<OffsetDateTime> =
        sqlx::query_scalar("SELECT granted_ends_at FROM user_standard_entitlements WHERE id=$1")
            .bind(grant.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(original_end, renewed.entitlement.ends_at);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn renewal_outbox_failure_rolls_back_the_receipt_audit_and_entitlement(pool: PgPool) {
    let (db, actor, original) = fixture(&pool).await;
    let grant = db
        .grant_standard_entitlement(original)
        .await
        .unwrap()
        .entitlement;
    sqlx::raw_sql("CREATE FUNCTION reject_renewal_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='entitlement.changed' AND NEW.dedupe_key LIKE 'renewal:%' THEN RAISE EXCEPTION 'outbox unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_renewal_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_renewal_event();").execute(&pool).await.unwrap();
    assert!(
        db.renew_standard_entitlement(command(&grant, actor))
            .await
            .is_err()
    );
    assert!(
        db.get_standard_entitlement_renewal_request(grant.user_id, "renew-once")
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        db.list_standard_entitlements_for_admin(grant.user_id)
            .await
            .unwrap()[0],
        grant
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM admin_audit_log WHERE action='standard_entitlement.renew'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM outbox_events WHERE dedupe_key LIKE 'renewal:%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}
