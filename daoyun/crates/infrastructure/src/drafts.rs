use crate::Database;
use serde_json::Value;
use sqlx::{FromRow, Postgres, Transaction};
use std::collections::HashSet;
use time::OffsetDateTime;
use uuid::Uuid;
#[derive(Debug)]
pub enum DraftError {
    NotFound,
    Conflict,
    Forbidden,
    LimitReached,
    InvalidInput,
    AttachmentUnavailable,
    Database(sqlx::Error),
}
impl From<sqlx::Error> for DraftError {
    fn from(e: sqlx::Error) -> Self {
        Self::Database(e)
    }
}
#[derive(Debug, FromRow)]
pub struct DraftRecord {
    pub id: Uuid,
    pub revision: i64,
    pub payload: Value,
    pub updated_at: OffsetDateTime,
}
impl Database {
    pub async fn list_drafts(
        &self,
        owner: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<DraftRecord>, DraftError> {
        Ok(sqlx::query_as("SELECT id,revision,payload,updated_at FROM member_drafts WHERE owner_id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3").bind(owner).bind(cursor).bind(limit.clamp(1,51)).fetch_all(&self.pool).await?)
    }
    pub async fn draft(&self, owner: Uuid, id: Uuid) -> Result<DraftRecord, DraftError> {
        sqlx::query_as("SELECT id,revision,payload,updated_at FROM member_drafts WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL").bind(id).bind(owner).fetch_optional(&self.pool).await?.ok_or(DraftError::NotFound)
    }
    pub async fn save_draft(
        &self,
        owner: Uuid,
        id: Uuid,
        expected: i64,
        payload: Value,
    ) -> Result<DraftRecord, DraftError> {
        if expected < 0
            || expected == i64::MAX
            || !payload.is_object()
            || payload.to_string().len() > 2_000_000
            || payload
                .get("title")
                .and_then(Value::as_str)
                .is_some_and(|s| s.chars().count() > 160)
        {
            return Err(DraftError::InvalidInput);
        }
        let mut refs = HashSet::new();
        if let Some(doc) = payload.get("rich_content")
            && !crate::topics::collect_rich_content_attachment_ids(doc, &mut refs)
        {
            return Err(DraftError::InvalidInput);
        }
        if let Some(images) = payload.get("images") {
            let images = images.as_array().ok_or(DraftError::InvalidInput)?;
            for image in images {
                refs.insert(
                    image
                        .get("attachmentId")
                        .and_then(Value::as_str)
                        .and_then(|v| Uuid::parse_str(v).ok())
                        .ok_or(DraftError::InvalidInput)?,
                );
            }
        }
        if refs.len() > 20 {
            return Err(DraftError::InvalidInput);
        }
        let mut tx = self.pool.begin().await?;
        lock_owner(&mut tx, owner).await?;
        let current: Option<(Uuid, i64, Value, Option<OffsetDateTime>)> = sqlx::query_as(
            "SELECT owner_id,revision,payload,deleted_at FROM member_drafts WHERE id=$1 FOR UPDATE",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((actual, revision, stored, deleted)) = current {
            if actual != owner || deleted.is_some() {
                return Err(DraftError::NotFound);
            }
            if revision == expected + 1 && stored == payload {
                let row = sqlx::query_as(
                    "SELECT id,revision,payload,updated_at FROM member_drafts WHERE id=$1",
                )
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
                tx.commit().await?;
                return Ok(row);
            }
            if revision != expected {
                return Err(DraftError::Conflict);
            }
        } else {
            if expected != 0 {
                return Err(DraftError::NotFound);
            }
            let count: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM member_drafts WHERE owner_id=$1 AND deleted_at IS NULL",
            )
            .bind(owner)
            .fetch_one(&mut *tx)
            .await?;
            if count >= 50 {
                return Err(DraftError::LimitReached);
            }
        }
        let refs = refs.into_iter().collect::<Vec<_>>();
        let available:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM topic_attachments a WHERE id=ANY($1) AND uploader_id=$2 AND topic_id IS NULL AND status='ready' AND scan_status='clean' AND deleted_at IS NULL AND (expires_at>CURRENT_TIMESTAMP OR EXISTS(SELECT 1 FROM member_draft_attachments r WHERE r.attachment_id=a.id)) ORDER BY id FOR UPDATE").bind(&refs).bind(owner).fetch_all(&mut *tx).await?;
        if available.len() != refs.len() {
            return Err(DraftError::AttachmentUnavailable);
        }
        let row=sqlx::query_as("INSERT INTO member_drafts(id,owner_id,revision,payload) VALUES($1,$2,1,$3) ON CONFLICT(id) DO UPDATE SET revision=member_drafts.revision+1,payload=EXCLUDED.payload,updated_at=CURRENT_TIMESTAMP RETURNING id,revision,payload,updated_at").bind(id).bind(owner).bind(payload).fetch_one(&mut *tx).await?;
        sqlx::query("DELETE FROM member_draft_attachments WHERE draft_id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO member_draft_attachments(draft_id,attachment_id) SELECT $1,unnest($2::uuid[])").bind(id).bind(&refs).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(row)
    }
    pub async fn delete_draft(
        &self,
        owner: Uuid,
        id: Uuid,
        expected: i64,
    ) -> Result<(), DraftError> {
        let mut tx = self.pool.begin().await?;
        lock_owner(&mut tx, owner).await?;
        let row: Option<(i64, Option<OffsetDateTime>)> = sqlx::query_as(
            "SELECT revision,deleted_at FROM member_drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        )
        .bind(id)
        .bind(owner)
        .fetch_optional(&mut *tx)
        .await?;
        let (revision, deleted) = row.ok_or(DraftError::NotFound)?;
        if revision != expected {
            return Err(DraftError::Conflict);
        }
        if deleted.is_none() {
            consume_draft(&mut tx, owner, id, expected).await?;
        }
        tx.commit().await?;
        Ok(())
    }
}
async fn lock_owner(tx: &mut Transaction<'_, Postgres>, owner: Uuid) -> Result<(), DraftError> {
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM users WHERE id=$1 FOR UPDATE")
            .bind(owner)
            .fetch_optional(&mut **tx)
            .await?;
    if status.as_deref() != Some("active") {
        return Err(DraftError::Forbidden);
    }
    Ok(())
}
pub(crate) async fn consume_draft(
    tx: &mut Transaction<'_, Postgres>,
    owner: Uuid,
    id: Uuid,
    expected: i64,
) -> Result<(), DraftError> {
    let count=sqlx::query("UPDATE member_drafts SET deleted_at=CURRENT_TIMESTAMP,payload='{}' WHERE id=$1 AND owner_id=$2 AND revision=$3 AND deleted_at IS NULL").bind(id).bind(owner).bind(expected).execute(&mut **tx).await?.rows_affected();
    if count != 1 {
        return Err(DraftError::Conflict);
    }
    sqlx::query("DELETE FROM member_draft_attachments WHERE draft_id=$1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
