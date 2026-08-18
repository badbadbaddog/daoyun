use std::{error::Error, fmt};

use serde_json::json;
use sqlx::{FromRow, PgConnection, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::{Database, DatabaseError, NewOutboxEvent, OutboxError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoardUserRestrictionAction {
    TopicCreate,
    ReplyCreate,
    AttachmentUpload,
}

impl BoardUserRestrictionAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TopicCreate => "topic.create",
            Self::ReplyCreate => "reply.create",
            Self::AttachmentUpload => "attachment.upload",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutBoardUserRestrictionRecord {
    pub board_id: Uuid,
    pub target_user_id: Uuid,
    pub actor_id: Uuid,
    pub actions: Vec<BoardUserRestrictionAction>,
    pub starts_at: OffsetDateTime,
    pub ends_at: Option<OffsetDateTime>,
    pub reason: String,
    pub expected_revision: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct BoardUserRestrictionRecord {
    pub id: Uuid,
    pub board_id: Uuid,
    pub user_id: Uuid,
    pub actions: Vec<String>,
    pub starts_at: OffsetDateTime,
    pub ends_at: Option<OffsetDateTime>,
    pub reason: String,
    pub created_by: Uuid,
    pub updated_by: Uuid,
    pub revision: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug)]
pub enum BoardUserRestrictionMutationError {
    BoardUnavailable,
    TargetUnavailable,
    Forbidden,
    ProtectedTarget,
    InvalidInput,
    RevisionConflict,
    Database(DatabaseError),
    Outbox(OutboxError),
}

impl Database {
    pub async fn put_board_user_restriction(
        &self,
        input: PutBoardUserRestrictionRecord,
    ) -> Result<BoardUserRestrictionRecord, BoardUserRestrictionMutationError> {
        let actions = normalized_actions(&input.actions)
            .ok_or(BoardUserRestrictionMutationError::InvalidInput)?;
        if !(1..=1000).contains(&input.reason.chars().count())
            || input.reason.chars().any(char::is_control)
            || input
                .ends_at
                .is_some_and(|ends_at| ends_at <= input.starts_at)
        {
            return Err(BoardUserRestrictionMutationError::InvalidInput);
        }
        if input.actor_id == input.target_user_id {
            return Err(BoardUserRestrictionMutationError::ProtectedTarget);
        }

        let mut transaction = self.pool.begin().await?;
        let board_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM boards WHERE id = $1 AND deleted_at IS NULL)",
        )
        .bind(input.board_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !board_exists {
            return Err(BoardUserRestrictionMutationError::BoardUnavailable);
        }
        if !has_permission_with_executor(
            &mut transaction,
            input.actor_id,
            permission_keys::MODERATION_USER_RESTRICT_IN_SCOPE,
            Some(input.board_id),
        )
        .await?
        {
            return Err(BoardUserRestrictionMutationError::Forbidden);
        }
        let target_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
                 SELECT 1 FROM users
                 WHERE id = $1 AND status IN ('active', 'restricted')
                 FOR SHARE
             )",
        )
        .bind(input.target_user_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !target_exists {
            return Err(BoardUserRestrictionMutationError::TargetUnavailable);
        }
        if target_is_protected(
            &mut transaction,
            input.actor_id,
            input.target_user_id,
            input.board_id,
        )
        .await?
        {
            return Err(BoardUserRestrictionMutationError::ProtectedTarget);
        }

        let existing = sqlx::query_as::<_, BoardUserRestrictionRecord>(
            "SELECT id, board_id, user_id, actions, starts_at, ends_at, reason,
                    created_by, updated_by, revision, created_at, updated_at
             FROM board_user_restrictions
             WHERE board_id = $1 AND user_id = $2
             FOR UPDATE",
        )
        .bind(input.board_id)
        .bind(input.target_user_id)
        .fetch_optional(&mut *transaction)
        .await?;

        let record = match (existing, input.expected_revision) {
            (None, None) => {
                sqlx::query_as::<_, BoardUserRestrictionRecord>(
                    "INSERT INTO board_user_restrictions
                    (id, board_id, user_id, actions, starts_at, ends_at, reason,
                     created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
                 RETURNING id, board_id, user_id, actions, starts_at, ends_at, reason,
                           created_by, updated_by, revision, created_at, updated_at",
                )
                .bind(Uuid::now_v7())
                .bind(input.board_id)
                .bind(input.target_user_id)
                .bind(&actions)
                .bind(input.starts_at)
                .bind(input.ends_at)
                .bind(&input.reason)
                .bind(input.actor_id)
                .fetch_one(&mut *transaction)
                .await?
            }
            (Some(existing), Some(expected_revision)) if existing.revision == expected_revision => {
                sqlx::query_as::<_, BoardUserRestrictionRecord>(
                    "UPDATE board_user_restrictions
                     SET actions = $3, starts_at = $4, ends_at = $5, reason = $6,
                         updated_by = $7, revision = revision + 1,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE board_id = $1 AND user_id = $2
                     RETURNING id, board_id, user_id, actions, starts_at, ends_at, reason,
                               created_by, updated_by, revision, created_at, updated_at",
                )
                .bind(input.board_id)
                .bind(input.target_user_id)
                .bind(&actions)
                .bind(input.starts_at)
                .bind(input.ends_at)
                .bind(&input.reason)
                .bind(input.actor_id)
                .fetch_one(&mut *transaction)
                .await?
            }
            _ => return Err(BoardUserRestrictionMutationError::RevisionConflict),
        };

        insert_audit(
            &mut transaction,
            input.actor_id,
            "board.user_restriction.put",
            "board_user_restriction",
            Some(record.id),
            json!({
                "board_id": record.board_id,
                "user_id": record.user_id,
                "actions": record.actions,
                "starts_at_unix": record.starts_at.unix_timestamp(),
                "ends_at_unix": record.ends_at.map(OffsetDateTime::unix_timestamp),
                "revision": record.revision,
            }),
        )
        .await?;
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "board.user_restriction.changed".to_owned(),
                aggregate_type: "board_user_restriction".to_owned(),
                aggregate_id: record.id,
                dedupe_key: format!("{}:{}", record.id, record.revision),
                payload: json!({
                    "restriction_id": record.id,
                    "board_id": record.board_id,
                    "user_id": record.user_id,
                    "actions": record.actions,
                    "starts_at_unix": record.starts_at.unix_timestamp(),
                    "ends_at_unix": record.ends_at.map(OffsetDateTime::unix_timestamp),
                    "revision": record.revision,
                }),
                max_attempts: 10,
            },
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn is_board_user_action_restricted(
        &self,
        user_id: Uuid,
        board_id: Uuid,
        action: &str,
        effective_at: OffsetDateTime,
    ) -> Result<bool, DatabaseError> {
        let mut connection = self.pool.acquire().await?;
        is_board_user_action_restricted_with_executor(
            &mut connection,
            user_id,
            board_id,
            action,
            effective_at,
        )
        .await
        .map_err(DatabaseError::from)
    }
}

pub(crate) async fn is_board_user_action_restricted_with_executor(
    connection: &mut PgConnection,
    user_id: Uuid,
    board_id: Uuid,
    action: &str,
    effective_at: OffsetDateTime,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM board_user_restrictions
             WHERE user_id = $1 AND board_id = $2
               AND $3 = ANY(actions)
               AND starts_at <= $4
               AND (ends_at IS NULL OR ends_at > $4)
             FOR SHARE
         )",
    )
    .bind(user_id)
    .bind(board_id)
    .bind(action)
    .bind(effective_at)
    .fetch_one(&mut *connection)
    .await
}

