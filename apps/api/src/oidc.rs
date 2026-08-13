use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::sync::Mutex as AsyncMutex;
use url::Url;
use uuid::Uuid;

const OIDC_CONFIG_MAX_BYTES: usize = 64 * 1024;
const OIDC_MAX_PROVIDERS: usize = 16;
const OIDC_MAX_TRANSACTIONS: usize = 1024;
const OIDC_TRANSACTION_TTL: Duration = Duration::from_secs(5 * 60);
const OIDC_MAX_CLAIMS: usize = 1024;
const OIDC_CLAIM_TTL: Duration = Duration::from_secs(5 * 60);
const OIDC_DISCOVERY_MAX_BYTES: usize = 64 * 1024;
const OIDC_DISCOVERY_CACHE_MAX_ENTRIES: usize = OIDC_MAX_PROVIDERS;
const OIDC_DISCOVERY_CACHE_TTL: Duration = Duration::from_secs(60 * 60);
const OIDC_JWKS_MAX_BYTES: usize = 64 * 1024;
const OIDC_JWKS_MAX_KEYS: usize = 64;
const OIDC_JWK_KID_MAX_CHARS: usize = 128;
const OIDC_RSA_MIN_BITS: usize = 2048;
const OIDC_JWKS_CACHE_MAX_ENTRIES: usize = OIDC_MAX_PROVIDERS;
const OIDC_JWKS_CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const OIDC_JWKS_REFRESH_COOLDOWN: Duration = Duration::from_secs(30);
const OIDC_JWKS_FAILURE_BACKOFF_BASE: Duration = Duration::from_secs(30);
const OIDC_JWKS_FAILURE_BACKOFF_MAX: Duration = Duration::from_secs(5 * 60);
const OIDC_TOKEN_RESPONSE_MAX_BYTES: usize = 64 * 1024;
const OIDC_ID_TOKEN_MAX_BYTES: usize = 32 * 1024;
const OIDC_ID_TOKEN_CLOCK_SKEW_SECONDS: u64 = 60;

#[derive(Clone)]
pub struct OidcProviderConfig {
    provider_key: String,
    display_name: String,
    issuer_identifier: String,
    issuer: Url,
    // Retained for the next protocol slice; never included in public summaries or Debug.
    #[allow(dead_code)]
    client_id: String,
    #[allow(dead_code)]
    client_secret: String,
    redirect_uri: Url,
}

#[derive(Debug, Deserialize)]
struct RawOidcProviderConfig {
    provider_key: String,
    display_name: String,
    issuer: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
}

impl OidcProviderConfig {
    pub fn parse_json(value: &str) -> Result<Vec<Self>, String> {
        if value.len() > OIDC_CONFIG_MAX_BYTES {
            return Err("DAOYUN_OIDC_PROVIDERS must be at most 64 KiB".to_owned());
        }
        let raw = serde_json::from_str::<Vec<RawOidcProviderConfig>>(value)
            .map_err(|_| "DAOYUN_OIDC_PROVIDERS must be a JSON array".to_owned())?;
        if raw.len() > OIDC_MAX_PROVIDERS {
            return Err("DAOYUN_OIDC_PROVIDERS may contain at most 16 providers".to_owned());
        }

        let mut keys = HashSet::with_capacity(raw.len());
        raw.into_iter()
            .map(|provider| Self::from_raw(provider, &mut keys))
            .collect()
    }

