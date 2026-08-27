use infrastructure::{
    Database, InstallationAdministrator, NewRegistrationEmailChallenge,
    UpdateSmtpConfigurationRecord,
};
use sqlx::{PgPool, types::Uuid};
use time::{Duration, OffsetDateTime};

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn smtp_configuration_preserves_or_clears_the_encrypted_password_and_audits(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let actor_id = initialize(&database).await;
    let ciphertext = vec![7_u8; 40];

    let saved = database
        .update_smtp_configuration(
            actor_id,
            UpdateSmtpConfigurationRecord {
                host: "smtp.example.com".to_owned(),
                port: 587,
                username: Some("mailer".to_owned()),
                password_ciphertext: Some(Some(ciphertext.clone())),
                tls_mode: "starttls".to_owned(),
                from_email: "noreply@example.com".to_owned(),
                from_name: "DaoYun".to_owned(),
                enabled: true,
                registration_email_verification_enabled: true,
            },
        )
        .await
        .expect("SMTP configuration must save");
    assert_eq!(saved.password_ciphertext, Some(ciphertext.clone()));

    let preserved = database
        .update_smtp_configuration(
            actor_id,
            UpdateSmtpConfigurationRecord {
                host: "smtp.example.com".to_owned(),
                port: 465,
                username: Some("mailer".to_owned()),
                password_ciphertext: None,
                tls_mode: "tls".to_owned(),
                from_email: "noreply@example.com".to_owned(),
                from_name: "DaoYun".to_owned(),
                enabled: true,
                registration_email_verification_enabled: false,
            },
        )
        .await
        .expect("omitted password must preserve the stored secret");
    assert_eq!(preserved.password_ciphertext, Some(ciphertext));

    let cleared = database
        .update_smtp_configuration(
            actor_id,
            UpdateSmtpConfigurationRecord {
                password_ciphertext: Some(None),
                ..UpdateSmtpConfigurationRecord::from_record(&preserved)
            },
        )
        .await
        .expect("explicit password clearing must succeed");
    assert!(cleared.password_ciphertext.is_none());

    let audit_summary = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT summary FROM admin_audit_log WHERE action = 'smtp.update' ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .expect("SMTP update audit must exist");
    assert_eq!(audit_summary["host"], "smtp.example.com");
    assert!(!audit_summary.to_string().contains("mailer"));
    assert!(!audit_summary.to_string().contains("password"));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn registration_email_challenge_enqueues_only_its_identifier_and_enforces_cooldown(
    pool: PgPool,
) {
    let database = Database::from_pool(pool.clone());
    let now = OffsetDateTime::now_utc();
    let challenge_id = Uuid::now_v7();

    database
        .create_registration_email_challenge(NewRegistrationEmailChallenge {
            id: challenge_id,
            email: "member@example.com".to_owned(),
            code_hash: "$argon2id$v=19$fixture".to_owned(),
            code_ciphertext: vec![9_u8; 40],
            expires_at: now + Duration::minutes(10),
            resend_after: now + Duration::minutes(1),
            enqueue_delivery: true,
        })
        .await
        .expect("first challenge must be created");

    let event = sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT event_type, payload FROM outbox_events WHERE aggregate_id = $1",
    )
    .bind(challenge_id)
    .fetch_one(&pool)
    .await
    .expect("challenge must enqueue a delivery event");
    assert_eq!(event.0, "email.registration_verification_requested");
    assert_eq!(event.1, serde_json::json!({"challenge_id": challenge_id}));
    assert!(!event.1.to_string().contains("member@example.com"));
    assert!(!event.1.to_string().contains("123456"));

    let second = database
        .create_registration_email_challenge(NewRegistrationEmailChallenge {
            id: Uuid::now_v7(),
            email: "member@example.com".to_owned(),
            code_hash: "$argon2id$v=19$fixture".to_owned(),
            code_ciphertext: vec![8_u8; 40],
            expires_at: now + Duration::minutes(10),
            resend_after: now + Duration::minutes(1),
            enqueue_delivery: true,
        })
        .await;
    assert!(matches!(
        second,
        Err(infrastructure::RegistrationEmailChallengeError::RateLimited { .. })
    ));
}

async fn initialize(database: &Database) -> Uuid {
    let id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "Owner".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("fixture must initialize");
    id
}
