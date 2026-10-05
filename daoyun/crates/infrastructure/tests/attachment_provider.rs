use infrastructure::{CreateAttachmentInput, Database};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn new_attachment_persists_its_actual_write_provider(pool: PgPool) {
    let user = Uuid::now_v7();
    let board = Uuid::now_v7();
    let topic = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,email,display_name,status) VALUES($1,'storage_owner','storage_owner@example.com','Storage owner','active')").bind(user).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO role_assignments(id,user_id,role_id,assigned_by) SELECT $1,$2,id,$2 FROM roles WHERE key='super_admin'").bind(Uuid::now_v7()).bind(user).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO boards(id,slug,name) VALUES($1,'storage-test','Storage test')")
        .bind(board)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO topics(id,board_id,author_id,title,excerpt,content,status,published_at) VALUES($1,$2,$3,'Storage','Storage','Storage','published',CURRENT_TIMESTAMP)").bind(topic).bind(board).bind(user).execute(&pool).await.unwrap();
    let db = Database::from_pool(pool.clone());
    let record = db
        .create_topic_attachment(CreateAttachmentInput {
            id: Uuid::now_v7(),
            topic_id: topic,
            uploader_id: user,
            original_name: "fixture.txt".into(),
            mime_type: "text/plain".into(),
            bytes: b"storage fixture".to_vec(),
        })
        .await
        .unwrap();
    let provider: String =
        sqlx::query_scalar("SELECT storage_provider FROM topic_attachments WHERE id=$1")
            .bind(record.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(provider, "local");
    assert_eq!(
        db.read_attachment(record.id, false, Some(user))
            .await
            .unwrap()
            .1,
        b"storage fixture"
    );
}
