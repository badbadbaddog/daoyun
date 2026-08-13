use infrastructure::{
    BindExternalIdentityError, ChangePasswordError, Database, ExternalIdentityError,
    NewExternalIdentityRecord, NewSessionRecord, NewUserRecord, RegisterUserError,
    SecurityAuditEvent, UnlinkExternalIdentityError,
};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn identity_registration_and_session_lifecycle_use_database_constraints(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let user_id = fixed_user_id();
    mark_initialized(&pool).await;

    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("first user must register");

    let login_record = database
        .find_login_user("owner")
        .await
        .expect("login lookup must work")
        .expect("registered user must be found");
    assert_eq!(login_record.id, user_id);
    assert_eq!(login_record.email, "owner@example.com");
    assert!(login_record.is_active);

    let token_hash = vec![7; 32];
    let csrf_hash = vec![9; 32];
    database
        .create_session(
            Uuid::now_v7(),
            user_id,
            token_hash.clone(),
            csrf_hash.clone(),
            "测试设备".to_owned(),
        )
        .await
        .expect("session must be created");

    let session = database
        .touch_session(&token_hash)
        .await
        .expect("session lookup must work")
        .expect("active session must be returned");
    assert_eq!(session.user.id, user_id);
    assert_eq!(session.csrf_token_hash, csrf_hash);

    assert!(
        database
            .revoke_session(&token_hash)
            .await
            .expect("session revoke must work")
    );
    assert!(
        database
            .touch_session(&token_hash)
            .await
            .expect("revoked session lookup must work")
            .is_none()
    );

    let active_sessions = sqlx::query("SELECT count(*) AS count FROM sessions WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("session count query must work")
        .get::<i64, _>("count");
    assert_eq!(active_sessions, 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn external_identity_lookup_uses_provider_subject_and_issuer_without_email_merging(
    pool: PgPool,
) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let local_user_id = fixed_user_id();
    let linked_user_id = Uuid::now_v7();
    for (id, username, email) in [
        (local_user_id, "local", "shared@example.com"),
        (linked_user_id, "linked", "linked@example.com"),
    ] {
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
            .expect("user must register");
    }
    database
        .insert_external_identity(NewExternalIdentityRecord {
            id: Uuid::now_v7(),
            user_id: linked_user_id,
            provider_key: "google".to_owned(),
            subject: "provider-subject".to_owned(),
            issuer: "https://accounts.example.com".to_owned(),
            email_snapshot: Some("shared@example.com".to_owned()),
            email_verified: Some(true),
        })
        .await
        .expect("external identity must bind");

    assert!(
        database
            .find_external_identity_user(
                "google",
                "provider-subject",
                "https://wrong.example.com",
                Some("shared@example.com"),
                Some(true),
            )
            .await
            .expect("issuer mismatch lookup must complete")
            .is_none()
    );
    let linked = database
        .find_external_identity_user(
            "google",
            "provider-subject",
            "https://accounts.example.com",
            Some("new-snapshot@example.com"),
            Some(false),
        )
        .await
        .expect("external identity lookup must complete")
        .expect("bound identity must resolve");
    assert_eq!(linked.user_id, linked_user_id);
    assert_ne!(linked.user_id, local_user_id);

    let snapshot = sqlx::query(
        "SELECT email_snapshot, email_verified, last_authenticated_at
         FROM external_identities
         WHERE id = $1",
    )
    .bind(linked.identity_id)
    .fetch_one(&pool)
    .await
    .expect("external identity snapshot must be queryable");
    assert_eq!(
        snapshot
            .get::<Option<String>, _>("email_snapshot")
            .as_deref(),
        Some("new-snapshot@example.com")
    );
    assert_eq!(
        snapshot.get::<Option<bool>, _>("email_verified"),
        Some(false)
    );
    assert!(
        snapshot
            .get::<Option<time::OffsetDateTime>, _>("last_authenticated_at")
            .is_some()
    );
    database
        .find_external_identity_user(
            "google",
            "provider-subject",
            "https://accounts.example.com",
            None,
            None,
        )
        .await
        .expect("lookup without optional profile claims must complete")
        .expect("bound identity must still resolve");
    assert_eq!(
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT email_snapshot FROM external_identities WHERE id = $1",
        )
        .bind(linked.identity_id)
        .fetch_one(&pool)
        .await
        .expect("preserved snapshot must be queryable")
        .as_deref(),
        Some("new-snapshot@example.com")
    );

    let duplicate = database
        .insert_external_identity(NewExternalIdentityRecord {
            id: Uuid::now_v7(),
            user_id: local_user_id,
            provider_key: "google".to_owned(),
            subject: "provider-subject".to_owned(),
            issuer: "https://accounts.example.com".to_owned(),
            email_snapshot: None,
            email_verified: None,
        })
        .await;
    assert!(matches!(
        duplicate,
        Err(ExternalIdentityError::IdentityUnavailable)
    ));
    assert!(matches!(
        database
            .insert_external_identity(NewExternalIdentityRecord {
                id: Uuid::now_v7(),
                user_id: local_user_id,
                provider_key: "github".to_owned(),
                subject: "another-subject".to_owned(),
                issuer: "http://issuer.example.com".to_owned(),
                email_snapshot: None,
                email_verified: None,
            })
            .await,
        Err(ExternalIdentityError::InvalidInput)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn registration_reports_username_and_email_conflicts_without_partial_rows(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let first = NewUserRecord {
        id: fixed_user_id(),
        username: "owner".to_owned(),
        email: "owner@example.com".to_owned(),
        display_name: "站点管理员".to_owned(),
        password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
            .to_owned(),
    };
    database
        .register_user(first)
        .await
        .expect("first user must register");

    let duplicate_email = database
        .register_user(NewUserRecord {
            id: Uuid::now_v7(),
            username: "another".to_owned(),
            email: "OWNER@example.com".to_owned(),
            display_name: "另一个人".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await;
    assert!(matches!(
        duplicate_email,
        Err(RegisterUserError::IdentityUnavailable)
    ));

    let user_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
        .fetch_one(&pool)
        .await
        .expect("user count query must work");
    assert_eq!(user_count, 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn registration_rolls_back_the_user_when_session_creation_fails(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;

    let result = database
        .register_user_with_session(
            NewUserRecord {
                id: fixed_user_id(),
                username: "owner".to_owned(),
                email: "owner@example.com".to_owned(),
                display_name: "站点管理员".to_owned(),
                password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                    .to_owned(),
            },
            NewSessionRecord {
                id: Uuid::now_v7(),
                token_hash: vec![7; 31],
                csrf_token_hash: vec![9; 32],
                device_label: "测试设备".to_owned(),
            },
        )
        .await;

    assert!(matches!(result, Err(RegisterUserError::Database(_))));
    let user_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
        .fetch_one(&pool)
        .await
        .expect("user count query must work");
    assert_eq!(user_count, 0);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn security_audit_events_keep_only_server_controlled_metadata(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("user must register");
    let session_id = Uuid::now_v7();
    database
        .create_session(
            session_id,
            user_id,
            vec![7; 32],
            vec![9; 32],
            "测试设备".to_owned(),
        )
        .await
        .expect("session must be created");

    database
        .insert_security_audit(SecurityAuditEvent {
            user_id: Some(user_id),
            session_id: Some(session_id),
            event_type: "auth.login.succeeded".to_owned(),
            metadata: json!({"method": "password"}),
        })
        .await
        .expect("audit event must insert");

    let row = sqlx::query(
        "SELECT user_id, session_id, event_type, metadata, created_at
         FROM security_audit_log
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("audit event must be queryable");
    assert_eq!(row.get::<Uuid, _>("user_id"), user_id);
    assert_eq!(row.get::<Uuid, _>("session_id"), session_id);
    assert_eq!(row.get::<String, _>("event_type"), "auth.login.succeeded");
    assert_eq!(
        row.get::<serde_json::Value, _>("metadata"),
        json!({"method": "password"})
    );
    assert!(row.get::<time::OffsetDateTime, _>("created_at") <= time::OffsetDateTime::now_utc());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn recent_authentication_is_scoped_to_session_and_consumed_once(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("user must register");
    let session_id = Uuid::now_v7();
    database
        .create_session(
            session_id,
            user_id,
            vec![7; 32],
            vec![9; 32],
            "测试设备".to_owned(),
        )
        .await
        .expect("session must be created");

    let recent = database
        .create_recent_authentication(user_id, session_id, "security.settings", "password")
        .await
        .expect("recent authentication must be created");
    assert!(recent.expires_at > time::OffsetDateTime::now_utc());
    assert!(
        database
            .consume_recent_authentication(user_id, session_id, "security.settings")
            .await
            .expect("recent authentication must be consumed")
    );
    assert!(
        !database
            .consume_recent_authentication(user_id, session_id, "security.settings")
            .await
            .expect("consumed authentication must not be reused")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_recent_authentication_replaces_the_same_active_operation(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("user must register");
    let session_id = Uuid::now_v7();
    database
        .create_session(
            session_id,
            user_id,
            vec![7; 32],
            vec![9; 32],
            "测试设备".to_owned(),
        )
        .await
        .expect("session must be created");

    let first_database = database.clone();
    let second_database = database.clone();
    let (first, second) = tokio::join!(
        first_database.create_recent_authentication(
            user_id,
            session_id,
            "security.settings",
            "password",
        ),
        second_database.create_recent_authentication(
            user_id,
            session_id,
            "security.settings",
            "password",
        ),
    );
    first.expect("first recent authentication must succeed");
    second.expect("second recent authentication must succeed");

    let active = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM recent_authentications
         WHERE session_id = $1 AND operation = 'security.settings' AND consumed_at IS NULL",
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    .expect("active recent authentication count must be queryable");
    assert_eq!(active, 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn recent_authentication_rejects_a_session_owned_by_another_user(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let owner_id = fixed_user_id();
    let other_id = Uuid::now_v7();
    for (id, username, email) in [
        (owner_id, "owner", "owner@example.com"),
        (other_id, "other", "other@example.com"),
    ] {
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
            .expect("user must register");
    }
    let session_id = Uuid::now_v7();
    database
        .create_session(
            session_id,
            owner_id,
            vec![7; 32],
            vec![9; 32],
            "测试设备".to_owned(),
        )
        .await
        .expect("session must be created");

    let result = database
        .create_recent_authentication(other_id, session_id, "security.settings", "password")
        .await;
    assert!(result.is_err());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn revoked_sessions_cannot_consume_recent_authentication(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("user must register");
    let session_id = Uuid::now_v7();
    let token_hash = vec![7; 32];
    database
        .create_session(
            session_id,
            user_id,
            token_hash.clone(),
            vec![9; 32],
            "测试设备".to_owned(),
        )
        .await
        .expect("session must be created");
    database
        .create_recent_authentication(user_id, session_id, "security.settings", "password")
        .await
        .expect("recent authentication must be created");
    assert!(
        database
            .revoke_session(&token_hash)
            .await
            .expect("session must be revoked")
    );

    assert!(
        !database
            .consume_recent_authentication(user_id, session_id, "security.settings")
            .await
            .expect("revoked session state must be rejected")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn password_change_consumes_recent_auth_and_rotates_session_security(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    let old_password_hash = "$argon2id$v=19$old-password-hash";
    let new_password_hash = "$argon2id$v=19$new-password-hash";
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: old_password_hash.to_owned(),
        })
        .await
        .expect("user must register");

    let current_session_id = Uuid::now_v7();
    let other_session_id = Uuid::now_v7();
    for (id, token_hash, csrf_token_hash, label) in [
        (current_session_id, vec![7; 32], vec![9; 32], "当前设备"),
        (other_session_id, vec![8; 32], vec![10; 32], "其他设备"),
    ] {
        database
            .create_session(id, user_id, token_hash, csrf_token_hash, label.to_owned())
            .await
            .expect("session must be created");
    }
    database
        .create_recent_authentication(user_id, current_session_id, "security.settings", "password")
        .await
        .expect("recent authentication must be created");

    let new_csrf_hash = vec![11; 32];
    database
        .change_password(
            user_id,
            current_session_id,
            new_password_hash,
            new_csrf_hash.clone(),
        )
        .await
        .expect("password change must succeed");

    assert_eq!(
        database
            .find_password_hash(user_id)
            .await
            .expect("password hash must be queryable")
            .as_deref(),
        Some(new_password_hash)
    );
    let sessions = sqlx::query(
        "SELECT id, csrf_token_hash, revoked_at FROM sessions WHERE user_id = $1 ORDER BY id",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .expect("sessions must be queryable");
    let current = sessions
        .iter()
        .find(|row| row.get::<Uuid, _>("id") == current_session_id)
        .expect("current session must remain");
    assert!(
        current
            .get::<Option<time::OffsetDateTime>, _>("revoked_at")
            .is_none()
    );
    assert_eq!(current.get::<Vec<u8>, _>("csrf_token_hash"), new_csrf_hash);
    let other = sessions
        .iter()
        .find(|row| row.get::<Uuid, _>("id") == other_session_id)
        .expect("other session must remain as a revoked record");
    assert!(
        other
            .get::<Option<time::OffsetDateTime>, _>("revoked_at")
            .is_some()
    );
    assert!(matches!(
        database
            .change_password(
                user_id,
                current_session_id,
                "$argon2id$v=19$another-password-hash",
                vec![12; 32],
            )
            .await,
        Err(ChangePasswordError::RecentAuthenticationRequired)
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM security_audit_log
             WHERE user_id = $1 AND session_id = $2 AND event_type = 'auth.password.changed'",
        )
        .bind(user_id)
        .bind(current_session_id)
        .fetch_one(&pool)
        .await
        .expect("password audit event must be queryable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn unlink_external_identity_is_atomic_and_rotates_current_session_security(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("user must register");
    let current_session_id = Uuid::now_v7();
    let other_session_id = Uuid::now_v7();
    database
        .create_session(
            current_session_id,
            user_id,
            vec![7; 32],
            vec![9; 32],
            "当前设备".to_owned(),
        )
        .await
        .expect("current session must be created");
    database
        .create_session(
            other_session_id,
            user_id,
            vec![8; 32],
            vec![10; 32],
            "其他设备".to_owned(),
        )
        .await
        .expect("other session must be created");
    let identity_id = Uuid::now_v7();
    database
        .insert_external_identity(NewExternalIdentityRecord {
            id: identity_id,
            user_id,
            provider_key: "google".to_owned(),
            subject: "subject".to_owned(),
            issuer: "https://issuer.example.com".to_owned(),
            email_snapshot: None,
            email_verified: None,
        })
        .await
        .expect("identity must be inserted");
    database
        .create_recent_authentication(user_id, current_session_id, "security.settings", "password")
        .await
        .expect("recent authentication must be created");

    database
        .unlink_external_identity(user_id, current_session_id, identity_id, vec![11; 32])
        .await
        .expect("identity unlink must succeed");

    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM external_identities WHERE id = $1")
            .bind(identity_id)
            .fetch_one(&pool)
            .await
            .expect("identity count must be queryable"),
        0
    );
    let current = sqlx::query("SELECT csrf_token_hash, revoked_at FROM sessions WHERE id = $1")
        .bind(current_session_id)
        .fetch_one(&pool)
        .await
        .expect("current session must be queryable");
    assert_eq!(current.get::<Vec<u8>, _>("csrf_token_hash"), vec![11; 32]);
    assert!(
        current
            .get::<Option<time::OffsetDateTime>, _>("revoked_at")
            .is_none()
    );
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT revoked_at IS NOT NULL FROM sessions WHERE id = $1")
            .bind(other_session_id)
            .fetch_one(&pool)
            .await
            .expect("other session must be queryable")
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM security_audit_log WHERE event_type = 'auth.identity.unlinked'",
        )
        .fetch_one(&pool)
        .await
        .expect("unlink audit must be queryable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM recent_authentications WHERE consumed_at IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("recent auth state must be queryable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn unlink_external_identity_rejects_the_last_available_login_method_without_mutation(
    pool: PgPool,
) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("user must register");
    sqlx::query("DELETE FROM password_credentials WHERE user_id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("password credential must be removable for the fixture");
    let session_id = Uuid::now_v7();
    database
        .create_session(
            session_id,
            user_id,
            vec![7; 32],
            vec![9; 32],
            "当前设备".to_owned(),
        )
        .await
        .expect("session must be created");
    let identity_id = Uuid::now_v7();
    database
        .insert_external_identity(NewExternalIdentityRecord {
            id: identity_id,
            user_id,
            provider_key: "google".to_owned(),
            subject: "subject".to_owned(),
            issuer: "https://issuer.example.com".to_owned(),
            email_snapshot: None,
            email_verified: None,
        })
        .await
        .expect("identity must be inserted");
    database
        .create_recent_authentication(user_id, session_id, "security.settings", "password")
        .await
        .expect("recent authentication must be created");

    assert!(matches!(
        database
            .unlink_external_identity(user_id, session_id, identity_id, vec![11; 32])
            .await,
        Err(UnlinkExternalIdentityError::LastLoginMethodRequired)
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM external_identities WHERE id = $1")
            .bind(identity_id)
            .fetch_one(&pool)
            .await
            .expect("identity count must be queryable"),
        1
    );
    assert!(
        database
            .consume_recent_authentication(user_id, session_id, "security.settings")
            .await
            .expect("rollback must preserve recent authentication")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn binding_external_identity_consumes_recent_auth_and_rotates_current_session_security(
    pool: PgPool,
) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$abcdefghijklmnop"
                .to_owned(),
        })
        .await
        .expect("user must register");
    let current_session_id = Uuid::now_v7();
    let other_session_id = Uuid::now_v7();
    database
        .create_session(
            current_session_id,
            user_id,
            vec![7; 32],
            vec![9; 32],
            "当前设备".to_owned(),
        )
        .await
        .expect("current session must be created");
    database
        .create_session(
            other_session_id,
            user_id,
            vec![8; 32],
            vec![10; 32],
            "其他设备".to_owned(),
        )
        .await
        .expect("other session must be created");
    database
        .create_recent_authentication(user_id, current_session_id, "security.settings", "password")
        .await
        .expect("recent authentication must be created");

    let identity_id = Uuid::now_v7();
    database
        .bind_external_identity(
            user_id,
            current_session_id,
            None,
            NewExternalIdentityRecord {
                id: identity_id,
                user_id,
                provider_key: "google".to_owned(),
                subject: "new-subject".to_owned(),
                issuer: "https://accounts.example.com".to_owned(),
                email_snapshot: Some("owner@provider.example".to_owned()),
                email_verified: Some(true),
            },
            vec![11; 32],
        )
        .await
        .expect("external identity must bind");

    let identity =
        sqlx::query("SELECT user_id, last_authenticated_at FROM external_identities WHERE id = $1")
            .bind(identity_id)
            .fetch_one(&pool)
            .await
            .expect("bound identity must be queryable");
    assert_eq!(identity.get::<Uuid, _>("user_id"), user_id);
    assert!(
        identity
            .get::<Option<time::OffsetDateTime>, _>("last_authenticated_at")
            .is_some()
    );
    assert_eq!(
        sqlx::query_scalar::<_, Vec<u8>>("SELECT csrf_token_hash FROM sessions WHERE id = $1")
            .bind(current_session_id)
            .fetch_one(&pool)
            .await
            .expect("current session must be queryable"),
        vec![11; 32]
    );
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT revoked_at IS NOT NULL FROM sessions WHERE id = $1")
            .bind(other_session_id)
            .fetch_one(&pool)
            .await
            .expect("other session must be queryable")
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM security_audit_log WHERE event_type = 'auth.identity.bound'",
        )
        .fetch_one(&pool)
        .await
        .expect("binding audit event must be queryable"),
        1
    );
    assert!(matches!(
        database
            .bind_external_identity(
                user_id,
                current_session_id,
                None,
                NewExternalIdentityRecord {
                    id: Uuid::now_v7(),
                    user_id,
                    provider_key: "github".to_owned(),
                    subject: "second-subject".to_owned(),
                    issuer: "https://github.example.com".to_owned(),
                    email_snapshot: None,
                    email_verified: None,
                },
                vec![12; 32],
            )
            .await,
        Err(BindExternalIdentityError::RecentAuthenticationRequired)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn replacing_external_identity_is_atomic_and_preserves_the_old_identity_on_conflict(
    pool: PgPool,
) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    let other_user_id = Uuid::now_v7();
    for (id, username, email) in [
        (user_id, "owner", "owner@example.com"),
        (other_user_id, "other", "other@example.com"),
    ] {
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
            .expect("user must register");
    }
    let current_session_id = Uuid::now_v7();
    database
        .create_session(
            current_session_id,
            user_id,
            vec![7; 32],
            vec![9; 32],
            "当前设备".to_owned(),
        )
        .await
        .expect("current session must be created");
    let old_identity_id = Uuid::now_v7();
    database
        .insert_external_identity(NewExternalIdentityRecord {
            id: old_identity_id,
            user_id,
            provider_key: "google".to_owned(),
            subject: "old-subject".to_owned(),
            issuer: "https://accounts.example.com".to_owned(),
            email_snapshot: None,
            email_verified: None,
        })
        .await
        .expect("old identity must be inserted");
    database
        .insert_external_identity(NewExternalIdentityRecord {
            id: Uuid::now_v7(),
            user_id: other_user_id,
            provider_key: "github".to_owned(),
            subject: "taken-subject".to_owned(),
            issuer: "https://github.example.com".to_owned(),
            email_snapshot: None,
            email_verified: None,
        })
        .await
        .expect("conflicting identity must be inserted");
    database
        .create_recent_authentication(user_id, current_session_id, "security.settings", "password")
        .await
        .expect("recent authentication must be created");

    let conflict = database
        .bind_external_identity(
            user_id,
            current_session_id,
            Some(old_identity_id),
            NewExternalIdentityRecord {
                id: Uuid::now_v7(),
                user_id,
                provider_key: "github".to_owned(),
                subject: "taken-subject".to_owned(),
                issuer: "https://github.example.com".to_owned(),
                email_snapshot: None,
                email_verified: None,
            },
            vec![11; 32],
        )
        .await;
    assert!(matches!(
        conflict,
        Err(BindExternalIdentityError::IdentityUnavailable)
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM external_identities WHERE id = $1")
            .bind(old_identity_id)
            .fetch_one(&pool)
            .await
            .expect("old identity must be queryable"),
        1
    );
    assert!(
        database
            .consume_recent_authentication(user_id, current_session_id, "security.settings")
            .await
            .expect("recent authentication must remain available after rollback")
    );

    database
        .create_recent_authentication(user_id, current_session_id, "security.settings", "password")
        .await
        .expect("replacement needs a fresh recent authentication");
    let new_identity_id = Uuid::now_v7();
    database
        .bind_external_identity(
            user_id,
            current_session_id,
            Some(old_identity_id),
            NewExternalIdentityRecord {
                id: new_identity_id,
                user_id,
                provider_key: "github".to_owned(),
                subject: "new-subject".to_owned(),
                issuer: "https://github.example.com".to_owned(),
                email_snapshot: None,
                email_verified: None,
            },
            vec![12; 32],
        )
        .await
        .expect("owned external identity must be replaced");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM external_identities WHERE id = $1")
            .bind(old_identity_id)
            .fetch_one(&pool)
            .await
            .expect("old identity count must be queryable"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM external_identities WHERE id = $1")
            .bind(new_identity_id)
            .fetch_one(&pool)
            .await
            .expect("new identity count must be queryable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM security_audit_log WHERE event_type = 'auth.identity.replaced'",
        )
        .fetch_one(&pool)
        .await
        .expect("replacement audit event must be queryable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn password_change_rolls_back_when_a_late_write_fails(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    mark_initialized(&pool).await;
    let user_id = fixed_user_id();
    let old_password_hash = "$argon2id$v=19$old-password-hash";
    database
        .register_user(NewUserRecord {
            id: user_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "站点管理员".to_owned(),
            password_hash: old_password_hash.to_owned(),
        })
        .await
        .expect("user must register");
    let current_session_id = Uuid::now_v7();
    let other_session_id = Uuid::now_v7();
    database
        .create_session(
            current_session_id,
            user_id,
            vec![7; 32],
            vec![9; 32],
            "当前设备".to_owned(),
        )
        .await
        .expect("current session must be created");
    database
        .create_session(
            other_session_id,
            user_id,
            vec![8; 32],
            vec![10; 32],
            "其他设备".to_owned(),
        )
        .await
        .expect("other session must be created");
    database
        .create_recent_authentication(user_id, current_session_id, "security.settings", "password")
        .await
        .expect("recent authentication must be created");

    assert!(matches!(
        database
            .change_password(
                user_id,
                current_session_id,
                "$argon2id$v=19$new-password-hash",
                vec![11; 31],
            )
            .await,
        Err(ChangePasswordError::Database(_))
    ));
    assert_eq!(
        database
            .find_password_hash(user_id)
            .await
            .expect("password hash must be queryable")
            .as_deref(),
        Some(old_password_hash)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM sessions
             WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
        )
        .bind(other_session_id)
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("other session state must be queryable"),
        1
    );
    assert!(
        database
            .consume_recent_authentication(user_id, current_session_id, "security.settings")
            .await
            .expect("recent authentication must remain consumable after rollback")
    );
}

fn fixed_user_id() -> Uuid {
    Uuid::parse_str("019fc700-0000-7000-8000-000000000003").expect("fixture UUID must be valid")
}

async fn mark_initialized(pool: &PgPool) {
    sqlx::query(
        "UPDATE system_state SET is_initialized = TRUE, initialized_at = CURRENT_TIMESTAMP",
    )
    .execute(pool)
    .await
    .expect("test instance must be marked initialized");
}
