use std::{collections::BTreeSet, error::Error, fmt};

use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::{Database, DatabaseError};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentAccessPolicySubjectRecord {
    pub subject_type: String,
    pub community_group_id: Option<Uuid>,
    pub subject_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentAccessPolicyRecord {
    pub id: Uuid,
    pub target_type: String,
    pub target_id: Uuid,
    pub operator: String,
    pub subjects: Vec<ContentAccessPolicySubjectRecord>,
    pub revision: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct PutContentAccessPolicyRecord {
    pub target_type: String,
    pub target_id: Uuid,
    pub operator: String,
    pub subjects: Vec<ContentAccessPolicySubjectRecord>,
    pub expected_revision: Option<i64>,
}

#[derive(Debug)]
pub enum ContentAccessPolicyMutationError {
    Forbidden,
    TargetNotFound,
    RevisionConflict,
    InvalidInput,
    SubjectUnavailable,
    Database(DatabaseError),
}

#[derive(FromRow)]
struct ContentAccessPolicyRow {
    id: Uuid,
    target_type: String,
    target_id: Uuid,
    operator: String,
    revision: i64,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

impl Database {
    pub async fn content_access_policy(
        &self,
        target_type: &str,
        target_id: Uuid,
    ) -> Result<Option<ContentAccessPolicyRecord>, DatabaseError> {
        let row = sqlx::query_as::<_, ContentAccessPolicyRow>(
            "SELECT id, target_type, target_id, operator, revision, created_at, updated_at
             FROM content_access_policies
             WHERE target_type = $1 AND target_id = $2",
        )
        .bind(target_type)
        .bind(target_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        Ok(Some(load_policy_from_pool(&self.pool, row).await?))
    }

    pub async fn put_content_access_policy(
        &self,
        actor_id: Uuid,
        input: PutContentAccessPolicyRecord,
    ) -> Result<ContentAccessPolicyRecord, ContentAccessPolicyMutationError> {
        if !valid_policy_input(&input) {
            return Err(ContentAccessPolicyMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::CONTENT_ACCESS_POLICIES_WRITE,
            None,
        )
        .await?
        {
            return Err(ContentAccessPolicyMutationError::Forbidden);
        }
        let target_exists = target_exists(
            &mut transaction,
            input.target_type.as_str(),
            input.target_id,
        )
        .await?;
        if !target_exists {
            return Err(ContentAccessPolicyMutationError::TargetNotFound);
        }
        validate_subject_references(&mut transaction, &input.subjects).await?;

        let current = sqlx::query_as::<_, ContentAccessPolicyRow>(
            "SELECT id, target_type, target_id, operator, revision, created_at, updated_at
             FROM content_access_policies
             WHERE target_type = $1 AND target_id = $2
             FOR UPDATE",
        )
        .bind(&input.target_type)
        .bind(input.target_id)
        .fetch_optional(&mut *transaction)
        .await?;

        let policy_id = if let Some(current) = current {
            if input.expected_revision != Some(current.revision) {
                return Err(ContentAccessPolicyMutationError::RevisionConflict);
            }
            sqlx::query(
                "UPDATE content_access_policies
                 SET operator = $2, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1",
            )
            .bind(current.id)
            .bind(&input.operator)
            .execute(&mut *transaction)
            .await?;
            current.id
        } else {
            if input.expected_revision.is_some() {
                return Err(ContentAccessPolicyMutationError::RevisionConflict);
            }
            let policy_id = Uuid::now_v7();
            sqlx::query(
                "INSERT INTO content_access_policies (
                    id, target_type, target_id, operator
                 ) VALUES ($1, $2, $3, $4)",
            )
            .bind(policy_id)
            .bind(&input.target_type)
            .bind(input.target_id)
            .bind(&input.operator)
            .execute(&mut *transaction)
            .await?;
            policy_id
        };

        sqlx::query("DELETE FROM content_access_policy_subjects WHERE policy_id = $1")
            .bind(policy_id)
            .execute(&mut *transaction)
            .await?;
        for subject in &input.subjects {
            sqlx::query(
                "INSERT INTO content_access_policy_subjects (
                    id, policy_id, subject_type, community_group_id, subject_key
                 ) VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(Uuid::now_v7())
            .bind(policy_id)
            .bind(&subject.subject_type)
            .bind(subject.community_group_id)
            .bind(subject.subject_key.as_deref())
            .execute(&mut *transaction)
            .await?;
        }
        insert_audit(
            &mut transaction,
            actor_id,
            "content.access_policy.put",
            "content_access_policy",
            Some(policy_id),
            serde_json::json!({
                "target_type": input.target_type,
                "target_id": input.target_id,
                "operator": input.operator,
                "subject_count": input.subjects.len()
            }),
        )
        .await?;
        let row = sqlx::query_as::<_, ContentAccessPolicyRow>(
            "SELECT id, target_type, target_id, operator, revision, created_at, updated_at
             FROM content_access_policies WHERE id = $1",
        )
        .bind(policy_id)
        .fetch_one(&mut *transaction)
        .await?;
        let record = load_policy_from_transaction(&mut transaction, row).await?;
        transaction.commit().await?;
        Ok(record)
    }
}

async fn target_exists(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    target_type: &str,
    target_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT CASE $1
            WHEN 'board' THEN EXISTS (
                SELECT 1 FROM boards WHERE id = $2 AND deleted_at IS NULL
            )
            WHEN 'topic' THEN EXISTS (
                SELECT 1 FROM topics WHERE id = $2 AND deleted_at IS NULL
            )
            WHEN 'post' THEN EXISTS (
                SELECT 1 FROM posts WHERE id = $2 AND deleted_at IS NULL
            )
            WHEN 'attachment' THEN EXISTS (
                SELECT 1 FROM topic_attachments WHERE id = $2
            )
            ELSE FALSE
         END",
    )
    .bind(target_type)
    .bind(target_id)
    .fetch_one(&mut **transaction)
    .await
}

async fn validate_subject_references(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    subjects: &[ContentAccessPolicySubjectRecord],
) -> Result<(), ContentAccessPolicyMutationError> {
    for subject in subjects {
        let available = match subject.subject_type.as_str() {
            "community_group" => {
                sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS (
                        SELECT 1 FROM community_groups
                        WHERE id = $1 AND status = 'active'
                     )",
                )
                .bind(subject.community_group_id)
                .fetch_one(&mut **transaction)
                .await?
            }
            "entitlement" => {
                sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS (
                        SELECT 1 FROM standard_entitlement_types
                        WHERE internal_key = $1
                     )",
                )
                .bind(subject.subject_key.as_deref())
                .fetch_one(&mut **transaction)
                .await?
            }
            "governance" => {
                sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS (
                        SELECT 1 FROM permissions
                        WHERE permission_key = $1
                          AND (
                              permission_key LIKE 'governance.%'
                              OR permission_key LIKE 'moderation.%'
                              OR permission_key = 'audit.related.read'
                          )
                     )",
                )
                .bind(subject.subject_key.as_deref())
                .fetch_one(&mut **transaction)
                .await?
            }
            _ => true,
        };
        if !available {
            return Err(ContentAccessPolicyMutationError::SubjectUnavailable);
        }
    }
    Ok(())
}

