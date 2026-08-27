use infrastructure::{
    BookmarkMutationError, Database, ListBookmarksError, PostLikeMutationError, PublicTopicFilters,
};
use serde_json::Value;
use sqlx::{PgPool, types::Uuid};

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn bookmarks_are_idempotent_stably_paginated_and_keep_hidden_edges(pool: PgPool) {
    let user = fixture_id(1);
    let author = fixture_id(2);
    let board = fixture_id(11);
    let hidden_board = fixture_id(12);
    let older_topic = fixture_id(101);
    let newer_topic = fixture_id(102);
    let later_hidden_topic = fixture_id(103);
    let unavailable_topic = fixture_id(104);
    insert_user(&pool, user, "reader", "active").await;
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "public-board", "public").await;
    insert_board(&pool, hidden_board, "hidden-board", "hidden").await;
    for topic in [older_topic, newer_topic, later_hidden_topic] {
        insert_topic(&pool, topic, board, author, "published", false).await;
    }
    insert_topic(
        &pool,
        unavailable_topic,
        hidden_board,
        author,
        "published",
        false,
    )
    .await;
    let database = Database::from_pool(pool.clone());

    for topic in [older_topic, newer_topic, later_hidden_topic] {
        let state = database
            .set_topic_bookmarked(user, topic, true)
            .await
            .expect("visible topic must be bookmarkable");
        assert!(state.bookmarked);
        assert_eq!(state.topic_id, topic);
    }
    let repeated = database
        .set_topic_bookmarked(user, newer_topic, true)
        .await
        .expect("repeated bookmark must be idempotent");
    assert!(repeated.bookmarked);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topic_bookmarks WHERE user_id = $1")
            .bind(user)
            .fetch_one(&pool)
            .await
            .expect("bookmark count must be readable"),
        3
    );
    let unavailable = database
        .set_topic_bookmarked(user, unavailable_topic, true)
        .await
        .expect_err("hidden-board topic must not be bookmarkable");
    assert!(matches!(
        unavailable,
        BookmarkMutationError::TopicUnavailable
    ));

    sqlx::query(
        "UPDATE topic_bookmarks SET created_at = '2026-08-03T12:00:00Z'::timestamptz \
         WHERE user_id = $1",
    )
    .bind(user)
    .execute(&pool)
    .await
    .expect("bookmark timestamps must update");
    sqlx::query("UPDATE topics SET status = 'hidden' WHERE id = $1")
        .bind(later_hidden_topic)
        .execute(&pool)
        .await
        .expect("topic visibility fixture must update");

    let first_page = database
        .list_user_bookmarks(user, None, 1)
        .await
        .expect("first bookmark page must load");
    assert_eq!(first_page.len(), 1);
    assert_eq!(first_page[0].id, newer_topic);
    assert_eq!(first_page[0].viewer_bookmarked, Some(true));
    let second_page = database
        .list_user_bookmarks(user, Some(newer_topic), 2)
        .await
        .expect("second bookmark page must load");
    assert_eq!(
        second_page.iter().map(|topic| topic.id).collect::<Vec<_>>(),
        vec![older_topic]
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM topic_bookmarks WHERE user_id = $1 AND topic_id = $2",
        )
        .bind(user)
        .bind(later_hidden_topic)
        .fetch_one(&pool)
        .await
        .expect("hidden bookmark edge count must be readable"),
        1
    );

    let invalid_cursor = database
        .list_user_bookmarks(user, Some(later_hidden_topic), 20)
        .await
        .expect_err("hidden bookmark cannot be used as a public cursor");
    assert!(matches!(invalid_cursor, ListBookmarksError::InvalidCursor));

    let removed = database
        .set_topic_bookmarked(user, older_topic, false)
        .await
        .expect("bookmark must be removable");
    assert!(!removed.bookmarked);
    let repeated_remove = database
        .set_topic_bookmarked(user, older_topic, false)
        .await
        .expect("repeated bookmark removal must be idempotent");
    assert!(!repeated_remove.bookmarked);
    let bookmark_audit = sqlx::query_as::<_, (String, Uuid, Value)>(
        "SELECT action, resource_id, summary FROM admin_audit_log
         WHERE actor_id = $1 ORDER BY action, resource_id",
    )
    .bind(user)
    .fetch_all(&pool)
    .await
    .expect("bookmark audit rows must be readable");
    assert_eq!(bookmark_audit.len(), 4);
    assert_eq!(
        bookmark_audit
            .iter()
            .filter(|(action, _, _)| action == "topic.bookmark")
            .count(),
        3
    );
    assert_eq!(
        bookmark_audit
            .iter()
            .filter(|(action, id, _)| action == "topic.unbookmark" && *id == older_topic)
            .count(),
        1
    );
    assert!(
        bookmark_audit
            .iter()
            .all(|(_, _, summary)| summary == &serde_json::json!({}))
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn post_likes_are_idempotent_and_sync_topic_and_reply_counts(pool: PgPool) {
    let user = fixture_id(1);
    let author = fixture_id(2);
    let board = fixture_id(11);
    let topic = fixture_id(101);
    let reply = fixture_id(201);
    let hidden_reply = fixture_id(202);
    insert_user(&pool, user, "reader", "active").await;
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "public-board", "public").await;
    insert_topic(&pool, topic, board, author, "published", false).await;
    insert_reply(&pool, reply, topic, author, "published", false).await;
    insert_reply(&pool, hidden_reply, topic, author, "hidden", false).await;
    let database = Database::from_pool(pool.clone());

    let liked_topic = database
        .set_post_liked(user, topic, true)
        .await
        .expect("topic post must be likeable");
    assert!(liked_topic.liked);
    assert_eq!(liked_topic.like_count, 1);
    let repeated_topic = database
        .set_post_liked(user, topic, true)
        .await
        .expect("repeated topic like must be idempotent");
    assert_eq!(repeated_topic.like_count, 1);
    assert_eq!(topic_and_post_like_counts(&pool, topic).await, (1, 1));

    let unliked_topic = database
        .set_post_liked(user, topic, false)
        .await
        .expect("topic like must be removable");
    assert!(!unliked_topic.liked);
    assert_eq!(unliked_topic.like_count, 0);
    let repeated_unlike = database
        .set_post_liked(user, topic, false)
        .await
        .expect("repeated unlike must be idempotent");
    assert_eq!(repeated_unlike.like_count, 0);
    assert_eq!(topic_and_post_like_counts(&pool, topic).await, (0, 0));

    let liked_reply = database
        .set_post_liked(user, reply, true)
        .await
        .expect("reply must be likeable");
    assert_eq!(liked_reply.like_count, 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT like_count FROM posts WHERE id = $1")
            .bind(reply)
            .fetch_one(&pool)
            .await
            .expect("reply like count must be readable"),
        1
    );
    assert_eq!(topic_and_post_like_counts(&pool, topic).await, (0, 0));

    let unavailable = database
        .set_post_liked(user, hidden_reply, true)
        .await
        .expect_err("hidden reply must not be likeable");
    assert!(matches!(
        unavailable,
        PostLikeMutationError::PostUnavailable
    ));
    let like_audit = sqlx::query_as::<_, (String, Uuid, Value)>(
        "SELECT action, resource_id, summary FROM admin_audit_log
         WHERE actor_id = $1 ORDER BY action, resource_id",
    )
    .bind(user)
    .fetch_all(&pool)
    .await
    .expect("like audit rows must be readable");
    assert_eq!(like_audit.len(), 3);
    assert_eq!(
        like_audit
            .iter()
            .filter(|(action, _, _)| action == "post.like")
            .count(),
        2
    );
    assert_eq!(
        like_audit
            .iter()
            .filter(|(action, id, _)| action == "post.unlike" && *id == topic)
            .count(),
        1
    );
    assert!(
        like_audit
            .iter()
            .all(|(_, _, summary)| summary == &serde_json::json!({"topic_id": topic}))
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_topic_and_reply_reads_include_optional_viewer_interaction_state(pool: PgPool) {
    let user = fixture_id(1);
    let author = fixture_id(2);
    let board = fixture_id(11);
    let topic = fixture_id(101);
    let reply = fixture_id(201);
    insert_user(&pool, user, "reader", "active").await;
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "public-board", "public").await;
    insert_topic(&pool, topic, board, author, "published", false).await;
    insert_reply(&pool, reply, topic, author, "published", false).await;
    let database = Database::from_pool(pool);
    database
        .set_topic_bookmarked(user, topic, true)
        .await
        .expect("topic must be bookmarkable");
    database
        .set_post_liked(user, topic, true)
        .await
        .expect("topic post must be likeable");
    database
        .set_post_liked(user, reply, true)
        .await
        .expect("reply must be likeable");

    let anonymous_topics = database
        .list_public_topics(&PublicTopicFilters::default(), None, 20)
        .await
        .expect("anonymous topic list must load");
    assert_eq!(anonymous_topics[0].viewer_bookmarked, None);
    assert_eq!(anonymous_topics[0].viewer_liked, None);

    let viewer_topics = database
        .list_public_topics(
            &PublicTopicFilters {
                viewer_user_id: Some(user),
                ..PublicTopicFilters::default()
            },
            None,
            20,
        )
        .await
        .expect("viewer topic list must load");
    assert_eq!(viewer_topics[0].viewer_bookmarked, Some(true));
    assert_eq!(viewer_topics[0].viewer_liked, Some(true));

    let anonymous_detail = database
        .public_topic(topic)
        .await
        .expect("anonymous topic detail must load")
        .expect("topic must be visible");
    assert_eq!(anonymous_detail.summary.viewer_bookmarked, None);
    let viewer_detail = database
        .public_topic_for_viewer(topic, Some(user))
        .await
        .expect("viewer topic detail must load")
        .expect("topic must be visible");
    assert_eq!(viewer_detail.summary.viewer_bookmarked, Some(true));
    assert_eq!(viewer_detail.summary.viewer_liked, Some(true));

    let anonymous_replies = database
        .list_public_replies(topic, None, 20)
        .await
        .expect("anonymous replies must load")
        .expect("topic must be visible");
    assert_eq!(anonymous_replies[0].like_count, 1);
    assert_eq!(anonymous_replies[0].viewer_liked, None);
    let viewer_replies = database
        .list_public_replies_for_viewer(topic, Some(user), None, 20)
        .await
        .expect("viewer replies must load")
        .expect("topic must be visible");
    assert_eq!(viewer_replies[0].like_count, 1);
    assert_eq!(viewer_replies[0].viewer_liked, Some(true));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_likes_count_once_and_late_failures_roll_back(pool: PgPool) {
    let user = fixture_id(1);
    let author = fixture_id(2);
    let board = fixture_id(11);
    let topic = fixture_id(101);
    insert_user(&pool, user, "reader", "active").await;
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "public-board", "public").await;
    insert_topic(&pool, topic, board, author, "published", false).await;
    let first_database = Database::from_pool(pool.clone());
    let second_database = Database::from_pool(pool.clone());

    let (first, second) = tokio::join!(
        first_database.set_post_liked(user, topic, true),
        second_database.set_post_liked(user, topic, true),
    );
    assert_eq!(first.expect("first like must succeed").like_count, 1);
    assert_eq!(second.expect("second like must succeed").like_count, 1);
    assert_eq!(topic_and_post_like_counts(&pool, topic).await, (1, 1));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM post_likes")
            .fetch_one(&pool)
            .await
            .expect("like edge count must be readable"),
        1
    );

    first_database
        .set_post_liked(user, topic, false)
        .await
        .expect("fixture like must be removed");
    sqlx::query("UPDATE topics SET like_count = $2 WHERE id = $1")
        .bind(topic)
        .bind(i64::MAX)
        .execute(&pool)
        .await
        .expect("overflow fixture must update");

    let failed = first_database
        .set_post_liked(user, topic, true)
        .await
        .expect_err("late topic counter overflow must fail the transaction");
    assert!(matches!(failed, PostLikeMutationError::Database(_)));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM post_likes")
            .fetch_one(&pool)
            .await
            .expect("rolled-back edge count must be readable"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT like_count FROM posts WHERE id = $1")
            .bind(topic)
            .fetch_one(&pool)
            .await
            .expect("rolled-back post count must be readable"),
        0
    );
}

