use infrastructure::{AppendExperienceError, Database};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn points_and_experience_are_independent(pool: PgPool) {
    let (database, user_id) = create_experience_fixture(&pool, "exp_independent").await;

    database
        .append_points_ledger(user_id, 500, "admin.compensation", Some("points-only"))
        .await
        .expect("points grant must succeed");

    let experience = database
        .get_experience_account(user_id)
        .await
        .expect("experience account must exist");
    assert_eq!(experience.experience, 0);
    assert_eq!(experience.level_order, 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn experience_ledger_is_idempotent_and_uses_dynamic_level_thresholds(pool: PgPool) {
    let (database, user_id) = create_experience_fixture(&pool, "exp_upgrade").await;
    let source_id = Uuid::now_v7();

    let granted = database
        .append_experience(
            user_id,
            120,
            "topic.featured",
            Some(source_id),
            "featured-reward",
            None,
        )
        .await
        .expect("experience grant must succeed");
    assert_eq!(granted.account.experience, 120);
    assert_eq!(granted.account.level_order, 2);
    assert_eq!(granted.account.internal_key, "lv_2");
    assert!(!granted.replayed);

    let replay = database
        .append_experience(
            user_id,
            120,
            "topic.featured",
            Some(source_id),
            "featured-reward",
            None,
        )
        .await
        .expect("same experience event must replay");
    assert_eq!(replay.entry_id, granted.entry_id);
    assert_eq!(replay.account.revision, granted.account.revision);
    assert!(replay.replayed);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM outbox_events
             WHERE event_type = 'experience.changed' AND aggregate_id = $1",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("experience event count must be queryable"),
        1
    );

    let conflict = database
        .append_experience(
            user_id,
            121,
            "topic.featured",
            Some(source_id),
            "featured-reward",
            None,
        )
        .await
        .expect_err("same key with different input must conflict");
    assert!(matches!(
        conflict,
        AppendExperienceError::IdempotencyConflict
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn experience_reversal_appends_a_new_entry_without_automatic_downgrade(pool: PgPool) {
    let (database, user_id) = create_experience_fixture(&pool, "exp_reversal").await;

    let granted = database
        .append_experience(
            user_id,
            120,
            "reply.accepted",
            Some(Uuid::now_v7()),
            "accepted-reward",
            None,
        )
        .await
        .expect("experience grant must succeed");

    let reversed = database
        .append_experience(
            user_id,
            -120,
            "moderation.reward_reversed",
            None,
            "accepted-reversal",
            Some(granted.entry_id),
        )
        .await
        .expect("experience reversal must succeed");

    assert_eq!(reversed.account.experience, 0);
    assert_eq!(reversed.account.level_order, 2);
    assert!(!reversed.replayed);

    let duplicate_reversal = database
        .append_experience(
            user_id,
            -120,
            "moderation.reward_reversed",
            None,
            "second-reversal",
            Some(granted.entry_id),
        )
        .await
        .expect_err("one ledger entry can only be reversed once");
    assert!(matches!(
        duplicate_reversal,
        AppendExperienceError::ReversalConflict
    ));
}

async fn create_experience_fixture(pool: &PgPool, username: &str) -> (Database, Uuid) {
    let user_id = Uuid::now_v7();
    let email = format!("{username}@example.com");
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, $2, $3, $2, 'active')",
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
        .expect("points account fixture must insert");
    (Database::from_pool(pool.clone()), user_id)
}
