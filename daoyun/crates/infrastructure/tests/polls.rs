use infrastructure::{Database, NewPollRecord, NewTopicRecord, PollError};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
async fn setup(pool: &PgPool) -> (Database, Uuid, Uuid, Uuid) {
    let author = Uuid::now_v7();
    let voter = Uuid::now_v7();
    let board = Uuid::now_v7();
    for (id, name) in [(author, "poll_author"), (voter, "poll_voter")] {
        sqlx::query("INSERT INTO users(id,username,email,display_name,status) VALUES($1,$2,$2||'@test.invalid',$2,'active')").bind(id).bind(name).execute(pool).await.unwrap();
    }
    sqlx::query("INSERT INTO boards(id,slug,name,visibility) VALUES($1,'polls','Polls','public')")
        .bind(board)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO community_group_permissions(group_id,permission_key,allowed) SELECT id,'topic.poll.create',true FROM community_groups WHERE internal_key='registered_member' ON CONFLICT(group_id,permission_key) DO UPDATE SET allowed=true").execute(pool).await.unwrap();
    sqlx::query("INSERT INTO plugins(id,key,name,version,description,capabilities,component_bytes,component_sha256,status,installed_by,business_api_version,data_scopes,event_subscriptions) VALUES($1,'official_polls','Polls','0.1.0','','[\"topic.polls\",\"ui.panel\"]',$2,$3,'enabled',$4,'0.1.0','[]','[]')").bind(Uuid::now_v7()).bind(vec![0u8]).bind("a".repeat(64)).bind(author).execute(pool).await.unwrap();
    (Database::from_pool(pool.clone()), author, voter, board)
}
fn input(author: Uuid, board: Uuid) -> NewTopicRecord {
    NewTopicRecord {
        id: Uuid::now_v7(),
        board_id: Some(board),
        author_id: author,
        title: "Poll".into(),
        excerpt: "Body".into(),
        content: "Body".into(),
        rich_content: None,
        tags: vec![],
    }
}
fn poll() -> NewPollRecord {
    NewPollRecord {
        question: "Which one?".into(),
        options: vec!["A".into(), "B".into()],
        ends_at: OffsetDateTime::now_utc() + Duration::days(1),
    }
}
#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn polls_vote_once_hide_early_counts_and_reject_late_edits(pool: PgPool) {
    let (db, author, voter, board) = setup(&pool).await;
    let topic = input(author, board);
    let id = topic.id;
    db.create_published_topic_with_extensions(topic, None, None, Some(poll()))
        .await
        .unwrap();
    let before = db.topic_poll(id, Some(voter)).await.unwrap().unwrap();
    assert!(before.total_votes.is_none());
    let option = before.options[0].id;
    let (one, two) = tokio::join!(
        db.vote_poll(voter, id, option),
        db.vote_poll(voter, id, option)
    );
    one.unwrap();
    two.unwrap();
    let result = db.topic_poll(id, Some(voter)).await.unwrap().unwrap();
    assert_eq!(result.total_votes, Some(1));
    assert!(matches!(
        db.vote_poll(voter, id, before.options[1].id).await,
        Err(PollError::AlreadyVoted)
    ));
    assert!(matches!(
        db.update_poll(author, id, 1, poll()).await,
        Err(PollError::Conflict)
    ));
    assert!(
        db.topic_poll(id, None)
            .await
            .unwrap()
            .unwrap()
            .total_votes
            .is_none()
    );
    sqlx::query(
        "UPDATE topic_polls SET ends_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE topic_id=$1",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        db.topic_poll(id, None).await.unwrap().unwrap().total_votes,
        Some(1)
    );
    assert!(matches!(
        db.vote_poll(author, id, option).await,
        Err(PollError::Closed)
    ));
    sqlx::query("UPDATE topics SET status='hidden' WHERE id=$1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.topic_poll(id, Some(author)).await,
        Err(PollError::NotFound)
    ));
}
#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn polls_enforce_provider_permissions_foreign_options_and_atomic_creation(pool: PgPool) {
    let (db, author, voter, board) = setup(&pool).await;
    let topic = input(author, board);
    let id = topic.id;
    db.create_published_topic_with_extensions(topic, None, None, Some(poll()))
        .await
        .unwrap();
    assert!(matches!(
        db.vote_poll(voter, id, Uuid::now_v7()).await,
        Err(PollError::InvalidOption)
    ));
    sqlx::query("UPDATE topics SET locked_at=CURRENT_TIMESTAMP,locked_by=author_id WHERE id=$1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let option = db
        .topic_poll(id, Some(voter))
        .await
        .unwrap()
        .unwrap()
        .options[0]
        .id;
    assert!(matches!(
        db.vote_poll(voter, id, option).await,
        Err(PollError::Closed)
    ));
    sqlx::query("UPDATE plugins SET status='disabled'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        db.create_published_topic_with_extensions(input(author, board), None, None, Some(poll()))
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topics")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert!(
        !db.topic_poll(id, Some(voter))
            .await
            .unwrap()
            .unwrap()
            .enabled
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn polls_allow_author_edits_only_before_first_vote_and_reject_restricted_accounts(
    pool: PgPool,
) {
    let (db, author, voter, board) = setup(&pool).await;
    let topic = input(author, board);
    let id = topic.id;
    db.create_published_topic_with_extensions(topic, None, None, Some(poll()))
        .await
        .unwrap();
    assert!(matches!(
        db.update_poll(voter, id, 1, poll()).await,
        Err(PollError::Forbidden)
    ));
    let original = db.topic_poll(id, Some(author)).await.unwrap().unwrap();
    assert!(original.can_edit);
    db.update_poll(author, id, 1, poll()).await.unwrap();
    assert_eq!(db.topic_poll(id, None).await.unwrap().unwrap().revision, 2);
    assert!(matches!(
        db.vote_poll(voter, id, original.options[0].id).await,
        Err(PollError::InvalidOption)
    ));
    let option = db
        .topic_poll(id, Some(voter))
        .await
        .unwrap()
        .unwrap()
        .options[0]
        .id;
    sqlx::query("UPDATE users SET status='restricted' WHERE id=$1")
        .bind(voter)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.vote_poll(voter, id, option).await,
        Err(PollError::Forbidden)
    ));
    sqlx::query("DELETE FROM community_group_permissions WHERE permission_key='topic.poll.create'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        db.create_published_topic_with_extensions(input(author, board), None, None, Some(poll()))
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topics")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn builtin_migration_preserves_disabled_poll_history_and_blocks_incompatible_rollback(
    pool: PgPool,
) {
    infrastructure::MIGRATOR
        .undo(&pool, 202609160004)
        .await
        .unwrap();
    let (db, author, voter, board) = setup(&pool).await;
    let topic = input(author, board);
    let topic_id = topic.id;
    db.create_published_topic_with_extensions(topic, None, None, Some(poll()))
        .await
        .unwrap();
    let option = db
        .topic_poll(topic_id, Some(voter))
        .await
        .unwrap()
        .unwrap()
        .options[0]
        .id;
    db.vote_poll(voter, topic_id, option).await.unwrap();
    sqlx::query("UPDATE plugins SET status='disabled',revision=7 WHERE key='official_polls'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO plugins(id,key,name,version,business_api_version,capabilities,component_bytes,component_sha256,installed_by) VALUES($1,'official_topic_supplements','Single capability','0.1.0','0.1.0','[\"topic.supplements\"]',$4,$5,$6),($2,'official_points_redemption','Mixed capabilities','0.1.0','0.1.0','[\"membership.redemption\",\"topic.polls\",\"ui.panel\"]',$4,$5,$6),($3,'third_party_polls','Third party','0.1.0','0.1.0','[\"topic.polls\",\"ui.panel\"]',$4,$5,$6)").bind(Uuid::now_v7()).bind(Uuid::now_v7()).bind(Uuid::now_v7()).bind(vec![0u8]).bind("a".repeat(64)).bind(author).execute(&pool).await.unwrap();
    let before: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(p) FROM plugins p WHERE key='official_polls'")
            .fetch_one(&pool)
            .await
            .unwrap();
    infrastructure::MIGRATOR.run(&pool).await.unwrap();
    let exists: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='plugins' AND column_name='execution')").fetch_one(&pool).await.unwrap();
    assert!(
        exists,
        "builtin migration must record execution independently of Wasm"
    );
    let mut after: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(p) FROM plugins p WHERE key='official_polls'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(after["execution"], "native");
    assert_eq!(after["revision"], 8);
    after.as_object_mut().unwrap().remove("execution");
    after["revision"] = serde_json::json!(7);
    assert_eq!(after, before);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM plugins WHERE key IN ('official_topic_supplements','official_points_redemption','third_party_polls') AND execution='wasm' AND revision=1").fetch_one(&pool).await.unwrap(),3,"migration must leave nonmatching official and third-party contracts unchanged");
    let history = db.topic_poll(topic_id, Some(voter)).await.unwrap().unwrap();
    assert!(!history.enabled);
    assert_eq!(history.total_votes, Some(1));
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT provider_key FROM topic_polls WHERE topic_id=$1")
            .bind(topic_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "official_polls"
    );
    infrastructure::MIGRATOR
        .undo(&pool, 202609160004)
        .await
        .expect("retained legacy components permit schema rollback");
    assert_eq!(
        db.topic_poll(topic_id, Some(voter))
            .await
            .unwrap()
            .unwrap()
            .total_votes,
        Some(1)
    );
    infrastructure::MIGRATOR.run(&pool).await.unwrap();
    sqlx::query("INSERT INTO plugins(id,key,name,version,business_api_version,capabilities,component_bytes,component_sha256,execution,installed_by) VALUES($1,'official_community_analytics','Analytics','0.1.0','0.1.0','[\"community.analytics\"]'::jsonb,$2,$3,'native',$4)").bind(Uuid::now_v7()).bind(Vec::<u8>::new()).bind("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855").bind(author).execute(&pool).await.unwrap();
    assert!(
        infrastructure::MIGRATOR
            .undo(&pool, 202609160004)
            .await
            .is_err(),
        "new native records must block an incompatible schema rollback"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topic_poll_votes")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}
