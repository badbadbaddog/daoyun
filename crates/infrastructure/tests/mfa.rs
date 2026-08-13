use infrastructure::{Database, MIGRATOR, MfaRecoveryCodeRecord, NewMfaChallengeRecord};
use sqlx::{PgPool, Row};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn mfa_migration_applies_and_rolls_back(pool: PgPool) {
    MIGRATOR.run(&pool).await.expect("migrations must apply");
    for table in ["mfa_totp", "mfa_recovery_codes", "mfa_challenges"] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("table lookup must succeed");
        assert!(exists, "{table} must exist");
    }

    MIGRATOR
        .undo(&pool, 202608090001)
        .await
        .expect("mfa migration must roll back");
    let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass('mfa_totp') IS NOT NULL")
        .fetch_one(&pool)
        .await
        .expect("rolled-back table lookup must succeed");
    assert!(!exists);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn mfa_setup_enable_and_replay_state_are_atomic(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name) VALUES ($1, 'mfa_user', 'mfa@example.com', 'MFA User')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("user must exist");
    let database = Database::from_pool(pool.clone());
    let status = database
        .get_mfa_status(user_id)
        .await
        .expect("status query must succeed");
    assert!(!status.enabled);
    assert!(!status.setup_pending);
    assert_eq!(status.recovery_codes_remaining, 0);

    database
        .upsert_mfa_totp_setup(
            user_id,
            vec![1; 49],
            OffsetDateTime::now_utc() + Duration::minutes(10),
        )
        .await
        .expect("setup must persist");
    let pending = database
        .get_mfa_totp(user_id)
        .await
        .expect("totp query must succeed")
        .expect("pending setup must exist");
    assert!(!pending.enabled);
    assert!(pending.setup_expires_at.is_some());

    let codes = (0..10)
        .map(|index| (Uuid::now_v7(), format!("$argon2id$v=19$test-{index}")))
        .collect::<Vec<_>>();
    database
        .enable_mfa_totp(user_id, 42, &codes)
        .await
        .expect("enable must persist");
    let enabled = database
        .get_mfa_totp(user_id)
        .await
        .expect("totp query must succeed")
        .expect("enabled setup must exist");
    assert!(enabled.enabled);
    assert_eq!(enabled.last_used_step, Some(42));
    assert_eq!(
        database
            .get_mfa_status(user_id)
            .await
            .unwrap()
            .recovery_codes_remaining,
        10
    );

    assert!(
        !database
            .consume_mfa_totp_step(user_id, 42)
            .await
            .expect("replay check must succeed")
    );
    assert!(
        database
            .consume_mfa_totp_step(user_id, 43)
            .await
            .expect("next step must succeed")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn mfa_recovery_code_is_one_time(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name) VALUES ($1, 'recover_user', 'recover@example.com', 'Recovery User')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("user must exist");
    let database = Database::from_pool(pool.clone());
    database
        .upsert_mfa_totp_setup(
            user_id,
            vec![2; 49],
            OffsetDateTime::now_utc() + Duration::minutes(10),
        )
        .await
        .expect("setup must persist");
    let code_id = Uuid::now_v7();
    database
        .enable_mfa_totp(
            user_id,
            1,
            &[(code_id, "$argon2id$v=19$recovery".to_owned())],
        )
        .await
        .expect("enable must persist");
    let codes = database
        .list_unused_mfa_recovery_codes(user_id)
        .await
        .expect("codes must list");
    assert_eq!(codes.len(), 1);
    assert_eq!(codes[0].id, code_id);
    assert!(
        database
            .consume_mfa_recovery_code(user_id, code_id)
            .await
            .expect("first recovery use must succeed")
    );
    assert!(
        !database
            .consume_mfa_recovery_code(user_id, code_id)
            .await
            .expect("replay recovery use must be rejected")
    );
    assert!(
        database
            .list_unused_mfa_recovery_codes(user_id)
            .await
            .expect("codes must list")
            .is_empty()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn mfa_constraints_reject_invalid_challenges(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name) VALUES ($1, 'constraint_user', 'constraint@example.com', 'Constraint User')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("user must exist");
    let result = sqlx::query(
        "INSERT INTO mfa_challenges (id, user_id, device_label, browser_token_hash, expires_at)
         VALUES ($1, $2, 'browser', $3, CURRENT_TIMESTAMP + INTERVAL '5 minutes')",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(vec![0_u8; 31])
    .execute(&pool)
    .await;
    assert!(result.is_err());

    let row = sqlx::query("SELECT count(*)::bigint AS count FROM mfa_challenges")
        .fetch_one(&pool)
        .await
        .expect("count must query");
    assert_eq!(row.get::<i64, _>("count"), 0);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn mfa_challenge_is_bound_to_browser_hash_and_consumed_once(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name) VALUES ($1, 'challenge_user', 'challenge@example.com', 'Challenge User')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("user must exist");
    let database = Database::from_pool(pool);
    let challenge_id = Uuid::now_v7();
    let browser_hash = vec![7_u8; 32];
    database
        .create_mfa_challenge(NewMfaChallengeRecord {
            id: challenge_id,
            user_id,
            device_label: "browser".to_owned(),
            browser_token_hash: browser_hash.clone(),
            expires_at: OffsetDateTime::now_utc() + Duration::minutes(5),
        })
        .await
        .expect("challenge must persist");
    assert!(
        database
            .consume_mfa_challenge(challenge_id, vec![8_u8; 32])
            .await
            .expect("wrong browser hash must be handled")
            .is_none()
    );
    let consumed = database
        .consume_mfa_challenge(challenge_id, browser_hash)
        .await
        .expect("challenge consume must succeed")
        .expect("challenge must be available");
    assert_eq!(consumed.user_id, user_id);
    assert!(
        database
            .consume_mfa_challenge(challenge_id, vec![7_u8; 32])
            .await
            .expect("replay challenge must be handled")
            .is_none()
    );
}

#[allow(dead_code)]
fn _record_type_is_public(_: MfaRecoveryCodeRecord) {}
