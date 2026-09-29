use crate::{
    Database, DatabaseError,
    admin::insert_audit,
    authorization::{has_permission_with_executor, permission_keys},
};
use serde_json::json;
use sqlx::{FromRow, PgConnection};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct AdminCommentRecord {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub topic_title: String,
    pub board_id: Uuid,
    pub board_name: String,
    pub author_id: Uuid,
    pub author_username: String,
    pub author_display_name: String,
    pub author_avatar_url: Option<String>,
    pub content: String,
    pub content_truncated: bool,
    pub status: String,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug)]
pub enum AdminCommentError {
    Forbidden,
    NotFound,
    InvalidInput,
    Conflict,
    Database(DatabaseError),
}
impl From<sqlx::Error> for AdminCommentError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(value.into())
    }
}

#[derive(Debug)]
pub struct AdminCommentFilters {
    pub board_id: Uuid,
    pub status: Option<String>,
    pub query: String,
    pub cursor: Option<Uuid>,
    pub limit: i64,
}

async fn fetch_comment(
    connection: &mut PgConnection,
    id: Uuid,
) -> Result<AdminCommentRecord, AdminCommentError> {
    sqlx::query_as("SELECT p.id, p.topic_id, COALESCE(NULLIF(t.title, ''), LEFT(t.excerpt, 100)) AS topic_title,\n    b.id AS board_id, b.name AS board_name, u.id AS author_id, u.username AS author_username,\n    u.display_name AS author_display_name, u.avatar_url AS author_avatar_url,\n    p.content, FALSE AS content_truncated, p.status, p.created_at, p.updated_at\n    FROM posts p JOIN topics t ON t.id=p.topic_id JOIN boards b ON b.id=t.board_id JOIN users u ON u.id=p.author_id WHERE p.kind='reply' AND p.deleted_at IS NULL AND p.status IN ('published','hidden') AND t.deleted_at IS NULL AND b.deleted_at IS NULL AND p.id=$1")
        .bind(id).fetch_optional(connection).await?.ok_or(AdminCommentError::NotFound)
}

