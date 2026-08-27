use std::{error::Error, fmt, io::Cursor, path::Path};

use image::{ImageFormat, ImageReader};
use serde_json::json;
use sqlx::{FromRow, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::board_user_restrictions::is_board_user_action_restricted_with_executor;
use crate::community_permissions::{
    CommunityActionError, authorize_community_action_with_executor,
    community_quota_limit_with_executor,
};
use crate::{Database, DatabaseError};

pub const MAX_ATTACHMENT_BYTES: usize = 50 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 12_000;
const MAX_IMAGE_PIXELS: u64 = 25_000_000;
const MAX_IMAGE_DECODE_BYTES: u64 = 128 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS: i32 = 365;
const DRAFT_RETENTION_HOURS: i64 = 24;
const ORPHAN_GRACE_HOURS: i64 = 24;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateAttachmentInput {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub uploader_id: Uuid,
    pub original_name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateDraftImageAttachmentInput {
    pub id: Uuid,
    pub uploader_id: Uuid,
    pub original_name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct DraftImageAttachmentRecord {
    pub id: Uuid,
    pub original_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct AttachmentRecord {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub original_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub sha256: Vec<u8>,
    pub status: String,
    pub scan_status: String,
    pub created_at: OffsetDateTime,
    pub storage_key: String,
    pub thumbnail_key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AttachmentCleanupResultRecord {
    pub deleted_records: u64,
    pub deleted_objects: u64,
    pub failed_objects: u64,
}

#[derive(Debug)]
pub enum AttachmentError {
    TopicUnavailable,
    Forbidden,
    BoardRestricted,
    QuotaExceeded,
    Invalid,
    MalwareDetected,
    Storage(String),
    Image(image::ImageError),
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListAttachmentsError {
    TopicUnavailable,
    Forbidden,
    QuotaExceeded,
    Storage(String),
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum AttachmentCleanupError {
    Storage(String),
    Database(DatabaseError),
}

impl Database {
    pub async fn create_topic_attachment(
        &self,
        input: CreateAttachmentInput,
    ) -> Result<AttachmentRecord, AttachmentError> {
        validate_upload(&input)?;
        scan_bytes(&input.bytes)?;
        let extension = extension_for(&input.mime_type);
        let storage_key = format!("topics/{}/{}{}", input.topic_id, input.id, extension);
        let thumbnail_key = image_format(&input.mime_type)
            .map(|_| format!("topics/{}/{}-thumb.webp", input.topic_id, input.id));
        let thumbnail_bytes = image_format(&input.mime_type)
            .map(|format| make_thumbnail(&input.bytes, format))
            .transpose()?;

        let hash = sha256(&input.bytes);
        let mut transaction = self.pool.begin().await?;
        let active_uploader = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE",
        )
        .bind(input.uploader_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if active_uploader.is_none() {
            return Err(AttachmentError::Forbidden);
        }
        let topic = sqlx::query_as::<_, AttachmentTopicRow>(
            "SELECT author_id, board_id, status, deleted_at FROM topics WHERE id = $1 FOR UPDATE",
        )
        .bind(input.topic_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(AttachmentError::TopicUnavailable)?;
        if topic.status != "published" || topic.deleted_at.is_some() {
            return Err(AttachmentError::TopicUnavailable);
        }
        if topic.author_id != input.uploader_id {
            return Err(AttachmentError::Forbidden);
        }
        if is_board_user_action_restricted_with_executor(
            &mut transaction,
            input.uploader_id,
            topic.board_id,
            "attachment.upload",
            OffsetDateTime::now_utc(),
        )
        .await?
        {
            return Err(AttachmentError::BoardRestricted);
        }
        authorize_attachment_upload(&mut transaction, input.uploader_id, input.bytes.len()).await?;
        self.attachment_store
            .put(&storage_key, &input.bytes)
            .await
            .map_err(AttachmentError::Storage)?;
        if let (Some(key), Some(bytes)) = (&thumbnail_key, thumbnail_bytes.as_ref())
            && let Err(error) = self.attachment_store.put(key, bytes).await
        {
            remove_object(&self.attachment_store, &storage_key).await;
            return Err(AttachmentError::Storage(error));
        }
        let mut record = match sqlx::query_as::<_, AttachmentRecord>(
            "INSERT INTO topic_attachments
                (id, topic_id, uploader_id, storage_key, original_name, mime_type,
                 size_bytes, sha256, status, scan_status, scanned_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', 'clean', CURRENT_TIMESTAMP,
                     CURRENT_TIMESTAMP + ($9::int * INTERVAL '1 day'))
             RETURNING id, topic_id, original_name, mime_type, size_bytes, sha256,
                       status, scan_status, created_at, storage_key, NULL::varchar AS thumbnail_key",
        )
        .bind(input.id)
        .bind(input.topic_id)
        .bind(input.uploader_id)
        .bind(&storage_key)
        .bind(&input.original_name)
        .bind(&input.mime_type)
        .bind(i64::try_from(input.bytes.len()).expect("validated size fits i64"))
        .bind(&hash)
        .bind(retention_days())
        .fetch_one(&mut *transaction)
        .await
        {
            Ok(record) => record,
            Err(error) => {
                remove_object(&self.attachment_store, &storage_key).await;
                if let Some(key) = &thumbnail_key {
                    remove_object(&self.attachment_store, key).await;
                }
                return Err(AttachmentError::from(error));
            }
        };
        record.thumbnail_key = thumbnail_key;
        if let Err(error) = insert_audit(
            &mut transaction,
            input.uploader_id,
            "attachment.create",
            "attachment",
            Some(input.id),
            json!({"topic_id": input.topic_id, "mime_type": input.mime_type}),
        )
        .await
        {
            remove_object(&self.attachment_store, &storage_key).await;
            if let Some(key) = &record.thumbnail_key {
                remove_object(&self.attachment_store, key).await;
            }
            return Err(AttachmentError::from(error));
        }
        if let Err(error) = transaction.commit().await {
            remove_object(&self.attachment_store, &storage_key).await;
            if let Some(key) = &record.thumbnail_key {
                remove_object(&self.attachment_store, key).await;
            }
            return Err(AttachmentError::from(error));
        }
        Ok(record)
    }

    pub async fn create_draft_image_attachment(
        &self,
        input: CreateDraftImageAttachmentInput,
    ) -> Result<DraftImageAttachmentRecord, AttachmentError> {
        validate_draft_image_upload(&input)?;
        scan_bytes(&input.bytes)?;

        let extension = extension_for(&input.mime_type);
        let storage_key = format!("drafts/{}/{}{}", input.uploader_id, input.id, extension);
        let thumbnail_key = format!("drafts/{}/{}-thumb.webp", input.uploader_id, input.id);
        let thumbnail_bytes = make_thumbnail(
            &input.bytes,
            image_format(&input.mime_type).ok_or(AttachmentError::Invalid)?,
        )?;
        let hash = sha256(&input.bytes);

        let mut transaction = self.pool.begin().await?;
        let active_uploader = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE",
        )
        .bind(input.uploader_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if active_uploader.is_none() {
            return Err(AttachmentError::Forbidden);
        }
        authorize_attachment_upload(&mut transaction, input.uploader_id, input.bytes.len()).await?;

        self.attachment_store
            .put(&storage_key, &input.bytes)
            .await
            .map_err(AttachmentError::Storage)?;
        if let Err(error) = self
            .attachment_store
            .put(&thumbnail_key, &thumbnail_bytes)
            .await
        {
            remove_object(&self.attachment_store, &storage_key).await;
            return Err(AttachmentError::Storage(error));
        }

        let record = match sqlx::query_as::<_, DraftImageAttachmentRecord>(
            "INSERT INTO topic_attachments
                (id, topic_id, uploader_id, storage_key, original_name, mime_type,
                 size_bytes, sha256, status, scan_status, scanned_at, expires_at)
             VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 'ready', 'clean', CURRENT_TIMESTAMP,
                     CURRENT_TIMESTAMP + ($8::bigint * INTERVAL '1 hour'))
             RETURNING id, original_name, mime_type, size_bytes, expires_at",
        )
        .bind(input.id)
        .bind(input.uploader_id)
        .bind(&storage_key)
        .bind(&input.original_name)
        .bind(&input.mime_type)
        .bind(i64::try_from(input.bytes.len()).expect("validated size fits i64"))
        .bind(&hash)
        .bind(DRAFT_RETENTION_HOURS)
        .fetch_one(&mut *transaction)
        .await
        {
            Ok(record) => record,
            Err(error) => {
                remove_object(&self.attachment_store, &storage_key).await;
                remove_object(&self.attachment_store, &thumbnail_key).await;
                return Err(AttachmentError::from(error));
            }
        };

        if let Err(error) = insert_audit(
            &mut transaction,
            input.uploader_id,
            "attachment.draft.create",
            "attachment",
            Some(input.id),
            json!({"mime_type": input.mime_type}),
        )
        .await
        {
            remove_object(&self.attachment_store, &storage_key).await;
            remove_object(&self.attachment_store, &thumbnail_key).await;
            return Err(AttachmentError::from(error));
        }
        if let Err(error) = transaction.commit().await {
            remove_object(&self.attachment_store, &storage_key).await;
            remove_object(&self.attachment_store, &thumbnail_key).await;
            return Err(AttachmentError::from(error));
        }

        Ok(record)
    }

    pub async fn list_topic_attachments(
        &self,
        topic_id: Uuid,
        viewer_user_id: Option<Uuid>,
    ) -> Result<Vec<AttachmentRecord>, ListAttachmentsError> {
        let records = sqlx::query_as::<_, AttachmentRecord>(
            "SELECT a.id, a.topic_id, a.original_name, a.mime_type, a.size_bytes,
                    a.sha256, a.status, a.scan_status, a.created_at, a.storage_key,
                    CASE WHEN a.mime_type LIKE 'image/%'
                         THEN regexp_replace(a.storage_key, '\\.[^.]+$', '-thumb.webp')
                         ELSE NULL END AS thumbnail_key
             FROM topic_attachments AS a
             INNER JOIN topics AS t ON t.id = a.topic_id
             WHERE a.topic_id = $1 AND t.status = 'published'
               AND t.deleted_at IS NULL AND a.status = 'ready'
               AND daoyun_can_access_content('topic', t.id, $2, CURRENT_TIMESTAMP)
               AND daoyun_can_access_content('attachment', a.id, $2, CURRENT_TIMESTAMP)
             ORDER BY a.created_at, a.id",
        )
        .bind(topic_id)
        .bind(viewer_user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| ListAttachmentsError::Database(DatabaseError::from(error)))?;
        if records.is_empty() {
            let exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (
                    SELECT 1 FROM topics
                    WHERE id = $1 AND status = 'published' AND deleted_at IS NULL
                      AND daoyun_can_access_content('topic', id, $2, CURRENT_TIMESTAMP)
                 )",
            )
            .bind(topic_id)
            .bind(viewer_user_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|error| ListAttachmentsError::Database(DatabaseError::from(error)))?;
            if !exists {
                return Err(ListAttachmentsError::TopicUnavailable);
            }
        }
        Ok(records)
    }

    pub async fn read_attachment(
        &self,
        attachment_id: Uuid,
        thumbnail: bool,
        viewer_user_id: Option<Uuid>,
    ) -> Result<(AttachmentRecord, Vec<u8>), ListAttachmentsError> {
        let record = sqlx::query_as::<_, AttachmentRecord>(
            "SELECT a.id, a.topic_id, a.original_name, a.mime_type, a.size_bytes,
                    a.sha256, a.status, a.scan_status, a.created_at, a.storage_key,
                    CASE WHEN a.mime_type LIKE 'image/%'
                         THEN regexp_replace(a.storage_key, '\\.[^.]+$', '-thumb.webp')
                         ELSE NULL END AS thumbnail_key
             FROM topic_attachments AS a
             INNER JOIN topics AS t ON t.id = a.topic_id
             WHERE a.id = $1 AND a.status = 'ready'
               AND t.status = 'published' AND t.deleted_at IS NULL
               AND daoyun_can_access_content('topic', t.id, $2, CURRENT_TIMESTAMP)
               AND daoyun_can_access_content('attachment', a.id, $2, CURRENT_TIMESTAMP)",
        )
        .bind(attachment_id)
        .bind(viewer_user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| ListAttachmentsError::Database(DatabaseError::from(error)))?
        .ok_or(ListAttachmentsError::TopicUnavailable)?;
        let download_user_id = if thumbnail {
            None
        } else {
            Some(viewer_user_id.ok_or(ListAttachmentsError::Forbidden)?)
        };
        if let Some(viewer_user_id) = download_user_id {
            let effective_at = OffsetDateTime::now_utc();
            let mut precheck = self.pool.begin().await?;
            authorize_community_action_with_executor(
                &mut precheck,
                viewer_user_id,
                "attachment.download",
                None,
                None,
                effective_at,
            )
            .await
            .map_err(|error| match error {
                CommunityActionError::PermissionDenied => ListAttachmentsError::Forbidden,
                CommunityActionError::QuotaExceeded => ListAttachmentsError::QuotaExceeded,
                CommunityActionError::Database(error) => {
                    ListAttachmentsError::Database(DatabaseError::from(error))
                }
            })?;
            let quota_limit = community_quota_limit_with_executor(
                &mut precheck,
                viewer_user_id,
                "attachment.download.bytes.daily",
                effective_at,
            )
            .await?;
            let quota_used = sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE((
                     SELECT used FROM community_quota_usage
                     WHERE user_id = $1 AND quota_key = $2 AND window_start = $3
                 ), 0)::bigint",
            )
            .bind(viewer_user_id)
            .bind("attachment.download.bytes.daily")
            .bind(effective_at.date())
            .fetch_one(&mut *precheck)
            .await?;
            if quota_used
                .checked_add(record.size_bytes)
                .is_none_or(|required| required > quota_limit)
            {
                return Err(ListAttachmentsError::QuotaExceeded);
            }
            precheck.commit().await?;
        }
        let key = if thumbnail {
            record
                .thumbnail_key
                .as_ref()
                .ok_or(ListAttachmentsError::TopicUnavailable)?
        } else {
            &record.storage_key
        };
        let bytes = self
            .attachment_store
            .get(key)
            .await
            .map_err(ListAttachmentsError::Storage)?;
        if let Some(viewer_user_id) = download_user_id {
            let mut transaction = self.pool.begin().await?;
            authorize_community_action_with_executor(
                &mut transaction,
                viewer_user_id,
                "attachment.download",
                Some(("attachment.download.bytes.daily", record.size_bytes)),
                None,
                OffsetDateTime::now_utc(),
            )
            .await
            .map_err(|error| match error {
                CommunityActionError::PermissionDenied => ListAttachmentsError::Forbidden,
                CommunityActionError::QuotaExceeded => ListAttachmentsError::QuotaExceeded,
                CommunityActionError::Database(error) => {
                    ListAttachmentsError::Database(DatabaseError::from(error))
                }
            })?;
            transaction.commit().await?;
        }
        Ok((record, bytes))
    }

    pub async fn cleanup_attachments(
        &self,
        batch_size: i64,
    ) -> Result<AttachmentCleanupResultRecord, AttachmentCleanupError> {
        let batch_size = batch_size.clamp(1, 500);
        let mut transaction = self.pool.begin().await?;
        let stale = sqlx::query_as::<_, (Uuid, String, Option<String>)>(
            "SELECT id, storage_key,
                    CASE WHEN mime_type LIKE 'image/%'
                         THEN regexp_replace(storage_key, '\\.[^.]+$', '-thumb.webp')
                         ELSE NULL END AS thumbnail_key
             FROM topic_attachments
             WHERE deleted_at IS NOT NULL
                OR expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
                OR status = 'rejected'
                OR scan_status IN ('infected', 'error')
             ORDER BY COALESCE(expires_at, created_at), id
             LIMIT $1
             FOR UPDATE SKIP LOCKED",
        )
        .bind(batch_size)
        .fetch_all(&mut *transaction)
        .await?;
        for (id, _, _) in &stale {
            sqlx::query("DELETE FROM topic_attachments WHERE id = $1")
                .bind(id)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;

        let mut deleted_objects = 0_u64;
        let mut failed_objects = 0_u64;
        for (_, storage_key, thumbnail_key) in &stale {
            for key in [Some(storage_key), thumbnail_key.as_ref()]
                .into_iter()
                .flatten()
            {
                match self.attachment_store.delete(key).await {
                    Ok(()) => deleted_objects += 1,
                    Err(_) => failed_objects += 1,
                }
            }
        }
        let orphan_keys = match self.attachment_store.local_root() {
            Some(root) => self.find_orphan_objects(root).await?,
            None => Vec::new(),
        };
        for key in orphan_keys {
            match self.attachment_store.delete(&key).await {
                Ok(()) => deleted_objects += 1,
                Err(_) => failed_objects += 1,
            }
        }
        Ok(AttachmentCleanupResultRecord {
            deleted_records: stale.len() as u64,
            deleted_objects,
            failed_objects,
        })
    }

    async fn find_orphan_objects(
        &self,
        root: &Path,
    ) -> Result<Vec<String>, AttachmentCleanupError> {
        let expected = sqlx::query_as::<_, (String, String)>(
            "SELECT storage_key, mime_type FROM topic_attachments",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut keys = std::collections::HashSet::new();
        for (storage_key, mime_type) in expected {
            keys.insert(storage_key.clone());
            if mime_type.starts_with("image/") {
                keys.insert(regexless_thumbnail_key(&storage_key));
            }
        }
        let mut files = Vec::new();
        collect_files(root, root, &mut files).await?;
        let cutoff = std::time::SystemTime::now().checked_sub(std::time::Duration::from_secs(
            (ORPHAN_GRACE_HOURS * 3600) as u64,
        ));
        let mut orphans = Vec::new();
        for (key, modified) in files {
            if keys.contains(&key) || cutoff.is_some_and(|limit| modified >= limit) {
                continue;
            }
            orphans.push(key);
        }
        Ok(orphans)
    }
}

#[derive(Debug, FromRow)]
struct AttachmentTopicRow {
    author_id: Uuid,
    board_id: Uuid,
    status: String,
    deleted_at: Option<OffsetDateTime>,
}

async fn authorize_attachment_upload(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    uploader_id: Uuid,
    byte_len: usize,
) -> Result<(), AttachmentError> {
    let effective_at = OffsetDateTime::now_utc();
    let upload_bytes = i64::try_from(byte_len).expect("validated size fits i64");
    if has_instance_super_admin_role(transaction, uploader_id).await? {
        authorize_community_action_with_executor(
            transaction,
            uploader_id,
            "attachment.upload",
            None,
            None,
            effective_at,
        )
        .await
        .map_err(|error| match error {
            CommunityActionError::PermissionDenied => AttachmentError::Forbidden,
            CommunityActionError::QuotaExceeded => AttachmentError::QuotaExceeded,
            CommunityActionError::Database(error) => AttachmentError::from(error),
        })?;
        return Ok(());
    }
    authorize_community_action_with_executor(
        transaction,
        uploader_id,
        "attachment.upload",
        Some(("attachment.upload.daily", 1)),
        Some(("attachment.file.bytes", upload_bytes)),
        effective_at,
    )
    .await
    .map_err(|error| match error {
        CommunityActionError::PermissionDenied => AttachmentError::Forbidden,
        CommunityActionError::QuotaExceeded => AttachmentError::QuotaExceeded,
        CommunityActionError::Database(error) => AttachmentError::from(error),
    })?;
    let storage_used = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(size_bytes), 0)::bigint
         FROM topic_attachments
         WHERE uploader_id = $1 AND deleted_at IS NULL
           AND status IN ('pending', 'ready')",
    )
    .bind(uploader_id)
    .fetch_one(&mut **transaction)
    .await?;
    let storage_limit = community_quota_limit_with_executor(
        transaction,
        uploader_id,
        "attachment.storage.bytes",
        effective_at,
    )
    .await?;
    if storage_used
        .checked_add(upload_bytes)
        .is_none_or(|required| required > storage_limit)
    {
        return Err(AttachmentError::QuotaExceeded);
    }
    Ok(())
}

async fn has_instance_super_admin_role(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1
             FROM role_assignments AS assignment
             INNER JOIN roles AS role ON role.id = assignment.role_id
             WHERE assignment.user_id = $1
               AND assignment.scope_id IS NULL
               AND role.key = 'super_admin'
         )",
    )
    .bind(user_id)
    .fetch_one(&mut **transaction)
    .await
}

fn validate_upload(input: &CreateAttachmentInput) -> Result<(), AttachmentError> {
    validate_upload_fields(&input.original_name, &input.mime_type, &input.bytes, false)
}

fn validate_draft_image_upload(
    input: &CreateDraftImageAttachmentInput,
) -> Result<(), AttachmentError> {
    validate_upload_fields(&input.original_name, &input.mime_type, &input.bytes, true)
}

fn validate_upload_fields(
    original_name: &str,
    mime_type: &str,
    bytes: &[u8],
    images_only: bool,
) -> Result<(), AttachmentError> {
    if bytes.is_empty() || bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(AttachmentError::Invalid);
    }
    if original_name.is_empty()
        || original_name.len() > 255
        || original_name.contains(['/', '\\'])
        || original_name.chars().any(char::is_control)
        || !allowed_mime(mime_type)
        || images_only && image_format(mime_type).is_none()
        || !signature_matches(mime_type, bytes)
    {
        return Err(AttachmentError::Invalid);
    }
    Ok(())
}

fn allowed_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "application/pdf" | "text/plain"
    )
}

