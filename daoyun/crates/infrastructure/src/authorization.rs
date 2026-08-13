use serde_json::json;
use sqlx::{FromRow, PgConnection, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::{Database, DatabaseError};

pub mod permission_keys {
    pub const ADMIN_CONFIGURATION_READ: &str = "admin.configuration.read";
    pub const ADMIN_CONFIGURATION_WRITE: &str = "admin.configuration.write";
    pub const ADMIN_USERS_READ: &str = "admin.users.read";
    pub const ADMIN_USERS_MODERATE: &str = "admin.users.moderate";
    pub const GOVERNANCE_REPORTS_READ: &str = "governance.reports.read";
    pub const GOVERNANCE_REPORTS_RESOLVE: &str = "governance.reports.resolve";
    pub const MODERATION_TOPIC: &str = "moderation.topic";
    pub const AUDIT_READ: &str = "audit.read";
    pub const ATTACHMENT_CREATE: &str = "attachment.create";
    pub const ATTACHMENT_CLEANUP: &str = "attachment.cleanup";
    pub const GOVERNANCE_POLICY_READ: &str = "governance.policy.read";
    pub const GOVERNANCE_POLICY_WRITE: &str = "governance.policy.write";
    pub const GOVERNANCE_ALERTS_READ: &str = "governance.alerts.read";
    pub const GOVERNANCE_ALERTS_RESOLVE: &str = "governance.alerts.resolve";
    pub const MEMBERSHIP_RULES_READ: &str = "membership.rules.read";
    pub const MEMBERSHIP_RULES_WRITE: &str = "membership.rules.write";
    pub const MEMBERSHIP_POINTS_GRANT: &str = "membership.points.grant";
    pub const MEMBERSHIP_MEDALS_READ: &str = "membership.medals.read";
    pub const MEMBERSHIP_MEDALS_GRANT: &str = "membership.medals.grant";
    pub const MEMBERSHIP_MEDAL_RULES_WRITE: &str = "membership.medals.rules.write";
    pub const AUTHORIZATION_ROLES_READ: &str = "authorization.roles.read";
    pub const AUTHORIZATION_ROLES_WRITE: &str = "authorization.roles.write";
    pub const AUTHORIZATION_ASSIGNMENTS_READ: &str = "authorization.assignments.read";
    pub const AUTHORIZATION_ASSIGNMENTS_WRITE: &str = "authorization.assignments.write";
    pub const OPERATIONS_READ: &str = "operations.read";
    pub const OPERATIONS_ALERTS_WRITE: &str = "operations.alerts.write";
    pub const PLUGINS_READ: &str = "plugins.read";
    pub const PLUGINS_INSTALL: &str = "plugins.install";
    pub const PLUGINS_LIFECYCLE: &str = "plugins.lifecycle";
    pub const PLUGINS_INVOKE: &str = "plugins.invoke";
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct AuthorizationPermissionRecord {
    pub key: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct AuthorizationRoleRecord {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub scope: String,
    pub is_system: bool,
    pub permission_keys: Vec<String>,
    pub assignment_count: i64,
    pub revision: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct AuthorizationRoleAssignmentRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_username: String,
    pub user_display_name: String,
    pub user_avatar_url: Option<String>,
    pub role_id: Uuid,
    pub role_key: String,
    pub role_name: String,
    pub role_scope: String,
    pub role_is_system: bool,
    pub role_revision: i64,
    pub scope_id: Option<Uuid>,
    pub assigned_by_id: Uuid,
    pub assigned_by_username: String,
    pub assigned_by_display_name: String,
    pub assigned_by_avatar_url: Option<String>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug)]
pub enum ListAuthorizationAssignmentsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub struct CreateAuthorizationRoleRecord {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub scope: String,
    pub permission_keys: Vec<String>,
}

#[derive(Debug)]
pub struct UpdateAuthorizationRoleRecord {
    pub role_id: Uuid,
    pub name: String,
    pub permission_keys: Vec<String>,
    pub expected_revision: i64,
}

#[derive(Debug)]
pub enum MutateAuthorizationRoleError {
    Forbidden,
    NotFound,
    Conflict,
    SystemManaged,
    InUse,
    PermissionInvalid,
    Database(DatabaseError),
}

#[derive(Debug)]
pub struct CreateAuthorizationAssignmentRecord {
    pub id: Uuid,
    pub username: String,
    pub role_id: Uuid,
    pub scope_id: Option<Uuid>,
}

#[derive(Debug)]
pub enum MutateAuthorizationAssignmentError {
    Forbidden,
    UserNotFound,
    RoleNotFound,
    AssignmentNotFound,
    Conflict,
    SystemManaged,
    ScopeInvalid,
    PermissionInvalid,
    Database(DatabaseError),
}

impl Database {
    pub async fn list_global_permission_keys(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<String>, DatabaseError> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT permission.permission_key
             FROM users AS account
             INNER JOIN role_assignments AS assignment ON assignment.user_id = account.id
             INNER JOIN roles AS role ON role.id = assignment.role_id
             INNER JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
             INNER JOIN permissions AS permission ON permission.id = role_permission.permission_id
             WHERE account.id = $1
               AND account.status <> 'suspended'
               AND role.scope IN ('instance', 'site')
               AND assignment.scope_id IS NULL
             ORDER BY permission.permission_key",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_authorization_permissions(
        &self,
    ) -> Result<Vec<AuthorizationPermissionRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, AuthorizationPermissionRecord>(
            "SELECT permission_key AS key, name, description
             FROM permissions
             ORDER BY permission_key",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_authorization_roles(
        &self,
    ) -> Result<Vec<AuthorizationRoleRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, AuthorizationRoleRecord>(
            "SELECT role.id, role.key, role.name, role.scope, role.is_system,
                    COALESCE(
                        array_agg(permission.permission_key ORDER BY permission.permission_key)
                            FILTER (WHERE permission.id IS NOT NULL),
                        ARRAY[]::varchar[]
                    ) AS permission_keys,
                    COUNT(DISTINCT assignment.id) AS assignment_count,
                    role.revision, role.created_at, role.updated_at
             FROM roles AS role
             LEFT JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
             LEFT JOIN permissions AS permission ON permission.id = role_permission.permission_id
             LEFT JOIN role_assignments AS assignment ON assignment.role_id = role.id
             GROUP BY role.id
             ORDER BY role.key",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_authorization_role_assignments(
        &self,
        username: Option<&str>,
        role_id: Option<Uuid>,
        scope_id: Option<Uuid>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<AuthorizationRoleAssignmentRecord>, ListAuthorizationAssignmentsError> {
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                     SELECT 1
                     FROM role_assignments AS assignment
                     INNER JOIN users AS account ON account.id = assignment.user_id
                     WHERE assignment.id = $1
                       AND ($2::text IS NULL OR account.username = $2)
                       AND ($3::uuid IS NULL OR assignment.role_id = $3)
                       AND ($4::uuid IS NULL OR assignment.scope_id = $4)
                 )",
            )
            .bind(cursor)
            .bind(username)
            .bind(role_id)
            .bind(scope_id)
            .fetch_one(&self.pool)
            .await?;
            if !valid {
                return Err(ListAuthorizationAssignmentsError::InvalidCursor);
            }
        }

        Ok(sqlx::query_as::<_, AuthorizationRoleAssignmentRecord>(
            "SELECT assignment.id,
                    account.id AS user_id,
                    account.username AS user_username,
                    account.display_name AS user_display_name,
                    account.avatar_url AS user_avatar_url,
                    role.id AS role_id,
                    role.key AS role_key,
                    role.name AS role_name,
                    role.scope AS role_scope,
                    role.is_system AS role_is_system,
                    role.revision AS role_revision,
                    assignment.scope_id,
                    assigner.id AS assigned_by_id,
                    assigner.username AS assigned_by_username,
                    assigner.display_name AS assigned_by_display_name,
                    assigner.avatar_url AS assigned_by_avatar_url,
                    assignment.created_at
             FROM role_assignments AS assignment
             INNER JOIN users AS account ON account.id = assignment.user_id
             INNER JOIN roles AS role ON role.id = assignment.role_id
             INNER JOIN users AS assigner ON assigner.id = assignment.assigned_by
             WHERE ($1::text IS NULL OR account.username = $1)
               AND ($2::uuid IS NULL OR assignment.role_id = $2)
               AND ($3::uuid IS NULL OR assignment.scope_id = $3)
               AND ($4::uuid IS NULL OR (assignment.created_at, assignment.id) < (
                   SELECT cursor.created_at, cursor.id
                   FROM role_assignments AS cursor
                   WHERE cursor.id = $4
               ))
             ORDER BY assignment.created_at DESC, assignment.id DESC
             LIMIT $5",
        )
        .bind(username)
        .bind(role_id)
        .bind(scope_id)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn create_authorization_role(
        &self,
        actor_id: Uuid,
        role: CreateAuthorizationRoleRecord,
    ) -> Result<AuthorizationRoleRecord, MutateAuthorizationRoleError> {
        let mut transaction = self.pool.begin().await?;
        lock_authorization_actor(&mut transaction, actor_id).await?;
        authorize_role_write(&mut transaction, actor_id).await?;
        validate_grant_ceiling(&mut transaction, actor_id, &role.permission_keys).await?;

        let insert = sqlx::query(
            "INSERT INTO roles (id, key, name, scope, is_system) \
             VALUES ($1, $2, $3, $4, FALSE)",
        )
        .bind(role.id)
        .bind(&role.key)
        .bind(&role.name)
        .bind(&role.scope)
        .execute(&mut *transaction)
        .await;
        if let Err(error) = insert {
            return Err(map_role_write_error(error));
        }
        insert_role_permissions(&mut transaction, role.id, &role.permission_keys).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "authorization.role.create",
            "authorization_role",
            Some(role.id),
            json!({
                "key": role.key,
                "scope": role.scope,
                "permission_keys": role.permission_keys,
            }),
        )
        .await?;
        let result = fetch_authorization_role(&mut transaction, role.id)
            .await?
            .ok_or(MutateAuthorizationRoleError::NotFound)?;
        transaction.commit().await?;
        Ok(result)
    }

    pub async fn update_authorization_role(
        &self,
        actor_id: Uuid,
        role: UpdateAuthorizationRoleRecord,
    ) -> Result<AuthorizationRoleRecord, MutateAuthorizationRoleError> {
        let mut transaction = self.pool.begin().await?;
        lock_authorization_actor(&mut transaction, actor_id).await?;
        authorize_role_write(&mut transaction, actor_id).await?;
        let current = sqlx::query_as::<_, (String, String, bool, i64)>(
            "SELECT key, scope, is_system, revision FROM roles WHERE id = $1 FOR UPDATE",
        )
        .bind(role.role_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(MutateAuthorizationRoleError::NotFound)?;
        if current.2 {
            return Err(MutateAuthorizationRoleError::SystemManaged);
        }
        if current.3 != role.expected_revision {
            return Err(MutateAuthorizationRoleError::Conflict);
        }
        validate_grant_ceiling(&mut transaction, actor_id, &role.permission_keys).await?;

        sqlx::query(
            "UPDATE roles \
             SET name = $2, revision = revision + 1, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1",
        )
        .bind(role.role_id)
        .bind(&role.name)
        .execute(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM role_permissions WHERE role_id = $1")
            .bind(role.role_id)
            .execute(&mut *transaction)
            .await?;
        insert_role_permissions(&mut transaction, role.role_id, &role.permission_keys).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "authorization.role.update",
            "authorization_role",
            Some(role.role_id),
            json!({
                "key": current.0,
                "scope": current.1,
                "permission_keys": role.permission_keys,
            }),
        )
        .await?;
        let result = fetch_authorization_role(&mut transaction, role.role_id)
            .await?
            .ok_or(MutateAuthorizationRoleError::NotFound)?;
        transaction.commit().await?;
        Ok(result)
    }

    pub async fn delete_authorization_role(
        &self,
        actor_id: Uuid,
        role_id: Uuid,
    ) -> Result<(), MutateAuthorizationRoleError> {
        let mut transaction = self.pool.begin().await?;
        lock_authorization_actor(&mut transaction, actor_id).await?;
        authorize_role_write(&mut transaction, actor_id).await?;
        let role = sqlx::query_as::<_, (String, String, bool)>(
            "SELECT key, scope, is_system FROM roles WHERE id = $1 FOR UPDATE",
        )
        .bind(role_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(MutateAuthorizationRoleError::NotFound)?;
        if role.2 {
            return Err(MutateAuthorizationRoleError::SystemManaged);
        }
        let in_use = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM role_assignments WHERE role_id = $1)",
        )
        .bind(role_id)
        .fetch_one(&mut *transaction)
        .await?;
        if in_use {
            return Err(MutateAuthorizationRoleError::InUse);
        }
        sqlx::query("DELETE FROM roles WHERE id = $1")
            .bind(role_id)
            .execute(&mut *transaction)
            .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "authorization.role.delete",
            "authorization_role",
            Some(role_id),
            json!({"key": role.0, "scope": role.1}),
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn create_authorization_assignment(
        &self,
        actor_id: Uuid,
        assignment: CreateAuthorizationAssignmentRecord,
    ) -> Result<AuthorizationRoleAssignmentRecord, MutateAuthorizationAssignmentError> {
        let mut transaction = self.pool.begin().await?;
        lock_assignment_actor(&mut transaction, actor_id).await?;
        authorize_assignment_write(&mut transaction, actor_id).await?;
        let user_id =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = $1 FOR UPDATE")
                .bind(&assignment.username)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or(MutateAuthorizationAssignmentError::UserNotFound)?;
        let role = sqlx::query_as::<_, (String, String, bool)>(
            "SELECT key, scope, is_system FROM roles WHERE id = $1 FOR UPDATE",
        )
        .bind(assignment.role_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(MutateAuthorizationAssignmentError::RoleNotFound)?;
        if role.2 {
            return Err(MutateAuthorizationAssignmentError::SystemManaged);
        }
        validate_assignment_scope(&mut transaction, &role.1, assignment.scope_id).await?;
        let permission_keys = sqlx::query_scalar::<_, String>(
            "SELECT permission.permission_key
             FROM role_permissions AS role_permission
             INNER JOIN permissions AS permission ON permission.id = role_permission.permission_id
             WHERE role_permission.role_id = $1
             ORDER BY permission.permission_key",
        )
        .bind(assignment.role_id)
        .fetch_all(&mut *transaction)
        .await?;
        validate_assignment_grant_ceiling(&mut transaction, actor_id, &permission_keys).await?;

        let insert = sqlx::query(
            "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(assignment.id)
        .bind(user_id)
        .bind(assignment.role_id)
        .bind(actor_id)
        .bind(assignment.scope_id)
        .execute(&mut *transaction)
        .await;
        if let Err(error) = insert {
            return Err(map_assignment_write_error(error));
        }
        insert_audit(
            &mut transaction,
            actor_id,
            "authorization.assignment.create",
            "authorization_assignment",
            Some(assignment.id),
            json!({
                "role_key": role.0,
                "target_username": assignment.username,
                "scope_id": assignment.scope_id,
            }),
        )
        .await?;
        let result = fetch_authorization_assignment(&mut transaction, assignment.id)
            .await?
            .ok_or(MutateAuthorizationAssignmentError::AssignmentNotFound)?;
        transaction.commit().await?;
        Ok(result)
    }

    pub async fn delete_authorization_assignment(
        &self,
        actor_id: Uuid,
        assignment_id: Uuid,
    ) -> Result<(), MutateAuthorizationAssignmentError> {
        let mut transaction = self.pool.begin().await?;
        lock_assignment_actor(&mut transaction, actor_id).await?;
        authorize_assignment_write(&mut transaction, actor_id).await?;
        let assignment = sqlx::query_as::<_, (String, String, bool, Option<Uuid>)>(
            "SELECT account.username, role.key, role.is_system, assignment.scope_id
             FROM role_assignments AS assignment
             INNER JOIN users AS account ON account.id = assignment.user_id
             INNER JOIN roles AS role ON role.id = assignment.role_id
             WHERE assignment.id = $1
             FOR UPDATE OF assignment, account, role",
        )
        .bind(assignment_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(MutateAuthorizationAssignmentError::AssignmentNotFound)?;
        if assignment.2 {
            return Err(MutateAuthorizationAssignmentError::SystemManaged);
        }
        sqlx::query("DELETE FROM role_assignments WHERE id = $1")
            .bind(assignment_id)
            .execute(&mut *transaction)
            .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "authorization.assignment.delete",
            "authorization_assignment",
            Some(assignment_id),
            json!({
                "role_key": assignment.1,
                "target_username": assignment.0,
                "scope_id": assignment.3,
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn has_permission(
        &self,
        user_id: Uuid,
        permission_key: &str,
        resource_scope_id: Option<Uuid>,
    ) -> Result<bool, DatabaseError> {
        let mut connection = self.pool.acquire().await?;
        Ok(has_permission_with_executor(
            &mut connection,
            user_id,
            permission_key,
            resource_scope_id,
        )
        .await?)
    }
}

async fn lock_authorization_actor(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor_id: Uuid,
) -> Result<(), MutateAuthorizationRoleError> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 FOR UPDATE)",
    )
    .bind(actor_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !exists {
        return Err(MutateAuthorizationRoleError::Forbidden);
    }
    Ok(())
}

async fn authorize_role_write(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor_id: Uuid,
) -> Result<(), MutateAuthorizationRoleError> {
    if !has_permission_with_executor(
        &mut *transaction,
        actor_id,
        permission_keys::AUTHORIZATION_ROLES_WRITE,
        None,
    )
    .await?
    {
        return Err(MutateAuthorizationRoleError::Forbidden);
    }
    Ok(())
}

async fn validate_grant_ceiling(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor_id: Uuid,
    permission_keys: &[String],
) -> Result<(), MutateAuthorizationRoleError> {
    if permission_keys.is_empty() {
        return Err(MutateAuthorizationRoleError::PermissionInvalid);
    }
    let permitted = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT requested.permission_key)
         FROM permissions AS requested
         WHERE requested.permission_key = ANY($2)
           AND EXISTS (
               SELECT 1
               FROM users AS account
               INNER JOIN role_assignments AS assignment ON assignment.user_id = account.id
               INNER JOIN roles AS role ON role.id = assignment.role_id
               INNER JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
               WHERE account.id = $1
                 AND account.status <> 'suspended'
                 AND role.scope IN ('instance', 'site')
                 AND assignment.scope_id IS NULL
                 AND role_permission.permission_id = requested.id
           )",
    )
    .bind(actor_id)
    .bind(permission_keys)
    .fetch_one(&mut **transaction)
    .await?;
    if usize::try_from(permitted).ok() != Some(permission_keys.len()) {
        return Err(MutateAuthorizationRoleError::PermissionInvalid);
    }
    Ok(())
}

async fn insert_role_permissions(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role_id: Uuid,
    permission_keys: &[String],
) -> Result<(), MutateAuthorizationRoleError> {
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE permission_key = ANY($2)",
    )
    .bind(role_id)
    .bind(permission_keys)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn fetch_authorization_role(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role_id: Uuid,
) -> Result<Option<AuthorizationRoleRecord>, sqlx::Error> {
    sqlx::query_as::<_, AuthorizationRoleRecord>(
        "SELECT role.id, role.key, role.name, role.scope, role.is_system,
                COALESCE(
                    array_agg(permission.permission_key ORDER BY permission.permission_key)
                        FILTER (WHERE permission.id IS NOT NULL),
                    ARRAY[]::varchar[]
                ) AS permission_keys,
                COUNT(DISTINCT assignment.id) AS assignment_count,
                role.revision, role.created_at, role.updated_at
         FROM roles AS role
         LEFT JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
         LEFT JOIN permissions AS permission ON permission.id = role_permission.permission_id
         LEFT JOIN role_assignments AS assignment ON assignment.role_id = role.id
         WHERE role.id = $1
         GROUP BY role.id",
    )
    .bind(role_id)
    .fetch_optional(&mut **transaction)
    .await
}

fn map_role_write_error(error: sqlx::Error) -> MutateAuthorizationRoleError {
    if matches!(
        &error,
        sqlx::Error::Database(database_error)
            if database_error.code().as_deref() == Some("23505")
    ) {
        MutateAuthorizationRoleError::Conflict
    } else {
        MutateAuthorizationRoleError::Database(error.into())
    }
}

async fn lock_assignment_actor(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor_id: Uuid,
) -> Result<(), MutateAuthorizationAssignmentError> {
    let actor = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE id = $1 FOR UPDATE")
        .bind(actor_id)
        .fetch_optional(&mut **transaction)
        .await?;
    if actor.is_none() {
        return Err(MutateAuthorizationAssignmentError::Forbidden);
    }
    Ok(())
}

async fn authorize_assignment_write(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor_id: Uuid,
) -> Result<(), MutateAuthorizationAssignmentError> {
    if !has_permission_with_executor(
        &mut *transaction,
        actor_id,
        permission_keys::AUTHORIZATION_ASSIGNMENTS_WRITE,
        None,
    )
    .await?
    {
        return Err(MutateAuthorizationAssignmentError::Forbidden);
    }
    Ok(())
}

async fn validate_assignment_scope(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role_scope: &str,
    scope_id: Option<Uuid>,
) -> Result<(), MutateAuthorizationAssignmentError> {
    match (role_scope, scope_id) {
        ("instance" | "site", None) => Ok(()),
        ("board", Some(board_id)) => {
            let available = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM boards WHERE id = $1 AND deleted_at IS NULL)",
            )
            .bind(board_id)
            .fetch_one(&mut **transaction)
            .await?;
            if available {
                Ok(())
            } else {
                Err(MutateAuthorizationAssignmentError::ScopeInvalid)
            }
        }
        _ => Err(MutateAuthorizationAssignmentError::ScopeInvalid),
    }
}

async fn validate_assignment_grant_ceiling(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor_id: Uuid,
    permission_keys: &[String],
) -> Result<(), MutateAuthorizationAssignmentError> {
    if permission_keys.is_empty() {
        return Err(MutateAuthorizationAssignmentError::PermissionInvalid);
    }
    let permitted = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT requested.permission_key)
         FROM permissions AS requested
         WHERE requested.permission_key = ANY($2)
           AND EXISTS (
               SELECT 1
               FROM users AS account
               INNER JOIN role_assignments AS assignment ON assignment.user_id = account.id
               INNER JOIN roles AS role ON role.id = assignment.role_id
               INNER JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
               WHERE account.id = $1
                 AND account.status <> 'suspended'
                 AND role.scope IN ('instance', 'site')
                 AND assignment.scope_id IS NULL
                 AND role_permission.permission_id = requested.id
           )",
    )
    .bind(actor_id)
    .bind(permission_keys)
    .fetch_one(&mut **transaction)
    .await?;
    if usize::try_from(permitted).ok() != Some(permission_keys.len()) {
        return Err(MutateAuthorizationAssignmentError::PermissionInvalid);
    }
    Ok(())
}

