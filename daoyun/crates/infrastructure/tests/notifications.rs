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
    sqlx::query("INSERT INTO boards(id,slug,name) VALUES($1,'notifications','通知测试')")
        .bind(fixture_id(301))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO topics(id,board_id,author_id,title,excerpt,content,status,published_at) VALUES($1,$2,$3,'通知主题','通知摘要','通知正文','published',CURRENT_TIMESTAMP)")
        .bind(fixture_id(201)).bind(fixture_id(301)).bind(recipient).execute(&pool).await.unwrap();
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

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn read_all_preserves_late_commits_even_with_older_timestamps(pool: PgPool) {
    let recipient = fixture_id(1);
    insert_user(&pool, recipient, "recipient").await;
    let first = fixture_id(101);
    let late = fixture_id(100);
    sqlx::query("INSERT INTO notifications(id,recipient_id,kind,target_type,target_id,aggregate_key,created_at) VALUES($1,$2,'follow','user',$2,$1::text,'2026-08-02'::timestamptz)").bind(first).bind(recipient).execute(&pool).await.unwrap();
    let mut lock = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM notifications WHERE id=$1 FOR UPDATE")
        .bind(first)
        .fetch_one(&mut *lock)
        .await
        .unwrap();
    let mut arrival = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO notifications(id,recipient_id,kind,target_type,target_id,aggregate_key,created_at) VALUES($1,$2,'follow','user',$2,$1::text,'2026-08-01'::timestamptz)").bind(late).bind(recipient).execute(&mut *arrival).await.unwrap();
    let database = Database::from_pool(pool.clone());
    let action = tokio::spawn(async move { database.mark_all_notifications_read(recipient).await });
    let mut waiting = false;
    for _ in 0..200 {
        waiting = sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'UPDATE notifications%SET read_at = CURRENT_TIMESTAMP%' AND wait_event_type='Lock')").fetch_one(&pool).await.unwrap();
        if waiting {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(
        waiting,
        "read-all must reach its UPDATE snapshot and wait for the held row lock"
    );
    arrival.commit().await.unwrap();
    lock.commit().await.unwrap();
    let result = action.await.unwrap().unwrap();
    assert_eq!(result.unread_count, 1);
    let unread = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM notifications WHERE recipient_id=$1 AND read_at IS NULL",
    )
    .bind(recipient)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(unread, vec![late]);
}
