use serde_json::json;
use sqlx::{FromRow, PgConnection, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::Database;
use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::board_user_restrictions::is_board_user_action_restricted_with_executor;
use crate::community_permissions::{CommunityActionError, verify_community_action_with_executor};

#[derive(Debug)]
pub enum SupplementError {
    NotFound,
    Forbidden,
    Disabled,
    LimitReached,
    Conflict,
    InvalidInput,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for SupplementError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct SupplementRecord {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub author_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub content: String,
    pub status: String,
    pub revision: i32,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, FromRow)]
pub struct SupplementSettingsRecord {
    pub enabled: bool,
    pub max_per_topic: i32,
}

#[derive(Debug)]
pub struct SupplementListRecord {
    pub records: Vec<SupplementRecord>,
    pub settings: SupplementSettingsRecord,
    pub used_count: i64,
    pub can_submit: bool,
}

#[derive(Debug)]
pub struct NewTopicSupplement {
    pub topic_id: Uuid,
    pub author_id: Uuid,
    pub content: String,
    pub idempotency_key: String,
}

#[derive(FromRow)]
struct SupplementTopic {
    author_id: Uuid,
    board_id: Uuid,
    locked: bool,
    writable: bool,
}

macro_rules! select_supplements {
    ($suffix:literal) => {
        concat!(
            "SELECT s.id, s.topic_id, s.author_id, u.username, u.display_name, u.avatar_url,
                 s.content, s.status, s.revision, s.created_at, s.updated_at
                 FROM topic_supplements s JOIN users u ON u.id = s.author_id ",
            $suffix
        )
    };
}

async fn topic_context(
    transaction: &mut Transaction<'_, Postgres>,
    topic_id: Uuid,
    viewer: Option<Uuid>,
    write: bool,
) -> Result<SupplementTopic, SupplementError> {
    // All supplement writers serialize on the topic before counting or checking receipts.
    if write {
        sqlx::query("SELECT id FROM topics WHERE id = $1 FOR UPDATE")
            .bind(topic_id)
            .execute(&mut **transaction)
            .await?;
    }
    let topic = sqlx::query_as::<_, SupplementTopic>(
        "SELECT t.author_id, t.board_id, t.locked_at IS NOT NULL AS locked,
                b.status = 'open' AS writable
         FROM topics t JOIN boards b ON b.id = t.board_id
         JOIN users u ON u.id = t.author_id
         WHERE t.id = $1 AND t.status = 'published' AND t.deleted_at IS NULL
           AND b.deleted_at IS NULL AND b.visibility = 'public'
           AND b.status IN ('open', 'read_only') AND u.status IN ('active', 'restricted')
           AND daoyun_can_access_content('topic', t.id, $2, CURRENT_TIMESTAMP)
         FOR SHARE OF t, b",
    )
    .bind(topic_id)
    .bind(viewer)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(SupplementError::NotFound)?;
    Ok(topic)
}

async fn settings(connection: &mut PgConnection) -> Result<SupplementSettingsRecord, sqlx::Error> {
    sqlx::query_as(
        "SELECT enabled, max_per_topic FROM topic_supplement_settings WHERE id = 1 FOR SHARE",
    )
    .fetch_one(connection)
    .await
}

// A declared, installed and enabled provider is required, regardless of its plugin key.
// The shared row lock makes disabling/uninstalling wait for in-flight additions.
async fn extension_enabled(connection: &mut PgConnection) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT id FROM plugins WHERE status = 'enabled' AND capabilities ? 'topic.supplements' FOR SHARE)")
        .fetch_one(connection).await
}

async fn author_allowed(
    transaction: &mut Transaction<'_, Postgres>,
    topic: &SupplementTopic,
    actor: Uuid,
) -> Result<bool, SupplementError> {
    if topic.author_id != actor || topic.locked || !topic.writable {
        return Ok(false);
    }
    let now = OffsetDateTime::now_utc();
    // Supplements are content writes and inherit the author's existing posting restrictions.
    match verify_community_action_with_executor(transaction, actor, "topic.create", now).await {
        Ok(()) => {}
        Err(CommunityActionError::PermissionDenied | CommunityActionError::QuotaExceeded) => {
            return Ok(false);
        }
        Err(CommunityActionError::Database(error)) => return Err(error.into()),
    }
    Ok(!is_board_user_action_restricted_with_executor(
        transaction,
        actor,
        topic.board_id,
        "topic.create",
        now,
    )
    .await?)
}

async fn record(
    connection: &mut PgConnection,
    id: Uuid,
) -> Result<SupplementRecord, SupplementError> {
    sqlx::query_as(select_supplements!("WHERE s.id = $1"))
        .bind(id)
        .fetch_optional(connection)
        .await?
        .ok_or(SupplementError::NotFound)
}