async fn fetch_authorization_assignment(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    assignment_id: Uuid,
) -> Result<Option<AuthorizationRoleAssignmentRecord>, sqlx::Error> {
    sqlx::query_as::<_, AuthorizationRoleAssignmentRecord>(
        "SELECT assignment.id,
                account.id AS user_id,
                account.username AS user_username,
                account.display_name AS user_display_name,
                account.avatar_url AS user_avatar_url,
                role.id AS role_id,
                role.key AS role_key,
                role.name AS role_name,
                role.scope AS role_scope,
                role.is_system AS role_is_system,
                role.revision AS role_revision,
                assignment.scope_id,
                assigner.id AS assigned_by_id,
                assigner.username AS assigned_by_username,
                assigner.display_name AS assigned_by_display_name,
                assigner.avatar_url AS assigned_by_avatar_url,
                assignment.created_at
         FROM role_assignments AS assignment
         INNER JOIN users AS account ON account.id = assignment.user_id
         INNER JOIN roles AS role ON role.id = assignment.role_id
         INNER JOIN users AS assigner ON assigner.id = assignment.assigned_by
         WHERE assignment.id = $1",
    )
    .bind(assignment_id)
    .fetch_optional(&mut **transaction)
    .await
}

fn map_assignment_write_error(error: sqlx::Error) -> MutateAuthorizationAssignmentError {
    if matches!(
        &error,
        sqlx::Error::Database(database_error)
            if database_error.code().as_deref() == Some("23505")
    ) {
        MutateAuthorizationAssignmentError::Conflict
    } else {
        MutateAuthorizationAssignmentError::Database(error.into())
    }
}

impl From<sqlx::Error> for ListAuthorizationAssignmentsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl From<sqlx::Error> for MutateAuthorizationRoleError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl From<sqlx::Error> for MutateAuthorizationAssignmentError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

pub(crate) async fn has_permission_with_executor(
    connection: &mut PgConnection,
    user_id: Uuid,
    permission_key: &str,
    resource_scope_id: Option<Uuid>,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
             SELECT 1
             FROM users AS account
             INNER JOIN role_assignments AS assignment ON assignment.user_id = account.id
             INNER JOIN roles AS role ON role.id = assignment.role_id
             INNER JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
             INNER JOIN permissions AS permission ON permission.id = role_permission.permission_id
             WHERE account.id = $1
               AND account.status <> 'suspended'
               AND permission.permission_key = $2
               AND (
                   (role.scope IN ('instance', 'site') AND assignment.scope_id IS NULL)
                   OR (
                       role.scope = 'board'
                       AND assignment.scope_id IS NOT NULL
                       AND assignment.scope_id = $3
                   )
               )
         )",
    )
    .bind(user_id)
    .bind(permission_key)
    .bind(resource_scope_id)
    .fetch_one(&mut *connection)
    .await
}
