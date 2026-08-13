use infrastructure::{Database, InitializeInstallationError, InstallationAdministrator, MIGRATOR};
use sqlx::{PgPool, types::Uuid};

#[sqlx::test(migrations = false)]
async fn migrations_build_an_uninitialized_singleton_from_an_empty_database(pool: PgPool) {
    let database = Database::from_pool(pool.clone());

    database
        .migrate()
        .await
        .expect("an empty database must migrate successfully");

    let states =
        sqlx::query_as::<_, (bool, bool)>("SELECT singleton, is_initialized FROM system_state")
            .fetch_all(&pool)
            .await
            .expect("system state must be queryable after migrations");

    assert_eq!(states, vec![(true, false)]);
    database
        .check_readiness()
        .await
        .expect("a fully migrated database must be ready");
}

#[sqlx::test(migrations = false)]
async fn readiness_rejects_a_database_with_missing_migrations(pool: PgPool) {
    let database = Database::from_pool(pool);

    let error = database
        .check_readiness()
        .await
        .expect_err("an empty database must not be ready");

    assert_eq!(error.to_string(), "database migration state is not current");
    assert!(MIGRATOR.iter().next().is_some());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_status_reads_the_database_singleton(pool: PgPool) {
    let database = Database::from_pool(pool.clone());

    assert!(
        !database
            .installation_status()
            .await
            .expect("fresh installation status must be readable")
    );

    sqlx::query(
        "UPDATE system_state \
         SET is_initialized = TRUE, initialized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
         WHERE singleton",
    )
    .execute(&pool)
    .await
    .expect("fixture must mark the installation initialized");

    assert!(
        database
            .installation_status()
            .await
            .expect("initialized status must be readable")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn identity_foundation_migration_creates_all_required_tables(pool: PgPool) {
    for table in ["users", "password_credentials", "roles", "role_assignments"] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("table lookup must succeed");

        assert!(exists, "{table} must exist after migrations");
    }
}

#[sqlx::test(migrations = false)]
async fn authorization_management_migration_seeds_capabilities_and_rolls_back(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("existing migrations must apply before authorization management");
    MIGRATOR
        .undo(&pool, 202608100001)
        .await
        .expect("authorization management migration must roll back for fixture setup");

    let super_admin_role = Uuid::parse_str("019fd200-0000-7000-8000-000000000001")
        .expect("super administrator role UUID must be valid");
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system) \
         VALUES ($1, 'super_admin', 'Super administrator', 'instance', TRUE)",
    )
    .bind(super_admin_role)
    .execute(&pool)
    .await
    .expect("pre-existing super administrator role must insert");

    MIGRATOR
        .run(&pool)
        .await
        .expect("authorization management migration must apply");

    let revision = sqlx::query_scalar::<_, i64>("SELECT revision FROM roles WHERE id = $1")
        .bind(super_admin_role)
        .fetch_one(&pool)
        .await
        .expect("role revision must be queryable");
    assert_eq!(revision, 1);

    let permission_keys = sqlx::query_scalar::<_, String>(
        "SELECT permission_key FROM permissions \
         WHERE permission_key LIKE 'authorization.%' ORDER BY permission_key",
    )
    .fetch_all(&pool)
    .await
    .expect("authorization permissions must be queryable");
    assert_eq!(
        permission_keys,
        vec![
            "authorization.assignments.read",
            "authorization.assignments.write",
            "authorization.roles.read",
            "authorization.roles.write",
        ]
    );

    let granted = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM role_permissions \
         WHERE role_id = $1 \
           AND permission_id IN (SELECT id FROM permissions WHERE permission_key LIKE 'authorization.%')",
    )
    .bind(super_admin_role)
    .fetch_one(&pool)
    .await
    .expect("super administrator authorization grants must be queryable");
    assert_eq!(granted, 4);

    let invalid_revision = sqlx::query("UPDATE roles SET revision = 0 WHERE id = $1")
        .bind(super_admin_role)
        .execute(&pool)
        .await;
    assert!(
        invalid_revision.is_err(),
        "role revisions must remain positive"
    );

    MIGRATOR
        .undo(&pool, 202608100001)
        .await
        .expect("authorization management migration must roll back");

    let revision_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'revision'
         )",
    )
    .fetch_one(&pool)
    .await
    .expect("role revision column lookup must succeed");
    assert!(
        !revision_exists,
        "role revision must be removed on rollback"
    );

    let permission_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM permissions WHERE permission_key LIKE 'authorization.%'",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back authorization permission count must be readable");
    assert_eq!(permission_count, 0);
}