fn signature_matches(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "application/pdf" => bytes.starts_with(b"%PDF-"),
        "text/plain" => bytes
            .iter()
            .all(|byte| *byte == b'\n' || *byte == b'\r' || *byte == b'\t' || *byte >= 0x20),
        _ => false,
    }
}

fn image_format(mime: &str) -> Option<ImageFormat> {
    match mime {
        "image/png" => Some(ImageFormat::Png),
        "image/jpeg" => Some(ImageFormat::Jpeg),
        "image/gif" => Some(ImageFormat::Gif),
        "image/webp" => Some(ImageFormat::WebP),
        _ => None,
    }
}

fn extension_for(mime: &str) -> &'static str {
    match mime {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        "application/pdf" => ".pdf",
        "text/plain" => ".txt",
        _ => ".bin",
    }
}

async fn remove_object(store: &crate::storage::AttachmentStore, key: &str) {
    if let Err(error) = store.delete(key).await {
        tracing::warn!(storage_key = key, error = %error, "Attachment compensation cleanup failed");
    }
}

fn make_thumbnail(bytes: &[u8], format: ImageFormat) -> Result<Vec<u8>, AttachmentError> {
    let (width, height) = ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(AttachmentError::Image)?;
    if !image_dimensions_allowed(width, height) {
        return Err(AttachmentError::Invalid);
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_IMAGE_DECODE_BYTES);
    reader.limits(limits);
    let image = reader.decode().map_err(AttachmentError::Image)?;
    let thumbnail = image.thumbnail(640, 640);
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, ImageFormat::WebP)
        .map_err(AttachmentError::Image)?;
    Ok(output.into_inner())
}

