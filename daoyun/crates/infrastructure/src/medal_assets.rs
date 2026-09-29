use crate::admin::insert_audit;
use crate::authorization::{has_permission_with_executor, permission_keys};
use crate::{Database, DatabaseError};
use image::{ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use std::{fmt, io::Cursor};
use uuid::Uuid;

pub const MAX_MEDAL_ASSET_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, FromRow)]
pub struct MedalAssetRecord {
    pub asset_key: String,
    pub storage_key: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

#[derive(Debug)]
pub enum MedalAssetError {
    Invalid,
    Forbidden,
    NotFound,
    Database(DatabaseError),
    Storage(String),
}
impl fmt::Display for MedalAssetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "medal asset operation failed: {self:?}")
    }
}
impl std::error::Error for MedalAssetError {}
impl From<sqlx::Error> for MedalAssetError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.into())
    }
}
impl From<DatabaseError> for MedalAssetError {
    fn from(error: DatabaseError) -> Self {
        Self::Database(error)
    }
}

pub fn uploaded_medal_sha256(key: &str) -> Option<&str> {
    let hash = key.strip_prefix("upload_")?;
    (hash.len() == 64
        && hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))
    .then_some(hash)
}

fn validate_image(mime: &str, bytes: &[u8]) -> Result<&'static str, MedalAssetError> {
    if !matches!(
        mime,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    ) || bytes.is_empty()
        || bytes.len() > MAX_MEDAL_ASSET_BYTES
    {
        return Err(MedalAssetError::Invalid);
    }
    // Browsers infer MIME from the filename; artwork packs can contain GIFs named .jpg.
    let format = image::guess_format(bytes).map_err(|_| MedalAssetError::Invalid)?;
    let actual_mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        ImageFormat::Gif => "image/gif",
        _ => return Err(MedalAssetError::Invalid),
    };
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(1024);
    limits.max_image_height = Some(1024);
    limits.max_alloc = Some(16 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().map_err(|_| MedalAssetError::Invalid)?;
    Ok(actual_mime)
}

impl Database {
    pub async fn upload_medal_asset(
        &self,
        actor_id: Uuid,
        mime: &str,
        bytes: Vec<u8>,
    ) -> Result<MedalAssetRecord, MedalAssetError> {
        let mut transaction = self.pool.begin().await?;
        if !has_permission_with_executor(
            &mut transaction,
            actor_id,
            permission_keys::MEMBERSHIP_MEDAL_RULES_WRITE,
            None,
        )
        .await?
        {
            return Err(MedalAssetError::Forbidden);
        }
        let mime = validate_image(mime, &bytes)?;
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let key = format!("upload_{hash}");
        let storage_key = format!("membership/medals/{hash}-{}", Uuid::now_v7());
        // Write a fresh object so repeated uploads cannot truncate an image that is already public.
        self.attachment_store
            .put(&storage_key, &bytes)
            .await
            .map_err(MedalAssetError::Storage)?;
        let result: Result<MedalAssetRecord, MedalAssetError> = async {
        let record = sqlx::query_as::<_, MedalAssetRecord>(
            "INSERT INTO membership_medal_assets (asset_key, storage_key, mime_type, size_bytes, created_by)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (asset_key) DO UPDATE SET asset_key = EXCLUDED.asset_key
             RETURNING asset_key, storage_key, mime_type, size_bytes"
        ).bind(&key).bind(&storage_key).bind(mime).bind(bytes.len() as i64).bind(actor_id).fetch_one(&mut *transaction).await?;
        insert_audit(
            &mut transaction,
            actor_id,
            "membership.medal.asset.upload",
            "membership_medal_asset",
            None,
            serde_json::json!({"asset_key": key, "mime_type": mime, "size_bytes": bytes.len()}),
        )
        .await?;
        transaction.commit().await?;
        Ok(record)
        }.await;
        if !result
            .as_ref()
            .is_ok_and(|record| record.storage_key == storage_key)
        {
            let _ = self.attachment_store.delete(&storage_key).await;
        }
        result
    }

    pub async fn read_medal_asset(
        &self,
        key: &str,
    ) -> Result<(MedalAssetRecord, Vec<u8>), MedalAssetError> {
        if uploaded_medal_sha256(key).is_none() {
            return Err(MedalAssetError::NotFound);
        }
        let record = sqlx::query_as::<_, MedalAssetRecord>("SELECT asset_key, storage_key, mime_type, size_bytes FROM membership_medal_assets WHERE asset_key = $1")
            .bind(key).fetch_optional(&self.pool).await?.ok_or(MedalAssetError::NotFound)?;
        let bytes = self
            .attachment_store
            .get(&record.storage_key)
            .await
            .map_err(MedalAssetError::Storage)?;
        Ok((record, bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_gif_bytes_when_the_filename_is_jpeg() {
        let gif = include_bytes!("../../../public/assets/membership/medals/medal1.gif");
        assert_eq!(validate_image("image/jpeg", gif).unwrap(), "image/gif");
    }

    #[test]
    fn validates_all_supported_formats_and_rejects_size_and_dimension_limits() {
        for (format, mime) in [
            (ImageFormat::Png, "image/png"),
            (ImageFormat::Jpeg, "image/jpeg"),
            (ImageFormat::WebP, "image/webp"),
            (ImageFormat::Gif, "image/gif"),
        ] {
            let mut output = Cursor::new(Vec::new());
            image::DynamicImage::new_rgb8(16, 16)
                .write_to(&mut output, format)
                .unwrap();
            assert!(validate_image(mime, output.get_ref()).is_ok());
            assert!(validate_image("image/svg+xml", output.get_ref()).is_err());
        }
        let mut output = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1025, 1)
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        assert!(validate_image("image/png", output.get_ref()).is_err());
        assert!(validate_image("image/png", &vec![0; MAX_MEDAL_ASSET_BYTES + 1]).is_err());
        assert!(validate_image("image/png", &[]).is_err());
    }
}
