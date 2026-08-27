use infrastructure::{
    AdminUserReadError, BlockMutationError, Database, FollowMutationError, ListUserRelationsError,
    UpdateAdminUserStatusError, UpdateAdminUserStatusRecord, UpdateUserProfileError,
    UpdateUserProfileRecord, UserRelationKind,
};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};
use time::{Duration, OffsetDateTime};

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_profiles_count_only_visible_topics_and_update_with_revision_control(pool: PgPool) {
    let viewer = fixture_id(1);
    let target = fixture_id(2);
    let public_board = fixture_id(11);
    let hidden_board = fixture_id(12);
    insert_user(&pool, viewer, "viewer", "active").await;
    insert_user(&pool, target, "target", "active").await;
    insert_board(&pool, public_board, "public-board", "public").await;
    insert_board(&pool, hidden_board, "hidden-board", "hidden").await;
    insert_topic(
        &pool,
        fixture_id(101),
        public_board,
        target,
        "published",
        false,
    )
    .await;
    insert_topic(
        &pool,
        fixture_id(102),
        hidden_board,
        target,
        "published",
        false,
    )
    .await;
    insert_topic(
        &pool,
        fixture_id(103),
        public_board,
        target,
        "hidden",
        false,
    )
    .await;
    let database = Database::from_pool(pool.clone());

    let anonymous = database
        .public_user_profile("target", None)
        .await
        .expect("anonymous profile lookup must succeed")
        .expect("active profile must be public");
    assert_eq!(anonymous.topic_count, 1);
    assert!(anonymous.viewer.is_none());
    assert_eq!(anonymous.follower_count, 0);

    let viewed = database
        .public_user_profile("target", Some(viewer))
        .await
        .expect("viewer profile lookup must succeed")
        .expect("active profile must be public");
    let viewer_state = viewed
        .viewer
        .expect("authenticated viewer state must exist");
    assert!(!viewer_state.is_self);
    assert!(!viewer_state.is_following);
    assert!(viewer_state.can_message);

    let revision = database
        .update_user_profile(UpdateUserProfileRecord {
            user_id: target,
            base_revision: 1,
            display_name: "目标用户".to_owned(),
            bio: "公开简介".to_owned(),
            location: Some("杭州".to_owned()),
            website_url: Some("https://example.com".to_owned()),
            avatar_url: Some("https://example.com/avatar.png".to_owned()),
        })
        .await
        .expect("matching profile revision must update");
    assert_eq!(revision, 2);
    let profile_audit = sqlx::query_as::<_, (String, String, Option<Uuid>, Value)>(
        "SELECT action, resource_type, resource_id, summary
         FROM admin_audit_log WHERE actor_id = $1",
    )
    .bind(target)
    .fetch_one(&pool)
    .await
    .expect("profile audit must be readable");
    assert_eq!(
        profile_audit,
        (
            "user.profile.update".to_owned(),
            "user".to_owned(),
            Some(target),
            json!({"revision": 2}),
        )
    );
    assert!(!profile_audit.3.to_string().contains("目标用户"));

    let updated = database
        .public_user_profile("target", Some(target))
        .await
        .expect("updated profile lookup must succeed")
        .expect("updated profile must remain public");
    assert_eq!(updated.display_name, "目标用户");
    assert_eq!(updated.bio, "公开简介");
    assert_eq!(updated.profile_revision, 2);
    assert!(
        updated
            .viewer
            .expect("owner viewer state must exist")
            .is_self
    );

    let conflict = database
        .update_user_profile(UpdateUserProfileRecord {
            user_id: target,
            base_revision: 1,
            display_name: "陈旧修改".to_owned(),
            bio: String::new(),
            location: None,
            website_url: None,
            avatar_url: None,
        })
        .await
        .expect_err("stale profile revision must conflict");
    assert!(matches!(conflict, UpdateUserProfileError::RevisionConflict));

    sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
        .bind(target)
        .execute(&pool)
        .await
        .expect("target suspension fixture must update");
    assert!(
        database
            .public_user_profile("target", Some(viewer))
            .await
            .expect("suspended lookup must not fail")
            .is_none()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn follow_and_block_mutations_are_idempotent_and_keep_counts_consistent(pool: PgPool) {
    let follower = fixture_id(1);
    let target = fixture_id(2);
    insert_user(&pool, follower, "follower", "active").await;
    insert_user(&pool, target, "target", "active").await;
    let database = Database::from_pool(pool.clone());

    let followed = database
        .set_user_following(follower, target, true)
        .await
        .expect("first follow must succeed");
    assert!(followed.following);
    assert_eq!((followed.follower_count, followed.following_count), (1, 1));

    let repeated = database
        .set_user_following(follower, target, true)
        .await
        .expect("repeated follow must be idempotent");
    assert_eq!((repeated.follower_count, repeated.following_count), (1, 1));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM user_follows")
            .fetch_one(&pool)
            .await
            .expect("follow row count must be readable"),
        1
    );

    let self_follow = database
        .set_user_following(follower, follower, true)
        .await
        .expect_err("self follow must be rejected");
    assert!(matches!(self_follow, FollowMutationError::SelfFollow));

    let blocked = database
        .set_user_blocked(target, follower, true)
        .await
        .expect("blocking must succeed");
    assert!(blocked.blocked);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM user_follows")
            .fetch_one(&pool)
            .await
            .expect("cleared follow row count must be readable"),
        0
    );
    let counts = sqlx::query_as::<_, (i64, i64, i64, i64)>(
        "SELECT follower.follower_count, follower.following_count, \
                target.follower_count, target.following_count \
         FROM users AS follower CROSS JOIN users AS target \
         WHERE follower.id = $1 AND target.id = $2",
    )
    .bind(follower)
    .bind(target)
    .fetch_one(&pool)
    .await
    .expect("relationship counts must be readable");
    assert_eq!(counts, (0, 0, 0, 0));

    let hidden_by_block = database
        .set_user_following(follower, target, true)
        .await
        .expect_err("either block direction must hide the target");
    assert!(matches!(
        hidden_by_block,
        FollowMutationError::TargetUnavailable
    ));

    let unblocked = database
        .set_user_blocked(target, follower, false)
        .await
        .expect("unblock must succeed");
    assert!(!unblocked.blocked);
    let repeated_unblock = database
        .set_user_blocked(target, follower, false)
        .await
        .expect("repeated unblock must be idempotent");
    assert!(!repeated_unblock.blocked);

    let repeated_unfollow = database
        .set_user_following(follower, target, false)
        .await
        .expect("repeated unfollow must be idempotent");
    assert!(!repeated_unfollow.following);

    let self_block = database
        .set_user_blocked(target, target, true)
        .await
        .expect_err("self block must be rejected");
    assert!(matches!(self_block, BlockMutationError::SelfBlock));

    let relation_audit = sqlx::query_as::<_, (Uuid, String, Option<Uuid>, Value)>(
        "SELECT actor_id, action, resource_id, summary
         FROM admin_audit_log ORDER BY action, actor_id",
    )
    .fetch_all(&pool)
    .await
    .expect("relation audit rows must be readable");
    assert_eq!(
        relation_audit,
        vec![
            (target, "user.block".to_owned(), Some(follower), json!({})),
            (follower, "user.follow".to_owned(), Some(target), json!({})),
            (target, "user.unblock".to_owned(), Some(follower), json!({}),),
        ]
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn relationship_lists_are_visibility_filtered_and_stably_paginated(pool: PgPool) {
    let owner = fixture_id(1);
    let older_follower = fixture_id(2);
    let newer_follower = fixture_id(3);
    let suspended_follower = fixture_id(4);
    let followed_user = fixture_id(5);
    for (id, username, status) in [
        (owner, "owner", "active"),
        (older_follower, "older", "active"),
        (newer_follower, "newer", "active"),
        (suspended_follower, "suspended", "suspended"),
        (followed_user, "followed", "active"),
    ] {
        insert_user(&pool, id, username, status).await;
    }
    for (follower_id, followed_id, created_at) in [
        (older_follower, owner, "2026-08-03T10:00:00Z"),
        (newer_follower, owner, "2026-08-03T10:00:00Z"),
        (suspended_follower, owner, "2026-08-03T11:00:00Z"),
        (owner, followed_user, "2026-08-03T12:00:00Z"),
    ] {
        sqlx::query(
            "INSERT INTO user_follows (follower_id, followed_id, created_at) \
             VALUES ($1, $2, $3::timestamptz)",
        )
        .bind(follower_id)
        .bind(followed_id)
        .bind(created_at)
        .execute(&pool)
        .await
        .expect("follow fixture must insert");
    }
    let database = Database::from_pool(pool.clone());

    let first_page = database
        .list_user_relations("owner", UserRelationKind::Followers, None, 1)
        .await
        .expect("first follower page must load")
        .expect("active owner must be visible");
    assert_eq!(first_page.len(), 1);
    assert_eq!(first_page[0].id, newer_follower);

    let second_page = database
        .list_user_relations(
            "owner",
            UserRelationKind::Followers,
            Some(newer_follower),
            2,
        )
        .await
        .expect("second follower page must load")
        .expect("active owner must stay visible");
    assert_eq!(
        second_page.iter().map(|user| user.id).collect::<Vec<_>>(),
        vec![older_follower]
    );

    let following = database
        .list_user_relations("owner", UserRelationKind::Following, None, 20)
        .await
        .expect("following page must load")
        .expect("active owner must be visible");
    assert_eq!(following.len(), 1);
    assert_eq!(following[0].id, followed_user);

    let invalid_cursor = database
        .list_user_relations(
            "owner",
            UserRelationKind::Followers,
            Some(followed_user),
            20,
        )
        .await
        .expect_err("cursor from the other relation direction must fail");
    assert!(matches!(
        invalid_cursor,
        ListUserRelationsError::InvalidCursor
    ));

    sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
        .bind(owner)
        .execute(&pool)
        .await
        .expect("owner suspension fixture must update");
    assert!(
        database
            .list_user_relations("owner", UserRelationKind::Followers, None, 20)
            .await
            .expect("hidden owner lookup must not fail")
            .is_none()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_user_read_model_searches_and_pages_without_exposing_credentials(pool: PgPool) {
    let administrator = fixture_id(700);
    let target = fixture_id(701);
    let board = fixture_id(702);
    let role = fixture_id(703);
    let topic = fixture_id(704);
    let reply = fixture_id(705);
    let report = fixture_id(706);
    insert_user(&pool, administrator, "administrator", "active").await;
    insert_user(&pool, target, "targetuser", "restricted").await;
    insert_board(&pool, board, "admin-users", "public").await;
    sqlx::query("UPDATE users SET display_name = '目标成员', restriction_reason = '等待人工复核' WHERE id = $1")
        .bind(target).execute(&pool).await.expect("admin user fixture must update");
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope) VALUES ($1, 'moderator', '版主', 'site')",
    )
    .bind(role)
    .execute(&pool)
    .await
    .expect("role fixture must insert");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by) VALUES ($1, $2, $3, $4)",
    )
    .bind(fixture_id(707))
    .bind(target)
    .bind(role)
    .bind(administrator)
    .execute(&pool)
    .await
    .expect("role assignment fixture must insert");
    insert_topic(&pool, topic, board, target, "published", false).await;
    sqlx::query("INSERT INTO posts (id, topic_id, author_id, kind, content, status, floor_number) VALUES ($1, $2, $3, 'reply', '回复内容', 'published', 1)")
        .bind(reply).bind(topic).bind(target).execute(&pool).await.expect("reply fixture must insert");
    sqlx::query("INSERT INTO content_reports (id, reporter_id, target_type, target_id, reason) VALUES ($1, $2, 'topic', $3, 'spam')")
        .bind(report).bind(administrator).bind(topic).execute(&pool).await.expect("report fixture must insert");
    let database = Database::from_pool(pool.clone());

    let users = database
        .list_admin_users(
            Some("目标"),
            Some("restricted"),
            Some(role),
            None,
            None,
            None,
            20,
        )
        .await
        .expect("admin user search must succeed");
    assert_eq!(users.len(), 1);
    assert_eq!(users[0].id, target);
    assert_eq!(users[0].topic_count, 1);
    assert_eq!(users[0].post_count, 1);
    assert_eq!(users[0].report_count, 1);

    let detail = database
        .admin_user_detail(target)
        .await
        .expect("detail lookup must succeed")
        .expect("target must exist");
    assert_eq!(detail.summary.status, "restricted");
    assert_eq!(detail.restriction_reason.as_deref(), Some("等待人工复核"));
    assert_eq!(detail.roles.len(), 1);
    assert_eq!(detail.roles[0].key, "moderator");

    let content = database
        .list_admin_user_content(target, None, 20)
        .await
        .expect("content list must succeed");
    assert_eq!(content.len(), 2);
    assert_eq!(
        content
            .iter()
            .map(|item| item.kind.as_str())
            .collect::<Vec<_>>(),
        vec!["reply", "topic"]
    );

    let reports = database
        .list_admin_user_reports(target, None, 20)
        .await
        .expect("report list must succeed");
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].id, report);

    let invalid_cursor = database
        .list_admin_user_content(target, Some(fixture_id(999)), 20)
        .await
        .expect_err("foreign cursor must fail");
    assert!(matches!(invalid_cursor, AdminUserReadError::InvalidCursor));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_user_status_update_is_atomic_revisioned_and_protects_the_last_super_admin(
    pool: PgPool,
) {
    let actor = fixture_id(800);
    let target = fixture_id(801);
    let protected_admin = fixture_id(802);
    let moderator_role = fixture_id(803);
    let super_admin_role = fixture_id(804);
    insert_user(&pool, actor, "moderator", "active").await;
    insert_user(&pool, target, "managed", "active").await;
    insert_user(&pool, protected_admin, "protected", "active").await;
    sqlx::query("INSERT INTO roles (id, key, name, scope, is_system) VALUES ($1, 'moderator_role', 'Moderator', 'site', false), ($2, 'super_admin', 'Super administrator', 'instance', true)")
        .bind(moderator_role).bind(super_admin_role).execute(&pool).await.expect("roles must insert");
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = 'admin.users.moderate'")
        .bind(moderator_role).execute(&pool).await.expect("moderation permission must assign");
    sqlx::query("INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id) VALUES ($1, $2, $3, $2, NULL), ($4, $5, $6, $5, NULL)")
        .bind(fixture_id(805)).bind(actor).bind(moderator_role)
        .bind(fixture_id(806)).bind(protected_admin).bind(super_admin_role)
        .execute(&pool).await.expect("role assignments must insert");
    let database = Database::from_pool(pool.clone());
    let expires_at = OffsetDateTime::now_utc() + Duration::days(7);

    let update = database
        .update_admin_user_status(UpdateAdminUserStatusRecord {
            actor_id: actor,
            target_user_id: target,
            status: "restricted".to_owned(),
            reason: "需要完成内容复核".to_owned(),
            expires_at: Some(expires_at),
            expected_revision: 1,
        })
        .await
        .expect("authorized restriction must commit");
    assert_eq!(update.status, "restricted");
    assert_eq!(update.revision, 2);
    assert_eq!(update.reason.as_deref(), Some("需要完成内容复核"));
    assert_eq!(update.actor.id, actor);

    let stored = sqlx::query_as::<_, (String, Option<String>, Option<OffsetDateTime>, i64)>(
        "SELECT status, restriction_reason, restriction_expires_at, admin_revision FROM users WHERE id = $1",
    )
    .bind(target)
    .fetch_one(&pool)
    .await
    .expect("updated user must be readable");
    assert_eq!(stored.0, "restricted");
    assert_eq!(stored.1.as_deref(), Some("需要完成内容复核"));
    assert_eq!(stored.3, 2);
    assert!(stored.2.is_some());
    let audit = sqlx::query_as::<_, (Uuid, String, Option<Uuid>, Value)>(
        "SELECT id, action, resource_id, summary FROM admin_audit_log WHERE id = $1",
    )
    .bind(update.audit_id)
    .fetch_one(&pool)
    .await
    .expect("status audit must commit");
    assert_eq!(audit.1, "user.status.update");
    assert_eq!(audit.2, Some(target));
    assert_eq!(audit.3["new_status"], "restricted");
    let outbox_payload = sqlx::query_scalar::<_, Value>(
        "SELECT payload FROM outbox_events WHERE event_type = 'user.status_changed' AND aggregate_id = $1",
    )
    .bind(target)
    .fetch_one(&pool)
    .await
    .expect("status outbox event must commit");
    assert_eq!(outbox_payload["revision"], 2);

    let conflict = database
        .update_admin_user_status(UpdateAdminUserStatusRecord {
            actor_id: actor,
            target_user_id: target,
            status: "active".to_owned(),
            reason: String::new(),
            expires_at: None,
            expected_revision: 1,
        })
        .await
        .expect_err("stale revision must not overwrite the restriction");
    assert!(matches!(conflict, UpdateAdminUserStatusError::Conflict));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT admin_revision FROM users WHERE id = $1")
            .bind(target)
            .fetch_one(&pool)
            .await
            .expect("revision must be readable"),
        2
    );

    let last_admin = database
        .update_admin_user_status(UpdateAdminUserStatusRecord {
            actor_id: actor,
            target_user_id: protected_admin,
            status: "suspended".to_owned(),
            reason: "安全处置".to_owned(),
            expires_at: None,
            expected_revision: 1,
        })
        .await
        .expect_err("the final active super administrator must be protected");
    assert!(matches!(
        last_admin,
        UpdateAdminUserStatusError::LastSuperAdmin
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn expired_user_restrictions_restore_once_with_audit_and_outbox(pool: PgPool) {
    let actor = fixture_id(820);
    let expired = fixture_id(821);
    let future = fixture_id(822);
    insert_user(&pool, actor, "expiry_actor", "active").await;
    insert_user(&pool, expired, "expired_user", "restricted").await;
    insert_user(&pool, future, "future_user", "suspended").await;
    sqlx::query(
        "UPDATE users
         SET restriction_reason = 'temporary restriction',
             restriction_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute',
             admin_revision = 2
         WHERE id = $1",
    )
    .bind(expired)
    .execute(&pool)
    .await
    .expect("expired fixture must update");
    sqlx::query(
        "UPDATE users
         SET restriction_reason = 'future suspension',
             restriction_expires_at = CURRENT_TIMESTAMP + INTERVAL '1 day',
             admin_revision = 2
         WHERE id = $1",
    )
    .bind(future)
    .execute(&pool)
    .await
    .expect("future fixture must update");
    sqlx::query(
        "INSERT INTO admin_audit_log (id, actor_id, action, resource_type, resource_id, summary)
         VALUES ($1, $2, 'user.status.update', 'user', $3, '{}'::jsonb)",
    )
    .bind(fixture_id(823))
    .bind(actor)
    .bind(expired)
    .execute(&pool)
    .await
    .expect("source status audit must insert");
    let database = Database::from_pool(pool.clone());

    assert_eq!(
        database
            .expire_admin_user_statuses(100)
            .await
            .expect("expiry sweep must succeed"),
        1
    );
    let restored = sqlx::query_as::<_, (String, Option<String>, Option<OffsetDateTime>, i64)>(
        "SELECT status, restriction_reason, restriction_expires_at, admin_revision FROM users WHERE id = $1",
    )
    .bind(expired)
    .fetch_one(&pool)
    .await
    .expect("restored user must be readable");
    assert_eq!(restored, ("active".to_owned(), None, None, 3));
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM users WHERE id = $1")
            .bind(future)
            .fetch_one(&pool)
            .await
            .expect("future user status must be readable"),
        "suspended"
    );
    let audit = sqlx::query_as::<_, (Uuid, String, Value)>(
        "SELECT actor_id, action, summary FROM admin_audit_log
         WHERE resource_id = $1 AND action = 'user.status.expire'",
    )
    .bind(expired)
    .fetch_one(&pool)
    .await
    .expect("expiry audit must be readable");
    assert_eq!(audit.0, actor);
    assert_eq!(audit.1, "user.status.expire");
    assert_eq!(audit.2["revision"], 3);
    let payload = sqlx::query_scalar::<_, Value>(
        "SELECT payload FROM outbox_events
         WHERE event_type = 'user.status_changed' AND aggregate_id = $1",
    )
    .bind(expired)
    .fetch_one(&pool)
    .await
    .expect("expiry outbox event must be readable");
    assert_eq!(payload["status"], "active");
    assert_eq!(payload["reason"], "restriction_expired");
    assert_eq!(payload["revision"], 3);
    assert_eq!(
        database
            .expire_admin_user_statuses(100)
            .await
            .expect("repeated expiry sweep must succeed"),
        0
    );
}

fn fixture_id(value: u128) -> Uuid {
    Uuid::from_u128(0x019f_c900_0000_7000_8000_0000_0000_0000 + value)
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

async fn insert_board(pool: &PgPool, id: Uuid, slug: &str, visibility: &str) {
    sqlx::query("INSERT INTO boards (id, slug, name, visibility) VALUES ($1, $2, $2, $3)")
        .bind(id)
        .bind(slug)
        .bind(visibility)
        .execute(pool)
        .await
        .expect("board fixture must insert");
}

async fn insert_topic(
    pool: &PgPool,
    id: Uuid,
    board_id: Uuid,
    author_id: Uuid,
    status: &str,
    deleted: bool,
) {
    sqlx::query(
        "INSERT INTO topics (\
             id, board_id, author_id, title, content, status, published_at, last_activity_at, deleted_at\
         ) VALUES (\
             $1, $2, $3, $1::text, 'content', $4, \
             CASE WHEN $4 = 'published' THEN '2026-08-03T10:00:00Z'::timestamptz END, \
             '2026-08-03T10:00:00Z'::timestamptz, \
             CASE WHEN $5 THEN '2026-08-03T11:00:00Z'::timestamptz END\
         )",
    )
    .bind(id)
    .bind(board_id)
    .bind(author_id)
    .bind(status)
    .bind(deleted)
    .execute(pool)
    .await
    .expect("topic fixture must insert");
}
