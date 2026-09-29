use infrastructure::{
    Database, EditReviewDecisionRecord, EditReviewPolicyUpdateRecord, UpdateTopicRecord,
};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn topic_edit_review_keeps_public_revision_until_approval(pool: PgPool) {
    let author = Uuid::now_v7();
    let reviewer = Uuid::now_v7();
    let board = Uuid::now_v7();
    let topic = Uuid::now_v7();
    for (id, username) in [(author, "edit_author"), (reviewer, "edit_reviewer")] {
        sqlx::query("INSERT INTO users (id, username, email, display_name, status) VALUES ($1, $2, $2 || '@example.com', $2, 'active')")
            .bind(id).bind(username).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO boards (id, slug, name) VALUES ($1, 'edit-review', 'Edit review')")
        .bind(board)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO topics (id, board_id, author_id, title, excerpt, content, status, published_at) VALUES ($1, $2, $3, 'Original', 'Original excerpt', 'Original body', 'published', CURRENT_TIMESTAMP)")
        .bind(topic).bind(board).bind(author).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO posts (id, topic_id, author_id, kind, content, status) VALUES ($1, $1, $2, 'topic', 'Original body', 'published')")
        .bind(topic).bind(author).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content) VALUES ($1, $2, $3, 1, 'Original body')")
        .bind(Uuid::now_v7()).bind(topic).bind(author).execute(&pool).await.unwrap();

    let role = Uuid::now_v7();
    sqlx::query("INSERT INTO roles (id, key, name, scope) VALUES ($1, 'edit_review_manager', 'Edit review manager', 'site')")
        .bind(role).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key IN ('admin.configuration.read', 'admin.configuration.write', 'moderation.topic')")
        .bind(role).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by) VALUES ($1, $2, $3, $2)",
    )
    .bind(Uuid::now_v7())
    .bind(reviewer)
    .bind(role)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO plugins (id, key, name, version, description, capabilities, component_bytes, component_sha256, status, installed_by, business_api_version, data_scopes, event_subscriptions) VALUES ($1, 'official_topic_edit_review', 'Edit review', '1.0.0', '', '[\"topic.edit_review\", \"ui.panel\"]', $2, $3, 'enabled', $4, '0.1.0', '[]', '[]')")
        .bind(Uuid::now_v7()).bind(vec![0_u8]).bind("a".repeat(64)).bind(reviewer).execute(&pool).await.unwrap();

    let database = Database::from_pool(pool.clone());
    let policies = database
        .edit_review_policies(
            reviewer,
            Some(vec![EditReviewPolicyUpdateRecord {
                board_id: board,
                topic_edits_require_review: true,
                reply_edits_require_review: false,
            }]),
        )
        .await
        .unwrap();
    assert!(policies[0].topic_edits_require_review);
    assert!(!policies[0].reply_edits_require_review);

    let review_id = database
        .submit_topic_edit_review(UpdateTopicRecord {
            topic_id: topic,
            author_id: author,
            base_revision: 1,
            title: Some("Changed".into()),
            excerpt: Some("Changed excerpt".into()),
            content: Some("Changed body".into()),
            rich_content: None,
            tags: None,
        })
        .await
        .unwrap()
        .expect("policy should create a pending review");
    let (title, content, revision): (String, String, i32) = sqlx::query_as(
        "SELECT t.title, p.content, p.revision_count FROM topics t JOIN posts p ON p.topic_id = t.id AND p.kind = 'topic' WHERE t.id = $1",
    ).bind(topic).fetch_one(&pool).await.unwrap();
    assert_eq!(
        (title.as_str(), content.as_str(), revision),
        ("Original", "Original body", 1)
    );

    let first = database
        .list_edit_reviews_page(reviewer, board, "pending", Some("topic"), None, 1)
        .await
        .unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].id, review_id);
    assert!(
        database
            .list_edit_reviews_page(reviewer, board, "pending", None, Some(review_id), 1)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        database
            .list_edit_reviews_page(reviewer, board, "pending", Some("reply"), None, 1)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        database
            .list_edit_reviews_page(reviewer, board, "pending", None, Some(Uuid::now_v7()), 1)
            .await
            .is_err()
    );
    assert!(
        database
            .list_edit_reviews_page(author, board, "pending", None, None, 1)
            .await
            .is_err()
    );

    let attachment = Uuid::now_v7();
    sqlx::query("INSERT INTO topic_attachments (id, uploader_id, storage_key, original_name, mime_type, size_bytes, sha256, status, scan_status, scanned_at, expires_at) VALUES ($1,$2,$3,'review.png','image/png',1,$4,'ready','clean',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + INTERVAL '1 day')")
        .bind(attachment).bind(author).bind(format!("test-missing/{attachment}.png")).bind(vec![0_u8;32]).execute(&pool).await.unwrap();
    sqlx::query("UPDATE content_edit_reviews SET proposed_rich_content=$2 WHERE id=$1")
        .bind(review_id).bind(serde_json::json!({"type":"doc","content":[{"type":"image","attrs":{"attachmentId":attachment}}]})).execute(&pool).await.unwrap();
    assert!(matches!(
        database.read_attachment(attachment, true, None).await,
        Err(infrastructure::ListAttachmentsError::TopicUnavailable)
    ));
    // Authorized review reaches storage; the deliberately absent test object must remain absent.
    assert!(matches!(
        database
            .read_attachment(attachment, true, Some(reviewer))
            .await,
        Err(infrastructure::ListAttachmentsError::Storage(_))
    ));

    let scoped_reviewer = Uuid::now_v7();
    let scoped_role = Uuid::now_v7();
    sqlx::query("INSERT INTO users (id,username,email,display_name,status) VALUES ($1,'scoped_review','scoped@example.com','Scoped reviewer','active')")
        .bind(scoped_reviewer).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO roles(id,key,name,scope) VALUES($1,'scoped_review','Scoped review','board')",
    )
    .bind(scoped_role)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key='moderation.topic'")
        .bind(scoped_role).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO role_assignments(id,user_id,role_id,scope_id,assigned_by) VALUES($1,$2,$3,$4,$2)")
        .bind(Uuid::now_v7()).bind(scoped_reviewer).bind(scoped_role).bind(board).execute(&pool).await.unwrap();
    assert_eq!(
        database
            .list_edit_reviews_page(scoped_reviewer, board, "pending", None, None, 20)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(matches!(
        database
            .read_attachment(attachment, true, Some(scoped_reviewer))
            .await,
        Err(infrastructure::ListAttachmentsError::Storage(_))
    ));
    let moved_board = Uuid::now_v7();
    sqlx::query("INSERT INTO boards(id,slug,name) VALUES($1,'moved-review','Moved review')")
        .bind(moved_board)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE topics SET board_id=$2 WHERE id=$1")
        .bind(topic)
        .bind(moved_board)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        database
            .list_edit_reviews_page(scoped_reviewer, board, "pending", None, None, 20)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        database.get_edit_review(scoped_reviewer, review_id).await,
        Err(infrastructure::EditReviewError::Forbidden)
    ));
    assert!(matches!(
        database
            .resolve_edit_review(
                scoped_reviewer,
                review_id,
                EditReviewDecisionRecord::Reject,
                1,
                "Moved board"
            )
            .await,
        Err(infrastructure::EditReviewError::Forbidden)
    ));
    sqlx::query("UPDATE topics SET board_id=$2 WHERE id=$1")
        .bind(topic)
        .bind(board)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
        .bind(scoped_reviewer)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        database
            .read_attachment(attachment, true, Some(scoped_reviewer))
            .await,
        Err(infrastructure::ListAttachmentsError::TopicUnavailable)
    ));

    let rejected = database
        .resolve_edit_review(
            reviewer,
            review_id,
            EditReviewDecisionRecord::Reject,
            1,
            "Needs work",
        )
        .await
        .unwrap();
    assert_eq!(rejected.status, "rejected");
    assert!(matches!(
        database
            .read_attachment(attachment, true, Some(reviewer))
            .await,
        Err(infrastructure::ListAttachmentsError::TopicUnavailable)
    ));

    let approved_id = database
        .submit_topic_edit_review(UpdateTopicRecord {
            topic_id: topic,
            author_id: author,
            base_revision: 1,
            title: Some("Approved".into()),
            excerpt: Some("Approved excerpt".into()),
            content: Some("Approved body".into()),
            rich_content: None,
            tags: None,
        })
        .await
        .unwrap()
        .unwrap();
    let approved = database
        .resolve_edit_review(
            reviewer,
            approved_id,
            EditReviewDecisionRecord::Approve,
            1,
            "Looks good",
        )
        .await
        .unwrap();
    assert_eq!(approved.status, "approved");
    let (title, content, revision): (String, String, i32) = sqlx::query_as(
        "SELECT t.title, p.content, p.revision_count FROM topics t JOIN posts p ON p.topic_id = t.id AND p.kind = 'topic' WHERE t.id = $1",
    ).bind(topic).fetch_one(&pool).await.unwrap();
    assert_eq!(
        (title.as_str(), content.as_str(), revision),
        ("Approved", "Approved body", 2)
    );
}
