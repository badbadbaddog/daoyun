use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use api_contract::{
    ApiResponse, AuthenticatedSession, ErrorBody, ErrorCode, ErrorResponse, MfaCodeRequest,
    MfaDisableData, MfaEnableData, MfaRecoveryCodesData, MfaSetupData, MfaStatus, MfaVerifyRequest,
    RequestId, error_codes,
};
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use infrastructure::{Database, MfaError, MfaSecurityMutationError, MfaVerificationRecord};
use rand_core::{OsRng, RngCore};
use serde_json::json;
use std::{error::Error, fmt};
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use totp_rs::{Algorithm, Builder, Secret, Totp};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::auth::{
    ApiError, AuthRuntime, authenticate_session, authenticate_state_change, cookie_value,
    create_session, csrf_cookie_header, malformed_body, random_token,
    recent_authentication_required, record_security_audit, service_unavailable,
    session_cookie_headers, token_hash,
};

const CIPHERTEXT_VERSION: u8 = 1;
const NONCE_BYTES: usize = 12;
const TOTP_SECRET_BYTES: usize = 20;

// RFC 6238: https://www.rfc-editor.org/rfc/rfc6238.html
// totp-rs 6.0.0: https://docs.rs/totp-rs/6.0.0/totp_rs/
// aes-gcm 0.11.0: https://docs.rs/aes-gcm/0.11.0/aes_gcm/
#[derive(Clone)]
pub struct MfaRuntime {
    key: Option<[u8; 32]>,
}

#[derive(Debug)]
pub enum MfaConfigError {
    InvalidBase64,
    InvalidLength,
}

impl fmt::Display for MfaConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBase64 => {
                formatter.write_str("DAOYUN_MFA_ENCRYPTION_KEY must be base64 encoded")
            }
            Self::InvalidLength => {
                formatter.write_str("DAOYUN_MFA_ENCRYPTION_KEY must decode to exactly 32 bytes")
            }
        }
    }
}

impl Error for MfaConfigError {}

impl MfaRuntime {
    pub fn disabled() -> Self {
        Self { key: None }
    }

    pub fn from_environment() -> Result<Self, MfaConfigError> {
        let value = match std::env::var("DAOYUN_MFA_ENCRYPTION_KEY") {
            Ok(value) => value,
            Err(std::env::VarError::NotPresent) => return Ok(Self::disabled()),
            Err(std::env::VarError::NotUnicode(_)) => return Err(MfaConfigError::InvalidBase64),
        };
        Self::from_key_material(Some(&value))
    }

    pub fn from_key_material(value: Option<&str>) -> Result<Self, MfaConfigError> {
        let Some(value) = value else {
            return Ok(Self::disabled());
        };
        let decoded = BASE64
            .decode(value)
            .map_err(|_| MfaConfigError::InvalidBase64)?;
        let key: [u8; 32] = decoded
            .try_into()
            .map_err(|_| MfaConfigError::InvalidLength)?;
        Ok(Self { key: Some(key) })
    }

    pub fn is_enabled(&self) -> bool {
        self.key.is_some()
    }

    pub fn encrypt_secret(&self, user_id: Uuid, secret: &[u8]) -> Result<Vec<u8>, MfaConfigError> {
        let Some(key) = self.key else {
            return Err(MfaConfigError::InvalidLength);
        };
        if secret.is_empty() {
            return Err(MfaConfigError::InvalidLength);
        }
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| MfaConfigError::InvalidLength)?;
        let mut nonce_bytes = [0_u8; NONCE_BYTES];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from(nonce_bytes);
        let aad = secret_aad(user_id);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: secret,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| MfaConfigError::InvalidLength)?;
        let mut output = Vec::with_capacity(1 + NONCE_BYTES + ciphertext.len());
        output.push(CIPHERTEXT_VERSION);
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);
        Ok(output)
    }

    pub fn decrypt_secret(
        &self,
        user_id: Uuid,
        ciphertext: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, MfaConfigError> {
        let Some(key) = self.key else {
            return Err(MfaConfigError::InvalidLength);
        };
        if ciphertext.len() <= 1 + NONCE_BYTES || ciphertext[0] != CIPHERTEXT_VERSION {
            return Err(MfaConfigError::InvalidLength);
        }
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| MfaConfigError::InvalidLength)?;
        let nonce = Nonce::try_from(&ciphertext[1..1 + NONCE_BYTES])
            .map_err(|_| MfaConfigError::InvalidLength)?;
        let aad = secret_aad(user_id);
        let plaintext = cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: &ciphertext[1 + NONCE_BYTES..],
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| MfaConfigError::InvalidLength)?;
        Ok(Zeroizing::new(plaintext))
    }
}