fn valid_policy_input(input: &PutContentAccessPolicyRecord) -> bool {
    if !matches!(
        input.target_type.as_str(),
        "board" | "topic" | "post" | "attachment"
    ) || !matches!(input.operator.as_str(), "any_of" | "all_of")
        || input.subjects.is_empty()
        || input.subjects.len() > 32
        || input.expected_revision.is_some_and(|revision| revision < 1)
    {
        return false;
    }
    let mut unique = BTreeSet::new();
    input.subjects.iter().all(|subject| {
        let shape_is_valid = match subject.subject_type.as_str() {
            "public" | "authenticated" => {
                subject.community_group_id.is_none() && subject.subject_key.is_none()
            }
            "community_group" => {
                subject.community_group_id.is_some() && subject.subject_key.is_none()
            }
            "entitlement" | "governance" => {
                subject.community_group_id.is_none()
                    && subject.subject_key.as_deref().is_some_and(valid_policy_key)
            }
            _ => false,
        };
        shape_is_valid
            && unique.insert((
                subject.subject_type.clone(),
                subject.community_group_id,
                subject.subject_key.clone(),
            ))
    })
}

fn valid_policy_key(value: &str) -> bool {
    value == value.trim()
        && (1..=128).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'.' | b'_' | b'-' | b':')
        })
}

async fn load_policy_from_pool(
    pool: &sqlx::PgPool,
    row: ContentAccessPolicyRow,
) -> Result<ContentAccessPolicyRecord, sqlx::Error> {
    let subjects = load_subjects(pool, row.id).await?;
    Ok(build_policy(row, subjects))
}

async fn load_policy_from_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    row: ContentAccessPolicyRow,
) -> Result<ContentAccessPolicyRecord, sqlx::Error> {
    let subjects = sqlx::query_as::<_, ContentAccessPolicySubjectRow>(
        "SELECT subject_type, community_group_id, subject_key
         FROM content_access_policy_subjects
         WHERE policy_id = $1
         ORDER BY subject_type, community_group_id, subject_key",
    )
    .bind(row.id)
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .map(ContentAccessPolicySubjectRecord::from)
    .collect();
    Ok(build_policy(row, subjects))
}

async fn load_subjects(
    pool: &sqlx::PgPool,
    policy_id: Uuid,
) -> Result<Vec<ContentAccessPolicySubjectRecord>, sqlx::Error> {
    Ok(sqlx::query_as::<_, ContentAccessPolicySubjectRow>(
        "SELECT subject_type, community_group_id, subject_key
         FROM content_access_policy_subjects
         WHERE policy_id = $1
         ORDER BY subject_type, community_group_id, subject_key",
    )
    .bind(policy_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(ContentAccessPolicySubjectRecord::from)
    .collect())
}

#[derive(FromRow)]
struct ContentAccessPolicySubjectRow {
    subject_type: String,
    community_group_id: Option<Uuid>,
    subject_key: Option<String>,
}

impl From<ContentAccessPolicySubjectRow> for ContentAccessPolicySubjectRecord {
    fn from(value: ContentAccessPolicySubjectRow) -> Self {
        Self {
            subject_type: value.subject_type,
            community_group_id: value.community_group_id,
            subject_key: value.subject_key,
        }
    }
}

fn build_policy(
    row: ContentAccessPolicyRow,
    subjects: Vec<ContentAccessPolicySubjectRecord>,
) -> ContentAccessPolicyRecord {
    ContentAccessPolicyRecord {
        id: row.id,
        target_type: row.target_type,
        target_id: row.target_id,
        operator: row.operator,
        subjects,
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

impl From<sqlx::Error> for ContentAccessPolicyMutationError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(value))
    }
}

impl fmt::Display for ContentAccessPolicyMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Forbidden => formatter.write_str("content access policy mutation is forbidden"),
            Self::TargetNotFound => formatter.write_str("content access target not found"),
            Self::RevisionConflict => {
                formatter.write_str("content access policy revision conflict")
            }
            Self::InvalidInput => formatter.write_str("invalid content access policy input"),
            Self::SubjectUnavailable => formatter.write_str("content access subject unavailable"),
            Self::Database(error) => {
                write!(formatter, "content access policy database error: {error}")
            }
        }
    }
}

impl Error for ContentAccessPolicyMutationError {}
