use std::{
    collections::{HashMap, HashSet},
    error::Error,
    fmt,
};

use serde_json::{Value, json};
use sqlx::{FromRow, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::board_user_restrictions::is_board_user_action_restricted_with_executor;
use crate::community_permissions::{
    CommunityActionError, authorize_community_action_with_executor,
    verify_community_action_with_executor,
};
use crate::idempotency::release_expired_key_and_prune;
use crate::notifications::insert_notification;
use crate::outbox::enqueue_core_event_in_transaction;
use crate::{Database, DatabaseError, NewOutboxEvent, OutboxError};

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
    pub image_attachment_id: Option<Uuid>,
    #[sqlx(skip)]
    pub tags: Vec<PublicTagRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicTopicDetailRecord {
    pub summary: PublicTopicRecord,
    pub content: String,
    pub rich_content: Option<Value>,
    pub content_revision: i32,
    pub reply_gate_unlocked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct ModerationBoardRecord {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub tone: String,
    pub capability_keys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct ModerationTopicRecord {
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
    pub view_count: i64,
    pub moderation_status: String,
    pub governance_revision: i64,
    pub is_featured: bool,
    pub is_pinned: bool,
    pub is_locked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct TopicModerationHistoryRecord {
    pub id: Uuid,
    pub source: String,
    pub action: String,
    pub actor_id: Uuid,
    pub actor_username: String,
    pub actor_display_name: String,
    pub actor_avatar_url: Option<String>,
    pub reason: Option<String>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModerationTopicFilters {
    pub board_id: Option<Uuid>,
    pub search: Option<String>,
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
    pub rich_content: Option<Value>,
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
    pub rich_content: Option<Value>,
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
    pub rich_content: Option<Value>,
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
    pub rich_content: Option<Value>,
    pub tags: Option<Vec<NewTagRecord>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewReplyRecord {
    pub id: Uuid,
    pub revision_id: Uuid,
    pub topic_id: Uuid,
    pub author_id: Uuid,
    pub content: String,
    pub rich_content: Option<Value>,
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateReplyRecord {
    pub topic_id: Uuid,
    pub reply_id: Uuid,
    pub author_id: Uuid,
    pub base_revision: i32,
    pub content: String,
    pub rich_content: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct PublicReplyRecord {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub floor_number: i64,
    pub reply_to_id: Option<Uuid>,
    pub reply_to_floor_number: Option<i64>,
    pub reply_to_author_id: Option<Uuid>,
    pub reply_to_author_username: Option<String>,
    pub reply_to_author_display_name: Option<String>,
    pub reply_to_author_avatar_url: Option<String>,
    pub reply_to_excerpt: Option<String>,
    pub reply_to_rich_content: Option<Value>,
    pub reply_to_is_deleted: Option<bool>,
    pub author_id: Uuid,
    pub author_username: String,
    pub author_display_name: String,
    pub author_avatar_url: Option<String>,
    pub content: String,
    pub rich_content: Option<Value>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub revision_count: i32,
    pub like_count: i64,
    #[sqlx(default)]
    pub reply_gate_unlocked: bool,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TopicGovernanceAction {
    Pin,
    Unpin,
    Feature,
    Unfeature,
    Lock,
    Unlock,
    Move,
}

impl TopicGovernanceAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pin => "pin",
            Self::Unpin => "unpin",
            Self::Feature => "feature",
            Self::Unfeature => "unfeature",
            Self::Lock => "lock",
            Self::Unlock => "unlock",
            Self::Move => "move",
        }
    }

    fn permission_key(self) -> &'static str {
        match self {
            Self::Pin | Self::Unpin => permission_keys::MODERATION_TOPIC_PIN,
            Self::Feature | Self::Unfeature => permission_keys::MODERATION_TOPIC_FEATURE,
            Self::Lock | Self::Unlock => permission_keys::MODERATION_TOPIC_LOCK,
            Self::Move => permission_keys::MODERATION_TOPIC_MOVE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicGovernanceInput {
    pub topic_id: Uuid,
    pub actor_id: Uuid,
    pub action: TopicGovernanceAction,
    pub expected_revision: i64,
    pub target_board_id: Option<Uuid>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicGovernanceResultRecord {
    pub topic_id: Uuid,
    pub board_id: Uuid,
    pub is_pinned: bool,
    pub is_featured: bool,
    pub is_locked: bool,
    pub governance_revision: i64,
}

#[derive(Debug)]
pub enum CreateTopicError {
    BoardUnavailable,
    BoardRestricted,
    AuthorRestricted,
    PermissionDenied,
    QuotaExceeded,
    IdempotencyConflict,
    AttachmentUnavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListPublicTopicsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListModerationTopicsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListTopicModerationHistoryError {
    TopicUnavailable,
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
    TopicLocked,
    BoardRestricted,
    AuthorRestricted,
    PermissionDenied,
    QuotaExceeded,
    IdempotencyConflict,
    InvalidReplyTarget,
    AttachmentUnavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum UpdateTopicError {
    TopicUnavailable,
    Forbidden,
    RevisionConflict,
    AttachmentUnavailable,
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
    AttachmentUnavailable,
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

#[derive(Debug)]
pub enum TopicGovernanceError {
    Unavailable,
    Forbidden,
    InvalidInput,
    RevisionConflict,
    Database(DatabaseError),
    Outbox(OutboxError),
}

impl Database {
    pub async fn list_moderation_boards(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ModerationBoardRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, ModerationBoardRecord>(
            "WITH granted AS (
                 SELECT DISTINCT board.id, permission.permission_key
                 FROM boards AS board
                 INNER JOIN role_assignments AS assignment ON assignment.user_id = $1
                 INNER JOIN roles AS role ON role.id = assignment.role_id
                 INNER JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
                 INNER JOIN permissions AS permission ON permission.id = role_permission.permission_id
                 INNER JOIN users AS account ON account.id = assignment.user_id
                 WHERE account.status IN ('active', 'restricted')
                   AND permission.permission_key LIKE 'moderation.%'
                   AND (
                       (role.scope IN ('instance', 'site') AND assignment.scope_id IS NULL)
                       OR (
                           role.scope = 'board'
                           AND assignment.scope_id IS NOT NULL
                           AND daoyun_board_scope_covers(assignment.scope_id, assignment.scope_mode, board.id)
                       )
                   )
                   AND board.deleted_at IS NULL
             )
             SELECT board.id, board.slug, board.name, board.tone,
                    ARRAY(
                        SELECT granted.permission_key
                        FROM granted
                        WHERE granted.id = board.id
                        ORDER BY granted.permission_key
                    ) AS capability_keys
             FROM boards AS board
             WHERE board.deleted_at IS NULL
               AND EXISTS (
                   SELECT 1 FROM granted
                   WHERE granted.id = board.id AND granted.permission_key = 'moderation.topic'
               )
             ORDER BY board.position, board.id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_moderation_topics(
        &self,
        user_id: Uuid,
        filters: &ModerationTopicFilters,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<ModerationTopicRecord>, ListModerationTopicsError> {
        if let Some(cursor) = cursor {
            let cursor_is_valid = sqlx::query_scalar::<_, bool>(
                r#"WITH granted AS (
                     SELECT DISTINCT board.id, permission.permission_key
                     FROM boards AS board
                     INNER JOIN role_assignments AS assignment ON assignment.user_id = $1
                     INNER JOIN roles AS role ON role.id = assignment.role_id
                     INNER JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
                     INNER JOIN permissions AS permission ON permission.id = role_permission.permission_id
                     INNER JOIN users AS account ON account.id = assignment.user_id
                     WHERE account.status IN ('active', 'restricted')
                       AND permission.permission_key LIKE 'moderation.%'
                       AND (
                           (role.scope IN ('instance', 'site') AND assignment.scope_id IS NULL)
                           OR (
                               role.scope = 'board'
                               AND assignment.scope_id IS NOT NULL
                               AND daoyun_board_scope_covers(assignment.scope_id, assignment.scope_mode, board.id)
                           )
                       )
                       AND board.deleted_at IS NULL
                 ), allowed_boards AS (
                     SELECT id FROM granted
                     WHERE permission_key = 'moderation.topic'
                 )
                 SELECT EXISTS (
                     SELECT 1
                     FROM topics AS topic
                     INNER JOIN boards AS board ON board.id = topic.board_id
                     INNER JOIN allowed_boards ON allowed_boards.id = board.id
                     INNER JOIN users AS author ON author.id = topic.author_id
                     WHERE topic.id = $2
                       AND topic.status = 'published'
                       AND topic.deleted_at IS NULL
                       AND board.deleted_at IS NULL
                       AND author.status IN ('active', 'restricted')
                       AND ($3::uuid IS NULL OR topic.board_id = $3)
                       AND ($4::text IS NULL OR topic.search_vector @@ websearch_to_tsquery('simple', $4))
                 )"#,
            )
            .bind(user_id)
            .bind(cursor)
            .bind(filters.board_id)
            .bind(filters.search.as_deref())
            .fetch_one(&self.pool)
            .await?;
            if !cursor_is_valid {
                return Err(ListModerationTopicsError::InvalidCursor);
            }
        }

        Ok(sqlx::query_as::<_, ModerationTopicRecord>(
            "WITH granted AS (
                 SELECT DISTINCT board.id, permission.permission_key
                 FROM boards AS board
                 INNER JOIN role_assignments AS assignment ON assignment.user_id = $1
                 INNER JOIN roles AS role ON role.id = assignment.role_id
                 INNER JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
                 INNER JOIN permissions AS permission ON permission.id = role_permission.permission_id
                 INNER JOIN users AS account ON account.id = assignment.user_id
                 WHERE account.status IN ('active', 'restricted')
                   AND permission.permission_key LIKE 'moderation.%'
                   AND (
                       (role.scope IN ('instance', 'site') AND assignment.scope_id IS NULL)
                       OR (
                           role.scope = 'board'
                           AND assignment.scope_id IS NOT NULL
                           AND daoyun_board_scope_covers(assignment.scope_id, assignment.scope_mode, board.id)
                       )
                   )
                   AND board.deleted_at IS NULL
             ), allowed_boards AS (
                 SELECT id FROM granted
                 WHERE permission_key = 'moderation.topic'
             )
             SELECT t.id, t.title, t.excerpt,
                    author.id AS author_id, author.username AS author_username,
                    author.display_name AS author_display_name,
                    author.avatar_url AS author_avatar_url,
                    board.id AS board_id, board.slug AS board_slug,
                    board.name AS board_name, board.tone AS board_tone,
                    t.published_at, t.last_activity_at,
                    t.reply_count, t.like_count, t.view_count,
                    t.moderation_status, t.governance_revision,
                    t.featured_at IS NOT NULL AS is_featured,
                    t.pinned_at IS NOT NULL AS is_pinned,
                    t.locked_at IS NOT NULL AS is_locked
             FROM topics AS t
             INNER JOIN boards AS board ON board.id = t.board_id
             INNER JOIN allowed_boards ON allowed_boards.id = board.id
             INNER JOIN users AS author ON author.id = t.author_id
             WHERE t.status = 'published'
               AND t.deleted_at IS NULL
               AND board.deleted_at IS NULL
               AND author.status IN ('active', 'restricted')
               AND ($2::uuid IS NULL OR t.board_id = $2)
               AND ($3::text IS NULL OR t.search_vector @@ websearch_to_tsquery('simple', $3))
               AND ($4::uuid IS NULL OR (t.published_at, t.id) < (
                   SELECT cursor_topic.published_at, cursor_topic.id
                   FROM topics AS cursor_topic WHERE cursor_topic.id = $4
               ))
             ORDER BY t.published_at DESC, t.id DESC
             LIMIT $5",
        )
        .bind(user_id)
        .bind(filters.board_id)
        .bind(filters.search.as_deref())
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_topic_moderation_history(
        &self,
        topic_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<TopicModerationHistoryRecord>, ListTopicModerationHistoryError> {
        let topic_exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM topics WHERE id = $1)")
                .bind(topic_id)
                .fetch_one(&self.pool)
                .await?;
        if !topic_exists {
            return Err(ListTopicModerationHistoryError::TopicUnavailable);
        }

        if let Some(cursor) = cursor {
            let cursor_is_valid = sqlx::query_scalar::<_, bool>(
                r#"WITH history AS (
                     SELECT moderation.id
                     FROM topic_moderation_actions AS moderation
                     WHERE moderation.topic_id = $1
                     UNION ALL
                     SELECT audit.id
                     FROM admin_audit_log AS audit
                     WHERE audit.action = 'topic.governance'
                       AND audit.resource_type = 'topic'
                       AND audit.resource_id = $1
                 )
                 SELECT EXISTS (SELECT 1 FROM history WHERE id = $2)"#,
            )
            .bind(topic_id)
            .bind(cursor)
            .fetch_one(&self.pool)
            .await?;
            if !cursor_is_valid {
                return Err(ListTopicModerationHistoryError::InvalidCursor);
            }
        }

        Ok(sqlx::query_as::<_, TopicModerationHistoryRecord>(
            r#"WITH history AS (
                 SELECT moderation.id,
                        'moderation'::text AS source,
                        moderation.action,
                        actor.id AS actor_id,
                        actor.username AS actor_username,
                        actor.display_name AS actor_display_name,
                        actor.avatar_url AS actor_avatar_url,
                        moderation.reason,
                        moderation.created_at
                 FROM topic_moderation_actions AS moderation
                 INNER JOIN users AS actor ON actor.id = moderation.moderator_id
                 WHERE moderation.topic_id = $1

                 UNION ALL

                 SELECT audit.id,
                        'governance'::text AS source,
                        audit.summary ->> 'action' AS action,
                        actor.id AS actor_id,
                        actor.username AS actor_username,
                        actor.display_name AS actor_display_name,
                        actor.avatar_url AS actor_avatar_url,
                        NULLIF(audit.summary ->> 'reason', '') AS reason,
                        audit.created_at
                 FROM admin_audit_log AS audit
                 INNER JOIN users AS actor ON actor.id = audit.actor_id
                 WHERE audit.action = 'topic.governance'
                   AND audit.resource_type = 'topic'
                   AND audit.resource_id = $1
             )
             SELECT id, source, action, actor_id, actor_username, actor_display_name,
                    actor_avatar_url, reason, created_at
             FROM history
             WHERE $2::uuid IS NULL OR (created_at, id) < (
                 SELECT created_at, id FROM history WHERE id = $2
             )
             ORDER BY created_at DESC, id DESC
             LIMIT $3"#,
        )
        .bind(topic_id)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn govern_topic(
        &self,
        input: TopicGovernanceInput,
    ) -> Result<TopicGovernanceResultRecord, TopicGovernanceError> {
        if input.expected_revision < 1
            || input.reason.as_deref().is_some_and(|reason| {
                !(1..=1000).contains(&reason.chars().count())
                    || reason.chars().any(char::is_control)
            })
            || (input.action == TopicGovernanceAction::Move) != input.target_board_id.is_some()
        {
            return Err(TopicGovernanceError::InvalidInput);
        }

        let mut transaction = self.pool.begin().await?;
        let topic = sqlx::query_as::<_, TopicGovernanceRow>(
            "SELECT author_id, board_id, status, deleted_at, governance_revision
             FROM topics WHERE id = $1 FOR UPDATE",
        )
        .bind(input.topic_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(TopicGovernanceError::Unavailable)?;
        if topic.status != "published" || topic.deleted_at.is_some() {
            return Err(TopicGovernanceError::Unavailable);
        }
        if topic.governance_revision != input.expected_revision {
            return Err(TopicGovernanceError::RevisionConflict);
        }
        if !has_permission_with_executor(
            &mut transaction,
            input.actor_id,
            input.action.permission_key(),
            Some(topic.board_id),
        )
        .await?
        {
            return Err(TopicGovernanceError::Forbidden);
        }

        let target_board_id = input.target_board_id.unwrap_or(topic.board_id);
        if input.action == TopicGovernanceAction::Move {
            if target_board_id == topic.board_id {
                return Err(TopicGovernanceError::InvalidInput);
            }
            if !has_permission_with_executor(
                &mut transaction,
                input.actor_id,
                permission_keys::MODERATION_TOPIC_MOVE,
                Some(target_board_id),
            )
            .await?
            {
                return Err(TopicGovernanceError::Forbidden);
            }
            let locked_boards = sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM boards
                 WHERE id = ANY($1) AND visibility = 'public' AND deleted_at IS NULL
                 ORDER BY id FOR UPDATE",
            )
            .bind(vec![topic.board_id, target_board_id])
            .fetch_all(&mut *transaction)
            .await?;
            if locked_boards.len() != 2 {
                return Err(TopicGovernanceError::Unavailable);
            }
        }

        match input.action {
            TopicGovernanceAction::Pin => {
                sqlx::query("UPDATE topics SET pinned_at = COALESCE(pinned_at, CURRENT_TIMESTAMP) WHERE id = $1")
                    .bind(input.topic_id)
                    .execute(&mut *transaction)
                    .await?;
            }
            TopicGovernanceAction::Unpin => {
                sqlx::query("UPDATE topics SET pinned_at = NULL WHERE id = $1")
                    .bind(input.topic_id)
                    .execute(&mut *transaction)
                    .await?;
            }
            TopicGovernanceAction::Feature => {
                sqlx::query("UPDATE topics SET featured_at = COALESCE(featured_at, CURRENT_TIMESTAMP) WHERE id = $1")
                    .bind(input.topic_id)
                    .execute(&mut *transaction)
                    .await?;
            }
            TopicGovernanceAction::Unfeature => {
                sqlx::query("UPDATE topics SET featured_at = NULL WHERE id = $1")
                    .bind(input.topic_id)
                    .execute(&mut *transaction)
                    .await?;
            }
            TopicGovernanceAction::Lock => {
                sqlx::query(
                    "UPDATE topics SET locked_at = COALESCE(locked_at, CURRENT_TIMESTAMP),
                     locked_by = COALESCE(locked_by, $2) WHERE id = $1",
                )
                .bind(input.topic_id)
                .bind(input.actor_id)
                .execute(&mut *transaction)
                .await?;
            }
            TopicGovernanceAction::Unlock => {
                sqlx::query("UPDATE topics SET locked_at = NULL, locked_by = NULL WHERE id = $1")
                    .bind(input.topic_id)
                    .execute(&mut *transaction)
                    .await?;
            }
            TopicGovernanceAction::Move => {
                sqlx::query("UPDATE topics SET board_id = $2 WHERE id = $1")
                    .bind(input.topic_id)
                    .bind(target_board_id)
                    .execute(&mut *transaction)
                    .await?;
                sqlx::query(
                    "UPDATE boards SET topic_count = GREATEST(topic_count - 1, 0),
                     updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                )
                .bind(topic.board_id)
                .execute(&mut *transaction)
                .await?;
                sqlx::query(
                    "UPDATE boards SET topic_count = topic_count + 1,
                     updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                )
                .bind(target_board_id)
                .execute(&mut *transaction)
                .await?;
            }
        }

        let result = sqlx::query_as::<_, TopicGovernanceResultRow>(
            "UPDATE topics SET governance_revision = governance_revision + 1,
                    updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id AS topic_id, board_id, pinned_at IS NOT NULL AS is_pinned,
                       featured_at IS NOT NULL AS is_featured,
                       locked_at IS NOT NULL AS is_locked, governance_revision",
        )
        .bind(input.topic_id)
        .fetch_one(&mut *transaction)
        .await?;
        let summary = json!({
            "action": input.action.as_str(),
            "from_board_id": topic.board_id,
            "to_board_id": result.board_id,
            "revision": result.governance_revision,
            "reason": input.reason,
        });
        insert_audit(
            &mut transaction,
            input.actor_id,
            "topic.governance",
            "topic",
            Some(input.topic_id),
            summary,
        )
        .await?;
        if topic.author_id != input.actor_id {
            insert_notification(
                &mut transaction,
                Uuid::now_v7(),
                topic.author_id,
                Some(input.actor_id),
                "topic_governance",
                "topic",
                input.topic_id,
                &format!(
                    "topic:{}:governance:{}",
                    input.topic_id, result.governance_revision
                ),
            )
            .await?;
        }
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "topic.governance.changed".to_owned(),
                aggregate_type: "topic".to_owned(),
                aggregate_id: input.topic_id,
                dedupe_key: format!("{}:{}", input.topic_id, result.governance_revision),
                payload: json!({
                    "topic_id": result.topic_id,
                    "action": input.action.as_str(),
                    "board_id": result.board_id,
                    "is_pinned": result.is_pinned,
                    "is_featured": result.is_featured,
                    "is_locked": result.is_locked,
                    "governance_revision": result.governance_revision,
                }),
                max_attempts: 10,
            },
        )
        .await?;
        transaction.commit().await?;
        Ok(result.into())
    }

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
                featured_at = CASE WHEN $2 = 'approved' THEN featured_at ELSE NULL END,
                pinned_at = CASE WHEN $2 = 'approved' THEN pinned_at ELSE NULL END,
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
        let active_author =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE id = $1 FOR UPDATE")
                .bind(input.author_id)
                .fetch_optional(&mut *transaction)
                .await?;
        if active_author.is_none() {
            return Err(CreateTopicError::AuthorRestricted);
        }
        if idempotency.is_some() {
            verify_community_action_with_executor(
                &mut transaction,
                input.author_id,
                "topic.create",
                OffsetDateTime::now_utc(),
            )
            .await
            .map_err(map_topic_community_action_error)?;
        }
        if let Some(idempotency) = idempotency.as_ref() {
            release_expired_key_and_prune(
                &mut transaction,
                input.author_id,
                "POST /api/v1/topics",
                &idempotency.key,
            )
            .await?;
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

        authorize_community_action_with_executor(
            &mut transaction,
            input.author_id,
            "topic.create",
            Some(("topic.create.daily", 1)),
            None,
            OffsetDateTime::now_utc(),
        )
        .await
        .map_err(map_topic_community_action_error)?;

        let board_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM boards \
             WHERE visibility = 'public' AND deleted_at IS NULL \
               AND ($1::uuid IS NULL OR id = $1) \
               AND daoyun_can_access_content('board', id, $2, CURRENT_TIMESTAMP) \
             ORDER BY position, id \
             LIMIT 1 \
             FOR SHARE",
        )
        .bind(input.board_id)
        .bind(input.author_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(CreateTopicError::BoardUnavailable)?;
        if is_board_user_action_restricted_with_executor(
            &mut transaction,
            input.author_id,
            board_id,
            "topic.create",
            OffsetDateTime::now_utc(),
        )
        .await?
        {
            return Err(CreateTopicError::BoardRestricted);
        }

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

        if !bind_rich_content_attachments(
            &mut transaction,
            input.id,
            input.author_id,
            input.rich_content.as_ref(),
        )
        .await?
        {
            return Err(CreateTopicError::AttachmentUnavailable);
        }

        let inserted_post = sqlx::query(
            "INSERT INTO posts (id, topic_id, author_id, kind, content, rich_content, status) \
             VALUES ($1, $1, $2, 'topic', $3, $4, 'published')",
        )
        .bind(input.id)
        .bind(input.author_id)
        .bind(&input.content)
        .bind(&input.rich_content)
        .execute(&mut *transaction)
        .await?;
        debug_assert_eq!(inserted_post.rows_affected(), 1);

        let inserted_revision = sqlx::query(
            "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content, rich_content) \
             VALUES ($1, $2, $3, 1, $4, $5)",
        )
        .bind(Uuid::now_v7())
        .bind(input.id)
        .bind(input.author_id)
        .bind(&input.content)
        .bind(&input.rich_content)
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
        enqueue_core_event_in_transaction(
            &mut transaction,
            Uuid::now_v7(),
            "topic.published",
            "topic",
            input.id,
            json!({
                "topic_id": input.id,
                "board_id": board_id,
                "author_id": input.author_id,
            }),
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
            "SELECT t.author_id, t.status, t.deleted_at, p.revision_count, p.content, p.rich_content \
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

        let content_changed = input.content.is_some();
        let next_content = input.content.as_deref().unwrap_or(current.content.as_str());
        let next_rich_content = if content_changed {
            input.rich_content.as_ref()
        } else {
            current.rich_content.as_ref()
        };
        if !bind_rich_content_attachments(
            &mut transaction,
            input.topic_id,
            input.author_id,
            next_rich_content,
        )
        .await?
        {
            return Err(UpdateTopicError::AttachmentUnavailable);
        }
        sqlx::query(
            "UPDATE posts SET content = $2, rich_content = $3, revision_count = $4, updated_at = CURRENT_TIMESTAMP \
             WHERE topic_id = $1 AND kind = 'topic' AND deleted_at IS NULL",
        )
        .bind(input.topic_id)
        .bind(next_content)
        .bind(next_rich_content)
        .bind(next_revision)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content, rich_content) \
             SELECT $1, p.id, $2, $3, $4, $5 FROM posts AS p \
             WHERE p.topic_id = $6 AND p.kind = 'topic' AND p.deleted_at IS NULL",
        )
        .bind(Uuid::now_v7())
        .bind(input.author_id)
        .bind(next_revision)
        .bind(next_content)
        .bind(next_rich_content)
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
                    r.content, r.rich_content, r.created_at \
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

        if !bind_rich_content_attachments(
            &mut transaction,
            input.topic_id,
            input.author_id,
            input.rich_content.as_ref(),
        )
        .await?
        {
            return Err(ReplyMutationError::AttachmentUnavailable);
        }

        let next_revision = current.revision_count + 1;
        let updated = sqlx::query(
            "UPDATE posts SET content = $2, rich_content = $3, revision_count = $4, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(input.reply_id)
        .bind(&input.content)
        .bind(&input.rich_content)
        .bind(next_revision)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(ReplyMutationError::ReplyUnavailable);
        }
        sqlx::query(
            "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content, rich_content) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(Uuid::now_v7())
        .bind(input.reply_id)
        .bind(input.author_id)
        .bind(next_revision)
        .bind(&input.content)
        .bind(&input.rich_content)
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
                    r.content, r.rich_content, r.created_at \
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
        let active_author =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE id = $1 FOR UPDATE")
                .bind(input.author_id)
                .fetch_optional(&mut *transaction)
                .await?;
        if active_author.is_none() {
            return Err(CreateReplyError::AuthorRestricted);
        }
        if idempotency.is_some() {
            verify_community_action_with_executor(
                &mut transaction,
                input.author_id,
                "reply.create",
                OffsetDateTime::now_utc(),
            )
            .await
            .map_err(map_reply_community_action_error)?;
        }
        if let Some(idempotency) = idempotency.as_ref() {
            release_expired_key_and_prune(
                &mut transaction,
                input.author_id,
                "POST /api/v1/topics/{topic_id}/replies",
                &idempotency.key,
            )
            .await?;
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

        authorize_community_action_with_executor(
            &mut transaction,
            input.author_id,
            "reply.create",
            Some(("reply.create.daily", 1)),
            None,
            OffsetDateTime::now_utc(),
        )
        .await
        .map_err(map_reply_community_action_error)?;

        let visible_topic = sqlx::query_as::<_, (Uuid, Uuid, Option<OffsetDateTime>)>(
            "SELECT t.id, t.board_id, t.locked_at \
             FROM topics AS t \
             INNER JOIN boards AS b ON b.id = t.board_id \
             INNER JOIN users AS u ON u.id = t.author_id \
             WHERE t.id = $1 \
               AND t.status = 'published' AND t.deleted_at IS NULL \
               AND b.visibility = 'public' AND b.deleted_at IS NULL \
               AND u.status = 'active' \
               AND daoyun_can_access_content('topic', t.id, $2, CURRENT_TIMESTAMP) \
             FOR UPDATE OF t FOR SHARE OF b, u",
        )
        .bind(input.topic_id)
        .bind(input.author_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if visible_topic.is_none() {
            return Err(CreateReplyError::TopicUnavailable);
        }
        if visible_topic
            .as_ref()
            .is_some_and(|(_, _, locked_at)| locked_at.is_some())
        {
            return Err(CreateReplyError::TopicLocked);
        }
        let board_id = visible_topic
            .as_ref()
            .map(|(_, board_id, _)| *board_id)
            .ok_or(CreateReplyError::TopicUnavailable)?;
        if is_board_user_action_restricted_with_executor(
            &mut transaction,
            input.author_id,
            board_id,
            "reply.create",
            OffsetDateTime::now_utc(),
        )
        .await?
        {
            return Err(CreateReplyError::BoardRestricted);
        }
        let topic_author_id =
            sqlx::query_scalar::<_, Uuid>("SELECT author_id FROM topics WHERE id = $1")
                .bind(input.topic_id)
                .fetch_one(&mut *transaction)
                .await?;

        if let Some(reply_to_id) = input.reply_to_id {
            let reply_target_is_valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(\
                     SELECT 1 FROM posts \
                     WHERE id = $1 AND topic_id = $2 AND kind = 'reply' \
                       AND status = 'published' AND deleted_at IS NULL\
                 )",
            )
            .bind(reply_to_id)
            .bind(input.topic_id)
            .fetch_one(&mut *transaction)
            .await?;
            if !reply_target_is_valid {
                return Err(CreateReplyError::InvalidReplyTarget);
            }
        }

        let floor_number = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(MAX(floor_number), 0) + 1 \
             FROM posts WHERE topic_id = $1 AND kind = 'reply'",
        )
        .bind(input.topic_id)
        .fetch_one(&mut *transaction)
        .await?;

        if !bind_rich_content_attachments(
            &mut transaction,
            input.topic_id,
            input.author_id,
            input.rich_content.as_ref(),
        )
        .await?
        {
            return Err(CreateReplyError::AttachmentUnavailable);
        }

        sqlx::query(
            "INSERT INTO posts (\
                 id, topic_id, author_id, kind, content, rich_content, status, floor_number, reply_to_id\
             ) VALUES ($1, $2, $3, 'reply', $4, $5, 'published', $6, $7)",
        )
        .bind(input.id)
        .bind(input.topic_id)
        .bind(input.author_id)
        .bind(&input.content)
        .bind(&input.rich_content)
        .bind(floor_number)
        .bind(input.reply_to_id)
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content, rich_content) \
             VALUES ($1, $2, $3, 1, $4, $5)",
        )
        .bind(input.revision_id)
        .bind(input.id)
        .bind(input.author_id)
        .bind(&input.content)
        .bind(&input.rich_content)
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
        enqueue_core_event_in_transaction(
            &mut transaction,
            Uuid::now_v7(),
            "reply.created",
            "reply",
            input.id,
            json!({
                "reply_id": input.id,
                "topic_id": input.topic_id,
                "board_id": board_id,
                "author_id": input.author_id,
            }),
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
                   AND u.status = 'active' \
                   AND daoyun_can_access_content('topic', t.id, $2, CURRENT_TIMESTAMP)\
             )",
        )
        .bind(topic_id)
        .bind(viewer_user_id)
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
                       AND p.deleted_at IS NULL AND u.status = 'active' \
                       AND daoyun_can_access_content('post', p.id, $3, CURRENT_TIMESTAMP)\
                 )",
            )
            .bind(cursor)
            .bind(topic_id)
            .bind(viewer_user_id)
            .fetch_one(&self.pool)
            .await?;
            if !cursor_is_valid {
                return Err(ListPublicRepliesError::InvalidCursor);
            }
        }

        let mut replies = sqlx::query_as::<_, PublicReplyRecord>(
            "SELECT p.id, p.topic_id, p.floor_number, p.reply_to_id, \
                    target.floor_number AS reply_to_floor_number, \
                    target.author_id AS reply_to_author_id, \
                    target_author.username AS reply_to_author_username, \
                    target_author.display_name AS reply_to_author_display_name, \
                    target_author.avatar_url AS reply_to_author_avatar_url, \
                    CASE WHEN target.deleted_at IS NULL AND target.status = 'published' \
                              AND target_author.status = 'active' \
                              AND daoyun_can_access_content('post', target.id, $4, CURRENT_TIMESTAMP) \
                         THEN LEFT(target.content, 160) ELSE NULL END AS reply_to_excerpt, \
                    CASE WHEN target.deleted_at IS NULL AND target.status = 'published' \
                              AND target_author.status = 'active' \
                              AND daoyun_can_access_content('post', target.id, $4, CURRENT_TIMESTAMP) \
                         THEN target.rich_content ELSE NULL END AS reply_to_rich_content, \
                    CASE WHEN target.id IS NULL THEN NULL \
                         ELSE target.deleted_at IS NOT NULL OR target.status <> 'published' \
                              OR target_author.status <> 'active' \
                    END AS reply_to_is_deleted, \
                    p.author_id, \
                    u.username AS author_username, u.display_name AS author_display_name, \
                    u.avatar_url AS author_avatar_url, \
                    p.content, p.rich_content, p.created_at, p.updated_at, p.revision_count, p.like_count \
             FROM posts AS p \
             INNER JOIN users AS u ON u.id = p.author_id \
             LEFT JOIN posts AS target ON target.id = p.reply_to_id AND target.kind = 'reply' \
             LEFT JOIN users AS target_author ON target_author.id = target.author_id \
             WHERE p.topic_id = $1 \
               AND p.kind = 'reply' AND p.status = 'published' \
               AND p.deleted_at IS NULL AND u.status = 'active' \
               AND daoyun_can_access_content('post', p.id, $4, CURRENT_TIMESTAMP) \
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
        .bind(viewer_user_id)
        .fetch_all(&self.pool)
        .await?;
        let gate_unlocked = reply_gate_is_unlocked(&self.pool, topic_id, viewer_user_id).await?;
        for reply in &mut replies {
            reply.reply_gate_unlocked = gate_unlocked;
        }
        if let Some(viewer_user_id) = viewer_user_id {
            hydrate_reply_viewer_states(&self.pool, &mut replies, viewer_user_id).await?;
        }
        Ok(Some(replies))
    }

    pub async fn public_reply(
        &self,
        reply_id: Uuid,
    ) -> Result<Option<PublicReplyRecord>, DatabaseError> {
        self.public_reply_for_viewer(reply_id, None).await
    }

    pub async fn public_reply_for_viewer(
        &self,
        reply_id: Uuid,
        viewer_user_id: Option<Uuid>,
    ) -> Result<Option<PublicReplyRecord>, DatabaseError> {
        let mut reply = sqlx::query_as::<_, PublicReplyRecord>(
            "SELECT p.id, p.topic_id, p.floor_number, p.reply_to_id, \
                    target.floor_number AS reply_to_floor_number, \
                    target.author_id AS reply_to_author_id, \
                    target_author.username AS reply_to_author_username, \
                    target_author.display_name AS reply_to_author_display_name, \
                    target_author.avatar_url AS reply_to_author_avatar_url, \
                    CASE WHEN target.deleted_at IS NULL AND target.status = 'published' \
                              AND target_author.status = 'active' \
                              AND daoyun_can_access_content('post', target.id, $2, CURRENT_TIMESTAMP) \
                         THEN LEFT(target.content, 160) ELSE NULL END AS reply_to_excerpt, \
                    CASE WHEN target.deleted_at IS NULL AND target.status = 'published' \
                              AND target_author.status = 'active' \
                              AND daoyun_can_access_content('post', target.id, $2, CURRENT_TIMESTAMP) \
                         THEN target.rich_content ELSE NULL END AS reply_to_rich_content, \
                    CASE WHEN target.id IS NULL THEN NULL \
                         ELSE target.deleted_at IS NOT NULL OR target.status <> 'published' \
                              OR target_author.status <> 'active' \
                    END AS reply_to_is_deleted, \
                    p.author_id, \
                    u.username AS author_username, u.display_name AS author_display_name, \
                    u.avatar_url AS author_avatar_url, \
                    p.content, p.rich_content, p.created_at, p.updated_at, p.revision_count, p.like_count \
             FROM posts AS p \
             INNER JOIN users AS u ON u.id = p.author_id \
             LEFT JOIN posts AS target ON target.id = p.reply_to_id AND target.kind = 'reply' \
             LEFT JOIN users AS target_author ON target_author.id = target.author_id \
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
        .bind(viewer_user_id)
        .fetch_optional(&self.pool)
        .await?;
        if let Some(reply) = reply.as_mut() {
            reply.reply_gate_unlocked =
                reply_gate_is_unlocked(&self.pool, reply.topic_id, viewer_user_id).await?;
        }
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
                       AND daoyun_can_access_content('topic', t.id, $8, CURRENT_TIMESTAMP)
                 )"#,
            )
            .bind(cursor)
            .bind(filters.board_slug.as_deref())
            .bind(filters.search.as_deref())
            .bind(filters.tag_slug.as_deref())
            .bind(filters.featured_only)
            .bind(filters.author_username.as_deref())
            .bind(filters.following_user_id)
            .bind(filters.viewer_user_id)
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
                       AND daoyun_can_access_content('topic', t.id, $9, CURRENT_TIMESTAMP)
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
                .bind(filters.viewer_user_id)
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
                       AND daoyun_can_access_content('topic', t.id, $9, CURRENT_TIMESTAMP)
                       AND (
                           $7::uuid IS NULL
                           OR ((CASE WHEN $1::text IS NOT NULL THEN (t.pinned_at IS NOT NULL) ELSE FALSE END), t.hot_score, t.published_at, t.id) < (
                               SELECT (CASE WHEN $1::text IS NOT NULL THEN (c.pinned_at IS NOT NULL) ELSE FALSE END), c.hot_score, c.published_at, c.id
                               FROM topics AS c WHERE c.id = $7
                           )
                       )
                     ORDER BY (CASE WHEN $1::text IS NOT NULL THEN (t.pinned_at IS NOT NULL) ELSE FALSE END) DESC,
                              t.hot_score DESC, t.published_at DESC, t.id DESC
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
                .bind(filters.viewer_user_id)
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
                       AND daoyun_can_access_content('topic', t.id, $9, CURRENT_TIMESTAMP)
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
                .bind(filters.viewer_user_id)
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
        hydrate_topic_cover_images(&self.pool, &mut records, filters.viewer_user_id).await?;
        if let Some(viewer_user_id) = filters.viewer_user_id {
            hydrate_topic_viewer_states(&self.pool, &mut records, viewer_user_id).await?;
        }
        Ok(records)
    }

    pub async fn public_topic(
        &self,
        topic_id: Uuid,
    ) -> Result<Option<PublicTopicDetailRecord>, DatabaseError> {
        self.public_topic_for_viewer(topic_id, None).await
    }

    pub async fn public_topic_for_viewer(
        &self,
        topic_id: Uuid,
        viewer_user_id: Option<Uuid>,
    ) -> Result<Option<PublicTopicDetailRecord>, DatabaseError> {
        let row = sqlx::query_as::<_, PublicTopicDetailRow>(
            r#"SELECT t.id, t.title, t.excerpt, t.content, p.rich_content, p.revision_count AS content_revision,
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
               AND u.status = 'active'
               AND daoyun_can_access_content('topic', t.id, $2, CURRENT_TIMESTAMP)"#,
        )
        .bind(topic_id)
        .bind(viewer_user_id)
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
        let cover_candidates = detail
            .rich_content
            .as_ref()
            .and_then(first_public_rich_content_image_id)
            .map(|attachment_id| HashMap::from([(topic_id, attachment_id)]))
            .unwrap_or_default();
        hydrate_topic_cover_candidates(
            &self.pool,
            std::slice::from_mut(&mut detail.summary),
            cover_candidates,
            viewer_user_id,
        )
        .await?;
        detail.reply_gate_unlocked =
            reply_gate_is_unlocked(&self.pool, topic_id, viewer_user_id).await?;
        detail.summary.tags = tags;
        if let Some(viewer_user_id) = viewer_user_id {
            hydrate_topic_viewer_states(
                &self.pool,
                std::slice::from_mut(&mut detail.summary),
                viewer_user_id,
            )
            .await?;
        }
        Ok(Some(detail))
    }
}

async fn reply_gate_is_unlocked(
    pool: &sqlx::PgPool,
    topic_id: Uuid,
    viewer_user_id: Option<Uuid>,
) -> Result<bool, sqlx::Error> {
    let Some(viewer_user_id) = viewer_user_id else {
        return Ok(false);
    };
    sqlx::query_scalar(
        "SELECT EXISTS(\
             SELECT 1 FROM topics WHERE id = $1 AND author_id = $2\
         ) OR EXISTS(\
             SELECT 1 FROM posts \
             WHERE topic_id = $1 AND author_id = $2 AND kind = 'reply' \
               AND status = 'published' AND deleted_at IS NULL\
         ) OR EXISTS(\
             SELECT 1 FROM role_assignments AS assignment \
             INNER JOIN roles AS role ON role.id = assignment.role_id \
             WHERE assignment.user_id = $2 AND assignment.scope_id IS NULL \
               AND role.key = 'super_admin'\
         )",
    )
    .bind(topic_id)
    .bind(viewer_user_id)
    .fetch_one(pool)
    .await
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

pub(crate) async fn hydrate_topic_cover_images(
    pool: &sqlx::PgPool,
    topics: &mut [PublicTopicRecord],
    viewer_user_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let topic_ids = topics.iter().map(|topic| topic.id).collect::<Vec<_>>();
    if topic_ids.is_empty() {
        return Ok(());
    }
    let documents = sqlx::query_as::<_, TopicRichContentRow>(
        "SELECT post.topic_id, post.rich_content \
         FROM posts AS post \
         WHERE post.topic_id = ANY($1::uuid[]) \
           AND post.kind = 'topic' AND post.status = 'published' \
           AND post.deleted_at IS NULL",
    )
    .bind(&topic_ids)
    .fetch_all(pool)
    .await?;
    let candidates = documents
        .into_iter()
        .filter_map(|document| {
            document
                .rich_content
                .as_ref()
                .and_then(first_public_rich_content_image_id)
                .map(|attachment_id| (document.topic_id, attachment_id))
        })
        .collect::<HashMap<_, _>>();
    hydrate_topic_cover_candidates(pool, topics, candidates, viewer_user_id).await
}

async fn hydrate_topic_cover_candidates(
    pool: &sqlx::PgPool,
    topics: &mut [PublicTopicRecord],
    candidates: HashMap<Uuid, Uuid>,
    viewer_user_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    if candidates.is_empty() {
        return Ok(());
    }
    let attachment_ids = candidates.values().copied().collect::<Vec<_>>();
    let topic_ids = candidates.keys().copied().collect::<Vec<_>>();
    let available = sqlx::query_as::<_, TopicCoverAttachmentRow>(
        "SELECT attachment.id, attachment.topic_id \
         FROM topic_attachments AS attachment \
         INNER JOIN topics AS topic ON topic.id = attachment.topic_id \
         WHERE attachment.id = ANY($1::uuid[]) \
           AND attachment.topic_id = ANY($2::uuid[]) \
           AND attachment.status = 'ready' \
           AND attachment.scan_status = 'clean' \
           AND attachment.deleted_at IS NULL \
           AND attachment.mime_type LIKE 'image/%' \
           AND topic.status = 'published' AND topic.deleted_at IS NULL \
           AND daoyun_can_access_content('topic', topic.id, $3, CURRENT_TIMESTAMP) \
           AND daoyun_can_access_content('attachment', attachment.id, $3, CURRENT_TIMESTAMP)",
    )
    .bind(&attachment_ids)
    .bind(&topic_ids)
    .bind(viewer_user_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|attachment| (attachment.topic_id, attachment.id))
    .collect::<HashMap<_, _>>();
    for topic in topics {
        topic.image_attachment_id = candidates.get(&topic.id).and_then(|candidate| {
            (available.get(&topic.id) == Some(candidate)).then_some(*candidate)
        });
    }
    Ok(())
}

fn first_public_rich_content_image_id(value: &Value) -> Option<Uuid> {
    let object = value.as_object()?;
    if object.get("type").and_then(Value::as_str) == Some("replyGate") {
        return None;
    }
    if object.get("type").and_then(Value::as_str) == Some("image")
        && let Some(attachment_id) = object
            .get("attrs")
            .and_then(Value::as_object)
            .and_then(|attrs| attrs.get("attachmentId"))
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
    {
        return Some(attachment_id);
    }
    object
        .get("content")
        .and_then(Value::as_array)
        .and_then(|content| content.iter().find_map(first_public_rich_content_image_id))
}

#[cfg(test)]
mod cover_image_tests {
    use super::first_public_rich_content_image_id;
    use serde_json::json;
    use sqlx::types::Uuid;

    #[test]
    fn rich_content_cover_uses_the_first_public_image_in_document_order() {
        let first = Uuid::from_u128(1);
        let second = Uuid::from_u128(2);
        let document = json!({
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "正文"}]},
                {"type": "image", "attrs": {"attachmentId": first}},
                {"type": "image", "attrs": {"attachmentId": second}}
            ]
        });

        assert_eq!(first_public_rich_content_image_id(&document), Some(first));
    }

    #[test]
    fn rich_content_cover_skips_reply_gates_and_invalid_image_ids() {
        let public = Uuid::from_u128(3);
        let document = json!({
            "type": "doc",
            "content": [
                {
                    "type": "replyGate",
                    "attrs": {"locked": true},
                    "content": [
                        {"type": "image", "attrs": {"attachmentId": Uuid::from_u128(4)}}
                    ]
                },
                {"type": "image", "attrs": {"attachmentId": "not-a-uuid"}},
                {"type": "image", "attrs": {"attachmentId": public}}
            ]
        });

        assert_eq!(first_public_rich_content_image_id(&document), Some(public));
    }
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
    rich_content: Option<Value>,
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

#[derive(Debug, FromRow)]
struct TopicGovernanceRow {
    author_id: Uuid,
    board_id: Uuid,
    status: String,
    deleted_at: Option<OffsetDateTime>,
    governance_revision: i64,
}

#[derive(Debug, FromRow)]
struct TopicGovernanceResultRow {
    topic_id: Uuid,
    board_id: Uuid,
    is_pinned: bool,
    is_featured: bool,
    is_locked: bool,
    governance_revision: i64,
}

impl From<TopicGovernanceResultRow> for TopicGovernanceResultRecord {
    fn from(row: TopicGovernanceResultRow) -> Self {
        Self {
            topic_id: row.topic_id,
            board_id: row.board_id,
            is_pinned: row.is_pinned,
            is_featured: row.is_featured,
            is_locked: row.is_locked,
            governance_revision: row.governance_revision,
        }
    }
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
    rich_content: Option<Value>,
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
struct TopicRichContentRow {
    topic_id: Uuid,
    rich_content: Option<Value>,
}

#[derive(Debug, FromRow)]
struct TopicCoverAttachmentRow {
    id: Uuid,
    topic_id: Uuid,
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
                image_attachment_id: None,
                tags: Vec::new(),
            },
            content: row.content,
            rich_content: row.rich_content,
            content_revision: row.content_revision,
            reply_gate_unlocked: false,
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

impl fmt::Display for ListModerationTopicsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCursor => formatter.write_str("moderation topic cursor is not available"),
            Self::Database(_) => {
                formatter.write_str("moderation topic list database operation failed")
            }
        }
    }
}

impl Error for ListModerationTopicsError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidCursor => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for ListModerationTopicsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for ListTopicModerationHistoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TopicUnavailable => formatter.write_str("topic history is unavailable"),
            Self::InvalidCursor => formatter.write_str("topic history cursor is not available"),
            Self::Database(_) => formatter.write_str("topic history database operation failed"),
        }
    }
}

