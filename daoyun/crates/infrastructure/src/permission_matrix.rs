use crate::community_groups::list_active_community_memberships_with_executor;
use crate::community_permissions::{CommunityAccessError, community_access_snapshot_with_executor};
use crate::standard_entitlements::list_active_standard_entitlements_with_executor;
use crate::{Database, DatabaseError};
use sqlx::{FromRow, PgConnection};
use std::collections::{BTreeMap, BTreeSet};
use time::OffsetDateTime;
use uuid::Uuid;

const ACTIONS: [(&str, &str, Option<&str>); 5] = [
    ("browse", "board.read", None),
    ("topic_create", "topic.create", Some("topic.create.daily")),
    ("reply_create", "reply.create", Some("reply.create.daily")),
    (
        "attachment_upload",
        "attachment.upload",
        Some("attachment.upload.daily"),
    ),
    (
        "attachment_download",
        "attachment.download",
        Some("attachment.download.bytes.daily"),
    ),
];

#[derive(Debug)]
pub enum PermissionMatrixError {
    BoardNotFound,
    SubjectNotFound,
    InvalidScenario,
    SourceLimit,
    Database(DatabaseError),
}
impl From<sqlx::Error> for PermissionMatrixError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}
impl From<DatabaseError> for PermissionMatrixError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

pub struct BoardPermissionMatrixRecord {
    pub board_id: Uuid,
    pub visibility: String,
    pub policy_revision: Option<i64>,
    pub evaluated_at: OffsetDateTime,
    pub scenarios: Vec<PermissionMatrixScenarioRecord>,
}
pub struct PermissionMatrixScenarioRecord {
    pub id: Uuid,
    pub kind: &'static str,
    pub display_name: String,
    pub complete: bool,
    pub actions: Vec<PermissionMatrixActionRecord>,
    pub sources: Vec<PermissionMatrixSourceRecord>,
    pub quotas: Vec<PermissionMatrixQuotaRecord>,
}
pub struct PermissionMatrixSourceRecord {
    pub id: Uuid,
    pub kind: &'static str,
    pub key: String,
    pub display_name: String,
    pub permission_keys: BTreeSet<String>,
    pub quotas: BTreeMap<String, i64>,
    pub type_version: Option<i32>,
    pub starts_at: Option<OffsetDateTime>,
    pub ends_at: Option<OffsetDateTime>,
}
pub struct PermissionMatrixActionRecord {
    pub action: &'static str,
    pub decision: &'static str,
    pub reason: &'static str,
    pub permission_provided: bool,
    pub source_ids: Vec<Uuid>,
}
pub struct PermissionMatrixQuotaRecord {
    pub key: String,
    pub limit: i64,
    pub used: Option<i64>,
    pub source_ids: Vec<Uuid>,
}
#[derive(FromRow)]
struct MatrixGroup {
    id: Uuid,
    internal_key: String,
    display_name: String,
    status: String,
}

