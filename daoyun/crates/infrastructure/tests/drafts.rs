use infrastructure::{Database, DraftError};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
async fn user(pool: &PgPool, name: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,email,display_name,status) VALUES($1,$2,$2||'@test.invalid',$2,'active')").bind(id).bind(name).execute(pool).await.unwrap();
    id
}
#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn drafts_isolate_owners_detect_conflicts_and_preserve_retries(pool: PgPool) {
    let a = user(&pool, "draft_a").await;
    let b = user(&pool, "draft_b").await;
    let db = Database::from_pool(pool.clone());
    let id = Uuid::now_v7();
    let payload = json!({"title":"first","rich_content":{"type":"doc","content":[]},"images":[]});
    let first = db.save_draft(a, id, 0, payload.clone()).await.unwrap();
    assert_eq!(first.revision, 1);
    assert_eq!(
        db.save_draft(a, id, 0, payload.clone())
            .await
            .unwrap()
            .revision,
        1
    );
    assert!(matches!(db.draft(b, id).await, Err(DraftError::NotFound)));
    assert!(matches!(
        db.save_draft(b, id, 0, payload.clone()).await,
        Err(DraftError::NotFound)
    ));
    let mut next = payload.clone();
    next["title"] = json!("second");
    let (one, two) = tokio::join!(
        db.save_draft(a, id, 1, next.clone()),
        db.save_draft(a, id, 1, json!({"title":"other"}))
    );
    assert_eq!(usize::from(one.is_ok()) + usize::from(two.is_ok()), 1);
    assert!(matches!(
        db.delete_draft(a, id, 1).await,
        Err(DraftError::Conflict)
    ));
    assert_eq!(db.list_drafts(b, None, 20).await.unwrap().len(), 0);
    db.delete_draft(a, id, 2).await.unwrap();
    assert!(matches!(
        db.save_draft(a, id, 0, payload).await,
        Err(DraftError::NotFound)
    ));
    assert!(db.list_drafts(a, None, 20).await.unwrap().is_empty());
}
#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn drafts_enforce_capacity_and_attachment_ownership(pool: PgPool) {
    let a = user(&pool, "draft_limit").await;
    let db = Database::from_pool(pool.clone());
    assert!(matches!(
        db.save_draft(
            a,
            Uuid::now_v7(),
            0,
            json!({"images":[{"attachmentId":Uuid::now_v7(),"fileName":"x"}]})
        )
        .await,
        Err(DraftError::AttachmentUnavailable)
    ));
    for _ in 0..50 {
        db.save_draft(a, Uuid::now_v7(), 0, json!({"title":"draft"}))
            .await
            .unwrap();
    }
    assert!(matches!(
        db.save_draft(a, Uuid::now_v7(), 0, json!({})).await,
        Err(DraftError::LimitReached)
    ));
    assert_eq!(db.list_drafts(a, None, 51).await.unwrap().len(), 50);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn shared_draft_images_survive_expiry_until_last_reference_is_removed(pool: PgPool) {
    let a = user(&pool, "draft_image_owner").await;
    let b = user(&pool, "draft_image_other").await;
    let db = Database::from_pool(pool.clone());
    let image = Uuid::now_v7();
    sqlx::query("INSERT INTO topic_attachments(id,uploader_id,storage_key,original_name,mime_type,size_bytes,sha256,status,scan_status,expires_at) VALUES($1,$2,$3,'draft.png','image/png',4,$4,'ready','clean',CURRENT_TIMESTAMP+INTERVAL '1 hour')").bind(image).bind(a).bind(format!("drafts/{a}/{image}.png")).bind(vec![0u8;32]).execute(&pool).await.unwrap();
    let payload = json!({"images":[{"attachmentId":image,"fileName":"draft.png"}]});
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    assert!(matches!(
        db.save_draft(b, Uuid::now_v7(), 0, payload.clone()).await,
        Err(DraftError::AttachmentUnavailable)
    ));
    db.save_draft(a, first, 0, payload.clone()).await.unwrap();
    db.save_draft(a, second, 0, payload.clone()).await.unwrap();
    sqlx::query(
        "UPDATE topic_attachments SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 day' WHERE id=$1",
    )
    .bind(image)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(db.cleanup_attachments(10).await.unwrap().deleted_records, 0);
    db.delete_draft(a, first, 1).await.unwrap();
    assert_eq!(db.cleanup_attachments(10).await.unwrap().deleted_records, 0);
    let mut next = payload;
    next["title"] = json!("still editable");
    db.save_draft(a, second, 1, next).await.unwrap();
    db.delete_draft(a, second, 2).await.unwrap();
    assert_eq!(db.cleanup_attachments(10).await.unwrap().deleted_records, 1);
}
