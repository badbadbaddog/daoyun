use serde_json::json;
use sqlx::{FromRow, Postgres, Transaction, types::Json, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::{Database, DatabaseError};

const MAX_COMPONENT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginRecord {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub capabilities: Vec<String>,
    pub component_sha256: String,
    pub component_size: i64,
    pub status: String,
    pub revision: i64,
    pub installed_by: Uuid,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginExecutableRecord {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub capabilities: Vec<String>,
    pub component_bytes: Vec<u8>,
    pub component_sha256: String,
    pub revision: i64,
}

#[derive(Debug)]
pub struct InstallPluginRecord {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub capabilities: Vec<String>,
    pub component_bytes: Vec<u8>,
    pub component_sha256: String,
}

#[derive(Debug)]
pub struct UpdatePluginStatusRecord {
    pub plugin_id: Uuid,
    pub status: String,
    pub expected_revision: i64,
}

#[derive(Debug)]
pub enum ListPluginsError {
    Forbidden,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum PluginMutationError {
    Forbidden,
    NotFound,
    Conflict,
    MustBeDisabled,
    InvalidInput,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum PluginInvokeError {
    Forbidden,
    NotFound,
    Disabled,
    CapabilityDenied,
    Database(DatabaseError),
}

#[derive(FromRow)]
struct PluginRow {
    id: Uuid,
    key: String,
    name: String,
    version: String,
    description: String,
    capabilities: Json<Vec<String>>,
    component_sha256: String,
    component_size: i64,
    status: String,
    revision: i64,
    installed_by: Uuid,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(FromRow)]
struct PluginExecutableRow {
    id: Uuid,
    key: String,
    name: String,
    version: String,
    description: String,
    capabilities: Json<Vec<String>>,
    component_bytes: Vec<u8>,
    component_sha256: String,
    revision: i64,
}

impl Database {
    pub async fn list_plugins(
        &self,
        actor_id: Uuid,
    ) -> Result<Vec<PluginRecord>, ListPluginsError> {
        let mut connection = self.pool.acquire().await?;
        if !has_permission_with_executor(
            &mut connection,
            actor_id,
            permission_keys::PLUGINS_READ,
            None,
        )
        .await?
        {
            return Err(ListPluginsError::Forbidden);
        }
        let rows = sqlx::query_as::<_, PluginRow>(
            "SELECT id, key, name, version, description, capabilities,
                    component_sha256, octet_length(component_bytes)::bigint AS component_size,
                    status, revision, installed_by, created_at, updated_at
             FROM plugins
             ORDER BY key",
        )
        .fetch_all(&mut *connection)
        .await?;
        Ok(rows.into_iter().map(PluginRecord::from).collect())
    }

    pub async fn install_plugin(
        &self,
        actor_id: Uuid,
        input: InstallPluginRecord,
    ) -> Result<PluginRecord, PluginMutationError> {
        if !valid_install_input(&input) {
            return Err(PluginMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        authorize_plugin_mutation(&mut transaction, actor_id, permission_keys::PLUGINS_INSTALL)
            .await?;
        let row = sqlx::query_as::<_, PluginRow>(
            "INSERT INTO plugins
             (id, key, name, version, description, capabilities, component_bytes,
              component_sha256, installed_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, key, name, version, description, capabilities,
                       component_sha256, octet_length(component_bytes)::bigint AS component_size,
                       status, revision, installed_by, created_at, updated_at",
        )
        .bind(input.id)
        .bind(&input.key)
        .bind(&input.name)
        .bind(&input.version)
        .bind(&input.description)
        .bind(Json(&input.capabilities))
        .bind(&input.component_bytes)
        .bind(&input.component_sha256)
        .bind(actor_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_plugin_write_error)?;
        insert_audit(
            &mut transaction,
            actor_id,
            "plugin.install",
            "plugin",
            Some(row.id),
            json!({
                "key": row.key,
                "version": row.version,
                "capabilities": row.capabilities.0,
                "component_sha256": row.component_sha256,
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(row.into())
    }

    pub async fn load_plugin_for_lifecycle(
        &self,
        actor_id: Uuid,
        plugin_id: Uuid,
    ) -> Result<PluginExecutableRecord, PluginMutationError> {
        let mut transaction = self.pool.begin().await?;
        authorize_plugin_mutation(
            &mut transaction,
            actor_id,
            permission_keys::PLUGINS_LIFECYCLE,
        )
        .await?;
        let row = fetch_executable(&mut transaction, plugin_id)
            .await?
            .ok_or(PluginMutationError::NotFound)?;
        transaction.commit().await?;
        Ok(row.into())
    }

    pub async fn update_plugin_status(
        &self,
        actor_id: Uuid,
        input: UpdatePluginStatusRecord,
    ) -> Result<PluginRecord, PluginMutationError> {
        if !matches!(input.status.as_str(), "enabled" | "disabled") || input.expected_revision <= 0
        {
            return Err(PluginMutationError::InvalidInput);
        }
        let mut transaction = self.pool.begin().await?;
        authorize_plugin_mutation(
            &mut transaction,
            actor_id,
            permission_keys::PLUGINS_LIFECYCLE,
        )
        .await?;
        let current = sqlx::query_as::<_, (String, i64)>(
            "SELECT status, revision FROM plugins WHERE id = $1 FOR UPDATE",
        )
        .bind(input.plugin_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(PluginMutationError::NotFound)?;
        if current.1 != input.expected_revision {
            return Err(PluginMutationError::Conflict);
        }
        if current.0 == input.status {
            return Err(PluginMutationError::Conflict);
        }
        let row = sqlx::query_as::<_, PluginRow>(
            "UPDATE plugins
             SET status = $2, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id, key, name, version, description, capabilities,
                       component_sha256, octet_length(component_bytes)::bigint AS component_size,
                       status, revision, installed_by, created_at, updated_at",
        )
        .bind(input.plugin_id)
        .bind(&input.status)
        .fetch_one(&mut *transaction)
        .await?;
        let action = if input.status == "enabled" {
            "plugin.lifecycle.enable"
        } else {
            "plugin.lifecycle.disable"
        };
        insert_audit(
            &mut transaction,
            actor_id,
            action,
            "plugin",
            Some(row.id),
            json!({"key": row.key, "status": row.status, "revision": row.revision}),
        )
        .await?;
        transaction.commit().await?;
        Ok(row.into())
    }

    pub async fn delete_plugin(
        &self,
        actor_id: Uuid,
        plugin_id: Uuid,
    ) -> Result<(), PluginMutationError> {
        let mut transaction = self.pool.begin().await?;
        authorize_plugin_mutation(
            &mut transaction,
            actor_id,
            permission_keys::PLUGINS_LIFECYCLE,
        )
        .await?;
        let plugin = sqlx::query_as::<_, (String, String)>(
            "SELECT key, status FROM plugins WHERE id = $1 FOR UPDATE",
        )
        .bind(plugin_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(PluginMutationError::NotFound)?;
        if plugin.1 != "disabled" {
            return Err(PluginMutationError::MustBeDisabled);
        }
        sqlx::query("DELETE FROM plugins WHERE id = $1")
            .bind(plugin_id)
            .execute(&mut *transaction)
            .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "plugin.uninstall",
            "plugin",
            Some(plugin_id),
            json!({"key": plugin.0}),
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn load_plugin_for_invoke(
        &self,
        actor_id: Uuid,
        plugin_id: Uuid,
        capability: &str,
    ) -> Result<PluginExecutableRecord, PluginInvokeError> {
        if !matches!(capability, "content.transform" | "ui.panel") {
            return Err(PluginInvokeError::CapabilityDenied);
        }
        let mut transaction = self.pool.begin().await?;
        authorize_plugin_invoke(&mut transaction, actor_id).await?;
        let row = fetch_executable(&mut transaction, plugin_id)
            .await?
            .ok_or(PluginInvokeError::NotFound)?;
        let status =
            sqlx::query_scalar::<_, String>("SELECT status FROM plugins WHERE id = $1 FOR SHARE")
                .bind(plugin_id)
                .fetch_one(&mut *transaction)
                .await?;
        if status != "enabled" {
            return Err(PluginInvokeError::Disabled);
        }
        if !row.capabilities.0.iter().any(|item| item == capability) {
            return Err(PluginInvokeError::CapabilityDenied);
        }
        insert_audit(
            &mut transaction,
            actor_id,
            "plugin.invoke",
            "plugin",
            Some(plugin_id),
            json!({"key": row.key, "capability": capability, "revision": row.revision}),
        )
        .await?;
        transaction.commit().await?;
        Ok(row.into())
    }
}

async fn fetch_executable(
    transaction: &mut Transaction<'_, Postgres>,
    plugin_id: Uuid,
) -> Result<Option<PluginExecutableRow>, sqlx::Error> {
    sqlx::query_as::<_, PluginExecutableRow>(
        "SELECT id, key, name, version, description, capabilities, component_bytes,
                component_sha256, revision
         FROM plugins
         WHERE id = $1",
    )
    .bind(plugin_id)
    .fetch_optional(&mut **transaction)
    .await
}

async fn authorize_plugin_mutation(
    transaction: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    permission_key: &str,
) -> Result<(), PluginMutationError> {
    let actor_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 FOR UPDATE)",
    )
    .bind(actor_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !actor_exists
        || !has_permission_with_executor(&mut *transaction, actor_id, permission_key, None).await?
    {
        return Err(PluginMutationError::Forbidden);
    }
    Ok(())
}

async fn authorize_plugin_invoke(
    transaction: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
) -> Result<(), PluginInvokeError> {
    let actor_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 FOR UPDATE)",
    )
    .bind(actor_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !actor_exists
        || !has_permission_with_executor(
            &mut *transaction,
            actor_id,
            permission_keys::PLUGINS_INVOKE,
            None,
        )
        .await?
    {
        return Err(PluginInvokeError::Forbidden);
    }
    Ok(())
}

fn valid_install_input(input: &InstallPluginRecord) -> bool {
    let mut capabilities = input.capabilities.clone();
    capabilities.sort();
    capabilities.dedup();
    valid_key(&input.key)
        && bounded_text(&input.name, 1, 80)
        && bounded_text(&input.description, 0, 500)
        && valid_version(&input.version)
        && capabilities == input.capabilities
        && (matches!(
            capabilities.as_slice(),
            [capability] if matches!(capability.as_str(), "content.transform" | "ui.panel")
        ) || capabilities == ["content.transform".to_owned(), "ui.panel".to_owned()])
        && (1..=MAX_COMPONENT_BYTES).contains(&input.component_bytes.len())
        && input.component_sha256.len() == 64
        && input
            .component_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_key(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn valid_version(value: &str) -> bool {
    let mut parts = value.split('.');
    let valid = (0..3).all(|_| {
        parts.next().is_some_and(|part| {
            !part.is_empty()
                && (part == "0" || !part.starts_with('0'))
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && part.parse::<u32>().is_ok()
        })
    });
    valid && parts.next().is_none()
}

fn bounded_text(value: &str, minimum: usize, maximum: usize) -> bool {
    let count = value.chars().count();
    (minimum..=maximum).contains(&count)
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn map_plugin_write_error(error: sqlx::Error) -> PluginMutationError {
    if matches!(
        &error,
        sqlx::Error::Database(database_error)
            if database_error.code().as_deref() == Some("23505")
    ) {
        PluginMutationError::Conflict
    } else {
        PluginMutationError::Database(error.into())
    }
}

impl From<PluginRow> for PluginRecord {
    fn from(row: PluginRow) -> Self {
        Self {
            id: row.id,
            key: row.key,
            name: row.name,
            version: row.version,
            description: row.description,
            capabilities: row.capabilities.0,
            component_sha256: row.component_sha256,
            component_size: row.component_size,
            status: row.status,
            revision: row.revision,
            installed_by: row.installed_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

impl From<PluginExecutableRow> for PluginExecutableRecord {
    fn from(row: PluginExecutableRow) -> Self {
        Self {
            id: row.id,
            key: row.key,
            name: row.name,
            version: row.version,
            description: row.description,
            capabilities: row.capabilities.0,
            component_bytes: row.component_bytes,
            component_sha256: row.component_sha256,
            revision: row.revision,
        }
    }
}

impl From<sqlx::Error> for ListPluginsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl From<sqlx::Error> for PluginMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}

impl From<sqlx::Error> for PluginInvokeError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}