#[sqlx::test(migrations = false)]
async fn admin_user_migrations_add_status_state_and_capabilities_and_roll_back(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("admin user migrations must apply");

    let columns = sqlx::query_scalar::<_, String>(
        "SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND column_name IN ('admin_revision', 'restriction_reason', 'restriction_expires_at')
         ORDER BY column_name",
    )
    .fetch_all(&pool)
    .await
    .expect("admin user columns must be queryable");
    assert_eq!(
        columns,
        vec![
            "admin_revision",
            "restriction_expires_at",
            "restriction_reason",
        ]
    );
    let permissions = sqlx::query_scalar::<_, String>(
        "SELECT permission_key FROM permissions
         WHERE permission_key IN ('admin.users.read', 'admin.users.moderate')
         ORDER BY permission_key",
    )
    .fetch_all(&pool)
    .await
    .expect("admin user permissions must be queryable");
    assert_eq!(
        permissions,
        vec!["admin.users.moderate", "admin.users.read"]
    );

    MIGRATOR
        .undo(&pool, 202608120001)
        .await
        .expect("admin user moderation migration must roll back");
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM permissions WHERE permission_key = 'admin.users.moderate'",
        )
        .fetch_one(&pool)
        .await
        .expect("moderation permission count must be readable"),
        0
    );

    MIGRATOR
        .undo(&pool, 202608110003)
        .await
        .expect("admin user read model migration must roll back");
    let remaining_columns = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND column_name IN ('admin_revision', 'restriction_reason', 'restriction_expires_at')",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back admin user columns must be queryable");
    assert_eq!(remaining_columns, 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM permissions WHERE permission_key = 'admin.users.read'",
        )
        .fetch_one(&pool)
        .await
        .expect("read permission count must be readable"),
        0
    );

    MIGRATOR
        .run(&pool)
        .await
        .expect("rolled-back admin user migrations must apply again");
}

#[sqlx::test(migrations = false)]
async fn board_hierarchy_migration_adds_reversible_parent_revision_and_order_index(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("existing migrations must apply before board hierarchy setup");
    MIGRATOR
        .undo(&pool, 202608120002)
        .await
        .expect("board hierarchy migration must roll back for fixture setup");
    sqlx::query(
        "INSERT INTO boards
             (id, slug, name, description, icon, tone, position, visibility)
         VALUES ($1, 'general', '综合讨论', '', 'messages', 'green', 0, 'public')",
    )
    .bind(Uuid::now_v7())
    .execute(&pool)
    .await
    .expect("legacy flat board fixture must insert");
    MIGRATOR
        .run(&pool)
        .await
        .expect("board hierarchy migration must apply to an existing flat board");

    let columns = sqlx::query_scalar::<_, String>(
        "SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'boards'
           AND column_name IN ('parent_id', 'revision')
         ORDER BY column_name",
    )
    .fetch_all(&pool)
    .await
    .expect("board hierarchy columns must be queryable");
    assert_eq!(columns, vec!["parent_id", "revision"]);
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT to_regclass('public.boards_admin_tree_order') IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("board hierarchy index must be queryable")
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT revision FROM boards WHERE slug = 'general'")
            .fetch_one(&pool)
            .await
            .expect("existing board revision must be readable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT parent_id FROM boards WHERE slug = 'general'"
        )
        .fetch_one(&pool)
        .await
        .expect("existing board parent must be readable"),
        None
    );

    MIGRATOR
        .undo(&pool, 202608120002)
        .await
        .expect("board hierarchy migration must roll back");
    let remaining_columns = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'boards'
           AND column_name IN ('parent_id', 'revision')",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back board columns must be queryable");
    assert_eq!(remaining_columns, 0);

    MIGRATOR
        .run(&pool)
        .await
        .expect("rolled-back board hierarchy migration must apply again");
}

