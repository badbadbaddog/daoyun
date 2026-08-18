use infrastructure::{
    BoardUserRestrictionAction, BoardUserRestrictionMutationError, Database,
    PutBoardUserRestrictionRecord,
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