    pub fn provider_key(&self) -> &str {
        &self.provider_key
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    fn redirect_uri(&self) -> &Url {
        &self.redirect_uri
    }

    fn from_raw(raw: RawOidcProviderConfig, keys: &mut HashSet<String>) -> Result<Self, String> {
        if !valid_provider_key(&raw.provider_key) {
            return Err(format!(
                "OIDC provider key `{}` must use 2-32 lowercase ASCII letters, digits, `_` or `-`",
                raw.provider_key
            ));
        }
        if !keys.insert(raw.provider_key.clone()) {
            return Err(format!(
                "OIDC provider key `{}` is duplicated",
                raw.provider_key
            ));
        }
        if raw.display_name.trim().is_empty()
            || raw.display_name.chars().count() > 80
            || raw.display_name.chars().any(char::is_control)
        {
            return Err(format!(
                "OIDC provider `{}` display_name must contain 1-80 non-control characters and not be blank",
                raw.provider_key
            ));
        }
        let issuer = parse_https_url("issuer", &raw.issuer)?;
        if raw.client_id.is_empty() || raw.client_id.chars().count() > 256 {
            return Err(format!(
                "OIDC provider `{}` client_id must be 1-256 characters",
                raw.provider_key
            ));
        }
        if raw.client_secret.is_empty() || raw.client_secret.chars().count() > 512 {
            return Err(format!(
                "OIDC provider `{}` client_secret must be 1-512 characters",
                raw.provider_key
            ));
        }
        let redirect_uri = parse_redirect_url(&raw.redirect_uri, &raw.provider_key)?;

        Ok(Self {
            provider_key: raw.provider_key,
            display_name: raw.display_name,
            issuer_identifier: raw.issuer,
            issuer,
            client_id: raw.client_id,
            client_secret: raw.client_secret,
            redirect_uri,
        })
    }

    fn issuer_identifier(&self) -> &str {
        &self.issuer_identifier
    }

    fn client_id(&self) -> &str {
        &self.client_id
    }

    fn client_secret(&self) -> &str {
        &self.client_secret
    }

    #[allow(dead_code)]
    fn discovery_url(&self) -> Url {
        let base = self
            .issuer_identifier
            .strip_suffix('/')
            .unwrap_or(&self.issuer_identifier);
        Url::parse(&format!("{base}/.well-known/openid-configuration"))
            .expect("validated issuer must produce a discovery URL")
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OidcJwksError {
    ResponseTooLarge,
    TooManyKeys,
    InvalidJwks,
    Network,
    HttpStatus,
    Redirected,
    RefreshThrottled,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OidcJwkSet {
    keys: Vec<OidcJwk>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OidcJwk {
    kid: Option<String>,
    alg: Option<String>,
    key: OidcJwkKey,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
enum OidcJwkKey {
    Rsa { n: Vec<u8>, e: Vec<u8> },
    Ec { crv: String, x: Vec<u8>, y: Vec<u8> },
    Okp { crv: String, x: Vec<u8> },
}

#[derive(Debug, Deserialize)]
struct RawOidcJwkSet {
    keys: Option<Vec<RawOidcJwk>>,
}

#[derive(Debug, Deserialize)]
struct RawOidcJwk {
    #[serde(default, deserialize_with = "deserialize_present_string")]
    kid: Option<String>,
    kty: Option<String>,
    n: Option<String>,
    e: Option<String>,
    crv: Option<String>,
    x: Option<String>,
    y: Option<String>,
    #[serde(
        default,
        rename = "use",
        deserialize_with = "deserialize_present_string"
    )]
    use_: Option<String>,
    #[serde(default, deserialize_with = "deserialize_present_strings")]
    key_ops: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_present_string")]
    alg: Option<String>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

fn deserialize_present_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    String::deserialize(deserializer).map(Some)
}

fn deserialize_present_strings<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Vec::<String>::deserialize(deserializer).map(Some)
}

#[allow(dead_code)]
impl OidcJwkSet {
    // Sources: RFC 7517 sections 4-5, RFC 7518 section 6, and RFC 8037 section 2.
    // https://www.rfc-editor.org/rfc/rfc7517.html#section-5
    // https://www.rfc-editor.org/rfc/rfc7518.html#section-6
    // https://www.rfc-editor.org/rfc/rfc8037.html#section-2
    fn parse(body: &[u8]) -> Result<Self, OidcJwksError> {
        if body.len() > OIDC_JWKS_MAX_BYTES {
            return Err(OidcJwksError::ResponseTooLarge);
        }
        let raw = serde_json::from_slice::<RawOidcJwkSet>(body)
            .map_err(|_| OidcJwksError::InvalidJwks)?;
        let raw_keys = raw.keys.ok_or(OidcJwksError::InvalidJwks)?;
        if raw_keys.len() > OIDC_JWKS_MAX_KEYS {
            return Err(OidcJwksError::TooManyKeys);
        }

        let mut kids = HashSet::with_capacity(raw_keys.len());
        let mut keys = Vec::with_capacity(raw_keys.len());
        for raw_key in raw_keys {
            let kid = validate_kid(raw_key.kid.clone(), &mut kids)?;
            if raw_key.use_.as_deref().is_some_and(|value| value != "sig")
                || raw_key
                    .key_ops
                    .as_ref()
                    .is_some_and(|ops| ops.len() != 1 || ops[0] != "verify")
                || has_private_jwk_material(&raw_key)
            {
                return Err(OidcJwksError::InvalidJwks);
            }

            let key = match raw_key.kty.as_deref() {
                Some("RSA") => {
                    validate_jwk_alg(
                        raw_key.alg.as_deref(),
                        &["RS256", "RS384", "RS512", "PS256", "PS384", "PS512"],
                    )?;
                    OidcJwkKey::Rsa {
                        n: decode_rsa_modulus(raw_key.n.as_deref())?,
                        e: decode_rsa_exponent(raw_key.e.as_deref())?,
                    }
                }
                Some("EC") => {
                    let crv = raw_key.crv.ok_or(OidcJwksError::InvalidJwks)?;
                    let (coordinate_bytes, expected_alg) = match crv.as_str() {
                        "P-256" => (32, "ES256"),
                        "P-384" => (48, "ES384"),
                        "P-521" => (66, "ES512"),
                        "secp256k1" => (32, "ES256K"),
                        _ => return Err(OidcJwksError::InvalidJwks),
                    };
                    validate_jwk_alg(raw_key.alg.as_deref(), &[expected_alg])?;
                    let x = decode_jwk_base64url(raw_key.x.as_deref())?;
                    let y = decode_jwk_base64url(raw_key.y.as_deref())?;
                    validate_public_coordinate(&x, coordinate_bytes)?;
                    validate_public_coordinate(&y, coordinate_bytes)?;
                    OidcJwkKey::Ec { crv, x, y }
                }
                Some("OKP") => {
                    let crv = raw_key.crv.ok_or(OidcJwksError::InvalidJwks)?;
                    let coordinate_bytes = match crv.as_str() {
                        "Ed25519" => 32,
                        "Ed448" => 57,
                        _ => return Err(OidcJwksError::InvalidJwks),
                    };
                    validate_jwk_alg(raw_key.alg.as_deref(), &["EdDSA"])?;
                    let x = decode_jwk_base64url(raw_key.x.as_deref())?;
                    validate_public_coordinate(&x, coordinate_bytes)?;
                    OidcJwkKey::Okp { crv, x }
                }
                _ => return Err(OidcJwksError::InvalidJwks),
            };
            keys.push(OidcJwk {
                kid,
                alg: raw_key.alg,
                key,
            });
        }
        Ok(Self { keys })
    }

    fn len(&self) -> usize {
        self.keys.len()
    }

    fn key_by_kid(&self, kid: &str) -> Option<&OidcJwk> {
        self.keys.iter().find(|key| key.kid.as_deref() == Some(kid))
    }

    fn keys(&self) -> &[OidcJwk] {
        &self.keys
    }
}

#[allow(dead_code)]
impl OidcJwk {
    fn kid(&self) -> Option<&str> {
        self.kid.as_deref()
    }

    fn alg(&self) -> Option<&str> {
        self.alg.as_deref()
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OidcTokenExchangeError {
    ResponseTooLarge,
    Network,
    HttpStatus,
    Redirected,
    InvalidContentType,
    InvalidResponse,
}

#[allow(dead_code)]
#[derive(Clone)]
pub(crate) struct OidcTokenResponse {
    access_token: zeroize::Zeroizing<String>,
    token_type: String,
    expires_in: Option<u64>,
    id_token: zeroize::Zeroizing<String>,
    refresh_token: Option<zeroize::Zeroizing<String>>,
}

#[derive(Debug, Deserialize)]
struct RawOidcTokenResponse {
    access_token: String,
    token_type: String,
    #[serde(default)]
    expires_in: Option<u64>,
    id_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[allow(dead_code)]
impl OidcTokenResponse {
    fn parse(body: &[u8]) -> Result<Self, OidcTokenExchangeError> {
        if body.len() > OIDC_TOKEN_RESPONSE_MAX_BYTES {
            return Err(OidcTokenExchangeError::ResponseTooLarge);
        }
        let raw = serde_json::from_slice::<RawOidcTokenResponse>(body)
            .map_err(|_| OidcTokenExchangeError::InvalidResponse)?;
        if raw.access_token.is_empty()
            || raw.access_token.chars().count() > 16 * 1024
            || raw.token_type.len() > 64
            || !raw.token_type.eq_ignore_ascii_case("bearer")
            || raw.id_token.is_empty()
            || raw.id_token.len() > OIDC_ID_TOKEN_MAX_BYTES
            || raw
                .refresh_token
                .as_ref()
                .is_some_and(|token| token.is_empty() || token.chars().count() > 16 * 1024)
        {
            return Err(OidcTokenExchangeError::InvalidResponse);
        }
        Ok(Self {
            access_token: zeroize::Zeroizing::new(raw.access_token),
            token_type: raw.token_type,
            expires_in: raw.expires_in,
            id_token: zeroize::Zeroizing::new(raw.id_token),
            refresh_token: raw.refresh_token.map(zeroize::Zeroizing::new),
        })
    }

    fn access_token(&self) -> &str {
        &self.access_token
    }

    fn token_type(&self) -> &str {
        &self.token_type
    }

    fn expires_in(&self) -> Option<u64> {
        self.expires_in
    }

    fn id_token(&self) -> &str {
        &self.id_token
    }

    fn refresh_token(&self) -> Option<&str> {
        self.refresh_token.as_deref().map(String::as_str)
    }
}

impl fmt::Debug for OidcTokenResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OidcTokenResponse")
            .field("access_token", &"[redacted]")
            .field("token_type", &self.token_type)
            .field("expires_in", &self.expires_in)
            .field("id_token", &"[redacted]")
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "[redacted]"),
            )
            .finish()
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OidcIdTokenError {
    Oversized,
    InvalidHeader,
    MissingKey,
    UnsupportedAlgorithm,
    InvalidSignature,
    InvalidClaims,
    IssuerMismatch,
    AudienceMismatch,
    NonceMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OidcProtocolError {
    Capacity,
    Invalid,
    Unavailable,
}

#[derive(Debug, Deserialize)]
struct RawOidcIdTokenClaims {
    iss: String,
    sub: String,
    aud: OidcAudience,
    iat: u64,
    nonce: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    email_verified: Option<bool>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    preferred_username: Option<String>,
    #[serde(default)]
    azp: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum OidcAudience {
    Single(String),
    Multiple(Vec<String>),
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OidcVerifiedIdToken {
    subject: String,
    issuer: String,
    email: Option<String>,
    email_verified: Option<bool>,
    name: Option<String>,
    preferred_username: Option<String>,
}

#[allow(dead_code)]
impl OidcVerifiedIdToken {
    pub(crate) fn subject(&self) -> &str {
        &self.subject
    }

    pub(crate) fn issuer(&self) -> &str {
        &self.issuer
    }

    pub(crate) fn email(&self) -> Option<&str> {
        self.email.as_deref()
    }

    pub(crate) fn email_verified(&self) -> Option<bool> {
        self.email_verified
    }

    pub(crate) fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    pub(crate) fn preferred_username(&self) -> Option<&str> {
        self.preferred_username.as_deref()
    }
}

#[allow(dead_code)]
fn verify_id_token(
    provider: &OidcProviderConfig,
    transaction: &OidcAuthorizationTransaction,
    jwks: &OidcJwkSet,
    token: &str,
) -> Result<OidcVerifiedIdToken, OidcIdTokenError> {
    if token.is_empty() || token.len() > OIDC_ID_TOKEN_MAX_BYTES {
        return Err(OidcIdTokenError::Oversized);
    }
    let header = decode_header(token).map_err(|_| OidcIdTokenError::InvalidHeader)?;
    if header.alg != Algorithm::RS256 {
        return Err(OidcIdTokenError::UnsupportedAlgorithm);
    }
    let kid = header.kid.as_deref().ok_or(OidcIdTokenError::MissingKey)?;
    let jwk = jwks.key_by_kid(kid).ok_or(OidcIdTokenError::MissingKey)?;
    if jwk.alg.as_deref().is_some_and(|alg| alg != "RS256") {
        return Err(OidcIdTokenError::UnsupportedAlgorithm);
    }
    let OidcJwkKey::Rsa { n, e } = &jwk.key else {
        return Err(OidcIdTokenError::UnsupportedAlgorithm);
    };
    let decoding_key = DecodingKey::from_rsa_raw_components(n, e);
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[provider.issuer_identifier()]);
    validation.set_audience(&[provider.client_id()]);
    validation.set_required_spec_claims(&["exp", "iss", "aud"]);
    validation.leeway = OIDC_ID_TOKEN_CLOCK_SKEW_SECONDS;
    let token_data =
        decode::<RawOidcIdTokenClaims>(token, &decoding_key, &validation).map_err(|error| {
            match error.kind() {
                jsonwebtoken::errors::ErrorKind::InvalidIssuer => OidcIdTokenError::IssuerMismatch,
                jsonwebtoken::errors::ErrorKind::InvalidAudience => {
                    OidcIdTokenError::AudienceMismatch
                }
                jsonwebtoken::errors::ErrorKind::InvalidSignature => {
                    OidcIdTokenError::InvalidSignature
                }
                _ => OidcIdTokenError::InvalidClaims,
            }
        })?;
    let claims = token_data.claims;
    let nonce_matches = claims
        .nonce
        .as_bytes()
        .ct_eq(transaction.nonce().as_bytes())
        .unwrap_u8()
        == 1;
    if claims.sub.is_empty()
        || claims.sub.chars().count() > 255
        || claims.sub.chars().any(char::is_control)
        || claims.iss != provider.issuer_identifier()
        || claims.iat > jsonwebtoken::get_current_timestamp() + OIDC_ID_TOKEN_CLOCK_SKEW_SECONDS
        || !nonce_matches
    {
        return if claims.iss != provider.issuer_identifier() {
            Err(OidcIdTokenError::IssuerMismatch)
        } else if !nonce_matches {
            Err(OidcIdTokenError::NonceMismatch)
        } else {
            Err(OidcIdTokenError::InvalidClaims)
        };
    }
    let audience_matches = valid_audience(&claims.aud, claims.azp.as_deref(), provider.client_id());
    if !audience_matches {
        return Err(OidcIdTokenError::AudienceMismatch);
    }
    Ok(OidcVerifiedIdToken {
        subject: claims.sub,
        issuer: claims.iss,
        email: claims.email,
        email_verified: claims.email_verified,
        name: claims.name,
        preferred_username: claims.preferred_username,
    })
}

fn valid_audience(
    audience: &OidcAudience,
    authorized_party: Option<&str>,
    client_id: &str,
) -> bool {
    if authorized_party.is_some_and(|value| value != client_id) {
        return false;
    }
    match audience {
        OidcAudience::Single(value) => value == client_id,
        OidcAudience::Multiple(values) => {
            values.iter().any(|value| value == client_id)
                && (values.len() <= 1 || authorized_party == Some(client_id))
        }
    }
}

fn validate_kid(
    kid: Option<String>,
    kids: &mut HashSet<String>,
) -> Result<Option<String>, OidcJwksError> {
    let Some(kid) = kid else {
        return Ok(None);
    };
    if kid.is_empty()
        || kid.chars().count() > OIDC_JWK_KID_MAX_CHARS
        || kid.chars().any(char::is_control)
        || !kids.insert(kid.clone())
    {
        return Err(OidcJwksError::InvalidJwks);
    }
    Ok(Some(kid))
}

fn has_private_jwk_material(raw: &RawOidcJwk) -> bool {
    raw.extra.contains_key("d")
        || raw.extra.contains_key("p")
        || raw.extra.contains_key("q")
        || raw.extra.contains_key("dp")
        || raw.extra.contains_key("dq")
        || raw.extra.contains_key("qi")
        || raw.extra.contains_key("oth")
        || raw.extra.contains_key("k")
}

fn decode_jwk_base64url(value: Option<&str>) -> Result<Vec<u8>, OidcJwksError> {
    let value = value.ok_or(OidcJwksError::InvalidJwks)?;
    if value.is_empty() || value.contains('=') || value.len() % 4 == 1 {
        return Err(OidcJwksError::InvalidJwks);
    }

    let mut output = Vec::with_capacity(value.len() * 3 / 4);
    let mut buffer = 0_u32;
    let mut bits = 0_u8;
    for byte in value.bytes() {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return Err(OidcJwksError::InvalidJwks),
        } as u32;
        buffer = (buffer << 6) | digit;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
            buffer &= (1_u32 << bits).saturating_sub(1);
        }
    }
    if bits >= 6 || (bits > 0 && buffer != 0) || output.is_empty() {
        return Err(OidcJwksError::InvalidJwks);
    }
    Ok(output)
}

fn decode_rsa_exponent(value: Option<&str>) -> Result<Vec<u8>, OidcJwksError> {
    let exponent = decode_jwk_base64url_uint(value)?;
    if (exponent.len() == 1 && exponent[0] < 3) || exponent.last().is_none_or(|byte| byte % 2 == 0)
    {
        return Err(OidcJwksError::InvalidJwks);
    }
    Ok(exponent)
}

fn decode_rsa_modulus(value: Option<&str>) -> Result<Vec<u8>, OidcJwksError> {
    let modulus = decode_jwk_base64url_uint(value)?;
    let modulus_bits = (modulus.len() - 1) * 8 + (8 - modulus[0].leading_zeros() as usize);
    if modulus_bits < OIDC_RSA_MIN_BITS || modulus.last().is_none_or(|byte| byte % 2 == 0) {
        return Err(OidcJwksError::InvalidJwks);
    }
    Ok(modulus)
}

fn decode_jwk_base64url_uint(value: Option<&str>) -> Result<Vec<u8>, OidcJwksError> {
    let value = decode_jwk_base64url(value)?;
    if value.first() == Some(&0) {
        return Err(OidcJwksError::InvalidJwks);
    }
    Ok(value)
}

fn validate_public_coordinate(value: &[u8], expected_bytes: usize) -> Result<(), OidcJwksError> {
    if value.len() != expected_bytes || value.iter().all(|byte| *byte == 0) {
        return Err(OidcJwksError::InvalidJwks);
    }
    Ok(())
}

fn validate_jwk_alg(alg: Option<&str>, allowed: &[&str]) -> Result<(), OidcJwksError> {
    if alg.is_some_and(|alg| !allowed.contains(&alg)) {
        return Err(OidcJwksError::InvalidJwks);
    }
    Ok(())
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OidcDiscoveryError {
    ResponseTooLarge,
    InvalidMetadata,
    Network,
    HttpStatus,
    Redirected,
}

#[allow(dead_code)]
#[derive(Clone)]
pub(crate) struct OidcDiscoveryClient {
    client: reqwest::Client,
    provider_locks: Arc<AsyncMutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OidcHttpError {
    ResponseTooLarge,
    Network,
    HttpStatus,
    Redirected,
    InvalidContentType,
}

#[allow(dead_code)]
impl OidcDiscoveryClient {
    fn new() -> Result<Self, OidcDiscoveryError> {
        // Source: https://docs.rs/reqwest/0.13.4/reqwest/struct.ClientBuilder.html
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            // Source: https://docs.rs/reqwest/0.13.4/reqwest/struct.ClientBuilder.html#method.no_proxy
            .no_proxy()
            .https_only(true)
            .build()
            .map_err(|_| OidcDiscoveryError::Network)?;
        Ok(Self::from_client(client))
    }

    #[cfg(test)]
    fn for_tests() -> Self {
        Self::for_tests_with_timeout(Duration::from_secs(8))
    }

    #[cfg(test)]
    fn for_tests_with_timeout(timeout: Duration) -> Self {
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .https_only(false)
            .build()
            .expect("test HTTP client must build");
        Self::from_client(client)
    }

    fn from_client(client: reqwest::Client) -> Self {
        Self {
            client,
            provider_locks: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }

    async fn discover(
        &self,
        provider: &OidcProviderConfig,
        cache: &OidcDiscoveryCache,
    ) -> Result<OidcDiscoveryMetadata, OidcDiscoveryError> {
        self.discover_at(provider, cache, provider.discovery_url())
            .await
    }

    async fn discover_at(
        &self,
        provider: &OidcProviderConfig,
        cache: &OidcDiscoveryCache,
        discovery_url: Url,
    ) -> Result<OidcDiscoveryMetadata, OidcDiscoveryError> {
        if let Some(metadata) = cache.get_at(provider.provider_key(), Instant::now()) {
            return Ok(metadata);
        }
        let provider_lock = {
            let mut locks = self.provider_locks.lock().await;
            locks
                .entry(provider.provider_key().to_owned())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        let _guard = provider_lock.lock().await;
        if let Some(metadata) = cache.get_at(provider.provider_key(), Instant::now()) {
            return Ok(metadata);
        }

        let metadata = self.fetch_at(provider, discovery_url).await?;
        cache.insert_at(provider.provider_key(), metadata.clone(), Instant::now());
        Ok(metadata)
    }

    async fn fetch(
        &self,
        provider: &OidcProviderConfig,
    ) -> Result<OidcDiscoveryMetadata, OidcDiscoveryError> {
        self.fetch_at(provider, provider.discovery_url()).await
    }

    async fn fetch_at(
        &self,
        provider: &OidcProviderConfig,
        discovery_url: Url,
    ) -> Result<OidcDiscoveryMetadata, OidcDiscoveryError> {
        let body = self
            .fetch_json_body(discovery_url, OIDC_DISCOVERY_MAX_BYTES)
            .await
            .map_err(|error| match error {
                OidcHttpError::ResponseTooLarge => OidcDiscoveryError::ResponseTooLarge,
                OidcHttpError::Network => OidcDiscoveryError::Network,
                OidcHttpError::HttpStatus => OidcDiscoveryError::HttpStatus,
                OidcHttpError::Redirected => OidcDiscoveryError::Redirected,
                OidcHttpError::InvalidContentType => OidcDiscoveryError::InvalidMetadata,
            })?;
        OidcDiscoveryMetadata::parse(provider, &body)
    }

    async fn fetch_json_body(&self, url: Url, max_bytes: usize) -> Result<Vec<u8>, OidcHttpError> {
        self.read_json_response(
            self.client
                .get(url)
                .header(reqwest::header::ACCEPT, "application/json"),
            max_bytes,
        )
        .await
    }

    #[allow(dead_code)]
    async fn exchange_code(
        &self,
        provider: &OidcProviderConfig,
        metadata: &OidcDiscoveryMetadata,
        transaction: &OidcAuthorizationTransaction,
        code: &str,
    ) -> Result<OidcTokenResponse, OidcTokenExchangeError> {
        if code.is_empty() || code.chars().count() > 16 * 1024 {
            return Err(OidcTokenExchangeError::InvalidResponse);
        }
        let form = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "authorization_code")
            .append_pair("code", code)
            .append_pair("redirect_uri", transaction.redirect_uri())
            .append_pair("client_id", provider.client_id())
            .append_pair("client_secret", provider.client_secret())
            .append_pair("code_verifier", transaction.code_verifier())
            .finish();
        let body = self
            .read_json_response(
                self.client
                    .post(metadata.token_endpoint().clone())
                    .header(reqwest::header::ACCEPT, "application/json")
                    .header(
                        reqwest::header::CONTENT_TYPE,
                        "application/x-www-form-urlencoded",
                    )
                    .body(form),
                OIDC_TOKEN_RESPONSE_MAX_BYTES,
            )
            .await
            .map_err(|error| match error {
                OidcHttpError::ResponseTooLarge => OidcTokenExchangeError::ResponseTooLarge,
                OidcHttpError::Network => OidcTokenExchangeError::Network,
                OidcHttpError::HttpStatus => OidcTokenExchangeError::HttpStatus,
                OidcHttpError::Redirected => OidcTokenExchangeError::Redirected,
                OidcHttpError::InvalidContentType => OidcTokenExchangeError::InvalidContentType,
            })?;
        OidcTokenResponse::parse(&body)
    }

    async fn read_json_response(
        &self,
        request: reqwest::RequestBuilder,
        max_bytes: usize,
    ) -> Result<Vec<u8>, OidcHttpError> {
        // Source: https://docs.rs/reqwest/0.13.4/reqwest/struct.Response.html
        let mut response = request
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| OidcHttpError::Network)?;
        if response.status().is_redirection() {
            return Err(OidcHttpError::Redirected);
        }
        if !response.status().is_success() {
            return Err(OidcHttpError::HttpStatus);
        }
        let is_json = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
        if !is_json {
            return Err(OidcHttpError::InvalidContentType);
        }
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes as u64)
        {
            return Err(OidcHttpError::ResponseTooLarge);
        }

        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| OidcHttpError::Network)? {
            if body.len().saturating_add(chunk.len()) > max_bytes {
                return Err(OidcHttpError::ResponseTooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub(crate) struct OidcDiscoveryMetadata {
    issuer: Url,
    authorization_endpoint: Url,
    token_endpoint: Url,
    jwks_uri: Url,
}

#[derive(Debug, Deserialize)]
struct RawOidcDiscoveryMetadata {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
    response_types_supported: Vec<String>,
    subject_types_supported: Vec<String>,
    id_token_signing_alg_values_supported: Vec<String>,
    #[serde(default)]
    code_challenge_methods_supported: Vec<String>,
}

#[allow(dead_code)]
impl OidcDiscoveryMetadata {
    fn parse(provider: &OidcProviderConfig, body: &[u8]) -> Result<Self, OidcDiscoveryError> {
        if body.len() > OIDC_DISCOVERY_MAX_BYTES {
            return Err(OidcDiscoveryError::ResponseTooLarge);
        }
        let raw = serde_json::from_slice::<RawOidcDiscoveryMetadata>(body)
            .map_err(|_| OidcDiscoveryError::InvalidMetadata)?;
        if raw.issuer != provider.issuer_identifier()
            || !raw
                .response_types_supported
                .iter()
                .any(|value| value == "code")
            || !raw
                .subject_types_supported
                .iter()
                .any(|value| value == "public" || value == "pairwise")
            || !raw
                .id_token_signing_alg_values_supported
                .iter()
                .any(|value| value == "RS256")
            || !raw
                .code_challenge_methods_supported
                .iter()
                .any(|value| value == "S256")
        {
            return Err(OidcDiscoveryError::InvalidMetadata);
        }
        let issuer = parse_https_url("discovery issuer", &raw.issuer)
            .map_err(|_| OidcDiscoveryError::InvalidMetadata)?;
        let authorization_endpoint = parse_discovery_endpoint(&raw.authorization_endpoint)?;
        let token_endpoint = parse_discovery_endpoint(&raw.token_endpoint)?;
        let jwks_uri = parse_discovery_endpoint(&raw.jwks_uri)?;

        Ok(Self {
            issuer,
            authorization_endpoint,
            token_endpoint,
            jwks_uri,
        })
    }

    fn issuer(&self) -> &Url {
        &self.issuer
    }

    fn authorization_endpoint(&self) -> &Url {
        &self.authorization_endpoint
    }

    fn token_endpoint(&self) -> &Url {
        &self.token_endpoint
    }

    fn jwks_uri(&self) -> &Url {
        &self.jwks_uri
    }
}

#[allow(dead_code)]
#[derive(Clone, Default)]
pub(crate) struct OidcDiscoveryCache {
    entries: Arc<Mutex<HashMap<String, OidcDiscoveryCacheEntry>>>,
}

#[allow(dead_code)]
#[derive(Clone)]
struct OidcDiscoveryCacheEntry {
    metadata: OidcDiscoveryMetadata,
    expires_at: Instant,
}

#[allow(dead_code)]
impl OidcDiscoveryCache {
    fn new() -> Self {
        Self::default()
    }

    fn insert_at(&self, provider_key: &str, metadata: OidcDiscoveryMetadata, now: Instant) {
        let mut entries = self
            .entries
            .lock()
            .expect("OIDC discovery cache lock must not be poisoned");
        entries.retain(|_, entry| entry.expires_at > now);
        if entries.len() >= OIDC_DISCOVERY_CACHE_MAX_ENTRIES && !entries.contains_key(provider_key)
        {
            return;
        }
        entries.insert(
            provider_key.to_owned(),
            OidcDiscoveryCacheEntry {
                metadata,
                expires_at: now + OIDC_DISCOVERY_CACHE_TTL,
            },
        );
    }

    fn get_at(&self, provider_key: &str, now: Instant) -> Option<OidcDiscoveryMetadata> {
        let mut entries = self
            .entries
            .lock()
            .expect("OIDC discovery cache lock must not be poisoned");
        entries.retain(|_, entry| entry.expires_at > now);
        entries
            .get(provider_key)
            .map(|entry| entry.metadata.clone())
    }
}

#[allow(dead_code)]
#[derive(Clone, Default)]
pub(crate) struct OidcJwksCache {
    entries: Arc<Mutex<HashMap<String, OidcJwksCacheEntry>>>,
}

#[allow(dead_code)]
#[derive(Clone)]
struct OidcJwksCacheEntry {
    jwks: Option<OidcJwkSet>,
    expires_at: Instant,
    refresh_after: Instant,
    retry_at: Instant,
    failure_count: u32,
}

#[allow(dead_code)]
impl OidcJwksCache {
    fn new() -> Self {
        Self::default()
    }

    fn insert_at(&self, provider_key: &str, jwks: OidcJwkSet, now: Instant) {
        let mut entries = self
            .entries
            .lock()
            .expect("OIDC JWKS cache lock must not be poisoned");
        if entries.len() >= OIDC_JWKS_CACHE_MAX_ENTRIES && !entries.contains_key(provider_key) {
            return;
        }
        entries.insert(
            provider_key.to_owned(),
            OidcJwksCacheEntry {
                jwks: Some(jwks),
                expires_at: now + OIDC_JWKS_CACHE_TTL,
                refresh_after: now + OIDC_JWKS_REFRESH_COOLDOWN,
                retry_at: now,
                failure_count: 0,
            },
        );
    }

    fn get_at(&self, provider_key: &str, now: Instant) -> Option<OidcJwkSet> {
        let entries = self
            .entries
            .lock()
            .expect("OIDC JWKS cache lock must not be poisoned");
        entries.get(provider_key).and_then(|entry| {
            (entry.expires_at > now)
                .then(|| entry.jwks.clone())
                .flatten()
        })
    }

    fn entry_at(&self, provider_key: &str) -> Option<OidcJwksCacheEntry> {
        let entries = self
            .entries
            .lock()
            .expect("OIDC JWKS cache lock must not be poisoned");
        entries.get(provider_key).cloned()
    }

    fn blocked_refresh_at(
        &self,
        provider_key: &str,
        now: Instant,
        respect_cooldown: bool,
    ) -> Option<Result<OidcJwkSet, OidcJwksError>> {
        let entry = self.entry_at(provider_key)?;
        if entry.retry_at <= now && (!respect_cooldown || entry.refresh_after <= now) {
            return None;
        }
        Some(
            entry
                .jwks
                .filter(|_| entry.expires_at > now)
                .ok_or(OidcJwksError::RefreshThrottled),
        )
    }

    fn record_failure_at(&self, provider_key: &str, error_at: Instant) {
        let mut entries = self
            .entries
            .lock()
            .expect("OIDC JWKS cache lock must not be poisoned");
        let Some(entry) = entries.get_mut(provider_key) else {
            if entries.len() >= OIDC_JWKS_CACHE_MAX_ENTRIES {
                return;
            }
            entries.insert(
                provider_key.to_owned(),
                OidcJwksCacheEntry {
                    jwks: None,
                    expires_at: error_at,
                    refresh_after: error_at,
                    retry_at: error_at + OIDC_JWKS_FAILURE_BACKOFF_BASE,
                    failure_count: 1,
                },
            );
            return;
        };

        entry.failure_count = entry.failure_count.saturating_add(1);
        let multiplier = 1_u64 << entry.failure_count.saturating_sub(1).min(4);
        let backoff_seconds = OIDC_JWKS_FAILURE_BACKOFF_BASE
            .as_secs()
            .saturating_mul(multiplier)
            .min(OIDC_JWKS_FAILURE_BACKOFF_MAX.as_secs());
        entry.retry_at = error_at + Duration::from_secs(backoff_seconds);
        if entry.expires_at <= error_at {
            entry.jwks = None;
        }
    }
}

#[allow(dead_code)]
impl OidcDiscoveryClient {
    async fn jwks(
        &self,
        provider: &OidcProviderConfig,
        metadata: &OidcDiscoveryMetadata,
        cache: &OidcJwksCache,
    ) -> Result<OidcJwkSet, OidcJwksError> {
        self.jwks_at(provider, cache, metadata.jwks_uri().clone())
            .await
    }

    async fn refresh_jwks(
        &self,
        provider: &OidcProviderConfig,
        metadata: &OidcDiscoveryMetadata,
        cache: &OidcJwksCache,
    ) -> Result<OidcJwkSet, OidcJwksError> {
        self.refresh_jwks_at(provider, cache, metadata.jwks_uri().clone(), Instant::now())
            .await
    }

    async fn jwks_at(
        &self,
        provider: &OidcProviderConfig,
        cache: &OidcJwksCache,
        jwks_uri: Url,
    ) -> Result<OidcJwkSet, OidcJwksError> {
        self.jwks_at_now(provider, cache, jwks_uri, Instant::now())
            .await
    }

    async fn jwks_at_now(
        &self,
        provider: &OidcProviderConfig,
        cache: &OidcJwksCache,
        jwks_uri: Url,
        now: Instant,
    ) -> Result<OidcJwkSet, OidcJwksError> {
        if let Some(jwks) = cache.get_at(provider.provider_key(), now) {
            return Ok(jwks);
        }
        let provider_lock = self.provider_lock(provider.provider_key()).await;
        let _guard = provider_lock.lock().await;
        let now = Instant::now().max(now);
        if let Some(jwks) = cache.get_at(provider.provider_key(), now) {
            return Ok(jwks);
        }
        if let Some(blocked) = cache.blocked_refresh_at(provider.provider_key(), now, false) {
            return blocked;
        }

        let fetched = self.fetch_jwks_at(jwks_uri).await;
        let completed_at = Instant::now().max(now);
        match fetched {
            Ok(jwks) => {
                cache.insert_at(provider.provider_key(), jwks.clone(), completed_at);
                Ok(jwks)
            }
            Err(error) => {
                cache.record_failure_at(provider.provider_key(), completed_at);
                Err(error)
            }
        }
    }

    async fn refresh_jwks_at(
        &self,
        provider: &OidcProviderConfig,
        cache: &OidcJwksCache,
        jwks_uri: Url,
        now: Instant,
    ) -> Result<OidcJwkSet, OidcJwksError> {
        if let Some(blocked) = cache.blocked_refresh_at(provider.provider_key(), now, true) {
            return blocked;
        }
        let provider_lock = self.provider_lock(provider.provider_key()).await;
        let _guard = provider_lock.lock().await;
        let now = Instant::now().max(now);
        if let Some(blocked) = cache.blocked_refresh_at(provider.provider_key(), now, true) {
            return blocked;
        }

        let fetched = self.fetch_jwks_at(jwks_uri).await;
        let completed_at = Instant::now().max(now);
        match fetched {
            Ok(jwks) => {
                cache.insert_at(provider.provider_key(), jwks.clone(), completed_at);
                Ok(jwks)
            }
            Err(error) => {
                cache.record_failure_at(provider.provider_key(), completed_at);
                cache
                    .get_at(provider.provider_key(), completed_at)
                    .ok_or(error)
            }
        }
    }

    async fn fetch_jwks_at(&self, jwks_uri: Url) -> Result<OidcJwkSet, OidcJwksError> {
        let body = self
            .fetch_json_body(jwks_uri, OIDC_JWKS_MAX_BYTES)
            .await
            .map_err(|error| match error {
                OidcHttpError::ResponseTooLarge => OidcJwksError::ResponseTooLarge,
                OidcHttpError::Network => OidcJwksError::Network,
                OidcHttpError::HttpStatus => OidcJwksError::HttpStatus,
                OidcHttpError::Redirected => OidcJwksError::Redirected,
                OidcHttpError::InvalidContentType => OidcJwksError::InvalidJwks,
            })?;
        OidcJwkSet::parse(&body)
    }

    async fn provider_lock(&self, provider_key: &str) -> Arc<AsyncMutex<()>> {
        let mut locks = self.provider_locks.lock().await;
        locks
            .entry(provider_key.to_owned())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OidcTransactionError {
    Capacity,
    Invalid,
}

#[allow(dead_code)]
#[derive(Clone, Default)]
pub(crate) struct OidcAuthorizationTransactionStore {
    entries: Arc<Mutex<HashMap<String, OidcAuthorizationTransaction>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OidcClaim {
    provider_key: String,
    provider_display_name: String,
    subject: String,
    issuer: String,
    email_snapshot: Option<String>,
    email_verified: Option<bool>,
    name: Option<String>,
    preferred_username: Option<String>,
    expires_at: Instant,
}

#[derive(Clone, Default)]
pub(crate) struct OidcClaimStore {
    entries: Arc<Mutex<HashMap<String, OidcClaim>>>,
}

impl OidcClaimStore {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn issue(
        &self,
        provider: &OidcProviderConfig,
        verified: &OidcVerifiedIdToken,
    ) -> Result<String, OidcTransactionError> {
        self.issue_at(provider, verified, Instant::now())
    }

    fn issue_at(
        &self,
        provider: &OidcProviderConfig,
        verified: &OidcVerifiedIdToken,
        now: Instant,
    ) -> Result<String, OidcTransactionError> {
        let mut entries = self
            .entries
            .lock()
            .expect("OIDC claim lock must not be poisoned");
        entries.retain(|_, claim| claim.expires_at > now);
        if entries.len() >= OIDC_MAX_CLAIMS {
            return Err(OidcTransactionError::Capacity);
        }
        let token = loop {
            let candidate = random_hex_token();
            if !entries.contains_key(&candidate) {
                break candidate;
            }
        };
        entries.insert(
            token.clone(),
            OidcClaim {
                provider_key: provider.provider_key.clone(),
                provider_display_name: provider.display_name.clone(),
                subject: verified.subject.clone(),
                issuer: verified.issuer.clone(),
                email_snapshot: verified.email.clone(),
                email_verified: verified.email_verified,
                name: safe_profile_field(verified.name(), 80),
                preferred_username: safe_profile_field(verified.preferred_username(), 32),
                expires_at: now + OIDC_CLAIM_TTL,
            },
        );
        Ok(token)
    }

    pub(crate) fn peek(&self, token: &str) -> Option<OidcClaim> {
        self.peek_at(token, Instant::now())
    }

    fn peek_at(&self, token: &str, now: Instant) -> Option<OidcClaim> {
        let mut entries = self
            .entries
            .lock()
            .expect("OIDC claim lock must not be poisoned");
        let claim = entries.get(token)?;
        if claim.expires_at <= now {
            entries.remove(token);
            return None;
        }
        Some(claim.clone())
    }

    pub(crate) fn consume(&self, token: &str) -> Option<OidcClaim> {
        self.consume_at(token, Instant::now())
    }

    fn consume_at(&self, token: &str, now: Instant) -> Option<OidcClaim> {
        let mut entries = self
            .entries
            .lock()
            .expect("OIDC claim lock must not be poisoned");
        let claim = entries.remove(token)?;
        (claim.expires_at > now).then_some(claim)
    }
}

fn safe_profile_field(value: Option<&str>, max_characters: usize) -> Option<String> {
    let value = value?.trim();
    ((1..=max_characters).contains(&value.chars().count()) && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}

impl OidcClaim {
    pub(crate) fn provider_key(&self) -> &str {
        &self.provider_key
    }
    pub(crate) fn provider_display_name(&self) -> &str {
        &self.provider_display_name
    }
    pub(crate) fn subject(&self) -> &str {
        &self.subject
    }
    pub(crate) fn issuer(&self) -> &str {
        &self.issuer
    }
    pub(crate) fn email_snapshot(&self) -> Option<&str> {
        self.email_snapshot.as_deref()
    }
    pub(crate) fn email_verified(&self) -> Option<bool> {
        self.email_verified
    }
    pub(crate) fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
    pub(crate) fn preferred_username(&self) -> Option<&str> {
        self.preferred_username.as_deref()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OidcIdentityBinding {
    pub(crate) user_id: Uuid,
    pub(crate) session_id: Uuid,
    pub(crate) replacement_identity_id: Option<Uuid>,
}

#[derive(Clone)]
pub(crate) struct OidcAuthorizationTransaction {
    provider_key: String,
    redirect_uri: String,
    state: String,
    nonce: String,
    code_verifier: String,
    code_challenge: String,
    browser_binding: String,
    identity_binding: Option<OidcIdentityBinding>,
    expires_at: Instant,
}

#[allow(dead_code)]
impl OidcAuthorizationTransactionStore {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    #[allow(dead_code)]
    pub(crate) fn begin(
        &self,
        provider: &OidcProviderConfig,
    ) -> Result<OidcAuthorizationTransaction, OidcTransactionError> {
        self.begin_at(provider, Instant::now())
    }

    pub(crate) fn begin_binding(
        &self,
        provider: &OidcProviderConfig,
        binding: OidcIdentityBinding,
    ) -> Result<OidcAuthorizationTransaction, OidcTransactionError> {
        self.begin_binding_at(provider, binding, Instant::now())
    }

    fn begin_at(
        &self,
        provider: &OidcProviderConfig,
        now: Instant,
    ) -> Result<OidcAuthorizationTransaction, OidcTransactionError> {
        self.begin_with_binding_at(provider, None, now)
    }

    fn begin_binding_at(
        &self,
        provider: &OidcProviderConfig,
        binding: OidcIdentityBinding,
        now: Instant,
    ) -> Result<OidcAuthorizationTransaction, OidcTransactionError> {
        self.begin_with_binding_at(provider, Some(binding), now)
    }

    fn begin_with_binding_at(
        &self,
        provider: &OidcProviderConfig,
        identity_binding: Option<OidcIdentityBinding>,
        now: Instant,
    ) -> Result<OidcAuthorizationTransaction, OidcTransactionError> {
        let mut entries = self
            .entries
            .lock()
            .expect("OIDC transaction lock must not be poisoned");
        entries.retain(|_, transaction| transaction.expires_at > now);
        if entries.len() >= OIDC_MAX_TRANSACTIONS {
            return Err(OidcTransactionError::Capacity);
        }

        let state = loop {
            let candidate = random_hex_token();
            if !entries.contains_key(&candidate) {
                break candidate;
            }
        };
        let code_verifier = random_code_verifier();
        let transaction = OidcAuthorizationTransaction {
            provider_key: provider.provider_key.clone(),
            redirect_uri: provider.redirect_uri().as_str().to_owned(),
            state,
            nonce: random_hex_token(),
            code_challenge: pkce_s256_challenge(&code_verifier),
            code_verifier,
            browser_binding: random_hex_token(),
            identity_binding,
            expires_at: now + OIDC_TRANSACTION_TTL,
        };
        let result = transaction.clone();
        entries.insert(transaction.state.clone(), transaction);
        Ok(result)
    }

    fn consume_at(
        &self,
        provider_key: &str,
        state: &str,
        browser_binding: &str,
        now: Instant,
    ) -> Result<OidcAuthorizationTransaction, OidcTransactionError> {
        let mut entries = self
            .entries
            .lock()
            .expect("OIDC transaction lock must not be poisoned");
        let Some(transaction) = entries.get(state) else {
            return Err(OidcTransactionError::Invalid);
        };
        if transaction.expires_at <= now {
            entries.remove(state);
            return Err(OidcTransactionError::Invalid);
        }
        if transaction.provider_key != provider_key
            || transaction.browser_binding != browser_binding
        {
            return Err(OidcTransactionError::Invalid);
        }
        Ok(entries
            .remove(state)
            .expect("transaction must remain while holding the lock"))
    }
}

#[allow(dead_code)]
impl OidcAuthorizationTransaction {
    fn provider_key(&self) -> &str {
        &self.provider_key
    }

    fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    fn state(&self) -> &str {
        &self.state
    }

    fn nonce(&self) -> &str {
        &self.nonce
    }

    fn code_verifier(&self) -> &str {
        &self.code_verifier
    }

    fn code_challenge(&self) -> &str {
        &self.code_challenge
    }

    fn code_challenge_method(&self) -> &'static str {
        "S256"
    }

    fn browser_binding(&self) -> &str {
        &self.browser_binding
    }

    pub(crate) fn identity_binding(&self) -> Option<OidcIdentityBinding> {
        self.identity_binding
    }
}

#[derive(Clone)]
pub(crate) struct OidcRuntime {
    client: OidcDiscoveryClient,
    discovery_cache: OidcDiscoveryCache,
    jwks_cache: OidcJwksCache,
    transactions: OidcAuthorizationTransactionStore,
    claims: OidcClaimStore,
}

pub(crate) struct OidcAuthorizationStart {
    authorization_url: Url,
    browser_binding: String,
}

impl OidcAuthorizationStart {
    pub(crate) fn authorization_url(&self) -> &Url {
        &self.authorization_url
    }

    pub(crate) fn browser_binding(&self) -> &str {
        &self.browser_binding
    }
}

impl OidcRuntime {
    pub(crate) fn new() -> Option<Self> {
        Some(Self {
            client: OidcDiscoveryClient::new().ok()?,
            discovery_cache: OidcDiscoveryCache::new(),
            jwks_cache: OidcJwksCache::new(),
            transactions: OidcAuthorizationTransactionStore::new(),
            claims: OidcClaimStore::new(),
        })
    }

    #[cfg(test)]
    pub(crate) fn for_tests(
        provider: &OidcProviderConfig,
        metadata_body: &[u8],
    ) -> Result<Self, OidcDiscoveryError> {
        let runtime = Self {
            client: OidcDiscoveryClient::for_tests(),
            discovery_cache: OidcDiscoveryCache::new(),
            jwks_cache: OidcJwksCache::new(),
            transactions: OidcAuthorizationTransactionStore::new(),
            claims: OidcClaimStore::new(),
        };
        let metadata = OidcDiscoveryMetadata::parse(provider, metadata_body)?;
        runtime
            .discovery_cache
            .insert_at(provider.provider_key(), metadata, Instant::now());
        Ok(runtime)
    }

    pub(crate) async fn start(
        &self,
        provider: &OidcProviderConfig,
    ) -> Result<OidcAuthorizationStart, OidcProtocolError> {
        let metadata = self
            .client
            .discover(provider, &self.discovery_cache)
            .await
            .map_err(|_| OidcProtocolError::Unavailable)?;
        self.start_with_metadata(provider, &metadata)
    }

    pub(crate) fn issue_claim(
        &self,
        provider: &OidcProviderConfig,
        verified: &OidcVerifiedIdToken,
    ) -> Result<String, OidcTransactionError> {
        self.claims.issue(provider, verified)
    }

    pub(crate) fn peek_claim(&self, token: &str) -> Option<OidcClaim> {
        self.claims.peek(token)
    }

    pub(crate) fn consume_claim(&self, token: &str) -> Option<OidcClaim> {
        self.claims.consume(token)
    }

    pub(crate) async fn start_identity_binding(
        &self,
        provider: &OidcProviderConfig,
        binding: OidcIdentityBinding,
    ) -> Result<OidcAuthorizationStart, OidcProtocolError> {
        let metadata = self
            .client
            .discover(provider, &self.discovery_cache)
            .await
            .map_err(|_| OidcProtocolError::Unavailable)?;
        self.start_with_metadata_and_binding(provider, &metadata, Some(binding))
    }

    fn start_with_metadata(
        &self,
        provider: &OidcProviderConfig,
        metadata: &OidcDiscoveryMetadata,
    ) -> Result<OidcAuthorizationStart, OidcProtocolError> {
        self.start_with_metadata_and_binding(provider, metadata, None)
    }

    fn start_with_metadata_and_binding(
        &self,
        provider: &OidcProviderConfig,
        metadata: &OidcDiscoveryMetadata,
        identity_binding: Option<OidcIdentityBinding>,
    ) -> Result<OidcAuthorizationStart, OidcProtocolError> {
        let transaction = self
            .transactions
            .begin_with_binding_at(provider, identity_binding, Instant::now())
            .map_err(|error| match error {
                OidcTransactionError::Capacity => OidcProtocolError::Capacity,
                OidcTransactionError::Invalid => OidcProtocolError::Invalid,
            })?;
        let mut authorization_url = metadata.authorization_endpoint().clone();
        // Metadata is untrusted network input; only the fixed authorization-code parameters
        // are allowed to reach the provider.
        authorization_url.set_query(None);
        authorization_url
            .query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", provider.client_id())
            .append_pair("redirect_uri", transaction.redirect_uri())
            .append_pair("scope", "openid")
            .append_pair("state", transaction.state())
            .append_pair("nonce", transaction.nonce())
            .append_pair("code_challenge", transaction.code_challenge())
            .append_pair("code_challenge_method", transaction.code_challenge_method());
        Ok(OidcAuthorizationStart {
            authorization_url,
            browser_binding: transaction.browser_binding().to_owned(),
        })
    }

    pub(crate) fn consume(
        &self,
        provider_key: &str,
        state: &str,
        browser_binding: &str,
    ) -> Result<OidcAuthorizationTransaction, OidcProtocolError> {
        self.transactions
            .consume_at(provider_key, state, browser_binding, Instant::now())
            .map_err(|_| OidcProtocolError::Invalid)
    }

    pub(crate) async fn verify_callback(
        &self,
        provider: &OidcProviderConfig,
        transaction: &OidcAuthorizationTransaction,
        code: &str,
    ) -> Result<OidcVerifiedIdToken, OidcProtocolError> {
        if code.is_empty() || code.chars().count() > 16 * 1024 {
            return Err(OidcProtocolError::Invalid);
        }
        let metadata = self
            .client
            .discover(provider, &self.discovery_cache)
            .await
            .map_err(|_| OidcProtocolError::Unavailable)?;
        let token_response = self
            .client
            .exchange_code(provider, &metadata, transaction, code)
            .await
            .map_err(|_| OidcProtocolError::Unavailable)?;
        let jwks = self
            .client
            .jwks(provider, &metadata, &self.jwks_cache)
            .await
            .map_err(|_| OidcProtocolError::Unavailable)?;
        match verify_id_token(provider, transaction, &jwks, token_response.id_token()) {
            Ok(verified) => Ok(verified),
            Err(OidcIdTokenError::MissingKey) => {
                let refreshed = self
                    .client
                    .refresh_jwks(provider, &metadata, &self.jwks_cache)
                    .await
                    .map_err(|_| OidcProtocolError::Unavailable)?;
                verify_id_token(provider, transaction, &refreshed, token_response.id_token())
                    .map_err(|_| OidcProtocolError::Invalid)
            }
            Err(_) => Err(OidcProtocolError::Invalid),
        }
    }
}

fn random_hex_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// RFC 7636 section 4.1 recommends 32 random octets encoded as 43 base64url characters.
fn random_code_verifier() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    base64url_encode(&bytes)
}

// RFC 7636 section 4.2: S256 is BASE64URL(SHA256(ASCII(code_verifier))) without padding.
fn pkce_s256_challenge(code_verifier: &str) -> String {
    let digest = Sha256::digest(code_verifier.as_bytes());
    base64url_encode(&digest)
}

fn base64url_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity((bytes.len() * 4).div_ceil(3));
    for chunk in bytes.chunks(3) {
        output.push(TABLE[(chunk[0] >> 2) as usize] as char);
        output.push(
            TABLE[((chunk[0] & 0x03) << 4 | chunk.get(1).copied().unwrap_or(0) >> 4) as usize]
                as char,
        );
        if let Some(second) = chunk.get(1) {
            output.push(
                TABLE[((second & 0x0f) << 2 | chunk.get(2).copied().unwrap_or(0) >> 6) as usize]
                    as char,
            );
        }
        if let Some(third) = chunk.get(2) {
            output.push(TABLE[(third & 0x3f) as usize] as char);
        }
    }
    output
}

impl fmt::Debug for OidcProviderConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProviderConfig")
            .field("provider_key", &self.provider_key)
            .field("display_name", &self.display_name)
            .field("issuer", &self.issuer)
            .field("client", &"[redacted]")
            .field("credential", &"[redacted]")
            .field("redirect_uri", &self.redirect_uri)
            .finish()
    }
}

fn valid_provider_key(value: &str) -> bool {
    let length = value.chars().count();
    (2..=32).contains(&length)
        && value.starts_with(|character: char| character.is_ascii_lowercase())
        && value.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '_'
                || character == '-'
        })
}

fn parse_https_url(field: &str, value: &str) -> Result<Url, String> {
    // Source: https://docs.rs/url/2.5.8/url/struct.Url.html#method.parse
    let url = Url::parse(value).map_err(|_| format!("OIDC {field} must be an absolute URL"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(format!(
            "OIDC {field} must be an HTTPS URL without credentials, query or fragment"
        ));
    }
    Ok(url)
}

fn parse_discovery_endpoint(value: &str) -> Result<Url, OidcDiscoveryError> {
    if value.chars().count() > 2048 {
        return Err(OidcDiscoveryError::InvalidMetadata);
    }
    let url = Url::parse(value).map_err(|_| OidcDiscoveryError::InvalidMetadata)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(OidcDiscoveryError::InvalidMetadata);
    }
    Ok(url)
}

fn parse_redirect_url(value: &str, provider_key: &str) -> Result<Url, String> {
    // Source: https://docs.rs/url/2.5.8/url/struct.Url.html#method.parse
    let url =
        Url::parse(value).map_err(|_| "OIDC redirect_uri must be an absolute URL".to_owned())?;
    let is_loopback = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if (url.scheme() != "https" && !(url.scheme() == "http" && is_loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(format!(
            "OIDC provider `{provider_key}` redirect_uri must use HTTPS (or loopback HTTP) without credentials, query or fragment"
        ));
    }
    let expected_path = format!("/api/v1/auth/oidc/{provider_key}/callback");
    if url.path() != expected_path {
        return Err(format!(
            "OIDC provider `{provider_key}` redirect_uri path must be {expected_path}"
        ));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discovery_metadata(issuer: &str) -> String {
        serde_json::json!({
            "issuer": issuer,
            "authorization_endpoint": "https://issuer.example/oauth2/authorize",
            "token_endpoint": "https://issuer.example/oauth2/token",
            "jwks_uri": "https://issuer.example/.well-known/jwks.json",
            "response_types_supported": ["code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "code_challenge_methods_supported": ["S256"]
        })
        .to_string()
    }

    fn rsa_modulus(marker: u8) -> String {
        let mut bytes = vec![marker | 1; OIDC_RSA_MIN_BITS / 8];
        bytes[0] |= 0x80;
        base64url_encode(&bytes)
    }

    fn jwks_json(kid: &str, marker: u8) -> String {
        serde_json::json!({
            "keys": [{
                "kty": "RSA",
                "kid": kid,
                "use": "sig",
                "alg": "RS256",
                "n": rsa_modulus(marker),
                "e": "AQAB"
            }]
        })
        .to_string()
    }

    #[test]
    fn debug_output_redacts_client_credentials() {
        let config = OidcProviderConfig::parse_json(
            r#"[{"provider_key":"local","display_name":"Local","issuer":"https://issuer.example","client_id":"client-id","client_secret":"client-secret","redirect_uri":"http://127.0.0.1:3000/api/v1/auth/oidc/local/callback"}]"#,
        )
        .expect("fixture must parse");
        let output = format!("{config:?}");
        assert!(!output.contains("client-secret"));
        assert!(!output.contains("client-id"));
    }

    fn provider() -> OidcProviderConfig {
        OidcProviderConfig::parse_json(
            r#"[{"provider_key":"google","display_name":"Google","issuer":"https://accounts.google.com","client_id":"client-id","client_secret":"client-secret","redirect_uri":"https://community.example.com/api/v1/auth/oidc/google/callback"}]"#,
        )
        .expect("provider fixture must parse")
        .pop()
        .expect("provider fixture must contain one item")
    }

    #[test]
    fn pkce_uses_the_rfc7636_s256_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            pkce_s256_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn token_response_requires_bearer_and_redacts_secrets() {
        let response = OidcTokenResponse::parse(
            br#"{"access_token":"access","token_type":"Bearer","expires_in":3600,"id_token":"header.payload.signature","refresh_token":"refresh"}"#,
        )
        .expect("token response must parse");
        assert_eq!(response.access_token(), "access");
        assert_eq!(response.token_type(), "Bearer");
        assert_eq!(response.expires_in(), Some(3600));
        assert_eq!(response.id_token(), "header.payload.signature");
        assert_eq!(response.refresh_token(), Some("refresh"));
        let debug = format!("{response:?}");
        assert!(!debug.contains("\"access\""));
        assert!(!debug.contains("header.payload.signature"));
        assert!(!debug.contains("\"refresh\""));
        assert!(matches!(
            OidcTokenResponse::parse(
                br#"{"access_token":"access","token_type":"Basic","id_token":"id"}"#
            ),
            Err(OidcTokenExchangeError::InvalidResponse)
        ));
        assert!(matches!(
            OidcTokenResponse::parse(br#"{"access_token":"access","token_type":"Bearer"}"#),
            Err(OidcTokenExchangeError::InvalidResponse)
        ));
    }

    #[test]
    fn id_token_verifier_rejects_invalid_header_algorithm_and_key() {
        let provider = provider();
        let transaction = OidcAuthorizationTransactionStore::new()
            .begin(&provider)
            .expect("transaction must begin");
        let jwks =
            OidcJwkSet::parse(jwks_json("key-a", 1).as_bytes()).expect("JWKS fixture must parse");
        assert!(matches!(
            verify_id_token(&provider, &transaction, &jwks, "not-a-jwt"),
            Err(OidcIdTokenError::InvalidHeader)
        ));

        let hs256_header = format!(
            "{}.payload.signature",
            base64url_encode(br#"{"alg":"HS256","kid":"key-a","typ":"JWT"}"#)
        );
        assert!(matches!(
            verify_id_token(&provider, &transaction, &jwks, &hs256_header),
            Err(OidcIdTokenError::UnsupportedAlgorithm)
        ));

        let unknown_key = format!(
            "{}.payload.signature",
            base64url_encode(br#"{"alg":"RS256","kid":"unknown","typ":"JWT"}"#)
        );
        assert!(matches!(
            verify_id_token(&provider, &transaction, &jwks, &unknown_key),
            Err(OidcIdTokenError::MissingKey)
        ));
    }

    #[test]
    fn id_token_audience_requires_matching_authorized_party_when_present_or_multi_valued() {
        assert!(valid_audience(
            &OidcAudience::Single("client-id".to_owned()),
            None,
            "client-id"
        ));
        assert!(!valid_audience(
            &OidcAudience::Single("client-id".to_owned()),
            Some("other-client"),
            "client-id"
        ));
        assert!(!valid_audience(
            &OidcAudience::Multiple(vec!["client-id".to_owned(), "api".to_owned()]),
            None,
            "client-id"
        ));
        assert!(valid_audience(
            &OidcAudience::Multiple(vec!["client-id".to_owned(), "api".to_owned()]),
            Some("client-id"),
            "client-id"
        ));
    }

    #[test]
    fn authorization_transactions_are_bound_one_time_and_expiring() {
        let store = OidcAuthorizationTransactionStore::new();
        let provider = provider();
        let now = Instant::now();
        let first = store
            .begin_at(&provider, now)
            .expect("transaction must begin");
        let second = store
            .begin_at(&provider, now)
            .expect("transaction must begin");

        assert_ne!(first.state(), second.state());
        assert_ne!(first.nonce(), second.nonce());
        assert_ne!(first.browser_binding(), second.browser_binding());
        assert_eq!(first.provider_key(), "google");
        assert_eq!(first.redirect_uri(), provider.redirect_uri().as_str());
        assert_eq!(first.code_challenge_method(), "S256");
        assert_eq!(first.code_verifier().len(), 43);
        assert_eq!(first.code_challenge().len(), 43);

        assert!(matches!(
            store.consume_at("other", first.state(), first.browser_binding(), now),
            Err(OidcTransactionError::Invalid)
        ));
        assert!(matches!(
            store.consume_at("google", first.state(), "wrong-browser", now),
            Err(OidcTransactionError::Invalid)
        ));
        let consumed = store
            .consume_at("google", first.state(), first.browser_binding(), now)
            .expect("matching transaction must be consumed");
        assert_eq!(consumed.nonce(), first.nonce());
        assert!(matches!(
            store.consume_at("google", first.state(), first.browser_binding(), now),
            Err(OidcTransactionError::Invalid)
        ));

        assert!(matches!(
            store.consume_at(
                "google",
                second.state(),
                second.browser_binding(),
                now + OIDC_TRANSACTION_TTL + Duration::from_secs(1),
            ),
            Err(OidcTransactionError::Invalid)
        ));
    }

    #[test]
    fn oidc_claims_are_short_lived_single_use_and_keep_verified_profile_server_side() {
        let provider = provider();
        let store = OidcClaimStore::new();
        let now = Instant::now();
        let verified = OidcVerifiedIdToken {
            subject: "provider-subject".to_owned(),
            issuer: "https://accounts.google.com".to_owned(),
            email: Some("person@example.com".to_owned()),
            email_verified: Some(true),
            name: Some("Person".to_owned()),
            preferred_username: Some("person".to_owned()),
        };
        let token = store
            .issue_at(&provider, &verified, now)
            .expect("claim must be issued");
        assert_eq!(token.len(), 64);
        let claim = store.peek_at(&token, now).expect("claim must be readable");
        assert_eq!(claim.provider_key(), "google");
        assert_eq!(claim.provider_display_name(), "Google");
        assert_eq!(claim.subject(), "provider-subject");
        assert_eq!(claim.email_snapshot(), Some("person@example.com"));
        assert_eq!(claim.name(), Some("Person"));
        assert_eq!(store.consume_at(&token, now), Some(claim));
        assert!(store.consume_at(&token, now).is_none());

        let expired = store
            .issue_at(&provider, &verified, now)
            .expect("claim must be issued");
        assert!(store.peek_at(&expired, now + OIDC_CLAIM_TTL).is_none());
    }

    #[test]
    fn oidc_claims_discard_oversized_or_control_character_profile_fields() {
        let provider = provider();
        let store = OidcClaimStore::new();
        let verified = OidcVerifiedIdToken {
            subject: "provider-subject".to_owned(),
            issuer: "https://accounts.google.com".to_owned(),
            email: None,
            email_verified: None,
            name: Some(format!("member{}", "x".repeat(80))),
            preferred_username: Some("member\u{0007}".to_owned()),
        };

        let token = store
            .issue(&provider, &verified)
            .expect("claim must be issued");
        let claim = store.peek(&token).expect("claim must be readable");

        assert_eq!(claim.name(), None);
        assert_eq!(claim.preferred_username(), None);
    }

    #[test]
    fn binding_authorization_transactions_retain_the_account_session_and_replacement_target() {
        let store = OidcAuthorizationTransactionStore::new();
        let provider = provider();
        let binding = OidcIdentityBinding {
            user_id: Uuid::now_v7(),
            session_id: Uuid::now_v7(),
            replacement_identity_id: Some(Uuid::now_v7()),
        };
        let now = Instant::now();
        let transaction = store
            .begin_binding_at(&provider, binding, now)
            .expect("binding transaction must begin");

        assert_eq!(transaction.identity_binding(), Some(binding));
        let consumed = store
            .consume_at(
                provider.provider_key(),
                transaction.state(),
                transaction.browser_binding(),
                now,
            )
            .expect("binding transaction must be consumed");
        assert_eq!(consumed.identity_binding(), Some(binding));
    }

    #[test]
    fn authorization_start_uses_only_fixed_code_flow_parameters() {
        let provider = provider();
        let runtime = OidcRuntime {
            client: OidcDiscoveryClient::for_tests(),
            discovery_cache: OidcDiscoveryCache::new(),
            jwks_cache: OidcJwksCache::new(),
            transactions: OidcAuthorizationTransactionStore::new(),
            claims: OidcClaimStore::new(),
        };
        let metadata = OidcDiscoveryMetadata {
            issuer: Url::parse(provider.issuer_identifier()).expect("issuer must parse"),
            authorization_endpoint: Url::parse(
                "https://issuer.example/oauth2/authorize?response_type=token&scope=admin",
            )
            .expect("authorization endpoint must parse"),
            token_endpoint: Url::parse("https://issuer.example/oauth2/token")
                .expect("token endpoint must parse"),
            jwks_uri: Url::parse("https://issuer.example/.well-known/jwks.json")
                .expect("JWKS endpoint must parse"),
        };

        let start = runtime
            .start_with_metadata(&provider, &metadata)
            .expect("authorization must start");
        let pairs = start
            .authorization_url()
            .query_pairs()
            .into_owned()
            .collect::<HashMap<_, _>>();
        assert_eq!(pairs.len(), 8);
        assert_eq!(pairs.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(pairs.get("scope").map(String::as_str), Some("openid"));
        assert_eq!(
            pairs.get("client_id").map(String::as_str),
            Some("client-id")
        );
        assert_eq!(
            pairs.get("redirect_uri").map(String::as_str),
            Some("https://community.example.com/api/v1/auth/oidc/google/callback")
        );
        assert_eq!(
            pairs.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(pairs["state"].len(), 64);
        assert_eq!(pairs["nonce"].len(), 64);
        assert_eq!(pairs["code_challenge"].len(), 43);
        assert_eq!(start.browser_binding().len(), 64);
    }

    #[test]
    fn authorization_transactions_have_a_hard_capacity() {
        let store = OidcAuthorizationTransactionStore::new();
        let provider = provider();
        let now = Instant::now();
        for _ in 0..OIDC_MAX_TRANSACTIONS {
            store
                .begin_at(&provider, now)
                .expect("capacity should allow the configured limit");
        }
        assert!(matches!(
            store.begin_at(&provider, now),
            Err(OidcTransactionError::Capacity)
        ));
    }

    #[test]
    fn discovery_metadata_requires_exact_issuer_and_secure_endpoints() {
        let provider = OidcProviderConfig::parse_json(
            r#"[{"provider_key":"local","display_name":"Local","issuer":"https://issuer.example/tenant","client_id":"client-id","client_secret":"client-secret","redirect_uri":"http://127.0.0.1:3000/api/v1/auth/oidc/local/callback"}]"#,
        )
        .expect("provider fixture must parse")
        .pop()
        .expect("provider fixture must contain one item");

        assert_eq!(
            provider.discovery_url().as_str(),
            "https://issuer.example/tenant/.well-known/openid-configuration"
        );
        let multi_slash_provider = OidcProviderConfig::parse_json(
            r#"[{"provider_key":"local","display_name":"Local","issuer":"https://issuer.example/tenant///","client_id":"client-id","client_secret":"client-secret","redirect_uri":"http://127.0.0.1:3000/api/v1/auth/oidc/local/callback"}]"#,
        )
        .expect("provider fixture must parse")
        .pop()
        .expect("provider fixture must contain one item");
        assert_eq!(
            multi_slash_provider.discovery_url().as_str(),
            "https://issuer.example/tenant///.well-known/openid-configuration"
        );

        let metadata = OidcDiscoveryMetadata::parse(
            &provider,
            discovery_metadata("https://issuer.example/tenant").as_bytes(),
        )
        .expect("valid metadata must parse");
        assert_eq!(
            metadata.authorization_endpoint().as_str(),
            "https://issuer.example/oauth2/authorize"
        );
        assert_eq!(
            metadata.token_endpoint().as_str(),
            "https://issuer.example/oauth2/token"
        );
        assert_eq!(
            metadata.jwks_uri().as_str(),
            "https://issuer.example/.well-known/jwks.json"
        );

        let wrong_issuer = discovery_metadata("https://issuer.example/tenant/");
        assert!(matches!(
            OidcDiscoveryMetadata::parse(&provider, wrong_issuer.as_bytes()),
            Err(OidcDiscoveryError::InvalidMetadata)
        ));

        let insecure_endpoint = discovery_metadata("https://issuer.example/tenant").replace(
            "https://issuer.example/oauth2/token",
            "http://issuer.example/token",
        );
        assert!(matches!(
            OidcDiscoveryMetadata::parse(&provider, insecure_endpoint.as_bytes()),
            Err(OidcDiscoveryError::InvalidMetadata)
        ));
    }

    #[test]
    fn discovery_metadata_requires_code_s256_and_rs256() {
        let provider = OidcProviderConfig::parse_json(
            r#"[{"provider_key":"local","display_name":"Local","issuer":"https://issuer.example","client_id":"client-id","client_secret":"client-secret","redirect_uri":"http://127.0.0.1:3000/api/v1/auth/oidc/local/callback"}]"#,
        )
        .expect("provider fixture must parse")
        .pop()
        .expect("provider fixture must contain one item");
        let valid = discovery_metadata("https://issuer.example");

        for unsupported in [
            valid.replace("\"code\"", "\"id_token\""),
            valid.replace("\"S256\"", "\"plain\""),
            valid.replace("\"RS256\"", "\"HS256\""),
        ] {
            assert!(matches!(
                OidcDiscoveryMetadata::parse(&provider, unsupported.as_bytes()),
                Err(OidcDiscoveryError::InvalidMetadata)
            ));
        }
    }

    #[test]
    fn discovery_metadata_and_cache_are_bounded_and_expiring() {
        let provider = provider();
        let oversized = vec![b' '; OIDC_DISCOVERY_MAX_BYTES + 1];
        assert!(matches!(
            OidcDiscoveryMetadata::parse(&provider, &oversized),
            Err(OidcDiscoveryError::ResponseTooLarge)
        ));

        let metadata = OidcDiscoveryMetadata::parse(
            &provider,
            discovery_metadata("https://accounts.google.com").as_bytes(),
        )
        .expect("valid metadata must parse");
        let cache = OidcDiscoveryCache::new();
        let now = Instant::now();
        cache.insert_at("google", metadata.clone(), now);

        assert!(cache.get_at("google", now).is_some());
        assert!(
            cache
                .get_at(
                    "google",
                    now + OIDC_DISCOVERY_CACHE_TTL - Duration::from_secs(1)
                )
                .is_some()
        );
        assert!(
            cache
                .get_at("google", now + OIDC_DISCOVERY_CACHE_TTL)
                .is_none()
        );

        let bounded_cache = OidcDiscoveryCache::new();
        for index in 0..OIDC_DISCOVERY_CACHE_MAX_ENTRIES {
            bounded_cache.insert_at(&format!("provider-{index}"), metadata.clone(), now);
        }
        bounded_cache.insert_at("provider-overflow", metadata, now);
        assert!(bounded_cache.get_at("provider-0", now).is_some());
        assert!(bounded_cache.get_at("provider-overflow", now).is_none());
    }

    #[test]
    fn jwks_parser_accepts_public_keys_and_rejects_private_or_ambiguous_keys() {
        let valid = OidcJwkSet::parse(jwks_json("key-a", 1).as_bytes())
            .expect("valid public JWKS must parse");
        assert_eq!(valid.len(), 1);
        let key = valid.key_by_kid("key-a").expect("key must exist");
        assert_eq!(key.kid(), Some("key-a"));
        assert_eq!(key.alg(), Some("RS256"));

        let modulus = rsa_modulus(1);

        for invalid in [
            r#"{}"#.to_owned(),
            serde_json::json!({"keys": [
                {"kty": "RSA", "kid": "duplicate", "n": modulus, "e": "AQAB"},
                {"kty": "RSA", "kid": "duplicate", "n": modulus, "e": "AQAB"}
            ]})
            .to_string(),
            serde_json::json!({"keys": [{
                "kty": "RSA", "kid": "private", "n": modulus, "e": "AQAB", "d": "AQIDBA"
            }]})
            .to_string(),
            serde_json::json!({"keys": [{"kty": "oct", "kid": "symmetric", "k": "AQIDBA"}]})
                .to_string(),
            serde_json::json!({"keys": [{"kty": "RSA", "kid": "bad-base64", "n": "!", "e": "AQAB"}]})
                .to_string(),
            serde_json::json!({"keys": [{"kty": "RSA", "kid": "missing-n", "e": "AQAB"}]})
                .to_string(),
            serde_json::json!({"keys": [{
                "kty": "RSA", "kid": "private-null", "n": modulus, "e": "AQAB", "d": null
            }]})
            .to_string(),
            serde_json::json!({"keys": [{"kty": "RSA", "kid": null, "n": modulus, "e": "AQAB"}]})
                .to_string(),
            serde_json::json!({"keys": [{"kty": "RSA", "kid": "null-use", "use": null, "n": modulus, "e": "AQAB"}]})
                .to_string(),
            serde_json::json!({"keys": [{"kty": "RSA", "kid": "null-alg", "alg": null, "n": modulus, "e": "AQAB"}]})
                .to_string(),
            serde_json::json!({"keys": [{"kty": "RSA", "kid": "null-ops", "key_ops": null, "n": modulus, "e": "AQAB"}]})
                .to_string(),
            jwks_json(&"k".repeat(OIDC_JWK_KID_MAX_CHARS + 1), 1),
            serde_json::json!({"keys": [{"kty": "RSA", "kid": "leading-zero", "n": "AAE", "e": "AQAB"}]})
                .to_string(),
            serde_json::json!({"keys": [{
                "kty": "RSA", "kid": "even-exponent", "n": modulus, "e": "Ag"
            }]})
            .to_string(),
            serde_json::json!({"keys": [{
                "kty": "RSA", "kid": "wrong-alg", "alg": "HS256", "n": modulus, "e": "AQAB"
            }]})
            .to_string(),
            serde_json::json!({"keys": [{
                "kty": "RSA", "kid": "wrong-operation", "key_ops": ["sign", "verify"], "n": modulus, "e": "AQAB"
            }]})
            .to_string(),
            serde_json::json!({
                "keys": [{"kty": "EC", "kid": "ec", "crv": "P-256", "x": "AQIDBA", "y": "BQYHCA"}]
            })
            .to_string(),
        ] {
            assert!(matches!(
                OidcJwkSet::parse(invalid.as_bytes()),
                Err(OidcJwksError::InvalidJwks)
            ));
        }

        let p256_x = base64url_encode(&[1; 32]);
        let p256_y = base64url_encode(&[2; 32]);
        let ed25519_x = base64url_encode(&[3; 32]);
        let supported = serde_json::json!({
            "keys": [
                {"kty": "RSA", "kid": "rsa", "alg": "RS256", "n": modulus, "e": "AQAB"},
                {"kty": "EC", "kid": "ec", "alg": "ES256", "crv": "P-256", "x": p256_x, "y": p256_y},
                {"kty": "OKP", "kid": "okp", "alg": "EdDSA", "crv": "Ed25519", "x": ed25519_x}
            ]
        })
        .to_string();
        assert_eq!(
            OidcJwkSet::parse(supported.as_bytes())
                .expect("supported public key types must parse")
                .keys()
                .len(),
            3
        );
    }

    #[test]
    fn jwks_parser_bounds_key_count_and_body_size() {
        let oversized = vec![b' '; OIDC_JWKS_MAX_BYTES + 1];
        assert!(matches!(
            OidcJwkSet::parse(&oversized),
            Err(OidcJwksError::ResponseTooLarge)
        ));

        let keys = (0..=OIDC_JWKS_MAX_KEYS)
            .map(|index| {
                serde_json::json!({
                    "kty": "RSA",
                    "kid": format!("key-{index}"),
                    "n": rsa_modulus(index as u8),
                    "e": "AQAB"
                })
            })
            .collect::<Vec<_>>();
        let body = serde_json::json!({"keys": keys}).to_string();
        assert!(matches!(
            OidcJwkSet::parse(body.as_bytes()),
            Err(OidcJwksError::TooManyKeys)
        ));

        let jwks = OidcJwkSet::parse(jwks_json("capacity", 1).as_bytes())
            .expect("valid JWKS fixture must parse");
        let cache = OidcJwksCache::new();
        let now = Instant::now();
        for index in 0..OIDC_JWKS_CACHE_MAX_ENTRIES {
            cache.insert_at(&format!("provider-{index}"), jwks.clone(), now);
        }
        cache.insert_at("provider-overflow", jwks, now);
        assert!(cache.get_at("provider-0", now).is_some());
        assert!(cache.get_at("provider-overflow", now).is_none());
    }

    #[tokio::test]
    async fn jwks_cache_merges_concurrent_requests_and_refreshes_rotation() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use axum::{Router, routing::get};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("local listener must bind");
        let address = listener.local_addr().expect("local address must exist");
        let jwks_url = Url::parse(&format!("http://{address}/jwks")).expect("JWKS URL must parse");
        let body = Arc::new(tokio::sync::Mutex::new(jwks_json("key-a", 1)));
        let request_count = Arc::new(AtomicUsize::new(0));
        let app_body = body.clone();
        let app_count = request_count.clone();
        let app = Router::new().route(
            "/jwks",
            get(move || {
                let body = app_body.clone();
                let count = app_count.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    let body = body.lock().await.clone();
                    (
                        [(axum::http::header::CONTENT_TYPE, "application/json")],
                        body,
                    )
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("local server must run");
        });

        let client = OidcDiscoveryClient::for_tests();
        let cache = OidcJwksCache::new();
        let provider = provider();
        let (first, second) = tokio::join!(
            client.jwks_at(&provider, &cache, jwks_url.clone()),
            client.jwks_at(&provider, &cache, jwks_url.clone())
        );
        assert!(
            first
                .expect("first JWKS request must succeed")
                .key_by_kid("key-a")
                .is_some()
        );
        assert!(second.is_ok());
        assert_eq!(request_count.load(Ordering::SeqCst), 1);

        *body.lock().await = jwks_json("key-b", 5);
        let cache_entry = cache
            .entry_at("google")
            .expect("initial JWKS cache entry must exist");
        let cooled = client
            .refresh_jwks_at(
                &provider,
                &cache,
                jwks_url.clone(),
                cache_entry.refresh_after - Duration::from_millis(1),
            )
            .await
            .expect("refresh cooldown must return valid cached keys");
        assert!(cooled.key_by_kid("key-a").is_some());
        assert_eq!(request_count.load(Ordering::SeqCst), 1);

        let refreshed = client
            .refresh_jwks_at(
                &provider,
                &cache,
                jwks_url.clone(),
                cache_entry.refresh_after,
            )
            .await
            .expect("rotation refresh must succeed");
        assert!(refreshed.key_by_kid("key-b").is_some());
        assert!(refreshed.key_by_kid("key-a").is_none());
        assert_eq!(request_count.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn jwks_refresh_failure_never_returns_a_key_that_expires_during_the_request() {
        use axum::{Router, http::StatusCode, routing::get};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("local listener must bind");
        let address = listener.local_addr().expect("local address must exist");
        let jwks_url = Url::parse(&format!("http://{address}/jwks")).expect("JWKS URL must parse");
        let request_started = Arc::new(tokio::sync::Notify::new());
        let release_response = Arc::new(tokio::sync::Notify::new());
        let app_started = request_started.clone();
        let app_release = release_response.clone();
        let app = Router::new().route(
            "/jwks",
            get(move || {
                let started = app_started.clone();
                let release = app_release.clone();
                async move {
                    started.notify_one();
                    release.notified().await;
                    (StatusCode::SERVICE_UNAVAILABLE, "upstream unavailable")
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("local server must run");
        });

        let client = OidcDiscoveryClient::for_tests();
        let cache = OidcJwksCache::new();
        let provider = provider();
        let now = Instant::now();
        let old = OidcJwkSet::parse(jwks_json("key-a", 1).as_bytes()).expect("fixture must parse");
        cache.insert_at("google", old, now);
        cache
            .entries
            .lock()
            .expect("cache lock must not be poisoned")
            .get_mut("google")
            .expect("cache entry must exist")
            .refresh_after = now;

        let expire_during_request = async {
            request_started.notified().await;
            cache
                .entries
                .lock()
                .expect("cache lock must not be poisoned")
                .get_mut("google")
                .expect("cache entry must exist")
                .expires_at = Instant::now();
            release_response.notify_one();
        };
        let (result, ()) = tokio::join!(
            client.refresh_jwks_at(&provider, &cache, jwks_url, now),
            expire_during_request
        );
        assert!(result.is_err());
        assert!(cache.get_at("google", Instant::now()).is_none());
        server.abort();
    }

    #[tokio::test]
    async fn jwks_cache_keeps_valid_keys_during_backoff_but_never_serves_expired_keys() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use axum::{Router, http::StatusCode, routing::get};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("local listener must bind");
        let address = listener.local_addr().expect("local address must exist");
        let jwks_url = Url::parse(&format!("http://{address}/jwks")).expect("JWKS URL must parse");
        let request_count = Arc::new(AtomicUsize::new(0));
        let app_count = request_count.clone();
        let app = Router::new().route(
            "/jwks",
            get(move || {
                let count = app_count.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    (StatusCode::SERVICE_UNAVAILABLE, "upstream unavailable")
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("local server must run");
        });

        let client = OidcDiscoveryClient::for_tests();
        let cache = OidcJwksCache::new();
        let provider = provider();
        let now = Instant::now();
        let old = OidcJwkSet::parse(jwks_json("key-a", 1).as_bytes()).expect("fixture must parse");
        cache.insert_at("google", old.clone(), now);
        let retained = client
            .refresh_jwks_at(
                &provider,
                &cache,
                jwks_url.clone(),
                now + OIDC_JWKS_REFRESH_COOLDOWN,
            )
            .await
            .expect("valid unexpired keys must survive a refresh failure");
        assert_eq!(retained, old);
        assert_eq!(request_count.load(Ordering::SeqCst), 1);
        let throttled = client
            .refresh_jwks_at(
                &provider,
                &cache,
                jwks_url.clone(),
                now + OIDC_JWKS_REFRESH_COOLDOWN + Duration::from_secs(1),
            )
            .await
            .expect("backoff should return still-valid keys");
        assert_eq!(throttled, old);
        assert_eq!(request_count.load(Ordering::SeqCst), 1);

        let first_retry_at = cache
            .entry_at("google")
            .expect("failed refresh state must remain cached")
            .retry_at;
        let retained_again = client
            .refresh_jwks_at(&provider, &cache, jwks_url.clone(), first_retry_at)
            .await
            .expect("a repeated failure must still retain unexpired keys");
        assert_eq!(retained_again, old);
        assert_eq!(request_count.load(Ordering::SeqCst), 2);
        let second_retry_at = cache
            .entry_at("google")
            .expect("repeated failure state must remain cached")
            .retry_at;
        assert_eq!(
            second_retry_at.duration_since(first_retry_at),
            OIDC_JWKS_FAILURE_BACKOFF_BASE * 2
        );

        let expired_at = now + OIDC_JWKS_CACHE_TTL + Duration::from_secs(1);
        let expired = client
            .jwks_at_now(&provider, &cache, jwks_url.clone(), expired_at)
            .await;
        assert!(expired.is_err());
        assert!(cache.get_at("google", expired_at).is_none());
        assert_eq!(request_count.load(Ordering::SeqCst), 3);
        assert!(matches!(
            client
                .jwks_at_now(
                    &provider,
                    &cache,
                    jwks_url,
                    expired_at + Duration::from_secs(1),
                )
                .await,
            Err(OidcJwksError::RefreshThrottled)
        ));
        assert_eq!(request_count.load(Ordering::SeqCst), 3);
        server.abort();
    }

    #[tokio::test]
    async fn discovery_client_fetches_metadata_without_following_redirects() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use axum::{Router, http::StatusCode, routing::get};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("local listener must bind");
        let address = listener.local_addr().expect("local address must exist");
        let discovery_url = Url::parse(&format!(
            "http://{address}/.well-known/openid-configuration"
        ))
        .expect("discovery URL must parse");
        let provider = provider();
        let body = discovery_metadata(provider.issuer_identifier());
        let request_count = Arc::new(AtomicUsize::new(0));
        let handler_request_count = request_count.clone();
        let app = Router::new().route(
            "/.well-known/openid-configuration",
            get(move || {
                let body = body.clone();
                let request_count = handler_request_count.clone();
                async move {
                    request_count.fetch_add(1, Ordering::SeqCst);
                    (
                        [(axum::http::header::CONTENT_TYPE, "application/json")],
                        body,
                    )
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("local server must run");
        });

        let client = OidcDiscoveryClient::for_tests();
        let cache = OidcDiscoveryCache::new();
        let (first, second) = tokio::join!(
            client.discover_at(&provider, &cache, discovery_url.clone()),
            client.discover_at(&provider, &cache, discovery_url)
        );
        assert_eq!(
            first
                .expect("first discovery must succeed")
                .issuer()
                .as_str(),
            provider.issuer.as_str()
        );
        assert!(second.is_ok());
        assert_eq!(request_count.load(Ordering::SeqCst), 1);
        assert!(matches!(
            OidcDiscoveryClient::new()
                .expect("production client must build")
                .fetch_at(
                    &provider,
                    Url::parse("http://127.0.0.1/.well-known/openid-configuration")
                        .expect("HTTP URL fixture must parse")
                )
                .await,
            Err(OidcDiscoveryError::Network)
        ));
        server.abort();

        let redirect_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("redirect listener must bind");
        let redirect_address = redirect_listener
            .local_addr()
            .expect("redirect address must exist");
        let redirect_url = Url::parse(&format!(
            "http://{redirect_address}/.well-known/openid-configuration"
        ))
        .expect("redirect URL must parse");
        let redirect_app = Router::new().route(
            "/.well-known/openid-configuration",
            get(|| async {
                (
                    StatusCode::FOUND,
                    [(axum::http::header::LOCATION, "/other")],
                )
            }),
        );
        let redirect_server = tokio::spawn(async move {
            axum::serve(redirect_listener, redirect_app)
                .await
                .expect("redirect server must run");
        });
        assert!(matches!(
            OidcDiscoveryClient::for_tests()
                .fetch_at(&provider, redirect_url)
                .await,
            Err(OidcDiscoveryError::Redirected)
        ));
        redirect_server.abort();
    }

    #[tokio::test]
    async fn discovery_client_rejects_response_bodies_over_the_limit() {
        use axum::{Router, routing::get};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("local listener must bind");
        let address = listener.local_addr().expect("local address must exist");
        let discovery_url = Url::parse(&format!(
            "http://{address}/.well-known/openid-configuration"
        ))
        .expect("discovery URL must parse");
        let body = "x".repeat(OIDC_DISCOVERY_MAX_BYTES + 1);
        let app = Router::new().route(
            "/.well-known/openid-configuration",
            get(move || {
                let body = body.clone();
                async move {
                    (
                        [(axum::http::header::CONTENT_TYPE, "application/json")],
                        body,
                    )
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("local server must run");
        });

        assert!(matches!(
            OidcDiscoveryClient::for_tests()
                .fetch_at(&provider(), discovery_url)
                .await,
            Err(OidcDiscoveryError::ResponseTooLarge)
        ));
        server.abort();

        let content_type_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("content type listener must bind");
        let content_type_address = content_type_listener
            .local_addr()
            .expect("content type address must exist");
        let content_type_url = Url::parse(&format!(
            "http://{content_type_address}/.well-known/openid-configuration"
        ))
        .expect("content type URL must parse");
        let provider = provider();
        let valid_body = discovery_metadata(provider.issuer_identifier());
        let content_type_app = Router::new().route(
            "/.well-known/openid-configuration",
            get(move || {
                let body = valid_body.clone();
                async move { body }
            }),
        );
        let content_type_server = tokio::spawn(async move {
            axum::serve(content_type_listener, content_type_app)
                .await
                .expect("content type server must run");
        });
        assert!(matches!(
            OidcDiscoveryClient::for_tests()
                .fetch_at(&provider, content_type_url)
                .await,
            Err(OidcDiscoveryError::InvalidMetadata)
        ));
        content_type_server.abort();

        let timeout_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("timeout listener must bind");
        let timeout_address = timeout_listener
            .local_addr()
            .expect("timeout address must exist");
        let timeout_url = Url::parse(&format!(
            "http://{timeout_address}/.well-known/openid-configuration"
        ))
        .expect("timeout URL must parse");
        let timeout_app = Router::new().route(
            "/.well-known/openid-configuration",
            get(|| async { std::future::pending::<String>().await }),
        );
        let timeout_server = tokio::spawn(async move {
            axum::serve(timeout_listener, timeout_app)
                .await
                .expect("timeout server must run");
        });
        assert!(matches!(
            OidcDiscoveryClient::for_tests_with_timeout(Duration::from_millis(100))
                .fetch_at(&provider, timeout_url)
                .await,
            Err(OidcDiscoveryError::Network)
        ));
        timeout_server.abort();
    }

    #[tokio::test]
    async fn token_exchange_posts_only_expected_form_fields() {
        use axum::{Router, routing::post};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("token listener must bind");
        let address = listener.local_addr().expect("token address must exist");
        let app = Router::new().route(
            "/token",
            post(|body: String| async move {
                let pairs: HashMap<_, _> = url::form_urlencoded::parse(body.as_bytes())
                    .into_owned()
                    .collect();
                assert_eq!(pairs.get("grant_type"), Some(&"authorization_code".to_owned()));
                assert_eq!(pairs.get("code"), Some(&"auth-code".to_owned()));
                assert_eq!(pairs.get("client_id"), Some(&"client-id".to_owned()));
                assert_eq!(pairs.get("client_secret"), Some(&"client-secret".to_owned()));
                assert_eq!(pairs.get("redirect_uri"), Some(&"https://community.example.com/api/v1/auth/oidc/google/callback".to_owned()));
                assert!(pairs.get("code_verifier").is_some_and(|value| value.len() == 43));
                (
                    [(axum::http::header::CONTENT_TYPE, "application/json")],
                    r#"{"access_token":"access","token_type":"Bearer","id_token":"header.payload.signature"}"#,
                )
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("token server must run");
        });

        let provider = provider();
        let transaction = OidcAuthorizationTransactionStore::new()
            .begin(&provider)
            .expect("transaction must begin");
        let metadata = OidcDiscoveryMetadata {
            issuer: provider.issuer.clone(),
            authorization_endpoint: Url::parse("https://accounts.google.com/authorize")
                .expect("authorization endpoint must parse"),
            token_endpoint: Url::parse(&format!("http://{address}/token"))
                .expect("test token endpoint must parse"),
            jwks_uri: Url::parse("https://accounts.google.com/jwks")
                .expect("JWKS endpoint must parse"),
        };
        let response = OidcDiscoveryClient::for_tests()
            .exchange_code(&provider, &metadata, &transaction, "auth-code")
            .await
            .expect("token exchange must succeed");
        assert_eq!(response.id_token(), "header.payload.signature");
        assert_eq!(response.token_type(), "Bearer");
        server.abort();
    }
}
