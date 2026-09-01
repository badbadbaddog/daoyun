use std::{error::Error, fmt};

use serde_json::json;
use sqlx::{Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::governance::ContentReportRecord;
use crate::notifications::insert_notification;
use crate::{Database, DatabaseError, NewOutboxEvent, OutboxError};

#[derive(Debug)]
pub struct UserProfileViewerRecord {
    pub is_self: bool,
    pub is_following: bool,
    pub is_blocked_by_viewer: bool,
    pub can_message: bool,
}

#[derive(Debug)]
pub struct PublicUserProfileRecord {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub bio: String,
    pub location: Option<String>,
    pub website_url: Option<String>,
    pub profile_revision: i32,
    pub created_at: OffsetDateTime,
    pub topic_count: i64,
    pub follower_count: i64,
    pub following_count: i64,
    pub viewer: Option<UserProfileViewerRecord>,
}

#[derive(Debug)]
pub struct UpdateUserProfileRecord {
    pub user_id: Uuid,
    pub base_revision: i32,
    pub display_name: String,
    pub bio: String,
    pub location: Option<String>,
    pub website_url: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug)]
pub struct FollowStateRecord {
    pub user_id: Uuid,
    pub following: bool,
    pub follower_count: i64,
    pub following_count: i64,
}

#[derive(Debug)]
pub struct BlockStateRecord {
    pub user_id: Uuid,
    pub blocked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct PublicUserSummaryRecord {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct AdminUserSummaryRecord {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub primary_role: Option<String>,
    pub topic_count: i64,
    pub post_count: i64,
    pub report_count: i64,
    pub created_at: OffsetDateTime,
    pub last_seen_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct AdminUserRoleRecord {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub scope: String,
    pub is_system: bool,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminUserDetailRecord {
    pub summary: AdminUserSummaryRecord,
    pub bio: String,
    pub location: Option<String>,
    pub website_url: Option<String>,
    pub follower_count: i64,
    pub following_count: i64,
    pub roles: Vec<AdminUserRoleRecord>,
    pub restriction_reason: Option<String>,
    pub restriction_expires_at: Option<OffsetDateTime>,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct AdminUserContentRecord {
    pub id: Uuid,
    pub kind: String,
    pub topic_id: Uuid,
    pub title: Option<String>,
    pub excerpt: String,
    pub status: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateAdminUserStatusRecord {
    pub actor_id: Uuid,
    pub target_user_id: Uuid,
    pub status: String,
    pub reason: String,
    pub expires_at: Option<OffsetDateTime>,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminUserStatusUpdateRecord {
    pub user_id: Uuid,
    pub status: String,
    pub reason: Option<String>,
    pub expires_at: Option<OffsetDateTime>,
    pub revision: i64,
    pub audit_id: Uuid,
    pub actor: PublicUserSummaryRecord,
    pub changed_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserRelationKind {
    Followers,
    Following,
}

#[derive(Debug)]
pub enum UpdateUserProfileError {
    ProfileUnavailable,
    RevisionConflict,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum FollowMutationError {
    SelfFollow,
    TargetUnavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum BlockMutationError {
    SelfBlock,
    TargetUnavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListUserRelationsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum AdminUserReadError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum UpdateAdminUserStatusError {
    Forbidden,
    NotFound,
    Conflict,
    Invalid,
    SelfSuspension,
    LastSuperAdmin,
    Database(DatabaseError),
    Outbox(OutboxError),
}

impl Database {
    pub async fn list_public_users(
        &self,
        viewer_user_id: Option<Uuid>,
        query: &str,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<PublicUserSummaryRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, PublicUserSummaryRecord>(
            "SELECT account.id, account.username, account.display_name, account.avatar_url \
             FROM users AS account \
             WHERE account.status = 'active' \
               AND (POSITION(LOWER($1) IN LOWER(account.username)) > 0 \
                    OR POSITION(LOWER($1) IN LOWER(account.display_name)) > 0) \
               AND ($2::uuid IS NULL OR (account.username, account.id) > ( \
                    SELECT cursor_account.username, cursor_account.id \
                    FROM users AS cursor_account \
                    WHERE cursor_account.id = $2 AND cursor_account.status = 'active' \
                      AND (POSITION(LOWER($1) IN LOWER(cursor_account.username)) > 0 \
                           OR POSITION(LOWER($1) IN LOWER(cursor_account.display_name)) > 0) \
               )) \
               AND ($3::uuid IS NULL OR account.id = $3 OR NOT EXISTS ( \
                    SELECT 1 FROM user_blocks AS block \
                    WHERE (block.blocker_id = $3 AND block.blocked_id = account.id) \
                       OR (block.blocker_id = account.id AND block.blocked_id = $3) \
               )) \
             ORDER BY account.username, account.id \
             LIMIT $4",
        )
        .bind(query)
        .bind(cursor)
        .bind(viewer_user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn active_user_exists(&self, user_id: Uuid) -> Result<bool, DatabaseError> {
        Ok(sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND status = 'active')",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn admin_user_exists(&self, user_id: Uuid) -> Result<bool, DatabaseError> {
        Ok(
            sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)")
                .bind(user_id)
                .fetch_one(&self.pool)
                .await?,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn list_admin_users(
        &self,
        query: Option<&str>,
        status: Option<&str>,
        role_id: Option<Uuid>,
        registered_after: Option<OffsetDateTime>,
        registered_before: Option<OffsetDateTime>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<AdminUserSummaryRecord>, AdminUserReadError> {
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                    SELECT 1 FROM users AS u
                    WHERE u.id = $6
                      AND ($1::text IS NULL OR u.id::text = $1 OR u.username ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
                      AND ($2::text IS NULL OR u.status = $2)
                      AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM role_assignments AS ra WHERE ra.user_id = u.id AND ra.role_id = $3))
                      AND ($4::timestamptz IS NULL OR u.created_at >= $4)
                      AND ($5::timestamptz IS NULL OR u.created_at < $5)
                )",
            )
            .bind(query)
            .bind(status)
            .bind(role_id)
            .bind(registered_after)
            .bind(registered_before)
            .bind(cursor)
            .fetch_one(&self.pool)
            .await?;
            if !valid {
                return Err(AdminUserReadError::InvalidCursor);
            }
        }

        Ok(sqlx::query_as::<_, AdminUserSummaryRecord>(
            "SELECT u.id, u.username, u.display_name, u.avatar_url, u.status,
                    (SELECT r.name FROM role_assignments AS ra INNER JOIN roles AS r ON r.id = ra.role_id
                     WHERE ra.user_id = u.id ORDER BY r.is_system DESC, ra.created_at ASC, ra.id ASC LIMIT 1) AS primary_role,
                    (SELECT COUNT(*) FROM topics AS t WHERE t.author_id = u.id AND t.deleted_at IS NULL) AS topic_count,
                    (SELECT COUNT(*) FROM posts AS p WHERE p.author_id = u.id AND p.kind = 'reply' AND p.deleted_at IS NULL) AS post_count,
                    (SELECT COUNT(*) FROM content_reports AS cr
                     LEFT JOIN topics AS rt ON cr.target_type = 'topic' AND rt.id = cr.target_id
                     LEFT JOIN posts AS rp ON cr.target_type = 'post' AND rp.id = cr.target_id
                     WHERE cr.reporter_id = u.id OR COALESCE(rt.author_id, rp.author_id) = u.id) AS report_count,
                    u.created_at,
                    (SELECT MAX(s.last_seen_at) FROM sessions AS s WHERE s.user_id = u.id) AS last_seen_at
             FROM users AS u
             WHERE ($1::text IS NULL OR u.id::text = $1 OR u.username ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
               AND ($2::text IS NULL OR u.status = $2)
               AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM role_assignments AS ra WHERE ra.user_id = u.id AND ra.role_id = $3))
               AND ($4::timestamptz IS NULL OR u.created_at >= $4)
               AND ($5::timestamptz IS NULL OR u.created_at < $5)
               AND ($6::uuid IS NULL OR (u.created_at, u.id) < (SELECT created_at, id FROM users WHERE id = $6))
             ORDER BY u.created_at DESC, u.id DESC
             LIMIT $7",
        )
        .bind(query)
        .bind(status)
        .bind(role_id)
        .bind(registered_after)
        .bind(registered_before)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn admin_user_detail(
        &self,
        user_id: Uuid,
    ) -> Result<Option<AdminUserDetailRecord>, DatabaseError> {
        #[derive(sqlx::FromRow)]
        struct DetailRow {
            id: Uuid,
            username: String,
            display_name: String,
            avatar_url: Option<String>,
            status: String,
            primary_role: Option<String>,
            topic_count: i64,
            post_count: i64,
            report_count: i64,
            created_at: OffsetDateTime,
            last_seen_at: Option<OffsetDateTime>,
            bio: String,
            location: Option<String>,
            website_url: Option<String>,
            follower_count: i64,
            following_count: i64,
            restriction_reason: Option<String>,
            restriction_expires_at: Option<OffsetDateTime>,
            revision: i64,
        }
        let row = sqlx::query_as::<_, DetailRow>(
            "SELECT u.id, u.username, u.display_name, u.avatar_url, u.status,
                    (SELECT r.name FROM role_assignments AS ra INNER JOIN roles AS r ON r.id = ra.role_id
                     WHERE ra.user_id = u.id ORDER BY r.is_system DESC, ra.created_at ASC, ra.id ASC LIMIT 1) AS primary_role,
                    (SELECT COUNT(*) FROM topics AS t WHERE t.author_id = u.id AND t.deleted_at IS NULL) AS topic_count,
                    (SELECT COUNT(*) FROM posts AS p WHERE p.author_id = u.id AND p.kind = 'reply' AND p.deleted_at IS NULL) AS post_count,
                    (SELECT COUNT(*) FROM content_reports AS cr
                     LEFT JOIN topics AS rt ON cr.target_type = 'topic' AND rt.id = cr.target_id
                     LEFT JOIN posts AS rp ON cr.target_type = 'post' AND rp.id = cr.target_id
                     WHERE cr.reporter_id = u.id OR COALESCE(rt.author_id, rp.author_id) = u.id) AS report_count,
                    u.created_at, (SELECT MAX(s.last_seen_at) FROM sessions AS s WHERE s.user_id = u.id) AS last_seen_at,
                    u.bio, u.location, u.website_url, u.follower_count, u.following_count,
                    u.restriction_reason, u.restriction_expires_at, u.admin_revision AS revision
             FROM users AS u WHERE u.id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        let roles = sqlx::query_as::<_, AdminUserRoleRecord>(
            "SELECT r.id, r.key, r.name, r.scope, r.is_system, r.revision
             FROM role_assignments AS ra INNER JOIN roles AS r ON r.id = ra.role_id
             WHERE ra.user_id = $1 ORDER BY r.is_system DESC, r.name ASC, r.id ASC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(Some(AdminUserDetailRecord {
            summary: AdminUserSummaryRecord {
                id: row.id,
                username: row.username,
                display_name: row.display_name,
                avatar_url: row.avatar_url,
                status: row.status,
                primary_role: row.primary_role,
                topic_count: row.topic_count,
                post_count: row.post_count,
                report_count: row.report_count,
                created_at: row.created_at,
                last_seen_at: row.last_seen_at,
            },
            bio: row.bio,
            location: row.location,
            website_url: row.website_url,
            follower_count: row.follower_count,
            following_count: row.following_count,
            roles,
            restriction_reason: row.restriction_reason,
            restriction_expires_at: row.restriction_expires_at,
            revision: row.revision,
        }))
    }

    pub async fn update_admin_user_status(
        &self,
        input: UpdateAdminUserStatusRecord,
    ) -> Result<AdminUserStatusUpdateRecord, UpdateAdminUserStatusError> {
        let status = input.status.trim();
        if !matches!(status, "active" | "restricted" | "suspended") || input.expected_revision < 1 {
            return Err(UpdateAdminUserStatusError::Invalid);
        }
        let reason = input.reason.trim();
        let restriction_reason = if status == "active" {
            if input.expires_at.is_some() {
                return Err(UpdateAdminUserStatusError::Invalid);
            }
            None
        } else {
            let reason_length = reason.chars().count();
            if !(2..=500).contains(&reason_length)
                || input
                    .expires_at
                    .is_some_and(|expires_at| expires_at <= OffsetDateTime::now_utc())
            {
                return Err(UpdateAdminUserStatusError::Invalid);
            }
            Some(reason.to_owned())
        };

        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
            .bind(input.actor_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(UpdateAdminUserStatusError::Forbidden)?;
        if !has_permission_with_executor(
            &mut transaction,
            input.actor_id,
            permission_keys::ADMIN_USERS_MODERATE,
            None,
        )
        .await?
        {
            return Err(UpdateAdminUserStatusError::Forbidden);
        }

        #[derive(sqlx::FromRow)]
        struct CurrentStatusRow {
            status: String,
            admin_revision: i64,
        }
        let current = sqlx::query_as::<_, CurrentStatusRow>(
            "SELECT status, admin_revision FROM users WHERE id = $1 FOR UPDATE",
        )
        .bind(input.target_user_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(UpdateAdminUserStatusError::NotFound)?;
        if current.admin_revision != input.expected_revision {
            return Err(UpdateAdminUserStatusError::Conflict);
        }
        if status == "suspended" && input.actor_id == input.target_user_id {
            return Err(UpdateAdminUserStatusError::SelfSuspension);
        }

        if current.status == "active" && status != "active" {
            sqlx::query("SELECT id FROM roles WHERE key = 'super_admin' FOR UPDATE")
                .fetch_optional(&mut *transaction)
                .await?;
            let target_is_super_admin = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                    SELECT 1 FROM role_assignments AS assignment
                    INNER JOIN roles AS role ON role.id = assignment.role_id
                    WHERE assignment.user_id = $1 AND assignment.scope_id IS NULL
                      AND role.key = 'super_admin'
                )",
            )
            .bind(input.target_user_id)
            .fetch_one(&mut *transaction)
            .await?;
            if target_is_super_admin {
                let active_super_admins = sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(DISTINCT account.id)
                     FROM users AS account
                     INNER JOIN role_assignments AS assignment ON assignment.user_id = account.id
                     INNER JOIN roles AS role ON role.id = assignment.role_id
                     WHERE account.status = 'active' AND assignment.scope_id IS NULL
                       AND role.key = 'super_admin'",
                )
                .fetch_one(&mut *transaction)
                .await?;
                if active_super_admins <= 1 {
                    return Err(UpdateAdminUserStatusError::LastSuperAdmin);
                }
            }
        }

        #[derive(sqlx::FromRow)]
        struct UpdatedStatusRow {
            status: String,
            restriction_reason: Option<String>,
            restriction_expires_at: Option<OffsetDateTime>,
            admin_revision: i64,
            updated_at: OffsetDateTime,
        }
        let updated = sqlx::query_as::<_, UpdatedStatusRow>(
            "UPDATE users
             SET status = $2, restriction_reason = $3, restriction_expires_at = $4,
                 admin_revision = admin_revision + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING status, restriction_reason, restriction_expires_at,
                       admin_revision, updated_at",
        )
        .bind(input.target_user_id)
        .bind(status)
        .bind(&restriction_reason)
        .bind(if status == "active" {
            None
        } else {
            input.expires_at
        })
        .fetch_one(&mut *transaction)
        .await?;
        let audit_id = insert_audit(
            &mut transaction,
            input.actor_id,
            "user.status.update",
            "user",
            Some(input.target_user_id),
            json!({
                "old_status": current.status,
                "new_status": updated.status,
                "reason": updated.restriction_reason,
                "expires_at": updated.restriction_expires_at.map(|value| value.to_string()),
                "revision": updated.admin_revision,
            }),
        )
        .await?;
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "user.status_changed".to_owned(),
                aggregate_type: "user".to_owned(),
                aggregate_id: input.target_user_id,
                dedupe_key: format!(
                    "user-status:{}:{}",
                    input.target_user_id, updated.admin_revision
                ),
                payload: json!({
                    "user_id": input.target_user_id,
                    "status": updated.status,
                    "reason": updated.restriction_reason,
                    "expires_at": updated.restriction_expires_at.map(|value| value.to_string()),
                    "revision": updated.admin_revision,
                    "audit_id": audit_id,
                }),
                max_attempts: 8,
            },
        )
        .await
        .map_err(UpdateAdminUserStatusError::Outbox)?;
        let actor = sqlx::query_as::<_, PublicUserSummaryRecord>(
            "SELECT id, username, display_name, avatar_url FROM users WHERE id = $1",
        )
        .bind(input.actor_id)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;

        Ok(AdminUserStatusUpdateRecord {
            user_id: input.target_user_id,
            status: updated.status,
            reason: updated.restriction_reason,
            expires_at: updated.restriction_expires_at,
            revision: updated.admin_revision,
            audit_id,
            actor,
            changed_at: updated.updated_at,
        })
    }

    pub async fn expire_admin_user_statuses(&self, limit: i64) -> Result<usize, DatabaseError> {
        if !(1..=500).contains(&limit) {
            return Err(DatabaseError::MigrationState);
        }

        #[derive(sqlx::FromRow)]
        struct ExpiredStatusRow {
            id: Uuid,
            status: String,
            admin_revision: i64,
            actor_id: Uuid,
        }

        let mut transaction = self.pool.begin().await?;
        let expired = sqlx::query_as::<_, ExpiredStatusRow>(
            "SELECT account.id, account.status, account.admin_revision,
                    COALESCE((
                        SELECT audit.actor_id
                        FROM admin_audit_log AS audit
                        WHERE audit.resource_type = 'user'
                          AND audit.resource_id = account.id
                          AND audit.action = 'user.status.update'
                        ORDER BY audit.created_at DESC, audit.id DESC
                        LIMIT 1
                    ), account.id) AS actor_id
             FROM users AS account
             WHERE account.status IN ('restricted', 'suspended')
               AND account.restriction_expires_at <= CURRENT_TIMESTAMP
             ORDER BY account.restriction_expires_at, account.id
             LIMIT $1
             FOR UPDATE OF account SKIP LOCKED",
        )
        .bind(limit)
        .fetch_all(&mut *transaction)
        .await?;

        for account in &expired {
            let revision = account.admin_revision + 1;
            sqlx::query(
                "UPDATE users
                 SET status = 'active', restriction_reason = NULL,
                     restriction_expires_at = NULL, admin_revision = $2,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1",
            )
            .bind(account.id)
            .bind(revision)
            .execute(&mut *transaction)
            .await?;
            let audit_id = insert_audit(
                &mut transaction,
                account.actor_id,
                "user.status.expire",
                "user",
                Some(account.id),
                json!({
                    "old_status": account.status,
                    "new_status": "active",
                    "reason": "restriction_expired",
                    "revision": revision,
                }),
            )
            .await?;
            self.enqueue_outbox_event_in_transaction(
                &mut transaction,
                NewOutboxEvent {
                    id: Uuid::now_v7(),
                    event_type: "user.status_changed".to_owned(),
                    aggregate_type: "user".to_owned(),
                    aggregate_id: account.id,
                    dedupe_key: format!("user-status:{}:{}", account.id, revision),
                    payload: json!({
                        "user_id": account.id,
                        "status": "active",
                        "reason": "restriction_expired",
                        "expires_at": null,
                        "revision": revision,
                        "audit_id": audit_id,
                    }),
                    max_attempts: 8,
                },
            )
            .await
            .map_err(|error| match error {
                OutboxError::Database(error) => error,
                OutboxError::InvalidInput | OutboxError::IdempotencyConflict => {
                    DatabaseError::MigrationState
                }
            })?;
        }
        transaction.commit().await?;
        Ok(expired.len())
    }

    pub async fn list_admin_user_content(
        &self,
        user_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<AdminUserContentRecord>, AdminUserReadError> {
        let cursor_time = if let Some(cursor) = cursor {
            sqlx::query_scalar::<_, OffsetDateTime>(
                "SELECT created_at FROM topics WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL
                 UNION ALL
                 SELECT created_at FROM posts WHERE id = $1 AND author_id = $2 AND kind = 'reply' AND deleted_at IS NULL",
            )
            .bind(cursor)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AdminUserReadError::InvalidCursor)?
            .into()
        } else {
            None
        };
        Ok(sqlx::query_as::<_, AdminUserContentRecord>(
            "SELECT content.id, content.kind, content.topic_id, content.title, content.excerpt, content.status, content.created_at
             FROM (
                 SELECT t.id, 'topic'::text AS kind, t.id AS topic_id, t.title AS title,
                        t.excerpt, t.status, t.created_at
                 FROM topics AS t WHERE t.author_id = $1 AND t.deleted_at IS NULL
                 UNION ALL
                 SELECT p.id, 'reply'::text AS kind, p.topic_id, t.title AS title,
                        LEFT(p.content, 500) AS excerpt, p.status, p.created_at
                 FROM posts AS p INNER JOIN topics AS t ON t.id = p.topic_id
                 WHERE p.author_id = $1 AND p.kind = 'reply' AND p.deleted_at IS NULL
             ) AS content
             WHERE ($2::timestamptz IS NULL OR (content.created_at, content.id) < ($2, $3))
             ORDER BY content.created_at DESC, content.id DESC LIMIT $4",
        )
        .bind(user_id)
        .bind(cursor_time)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_admin_user_reports(
        &self,
        user_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<ContentReportRecord>, AdminUserReadError> {
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM content_reports AS r
                 LEFT JOIN topics AS t ON r.target_type = 'topic' AND t.id = r.target_id
                 LEFT JOIN posts AS p ON r.target_type = 'post' AND p.id = r.target_id
                 WHERE r.id = $1 AND (r.reporter_id = $2 OR COALESCE(t.author_id, p.author_id) = $2))",
            ).bind(cursor).bind(user_id).fetch_one(&self.pool).await?;
            if !valid {
                return Err(AdminUserReadError::InvalidCursor);
            }
        }
        Ok(sqlx::query_as::<_, ContentReportRecord>(
            "SELECT r.id, r.target_type, r.target_id,
                    CASE WHEN r.target_type = 'topic' THEN topic_target.id ELSE post_topic.id END AS target_topic_id,
                    CASE WHEN r.target_type = 'topic' THEN topic_target.title ELSE post_topic.title END AS target_title,
                    COALESCE(topic_target.author_id, post_target.author_id) AS target_author_id,
                    target_author.username AS target_author_username, target_author.display_name AS target_author_display_name,
                    target_author.avatar_url AS target_author_avatar_url,
                    reporter.id AS reporter_id, reporter.username AS reporter_username,
                    reporter.display_name AS reporter_display_name, reporter.avatar_url AS reporter_avatar_url,
                    r.reason, r.details, r.status, r.resolution, r.resolution_note,
                    reviewer.id AS reviewer_id, reviewer.username AS reviewer_username,
                    reviewer.display_name AS reviewer_display_name, reviewer.avatar_url AS reviewer_avatar_url,
                    r.created_at, r.updated_at, r.resolved_at, r.revision
             FROM content_reports AS r
             INNER JOIN users AS reporter ON reporter.id = r.reporter_id
             LEFT JOIN topics AS topic_target ON r.target_type = 'topic' AND topic_target.id = r.target_id
             LEFT JOIN posts AS post_target ON r.target_type = 'post' AND post_target.id = r.target_id
             LEFT JOIN topics AS post_topic ON post_topic.id = post_target.topic_id
             LEFT JOIN users AS target_author ON target_author.id = COALESCE(topic_target.author_id, post_target.author_id)
             LEFT JOIN users AS reviewer ON reviewer.id = r.reviewer_id
             WHERE (r.reporter_id = $1 OR COALESCE(topic_target.author_id, post_target.author_id) = $1)
               AND ($2::uuid IS NULL OR (r.created_at, r.id) < (SELECT created_at, id FROM content_reports WHERE id = $2))
             ORDER BY r.created_at DESC, r.id DESC LIMIT $3",
        ).bind(user_id).bind(cursor).bind(limit).fetch_all(&self.pool).await?)
    }

    pub async fn user_id_by_username(&self, username: &str) -> Result<Option<Uuid>, DatabaseError> {
        Ok(sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE username = $1 AND status = 'active'",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn public_user_profile(
        &self,
        username: &str,
        viewer_id: Option<Uuid>,
    ) -> Result<Option<PublicUserProfileRecord>, DatabaseError> {
        let row = sqlx::query_as::<_, UserProfileRow>(
            "SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.location, \
                    u.website_url, u.profile_revision, u.created_at, u.follower_count, \
                    u.following_count, \
                    (SELECT COUNT(*) FROM topics AS t \
                     INNER JOIN boards AS b ON b.id = t.board_id \
                     WHERE t.author_id = u.id AND t.status = 'published' \
                       AND t.deleted_at IS NULL AND b.visibility = 'public' \
                       AND b.deleted_at IS NULL) AS topic_count, \
                    ($2::uuid IS NOT NULL) AS has_viewer, \
                    COALESCE($2 = u.id, FALSE) AS is_self, \
                    CASE WHEN $2::uuid IS NULL THEN FALSE ELSE EXISTS (\
                        SELECT 1 FROM user_follows AS f \
                        WHERE f.follower_id = $2 AND f.followed_id = u.id\
                    ) END AS is_following, \
                    CASE WHEN $2::uuid IS NULL THEN FALSE ELSE EXISTS (\
                        SELECT 1 FROM user_blocks AS bl \
                        WHERE bl.blocker_id = $2 AND bl.blocked_id = u.id\
                    ) END AS is_blocked_by_viewer, \
                    CASE WHEN $2::uuid IS NULL OR $2 = u.id THEN FALSE ELSE NOT EXISTS (\
                        SELECT 1 FROM user_blocks AS bl \
                        WHERE (bl.blocker_id = $2 AND bl.blocked_id = u.id) \
                           OR (bl.blocker_id = u.id AND bl.blocked_id = $2)\
                    ) END AS can_message \
             FROM users AS u \
             WHERE u.username = $1 AND u.status = 'active'",
        )
        .bind(username)
        .bind(viewer_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(PublicUserProfileRecord::from))
    }

    pub async fn update_user_profile(
        &self,
        input: UpdateUserProfileRecord,
    ) -> Result<i32, UpdateUserProfileError> {
        let mut transaction = self.pool.begin().await?;
        let current_revision = sqlx::query_scalar::<_, i32>(
            "SELECT profile_revision FROM users \
             WHERE id = $1 AND status = 'active' FOR UPDATE",
        )
        .bind(input.user_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(current_revision) = current_revision else {
            return Err(UpdateUserProfileError::ProfileUnavailable);
        };
        if current_revision != input.base_revision {
            return Err(UpdateUserProfileError::RevisionConflict);
        }

        let next_revision = current_revision + 1;
        let updated_revision = sqlx::query_scalar::<_, i32>(
            "UPDATE users SET display_name = $2, bio = $3, location = $4, \
                 website_url = $5, avatar_url = $6, profile_revision = $7, \
                 updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND status = 'active' \
             RETURNING profile_revision",
        )
        .bind(input.user_id)
        .bind(input.display_name)
        .bind(input.bio)
        .bind(input.location)
        .bind(input.website_url)
        .bind(input.avatar_url)
        .bind(next_revision)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(UpdateUserProfileError::ProfileUnavailable)?;
        insert_audit(
            &mut transaction,
            input.user_id,
            "user.profile.update",
            "user",
            Some(input.user_id),
            json!({"revision": updated_revision}),
        )
        .await?;
        transaction.commit().await?;
        Ok(updated_revision)
    }

    pub async fn set_user_following(
        &self,
        follower_id: Uuid,
        followed_id: Uuid,
        following: bool,
    ) -> Result<FollowStateRecord, FollowMutationError> {
        if follower_id == followed_id {
            return Err(FollowMutationError::SelfFollow);
        }
        let mut transaction = self.pool.begin().await?;
        if !lock_active_user_pair(&mut transaction, follower_id, followed_id).await? {
            return Err(FollowMutationError::TargetUnavailable);
        }
        let blocked = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (\
                 SELECT 1 FROM user_blocks \
                 WHERE (blocker_id = $1 AND blocked_id = $2) \
                    OR (blocker_id = $2 AND blocked_id = $1)\
             )",
        )
        .bind(follower_id)
        .bind(followed_id)
        .fetch_one(&mut *transaction)
        .await?;
        if blocked {
            return Err(FollowMutationError::TargetUnavailable);
        }

        let edge_changed = if following {
            sqlx::query(
                "INSERT INTO user_follows (follower_id, followed_id) VALUES ($1, $2) \
                 ON CONFLICT (follower_id, followed_id) DO NOTHING",
            )
            .bind(follower_id)
            .bind(followed_id)
            .execute(&mut *transaction)
            .await?
            .rows_affected()
                == 1
        } else {
            sqlx::query("DELETE FROM user_follows WHERE follower_id = $1 AND followed_id = $2")
                .bind(follower_id)
                .bind(followed_id)
                .execute(&mut *transaction)
                .await?
                .rows_affected()
                == 1
        };
        if following && edge_changed {
            insert_notification(
                &mut transaction,
                Uuid::now_v7(),
                followed_id,
                Some(follower_id),
                "follow",
                "user",
                followed_id,
                &format!("follow:{follower_id}"),
            )
            .await?;
        }
        recompute_relationship_counts(&mut transaction, follower_id, followed_id).await?;
        let (follower_count, following_count) = sqlx::query_as::<_, (i64, i64)>(
            "SELECT followed.follower_count, follower.following_count \
             FROM users AS followed CROSS JOIN users AS follower \
             WHERE followed.id = $1 AND follower.id = $2",
        )
        .bind(followed_id)
        .bind(follower_id)
        .fetch_one(&mut *transaction)
        .await?;
        if edge_changed {
            insert_audit(
                &mut transaction,
                follower_id,
                if following {
                    "user.follow"
                } else {
                    "user.unfollow"
                },
                "user",
                Some(followed_id),
                json!({}),
            )
            .await?;
        }
        transaction.commit().await?;

        Ok(FollowStateRecord {
            user_id: followed_id,
            following,
            follower_count,
            following_count,
        })
    }

    pub async fn set_user_blocked(
        &self,
        blocker_id: Uuid,
        blocked_id: Uuid,
        blocked: bool,
    ) -> Result<BlockStateRecord, BlockMutationError> {
        if blocker_id == blocked_id {
            return Err(BlockMutationError::SelfBlock);
        }
        let mut transaction = self.pool.begin().await?;
        if !lock_active_user_pair(&mut transaction, blocker_id, blocked_id).await? {
            return Err(BlockMutationError::TargetUnavailable);
        }

        let edge_changed = if blocked {
            let edge_changed = sqlx::query(
                "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) \
                 ON CONFLICT (blocker_id, blocked_id) DO NOTHING",
            )
            .bind(blocker_id)
            .bind(blocked_id)
            .execute(&mut *transaction)
            .await?
            .rows_affected()
                == 1;
            sqlx::query(
                "DELETE FROM user_follows \
                 WHERE (follower_id = $1 AND followed_id = $2) \
                    OR (follower_id = $2 AND followed_id = $1)",
            )
            .bind(blocker_id)
            .bind(blocked_id)
            .execute(&mut *transaction)
            .await?;
            recompute_relationship_counts(&mut transaction, blocker_id, blocked_id).await?;
            edge_changed
        } else {
            sqlx::query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2")
                .bind(blocker_id)
                .bind(blocked_id)
                .execute(&mut *transaction)
                .await?
                .rows_affected()
                == 1
        };
        if edge_changed {
            insert_audit(
                &mut transaction,
                blocker_id,
                if blocked {
                    "user.block"
                } else {
                    "user.unblock"
                },
                "user",
                Some(blocked_id),
                json!({}),
            )
            .await?;
        }
        transaction.commit().await?;

        Ok(BlockStateRecord {
            user_id: blocked_id,
            blocked,
        })
    }

    pub async fn list_user_relations(
        &self,
        username: &str,
        kind: UserRelationKind,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Option<Vec<PublicUserSummaryRecord>>, ListUserRelationsError> {
        let owner_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE username = $1 AND status = 'active'",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;
        let Some(owner_id) = owner_id else {
            return Ok(None);
        };

        if let Some(cursor) = cursor {
            let cursor_is_valid = match kind {
                UserRelationKind::Followers => {
                    sqlx::query_scalar::<_, bool>(
                        "SELECT EXISTS (\
                         SELECT 1 FROM user_follows AS f \
                         INNER JOIN users AS related ON related.id = f.follower_id \
                         WHERE f.followed_id = $1 AND related.id = $2 \
                           AND related.status = 'active'\
                     )",
                    )
                    .bind(owner_id)
                    .bind(cursor)
                    .fetch_one(&self.pool)
                    .await?
                }
                UserRelationKind::Following => {
                    sqlx::query_scalar::<_, bool>(
                        "SELECT EXISTS (\
                         SELECT 1 FROM user_follows AS f \
                         INNER JOIN users AS related ON related.id = f.followed_id \
                         WHERE f.follower_id = $1 AND related.id = $2 \
                           AND related.status = 'active'\
                     )",
                    )
                    .bind(owner_id)
                    .bind(cursor)
                    .fetch_one(&self.pool)
                    .await?
                }
            };
            if !cursor_is_valid {
                return Err(ListUserRelationsError::InvalidCursor);
            }
        }

        let records = match kind {
            UserRelationKind::Followers => sqlx::query_as::<_, PublicUserSummaryRecord>(
                "SELECT related.id, related.username, related.display_name, related.avatar_url \
                 FROM user_follows AS f \
                 INNER JOIN users AS related ON related.id = f.follower_id \
                 WHERE f.followed_id = $1 AND related.status = 'active' \
                   AND ($2::uuid IS NULL OR (f.created_at, related.id) < (\
                       SELECT cursor_follow.created_at, cursor_user.id \
                       FROM user_follows AS cursor_follow \
                       INNER JOIN users AS cursor_user ON cursor_user.id = cursor_follow.follower_id \
                       WHERE cursor_follow.followed_id = $1 AND cursor_user.id = $2\
                   )) \
                 ORDER BY f.created_at DESC, related.id DESC LIMIT $3",
            )
            .bind(owner_id)
            .bind(cursor)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?,
            UserRelationKind::Following => sqlx::query_as::<_, PublicUserSummaryRecord>(
                "SELECT related.id, related.username, related.display_name, related.avatar_url \
                 FROM user_follows AS f \
                 INNER JOIN users AS related ON related.id = f.followed_id \
                 WHERE f.follower_id = $1 AND related.status = 'active' \
                   AND ($2::uuid IS NULL OR (f.created_at, related.id) < (\
                       SELECT cursor_follow.created_at, cursor_user.id \
                       FROM user_follows AS cursor_follow \
                       INNER JOIN users AS cursor_user ON cursor_user.id = cursor_follow.followed_id \
                       WHERE cursor_follow.follower_id = $1 AND cursor_user.id = $2\
                   )) \
                 ORDER BY f.created_at DESC, related.id DESC LIMIT $3",
            )
            .bind(owner_id)
            .bind(cursor)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?,
        };
        Ok(Some(records))
    }
}

#[derive(Debug, sqlx::FromRow)]
struct UserProfileRow {
    id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    bio: String,
    location: Option<String>,
    website_url: Option<String>,
    profile_revision: i32,
    created_at: OffsetDateTime,
    topic_count: i64,
    follower_count: i64,
    following_count: i64,
    has_viewer: bool,
    is_self: bool,
    is_following: bool,
    is_blocked_by_viewer: bool,
    can_message: bool,
}

impl From<UserProfileRow> for PublicUserProfileRecord {
    fn from(row: UserProfileRow) -> Self {
        let viewer = row.has_viewer.then_some(UserProfileViewerRecord {
            is_self: row.is_self,
            is_following: row.is_following,
            is_blocked_by_viewer: row.is_blocked_by_viewer,
            can_message: row.can_message,
        });
        Self {
            id: row.id,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            bio: row.bio,
            location: row.location,
            website_url: row.website_url,
            profile_revision: row.profile_revision,
            created_at: row.created_at,
            topic_count: row.topic_count,
            follower_count: row.follower_count,
            following_count: row.following_count,
            viewer,
        }
    }
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

async fn recompute_relationship_counts(
    transaction: &mut Transaction<'_, Postgres>,
    first: Uuid,
    second: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE users AS u SET \
             follower_count = (SELECT COUNT(*) FROM user_follows WHERE followed_id = u.id), \
             following_count = (SELECT COUNT(*) FROM user_follows WHERE follower_id = u.id), \
             updated_at = CURRENT_TIMESTAMP \
         WHERE u.id = $1 OR u.id = $2",
    )
    .bind(first)
    .bind(second)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

impl fmt::Display for UpdateUserProfileError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProfileUnavailable => formatter.write_str("user profile is unavailable"),
            Self::RevisionConflict => formatter.write_str("user profile revision is stale"),
            Self::Database(_) => formatter.write_str("user profile database operation failed"),
        }
    }
}

impl Error for UpdateUserProfileError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::ProfileUnavailable | Self::RevisionConflict => None,
        }
    }
}

impl fmt::Display for FollowMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SelfFollow => formatter.write_str("users cannot follow themselves"),
            Self::TargetUnavailable => formatter.write_str("follow target is unavailable"),
            Self::Database(_) => formatter.write_str("follow database operation failed"),
        }
    }
}

impl Error for FollowMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::SelfFollow | Self::TargetUnavailable => None,
        }
    }
}

impl fmt::Display for BlockMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SelfBlock => formatter.write_str("users cannot block themselves"),
            Self::TargetUnavailable => formatter.write_str("block target is unavailable"),
            Self::Database(_) => formatter.write_str("block database operation failed"),
        }
    }
}