impl Database {
    /// An advisory snapshot, never an authorization token or a quota reservation.
    pub async fn board_permission_matrix(
        &self,
        board_id: Uuid,
        group_ids: &[Uuid],
        user_id: Option<Uuid>,
    ) -> Result<BoardPermissionMatrixRecord, PermissionMatrixError> {
        if group_ids.len() > 4
            || group_ids.iter().collect::<BTreeSet<_>>().len() != group_ids.len()
            || (group_ids.is_empty() && user_id.is_none())
        {
            return Err(PermissionMatrixError::InvalidScenario);
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await?;
        sqlx::query("SET LOCAL statement_timeout = '2000ms'")
            .execute(&mut *tx)
            .await?;
        let evaluated_at: OffsetDateTime = sqlx::query_scalar("SELECT CURRENT_TIMESTAMP")
            .fetch_one(&mut *tx)
            .await?;
        let visibility = sqlx::query_scalar::<_, String>(
            "SELECT visibility FROM boards WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(board_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(PermissionMatrixError::BoardNotFound)?;
        let policy_revision = sqlx::query_scalar("SELECT revision FROM content_access_policies WHERE target_type = 'board' AND target_id = $1")
            .bind(board_id).fetch_optional(&mut *tx).await?;
        let mut scenarios = Vec::new();
        for id in group_ids {
            let group = sqlx::query_as::<_, MatrixGroup>(
                "SELECT id, internal_key, display_name, status FROM community_groups WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(PermissionMatrixError::SubjectNotFound)?;
            let permission_keys: BTreeSet<String> = sqlx::query_scalar::<_, String>(
                "SELECT permission_key FROM community_group_permissions WHERE group_id = $1 AND allowed ORDER BY permission_key")
                .bind(id).fetch_all(&mut *tx).await?.into_iter().collect();
            let quotas = sqlx::query_as::<_, (String, i64)>("SELECT quota_key, quota_value FROM community_group_quota_rules WHERE group_id = $1 ORDER BY quota_key")
                .bind(id).fetch_all(&mut *tx).await?.into_iter().collect();
            let source = PermissionMatrixSourceRecord {
                id: group.id,
                kind: "group",
                key: group.internal_key,
                display_name: group.display_name.clone(),
                permission_keys,
                quotas,
                type_version: None,
                starts_at: None,
                ends_at: None,
            };
            let actions = ACTIONS
                .iter()
                .map(|(action, permission, _)| {
                    let provided = source.permission_keys.contains(*permission);
                    let (decision, reason) = if group.status != "active" {
                        ("not_applicable", "group.inactive")
                    } else if visibility != "public" {
                        ("denied", "board.hidden")
                    } else if provided {
                        ("provided", "scenario.specific_user_required")
                    } else {
                        ("not_provided", "scenario.other_sources_unknown")
                    };
                    PermissionMatrixActionRecord {
                        action,
                        decision,
                        reason,
                        permission_provided: provided,
                        source_ids: if provided { vec![source.id] } else { vec![] },
                    }
                })
                .collect();
            let quota_rows = quota_rows(
                &source.quotas,
                std::slice::from_ref(&source),
                &BTreeMap::new(),
                false,
            );
            scenarios.push(PermissionMatrixScenarioRecord {
                id: group.id,
                kind: "group",
                display_name: group.display_name,
                complete: false,
                actions,
                sources: vec![source],
                quotas: quota_rows,
            });
        }
        if let Some(user_id) = user_id {
            scenarios
                .push(user_scenario(&mut tx, user_id, board_id, &visibility, evaluated_at).await?);
        }
        tx.commit().await?;
        Ok(BoardPermissionMatrixRecord {
            board_id,
            visibility,
            policy_revision,
            evaluated_at,
            scenarios,
        })
    }
    /// Uses the same source snapshot and resource predicates as real community operations.
    /// The read-only transaction cannot consume quota or authorize a later request.
    pub async fn permission_check(
        &self,
        board_id: Uuid,
        user_id: Uuid,
        action: &str,
        topic_id: Option<Uuid>,
        attachment_id: Option<Uuid>,
        file_bytes: Option<i64>,
    ) -> Result<BoardPermissionMatrixRecord, PermissionMatrixError> {
        if !ACTIONS.iter().any(|entry| entry.0 == action)
            || file_bytes
                .is_some_and(|bytes| bytes <= 0 || bytes > crate::MAX_ATTACHMENT_BYTES as i64)
            || (file_bytes.is_some() && action != "attachment_upload")
            || (attachment_id.is_some() && action != "attachment_download")
            || (topic_id.is_some() && action == "topic_create")
        {
            return Err(PermissionMatrixError::InvalidScenario);
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await?;
        sqlx::query("SET LOCAL statement_timeout = '2000ms'")
            .execute(&mut *tx)
            .await?;
        let at: OffsetDateTime = sqlx::query_scalar("SELECT CURRENT_TIMESTAMP")
            .fetch_one(&mut *tx)
            .await?;
        let visibility = sqlx::query_scalar::<_, String>(
            "SELECT visibility FROM boards WHERE id=$1 AND deleted_at IS NULL",
        )
        .bind(board_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(PermissionMatrixError::BoardNotFound)?;
        let policy_revision = sqlx::query_scalar("SELECT revision FROM content_access_policies WHERE target_type='board' AND target_id=$1")
            .bind(board_id).fetch_optional(&mut *tx).await?;
        // Uploading to an owned, known topic does not require public board visibility.
        // The same board and topic access policies are still checked below.
        let action_visibility = if action == "attachment_upload" {
            "public"
        } else {
            &visibility
        };
        let mut scenario = user_scenario(&mut tx, user_id, board_id, action_visibility, at).await?;
        let index = scenario
            .actions
            .iter()
            .position(|entry| entry.action == action)
            .ok_or(PermissionMatrixError::InvalidScenario)?;
        let mut result = scenario.actions.remove(index);
        let quota = |key: &str| scenario.quotas.iter().find(|quota| quota.key == key);
        let fits = |key: &str, bytes: i64| {
            quota(key).is_some_and(|q| {
                q.used
                    .unwrap_or(0)
                    .checked_add(bytes)
                    .is_some_and(|amount| amount <= q.limit)
            })
        };
        if let Some(topic_id) = topic_id {
            let topic = sqlx::query_as::<_, (Uuid, Uuid, bool, bool, bool, bool, bool)>(
                "SELECT t.board_id,t.author_id,
                    t.status='published' AND t.deleted_at IS NULL,
                    t.locked_at IS NOT NULL,u.status='active',
                    EXISTS(SELECT 1 FROM posts p WHERE p.topic_id=t.id AND p.kind='topic' AND p.deleted_at IS NULL),
                    daoyun_can_access_content('topic',t.id,$2,$3)
                 FROM topics t JOIN users u ON u.id=t.author_id WHERE t.id=$1")
                .bind(topic_id).bind(user_id).bind(at).fetch_optional(&mut *tx).await?;
            if topic.as_ref().is_some_and(|topic| topic.0 != board_id) {
                return Err(PermissionMatrixError::InvalidScenario);
            }
            if action != "attachment_download"
                && matches!(result.decision, "allowed" | "missing_context")
            {
                let decision = match topic {
                    None => ("denied", "resource.unavailable"),
                    Some((_, _, false, _, _, _, _)) => ("denied", "resource.unavailable"),
                    Some((_, _, _, _, _, _, false)) => {
                        ("denied", "content.access_policy_unmatched")
                    }
                    Some((_, author, _, _, _, _, _))
                        if action == "attachment_upload" && author != user_id =>
                    {
                        ("denied", "attachment.owner_required")
                    }
                    Some((_, _, _, _, false, _, _)) if action != "attachment_upload" => {
                        ("denied", "resource.unavailable")
                    }
                    Some((_, _, _, _, _, false, _)) if action == "browse" => {
                        ("denied", "resource.unavailable")
                    }
                    Some((_, _, _, true, _, _, _)) if action == "reply_create" => {
                        ("denied", "topic.locked")
                    }
                    Some(_) => ("allowed", "resource.conditions_matched"),
                };
                (result.decision, result.reason) = decision;
            }
        }
        if action == "attachment_upload" && matches!(result.decision, "allowed" | "missing_context")
        {
            if topic_id.is_none() || file_bytes.is_none() {
                (result.decision, result.reason) = ("missing_context", "resource.context_required");
            } else if !crate::attachments::has_instance_super_admin_role(&mut tx, user_id).await?
                && (quota("attachment.file.bytes")
                    .is_none_or(|q| file_bytes.unwrap_or(0) > q.limit)
                    || !fits("attachment.storage.bytes", file_bytes.unwrap_or(0)))
            {
                (result.decision, result.reason) = ("denied", "community.quota_exhausted");
            } else {
                (result.decision, result.reason) = ("allowed", "resource.conditions_matched");
            }
        }
        if action == "reply_create" && topic_id.is_none() && result.decision != "denied" {
            (result.decision, result.reason) = ("missing_context", "resource.context_required");
        }
        if action == "attachment_download"
            && let Some(attachment_id) = attachment_id
        {
            let attachment = sqlx::query_as::<_, (Uuid, Uuid, i64, bool)>(
                "SELECT t.board_id,t.id,a.size_bytes,
                        a.status='ready' AND a.scan_status='clean' AND a.deleted_at IS NULL
                        AND t.status='published' AND t.deleted_at IS NULL
                        AND daoyun_can_access_content('topic',t.id,$2,$3)
                        AND daoyun_can_access_content('attachment',a.id,$2,$3)
                     FROM topic_attachments a JOIN topics t ON t.id=a.topic_id WHERE a.id=$1",
            )
            .bind(attachment_id)
            .bind(user_id)
            .bind(at)
            .fetch_optional(&mut *tx)
            .await?;
            if attachment
                .as_ref()
                .is_some_and(|a| a.0 != board_id || topic_id.is_some_and(|id| id != a.1))
            {
                return Err(PermissionMatrixError::InvalidScenario);
            }
            if result.decision != "denied" {
                (result.decision, result.reason) = match attachment {
                    Some((_, _, bytes, true)) if fits("attachment.download.bytes.daily", bytes) => {
                        ("allowed", "resource.conditions_matched")
                    }
                    Some((_, _, _, true)) => ("denied", "community.quota_exhausted"),
                    _ => ("denied", "resource.unavailable"),
                };
            }
        }
        scenario.actions = vec![result];
        tx.commit().await?;
        Ok(BoardPermissionMatrixRecord {
            board_id,
            visibility,
            policy_revision,
            evaluated_at: at,
            scenarios: vec![scenario],
        })
    }
}

async fn user_scenario(
    connection: &mut PgConnection,
    user_id: Uuid,
    board_id: Uuid,
    visibility: &str,
    at: OffsetDateTime,
) -> Result<PermissionMatrixScenarioRecord, PermissionMatrixError> {
    let display_name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or(PermissionMatrixError::SubjectNotFound)?;
    let count: i64 = sqlx::query_scalar("SELECT (
        SELECT count(*) FROM community_group_memberships m JOIN community_groups g ON g.id = m.group_id
        WHERE m.user_id = $1 AND m.revoked_at IS NULL AND m.starts_at <= $2 AND (m.ends_at IS NULL OR m.ends_at > $2) AND g.status = 'active'
    ) + (SELECT count(*) FROM user_standard_entitlements WHERE user_id = $1 AND revoked_at IS NULL AND starts_at <= $2 AND (ends_at IS NULL OR ends_at > $2))")
        .bind(user_id).bind(at).fetch_one(&mut *connection).await?;
    if count > 128 {
        return Err(PermissionMatrixError::SourceLimit);
    }
    let snapshot = community_access_snapshot_with_executor(connection, user_id, at)
        .await
        .map_err(|error| match error {
            CommunityAccessError::UserNotFound => PermissionMatrixError::SubjectNotFound,
            CommunityAccessError::Database(error) => PermissionMatrixError::Database(error),
        })?;
    let memberships =
        list_active_community_memberships_with_executor(connection, user_id, at).await?;
    let entitlements =
        list_active_standard_entitlements_with_executor(connection, user_id, at).await?;
    let mut sources = Vec::new();
    for source in &snapshot.sources {
        let membership = memberships
            .iter()
            .find(|membership| membership.id == source.membership_id);
        sources.push(PermissionMatrixSourceRecord {
            id: source.membership_id,
            kind: "group",
            key: source.group_key.clone(),
            display_name: membership
                .map(|m| m.group_display_name.clone())
                .unwrap_or_else(|| source.group_key.clone()),
            permission_keys: source.permission_keys.clone(),
            quotas: source.quotas.clone(),
            type_version: None,
            starts_at: membership.map(|m| m.starts_at),
            ends_at: membership.and_then(|m| m.ends_at),
        });
    }
    for source in &snapshot.entitlement_sources {
        let entitlement = entitlements
            .iter()
            .find(|entitlement| entitlement.id == source.entitlement_id);
        sources.push(PermissionMatrixSourceRecord {
            id: source.entitlement_id,
            kind: "entitlement",
            key: source.entitlement_key.clone(),
            display_name: sqlx::query_scalar::<_, String>(
                "SELECT display_name FROM standard_entitlement_types WHERE internal_key = $1",
            )
            .bind(&source.entitlement_key)
            .fetch_optional(&mut *connection)
            .await?
            .unwrap_or_else(|| source.entitlement_key.clone()),
            permission_keys: source.permission_keys.clone(),
            quotas: source.quotas.clone(),
            type_version: Some(source.type_version),
            starts_at: entitlement.map(|e| e.starts_at),
            ends_at: entitlement.and_then(|e| e.ends_at),
        });
    }
    let mut used: BTreeMap<String, i64> = sqlx::query_as::<_, (String, i64)>(
        "SELECT quota_key, used FROM community_quota_usage WHERE user_id = $1 AND window_start = $2")
        .bind(user_id).bind(at.date()).fetch_all(&mut *connection).await?.into_iter().collect();
    let storage_used: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM topic_attachments
        WHERE uploader_id = $1 AND deleted_at IS NULL AND status IN ('pending', 'ready')",
    )
    .bind(user_id)
    .fetch_one(&mut *connection)
    .await?;
    used.insert("attachment.storage.bytes".into(), storage_used);
    let board_read = visibility == "public"
        && sqlx::query_scalar::<_, bool>("SELECT daoyun_can_access_content('board', $1, $2, $3)")
            .bind(board_id)
            .bind(user_id)
            .bind(at)
            .fetch_one(&mut *connection)
            .await?;
    let upload_exempt =
        crate::attachments::has_instance_super_admin_role(connection, user_id).await?;
    let mut actions = Vec::new();
    for (action, permission, daily) in ACTIONS {
        let source_ids = sources
            .iter()
            .filter(|s| s.permission_keys.contains(permission))
            .map(|s| s.id)
            .collect::<Vec<_>>();
        let provided = !source_ids.is_empty();
        let allowed = snapshot.permission_keys.contains(permission);
        let restricted = if matches!(
            permission,
            "topic.create" | "reply.create" | "attachment.upload"
        ) {
            crate::board_user_restrictions::read_board_user_action_restriction(
                connection, user_id, board_id, permission, at, false,
            )
            .await?
        } else {
            false
        };
        let daily_exhausted = daily.is_some_and(|key| {
            used.get(key).copied().unwrap_or(0) >= snapshot.quotas.get(key).copied().unwrap_or(0)
        });
        let upload_exhausted = daily_exhausted
            || snapshot
                .quotas
                .get("attachment.file.bytes")
                .copied()
                .unwrap_or(0)
                == 0
            || storage_used
                >= snapshot
                    .quotas
                    .get("attachment.storage.bytes")
                    .copied()
                    .unwrap_or(0);
        let (decision, reason) = if action == "browse" {
            if board_read {
                ("allowed", "board.access_policy_matched")
            } else {
                (
                    "denied",
                    if visibility != "public" {
                        "board.hidden"
                    } else {
                        "content.access_policy_unmatched"
                    },
                )
            }
        } else if snapshot.denied {
            ("denied", "account.inactive")
        } else if snapshot.blocked_permission_keys.contains(permission) {
            ("denied", "account.restricted")
        } else if !allowed {
            ("denied", "community.permission_not_provided")
        } else if restricted {
            ("denied", "board.action_restricted")
        } else if action != "attachment_download" && !board_read {
            (
                "denied",
                if visibility != "public" {
                    "board.hidden"
                } else {
                    "content.access_policy_unmatched"
                },
            )
        } else if (action == "attachment_upload" && upload_exhausted && !upload_exempt)
            || (action != "attachment_upload" && daily_exhausted)
        {
            ("denied", "community.quota_exhausted")
        } else if action == "topic_create" {
            ("allowed", "board.basic_conditions_matched")
        } else {
            (
                "missing_context",
                if action == "attachment_upload" && upload_exempt {
                    "resource.context_required_upload_quota_exempt"
                } else {
                    "resource.context_required"
                },
            )
        };
        actions.push(PermissionMatrixActionRecord {
            action,
            decision,
            reason,
            permission_provided: provided,
            source_ids,
        });
    }
    let quotas = quota_rows(&snapshot.quotas, &sources, &used, true);
    Ok(PermissionMatrixScenarioRecord {
        id: user_id,
        kind: "user",
        display_name,
        complete: true,
        actions,
        sources,
        quotas,
    })
}

fn quota_rows(
    limits: &BTreeMap<String, i64>,
    sources: &[PermissionMatrixSourceRecord],
    used: &BTreeMap<String, i64>,
    user: bool,
) -> Vec<PermissionMatrixQuotaRecord> {
    crate::COMMUNITY_QUOTA_KEYS
        .into_iter()
        .map(|key| {
            let limit = limits.get(key).copied().unwrap_or(0);
            PermissionMatrixQuotaRecord {
                key: key.into(),
                limit,
                used: (user && (key.ends_with(".daily") || key == "attachment.storage.bytes"))
                    .then(|| used.get(key).copied().unwrap_or(0)),
                source_ids: sources
                    .iter()
                    .filter(|s| s.quotas.get(key).copied() == Some(limit))
                    .map(|s| s.id)
                    .collect(),
            }
        })
        .collect()
}
