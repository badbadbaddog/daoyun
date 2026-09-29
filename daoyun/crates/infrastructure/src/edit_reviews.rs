use serde_json::{Value, json};
use sqlx::{FromRow, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::{
    Database, DatabaseError, NewTagRecord, ReplyMutationError, UpdateReplyRecord, UpdateTopicError,
    UpdateTopicRecord,
};

#[derive(Debug)]
pub enum EditReviewError {
    NotFound,
    Forbidden,
    Conflict,
    InvalidInput,
    AttachmentUnavailable,
    Database(DatabaseError),
}

impl From<sqlx::Error> for EditReviewError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditReviewDecisionRecord {
    Approve,
    Reject,
}

#[derive(Debug, Clone)]
pub struct EditReviewPolicyUpdateRecord {
    pub board_id: Uuid,
    pub topic_edits_require_review: bool,
    pub reply_edits_require_review: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct EditReviewPolicyRecord {
    pub board_id: Uuid,
    pub board_name: String,
    pub topic_edits_require_review: bool,
    pub reply_edits_require_review: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct EditReviewRecord {
    pub id: Uuid,
    pub board_id: Uuid,
    pub board_name: String,
    pub topic_id: Uuid,
    pub post_id: Uuid,
    pub target_type: String,
    pub editor_id: Uuid,
    pub editor_username: String,
    pub editor_display_name: String,
    pub editor_avatar_url: Option<String>,
    pub base_revision: i32,
    pub current_title: Option<String>,
    pub current_content: String,
    pub proposed_title: Option<String>,
    pub proposed_content: Option<String>,
    pub proposed_rich_content: Option<Value>,
    pub proposed_excerpt: Option<String>,
    pub proposed_tags: Option<Value>,
    pub content_changed: bool,
    pub status: String,
    pub revision: i32,
    pub reviewer_id: Option<Uuid>,
    pub reviewer_username: Option<String>,
    pub reviewer_display_name: Option<String>,
    pub reviewer_avatar_url: Option<String>,
    pub review_reason: Option<String>,
    pub created_at: OffsetDateTime,
    pub reviewed_at: Option<OffsetDateTime>,
}

#[derive(FromRow)]
struct EditableTarget {
    post_id: Uuid,
    board_id: Uuid,
    author_id: Uuid,
    revision_count: i32,
}

async fn review_required(
    transaction: &mut Transaction<'_, Postgres>,
    board_id: Uuid,
    column: &str,
) -> Result<bool, sqlx::Error> {
    let provider = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM plugins \
         WHERE status = 'enabled' AND capabilities ? 'topic.edit_review' \
         ORDER BY id LIMIT 1 FOR SHARE",
    )
    .fetch_optional(&mut **transaction)
    .await?;
    if provider.is_none() {
        return Ok(false);
    }
    let query = match column {
        "topic" => {
            "SELECT COALESCE((SELECT topic_edits_require_review FROM edit_review_policies WHERE board_id = $1), false)"
        }
        "reply" => {
            "SELECT COALESCE((SELECT reply_edits_require_review FROM edit_review_policies WHERE board_id = $1), false)"
        }
        _ => return Ok(false),
    };
    sqlx::query_scalar(query)
        .bind(board_id)
        .fetch_one(&mut **transaction)
        .await
}

async fn review_record(
    transaction: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<EditReviewRecord, EditReviewError> {
    sqlx::query_as(
        "SELECT r.id, t.board_id, b.name AS board_name, r.topic_id, r.post_id, r.target_type, \
                r.editor_id, e.username AS editor_username, e.display_name AS editor_display_name, \
                e.avatar_url AS editor_avatar_url, r.base_revision, \
                CASE WHEN r.target_type = 'topic' THEN t.title END AS current_title, \
                p.content AS current_content, r.proposed_title, r.proposed_content, \
                r.proposed_rich_content, r.proposed_excerpt, r.proposed_tags, r.content_changed, \
                r.status, r.revision, r.reviewer_id, rv.username AS reviewer_username, \
                rv.display_name AS reviewer_display_name, rv.avatar_url AS reviewer_avatar_url, \
                r.review_reason, r.created_at, r.reviewed_at \
         FROM content_edit_reviews r \
         JOIN topics t ON t.id = r.topic_id \
         JOIN boards b ON b.id = t.board_id \
         JOIN posts p ON p.id = r.post_id \
         JOIN users e ON e.id = r.editor_id \
         LEFT JOIN users rv ON rv.id = r.reviewer_id \
         WHERE r.id = $1",
    )
    .bind(id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(EditReviewError::NotFound)
}

fn tags_from_json(value: Option<Value>) -> Result<Option<Vec<NewTagRecord>>, EditReviewError> {
    let Some(Value::Array(items)) = value else {
        return Ok(None);
    };
    items
        .into_iter()
        .map(|item| {
            let Value::Object(object) = item else {
                return Err(EditReviewError::InvalidInput);
            };
            let slug = object
                .get("slug")
                .and_then(Value::as_str)
                .ok_or(EditReviewError::InvalidInput)?;
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .ok_or(EditReviewError::InvalidInput)?;
            Ok(NewTagRecord {
                slug: slug.to_owned(),
                name: name.to_owned(),
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

impl Database {
    pub async fn edit_review_policies(
        &self,
        actor: Uuid,
        update: Option<Vec<EditReviewPolicyUpdateRecord>>,
    ) -> Result<Vec<EditReviewPolicyRecord>, EditReviewError> {
        let mut transaction = self.pool.begin().await?;
        if let Some(updates) = update {
            if updates.is_empty() || updates.len() > 100 {
                return Err(EditReviewError::InvalidInput);
            }
            let mut unique = std::collections::BTreeSet::new();
            for item in &updates {
                if !unique.insert(item.board_id)
                    || !has_permission_with_executor(
                        &mut transaction,
                        actor,
                        permission_keys::ADMIN_CONFIGURATION_WRITE,
                        Some(item.board_id),
                    )
                    .await?
                {
                    return Err(EditReviewError::Forbidden);
                }
                let exists: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM boards WHERE id = $1 AND deleted_at IS NULL FOR UPDATE)",
                ).bind(item.board_id).fetch_one(&mut *transaction).await?;
                if !exists {
                    return Err(EditReviewError::NotFound);
                }
            }
            for item in updates {
                sqlx::query(
                    "INSERT INTO edit_review_policies (board_id, topic_edits_require_review, reply_edits_require_review) \
                     VALUES ($1, $2, $3) ON CONFLICT (board_id) DO UPDATE SET \
                     topic_edits_require_review = EXCLUDED.topic_edits_require_review, \
                     reply_edits_require_review = EXCLUDED.reply_edits_require_review, \
                     updated_at = CURRENT_TIMESTAMP",
                ).bind(item.board_id).bind(item.topic_edits_require_review)
                    .bind(item.reply_edits_require_review).execute(&mut *transaction).await?;
                insert_audit(
                    &mut transaction,
                    actor,
                    "topic.edit_review.policy",
                    "board",
                    Some(item.board_id),
                    json!({
                        "topic_edits_require_review": item.topic_edits_require_review,
                        "reply_edits_require_review": item.reply_edits_require_review,
                    }),
                )
                .await?;
            }
        }

        let boards: Vec<(Uuid, String, bool, bool)> = sqlx::query_as(
            "SELECT b.id, b.name, COALESCE(p.topic_edits_require_review, false), \
                    COALESCE(p.reply_edits_require_review, false) \
             FROM boards b LEFT JOIN edit_review_policies p ON p.board_id = b.id \
             WHERE b.deleted_at IS NULL ORDER BY b.position, b.name, b.id",
        )
        .fetch_all(&mut *transaction)
        .await?;
        let mut result = Vec::new();
        for (board_id, board_name, topic_edits_require_review, reply_edits_require_review) in boards
        {
            if has_permission_with_executor(
                &mut transaction,
                actor,
                permission_keys::ADMIN_CONFIGURATION_READ,
                Some(board_id),
            )
            .await?
            {
                result.push(EditReviewPolicyRecord {
                    board_id,
                    board_name,
                    topic_edits_require_review,
                    reply_edits_require_review,
                });
            }
        }
        transaction.commit().await?;
        Ok(result)
    }

    pub async fn submit_topic_edit_review(
        &self,
        input: UpdateTopicRecord,
    ) -> Result<Option<Uuid>, EditReviewError> {
        let mut transaction = self.pool.begin().await?;
        let current: EditableTarget = sqlx::query_as(
            "SELECT p.id AS post_id, t.board_id, t.author_id, p.revision_count \
             FROM topics t JOIN posts p ON p.topic_id = t.id AND p.kind = 'topic' AND p.deleted_at IS NULL \
             WHERE t.id = $1 AND t.status = 'published' AND t.deleted_at IS NULL FOR UPDATE OF t, p",
        ).bind(input.topic_id).fetch_optional(&mut *transaction).await?
            .ok_or(EditReviewError::NotFound)?;
        if current.author_id != input.author_id {
            return Err(EditReviewError::Forbidden);
        }
        if !review_required(&mut transaction, current.board_id, "topic").await? {
            transaction.commit().await?;
            return Ok(None);
        }
        if current.revision_count != input.base_revision {
            return Err(EditReviewError::Conflict);
        }
        let proposed_tags = input.tags.as_ref().map(|tags| {
            Value::Array(
                tags.iter()
                    .map(|tag| json!({"slug": tag.slug, "name": tag.name}))
                    .collect(),
            )
        });
        let id = Uuid::now_v7();
        let inserted = sqlx::query(
            "INSERT INTO content_edit_reviews \
             (id, board_id, topic_id, post_id, target_type, editor_id, base_revision, \
              proposed_title, proposed_excerpt, proposed_content, content_changed, proposed_rich_content, proposed_tags) \
             VALUES ($1, $2, $3, $4, 'topic', $5, $6, $7, $8, $9, $10, $11, $12)",
        ).bind(id).bind(current.board_id).bind(input.topic_id).bind(current.post_id)
            .bind(input.author_id).bind(input.base_revision).bind(input.title).bind(input.excerpt)
            .bind(input.content.as_deref()).bind(input.content.is_some()).bind(input.rich_content)
            .bind(proposed_tags).execute(&mut *transaction).await;
        if let Err(error) = inserted {
            if error.as_database_error().and_then(|e| e.code()).as_deref() == Some("23505") {
                return Err(EditReviewError::Conflict);
            }
            return Err(error.into());
        }
        insert_audit(
            &mut transaction,
            input.author_id,
            "topic.edit_review.submit",
            "edit_review",
            Some(id),
            json!({"topic_id": input.topic_id, "base_revision": input.base_revision}),
        )
        .await?;
        transaction.commit().await?;
        Ok(Some(id))
    }

    pub async fn submit_reply_edit_review(
        &self,
        input: UpdateReplyRecord,
    ) -> Result<Option<Uuid>, EditReviewError> {
        let mut transaction = self.pool.begin().await?;
        let current: EditableTarget = sqlx::query_as(
            "SELECT p.id AS post_id, t.board_id, p.author_id, p.revision_count \
             FROM posts p JOIN topics t ON t.id = p.topic_id \
             WHERE p.id = $1 AND p.topic_id = $2 AND p.kind = 'reply' AND p.status = 'published' \
               AND p.deleted_at IS NULL AND t.status = 'published' AND t.deleted_at IS NULL \
             FOR UPDATE OF t, p",
        )
        .bind(input.reply_id)
        .bind(input.topic_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(EditReviewError::NotFound)?;
        if current.author_id != input.author_id {
            return Err(EditReviewError::NotFound);
        }
        if !review_required(&mut transaction, current.board_id, "reply").await? {
            transaction.commit().await?;
            return Ok(None);
        }
        if current.revision_count != input.base_revision {
            return Err(EditReviewError::Conflict);
        }
        let id = Uuid::now_v7();
        let inserted = sqlx::query(
            "INSERT INTO content_edit_reviews \
             (id, board_id, topic_id, post_id, target_type, editor_id, base_revision, \
              proposed_content, content_changed, proposed_rich_content) \
             VALUES ($1, $2, $3, $4, 'reply', $5, $6, $7, true, $8)",
        )
        .bind(id)
        .bind(current.board_id)
        .bind(input.topic_id)
        .bind(current.post_id)
        .bind(input.author_id)
        .bind(input.base_revision)
        .bind(input.content)
        .bind(input.rich_content)
        .execute(&mut *transaction)
        .await;
        if let Err(error) = inserted {
            if error.as_database_error().and_then(|e| e.code()).as_deref() == Some("23505") {
                return Err(EditReviewError::Conflict);
            }
            return Err(error.into());
        }
        insert_audit(&mut transaction, input.author_id, "reply.edit_review.submit", "edit_review", Some(id),
            json!({"topic_id": input.topic_id, "reply_id": input.reply_id, "base_revision": input.base_revision})).await?;
        transaction.commit().await?;
        Ok(Some(id))
    }

    pub async fn list_edit_reviews(
        &self,
        actor: Uuid,
        board_id: Uuid,
        status: &str,
    ) -> Result<Vec<EditReviewRecord>, EditReviewError> {
        self.list_edit_reviews_page(actor, board_id, status, None, None, 100)
            .await
    }

    pub async fn list_edit_reviews_page(
        &self,
        actor: Uuid,
        board_id: Uuid,
        status: &str,
        target_type: Option<&str>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<EditReviewRecord>, EditReviewError> {
        if !matches!(status, "pending" | "approved" | "rejected")
            || !(1..=100).contains(&limit)
            || target_type.is_some_and(|value| !matches!(value, "topic" | "reply"))
        {
            return Err(EditReviewError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor,
            permission_keys::MODERATION_TOPIC,
            Some(board_id),
        )
        .await?
        {
            return Err(EditReviewError::Forbidden);
        }
        if let Some(cursor) = cursor {
            let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM content_edit_reviews r JOIN topics t ON t.id=r.topic_id WHERE r.id=$1 AND t.board_id=$2 AND r.status=$3 AND ($4::text IS NULL OR r.target_type=$4))")
                .bind(cursor).bind(board_id).bind(status).bind(target_type).fetch_one(&mut *transaction).await?;
            if !valid {
                return Err(EditReviewError::InvalidInput);
            }
        }
        let ids: Vec<Uuid> = sqlx::query_scalar("SELECT r.id FROM content_edit_reviews r JOIN topics t ON t.id=r.topic_id WHERE t.board_id=$1 AND r.status=$2 AND ($3::text IS NULL OR r.target_type=$3)
            AND ($4::uuid IS NULL OR (r.created_at,r.id)>(SELECT created_at,id FROM content_edit_reviews WHERE id=$4)) ORDER BY r.created_at,r.id LIMIT $5")
            .bind(board_id).bind(status).bind(target_type).bind(cursor).bind(limit).fetch_all(&mut *transaction).await?;
        let mut records = Vec::with_capacity(ids.len());
        for id in ids {
            records.push(review_record(&mut transaction, id).await?);
        }
        transaction.commit().await?;
        Ok(records)
    }

    pub async fn get_edit_review(
        &self,
        actor: Uuid,
        id: Uuid,
    ) -> Result<EditReviewRecord, EditReviewError> {
        let mut transaction = self.pool.begin().await?;
        let record = review_record(&mut transaction, id).await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor,
            permission_keys::MODERATION_TOPIC,
            Some(record.board_id),
        )
        .await?
        {
            return Err(EditReviewError::Forbidden);
        }
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn resolve_edit_review(
        &self,
        actor: Uuid,
        id: Uuid,
        decision: EditReviewDecisionRecord,
        base_revision: i32,
        reason: &str,
    ) -> Result<EditReviewRecord, EditReviewError> {
        if base_revision < 1
            || !(1..=500).contains(&reason.trim().chars().count())
            || reason.chars().any(char::is_control)
        {
            return Err(EditReviewError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        // Lock the current topic before authorizing so a concurrent board move cannot change the scope.
        sqlx::query_scalar::<_, Uuid>(
            "SELECT t.id FROM topics t JOIN content_edit_reviews r ON r.topic_id=t.id WHERE r.id=$1 FOR UPDATE OF t",
        ).bind(id).fetch_optional(&mut *transaction).await?.ok_or(EditReviewError::NotFound)?;
        let before = review_record(&mut transaction, id).await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor,
            permission_keys::MODERATION_TOPIC,
            Some(before.board_id),
        )
        .await?
        {
            return Err(EditReviewError::Forbidden);
        }
        if before.status != "pending" || before.revision != base_revision {
            return Err(EditReviewError::Conflict);
        }
        if decision == EditReviewDecisionRecord::Reject {
            let updated = sqlx::query("UPDATE content_edit_reviews SET status = 'rejected', revision = revision + 1, reviewer_id = $2, review_reason = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'pending' AND revision = $4")
                .bind(id).bind(actor).bind(reason.trim()).bind(base_revision).execute(&mut *transaction).await?;
            if updated.rows_affected() != 1 {
                return Err(EditReviewError::Conflict);
            }
            insert_audit(
                &mut transaction,
                actor,
                "topic.edit_review.reject",
                "edit_review",
                Some(id),
                json!({"reason": reason.trim()}),
            )
            .await?;
            let result = review_record(&mut transaction, id).await?;
            transaction.commit().await?;
            return Ok(result);
        }
        if before.target_type == "topic" {
            self.update_published_topic_in_transaction(
                &mut transaction,
                UpdateTopicRecord {
                    topic_id: before.topic_id,
                    author_id: before.editor_id,
                    base_revision: before.base_revision,
                    title: before.proposed_title.clone(),
                    excerpt: before.proposed_excerpt.clone(),
                    content: before
                        .content_changed
                        .then(|| before.proposed_content.clone())
                        .flatten(),
                    rich_content: before.proposed_rich_content.clone(),
                    tags: tags_from_json(before.proposed_tags.clone())?,
                },
            )
            .await
            .map_err(|error| match error {
                UpdateTopicError::TopicUnavailable => EditReviewError::NotFound,
                UpdateTopicError::Forbidden => EditReviewError::Forbidden,
                UpdateTopicError::RevisionConflict => EditReviewError::Conflict,
                UpdateTopicError::AttachmentUnavailable => EditReviewError::AttachmentUnavailable,
                UpdateTopicError::Database(error) => EditReviewError::Database(error),
            })?;
        } else {
            self.update_published_reply_in_transaction(
                &mut transaction,
                UpdateReplyRecord {
                    topic_id: before.topic_id,
                    reply_id: before.post_id,
                    author_id: before.editor_id,
                    base_revision: before.base_revision,
                    content: before
                        .proposed_content
                        .clone()
                        .ok_or(EditReviewError::InvalidInput)?,
                    rich_content: before.proposed_rich_content.clone(),
                },
            )
            .await
            .map_err(|error| match error {
                ReplyMutationError::ReplyUnavailable => EditReviewError::NotFound,
                ReplyMutationError::RevisionConflict => EditReviewError::Conflict,
                ReplyMutationError::AttachmentUnavailable => EditReviewError::AttachmentUnavailable,
                ReplyMutationError::Database(error) => EditReviewError::Database(error),
            })?;
        }

        let updated = sqlx::query("UPDATE content_edit_reviews SET status = 'approved', revision = revision + 1, reviewer_id = $2, review_reason = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'pending' AND revision = $4")
            .bind(id).bind(actor).bind(reason.trim()).bind(base_revision).execute(&mut *transaction).await?;
        if updated.rows_affected() != 1 {
            return Err(EditReviewError::Conflict);
        }
        insert_audit(
            &mut transaction,
            actor,
            "topic.edit_review.approve",
            "edit_review",
            Some(id),
            json!({"reason": reason.trim()}),
        )
        .await?;
        let result = review_record(&mut transaction, id).await?;
        transaction.commit().await?;
        Ok(result)
    }
}