#[sqlx::test(migrations = false)]
async fn report_revision_migration_is_reversible_and_backfills_existing_reports(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all report migrations must apply");

    let revision_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'content_reports'
               AND column_name = 'revision'
         )",
    )
    .fetch_one(&pool)
    .await
    .expect("report revision column lookup must succeed");
    assert!(revision_exists, "report revision column must exist");

    MIGRATOR
        .undo(&pool, 202608120003)
        .await
        .expect("report revision migration must roll back");
    let remaining = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'content_reports'
           AND column_name = 'revision'",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back report revision lookup must succeed");
    assert_eq!(remaining, 0);

    MIGRATOR
        .run(&pool)
        .await
        .expect("report revision migration must reapply");
}

#[sqlx::test(migrations = false)]
async fn operations_observability_migration_seeds_rules_and_capabilities_and_rolls_back(
    pool: PgPool,
) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("existing migrations must apply before operations observability");

    for table in ["operations_alert_rules", "operations_alerts"] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("operations table lookup must succeed");
        assert!(exists, "{table} must exist after the migration");
    }

    let rules = sqlx::query_as::<_, (String, String, i64, i32)>(
        "SELECT key, kind, threshold, window_seconds FROM operations_alert_rules ORDER BY key",
    )
    .fetch_all(&pool)
    .await
    .expect("default operations alert rules must be queryable");
    assert_eq!(rules.len(), 4);
    assert!(
        rules
            .iter()
            .all(|(_, _, threshold, window)| *threshold >= 0 && *window >= 30)
    );

    let permissions = sqlx::query_scalar::<_, String>(
        "SELECT permission_key FROM permissions WHERE permission_key LIKE 'operations.%' ORDER BY permission_key",
    )
    .fetch_all(&pool)
    .await
    .expect("operations permissions must be queryable");
    assert_eq!(
        permissions,
        vec!["operations.alerts.write", "operations.read"]
    );

    let invalid_revision = sqlx::query("UPDATE operations_alert_rules SET revision = 0")
        .execute(&pool)
        .await;
    assert!(
        invalid_revision.is_err(),
        "rule revisions must remain positive"
    );

    MIGRATOR
        .undo(&pool, 202608100002)
        .await
        .expect("operations observability migration must roll back");

    for table in ["operations_alert_rules", "operations_alerts"] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("rolled-back operations table lookup must succeed");
        assert!(!exists, "{table} must be removed on rollback");
    }
    let permission_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM permissions WHERE permission_key LIKE 'operations.%'",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back operations permission count must be readable");
    assert_eq!(permission_count, 0);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn user_profile_relationship_migration_enforces_safe_defaults_and_unique_edges(pool: PgPool) {
    let first = Uuid::parse_str("019fc700-0000-7000-8000-000000000011")
        .expect("first user UUID must be valid");
    let second = Uuid::parse_str("019fc700-0000-7000-8000-000000000012")
        .expect("second user UUID must be valid");
    for (id, username) in [(first, "profile_one"), (second, "profile_two")] {
        sqlx::query(
            "INSERT INTO users (id, username, email, display_name) \
             VALUES ($1, $2, $2 || '@example.com', $2)",
        )
        .bind(id)
        .bind(username)
        .execute(&pool)
        .await
        .expect("profile fixture must insert");
    }

    let defaults = sqlx::query_as::<_, (Option<String>, String, i32, i64, i64)>(
        "SELECT avatar_url, bio, profile_revision, follower_count, following_count \
         FROM users WHERE id = $1",
    )
    .bind(first)
    .fetch_one(&pool)
    .await
    .expect("profile defaults must be readable");
    assert_eq!(defaults, (None, String::new(), 1, 0, 0));

    let invalid_avatar =
        sqlx::query("UPDATE users SET avatar_url = 'http://example.com/a.png' WHERE id = $1")
            .bind(first)
            .execute(&pool)
            .await;
    assert!(invalid_avatar.is_err(), "avatar URLs must use HTTPS");

    sqlx::query("INSERT INTO user_follows (follower_id, followed_id) VALUES ($1, $2)")
        .bind(first)
        .bind(second)
        .execute(&pool)
        .await
        .expect("valid follow relationship must insert");
    let duplicate_follow =
        sqlx::query("INSERT INTO user_follows (follower_id, followed_id) VALUES ($1, $2)")
            .bind(first)
            .bind(second)
            .execute(&pool)
            .await;
    assert!(
        duplicate_follow.is_err(),
        "follow relationships must be unique"
    );

    let self_follow =
        sqlx::query("INSERT INTO user_follows (follower_id, followed_id) VALUES ($1, $1)")
            .bind(first)
            .execute(&pool)
            .await;
    assert!(self_follow.is_err(), "users must not follow themselves");

    sqlx::query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)")
        .bind(first)
        .bind(second)
        .execute(&pool)
        .await
        .expect("valid block relationship must insert");
    let self_block =
        sqlx::query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $1)")
            .bind(first)
            .execute(&pool)
            .await;
    assert!(self_block.is_err(), "users must not block themselves");
}

