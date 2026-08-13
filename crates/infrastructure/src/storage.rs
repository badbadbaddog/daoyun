use std::path::{Component, Path, PathBuf};

#[cfg(feature = "s3")]
use std::sync::Arc;

#[cfg(feature = "s3")]
use object_store::{DynObjectStore, ObjectStoreExt};

#[derive(Debug, Clone, PartialEq, Eq)]
enum StorageProvider {
    Local,
    S3,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StorageSettings {
    provider: StorageProvider,
    local_root: PathBuf,
    bucket: Option<String>,
    endpoint: Option<String>,
    region: String,
    prefix: String,
    access_key_id: Option<String>,
    secret_access_key: Option<String>,
    session_token: Option<String>,
    allow_http: bool,
    force_path_style: bool,
}

impl StorageSettings {
    fn from_environment() -> Result<Self, String> {
        let provider = match std::env::var("DAOYUN_ATTACHMENT_PROVIDER")
            .unwrap_or_else(|_| "local".to_owned())
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "local" => StorageProvider::Local,
            "s3" => StorageProvider::S3,
            other => return Err(format!("unsupported attachment provider: {other}")),
        };
        let local_root = std::env::var_os("DAOYUN_ATTACHMENT_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("target/daoyun-attachments"));
        let bucket = optional_env("DAOYUN_S3_BUCKET");
        let endpoint = optional_env("DAOYUN_S3_ENDPOINT");
        let region = optional_env("DAOYUN_S3_REGION").unwrap_or_else(|| "us-east-1".to_owned());
        let prefix = normalize_prefix(
            &optional_env("DAOYUN_S3_PREFIX").unwrap_or_else(|| "daoyun".to_owned()),
        )?;
        let allow_http = parse_bool("DAOYUN_S3_ALLOW_HTTP", false)?;
        let force_path_style = parse_bool("DAOYUN_S3_FORCE_PATH_STYLE", true)?;
        let settings = Self {
            provider,
            local_root,
            bucket,
            endpoint,
            region,
            prefix,
            access_key_id: optional_env("DAOYUN_S3_ACCESS_KEY_ID"),
            secret_access_key: optional_env("DAOYUN_S3_SECRET_ACCESS_KEY"),
            session_token: optional_env("DAOYUN_S3_SESSION_TOKEN"),
            allow_http,
            force_path_style,
        };
        settings.validate()?;
        Ok(settings)
    }

    fn validate(&self) -> Result<(), String> {
        if self.provider == StorageProvider::Local {
            return Ok(());
        }
        if self.bucket.as_deref().is_none_or(str::is_empty) {
            return Err("DAOYUN_S3_BUCKET is required when S3 storage is enabled".to_owned());
        }
        if let Some(endpoint) = &self.endpoint {
            let is_http = endpoint
                .strip_prefix("http://")
                .is_some_and(|rest| !rest.is_empty());
            let is_https = endpoint
                .strip_prefix("https://")
                .is_some_and(|rest| !rest.is_empty());
            if !(is_https || (is_http && self.allow_http)) {
                return Err(
                    "DAOYUN_S3_ENDPOINT must use HTTPS unless DAOYUN_S3_ALLOW_HTTP=true".to_owned(),
                );
            }
        }
        match (&self.access_key_id, &self.secret_access_key) {
            (Some(_), None) => {
                Err("DAOYUN_S3_SECRET_ACCESS_KEY is required with an access key".to_owned())
            }
            (None, Some(_)) => {
                Err("DAOYUN_S3_ACCESS_KEY_ID is required with a secret key".to_owned())
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone)]
pub(crate) enum AttachmentStore {
    Local {
        root: PathBuf,
    },
    #[cfg(feature = "s3")]
    S3 {
        prefix: String,
        store: Arc<DynObjectStore>,
    },
    Unavailable(String),
}

impl std::fmt::Debug for AttachmentStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local { root } => formatter.debug_struct("Local").field("root", root).finish(),
            #[cfg(feature = "s3")]
            Self::S3 { prefix, .. } => formatter
                .debug_struct("S3")
                .field("prefix", prefix)
                .finish(),
            Self::Unavailable(message) => {
                formatter.debug_tuple("Unavailable").field(message).finish()
            }
        }
    }
}