fn fixture_id(value: u128) -> Uuid {
    Uuid::from_u128(0x019f_ca00_0000_7000_8000_0000_0000_0000 + value)
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
             id, board_id, author_id, title, excerpt, content, status, published_at,\
             last_activity_at, deleted_at\
         ) VALUES (\
             $1, $2, $3, $1::text, 'Excerpt', 'Content', $4,\
             CASE WHEN $4 = 'published' THEN '2026-08-03T10:00:00Z'::timestamptz END,\
             '2026-08-03T10:00:00Z'::timestamptz,\
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
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status, deleted_at) \
         VALUES ($1, $1, $2, 'topic', 'Content', $3, \
                 CASE WHEN $4 THEN CURRENT_TIMESTAMP END)",
    )
    .bind(id)
    .bind(author_id)
    .bind(status)
    .bind(deleted)
    .execute(pool)
    .await
    .expect("topic post fixture must insert");
}

async fn insert_reply(
    pool: &PgPool,
    id: Uuid,
    topic_id: Uuid,
    author_id: Uuid,
    status: &str,
    deleted: bool,
) {
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status, deleted_at, floor_number) \
         VALUES ($1, $2, $3, 'reply', 'Reply', $4, \
                 CASE WHEN $5 THEN CURRENT_TIMESTAMP END, $6)",
    )
    .bind(id)
    .bind(topic_id)
    .bind(author_id)
    .bind(status)
    .bind(deleted)
    .bind(i64::try_from(id.as_u128() & 0x7fff_ffff).expect("fixture floor must fit i64"))
    .execute(pool)
    .await
    .expect("reply fixture must insert");
}

async fn topic_and_post_like_counts(pool: &PgPool, topic_id: Uuid) -> (i64, i64) {
    sqlx::query_as::<_, (i64, i64)>(
        "SELECT topic.like_count, post.like_count \
         FROM topics AS topic INNER JOIN posts AS post ON post.id = topic.id \
         WHERE topic.id = $1",
    )
    .bind(topic_id)
    .fetch_one(pool)
    .await
    .expect("topic and post like counts must be readable")
}
