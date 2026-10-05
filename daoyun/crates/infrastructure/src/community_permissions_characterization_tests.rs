use super::*;
use sqlx::PgPool;
use time::Duration;

// 固定时刻直接复验生产事务授权函数，不复制权限计算算法。
const EFFECTIVE_UNIX: i64 = 1_800_000_000;

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn v3_quota_ten_and_twenty_resolves_to_twenty_not_thirty(pool: PgPool) {
    let (database, user_id, effective_at) = subject(&pool).await;
    sqlx::query(
        "INSERT INTO community_group_memberships
         (id, user_id, group_id, membership_kind, source, reason, starts_at, idempotency_key)
         SELECT $1, $2, id, 'additional', 'test.fixture', 'V3 quota characterization', $3, 'v3-quota'
         FROM community_groups WHERE internal_key = 'established_member'",
    )
    .bind(Uuid::now_v7()).bind(user_id).bind(effective_at - Duration::days(1))
    .execute(&pool).await.expect("additional group must insert");
    let snapshot = database
        .community_access_snapshot(user_id, effective_at)
        .await
        .unwrap();
    assert_eq!(snapshot.quotas["topic.create.daily"], 20);
    let mut transaction = pool.begin().await.unwrap();
    assert_eq!(
        community_quota_limit_with_executor(
            &mut transaction,
            user_id,
            "topic.create.daily",
            effective_at
        )
        .await
        .unwrap(),
        20
    );
    assert!(matches!(
        authorize_community_action_with_executor(
            &mut transaction,
            user_id,
            "topic.create",
            Some(("topic.create.daily", 21)),
            None,
            effective_at
        )
        .await,
        Err(CommunityActionError::QuotaExceeded)
    ));
    authorize_community_action_with_executor(
        &mut transaction,
        user_id,
        "topic.create",
        Some(("topic.create.daily", 20)),
        None,
        effective_at,
    )
    .await
    .unwrap();
    assert!(matches!(
        authorize_community_action_with_executor(
            &mut transaction,
            user_id,
            "topic.create",
            Some(("topic.create.daily", 1)),
            None,
            effective_at
        )
        .await,
        Err(CommunityActionError::QuotaExceeded)
    ));
    transaction.commit().await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT used FROM community_quota_usage WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        20
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn v3_entitlement_allows_without_base_allow_and_expires_at_equal_time(pool: PgPool) {
    let (database, user_id, ends_at) = subject(&pool).await;
    sqlx::query("DELETE FROM community_group_permissions WHERE permission_key = 'topic.create'")
        .execute(&pool)
        .await
        .unwrap();
    entitlement(&pool, user_id, ends_at).await;
    let before = ends_at - Duration::seconds(1);
    let active = database
        .community_access_snapshot(user_id, before)
        .await
        .unwrap();
    assert!(active.permission_keys.contains("topic.create"));
    assert_eq!(active.entitlement_sources.len(), 1);
    assert!(
        active
            .sources
            .iter()
            .all(|source| !source.permission_keys.contains("topic.create"))
    );
    let mut transaction = pool.begin().await.unwrap();
    verify_community_action_with_executor(&mut transaction, user_id, "topic.create", before)
        .await
        .expect("entitlement must independently allow the real action");
    assert!(matches!(
        verify_community_action_with_executor(&mut transaction, user_id, "topic.create", ends_at)
            .await,
        Err(CommunityActionError::PermissionDenied)
    ));
    assert!(matches!(
        verify_community_action_with_executor(
            &mut transaction,
            user_id,
            "topic.create",
            ends_at + Duration::seconds(1)
        )
        .await,
        Err(CommunityActionError::PermissionDenied)
    ));
    transaction.commit().await.unwrap();
    let expired = database
        .community_access_snapshot(user_id, ends_at)
        .await
        .unwrap();
    assert!(!expired.permission_keys.contains("topic.create"));
    assert!(expired.entitlement_sources.is_empty());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM community_quota_usage WHERE user_id = $1"
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn v3_zero_and_missing_quota_deny_consumption_without_creating_usage(pool: PgPool) {
    let (_, user_id, effective_at) = subject(&pool).await;
    sqlx::query("UPDATE community_group_quota_rules SET quota_value = 0 WHERE quota_key = 'topic.create.daily'")
        .execute(&pool).await.unwrap();
    let mut transaction = pool.begin().await.unwrap();
    for quota in ["topic.create.daily", "content.external_link.daily"] {
        assert_eq!(
            community_quota_limit_with_executor(&mut transaction, user_id, quota, effective_at)
                .await
                .unwrap(),
            0
        );
        assert!(matches!(
            authorize_community_action_with_executor(
                &mut transaction,
                user_id,
                "topic.create",
                Some((quota, 1)),
                None,
                effective_at
            )
            .await,
            Err(CommunityActionError::QuotaExceeded)
        ));
    }
    transaction.commit().await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM community_quota_usage WHERE user_id = $1"
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
}

async fn subject(pool: &PgPool) -> (Database, Uuid, OffsetDateTime) {
    let user_id = Uuid::now_v7();
    let effective_at = OffsetDateTime::from_unix_timestamp(EFFECTIVE_UNIX).unwrap();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
        VALUES ($1, 'v3_subject', 'v3_subject@example.test', 'V3 subject', 'active')",
    )
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE community_group_memberships SET starts_at = $2 WHERE user_id = $1")
        .bind(user_id)
        .bind(effective_at - Duration::days(1))
        .execute(pool)
        .await
        .unwrap();
    (Database::from_pool(pool.clone()), user_id, effective_at)
}

async fn entitlement(pool: &PgPool, user_id: Uuid, ends_at: OffsetDateTime) {
    let type_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO standard_entitlement_types (id, internal_key, display_name)
        VALUES ($1, 'v3_topic_access', 'V3 topic access')",
    )
    .bind(type_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO user_standard_entitlements
        (id, user_id, entitlement_type_id, entitlement_key, type_version, permission_snapshot,
         quota_snapshot, source, reason, starts_at, ends_at, idempotency_key, granted_by)
        VALUES ($1, $2, $3, 'v3_topic_access', 1, ARRAY['topic.create']::varchar[],
        jsonb_build_object('topic.create.daily', 20), 'test_fixture', 'V3 entitlement characterization',
        $4, $5, 'v3-entitlement', $2)")
        .bind(Uuid::now_v7()).bind(user_id).bind(type_id)
        .bind(ends_at - Duration::days(1)).bind(ends_at).execute(pool).await.unwrap();
}
