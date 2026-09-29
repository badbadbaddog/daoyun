use infrastructure::{Database, NewTopicSupplement, SupplementError, SupplementSettingsRecord};
use sqlx::PgPool;
use uuid::Uuid;

async fn fixture(pool: &PgPool) -> (Database, Uuid, Uuid, Uuid) {
    let author = Uuid::now_v7();
    let board = Uuid::now_v7();
    let topic = Uuid::now_v7();
    sqlx::query("INSERT INTO users (id, username, email, display_name, status) VALUES ($1, 'supplement_author', 'supplement@example.com', 'Author', 'active')")
        .bind(author).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO boards (id, slug, name) VALUES ($1, 'supplements', 'Supplements')")
        .bind(board)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO topics (id, board_id, author_id, title, content, status, published_at) VALUES ($1, $2, $3, 'Original', 'Original body', 'published', CURRENT_TIMESTAMP)")
        .bind(topic).bind(board).bind(author).execute(pool).await.unwrap();
    sqlx::query("UPDATE topic_supplement_settings SET enabled = true WHERE id = 1")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO plugins (id, key, name, version, description, capabilities, component_bytes, component_sha256, status, installed_by, business_api_version, data_scopes, event_subscriptions) VALUES ($1, 'official_topic_supplements', 'Topic supplements', '1.0.0', '', '[\"topic.supplements\", \"ui.panel\"]', $2, $3, 'enabled', $4, '0.1.0', '[]', '[]')")
        .bind(Uuid::now_v7())
        .bind(vec![0_u8])
        .bind("a".repeat(64))
        .bind(author)
        .execute(pool)
        .await
        .unwrap();
    (Database::from_pool(pool.clone()), author, board, topic)
}

fn input(author: Uuid, topic: Uuid, key: &str, content: &str) -> NewTopicSupplement {
    NewTopicSupplement {
        author_id: author,
        topic_id: topic,
        idempotency_key: key.into(),
        content: content.into(),
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_supplements_share_one_slot_and_retries_are_idempotent(pool: PgPool) {
    let (db, author, _, topic) = fixture(&pool).await;
    let (first, second) = tokio::join!(
        db.create_topic_supplement(input(author, topic, "first", "First")),
        db.create_topic_supplement(input(author, topic, "second", "Second")),
    );
    let (winner, failed, key) = match (first, second) {
        (Ok((record, true)), failed) => (record, failed, "first"),
        (failed, Ok((record, true))) => (record, failed, "second"),
        other => panic!("expected exactly one successful write: {other:?}"),
    };
    assert!(matches!(failed, Err(SupplementError::LimitReached)));
    assert_eq!(winner.status, "approved");
    let (replayed, created) = db
        .create_topic_supplement(input(author, topic, key, &winner.content))
        .await
        .unwrap();
    assert!(!created);
    assert_eq!(winner.id, replayed.id);
    assert!(matches!(
        db.create_topic_supplement(input(author, topic, key, "Changed"))
            .await,
        Err(SupplementError::Conflict)
    ));
    assert_eq!(
        db.list_topic_supplements(topic, None)
            .await
            .unwrap()
            .records
            .len(),
        1
    );
    let own = db
        .list_topic_supplements(topic, Some(author))
        .await
        .unwrap();
    assert_eq!(own.used_count, 1);
    assert!(!own.can_submit);
    assert_eq!(own.records.len(), 1);
    assert!(matches!(
        db.create_topic_supplement(input(Uuid::now_v7(), topic, "other", "Other"))
            .await,
        Err(SupplementError::Forbidden)
    ));
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM admin_audit_log WHERE action = 'topic.supplement.create'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audits, 1);
    let original: String = sqlx::query_scalar("SELECT content FROM topics WHERE id = $1")
        .bind(topic)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(original, "Original body");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn direct_publication_and_disabling_preserve_history_and_consumed_slots(pool: PgPool) {
    let (db, author, _, topic) = fixture(&pool).await;
    let (record, _) = db
        .create_topic_supplement(input(author, topic, "first", "Supplement"))
        .await
        .unwrap();
    assert_eq!(record.status, "approved");
    assert_eq!(
        db.list_topic_supplements(topic, None)
            .await
            .unwrap()
            .records
            .len(),
        1
    );
    let role = Uuid::now_v7();
    sqlx::query("INSERT INTO roles (id, key, name, scope) VALUES ($1, 'supplement_configurer', 'Supplement configurer', 'site')")
        .bind(role).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key IN ('admin.configuration.read', 'admin.configuration.write')")
        .bind(role).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by) VALUES ($1, $2, $3, $2)",
    )
    .bind(Uuid::now_v7())
    .bind(author)
    .bind(role)
    .execute(&pool)
    .await
    .unwrap();
    assert!(matches!(
        db.create_topic_supplement(input(author, topic, "again", "More"))
            .await,
        Err(SupplementError::LimitReached)
    ));
    db.topic_supplement_settings(
        author,
        Some(SupplementSettingsRecord {
            enabled: false,
            max_per_topic: 0,
        }),
    )
    .await
    .unwrap();
    let public = db.list_topic_supplements(topic, None).await.unwrap();
    assert_eq!(public.records.len(), 1);
    assert!(!public.settings.enabled);
    assert_eq!(public.settings.max_per_topic, 0);
    assert!(matches!(
        db.create_topic_supplement(input(author, topic, "disabled", "More"))
            .await,
        Err(SupplementError::Disabled)
    ));
    let (replayed, created) = db
        .create_topic_supplement(input(author, topic, "first", "Supplement"))
        .await
        .unwrap();
    assert!(!created);
    assert_eq!(replayed.id, record.id);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn supplement_writes_enforce_account_and_board_restrictions(pool: PgPool) {
    let (db, author, board, topic) = fixture(&pool).await;
    sqlx::query("UPDATE users SET status = 'restricted' WHERE id = $1")
        .bind(author)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.create_topic_supplement(input(author, topic, "restricted", "Text"))
            .await,
        Err(SupplementError::Forbidden)
    ));
    sqlx::query("UPDATE users SET status = 'active' WHERE id = $1")
        .bind(author)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE boards SET status = 'read_only' WHERE id = $1")
        .bind(board)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.create_topic_supplement(input(author, topic, "readonly", "Text"))
            .await,
        Err(SupplementError::Forbidden)
    ));
    sqlx::query("UPDATE boards SET status = 'open' WHERE id = $1")
        .bind(board)
        .execute(&pool)
        .await
        .unwrap();
    let (record, _) = db
        .create_topic_supplement(input(author, topic, "allowed", "Text"))
        .await
        .unwrap();
    assert_eq!(record.status, "approved");
    sqlx::query("UPDATE boards SET visibility = 'hidden', status = 'hidden' WHERE id = $1")
        .bind(board)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.list_topic_supplements(topic, None).await,
        Err(SupplementError::NotFound)
    ));
}