impl Error for ListTopicModerationHistoryError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::TopicUnavailable | Self::InvalidCursor => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for ListTopicModerationHistoryError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
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

async fn bind_rich_content_attachments(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    topic_id: Uuid,
    uploader_id: Uuid,
    rich_content: Option<&Value>,
) -> Result<bool, sqlx::Error> {
    let Some(rich_content) = rich_content else {
        return Ok(true);
    };
    let mut attachment_ids = HashSet::new();
    if !collect_rich_content_attachment_ids(rich_content, &mut attachment_ids)
        || attachment_ids.len() > 20
    {
        return Ok(false);
    }
    if attachment_ids.is_empty() {
        return Ok(true);
    }
    let attachment_ids = attachment_ids.into_iter().collect::<Vec<_>>();
    let available = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM topic_attachments
         WHERE id = ANY($1) AND uploader_id = $2
           AND (topic_id IS NULL OR topic_id = $3)
           AND status = 'ready' AND scan_status = 'clean'
           AND deleted_at IS NULL
           AND (topic_id IS NOT NULL OR expires_at > CURRENT_TIMESTAMP)
         FOR UPDATE",
    )
    .bind(&attachment_ids)
    .bind(uploader_id)
    .bind(topic_id)
    .fetch_all(&mut **transaction)
    .await?;
    if available.len() != attachment_ids.len() {
        return Ok(false);
    }
    sqlx::query(
        "UPDATE topic_attachments
         SET topic_id = $2,
             expires_at = CURRENT_TIMESTAMP + ($3::int * INTERVAL '1 day')
         WHERE id = ANY($1) AND topic_id IS NULL",
    )
    .bind(&attachment_ids)
    .bind(topic_id)
    .bind(crate::attachments::retention_days())
    .execute(&mut **transaction)
    .await?;
    Ok(true)
}