fn secret_aad(user_id: Uuid) -> String {
    format!("mfa_totp:v1:{user_id}")
}

pub fn build_totp(secret: &[u8], account_name: &str) -> Result<Totp, String> {
    if secret.len() != TOTP_SECRET_BYTES || account_name.is_empty() {
        return Err("invalid TOTP setup input".to_owned());
    }
    Builder::new()
        .with_algorithm(Algorithm::SHA1)
        .with_digits(6)
        .with_skew(1)
        .with_step_duration(30)
        .with_secret(secret)
        .with_account_name(account_name)
        .with_issuer(Some("DaoYun"))
        .build()
        .map_err(|error| error.to_string())
}

pub fn generate_totp_setup(
    account_name: &str,
) -> Result<(Zeroizing<Vec<u8>>, String, String), String> {
    let secret = Secret::generate();
    let secret_bytes = Zeroizing::new(secret.as_bytes().to_vec());
    let totp = build_totp(&secret_bytes, account_name)?;
    let secret_base32 = secret.to_base32();
    let otpauth_url = totp.to_url().map_err(|error| error.to_string())?;
    Ok((secret_bytes, secret_base32, otpauth_url))
}

pub fn verify_totp(secret: &[u8], account_name: &str, code: &str) -> Option<u64> {
    if code.len() != 6 || !code.as_bytes().iter().all(u8::is_ascii_digit) {
        return None;
    }
    build_totp(secret, account_name).ok()?.check_current(code)
}

pub fn generate_recovery_codes(count: usize) -> Vec<String> {
    (0..count)
        .map(|_| {
            let secret = Secret::generate();
            let raw = secret.to_base32();
            raw.as_bytes()[..16]
                .chunks(4)
                .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
                .collect::<Vec<_>>()
                .join("-")
        })
        .collect()
}

pub fn hash_recovery_code(code: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(code.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| error.to_string())
}

pub fn verify_recovery_code(hash: &str, code: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(code.as_bytes(), &parsed)
        .is_ok()
}

