use infrastructure::{
    BoardUserRestrictionAction, BoardUserRestrictionMutationError, CreateTopicError, Database,
    IdempotencyInput, NewTopicRecord, PutBoardUserRestrictionRecord, UpdateAdminBoardRecord,
};
use sqlx::{PgPool, types::Uuid};
use time::OffsetDateTime;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn board_user_restrictions_are_revisioned_expiring_and_dynamically_scoped(pool: PgPool) {
    let actor = fixture_id(1);
    let target = fixture_id(2);
    let root = fixture_id(11);
    let child = fixture_id(12);
    let other_root = fixture_id(13);
    insert_user(&pool, actor, "moderator").await;
    insert_user(&pool, target, "member").await;
    insert_board(&pool, root, "root", None).await;
    insert_board(&pool, child, "child", Some(root)).await;
    insert_board(&pool, other_root, "other", None).await;
    grant_scoped_restriction_permission(&pool, actor, root).await;
    let database = Database::from_pool(pool.clone());
    let starts_at = OffsetDateTime::from_unix_timestamp(1_786_742_400)
        .expect("fixture timestamp must be valid");
    let ends_at = OffsetDateTime::from_unix_timestamp(1_786_828_800)
        .expect("fixture timestamp must be valid");

    let created = database
        .put_board_user_restriction(PutBoardUserRestrictionRecord {
            board_id: child,
            target_user_id: target,
            actor_id: actor,
            actions: vec![
                BoardUserRestrictionAction::TopicCreate,
                BoardUserRestrictionAction::ReplyCreate,
                BoardUserRestrictionAction::AttachmentUpload,
            ],
            starts_at,
            ends_at: Some(ends_at),
            reason: "temporary board restriction".to_owned(),
            expected_revision: None,
        })
        .await
        .expect("restriction must be created in a subtree scope");
    assert_eq!(created.revision, 1);
    assert!(
        database
            .is_board_user_action_restricted(target, child, "topic.create", starts_at)
            .await
            .expect("effective restriction must resolve")
    );
    assert!(
        !database
            .is_board_user_action_restricted(target, root, "topic.create", starts_at)
            .await
            .expect("restriction must not leak to another board")
    );
    assert!(
        !database
            .is_board_user_action_restricted(target, child, "topic.create", ends_at)
            .await
            .expect("restriction must expire at the exclusive boundary")
    );

    let self_restriction = database
        .put_board_user_restriction(PutBoardUserRestrictionRecord {
            board_id: child,
            target_user_id: actor,
            actor_id: actor,
            actions: vec![BoardUserRestrictionAction::ReplyCreate],
            starts_at,
            ends_at: None,
            reason: "self".to_owned(),
            expected_revision: None,
        })
        .await
        .expect_err("moderators must not restrict themselves");
    assert!(matches!(
        self_restriction,
        BoardUserRestrictionMutationError::ProtectedTarget
    ));

    sqlx::query("UPDATE boards SET parent_id = $2 WHERE id = $1")
        .bind(child)
        .bind(other_root)
        .execute(&pool)
        .await
        .expect("board move fixture must update");
    let after_move = database
        .put_board_user_restriction(PutBoardUserRestrictionRecord {
            board_id: child,
            target_user_id: target,
            actor_id: actor,
            actions: vec![BoardUserRestrictionAction::TopicCreate],
            starts_at,
            ends_at: Some(ends_at),
            reason: "stale scope".to_owned(),
            expected_revision: Some(1),
        })
        .await
        .expect_err("moved board must leave the old subtree scope immediately");
    assert!(matches!(
        after_move,
        BoardUserRestrictionMutationError::Forbidden
    ));
}

