use infrastructure::MIGRATOR;
use sqlx::PgPool;
use uuid::Uuid;

const PREVIOUS_MIGRATION_VERSION: i64 = 202608130001;

#[sqlx::test(migrations = false)]
async fn membership_v2_migration_creates_unbounded_dynamic_levels_and_rolls_back(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");

    for table in [
        "membership_levels",
        "experience_accounts",
        "experience_ledger_entries",
    ] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("membership v2 table lookup must succeed");
        assert!(exists, "{table} must exist after migrations");
    }

    let default_level_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM membership_levels WHERE level_order BETWEEN 1 AND 20",
    )
    .fetch_one(&pool)
    .await
    .expect("default levels must be queryable");
    assert_eq!(default_level_count, 20);

    sqlx::query(
        "INSERT INTO membership_levels (
             id, internal_key, level_order, display_name, required_experience, status
         ) VALUES ($1, 'community_legend', 21, '社区传奇', 120000, 'draft')",
    )
    .bind(Uuid::now_v7())
    .execute(&pool)
    .await
    .expect("level order must not have a technical upper bound");

    MIGRATOR
        .undo(&pool, PREVIOUS_MIGRATION_VERSION)
        .await
        .expect("membership v2 migration must roll back");

    for table in [
        "experience_ledger_entries",
        "experience_accounts",
        "membership_levels",
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
        .expect("membership v2 migration must apply again");
}

#[sqlx::test(migrations = false)]
async fn membership_v2_migration_backfills_experience_without_changing_points(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");
    MIGRATOR
        .undo(&pool, PREVIOUS_MIGRATION_VERSION)
        .await
        .expect("membership v2 migration must roll back for fixture setup");

    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'exp_backfill', 'exp_backfill@example.com', '经验回填', 'active')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("user fixture must insert");
    sqlx::query(
        "INSERT INTO membership_accounts (
             user_id, points_balance, lifetime_points, level_key, revision
         ) VALUES ($1, 320, 750, 'lv_3', 4)",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("membership fixture must insert");

    MIGRATOR
        .run(&pool)
        .await
        .expect("membership v2 migration must apply to existing accounts");

    let (experience, internal_key, points_balance) = sqlx::query_as::<_, (i64, String, i64)>(
        "SELECT experience.experience, level.internal_key, points.points_balance
         FROM experience_accounts AS experience
         JOIN membership_levels AS level ON level.id = experience.current_level_id
         JOIN membership_accounts AS points ON points.user_id = experience.user_id
         WHERE experience.user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("backfilled experience account must be queryable");

    assert_eq!(experience, 750);
    assert_eq!(internal_key, "lv_3");
    assert_eq!(points_balance, 320);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn membership_v2_migration_initializes_experience_for_new_users(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, 'new_experience', 'new_experience@example.com', '新成长账户', 'active')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("user fixture must insert");

    let (experience, internal_key, revision) = sqlx::query_as::<_, (i64, String, i64)>(
        "SELECT account.experience, level.internal_key, account.revision
         FROM experience_accounts AS account
         JOIN membership_levels AS level ON level.id = account.current_level_id
         WHERE account.user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("new user must receive an experience account");

    assert_eq!(experience, 0);
    assert_eq!(internal_key, "lv_1");
    assert_eq!(revision, 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn published_membership_level_thresholds_must_be_strictly_increasing(pool: PgPool) {
    let conflicting = sqlx::query(
        "INSERT INTO membership_levels (
             id, internal_key, level_order, display_name, required_experience,
             status, published_at
         ) VALUES ($1, 'conflicting_threshold', 21, '冲突等级', 100,
                   'published', now())",
    )
    .bind(Uuid::now_v7())
    .execute(&pool)
    .await;

    assert!(
        conflicting.is_err(),
        "published thresholds must increase with level order"
    );
}
