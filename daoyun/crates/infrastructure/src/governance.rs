use std::{error::Error, fmt};

use serde_json::json;
use sqlx::{FromRow, Postgres, Transaction, postgres::PgConnection};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::{Database, DatabaseError, NewOutboxEvent, OutboxError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewContentReportRecord {
    pub id: Uuid,
    pub target_type: String,
    pub target_id: Uuid,
    pub reason: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContentReportCreationRecord {
    pub id: Uuid,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct ContentReportRecord {
    pub id: Uuid,
    pub target_type: String,
    pub target_id: Uuid,
    pub target_topic_id: Option<Uuid>,
    pub target_title: Option<String>,
    pub target_author_id: Option<Uuid>,
    pub target_author_username: Option<String>,
    pub target_author_display_name: Option<String>,
    pub target_author_avatar_url: Option<String>,
    pub reporter_id: Uuid,
    pub reporter_username: String,
    pub reporter_display_name: String,
    pub reporter_avatar_url: Option<String>,
    pub reason: String,
    pub details: Option<String>,
    pub status: String,
    pub resolution: String,
    pub resolution_note: Option<String>,
    pub reviewer_id: Option<Uuid>,
    pub reviewer_username: Option<String>,
    pub reviewer_display_name: Option<String>,
    pub reviewer_avatar_url: Option<String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub resolved_at: Option<OffsetDateTime>,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct ReportContextItemRecord {
    pub id: Uuid,
    pub author_id: Option<Uuid>,
    pub author_username: Option<String>,
    pub author_display_name: Option<String>,
    pub author_avatar_url: Option<String>,
    pub content: String,
    pub status: String,
    pub is_target: bool,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportContentContextRecord {
    pub topic_id: Uuid,
    pub title: String,
    pub items: Vec<ReportContextItemRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct ReportAuthorContextRecord {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub report_count: i64,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct ReportHistoryItemRecord {
    pub id: Uuid,
    pub reason: String,
    pub status: String,
    pub resolution: String,
    pub created_at: OffsetDateTime,
    pub resolved_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct ReportHandlingRecordRecord {
    pub id: Uuid,
    pub action: String,
    pub actor_id: Uuid,
    pub actor_username: String,
    pub actor_display_name: String,
    pub actor_avatar_url: Option<String>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentReportDetailRecord {
    pub report: ContentReportRecord,
    pub context: ReportContentContextRecord,
    pub author: Option<ReportAuthorContextRecord>,
    pub related_reports: Vec<ReportHistoryItemRecord>,
    pub handling_history: Vec<ReportHandlingRecordRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateContentReportRecord {
    pub report_id: Uuid,
    pub status: &'static str,
    pub resolution: &'static str,
    pub reviewer_id: Uuid,
    pub note: Option<String>,
    pub expected_revision: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModerateReportUserRecord {
    pub status: &'static str,
    pub reason: String,
    pub expires_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModerateContentReportRecord {
    pub report_id: Uuid,
    pub reviewer_id: Uuid,
    pub disposition: &'static str,
    pub content_action: &'static str,
    pub user_action: Option<ModerateReportUserRecord>,
    pub public_reason: Option<String>,
    pub note: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportModerationUserResultRecord {
    pub user_id: Uuid,
    pub status: String,
    pub reason: String,
    pub expires_at: Option<OffsetDateTime>,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportModerationResultRecord {
    pub report: ContentReportRecord,
    pub content_action: String,
    pub target_id: Uuid,
    pub content_changed: bool,
    pub user: Option<ReportModerationUserResultRecord>,
    pub audit_id: Uuid,
    pub notification_queued: bool,
}

#[derive(Debug)]
pub enum CreateContentReportError {
    TargetUnavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListContentReportsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum GetContentReportDetailError {
    NotFound,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum UpdateContentReportError {
    NotFound,
    InvalidAction,
    TargetUnavailable,
    Conflict,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ModerateContentReportError {
    NotFound,
    Forbidden,
    Conflict,
    Invalid,
    TargetStateConflict,
    Database(DatabaseError),
    Outbox(OutboxError),
}

impl Database {
    pub async fn create_content_report(
        &self,
        reporter_id: Uuid,
        input: NewContentReportRecord,
    ) -> Result<ContentReportCreationRecord, CreateContentReportError> {
        let mut transaction = self.pool.begin().await?;
        let target_board_id =
            report_target_scope(&mut transaction, &input.target_type, input.target_id)
                .await?
                .ok_or(CreateContentReportError::TargetUnavailable)?;

        let inserted = sqlx::query(
            "INSERT INTO content_reports
                (id, reporter_id, target_type, target_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING",
        )
        .bind(input.id)
        .bind(reporter_id)
        .bind(&input.target_type)
        .bind(input.target_id)
        .bind(&input.reason)
        .bind(&input.details)
        .execute(&mut *transaction)
        .await?
        .rows_affected()
            == 1;

        let report_id = if inserted {
            input.id
        } else {
            sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM content_reports
                 WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3",
            )
            .bind(reporter_id)
            .bind(&input.target_type)
            .bind(input.target_id)
            .fetch_one(&mut *transaction)
            .await?
        };

        if inserted {
            notify_report_reviewers(
                &mut transaction,
                reporter_id,
                report_id,
                &input.target_type,
                input.target_id,
                target_board_id,
            )
            .await?;
            maybe_create_risk_alert(
                &mut transaction,
                reporter_id,
                report_id,
                &input.target_type,
                input.target_id,
                &input.reason,
            )
            .await?;
            insert_governance_audit(
                &mut transaction,
                reporter_id,
                "report.create",
                report_id,
                json!({"target_type": input.target_type, "target_id": input.target_id}),
            )
            .await?;
        }

        transaction.commit().await?;
        Ok(ContentReportCreationRecord {
            id: report_id,
            created: inserted,
        })
    }

    pub async fn list_content_reports(
        &self,
        status: Option<&str>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<ContentReportRecord>, ListContentReportsError> {
        if let Some(cursor) = cursor {
            let cursor_exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                     SELECT 1 FROM content_reports
                     WHERE id = $1 AND ($2::text IS NULL OR status = $2)
                 )",
            )
            .bind(cursor)
            .bind(status)
            .fetch_one(&self.pool)
            .await?;
            if !cursor_exists {
                return Err(ListContentReportsError::InvalidCursor);
            }
        }

        Ok(sqlx::query_as::<_, ContentReportRecord>(
            "SELECT r.id, r.target_type, r.target_id,
                    CASE WHEN r.target_type = 'topic' THEN topic_target.id ELSE post_topic.id END AS target_topic_id,
                    CASE WHEN r.target_type = 'topic' THEN topic_target.title ELSE post_topic.title END AS target_title,
                    COALESCE(topic_target.author_id, post_target.author_id) AS target_author_id,
                    target_author.username AS target_author_username,
                    target_author.display_name AS target_author_display_name,
                    target_author.avatar_url AS target_author_avatar_url,
                    reporter.id AS reporter_id, reporter.username AS reporter_username,
                    reporter.display_name AS reporter_display_name, reporter.avatar_url AS reporter_avatar_url,
                    r.reason, r.details, r.status, r.resolution, r.resolution_note,
                    reviewer.id AS reviewer_id, reviewer.username AS reviewer_username,
                    reviewer.display_name AS reviewer_display_name, reviewer.avatar_url AS reviewer_avatar_url,
                    r.created_at, r.updated_at, r.resolved_at, r.revision
             FROM content_reports AS r
             INNER JOIN users AS reporter ON reporter.id = r.reporter_id
             LEFT JOIN topics AS topic_target
               ON r.target_type = 'topic' AND topic_target.id = r.target_id
             LEFT JOIN posts AS post_target
               ON r.target_type = 'post' AND post_target.id = r.target_id
             LEFT JOIN topics AS post_topic ON post_topic.id = post_target.topic_id
             LEFT JOIN users AS target_author
               ON target_author.id = COALESCE(topic_target.author_id, post_target.author_id)
             LEFT JOIN users AS reviewer ON reviewer.id = r.reviewer_id
             WHERE ($1::text IS NULL OR r.status = $1)
               AND ($2::uuid IS NULL OR (r.created_at, r.id) < (
                   SELECT created_at, id FROM content_reports WHERE id = $2
               ))
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT $3",
        )
        .bind(status)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn get_content_report_detail(
        &self,
        report_id: Uuid,
    ) -> Result<ContentReportDetailRecord, GetContentReportDetailError> {
        let mut connection = self.pool.acquire().await?;
        let report = fetch_report(&mut connection, report_id)
            .await?
            .ok_or(GetContentReportDetailError::NotFound)?;
        let topic_id = report
            .target_topic_id
            .ok_or(GetContentReportDetailError::NotFound)?;
        let title = report
            .target_title
            .clone()
            .ok_or(GetContentReportDetailError::NotFound)?;
        let target_post_id = if report.target_type == "topic" {
            sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM posts WHERE topic_id = $1 AND kind = 'topic' ORDER BY created_at, id LIMIT 1",
            )
            .bind(topic_id)
            .fetch_optional(&mut *connection)
            .await?
            .ok_or(GetContentReportDetailError::NotFound)?
        } else {
            report.target_id
        };
        let items = sqlx::query_as::<_, ReportContextItemRecord>(
            "WITH target AS (
                 SELECT created_at FROM posts WHERE id = $2
             )
             SELECT post.id, author.id AS author_id, author.username AS author_username,
                    author.display_name AS author_display_name,
                    author.avatar_url AS author_avatar_url,
                    LEFT(post.content, 2000) AS content, post.status,
                    post.id = $2 AS is_target, post.created_at
             FROM posts AS post
             LEFT JOIN users AS author ON author.id = post.author_id
             CROSS JOIN target
             WHERE post.topic_id = $1
             ORDER BY post.id = $2 DESC,
                      ABS(EXTRACT(EPOCH FROM (post.created_at - target.created_at))),
                      post.created_at, post.id
             LIMIT 5",
        )
        .bind(topic_id)
        .bind(target_post_id)
        .fetch_all(&mut *connection)
        .await?;
        if items.is_empty() || !items.iter().any(|item| item.is_target) {
            return Err(GetContentReportDetailError::NotFound);
        }

        let author = match report.target_author_id {
            Some(author_id) => {
                sqlx::query_as::<_, ReportAuthorContextRecord>(
                    "SELECT author.id, author.username, author.display_name, author.avatar_url,
                        author.status, author.admin_revision AS revision,
                        (SELECT COUNT(*)
                         FROM content_reports AS history
                         LEFT JOIN topics AS history_topic
                           ON history.target_type = 'topic' AND history_topic.id = history.target_id
                         LEFT JOIN posts AS history_post
                           ON history.target_type = 'post' AND history_post.id = history.target_id
                         WHERE COALESCE(history_topic.author_id, history_post.author_id) = author.id
                        ) AS report_count
                 FROM users AS author WHERE author.id = $1",
                )
                .bind(author_id)
                .fetch_optional(&mut *connection)
                .await?
            }
            None => None,
        };
        let related_reports = match report.target_author_id {
            Some(author_id) => {
                sqlx::query_as::<_, ReportHistoryItemRecord>(
                    "SELECT history.id, history.reason, history.status, history.resolution,
                        history.created_at, history.resolved_at
                 FROM content_reports AS history
                 LEFT JOIN topics AS history_topic
                   ON history.target_type = 'topic' AND history_topic.id = history.target_id
                 LEFT JOIN posts AS history_post
                   ON history.target_type = 'post' AND history_post.id = history.target_id
                 WHERE COALESCE(history_topic.author_id, history_post.author_id) = $1
                 ORDER BY history.created_at DESC, history.id DESC
                 LIMIT 20",
                )
                .bind(author_id)
                .fetch_all(&mut *connection)
                .await?
            }
            None => Vec::new(),
        };
        let handling_history = sqlx::query_as::<_, ReportHandlingRecordRecord>(
            "SELECT audit.id, audit.action, actor.id AS actor_id,
                    actor.username AS actor_username, actor.display_name AS actor_display_name,
                    actor.avatar_url AS actor_avatar_url, audit.created_at
             FROM admin_audit_log AS audit
             INNER JOIN users AS actor ON actor.id = audit.actor_id
             WHERE audit.resource_type = 'content_report' AND audit.resource_id = $1
             ORDER BY audit.created_at DESC, audit.id DESC
             LIMIT 20",
        )
        .bind(report_id)
        .fetch_all(&mut *connection)
        .await?;

        Ok(ContentReportDetailRecord {
            report,
            context: ReportContentContextRecord {
                topic_id,
                title,
                items,
            },
            author,
            related_reports,
            handling_history,
        })
    }

    pub async fn update_content_report(
        &self,
        input: UpdateContentReportRecord,
    ) -> Result<ContentReportRecord, UpdateContentReportError> {
        if !valid_report_action(input.status, input.resolution) {
            return Err(UpdateContentReportError::InvalidAction);
        }

        let mut transaction = self.pool.begin().await?;
        let report = sqlx::query_as::<_, ReportTargetRow>(
            "SELECT reporter_id, target_type, target_id
             FROM content_reports WHERE id = $1 FOR UPDATE",
        )
        .bind(input.report_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(UpdateContentReportError::NotFound)?;

        let current_revision =
            sqlx::query_scalar::<_, i64>("SELECT revision FROM content_reports WHERE id = $1")
                .bind(input.report_id)
                .fetch_one(&mut *transaction)
                .await?;
        if input
            .expected_revision
            .is_some_and(|expected_revision| current_revision != expected_revision)
        {
            return Err(UpdateContentReportError::Conflict);
        }

        apply_report_resolution(&mut transaction, &report, input.status, input.resolution).await?;

        let resolved = matches!(input.status, "resolved" | "dismissed");
        sqlx::query(
            "UPDATE content_reports
             SET status = $2, resolution = $3, resolution_note = $4,
                 reviewer_id = $5,
                 resolved_at = CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE NULL END,
                 updated_at = CURRENT_TIMESTAMP, revision = revision + 1
             WHERE id = $1",
        )
        .bind(input.report_id)
        .bind(input.status)
        .bind(input.resolution)
        .bind(&input.note)
        .bind(input.reviewer_id)
        .bind(resolved)
        .execute(&mut *transaction)
        .await?;

        insert_governance_audit(
            &mut transaction,
            input.reviewer_id,
            if resolved {
                "report.resolve"
            } else {
                "report.review"
            },
            input.report_id,
            json!({
                "target_type": report.target_type,
                "target_id": report.target_id,
                "status": input.status,
                "resolution": input.resolution
            }),
        )
        .await?;

        if resolved {
            notify_reporter(
                &mut transaction,
                input.reviewer_id,
                report.reporter_id,
                input.report_id,
                &report.target_type,
                report.target_id,
            )
            .await?;
        }

        let updated = fetch_report(&mut transaction, input.report_id)
            .await?
            .ok_or(UpdateContentReportError::NotFound)?;
        transaction.commit().await?;
        Ok(updated)
    }

    pub async fn moderate_content_report(
        &self,
        input: ModerateContentReportRecord,
    ) -> Result<ReportModerationResultRecord, ModerateContentReportError> {
        if !valid_moderation(&input) {
            return Err(ModerateContentReportError::Invalid);
        }
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
            .bind(input.reviewer_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(ModerateContentReportError::Forbidden)?;
        if !has_permission_with_executor(
            &mut transaction,
            input.reviewer_id,
            permission_keys::GOVERNANCE_REPORTS_RESOLVE,
            None,
        )
        .await?
        {
            return Err(ModerateContentReportError::Forbidden);
        }

        #[derive(FromRow)]
        struct ModerationTargetRow {
            reporter_id: Uuid,
            target_type: String,
            target_id: Uuid,
            status: String,
            revision: i64,
        }
        let report = sqlx::query_as::<_, ModerationTargetRow>(
            "SELECT reporter_id, target_type, target_id, status, revision
             FROM content_reports WHERE id = $1 FOR UPDATE",
        )
        .bind(input.report_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(ModerateContentReportError::NotFound)?;
        if report.revision != input.expected_revision {
            return Err(ModerateContentReportError::Conflict);
        }
        if !matches!(report.status.as_str(), "open" | "in_review") {
            return Err(ModerateContentReportError::TargetStateConflict);
        }

        let report_target = ReportTargetRow {
            reporter_id: report.reporter_id,
            target_type: report.target_type.clone(),
            target_id: report.target_id,
        };
        let content_changed = if input.content_action == "hide" {
            let result = match report.target_type.as_str() {
                "topic" => hide_topic(&mut transaction, report.target_id).await,
                "post" => hide_post(&mut transaction, report.target_id).await,
                _ => return Err(ModerateContentReportError::Invalid),
            };
            match result {
                Ok(()) => true,
                Err(UpdateContentReportError::TargetUnavailable) => {
                    return Err(ModerateContentReportError::TargetStateConflict);
                }
                Err(UpdateContentReportError::Database(error)) => {
                    return Err(ModerateContentReportError::Database(error));
                }
                Err(
                    UpdateContentReportError::NotFound
                    | UpdateContentReportError::InvalidAction
                    | UpdateContentReportError::Conflict,
                ) => {
                    return Err(ModerateContentReportError::Invalid);
                }
            }
        } else {
            false
        };

        let user = if let Some(user_action) = &input.user_action {
            let author_id = target_author_id(&mut transaction, &report_target)
                .await?
                .ok_or(ModerateContentReportError::TargetStateConflict)?;
            if author_id == input.reviewer_id {
                return Err(ModerateContentReportError::TargetStateConflict);
            }
            #[derive(FromRow)]
            struct CurrentUserRow {
                status: String,
                admin_revision: i64,
            }
            let current = sqlx::query_as::<_, CurrentUserRow>(
                "SELECT status, admin_revision FROM users WHERE id = $1 FOR UPDATE",
            )
            .bind(author_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(ModerateContentReportError::TargetStateConflict)?;
            if current.status != "active" {
                return Err(ModerateContentReportError::TargetStateConflict);
            }
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
            .bind(author_id)
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
                    return Err(ModerateContentReportError::TargetStateConflict);
                }
            }
            let updated_revision = sqlx::query_scalar::<_, i64>(
                "UPDATE users
                 SET status = $2, restriction_reason = $3, restriction_expires_at = $4,
                     admin_revision = admin_revision + 1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1
                 RETURNING admin_revision",
            )
            .bind(author_id)
            .bind(user_action.status)
            .bind(&user_action.reason)
            .bind(user_action.expires_at)
            .fetch_one(&mut *transaction)
            .await?;
            if user_action.status == "suspended" {
                sqlx::query(
                    "UPDATE sessions
                     SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                     WHERE user_id = $1 AND revoked_at IS NULL",
                )
                .bind(author_id)
                .execute(&mut *transaction)
                .await?;
            }
            let user_audit_id = insert_audit(
                &mut transaction,
                input.reviewer_id,
                "user.status.update",
                "user",
                Some(author_id),
                json!({
                    "old_status": current.status,
                    "old_revision": current.admin_revision,
                    "new_status": user_action.status,
                    "reason": user_action.reason,
                    "expires_at": user_action.expires_at.map(|value| value.to_string()),
                    "revision": updated_revision,
                    "report_id": input.report_id,
                }),
            )
            .await?;
            self.enqueue_outbox_event_in_transaction(
                &mut transaction,
                NewOutboxEvent {
                    id: Uuid::now_v7(),
                    event_type: "user.status_changed".to_owned(),
                    aggregate_type: "user".to_owned(),
                    aggregate_id: author_id,
                    dedupe_key: format!("user-status:{author_id}:{updated_revision}"),
                    payload: json!({
                        "user_id": author_id,
                        "status": user_action.status,
                        "reason": user_action.reason,
                        "expires_at": user_action.expires_at.map(|value| value.to_string()),
                        "revision": updated_revision,
                        "audit_id": user_audit_id,
                        "report_id": input.report_id,
                    }),
                    max_attempts: 8,
                },
            )
            .await
            .map_err(ModerateContentReportError::Outbox)?;
            Some(ReportModerationUserResultRecord {
                user_id: author_id,
                status: user_action.status.to_owned(),
                reason: user_action.reason.clone(),
                expires_at: user_action.expires_at,
                revision: updated_revision,
            })
        } else {
            None
        };

        let resolution = if input.disposition == "dismissed" {
            "dismiss"
        } else if input.content_action == "hide" && report.target_type == "topic" {
            "hide_topic"
        } else if input.content_action == "hide" {
            "hide_post"
        } else {
            "suspend_author"
        };
        let updated_rows = sqlx::query(
            "UPDATE content_reports
             SET status = $2, resolution = $3, resolution_note = $4, reviewer_id = $5,
                 resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                 revision = revision + 1
             WHERE id = $1 AND revision = $6",
        )
        .bind(input.report_id)
        .bind(input.disposition)
        .bind(resolution)
        .bind(&input.note)
        .bind(input.reviewer_id)
        .bind(input.expected_revision)
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        if updated_rows != 1 {
            return Err(ModerateContentReportError::Conflict);
        }
        let audit_id = insert_audit(
            &mut transaction,
            input.reviewer_id,
            "report.moderate",
            "content_report",
            Some(input.report_id),
            json!({
                "target_type": report.target_type,
                "target_id": report.target_id,
                "disposition": input.disposition,
                "content_action": input.content_action,
                "user_action": input.user_action.as_ref().map(|action| action.status),
                "revision": input.expected_revision + 1,
            }),
        )
        .await?;
        notify_reporter(
            &mut transaction,
            input.reviewer_id,
            report.reporter_id,
            input.report_id,
            &report.target_type,
            report.target_id,
        )
        .await?;
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "report.moderated".to_owned(),
                aggregate_type: "content_report".to_owned(),
                aggregate_id: input.report_id,
                dedupe_key: format!(
                    "report-moderated:{}:{}",
                    input.report_id,
                    input.expected_revision + 1
                ),
                payload: json!({
                    "report_id": input.report_id,
                    "target_type": report.target_type,
                    "target_id": report.target_id,
                    "disposition": input.disposition,
                    "public_reason": input.public_reason,
                    "revision": input.expected_revision + 1,
                    "audit_id": audit_id,
                }),
                max_attempts: 8,
            },
        )
        .await
        .map_err(ModerateContentReportError::Outbox)?;
        let updated = fetch_report(&mut transaction, input.report_id)
            .await?
            .ok_or(ModerateContentReportError::NotFound)?;
        transaction.commit().await?;

        Ok(ReportModerationResultRecord {
            report: updated,
            content_action: input.content_action.to_owned(),
            target_id: report.target_id,
            content_changed,
            user,
            audit_id,
            notification_queued: true,
        })
    }

    pub async fn update_content_reports_batch(
        &self,
        inputs: &[UpdateContentReportRecord],
    ) -> Result<Vec<ContentReportRecord>, UpdateContentReportError> {
        if inputs.is_empty()
            || inputs
                .iter()
                .any(|input| !valid_report_action(input.status, input.resolution))
        {
            return Err(UpdateContentReportError::InvalidAction);
        }

        let mut ordered = inputs.to_vec();
        ordered.sort_by_key(|input| input.report_id);
        let mut transaction = self.pool.begin().await?;
        let mut updated = Vec::with_capacity(ordered.len());
        for input in &ordered {
            let report = sqlx::query_as::<_, ReportTargetRow>(
                "SELECT reporter_id, target_type, target_id
                 FROM content_reports WHERE id = $1 FOR UPDATE",
            )
            .bind(input.report_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(UpdateContentReportError::NotFound)?;

            apply_report_resolution(&mut transaction, &report, input.status, input.resolution)
                .await?;
            let resolved = matches!(input.status, "resolved" | "dismissed");
            sqlx::query(
                "UPDATE content_reports
                 SET status = $2, resolution = $3, resolution_note = $4,
                     reviewer_id = $5,
                     resolved_at = CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE NULL END,
                     updated_at = CURRENT_TIMESTAMP, revision = revision + 1
                 WHERE id = $1",
            )
            .bind(input.report_id)
            .bind(input.status)
            .bind(input.resolution)
            .bind(&input.note)
            .bind(input.reviewer_id)
            .bind(resolved)
            .execute(&mut *transaction)
            .await?;

            insert_governance_audit(
                &mut transaction,
                input.reviewer_id,
                if resolved {
                    "report.resolve"
                } else {
                    "report.review"
                },
                input.report_id,
                json!({
                    "target_type": report.target_type,
                    "target_id": report.target_id,
                    "status": input.status,
                    "resolution": input.resolution,
                    "batch": true
                }),
            )
            .await?;
            if resolved {
                notify_reporter(
                    &mut transaction,
                    input.reviewer_id,
                    report.reporter_id,
                    input.report_id,
                    &report.target_type,
                    report.target_id,
                )
                .await?;
            }
            updated.push(
                fetch_report(&mut transaction, input.report_id)
                    .await?
                    .ok_or(UpdateContentReportError::NotFound)?,
            );
        }
        transaction.commit().await?;
        Ok(updated)
    }
}

#[derive(Debug, FromRow)]
struct ReportTargetRow {
    reporter_id: Uuid,
    target_type: String,
    target_id: Uuid,
}

async fn notify_report_reviewers(
    transaction: &mut Transaction<'_, Postgres>,
    reporter_id: Uuid,
    report_id: Uuid,
    target_type: &str,
    target_id: Uuid,
    board_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO notifications
            (id, recipient_id, actor_id, kind, target_type, target_id, aggregate_key)
         SELECT gen_random_uuid(), candidate.id, $1, 'report', $2, $3,
                'report:new:' || $4::text || ':' || candidate.id::text
         FROM users AS candidate
         WHERE candidate.status = 'active'
           AND EXISTS (
               SELECT 1
               FROM role_assignments AS assignment
               INNER JOIN roles AS role ON role.id = assignment.role_id
               INNER JOIN role_permissions AS role_permission
                   ON role_permission.role_id = role.id
               INNER JOIN permissions AS permission
                   ON permission.id = role_permission.permission_id
                 WHERE assignment.user_id = candidate.id
                 AND permission.permission_key = 'governance.reports.read'
                 AND (
                     (role.scope IN ('instance', 'site') AND assignment.scope_id IS NULL)
                     OR (
                         role.scope = 'board'
                         AND assignment.scope_id IS NOT NULL
                         AND daoyun_board_scope_covers(
                             assignment.scope_id,
                             assignment.scope_mode,
                             $5
                         )
                     )
                 )
           )
         ON CONFLICT (recipient_id, aggregate_key) DO NOTHING",
    )
    .bind(reporter_id)
    .bind(target_type)
    .bind(target_id)
    .bind(report_id)
    .bind(board_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn notify_reporter(
    transaction: &mut Transaction<'_, Postgres>,
    reviewer_id: Uuid,
    reporter_id: Uuid,
    report_id: Uuid,
    target_type: &str,
    target_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO notifications
            (id, recipient_id, actor_id, kind, target_type, target_id, aggregate_key)
         SELECT gen_random_uuid(), reporter.id, $1, 'report', $2, $3,
                'report:resolved:' || $4::text
         FROM users AS reporter
         WHERE reporter.id = $5 AND reporter.status = 'active'
         ON CONFLICT (recipient_id, aggregate_key) DO NOTHING",
    )
    .bind(reviewer_id)
    .bind(target_type)
    .bind(target_id)
    .bind(report_id)
    .bind(reporter_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn report_target_scope(
    transaction: &mut Transaction<'_, Postgres>,
    target_type: &str,
    target_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    match target_type {
        "topic" => {
            sqlx::query_scalar::<_, Uuid>(
                "SELECT b.id
                 FROM topics AS t
                 INNER JOIN boards AS b ON b.id = t.board_id
                 INNER JOIN users AS u ON u.id = t.author_id
                 WHERE t.id = $1 AND t.status = 'published' AND t.deleted_at IS NULL
                   AND b.visibility = 'public' AND b.deleted_at IS NULL AND u.status = 'active'",
            )
            .bind(target_id)
            .fetch_optional(&mut **transaction)
            .await
        }
        "post" => {
            sqlx::query_scalar::<_, Uuid>(
                "SELECT b.id
                 FROM posts AS p
                 INNER JOIN topics AS t ON t.id = p.topic_id
                 INNER JOIN boards AS b ON b.id = t.board_id
                 INNER JOIN users AS author ON author.id = p.author_id
                 INNER JOIN users AS topic_author ON topic_author.id = t.author_id
                 WHERE p.id = $1 AND p.kind = 'reply' AND p.status = 'published'
                   AND p.deleted_at IS NULL AND t.status = 'published' AND t.deleted_at IS NULL
                   AND b.visibility = 'public' AND b.deleted_at IS NULL
                   AND author.status = 'active' AND topic_author.status = 'active'",
            )
            .bind(target_id)
            .fetch_optional(&mut **transaction)
            .await
        }
        _ => Ok(None),
    }
}

async fn apply_report_resolution(
    transaction: &mut Transaction<'_, Postgres>,
    report: &ReportTargetRow,
    status: &str,
    resolution: &str,
) -> Result<(), UpdateContentReportError> {
    if matches!(status, "open" | "in_review") {
        return Ok(());
    }
    match resolution {
        "none" => Ok(()),
        "dismiss" => Ok(()),
        "suspend_author" => {
            let author_id = target_author_id(transaction, report).await?;
            let Some(author_id) = author_id else {
                return Err(UpdateContentReportError::TargetUnavailable);
            };
            sqlx::query(
                "UPDATE users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status <> 'suspended'",
            )
            .bind(author_id)
            .execute(&mut **transaction)
            .await?;
            sqlx::query(
                "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $1 AND revoked_at IS NULL",
            )
            .bind(author_id)
            .execute(&mut **transaction)
            .await?;
            Ok(())
        }
        "hide_topic" if report.target_type == "topic" => {
            hide_topic(transaction, report.target_id).await
        }
        "hide_post" if report.target_type == "post" => {
            hide_post(transaction, report.target_id).await
        }
        _ => Err(UpdateContentReportError::InvalidAction),
    }
}

async fn target_author_id(
    transaction: &mut Transaction<'_, Postgres>,
    report: &ReportTargetRow,
) -> Result<Option<Uuid>, sqlx::Error> {
    match report.target_type.as_str() {
        "topic" => {
            sqlx::query_scalar::<_, Uuid>("SELECT author_id FROM topics WHERE id = $1")
                .bind(report.target_id)
                .fetch_optional(&mut **transaction)
                .await
        }
        "post" => {
            sqlx::query_scalar::<_, Uuid>("SELECT author_id FROM posts WHERE id = $1")
                .bind(report.target_id)
                .fetch_optional(&mut **transaction)
                .await
        }
        _ => Ok(None),
    }
}

async fn hide_topic(
    transaction: &mut Transaction<'_, Postgres>,
    topic_id: Uuid,
) -> Result<(), UpdateContentReportError> {
    let topic = sqlx::query_as::<_, (Uuid, String, Option<OffsetDateTime>)>(
        "SELECT board_id, status, deleted_at FROM topics WHERE id = $1 FOR UPDATE",
    )
    .bind(topic_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(UpdateContentReportError::TargetUnavailable)?;
    let was_public = topic.1 == "published" && topic.2.is_none();
    if !was_public {
        return Err(UpdateContentReportError::TargetUnavailable);
    }
    sqlx::query(
        "UPDATE topics SET status = 'hidden', moderation_status = 'hidden',
            deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), featured_at = NULL,
            pinned_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    )
    .bind(topic_id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "UPDATE posts SET status = 'hidden', deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP WHERE topic_id = $1 AND deleted_at IS NULL",
    )
    .bind(topic_id)
    .execute(&mut **transaction)
    .await?;
    if was_public {
        sqlx::query(
            "UPDATE boards SET topic_count = GREATEST(topic_count - 1, 0),
                updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        )
        .bind(topic.0)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn hide_post(
    transaction: &mut Transaction<'_, Postgres>,
    post_id: Uuid,
) -> Result<(), UpdateContentReportError> {
    let post = sqlx::query_as::<_, (Uuid, String, Option<OffsetDateTime>)>(
        "SELECT topic_id, kind, deleted_at FROM posts WHERE id = $1 FOR UPDATE",
    )
    .bind(post_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(UpdateContentReportError::TargetUnavailable)?;
    if post.1 != "reply" || post.2.is_some() {
        return Err(UpdateContentReportError::TargetUnavailable);
    }
    sqlx::query(
        "UPDATE posts SET status = 'hidden', deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    )
    .bind(post_id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "UPDATE topics AS t SET reply_count = counts.reply_count,
            last_activity_at = COALESCE(counts.last_activity_at, t.published_at),
            updated_at = CURRENT_TIMESTAMP
         FROM (
             SELECT $1::uuid AS topic_id,
                    COUNT(p.id)::bigint AS reply_count,
                    MAX(p.created_at) AS last_activity_at
             FROM posts AS p
             WHERE p.topic_id = $1 AND p.kind = 'reply'
               AND p.status = 'published' AND p.deleted_at IS NULL
         ) AS counts
         WHERE t.id = counts.topic_id",
    )
    .bind(post.0)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn fetch_report(
    connection: &mut PgConnection,
    report_id: Uuid,
) -> Result<Option<ContentReportRecord>, sqlx::Error> {
    sqlx::query_as::<_, ContentReportRecord>(
        "SELECT r.id, r.target_type, r.target_id,
                CASE WHEN r.target_type = 'topic' THEN topic_target.id ELSE post_topic.id END AS target_topic_id,
                CASE WHEN r.target_type = 'topic' THEN topic_target.title ELSE post_topic.title END AS target_title,
                COALESCE(topic_target.author_id, post_target.author_id) AS target_author_id,
                target_author.username AS target_author_username,
                target_author.display_name AS target_author_display_name,
                target_author.avatar_url AS target_author_avatar_url,
                reporter.id AS reporter_id, reporter.username AS reporter_username,
                reporter.display_name AS reporter_display_name, reporter.avatar_url AS reporter_avatar_url,
                r.reason, r.details, r.status, r.resolution, r.resolution_note,
                reviewer.id AS reviewer_id, reviewer.username AS reviewer_username,
                reviewer.display_name AS reviewer_display_name, reviewer.avatar_url AS reviewer_avatar_url,
                r.created_at, r.updated_at, r.resolved_at, r.revision
         FROM content_reports AS r
         INNER JOIN users AS reporter ON reporter.id = r.reporter_id
         LEFT JOIN topics AS topic_target
           ON r.target_type = 'topic' AND topic_target.id = r.target_id
         LEFT JOIN posts AS post_target
           ON r.target_type = 'post' AND post_target.id = r.target_id
         LEFT JOIN topics AS post_topic ON post_topic.id = post_target.topic_id
         LEFT JOIN users AS target_author
           ON target_author.id = COALESCE(topic_target.author_id, post_target.author_id)
         LEFT JOIN users AS reviewer ON reviewer.id = r.reviewer_id
         WHERE r.id = $1",
    )
    .bind(report_id)
    .fetch_optional(&mut *connection)
    .await
}

async fn maybe_create_risk_alert(
    transaction: &mut Transaction<'_, Postgres>,
    reporter_id: Uuid,
    report_id: Uuid,
    target_type: &str,
    target_id: Uuid,
    reason: &str,
) -> Result<(), sqlx::Error> {
    let policy = sqlx::query_as::<_, (bool, i16, i16, i16)>(
        "SELECT enabled, alert_score_threshold, reporter_window_minutes, reporter_alert_limit
         FROM governance_policies WHERE id = 1",
    )
    .fetch_one(&mut **transaction)
    .await?;
    if !policy.0 {
        return Ok(());
    }

    let recent_reports = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM content_reports
         WHERE reporter_id = $1
           AND created_at >= CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 minute')",
    )
    .bind(reporter_id)
    .bind(policy.2)
    .fetch_one(&mut **transaction)
    .await?;
    let target_reports = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM content_reports
         WHERE target_type = $1 AND target_id = $2
           AND created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'",
    )
    .bind(target_type)
    .bind(target_id)
    .fetch_one(&mut **transaction)
    .await?;
    let reason_score = match reason {
        "illegal" => 80,
        "copyright" => 70,
        "harassment" => 60,
        "spam" => 50,
        _ => 20,
    };
    let score = (reason_score
        + (recent_reports.saturating_sub(1).min(2) * 10) as i32
        + (target_reports.saturating_sub(1).min(4) * 5) as i32)
        .min(100);
    let is_spike = recent_reports >= i64::from(policy.3);
    let is_high_risk = score >= i32::from(policy.1);
    if !is_high_risk && !is_spike {
        return Ok(());
    }
    let kind = if is_spike {
        "reporter_spike"
    } else {
        "high_risk_report"
    };
    let severity = if score >= 90 || is_spike && recent_reports >= i64::from(policy.3) * 2 {
        "critical"
    } else if score >= 70 {
        "high"
    } else {
        "medium"
    };
    sqlx::query(
        "INSERT INTO risk_alerts
            (id, kind, severity, score, target_type, target_id, reporter_id, report_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (report_id) WHERE status = 'open' AND report_id IS NOT NULL DO NOTHING",
    )
    .bind(Uuid::now_v7())
    .bind(kind)
    .bind(severity)
    .bind(i16::try_from(score).expect("risk score fits smallint"))
    .bind(target_type)
    .bind(target_id)
    .bind(reporter_id)
    .bind(report_id)
    .bind(sqlx::types::Json(json!({
        "reason": reason,
        "recent_reports": recent_reports,
        "target_reports": target_reports,
        "threshold": policy.1
    })))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn insert_governance_audit(
    transaction: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    action: &str,
    report_id: Uuid,
    summary: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO admin_audit_log (id, actor_id, action, resource_type, resource_id, summary)
         VALUES ($1, $2, $3, 'content_report', $4, $5)",
    )
    .bind(Uuid::now_v7())
    .bind(actor_id)
    .bind(action)
    .bind(report_id)
    .bind(sqlx::types::Json(summary))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn valid_report_action(status: &str, resolution: &str) -> bool {
    matches!(status, "open" | "in_review") && resolution == "none"
}

fn valid_moderation(input: &ModerateContentReportRecord) -> bool {
    if input.expected_revision < 1
        || !(2..=1000).contains(&input.note.chars().count())
        || input.note.chars().any(char::is_control)
        || input.public_reason.as_ref().is_some_and(|reason| {
            !(2..=500).contains(&reason.chars().count()) || reason.chars().any(char::is_control)
        })
        || input.user_action.as_ref().is_some_and(|action| {
            !matches!(action.status, "restricted" | "suspended")
                || !(2..=500).contains(&action.reason.chars().count())
                || action.reason.chars().any(char::is_control)
                || action
                    .expires_at
                    .is_some_and(|expires_at| expires_at <= OffsetDateTime::now_utc())
        })
    {
        return false;
    }
    match input.disposition {
        "dismissed" => input.content_action == "none" && input.user_action.is_none(),
        "resolved" => {
            matches!(input.content_action, "none" | "hide")
                && (input.content_action == "hide" || input.user_action.is_some())
        }
        _ => false,
    }
}

impl From<sqlx::Error> for CreateContentReportError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for GetContentReportDetailError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for ModerateContentReportError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for ListContentReportsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for UpdateContentReportError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for CreateContentReportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TargetUnavailable => formatter.write_str("report target is unavailable"),
            Self::Database(_) => formatter.write_str("content report database operation failed"),
        }
    }
}

impl Error for CreateContentReportError {}

impl fmt::Display for ListContentReportsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCursor => formatter.write_str("content report cursor is invalid"),
            Self::Database(_) => {
                formatter.write_str("content report list database operation failed")
            }
        }
    }
}

impl Error for ListContentReportsError {}

impl fmt::Display for UpdateContentReportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("content report was not found"),
            Self::InvalidAction => formatter.write_str("content report action is invalid"),
            Self::TargetUnavailable => formatter.write_str("report target is unavailable"),
            Self::Conflict => formatter.write_str("content report revision is stale"),
            Self::Database(_) => {
                formatter.write_str("content report update database operation failed")
            }
        }
    }
}

impl Error for UpdateContentReportError {}
