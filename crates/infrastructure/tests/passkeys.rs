use infrastructure::{
    Database, NewPasskeyChallengeRecord, NewPasskeyCredentialRecord, NewUserRecord,
    PasskeyChallengeKind,
};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn passkey_credentials_are_unique_and_challenges_are_single_use(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = Uuid::now_v7();
    let other_user_id = Uuid::now_v7();
    register_user(
        &database,
        user_id,
        "passkey_owner",
        "passkey-owner@example.com",
    )
    .await;
    register_user(
        &database,
        other_user_id,
        "passkey_other",
        "passkey-other@example.com",
    )
    .await;

    let credential_id = vec![7; 32];
    database
        .create_passkey_credential(NewPasskeyCredentialRecord {
            id: Uuid::now_v7(),
            user_id,
            credential_id: credential_id.clone(),
            credential: json!({ "id": "Bw", "counter": 0 }),
        })
        .await
        .expect("first credential must be stored");
    assert!(
        database
            .create_passkey_credential(NewPasskeyCredentialRecord {
                id: Uuid::now_v7(),
                user_id: other_user_id,
                credential_id,
                credential: json!({ "id": "Bw", "counter": 0 }),
            })
            .await
            .is_err()
    );

    let session_id = Uuid::now_v7();
    database
        .create_session(
            session_id,
            user_id,
            vec![1; 32],
            vec![2; 32],
            "测试设备".to_owned(),
        )
        .await
        .expect("session must be stored");
    let challenge_id = Uuid::now_v7();
    database
        .create_passkey_challenge(NewPasskeyChallengeRecord {
            id: challenge_id,
            user_id: Some(user_id),
            session_id: Some(session_id),
            kind: PasskeyChallengeKind::Registration,
            state: json!({ "challenge": "opaque" }),
        })
        .await
        .expect("registration challenge must be stored");
    assert!(
        database
            .consume_passkey_challenge(
                challenge_id,
                Some(other_user_id),
                Some(session_id),
                PasskeyChallengeKind::Registration,
            )
            .await
            .expect("wrong challenge binding must complete")
            .is_none()
    );
    assert!(
        database
            .consume_passkey_challenge(
                challenge_id,
                Some(user_id),
                Some(session_id),
                PasskeyChallengeKind::Registration,
            )
            .await
            .expect("challenge lookup must complete")
            .is_some()
    );
    assert!(
        database
            .consume_passkey_challenge(
                challenge_id,
                Some(user_id),
                Some(session_id),
                PasskeyChallengeKind::Registration,
            )
            .await
            .expect("challenge replay must complete")
            .is_none()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn passkey_counter_updates_support_the_full_u32_range(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = Uuid::now_v7();
    register_user(
        &database,
        user_id,
        "counter_owner",
        "counter-owner@example.com",
    )
    .await;
    let credential_id = vec![8; 32];
    database
        .create_passkey_credential(NewPasskeyCredentialRecord {
            id: Uuid::now_v7(),
            user_id,
            credential_id: credential_id.clone(),
            credential: json!({ "counter": 2_147_483_647_u32 }),
        })
        .await
        .expect("credential must be stored");

    assert!(
        database
            .update_passkey_counter(&credential_id, 2_147_483_647, u32::MAX)
            .await
            .expect("counter update must complete")
    );
    let counter = sqlx::query_scalar::<_, i64>(
        "SELECT (credential->>'counter')::bigint
         FROM passkey_credentials
         WHERE credential_id = $1",
    )
    .bind(&credential_id)
    .fetch_one(&pool)
    .await
    .expect("counter must be queryable");
    assert_eq!(counter, i64::from(u32::MAX));
}

async fn mark_initialized(pool: &PgPool) {
    sqlx::query(
        "UPDATE system_state
         SET is_initialized = TRUE,
             initialized_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE singleton",
    )
    .execute(pool)
    .await
    .expect("test instance must initialize");
}

async fn register_user(database: &Database, id: Uuid, username: &str, email: &str) {
    database
        .register_user(NewUserRecord {
            id,
            username: username.to_owned(),
            email: email.to_owned(),
            display_name: username.to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("test user must register");
}
