use infrastructure::{
    CreateReplyError, CreateTopicError, Database, IdempotencyInput, ListPublicRepliesError,
    ListPublicTopicsError, NewReplyRecord, NewTagRecord, NewTopicRecord, PublicTopicFilters,
    ReplyMutationError, TopicGovernanceAction, TopicGovernanceError, TopicGovernanceInput,
    TopicSort, UpdateReplyRecord, UpdateTopicError, UpdateTopicRecord,
};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_topics_are_visibility_filtered_and_stably_cursor_paginated(pool: PgPool) {
    let author = fixture_id(1);
    let suspended_author = fixture_id(2);
    let public_board = fixture_id(11);
    let hidden_board = fixture_id(12);
    insert_user(&pool, author, "author", "active").await;
    insert_user(&pool, suspended_author, "suspended", "suspended").await;
    insert_board(&pool, public_board, "general", "public").await;
    insert_board(&pool, hidden_board, "staff", "hidden").await;

    insert_topic(
        &pool,
        fixture_id(101),
        public_board,
        author,
        "older",
        "2026-08-01T10:00:00Z",
        10,
        false,
        false,
        "published",
        false,
    )
    .await;
    insert_topic(
        &pool,
        fixture_id(102),
        public_board,
        author,
        "pinned",
        "2026-08-01T09:00:00Z",
        1,
        true,
        false,
        "published",
        false,
    )
    .await;
    insert_topic(
        &pool,
        fixture_id(103),
        public_board,
        author,
        "newer",
        "2026-08-01T11:00:00Z",
        100,
        false,
        true,
        "published",
        false,
    )
    .await;

    for (id, board, user, status, deleted) in [
        (fixture_id(104), hidden_board, author, "published", false),
        (fixture_id(105), public_board, author, "draft", false),
        (fixture_id(106), public_board, author, "published", true),
        (
            fixture_id(107),
            public_board,
            suspended_author,
            "published",
            false,
        ),
    ] {
        insert_topic(
            &pool,
            id,
            board,
            user,
            "not-public",
            "2026-08-02T12:00:00Z",
            999,
            false,
            false,
            status,
            deleted,
        )
        .await;
    }

    let database = Database::from_pool(pool.clone());
    let filters = PublicTopicFilters::default();
    let first_page = database
        .list_public_topics(&filters, None, 2)
        .await
        .expect("first topic page must load");
    assert_eq!(
        first_page
            .iter()
            .map(|topic| topic.title.as_str())
            .collect::<Vec<_>>(),
        ["pinned", "newer"]
    );

    let second_page = database
        .list_public_topics(&filters, Some(first_page[1].id), 2)
        .await
        .expect("second topic page must load");
    assert_eq!(
        second_page
            .iter()
            .map(|topic| topic.title.as_str())
            .collect::<Vec<_>>(),
        ["older"]
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_filters_use_full_text_search_and_support_each_sort(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;

    for (id, title, published_at, hot_score, featured) in [
        (101, "100% Rust", "2026-08-01T10:00:00Z", 10, true),
        (102, "1000 Rust", "2026-08-01T11:00:00Z", 100, false),
        (103, "quiet topic", "2026-08-01T12:00:00Z", 1, true),
    ] {
        insert_topic(
            &pool,
            fixture_id(id),
            board,
            author,
            title,
            published_at,
            hot_score,
            false,
            featured,
            "published",
            false,
        )
        .await;
    }
    sqlx::query("UPDATE topics SET last_activity_at = $2::timestamptz WHERE id = $1")
        .bind(fixture_id(101))
        .bind("2026-08-03T10:00:00Z")
        .execute(&pool)
        .await
        .expect("activity fixture must update");

    let database = Database::from_pool(pool.clone());
    let literal_search = PublicTopicFilters {
        board_slug: Some("general".to_owned()),
        search: Some("100%".to_owned()),
        tag_slug: None,
        author_username: None,
        following_user_id: None,
        viewer_user_id: None,
        featured_only: true,
        sort: TopicSort::Latest,
    };
    let search_results = database
        .list_public_topics(&literal_search, None, 10)
        .await
        .expect("combined filters must work");
    assert_eq!(
        search_results
            .iter()
            .map(|topic| topic.title.as_str())
            .collect::<Vec<_>>(),
        ["100% Rust"]
    );
    sqlx::query("UPDATE topics SET content = 'PostgreSQL body-only search term' WHERE id = $1")
        .bind(fixture_id(103))
        .execute(&pool)
        .await
        .expect("content search fixture must update");
    let content_search_results = database
        .list_public_topics(
            &PublicTopicFilters {
                search: Some("PostgreSQL".to_owned()),
                ..PublicTopicFilters::default()
            },
            None,
            10,
        )
        .await
        .expect("content search must work");
    assert_eq!(
        content_search_results
            .iter()
            .map(|topic| topic.title.as_str())
            .collect::<Vec<_>>(),
        ["quiet topic"]
    );

    let popular = database
        .list_public_topics(
            &PublicTopicFilters {
                sort: TopicSort::Popular,
                ..PublicTopicFilters::default()
            },
            None,
            10,
        )
        .await
        .expect("popular topics must load");
    assert_eq!(popular[0].title, "1000 Rust");

    let active = database
        .list_public_topics(
            &PublicTopicFilters {
                sort: TopicSort::Active,
                ..PublicTopicFilters::default()
            },
            None,
            10,
        )
        .await
        .expect("active topics must load");
    assert_eq!(active[0].title, "100% Rust");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_author_and_following_filters_scope_results_and_cursors(pool: PgPool) {
    let viewer = fixture_id(1);
    let followed_author = fixture_id(2);
    let other_author = fixture_id(3);
    let board = fixture_id(11);
    insert_user(&pool, viewer, "viewer", "active").await;
    insert_user(&pool, followed_author, "followed", "active").await;
    insert_user(&pool, other_author, "other", "active").await;
    insert_board(&pool, board, "general", "public").await;
    sqlx::query("INSERT INTO user_follows (follower_id, followed_id) VALUES ($1, $2)")
        .bind(viewer)
        .bind(followed_author)
        .execute(&pool)
        .await
        .expect("follow fixture must insert");
    insert_topic(
        &pool,
        fixture_id(101),
        board,
        followed_author,
        "followed topic",
        "2026-08-03T10:00:00Z",
        10,
        false,
        false,
        "published",
        false,
    )
    .await;
    insert_topic(
        &pool,
        fixture_id(102),
        board,
        other_author,
        "other topic",
        "2026-08-03T11:00:00Z",
        20,
        false,
        false,
        "published",
        false,
    )
    .await;
    let database = Database::from_pool(pool);

    let by_author = database
        .list_public_topics(
            &PublicTopicFilters {
                author_username: Some("followed".to_owned()),
                ..PublicTopicFilters::default()
            },
            None,
            20,
        )
        .await
        .expect("author topics must load");
    assert_eq!(by_author.len(), 1);
    assert_eq!(by_author[0].title, "followed topic");

    let following = database
        .list_public_topics(
            &PublicTopicFilters {
                following_user_id: Some(viewer),
                ..PublicTopicFilters::default()
            },
            None,
            20,
        )
        .await
        .expect("following topics must load");
    assert_eq!(following.len(), 1);
    assert_eq!(following[0].author_username, "followed");

    let invalid_cursor = database
        .list_public_topics(
            &PublicTopicFilters {
                following_user_id: Some(viewer),
                ..PublicTopicFilters::default()
            },
            Some(fixture_id(102)),
            20,
        )
        .await
        .expect_err("topic outside the following feed must not be a cursor");
    assert!(matches!(
        invalid_cursor,
        ListPublicTopicsError::InvalidCursor
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_topic_detail_and_cursor_validation_hide_unavailable_rows(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    let topic_id = fixture_id(101);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    insert_topic(
        &pool,
        topic_id,
        board,
        author,
        "visible",
        "2026-08-01T10:00:00Z",
        10,
        false,
        false,
        "published",
        false,
    )
    .await;

    let database = Database::from_pool(pool);
    let detail = database
        .public_topic(topic_id)
        .await
        .expect("topic detail lookup must work")
        .expect("published topic must be visible");
    assert_eq!(detail.summary.title, "visible");
    assert_eq!(detail.content, "Content for visible");
    assert_eq!(detail.summary.author_username, "author");
    assert_eq!(detail.summary.board_slug, "general");

    let error = database
        .list_public_topics(&PublicTopicFilters::default(), Some(fixture_id(999)), 20)
        .await
        .expect_err("an unavailable cursor must be rejected");
    assert!(matches!(error, ListPublicTopicsError::InvalidCursor));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_tags_are_publicly_listed_and_filter_topics(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    let database = Database::from_pool(pool.clone());
    database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(101),
                board_id: Some(board),
                author_id: author,
                title: "带标签主题".to_owned(),
                excerpt: "带标签主题".to_owned(),
                content: "正文".to_owned(),
                tags: vec![NewTagRecord {
                    slug: "rust".to_owned(),
                    name: "Rust".to_owned(),
                }],
            },
            None,
        )
        .await
        .expect("tagged topic must publish");
    database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(102),
                board_id: Some(board),
                author_id: author,
                title: "复用标签主题".to_owned(),
                excerpt: "复用标签主题".to_owned(),
                content: "正文".to_owned(),
                tags: vec![NewTagRecord {
                    slug: "rust".to_owned(),
                    name: "不能覆盖既有名称".to_owned(),
                }],
            },
            None,
        )
        .await
        .expect("existing tag slug must be reusable");

    let detail = database
        .public_topic(fixture_id(101))
        .await
        .expect("tagged detail must load")
        .expect("tagged detail must be visible");
    assert_eq!(detail.summary.tags[0].slug, "rust");
    assert_eq!(detail.content_revision, 1);

    let filtered = database
        .list_public_topics(
            &PublicTopicFilters {
                tag_slug: Some("rust".to_owned()),
                ..PublicTopicFilters::default()
            },
            None,
            10,
        )
        .await
        .expect("tag filter must load");
    assert_eq!(
        filtered.iter().map(|topic| topic.id).collect::<Vec<_>>(),
        [fixture_id(102), fixture_id(101)]
    );

    let tags = database
        .list_public_tags()
        .await
        .expect("public tags must load");
    assert_eq!(tags[0].slug, "rust");
    assert_eq!(tags[0].name, "Rust");
    assert_eq!(tags[0].topic_count, 2);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn editing_topic_appends_revision_and_rejects_stale_or_other_authors(pool: PgPool) {
    let author = fixture_id(1);
    let other = fixture_id(2);
    let board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_user(&pool, other, "other", "active").await;
    insert_board(&pool, board, "general", "public").await;
    insert_topic(
        &pool,
        fixture_id(101),
        board,
        author,
        "可编辑主题",
        "2026-08-01T10:00:00Z",
        0,
        false,
        false,
        "published",
        false,
    )
    .await;
    sqlx::query("INSERT INTO tags (id, slug, name) VALUES ($1, 'edited', '官方标签')")
        .bind(fixture_id(501))
        .execute(&pool)
        .await
        .expect("existing edit tag must insert");
    let database = Database::from_pool(pool.clone());
    let updated = database
        .update_published_topic(UpdateTopicRecord {
            topic_id: fixture_id(101),
            author_id: author,
            base_revision: 1,
            title: Some("已编辑主题".to_owned()),
            excerpt: Some("新的摘要".to_owned()),
            content: Some("新的正文".to_owned()),
            tags: Some(vec![NewTagRecord {
                slug: "edited".to_owned(),
                name: "已编辑".to_owned(),
            }]),
        })
        .await
        .expect("author edit must succeed");
    assert_eq!(updated.revision_number, 2);

    let detail = database
        .public_topic(fixture_id(101))
        .await
        .expect("edited detail must load")
        .expect("edited topic must be visible");
    assert_eq!(detail.content, "新的正文");
    assert_eq!(detail.content_revision, 2);
    assert_eq!(detail.summary.tags[0].slug, "edited");
    assert_eq!(detail.summary.tags[0].name, "官方标签");

    let revisions = database
        .list_topic_revisions(fixture_id(101), author)
        .await
        .expect("author revisions must load")
        .expect("author revisions must be visible");
    assert_eq!(revisions.len(), 2);
    assert_eq!(revisions[1].content, "新的正文");
    assert!(
        database
            .list_topic_revisions(fixture_id(101), other)
            .await
            .expect("other revision lookup must not fail")
            .is_none()
    );

    let forbidden = database
        .update_published_topic(UpdateTopicRecord {
            topic_id: fixture_id(101),
            author_id: other,
            base_revision: 2,
            title: Some("越权".to_owned()),
            excerpt: None,
            content: None,
            tags: None,
        })
        .await
        .expect_err("other author must be rejected");
    assert!(matches!(forbidden, UpdateTopicError::Forbidden));

    let conflict = database
        .update_published_topic(UpdateTopicRecord {
            topic_id: fixture_id(101),
            author_id: author,
            base_revision: 1,
            title: Some("过期编辑".to_owned()),
            excerpt: None,
            content: None,
            tags: None,
        })
        .await
        .expect_err("stale edit must be rejected");
    assert!(matches!(conflict, UpdateTopicError::RevisionConflict));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn publishing_updates_the_board_count_once_for_an_idempotent_request(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    let database = Database::from_pool(pool.clone());
    let input = NewTopicRecord {
        id: fixture_id(101),
        board_id: None,
        author_id: author,
        title: "发布主题".to_owned(),
        excerpt: "发布主题".to_owned(),
        content: "这是主题正文".to_owned(),
        tags: Vec::new(),
    };
    let idempotency = IdempotencyInput {
        key: "topic-create-001".to_owned(),
        request_hash: vec![7; 32],
    };

    let first = database
        .create_published_topic(input, Some(idempotency.clone()))
        .await
        .expect("first topic must be created");
    assert!(first.created);

    let replay = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(102),
                board_id: None,
                author_id: author,
                title: "发布主题".to_owned(),
                excerpt: "发布主题".to_owned(),
                content: "这是主题正文".to_owned(),
                tags: Vec::new(),
            },
            Some(idempotency.clone()),
        )
        .await
        .expect("same idempotency key must replay");
    assert!(!replay.created);
    assert_eq!(replay.topic_id, first.topic_id);

    let conflict = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(103),
                board_id: None,
                author_id: author,
                title: "不同内容".to_owned(),
                excerpt: "不同内容".to_owned(),
                content: "不同正文".to_owned(),
                tags: Vec::new(),
            },
            Some(IdempotencyInput {
                key: "topic-create-001".to_owned(),
                request_hash: vec![8; 32],
            }),
        )
        .await
        .expect_err("different payload must conflict");
    assert!(matches!(conflict, CreateTopicError::IdempotencyConflict));

    let topic_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topics")
        .fetch_one(&pool)
        .await
        .expect("topic count must be readable");
    let board_count = sqlx::query_scalar::<_, i64>("SELECT topic_count FROM boards WHERE id = $1")
        .bind(board)
        .fetch_one(&pool)
        .await
        .expect("board count must be readable");
    assert_eq!(topic_count, 1);
    assert_eq!(board_count, 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM outbox_events
             WHERE event_type = 'topic.published' AND aggregate_id = $1",
        )
        .bind(first.topic_id)
        .fetch_one(&pool)
        .await
        .expect("topic event count must be readable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn expired_topic_idempotency_key_can_be_reused_and_is_pruned(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    let database = Database::from_pool(pool.clone());
    let key = "expired-topic-key";

    let first = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(101),
                board_id: Some(board),
                author_id: author,
                title: "第一次发布".to_owned(),
                excerpt: "第一次发布".to_owned(),
                content: "第一次正文".to_owned(),
                tags: Vec::new(),
            },
            Some(IdempotencyInput {
                key: key.to_owned(),
                request_hash: vec![31; 32],
            }),
        )
        .await
        .expect("first topic must create");
    assert!(first.created);

    sqlx::query(
        "UPDATE idempotency_records
         SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 days',
             expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
         WHERE user_id = $1 AND endpoint = 'POST /api/v1/topics' AND idempotency_key = $2",
    )
    .bind(author)
    .bind(key)
    .execute(&pool)
    .await
    .expect("idempotency fixture must expire");

    let second = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(102),
                board_id: Some(board),
                author_id: author,
                title: "第二次发布".to_owned(),
                excerpt: "第二次发布".to_owned(),
                content: "第二次正文".to_owned(),
                tags: Vec::new(),
            },
            Some(IdempotencyInput {
                key: key.to_owned(),
                request_hash: vec![32; 32],
            }),
        )
        .await
        .expect("expired key must be reusable");
    assert!(second.created);
    assert_ne!(second.topic_id, first.topic_id);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM idempotency_records
             WHERE user_id = $1 AND endpoint = 'POST /api/v1/topics' AND idempotency_key = $2",
        )
        .bind(author)
        .bind(key)
        .fetch_one(&pool)
        .await
        .expect("active idempotency record must be queryable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn publishing_enforces_community_permission_and_daily_quota_transactionally(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    insert_user(&pool, author, "community_author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    let database = Database::from_pool(pool.clone());

    sqlx::query(
        "DELETE FROM community_group_permissions
         WHERE group_id = (
             SELECT id FROM community_groups WHERE internal_key = 'registered_member'
         ) AND permission_key = 'topic.create'",
    )
    .execute(&pool)
    .await
    .expect("topic permission fixture must update");
    let denied = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(201),
                board_id: Some(board),
                author_id: author,
                title: "无权限主题".to_owned(),
                excerpt: "无权限".to_owned(),
                content: "不应写入".to_owned(),
                tags: Vec::new(),
            },
            Some(IdempotencyInput {
                key: "community-denied".to_owned(),
                request_hash: vec![1; 32],
            }),
        )
        .await;
    assert!(matches!(denied, Err(CreateTopicError::PermissionDenied)));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM topics")
            .fetch_one(&pool)
            .await
            .expect("topic count must be queryable"),
        0
    );

    sqlx::query(
        "INSERT INTO community_group_permissions (group_id, permission_key)
         SELECT id, 'topic.create' FROM community_groups
         WHERE internal_key = 'registered_member'",
    )
    .execute(&pool)
    .await
    .expect("topic permission fixture must restore");
    sqlx::query(
        "UPDATE community_group_quota_rules SET quota_value = 1
         WHERE group_id = (
             SELECT id FROM community_groups WHERE internal_key = 'registered_member'
         ) AND quota_key = 'topic.create.daily'",
    )
    .execute(&pool)
    .await
    .expect("topic quota fixture must update");
    let input = NewTopicRecord {
        id: fixture_id(202),
        board_id: Some(board),
        author_id: author,
        title: "配额主题".to_owned(),
        excerpt: "配额".to_owned(),
        content: "仅能创建一次".to_owned(),
        tags: Vec::new(),
    };
    let idempotency = IdempotencyInput {
        key: "community-quota-1".to_owned(),
        request_hash: vec![2; 32],
    };
    let created = database
        .create_published_topic(input.clone(), Some(idempotency.clone()))
        .await
        .expect("first topic within quota must create");
    assert!(created.created);

    sqlx::query(
        "DELETE FROM community_group_permissions
         WHERE group_id = (
             SELECT id FROM community_groups WHERE internal_key = 'registered_member'
         ) AND permission_key = 'topic.create'",
    )
    .execute(&pool)
    .await
    .expect("topic permission fixture must revoke");
    let replay = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(203),
                ..input
            },
            Some(idempotency.clone()),
        )
        .await;
    assert!(matches!(replay, Err(CreateTopicError::PermissionDenied)));

    sqlx::query(
        "INSERT INTO community_group_permissions (group_id, permission_key)
         SELECT id, 'topic.create' FROM community_groups
         WHERE internal_key = 'registered_member'",
    )
    .execute(&pool)
    .await
    .expect("topic permission fixture must restore");

    let replay = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(203),
                ..input.clone()
            },
            Some(idempotency),
        )
        .await
        .expect("idempotent replay must not consume quota twice");
    assert!(!replay.created);

    let exceeded = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(204),
                board_id: Some(board),
                author_id: author,
                title: "超额主题".to_owned(),
                excerpt: "超额".to_owned(),
                content: "不应写入".to_owned(),
                tags: Vec::new(),
            },
            Some(IdempotencyInput {
                key: "community-quota-2".to_owned(),
                request_hash: vec![3; 32],
            }),
        )
        .await;
    assert!(matches!(exceeded, Err(CreateTopicError::QuotaExceeded)));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT used FROM community_quota_usage
             WHERE user_id = $1 AND quota_key = 'topic.create.daily'",
        )
        .bind(author)
        .fetch_one(&pool)
        .await
        .expect("quota usage must be queryable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM topics")
            .fetch_one(&pool)
            .await
            .expect("topic count must be queryable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn publishing_rejects_a_hidden_or_missing_board(pool: PgPool) {
    let author = fixture_id(1);
    let hidden_board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, hidden_board, "staff", "hidden").await;
    let database = Database::from_pool(pool);

    let error = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(101),
                board_id: Some(hidden_board),
                author_id: author,
                title: "主题".to_owned(),
                excerpt: "主题".to_owned(),
                content: "正文".to_owned(),
                tags: Vec::new(),
            },
            None,
        )
        .await
        .expect_err("hidden board must not accept public topics");
    assert!(matches!(error, CreateTopicError::BoardUnavailable));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_idempotent_publishing_has_one_topic_and_one_count_increment(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    let database = Database::from_pool(pool.clone());
    let first = database.create_published_topic(
        NewTopicRecord {
            id: fixture_id(101),
            board_id: Some(board),
            author_id: author,
            title: "并发发布".to_owned(),
            excerpt: "并发发布".to_owned(),
            content: "相同正文".to_owned(),
            tags: Vec::new(),
        },
        Some(IdempotencyInput {
            key: "concurrent-topic".to_owned(),
            request_hash: vec![9; 32],
        }),
    );
    let second = database.create_published_topic(
        NewTopicRecord {
            id: fixture_id(102),
            board_id: Some(board),
            author_id: author,
            title: "并发发布".to_owned(),
            excerpt: "并发发布".to_owned(),
            content: "相同正文".to_owned(),
            tags: Vec::new(),
        },
        Some(IdempotencyInput {
            key: "concurrent-topic".to_owned(),
            request_hash: vec![9; 32],
        }),
    );

    let (first, second) = tokio::join!(first, second);
    let results = [
        first.expect("first concurrent request must complete"),
        second.expect("second concurrent request must complete"),
    ];
    assert_eq!(results.iter().filter(|result| result.created).count(), 1);
    assert_eq!(results[0].topic_id, results[1].topic_id);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topics")
            .fetch_one(&pool)
            .await
            .expect("topic count must be readable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT topic_count FROM boards WHERE id = $1")
            .bind(board)
            .fetch_one(&pool)
            .await
            .expect("board count must be readable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn a_late_board_count_failure_rolls_back_topic_and_idempotency(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    sqlx::query(
        "ALTER TABLE boards ADD CONSTRAINT boards_forced_count_failure \
         CHECK (topic_count = 0) NOT VALID",
    )
    .execute(&pool)
    .await
    .expect("failure fixture must install");
    let database = Database::from_pool(pool.clone());

    let result = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(101),
                board_id: Some(board),
                author_id: author,
                title: "回滚主题".to_owned(),
                excerpt: "回滚主题".to_owned(),
                content: "正文".to_owned(),
                tags: Vec::new(),
            },
            Some(IdempotencyInput {
                key: "rollback-topic".to_owned(),
                request_hash: vec![10; 32],
            }),
        )
        .await;
    assert!(matches!(result, Err(CreateTopicError::Database(_))));

    let topic_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topics")
        .fetch_one(&pool)
        .await
        .expect("rolled back topic count must be readable");
    assert_eq!(topic_count, 0, "topics must be empty after rollback");

    let idempotency_count =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM idempotency_records")
            .fetch_one(&pool)
            .await
            .expect("rolled back idempotency count must be readable");
    assert_eq!(
        idempotency_count, 0,
        "idempotency records must be empty after rollback"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT topic_count FROM boards WHERE id = $1")
            .bind(board)
            .fetch_one(&pool)
            .await
            .expect("board count must be readable"),
        0
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_replies_are_visibility_filtered_and_stably_paginated(pool: PgPool) {
    let author = fixture_id(1);
    let suspended = fixture_id(2);
    let board = fixture_id(11);
    let topic = fixture_id(101);
    insert_user(&pool, author, "author", "active").await;
    insert_user(&pool, suspended, "suspended", "suspended").await;
    insert_board(&pool, board, "general", "public").await;
    insert_topic(
        &pool,
        topic,
        board,
        author,
        "topic",
        "2026-08-01T10:00:00Z",
        0,
        false,
        false,
        "published",
        false,
    )
    .await;
    for (id, user, status, deleted) in [
        (201, author, "published", false),
        (202, author, "published", false),
        (203, suspended, "published", false),
        (204, author, "hidden", false),
        (205, author, "published", true),
    ] {
        insert_reply(&pool, fixture_id(id), topic, user, status, deleted).await;
    }

    let database = Database::from_pool(pool);
    let first = database
        .list_public_replies(topic, None, 1)
        .await
        .expect("first reply page must load")
        .expect("topic must be visible");
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].content, "Reply 201");

    let second = database
        .list_public_replies(topic, Some(first[0].id), 2)
        .await
        .expect("second reply page must load")
        .expect("topic must be visible");
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].content, "Reply 202");

    let error = database
        .list_public_replies(topic, Some(fixture_id(999)), 20)
        .await
        .expect_err("foreign cursor must fail");
    assert!(matches!(error, ListPublicRepliesError::InvalidCursor));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn publishing_a_reply_is_transactional_and_idempotent(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    let topic = fixture_id(101);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    insert_topic(
        &pool,
        topic,
        board,
        author,
        "topic",
        "2026-08-01T10:00:00Z",
        0,
        false,
        false,
        "published",
        false,
    )
    .await;
    let database = Database::from_pool(pool.clone());
    let idempotency = IdempotencyInput {
        key: "reply-create-001".to_owned(),
        request_hash: vec![11; 32],
    };

    let first = database
        .create_published_reply(
            NewReplyRecord {
                id: fixture_id(201),
                revision_id: fixture_id(301),
                topic_id: topic,
                author_id: author,
                content: "第一条回复".to_owned(),
            },
            Some(idempotency.clone()),
        )
        .await
        .expect("first reply must publish");
    assert!(first.created);

    let replay = database
        .create_published_reply(
            NewReplyRecord {
                id: fixture_id(202),
                revision_id: fixture_id(302),
                topic_id: topic,
                author_id: author,
                content: "第一条回复".to_owned(),
            },
            Some(idempotency.clone()),
        )
        .await
        .expect("same reply must replay");
    assert!(!replay.created);
    assert_eq!(replay.reply_id, first.reply_id);

    let conflict = database
        .create_published_reply(
            NewReplyRecord {
                id: fixture_id(203),
                revision_id: fixture_id(303),
                topic_id: topic,
                author_id: author,
                content: "不同回复".to_owned(),
            },
            Some(IdempotencyInput {
                key: "reply-create-001".to_owned(),
                request_hash: vec![12; 32],
            }),
        )
        .await
        .expect_err("different reply must conflict");
    assert!(matches!(conflict, CreateReplyError::IdempotencyConflict));

    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM posts WHERE kind = 'reply'")
            .fetch_one(&pool)
            .await
            .expect("reply count must be readable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT reply_count FROM topics WHERE id = $1")
            .bind(topic)
            .fetch_one(&pool)
            .await
            .expect("topic reply count must be readable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM outbox_events
             WHERE event_type = 'reply.created' AND aggregate_id = $1",
        )
        .bind(first.reply_id)
        .fetch_one(&pool)
        .await
        .expect("reply event count must be readable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn editing_a_reply_appends_revisions_and_hides_it_from_other_authors(pool: PgPool) {
    let author = fixture_id(1);
    let other = fixture_id(2);
    let board = fixture_id(11);
    let topic = fixture_id(101);
    let reply = fixture_id(201);
    insert_user(&pool, author, "author", "active").await;
    insert_user(&pool, other, "other", "active").await;
    insert_board(&pool, board, "general", "public").await;
    insert_topic(
        &pool,
        topic,
        board,
        author,
        "topic",
        "2026-08-01T10:00:00Z",
        0,
        false,
        false,
        "published",
        false,
    )
    .await;
    insert_reply(&pool, reply, topic, author, "published", false).await;
    let database = Database::from_pool(pool.clone());

    let updated = database
        .update_published_reply(UpdateReplyRecord {
            topic_id: topic,
            reply_id: reply,
            author_id: author,
            base_revision: 1,
            content: "更新后的回复".to_owned(),
        })
        .await
        .expect("author reply edit must succeed");
    assert_eq!(updated.reply_id, reply);
    assert_eq!(updated.revision_number, 2);

    let public_reply = database
        .public_reply(reply)
        .await
        .expect("updated reply must load")
        .expect("updated reply must stay visible");
    assert_eq!(public_reply.content, "更新后的回复");
    assert_eq!(public_reply.revision_count, 2);

    let revisions = database
        .list_reply_revisions(topic, reply, author)
        .await
        .expect("author reply revisions must load")
        .expect("author reply revisions must be visible");
    assert_eq!(revisions.len(), 2);
    assert_eq!(revisions[0].content, "Reply 201");
    assert_eq!(revisions[1].content, "更新后的回复");
    assert!(
        database
            .list_reply_revisions(topic, reply, other)
            .await
            .expect("other author revision lookup must not fail")
            .is_none()
    );

    let forbidden = database
        .update_published_reply(UpdateReplyRecord {
            topic_id: topic,
            reply_id: reply,
            author_id: other,
            base_revision: 2,
            content: "越权编辑".to_owned(),
        })
        .await
        .expect_err("other author reply edit must be hidden");
    assert!(matches!(forbidden, ReplyMutationError::ReplyUnavailable));

    let conflict = database
        .update_published_reply(UpdateReplyRecord {
            topic_id: topic,
            reply_id: reply,
            author_id: author,
            base_revision: 1,
            content: "过期编辑".to_owned(),
        })
        .await
        .expect_err("stale reply edit must conflict");
    assert!(matches!(conflict, ReplyMutationError::RevisionConflict));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM post_revisions WHERE post_id = $1")
            .bind(reply)
            .fetch_one(&pool)
            .await
            .expect("reply revision count must be readable"),
        2
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn deleting_a_reply_is_soft_and_recomputes_topic_activity(pool: PgPool) {
    let author = fixture_id(1);
    let other = fixture_id(2);
    let board = fixture_id(11);
    let topic = fixture_id(101);
    let first_reply = fixture_id(201);
    let latest_reply = fixture_id(202);
    insert_user(&pool, author, "author", "active").await;
    insert_user(&pool, other, "other", "active").await;
    insert_board(&pool, board, "general", "public").await;
    insert_topic(
        &pool,
        topic,
        board,
        author,
        "topic",
        "2026-08-01T10:00:00Z",
        0,
        false,
        false,
        "published",
        false,
    )
    .await;
    insert_reply(&pool, first_reply, topic, author, "published", false).await;
    insert_reply(&pool, latest_reply, topic, author, "published", false).await;
    sqlx::query(
        "UPDATE topics SET reply_count = 2, last_activity_at = \
         (SELECT created_at FROM posts WHERE id = $2) WHERE id = $1",
    )
    .bind(topic)
    .bind(latest_reply)
    .execute(&pool)
    .await
    .expect("topic activity fixture must update");
    let database = Database::from_pool(pool.clone());

    let hidden = database
        .delete_published_reply(topic, latest_reply, other)
        .await
        .expect_err("other author delete must be hidden");
    assert!(matches!(hidden, ReplyMutationError::ReplyUnavailable));

    database
        .delete_published_reply(topic, latest_reply, author)
        .await
        .expect("latest reply delete must succeed");
    let topic_state = sqlx::query_as::<_, (i64, time::OffsetDateTime)>(
        "SELECT reply_count, last_activity_at FROM topics WHERE id = $1",
    )
    .bind(topic)
    .fetch_one(&pool)
    .await
    .expect("topic state must be readable");
    let first_created_at =
        sqlx::query_scalar::<_, time::OffsetDateTime>("SELECT created_at FROM posts WHERE id = $1")
            .bind(first_reply)
            .fetch_one(&pool)
            .await
            .expect("first reply timestamp must be readable");
    assert_eq!(topic_state, (1, first_created_at));
    assert!(database.public_reply(latest_reply).await.unwrap().is_none());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM post_revisions WHERE post_id = $1")
            .bind(latest_reply)
            .fetch_one(&pool)
            .await
            .expect("deleted reply revisions must remain readable"),
        1
    );

    database
        .delete_published_reply(topic, first_reply, author)
        .await
        .expect("last reply delete must succeed");
    let empty_topic_state = sqlx::query_as::<_, (i64, time::OffsetDateTime)>(
        "SELECT reply_count, last_activity_at FROM topics WHERE id = $1",
    )
    .bind(topic)
    .fetch_one(&pool)
    .await
    .expect("empty topic state must be readable");
    let published_at = sqlx::query_scalar::<_, time::OffsetDateTime>(
        "SELECT published_at FROM topics WHERE id = $1",
    )
    .bind(topic)
    .fetch_one(&pool)
    .await
    .expect("topic publish timestamp must be readable");
    assert_eq!(empty_topic_state, (0, published_at));

    let repeated = database
        .delete_published_reply(topic, first_reply, author)
        .await
        .expect_err("repeated reply delete must be unavailable");
    assert!(matches!(repeated, ReplyMutationError::ReplyUnavailable));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn content_mutations_are_atomically_audited_without_user_content(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    let topic = fixture_id(101);
    let reply = fixture_id(201);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    let database = Database::from_pool(pool.clone());

    let topic_idempotency = IdempotencyInput {
        key: "audit-topic-create".to_owned(),
        request_hash: vec![21; 32],
    };
    database
        .create_published_topic(
            NewTopicRecord {
                id: topic,
                board_id: Some(board),
                author_id: author,
                title: "PRIVATE_TOPIC_TITLE".to_owned(),
                excerpt: "PRIVATE_TOPIC_EXCERPT".to_owned(),
                content: "PRIVATE_TOPIC_BODY".to_owned(),
                tags: vec![NewTagRecord {
                    slug: "private-tag".to_owned(),
                    name: "PRIVATE_TAG_NAME".to_owned(),
                }],
            },
            Some(topic_idempotency.clone()),
        )
        .await
        .expect("topic create must succeed");
    let replayed_topic = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(102),
                board_id: Some(board),
                author_id: author,
                title: "PRIVATE_TOPIC_TITLE".to_owned(),
                excerpt: "PRIVATE_TOPIC_EXCERPT".to_owned(),
                content: "PRIVATE_TOPIC_BODY".to_owned(),
                tags: vec![NewTagRecord {
                    slug: "private-tag".to_owned(),
                    name: "PRIVATE_TAG_NAME".to_owned(),
                }],
            },
            Some(topic_idempotency),
        )
        .await
        .expect("topic replay must succeed");
    assert!(!replayed_topic.created);

    database
        .update_published_topic(UpdateTopicRecord {
            topic_id: topic,
            author_id: author,
            base_revision: 1,
            title: Some("PRIVATE_UPDATED_TITLE".to_owned()),
            excerpt: None,
            content: Some("PRIVATE_UPDATED_TOPIC_BODY".to_owned()),
            tags: None,
        })
        .await
        .expect("topic update must succeed");

    let reply_idempotency = IdempotencyInput {
        key: "audit-reply-create".to_owned(),
        request_hash: vec![22; 32],
    };
    database
        .create_published_reply(
            NewReplyRecord {
                id: reply,
                revision_id: fixture_id(301),
                topic_id: topic,
                author_id: author,
                content: "PRIVATE_REPLY_BODY".to_owned(),
            },
            Some(reply_idempotency.clone()),
        )
        .await
        .expect("reply create must succeed");
    let replayed_reply = database
        .create_published_reply(
            NewReplyRecord {
                id: fixture_id(202),
                revision_id: fixture_id(302),
                topic_id: topic,
                author_id: author,
                content: "PRIVATE_REPLY_BODY".to_owned(),
            },
            Some(reply_idempotency),
        )
        .await
        .expect("reply replay must succeed");
    assert!(!replayed_reply.created);

    database
        .update_published_reply(UpdateReplyRecord {
            topic_id: topic,
            reply_id: reply,
            author_id: author,
            base_revision: 1,
            content: "PRIVATE_UPDATED_REPLY_BODY".to_owned(),
        })
        .await
        .expect("reply update must succeed");
    database
        .delete_published_reply(topic, reply, author)
        .await
        .expect("reply delete must succeed");
    database
        .delete_published_topic(topic, author)
        .await
        .expect("topic delete must succeed");

    let audit = sqlx::query_as::<_, (String, String, Option<Uuid>, Value)>(
        "SELECT action, resource_type, resource_id, summary
         FROM admin_audit_log WHERE actor_id = $1 ORDER BY action",
    )
    .bind(author)
    .fetch_all(&pool)
    .await
    .expect("content audit rows must be readable");
    assert_eq!(
        audit,
        vec![
            (
                "reply.create".to_owned(),
                "reply".to_owned(),
                Some(reply),
                json!({"topic_id": topic}),
            ),
            (
                "reply.delete".to_owned(),
                "reply".to_owned(),
                Some(reply),
                json!({"topic_id": topic}),
            ),
            (
                "reply.update".to_owned(),
                "reply".to_owned(),
                Some(reply),
                json!({"revision": 2, "topic_id": topic}),
            ),
            (
                "topic.create".to_owned(),
                "topic".to_owned(),
                Some(topic),
                json!({"board_id": board}),
            ),
            (
                "topic.delete".to_owned(),
                "topic".to_owned(),
                Some(topic),
                json!({}),
            ),
            (
                "topic.update".to_owned(),
                "topic".to_owned(),
                Some(topic),
                json!({"revision": 2}),
            ),
        ]
    );
    let serialized = serde_json::to_string(&audit).expect("audit rows must serialize");
    assert!(!serialized.contains("PRIVATE_"));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn audit_insert_failure_rolls_back_topic_and_idempotency(pool: PgPool) {
    let author = fixture_id(1);
    let board = fixture_id(11);
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, board, "general", "public").await;
    sqlx::query(
        "ALTER TABLE admin_audit_log ADD CONSTRAINT forced_topic_audit_failure
         CHECK (action <> 'topic.create')",
    )
    .execute(&pool)
    .await
    .expect("audit failure fixture must install");
    let database = Database::from_pool(pool.clone());

    let result = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(101),
                board_id: Some(board),
                author_id: author,
                title: "审计失败回滚".to_owned(),
                excerpt: "审计失败回滚".to_owned(),
                content: "正文".to_owned(),
                tags: Vec::new(),
            },
            Some(IdempotencyInput {
                key: "audit-failure-rollback".to_owned(),
                request_hash: vec![23; 32],
            }),
        )
        .await;
    assert!(matches!(result, Err(CreateTopicError::Database(_))));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topics")
            .fetch_one(&pool)
            .await
            .expect("topic count must be readable"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM idempotency_records")
            .fetch_one(&pool)
            .await
            .expect("idempotency count must be readable"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM admin_audit_log")
            .fetch_one(&pool)
            .await
            .expect("audit count must be readable"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT topic_count FROM boards WHERE id = $1")
            .bind(board)
            .fetch_one(&pool)
            .await
            .expect("board count must be readable"),
        0
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_governance_actions_are_revisioned_atomic_and_lock_replies(pool: PgPool) {
    let moderator = fixture_id(1);
    let author = fixture_id(2);
    let source_board = fixture_id(11);
    let target_board = fixture_id(12);
    let topic = fixture_id(101);
    insert_user(&pool, moderator, "moderator", "active").await;
    insert_user(&pool, author, "author", "active").await;
    insert_board(&pool, source_board, "source", "public").await;
    insert_board(&pool, target_board, "target", "public").await;
    insert_topic(
        &pool,
        topic,
        source_board,
        author,
        "governed",
        "2026-08-15T10:00:00Z",
        0,
        false,
        false,
        "published",
        false,
    )
    .await;
    sqlx::query("UPDATE boards SET topic_count = 1 WHERE id = $1")
        .bind(source_board)
        .execute(&pool)
        .await
        .expect("source board count fixture must update");
    let role_id = fixture_id(201);
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope)
         VALUES ($1, 'topic_governor', 'Topic governor', 'instance')",
    )
    .bind(role_id)
    .execute(&pool)
    .await
    .expect("governance role fixture must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE permission_key = ANY($2)",
    )
    .bind(role_id)
    .bind(vec![
        "moderation.topic.pin",
        "moderation.topic.feature",
        "moderation.topic.lock",
        "moderation.topic.move",
    ])
    .execute(&pool)
    .await
    .expect("governance permissions must assign");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by)
         VALUES ($1, $2, $3, $2)",
    )
    .bind(fixture_id(202))
    .bind(moderator)
    .bind(role_id)
    .execute(&pool)
    .await
    .expect("governance assignment must insert");
    let database = Database::from_pool(pool.clone());

    let pinned = database
        .govern_topic(TopicGovernanceInput {
            topic_id: topic,
            actor_id: moderator,
            action: TopicGovernanceAction::Pin,
            expected_revision: 1,
            target_board_id: None,
            reason: Some("keep visible".to_owned()),
        })
        .await
        .expect("pin must succeed");
    assert!(pinned.is_pinned);
    assert_eq!(pinned.governance_revision, 2);

    let conflict = database
        .govern_topic(TopicGovernanceInput {
            topic_id: topic,
            actor_id: moderator,
            action: TopicGovernanceAction::Feature,
            expected_revision: 1,
            target_board_id: None,
            reason: None,
        })
        .await
        .expect_err("stale revision must fail");
    assert!(matches!(conflict, TopicGovernanceError::RevisionConflict));

    let locked = database
        .govern_topic(TopicGovernanceInput {
            topic_id: topic,
            actor_id: moderator,
            action: TopicGovernanceAction::Lock,
            expected_revision: 2,
            target_board_id: None,
            reason: None,
        })
        .await
        .expect("lock must succeed");
    assert!(locked.is_locked);
    let locked_reply = database
        .create_published_reply(
            NewReplyRecord {
                id: fixture_id(301),
                revision_id: fixture_id(302),
                topic_id: topic,
                author_id: author,
                content: "blocked".to_owned(),
            },
            None,
        )
        .await
        .expect_err("locked topic must reject replies");
    assert!(matches!(locked_reply, CreateReplyError::TopicLocked));

    let unlocked = database
        .govern_topic(TopicGovernanceInput {
            topic_id: topic,
            actor_id: moderator,
            action: TopicGovernanceAction::Unlock,
            expected_revision: 3,
            target_board_id: None,
            reason: None,
        })
        .await
        .expect("unlock must succeed");
    assert!(!unlocked.is_locked);
    let moved = database
        .govern_topic(TopicGovernanceInput {
            topic_id: topic,
            actor_id: moderator,
            action: TopicGovernanceAction::Move,
            expected_revision: 4,
            target_board_id: Some(target_board),
            reason: Some("better board".to_owned()),
        })
        .await
        .expect("move must succeed");
    assert_eq!(moved.board_id, target_board);
    assert_eq!(moved.governance_revision, 5);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT topic_count FROM boards WHERE id = $1")
            .bind(source_board)
            .fetch_one(&pool)
            .await
            .expect("source board count must load"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT topic_count FROM boards WHERE id = $1")
            .bind(target_board)
            .fetch_one(&pool)
            .await
            .expect("target board count must load"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM outbox_events WHERE event_type = 'topic.governance.changed' AND aggregate_id = $1",
        )
        .bind(topic)
        .fetch_one(&pool)
        .await
        .expect("governance outbox events must load"),
        4
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM notifications WHERE kind = 'topic_governance' AND target_id = $1",
        )
        .bind(topic)
        .fetch_one(&pool)
        .await
        .expect("governance notifications must load"),
        4
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn board_user_restrictions_block_topics_and_replies_only_in_the_target_board(pool: PgPool) {
    let author = fixture_id(1);
    let other_author = fixture_id(2);
    let restricted_board = fixture_id(11);
    let open_board = fixture_id(12);
    let existing_topic = fixture_id(101);
    insert_user(&pool, author, "author", "active").await;
    insert_user(&pool, other_author, "other", "active").await;
    insert_board(&pool, restricted_board, "restricted", "public").await;
    insert_board(&pool, open_board, "open", "public").await;
    insert_topic(
        &pool,
        existing_topic,
        restricted_board,
        other_author,
        "existing",
        "2026-08-15T10:00:00Z",
        0,
        false,
        false,
        "published",
        false,
    )
    .await;
    sqlx::query(
        "INSERT INTO board_user_restrictions
            (id, board_id, user_id, actions, starts_at, ends_at, reason, created_by, updated_by)
         VALUES ($1, $2, $3, ARRAY['topic.create', 'reply.create']::varchar[],
                 CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP + INTERVAL '1 hour',
                 'temporary', $4, $4)",
    )
    .bind(fixture_id(201))
    .bind(restricted_board)
    .bind(author)
    .bind(other_author)
    .execute(&pool)
    .await
    .expect("board restriction fixture must insert");
    let database = Database::from_pool(pool.clone());

    let topic_error = database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(301),
                board_id: Some(restricted_board),
                author_id: author,
                title: "blocked topic".to_owned(),
                excerpt: "blocked".to_owned(),
                content: "blocked".to_owned(),
                tags: Vec::new(),
            },
            None,
        )
        .await
        .expect_err("restricted board must reject topic creation");
    assert!(matches!(topic_error, CreateTopicError::BoardRestricted));

    let reply_error = database
        .create_published_reply(
            NewReplyRecord {
                id: fixture_id(302),
                revision_id: fixture_id(303),
                topic_id: existing_topic,
                author_id: author,
                content: "blocked reply".to_owned(),
            },
            None,
        )
        .await
        .expect_err("restricted board must reject reply creation");
    assert!(matches!(reply_error, CreateReplyError::BoardRestricted));

    database
        .create_published_topic(
            NewTopicRecord {
                id: fixture_id(304),
                board_id: Some(open_board),
                author_id: author,
                title: "allowed topic".to_owned(),
                excerpt: "allowed".to_owned(),
                content: "allowed".to_owned(),
                tags: Vec::new(),
            },
            None,
        )
        .await
        .expect("restriction must not affect another board");
}

