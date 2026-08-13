use std::{
    collections::{HashMap, HashSet},
    error::Error,
    fmt,
};

use serde_json::json;
use sqlx::{FromRow, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::notifications::insert_notification;
use crate::{Database, DatabaseError};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum TopicSort {
    #[default]
    Latest,
    Popular,
    Active,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PublicTopicFilters {
    pub board_slug: Option<String>,
    pub search: Option<String>,
    pub tag_slug: Option<String>,
    pub author_username: Option<String>,
    pub following_user_id: Option<Uuid>,
    pub viewer_user_id: Option<Uuid>,
    pub featured_only: bool,
    pub sort: TopicSort,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct PublicTopicRecord {
    pub id: Uuid,
    pub title: String,
    pub excerpt: String,
    pub author_id: Uuid,
    pub author_username: String,
    pub author_display_name: String,
    pub author_avatar_url: Option<String>,
    pub board_id: Uuid,
    pub board_slug: String,
    pub board_name: String,
    pub board_tone: String,
    pub published_at: OffsetDateTime,
    pub last_activity_at: OffsetDateTime,
    pub reply_count: i64,
    pub like_count: i64,
    #[sqlx(default)]
    pub viewer_bookmarked: Option<bool>,
    #[sqlx(default)]
    pub viewer_liked: Option<bool>,
    pub view_count: i64,
    pub is_featured: bool,
    pub is_pinned: bool,
    #[sqlx(skip)]
    pub tags: Vec<PublicTagRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicTopicDetailRecord {
    pub summary: PublicTopicRecord,
    pub content: String,
    pub content_revision: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct PublicTagRecord {
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct PublicTagUsageRecord {
    pub slug: String,
    pub name: String,
    pub topic_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct TopicRevisionRecord {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub revision_number: i32,
    pub editor_id: Uuid,
    pub editor_username: String,
    pub editor_display_name: String,
    pub editor_avatar_url: Option<String>,
    pub content: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct ReplyRevisionRecord {
    pub id: Uuid,
    pub reply_id: Uuid,
    pub revision_number: i32,
    pub editor_id: Uuid,
    pub editor_username: String,
    pub editor_display_name: String,
    pub editor_avatar_url: Option<String>,
    pub content: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewTagRecord {
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewTopicRecord {
    pub id: Uuid,
    pub board_id: Option<Uuid>,
    pub author_id: Uuid,
    pub title: String,
    pub excerpt: String,
    pub content: String,
    pub tags: Vec<NewTagRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateTopicRecord {
    pub topic_id: Uuid,
    pub author_id: Uuid,
    pub base_revision: i32,
    pub title: Option<String>,
    pub excerpt: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<NewTagRecord>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewReplyRecord {
    pub id: Uuid,
    pub revision_id: Uuid,
    pub topic_id: Uuid,
    pub author_id: Uuid,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateReplyRecord {
    pub topic_id: Uuid,
    pub reply_id: Uuid,
    pub author_id: Uuid,
    pub base_revision: i32,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct PublicReplyRecord {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub author_id: Uuid,
    pub author_username: String,
    pub author_display_name: String,
    pub author_avatar_url: Option<String>,
    pub content: String,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub revision_count: i32,
    pub like_count: i64,
    #[sqlx(default)]
    pub viewer_liked: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotencyInput {
    pub key: String,
    pub request_hash: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CreateTopicResult {
    pub topic_id: Uuid,
    pub created: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CreateReplyResult {
    pub reply_id: Uuid,
    pub created: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpdateTopicResult {
    pub topic_id: Uuid,
    pub revision_number: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpdateReplyResult {
    pub reply_id: Uuid,
    pub revision_number: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicModerationResultRecord {
    pub topic_id: Uuid,
    pub status: String,
}

#[derive(Debug)]
pub enum CreateTopicError {
    BoardUnavailable,
    AuthorRestricted,
    IdempotencyConflict,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListPublicTopicsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListPublicRepliesError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum CreateReplyError {
    TopicUnavailable,
    AuthorRestricted,
    IdempotencyConflict,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum UpdateTopicError {
    TopicUnavailable,
    Forbidden,
    RevisionConflict,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListTopicRevisionsError {
    TopicUnavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ReplyMutationError {
    ReplyUnavailable,
    RevisionConflict,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum TopicDeleteError {
    Unavailable,
    Forbidden,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum TopicModerationError {
    Unavailable,
    Forbidden,
    InvalidStatus,
    Database(DatabaseError),
}

impl Database {
    pub async fn delete_published_topic(
        &self,
        topic_id: Uuid,
        author_id: Uuid,
    ) -> Result<(), TopicDeleteError> {
        let mut transaction = self.pool.begin().await?;
        let topic = sqlx::query_as::<_, TopicDeleteRow>(
            "SELECT author_id, board_id, status, deleted_at FROM topics WHERE id = $1 FOR UPDATE",
        )
        .bind(topic_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(TopicDeleteError::Unavailable)?;
        if topic.status != "published" || topic.deleted_at.is_some() {
            return Err(TopicDeleteError::Unavailable);
        }
        if topic.author_id != author_id {
            return Err(TopicDeleteError::Forbidden);
        }
        sqlx::query(
            "UPDATE topics SET status = 'hidden', moderation_status = 'hidden',
                deleted_at = CURRENT_TIMESTAMP, featured_at = NULL, pinned_at = NULL,
                updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        )
        .bind(topic_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE posts SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE topic_id = $1 AND deleted_at IS NULL",
        )
        .bind(topic_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE boards SET topic_count = GREATEST(topic_count - 1, 0), updated_at = CURRENT_TIMESTAMP
             WHERE id = $1",
        )
        .bind(topic.board_id)
        .execute(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            author_id,
            "topic.delete",
            "topic",
            Some(topic_id),
            json!({}),
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn moderate_topic(
        &self,
        topic_id: Uuid,
        moderator_id: Uuid,
        status: &str,
        reason: Option<&str>,
    ) -> Result<TopicModerationResultRecord, TopicModerationError> {
        if !matches!(status, "approved" | "hidden" | "rejected") {
            return Err(TopicModerationError::InvalidStatus);
        }
        let mut transaction = self.pool.begin().await?;
        let topic = sqlx::query_as::<_, TopicModerationRow>(
            "SELECT board_id, status, deleted_at FROM topics WHERE id = $1 FOR UPDATE",
        )
        .bind(topic_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(TopicModerationError::Unavailable)?;
        let is_moderator = has_permission_with_executor(
            &mut transaction,
            moderator_id,
            permission_keys::MODERATION_TOPIC,
            Some(topic.board_id),
        )
        .await?;
        if !is_moderator {
            return Err(TopicModerationError::Forbidden);
        }
        let was_public = topic.status == "published" && topic.deleted_at.is_none();
        let becomes_public = status == "approved";
        sqlx::query(
            "UPDATE topics SET status = CASE WHEN $2 = 'approved' THEN 'published' ELSE 'hidden' END,
                moderation_status = $2,
                published_at = CASE WHEN $2 = 'approved' THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE published_at END,
                deleted_at = CASE WHEN $2 = 'approved' THEN NULL ELSE deleted_at END,
                updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        )
        .bind(topic_id)
        .bind(status)
        .execute(&mut *transaction)
        .await?;
        if was_public != becomes_public {
            let delta = if becomes_public { 1_i64 } else { -1_i64 };
            sqlx::query(
                "UPDATE boards SET topic_count = GREATEST(topic_count + $2, 0), updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            )
            .bind(topic.board_id)
            .bind(delta)
            .execute(&mut *transaction)
            .await?;
        }
        sqlx::query(
            "INSERT INTO topic_moderation_actions (id, topic_id, moderator_id, action, reason)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(Uuid::now_v7())
        .bind(topic_id)
        .bind(moderator_id)
        .bind(status)
        .bind(reason)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(TopicModerationResultRecord {
            topic_id,
            status: status.to_owned(),
        })
    }

    pub async fn create_published_topic(
        &self,
        input: NewTopicRecord,
        idempotency: Option<IdempotencyInput>,
    ) -> Result<CreateTopicResult, CreateTopicError> {
        let mut transaction = self.pool.begin().await?;
        let active_author = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE",
        )
        .bind(input.author_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if active_author.is_none() {
            return Err(CreateTopicError::AuthorRestricted);
        }
        if let Some(idempotency) = idempotency.as_ref() {
            let inserted = sqlx::query_as::<_, IdempotencyRow>(
                "INSERT INTO idempotency_records (\
                    id, user_id, endpoint, idempotency_key, request_hash, resource_type, resource_id, expires_at\
                 ) VALUES (\
                    $1, $2, 'POST /api/v1/topics', $3, $4, 'topic', $5, CURRENT_TIMESTAMP + INTERVAL '1 day'\
                 )\
                 ON CONFLICT (user_id, endpoint, idempotency_key) DO NOTHING \
                 RETURNING request_hash, resource_id",
            )
            .bind(Uuid::now_v7())
            .bind(input.author_id)
            .bind(&idempotency.key)
            .bind(&idempotency.request_hash)
            .bind(input.id)
            .fetch_optional(&mut *transaction)
            .await?;

            if let Some(record) = inserted {
                debug_assert_eq!(record.resource_id, input.id);
            } else {
                let existing = sqlx::query_as::<_, IdempotencyRow>(
                    "SELECT request_hash, resource_id \
                     FROM idempotency_records \
                     WHERE user_id = $1 AND endpoint = 'POST /api/v1/topics' AND idempotency_key = $2",
                )
                .bind(input.author_id)
                .bind(&idempotency.key)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or_else(|| {
                    CreateTopicError::Database(DatabaseError::from(sqlx::Error::Protocol(
                        "idempotency record disappeared after conflict".to_owned(),
                    )))
                })?;

                if record_hash_matches(&existing.request_hash, &idempotency.request_hash) {
                    transaction.commit().await?;
                    return Ok(CreateTopicResult {
                        topic_id: existing.resource_id,
                        created: false,
                    });
                }
                return Err(CreateTopicError::IdempotencyConflict);
            }
        }

        let board_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM boards \
             WHERE visibility = 'public' AND deleted_at IS NULL \
               AND ($1::uuid IS NULL OR id = $1) \
             ORDER BY position, id \
             LIMIT 1 \
             FOR SHARE",
        )
        .bind(input.board_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(CreateTopicError::BoardUnavailable)?;

        let inserted = sqlx::query(
            "INSERT INTO topics (\
                id, board_id, author_id, title, excerpt, content, status, published_at, last_activity_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        )
        .bind(input.id)
        .bind(board_id)
        .bind(input.author_id)
        .bind(&input.title)
        .bind(&input.excerpt)
        .bind(&input.content)
        .execute(&mut *transaction)
        .await?;
        debug_assert_eq!(inserted.rows_affected(), 1);

        let inserted_post = sqlx::query(
            "INSERT INTO posts (id, topic_id, author_id, kind, content, status) \
             VALUES ($1, $1, $2, 'topic', $3, 'published')",
        )
        .bind(input.id)
        .bind(input.author_id)
        .bind(&input.content)
        .execute(&mut *transaction)
        .await?;
        debug_assert_eq!(inserted_post.rows_affected(), 1);

        let inserted_revision = sqlx::query(
            "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content) \
             VALUES ($1, $2, $3, 1, $4)",
        )
        .bind(Uuid::now_v7())
        .bind(input.id)
        .bind(input.author_id)
        .bind(&input.content)
        .execute(&mut *transaction)
        .await?;
        debug_assert_eq!(inserted_revision.rows_affected(), 1);

        for tag in &input.tags {
            let tag_id = sqlx::query_scalar::<_, Uuid>(
                "INSERT INTO tags (id, slug, name) VALUES ($1, $2, $3) \
                 ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug \
                 RETURNING id",
            )
            .bind(Uuid::now_v7())
            .bind(&tag.slug)
            .bind(&tag.name)
            .fetch_one(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO topic_tags (topic_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(input.id)
            .bind(tag_id)
            .execute(&mut *transaction)
            .await?;
        }

        let updated = sqlx::query(
            "UPDATE boards SET topic_count = topic_count + 1, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND visibility = 'public' AND deleted_at IS NULL",
        )
        .bind(board_id)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(CreateTopicError::BoardUnavailable);
        }

        insert_audit(
            &mut transaction,
            input.author_id,
            "topic.create",
            "topic",
            Some(input.id),
            json!({"board_id": board_id}),
        )
        .await?;
        transaction.commit().await?;
        Ok(CreateTopicResult {
            topic_id: input.id,
            created: true,
        })
    }

    pub async fn update_published_topic(
        &self,
        input: UpdateTopicRecord,
    ) -> Result<UpdateTopicResult, UpdateTopicError> {
        let mut transaction = self.pool.begin().await?;
        let current = sqlx::query_as::<_, EditableTopicRow>(
            "SELECT t.author_id, t.status, t.deleted_at, p.revision_count, p.content \
             FROM topics AS t \
             INNER JOIN posts AS p ON p.topic_id = t.id AND p.kind = 'topic' AND p.deleted_at IS NULL \
             WHERE t.id = $1 FOR UPDATE OF t, p",
        )
        .bind(input.topic_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(UpdateTopicError::TopicUnavailable)?;
        if current.status != "published" || current.deleted_at.is_some() {
            return Err(UpdateTopicError::TopicUnavailable);
        }
        if current.author_id != input.author_id {
            return Err(UpdateTopicError::Forbidden);
        }
        if current.revision_count != input.base_revision {
            return Err(UpdateTopicError::RevisionConflict);
        }

        let next_revision = current.revision_count + 1;
        let updated = sqlx::query(
            "UPDATE topics AS t SET \
                title = COALESCE($2, t.title), \
                excerpt = COALESCE($3, t.excerpt), \
                content = COALESCE($4, t.content), \
                updated_at = CURRENT_TIMESTAMP \
             WHERE t.id = $1",
        )
        .bind(input.topic_id)
        .bind(input.title.as_deref())
        .bind(input.excerpt.as_deref())
        .bind(input.content.as_deref())
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(UpdateTopicError::TopicUnavailable);
        }

        let next_content = input.content.as_deref().unwrap_or(current.content.as_str());
        sqlx::query(
            "UPDATE posts SET content = $2, revision_count = $3, updated_at = CURRENT_TIMESTAMP \
             WHERE topic_id = $1 AND kind = 'topic' AND deleted_at IS NULL",
        )
        .bind(input.topic_id)
        .bind(next_content)
        .bind(next_revision)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content) \
             SELECT $1, p.id, $2, $3, $4 FROM posts AS p \
             WHERE p.topic_id = $5 AND p.kind = 'topic' AND p.deleted_at IS NULL",
        )
        .bind(Uuid::now_v7())
        .bind(input.author_id)
        .bind(next_revision)
        .bind(next_content)
        .bind(input.topic_id)
        .execute(&mut *transaction)
        .await?;

        if let Some(tags) = input.tags {
            sqlx::query("DELETE FROM topic_tags WHERE topic_id = $1")
                .bind(input.topic_id)
                .execute(&mut *transaction)
                .await?;
            for tag in tags {
                let tag_id = sqlx::query_scalar::<_, Uuid>(
                    "INSERT INTO tags (id, slug, name) VALUES ($1, $2, $3) \
                     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug \
                     RETURNING id",
                )
                .bind(Uuid::now_v7())
                .bind(&tag.slug)
                .bind(&tag.name)
                .fetch_one(&mut *transaction)
                .await?;
                sqlx::query(
                    "INSERT INTO topic_tags (topic_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                )
                .bind(input.topic_id)
                .bind(tag_id)
                .execute(&mut *transaction)
                .await?;
            }
        }

        insert_audit(
            &mut transaction,
            input.author_id,
            "topic.update",
            "topic",
            Some(input.topic_id),
            json!({"revision": next_revision}),
        )
        .await?;
        transaction.commit().await?;
        Ok(UpdateTopicResult {
            topic_id: input.topic_id,
            revision_number: next_revision,
        })
    }

    pub async fn list_public_tags(&self) -> Result<Vec<PublicTagUsageRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, PublicTagUsageRecord>(
            "SELECT tg.slug, tg.name, COUNT(DISTINCT tt.topic_id) AS topic_count \
             FROM tags AS tg \
             INNER JOIN topic_tags AS tt ON tt.tag_id = tg.id \
             INNER JOIN topics AS t ON t.id = tt.topic_id \
             INNER JOIN boards AS b ON b.id = t.board_id \
             INNER JOIN users AS u ON u.id = t.author_id \
             WHERE t.status = 'published' AND t.deleted_at IS NULL \
               AND b.visibility = 'public' AND b.deleted_at IS NULL \
               AND u.status = 'active' \
             GROUP BY tg.id, tg.slug, tg.name \
             ORDER BY COUNT(DISTINCT tt.topic_id) DESC, tg.slug ASC",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_topic_revisions(
        &self,
        topic_id: Uuid,
        author_id: Uuid,
    ) -> Result<Option<Vec<TopicRevisionRecord>>, ListTopicRevisionsError> {
        let visible_author = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM topics AS t \
             INNER JOIN boards AS b ON b.id = t.board_id \
             INNER JOIN users AS u ON u.id = t.author_id \
             WHERE t.id = $1 AND t.author_id = $2 AND t.status = 'published' \
               AND t.deleted_at IS NULL AND b.visibility = 'public' AND b.deleted_at IS NULL \
               AND u.status = 'active')",
        )
        .bind(topic_id)
        .bind(author_id)
        .fetch_one(&self.pool)
        .await?;
        if !visible_author {
            return Ok(None);
        }
        let revisions = sqlx::query_as::<_, TopicRevisionRecord>(
            "SELECT r.id, p.topic_id, r.revision_number, e.id AS editor_id, \
                    e.username AS editor_username, e.display_name AS editor_display_name, \
                    e.avatar_url AS editor_avatar_url, \
                    r.content, r.created_at \
             FROM post_revisions AS r \
             INNER JOIN posts AS p ON p.id = r.post_id \
             INNER JOIN users AS e ON e.id = r.editor_id \
             WHERE p.topic_id = $1 AND p.kind = 'topic' AND e.status = 'active' \
             ORDER BY r.revision_number ASC, r.id ASC",
        )
        .bind(topic_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(Some(revisions))
    }

    pub async fn update_published_reply(
        &self,
        input: UpdateReplyRecord,
    ) -> Result<UpdateReplyResult, ReplyMutationError> {
        let mut transaction = self.pool.begin().await?;
        let visible_topic = sqlx::query_scalar::<_, Uuid>(
            "SELECT t.id FROM topics AS t \
             INNER JOIN boards AS b ON b.id = t.board_id \
             INNER JOIN users AS u ON u.id = t.author_id \
             WHERE t.id = $1 AND t.status = 'published' AND t.deleted_at IS NULL \
               AND b.visibility = 'public' AND b.deleted_at IS NULL AND u.status = 'active' \
             FOR UPDATE OF t FOR SHARE OF b, u",
        )
        .bind(input.topic_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if visible_topic.is_none() {
            return Err(ReplyMutationError::ReplyUnavailable);
        }

        let current = sqlx::query_as::<_, EditableReplyRow>(
            "SELECT author_id, revision_count FROM posts \
             WHERE id = $1 AND topic_id = $2 AND kind = 'reply' \
               AND status = 'published' AND deleted_at IS NULL FOR UPDATE",
        )
        .bind(input.reply_id)
        .bind(input.topic_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(current) = current else {
            return Err(ReplyMutationError::ReplyUnavailable);
        };
        if current.author_id != input.author_id {
            return Err(ReplyMutationError::ReplyUnavailable);
        }
        if current.revision_count != input.base_revision {
            return Err(ReplyMutationError::RevisionConflict);
        }

        let next_revision = current.revision_count + 1;
        let updated = sqlx::query(
            "UPDATE posts SET content = $2, revision_count = $3, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(input.reply_id)
        .bind(&input.content)
        .bind(next_revision)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(ReplyMutationError::ReplyUnavailable);
        }
        sqlx::query(
            "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(Uuid::now_v7())
        .bind(input.reply_id)
        .bind(input.author_id)
        .bind(next_revision)
        .bind(&input.content)
        .execute(&mut *transaction)
        .await?;

        insert_audit(
            &mut transaction,
            input.author_id,
            "reply.update",
            "reply",
            Some(input.reply_id),
            json!({"topic_id": input.topic_id, "revision": next_revision}),
        )
        .await?;
        transaction.commit().await?;
        Ok(UpdateReplyResult {
            reply_id: input.reply_id,
            revision_number: next_revision,
        })
    }

    pub async fn list_reply_revisions(
        &self,
        topic_id: Uuid,
        reply_id: Uuid,
        author_id: Uuid,
    ) -> Result<Option<Vec<ReplyRevisionRecord>>, DatabaseError> {
        let revisions = sqlx::query_as::<_, ReplyRevisionRecord>(
            "SELECT r.id, p.id AS reply_id, r.revision_number, e.id AS editor_id, \
                    e.username AS editor_username, e.display_name AS editor_display_name, \
                    e.avatar_url AS editor_avatar_url, \
                    r.content, r.created_at \
             FROM post_revisions AS r \
             INNER JOIN posts AS p ON p.id = r.post_id \
             INNER JOIN users AS e ON e.id = r.editor_id \
             INNER JOIN users AS a ON a.id = p.author_id \
             INNER JOIN topics AS t ON t.id = p.topic_id \
             INNER JOIN boards AS b ON b.id = t.board_id \
             INNER JOIN users AS ta ON ta.id = t.author_id \
             WHERE p.id = $1 AND p.topic_id = $2 AND p.author_id = $3 \
               AND p.kind = 'reply' AND p.status = 'published' AND p.deleted_at IS NULL \
               AND a.status = 'active' AND e.status = 'active' \
               AND t.status = 'published' AND t.deleted_at IS NULL \
               AND b.visibility = 'public' AND b.deleted_at IS NULL AND ta.status = 'active' \
             ORDER BY r.revision_number ASC, r.id ASC",
        )
        .bind(reply_id)
        .bind(topic_id)
        .bind(author_id)
        .fetch_all(&self.pool)
        .await?;
        Ok((!revisions.is_empty()).then_some(revisions))
    }

    pub async fn delete_published_reply(
        &self,
        topic_id: Uuid,
        reply_id: Uuid,
        author_id: Uuid,
    ) -> Result<(), ReplyMutationError> {
        let mut transaction = self.pool.begin().await?;
        let visible_topic = sqlx::query_scalar::<_, Uuid>(
            "SELECT t.id FROM topics AS t \
             INNER JOIN boards AS b ON b.id = t.board_id \
             INNER JOIN users AS u ON u.id = t.author_id \
             WHERE t.id = $1 AND t.status = 'published' AND t.deleted_at IS NULL \
               AND b.visibility = 'public' AND b.deleted_at IS NULL AND u.status = 'active' \
             FOR UPDATE OF t FOR SHARE OF b, u",
        )
        .bind(topic_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if visible_topic.is_none() {
            return Err(ReplyMutationError::ReplyUnavailable);
        }

        let reply_author = sqlx::query_scalar::<_, Uuid>(
            "SELECT author_id FROM posts \
             WHERE id = $1 AND topic_id = $2 AND kind = 'reply' \
               AND status = 'published' AND deleted_at IS NULL FOR UPDATE",
        )
        .bind(reply_id)
        .bind(topic_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if reply_author != Some(author_id) {
            return Err(ReplyMutationError::ReplyUnavailable);
        }

        let deleted = sqlx::query(
            "UPDATE posts SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(reply_id)
        .execute(&mut *transaction)
        .await?;
        if deleted.rows_affected() != 1 {
            return Err(ReplyMutationError::ReplyUnavailable);
        }

        let updated_topic = sqlx::query(
            "UPDATE topics AS t SET \
                 reply_count = stats.reply_count, \
                 last_activity_at = COALESCE(stats.last_activity_at, t.published_at), \
                 updated_at = CURRENT_TIMESTAMP \
             FROM (\
                 SELECT COUNT(*) AS reply_count, MAX(p.created_at) AS last_activity_at \
                 FROM posts AS p INNER JOIN users AS u ON u.id = p.author_id \
                 WHERE p.topic_id = $1 AND p.kind = 'reply' AND p.status = 'published' \
                   AND p.deleted_at IS NULL AND u.status = 'active'\
             ) AS stats \
             WHERE t.id = $1",
        )
        .bind(topic_id)
        .execute(&mut *transaction)
        .await?;
        debug_assert_eq!(updated_topic.rows_affected(), 1);

        insert_audit(
            &mut transaction,
            author_id,
            "reply.delete",
            "reply",
            Some(reply_id),
            json!({"topic_id": topic_id}),
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn create_published_reply(
        &self,
        input: NewReplyRecord,
        idempotency: Option<IdempotencyInput>,
    ) -> Result<CreateReplyResult, CreateReplyError> {
        let mut transaction = self.pool.begin().await?;
        let active_author = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE",
        )
        .bind(input.author_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if active_author.is_none() {
            return Err(CreateReplyError::AuthorRestricted);
        }
        if let Some(idempotency) = idempotency.as_ref() {
            let inserted = sqlx::query_as::<_, IdempotencyRow>(
                "INSERT INTO idempotency_records (\
                    id, user_id, endpoint, idempotency_key, request_hash, resource_type, resource_id, expires_at\
                 ) VALUES (\
                    $1, $2, 'POST /api/v1/topics/{topic_id}/replies', $3, $4, 'reply', $5, CURRENT_TIMESTAMP + INTERVAL '1 day'\
                 )\
                 ON CONFLICT (user_id, endpoint, idempotency_key) DO NOTHING \
                 RETURNING request_hash, resource_id",
            )
            .bind(Uuid::now_v7())
            .bind(input.author_id)
            .bind(&idempotency.key)
            .bind(&idempotency.request_hash)
            .bind(input.id)
            .fetch_optional(&mut *transaction)
            .await?;

            if inserted.is_none() {
                let existing = sqlx::query_as::<_, IdempotencyRow>(
                    "SELECT request_hash, resource_id \
                     FROM idempotency_records \
                     WHERE user_id = $1 \
                       AND endpoint = 'POST /api/v1/topics/{topic_id}/replies' \
                       AND idempotency_key = $2",
                )
                .bind(input.author_id)
                .bind(&idempotency.key)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or_else(|| {
                    CreateReplyError::Database(DatabaseError::from(sqlx::Error::Protocol(
                        "reply idempotency record disappeared after conflict".to_owned(),
                    )))
                })?;

                if record_hash_matches(&existing.request_hash, &idempotency.request_hash) {
                    transaction.commit().await?;
                    return Ok(CreateReplyResult {
                        reply_id: existing.resource_id,
                        created: false,
                    });
                }
                return Err(CreateReplyError::IdempotencyConflict);
            }
        }

        let visible_topic = sqlx::query_scalar::<_, Uuid>(
            "SELECT t.id \
             FROM topics AS t \
             INNER JOIN boards AS b ON b.id = t.board_id \
             INNER JOIN users AS u ON u.id = t.author_id \
             WHERE t.id = $1 \
               AND t.status = 'published' AND t.deleted_at IS NULL \
               AND b.visibility = 'public' AND b.deleted_at IS NULL \
               AND u.status = 'active' \
             FOR UPDATE OF t FOR SHARE OF b, u",
        )
        .bind(input.topic_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if visible_topic.is_none() {
            return Err(CreateReplyError::TopicUnavailable);
        }
        let topic_author_id =
            sqlx::query_scalar::<_, Uuid>("SELECT author_id FROM topics WHERE id = $1")
                .bind(input.topic_id)
                .fetch_one(&mut *transaction)
                .await?;

        sqlx::query(
            "INSERT INTO posts (id, topic_id, author_id, kind, content, status) \
             VALUES ($1, $2, $3, 'reply', $4, 'published')",
        )
        .bind(input.id)
        .bind(input.topic_id)
        .bind(input.author_id)
        .bind(&input.content)
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content) \
             VALUES ($1, $2, $3, 1, $4)",
        )
        .bind(input.revision_id)
        .bind(input.id)
        .bind(input.author_id)
        .bind(&input.content)
        .execute(&mut *transaction)
        .await?;

        let updated = sqlx::query(
            "UPDATE topics \
             SET reply_count = reply_count + 1, \
                 last_activity_at = CURRENT_TIMESTAMP, \
                 updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1",
        )
        .bind(input.topic_id)
        .execute(&mut *transaction)
        .await?;
        debug_assert_eq!(updated.rows_affected(), 1);

        if topic_author_id != input.author_id {
            insert_notification(
                &mut transaction,
                Uuid::now_v7(),
                topic_author_id,
                Some(input.author_id),
                "reply",
                "topic",
                input.topic_id,
                &format!("reply:{}", input.id),
            )
            .await?;
        }

        insert_audit(
            &mut transaction,
            input.author_id,
            "reply.create",
            "reply",
            Some(input.id),
            json!({"topic_id": input.topic_id}),
        )
        .await?;
        transaction.commit().await?;
        Ok(CreateReplyResult {
            reply_id: input.id,
            created: true,
        })
    }

    pub async fn list_public_replies(
        &self,
        topic_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Option<Vec<PublicReplyRecord>>, ListPublicRepliesError> {
        self.list_public_replies_for_viewer(topic_id, None, cursor, limit)
            .await
    }

    pub async fn list_public_replies_for_viewer(
        &self,
        topic_id: Uuid,
        viewer_user_id: Option<Uuid>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Option<Vec<PublicReplyRecord>>, ListPublicRepliesError> {
        let topic_is_visible = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (\
                 SELECT 1 FROM topics AS t \
                 INNER JOIN boards AS b ON b.id = t.board_id \
                 INNER JOIN users AS u ON u.id = t.author_id \
                 WHERE t.id = $1 \
                   AND t.status = 'published' AND t.deleted_at IS NULL \
                   AND b.visibility = 'public' AND b.deleted_at IS NULL \
                   AND u.status = 'active'\
             )",
        )
        .bind(topic_id)
        .fetch_one(&self.pool)
        .await?;
        if !topic_is_visible {
            return Ok(None);
        }

        if let Some(cursor) = cursor {
            let cursor_is_valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (\
                     SELECT 1 FROM posts AS p \
                     INNER JOIN users AS u ON u.id = p.author_id \
                     WHERE p.id = $1 AND p.topic_id = $2 \
                       AND p.kind = 'reply' AND p.status = 'published' \
                       AND p.deleted_at IS NULL AND u.status = 'active'\
                 )",
            )
            .bind(cursor)
            .bind(topic_id)
            .fetch_one(&self.pool)
            .await?;
            if !cursor_is_valid {
                return Err(ListPublicRepliesError::InvalidCursor);
            }
        }

        let mut replies = sqlx::query_as::<_, PublicReplyRecord>(
            "SELECT p.id, p.topic_id, p.author_id, \
                    u.username AS author_username, u.display_name AS author_display_name, \
                    u.avatar_url AS author_avatar_url, \
                    p.content, p.created_at, p.updated_at, p.revision_count, p.like_count \
             FROM posts AS p \
             INNER JOIN users AS u ON u.id = p.author_id \
             WHERE p.topic_id = $1 \
               AND p.kind = 'reply' AND p.status = 'published' \
               AND p.deleted_at IS NULL AND u.status = 'active' \
               AND (\
                   $2::uuid IS NULL \
                   OR (p.created_at, p.id) > (\
                       SELECT c.created_at, c.id FROM posts AS c WHERE c.id = $2\
                   )\
               ) \
             ORDER BY p.created_at ASC, p.id ASC \
             LIMIT $3",
        )
        .bind(topic_id)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        if let Some(viewer_user_id) = viewer_user_id {
            hydrate_reply_viewer_states(&self.pool, &mut replies, viewer_user_id).await?;
        }
        Ok(Some(replies))
    }

    pub async fn public_reply(
        &self,
        reply_id: Uuid,
    ) -> Result<Option<PublicReplyRecord>, DatabaseError> {
        let reply = sqlx::query_as::<_, PublicReplyRecord>(
            "SELECT p.id, p.topic_id, p.author_id, \
                    u.username AS author_username, u.display_name AS author_display_name, \
                    u.avatar_url AS author_avatar_url, \
                    p.content, p.created_at, p.updated_at, p.revision_count, p.like_count \
             FROM posts AS p \
             INNER JOIN users AS u ON u.id = p.author_id \
             INNER JOIN topics AS t ON t.id = p.topic_id \
             INNER JOIN boards AS b ON b.id = t.board_id \
             INNER JOIN users AS topic_author ON topic_author.id = t.author_id \
             WHERE p.id = $1 AND p.kind = 'reply' \
               AND p.status = 'published' AND p.deleted_at IS NULL \
               AND u.status = 'active' \
               AND t.status = 'published' AND t.deleted_at IS NULL \
               AND b.visibility = 'public' AND b.deleted_at IS NULL \
               AND topic_author.status = 'active'",
        )
        .bind(reply_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(reply)
    }

    pub async fn list_public_topics(
        &self,
        filters: &PublicTopicFilters,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<PublicTopicRecord>, ListPublicTopicsError> {
        if let Some(cursor) = cursor {
            let cursor_is_valid = sqlx::query_scalar::<_, bool>(
                r#"SELECT EXISTS (
                     SELECT 1
                     FROM topics AS t
                     INNER JOIN boards AS b ON b.id = t.board_id
                     INNER JOIN users AS u ON u.id = t.author_id
                     WHERE t.id = $1
                       AND t.status = 'published'
                       AND t.deleted_at IS NULL
                       AND b.visibility = 'public'
                       AND b.deleted_at IS NULL
                       AND u.status = 'active'
                       AND ($2::text IS NULL OR b.slug = $2)
                       AND ($3::text IS NULL OR t.search_vector @@ websearch_to_tsquery('simple', $3))
                       AND ($4::text IS NULL OR EXISTS (
                           SELECT 1 FROM topic_tags AS ctt
                           INNER JOIN tags AS ctg ON ctg.id = ctt.tag_id
                           WHERE ctt.topic_id = t.id AND ctg.slug = $4
                       ))
                       AND (NOT $5 OR t.featured_at IS NOT NULL)
                       AND ($6::text IS NULL OR u.username = $6)
                       AND ($7::uuid IS NULL OR EXISTS (
                           SELECT 1 FROM user_follows AS uf
                           WHERE uf.follower_id = $7 AND uf.followed_id = u.id
                       ))
                 )"#,
            )
            .bind(cursor)
            .bind(filters.board_slug.as_deref())
            .bind(filters.search.as_deref())
            .bind(filters.tag_slug.as_deref())
            .bind(filters.featured_only)
            .bind(filters.author_username.as_deref())
            .bind(filters.following_user_id)
            .fetch_one(&self.pool)
            .await?;
            if !cursor_is_valid {
                return Err(ListPublicTopicsError::InvalidCursor);
            }
        }

        let mut records = match filters.sort {
            TopicSort::Latest => {
                sqlx::query_as::<_, PublicTopicRecord>(
                    r#"SELECT t.id, t.title, t.excerpt,
                            u.id AS author_id, u.username AS author_username,
                            u.display_name AS author_display_name,
                            u.avatar_url AS author_avatar_url,
                            b.id AS board_id, b.slug AS board_slug, b.name AS board_name,
                            b.tone AS board_tone, t.published_at, t.last_activity_at,
                            t.reply_count, t.like_count, t.view_count,
                            (t.featured_at IS NOT NULL) AS is_featured,
                            (t.pinned_at IS NOT NULL) AS is_pinned
                     FROM topics AS t
                     INNER JOIN boards AS b ON b.id = t.board_id
                     INNER JOIN users AS u ON u.id = t.author_id
                     WHERE t.status = 'published'
                       AND t.deleted_at IS NULL
                       AND b.visibility = 'public'
                       AND b.deleted_at IS NULL
                       AND u.status = 'active'
                       AND ($1::text IS NULL OR b.slug = $1)
                       AND ($2::text IS NULL OR t.search_vector @@ websearch_to_tsquery('simple', $2))
                       AND ($3::text IS NULL OR EXISTS (
                           SELECT 1 FROM topic_tags AS ctt
                           INNER JOIN tags AS ctg ON ctg.id = ctt.tag_id
                           WHERE ctt.topic_id = t.id AND ctg.slug = $3
                       ))
                       AND (NOT $4 OR t.featured_at IS NOT NULL)
                       AND ($5::text IS NULL OR u.username = $5)
                       AND ($6::uuid IS NULL OR EXISTS (
                           SELECT 1 FROM user_follows AS uf
                           WHERE uf.follower_id = $6 AND uf.followed_id = u.id
                       ))
                       AND (
                           $7::uuid IS NULL
                           OR ((t.pinned_at IS NOT NULL), t.published_at, t.id) < (
                               SELECT (c.pinned_at IS NOT NULL), c.published_at, c.id
                               FROM topics AS c WHERE c.id = $7
                           )
                       )
                     ORDER BY (t.pinned_at IS NOT NULL) DESC, t.published_at DESC, t.id DESC
                     LIMIT $8"#,
                )
                .bind(filters.board_slug.as_deref())
                .bind(filters.search.as_deref())
                .bind(filters.tag_slug.as_deref())
                .bind(filters.featured_only)
                .bind(filters.author_username.as_deref())
                .bind(filters.following_user_id)
                .bind(cursor)
                .bind(limit)
                .fetch_all(&self.pool)
                .await
            }
            TopicSort::Popular => {
                sqlx::query_as::<_, PublicTopicRecord>(
                    r#"SELECT t.id, t.title, t.excerpt,
                            u.id AS author_id, u.username AS author_username,
                            u.display_name AS author_display_name,
                            u.avatar_url AS author_avatar_url,
                            b.id AS board_id, b.slug AS board_slug, b.name AS board_name,
                            b.tone AS board_tone, t.published_at, t.last_activity_at,
                            t.reply_count, t.like_count, t.view_count,
                            (t.featured_at IS NOT NULL) AS is_featured,
                            (t.pinned_at IS NOT NULL) AS is_pinned
                     FROM topics AS t
                     INNER JOIN boards AS b ON b.id = t.board_id
                     INNER JOIN users AS u ON u.id = t.author_id
                     WHERE t.status = 'published'
                       AND t.deleted_at IS NULL
                       AND b.visibility = 'public'
                       AND b.deleted_at IS NULL
                       AND u.status = 'active'
                       AND ($1::text IS NULL OR b.slug = $1)
                       AND ($2::text IS NULL OR t.search_vector @@ websearch_to_tsquery('simple', $2))
                       AND ($3::text IS NULL OR EXISTS (
                           SELECT 1 FROM topic_tags AS ctt
                           INNER JOIN tags AS ctg ON ctg.id = ctt.tag_id
                           WHERE ctt.topic_id = t.id AND ctg.slug = $3
                       ))
                       AND (NOT $4 OR t.featured_at IS NOT NULL)
                       AND ($5::text IS NULL OR u.username = $5)
                       AND ($6::uuid IS NULL OR EXISTS (
                           SELECT 1 FROM user_follows AS uf
                           WHERE uf.follower_id = $6 AND uf.followed_id = u.id
                       ))
                       AND (
                           $7::uuid IS NULL
                           OR ((t.pinned_at IS NOT NULL), t.hot_score, t.published_at, t.id) < (
                               SELECT (c.pinned_at IS NOT NULL), c.hot_score, c.published_at, c.id
                               FROM topics AS c WHERE c.id = $7
                           )
                       )
                     ORDER BY (t.pinned_at IS NOT NULL) DESC, t.hot_score DESC,
                              t.published_at DESC, t.id DESC
                     LIMIT $8"#,
                )
                .bind(filters.board_slug.as_deref())
                .bind(filters.search.as_deref())
                .bind(filters.tag_slug.as_deref())
                .bind(filters.featured_only)
                .bind(filters.author_username.as_deref())
                .bind(filters.following_user_id)
                .bind(cursor)
                .bind(limit)
                .fetch_all(&self.pool)
                .await
            }
            TopicSort::Active => {
                sqlx::query_as::<_, PublicTopicRecord>(
                    r#"SELECT t.id, t.title, t.excerpt,
                            u.id AS author_id, u.username AS author_username,
                            u.display_name AS author_display_name,
                            u.avatar_url AS author_avatar_url,
                            b.id AS board_id, b.slug AS board_slug, b.name AS board_name,
                            b.tone AS board_tone, t.published_at, t.last_activity_at,
                            t.reply_count, t.like_count, t.view_count,
                            (t.featured_at IS NOT NULL) AS is_featured,
                            (t.pinned_at IS NOT NULL) AS is_pinned
                     FROM topics AS t
                     INNER JOIN boards AS b ON b.id = t.board_id
                     INNER JOIN users AS u ON u.id = t.author_id
                     WHERE t.status = 'published'
                       AND t.deleted_at IS NULL
                       AND b.visibility = 'public'
                       AND b.deleted_at IS NULL
                       AND u.status = 'active'
                       AND ($1::text IS NULL OR b.slug = $1)
                       AND ($2::text IS NULL OR t.search_vector @@ websearch_to_tsquery('simple', $2))
                       AND ($3::text IS NULL OR EXISTS (
                           SELECT 1 FROM topic_tags AS ctt
                           INNER JOIN tags AS ctg ON ctg.id = ctt.tag_id
                           WHERE ctt.topic_id = t.id AND ctg.slug = $3
                       ))
                       AND (NOT $4 OR t.featured_at IS NOT NULL)
                       AND ($5::text IS NULL OR u.username = $5)
                       AND ($6::uuid IS NULL OR EXISTS (
                           SELECT 1 FROM user_follows AS uf
                           WHERE uf.follower_id = $6 AND uf.followed_id = u.id
                       ))
                       AND (
                           $7::uuid IS NULL
                           OR ((t.pinned_at IS NOT NULL), t.last_activity_at, t.id) < (
                               SELECT (c.pinned_at IS NOT NULL), c.last_activity_at, c.id
                               FROM topics AS c WHERE c.id = $7
                           )
                       )
                     ORDER BY (t.pinned_at IS NOT NULL) DESC, t.last_activity_at DESC, t.id DESC
                     LIMIT $8"#,
                )
                .bind(filters.board_slug.as_deref())
                .bind(filters.search.as_deref())
                .bind(filters.tag_slug.as_deref())
                .bind(filters.featured_only)
                .bind(filters.author_username.as_deref())
                .bind(filters.following_user_id)
                .bind(cursor)
                .bind(limit)
                .fetch_all(&self.pool)
                .await
            }
        }?;

        let topic_ids = records.iter().map(|record| record.id).collect::<Vec<_>>();
        if !topic_ids.is_empty() {
            let tag_rows = sqlx::query_as::<_, TopicTagJoinRow>(
                "SELECT tt.topic_id, tg.slug, tg.name \
                 FROM topic_tags AS tt INNER JOIN tags AS tg ON tg.id = tt.tag_id \
                 WHERE tt.topic_id = ANY($1::uuid[]) ORDER BY tt.topic_id, tg.slug",
            )
            .bind(&topic_ids)
            .fetch_all(&self.pool)
            .await?;
            let mut tags_by_topic = HashMap::<Uuid, Vec<PublicTagRecord>>::new();
            for row in tag_rows {
                tags_by_topic
                    .entry(row.topic_id)
                    .or_default()
                    .push(PublicTagRecord {
                        slug: row.slug,
                        name: row.name,
                    });
            }
            for record in &mut records {
                record.tags = tags_by_topic.remove(&record.id).unwrap_or_default();
            }
        }
        if let Some(viewer_user_id) = filters.viewer_user_id {
            hydrate_topic_viewer_states(&self.pool, &mut records, viewer_user_id).await?;
        }
        Ok(records)
    }

    pub async fn public_topic(
        &self,
        topic_id: Uuid,
    ) -> Result<Option<PublicTopicDetailRecord>, DatabaseError> {
        let row = sqlx::query_as::<_, PublicTopicDetailRow>(
            r#"SELECT t.id, t.title, t.excerpt, t.content, p.revision_count AS content_revision,
                    u.id AS author_id, u.username AS author_username,
                    u.display_name AS author_display_name,
                    u.avatar_url AS author_avatar_url,
                    b.id AS board_id, b.slug AS board_slug, b.name AS board_name,
                    b.tone AS board_tone, t.published_at, t.last_activity_at,
                    t.reply_count, t.like_count, t.view_count,
                    (t.featured_at IS NOT NULL) AS is_featured,
                    (t.pinned_at IS NOT NULL) AS is_pinned
             FROM topics AS t
             INNER JOIN posts AS p ON p.topic_id = t.id AND p.kind = 'topic' AND p.deleted_at IS NULL
             INNER JOIN boards AS b ON b.id = t.board_id
             INNER JOIN users AS u ON u.id = t.author_id
             WHERE t.id = $1
               AND t.status = 'published'
               AND t.deleted_at IS NULL
               AND b.visibility = 'public'
               AND b.deleted_at IS NULL
               AND u.status = 'active'"#,
        )
        .bind(topic_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };
        let tags = sqlx::query_as::<_, PublicTagRecord>(
            "SELECT tg.slug, tg.name FROM topic_tags AS tt \
             INNER JOIN tags AS tg ON tg.id = tt.tag_id \
             WHERE tt.topic_id = $1 ORDER BY tg.slug",
        )
        .bind(topic_id)
        .fetch_all(&self.pool)
        .await?;
        let mut detail = PublicTopicDetailRecord::from(row);
        detail.summary.tags = tags;
        Ok(Some(detail))
    }

    pub async fn public_topic_for_viewer(
        &self,
        topic_id: Uuid,
        viewer_user_id: Option<Uuid>,
    ) -> Result<Option<PublicTopicDetailRecord>, DatabaseError> {
        let mut detail = self.public_topic(topic_id).await?;
        if let (Some(detail), Some(viewer_user_id)) = (&mut detail, viewer_user_id) {
            hydrate_topic_viewer_states(
                &self.pool,
                std::slice::from_mut(&mut detail.summary),
                viewer_user_id,
            )
            .await?;
        }
        Ok(detail)
    }
}

async fn hydrate_topic_viewer_states(
    pool: &sqlx::PgPool,
    topics: &mut [PublicTopicRecord],
    viewer_user_id: Uuid,
) -> Result<(), sqlx::Error> {
    let topic_ids = topics.iter().map(|topic| topic.id).collect::<Vec<_>>();
    if topic_ids.is_empty() {
        return Ok(());
    }
    let states = sqlx::query_as::<_, TopicViewerStateRow>(
        "SELECT topic.id AS topic_id, \
                EXISTS (\
                    SELECT 1 FROM topic_bookmarks AS bookmark \
                    WHERE bookmark.user_id = $1 AND bookmark.topic_id = topic.id\
                ) AS bookmarked, \
                EXISTS (\
                    SELECT 1 FROM post_likes AS post_like \
                    WHERE post_like.user_id = $1 AND post_like.post_id = topic.id\
                ) AS liked \
         FROM topics AS topic WHERE topic.id = ANY($2::uuid[])",
    )
    .bind(viewer_user_id)
    .bind(&topic_ids)
    .fetch_all(pool)
    .await?;
    let states = states
        .into_iter()
        .map(|state| (state.topic_id, (state.bookmarked, state.liked)))
        .collect::<HashMap<_, _>>();
    for topic in topics {
        let (bookmarked, liked) = states.get(&topic.id).copied().unwrap_or((false, false));
        topic.viewer_bookmarked = Some(bookmarked);
        topic.viewer_liked = Some(liked);
    }
    Ok(())
}

async fn hydrate_reply_viewer_states(
    pool: &sqlx::PgPool,
    replies: &mut [PublicReplyRecord],
    viewer_user_id: Uuid,
) -> Result<(), sqlx::Error> {
    let reply_ids = replies.iter().map(|reply| reply.id).collect::<Vec<_>>();
    if reply_ids.is_empty() {
        return Ok(());
    }
    let liked_reply_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT post_id FROM post_likes WHERE user_id = $1 AND post_id = ANY($2::uuid[])",
    )
    .bind(viewer_user_id)
    .bind(&reply_ids)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect::<HashSet<_>>();
    for reply in replies {
        reply.viewer_liked = Some(liked_reply_ids.contains(&reply.id));
    }
    Ok(())
}

#[derive(Debug, FromRow)]
struct IdempotencyRow {
    request_hash: Vec<u8>,
    resource_id: Uuid,
}

#[derive(Debug, FromRow)]
struct EditableTopicRow {
    author_id: Uuid,
    status: String,
    deleted_at: Option<OffsetDateTime>,
    revision_count: i32,
    content: String,
}

#[derive(Debug, FromRow)]
struct EditableReplyRow {
    author_id: Uuid,
    revision_count: i32,
}

#[derive(Debug, FromRow)]
struct TopicDeleteRow {
    author_id: Uuid,
    board_id: Uuid,
    status: String,
    deleted_at: Option<OffsetDateTime>,
}

#[derive(Debug, FromRow)]
struct TopicModerationRow {
    board_id: Uuid,
    status: String,
    deleted_at: Option<OffsetDateTime>,
}

fn record_hash_matches(left: &[u8], right: &[u8]) -> bool {
    left == right
}

#[derive(Debug, FromRow)]
struct PublicTopicDetailRow {
    id: Uuid,
    title: String,
    excerpt: String,
    content: String,
    content_revision: i32,
    author_id: Uuid,
    author_username: String,
    author_display_name: String,
    author_avatar_url: Option<String>,
    board_id: Uuid,
    board_slug: String,
    board_name: String,
    board_tone: String,
    published_at: OffsetDateTime,
    last_activity_at: OffsetDateTime,
    reply_count: i64,
    like_count: i64,
    view_count: i64,
    is_featured: bool,
    is_pinned: bool,
}

#[derive(Debug, FromRow)]
struct TopicTagJoinRow {
    topic_id: Uuid,
    slug: String,
    name: String,
}

#[derive(Debug, FromRow)]
struct TopicViewerStateRow {
    topic_id: Uuid,
    bookmarked: bool,
    liked: bool,
}

impl From<PublicTopicDetailRow> for PublicTopicDetailRecord {
    fn from(row: PublicTopicDetailRow) -> Self {
        Self {
            summary: PublicTopicRecord {
                id: row.id,
                title: row.title,
                excerpt: row.excerpt,
                author_id: row.author_id,
                author_username: row.author_username,
                author_display_name: row.author_display_name,
                author_avatar_url: row.author_avatar_url,
                board_id: row.board_id,
                board_slug: row.board_slug,
                board_name: row.board_name,
                board_tone: row.board_tone,
                published_at: row.published_at,
                last_activity_at: row.last_activity_at,
                reply_count: row.reply_count,
                like_count: row.like_count,
                viewer_bookmarked: None,
                viewer_liked: None,
                view_count: row.view_count,
                is_featured: row.is_featured,
                is_pinned: row.is_pinned,
                tags: Vec::new(),
            },
            content: row.content,
            content_revision: row.content_revision,
        }
    }
}

impl fmt::Display for ListPublicTopicsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCursor => formatter.write_str("topic cursor is not available"),
            Self::Database(_) => formatter.write_str("public topic list database operation failed"),
        }
    }
}

impl Error for ListPublicTopicsError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidCursor => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for ListPublicTopicsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for CreateTopicError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BoardUnavailable => formatter.write_str("topic board is unavailable"),
            Self::AuthorRestricted => formatter.write_str("topic author is restricted"),
            Self::IdempotencyConflict => formatter.write_str("topic idempotency key conflicts"),
            Self::Database(_) => formatter.write_str("topic creation database operation failed"),
        }
    }
}

impl Error for CreateTopicError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::BoardUnavailable | Self::AuthorRestricted | Self::IdempotencyConflict => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for CreateTopicError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for ListPublicRepliesError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCursor => formatter.write_str("reply cursor is not available"),
            Self::Database(_) => formatter.write_str("public reply list database operation failed"),
        }
    }
}

impl Error for ListPublicRepliesError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidCursor => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for ListPublicRepliesError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for CreateReplyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TopicUnavailable => formatter.write_str("reply topic is unavailable"),
            Self::AuthorRestricted => formatter.write_str("reply author is restricted"),
            Self::IdempotencyConflict => formatter.write_str("reply idempotency key conflicts"),
            Self::Database(_) => formatter.write_str("reply creation database operation failed"),
        }
    }
}

impl Error for CreateReplyError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::TopicUnavailable | Self::AuthorRestricted | Self::IdempotencyConflict => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for CreateReplyError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for UpdateTopicError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TopicUnavailable => formatter.write_str("topic is unavailable"),
            Self::Forbidden => formatter.write_str("topic edit is forbidden"),
            Self::RevisionConflict => formatter.write_str("topic revision conflicts"),
            Self::Database(_) => formatter.write_str("topic update database operation failed"),
        }
    }
}

impl Error for UpdateTopicError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::TopicUnavailable | Self::Forbidden | Self::RevisionConflict => None,
        }
    }
}

impl From<sqlx::Error> for UpdateTopicError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for ListTopicRevisionsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TopicUnavailable => formatter.write_str("topic revisions are unavailable"),
            Self::Database(_) => formatter.write_str("topic revision query failed"),
        }
    }
}

impl Error for ListTopicRevisionsError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::TopicUnavailable => None,
        }
    }
}

impl From<sqlx::Error> for ListTopicRevisionsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for ReplyMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReplyUnavailable => formatter.write_str("reply is unavailable"),
            Self::RevisionConflict => formatter.write_str("reply revision conflicts"),
            Self::Database(_) => formatter.write_str("reply mutation database operation failed"),
        }
    }
}

impl Error for ReplyMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::ReplyUnavailable | Self::RevisionConflict => None,
        }
    }
}

impl From<sqlx::Error> for ReplyMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for TopicDeleteError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for TopicDeleteError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => formatter.write_str("topic is unavailable"),
            Self::Forbidden => formatter.write_str("topic deletion is forbidden"),
            Self::Database(_) => formatter.write_str("topic deletion database operation failed"),
        }
    }
}

impl Error for TopicDeleteError {}

impl From<sqlx::Error> for TopicModerationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for TopicModerationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => formatter.write_str("topic is unavailable"),
            Self::Forbidden => formatter.write_str("topic moderation is forbidden"),
            Self::InvalidStatus => formatter.write_str("topic moderation status is invalid"),
            Self::Database(_) => formatter.write_str("topic moderation database operation failed"),
        }
    }
}

impl Error for TopicModerationError {}
