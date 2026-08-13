use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn notification_reads_audit_only_actual_state_changes(pool: PgPool) {
    let recipient = fixture_id(1);
    let actor = fixture_id(2);
    let first = fixture_id(101);
    let second = fixture_id(102);
    insert_user(&pool, recipient, "recipient").await;
    insert_user(&pool, actor, "actor").await;
    for notification_id in [first, second] {
        sqlx::query(
            "INSERT INTO notifications
                (id, recipient_id, actor_id, kind, target_type, target_id, aggregate_key)
             VALUES ($1, $2, $3, 'reply', 'topic', $4, $5)",
        )
        .bind(notification_id)
        .bind(recipient)
        .bind(actor)
        .bind(fixture_id(201))
        .bind(format!("audit-notification:{notification_id}"))
        .execute(&pool)
        .await
        .expect("notification fixture must insert");
    }
    let database = Database::from_pool(pool.clone());

    let read = database
        .mark_notification_read(recipient, first)
        .await
        .expect("notification must become read");
    assert!(read.read_at.is_some());
    database
        .mark_notification_read(recipient, first)
        .await
        .expect("repeated notification read must stay idempotent");

    let all_read = database
        .mark_all_notifications_read(recipient)
        .await
        .expect("remaining notifications must become read");
    assert_eq!(all_read.unread_count, 0);
    database
        .mark_all_notifications_read(recipient)
        .await
        .expect("repeated read-all must stay idempotent");

    let audit = sqlx::query_as::<_, (String, String, Option<Uuid>, Value)>(
        "SELECT action, resource_type, resource_id, summary
         FROM admin_audit_log WHERE actor_id = $1 ORDER BY action",
    )
    .bind(recipient)
    .fetch_all(&pool)
    .await
    .expect("notification audit rows must be readable");
    assert_eq!(
        audit,
        vec![
            (
                "notification.read".to_owned(),
                "notification".to_owned(),
                Some(first),
                json!({}),
            ),
            (
                "notification.read_all".to_owned(),
                "notification".to_owned(),
                None,
                json!({"count": 1}),
            ),
        ]
    );
}

fn fixture_id(value: u128) -> Uuid {
    Uuid::from_u128(0x019f_cc00_0000_7000_8000_0000_0000_0000 + value)
}

async fn insert_user(pool: &PgPool, id: Uuid, username: &str) {
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status)
         VALUES ($1, $2, $2 || '@example.com', $2, 'active')",
    )
    .bind(id)
    .bind(username)
    .execute(pool)
    .await
    .expect("user fixture must insert");
}
