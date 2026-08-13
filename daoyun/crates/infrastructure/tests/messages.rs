use std::time::Duration;

use infrastructure::{
    ArchiveConversationError, CreateConversationError, Database, IdempotencyInput,
    ListConversationsError, ListDirectMessagesError, MarkConversationReadError,
    NewDirectMessageRecord, SendDirectMessageError,
};
use serde_json::Value;
use sqlx::{PgPool, types::Uuid};

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn conversation_creation_serializes_with_concurrent_blocks(pool: PgPool) {
    let first = fixture_id(1);
    let second = fixture_id(2);
    insert_user(&pool, first, "first", "active").await;
    insert_user(&pool, second, "second", "active").await;
    let database = Database::from_pool(pool.clone());

    let mut block_transaction = pool.begin().await.expect("block transaction must begin");
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE id = $1 OR id = $2 ORDER BY id FOR UPDATE",
    )
    .bind(first)
    .bind(second)
    .fetch_all(&mut *block_transaction)
    .await
    .expect("block transaction must lock both users");

    let creation = database.create_direct_conversation(first, second, fixture_id(101));
    tokio::pin!(creation);
    assert!(
        tokio::time::timeout(Duration::from_millis(500), &mut creation)
            .await
            .is_err(),
        "conversation creation must wait for a concurrent block mutation"
    );
    sqlx::query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)")
        .bind(first)
        .bind(second)
        .execute(&mut *block_transaction)
        .await
        .expect("block transaction must insert the relationship");
    block_transaction
        .commit()
        .await
        .expect("block transaction must commit");

    assert!(matches!(
        creation
            .await
            .expect_err("committed block must reject conversation creation"),
        CreateConversationError::Unavailable
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn message_sending_serializes_with_concurrent_blocks(pool: PgPool) {
    let first = fixture_id(1);
    let second = fixture_id(2);
    insert_user(&pool, first, "first", "active").await;
    insert_user(&pool, second, "second", "active").await;
    let database = Database::from_pool(pool.clone());
    let conversation = database
        .create_direct_conversation(first, second, fixture_id(101))
        .await
        .expect("conversation must create");

    let mut block_transaction = pool.begin().await.expect("block transaction must begin");
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE id = $1 OR id = $2 ORDER BY id FOR UPDATE",
    )
    .bind(first)
    .bind(second)
    .fetch_all(&mut *block_transaction)
    .await
    .expect("block transaction must lock both users");

    let sending = database.send_direct_message(
        NewDirectMessageRecord {
            id: fixture_id(201),
            conversation_id: conversation.id,
            sender_id: first,
            content: "must not cross the block boundary".to_owned(),
        },
        None,
    );
    tokio::pin!(sending);
    assert!(
        tokio::time::timeout(Duration::from_millis(500), &mut sending)
            .await
            .is_err(),
        "message sending must wait for a concurrent block mutation"
    );
    sqlx::query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)")
        .bind(second)
        .bind(first)
        .execute(&mut *block_transaction)
        .await
        .expect("block transaction must insert the relationship");
    block_transaction
        .commit()
        .await
        .expect("block transaction must commit");

    assert!(matches!(
        sending
            .await
            .expect_err("committed block must reject message sending"),
        SendDirectMessageError::ConversationUnavailable
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM direct_messages")
            .fetch_one(&pool)
            .await
            .expect("message count must be readable"),
        0
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn conversations_are_unique_two_party_resources_and_respect_blocks(pool: PgPool) {
    let first = fixture_id(1);
    let second = fixture_id(2);
    let third = fixture_id(3);
    insert_user(&pool, first, "first", "active").await;
    insert_user(&pool, second, "second", "active").await;
    insert_user(&pool, third, "third", "suspended").await;
    let database = Database::from_pool(pool.clone());

    let (left, right) = tokio::join!(
        database.create_direct_conversation(first, second, fixture_id(101)),
        database.create_direct_conversation(second, first, fixture_id(102)),
    );
    let left = left.expect("first concurrent create must succeed");
    let right = right.expect("second concurrent create must succeed");
    assert_eq!(left.id, right.id);
    assert_eq!(left.other_user.id, second);
    assert_eq!(right.other_user.id, first);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM direct_conversations")
            .fetch_one(&pool)
            .await
            .expect("conversation count must be readable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM conversation_members")
            .fetch_one(&pool)
            .await
            .expect("member count must be readable"),
        2
    );

    let self_conversation = database
        .create_direct_conversation(first, first, fixture_id(103))
        .await
        .expect_err("self conversations must be hidden as unavailable");
    assert!(matches!(
        self_conversation,
        CreateConversationError::Unavailable
    ));
    let inactive = database
        .create_direct_conversation(first, third, fixture_id(104))
        .await
        .expect_err("inactive recipients must be unavailable");
    assert!(matches!(inactive, CreateConversationError::Unavailable));

    sqlx::query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)")
        .bind(second)
        .bind(first)
        .execute(&pool)
        .await
        .expect("block fixture must insert");
    let blocked = database
        .create_direct_conversation(first, second, fixture_id(105))
        .await
        .expect_err("either block direction must hide conversation creation");
    assert!(matches!(blocked, CreateConversationError::Unavailable));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn messages_are_private_paginated_and_idempotent(pool: PgPool) {
    let first = fixture_id(1);
    let second = fixture_id(2);
    let outsider = fixture_id(3);
    for (id, username) in [(first, "first"), (second, "second"), (outsider, "outsider")] {
        insert_user(&pool, id, username, "active").await;
    }
    let database = Database::from_pool(pool.clone());
    let conversation = database
        .create_direct_conversation(first, second, fixture_id(101))
        .await
        .expect("conversation must create");

    let first_message = database
        .send_direct_message(
            NewDirectMessageRecord {
                id: fixture_id(201),
                conversation_id: conversation.id,
                sender_id: first,
                content: "hello".to_owned(),
            },
            Some(IdempotencyInput {
                key: "message-key".to_owned(),
                request_hash: vec![1; 32],
            }),
        )
        .await
        .expect("first message must send");
    assert!(first_message.created);
    let replay = database
        .send_direct_message(
            NewDirectMessageRecord {
                id: fixture_id(202),
                conversation_id: conversation.id,
                sender_id: first,
                content: "hello".to_owned(),
            },
            Some(IdempotencyInput {
                key: "message-key".to_owned(),
                request_hash: vec![1; 32],
            }),
        )
        .await
        .expect("matching idempotency replay must succeed");
    assert!(!replay.created);
    assert_eq!(replay.message.id, first_message.message.id);
    let conflict = database
        .send_direct_message(
            NewDirectMessageRecord {
                id: fixture_id(203),
                conversation_id: conversation.id,
                sender_id: first,
                content: "changed".to_owned(),
            },
            Some(IdempotencyInput {
                key: "message-key".to_owned(),
                request_hash: vec![2; 32],
            }),
        )
        .await
        .expect_err("changed idempotency replay must conflict");
    assert!(matches!(
        conflict,
        SendDirectMessageError::IdempotencyConflict
    ));

    database
        .send_direct_message(
            NewDirectMessageRecord {
                id: fixture_id(204),
                conversation_id: conversation.id,
                sender_id: second,
                content: "reply".to_owned(),
            },
            None,
        )
        .await
        .expect("reply must send");

    let messages = database
        .list_direct_messages(first, conversation.id, None, 1)
        .await
        .expect("first message page must load");
    assert_eq!(messages[0].content, "reply");
    let older = database
        .list_direct_messages(first, conversation.id, Some(messages[0].id), 10)
        .await
        .expect("older message page must load");
    assert_eq!(older.len(), 1);
    assert_eq!(older[0].content, "hello");

    let audit = sqlx::query_as::<_, (Uuid, String, Option<Uuid>, Value)>(
        "SELECT actor_id, action, resource_id, summary FROM admin_audit_log
         ORDER BY action, actor_id",
    )
    .fetch_all(&pool)
    .await
    .expect("message audit rows must be readable");
    assert_eq!(audit.len(), 3);
    assert_eq!(
        audit
            .iter()
            .filter(|(_, action, id, summary)| {
                action == "conversation.create"
                    && *id == Some(conversation.id)
                    && summary == &serde_json::json!({})
            })
            .count(),
        1
    );
    assert_eq!(
        audit
            .iter()
            .filter(|(_, action, _, summary)| {
                action == "message.send"
                    && summary == &serde_json::json!({"conversation_id": conversation.id})
            })
            .count(),
        2
    );
    let serialized = serde_json::to_string(&audit).expect("message audit rows must serialize");
    assert!(!serialized.contains("hello"));
    assert!(!serialized.contains("reply"));
    assert!(!serialized.contains("first"));
    assert!(!serialized.contains("second"));

    let outsider_read = database
        .list_direct_messages(outsider, conversation.id, None, 20)
        .await
        .expect_err("non-participants must not read messages");
    assert!(matches!(
        outsider_read,
        ListDirectMessagesError::ConversationUnavailable
    ));
    let invalid_cursor = database
        .list_direct_messages(first, conversation.id, Some(fixture_id(999)), 20)
        .await
        .expect_err("unknown message cursor must be rejected");
    assert!(matches!(
        invalid_cursor,
        ListDirectMessagesError::InvalidCursor
    ));

    sqlx::query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)")
        .bind(first)
        .bind(second)
        .execute(&pool)
        .await
        .expect("block fixture must insert");
    let blocked_send = database
        .send_direct_message(
            NewDirectMessageRecord {
                id: fixture_id(205),
                conversation_id: conversation.id,
                sender_id: second,
                content: "blocked".to_owned(),
            },
            None,
        )
        .await
        .expect_err("blocks must prevent new messages");
    assert!(matches!(
        blocked_send,
        SendDirectMessageError::ConversationUnavailable
    ));
    assert_eq!(
        database
            .list_direct_messages(second, conversation.id, None, 20)
            .await
            .expect("blocks must not hide existing history")
            .len(),
        2
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn unread_read_archive_and_conversation_pagination_are_user_scoped(pool: PgPool) {
    let first = fixture_id(1);
    let second = fixture_id(2);
    let third = fixture_id(3);
    for (id, username) in [(first, "first"), (second, "second"), (third, "third")] {
        insert_user(&pool, id, username, "active").await;
    }
    let database = Database::from_pool(pool.clone());
    let older_conversation = database
        .create_direct_conversation(first, second, fixture_id(101))
        .await
        .expect("older conversation must create");
    let newer_conversation = database
        .create_direct_conversation(first, third, fixture_id(102))
        .await
        .expect("newer conversation must create");
    sqlx::query(
        "UPDATE direct_conversations SET created_at = '2026-08-03T10:00:00Z', updated_at = '2026-08-03T10:00:00Z' WHERE id = $1",
    )
    .bind(older_conversation.id)
    .execute(&pool)
    .await
    .expect("older timestamp must update");
    sqlx::query(
        "UPDATE direct_conversations SET created_at = '2026-08-03T11:00:00Z', updated_at = '2026-08-03T11:00:00Z' WHERE id = $1",
    )
    .bind(newer_conversation.id)
    .execute(&pool)
    .await
    .expect("newer timestamp must update");

    let first_page = database
        .list_direct_conversations(first, None, 1)
        .await
        .expect("first conversation page must load");
    assert_eq!(first_page[0].id, newer_conversation.id);
    let second_page = database
        .list_direct_conversations(first, Some(newer_conversation.id), 10)
        .await
        .expect("second conversation page must load");
    assert_eq!(second_page[0].id, older_conversation.id);
    let invalid_cursor = database
        .list_direct_conversations(second, Some(newer_conversation.id), 20)
        .await
        .expect_err("another user's conversation cannot be a cursor");
    assert!(matches!(
        invalid_cursor,
        ListConversationsError::InvalidCursor
    ));

    let first_incoming = send(&database, older_conversation.id, second, 201, "one").await;
    let second_incoming = send(&database, older_conversation.id, second, 202, "two").await;
    let before_read = database
        .list_direct_conversations(first, None, 20)
        .await
        .expect("conversation summaries must load")
        .into_iter()
        .find(|item| item.id == older_conversation.id)
        .expect("older conversation must be listed");
    assert_eq!(before_read.unread_count, 2);

    let partial = database
        .mark_direct_conversation_read(first, older_conversation.id, first_incoming)
        .await
        .expect("partial read must succeed");
    assert_eq!(partial.last_read_message_id, first_incoming);
    assert_eq!(partial.unread_count, 1);
    let complete = database
        .mark_direct_conversation_read(first, older_conversation.id, second_incoming)
        .await
        .expect("complete read must succeed");
    assert_eq!(complete.unread_count, 0);
    let non_regressing = database
        .mark_direct_conversation_read(first, older_conversation.id, first_incoming)
        .await
        .expect("older read targets must be idempotent");
    assert_eq!(non_regressing.last_read_message_id, second_incoming);
    assert_eq!(non_regressing.unread_count, 0);

    let outsider_read = database
        .mark_direct_conversation_read(third, older_conversation.id, second_incoming)
        .await
        .expect_err("non-participant read state must be hidden");
    assert!(matches!(
        outsider_read,
        MarkConversationReadError::ConversationUnavailable
    ));

    database
        .archive_direct_conversation(first, older_conversation.id)
        .await
        .expect("conversation must archive");
    assert!(
        database
            .list_direct_conversations(first, None, 20)
            .await
            .expect("archived conversation list must load")
            .iter()
            .all(|item| item.id != older_conversation.id)
    );
    send(&database, older_conversation.id, second, 203, "restore").await;
    assert!(
        database
            .list_direct_conversations(first, None, 20)
            .await
            .expect("restored conversation list must load")
            .iter()
            .any(|item| item.id == older_conversation.id)
    );
    let outsider_archive = database
        .archive_direct_conversation(third, older_conversation.id)
        .await
        .expect_err("non-participants must not archive conversations");
    assert!(matches!(
        outsider_archive,
        ArchiveConversationError::ConversationUnavailable
    ));
    let first_audit_actions = sqlx::query_as::<_, (String, i64)>(
        "SELECT action, COUNT(*) FROM admin_audit_log
         WHERE actor_id = $1 GROUP BY action ORDER BY action",
    )
    .bind(first)
    .fetch_all(&pool)
    .await
    .expect("read and archive audit counts must be readable");
    assert_eq!(
        first_audit_actions,
        vec![
            ("conversation.archive".to_owned(), 1),
            ("conversation.create".to_owned(), 2),
            ("conversation.read".to_owned(), 2),
        ]
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn late_send_failure_rolls_back_message_activity_and_idempotency(pool: PgPool) {
    let first = fixture_id(1);
    let second = fixture_id(2);
    insert_user(&pool, first, "first", "active").await;
    insert_user(&pool, second, "second", "active").await;
    let database = Database::from_pool(pool.clone());
    let conversation = database
        .create_direct_conversation(first, second, fixture_id(101))
        .await
        .expect("conversation must create");
    sqlx::query(
        "UPDATE conversation_members SET unread_count = 9223372036854775807 WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(conversation.id)
    .bind(second)
    .execute(&pool)
    .await
    .expect("overflow fixture must update");

    let error = database
        .send_direct_message(
            NewDirectMessageRecord {
                id: fixture_id(201),
                conversation_id: conversation.id,
                sender_id: first,
                content: "must roll back".to_owned(),
            },
            Some(IdempotencyInput {
                key: "rollback-key".to_owned(),
                request_hash: vec![3; 32],
            }),
        )
        .await
        .expect_err("unread overflow must fail the transaction");
    assert!(matches!(error, SendDirectMessageError::Database(_)));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM direct_messages")
            .fetch_one(&pool)
            .await
            .expect("message count must be readable"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM idempotency_records")
            .fetch_one(&pool)
            .await
            .expect("idempotency count must be readable"),
        0
    );
    assert!(
        sqlx::query_scalar::<_, Option<time::OffsetDateTime>>(
            "SELECT last_message_at FROM direct_conversations WHERE id = $1",
        )
        .bind(conversation.id)
        .fetch_one(&pool)
        .await
        .expect("conversation activity must be readable")
        .is_none()
    );
}

async fn send(
    database: &Database,
    conversation_id: Uuid,
    sender_id: Uuid,
    id: u128,
    content: &str,
) -> Uuid {
    database
        .send_direct_message(
            NewDirectMessageRecord {
                id: fixture_id(id),
                conversation_id,
                sender_id,
                content: content.to_owned(),
            },
            None,
        )
        .await
        .expect("message fixture must send")
        .message
        .id
}

fn fixture_id(value: u128) -> Uuid {
    Uuid::from_u128(0x019fc900_0000_7000_8000_000000000000 | value)
}

async fn insert_user(pool: &PgPool, id: Uuid, username: &str, status: &str) {
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name, status) \
         VALUES ($1, $2, $2 || '@example.com', $2, $3)",
    )
    .bind(id)
    .bind(username)
    .bind(status)
    .execute(pool)
    .await
    .expect("user fixture must insert");
}
