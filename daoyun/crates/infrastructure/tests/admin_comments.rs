use infrastructure::{AdminCommentError, AdminCommentFilters, Database};
use sqlx::PgPool;
use uuid::Uuid;

async fn setup(pool: &PgPool) -> (Database, Uuid, Uuid, Uuid, Uuid, Uuid) {
    let moderator = Uuid::now_v7();
    let member = Uuid::now_v7();
    for (id, name) in [(moderator, "comment_mod"), (member, "comment_author")] {
        sqlx::query("INSERT INTO users(id,username,email,display_name,status) VALUES($1,$2,$2||'@test.invalid',$2,'active')").bind(id).bind(name).execute(pool).await.unwrap();
    }
    let board = Uuid::now_v7();
    let other = Uuid::now_v7();
    for (id, name) in [(board, "comments"), (other, "other-comments")] {
        sqlx::query("INSERT INTO boards(id,slug,name,description,icon,tone,position,visibility) VALUES($1,$2,$2,'','message-circle','blue',0,'public')").bind(id).bind(name).execute(pool).await.unwrap();
    }
    let role = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles(id,key,name,scope) VALUES($1,'comment_mod','Comment moderator','board')",
    )
    .bind(role)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key='moderation.topic'").bind(role).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO role_assignments(id,user_id,role_id,scope_id,assigned_by) VALUES($1,$2,$3,$4,$2)").bind(Uuid::now_v7()).bind(moderator).bind(role).bind(board).execute(pool).await.unwrap();
    let topic = Uuid::now_v7();
    let reply = Uuid::now_v7();
    sqlx::query("INSERT INTO topics(id,board_id,author_id,title,excerpt,content,status,published_at,last_activity_at,reply_count) VALUES($1,$2,$3,'Review this','Body','Body','published',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1)").bind(topic).bind(board).bind(member).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO posts(id,topic_id,author_id,kind,content,floor_number) VALUES($1,$2,$3,'reply','Needle comment',1)").bind(reply).bind(topic).bind(member).execute(pool).await.unwrap();
    (
        Database::from_pool(pool.clone()),
        moderator,
        member,
        board,
        other,
        reply,
    )
}
fn filters(board_id: Uuid) -> AdminCommentFilters {
    AdminCommentFilters {
        board_id,
        status: None,
        query: String::new(),
        cursor: None,
        limit: 20,
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn comments_enforce_board_scope_filters_and_pagination(pool: PgPool) {
    let (db, moderator, member, board, other, reply) = setup(&pool).await;
    assert!(matches!(
        db.list_admin_comments(member, &filters(board)).await,
        Err(AdminCommentError::Forbidden)
    ));
    assert!(matches!(
        db.list_admin_comments(moderator, &filters(other)).await,
        Err(AdminCommentError::Forbidden)
    ));
    assert!(matches!(
        db.get_admin_comment(member, reply).await,
        Err(AdminCommentError::Forbidden)
    ));
    let first = db.get_admin_comment(moderator, reply).await.unwrap();
    let second = Uuid::now_v7();
    sqlx::query("INSERT INTO posts(id,topic_id,author_id,kind,content,created_at,floor_number) VALUES($1,$2,$3,'reply',$4,CURRENT_TIMESTAMP+INTERVAL '1 second',2)").bind(second).bind(first.topic_id).bind(member).bind("Long ".repeat(300)).execute(&pool).await.unwrap();
    let mut f = filters(board);
    f.limit = 1;
    let rows = db.list_admin_comments(moderator, &f).await.unwrap();
    assert_eq!(rows[0].id, second);
    assert!(rows[0].content_truncated);
    assert_eq!(rows[0].content.chars().count(), 1000);
    assert!(
        !db.get_admin_comment(moderator, second)
            .await
            .unwrap()
            .content_truncated
    );
    f.cursor = Some(second);
    assert_eq!(
        db.list_admin_comments(moderator, &f).await.unwrap()[0].id,
        reply
    );
    f.cursor = Some(Uuid::now_v7());
    assert!(matches!(
        db.list_admin_comments(moderator, &f).await,
        Err(AdminCommentError::InvalidInput)
    ));
    f.cursor = None;
    f.query = "NEEDLE".into();
    assert_eq!(
        db.list_admin_comments(moderator, &f).await.unwrap()[0].id,
        reply
    );
    f.status = Some("hidden".into());
    assert!(
        db.list_admin_comments(moderator, &f)
            .await
            .unwrap()
            .is_empty()
    );
    sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
        .bind(moderator)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.get_admin_comment(moderator, reply).await,
        Err(AdminCommentError::Forbidden)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn comment_moderation_checks_version_and_updates_counts_and_audit(pool: PgPool) {
    let (db, moderator, member, _, _, reply) = setup(&pool).await;
    let initial = db.get_admin_comment(moderator, reply).await.unwrap();
    assert!(matches!(
        db.moderate_admin_comment(member, reply, "hidden", initial.updated_at, "违规内容")
            .await,
        Err(AdminCommentError::Forbidden)
    ));
    assert!(matches!(
        db.moderate_admin_comment(moderator, reply, "hidden", initial.updated_at, " ")
            .await,
        Err(AdminCommentError::InvalidInput)
    ));
    let hidden = db
        .moderate_admin_comment(moderator, reply, "hidden", initial.updated_at, "违规内容")
        .await
        .unwrap();
    assert_eq!(hidden.status, "hidden");
    assert!(matches!(
        db.moderate_admin_comment(
            moderator,
            reply,
            "published",
            initial.updated_at,
            "恢复内容"
        )
        .await,
        Err(AdminCommentError::Conflict)
    ));
    let count: i64 = sqlx::query_scalar("SELECT reply_count FROM topics WHERE id=$1")
        .bind(initial.topic_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let restored = db
        .moderate_admin_comment(moderator, reply, "published", hidden.updated_at, "复核通过")
        .await
        .unwrap();
    assert_eq!(restored.status, "published");
    let count: i64 = sqlx::query_scalar("SELECT reply_count FROM topics WHERE id=$1")
        .bind(initial.topic_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let actions: Vec<String> = sqlx::query_scalar(
        "SELECT action FROM admin_audit_log WHERE resource_id=$1 ORDER BY created_at,id",
    )
    .bind(reply)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(actions, vec!["reply.hide", "reply.restore"]);
    sqlx::query("UPDATE posts SET deleted_at=clock_timestamp() WHERE id=$1")
        .bind(reply)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.moderate_admin_comment(
            moderator,
            reply,
            "published",
            restored.updated_at,
            "恢复内容"
        )
        .await,
        Err(AdminCommentError::NotFound)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn failed_comment_audit_rolls_back_moderation_and_counts(pool: PgPool) {
    let (db, moderator, _, _, _, reply) = setup(&pool).await;
    let initial = db.get_admin_comment(moderator, reply).await.unwrap();
    sqlx::query("CREATE FUNCTION reject_comment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='reply.hide' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$").execute(&pool).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_comment_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_comment_audit()").execute(&pool).await.unwrap();
    assert!(matches!(
        db.moderate_admin_comment(moderator, reply, "hidden", initial.updated_at, "违规内容")
            .await,
        Err(AdminCommentError::Database(_))
    ));
    assert_eq!(
        db.get_admin_comment(moderator, reply).await.unwrap().status,
        "published"
    );
    let count: i64 = sqlx::query_scalar("SELECT reply_count FROM topics WHERE id=$1")
        .bind(initial.topic_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}