#[sqlx::test(migrations = false)]
async fn user_profile_relationship_migration_rolls_back_to_the_previous_version(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");

    // Source: https://docs.rs/sqlx/0.9.0/sqlx/migrate/struct.Migrator.html#method.undo
    MIGRATOR
        .undo(&pool, 202608030008)
        .await
        .expect("profile relationship migration must roll back");

    for table in ["user_follows", "user_blocks"] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("rolled-back table lookup must succeed");
        assert!(!exists, "{table} must be removed by the down migration");
    }
    let avatar_column_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (\
             SELECT 1 FROM information_schema.columns \
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'avatar_url'\
         )",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back column lookup must succeed");
    assert!(!avatar_column_exists);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn bookmark_like_migration_enforces_unique_edges_and_non_negative_counts(pool: PgPool) {
    for table in ["topic_bookmarks", "post_likes"] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("table lookup must succeed");
        assert!(exists, "{table} must exist after migrations");
    }
    for index in [
        "topic_bookmarks_user_time_index",
        "post_likes_user_time_index",
        "post_likes_post_index",
    ] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(index)
            .fetch_one(&pool)
            .await
            .expect("index lookup must succeed");
        assert!(exists, "{index} must exist after migrations");
    }

    let user =
        Uuid::parse_str("019fc700-0000-7000-8000-000000000021").expect("user UUID must be valid");
    let board =
        Uuid::parse_str("019fc700-0000-7000-8000-000000000022").expect("board UUID must be valid");
    let topic =
        Uuid::parse_str("019fc700-0000-7000-8000-000000000023").expect("topic UUID must be valid");
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name) \
         VALUES ($1, 'interaction_user', 'interaction@example.com', 'Interaction User')",
    )
    .bind(user)
    .execute(&pool)
    .await
    .expect("user fixture must insert");
    sqlx::query("INSERT INTO boards (id, slug, name) VALUES ($1, 'interactions', 'Interactions')")
        .bind(board)
        .execute(&pool)
        .await
        .expect("board fixture must insert");
    sqlx::query(
        "INSERT INTO topics (id, board_id, author_id, title, content, status, published_at) \
         VALUES ($1, $2, $3, 'Topic', 'Content', 'published', CURRENT_TIMESTAMP)",
    )
    .bind(topic)
    .bind(board)
    .bind(user)
    .execute(&pool)
    .await
    .expect("topic fixture must insert");
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status) \
         VALUES ($1, $1, $2, 'topic', 'Content', 'published')",
    )
    .bind(topic)
    .bind(user)
    .execute(&pool)
    .await
    .expect("post fixture must insert");

    sqlx::query("INSERT INTO topic_bookmarks (user_id, topic_id) VALUES ($1, $2)")
        .bind(user)
        .bind(topic)
        .execute(&pool)
        .await
        .expect("bookmark edge must insert");
    let duplicate_bookmark =
        sqlx::query("INSERT INTO topic_bookmarks (user_id, topic_id) VALUES ($1, $2)")
            .bind(user)
            .bind(topic)
            .execute(&pool)
            .await;
    assert!(duplicate_bookmark.is_err(), "bookmark edges must be unique");

    sqlx::query("INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2)")
        .bind(user)
        .bind(topic)
        .execute(&pool)
        .await
        .expect("like edge must insert");
    let duplicate_like = sqlx::query("INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2)")
        .bind(user)
        .bind(topic)
        .execute(&pool)
        .await;
    assert!(duplicate_like.is_err(), "like edges must be unique");

    let negative_count = sqlx::query("UPDATE posts SET like_count = -1 WHERE id = $1")
        .bind(topic)
        .execute(&pool)
        .await;
    assert!(
        negative_count.is_err(),
        "post like counts must not be negative"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn direct_message_migration_enforces_pairs_members_senders_and_content(pool: PgPool) {
    for table in [
        "direct_conversations",
        "conversation_members",
        "direct_messages",
    ] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("table lookup must succeed");
        assert!(exists, "{table} must exist after migrations");
    }

    let first = Uuid::parse_str("019fc900-0000-7000-8000-000000000001")
        .expect("first user UUID must be valid");
    let second = Uuid::parse_str("019fc900-0000-7000-8000-000000000002")
        .expect("second user UUID must be valid");
    let third = Uuid::parse_str("019fc900-0000-7000-8000-000000000003")
        .expect("third user UUID must be valid");
    for (id, username) in [
        (first, "message_one"),
        (second, "message_two"),
        (third, "message_three"),
    ] {
        sqlx::query(
            "INSERT INTO users (id, username, email, display_name) \
             VALUES ($1, $2, $2 || '@example.com', $2)",
        )
        .bind(id)
        .bind(username)
        .execute(&pool)
        .await
        .expect("message user fixture must insert");
    }

    let conversation = Uuid::parse_str("019fc900-0000-7000-8000-000000000101")
        .expect("conversation UUID must be valid");
    sqlx::query(
        "INSERT INTO direct_conversations (id, user_low_id, user_high_id) VALUES ($1, $2, $3)",
    )
    .bind(conversation)
    .bind(first)
    .bind(second)
    .execute(&pool)
    .await
    .expect("ordered conversation pair must insert");
    let reversed_pair = sqlx::query(
        "INSERT INTO direct_conversations (id, user_low_id, user_high_id) VALUES ($1, $2, $3)",
    )
    .bind(Uuid::now_v7())
    .bind(second)
    .bind(first)
    .execute(&pool)
    .await;
    assert!(
        reversed_pair.is_err(),
        "conversation pairs must use canonical order"
    );

    for user_id in [first, second] {
        sqlx::query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)")
            .bind(conversation)
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("conversation member must insert");
    }
    let message = Uuid::parse_str("019fc900-0000-7000-8000-000000000201")
        .expect("message UUID must be valid");
    sqlx::query(
        "INSERT INTO direct_messages (id, conversation_id, sender_id, content) \
         VALUES ($1, $2, $3, 'hello')",
    )
    .bind(message)
    .bind(conversation)
    .bind(first)
    .execute(&pool)
    .await
    .expect("member message must insert");

    let outsider_message = sqlx::query(
        "INSERT INTO direct_messages (id, conversation_id, sender_id, content) \
         VALUES ($1, $2, $3, 'outsider')",
    )
    .bind(Uuid::now_v7())
    .bind(conversation)
    .bind(third)
    .execute(&pool)
    .await;
    assert!(
        outsider_message.is_err(),
        "only conversation members may send"
    );
    let blank_message = sqlx::query(
        "INSERT INTO direct_messages (id, conversation_id, sender_id, content) \
         VALUES ($1, $2, $3, '   ')",
    )
    .bind(Uuid::now_v7())
    .bind(conversation)
    .bind(first)
    .execute(&pool)
    .await;
    assert!(blank_message.is_err(), "blank messages must be rejected");
    let negative_unread = sqlx::query(
        "UPDATE conversation_members SET unread_count = -1 \
         WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(conversation)
    .bind(second)
    .execute(&pool)
    .await;
    assert!(
        negative_unread.is_err(),
        "unread counts must stay non-negative"
    );
}