impl Database {
    pub async fn list_admin_comments(
        &self,
        actor: Uuid,
        filters: &AdminCommentFilters,
    ) -> Result<Vec<AdminCommentRecord>, AdminCommentError> {
        if !(1..=101).contains(&filters.limit)
            || filters.query.chars().count() > 120
            || filters
                .status
                .as_deref()
                .is_some_and(|s| !matches!(s, "published" | "hidden"))
        {
            return Err(AdminCommentError::InvalidInput);
        }
        let mut tx = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut tx,
            actor,
            permission_keys::MODERATION_TOPIC,
            Some(filters.board_id),
        )
        .await?
        {
            return Err(AdminCommentError::Forbidden);
        }
        if let Some(cursor) = filters.cursor {
            let valid: bool=sqlx::query_scalar("SELECT EXISTS(SELECT p.id, p.topic_id, COALESCE(NULLIF(t.title, ''), LEFT(t.excerpt, 100)) AS topic_title,\n    b.id AS board_id, b.name AS board_name, u.id AS author_id, u.username AS author_username,\n    u.display_name AS author_display_name, u.avatar_url AS author_avatar_url,\n    p.content, FALSE AS content_truncated, p.status, p.created_at, p.updated_at\n    FROM posts p JOIN topics t ON t.id=p.topic_id JOIN boards b ON b.id=t.board_id JOIN users u ON u.id=p.author_id WHERE p.kind='reply' AND p.deleted_at IS NULL AND p.status IN ('published','hidden') AND t.deleted_at IS NULL AND b.deleted_at IS NULL AND b.id=$1 AND ($2::text IS NULL OR p.status=$2) AND ($3::text='' OR strpos(lower(p.content),lower($3))>0 OR strpos(lower(u.username),lower($3))>0) AND p.id=$4)")
                .bind(filters.board_id).bind(filters.status.as_deref()).bind(&filters.query).bind(cursor)
                .fetch_one(&mut *tx).await?;
            if !valid {
                return Err(AdminCommentError::InvalidInput);
            }
        }
        let records=sqlx::query_as("SELECT p.id, p.topic_id, COALESCE(NULLIF(t.title, ''), LEFT(t.excerpt, 100)) AS topic_title,\n    b.id AS board_id, b.name AS board_name, u.id AS author_id, u.username AS author_username,\n    u.display_name AS author_display_name, u.avatar_url AS author_avatar_url,\n    LEFT(p.content,1000) AS content, char_length(p.content)>1000 AS content_truncated, p.status, p.created_at, p.updated_at\n    FROM posts p JOIN topics t ON t.id=p.topic_id JOIN boards b ON b.id=t.board_id JOIN users u ON u.id=p.author_id WHERE p.kind='reply' AND p.deleted_at IS NULL AND p.status IN ('published','hidden') AND t.deleted_at IS NULL AND b.deleted_at IS NULL AND b.id=$1 AND ($2::text IS NULL OR p.status=$2) AND ($3::text='' OR strpos(lower(p.content),lower($3))>0 OR strpos(lower(u.username),lower($3))>0) AND ($4::uuid IS NULL OR (p.created_at,p.id)<(SELECT created_at,id FROM posts WHERE id=$4)) ORDER BY p.created_at DESC,p.id DESC LIMIT $5")
            .bind(filters.board_id).bind(filters.status.as_deref()).bind(&filters.query).bind(filters.cursor).bind(filters.limit)
            .fetch_all(&mut *tx).await?;
        tx.commit().await?;
        Ok(records)
    }

    pub async fn get_admin_comment(
        &self,
        actor: Uuid,
        id: Uuid,
    ) -> Result<AdminCommentRecord, AdminCommentError> {
        let mut tx = self.pool.begin().await?;
        let record = fetch_comment(&mut tx, id).await?;
        if !has_permission_with_executor(
            &mut tx,
            actor,
            permission_keys::MODERATION_TOPIC,
            Some(record.board_id),
        )
        .await?
        {
            return Err(AdminCommentError::Forbidden);
        }
        tx.commit().await?;
        Ok(record)
    }

    pub async fn moderate_admin_comment(
        &self,
        actor: Uuid,
        id: Uuid,
        status: &str,
        expected_updated_at: OffsetDateTime,
        reason: &str,
    ) -> Result<AdminCommentRecord, AdminCommentError> {
        let reason = reason.trim();
        if !matches!(status, "published" | "hidden") || !(2..=500).contains(&reason.chars().count())
        {
            return Err(AdminCommentError::InvalidInput);
        }
        let mut tx = self.pool.begin().await?;
        // 与回复编辑/删除保持主题在先、回复在后的锁顺序。
        let topic: Option<(Uuid,Uuid)>=sqlx::query_as("SELECT t.id,t.board_id FROM topics t JOIN boards b ON b.id=t.board_id
            WHERE t.id=(SELECT topic_id FROM posts WHERE id=$1 AND kind='reply') AND t.deleted_at IS NULL AND b.deleted_at IS NULL FOR UPDATE OF t FOR SHARE OF b")
            .bind(id).fetch_optional(&mut *tx).await?;
        let (topic_id, board_id) = topic.ok_or(AdminCommentError::NotFound)?;
        if !has_permission_with_executor(
            &mut tx,
            actor,
            permission_keys::MODERATION_TOPIC,
            Some(board_id),
        )
        .await?
        {
            return Err(AdminCommentError::Forbidden);
        }
        let current: Option<(String,OffsetDateTime)>=sqlx::query_as("SELECT status,updated_at FROM posts WHERE id=$1 AND kind='reply' AND deleted_at IS NULL AND status IN ('published','hidden') FOR UPDATE")
            .bind(id).fetch_optional(&mut *tx).await?;
        let (old_status, updated_at) = current.ok_or(AdminCommentError::NotFound)?;
        if updated_at != expected_updated_at {
            return Err(AdminCommentError::Conflict);
        }
        if old_status == status {
            return Err(AdminCommentError::Conflict);
        }
        sqlx::query("UPDATE posts SET status=$2,updated_at=clock_timestamp() WHERE id=$1")
            .bind(id)
            .bind(status)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE topics t SET reply_count=counts.count,last_activity_at=COALESCE(counts.last_activity,t.published_at),updated_at=clock_timestamp()
            FROM (SELECT COUNT(*) AS count,MAX(p.created_at) AS last_activity FROM posts p JOIN users u ON u.id=p.author_id
                WHERE p.topic_id=$1 AND p.kind='reply' AND p.status='published' AND p.deleted_at IS NULL AND u.status='active') counts WHERE t.id=$1")
            .bind(topic_id).execute(&mut *tx).await?;
        insert_audit(&mut tx,actor,if status=="hidden" {"reply.hide"} else {"reply.restore"},"reply",Some(id),
            json!({"topic_id":topic_id,"board_id":board_id,"before":old_status,"after":status,"reason":reason})).await?;
        let result = fetch_comment(&mut tx, id).await?;
        tx.commit().await?;
        Ok(result)
    }
}