fn collect_rich_content_attachment_ids(value: &Value, output: &mut HashSet<Uuid>) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.get("type").and_then(Value::as_str) == Some("image") {
        let Some(attachment_id) = object
            .get("attrs")
            .and_then(Value::as_object)
            .and_then(|attrs| attrs.get("attachmentId"))
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            return false;
        };
        output.insert(attachment_id);
    }
    object
        .get("content")
        .and_then(Value::as_array)
        .is_none_or(|content| {
            content
                .iter()
                .all(|child| collect_rich_content_attachment_ids(child, output))
        })
}

fn map_topic_community_action_error(error: CommunityActionError) -> CreateTopicError {
    match error {
        CommunityActionError::PermissionDenied => CreateTopicError::PermissionDenied,
        CommunityActionError::QuotaExceeded => CreateTopicError::QuotaExceeded,
        CommunityActionError::Database(error) => {
            CreateTopicError::Database(DatabaseError::from(error))
        }
    }
}

fn map_reply_community_action_error(error: CommunityActionError) -> CreateReplyError {
    match error {
        CommunityActionError::PermissionDenied => CreateReplyError::PermissionDenied,
        CommunityActionError::QuotaExceeded => CreateReplyError::QuotaExceeded,
        CommunityActionError::Database(error) => {
            CreateReplyError::Database(DatabaseError::from(error))
        }
    }
}

