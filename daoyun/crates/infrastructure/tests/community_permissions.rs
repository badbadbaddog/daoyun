use std::collections::{BTreeMap, BTreeSet};

use infrastructure::{
    CommunityGroupPolicy, Database, GrantCommunityMembershipRecord, merge_community_group_policies,
};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

#[test]
fn pure_permission_merge_is_independent_of_group_order() {
    let user_id = Uuid::now_v7();
    let effective_at = OffsetDateTime::now_utc();
    let first = CommunityGroupPolicy {
        membership_id: Uuid::now_v7(),
        group_id: Uuid::now_v7(),
        group_key: "first".to_owned(),
        permission_keys: BTreeSet::from(["topic.create".to_owned()]),
        quotas: BTreeMap::from([("topic.create.daily".to_owned(), 10)]),
    };
    let second = CommunityGroupPolicy {
        membership_id: Uuid::now_v7(),
        group_id: Uuid::now_v7(),
        group_key: "second".to_owned(),
        permission_keys: BTreeSet::from(["message.send".to_owned()]),
        quotas: BTreeMap::from([("topic.create.daily".to_owned(), 30)]),
    };

    let forward = merge_community_group_policies(
        user_id,
        effective_at,
        "active",
        vec![first.clone(), second.clone()],
    );
    let reverse =
        merge_community_group_policies(user_id, effective_at, "active", vec![second, first]);
    assert_eq!(forward, reverse);
    assert_eq!(forward.quotas["topic.create.daily"], 30);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn community_permission_snapshot_unions_allows_and_maximizes_quotas(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let actor_id = insert_user(&pool, "permission_actor").await;
    let user_id = insert_user(&pool, "permission_subject").await;
    let now = OffsetDateTime::now_utc();
    grant_group(
        &database,
        &pool,
        actor_id,
        user_id,
        "established_member",
        "permission-established",
        now,
        None,
    )
    .await;
    grant_group(
        &database,
        &pool,
        actor_id,
        user_id,
        "verified_author",
        "permission-author",
        now,
        None,
    )
    .await;

    let snapshot = database
        .community_access_snapshot(user_id, now + Duration::seconds(1))
        .await
        .expect("community access snapshot must resolve");
    assert_eq!(snapshot.account_status, "active");
    assert!(!snapshot.denied);
    for permission in [
        "board.read",
        "topic.create",
        "message.send",
        "attachment.upload",
        "content.external_link.use",
        "topic.poll.create",
    ] {
        assert!(
            snapshot.permission_keys.contains(permission),
            "{permission} must be allowed by at least one active group"
        );
    }
    assert_eq!(snapshot.quotas["topic.create.daily"], 50);
    assert_eq!(snapshot.quotas["reply.create.daily"], 100);
    assert_eq!(snapshot.sources.len(), 3);
    assert_eq!(snapshot.sources[0].group_key, "established_member");
    assert_eq!(snapshot.sources[1].group_key, "registered_member");
    assert_eq!(snapshot.sources[2].group_key, "verified_author");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn account_status_and_expiry_take_priority_over_group_allows(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let actor_id = insert_user(&pool, "status_actor").await;
    let user_id = insert_user(&pool, "status_subject").await;
    let now = OffsetDateTime::now_utc();
    grant_group(
        &database,
        &pool,
        actor_id,
        user_id,
        "established_member",
        "expired-established",
        now - Duration::days(2),
        Some(now - Duration::days(1)),
    )
    .await;

    let active = database
        .community_access_snapshot(user_id, now)
        .await
        .expect("active snapshot must resolve");
    assert_eq!(active.quotas["attachment.upload.daily"], 5);
    assert_eq!(active.sources.len(), 1);

    sqlx::query("UPDATE users SET status = 'restricted' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("user must become restricted");
    let restricted = database
        .community_access_snapshot(user_id, now)
        .await
        .expect("restricted snapshot must resolve");
    assert!(!restricted.denied);
    assert!(restricted.permission_keys.contains("board.read"));
    assert!(!restricted.permission_keys.contains("topic.create"));
    assert!(restricted.blocked_permission_keys.contains("topic.create"));

    sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("user must become suspended");
    let suspended = database
        .community_access_snapshot(user_id, now)
        .await
        .expect("suspended snapshot must resolve");
    assert!(suspended.denied);
    assert_eq!(
        suspended.denial_reason.as_deref(),
        Some("account.suspended")
    );
    assert!(suspended.permission_keys.is_empty());
    assert!(suspended.quotas.is_empty());
}

#[allow(clippy::too_many_arguments)]
async fn grant_group(
    database: &Database,
    pool: &PgPool,
    actor_id: Uuid,
    user_id: Uuid,
    group_key: &str,
    idempotency_key: &str,
    starts_at: OffsetDateTime,
    ends_at: Option<OffsetDateTime>,
) {
    let group_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM community_groups WHERE internal_key = $1")
            .bind(group_key)
            .fetch_one(pool)
            .await
            .expect("community group must exist");
    database
        .grant_community_membership(
            actor_id,
            GrantCommunityMembershipRecord {
                user_id,
                group_id,
                membership_kind: "additional".to_owned(),
                source: "test.fixture".to_owned(),
                source_reference_id: None,
                reason: format!("Grant {group_key} for permission evaluation"),
                starts_at,
                ends_at,
                idempotency_key: idempotency_key.to_owned(),
            },
        )
        .await
        .expect("community membership must be granted");
}

async fn insert_user(pool: &PgPool, username: &str) -> Uuid {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, $2, $3, $4, 'active')",
    )
    .bind(user_id)
    .bind(username)
    .bind(format!("{username}@example.com"))
    .bind(username)
    .execute(pool)
    .await
    .expect("user fixture must insert");
    user_id
}
