use std::{error::Error, fmt};

use serde_json::json;
use sqlx::{FromRow, Postgres, Transaction, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::{Database, DatabaseError, PublicUserSummaryRecord};

#[derive(Debug, Clone)]
pub struct NotificationRecord {
    pub id: Uuid,
    pub kind: String,
    pub actor: Option<PublicUserSummaryRecord>,
    pub target_type: String,
    pub target_id: Uuid,
    pub topic_id: Option<Uuid>,
    pub read_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NotificationUnreadCountRecord {
    pub unread_count: i64,
}

#[derive(Debug)]
pub enum ListNotificationsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum NotificationMutationError {
    NotFound,
    Database(DatabaseError),
}

#[derive(Debug, FromRow)]
struct NotificationRow {
    id: Uuid,
    kind: String,
    actor_id: Option<Uuid>,
    actor_username: Option<String>,
    actor_display_name: Option<String>,
    actor_avatar_url: Option<String>,
    target_type: String,
    target_id: Uuid,
    topic_id: Option<Uuid>,
    read_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
}

impl NotificationRow {
    fn into_record(self) -> NotificationRecord {
        let actor = self.actor_id.map(|id| PublicUserSummaryRecord {
            id,
            username: self.actor_username.unwrap_or_default(),
            display_name: self.actor_display_name.unwrap_or_default(),
            avatar_url: self.actor_avatar_url,
        });
        NotificationRecord {
            id: self.id,
            kind: self.kind,
            actor,
            target_type: self.target_type,
            target_id: self.target_id,
            topic_id: self.topic_id,
            read_at: self.read_at,
            created_at: self.created_at,
        }
    }
}

// Governance notifications retain the recipient's own handling facts, without content snapshots.
// Other content targets share the current topic, board and post read boundaries.
macro_rules! notification_sql {
    ($before:literal, $after:literal) => {
        concat!(
            $before,
            "(
    n.kind = 'topic_governance' OR n.target_type NOT IN ('topic', 'post') OR EXISTS (
        SELECT 1 FROM topics AS topic
        JOIN boards AS board ON board.id = topic.board_id
        JOIN users AS author ON author.id = topic.author_id
        WHERE topic.id = CASE WHEN n.target_type = 'topic' THEN n.target_id ELSE (
            SELECT post.topic_id FROM posts AS post
            JOIN users AS post_author ON post_author.id = post.author_id
            WHERE post.id = n.target_id AND post.status = 'published'
              AND post.deleted_at IS NULL AND post_author.status = 'active'
              AND daoyun_can_access_content('post', post.id, n.recipient_id, CURRENT_TIMESTAMP)
        ) END
          AND topic.status = 'published' AND topic.deleted_at IS NULL
          AND board.visibility = 'public' AND board.deleted_at IS NULL
          AND author.status = 'active'
          AND daoyun_can_access_content('topic', topic.id, n.recipient_id, CURRENT_TIMESTAMP)
    )
)",
            $after
        )
    };
}

impl Database {
    pub async fn list_notifications(
        &self,
        recipient_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<NotificationRecord>, ListNotificationsError> {
        self.list_filtered_notifications(recipient_id, cursor, limit, false)
            .await
    }

    pub async fn list_filtered_notifications(
        &self,
        recipient_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
        unread: bool,
    ) -> Result<Vec<NotificationRecord>, ListNotificationsError> {
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM notifications WHERE recipient_id = $1 AND id = $2)",
            )
            .bind(recipient_id)
            .bind(cursor)
            .fetch_one(&self.pool)
            .await?;
            if !valid {
                return Err(ListNotificationsError::InvalidCursor);
            }
        }

        let rows = sqlx::query_as::<_, NotificationRow>(notification_sql!(
            "SELECT n.id, n.kind, actor.id AS actor_id, actor.username AS actor_username,
                    actor.display_name AS actor_display_name, actor.avatar_url AS actor_avatar_url,
                    n.target_type, n.target_id, post.topic_id, n.read_at, n.created_at
             FROM notifications AS n
             LEFT JOIN users AS actor ON actor.id = n.actor_id AND actor.status = 'active'
              LEFT JOIN posts AS post ON n.target_type = 'post' AND post.id = n.target_id
             WHERE n.recipient_id = $1 AND ",
            "
               AND (NOT $4::boolean OR n.read_at IS NULL)
               AND ($2::uuid IS NULL OR (n.created_at, n.id) < (
                   SELECT cursor.created_at, cursor.id FROM notifications AS cursor
                   WHERE cursor.recipient_id = $1 AND cursor.id = $2
               ))
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT $3"
        ))
        .bind(recipient_id)
        .bind(cursor)
        .bind(limit)
        .bind(unread)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(NotificationRow::into_record).collect())
    }

    pub async fn count_unread_notifications(
        &self,
        recipient_id: Uuid,
    ) -> Result<NotificationUnreadCountRecord, DatabaseError> {
        let unread_count = sqlx::query_scalar::<_, i64>(
            notification_sql!("SELECT COUNT(*) FROM notifications AS n WHERE n.recipient_id = $1 AND n.read_at IS NULL AND ", ""),
        )
        .bind(recipient_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(NotificationUnreadCountRecord { unread_count })
    }

    pub async fn mark_notification_read(
        &self,
        recipient_id: Uuid,
        notification_id: Uuid,
    ) -> Result<NotificationRecord, NotificationMutationError> {
        let mut transaction = self.pool.begin().await?;
        let updated = sqlx::query(notification_sql!(
            "UPDATE notifications AS n SET read_at = COALESCE(n.read_at, CURRENT_TIMESTAMP)
             WHERE n.id = $1 AND n.recipient_id = $2 AND n.read_at IS NULL AND ",
            ""
        ))
        .bind(notification_id)
        .bind(recipient_id)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() == 0 {
            let exists = sqlx::query_scalar::<_, bool>(notification_sql!(
                "SELECT EXISTS (SELECT 1 FROM notifications AS n
                 WHERE n.id = $1 AND n.recipient_id = $2 AND ",
                ")"
            ))
            .bind(notification_id)
            .bind(recipient_id)
            .fetch_one(&mut *transaction)
            .await?;
            if !exists {
                return Err(NotificationMutationError::NotFound);
            }
        } else {
            insert_audit(
                &mut transaction,
                recipient_id,
                "notification.read",
                "notification",
                Some(notification_id),
                json!({}),
            )
            .await?;
        }
        transaction.commit().await?;
        self.notification_by_id(recipient_id, notification_id).await
    }

    pub async fn mark_all_notifications_read(
        &self,
        recipient_id: Uuid,
    ) -> Result<NotificationUnreadCountRecord, DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        // READ COMMITTED fixes the UPDATE target set at statement start, including while waiting for locks.
        // https://www.postgresql.org/docs/16/transaction-iso.html#XACT-READ-COMMITTED
        let updated = sqlx::query(notification_sql!(
            "UPDATE notifications AS n SET read_at = CURRENT_TIMESTAMP
             WHERE n.recipient_id = $1 AND n.read_at IS NULL AND ",
            ""
        ))
        .bind(recipient_id)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() > 0 {
            insert_audit(
                &mut transaction,
                recipient_id,
                "notification.read_all",
                "notification",
                None,
                json!({"count": updated.rows_affected()}),
            )
            .await?;
        }
        let unread_count = sqlx::query_scalar::<_, i64>(
            notification_sql!("SELECT COUNT(*) FROM notifications AS n WHERE n.recipient_id = $1 AND n.read_at IS NULL AND ", ""),
        )
        .bind(recipient_id)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(NotificationUnreadCountRecord { unread_count })
    }

    async fn notification_by_id(
        &self,
        recipient_id: Uuid,
        notification_id: Uuid,
    ) -> Result<NotificationRecord, NotificationMutationError> {
        sqlx::query_as::<_, NotificationRow>(notification_sql!(
            "SELECT n.id, n.kind, actor.id AS actor_id, actor.username AS actor_username,
                    actor.display_name AS actor_display_name, actor.avatar_url AS actor_avatar_url,
                    n.target_type, n.target_id, post.topic_id, n.read_at, n.created_at
             FROM notifications AS n
             LEFT JOIN users AS actor ON actor.id = n.actor_id AND actor.status = 'active'
              LEFT JOIN posts AS post ON n.target_type = 'post' AND post.id = n.target_id
             WHERE n.recipient_id = $1 AND n.id = $2 AND ",
            ""
        ))
        .bind(recipient_id)
        .bind(notification_id)
        .fetch_optional(&self.pool)
        .await?
        .map(NotificationRow::into_record)
        .ok_or(NotificationMutationError::NotFound)
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_notification(
    transaction: &mut Transaction<'_, Postgres>,
    id: Uuid,
    recipient_id: Uuid,
    actor_id: Option<Uuid>,
    kind: &str,
    target_type: &str,
    target_id: Uuid,
    aggregate_key: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO notifications
            (id, recipient_id, actor_id, kind, target_type, target_id, aggregate_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (recipient_id, aggregate_key) DO NOTHING",
    )
    .bind(id)
    .bind(recipient_id)
    .bind(actor_id)
    .bind(kind)
    .bind(target_type)
    .bind(target_id)
    .bind(aggregate_key)
    .execute(&mut **transaction)
    .await?;
    Ok(result.rows_affected() == 1)
}

impl From<sqlx::Error> for ListNotificationsError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(value))
    }
}

impl From<sqlx::Error> for NotificationMutationError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(value))
    }
}

impl fmt::Display for ListNotificationsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCursor => formatter.write_str("notification cursor is not available"),
            Self::Database(_) => formatter.write_str("notification list database operation failed"),
        }
    }
}

impl Error for ListNotificationsError {}

impl fmt::Display for NotificationMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("notification is not available"),
            Self::Database(_) => formatter.write_str("notification database operation failed"),
        }
    }
}

impl Error for NotificationMutationError {}
