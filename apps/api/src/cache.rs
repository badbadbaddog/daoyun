use api_contract::SiteBranding;
use redis::aio::{ConnectionManager, ConnectionManagerConfig};
use std::{error::Error, fmt, net::IpAddr, time::Duration};
use url::Url;

use crate::worker::{HandlerFuture, OutboxHandler, OutboxHandlerError};
use infrastructure::ClaimedOutboxEvent;

const DEFAULT_KEY_PREFIX: &str = "daoyun";
const DEFAULT_TTL_SECONDS: u64 = 300;
const DEFAULT_TIMEOUT_MILLISECONDS: u64 = 1_000;

pub struct CacheConfig {
    redis_url: Option<String>,
    key_prefix: String,
    site_branding_ttl: Duration,
    connection_timeout: Duration,
    response_timeout: Duration,
}

impl CacheConfig {
    pub fn disabled() -> Self {
        Self {
            redis_url: None,
            key_prefix: DEFAULT_KEY_PREFIX.to_owned(),
            site_branding_ttl: Duration::from_secs(DEFAULT_TTL_SECONDS),
            connection_timeout: Duration::from_millis(DEFAULT_TIMEOUT_MILLISECONDS),
            response_timeout: Duration::from_millis(DEFAULT_TIMEOUT_MILLISECONDS),
        }
    }

    pub fn from_environment() -> Result<Self, CacheConfigError> {
        let redis_url = std::env::var("DAOYUN_REDIS_URL").ok();
        let Some(redis_url) = redis_url.filter(|value| !value.trim().is_empty()) else {
            return Ok(Self::disabled());
        };
        let allow_insecure = parse_optional_bool("DAOYUN_REDIS_ALLOW_INSECURE")?;
        let key_prefix = std::env::var("DAOYUN_REDIS_KEY_PREFIX")
            .unwrap_or_else(|_| DEFAULT_KEY_PREFIX.to_owned());
        let ttl_seconds = parse_bounded_integer(
            "DAOYUN_SITE_BRANDING_CACHE_TTL_SECONDS",
            DEFAULT_TTL_SECONDS,
            1,
            3_600,
        )?;
        let connection_timeout_milliseconds = parse_bounded_integer(
            "DAOYUN_REDIS_CONNECT_TIMEOUT_MS",
            DEFAULT_TIMEOUT_MILLISECONDS,
            100,
            10_000,
        )?;
        let response_timeout_milliseconds = parse_bounded_integer(
            "DAOYUN_REDIS_RESPONSE_TIMEOUT_MS",
            DEFAULT_TIMEOUT_MILLISECONDS,
            100,
            10_000,
        )?;
        Self::from_values(
            &redis_url,
            allow_insecure,
            &key_prefix,
            ttl_seconds,
            connection_timeout_milliseconds,
            response_timeout_milliseconds,
        )
    }

    pub fn from_redis_url(redis_url: &str, allow_insecure: bool) -> Result<Self, CacheConfigError> {
        Self::from_values(
            redis_url,
            allow_insecure,
            DEFAULT_KEY_PREFIX,
            DEFAULT_TTL_SECONDS,
            DEFAULT_TIMEOUT_MILLISECONDS,
            DEFAULT_TIMEOUT_MILLISECONDS,
        )
    }

    fn from_values(
        redis_url: &str,
        allow_insecure: bool,
        key_prefix: &str,
        ttl_seconds: u64,
        connection_timeout_milliseconds: u64,
        response_timeout_milliseconds: u64,
    ) -> Result<Self, CacheConfigError> {
        validate_redis_url(redis_url, allow_insecure)?;
        if key_prefix.is_empty()
            || key_prefix.len() > 64
            || !key_prefix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-'))
            || !(1..=3_600).contains(&ttl_seconds)
            || !(100..=10_000).contains(&connection_timeout_milliseconds)
            || !(100..=10_000).contains(&response_timeout_milliseconds)
        {
            return Err(CacheConfigError::InvalidValue);
        }
        Ok(Self {
            redis_url: Some(redis_url.to_owned()),
            key_prefix: key_prefix.to_owned(),
            site_branding_ttl: Duration::from_secs(ttl_seconds),
            connection_timeout: Duration::from_millis(connection_timeout_milliseconds),
            response_timeout: Duration::from_millis(response_timeout_milliseconds),
        })
    }

