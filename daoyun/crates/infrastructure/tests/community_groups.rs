use std::collections::{BTreeMap, BTreeSet};

use infrastructure::{
    CommunityGroupMutationError, CommunityMembershipMutationError, CreateCommunityGroupRecord,
    Database, GrantCommunityMembershipRecord, UpdateCommunityGroupRecord,
};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn community_group_configuration_is_revisioned_and_rejects_governance_permissions(
    pool: PgPool,
) {
    let database = Database::from_pool(pool.clone());
    let actor_id = insert_user(&pool, "group_config_actor").await;
    grant_super_admin(&pool, actor_id).await;
    let invalid = database
        .create_community_group(
            actor_id,
            CreateCommunityGroupRecord {
                internal_key: "invalid_governance".to_owned(),
                display_name: "越权组".to_owned(),
                description: String::new(),
                is_base: false,
                display_order: 50,
                permission_keys: BTreeSet::from(["moderation.topic".to_owned()]),
                quotas: BTreeMap::new(),
            },
        )
        .await;
    assert!(matches!(
        invalid,
        Err(CommunityGroupMutationError::InvalidInput)
    ));

    let created = database
        .create_community_group(
            actor_id,
            CreateCommunityGroupRecord {
                internal_key: "event_member".to_owned(),
                display_name: "活动成员".to_owned(),
                description: "限时活动用户组".to_owned(),
                is_base: false,
                display_order: 50,
                permission_keys: BTreeSet::from([
                    "topic.lottery.join".to_owned(),
                    "attachment.download".to_owned(),
                ]),
                quotas: BTreeMap::from([("attachment.download.bytes.daily".to_owned(), 10_000)]),
            },
        )
        .await
        .expect("community group must create");
    assert_eq!(created.revision, 1);
    assert_eq!(created.status, "active");

    let updated = database
        .update_community_group(
            actor_id,
            UpdateCommunityGroupRecord {
                id: created.id,
                expected_revision: 1,
                display_name: "活动伙伴".to_owned(),
                description: "已更新".to_owned(),
                status: "disabled".to_owned(),
                display_order: 51,
                permission_keys: BTreeSet::from(["attachment.download".to_owned()]),
                quotas: BTreeMap::from([("attachment.download.bytes.daily".to_owned(), 20_000)]),
            },
        )
        .await
        .expect("community group must update");
    assert_eq!(updated.revision, 2);
    assert_eq!(updated.status, "disabled");
    assert_eq!(updated.quotas["attachment.download.bytes.daily"], 20_000);

    let stale = database
        .update_community_group(
            actor_id,
            UpdateCommunityGroupRecord {
                id: created.id,
                expected_revision: 1,
                display_name: "陈旧写入".to_owned(),
                description: String::new(),
                status: "active".to_owned(),
                display_order: 52,
                permission_keys: BTreeSet::new(),
                quotas: BTreeMap::new(),
            },
        )
        .await;
    assert!(matches!(stale, Err(CommunityGroupMutationError::Conflict)));

    let groups = database
        .list_community_group_configurations()
        .await
        .expect("community groups must list");
    assert_eq!(groups.len(), 6);
    assert_eq!(
        groups.last().map(|group| group.internal_key.as_str()),
        Some("event_member")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn community_memberships_are_timed_idempotent_revocable_and_audited(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let actor_id = insert_user(&pool, "group_actor").await;
    grant_super_admin(&pool, actor_id).await;
    let user_id = insert_user(&pool, "group_subject").await;
    let established_group_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM community_groups WHERE internal_key = 'established_member'",
    )
    .fetch_one(&pool)
    .await
    .expect("established member group must exist");
    let now = OffsetDateTime::now_utc();
    let input = GrantCommunityMembershipRecord {
        user_id,
        group_id: established_group_id,
        membership_kind: "additional".to_owned(),
        source: "admin.manual".to_owned(),
        source_reference_id: None,
        reason: "Verified community participation".to_owned(),
        starts_at: now,
        ends_at: Some(now + Duration::days(30)),
        idempotency_key: "community-grant-1".to_owned(),
    };

    let granted = database
        .grant_community_membership(actor_id, input.clone())
        .await
        .expect("additional group membership must be granted");
    assert!(!granted.replayed);
    assert_eq!(granted.membership.revision, 1);
    assert_eq!(granted.membership.group_key, "established_member");
    assert_eq!(granted.membership.granted_by, Some(actor_id));

    let replay = database
        .grant_community_membership(actor_id, input)
        .await
        .expect("same grant must replay");
    assert!(replay.replayed);
    assert_eq!(replay.membership.id, granted.membership.id);

    let active = database
        .list_active_community_memberships(user_id, now + Duration::days(1))
        .await
        .expect("active memberships must be queryable");
    assert_eq!(active.len(), 2);
    assert_eq!(active[0].group_key, "registered_member");
    assert_eq!(active[1].group_key, "established_member");

    let revoked = database
        .revoke_community_membership(
            actor_id,
            granted.membership.id,
            1,
            "No longer eligible",
            "community-revoke-1",
        )
        .await
        .expect("membership must be revocable");
    assert!(!revoked.replayed);
    assert_eq!(revoked.membership.revision, 2);
    assert!(revoked.membership.revoked_at.is_some());

    let revoke_replay = database
        .revoke_community_membership(
            actor_id,
            granted.membership.id,
            1,
            "No longer eligible",
            "community-revoke-1",
        )
        .await
        .expect("same revocation must replay");
    assert!(revoke_replay.replayed);
    assert_eq!(revoke_replay.membership.revision, 2);

    let actions = sqlx::query_scalar::<_, String>(
        "SELECT action FROM admin_audit_log
         WHERE resource_type = 'community_group_membership'
         ORDER BY created_at, id",
    )
    .fetch_all(&pool)
    .await
    .expect("community membership audit must be queryable");
    assert_eq!(
        actions,
        ["community.membership.grant", "community.membership.revoke"]
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn community_membership_conflicts_and_expiry_are_deterministic(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let actor_id = insert_user(&pool, "group_conflict_actor").await;
    grant_super_admin(&pool, actor_id).await;
    let user_id = insert_user(&pool, "group_conflict_subject").await;
    let group_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM community_groups WHERE internal_key = 'partner'",
    )
    .fetch_one(&pool)
    .await
    .expect("partner group must exist");
    let now = OffsetDateTime::now_utc();
    let input = GrantCommunityMembershipRecord {
        user_id,
        group_id,
        membership_kind: "additional".to_owned(),
        source: "admin.manual".to_owned(),
        source_reference_id: None,
        reason: "Time limited partnership".to_owned(),
        starts_at: now - Duration::days(2),
        ends_at: Some(now - Duration::days(1)),
        idempotency_key: "expired-partner-1".to_owned(),
    };
    database
        .grant_community_membership(actor_id, input.clone())
        .await
        .expect("historical membership must be recordable");

    let active = database
        .list_active_community_memberships(user_id, now)
        .await
        .expect("active memberships must be queryable");
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].group_key, "registered_member");

    let conflict = database
        .grant_community_membership(
            actor_id,
            GrantCommunityMembershipRecord {
                reason: "Different idempotent content".to_owned(),
                ..input
            },
        )
        .await;
    assert!(matches!(
        conflict,
        Err(CommunityMembershipMutationError::IdempotencyConflict)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn base_membership_scheduling_returns_domain_conflict_before_unique_index(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let actor_id = insert_user(&pool, "base_schedule_actor").await;
    grant_super_admin(&pool, actor_id).await;
    let user_id = insert_user(&pool, "base_schedule_subject").await;
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "UPDATE community_group_memberships
         SET ends_at = $2
         WHERE user_id = $1 AND membership_kind = 'base' AND revoked_at IS NULL",
    )
    .bind(user_id)
    .bind(now + Duration::days(1))
    .execute(&pool)
    .await
    .expect("existing base membership must become time bounded");

    let next_base = database
        .create_community_group(
            actor_id,
            CreateCommunityGroupRecord {
                internal_key: "scheduled_base".to_owned(),
                display_name: "预排基础组".to_owned(),
                description: "用于验证基础组不支持同时保留两条未撤销记录".to_owned(),
                is_base: true,
                display_order: 60,
                permission_keys: BTreeSet::from(["board.read".to_owned(), "topic.read".to_owned()]),
                quotas: BTreeMap::new(),
            },
        )
        .await
        .expect("secondary base group fixture must create");

    let result = database
        .grant_community_membership(
            actor_id,
            GrantCommunityMembershipRecord {
                user_id,
                group_id: next_base.id,
                membership_kind: "base".to_owned(),
                source: "admin.manual".to_owned(),
                source_reference_id: None,
                reason: "Scheduled base replacement".to_owned(),
                starts_at: now + Duration::days(2),
                ends_at: None,
                idempotency_key: "scheduled-base-1".to_owned(),
            },
        )
        .await;
    assert!(matches!(
        result,
        Err(CommunityMembershipMutationError::ActiveMembershipConflict)
    ));
}

async fn grant_super_admin(pool: &PgPool, user_id: Uuid) {
    let role_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system)
         VALUES ($1, 'test_community_admin', 'Test community admin', 'instance', FALSE)",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test admin role must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions
         WHERE permission_key IN ('community.groups.write', 'community.memberships.write')",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test admin permissions must insert");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id)
         VALUES ($1, $2, $3, $2, NULL)",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test admin role must be assigned");
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