fn normalized_actions(actions: &[BoardUserRestrictionAction]) -> Option<Vec<String>> {
    let mut values = actions
        .iter()
        .map(|action| action.as_str().to_owned())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    (!values.is_empty() && values.len() == actions.len()).then_some(values)
}

async fn target_is_protected(
    connection: &mut PgConnection,
    actor_id: Uuid,
    target_id: Uuid,
    board_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let levels = sqlx::query_as::<_, (i16, i16)>(
        "SELECT
             COALESCE(MAX(role.protection_level) FILTER (WHERE assignment.user_id = $1), 0)::smallint,
             COALESCE(MAX(role.protection_level) FILTER (WHERE assignment.user_id = $2), 0)::smallint
         FROM role_assignments AS assignment
         INNER JOIN roles AS role ON role.id = assignment.role_id
         WHERE assignment.user_id IN ($1, $2)
           AND (
               (role.scope IN ('instance', 'site') AND assignment.scope_id IS NULL)
               OR (
                   role.scope = 'board' AND assignment.scope_id IS NOT NULL
                   AND daoyun_board_scope_covers(assignment.scope_id, assignment.scope_mode, $3)
               )
           )",
    )
    .bind(actor_id)
    .bind(target_id)
    .bind(board_id)
    .fetch_one(&mut *connection)
    .await?;
    if levels.0 < levels.1 {
        return Ok(true);
    }
    let target_is_super_admin = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM role_assignments AS assignment
             INNER JOIN roles AS role ON role.id = assignment.role_id
             WHERE assignment.user_id = $1 AND role.key = 'super_admin'
         )",
    )
    .bind(target_id)
    .fetch_one(&mut *connection)
    .await?;
    if !target_is_super_admin {
        return Ok(false);
    }
    let active_super_admins = sqlx::query_scalar::<_, i64>(
        "SELECT count(DISTINCT account.id)
         FROM users AS account
         INNER JOIN role_assignments AS assignment ON assignment.user_id = account.id
         INNER JOIN roles AS role ON role.id = assignment.role_id
         WHERE role.key = 'super_admin' AND account.status <> 'suspended'",
    )
    .fetch_one(connection)
    .await?;
    Ok(active_super_admins <= 1)
}

impl From<sqlx::Error> for BoardUserRestrictionMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl From<OutboxError> for BoardUserRestrictionMutationError {
    fn from(error: OutboxError) -> Self {
        Self::Outbox(error)
    }
}

impl fmt::Display for BoardUserRestrictionMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BoardUnavailable => formatter.write_str("board is unavailable"),
            Self::TargetUnavailable => formatter.write_str("target user is unavailable"),
            Self::Forbidden => formatter.write_str("board restriction is forbidden"),
            Self::ProtectedTarget => formatter.write_str("target user is protected"),
            Self::InvalidInput => formatter.write_str("board restriction input is invalid"),
            Self::RevisionConflict => formatter.write_str("board restriction revision conflicts"),
            Self::Database(_) => formatter.write_str("board restriction database operation failed"),
            Self::Outbox(_) => formatter.write_str("board restriction outbox operation failed"),
        }
    }
}

impl Error for BoardUserRestrictionMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Outbox(error) => Some(error),
            Self::BoardUnavailable
            | Self::TargetUnavailable
            | Self::Forbidden
            | Self::ProtectedTarget
            | Self::InvalidInput
            | Self::RevisionConflict => None,
        }
    }
}