impl Database {
    pub async fn list_topic_supplements(
        &self,
        topic_id: Uuid,
        viewer: Option<Uuid>,
    ) -> Result<SupplementListRecord, SupplementError> {
        let mut tx = self.pool.begin().await?;
        let topic = topic_context(&mut tx, topic_id, viewer, false).await?;
        let mut settings = settings(&mut tx).await?;
        let records: Vec<SupplementRecord> = sqlx::query_as(select_supplements!(
            "WHERE s.topic_id = $1
             AND (s.status = 'approved' OR s.author_id = $2)
             ORDER BY s.created_at, s.id"
        ))
        .bind(topic_id)
        .bind(viewer)
        .fetch_all(&mut *tx)
        .await?;
        let used_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM topic_supplements WHERE topic_id = $1")
                .bind(topic_id)
                .fetch_one(&mut *tx)
                .await?;
        let can_post = if let Some(viewer) = viewer {
            author_allowed(&mut tx, &topic, viewer).await?
        } else {
            false
        };
        settings.enabled &= extension_enabled(&mut tx).await?;
        let can_submit =
            settings.enabled && can_post && used_count < i64::from(settings.max_per_topic);
        tx.commit().await?;
        Ok(SupplementListRecord {
            records,
            settings,
            used_count,
            can_submit,
        })
    }

    pub async fn create_topic_supplement(
        &self,
        input: NewTopicSupplement,
    ) -> Result<(SupplementRecord, bool), SupplementError> {
        let content = input.content.trim();
        if !(1..=1000).contains(&content.chars().count())
            || content
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
            || !(1..=128).contains(&input.idempotency_key.len())
            || !input
                .idempotency_key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err(SupplementError::InvalidInput);
        }
        let mut tx = self.pool.begin().await?;
        let topic = topic_context(&mut tx, input.topic_id, Some(input.author_id), true).await?;
        if !author_allowed(&mut tx, &topic, input.author_id).await? {
            return Err(SupplementError::Forbidden);
        }
        let receipt: Option<(Uuid, String)> = sqlx::query_as(
            "SELECT id, content FROM topic_supplements WHERE topic_id = $1 AND author_id = $2 AND idempotency_key = $3"
        ).bind(input.topic_id).bind(input.author_id).bind(&input.idempotency_key)
            .fetch_optional(&mut *tx).await?;
        if let Some((id, original_content)) = receipt {
            if original_content != content {
                return Err(SupplementError::Conflict);
            }
            let result = record(&mut tx, id).await?;
            tx.commit().await?;
            return Ok((result, false));
        }
        let settings = settings(&mut tx).await?;
        if !settings.enabled || !extension_enabled(&mut tx).await? {
            return Err(SupplementError::Disabled);
        }
        let used: i64 =
            sqlx::query_scalar("SELECT count(*) FROM topic_supplements WHERE topic_id = $1")
                .bind(input.topic_id)
                .fetch_one(&mut *tx)
                .await?;
        // Hidden records still consume a slot.
        if used >= i64::from(settings.max_per_topic) {
            return Err(SupplementError::LimitReached);
        }
        let status = "approved";
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO topic_supplements (id, topic_id, author_id, content, status, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)")
            .bind(id).bind(input.topic_id).bind(input.author_id).bind(content).bind(status).bind(&input.idempotency_key)
            .execute(&mut *tx).await?;
        insert_audit(
            &mut tx,
            input.author_id,
            "topic.supplement.create",
            "topic_supplement",
            Some(id),
            json!({"topic_id": input.topic_id, "status": status}),
        )
        .await?;
        let result = record(&mut tx, id).await?;
        tx.commit().await?;
        Ok((result, true))
    }

    pub async fn topic_supplement_settings(
        &self,
        actor: Uuid,
        update: Option<SupplementSettingsRecord>,
    ) -> Result<SupplementSettingsRecord, SupplementError> {
        let mut tx = self.pool.begin().await?;
        let permission = if update.is_some() {
            permission_keys::ADMIN_CONFIGURATION_WRITE
        } else {
            permission_keys::ADMIN_CONFIGURATION_READ
        };
        if !has_permission_with_executor(&mut tx, actor, permission, None).await? {
            return Err(SupplementError::Forbidden);
        }
        if let Some(update) = update {
            if !(0..=100).contains(&update.max_per_topic) {
                return Err(SupplementError::InvalidInput);
            }
            sqlx::query("UPDATE topic_supplement_settings SET enabled = $1, max_per_topic = $2 WHERE id = 1")
                .bind(update.enabled).bind(update.max_per_topic).execute(&mut *tx).await?;
            insert_audit(
                &mut tx,
                actor,
                "topic.supplement.configure",
                "topic_supplement",
                None,
                json!({"enabled": update.enabled, "max_per_topic": update.max_per_topic}),
            )
            .await?;
        }
        let result = settings(&mut tx).await?;
        tx.commit().await?;
        Ok(result)
    }
}