    pub fn is_enabled(&self) -> bool {
        self.redis_url.is_some()
    }

    pub fn build(self) -> Result<CacheRuntime, CacheError> {
        let Some(redis_url) = self.redis_url else {
            return Ok(CacheRuntime::disabled());
        };
        let client = redis::Client::open(redis_url).map_err(CacheError::Redis)?;
        let manager_config = ConnectionManagerConfig::new()
            .set_number_of_retries(0)
            .set_connection_timeout(Some(self.connection_timeout))
            .set_response_timeout(Some(self.response_timeout));
        // Source: https://docs.rs/redis/1.5.0/redis/aio/struct.ConnectionManager.html#method.new_lazy_with_config
        let connection = ConnectionManager::new_lazy_with_config(client, manager_config)
            .map_err(CacheError::Redis)?;
        Ok(CacheRuntime {
            backend: CacheBackend::Redis(RedisCache {
                connection,
                site_branding_key: format!("{}:cache:site_branding:v1", self.key_prefix),
                site_branding_ttl_seconds: self.site_branding_ttl.as_secs(),
            }),
        })
    }
}

#[derive(Clone)]
pub struct CacheRuntime {
    backend: CacheBackend,
}

impl CacheRuntime {
    pub fn disabled() -> Self {
        Self {
            backend: CacheBackend::Disabled,
        }
    }

    pub fn is_enabled(&self) -> bool {
        matches!(self.backend, CacheBackend::Redis(_))
    }

    pub async fn get_site_branding(&self) -> Result<Option<SiteBranding>, CacheError> {
        let CacheBackend::Redis(cache) = &self.backend else {
            return Ok(None);
        };
        let mut connection = cache.connection.clone();
        let cached: Option<String> = redis::cmd("GET")
            .arg(&cache.site_branding_key)
            .query_async(&mut connection)
            .await
            .map_err(CacheError::Redis)?;
        cached
            .map(|value| serde_json::from_str(&value).map_err(CacheError::Serialization))
            .transpose()
    }

    pub async fn set_site_branding(&self, branding: &SiteBranding) -> Result<(), CacheError> {
        let CacheBackend::Redis(cache) = &self.backend else {
            return Ok(());
        };
        let serialized = serde_json::to_string(branding).map_err(CacheError::Serialization)?;
        let mut connection = cache.connection.clone();
        redis::cmd("SET")
            .arg(&cache.site_branding_key)
            .arg(serialized)
            .arg("EX")
            .arg(cache.site_branding_ttl_seconds)
            .query_async::<()>(&mut connection)
            .await
            .map_err(CacheError::Redis)
    }

    pub async fn delete_site_branding(&self) -> Result<(), CacheError> {
        let CacheBackend::Redis(cache) = &self.backend else {
            return Ok(());
        };
        let mut connection = cache.connection.clone();
        redis::cmd("DEL")
            .arg(&cache.site_branding_key)
            .query_async::<usize>(&mut connection)
            .await
            .map(|_| ())
            .map_err(CacheError::Redis)
    }
}

pub struct SiteBrandingCacheInvalidationHandler {
    cache: CacheRuntime,
}

impl SiteBrandingCacheInvalidationHandler {
    pub fn new(cache: CacheRuntime) -> Self {
        Self { cache }
    }
}

impl OutboxHandler for SiteBrandingCacheInvalidationHandler {
    fn event_type(&self) -> &'static str {
        "cache.site_branding_invalidated"
    }

    fn handle<'a>(&'a self, event: &'a ClaimedOutboxEvent) -> HandlerFuture<'a> {
        Box::pin(async move {
            if event
                .payload
                .get("cache_key")
                .and_then(|value| value.as_str())
                != Some("site_branding")
            {
                return Err(OutboxHandlerError::new("invalid cache invalidation event"));
            }
            self.cache
                .delete_site_branding()
                .await
                .map_err(|_| OutboxHandlerError::new("cache invalidation failed"))
        })
    }
}

#[derive(Clone)]
enum CacheBackend {
    Disabled,
    Redis(RedisCache),
}