impl AttachmentStore {
    pub(crate) fn from_environment() -> Self {
        let settings = match StorageSettings::from_environment() {
            Ok(settings) => settings,
            Err(error) => return Self::Unavailable(error),
        };
        match settings.provider {
            StorageProvider::Local => {
                if let Err(error) = std::fs::create_dir_all(&settings.local_root) {
                    return Self::Unavailable(format!(
                        "cannot create local attachment root: {error}"
                    ));
                }
                Self::Local {
                    root: settings.local_root,
                }
            }
            StorageProvider::S3 => {
                #[cfg(feature = "s3")]
                {
                    let bucket = settings.bucket.expect("S3 validation requires a bucket");
                    // Source: https://docs.rs/object_store/0.14.1/object_store/struct.AmazonS3Builder.html
                    let mut builder = object_store::aws::AmazonS3Builder::from_env()
                        .with_bucket_name(bucket)
                        .with_region(settings.region)
                        .with_allow_http(settings.allow_http)
                        .with_virtual_hosted_style_request(!settings.force_path_style)
                        .with_disable_bulk_delete(true);
                    if let Some(endpoint) = settings.endpoint {
                        builder = builder.with_endpoint(endpoint);
                    }
                    if let Some(access_key_id) = settings.access_key_id {
                        builder = builder.with_access_key_id(access_key_id);
                    }
                    if let Some(secret_access_key) = settings.secret_access_key {
                        builder = builder.with_secret_access_key(secret_access_key);
                    }
                    if let Some(session_token) = settings.session_token {
                        builder = builder.with_token(session_token);
                    }
                    match builder.build() {
                        Ok(store) => Self::S3 {
                            prefix: settings.prefix,
                            store: Arc::new(store),
                        },
                        Err(error) => Self::Unavailable(error.to_string()),
                    }
                }
                #[cfg(not(feature = "s3"))]
                {
                    Self::Unavailable(
                        "S3 storage requires building infrastructure with the `s3` feature"
                            .to_owned(),
                    )
                }
            }
        }
    }

    pub(crate) fn local_root(&self) -> Option<&Path> {
        match self {
            Self::Local { root } => Some(root),
            #[cfg(feature = "s3")]
            Self::S3 { .. } => None,
            Self::Unavailable(_) => None,
        }
    }

    pub(crate) async fn put(&self, key: &str, bytes: &[u8]) -> Result<(), String> {
        match self {
            Self::Local { root } => {
                let path = local_path(root, key)?;
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|error| error.to_string())?;
                }
                tokio::fs::write(path, bytes)
                    .await
                    .map_err(|error| error.to_string())
            }
            #[cfg(feature = "s3")]
            Self::S3 { store, .. } => store
                .put(&self.object_path(key), bytes.to_vec().into())
                .await
                .map(|_| ())
                .map_err(|error| error.to_string()),
            Self::Unavailable(error) => Err(error.clone()),
        }
    }

    pub(crate) async fn get(&self, key: &str) -> Result<Vec<u8>, String> {
        match self {
            Self::Local { root } => tokio::fs::read(local_path(root, key)?)
                .await
                .map_err(|error| error.to_string()),
            #[cfg(feature = "s3")]
            Self::S3 { store, .. } => store
                .get(&self.object_path(key))
                .await
                .map_err(|error| error.to_string())?
                .bytes()
                .await
                .map(|bytes| bytes.to_vec())
                .map_err(|error| error.to_string()),
            Self::Unavailable(error) => Err(error.clone()),
        }
    }

    pub(crate) async fn delete(&self, key: &str) -> Result<(), String> {
        match self {
            Self::Local { root } => match tokio::fs::remove_file(local_path(root, key)?).await {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error.to_string()),
            },
            #[cfg(feature = "s3")]
            Self::S3 { store, .. } => match store.delete(&self.object_path(key)).await {
                Ok(()) | Err(object_store::Error::NotFound { .. }) => Ok(()),
                Err(error) => Err(error.to_string()),
            },
            Self::Unavailable(error) => Err(error.clone()),
        }
    }

    #[cfg(feature = "s3")]
    fn object_path(&self, key: &str) -> object_store::path::Path {
        match self {
            Self::S3 { prefix, .. } if !prefix.is_empty() => {
                object_store::path::Path::from(format!("{prefix}/{key}"))
            }
            _ => object_store::path::Path::from(key),
        }
    }
}