#[sqlx::test(migrations = false)]
async fn direct_message_migration_rolls_back_to_bookmark_like_version(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");
    MIGRATOR
        .undo(&pool, 202608030010)
        .await
        .expect("direct message migration must roll back");

    for table in [
        "direct_messages",
        "conversation_members",
        "direct_conversations",
    ] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("rolled-back table lookup must succeed");
        assert!(!exists, "{table} must be removed by the down migration");
    }
}

#[sqlx::test(migrations = false)]
async fn topic_search_migration_creates_and_rolls_back_the_fts_index(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");

    let column_exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'topics' AND column_name = 'search_vector'
         )"#,
    )
    .fetch_one(&pool)
    .await
    .expect("search vector column lookup must succeed");
    assert!(column_exists, "search vector column must exist");
    let index_exists = sqlx::query_scalar::<_, bool>(
        "SELECT to_regclass('topics_public_search_index') IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .expect("search index lookup must succeed");
    assert!(index_exists, "search index must exist");

    MIGRATOR
        .undo(&pool, 202608030013)
        .await
        .expect("topic search migration must roll back");
    let column_exists_after_undo = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'topics' AND column_name = 'search_vector'
         )"#,
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back search vector lookup must succeed");
    assert!(
        !column_exists_after_undo,
        "search vector column must be removed"
    );
    let index_exists_after_undo = sqlx::query_scalar::<_, bool>(
        "SELECT to_regclass('topics_public_search_index') IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back search index lookup must succeed");
    assert!(!index_exists_after_undo, "search index must be removed");

    MIGRATOR
        .run(&pool)
        .await
        .expect("topic search migration must reapply");
    let column_exists_after_reapply = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'topics' AND column_name = 'search_vector'
         )"#,
    )
    .fetch_one(&pool)
    .await
    .expect("reapplied search vector lookup must succeed");
    assert!(
        column_exists_after_reapply,
        "search vector column must exist after reapply"
    );
}

