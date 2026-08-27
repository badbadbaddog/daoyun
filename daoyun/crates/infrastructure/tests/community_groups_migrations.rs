use infrastructure::MIGRATOR;
use sqlx::PgPool;
use uuid::Uuid;

const PREVIOUS_MIGRATION_VERSION: i64 = 202608150001;

#[sqlx::test(migrations = false)]
async fn community_group_migration_creates_separate_core_tables_and_rolls_back(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");

    for table in [
        "community_groups",
        "community_group_memberships",
        "community_group_permissions",
        "community_group_quota_rules",
    ] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("community group table lookup must succeed");
        assert!(exists, "{table} must exist after migrations");
    }

    let keys = sqlx::query_scalar::<_, String>(
        "SELECT internal_key FROM community_groups ORDER BY display_order, id",
    )
    .fetch_all(&pool)
    .await
    .expect("default community groups must be queryable");
    assert_eq!(
        keys,
        [
            "registered_member",
            "established_member",
            "verified_author",
            "internal_member",
            "partner",
        ]
    );

    MIGRATOR
        .undo(&pool, PREVIOUS_MIGRATION_VERSION)
        .await
        .expect("community group migration must roll back");
    for table in [
        "community_group_quota_rules",
        "community_group_permissions",
        "community_group_memberships",
        "community_groups",
    ] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("rolled-back table lookup must succeed");
        assert!(!exists, "{table} must be removed by rollback");
    }

    MIGRATOR
        .run(&pool)
        .await
        .expect("community group migration must apply again");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn new_users_receive_a_base_community_membership_without_rbac_assignment(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'community_member', 'community-member@example.com', '社区成员', 'active')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("user fixture must insert");

    let (group_key, membership_kind, source, revision) =
        sqlx::query_as::<_, (String, String, String, i64)>(
            "SELECT groups.internal_key, memberships.membership_kind,
                    memberships.source, memberships.revision
             FROM community_group_memberships AS memberships
             JOIN community_groups AS groups ON groups.id = memberships.group_id
             WHERE memberships.user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("new user must receive a base community membership");
    assert_eq!(group_key, "registered_member");
    assert_eq!(membership_kind, "base");
    assert_eq!(source, "account_creation");
    assert_eq!(revision, 1);

    let rbac_assignments =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM role_assignments WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("RBAC assignment count must be queryable");
    assert_eq!(rbac_assignments, 0);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn new_users_receive_the_configured_default_group_without_migrating_existing_users(
    pool: PgPool,
) {
    let existing_user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'existing_default_member', 'existing-default@example.com', '现有成员', 'active')",
    )
    .bind(existing_user_id)
    .execute(&pool)
    .await
    .expect("existing user fixture must insert");

    let replacement_group_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO community_groups (
             id, internal_key, display_name, description, is_base, is_default, status, display_order
         ) VALUES ($1, 'new_member', '新会员', '之后注册用户的基础组。', true, false, 'active', 6)",
    )
    .bind(replacement_group_id)
    .execute(&pool)
    .await
    .expect("replacement base group must insert");

    sqlx::query("UPDATE community_groups SET is_default = false WHERE is_default")
        .execute(&pool)
        .await
        .expect("existing default group must clear");
    sqlx::query("UPDATE community_groups SET is_default = true WHERE id = $1")
        .bind(replacement_group_id)
        .execute(&pool)
        .await
        .expect("replacement group must become default");

    let new_user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'new_default_member', 'new-default@example.com', '新成员', 'active')",
    )
    .bind(new_user_id)
    .execute(&pool)
    .await
    .expect("new user fixture must insert");

    let existing_group_key = sqlx::query_scalar::<_, String>(
        "SELECT groups.internal_key
         FROM community_group_memberships AS memberships
         JOIN community_groups AS groups ON groups.id = memberships.group_id
         WHERE memberships.user_id = $1 AND memberships.revoked_at IS NULL",
    )
    .bind(existing_user_id)
    .fetch_one(&pool)
    .await
    .expect("existing membership must remain queryable");
    assert_eq!(existing_group_key, "registered_member");

    let new_group_key = sqlx::query_scalar::<_, String>(
        "SELECT groups.internal_key
         FROM community_group_memberships AS memberships
         JOIN community_groups AS groups ON groups.id = memberships.group_id
         WHERE memberships.user_id = $1 AND memberships.revoked_at IS NULL",
    )
    .bind(new_user_id)
    .fetch_one(&pool)
    .await
    .expect("new membership must be queryable");
    assert_eq!(new_group_key, "new_member");
}