fn local_path(root: &Path, key: &str) -> Result<PathBuf, String> {
    let relative = Path::new(key);
    if relative.as_os_str().is_empty()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("attachment storage key is outside the local root".to_owned());
    }
    Ok(root.join(relative))
}

fn optional_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn parse_bool(name: &str, default: bool) -> Result<bool, String> {
    match optional_env(name) {
        None => Ok(default),
        Some(value) => match value.to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" => Ok(true),
            "0" | "false" | "no" => Ok(false),
            _ => Err(format!("{name} must be a boolean")),
        },
    }
}

fn normalize_prefix(prefix: &str) -> Result<String, String> {
    let prefix = prefix.trim_matches('/');
    if prefix.is_empty() {
        return Ok(String::new());
    }
    if prefix.split('/').any(|part| {
        part.is_empty()
            || part == "."
            || part == ".."
            || part.chars().any(|character| character.is_control())
    }) {
        return Err("DAOYUN_S3_PREFIX contains an unsafe path segment".to_owned());
    }
    Ok(prefix.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{StorageProvider, StorageSettings, local_path, normalize_prefix};
    use std::path::PathBuf;

    fn s3_settings(endpoint: Option<&str>) -> StorageSettings {
        StorageSettings {
            provider: StorageProvider::S3,
            local_root: PathBuf::from("target/test-attachments"),
            bucket: Some("daoyun-test".to_owned()),
            endpoint: endpoint.map(str::to_owned),
            region: "us-east-1".to_owned(),
            prefix: "daoyun".to_owned(),
            access_key_id: None,
            secret_access_key: None,
            session_token: None,
            allow_http: false,
            force_path_style: true,
        }
    }

    #[test]
    fn s3_rejects_http_endpoint_without_explicit_opt_in() {
        let settings = s3_settings(Some("http://localhost:9000"));
        assert!(settings.validate().is_err());
    }

    #[test]
    fn s3_accepts_http_endpoint_only_when_explicitly_enabled() {
        let mut settings = s3_settings(Some("http://localhost:9000"));
        settings.allow_http = true;
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn prefix_rejects_traversal_segments() {
        assert!(normalize_prefix("daoyun/../escape").is_err());
        assert_eq!(normalize_prefix("/daoyun/media/").unwrap(), "daoyun/media");
    }

    #[test]
    fn local_keys_cannot_escape_the_storage_root() {
        let root = PathBuf::from("target/test-attachments");
        assert!(local_path(&root, "../outside.bin").is_err());
        assert!(local_path(&root, r"C:\outside.bin").is_err());
        assert_eq!(
            local_path(&root, "topics/example.bin").unwrap(),
            root.join("topics/example.bin")
        );
    }

    #[tokio::test]
    async fn local_provider_round_trips_and_deletes_objects() {
        let root = std::env::temp_dir().join(format!(
            "daoyun-storage-{}-{}",
            std::process::id(),
            uuid::Uuid::now_v7()
        ));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let store = super::AttachmentStore::Local { root: root.clone() };

        store
            .put("topics/example/file.txt", b"hello")
            .await
            .expect("local object must be written");
        assert_eq!(
            store
                .get("topics/example/file.txt")
                .await
                .expect("local object must be readable"),
            b"hello"
        );
        store
            .delete("topics/example/file.txt")
            .await
            .expect("local object must be deleted");
        assert!(store.get("topics/example/file.txt").await.is_err());

        tokio::fs::remove_dir_all(root)
            .await
            .expect("test storage root must be removable");
    }
}