fn image_dimensions_allowed(width: u32, height: u32) -> bool {
    width > 0
        && height > 0
        && width <= MAX_IMAGE_DIMENSION
        && height <= MAX_IMAGE_DIMENSION
        && u64::from(width) * u64::from(height) <= MAX_IMAGE_PIXELS
}

fn sha256(bytes: &[u8]) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).to_vec()
}

impl From<sqlx::Error> for AttachmentError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for AttachmentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::TopicUnavailable => "attachment topic unavailable",
            Self::Forbidden => "attachment upload forbidden",
            Self::BoardRestricted => "attachment upload is restricted in board",
            Self::QuotaExceeded => "attachment upload quota was exceeded",
            Self::Invalid => "attachment is invalid",
            Self::MalwareDetected => "attachment malware was detected",
            Self::Storage(_) => "attachment storage operation failed",
            Self::Image(_) => "attachment image processing failed",
            Self::Database(_) => "attachment database operation failed",
        })
    }
}

impl Error for AttachmentError {}

impl From<sqlx::Error> for ListAttachmentsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for ListAttachmentsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::TopicUnavailable => "attachment topic unavailable",
            Self::Forbidden => "attachment download forbidden",
            Self::QuotaExceeded => "attachment download quota was exceeded",
            Self::Storage(_) => "attachment list storage operation failed",
            Self::Database(_) => "attachment list database operation failed",
        })
    }
}