impl fmt::Display for CreateTopicError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BoardUnavailable => formatter.write_str("topic board is unavailable"),
            Self::BoardRestricted => formatter.write_str("topic creation is restricted in board"),
            Self::AuthorRestricted => formatter.write_str("topic author is restricted"),
            Self::PermissionDenied => formatter.write_str("topic creation is not allowed"),
            Self::QuotaExceeded => formatter.write_str("topic creation quota was exceeded"),
            Self::IdempotencyConflict => formatter.write_str("topic idempotency key conflicts"),
            Self::AttachmentUnavailable => {
                formatter.write_str("topic rich content attachment is unavailable")
            }
            Self::Database(_) => formatter.write_str("topic creation database operation failed"),
        }
    }
}

impl Error for CreateTopicError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::BoardUnavailable
            | Self::BoardRestricted
            | Self::AuthorRestricted
            | Self::PermissionDenied
            | Self::QuotaExceeded
            | Self::IdempotencyConflict
            | Self::AttachmentUnavailable => None,
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
            Self::TopicLocked => formatter.write_str("reply topic is locked"),
            Self::BoardRestricted => formatter.write_str("reply creation is restricted in board"),
            Self::AuthorRestricted => formatter.write_str("reply author is restricted"),
            Self::PermissionDenied => formatter.write_str("reply creation is not allowed"),
            Self::QuotaExceeded => formatter.write_str("reply creation quota was exceeded"),
            Self::IdempotencyConflict => formatter.write_str("reply idempotency key conflicts"),
            Self::InvalidReplyTarget => formatter.write_str("reply target is unavailable"),
            Self::AttachmentUnavailable => {
                formatter.write_str("reply rich content attachment is unavailable")
            }
            Self::Database(_) => formatter.write_str("reply creation database operation failed"),
        }
    }
}

