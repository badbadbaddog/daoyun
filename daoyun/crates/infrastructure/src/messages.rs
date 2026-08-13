use std::{error::Error, fmt};

use serde_json::json;
use sqlx::{FromRow, Postgres, Transaction, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::notifications::insert_notification;
use crate::{Database, DatabaseError, IdempotencyInput, PublicUserSummaryRecord};

const MESSAGE_ENDPOINT: &str = "POST /api/v1/conversations/{conversation_id}/messages";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationLastMessageRecord {
    pub id: Uuid,
    pub sender_id: Uuid,
    pub content: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationSummaryRecord {
    pub id: Uuid,
    pub other_user: PublicUserSummaryRecord,
    pub last_message: Option<ConversationLastMessageRecord>,
    pub unread_count: i64,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectMessageRecord {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub sender: PublicUserSummaryRecord,
    pub content: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDirectMessageRecord {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub sender_id: Uuid,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendDirectMessageResult {
    pub message: DirectMessageRecord,
    pub created: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConversationReadStateRecord {
    pub conversation_id: Uuid,
    pub last_read_message_id: Uuid,
    pub unread_count: i64,
}

#[derive(Debug)]
pub enum CreateConversationError {
    Unavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListConversationsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListDirectMessagesError {
    ConversationUnavailable,
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum SendDirectMessageError {
    ConversationUnavailable,
    IdempotencyConflict,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum MarkConversationReadError {
    ConversationUnavailable,
    MessageUnavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ArchiveConversationError {
    ConversationUnavailable,
    Database(DatabaseError),
}

impl Database {
    pub async fn create_direct_conversation(
        &self,
        user_id: Uuid,
        recipient_id: Uuid,
        conversation_id: Uuid,
    ) -> Result<ConversationSummaryRecord, CreateConversationError> {
        if user_id == recipient_id {
            return Err(CreateConversationError::Unavailable);
        }
        let (user_low_id, user_high_id) = if user_id < recipient_id {
            (user_id, recipient_id)
        } else {
            (recipient_id, user_id)
        };
        let mut transaction = self.pool.begin().await?;
        if !lock_active_user_pair(&mut transaction, user_low_id, user_high_id).await? {
            return Err(CreateConversationError::Unavailable);
        }
        let available = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (\
                 SELECT 1 FROM users AS sender, users AS recipient \
                 WHERE sender.id = $1 AND sender.status = 'active' \
                   AND recipient.id = $2 AND recipient.status = 'active' \
                   AND NOT EXISTS (\
                       SELECT 1 FROM user_blocks AS block \
                       WHERE (block.blocker_id = $1 AND block.blocked_id = $2) \
                          OR (block.blocker_id = $2 AND block.blocked_id = $1)\
                   )\
             )",
        )
        .bind(user_id)
        .bind(recipient_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !available {
            return Err(CreateConversationError::Unavailable);
        }

        let inserted_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO direct_conversations (id, user_low_id, user_high_id) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (user_low_id, user_high_id) DO NOTHING \
             RETURNING id",
        )
        .bind(conversation_id)
        .bind(user_low_id)
        .bind(user_high_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let created = inserted_id.is_some();
        let id = if let Some(id) = inserted_id {
            sqlx::query(
                "INSERT INTO conversation_members (conversation_id, user_id) \
                 VALUES ($1, $2), ($1, $3)",
            )
            .bind(id)
            .bind(user_low_id)
            .bind(user_high_id)
            .execute(&mut *transaction)
            .await?;
            id
        } else {
            sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM direct_conversations \
                 WHERE user_low_id = $1 AND user_high_id = $2",
            )
            .bind(user_low_id)
            .bind(user_high_id)
            .fetch_one(&mut *transaction)
            .await?
        };

        sqlx::query(
            "UPDATE conversation_members \
             SET archived_at = NULL, updated_at = CURRENT_TIMESTAMP \
             WHERE conversation_id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        let summary = conversation_summary_in_transaction(&mut transaction, user_id, id)
            .await?
            .ok_or(CreateConversationError::Unavailable)?;
        if created {
            insert_audit(
                &mut transaction,
                user_id,
                "conversation.create",
                "conversation",
                Some(id),
                json!({}),
            )
            .await?;
        }
        transaction.commit().await?;
        Ok(summary)
    }

    pub async fn list_direct_conversations(
        &self,
        user_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<ConversationSummaryRecord>, ListConversationsError> {
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (\
                     SELECT 1 FROM conversation_members \
                     WHERE conversation_id = $1 AND user_id = $2 AND archived_at IS NULL\
                 )",
            )
            .bind(cursor)
            .bind(user_id)
            .fetch_one(&self.pool)
            .await?;
            if !valid {
                return Err(ListConversationsError::InvalidCursor);
            }
        }

        let rows = sqlx::query_as::<_, ConversationSummaryRow>(
            "SELECT conversation.id, other.id AS other_user_id, \
                    other.username AS other_username, other.display_name AS other_display_name, \
                    other.avatar_url AS other_avatar_url, member.unread_count, \
                    conversation.updated_at, last_message.id AS last_message_id, \
                    last_message.sender_id AS last_message_sender_id, \
                    last_message.content AS last_message_content, \
                    last_message.created_at AS last_message_created_at \
             FROM conversation_members AS member \
             INNER JOIN direct_conversations AS conversation ON conversation.id = member.conversation_id \
             INNER JOIN users AS other ON other.id = CASE \
                 WHEN conversation.user_low_id = $1 THEN conversation.user_high_id \
                 ELSE conversation.user_low_id END \
             LEFT JOIN LATERAL (\
                 SELECT message.id, message.sender_id, message.content, message.created_at \
                 FROM direct_messages AS message \
                 WHERE message.conversation_id = conversation.id AND message.deleted_at IS NULL \
                 ORDER BY message.created_at DESC, message.id DESC LIMIT 1\
             ) AS last_message ON TRUE \
             WHERE member.user_id = $1 AND member.archived_at IS NULL \
               AND (\
                   $2::uuid IS NULL OR \
                   (COALESCE(conversation.last_message_at, conversation.created_at), conversation.id) < (\
                       SELECT COALESCE(cursor_conversation.last_message_at, cursor_conversation.created_at), \
                              cursor_conversation.id \
                       FROM direct_conversations AS cursor_conversation \
                       WHERE cursor_conversation.id = $2\
                   )\
               ) \
             ORDER BY COALESCE(conversation.last_message_at, conversation.created_at) DESC, \
                      conversation.id DESC \
             LIMIT $3",
        )
        .bind(user_id)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(ConversationSummaryRow::into_record)
            .collect())
    }

    pub async fn list_direct_messages(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<DirectMessageRecord>, ListDirectMessagesError> {
        let is_member = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (\
                 SELECT 1 FROM conversation_members \
                 WHERE conversation_id = $1 AND user_id = $2\
             )",
        )
        .bind(conversation_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        if !is_member {
            return Err(ListDirectMessagesError::ConversationUnavailable);
        }
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (\
                     SELECT 1 FROM direct_messages \
                     WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL\
                 )",
            )
            .bind(cursor)
            .bind(conversation_id)
            .fetch_one(&self.pool)
            .await?;
            if !valid {
                return Err(ListDirectMessagesError::InvalidCursor);
            }
        }

        let rows = sqlx::query_as::<_, DirectMessageRow>(
            "SELECT message.id, message.conversation_id, message.content, message.created_at, \
                    sender.id AS sender_id, sender.username AS sender_username, \
                    sender.display_name AS sender_display_name, sender.avatar_url AS sender_avatar_url \
             FROM direct_messages AS message \
             INNER JOIN users AS sender ON sender.id = message.sender_id \
             WHERE message.conversation_id = $1 AND message.deleted_at IS NULL \
               AND (\
                   $2::uuid IS NULL OR (message.created_at, message.id) < (\
                       SELECT cursor_message.created_at, cursor_message.id \
                       FROM direct_messages AS cursor_message \
                       WHERE cursor_message.id = $2 AND cursor_message.conversation_id = $1\
                   )\
               ) \
             ORDER BY message.created_at DESC, message.id DESC \
             LIMIT $3",
        )
        .bind(conversation_id)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(DirectMessageRow::into_record)
            .collect())
    }

    pub async fn send_direct_message(
        &self,
        input: NewDirectMessageRecord,
        idempotency: Option<IdempotencyInput>,
    ) -> Result<SendDirectMessageResult, SendDirectMessageError> {
        let mut transaction = self.pool.begin().await?;
        if let Some(idempotency) = idempotency.as_ref() {
            let inserted = sqlx::query_as::<_, IdempotencyRow>(
                "INSERT INTO idempotency_records (\
                     id, user_id, endpoint, idempotency_key, request_hash, \
                     resource_type, resource_id, expires_at\
                 ) VALUES (\
                     $1, $2, $3, $4, $5, 'direct_message', $6, CURRENT_TIMESTAMP + INTERVAL '1 day'\
                 ) \
                 ON CONFLICT (user_id, endpoint, idempotency_key) DO NOTHING \
                 RETURNING request_hash, resource_id",
            )
            .bind(Uuid::now_v7())
            .bind(input.sender_id)
            .bind(MESSAGE_ENDPOINT)
            .bind(&idempotency.key)
            .bind(&idempotency.request_hash)
            .bind(input.id)
            .fetch_optional(&mut *transaction)
            .await?;
            if inserted.is_none() {
                let existing = sqlx::query_as::<_, IdempotencyRow>(
                    "SELECT request_hash, resource_id FROM idempotency_records \
                     WHERE user_id = $1 AND endpoint = $2 AND idempotency_key = $3",
                )
                .bind(input.sender_id)
                .bind(MESSAGE_ENDPOINT)
                .bind(&idempotency.key)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or_else(|| protocol_error("message idempotency record disappeared"))?;
                if existing.request_hash != idempotency.request_hash {
                    return Err(SendDirectMessageError::IdempotencyConflict);
                }
                let message = direct_message_in_transaction(&mut transaction, existing.resource_id)
                    .await?
                    .ok_or_else(|| protocol_error("idempotent message disappeared"))?;
                transaction.commit().await?;
                return Ok(SendDirectMessageResult {
                    message,
                    created: false,
                });
            }
        }

        let participant_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT receiver_member.user_id \
             FROM direct_conversations AS conversation \
             INNER JOIN conversation_members AS sender_member \
               ON sender_member.conversation_id = conversation.id AND sender_member.user_id = $2 \
             INNER JOIN conversation_members AS receiver_member \
               ON receiver_member.conversation_id = conversation.id AND receiver_member.user_id <> $2 \
             WHERE conversation.id = $1",
        )
        .bind(input.conversation_id)
        .bind(input.sender_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(participant_id) = participant_id else {
            return Err(SendDirectMessageError::ConversationUnavailable);
        };
        if !lock_active_user_pair(&mut transaction, input.sender_id, participant_id).await? {
            return Err(SendDirectMessageError::ConversationUnavailable);
        }

        let receiver_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT receiver_member.user_id \
             FROM direct_conversations AS conversation \
             INNER JOIN conversation_members AS sender_member \
               ON sender_member.conversation_id = conversation.id AND sender_member.user_id = $2 \
             INNER JOIN conversation_members AS receiver_member \
               ON receiver_member.conversation_id = conversation.id AND receiver_member.user_id <> $2 \
             INNER JOIN users AS receiver ON receiver.id = receiver_member.user_id \
             WHERE conversation.id = $1 AND receiver.status = 'active' \
               AND NOT EXISTS (\
                   SELECT 1 FROM user_blocks AS block \
                   WHERE (block.blocker_id = $2 AND block.blocked_id = receiver_member.user_id) \
                      OR (block.blocker_id = receiver_member.user_id AND block.blocked_id = $2)\
               ) \
             FOR UPDATE OF conversation, sender_member, receiver_member",
        )
        .bind(input.conversation_id)
        .bind(input.sender_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(receiver_id) = receiver_id else {
            return Err(SendDirectMessageError::ConversationUnavailable);
        };

        let created_at = sqlx::query_scalar::<_, OffsetDateTime>(
            "INSERT INTO direct_messages (id, conversation_id, sender_id, content) \
             VALUES ($1, $2, $3, $4) RETURNING created_at",
        )
        .bind(input.id)
        .bind(input.conversation_id)
        .bind(input.sender_id)
        .bind(&input.content)
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE direct_conversations \
             SET last_message_at = $2, updated_at = $2 WHERE id = $1",
        )
        .bind(input.conversation_id)
        .bind(created_at)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE conversation_members SET \
                 archived_at = NULL, \
                 last_read_message_id = CASE WHEN user_id = $2 THEN $3 ELSE last_read_message_id END, \
                 unread_count = CASE WHEN user_id = $2 THEN 0 ELSE unread_count + 1 END, \
                 updated_at = $4 \
             WHERE conversation_id = $1 AND user_id IN ($2, $5)",
        )
        .bind(input.conversation_id)
        .bind(input.sender_id)
        .bind(input.id)
        .bind(created_at)
        .bind(receiver_id)
        .execute(&mut *transaction)
        .await?;
        insert_notification(
            &mut transaction,
            Uuid::now_v7(),
            receiver_id,
            Some(input.sender_id),
            "message",
            "conversation",
            input.conversation_id,
            &format!("message:{}", input.id),
        )
        .await?;
        insert_audit(
            &mut transaction,
            input.sender_id,
            "message.send",
            "message",
            Some(input.id),
            json!({"conversation_id": input.conversation_id}),
        )
        .await?;
        let message = direct_message_in_transaction(&mut transaction, input.id)
            .await?
            .ok_or_else(|| protocol_error("created direct message disappeared"))?;
        transaction.commit().await?;
        Ok(SendDirectMessageResult {
            message,
            created: true,
        })
    }

    pub async fn mark_direct_conversation_read(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
        target_message_id: Uuid,
    ) -> Result<ConversationReadStateRecord, MarkConversationReadError> {
        let mut transaction = self.pool.begin().await?;
        let member = sqlx::query_as::<_, MemberReadRow>(
            "SELECT member.last_read_message_id, member.unread_count, \
                    current_message.created_at AS last_read_created_at \
             FROM conversation_members AS member \
             LEFT JOIN direct_messages AS current_message \
               ON current_message.id = member.last_read_message_id \
             WHERE member.conversation_id = $1 AND member.user_id = $2 \
             FOR UPDATE OF member",
        )
        .bind(conversation_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(member) = member else {
            return Err(MarkConversationReadError::ConversationUnavailable);
        };
        let target = sqlx::query_as::<_, MessagePositionRow>(
            "SELECT id, created_at FROM direct_messages \
             WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL",
        )
        .bind(target_message_id)
        .bind(conversation_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(target) = target else {
            return Err(MarkConversationReadError::MessageUnavailable);
        };

        if let (Some(current_id), Some(current_time)) =
            (member.last_read_message_id, member.last_read_created_at)
            && (current_time, current_id) >= (target.created_at, target.id)
        {
            transaction.commit().await?;
            return Ok(ConversationReadStateRecord {
                conversation_id,
                last_read_message_id: current_id,
                unread_count: member.unread_count,
            });
        }

        let unread_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM direct_messages \
             WHERE conversation_id = $1 AND sender_id <> $2 AND deleted_at IS NULL \
               AND (created_at, id) > ($3, $4)",
        )
        .bind(conversation_id)
        .bind(user_id)
        .bind(target.created_at)
        .bind(target.id)
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE conversation_members \
             SET last_read_message_id = $3, unread_count = $4, updated_at = CURRENT_TIMESTAMP \
             WHERE conversation_id = $1 AND user_id = $2",
        )
        .bind(conversation_id)
        .bind(user_id)
        .bind(target.id)
        .bind(unread_count)
        .execute(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            user_id,
            "conversation.read",
            "conversation",
            Some(conversation_id),
            json!({"message_id": target.id}),
        )
        .await?;
        transaction.commit().await?;
        Ok(ConversationReadStateRecord {
            conversation_id,
            last_read_message_id: target.id,
            unread_count,
        })
    }

    pub async fn archive_direct_conversation(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
    ) -> Result<(), ArchiveConversationError> {
        let mut transaction = self.pool.begin().await?;
        let changed = sqlx::query(
            "UPDATE conversation_members \
             SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
             WHERE conversation_id = $1 AND user_id = $2 AND archived_at IS NULL",
        )
        .bind(conversation_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        if changed.rows_affected() == 0 {
            let is_member = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM conversation_members
                 WHERE conversation_id = $1 AND user_id = $2)",
            )
            .bind(conversation_id)
            .bind(user_id)
            .fetch_one(&mut *transaction)
            .await?;
            if !is_member {
                return Err(ArchiveConversationError::ConversationUnavailable);
            }
            transaction.commit().await?;
            return Ok(());
        }
        insert_audit(
            &mut transaction,
            user_id,
            "conversation.archive",
            "conversation",
            Some(conversation_id),
            json!({}),
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }
}

async fn conversation_summary_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    conversation_id: Uuid,
) -> Result<Option<ConversationSummaryRecord>, sqlx::Error> {
    sqlx::query_as::<_, ConversationSummaryRow>(
        "SELECT conversation.id, other.id AS other_user_id, \
                other.username AS other_username, other.display_name AS other_display_name, \
                other.avatar_url AS other_avatar_url, member.unread_count, \
                conversation.updated_at, last_message.id AS last_message_id, \
                last_message.sender_id AS last_message_sender_id, \
                last_message.content AS last_message_content, \
                last_message.created_at AS last_message_created_at \
         FROM conversation_members AS member \
         INNER JOIN direct_conversations AS conversation ON conversation.id = member.conversation_id \
         INNER JOIN users AS other ON other.id = CASE \
             WHEN conversation.user_low_id = $1 THEN conversation.user_high_id \
             ELSE conversation.user_low_id END \
         LEFT JOIN LATERAL (\
             SELECT message.id, message.sender_id, message.content, message.created_at \
             FROM direct_messages AS message \
             WHERE message.conversation_id = conversation.id AND message.deleted_at IS NULL \
             ORDER BY message.created_at DESC, message.id DESC LIMIT 1\
         ) AS last_message ON TRUE \
         WHERE member.user_id = $1 AND member.conversation_id = $2",
    )
    .bind(user_id)
    .bind(conversation_id)
    .fetch_optional(&mut **transaction)
    .await
    .map(|row| row.map(ConversationSummaryRow::into_record))
}

async fn lock_active_user_pair(
    transaction: &mut Transaction<'_, Postgres>,
    first: Uuid,
    second: Uuid,
) -> Result<bool, sqlx::Error> {
    let users = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users \
         WHERE (id = $1 OR id = $2) AND status = 'active' \
         ORDER BY id FOR UPDATE",
    )
    .bind(first)
    .bind(second)
    .fetch_all(&mut **transaction)
    .await?;
    Ok(users.len() == 2)
}

async fn direct_message_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    message_id: Uuid,
) -> Result<Option<DirectMessageRecord>, sqlx::Error> {
    sqlx::query_as::<_, DirectMessageRow>(
        "SELECT message.id, message.conversation_id, message.content, message.created_at, \
                sender.id AS sender_id, sender.username AS sender_username, \
                sender.display_name AS sender_display_name, sender.avatar_url AS sender_avatar_url \
         FROM direct_messages AS message \
         INNER JOIN users AS sender ON sender.id = message.sender_id \
         WHERE message.id = $1 AND message.deleted_at IS NULL",
    )
    .bind(message_id)
    .fetch_optional(&mut **transaction)
    .await
    .map(|row| row.map(DirectMessageRow::into_record))
}

fn protocol_error(message: &str) -> SendDirectMessageError {
    SendDirectMessageError::Database(DatabaseError::from(sqlx::Error::Protocol(
        message.to_owned(),
    )))
}

#[derive(Debug, FromRow)]
struct ConversationSummaryRow {
    id: Uuid,
    other_user_id: Uuid,
    other_username: String,
    other_display_name: String,
    other_avatar_url: Option<String>,
    unread_count: i64,
    updated_at: OffsetDateTime,
    last_message_id: Option<Uuid>,
    last_message_sender_id: Option<Uuid>,
    last_message_content: Option<String>,
    last_message_created_at: Option<OffsetDateTime>,
}

impl ConversationSummaryRow {
    fn into_record(self) -> ConversationSummaryRecord {
        let last_message = match (
            self.last_message_id,
            self.last_message_sender_id,
            self.last_message_content,
            self.last_message_created_at,
        ) {
            (Some(id), Some(sender_id), Some(content), Some(created_at)) => {
                Some(ConversationLastMessageRecord {
                    id,
                    sender_id,
                    content,
                    created_at,
                })
            }
            _ => None,
        };
        ConversationSummaryRecord {
            id: self.id,
            other_user: PublicUserSummaryRecord {
                id: self.other_user_id,
                username: self.other_username,
                display_name: self.other_display_name,
                avatar_url: self.other_avatar_url,
            },
            last_message,
            unread_count: self.unread_count,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Debug, FromRow)]
struct DirectMessageRow {
    id: Uuid,
    conversation_id: Uuid,
    sender_id: Uuid,
    sender_username: String,
    sender_display_name: String,
    sender_avatar_url: Option<String>,
    content: String,
    created_at: OffsetDateTime,
}

impl DirectMessageRow {
    fn into_record(self) -> DirectMessageRecord {
        DirectMessageRecord {
            id: self.id,
            conversation_id: self.conversation_id,
            sender: PublicUserSummaryRecord {
                id: self.sender_id,
                username: self.sender_username,
                display_name: self.sender_display_name,
                avatar_url: self.sender_avatar_url,
            },
            content: self.content,
            created_at: self.created_at,
        }
    }
}

#[derive(Debug, FromRow)]
struct IdempotencyRow {
    request_hash: Vec<u8>,
    resource_id: Uuid,
}

#[derive(Debug, FromRow)]
struct MemberReadRow {
    last_read_message_id: Option<Uuid>,
    unread_count: i64,
    last_read_created_at: Option<OffsetDateTime>,
}

#[derive(Debug, FromRow)]
struct MessagePositionRow {
    id: Uuid,
    created_at: OffsetDateTime,
}

macro_rules! impl_database_error {
    ($error:ty) => {
        impl From<sqlx::Error> for $error {
            fn from(error: sqlx::Error) -> Self {
                Self::Database(DatabaseError::from(error))
            }
        }
    };
}

impl_database_error!(CreateConversationError);
impl_database_error!(ListConversationsError);
impl_database_error!(ListDirectMessagesError);
impl_database_error!(SendDirectMessageError);
impl_database_error!(MarkConversationReadError);
impl_database_error!(ArchiveConversationError);

macro_rules! impl_error {
    ($error:ty, $message:literal) => {
        impl fmt::Display for $error {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                match self {
                    Self::Database(_) => formatter.write_str($message),
                    other => write!(formatter, "{other:?}"),
                }
            }
        }

        impl Error for $error {
            fn source(&self) -> Option<&(dyn Error + 'static)> {
                match self {
                    Self::Database(error) => Some(error),
                    _ => None,
                }
            }
        }
    };
}

impl_error!(
    CreateConversationError,
    "conversation database operation failed"
);
impl_error!(
    ListConversationsError,
    "conversation list database operation failed"
);
impl_error!(
    ListDirectMessagesError,
    "message list database operation failed"
);
impl_error!(
    SendDirectMessageError,
    "message send database operation failed"
);
impl_error!(
    MarkConversationReadError,
    "conversation read database operation failed"
);
impl_error!(
    ArchiveConversationError,
    "conversation archive database operation failed"
);
