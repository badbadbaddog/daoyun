use std::collections::BTreeMap;

use infrastructure::{
    Database, GrantStandardEntitlementRecord, PutStandardEntitlementTypeRecord,
    RevokeStandardEntitlementRecord, StandardEntitlementMutationError,
};
use sqlx::{PgPool, types::Uuid};
use time::{Duration, OffsetDateTime};

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn standard_entitlements_are_versioned_snapshotted_merged_and_expiring(pool: PgPool) {
    let actor = fixture_id(1);
    let first_user = fixture_id(2);
    let second_user = fixture_id(3);
    insert_user(&pool, actor, "admin").await;
    grant_super_admin(&pool, actor).await;
    insert_user(&pool, first_user, "first").await;
    insert_user(&pool, second_user, "second").await;
    let database = Database::from_pool(pool.clone());
    let now = OffsetDateTime::now_utc();

    let entitlement_type = database
        .put_standard_entitlement_type(
            actor,
            PutStandardEntitlementTypeRecord {
                internal_key: "gold_vip".to_owned(),
                display_name: "Gold VIP".to_owned(),
                permission_keys: vec!["topic.poll.create".to_owned()],
                quotas: BTreeMap::from([("attachment.file.bytes".to_owned(), 20_971_520)]),
                expected_revision: None,
            },
        )
        .await
        .expect("entitlement type must be created");
    assert_eq!(entitlement_type.current_version, 1);

    let governance_benefit = database
        .put_standard_entitlement_type(
            actor,
            PutStandardEntitlementTypeRecord {
                internal_key: "invalid_governance".to_owned(),
                display_name: "Invalid".to_owned(),
                permission_keys: vec!["moderation.topic.pin".to_owned()],
                quotas: BTreeMap::new(),
                expected_revision: None,
            },
        )
        .await
        .expect_err("standard entitlements must reject governance capabilities");
    assert!(matches!(
        governance_benefit,
        StandardEntitlementMutationError::InvalidBenefits
    ));

    let first_grant = database
        .grant_standard_entitlement(GrantStandardEntitlementRecord {
            user_id: first_user,
            entitlement_type_id: entitlement_type.id,
            actor_id: actor,
            source: "plugin:vip".to_owned(),
            source_reference_id: Some("order-1001".to_owned()),
            reason: "purchase".to_owned(),
            starts_at: now,
            ends_at: Some(now + Duration::days(30)),
            idempotency_key: "grant-gold-first".to_owned(),
        })
        .await
        .expect("first entitlement grant must succeed");
    assert_eq!(first_grant.entitlement.type_version, 1);
    assert_eq!(
        first_grant.entitlement.quota_snapshot["attachment.file.bytes"],
        20_971_520
    );
    let replay = database
        .grant_standard_entitlement(GrantStandardEntitlementRecord {
            user_id: first_user,
            entitlement_type_id: entitlement_type.id,
            actor_id: actor,
            source: "plugin:vip".to_owned(),
            source_reference_id: Some("order-1001".to_owned()),
            reason: "purchase".to_owned(),
            starts_at: now,
            ends_at: Some(now + Duration::days(30)),
            idempotency_key: "grant-gold-first".to_owned(),
        })
        .await
        .expect("identical grant must replay");
    assert!(replay.replayed);
    assert_eq!(replay.entitlement.id, first_grant.entitlement.id);

    let version_two = database
        .put_standard_entitlement_type(
            actor,
            PutStandardEntitlementTypeRecord {
                internal_key: "gold_vip".to_owned(),
                display_name: "Gold VIP".to_owned(),
                permission_keys: vec!["topic.poll.create".to_owned()],
                quotas: BTreeMap::from([("attachment.file.bytes".to_owned(), 31_457_280)]),
                expected_revision: Some(1),
            },
        )
        .await
        .expect("entitlement type update must publish a new version");
    assert_eq!(version_two.current_version, 2);
    let second_grant = database
        .grant_standard_entitlement(GrantStandardEntitlementRecord {
            user_id: second_user,
            entitlement_type_id: entitlement_type.id,
            actor_id: actor,
            source: "admin".to_owned(),
            source_reference_id: None,
            reason: "manual grant".to_owned(),
            starts_at: now,
            ends_at: Some(now + Duration::days(30)),
            idempotency_key: "grant-gold-second".to_owned(),
        })
        .await
        .expect("second entitlement grant must succeed");
    assert_eq!(second_grant.entitlement.type_version, 2);
    assert_eq!(
        second_grant.entitlement.quota_snapshot["attachment.file.bytes"],
        31_457_280
    );

    let first_active = database
        .list_active_standard_entitlements(first_user, now + Duration::seconds(1))
        .await
        .expect("active entitlements must load");
    assert_eq!(first_active.len(), 1);
    assert_eq!(first_active[0].type_version, 1);
    let snapshot = database
        .community_access_snapshot(first_user, now + Duration::seconds(1))
        .await
        .expect("community access snapshot must merge entitlements");
    assert!(snapshot.permission_keys.contains("topic.poll.create"));
    assert_eq!(snapshot.quotas["attachment.file.bytes"], 20_971_520);
    assert!(
        database
            .list_active_standard_entitlements(first_user, now + Duration::days(30))
            .await
            .expect("expiration boundary must resolve")
            .is_empty()
    );

    let revoked = database
        .revoke_standard_entitlement(RevokeStandardEntitlementRecord {
            entitlement_id: first_grant.entitlement.id,
            actor_id: actor,
            expected_revision: 1,
            reason: "refund".to_owned(),
            idempotency_key: "revoke-gold-first".to_owned(),
        })
        .await
        .expect("entitlement revocation must succeed");
    assert!(!revoked.replayed);
    assert_eq!(revoked.entitlement.revision, 2);
    assert!(
        database
            .list_active_standard_entitlements(first_user, now + Duration::seconds(1))
            .await
            .expect("revoked entitlements must not be active")
            .is_empty()
    );
    let entitlement_events = sqlx::query_scalar::<_, String>(
        "SELECT payload->>'operation' FROM outbox_events
         WHERE event_type = 'entitlement.changed' AND aggregate_id = $1
         ORDER BY created_at, id",
    )
    .bind(first_user)
    .fetch_all(&pool)
    .await
    .expect("entitlement events must be queryable");
    assert_eq!(entitlement_events, vec!["granted", "revoked"]);
}

fn fixture_id(value: u128) -> Uuid {
    Uuid::from_u128(0x019f_c800_0000_7000_8000_0000_0000_0000 + value)
}

async fn grant_super_admin(pool: &PgPool, user_id: Uuid) {
    let role_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system)
         VALUES ($1, 'test_entitlement_admin', 'Test entitlement admin', 'instance', FALSE)",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test entitlement role must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions
         WHERE permission_key IN ('entitlements.types.write', 'entitlements.grants.write')",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test entitlement permissions must insert");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id)
         VALUES ($1, $2, $3, $2, NULL)",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await
    .expect("super admin role must be assigned");
}

async fn insert_user(pool: &PgPool, id: Uuid, username: &str) {
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, $2, $2 || '@example.com', $2, 'active')",
    )
    .bind(id)
    .bind(username)
    .execute(pool)
    .await
    .expect("user fixture must insert");
}