fn fixture_id(value: u128) -> Uuid {
    Uuid::from_u128(0x019f_c800_0000_7000_8000_0000_0000_0000 + value)
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

async fn insert_board(pool: &PgPool, id: Uuid, slug: &str, parent_id: Option<Uuid>) {
    sqlx::query(
        "INSERT INTO boards (id, slug, name, visibility, parent_id)
         VALUES ($1, $2, $2, 'public', $3)",
    )
    .bind(id)
    .bind(slug)
    .bind(parent_id)
    .execute(pool)
    .await
    .expect("board fixture must insert");
}

async fn grant_scoped_restriction_permission(pool: &PgPool, user_id: Uuid, board_id: Uuid) {
    let role_id = fixture_id(201);
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope)
         VALUES ($1, 'board_restrictor', 'Board restrictor', 'board')",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("role fixture must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions
         WHERE permission_key = 'moderation.user.restrict_in_scope'",
    )
    .bind(role_id)
    .execute(pool)
    .await
    .expect("restriction permission must assign");
    sqlx::query(
        "INSERT INTO role_assignments
            (id, user_id, role_id, assigned_by, scope_id, scope_mode)
         VALUES ($1, $2, $3, $2, $4, 'subtree')",
    )
    .bind(fixture_id(202))
    .bind(user_id)
    .bind(role_id)
    .bind(board_id)
    .execute(pool)
    .await
    .expect("restriction assignment must insert");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn scoped_restriction_and_publication_do_not_deadlock_on_the_author(pool: PgPool) {
    let actor = fixture_id(1);
    let author = fixture_id(2);
    let board = fixture_id(11);
    insert_user(&pool, actor, "counter_moderator").await;
    insert_user(&pool, author, "counter_member").await;
    insert_board(&pool, board, "counter-board", None).await;
    grant_scoped_restriction_permission(&pool, actor, board).await;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(author)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let database = Database::from_pool(pool.clone());
    let publisher = database.clone();
    let input = NewTopicRecord {
        id: fixture_id(31),
        board_id: Some(board),
        author_id: author,
        title: "Concurrent restriction and publication".to_owned(),
        excerpt: "Counter".to_owned(),
        content: "Publish before the queued restriction".to_owned(),
        rich_content: None,
        tags: Vec::new(),
    };
    let publish_input = input.clone();
    let publication = tokio::spawn(async move {
        publisher
            .create_published_topic(
                publish_input,
                Some(IdempotencyInput {
                    key: "restriction-counter-race".to_owned(),
                    request_hash: vec![1; 32],
                }),
            )
            .await
    });
    wait_for_lock_waiters(&pool, "%FROM users%", 1).await;
    let moderator = database.clone();
    let restriction = tokio::spawn(async move {
        moderator
            .put_board_user_restriction(PutBoardUserRestrictionRecord {
                board_id: board,
                target_user_id: author,
                actor_id: actor,
                actions: vec![BoardUserRestrictionAction::TopicCreate],
                starts_at: OffsetDateTime::now_utc(),
                ends_at: None,
                reason: "queued restriction".to_owned(),
                expected_revision: None,
            })
            .await
    });
    // Publication queues for the user first; the scoped restriction holds its board guard.
    wait_for_lock_waiters(&pool, "%FROM users%", 2).await;
    blocker.commit().await.unwrap();
    assert!(
        publication
            .await
            .unwrap()
            .expect("publication must not deadlock with the scope guard")
            .created
    );
    assert_eq!(
        restriction
            .await
            .unwrap()
            .expect("restriction must finish after publication")
            .revision,
        1
    );
    let counts: (i64,i64,i64) = sqlx::query_as("SELECT topic_count, (SELECT used FROM community_quota_usage WHERE user_id=$2 AND quota_key='topic.create.daily'), (SELECT count(*) FROM idempotency_records WHERE user_id=$2) FROM boards WHERE id=$1")
        .bind(board).bind(author).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (1, 1, 1));
    assert!(matches!(
        database
            .create_published_topic(
                NewTopicRecord {
                    id: fixture_id(32),
                    ..input
                },
                None
            )
            .await,
        Err(CreateTopicError::BoardRestricted)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn scoped_restriction_guard_still_blocks_board_reparenting(pool: PgPool) {
    let actor = fixture_id(1);
    let target = fixture_id(2);
    let root = fixture_id(11);
    let child = fixture_id(12);
    let other = fixture_id(13);
    insert_user(&pool, actor, "move_moderator").await;
    insert_user(&pool, target, "move_member").await;
    insert_board(&pool, root, "move-root", None).await;
    insert_board(&pool, child, "move-child", Some(root)).await;
    insert_board(&pool, other, "move-other", None).await;
    grant_scoped_restriction_permission(&pool, actor, root).await;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(target)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let database = Database::from_pool(pool.clone());
    let input = PutBoardUserRestrictionRecord {
        board_id: child,
        target_user_id: target,
        actor_id: actor,
        actions: vec![BoardUserRestrictionAction::TopicCreate],
        starts_at: OffsetDateTime::now_utc(),
        ends_at: None,
        reason: "scope guard".to_owned(),
        expected_revision: None,
    };
    let moderator = database.clone();
    let restriction_input = input.clone();
    let restriction = tokio::spawn(async move {
        moderator
            .put_board_user_restriction(restriction_input)
            .await
    });
    wait_for_lock_waiters(&pool, "%FROM users%", 1).await;
    let administrator = database.clone();
    let movement = tokio::spawn(async move {
        administrator
            .update_admin_board(
                actor,
                UpdateAdminBoardRecord {
                    id: child,
                    parent_id: Some(other),
                    slug: "move-child".to_owned(),
                    name: "move-child".to_owned(),
                    description: String::new(),
                    icon: "messages-square".to_owned(),
                    tone: "blue".to_owned(),
                    position: 0,
                    visibility: "public".to_owned(),
                    status: "open".to_owned(),
                    expected_revision: 1,
                },
            )
            .await
    });
    wait_for_lock_waiters(&pool, "%FROM boards%", 1).await;
    assert!(
        !movement.is_finished(),
        "scope hierarchy must remain locked until the restriction commits"
    );
    blocker.commit().await.unwrap();
    restriction
        .await
        .unwrap()
        .expect("restriction must commit in its original scope");
    let moved = movement
        .await
        .unwrap()
        .expect("board move must finish after the scope guard releases");
    assert_eq!(moved.parent_id, Some(other));
    assert!(matches!(
        database
            .put_board_user_restriction(PutBoardUserRestrictionRecord {
                expected_revision: Some(1),
                ..input
            })
            .await,
        Err(BoardUserRestrictionMutationError::Forbidden)
    ));
}

async fn wait_for_lock_waiters(pool: &PgPool, pattern: &str, expected: i64) {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1")
                .bind(pattern).fetch_one(pool).await.unwrap();
            if waiting >= expected { break; }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }).await.expect("expected transactions must reach their blocked row locks");
}