fn fixture_id(value: u128) -> Uuid {
    Uuid::from_u128(0x019f_c800_0000_7000_8000_0000_0000_0000 + value)
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

#[allow(clippy::too_many_arguments)]
async fn insert_topic(
    pool: &PgPool,
    id: Uuid,
    board_id: Uuid,
    author_id: Uuid,
    title: &str,
    published_at: &str,
    hot_score: i64,
    pinned: bool,
    featured: bool,
    status: &str,
    deleted: bool,
) {
    sqlx::query(
        "INSERT INTO topics (\
             id, board_id, author_id, title, excerpt, content, status, published_at,\
             last_activity_at, hot_score, pinned_at, featured_at, deleted_at\
         ) VALUES (\
             $1, $2, $3, $4, 'Excerpt for ' || $4, 'Content for ' || $4, $5,\
             CASE WHEN $5 = 'published' THEN $6::timestamptz END, $6::timestamptz, $7,\
             CASE WHEN $8 THEN $6::timestamptz END,\
             CASE WHEN $9 THEN $6::timestamptz END,\
             CASE WHEN $10 THEN $6::timestamptz END\
         )",
    )
    .bind(id)
    .bind(board_id)
    .bind(author_id)
    .bind(title)
    .bind(status)
    .bind(published_at)
    .bind(hot_score)
    .bind(pinned)
    .bind(featured)
    .bind(deleted)
    .execute(pool)
    .await
    .expect("topic fixture must insert");
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status, created_at, deleted_at) \
         VALUES ($1, $1, $2, 'topic', 'Content for ' || $3, $4, $5::timestamptz, \
                 CASE WHEN $6 THEN CURRENT_TIMESTAMP END)",
    )
    .bind(id)
    .bind(author_id)
    .bind(title)
    .bind(status)
    .bind(published_at)
    .bind(deleted)
    .execute(pool)
    .await
    .expect("topic post fixture must insert");
    sqlx::query(
        "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content, created_at) \
         VALUES (gen_random_uuid(), $1, $2, 1, 'Content for ' || $3, $4::timestamptz)",
    )
    .bind(id)
    .bind(author_id)
    .bind(title)
    .bind(published_at)
    .execute(pool)
    .await
    .expect("topic revision fixture must insert");
}

async fn insert_reply(
    pool: &PgPool,
    id: Uuid,
    topic_id: Uuid,
    author_id: Uuid,
    status: &str,
    deleted: bool,
) {
    let number = id.as_u128() & 0xffff;
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status, created_at, deleted_at) \
         VALUES ($1, $2, $3, 'reply', $4, $5, \
                 '2026-08-03T10:00:00Z'::timestamptz + ($6 * INTERVAL '1 second'), \
                 CASE WHEN $7 THEN CURRENT_TIMESTAMP END)",
    )
    .bind(id)
    .bind(topic_id)
    .bind(author_id)
    .bind(format!("Reply {number}"))
    .bind(status)
    .bind(i64::try_from(number).expect("fixture number must fit i64"))
    .bind(deleted)
    .execute(pool)
    .await
    .expect("reply fixture must insert");
    sqlx::query(
        "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content, created_at) \
         SELECT gen_random_uuid(), id, author_id, 1, content, created_at FROM posts WHERE id = $1",
    )
    .bind(id)
    .execute(pool)
    .await
    .expect("reply revision fixture must insert");
}
