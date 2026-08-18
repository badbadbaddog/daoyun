use std::collections::BTreeMap;

use infrastructure::{
    ContentAccessPolicyMutationError, ContentAccessPolicySubjectRecord, Database,
    GrantStandardEntitlementRecord, PublicTopicFilters, PutContentAccessPolicyRecord,
    PutStandardEntitlementTypeRecord,
};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn content_access_policy_defaults_public_and_matches_authenticated_or_group_subjects(
    pool: PgPool,
) {
    let viewer_id = insert_user(&pool, "policy_viewer").await;
    grant_super_admin(&pool, viewer_id).await;
    let outsider_id = insert_user(&pool, "policy_outsider").await;
    let board_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO boards (id, slug, name, description, icon, tone, position, visibility)
         VALUES ($1, 'policy-board', 'Policy board', '', 'messages-square', 'blue', 90, 'public')",
    )
    .bind(board_id)
    .execute(&pool)
    .await
    .expect("board fixture must insert");
    let topic_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO topics (
            id, board_id, author_id, title, excerpt, content, status, published_at
         ) VALUES ($1, $2, $3, 'Policy topic', '', 'Policy body', 'published', CURRENT_TIMESTAMP)",
    )
    .bind(topic_id)
    .bind(board_id)
    .bind(viewer_id)
    .execute(&pool)
    .await
    .expect("topic fixture must insert");

    assert!(can_access(&pool, topic_id, None).await);

    let board_policy_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO content_access_policies (id, target_type, target_id, operator)
         VALUES ($1, 'board', $2, 'any_of')",
    )
    .bind(board_policy_id)
    .bind(board_id)
    .execute(&pool)
    .await
    .expect("board policy fixture must insert");
    sqlx::query(
        "INSERT INTO content_access_policy_subjects (policy_id, subject_type)
         VALUES ($1, 'authenticated')",
    )
    .bind(board_policy_id)
    .execute(&pool)
    .await
    .expect("board authenticated subject must insert");

    assert!(!can_access(&pool, topic_id, None).await);
    assert!(can_access(&pool, topic_id, Some(viewer_id)).await);
    let database = Database::from_pool(pool.clone());
    assert!(
        database
            .list_public_boards(None, None, 10)
            .await
            .expect("anonymous board list must resolve")
            .is_empty()
    );
    assert_eq!(
        database
            .list_public_boards(Some(viewer_id), None, 10)
            .await
            .expect("authenticated board list must resolve")
            .iter()
            .map(|board| board.id)
            .collect::<Vec<_>>(),
        [board_id]
    );
    sqlx::query("DELETE FROM content_access_policies WHERE id = $1")
        .bind(board_policy_id)
        .execute(&pool)
        .await
        .expect("board policy fixture must delete");
    assert!(can_access(&pool, topic_id, None).await);

    let policy_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO content_access_policies (id, target_type, target_id, operator)
         VALUES ($1, 'topic', $2, 'any_of')",
    )
    .bind(policy_id)
    .bind(topic_id)
    .execute(&pool)
    .await
    .expect("policy fixture must insert");
    sqlx::query(
        "INSERT INTO content_access_policy_subjects (policy_id, subject_type)
         VALUES ($1, 'authenticated')",
    )
    .bind(policy_id)
    .execute(&pool)
    .await
    .expect("authenticated subject must insert");

    assert!(!can_access(&pool, topic_id, None).await);
    assert!(can_access(&pool, topic_id, Some(viewer_id)).await);

    sqlx::query("DELETE FROM content_access_policy_subjects WHERE policy_id = $1")
        .bind(policy_id)
        .execute(&pool)
        .await
        .expect("authenticated subject must delete");
    let group_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM community_groups WHERE internal_key = 'established_member'",
    )
    .fetch_one(&pool)
    .await
    .expect("established member group must exist");
    sqlx::query(
        "INSERT INTO content_access_policy_subjects (
            policy_id, subject_type, community_group_id
         ) VALUES ($1, 'community_group', $2)",
    )
    .bind(policy_id)
    .bind(group_id)
    .execute(&pool)
    .await
    .expect("group subject must insert");
    sqlx::query(
        "INSERT INTO community_group_memberships (
            id, user_id, group_id, membership_kind, source, reason, starts_at,
            idempotency_key
         ) VALUES ($1, $2, $3, 'additional', 'test.fixture', 'Policy access',
                   CURRENT_TIMESTAMP - INTERVAL '1 minute', 'policy-viewer-group')",
    )
    .bind(Uuid::now_v7())
    .bind(viewer_id)
    .bind(group_id)
    .execute(&pool)
    .await
    .expect("group membership must insert");

    assert!(can_access(&pool, topic_id, Some(viewer_id)).await);
    assert!(!can_access(&pool, topic_id, Some(outsider_id)).await);

    let visible = database
        .list_public_topics(
            &PublicTopicFilters {
                viewer_user_id: Some(viewer_id),
                ..PublicTopicFilters::default()
            },
            None,
            10,
        )
        .await
        .expect("authorized topic list must resolve");
    assert_eq!(
        visible.iter().map(|topic| topic.id).collect::<Vec<_>>(),
        [topic_id]
    );
    let hidden = database
        .list_public_topics(
            &PublicTopicFilters {
                viewer_user_id: Some(outsider_id),
                ..PublicTopicFilters::default()
            },
            None,
            10,
        )
        .await
        .expect("unauthorized topic list must resolve");
    assert!(hidden.is_empty());

    sqlx::query("DELETE FROM content_access_policy_subjects WHERE policy_id = $1")
        .bind(policy_id)
        .execute(&pool)
        .await
        .expect("group subject must delete");
    sqlx::query(
        "INSERT INTO content_access_policy_subjects (policy_id, subject_type, subject_key)
         VALUES ($1, 'entitlement', 'gold_vip')",
    )
    .bind(policy_id)
    .execute(&pool)
    .await
    .expect("entitlement subject must insert");
    let entitlement_type = database
        .put_standard_entitlement_type(
            viewer_id,
            PutStandardEntitlementTypeRecord {
                internal_key: "gold_vip".to_owned(),
                display_name: "Gold VIP".to_owned(),
                permission_keys: Vec::new(),
                quotas: BTreeMap::new(),
                expected_revision: None,
            },
        )
        .await
        .expect("entitlement type must insert");
    let now = OffsetDateTime::now_utc();
    database
        .grant_standard_entitlement(GrantStandardEntitlementRecord {
            user_id: viewer_id,
            entitlement_type_id: entitlement_type.id,
            actor_id: viewer_id,
            source: "test:fixture".to_owned(),
            source_reference_id: None,
            reason: "Policy access".to_owned(),
            starts_at: now - Duration::minutes(1),
            ends_at: Some(now + Duration::minutes(1)),
            idempotency_key: "policy-viewer-entitlement".to_owned(),
        })
        .await
        .expect("entitlement grant must insert");

    assert!(can_access(&pool, topic_id, Some(viewer_id)).await);
    assert!(!can_access(&pool, topic_id, Some(outsider_id)).await);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn content_access_policy_rejects_unknown_entitlement_subject(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let actor_id = insert_user(&pool, "policy_admin").await;
    grant_super_admin(&pool, actor_id).await;
    let board_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO boards (id, slug, name, description, icon, tone, position, visibility)
         VALUES ($1, 'policy-validation-board', 'Policy validation board', '', 'messages-square', 'blue', 91, 'public')",
    )
    .bind(board_id)
    .execute(&pool)
    .await
    .expect("board fixture must insert");

    let result = database
        .put_content_access_policy(
            actor_id,
            PutContentAccessPolicyRecord {
                target_type: "board".to_owned(),
                target_id: board_id,
                operator: "any_of".to_owned(),
                subjects: vec![ContentAccessPolicySubjectRecord {
                    subject_type: "entitlement".to_owned(),
                    community_group_id: None,
                    subject_key: Some("missing_entitlement".to_owned()),
                }],
                expected_revision: None,
            },
        )
        .await;
    assert!(matches!(
        result,
        Err(ContentAccessPolicyMutationError::SubjectUnavailable)
    ));
}

async fn grant_super_admin(pool: &PgPool, user_id: Uuid) {
    let role_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system)
         VALUES ($1, 'test_policy_admin', 'Test policy admin', 'instance', FALSE)",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test policy role must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions
         WHERE permission_key IN (
             'content.access_policies.write',
             'entitlements.types.write',
             'entitlements.grants.write'
         )",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test policy permissions must insert");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id)
         VALUES ($1, $2, $3, $2, NULL)",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await
    .expect("test policy role must be assigned");
}

async fn can_access(pool: &PgPool, topic_id: Uuid, viewer_id: Option<Uuid>) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT daoyun_can_access_content('topic', $1, $2, CURRENT_TIMESTAMP)",
    )
    .bind(topic_id)
    .bind(viewer_id)
    .fetch_one(pool)
    .await
    .expect("content access must resolve")
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