#[sqlx::test(migrations = false)]
async fn admin_configuration_migration_creates_and_rolls_back(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");
    let branding = sqlx::query_scalar::<_, bool>(
        "SELECT to_regclass('site_branding') IS NOT NULL
         AND to_regclass('admin_audit_log') IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .expect("admin tables lookup must succeed");
    assert!(branding, "admin tables must exist");

    MIGRATOR
        .undo(&pool, 202608040001)
        .await
        .expect("admin configuration migration must roll back");
    let removed = sqlx::query_scalar::<_, bool>(
        "SELECT to_regclass('site_branding') IS NULL
         AND to_regclass('admin_audit_log') IS NULL",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back admin tables lookup must succeed");
    assert!(removed, "admin tables must be removed");
}

#[sqlx::test(migrations = false)]
async fn branding_expansion_migration_creates_and_rolls_back(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");
    let expanded = sqlx::query_scalar::<_, bool>(
        "SELECT to_regclass('site_branding_assets') IS NOT NULL
         AND EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'site_branding' AND column_name = 'default_cover_url'
         )
         AND EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'site_branding' AND column_name = 'navigation_links'
         )
         AND EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'site_branding' AND column_name = 'footer_text'
         )
         AND EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'site_branding' AND column_name = 'footer_links'
         )",
    )
    .fetch_one(&pool)
    .await
    .expect("branding expansion lookup must succeed");
    assert!(expanded, "branding fields and asset metadata must exist");

    MIGRATOR
        .undo(&pool, 202608110002)
        .await
        .expect("branding expansion migration must roll back");
    let removed = sqlx::query_scalar::<_, bool>(
        "SELECT to_regclass('site_branding_assets') IS NULL
         AND NOT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'site_branding' AND column_name = 'default_cover_url'
         )",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back branding expansion lookup must succeed");
    assert!(removed, "branding expansion must be removed");

    MIGRATOR
        .run(&pool)
        .await
        .expect("branding expansion migration must reapply");
}

#[sqlx::test(migrations = false)]
async fn content_governance_migration_creates_and_rolls_back(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT to_regclass('content_reports') IS NOT NULL
         AND to_regclass('content_reports_status_time_index') IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .expect("content report table lookup must succeed");
    assert!(exists, "content report table and index must exist");

    MIGRATOR.undo(&pool, 202608040002).await.expect(
        "content governance migration and its dependent authorization migration must roll back",
    );
    let removed = sqlx::query_scalar::<_, bool>("SELECT to_regclass('content_reports') IS NULL")
        .fetch_one(&pool)
        .await
        .expect("rolled-back report table lookup must succeed");
    assert!(removed, "content report table must be removed");
}