impl Error for BlockMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::SelfBlock | Self::TargetUnavailable => None,
        }
    }
}

impl fmt::Display for ListUserRelationsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCursor => formatter.write_str("user relation cursor is invalid"),
            Self::Database(_) => formatter.write_str("user relation database operation failed"),
        }
    }
}

impl Error for ListUserRelationsError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::InvalidCursor => None,
        }
    }
}

impl fmt::Display for AdminUserReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCursor => formatter.write_str("admin user cursor is invalid"),
            Self::Database(_) => formatter.write_str("admin user database operation failed"),
        }
    }
}

impl Error for AdminUserReadError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::InvalidCursor => None,
        }
    }
}

impl fmt::Display for UpdateAdminUserStatusError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("admin user status update is forbidden"),
            Self::NotFound => formatter.write_str("admin user is unavailable"),
            Self::Conflict => formatter.write_str("admin user status revision is stale"),
            Self::Invalid => formatter.write_str("admin user status input is invalid"),
            Self::SelfSuspension => formatter.write_str("self suspension is forbidden"),
            Self::LastSuperAdmin => {
                formatter.write_str("last active super administrator is protected")
            }
            Self::Database(_) => formatter.write_str("admin user status database operation failed"),
            Self::Outbox(_) => formatter.write_str("admin user status event could not be queued"),
        }
    }
}

impl Error for UpdateAdminUserStatusError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Outbox(error) => Some(error),
            Self::Forbidden
            | Self::NotFound
            | Self::Conflict
            | Self::Invalid
            | Self::SelfSuspension
            | Self::LastSuperAdmin => None,
        }
    }
}

impl From<sqlx::Error> for UpdateUserProfileError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for FollowMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for BlockMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for ListUserRelationsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for AdminUserReadError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for UpdateAdminUserStatusError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}
