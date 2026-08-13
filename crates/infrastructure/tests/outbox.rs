use infrastructure::{Database, MIGRATOR, NewOutboxEvent, OutboxError, OutboxEventDisposition};
use serde_json::json;
use sqlx::{PgPool, Row};
use std::time::Duration;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn outbox_migration_applies_and_rolls_back(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");
    let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass('outbox_events') IS NOT NULL")
        .fetch_one(&pool)
        .await
        .expect("outbox table lookup must succeed");
    assert!(exists);

    MIGRATOR
        .undo(&pool, 202608080004)
        .await
        .expect("outbox migration must roll back");
    let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass('outbox_events') IS NOT NULL")
        .fetch_one(&pool)
        .await
        .expect("rolled-back outbox table lookup must succeed");
    assert!(!exists);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn outbox_constraints_reject_invalid_state_and_payload(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let invalid_input = database
        .enqueue_outbox_event(NewOutboxEvent {
            event_type: "Invalid Type".to_owned(),
            ..event(Uuid::now_v7(), "invalid-input", 3)
        })
        .await;
    assert!(matches!(invalid_input, Err(OutboxError::InvalidInput)));
    let invalid_claim = database
        .claim_outbox_events(0, Duration::from_secs(30))
        .await;
    assert!(matches!(invalid_claim, Err(OutboxError::InvalidInput)));

    let event_id = Uuid::now_v7();
    let invalid_type = sqlx::query(
        "INSERT INTO outbox_events
         (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload)
         VALUES ($1, 'Invalid Type', 'topic', $2, 'invalid-type', '{}'::jsonb)",
    )
    .bind(event_id)
    .bind(Uuid::now_v7())
    .execute(&pool)
    .await;
    assert!(invalid_type.is_err());

    let invalid_state = sqlx::query(
        "INSERT INTO outbox_events
         (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload, status)
         VALUES ($1, 'topic.published', 'topic', $2, 'invalid-state', '{}'::jsonb, 'processing')",
    )
    .bind(Uuid::now_v7())
    .bind(Uuid::now_v7())
    .execute(&pool)
    .await;
    assert!(invalid_state.is_err());

    let null_payload = sqlx::query(
        "INSERT INTO outbox_events
         (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload)
         VALUES ($1, 'topic.published', 'topic', $2, 'null-payload', 'null'::jsonb)",
    )
    .bind(Uuid::now_v7())
    .bind(Uuid::now_v7())
    .execute(&pool)
    .await;
    assert!(null_payload.is_err());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn enqueue_is_idempotent_and_composes_with_transactions(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let aggregate_id = Uuid::now_v7();
    let input = event(aggregate_id, "topic-1", 3);

    let (first, replay) = tokio::join!(
        database.enqueue_outbox_event(input.clone()),
        database.enqueue_outbox_event(input.clone())
    );
    let first = first.expect("first enqueue must succeed");
    let replay = replay.expect("concurrent replay must succeed");
    assert_eq!(first.id, replay.id);
    assert_eq!(first.attempts, 0);

    let conflict = database
        .enqueue_outbox_event(NewOutboxEvent {
            payload: json!({ "topic_id": aggregate_id, "changed": true }),
            ..input.clone()
        })
        .await;
    assert!(matches!(conflict, Err(OutboxError::IdempotencyConflict)));

    let mut transaction = pool.begin().await.expect("transaction must begin");
    let rolled_back = database
        .enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                dedupe_key: "topic-rollback".to_owned(),
                ..input
            },
        )
        .await
        .expect("transactional enqueue must succeed");
    transaction.rollback().await.expect("rollback must succeed");

    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM outbox_events WHERE id = $1)")
            .bind(rolled_back.id)
            .fetch_one(&pool)
            .await
            .expect("rollback result must be queryable");
    assert!(!exists);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn claims_use_leases_and_completion_requires_the_owner(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let first = database
        .enqueue_outbox_event(event(Uuid::now_v7(), "claim-1", 3))
        .await
        .expect("first event must enqueue");
    database
        .enqueue_outbox_event(event(Uuid::now_v7(), "claim-2", 3))
        .await
        .expect("second event must enqueue");

    let claimed = database
        .claim_outbox_events(1, Duration::from_secs(30))
        .await
        .expect("first claim must succeed");
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, first.id);
    assert_eq!(claimed[0].attempts, 1);

    let second_claim = database
        .claim_outbox_events(10, Duration::from_secs(30))
        .await
        .expect("second claim must succeed");
    assert_eq!(second_claim.len(), 1);
    assert_ne!(second_claim[0].id, first.id);

    assert!(
        !database
            .complete_outbox_event(first.id, Uuid::now_v7())
            .await
            .expect("wrong-owner completion must be handled")
    );
    assert!(
        database
            .complete_outbox_event(first.id, claimed[0].lock_token)
            .await
            .expect("owner completion must succeed")
    );

    let status =
        sqlx::query("SELECT status, completed_at IS NOT NULL FROM outbox_events WHERE id = $1")
            .bind(first.id)
            .fetch_one(&pool)
            .await
            .expect("completed event must be queryable");
    assert_eq!(status.get::<String, _>(0), "completed");
    assert!(status.get::<bool, _>(1));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn claims_can_be_restricted_to_registered_event_types(pool: PgPool) {
    let database = Database::from_pool(pool);
    let topic = database
        .enqueue_outbox_event(event(Uuid::now_v7(), "filtered-topic", 3))
        .await
        .expect("topic event must enqueue");
    let cache = database
        .enqueue_outbox_event(NewOutboxEvent {
            id: Uuid::now_v7(),
            event_type: "cache.site_branding_invalidated".to_owned(),
            aggregate_type: "site_branding".to_owned(),
            aggregate_id: Uuid::now_v7(),
            dedupe_key: "filtered-cache".to_owned(),
            payload: json!({ "cache_key": "site_branding" }),
            max_attempts: 3,
        })
        .await
        .expect("cache event must enqueue");

    let claimed = database
        .claim_outbox_events_for_types(
            &["cache.site_branding_invalidated".to_owned()],
            10,
            Duration::from_secs(30),
        )
        .await
        .expect("filtered claim must succeed");
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, cache.id);

    let remaining = database
        .claim_outbox_events(10, Duration::from_secs(30))
        .await
        .expect("unfiltered claim must succeed");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, topic.id);

    let invalid = database
        .claim_outbox_events_for_types(&[], 10, Duration::from_secs(30))
        .await;
    assert!(matches!(invalid, Err(OutboxError::InvalidInput)));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn failed_events_retry_then_become_dead_and_expired_leases_are_reclaimed(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let failed_event = database
        .enqueue_outbox_event(event(Uuid::now_v7(), "retry-1", 2))
        .await
        .expect("event must enqueue");

    let first = database
        .claim_outbox_events(1, Duration::from_secs(30))
        .await
        .expect("first claim must succeed")
        .pop()
        .expect("first claim must return the event");
    let disposition = database
        .fail_outbox_event(
            failed_event.id,
            first.lock_token,
            "temporary upstream failure\nsecret detail",
        )
        .await
        .expect("first failure must be recorded");
    assert_eq!(disposition, Some(OutboxEventDisposition::Pending));

    sqlx::query("UPDATE outbox_events SET available_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(failed_event.id)
        .execute(&pool)
        .await
        .expect("retry must become available");
    let second = database
        .claim_outbox_events(1, Duration::from_secs(30))
        .await
        .expect("second claim must succeed")
        .pop()
        .expect("second claim must return the event");
    assert_eq!(second.attempts, 2);
    let disposition = database
        .fail_outbox_event(failed_event.id, second.lock_token, "still unavailable")
        .await
        .expect("second failure must be recorded");
    assert_eq!(disposition, Some(OutboxEventDisposition::Dead));
    assert!(
        database
            .claim_outbox_events(10, Duration::from_secs(30))
            .await
            .expect("dead events must not break claims")
            .is_empty()
    );

    let reclaim = database
        .enqueue_outbox_event(event(Uuid::now_v7(), "reclaim-1", 3))
        .await
        .expect("reclaim event must enqueue");
    let original = database
        .claim_outbox_events(1, Duration::from_secs(30))
        .await
        .expect("original lease must succeed")
        .pop()
        .expect("original lease must contain event");
    sqlx::query(
        "UPDATE outbox_events
         SET locked_until = CURRENT_TIMESTAMP - INTERVAL '1 second'
         WHERE id = $1",
    )
    .bind(reclaim.id)
    .execute(&pool)
    .await
    .expect("lease must expire");
    let reclaimed = database
        .claim_outbox_events(1, Duration::from_secs(30))
        .await
        .expect("expired lease must be reclaimable")
        .pop()
        .expect("reclaimed event must be returned");
    assert_eq!(reclaimed.id, reclaim.id);
    assert_eq!(reclaimed.attempts, 2);
    assert_ne!(reclaimed.lock_token, original.lock_token);
}

fn event(aggregate_id: Uuid, dedupe_key: &str, max_attempts: i16) -> NewOutboxEvent {
    NewOutboxEvent {
        id: Uuid::now_v7(),
        event_type: "topic.published".to_owned(),
        aggregate_type: "topic".to_owned(),
        aggregate_id,
        dedupe_key: dedupe_key.to_owned(),
        payload: json!({ "topic_id": aggregate_id }),
        max_attempts,
    }
}