#[sqlx::test(migrations = false)]
async fn bookmark_like_migration_backfills_topic_posts_and_rolls_back(pool: PgPool) {
    MIGRATOR
        .run(&pool)
        .await
        .expect("all forward migrations must apply");
    MIGRATOR
        .undo(&pool, 202608030009)
        .await
        .expect("bookmark and like migration must roll back for fixture setup");

    let user =
        Uuid::parse_str("019fc700-0000-7000-8000-000000000031").expect("user UUID must be valid");
    let board =
        Uuid::parse_str("019fc700-0000-7000-8000-000000000032").expect("board UUID must be valid");
    let topic =
        Uuid::parse_str("019fc700-0000-7000-8000-000000000033").expect("topic UUID must be valid");
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name) \
         VALUES ($1, 'backfill_user', 'backfill@example.com', 'Backfill User')",
    )
    .bind(user)
    .execute(&pool)
    .await
    .expect("user fixture must insert");
    sqlx::query("INSERT INTO boards (id, slug, name) VALUES ($1, 'backfill', 'Backfill')")
        .bind(board)
        .execute(&pool)
        .await
        .expect("board fixture must insert");
    sqlx::query(
        "INSERT INTO topics (id, board_id, author_id, title, content, status, published_at, like_count) \
         VALUES ($1, $2, $3, 'Backfill', 'Content', 'published', CURRENT_TIMESTAMP, 7)",
    )
    .bind(topic)
    .bind(board)
    .bind(user)
    .execute(&pool)
    .await
    .expect("topic fixture must insert");
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status) \
         VALUES ($1, $1, $2, 'topic', 'Content', 'published')",
    )
    .bind(topic)
    .bind(user)
    .execute(&pool)
    .await
    .expect("topic post fixture must insert");

    MIGRATOR
        .run(&pool)
        .await
        .expect("bookmark and like migration must reapply");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT like_count FROM posts WHERE id = $1")
            .bind(topic)
            .fetch_one(&pool)
            .await
            .expect("backfilled like count must be readable"),
        7
    );

    MIGRATOR
        .undo(&pool, 202608030009)
        .await
        .expect("bookmark and like migration must roll back");
    for table in ["topic_bookmarks", "post_likes"] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("rolled-back table lookup must succeed");
        assert!(!exists, "{table} must be removed by the down migration");
    }
    let like_count_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (\
             SELECT 1 FROM information_schema.columns \
             WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'like_count'\
         )",
    )
    .fetch_one(&pool)
    .await
    .expect("rolled-back column lookup must succeed");
    assert!(!like_count_exists);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn content_model_migration_creates_posts_and_revisions(pool: PgPool) {
    for table in ["posts", "post_revisions"] {
        let exists = sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("table lookup must succeed");
        assert!(exists, "{table} must exist after migrations");
    }

    let first_post_index = sqlx::query_scalar::<_, bool>(
        "SELECT to_regclass('posts_active_topic_unique') IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .expect("first-post index lookup must succeed");
    assert!(first_post_index);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn initialization_atomically_creates_the_first_super_administrator(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let administrator = administrator("019fc700-0000-7000-8000-000000000001", "owner");

    database
        .initialize_installation(administrator)
        .await
        .expect("fresh installation must initialize");

    let state = sqlx::query_as::<_, (bool, bool)>(
        "SELECT is_initialized, initialized_at IS NOT NULL FROM system_state WHERE singleton",
    )
    .fetch_one(&pool)
    .await
    .expect("system state must be readable");
    let identity = sqlx::query_as::<_, (String, String, String, String, String)>(
        "SELECT users.username, users.email, users.display_name, password_credentials.password_hash, roles.key \
         FROM users \
         JOIN password_credentials ON password_credentials.user_id = users.id \
         JOIN role_assignments ON role_assignments.user_id = users.id \
         JOIN roles ON roles.id = role_assignments.role_id",
    )
    .fetch_one(&pool)
    .await
    .expect("administrator identity must be queryable");

    assert_eq!(state, (true, true));
    assert_eq!(identity.0, "owner");
    assert_eq!(identity.1, "owner@example.com");
    assert_eq!(identity.2, "站点管理员");
    assert!(identity.3.starts_with("$argon2id$v=19$"));
    assert_eq!(identity.4, "super_admin");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn repeated_initialization_returns_conflict_without_extra_identity_rows(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    database
        .initialize_installation(administrator(
            "019fc700-0000-7000-8000-000000000001",
            "owner",
        ))
        .await
        .expect("first initialization must succeed");

    let result = database
        .initialize_installation(administrator(
            "019fc700-0000-7000-8000-000000000002",
            "second_owner",
        ))
        .await;

    assert!(matches!(
        result,
        Err(InitializeInstallationError::AlreadyInitialized)
    ));
    assert_identity_row_counts(&pool, 1).await;
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_initialization_has_exactly_one_winner(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let first = database.initialize_installation(administrator(
        "019fc700-0000-7000-8000-000000000001",
        "first_owner",
    ));
    let second = database.initialize_installation(administrator(
        "019fc700-0000-7000-8000-000000000002",
        "second_owner",
    ));

    let (first, second) = tokio::join!(first, second);
    let results = [first, second];

    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(InitializeInstallationError::AlreadyInitialized)))
            .count(),
        1
    );
    assert_identity_row_counts(&pool, 1).await;
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn late_initialization_failure_rolls_back_every_write(pool: PgPool) {
    sqlx::query(
        "ALTER TABLE role_assignments \
         ADD CONSTRAINT role_assignments_forced_failure CHECK (FALSE) NOT VALID",
    )
    .execute(&pool)
    .await
    .expect("failure fixture must install");
    let database = Database::from_pool(pool.clone());

    let result = database
        .initialize_installation(administrator(
            "019fc700-0000-7000-8000-000000000001",
            "owner",
        ))
        .await;

    assert!(matches!(
        result,
        Err(InitializeInstallationError::Database(_))
    ));
    assert!(
        !database
            .installation_status()
            .await
            .expect("installation state must remain readable")
    );
    assert_identity_row_counts(&pool, 0).await;
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_boards_are_ordered_paginated_and_visibility_filtered(pool: PgPool) {
    let fixtures = [
        (
            "019fc600-0000-7000-8000-000000000001",
            "second",
            "第二板块",
            20,
            "public",
            None,
        ),
        (
            "019fc600-0000-7000-8000-000000000002",
            "first",
            "第一板块",
            10,
            "public",
            None,
        ),
        (
            "019fc600-0000-7000-8000-000000000003",
            "hidden",
            "隐藏板块",
            15,
            "hidden",
            None,
        ),
        (
            "019fc600-0000-7000-8000-000000000004",
            "deleted",
            "已删除板块",
            5,
            "public",
            Some("2026-08-03 00:00:00+00"),
        ),
        (
            "019fc600-0000-7000-8000-000000000005",
            "third",
            "第三板块",
            30,
            "public",
            None,
        ),
    ];

    for (id, slug, name, position, visibility, deleted_at) in fixtures {
        sqlx::query(
            "INSERT INTO boards (id, slug, name, description, icon, tone, position, visibility, deleted_at) \
             VALUES ($1, $2, $3, '', 'messages', 'green', $4, $5, $6::timestamptz)",
        )
        .bind(Uuid::parse_str(id).expect("fixture UUID must be valid"))
        .bind(slug)
        .bind(name)
        .bind(position)
        .bind(visibility)
        .bind(deleted_at)
        .execute(&pool)
        .await
        .expect("board fixture must insert");
    }

    let database = Database::from_pool(pool);
    let first_page = database
        .list_public_boards(None, 2)
        .await
        .expect("first page must load");

    assert_eq!(
        first_page
            .iter()
            .map(|board| board.slug.as_str())
            .collect::<Vec<_>>(),
        vec!["first", "second"]
    );

    let second_page = database
        .list_public_boards(Some(first_page[1].id), 2)
        .await
        .expect("second page must load");

    assert_eq!(
        second_page
            .iter()
            .map(|board| board.slug.as_str())
            .collect::<Vec<_>>(),
        vec!["third"]
    );
}

fn administrator(id: &str, username: &str) -> InstallationAdministrator {
    InstallationAdministrator {
        id: Uuid::parse_str(id).expect("fixture UUID must be valid"),
        username: username.to_owned(),
        email: format!("{username}@example.com"),
        display_name: "站点管理员".to_owned(),
        password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
    }
}

async fn assert_identity_row_counts(pool: &PgPool, expected: i64) {
    let users = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
        .expect("user count must be readable");
    let credentials = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM password_credentials")
        .fetch_one(pool)
        .await
        .expect("credential count must be readable");
    let roles = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM roles")
        .fetch_one(pool)
        .await
        .expect("role count must be readable");
    let assignments = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM role_assignments")
        .fetch_one(pool)
        .await
        .expect("role assignment count must be readable");

    assert_eq!(users, expected, "unexpected user row count");
    assert_eq!(credentials, expected, "unexpected credential row count");
    assert_eq!(roles, expected, "unexpected role row count");
    assert_eq!(
        assignments, expected,
        "unexpected role assignment row count"
    );
}
