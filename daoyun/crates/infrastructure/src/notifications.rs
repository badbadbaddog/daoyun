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
            read_at: self.read_at,
            created_at: self.created_at,
        }
    }
}

impl Database {
    pub async fn list_notifications(
        &self,
        recipient_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
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

        let rows = sqlx::query_as::<_, NotificationRow>(
            "SELECT n.id, n.kind, actor.id AS actor_id, actor.username AS actor_username,
                    actor.display_name AS actor_display_name, actor.avatar_url AS actor_avatar_url,
                    n.target_type, n.target_id, n.read_at, n.created_at
             FROM notifications AS n
             LEFT JOIN users AS actor ON actor.id = n.actor_id AND actor.status = 'active'
             WHERE n.recipient_id = $1
               AND ($2::uuid IS NULL OR (n.created_at, n.id) < (
                   SELECT cursor.created_at, cursor.id FROM notifications AS cursor
                   WHERE cursor.recipient_id = $1 AND cursor.id = $2
               ))
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT $3",
        )
        .bind(recipient_id)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(NotificationRow::into_record).collect())
    }

    pub async fn count_unread_notifications(
        &self,
        recipient_id: Uuid,
    ) -> Result<NotificationUnreadCountRecord, DatabaseError> {
        let unread_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM notifications WHERE recipient_id = $1 AND read_at IS NULL",
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
        let updated = sqlx::query(
            "UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
             WHERE id = $1 AND recipient_id = $2 AND read_at IS NULL",
        )
        .bind(notification_id)
        .bind(recipient_id)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() == 0 {
            let exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM notifications
                 WHERE id = $1 AND recipient_id = $2)",
            )
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
        self.notification_by_id(recipient_id, notification_id)
            .await
            .map_err(NotificationMutationError::Database)
    }

    pub async fn mark_all_notifications_read(
        &self,
        recipient_id: Uuid,
    ) -> Result<NotificationUnreadCountRecord, DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        let updated = sqlx::query(
            "UPDATE notifications SET read_at = CURRENT_TIMESTAMP
             WHERE recipient_id = $1 AND read_at IS NULL",
        )
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
        transaction.commit().await?;
        self.count_unread_notifications(recipient_id).await
    }

    async fn notification_by_id(
        &self,
        recipient_id: Uuid,
        notification_id: Uuid,
    ) -> Result<NotificationRecord, DatabaseError> {
        sqlx::query_as::<_, NotificationRow>(
            "SELECT n.id, n.kind, actor.id AS actor_id, actor.username AS actor_username,
                    actor.display_name AS actor_display_name, actor.avatar_url AS actor_avatar_url,
                    n.target_type, n.target_id, n.read_at, n.created_at
             FROM notifications AS n
             LEFT JOIN users AS actor ON actor.id = n.actor_id AND actor.status = 'active'
             WHERE n.recipient_id = $1 AND n.id = $2",
        )
        .bind(recipient_id)
        .bind(notification_id)
        .fetch_optional(&self.pool)
        .await?
        .map(NotificationRow::into_record)
        .ok_or_else(|| DatabaseError::Sqlx(sqlx::Error::RowNotFound))
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