pub(crate) fn challenge_cookie_header(runtime: &AuthRuntime, token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let value = format!(
        "{}={token}; Path=/; Max-Age=300; HttpOnly; SameSite=Strict{}",
        runtime.mfa_challenge_cookie_name(),
        runtime.secure_attribute()
    );
    headers.append(
        header::SET_COOKIE,
        HeaderValue::from_str(&value).expect("server-generated MFA cookie is valid"),
    );
    headers
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/mfa",
    operation_id = "getMfaStatus",
    tag = "auth",
    responses(
        (status = 200, body = ApiResponse<MfaStatus>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn status(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(mfa_runtime): Extension<MfaRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<MfaStatus>>, ApiError> {
    let (current, _) = authenticate_session(&database, &auth_runtime, &headers, request_id).await?;
    let status = database
        .get_mfa_status(current.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "MFA status lookup failed");
            service_unavailable(request_id)
        })?;
    if status.enabled && !mfa_runtime.is_enabled() {
        return Err(mfa_error(
            StatusCode::SERVICE_UNAVAILABLE,
            error_codes::AUTH_MFA_NOT_CONFIGURED,
            "多因素认证密钥未配置",
            request_id,
        ));
    }
    Ok(Json(ApiResponse::new(
        MfaStatus {
            enabled: status.enabled,
            setup_pending: status.setup_pending,
            recovery_codes_remaining: u8::try_from(status.recovery_codes_remaining)
                .unwrap_or(u8::MAX),
        },
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/mfa/verify",
    operation_id = "verifyMfaChallenge",
    tag = "auth",
    request_body = MfaVerifyRequest,
    responses(
        (status = 200, body = ApiResponse<AuthenticatedSession>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn verify_challenge(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(mfa_runtime): Extension<MfaRuntime>,
    headers: HeaderMap,
    request: Result<Json<MfaVerifyRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<AuthenticatedSession>>), ApiError> {
    ensure_configured(&mfa_runtime, request_id)?;
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let browser_token = cookie_value(&headers, auth_runtime.mfa_challenge_cookie_name())
        .filter(|value| valid_token(value))
        .ok_or_else(|| mfa_invalid(request_id))?;
    let browser_hash = token_hash(browser_token);
    let challenge = database
        .get_mfa_challenge(request.challenge_id, browser_hash.clone())
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "MFA challenge lookup failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| mfa_invalid(request_id))?;
    let account = database
        .get_mfa_challenge_user(challenge.user_id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "MFA challenge user lookup failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| mfa_invalid(request_id))?;
    let verification = match verify_current_mfa(
        &database,
        &mfa_runtime,
        account.id,
        &account.email,
        &request.code,
        request_id,
    )
    .await
    {
        Ok(verification) => verification,
        Err(error) => {
            let _ = database
                .record_mfa_challenge_failure(request.challenge_id, browser_hash)
                .await;
            return Err(error);
        }
    };
    let Some(_) = database
        .complete_mfa_challenge(request.challenge_id, browser_hash, verification)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "MFA challenge completion failed");
            service_unavailable(request_id)
        })?
    else {
        return Err(mfa_invalid(request_id));
    };
    let secrets = create_session(&database, account.id, challenge.device_label, request_id).await?;
    record_security_audit(
        &database,
        Some(account.id),
        Some(secrets.session_id),
        "auth.login.succeeded",
        json!({"method": "password+mfa"}),
        request_id,
    )
    .await;
    let mut response_headers = session_cookie_headers(&auth_runtime, &secrets);
    response_headers.append(
        header::SET_COOKIE,
        clear_challenge_cookie_value(&auth_runtime),
    );
    Ok((
        response_headers,
        Json(ApiResponse::new(
            AuthenticatedSession {
                user: api_contract::AuthenticatedUser {
                    id: account.id,
                    username: account.username,
                    email: account.email,
                    display_name: account.display_name,
                },
                csrf_token: secrets.csrf_token,
            },
            request_id,
        )),
    ))
}

fn clear_challenge_cookie_value(runtime: &AuthRuntime) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict{}",
        runtime.mfa_challenge_cookie_name(),
        runtime.secure_attribute()
    ))
    .expect("server-generated MFA cookie is valid")
}

fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/mfa/totp/setup",
    operation_id = "setupMfaTotp",
    tag = "auth",
    responses(
        (status = 200, body = ApiResponse<MfaSetupData>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn setup_totp(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(mfa_runtime): Extension<MfaRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<MfaSetupData>>, ApiError> {
    ensure_configured(&mfa_runtime, request_id)?;
    let current = authenticate_state_change(&database, &auth_runtime, &headers, request_id).await?;
    let recent = database
        .has_recent_authentication(current.user.id, current.id, "security.settings")
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "MFA recent authentication lookup failed");
            service_unavailable(request_id)
        })?;
    if !recent {
        return Err(recent_authentication_required(request_id));
    }
    let (secret, secret_base32, otpauth_url) =
        generate_totp_setup(&current.user.email).map_err(|_| mfa_internal_error(request_id))?;
    let encrypted = mfa_runtime
        .encrypt_secret(current.user.id, &secret)
        .map_err(|_| mfa_internal_error(request_id))?;
    let expires_at = OffsetDateTime::now_utc() + Duration::minutes(10);
    database
        .upsert_mfa_totp_setup(current.user.id, encrypted, expires_at)
        .await
        .map_err(|error| match error {
            MfaError::AlreadyEnabled => mfa_already_enabled(request_id),
            _ => {
                tracing::warn!(request_id = %request_id, "MFA setup persistence failed");
                service_unavailable(request_id)
            }
        })?;
    Ok(Json(ApiResponse::new(
        MfaSetupData {
            secret_base32,
            otpauth_url,
            expires_at: format_timestamp(expires_at, request_id)?,
        },
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/mfa/totp/enable",
    operation_id = "enableMfaTotp",
    tag = "auth",
    request_body = MfaCodeRequest,
    responses(
        (status = 200, body = ApiResponse<MfaEnableData>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn enable_totp(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(mfa_runtime): Extension<MfaRuntime>,
    headers: HeaderMap,
    request: Result<Json<MfaCodeRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<MfaEnableData>>), ApiError> {
    ensure_configured(&mfa_runtime, request_id)?;
    let current = authenticate_state_change(&database, &auth_runtime, &headers, request_id).await?;
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let totp = database
        .get_mfa_totp(current.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "MFA setup lookup failed");
            service_unavailable(request_id)
        })?
        .filter(|record| !record.enabled)
        .ok_or_else(|| mfa_setup_required(request_id))?;
    let secret = mfa_runtime
        .decrypt_secret(current.user.id, &totp.encrypted_secret)
        .map_err(|_| mfa_internal_error(request_id))?;
    let matched_step = verify_totp(&secret, &current.user.email, request.code.trim())
        .ok_or_else(|| mfa_invalid(request_id))?;
    let matched_step = i64::try_from(matched_step).map_err(|_| mfa_invalid(request_id))?;
    let recovery_codes = generate_recovery_codes(10);
    let recovery_hashes = hash_recovery_codes(recovery_codes.clone(), request_id).await?;
    let csrf_token = random_token();
    database
        .enable_mfa_totp_for_session(
            current.user.id,
            current.id,
            matched_step,
            &recovery_hashes,
            token_hash(&csrf_token),
        )
        .await
        .map_err(|error| map_mutation_error(error, request_id))?;
    let response_headers = csrf_cookie_header(&auth_runtime, &csrf_token);
    Ok((
        response_headers,
        Json(ApiResponse::new(
            MfaEnableData {
                enabled: true,
                csrf_token,
                recovery_codes,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/mfa/disable",
    operation_id = "disableMfa",
    tag = "auth",
    request_body = MfaCodeRequest,
    responses(
        (status = 200, body = ApiResponse<MfaDisableData>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn disable(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(mfa_runtime): Extension<MfaRuntime>,
    headers: HeaderMap,
    request: Result<Json<MfaCodeRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<MfaDisableData>>), ApiError> {
    ensure_configured(&mfa_runtime, request_id)?;
    let current = authenticate_state_change(&database, &auth_runtime, &headers, request_id).await?;
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let verification = verify_current_mfa(
        &database,
        &mfa_runtime,
        current.user.id,
        &current.user.email,
        &request.code,
        request_id,
    )
    .await?;
    let csrf_token = random_token();
    database
        .disable_mfa_for_session(
            current.user.id,
            current.id,
            verification,
            token_hash(&csrf_token),
        )
        .await
        .map_err(|error| map_mutation_error(error, request_id))?;
    Ok((
        csrf_cookie_header(&auth_runtime, &csrf_token),
        Json(ApiResponse::new(
            MfaDisableData {
                disabled: true,
                csrf_token,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/mfa/recovery-codes/regenerate",
    operation_id = "regenerateMfaRecoveryCodes",
    tag = "auth",
    request_body = MfaCodeRequest,
    responses(
        (status = 200, body = ApiResponse<MfaRecoveryCodesData>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn regenerate_recovery_codes(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(mfa_runtime): Extension<MfaRuntime>,
    headers: HeaderMap,
    request: Result<Json<MfaCodeRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<MfaRecoveryCodesData>>), ApiError> {
    ensure_configured(&mfa_runtime, request_id)?;
    let current = authenticate_state_change(&database, &auth_runtime, &headers, request_id).await?;
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let verification = verify_current_mfa(
        &database,
        &mfa_runtime,
        current.user.id,
        &current.user.email,
        &request.code,
        request_id,
    )
    .await?;
    let recovery_codes = generate_recovery_codes(10);
    let recovery_hashes = hash_recovery_codes(recovery_codes.clone(), request_id).await?;
    let csrf_token = random_token();
    database
        .regenerate_mfa_recovery_codes_for_session(
            current.user.id,
            current.id,
            verification,
            &recovery_hashes,
            token_hash(&csrf_token),
        )
        .await
        .map_err(|error| map_mutation_error(error, request_id))?;
    Ok((
        csrf_cookie_header(&auth_runtime, &csrf_token),
        Json(ApiResponse::new(
            MfaRecoveryCodesData {
                recovery_codes,
                csrf_token,
            },
            request_id,
        )),
    ))
}

async fn hash_recovery_codes(
    codes: Vec<String>,
    request_id: RequestId,
) -> Result<Vec<(Uuid, String)>, ApiError> {
    tokio::task::spawn_blocking(move || {
        codes
            .iter()
            .map(|code| hash_recovery_code(code).map(|hash| (Uuid::now_v7(), hash)))
            .collect::<Result<Vec<_>, _>>()
    })
    .await
    .map_err(|_| mfa_internal_error(request_id))?
    .map_err(|_| mfa_internal_error(request_id))
}

async fn verify_current_mfa(
    database: &Database,
    runtime: &MfaRuntime,
    user_id: Uuid,
    account_name: &str,
    code: &str,
    request_id: RequestId,
) -> Result<MfaVerificationRecord, ApiError> {
    let normalized = code.trim().to_ascii_uppercase();
    let totp = database
        .get_mfa_totp(user_id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "MFA credential lookup failed");
            service_unavailable(request_id)
        })?
        .filter(|record| record.enabled)
        .ok_or_else(|| mfa_not_enabled(request_id))?;
    if normalized.len() == 6 && normalized.as_bytes().iter().all(u8::is_ascii_digit) {
        let secret = runtime
            .decrypt_secret(user_id, &totp.encrypted_secret)
            .map_err(|_| mfa_internal_error(request_id))?;
        let step = verify_totp(&secret, account_name, &normalized)
            .and_then(|step| i64::try_from(step).ok())
            .ok_or_else(|| mfa_invalid(request_id))?;
        return Ok(MfaVerificationRecord::TotpStep(step));
    }
    if normalized.len() != 19 {
        return Err(mfa_invalid(request_id));
    }
    let records = database
        .list_unused_mfa_recovery_codes(user_id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "MFA recovery lookup failed");
            service_unavailable(request_id)
        })?;
    let matched = tokio::task::spawn_blocking(move || {
        records
            .into_iter()
            .find(|record| verify_recovery_code(&record.code_hash, &normalized))
            .map(|record| record.id)
    })
    .await
    .map_err(|_| mfa_internal_error(request_id))?
    .ok_or_else(|| mfa_invalid(request_id))?;
    Ok(MfaVerificationRecord::RecoveryCode(matched))
}

fn map_mutation_error(error: MfaSecurityMutationError, request_id: RequestId) -> ApiError {
    match error {
        MfaSecurityMutationError::RecentAuthenticationRequired => {
            recent_authentication_required(request_id)
        }
        MfaSecurityMutationError::VerificationFailed => mfa_invalid(request_id),
        MfaSecurityMutationError::NotEnabled => mfa_not_enabled(request_id),
        MfaSecurityMutationError::SetupRequired => mfa_setup_required(request_id),
        MfaSecurityMutationError::InvalidInput => mfa_internal_error(request_id),
        MfaSecurityMutationError::Database(error) => {
            tracing::warn!(request_id = %request_id, error = %error, "MFA security mutation failed");
            service_unavailable(request_id)
        }
    }
}

#[allow(clippy::result_large_err)]
fn ensure_configured(runtime: &MfaRuntime, request_id: RequestId) -> Result<(), ApiError> {
    runtime.is_enabled().then_some(()).ok_or_else(|| {
        mfa_error(
            StatusCode::SERVICE_UNAVAILABLE,
            error_codes::AUTH_MFA_NOT_CONFIGURED,
            "多因素认证尚未配置",
            request_id,
        )
    })
}

#[allow(clippy::result_large_err)]
fn format_timestamp(value: OffsetDateTime, request_id: RequestId) -> Result<String, ApiError> {
    value
        .format(&Rfc3339)
        .map_err(|_| mfa_internal_error(request_id))
}

fn mfa_already_enabled(request_id: RequestId) -> ApiError {
    mfa_error(
        StatusCode::CONFLICT,
        error_codes::AUTH_MFA_ALREADY_ENABLED,
        "多因素认证已启用",
        request_id,
    )
}

fn mfa_setup_required(request_id: RequestId) -> ApiError {
    mfa_error(
        StatusCode::CONFLICT,
        error_codes::AUTH_MFA_SETUP_REQUIRED,
        "请先完成多因素认证设置",
        request_id,
    )
}

fn mfa_not_enabled(request_id: RequestId) -> ApiError {
    mfa_error(
        StatusCode::CONFLICT,
        error_codes::AUTH_MFA_NOT_ENABLED,
        "多因素认证尚未启用",
        request_id,
    )
}

fn mfa_invalid(request_id: RequestId) -> ApiError {
    mfa_error(
        StatusCode::FORBIDDEN,
        error_codes::AUTH_MFA_INVALID,
        "多因素认证验证码无效",
        request_id,
    )
}

fn mfa_internal_error(request_id: RequestId) -> ApiError {
    mfa_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        error_codes::INTERNAL_ERROR,
        "多因素认证凭据暂时无法处理",
        request_id,
    )
}

fn mfa_error(
    status: StatusCode,
    code: &'static str,
    message: &'static str,
    request_id: RequestId,
) -> ApiError {
    (
        status,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            request_id,
        )),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_material_is_strict_and_encryption_is_bound_to_user() {
        assert!(matches!(
            MfaRuntime::from_key_material(Some("bad")),
            Err(MfaConfigError::InvalidLength | MfaConfigError::InvalidBase64)
        ));
        let key = BASE64.encode([9_u8; 32]);
        let runtime = MfaRuntime::from_key_material(Some(&key)).expect("key must parse");
        let user_id = Uuid::now_v7();
        let ciphertext = runtime
            .encrypt_secret(user_id, &[1_u8; 20])
            .expect("encrypt");
        assert_ne!(ciphertext, [1_u8; 20]);
        assert_eq!(
            &*runtime
                .decrypt_secret(user_id, &ciphertext)
                .expect("decrypt"),
            &[1_u8; 20]
        );
        assert!(runtime.decrypt_secret(Uuid::now_v7(), &ciphertext).is_err());
    }

    #[test]
    fn totp_and_recovery_code_helpers_follow_contract() {
        let (secret, base32, url) = generate_totp_setup("mfa@example.com").expect("setup");
        assert_eq!(secret.len(), 20);
        assert_eq!(base32.len(), 32);
        assert!(url.starts_with("otpauth://totp/"));
        let totp = build_totp(&secret, "mfa@example.com").expect("totp");
        let code = totp.generate_current().to_string();
        assert!(verify_totp(&secret, "mfa@example.com", &code).is_some());
        let recovery = generate_recovery_codes(10);
        assert_eq!(recovery.len(), 10);
        assert!(recovery.iter().all(|code| code.len() == 19));
        let hash = hash_recovery_code(&recovery[0]).expect("hash");
        assert!(verify_recovery_code(&hash, &recovery[0]));
        assert!(!verify_recovery_code(&hash, &recovery[1]));
    }
}
