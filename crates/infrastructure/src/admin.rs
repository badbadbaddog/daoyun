use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{
    FromRow,
    types::{Json, Uuid},
};
use time::OffsetDateTime;

use crate::authorization::permission_keys;
use crate::{Database, DatabaseError, NewOutboxEvent, OutboxError};

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct SiteBrandingRecord {
    pub site_name: String,
    pub logo_url: Option<String>,
    pub favicon_url: Option<String>,
    pub default_cover_url: Option<String>,
    pub navigation_links: Json<Vec<BrandLinkRecord>>,
    pub footer_text: Option<String>,
    pub footer_links: Json<Vec<BrandLinkRecord>>,
    pub primary_color: String,
    pub accent_color: String,
    pub theme_preset: String,
    pub list_density: String,
    pub home_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandLinkRecord {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct BrandAssetRecord {
    pub kind: String,
    pub storage_key: String,
    pub mime_type: String,
    pub sha256: Vec<u8>,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct AdminBoardRecord {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: String,
    pub position: i32,
    pub visibility: String,
    pub topic_count: i64,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct AdminBoardDeletionImpactRecord {
    pub board_id: Uuid,
    pub child_count: i64,
    pub topic_count: i64,
    pub reply_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
struct BoardHierarchyRecord {
    id: Uuid,
    parent_id: Option<Uuid>,
    revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct AdminAuditRecord {
    pub id: Uuid,
    pub actor_id: Uuid,
    pub actor_username: String,
    pub actor_display_name: String,
    pub actor_avatar_url: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub summary: Json<serde_json::Value>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Default)]
pub struct ListAdminAuditFilter<'a> {
    pub actor_id: Option<Uuid>,
    pub action: Option<&'a str>,
    pub resource_type: Option<&'a str>,
    pub resource_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub report_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct GovernancePolicyRecord {
    pub enabled: bool,
    pub alert_score_threshold: i16,
    pub reporter_window_minutes: i16,
    pub reporter_alert_limit: i16,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct RiskAlertRecord {
    pub id: Uuid,
    pub kind: String,
    pub severity: String,
    pub score: i16,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub reporter_id: Option<Uuid>,
    pub report_id: Option<Uuid>,
    pub status: String,
    pub details: Json<serde_json::Value>,
    pub acknowledged_by_id: Option<Uuid>,
    pub acknowledged_by_username: Option<String>,
    pub acknowledged_by_display_name: Option<String>,
    pub acknowledged_by_avatar_url: Option<String>,
    pub created_at: OffsetDateTime,
    pub acknowledged_at: Option<OffsetDateTime>,
}

#[derive(Debug)]
pub struct UpdateSiteBrandingRecord {
    pub site_name: String,
    pub logo_url: Option<String>,
    pub favicon_url: Option<String>,
    pub default_cover_url: Option<Option<String>>,
    pub navigation_links: Option<Vec<BrandLinkRecord>>,
    pub footer_text: Option<Option<String>>,
    pub footer_links: Option<Vec<BrandLinkRecord>>,
    pub primary_color: String,
    pub accent_color: String,
    pub theme_preset: String,
    pub list_density: String,
    pub home_mode: String,
}

#[derive(Debug)]
pub struct CreateAdminBoardRecord {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: String,
    pub position: i32,
    pub visibility: String,
}

#[derive(Debug)]
pub struct UpdateAdminBoardRecord {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: String,
    pub position: i32,
    pub visibility: String,
    pub expected_revision: i64,
}

#[derive(Debug)]
pub enum AdminConfigError {
    NotFound,
    Conflict,
    ParentInvalid,
    DepthExceeded,
    HasChildren,
    RevisionConflict,
    Outbox(OutboxError),
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum BrandAssetError {
    Invalid,
    NotFound,
    Storage(String),
    Outbox(OutboxError),
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListAdminAuditError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListRiskAlertsError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum UpdateRiskAlertError {
    NotFound,
    InvalidStatus,
    Database(DatabaseError),
}

impl Database {
    pub async fn is_super_admin(&self, user_id: Uuid) -> Result<bool, DatabaseError> {
        self.has_permission(user_id, permission_keys::ADMIN_CONFIGURATION_WRITE, None)
            .await
    }

    pub async fn get_site_branding(&self) -> Result<SiteBrandingRecord, DatabaseError> {
        Ok(sqlx::query_as::<_, SiteBrandingRecord>(
            "SELECT site_name, logo_url, favicon_url, default_cover_url, navigation_links,
                    footer_text, footer_links, primary_color, accent_color, theme_preset,
                    list_density, home_mode
             FROM site_branding WHERE id = 1",
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn list_admin_audit(
        &self,
        filter: ListAdminAuditFilter<'_>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<AdminAuditRecord>, ListAdminAuditError> {
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                     SELECT 1 FROM admin_audit_log
                     WHERE id = $1
                       AND ($2::uuid IS NULL OR actor_id = $2)
                       AND ($3::text IS NULL OR action = $3)
                       AND ($4::text IS NULL OR resource_type = $4)
                       AND ($5::uuid IS NULL OR resource_id = $5)
                       AND ($6::uuid IS NULL OR (resource_type = 'user' AND resource_id = $6))
                       AND ($7::uuid IS NULL OR
                           (resource_type = 'content_report' AND resource_id = $7) OR
                           summary ->> 'report_id' = $7::text)
                 )",
            )
            .bind(cursor)
            .bind(filter.actor_id)
            .bind(filter.action)
            .bind(filter.resource_type)
            .bind(filter.resource_id)
            .bind(filter.user_id)
            .bind(filter.report_id)
            .fetch_one(&self.pool)
            .await?;
            if !valid {
                return Err(ListAdminAuditError::InvalidCursor);
            }
        }

        Ok(sqlx::query_as::<_, AdminAuditRecord>(
            "SELECT audit.id, actor.id AS actor_id, actor.username AS actor_username,
                    actor.display_name AS actor_display_name, actor.avatar_url AS actor_avatar_url,
                    audit.action, audit.resource_type, audit.resource_id, audit.summary,
                    audit.created_at
             FROM admin_audit_log AS audit
             INNER JOIN users AS actor ON actor.id = audit.actor_id
             WHERE ($1::uuid IS NULL OR audit.actor_id = $1)
               AND ($2::text IS NULL OR audit.action = $2)
               AND ($3::text IS NULL OR audit.resource_type = $3)
               AND ($4::uuid IS NULL OR audit.resource_id = $4)
               AND ($5::uuid IS NULL OR
                   (audit.resource_type = 'user' AND audit.resource_id = $5))
               AND ($6::uuid IS NULL OR
                   (audit.resource_type = 'content_report' AND audit.resource_id = $6) OR
                   audit.summary ->> 'report_id' = $6::text)
               AND ($7::uuid IS NULL OR (audit.created_at, audit.id) < (
                   SELECT cursor.created_at, cursor.id
                   FROM admin_audit_log AS cursor
                   WHERE cursor.id = $7
               ))
             ORDER BY audit.created_at DESC, audit.id DESC
             LIMIT $8",
        )
        .bind(filter.actor_id)
        .bind(filter.action)
        .bind(filter.resource_type)
        .bind(filter.resource_id)
        .bind(filter.user_id)
        .bind(filter.report_id)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn update_site_branding(
        &self,
        actor_id: Uuid,
        branding: UpdateSiteBrandingRecord,
    ) -> Result<SiteBrandingRecord, AdminConfigError> {
        let mut transaction = self.pool.begin().await?;
        let record = sqlx::query_as::<_, SiteBrandingRecord>(
            "UPDATE site_branding
             SET site_name = $1, logo_url = $2, favicon_url = $3,
                 default_cover_url = CASE WHEN $4 THEN $5 ELSE default_cover_url END,
                 navigation_links = COALESCE($6, navigation_links),
                 footer_text = CASE WHEN $7 THEN $8 ELSE footer_text END,
                 footer_links = COALESCE($9, footer_links),
                 primary_color = $10, accent_color = $11, theme_preset = $12,
                 list_density = $13, home_mode = $14, updated_by = $15,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = 1
             RETURNING site_name, logo_url, favicon_url, default_cover_url, navigation_links,
                       footer_text, footer_links, primary_color, accent_color, theme_preset,
                       list_density, home_mode",
        )
        .bind(&branding.site_name)
        .bind(&branding.logo_url)
        .bind(&branding.favicon_url)
        .bind(branding.default_cover_url.is_some())
        .bind(branding.default_cover_url.flatten())
        .bind(branding.navigation_links.map(Json))
        .bind(branding.footer_text.is_some())
        .bind(branding.footer_text.flatten())
        .bind(branding.footer_links.map(Json))
        .bind(&branding.primary_color)
        .bind(&branding.accent_color)
        .bind(&branding.theme_preset)
        .bind(&branding.list_density)
        .bind(&branding.home_mode)
        .bind(actor_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(AdminConfigError::NotFound)?;
        insert_audit(
            &mut transaction,
            actor_id,
            "branding.update",
            "site_branding",
            None,
            json!({"site_name": record.site_name, "theme_preset": record.theme_preset}),
        )
        .await?;
        let event_id = Uuid::now_v7();
        self.enqueue_outbox_event_in_transaction(
            &mut transaction,
            NewOutboxEvent {
                id: event_id,
                event_type: "cache.site_branding_invalidated".to_owned(),
                aggregate_type: "site_branding".to_owned(),
                aggregate_id: Uuid::from_u128(1),
                dedupe_key: event_id.to_string(),
                payload: json!({ "cache_key": "site_branding" }),
                max_attempts: 8,
            },
        )
        .await
        .map_err(AdminConfigError::Outbox)?;
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn upload_brand_asset(
        &self,
        actor_id: Uuid,
        kind: &str,
        mime_type: &str,
        bytes: Vec<u8>,
    ) -> Result<SiteBrandingRecord, BrandAssetError> {
        let extension = validate_brand_asset(kind, mime_type, &bytes)?;
        let digest = Sha256::digest(&bytes).to_vec();
        let digest_hex = hex(&digest);
        // A server-generated generation id prevents a replaced digest key from being reused by a
        // concurrent upload while the previous object is being removed after commit.
        let storage_key = format!(
            "branding/{kind}/{digest_hex}-{}.{}",
            Uuid::now_v7(),
            extension
        );
        let existing_key = sqlx::query_scalar::<_, String>(
            "SELECT storage_key FROM site_branding_assets WHERE kind = $1",
        )
        .bind(kind)
        .fetch_optional(&self.pool)
        .await?
        .unwrap_or_default();
        self.attachment_store
            .put(&storage_key, &bytes)
            .await
            .map_err(BrandAssetError::Storage)?;

        let result = self
            .commit_brand_asset_upload(
                actor_id,
                kind,
                mime_type,
                digest,
                i64::try_from(bytes.len()).map_err(|_| BrandAssetError::Invalid)?,
                &storage_key,
            )
            .await;
        let (branding, previous_key) = match result {
            Ok(result) => result,
            Err(error) => {
                if existing_key != storage_key {
                    let _ = self.attachment_store.delete(&storage_key).await;
                }
                return Err(error);
            }
        };
        if let Some(previous_key) = previous_key
            && previous_key != storage_key
        {
            let _ = self.attachment_store.delete(&previous_key).await;
        }
        Ok(branding)
    }

    async fn commit_brand_asset_upload(
        &self,
        actor_id: Uuid,
        kind: &str,
        mime_type: &str,
        digest: Vec<u8>,
        size_bytes: i64,
        storage_key: &str,
    ) -> Result<(SiteBrandingRecord, Option<String>), BrandAssetError> {
        let mut transaction = self.pool.begin().await?;
        let previous_key = sqlx::query_scalar::<_, String>(
            "SELECT storage_key FROM site_branding_assets WHERE kind = $1 FOR UPDATE",
        )
        .bind(kind)
        .fetch_optional(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO site_branding_assets
                 (kind, storage_key, mime_type, sha256, size_bytes, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
             ON CONFLICT (kind) DO UPDATE
             SET storage_key = EXCLUDED.storage_key, mime_type = EXCLUDED.mime_type,
                 sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes,
                 updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(kind)
        .bind(storage_key)
        .bind(mime_type)
        .bind(&digest)
        .bind(size_bytes)
        .bind(actor_id)
        .execute(&mut *transaction)
        .await?;
        let public_url = format!("/api/v1/site-branding/assets/{kind}");
        let record = sqlx::query_as::<_, SiteBrandingRecord>(
            "UPDATE site_branding
             SET logo_url = CASE WHEN $1 = 'logo' THEN $2 ELSE logo_url END,
                 favicon_url = CASE WHEN $1 = 'favicon' THEN $2 ELSE favicon_url END,
                 updated_by = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = 1
             RETURNING site_name, logo_url, favicon_url, default_cover_url, navigation_links,
                       footer_text, footer_links, primary_color, accent_color, theme_preset,
                       list_density, home_mode",
        )
        .bind(kind)
        .bind(public_url)
        .bind(actor_id)
        .fetch_one(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "branding.asset.upload",
            "site_branding",
            None,
            json!({
                "kind": kind,
                "mime_type": mime_type,
                "size_bytes": size_bytes,
                "sha256": hex(&digest),
            }),
        )
        .await?;
        enqueue_branding_invalidation(self, &mut transaction).await?;
        transaction.commit().await?;
        Ok((record, previous_key))
    }

    pub async fn read_brand_asset(
        &self,
        kind: &str,
    ) -> Result<(BrandAssetRecord, Vec<u8>), BrandAssetError> {
        if !matches!(kind, "logo" | "favicon") {
            return Err(BrandAssetError::Invalid);
        }
        let record = sqlx::query_as::<_, BrandAssetRecord>(
            "SELECT kind, storage_key, mime_type, sha256, size_bytes
             FROM site_branding_assets WHERE kind = $1",
        )
        .bind(kind)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(BrandAssetError::NotFound)?;
        let bytes = self
            .attachment_store
            .get(&record.storage_key)
            .await
            .map_err(BrandAssetError::Storage)?;
        Ok((record, bytes))
    }

    pub async fn delete_brand_asset(
        &self,
        actor_id: Uuid,
        kind: &str,
    ) -> Result<SiteBrandingRecord, BrandAssetError> {
        if !matches!(kind, "logo" | "favicon") {
            return Err(BrandAssetError::Invalid);
        }
        let mut transaction = self.pool.begin().await?;
        let storage_key = sqlx::query_scalar::<_, String>(
            "DELETE FROM site_branding_assets WHERE kind = $1 RETURNING storage_key",
        )
        .bind(kind)
        .fetch_optional(&mut *transaction)
        .await?;
        if storage_key.is_none() {
            transaction.rollback().await?;
            return self.get_site_branding().await.map_err(Into::into);
        }
        let record = sqlx::query_as::<_, SiteBrandingRecord>(
            "UPDATE site_branding
             SET logo_url = CASE WHEN $1 = 'logo' THEN NULL ELSE logo_url END,
                 favicon_url = CASE WHEN $1 = 'favicon' THEN NULL ELSE favicon_url END,
                 updated_by = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = 1
             RETURNING site_name, logo_url, favicon_url, default_cover_url, navigation_links,
                       footer_text, footer_links, primary_color, accent_color, theme_preset,
                       list_density, home_mode",
        )
        .bind(kind)
        .bind(actor_id)
        .fetch_one(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "branding.asset.delete",
            "site_branding",
            None,
            json!({"kind": kind}),
        )
        .await?;
        enqueue_branding_invalidation(self, &mut transaction).await?;
        transaction.commit().await?;
        let _ = self
            .attachment_store
            .delete(storage_key.as_deref().expect("checked brand asset key"))
            .await;
        Ok(record)
    }

    pub async fn list_admin_boards(&self) -> Result<Vec<AdminBoardRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, AdminBoardRecord>(
            "SELECT id, parent_id, slug, name, description, icon, tone, position, visibility,
                    topic_count, revision
             FROM boards
             WHERE deleted_at IS NULL
             ORDER BY parent_id NULLS FIRST, position, id",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn create_admin_board(
        &self,
        actor_id: Uuid,
        board: CreateAdminBoardRecord,
    ) -> Result<AdminBoardRecord, AdminConfigError> {
        let mut transaction = self.pool.begin().await?;
        let hierarchy = lock_active_board_hierarchy(&mut transaction).await?;
        validate_board_hierarchy(&hierarchy, None, board.parent_id, 1)?;
        sqlx::query(
            "INSERT INTO boards
                 (id, parent_id, slug, name, description, icon, tone, position, visibility)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(board.id)
        .bind(board.parent_id)
        .bind(&board.slug)
        .bind(&board.name)
        .bind(&board.description)
        .bind(&board.icon)
        .bind(&board.tone)
        .bind(board.position)
        .bind(&board.visibility)
        .execute(&mut *transaction)
        .await
        .map_err(map_write_error)?;
        rewrite_sibling_positions(
            &mut transaction,
            board.parent_id,
            Some((board.id, board.position)),
        )
        .await?;
        let record = select_admin_board(&mut transaction, board.id).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "board.create",
            "board",
            Some(record.id),
            json!({
                "slug": record.slug,
                "parent_id": record.parent_id,
                "position": record.position,
                "revision": record.revision
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn get_admin_board_deletion_impact(
        &self,
        board_id: Uuid,
    ) -> Result<AdminBoardDeletionImpactRecord, AdminConfigError> {
        sqlx::query_as::<_, AdminBoardDeletionImpactRecord>(
            "SELECT b.id AS board_id,
                    (SELECT COUNT(*) FROM boards child
                     WHERE child.parent_id = b.id AND child.deleted_at IS NULL) AS child_count,
                    (SELECT COUNT(*) FROM topics topic
                     WHERE topic.board_id = b.id AND topic.deleted_at IS NULL) AS topic_count,
                    (SELECT COUNT(*) FROM posts post
                     JOIN topics topic ON topic.id = post.topic_id
                     WHERE topic.board_id = b.id AND topic.deleted_at IS NULL
                       AND post.kind = 'reply' AND post.deleted_at IS NULL) AS reply_count
             FROM boards b
             WHERE b.id = $1 AND b.deleted_at IS NULL",
        )
        .bind(board_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AdminConfigError::NotFound)
    }

    pub async fn update_admin_board(
        &self,
        actor_id: Uuid,
        board: UpdateAdminBoardRecord,
    ) -> Result<AdminBoardRecord, AdminConfigError> {
        let mut transaction = self.pool.begin().await?;
        let hierarchy = lock_active_board_hierarchy(&mut transaction).await?;
        let current = hierarchy
            .iter()
            .find(|current| current.id == board.id)
            .ok_or(AdminConfigError::NotFound)?;
        if current.revision != board.expected_revision {
            return Err(AdminConfigError::RevisionConflict);
        }
        let subtree_height = board_subtree_height(&hierarchy, board.id)?;
        validate_board_hierarchy(&hierarchy, Some(board.id), board.parent_id, subtree_height)?;
        let previous_parent_id = current.parent_id;
        let record = sqlx::query_as::<_, AdminBoardRecord>(
            "UPDATE boards
             SET parent_id = $2, slug = $3, name = $4, description = $5, icon = $6, tone = $7,
                 position = $8, visibility = $9, revision = revision + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND deleted_at IS NULL AND revision = $10
             RETURNING id, parent_id, slug, name, description, icon, tone, position, visibility,
                       topic_count, revision",
        )
        .bind(board.id)
        .bind(board.parent_id)
        .bind(&board.slug)
        .bind(&board.name)
        .bind(&board.description)
        .bind(&board.icon)
        .bind(&board.tone)
        .bind(board.position)
        .bind(&board.visibility)
        .bind(board.expected_revision)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(map_write_error)?
        .ok_or(AdminConfigError::RevisionConflict)?;
        if previous_parent_id != board.parent_id {
            rewrite_sibling_positions(&mut transaction, previous_parent_id, None).await?;
        }
        rewrite_sibling_positions(
            &mut transaction,
            board.parent_id,
            Some((board.id, board.position)),
        )
        .await?;
        let record = select_admin_board(&mut transaction, record.id).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "board.update",
            "board",
            Some(record.id),
            json!({
                "slug": record.slug,
                "visibility": record.visibility,
                "parent_id": record.parent_id,
                "position": record.position,
                "revision": record.revision
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn delete_admin_board(
        &self,
        actor_id: Uuid,
        board_id: Uuid,
    ) -> Result<(), AdminConfigError> {
        let mut transaction = self.pool.begin().await?;
        let board = sqlx::query_as::<_, (Option<Uuid>,)>(
            "SELECT parent_id
             FROM boards WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
        )
        .bind(board_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(AdminConfigError::NotFound)?;
        let has_children = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
                 SELECT 1 FROM boards WHERE parent_id = $1 AND deleted_at IS NULL
             )",
        )
        .bind(board_id)
        .fetch_one(&mut *transaction)
        .await?;
        if has_children {
            return Err(AdminConfigError::HasChildren);
        }
        let topic_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM topics WHERE board_id = $1 AND deleted_at IS NULL",
        )
        .bind(board_id)
        .fetch_one(&mut *transaction)
        .await?;
        if topic_count > 0 {
            return Err(AdminConfigError::Conflict);
        }
        sqlx::query(
            "UPDATE boards
             SET visibility = 'hidden', deleted_at = CURRENT_TIMESTAMP, deleted_by = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1",
        )
        .bind(board_id)
        .bind(actor_id)
        .execute(&mut *transaction)
        .await?;
        rewrite_sibling_positions(&mut transaction, board.0, None).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "board.delete",
            "board",
            Some(board_id),
            json!({}),
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn get_governance_policy(&self) -> Result<GovernancePolicyRecord, DatabaseError> {
        Ok(sqlx::query_as::<_, GovernancePolicyRecord>(
            "SELECT enabled, alert_score_threshold, reporter_window_minutes, reporter_alert_limit
             FROM governance_policies WHERE id = 1",
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn update_governance_policy(
        &self,
        actor_id: Uuid,
        enabled: bool,
        alert_score_threshold: i16,
        reporter_window_minutes: i16,
        reporter_alert_limit: i16,
    ) -> Result<GovernancePolicyRecord, DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        let record = sqlx::query_as::<_, GovernancePolicyRecord>(
            "UPDATE governance_policies
             SET enabled = $1, alert_score_threshold = $2, reporter_window_minutes = $3,
                 reporter_alert_limit = $4, updated_by = $5, updated_at = CURRENT_TIMESTAMP
             WHERE id = 1
             RETURNING enabled, alert_score_threshold, reporter_window_minutes, reporter_alert_limit",
        )
        .bind(enabled)
        .bind(alert_score_threshold)
        .bind(reporter_window_minutes)
        .bind(reporter_alert_limit)
        .bind(actor_id)
        .fetch_one(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "governance.policy.update",
            "governance_policy",
            None,
            json!({
                "enabled": record.enabled,
                "alert_score_threshold": record.alert_score_threshold,
                "reporter_window_minutes": record.reporter_window_minutes,
                "reporter_alert_limit": record.reporter_alert_limit
            }),
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn list_risk_alerts(
        &self,
        status: Option<&str>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<RiskAlertRecord>, ListRiskAlertsError> {
        if let Some(cursor) = cursor {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                     SELECT 1 FROM risk_alerts
                     WHERE id = $1 AND ($2::text IS NULL OR status = $2)
                 )",
            )
            .bind(cursor)
            .bind(status)
            .fetch_one(&self.pool)
            .await?;
            if !valid {
                return Err(ListRiskAlertsError::InvalidCursor);
            }
        }
        Ok(sqlx::query_as::<_, RiskAlertRecord>(
            "SELECT alert.id, alert.kind, alert.severity, alert.score,
                    alert.target_type, alert.target_id, alert.reporter_id, alert.report_id,
                    alert.status, alert.details,
                    acknowledged.id AS acknowledged_by_id,
                    acknowledged.username AS acknowledged_by_username,
                    acknowledged.display_name AS acknowledged_by_display_name,
                    acknowledged.avatar_url AS acknowledged_by_avatar_url,
                    alert.created_at, alert.acknowledged_at
             FROM risk_alerts AS alert
             LEFT JOIN users AS acknowledged ON acknowledged.id = alert.acknowledged_by
             WHERE ($1::text IS NULL OR alert.status = $1)
               AND ($2::uuid IS NULL OR (alert.created_at, alert.id) < (
                   SELECT cursor.created_at, cursor.id FROM risk_alerts AS cursor WHERE cursor.id = $2
               ))
             ORDER BY alert.created_at DESC, alert.id DESC
             LIMIT $3",
        )
        .bind(status)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn update_risk_alert(
        &self,
        actor_id: Uuid,
        alert_id: Uuid,
        status: &str,
    ) -> Result<RiskAlertRecord, UpdateRiskAlertError> {
        if !matches!(status, "acknowledged" | "dismissed") {
            return Err(UpdateRiskAlertError::InvalidStatus);
        }
        let mut transaction = self.pool.begin().await?;
        let record = sqlx::query_as::<_, RiskAlertRecord>(
            "UPDATE risk_alerts AS alert
             SET status = $2, acknowledged_by = $3, acknowledged_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE alert.id = $1
             RETURNING alert.id, alert.kind, alert.severity, alert.score,
                       alert.target_type, alert.target_id, alert.reporter_id, alert.report_id,
                       alert.status, alert.details, $3 AS acknowledged_by_id,
                       (SELECT username FROM users WHERE id = $3) AS acknowledged_by_username,
                       (SELECT display_name FROM users WHERE id = $3) AS acknowledged_by_display_name,
                       (SELECT avatar_url FROM users WHERE id = $3) AS acknowledged_by_avatar_url,
                       alert.created_at, alert.acknowledged_at",
        )
        .bind(alert_id)
        .bind(status)
        .bind(actor_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(UpdateRiskAlertError::NotFound)?;
        insert_audit(
            &mut transaction,
            actor_id,
            "governance.alert.update",
            "risk_alert",
            Some(alert_id),
            json!({"status": status, "score": record.score}),
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
    }
}

fn validate_brand_asset(
    kind: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<&'static str, BrandAssetError> {
    let (max_bytes, format, extension) = match (kind, mime_type) {
        ("logo", "image/png") | ("favicon", "image/png") => (
            if kind == "favicon" {
                512 * 1024
            } else {
                2 * 1024 * 1024
            },
            image::ImageFormat::Png,
            "png",
        ),
        ("logo", "image/webp") => (2 * 1024 * 1024, image::ImageFormat::WebP, "webp"),
        _ => return Err(BrandAssetError::Invalid),
    };
    if bytes.is_empty()
        || bytes.len() > max_bytes
        || image::load_from_memory_with_format(bytes, format).is_err()
    {
        return Err(BrandAssetError::Invalid);
    }
    Ok(extension)
}

async fn enqueue_branding_invalidation(
    database: &Database,
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), BrandAssetError> {
    let event_id = Uuid::now_v7();
    database
        .enqueue_outbox_event_in_transaction(
            transaction,
            NewOutboxEvent {
                id: event_id,
                event_type: "cache.site_branding_invalidated".to_owned(),
                aggregate_type: "site_branding".to_owned(),
                aggregate_id: Uuid::from_u128(1),
                dedupe_key: event_id.to_string(),
                payload: json!({ "cache_key": "site_branding" }),
                max_attempts: 8,
            },
        )
        .await
        .map(|_| ())
        .map_err(BrandAssetError::Outbox)
}

async fn lock_active_board_hierarchy(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Vec<BoardHierarchyRecord>, AdminConfigError> {
    Ok(sqlx::query_as::<_, BoardHierarchyRecord>(
        "SELECT id, parent_id, revision
         FROM boards
         WHERE deleted_at IS NULL
         ORDER BY id
         FOR UPDATE",
    )
    .fetch_all(&mut **transaction)
    .await?)
}

fn validate_board_hierarchy(
    hierarchy: &[BoardHierarchyRecord],
    board_id: Option<Uuid>,
    parent_id: Option<Uuid>,
    subtree_height: usize,
) -> Result<(), AdminConfigError> {
    let parents = hierarchy
        .iter()
        .map(|board| (board.id, board.parent_id))
        .collect::<HashMap<_, _>>();
    let mut ancestor_depth = 0usize;
    let mut cursor = parent_id;
    let mut visited = HashSet::new();

    while let Some(id) = cursor {
        if Some(id) == board_id || !visited.insert(id) {
            return Err(AdminConfigError::ParentInvalid);
        }
        let parent = parents.get(&id).ok_or(AdminConfigError::ParentInvalid)?;
        ancestor_depth += 1;
        cursor = *parent;
    }

    if ancestor_depth + subtree_height > 3 {
        return Err(AdminConfigError::DepthExceeded);
    }
    Ok(())
}

fn board_subtree_height(
    hierarchy: &[BoardHierarchyRecord],
    board_id: Uuid,
) -> Result<usize, AdminConfigError> {
    let mut children = HashMap::<Uuid, Vec<Uuid>>::new();
    for board in hierarchy {
        if let Some(parent_id) = board.parent_id {
            children.entry(parent_id).or_default().push(board.id);
        }
    }
    subtree_height_from(board_id, &children, &mut HashSet::new())
}

fn subtree_height_from(
    board_id: Uuid,
    children: &HashMap<Uuid, Vec<Uuid>>,
    visiting: &mut HashSet<Uuid>,
) -> Result<usize, AdminConfigError> {
    if !visiting.insert(board_id) {
        return Err(AdminConfigError::ParentInvalid);
    }
    let mut height = 1usize;
    if let Some(child_ids) = children.get(&board_id) {
        for child_id in child_ids {
            height = height.max(1 + subtree_height_from(*child_id, children, visiting)?);
        }
    }
    visiting.remove(&board_id);
    Ok(height)
}

async fn rewrite_sibling_positions(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    parent_id: Option<Uuid>,
    moving: Option<(Uuid, i32)>,
) -> Result<(), AdminConfigError> {
    let excluded_id = moving.map(|(id, _)| id);
    let mut sibling_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT id
         FROM boards
         WHERE parent_id IS NOT DISTINCT FROM $1::uuid
           AND deleted_at IS NULL
           AND ($2::uuid IS NULL OR id <> $2)
         ORDER BY position, id
         FOR UPDATE",
    )
    .bind(parent_id)
    .bind(excluded_id)
    .fetch_all(&mut **transaction)
    .await?;

    if let Some((moving_id, requested_position)) = moving {
        let requested_position = usize::try_from(requested_position).unwrap_or_default();
        sibling_ids.insert(requested_position.min(sibling_ids.len()), moving_id);
    }

    for (position, sibling_id) in sibling_ids.into_iter().enumerate() {
        let position = i32::try_from(position).map_err(|_| AdminConfigError::Conflict)?;
        if Some(sibling_id) == excluded_id {
            sqlx::query("UPDATE boards SET position = $2 WHERE id = $1 AND position <> $2")
                .bind(sibling_id)
                .bind(position)
                .execute(&mut **transaction)
                .await?;
        } else {
            sqlx::query(
                "UPDATE boards
                 SET position = $2, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND position <> $2",
            )
            .bind(sibling_id)
            .bind(position)
            .execute(&mut **transaction)
            .await?;
        }
    }
    Ok(())
}

async fn select_admin_board(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    board_id: Uuid,
) -> Result<AdminBoardRecord, AdminConfigError> {
    sqlx::query_as::<_, AdminBoardRecord>(
        "SELECT id, parent_id, slug, name, description, icon, tone, position, visibility,
                topic_count, revision
         FROM boards
         WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(board_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(AdminConfigError::NotFound)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) async fn insert_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor_id: Uuid,
    action: &str,
    resource_type: &str,
    resource_id: Option<Uuid>,
    summary: serde_json::Value,
) -> Result<Uuid, sqlx::Error> {
    let audit_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO admin_audit_log (id, actor_id, action, resource_type, resource_id, summary)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(audit_id)
    .bind(actor_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(Json(summary))
    .execute(&mut **transaction)
    .await?;
    Ok(audit_id)
}

fn map_write_error(error: sqlx::Error) -> AdminConfigError {
    if matches!(
        &error,
        sqlx::Error::Database(database_error)
            if database_error.code().as_deref() == Some("23505")
    ) {
        AdminConfigError::Conflict
    } else {
        AdminConfigError::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for AdminConfigError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for BrandAssetError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<DatabaseError> for BrandAssetError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

impl From<sqlx::Error> for ListAdminAuditError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for ListRiskAlertsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl From<sqlx::Error> for UpdateRiskAlertError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}
