use crate::community_permissions::{CommunityActionError, verify_community_action_with_executor};
use crate::{Database, DatabaseError};
use serde_json::json;
use sqlx::{FromRow, Postgres, Transaction};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
#[derive(Debug)]
pub enum PollError {
    NotFound,
    Forbidden,
    Disabled,
    Closed,
    AlreadyVoted,
    InvalidOption,
    InvalidInput,
    Conflict,
    Database(DatabaseError),
}
impl From<sqlx::Error> for PollError {
    fn from(e: sqlx::Error) -> Self {
        Self::Database(e.into())
    }
}
#[derive(Debug, Clone)]
pub struct NewPollRecord {
    pub question: String,
    pub options: Vec<String>,
    pub ends_at: OffsetDateTime,
}
#[derive(Debug, FromRow)]
pub struct PollOptionRecord {
    pub id: Uuid,
    pub label: String,
    pub votes: Option<i64>,
}
#[derive(Debug)]
pub struct PollRecord {
    pub topic_id: Uuid,
    pub question: String,
    pub ends_at: OffsetDateTime,
    pub revision: i64,
    pub enabled: bool,
    pub closed: bool,
    pub can_vote: bool,
    pub can_edit: bool,
    pub selected_option: Option<Uuid>,
    pub total_votes: Option<i64>,
    pub options: Vec<PollOptionRecord>,
}
fn action_error(e: CommunityActionError) -> PollError {
    match e {
        CommunityActionError::Database(e) => PollError::from(e),
        _ => PollError::Forbidden,
    }
}
async fn provider(
    tx: &mut Transaction<'_, Postgres>,
    key: Option<&str>,
) -> Result<String, PollError> {
    sqlx::query_scalar("SELECT key FROM plugins WHERE status='enabled' AND capabilities ? 'topic.polls' AND ($1::text IS NULL OR key=$1) ORDER BY key LIMIT 1 FOR SHARE").bind(key).fetch_optional(&mut **tx).await?.ok_or(PollError::Disabled)
}
fn validate(input: &NewPollRecord, now: OffsetDateTime) -> Result<(), PollError> {
    if input.question.trim().is_empty()
        || input.question.chars().count() > 200
        || input.question.chars().any(char::is_control)
        || !(2..=10).contains(&input.options.len())
        || input.ends_at <= now
        || input.ends_at > now + Duration::days(30)
    {
        return Err(PollError::InvalidInput);
    }
    let mut seen = std::collections::HashSet::new();
    for label in &input.options {
        if label.trim().is_empty()
            || label.chars().count() > 120
            || label.chars().any(char::is_control)
            || !seen.insert(label.trim().to_lowercase())
        {
            return Err(PollError::InvalidInput);
        }
    }
    Ok(())
}
async fn options(
    tx: &mut Transaction<'_, Postgres>,
    topic: Uuid,
    input: &NewPollRecord,
) -> Result<(), PollError> {
    for (position, label) in input.options.iter().enumerate() {
        sqlx::query(
            "INSERT INTO topic_poll_options(id,topic_id,position,label) VALUES($1,$2,$3,$4)",
        )
        .bind(Uuid::now_v7())
        .bind(topic)
        .bind(position as i16)
        .bind(label.trim())
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}
pub(crate) async fn create_poll(
    tx: &mut Transaction<'_, Postgres>,
    author: Uuid,
    topic: Uuid,
    input: NewPollRecord,
) -> Result<(), PollError> {
    let now: OffsetDateTime = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?;
    validate(&input, now)?;
    let key = provider(tx, None).await?;
    verify_community_action_with_executor(tx, author, "topic.poll.create", now)
        .await
        .map_err(action_error)?;
    sqlx::query(
        "INSERT INTO topic_polls(topic_id,provider_key,question,ends_at) VALUES($1,$2,$3,$4)",
    )
    .bind(topic)
    .bind(key)
    .bind(input.question.trim())
    .bind(input.ends_at)
    .execute(&mut **tx)
    .await?;
    options(tx, topic, &input).await?;
    crate::admin::insert_audit(
        tx,
        author,
        "topic.poll.create",
        "topic",
        Some(topic),
        json!({"options":input.options.len(),"ends_at":input.ends_at.unix_timestamp()}),
    )
    .await?;
    Ok(())
}
async fn topic_access(
    tx: &mut Transaction<'_, Postgres>,
    topic: Uuid,
    viewer: Option<Uuid>,
) -> Result<(Uuid, Uuid, bool), PollError> {
    sqlx::query_as("SELECT t.author_id,t.board_id,t.locked_at IS NOT NULL FROM topics t JOIN boards b ON b.id=t.board_id JOIN users u ON u.id=t.author_id WHERE t.id=$1 AND t.status='published' AND t.deleted_at IS NULL AND b.visibility='public' AND b.deleted_at IS NULL AND u.status='active' AND daoyun_can_access_content('topic',t.id,$2,CURRENT_TIMESTAMP) FOR UPDATE OF t").bind(topic).bind(viewer).fetch_optional(&mut **tx).await?.ok_or(PollError::NotFound)
}
async fn active_user(tx: &mut Transaction<'_, Postgres>, user: Uuid) -> Result<(), PollError> {
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM users WHERE id=$1 FOR UPDATE")
            .bind(user)
            .fetch_optional(&mut **tx)
            .await?;
    if status.as_deref() != Some("active") {
        return Err(PollError::Forbidden);
    }
    Ok(())
}
impl Database {
    pub async fn poll_policy(&self, user: Option<Uuid>) -> Result<(bool, bool), PollError> {
        let mut tx = self.pool.begin().await?;
        let enabled = match provider(&mut tx, None).await {
            Ok(_) => true,
            Err(PollError::Disabled) => false,
            Err(e) => return Err(e),
        };
        let can_create = if let Some(user) = user {
            match verify_community_action_with_executor(
                &mut tx,
                user,
                "topic.poll.create",
                OffsetDateTime::now_utc(),
            )
            .await
            {
                Ok(()) => enabled,
                Err(CommunityActionError::Database(e)) => return Err(e.into()),
                Err(_) => false,
            }
        } else {
            false
        };
        tx.commit().await?;
        Ok((enabled, can_create))
    }
    pub async fn topic_poll(
        &self,
        topic: Uuid,
        viewer: Option<Uuid>,
    ) -> Result<Option<PollRecord>, PollError> {
        let mut tx = self.pool.begin().await?;
        let (author, board, locked) = topic_access(&mut tx, topic, viewer).await?;
        let row:Option<(String,String,OffsetDateTime,i64,bool)>=sqlx::query_as("SELECT provider_key,question,ends_at,revision,ends_at<=CURRENT_TIMESTAMP FROM topic_polls WHERE topic_id=$1 FOR SHARE").bind(topic).fetch_optional(&mut *tx).await?;
        let Some((key, question, ends_at, revision, closed)) = row else {
            tx.commit().await?;
            return Ok(None);
        };
        let enabled = match provider(&mut tx, Some(&key)).await {
            Ok(_) => true,
            Err(PollError::Disabled) => false,
            Err(e) => return Err(e),
        };
        let selected_option: Option<Uuid> = sqlx::query_scalar(
            "SELECT option_id FROM topic_poll_votes WHERE topic_id=$1 AND user_id=$2",
        )
        .bind(topic)
        .bind(viewer)
        .fetch_optional(&mut *tx)
        .await?;
        let visible = closed || selected_option.is_some();
        let options=sqlx::query_as::<_,PollOptionRecord>("SELECT o.id,o.label,CASE WHEN $2 THEN (SELECT count(*) FROM topic_poll_votes v WHERE v.topic_id=o.topic_id AND v.option_id=o.id) ELSE NULL END AS votes FROM topic_poll_options o WHERE topic_id=$1 ORDER BY position").bind(topic).bind(visible).fetch_all(&mut *tx).await?;
        let voted: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM topic_poll_votes WHERE topic_id=$1)")
                .bind(topic)
                .fetch_one(&mut *tx)
                .await?;
        let can_edit = viewer == Some(author) && enabled && !closed && !locked && !voted;
        let total_votes = visible.then(|| options.iter().map(|o| o.votes.unwrap_or(0)).sum());
        let mut can_vote =
            viewer.is_some() && enabled && !locked && !closed && selected_option.is_none();
        if let Some(user) = viewer
            && can_vote
        {
            match verify_community_action_with_executor(
                &mut tx,
                user,
                "reply.create",
                OffsetDateTime::now_utc(),
            )
            .await
            {
                Ok(()) => {}
                Err(CommunityActionError::Database(e)) => return Err(e.into()),
                Err(_) => can_vote = false,
            };
            if crate::board_user_restrictions::is_board_user_action_restricted_with_executor(
                &mut tx,
                user,
                board,
                "reply.create",
                OffsetDateTime::now_utc(),
            )
            .await?
            {
                can_vote = false
            }
        }
        tx.commit().await?;
        Ok(Some(PollRecord {
            topic_id: topic,
            question,
            ends_at,
            revision,
            enabled,
            closed,
            can_vote,
            can_edit,
            selected_option,
            total_votes,
            options,
        }))
    }
    pub async fn vote_poll(&self, user: Uuid, topic: Uuid, option: Uuid) -> Result<(), PollError> {
        let mut tx = self.pool.begin().await?;
        active_user(&mut tx, user).await?;
        let (_, board, locked) = topic_access(&mut tx, topic, Some(user)).await?;
        let row: Option<(String, OffsetDateTime)> = sqlx::query_as(
            "SELECT provider_key,ends_at FROM topic_polls WHERE topic_id=$1 FOR UPDATE",
        )
        .bind(topic)
        .fetch_optional(&mut *tx)
        .await?;
        let (key, ends_at) = row.ok_or(PollError::NotFound)?;
        let now: OffsetDateTime = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut *tx)
            .await?;
        let closed = ends_at <= now;
        let prior: Option<Uuid> = sqlx::query_scalar(
            "SELECT option_id FROM topic_poll_votes WHERE topic_id=$1 AND user_id=$2",
        )
        .bind(topic)
        .bind(user)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(prior) = prior {
            if prior != option {
                return Err(PollError::AlreadyVoted);
            }
            tx.commit().await?;
            return Ok(());
        }
        provider(&mut tx, Some(&key)).await?;
        if locked || closed {
            return Err(PollError::Closed);
        }
        verify_community_action_with_executor(
            &mut tx,
            user,
            "reply.create",
            OffsetDateTime::now_utc(),
        )
        .await
        .map_err(action_error)?;
        if crate::board_user_restrictions::is_board_user_action_restricted_with_executor(
            &mut tx,
            user,
            board,
            "reply.create",
            OffsetDateTime::now_utc(),
        )
        .await?
        {
            return Err(PollError::Forbidden);
        }
        let valid: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM topic_poll_options WHERE topic_id=$1 AND id=$2)",
        )
        .bind(topic)
        .bind(option)
        .fetch_one(&mut *tx)
        .await?;
        if !valid {
            return Err(PollError::InvalidOption);
        }
        sqlx::query("INSERT INTO topic_poll_votes(topic_id,user_id,option_id) VALUES($1,$2,$3)")
            .bind(topic)
            .bind(user)
            .bind(option)
            .execute(&mut *tx)
            .await?;
        crate::admin::insert_audit(
            &mut tx,
            user,
            "topic.poll.vote",
            "topic",
            Some(topic),
            json!({}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn update_poll(
        &self,
        user: Uuid,
        topic: Uuid,
        expected: i64,
        input: NewPollRecord,
    ) -> Result<(), PollError> {
        let mut tx = self.pool.begin().await?;
        active_user(&mut tx, user).await?;
        let (author, _, locked) = topic_access(&mut tx, topic, Some(user)).await?;
        if author != user {
            return Err(PollError::Forbidden);
        }
        if locked {
            return Err(PollError::Closed);
        }
        let row:Option<(String,i64,OffsetDateTime,OffsetDateTime)>=sqlx::query_as("SELECT provider_key,revision,ends_at,created_at FROM topic_polls WHERE topic_id=$1 FOR UPDATE").bind(topic).fetch_optional(&mut *tx).await?;
        let (key, revision, ends_at, created_at) = row.ok_or(PollError::NotFound)?;
        let now: OffsetDateTime = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut *tx)
            .await?;
        let closed = ends_at <= now;
        if input.ends_at > created_at + Duration::days(30) {
            return Err(PollError::InvalidInput);
        }
        provider(&mut tx, Some(&key)).await?;
        if closed {
            return Err(PollError::Closed);
        }
        let voted: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM topic_poll_votes WHERE topic_id=$1)")
                .bind(topic)
                .fetch_one(&mut *tx)
                .await?;
        if expected != revision || voted {
            return Err(PollError::Conflict);
        }
        let now: OffsetDateTime = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut *tx)
            .await?;
        validate(&input, now)?;
        verify_community_action_with_executor(&mut tx, user, "topic.poll.create", now)
            .await
            .map_err(action_error)?;
        sqlx::query("DELETE FROM topic_poll_options WHERE topic_id=$1")
            .bind(topic)
            .execute(&mut *tx)
            .await?;
        options(&mut tx, topic, &input).await?;
        sqlx::query(
            "UPDATE topic_polls SET question=$2,ends_at=$3,revision=revision+1 WHERE topic_id=$1",
        )
        .bind(topic)
        .bind(input.question.trim())
        .bind(input.ends_at)
        .execute(&mut *tx)
        .await?;
        crate::admin::insert_audit(
            &mut tx,
            user,
            "topic.poll.update",
            "topic",
            Some(topic),
            json!({"revision":revision+1}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