#[derive(Clone)]
struct RedisCache {
    connection: ConnectionManager,
    site_branding_key: String,
    site_branding_ttl_seconds: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheConfigError {
    InvalidRedisUrl,
    InsecureRemoteRedis,
    InvalidValue,
}

impl fmt::Display for CacheConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRedisUrl => formatter.write_str("Redis URL is invalid"),
            Self::InsecureRemoteRedis => {
                formatter.write_str("remote Redis connections require TLS")
            }
            Self::InvalidValue => formatter.write_str("Redis cache configuration is invalid"),
        }
    }
}

impl Error for CacheConfigError {}

#[derive(Debug)]
pub enum CacheError {
    Redis(redis::RedisError),
    Serialization(serde_json::Error),
}

impl fmt::Display for CacheError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Redis(_) => formatter.write_str("Redis cache operation failed"),
            Self::Serialization(_) => formatter.write_str("cache serialization failed"),
        }
    }
}

impl Error for CacheError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Redis(error) => Some(error),
            Self::Serialization(error) => Some(error),
        }
    }
}

fn validate_redis_url(value: &str, allow_insecure: bool) -> Result<(), CacheConfigError> {
    let url = Url::parse(value).map_err(|_| CacheConfigError::InvalidRedisUrl)?;
    let host = url.host_str().ok_or(CacheConfigError::InvalidRedisUrl)?;
    match url.scheme() {
        "rediss" => Ok(()),
        "redis" if allow_insecure || is_loopback_host(host) => Ok(()),
        "redis" => Err(CacheConfigError::InsecureRemoteRedis),
        _ => Err(CacheConfigError::InvalidRedisUrl),
    }
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn parse_optional_bool(name: &str) -> Result<bool, CacheConfigError> {
    match std::env::var(name).as_deref() {
        Err(_) | Ok("") | Ok("false") | Ok("0") => Ok(false),
        Ok("true") | Ok("1") => Ok(true),
        Ok(_) => Err(CacheConfigError::InvalidValue),
    }
}

fn parse_bounded_integer(
    name: &str,
    default: u64,
    minimum: u64,
    maximum: u64,
) -> Result<u64, CacheConfigError> {
    let value = match std::env::var(name) {
        Ok(value) => value
            .parse::<u64>()
            .map_err(|_| CacheConfigError::InvalidValue)?,
        Err(_) => default,
    };
    if (minimum..=maximum).contains(&value) {
        Ok(value)
    } else {
        Err(CacheConfigError::InvalidValue)
    }
}

#[cfg(test)]
mod tests {
    use super::{CacheConfig, CacheConfigError, SiteBrandingCacheInvalidationHandler};
    use api_contract::{BrandHomeMode, BrandListDensity, BrandThemePreset, SiteBranding};
    use std::sync::Arc;
    use time::OffsetDateTime;
    use tokio::{
        io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
        net::{TcpListener, TcpStream},
        sync::Mutex,
    };
    use uuid::Uuid;

    use crate::worker::OutboxHandler;
    use infrastructure::ClaimedOutboxEvent;

    #[test]
    fn cache_is_disabled_without_a_url() {
        let config = CacheConfig::disabled();
        assert!(!config.is_enabled());
        assert!(
            !config
                .build()
                .expect("disabled cache must build")
                .is_enabled()
        );
    }

    #[test]
    fn remote_plaintext_redis_is_rejected_unless_explicitly_allowed() {
        let rejected = CacheConfig::from_values(
            "redis://cache.example.com:6379/0",
            false,
            "daoyun",
            300,
            1_000,
            1_000,
        );
        assert!(matches!(
            rejected,
            Err(CacheConfigError::InsecureRemoteRedis)
        ));
        assert!(
            CacheConfig::from_values(
                "redis://127.0.0.1:6379/0",
                false,
                "daoyun",
                300,
                1_000,
                1_000,
            )
            .is_ok()
        );
        assert!(
            CacheConfig::from_values(
                "rediss://cache.example.com:6380/0",
                false,
                "daoyun",
                300,
                1_000,
                1_000,
            )
            .is_ok()
        );
    }

    #[test]
    fn cache_validation_errors_never_echo_credentials() {
        let error = CacheConfig::from_values(
            "redis://:top-secret@cache.example.com:6379/0",
            false,
            "invalid prefix",
            0,
            1,
            1,
        )
        .err()
        .expect("invalid configuration must fail");
        assert!(!error.to_string().contains("top-secret"));
    }

    #[tokio::test]
    async fn redis_backend_round_trips_and_invalidates_site_branding() {
        let values = Arc::new(Mutex::new(None));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("controlled Redis listener must bind");
        let address = listener
            .local_addr()
            .expect("controlled Redis address must exist");
        let server_values = values.clone();
        let server = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let connection_values = server_values.clone();
                tokio::spawn(async move {
                    serve_redis_connection(stream, connection_values).await;
                });
            }
        });
        let cache = CacheConfig::from_redis_url(&format!("redis://{address}/0"), false)
            .expect("loopback Redis URL must be valid")
            .build()
            .expect("Redis cache must build lazily");
        let branding = SiteBranding {
            site_name: "刀云缓存测试".to_owned(),
            logo_url: None,
            favicon_url: None,
            default_cover_url: None,
            navigation_links: Vec::new(),
            footer_text: None,
            footer_links: Vec::new(),
            primary_color: "#123456".to_owned(),
            accent_color: "#abcdef".to_owned(),
            theme_preset: BrandThemePreset::Compact,
            list_density: BrandListDensity::Compact,
            home_mode: BrandHomeMode::Hot,
        };

        assert_eq!(
            cache
                .get_site_branding()
                .await
                .expect("empty cache lookup must succeed"),
            None
        );
        cache
            .set_site_branding(&branding)
            .await
            .expect("cache population must succeed");
        assert_eq!(
            cache
                .get_site_branding()
                .await
                .expect("populated cache lookup must succeed"),
            Some(branding)
        );
        let handler = SiteBrandingCacheInvalidationHandler::new(cache.clone());
        handler
            .handle(&ClaimedOutboxEvent {
                id: Uuid::now_v7(),
                event_type: "cache.site_branding_invalidated".to_owned(),
                aggregate_type: "site_branding".to_owned(),
                aggregate_id: Uuid::from_u128(1),
                payload: serde_json::json!({ "cache_key": "site_branding" }),
                attempts: 1,
                max_attempts: 8,
                lock_token: Uuid::now_v7(),
                locked_until: OffsetDateTime::now_utc() + time::Duration::seconds(30),
            })
            .await
            .expect("cache invalidation handler must succeed");
        assert_eq!(
            cache
                .get_site_branding()
                .await
                .expect("invalidated cache lookup must succeed"),
            None
        );
        server.abort();
    }

    async fn serve_redis_connection(stream: TcpStream, value: Arc<Mutex<Option<String>>>) {
        let (read_half, mut write_half) = stream.into_split();
        let mut reader = BufReader::new(read_half);
        while let Some(command) = read_command(&mut reader).await {
            let name = command
                .first()
                .map(|part| part.to_ascii_uppercase())
                .unwrap_or_default();
            let response = match name.as_str() {
                "CLIENT" | "SELECT" | "AUTH" => "+OK\r\n".to_owned(),
                "PING" => "+PONG\r\n".to_owned(),
                "GET" => match value.lock().await.clone() {
                    Some(value) => format!("${}\r\n{}\r\n", value.len(), value),
                    None => "$-1\r\n".to_owned(),
                },
                "SET" => {
                    *value.lock().await = command.get(2).cloned();
                    "+OK\r\n".to_owned()
                }
                "DEL" => {
                    let removed = value.lock().await.take().is_some();
                    format!(":{}\r\n", usize::from(removed))
                }
                _ => "-ERR unsupported controlled test command\r\n".to_owned(),
            };
            if write_half.write_all(response.as_bytes()).await.is_err() {
                break;
            }
        }
    }

    async fn read_command<R>(reader: &mut R) -> Option<Vec<String>>
    where
        R: tokio::io::AsyncBufRead + Unpin,
    {
        let mut header = String::new();
        if reader.read_line(&mut header).await.ok()? == 0 || !header.starts_with('*') {
            return None;
        }
        let count = header[1..].trim().parse::<usize>().ok()?;
        let mut command = Vec::with_capacity(count);
        for _ in 0..count {
            let mut length = String::new();
            reader.read_line(&mut length).await.ok()?;
            let length = length.strip_prefix('$')?.trim().parse::<usize>().ok()?;
            let mut bytes = vec![0; length + 2];
            reader.read_exact(&mut bytes).await.ok()?;
            bytes.truncate(length);
            command.push(String::from_utf8(bytes).ok()?);
        }
        Some(command)
    }
}