impl Error for ListAttachmentsError {}

impl From<sqlx::Error> for AttachmentCleanupError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for AttachmentCleanupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Storage(_) => "attachment cleanup storage operation failed",
            Self::Database(_) => "attachment cleanup database operation failed",
        })
    }
}

impl Error for AttachmentCleanupError {}

fn scan_bytes(bytes: &[u8]) -> Result<(), AttachmentError> {
    const EICAR: &[u8] = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    if bytes.windows(EICAR.len()).any(|window| window == EICAR) {
        return Err(AttachmentError::MalwareDetected);
    }
    Ok(())
}

pub(crate) fn retention_days() -> i32 {
    std::env::var("DAOYUN_ATTACHMENT_RETENTION_DAYS")
        .ok()
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|days| (1..=3650).contains(days))
        .unwrap_or(DEFAULT_RETENTION_DAYS)
}

fn regexless_thumbnail_key(storage_key: &str) -> String {
    match storage_key.rsplit_once('.') {
        Some((prefix, _)) => format!("{prefix}-thumb.webp"),
        None => format!("{storage_key}-thumb.webp"),
    }
}

async fn collect_files(
    root: &Path,
    current: &Path,
    output: &mut Vec<(String, std::time::SystemTime)>,
) -> Result<(), AttachmentCleanupError> {
    let mut entries = match tokio::fs::read_dir(current).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(AttachmentCleanupError::Storage(error.to_string())),
    };
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| AttachmentCleanupError::Storage(error.to_string()))?
    {
        let path = entry.path();
        let metadata = tokio::fs::symlink_metadata(entry.path())
            .await
            .map_err(|error| AttachmentCleanupError::Storage(error.to_string()))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            Box::pin(collect_files(root, &path, output)).await?;
        } else if metadata.is_file()
            && let Ok(relative) = path.strip_prefix(root)
            && let Some(key) = relative.to_str()
        {
            output.push((
                key.replace('\\', "/"),
                metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
            ));
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use std::{os::unix::fs::symlink, time::SystemTime};

    use super::collect_files;

    #[tokio::test]
    async fn collect_files_does_not_follow_directory_symlinks() {
        let root = std::env::temp_dir().join(format!(
            "daoyun-attachment-scan-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("system clock must be valid")
                .as_nanos()
        ));
        let outside = root.with_extension("outside");
        tokio::fs::create_dir_all(root.join("topics"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(&outside).await.unwrap();
        tokio::fs::write(root.join("topics/kept.bin"), b"kept")
            .await
            .unwrap();
        tokio::fs::write(outside.join("secret.bin"), b"secret")
            .await
            .unwrap();
        symlink(&outside, root.join("topics/linked")).unwrap();

        let mut files = Vec::new();
        collect_files(&root, &root, &mut files).await.unwrap();

        assert!(files.iter().any(|(key, _)| key == "topics/kept.bin"));
        assert!(!files.iter().any(|(key, _)| key.contains("secret.bin")));

        tokio::fs::remove_dir_all(&root).await.unwrap();
        tokio::fs::remove_dir_all(&outside).await.unwrap();
    }
}

#[cfg(test)]
mod transaction_tests {
    use std::{sync::Arc, time::Duration};

    use sqlx::{PgPool, types::Uuid};
    use tokio::sync::Notify;

    use super::{Database, image_dimensions_allowed};
    use crate::storage::AttachmentStore;

    #[test]
    fn image_dimensions_reject_decompression_bombs() {
        assert!(image_dimensions_allowed(6_000, 4_000));
        assert!(!image_dimensions_allowed(12_001, 1));
        assert!(!image_dimensions_allowed(10_000, 10_000));
        assert!(!image_dimensions_allowed(0, 100));
    }

    #[sqlx::test(migrator = "crate::MIGRATOR")]
    async fn attachment_download_releases_database_connection_before_storage_read(pool: PgPool) {
        let user_id = Uuid::now_v7();
        let board_id = Uuid::now_v7();
        let topic_id = Uuid::now_v7();
        let attachment_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO users (id, username, email, display_name, status)
             VALUES ($1, 'reader', 'reader@example.com', 'Reader', 'active')",
        )
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("reader fixture must insert");
        sqlx::query(
            "INSERT INTO boards (id, slug, name, visibility)
             VALUES ($1, 'downloads', 'Downloads', 'public')",
        )
        .bind(board_id)
        .execute(&pool)
        .await
        .expect("board fixture must insert");
        sqlx::query(
            "INSERT INTO topics (
                 id, board_id, author_id, title, excerpt, content, status,
                 published_at, last_activity_at
             ) VALUES (
                 $1, $2, $3, 'Download', 'Download', 'Download', 'published',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             )",
        )
        .bind(topic_id)
        .bind(board_id)
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("topic fixture must insert");
        sqlx::query(
            "INSERT INTO topic_attachments (
                 id, topic_id, uploader_id, storage_key, original_name,
                 mime_type, size_bytes, sha256, status
             ) VALUES (
                 $1, $2, $3, 'topics/read/file.txt', 'file.txt',
                 'text/plain', 4, $4, 'ready'
             )",
        )
        .bind(attachment_id)
        .bind(topic_id)
        .bind(user_id)
        .bind(vec![0_u8; 32])
        .execute(&pool)
        .await
        .expect("attachment fixture must insert");

        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let database = Database {
            pool: pool.clone(),
            attachment_store: AttachmentStore::DelayedRead {
                bytes: Arc::new(b"data".to_vec()),
                started: started.clone(),
                release: release.clone(),
            },
        };
        let mut held_connections = Vec::new();
        for _ in 0..pool.options().get_max_connections().saturating_sub(1) {
            held_connections.push(
                pool.acquire()
                    .await
                    .expect("test must reserve a database connection"),
            );
        }

        let download = tokio::spawn(async move {
            database
                .read_attachment(attachment_id, false, Some(user_id))
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), started.notified())
            .await
            .expect("download must reach object storage");
        let connection_available =
            match tokio::time::timeout(Duration::from_millis(250), pool.acquire()).await {
                Ok(Ok(connection)) => {
                    drop(connection);
                    true
                }
                Ok(Err(error)) => panic!("database connection acquisition failed: {error}"),
                Err(_) => false,
            };
        release.notify_one();
        let (_, bytes) = download
            .await
            .expect("download task must join")
            .expect("attachment must download");

        assert_eq!(bytes, b"data");
        assert!(
            connection_available,
            "object storage reads must not occupy a database connection"
        );
        drop(held_connections);
    }
}