impl Error for CreateReplyError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::TopicUnavailable
            | Self::TopicLocked
            | Self::BoardRestricted
            | Self::AuthorRestricted
            | Self::PermissionDenied
            | Self::QuotaExceeded
            | Self::IdempotencyConflict
            | Self::InvalidReplyTarget
            | Self::AttachmentUnavailable => None,
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
            Self::AttachmentUnavailable => {
                formatter.write_str("topic rich content attachment is unavailable")
            }
            Self::Database(_) => formatter.write_str("topic update database operation failed"),
        }
    }
}

impl Error for UpdateTopicError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::TopicUnavailable
            | Self::Forbidden
            | Self::RevisionConflict
            | Self::AttachmentUnavailable => None,
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
            Self::AttachmentUnavailable => {
                formatter.write_str("reply rich content attachment is unavailable")
            }
            Self::Database(_) => formatter.write_str("reply mutation database operation failed"),
        }
    }
}

impl Error for ReplyMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::ReplyUnavailable | Self::RevisionConflict | Self::AttachmentUnavailable => None,
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

impl From<sqlx::Error> for TopicGovernanceError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<OutboxError> for TopicGovernanceError {
    fn from(error: OutboxError) -> Self {
        Self::Outbox(error)
    }
}

impl fmt::Display for TopicGovernanceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => formatter.write_str("topic is unavailable"),
            Self::Forbidden => formatter.write_str("topic governance is forbidden"),
            Self::InvalidInput => formatter.write_str("topic governance input is invalid"),
            Self::RevisionConflict => formatter.write_str("topic governance revision conflicts"),
            Self::Database(_) => formatter.write_str("topic governance database operation failed"),
            Self::Outbox(_) => formatter.write_str("topic governance outbox operation failed"),
        }
    }
}

impl Error for TopicGovernanceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Outbox(error) => Some(error),
            Self::Unavailable | Self::Forbidden | Self::InvalidInput | Self::RevisionConflict => {
                None
            }
        }
    }
}
