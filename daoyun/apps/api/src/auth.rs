use api_contract::{
    ApiResponse, AuthenticatedSession, AuthenticatedUser, ChangePasswordData,
    ChangePasswordRequest, DeviceSession, ErrorBody, ErrorCode, ErrorResponse, ExternalIdentity,
    FieldErrors, LoginRequest, LogoutData, OidcAuthorizationStartData, OidcClaimAccountRequest,
    OidcClaimBindData, OidcClaimData, OidcProvider, PasskeyAssertionOptions,
    PasskeyAssertionOptionsData, PasskeyAssertionVerifyRequest, PasskeyAuthenticatorSelection,
    PasskeyCredentialDescriptor, PasskeyCredentialParameter, PasskeyCredentialSummary,
    PasskeyDeleteData, PasskeyRegistrationOptions, PasskeyRegistrationOptionsData,
    PasskeyRegistrationVerifyRequest, PasskeyRp, PasskeyUser, RecentAuthData, RecentAuthRequest,
    RegisterRequest, RegistrationEmailChallengeData, RegistrationEmailChallengeRequest,
    RegistrationPolicy, RequestId, RevokeDeviceSessionData, UnlinkExternalIdentityData,
    error_codes,
};
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::{
    Extension, Json, Router,
    extract::{
        ConnectInfo, DefaultBodyLimit, Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use email_address::EmailAddress;
use infrastructure::{
    BindExternalIdentityError, ChangePasswordError, Database, DeletePasskeyError,
    DeviceSessionRecord, ExternalIdentityRecord, NewExternalIdentityRecord, NewMfaChallengeRecord,
    NewPasskeyChallengeRecord, NewRegistrationEmailChallenge, NewSessionRecord, NewUserRecord,
    PasskeyChallengeKind, RegisterPasskeyError, RegisterUserError, RegistrationEmailChallengeError,
    SecurityAuditEvent, SessionRecord, UnlinkExternalIdentityError,
};
use passkey_auth::{
    AuthenticationResponse, CredentialId, PasskeyCredential, RegistrationResponse, Webauthn,
};
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    str::FromStr,
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};
use time::{
    Duration as TimeDuration, OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339,
};
use tokio::sync::Semaphore;
use url::Url;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::EmailRuntime;
use crate::oidc::{
    OidcClaim, OidcIdentityBinding, OidcProtocolError, OidcProviderConfig, OidcRuntime,
};

const AUTH_BODY_LIMIT: usize = 4 * 1024;
const SESSION_MAX_AGE_SECONDS: u64 = 30 * 24 * 60 * 60;
const OIDC_TRANSACTION_MAX_AGE_SECONDS: u64 = 5 * 60;
const REGISTRATION_CODE_EXPIRES_SECONDS: u32 = 10 * 60;
const REGISTRATION_CODE_RESEND_SECONDS: u32 = 60;
const MAX_TRACKED_AUTH_ATTEMPT_WINDOWS: usize = 16_384;
const RECENT_AUTH_OPERATIONS: &[&str] = &["security.settings"];
static PASSWORD_OPERATIONS: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(4));
static DUMMY_PASSWORD_HASH: LazyLock<String> = LazyLock::new(|| {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(b"daoyun-invalid-login-placeholder", &salt)
        .expect("the fixed dummy password must hash")
        .to_string()
});

pub(crate) type ApiError = (StatusCode, HeaderMap, Json<ErrorResponse>);

struct ValidatedRegistration {
    username: String,
    email: String,
    display_name: String,
    password: Zeroizing<String>,
    email_challenge_id: Option<Uuid>,
    email_verification_code: Option<Zeroizing<String>>,
}

pub(crate) struct SessionSecrets {
    pub(crate) session_id: Uuid,
    pub(crate) session_token: String,
    pub(crate) csrf_token: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OidcCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct AuthConfig {
    secure_cookies: bool,
    attempt_limit: u32,
    attempt_window: Duration,
    oidc_providers: Vec<OidcProviderConfig>,
    passkey_rp_id: String,
    passkey_origin: String,
    passkey_rp_name: String,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            secure_cookies: true,
            attempt_limit: 10,
            attempt_window: Duration::from_secs(15 * 60),
            oidc_providers: Vec::new(),
            passkey_rp_id: "127.0.0.1".to_owned(),
            passkey_origin: "http://127.0.0.1:5173".to_owned(),
            passkey_rp_name: "DaoYun".to_owned(),
        }
    }
}

impl AuthConfig {
    pub fn from_environment() -> Result<Self, String> {
        let secure_cookies = match std::env::var("DAOYUN_COOKIE_SECURE") {
            Ok(value) => value
                .parse::<bool>()
                .map_err(|_| "DAOYUN_COOKIE_SECURE must be true or false".to_owned())?,
            Err(std::env::VarError::NotPresent) => true,
            Err(std::env::VarError::NotUnicode(_)) => {
                return Err("DAOYUN_COOKIE_SECURE must be valid Unicode".to_owned());
            }
        };
        let mut config = Self::default().with_secure_cookies(secure_cookies);
        match std::env::var("DAOYUN_PASSKEY_RP_ID") {
            Ok(value) => {
                config = config.with_passkey_rp_id(value)?;
            }
            Err(std::env::VarError::NotPresent) => {}
            Err(std::env::VarError::NotUnicode(_)) => {
                return Err("DAOYUN_PASSKEY_RP_ID must be valid Unicode".to_owned());
            }
        }
        match std::env::var("DAOYUN_PASSKEY_ORIGIN") {
            Ok(value) => {
                config = config.with_passkey_origin(value)?;
            }
            Err(std::env::VarError::NotPresent) => {}
            Err(std::env::VarError::NotUnicode(_)) => {
                return Err("DAOYUN_PASSKEY_ORIGIN must be valid Unicode".to_owned());
            }
        }
        match std::env::var("DAOYUN_PASSKEY_RP_NAME") {
            Ok(value) => {
                config = config.with_passkey_rp_name(value)?;
            }
            Err(std::env::VarError::NotPresent) => {}
            Err(std::env::VarError::NotUnicode(_)) => {
                return Err("DAOYUN_PASSKEY_RP_NAME must be valid Unicode".to_owned());
            }
        }
        match std::env::var("DAOYUN_OIDC_PROVIDERS") {
            Ok(value) => {
                config = config.with_oidc_provider_json(value)?;
            }
            Err(std::env::VarError::NotPresent) => {}
            Err(std::env::VarError::NotUnicode(_)) => {
                return Err("DAOYUN_OIDC_PROVIDERS must be valid Unicode".to_owned());
            }
        }
        if !origin_matches_rp_id(
            Url::parse(&config.passkey_origin)
                .map_err(|_| "DAOYUN_PASSKEY_ORIGIN must be a valid origin".to_owned())?
                .host_str()
                .ok_or_else(|| "DAOYUN_PASSKEY_ORIGIN must include a host".to_owned())?,
            &config.passkey_rp_id,
        ) {
            return Err("DAOYUN_PASSKEY_ORIGIN host must match DAOYUN_PASSKEY_RP_ID".to_owned());
        }
        Ok(config)
    }

    pub fn with_secure_cookies(mut self, secure_cookies: bool) -> Self {
        self.secure_cookies = secure_cookies;
        self
    }

    pub fn with_attempt_limit(mut self, attempt_limit: u32) -> Self {
        self.attempt_limit = attempt_limit.max(1);
        self
    }

    pub fn with_passkey_rp_id(mut self, value: impl Into<String>) -> Result<Self, String> {
        self.passkey_rp_id = validate_passkey_rp_id(&value.into())?;
        Ok(self)
    }

    pub fn with_passkey_origin(mut self, value: impl Into<String>) -> Result<Self, String> {
        self.passkey_origin = validate_passkey_origin(&value.into())?;
        Ok(self)
    }

    pub fn with_passkey_rp_name(mut self, value: impl Into<String>) -> Result<Self, String> {
        self.passkey_rp_name = validate_passkey_rp_name(&value.into())?;
        Ok(self)
    }

    pub fn with_oidc_provider_json(mut self, value: String) -> Result<Self, String> {
        self.oidc_providers = OidcProviderConfig::parse_json(&value)?;
        Ok(self)
    }
}

#[derive(Clone)]
pub(crate) struct AuthRuntime {
    config: AuthConfig,
    attempts: Arc<Mutex<HashMap<String, AttemptWindow>>>,
    oidc: Option<OidcRuntime>,
}

#[derive(Clone, Copy)]
struct AttemptWindow {
    started_at: Instant,
    attempts: u32,
}

pub(crate) fn runtime(config: AuthConfig) -> AuthRuntime {
    LazyLock::force(&DUMMY_PASSWORD_HASH);
    AuthRuntime {
        config,
        attempts: Arc::new(Mutex::new(HashMap::new())),
        oidc: OidcRuntime::new(),
    }
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/auth/registration-policy", get(registration_policy))
        .route(
            "/api/v1/auth/registration-email-challenges",
            post(request_registration_email_challenge),
        )
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/mfa", get(crate::mfa::status))
        .route(
            "/api/v1/auth/mfa/verify",
            post(crate::mfa::verify_challenge),
        )
        .route("/api/v1/auth/mfa/totp/setup", post(crate::mfa::setup_totp))
        .route(
            "/api/v1/auth/mfa/totp/enable",
            post(crate::mfa::enable_totp),
        )
        .route("/api/v1/auth/mfa/disable", post(crate::mfa::disable))
        .route(
            "/api/v1/auth/mfa/recovery-codes/regenerate",
            post(crate::mfa::regenerate_recovery_codes),
        )
        .route("/api/v1/auth/recent-auth", post(recent_authenticate))
        .route(
            "/api/v1/auth/passkeys/registration/options",
            post(passkey_registration_options),
        )
        .route(
            "/api/v1/auth/passkeys/registration/verify",
            post(passkey_registration_verify),
        )
        .route(
            "/api/v1/auth/passkeys/assertion/options",
            post(passkey_assertion_options),
        )
        .route(
            "/api/v1/auth/passkeys/assertion/verify",
            post(passkey_assertion_verify),
        )
        .route("/api/v1/auth/passkeys", get(list_passkeys))
        .route("/api/v1/auth/passkeys/{passkey_id}", delete(delete_passkey))
        .route("/api/v1/auth/providers", get(list_oidc_providers))
        .route("/api/v1/auth/oidc/claim", get(get_oidc_claim))
        .route(
            "/api/v1/auth/oidc/claim/account",
            post(create_oidc_claim_account),
        )
        .route("/api/v1/auth/oidc/claim/bind", post(bind_oidc_claim))
        .route("/api/v1/auth/identities", get(list_external_identities))
        .route(
            "/api/v1/auth/oidc/{provider}/bindings",
            post(start_oidc_identity_binding),
        )
        .route(
            "/api/v1/auth/oidc/{provider}/bindings/{identity_id}/replacement",
            post(start_oidc_identity_replacement),
        )
        .route(
            "/api/v1/auth/oidc/{provider}/start",
            get(start_oidc_authorization),
        )
        .route(
            "/api/v1/auth/oidc/{provider}/callback",
            get(complete_oidc_authorization),
        )
        .route("/api/v1/auth/password", post(change_password))
        .route("/api/v1/auth/session", get(current_session))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/sessions", get(list_device_sessions))
        .route(
            "/api/v1/auth/sessions/{session_id}",
            delete(revoke_device_session),
        )
        .route(
            "/api/v1/auth/identities/{identity_id}/unlink",
            post(unlink_external_identity),
        )
        .layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT))
        .layer(Extension(runtime))
        .layer(middleware::map_response(disable_auth_caching))
}

async fn disable_auth_caching(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/registration-policy",
    operation_id = "getRegistrationPolicy",
    tag = "auth",
    responses(
        (status = 200, body = ApiResponse<RegistrationPolicy>, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn registration_policy(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<ApiResponse<RegistrationPolicy>>, ApiError> {
    let required = database
        .registration_email_verification_required()
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Registration policy lookup failed");
            service_unavailable(request_id)
        })?;
    Ok(Json(ApiResponse::new(
        RegistrationPolicy {
            email_verification_required: required,
            code_expires_in_seconds: REGISTRATION_CODE_EXPIRES_SECONDS,
            resend_after_seconds: REGISTRATION_CODE_RESEND_SECONDS,
        },
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/registration-email-challenges",
    operation_id = "requestRegistrationEmailChallenge",
    tag = "auth",
    request_body = RegistrationEmailChallengeRequest,
    responses(
        (status = 202, body = ApiResponse<RegistrationEmailChallengeData>, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 429, body = ErrorResponse, headers(("x-request-id" = String), ("retry-after" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn request_registration_email_challenge(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    Extension(email_runtime): Extension<EmailRuntime>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    request: Result<Json<RegistrationEmailChallengeRequest>, JsonRejection>,
) -> Result<
    (
        StatusCode,
        Json<ApiResponse<RegistrationEmailChallengeData>>,
    ),
    ApiError,
> {
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let email = request.email.trim().to_ascii_lowercase();
    if email.chars().count() > 254 || EmailAddress::from_str(&email).is_err() {
        let mut fields = FieldErrors::new();
        add_field_error(&mut fields, "email", "邮箱地址格式不正确");
        return Err(validation_error(request_id, fields));
    }
    if let Some(retry_after) = check_rate_limit(
        &runtime,
        "registration-email",
        &email,
        connect_info.map(|Extension(ConnectInfo(address))| address.ip()),
    ) {
        return Err(rate_limited(request_id, retry_after));
    }
    let required = database
        .registration_email_verification_required()
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Registration email policy lookup failed");
            email_unavailable(request_id)
        })?;
    if !required || !email_runtime.is_enabled() {
        return Err(email_unavailable(request_id));
    }

    let email_registered = database.email_is_registered(&email).await.map_err(|error| {
        tracing::warn!(request_id = %request_id, error = %error, "Registration email identity lookup failed");
        email_unavailable(request_id)
    })?;
    let challenge_id = Uuid::now_v7();
    let code = generate_registration_code();
    let code_hash = hash_password(Zeroizing::new(code.clone()), request_id).await?;
    let code_ciphertext = email_runtime
        .encrypt_registration_code(challenge_id, &code)
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Registration code encryption failed");
            email_unavailable(request_id)
        })?;
    let now = OffsetDateTime::now_utc();
    let expires_at = now + TimeDuration::seconds(i64::from(REGISTRATION_CODE_EXPIRES_SECONDS));
    let challenge = database
        .create_registration_email_challenge(NewRegistrationEmailChallenge {
            id: challenge_id,
            email,
            code_hash,
            code_ciphertext,
            expires_at,
            resend_after: now
                + TimeDuration::seconds(i64::from(REGISTRATION_CODE_RESEND_SECONDS)),
            enqueue_delivery: !email_registered,
        })
        .await
        .map_err(|error| match error {
            RegistrationEmailChallengeError::RateLimited {
                retry_after_seconds,
            } => rate_limited(request_id, Duration::from_secs(retry_after_seconds)),
            other => {
                tracing::warn!(request_id = %request_id, error = %other, "Registration email challenge creation failed");
                email_unavailable(request_id)
            }
        })?;
    Ok((
        StatusCode::ACCEPTED,
        Json(ApiResponse::new(
            RegistrationEmailChallengeData {
                challenge_id: challenge.id,
                expires_at: challenge
                    .expires_at
                    .format(&Rfc3339)
                    .expect("UTC timestamps format as RFC 3339"),
                resend_after_seconds: REGISTRATION_CODE_RESEND_SECONDS,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/register",
    operation_id = "registerUser",
    tag = "auth",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "The user and authenticated session were created", body = ApiResponse<AuthenticatedSession>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 409, description = "The username or email is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The registration fields are invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 429, description = "Too many registration attempts", body = ErrorResponse, headers(("x-request-id" = String), ("retry-after" = String))),
        (status = 503, description = "The identity service is not ready", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn register(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    request: Result<Json<RegisterRequest>, JsonRejection>,
) -> Result<
    (
        StatusCode,
        HeaderMap,
        Json<ApiResponse<AuthenticatedSession>>,
    ),
    ApiError,
> {
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let input =
        validate_registration(request).map_err(|fields| validation_error(request_id, fields))?;

    let is_initialized = database.installation_status().await.map_err(|error| {
        tracing::warn!(request_id = %request_id, error = %error, "Registration preflight failed");
        service_unavailable(request_id)
    })?;
    if !is_initialized {
        return Err(not_ready(request_id));
    }
    if let Some(retry_after) = check_rate_limit(
        &runtime,
        "register",
        &input.username,
        connect_info.map(|Extension(ConnectInfo(address))| address.ip()),
    ) {
        return Err(rate_limited(request_id, retry_after));
    }

    let ValidatedRegistration {
        username,
        email,
        display_name,
        password,
        email_challenge_id,
        email_verification_code,
    } = input;
    let verification_required = database
        .registration_email_verification_required()
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Registration email policy lookup failed");
            service_unavailable(request_id)
        })?;
    let verified_challenge_id = if verification_required {
        let (Some(challenge_id), Some(code)) = (email_challenge_id, email_verification_code) else {
            return Err(email_verification_invalid(request_id));
        };
        let challenge = database
            .get_registration_email_challenge(challenge_id)
            .await
            .map_err(|error| {
                tracing::warn!(request_id = %request_id, error = %error, "Registration email challenge lookup failed");
                service_unavailable(request_id)
            })?
            .ok_or_else(|| email_verification_invalid(request_id))?;
        let challenge_valid = challenge.email == email
            && challenge.delivered_at.is_some()
            && challenge.consumed_at.is_none()
            && challenge.attempts < 5
            && challenge.expires_at > OffsetDateTime::now_utc();
        let code_valid = if challenge_valid {
            verify_password(code, challenge.code_hash, request_id).await?
        } else {
            false
        };
        if !code_valid {
            if challenge_valid {
                let _ = database
                    .record_registration_email_challenge_failure(challenge_id, &email)
                    .await;
            }
            return Err(email_verification_invalid(request_id));
        }
        Some(challenge_id)
    } else {
        None
    };
    let password_hash = hash_password(password, request_id).await?;
    let user = AuthenticatedUser {
        id: Uuid::now_v7(),
        username,
        email,
        display_name,
    };

    let record = NewUserRecord {
        id: user.id,
        username: user.username.clone(),
        email: user.email.clone(),
        display_name: user.display_name.clone(),
        password_hash,
    };
    let secrets = new_session_secrets();
    let session = NewSessionRecord {
        id: Uuid::now_v7(),
        token_hash: token_hash(&secrets.session_token),
        csrf_token_hash: token_hash(&secrets.csrf_token),
        device_label: device_label(&headers),
    };
    let registration = if let Some(challenge_id) = verified_challenge_id {
        database
            .register_user_with_session_and_email_challenge(
                record,
                session,
                challenge_id,
                user.email.clone(),
            )
            .await
    } else {
        database.register_user_with_session(record, session).await
    };
    match registration {
        Ok(()) => {}
        Err(RegisterUserError::NotInitialized) => return Err(not_ready(request_id)),
        Err(RegisterUserError::IdentityUnavailable) => {
            return Err(identity_unavailable(request_id));
        }
        Err(RegisterUserError::EmailVerificationInvalid) => {
            return Err(email_verification_invalid(request_id));
        }
        Err(RegisterUserError::Database(error)) => {
            tracing::warn!(request_id = %request_id, error = %error, "Registration transaction failed");
            return Err(service_unavailable(request_id));
        }
    }
    let headers = session_cookie_headers(&runtime, &secrets);
    Ok((
        StatusCode::CREATED,
        headers,
        Json(ApiResponse::new(
            AuthenticatedSession {
                user,
                csrf_token: secrets.csrf_token,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    operation_id = "loginUser",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "The credentials were accepted and a session was created", body = ApiResponse<AuthenticatedSession>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 202, description = "The credentials were accepted and MFA verification is required", body = ApiResponse<api_contract::MfaChallengeData>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 401, description = "The credentials are invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The login fields are invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 429, description = "Too many login attempts", body = ErrorResponse, headers(("x-request-id" = String), ("retry-after" = String))),
        (status = 503, description = "The identity service is not ready", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn login(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    request: Result<Json<LoginRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let (identifier, password) =
        validate_login(request).map_err(|fields| validation_error(request_id, fields))?;
    let is_initialized = database.installation_status().await.map_err(|error| {
        tracing::warn!(request_id = %request_id, error = %error, "Login preflight failed");
        service_unavailable(request_id)
    })?;
    if !is_initialized {
        return Err(not_ready(request_id));
    }
    let client_ip = connect_info
        .as_ref()
        .map(|Extension(ConnectInfo(address))| address.ip());
    if let Some(retry_after) = check_rate_limit(&runtime, "login", &identifier, client_ip) {
        return Err(rate_limited(request_id, retry_after));
    }

    let record = database.find_login_user(&identifier).await.map_err(|error| {
        tracing::warn!(request_id = %request_id, error = %error, "Login identity lookup failed");
        service_unavailable(request_id)
    })?;
    let password_hash = record.as_ref().map_or_else(
        || DUMMY_PASSWORD_HASH.clone(),
        |record| record.password_hash.clone(),
    );
    let password_matches = verify_password(password, password_hash, request_id).await?;
    if !password_matches || !record.as_ref().is_some_and(|record| record.is_active) {
        record_security_audit(
            &database,
            record.as_ref().map(|record| record.id),
            None,
            "auth.login.failed",
            json!({"method": "password"}),
            request_id,
        )
        .await;
        return Err(invalid_credentials(request_id));
    }
    let record = record.expect("a valid password can only belong to a loaded user");
    let user = AuthenticatedUser {
        id: record.id,
        username: record.username,
        email: record.email,
        display_name: record.display_name,
    };
    let mfa_status = database.get_mfa_status(user.id).await.map_err(|error| {
        tracing::warn!(request_id = %request_id, error = %error, "MFA login status lookup failed");
        service_unavailable(request_id)
    })?;
    if mfa_status.enabled {
        let challenge_id = Uuid::now_v7();
        let browser_token = random_token();
        let expires_at = OffsetDateTime::now_utc() + time::Duration::minutes(5);
        database
            .create_mfa_challenge(infrastructure::NewMfaChallengeRecord {
                id: challenge_id,
                user_id: user.id,
                device_label: device_label(&headers),
                browser_token_hash: token_hash(&browser_token),
                expires_at,
            })
            .await
            .map_err(|error| {
                tracing::warn!(request_id = %request_id, error = %error, "MFA login challenge creation failed");
                service_unavailable(request_id)
            })?;
        release_rate_limit(&runtime, "login", &identifier, client_ip);
        record_security_audit(
            &database,
            Some(user.id),
            None,
            "auth.login.mfa_challenge",
            json!({"method": "password"}),
            request_id,
        )
        .await;
        let expires_at = expires_at
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|_| internal_error(request_id))?;
        return Ok((
            StatusCode::ACCEPTED,
            crate::mfa::challenge_cookie_header(&runtime, &browser_token),
            Json(ApiResponse::new(
                api_contract::MfaChallengeData {
                    challenge_id,
                    expires_at,
                },
                request_id,
            )),
        )
            .into_response());
    }
    let secrets = create_session(&database, user.id, device_label(&headers), request_id).await?;
    release_rate_limit(&runtime, "login", &identifier, client_ip);
    record_security_audit(
        &database,
        Some(user.id),
        Some(secrets.session_id),
        "auth.login.succeeded",
        json!({"method": "password"}),
        request_id,
    )
    .await;
    Ok((
        session_cookie_headers(&runtime, &secrets),
        Json(ApiResponse::new(
            AuthenticatedSession {
                user,
                csrf_token: secrets.csrf_token,
            },
            request_id,
        )),
    )
        .into_response())
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/recent-auth",
    operation_id = "createRecentAuthentication",
    tag = "auth",
    request_body = RecentAuthRequest,
    responses(
        (status = 200, description = "A recent authentication was established for the current operation", body = ApiResponse<RecentAuthData>, headers(("x-request-id" = String))),
        (status = 401, description = "The password is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, description = "The session or CSRF token is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The recent authentication request is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 429, description = "Too many recent authentication attempts", body = ErrorResponse, headers(("x-request-id" = String), ("retry-after" = String))),
        (status = 503, description = "The identity service is not ready", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn recent_authenticate(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    request: Result<Json<RecentAuthRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<RecentAuthData>>), ApiError> {
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let (operation, password) =
        validate_recent_auth(request).map_err(|fields| validation_error(request_id, fields))?;
    let current = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let recent_auth_identifier = current.user.id.to_string();
    let client_ip = connect_info
        .as_ref()
        .map(|Extension(ConnectInfo(address))| address.ip());
    if let Some(retry_after) =
        check_rate_limit(&runtime, "recent-auth", &recent_auth_identifier, client_ip)
    {
        return Err(rate_limited(request_id, retry_after));
    }
    let password_hash = database
        .find_password_hash(current.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Recent authentication credential lookup failed");
            service_unavailable(request_id)
        })?;
    let Some(password_hash) = password_hash else {
        record_security_audit(
            &database,
            Some(current.user.id),
            Some(current.id),
            "auth.recent.failed",
            json!({"method": "password", "operation": operation}),
            request_id,
        )
        .await;
        return Err(invalid_credentials(request_id));
    };
    let password_matches = verify_password(password, password_hash, request_id).await?;
    if !password_matches {
        record_security_audit(
            &database,
            Some(current.user.id),
            Some(current.id),
            "auth.recent.failed",
            json!({"method": "password", "operation": operation}),
            request_id,
        )
        .await;
        return Err(invalid_credentials(request_id));
    }
    let recent = database
        .create_recent_authentication(current.user.id, current.id, &operation, "password")
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Recent authentication creation failed");
            service_unavailable(request_id)
        })?;
    let expires_at =
        format_timestamp(recent.expires_at).map_err(|()| internal_error(request_id))?;
    release_rate_limit(&runtime, "recent-auth", &recent_auth_identifier, client_ip);
    record_security_audit(
        &database,
        Some(current.user.id),
        Some(current.id),
        "auth.recent.succeeded",
        json!({"method": "password", "operation": operation}),
        request_id,
    )
    .await;
    Ok((
        HeaderMap::new(),
        Json(ApiResponse::new(
            RecentAuthData {
                authenticated: true,
                expires_at,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/passkeys/registration/options",
    operation_id = "startPasskeyRegistration",
    tag = "auth",
    responses(
        (status = 200, description = "The challenge for registering a discoverable passkey", body = ApiResponse<PasskeyRegistrationOptionsData>, headers(("x-request-id" = String))),
        (status = 401, description = "The current session is missing or expired", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 403, description = "A recent password re-authentication is required", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The identity service or passkey configuration is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn passkey_registration_options(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<PasskeyRegistrationOptionsData>>, ApiError> {
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let has_recent_authentication = database
        .has_recent_authentication(session.user.id, session.id, "security.settings")
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey recent-auth lookup failed");
            service_unavailable(request_id)
        })?;
    if !has_recent_authentication {
        return Err(recent_authentication_required(request_id));
    }
    let webauthn = passkey_webauthn(&runtime, request_id)?;
    let existing_credentials = database
        .list_passkey_credential_ids(session.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey credential listing failed");
            service_unavailable(request_id)
        })?
        .into_iter()
        .map(CredentialId)
        .collect::<Vec<_>>();
    let (options, state) = webauthn.start_registration(
        session.user.id.as_bytes(),
        &session.user.username,
        &session.user.display_name,
        &existing_credentials,
    );
    let challenge_id = Uuid::now_v7();
    let state = serde_json::to_value(state).map_err(|error| {
        tracing::error!(request_id = %request_id, error = ?error, "Passkey registration state serialization failed");
        internal_error(request_id)
    })?;
    database
        .create_passkey_challenge(NewPasskeyChallengeRecord {
            id: challenge_id,
            user_id: Some(session.user.id),
            session_id: Some(session.id),
            kind: PasskeyChallengeKind::Registration,
            state,
        })
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey registration challenge creation failed");
            service_unavailable(request_id)
        })?;
    Ok(Json(ApiResponse::new(
        PasskeyRegistrationOptionsData {
            challenge_id,
            options: registration_options_from_challenge(options),
        },
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/passkeys/registration/verify",
    operation_id = "verifyPasskeyRegistration",
    tag = "auth",
    request_body = PasskeyRegistrationVerifyRequest,
    responses(
        (status = 201, description = "The passkey was registered and the CSRF token was rotated", body = ApiResponse<api_contract::PasskeyRegistrationData>, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 401, description = "The current session is missing or expired", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 403, description = "The CSRF token, recent authentication, or passkey ceremony is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The passkey response is malformed", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The passkey store is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn passkey_registration_verify(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<PasskeyRegistrationVerifyRequest>, JsonRejection>,
) -> Result<
    (
        StatusCode,
        HeaderMap,
        Json<ApiResponse<api_contract::PasskeyRegistrationData>>,
    ),
    ApiError,
> {
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let state = database
        .consume_passkey_challenge(
            request.challenge_id,
            Some(session.user.id),
            Some(session.id),
            PasskeyChallengeKind::Registration,
        )
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey registration challenge lookup failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| passkey_failed(request_id))?;
    let state = serde_json::from_value::<passkey_auth::RegistrationState>(state)
        .map_err(|_| passkey_failed(request_id))?;
    let response = RegistrationResponse {
        id: request.id,
        transports: request.transports,
        attestation_object: request.attestation_object,
        client_data_json: request.client_data_json,
    };
    let webauthn = passkey_webauthn(&runtime, request_id)?;
    let credential = webauthn
        .finish_registration(&state, &response)
        .map_err(|error| {
            tracing::info!(request_id = %request_id, error = ?error, "Passkey registration verification failed");
            passkey_failed(request_id)
        })?;
    let response_credential_id =
        CredentialId::from_b64url(&response.id).map_err(|_| passkey_failed(request_id))?;
    if response_credential_id != credential.id {
        return Err(passkey_failed(request_id));
    }
    let credential_json = serde_json::to_value(&credential).map_err(|error| {
        tracing::error!(request_id = %request_id, error = ?error, "Passkey credential serialization failed");
        internal_error(request_id)
    })?;
    let csrf_token = random_token();
    let passkey_id = Uuid::now_v7();
    database
        .register_passkey_with_recent_auth(
            session.user.id,
            session.id,
            infrastructure::NewPasskeyCredentialRecord {
                id: passkey_id,
                user_id: session.user.id,
                credential_id: credential.id.as_bytes().to_vec(),
                credential: credential_json,
            },
            token_hash(&csrf_token),
        )
        .await
        .map_err(|error| match error {
            RegisterPasskeyError::RecentAuthenticationRequired => {
                recent_authentication_required(request_id)
            }
            RegisterPasskeyError::CredentialUnavailable => passkey_failed(request_id),
            RegisterPasskeyError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Passkey registration transaction failed");
                service_unavailable(request_id)
            }
        })?;
    let response_headers = csrf_cookie_header(&runtime, &csrf_token);
    Ok((
        StatusCode::CREATED,
        response_headers,
        Json(ApiResponse::new(
            api_contract::PasskeyRegistrationData {
                credential: PasskeyCredentialSummary {
                    id: passkey_id,
                    created_at: format_timestamp(OffsetDateTime::now_utc())
                        .map_err(|()| internal_error(request_id))?,
                    last_used_at: None,
                },
                csrf_token,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/passkeys/assertion/options",
    operation_id = "startPasskeyAssertion",
    tag = "auth",
    responses(
        (status = 200, description = "The challenge for passwordless passkey sign-in", body = ApiResponse<PasskeyAssertionOptionsData>, headers(("x-request-id" = String))),
        (status = 429, description = "Too many passkey authentication attempts", body = ErrorResponse, headers(("retry-after" = String), ("x-request-id" = String))),
        (status = 503, description = "The identity service or passkey configuration is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn passkey_assertion_options(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
) -> Result<Json<ApiResponse<PasskeyAssertionOptionsData>>, ApiError> {
    if let Some(retry_after) = check_ip_rate_limit(
        &runtime,
        "passkey-assertion-options",
        connect_info.map(|Extension(ConnectInfo(address))| address.ip()),
    ) {
        return Err(rate_limited(request_id, retry_after));
    }
    let webauthn = passkey_webauthn(&runtime, request_id)?;
    let (options, state) = webauthn.start_authentication(&[]);
    let challenge_id = Uuid::now_v7();
    let state = serde_json::to_value(state).map_err(|error| {
        tracing::error!(request_id = %request_id, error = ?error, "Passkey assertion state serialization failed");
        internal_error(request_id)
    })?;
    database
        .create_passkey_challenge(NewPasskeyChallengeRecord {
            id: challenge_id,
            user_id: None,
            session_id: None,
            kind: PasskeyChallengeKind::Assertion,
            state,
        })
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey assertion challenge creation failed");
            service_unavailable(request_id)
        })?;
    Ok(Json(ApiResponse::new(
        PasskeyAssertionOptionsData {
            challenge_id,
            options: assertion_options_from_challenge(options),
        },
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/passkeys/assertion/verify",
    operation_id = "verifyPasskeyAssertion",
    tag = "auth",
    request_body = PasskeyAssertionVerifyRequest,
    responses(
        (status = 200, description = "The passkey assertion was accepted and a session was created", body = ApiResponse<AuthenticatedSession>, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 202, description = "The passkey assertion was accepted and MFA verification is required", body = ApiResponse<api_contract::MfaChallengeData>, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 403, description = "The passkey assertion was not accepted", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The passkey response is malformed", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 429, description = "Too many passkey authentication attempts", body = ErrorResponse, headers(("retry-after" = String), ("x-request-id" = String))),
        (status = 503, description = "The passkey store is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn passkey_assertion_verify(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    request: Result<Json<PasskeyAssertionVerifyRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    if let Some(retry_after) = check_ip_rate_limit(
        &runtime,
        "passkey-assertion-verify",
        connect_info.map(|Extension(ConnectInfo(address))| address.ip()),
    ) {
        return Err(rate_limited(request_id, retry_after));
    }
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let state = database
        .consume_passkey_challenge(
            request.challenge_id,
            None,
            None,
            PasskeyChallengeKind::Assertion,
        )
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey assertion challenge lookup failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| passkey_failed(request_id))?;
    let state = serde_json::from_value::<passkey_auth::AuthenticationState>(state)
        .map_err(|_| passkey_failed(request_id))?;
    let credential_id =
        CredentialId::from_b64url(&request.id).map_err(|_| passkey_failed(request_id))?;
    let stored = database
        .find_passkey_credential(credential_id.as_bytes())
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey credential lookup failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| passkey_failed(request_id))?;
    let credential = serde_json::from_value::<PasskeyCredential>(stored.credential)
        .map_err(|_| passkey_failed(request_id))?;
    if credential.id != credential_id {
        return Err(passkey_failed(request_id));
    }
    let user_handle = request
        .user_handle
        .as_deref()
        .and_then(|value| CredentialId::from_b64url(value).ok())
        .ok_or_else(|| passkey_failed(request_id))?;
    if user_handle.as_bytes() != stored.user_id.as_bytes() {
        return Err(passkey_failed(request_id));
    }
    let response = AuthenticationResponse {
        id: request.id,
        authenticator_data: request.authenticator_data,
        signature: request.signature,
        client_data_json: request.client_data_json,
        user_handle: request.user_handle,
    };
    let webauthn = passkey_webauthn(&runtime, request_id)?;
    let success = webauthn
        .finish_authentication(&state, &response, &credential)
        .map_err(|error| {
            tracing::info!(request_id = %request_id, error = ?error, "Passkey assertion verification failed");
            passkey_failed(request_id)
        })?;
    let updated = database
        .update_passkey_counter(
            credential_id.as_bytes(),
            credential.counter,
            success.new_counter,
        )
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey counter update failed");
            service_unavailable(request_id)
        })?;
    if !updated {
        return Err(passkey_failed(request_id));
    }
    let user = database
        .find_passkey_user(stored.user_id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey user lookup failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| passkey_failed(request_id))?;
    let mfa_status = database.get_mfa_status(user.id).await.map_err(|error| {
        tracing::warn!(request_id = %request_id, error = %error, "MFA passkey status lookup failed");
        service_unavailable(request_id)
    })?;
    if mfa_status.enabled {
        let challenge_id = Uuid::now_v7();
        let browser_token = random_token();
        let expires_at = OffsetDateTime::now_utc() + time::Duration::minutes(5);
        database
            .create_mfa_challenge(NewMfaChallengeRecord {
                id: challenge_id,
                user_id: user.id,
                device_label: device_label(&headers),
                browser_token_hash: token_hash(&browser_token),
                expires_at,
            })
            .await
            .map_err(|error| {
                tracing::warn!(request_id = %request_id, error = %error, "MFA passkey challenge creation failed");
                service_unavailable(request_id)
            })?;
        let expires_at = expires_at
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|_| internal_error(request_id))?;
        return Ok((
            StatusCode::ACCEPTED,
            crate::mfa::challenge_cookie_header(&runtime, &browser_token),
            Json(ApiResponse::new(
                api_contract::MfaChallengeData {
                    challenge_id,
                    expires_at,
                },
                request_id,
            )),
        )
            .into_response());
    }
    let secrets = create_session(&database, user.id, device_label(&headers), request_id).await?;
    record_security_audit(
        &database,
        Some(user.id),
        Some(secrets.session_id),
        "auth.login.succeeded",
        json!({"method": "passkey"}),
        request_id,
    )
    .await;
    Ok((
        session_cookie_headers(&runtime, &secrets),
        Json(ApiResponse::new(
            AuthenticatedSession {
                user: AuthenticatedUser {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    display_name: user.display_name,
                },
                csrf_token: secrets.csrf_token,
            },
            request_id,
        )),
    )
        .into_response())
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/passkeys",
    operation_id = "listPasskeys",
    tag = "auth",
    responses(
        (status = 200, description = "The current user's registered passkeys", body = ApiResponse<Vec<PasskeyCredentialSummary>>, headers(("x-request-id" = String))),
        (status = 401, description = "The current session is missing or expired", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 503, description = "The passkey store is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_passkeys(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<Vec<PasskeyCredentialSummary>>>), ApiError> {
    let (current, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let passkeys = database
        .list_passkey_credentials(current.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Passkey list failed");
            service_unavailable(request_id)
        })?
        .into_iter()
        .map(|record| {
            Ok(PasskeyCredentialSummary {
                id: record.id,
                created_at: format_timestamp(record.created_at)?,
                last_used_at: record.last_used_at.map(format_timestamp).transpose()?,
            })
        })
        .collect::<Result<Vec<_>, ()>>()
        .map_err(|()| internal_error(request_id))?;
    Ok((
        HeaderMap::new(),
        Json(ApiResponse::new(passkeys, request_id)),
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v1/auth/passkeys/{passkey_id}",
    operation_id = "deletePasskey",
    tag = "auth",
    params(("passkey_id" = Uuid, Path, description = "The passkey record to delete")),
    responses(
        (status = 200, description = "The passkey was deleted", body = ApiResponse<PasskeyDeleteData>, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 401, description = "The current session is missing or expired", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 403, description = "The CSRF token or recent authentication is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The passkey is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The passkey identifier is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The passkey store is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn delete_passkey(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    Path(passkey_id): Path<String>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<PasskeyDeleteData>>), ApiError> {
    let passkey_id = Uuid::parse_str(&passkey_id).map_err(|_| passkey_id_invalid(request_id))?;
    let current = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let csrf_token = random_token();
    database
        .delete_passkey_with_recent_auth(
            current.user.id,
            current.id,
            passkey_id,
            token_hash(&csrf_token),
        )
        .await
        .map_err(|error| match error {
            DeletePasskeyError::RecentAuthenticationRequired => {
                recent_authentication_required(request_id)
            }
            DeletePasskeyError::NotFound => passkey_not_found(request_id),
            DeletePasskeyError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Passkey deletion failed");
                service_unavailable(request_id)
            }
        })?;
    let response_headers = csrf_cookie_header(&runtime, &csrf_token);
    Ok((
        response_headers,
        Json(ApiResponse::new(
            PasskeyDeleteData {
                deleted: true,
                csrf_token,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/providers",
    operation_id = "listOidcProviders",
    tag = "auth",
    responses(
        (status = 200, description = "The configured public OIDC provider metadata", body = ApiResponse<Vec<OidcProvider>>, headers(("x-request-id" = String))),
        (status = 503, description = "The identity service configuration is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_oidc_providers(
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
) -> Result<(HeaderMap, Json<ApiResponse<Vec<OidcProvider>>>), ApiError> {
    let providers = runtime
        .config
        .oidc_providers
        .iter()
        .map(|provider| OidcProvider {
            provider_key: provider.provider_key().to_owned(),
            display_name: provider.display_name().to_owned(),
        })
        .collect();
    Ok((
        HeaderMap::new(),
        Json(ApiResponse::new(providers, request_id)),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/oidc/claim",
    operation_id = "getOidcClaim",
    tag = "auth",
    responses(
        (status = 200, description = "The short-lived verified OIDC claim", body = ApiResponse<OidcClaimData>, headers(("x-request-id" = String))),
        (status = 400, description = "The OIDC claim is missing or expired", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String)))
    )
)]
pub(crate) async fn get_oidc_claim(
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<OidcClaimData>>), ApiError> {
    let token = cookie_value(&headers, runtime.oidc_claim_cookie_name())
        .filter(|value| valid_token(value))
        .ok_or_else(|| oidc_claim_required(&runtime, request_id))?;
    let oidc = runtime
        .oidc
        .as_ref()
        .ok_or_else(|| oidc_claim_required(&runtime, request_id))?;
    let claim = oidc
        .peek_claim(token)
        .ok_or_else(|| oidc_claim_required(&runtime, request_id))?;
    Ok((
        HeaderMap::new(),
        Json(ApiResponse::new(oidc_claim_data(&claim), request_id)),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/oidc/claim/account",
    operation_id = "createOidcClaimAccount",
    tag = "auth",
    request_body = OidcClaimAccountRequest,
    responses(
        (status = 201, description = "A new account was created and the OIDC identity was linked", body = ApiResponse<AuthenticatedSession>, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 400, description = "The OIDC claim is missing or expired", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 409, description = "The account or external identity is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The account fields are invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 429, description = "Too many account creation attempts", body = ErrorResponse, headers(("retry-after" = String), ("x-request-id" = String))),
        (status = 503, description = "The identity service is not ready", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn create_oidc_claim_account(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    request: Result<Json<OidcClaimAccountRequest>, JsonRejection>,
) -> Result<
    (
        StatusCode,
        HeaderMap,
        Json<ApiResponse<AuthenticatedSession>>,
    ),
    ApiError,
> {
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let input = validate_registration(RegisterRequest {
        username: request.username,
        email: request.email,
        display_name: request.display_name,
        password: request.password,
        email_challenge_id: None,
        email_verification_code: None,
    })
    .map_err(|fields| validation_error(request_id, fields))?;
    let token = cookie_value(&headers, runtime.oidc_claim_cookie_name())
        .filter(|value| valid_token(value))
        .ok_or_else(|| oidc_claim_required(&runtime, request_id))?;
    let claim = runtime
        .oidc
        .as_ref()
        .and_then(|oidc| oidc.peek_claim(token))
        .ok_or_else(|| oidc_claim_required(&runtime, request_id))?;
    if let Some(retry_after) = check_rate_limit(
        &runtime,
        "oidc-claim-account",
        claim.provider_key(),
        connect_info.map(|Extension(ConnectInfo(address))| address.ip()),
    ) {
        return Err(rate_limited(request_id, retry_after));
    }
    let password_hash = hash_password(input.password, request_id).await?;
    let user = AuthenticatedUser {
        id: Uuid::now_v7(),
        username: input.username,
        email: input.email,
        display_name: input.display_name,
    };
    let secrets = new_session_secrets();
    let identity = NewExternalIdentityRecord {
        id: Uuid::now_v7(),
        user_id: user.id,
        provider_key: claim.provider_key().to_owned(),
        subject: claim.subject().to_owned(),
        issuer: claim.issuer().to_owned(),
        email_snapshot: claim.email_snapshot().map(str::to_owned),
        email_verified: claim.email_verified(),
    };
    match database
        .register_user_with_session_and_external_identity(
            NewUserRecord {
                id: user.id,
                username: user.username.clone(),
                email: user.email.clone(),
                display_name: user.display_name.clone(),
                password_hash,
            },
            NewSessionRecord {
                id: secrets.session_id,
                token_hash: token_hash(&secrets.session_token),
                csrf_token_hash: token_hash(&secrets.csrf_token),
                device_label: device_label(&headers),
            },
            identity,
        )
        .await
    {
        Ok(()) => {}
        Err(RegisterUserError::NotInitialized) => return Err(not_ready(request_id)),
        Err(RegisterUserError::IdentityUnavailable) => {
            return Err(identity_unavailable(request_id));
        }
        Err(RegisterUserError::EmailVerificationInvalid) => {
            return Err(service_unavailable(request_id));
        }
        Err(RegisterUserError::Database(error)) => {
            tracing::warn!(request_id = %request_id, error = %error, "OIDC claim account transaction failed");
            return Err(service_unavailable(request_id));
        }
    }
    runtime
        .oidc
        .as_ref()
        .and_then(|oidc| oidc.consume_claim(token));
    let mut response_headers = session_cookie_headers(&runtime, &secrets);
    append_set_cookie(
        &mut response_headers,
        clear_oidc_claim_cookie_value(&runtime),
    );
    Ok((
        StatusCode::CREATED,
        response_headers,
        Json(ApiResponse::new(
            AuthenticatedSession {
                user,
                csrf_token: secrets.csrf_token,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/oidc/claim/bind",
    operation_id = "bindOidcClaim",
    tag = "auth",
    responses(
        (status = 200, description = "The verified OIDC identity was bound to the current account", body = ApiResponse<OidcClaimBindData>, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 400, description = "The OIDC claim is missing or expired", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 403, description = "The CSRF token or recent authentication is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The external identity is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The identity service is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn bind_oidc_claim(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<OidcClaimBindData>>), ApiError> {
    let current = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let token = cookie_value(&headers, runtime.oidc_claim_cookie_name())
        .filter(|value| valid_token(value))
        .ok_or_else(|| oidc_claim_required(&runtime, request_id))?;
    let claim = runtime
        .oidc
        .as_ref()
        .and_then(|oidc| oidc.peek_claim(token))
        .ok_or_else(|| oidc_claim_required(&runtime, request_id))?;
    let csrf_token = random_token();
    let identity = NewExternalIdentityRecord {
        id: Uuid::now_v7(),
        user_id: current.user.id,
        provider_key: claim.provider_key().to_owned(),
        subject: claim.subject().to_owned(),
        issuer: claim.issuer().to_owned(),
        email_snapshot: claim.email_snapshot().map(str::to_owned),
        email_verified: claim.email_verified(),
    };
    match database
        .bind_external_identity(
            current.user.id,
            current.id,
            None,
            identity,
            token_hash(&csrf_token),
        )
        .await
    {
        Ok(()) => {}
        Err(BindExternalIdentityError::RecentAuthenticationRequired) => {
            return Err(recent_authentication_required(request_id));
        }
        Err(BindExternalIdentityError::IdentityUnavailable) => {
            return Err(identity_unavailable(request_id));
        }
        Err(
            BindExternalIdentityError::IdentityNotFound | BindExternalIdentityError::InvalidInput,
        ) => {
            return Err(oidc_claim_required(&runtime, request_id));
        }
        Err(BindExternalIdentityError::Database(error)) => {
            tracing::warn!(request_id = %request_id, error = %error, "OIDC claim binding transaction failed");
            return Err(service_unavailable(request_id));
        }
    }
    runtime
        .oidc
        .as_ref()
        .and_then(|oidc| oidc.consume_claim(token));
    let mut response_headers = csrf_cookie_header(&runtime, &csrf_token);
    append_set_cookie(
        &mut response_headers,
        clear_oidc_claim_cookie_value(&runtime),
    );
    Ok((
        response_headers,
        Json(ApiResponse::new(
            OidcClaimBindData {
                bound: true,
                csrf_token,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/identities",
    operation_id = "listExternalIdentities",
    tag = "auth",
    responses(
        (status = 200, description = "The external identities bound to the authenticated user", body = ApiResponse<Vec<ExternalIdentity>>, headers(("x-request-id" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 503, description = "The identity service is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_external_identities(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<Vec<ExternalIdentity>>>), ApiError> {
    let (current, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let identities = database
        .list_external_identities(current.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "External identity list failed");
            service_unavailable(request_id)
        })?
        .into_iter()
        .map(external_identity)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| internal_error(request_id))?;
    Ok((
        HeaderMap::new(),
        Json(ApiResponse::new(identities, request_id)),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/oidc/{provider}/bindings",
    operation_id = "startOidcIdentityBinding",
    tag = "auth",
    params(("provider" = String, Path, description = "Configured provider key")),
    responses(
        (status = 200, description = "A protected external identity binding authorization was created", body = ApiResponse<OidcAuthorizationStartData>, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token or recent authentication is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The provider is not configured", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 429, description = "Too many OIDC binding authorization starts", body = ErrorResponse, headers(("retry-after" = String), ("x-request-id" = String))),
        (status = 503, description = "The OIDC provider or identity service is unavailable", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String)))
    )
)]
pub(crate) async fn start_oidc_identity_binding(
    State(database): State<Database>,
    Path(provider_key): Path<String>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
) -> Result<(HeaderMap, Json<ApiResponse<OidcAuthorizationStartData>>), ApiError> {
    start_oidc_identity_binding_transaction(
        &database,
        &runtime,
        request_id,
        provider_key,
        None,
        headers,
        connect_info,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/oidc/{provider}/bindings/{identity_id}/replacement",
    operation_id = "startOidcIdentityReplacement",
    tag = "auth",
    params(
        ("provider" = String, Path, description = "Configured provider key"),
        ("identity_id" = Uuid, Path, description = "The current user's external identity to replace")
    ),
    responses(
        (status = 200, description = "A protected external identity replacement authorization was created", body = ApiResponse<OidcAuthorizationStartData>, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token or recent authentication is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The provider or external identity is unavailable", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 422, description = "The external identity identifier is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 429, description = "Too many OIDC binding authorization starts", body = ErrorResponse, headers(("retry-after" = String), ("x-request-id" = String))),
        (status = 503, description = "The OIDC provider or identity service is unavailable", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String)))
    )
)]
pub(crate) async fn start_oidc_identity_replacement(
    State(database): State<Database>,
    Path((provider_key, identity_id)): Path<(String, String)>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
) -> Result<(HeaderMap, Json<ApiResponse<OidcAuthorizationStartData>>), ApiError> {
    let identity_id = Uuid::parse_str(&identity_id).map_err(|_| identity_id_invalid(request_id))?;
    start_oidc_identity_binding_transaction(
        &database,
        &runtime,
        request_id,
        provider_key,
        Some(identity_id),
        headers,
        connect_info,
    )
    .await
}

async fn start_oidc_identity_binding_transaction(
    database: &Database,
    runtime: &AuthRuntime,
    request_id: RequestId,
    provider_key: String,
    replacement_identity_id: Option<Uuid>,
    headers: HeaderMap,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
) -> Result<(HeaderMap, Json<ApiResponse<OidcAuthorizationStartData>>), ApiError> {
    let provider = oidc_provider(runtime, &provider_key)
        .ok_or_else(|| oidc_provider_not_found(runtime, request_id))?;
    let current = authenticate_state_change(database, runtime, &headers, request_id).await?;
    let has_recent_authentication = database
        .has_recent_authentication(current.user.id, current.id, "security.settings")
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Recent authentication lookup failed");
            service_unavailable(request_id)
        })?;
    if !has_recent_authentication {
        return Err(recent_authentication_required(request_id));
    }
    if let Some(identity_id) = replacement_identity_id {
        let is_owned = database
            .external_identity_belongs_to_user(current.user.id, identity_id)
            .await
            .map_err(|error| {
                tracing::warn!(request_id = %request_id, error = %error, "External identity ownership lookup failed");
                service_unavailable(request_id)
            })?;
        if !is_owned {
            return Err(identity_not_found(request_id));
        }
    }
    if let Some(retry_after) = check_ip_rate_limit(
        runtime,
        "oidc-binding-start",
        connect_info.map(|Extension(ConnectInfo(address))| address.ip()),
    ) {
        return Err(rate_limited(request_id, retry_after));
    }
    let oidc = runtime
        .oidc
        .as_ref()
        .ok_or_else(|| oidc_failed(runtime, request_id, StatusCode::SERVICE_UNAVAILABLE))?;
    let start = oidc
        .start_identity_binding(
            provider,
            OidcIdentityBinding {
                user_id: current.user.id,
                session_id: current.id,
                replacement_identity_id,
            },
        )
        .await
        .map_err(|error| {
            tracing::warn!(
                request_id = %request_id,
                provider = provider.provider_key(),
                error = ?error,
                "OIDC identity binding authorization start failed"
            );
            oidc_failed(runtime, request_id, StatusCode::SERVICE_UNAVAILABLE)
        })?;
    let mut response_headers = HeaderMap::new();
    append_set_cookie(
        &mut response_headers,
        format!(
            "{}={}; Path=/; Max-Age={OIDC_TRANSACTION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax{}",
            runtime.oidc_cookie_name(),
            start.browser_binding(),
            runtime.secure_attribute()
        ),
    );
    Ok((
        response_headers,
        Json(ApiResponse::new(
            OidcAuthorizationStartData {
                authorization_url: start.authorization_url().as_str().to_owned(),
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/oidc/{provider}/start",
    operation_id = "startOidcAuthorization",
    tag = "auth",
    params(("provider" = String, Path, description = "Configured provider key")),
    responses(
        (status = 302, description = "Authorization starts at the configured provider", headers(("location" = String), ("set-cookie" = String), ("x-request-id" = String))),
        (status = 404, description = "The provider is not configured", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 429, description = "Too many OIDC authorization starts", body = ErrorResponse, headers(("retry-after" = String), ("x-request-id" = String))),
        (status = 503, description = "The OIDC provider is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn start_oidc_authorization(
    Path(provider_key): Path<String>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
) -> Result<Response, ApiError> {
    let provider = oidc_provider(&runtime, &provider_key)
        .ok_or_else(|| oidc_provider_not_found(&runtime, request_id))?;
    if let Some(retry_after) = check_ip_rate_limit(
        &runtime,
        "oidc-start",
        connect_info.map(|Extension(ConnectInfo(address))| address.ip()),
    ) {
        return Err(rate_limited(request_id, retry_after));
    }
    let oidc = runtime
        .oidc
        .as_ref()
        .ok_or_else(|| oidc_failed(&runtime, request_id, StatusCode::SERVICE_UNAVAILABLE))?;
    let start = oidc.start(provider).await.map_err(|error| {
        tracing::warn!(
            request_id = %request_id,
            provider = provider.provider_key(),
            error = ?error,
            "OIDC authorization start failed"
        );
        oidc_failed(&runtime, request_id, StatusCode::SERVICE_UNAVAILABLE)
    })?;
    let mut headers = HeaderMap::new();
    append_set_cookie(
        &mut headers,
        format!(
            "{}={}; Path=/; Max-Age={OIDC_TRANSACTION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax{}",
            runtime.oidc_cookie_name(),
            start.browser_binding(),
            runtime.secure_attribute()
        ),
    );
    Ok(found_response(start.authorization_url().as_str(), headers))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/oidc/{provider}/callback",
    operation_id = "completeOidcAuthorization",
    tag = "auth",
    params(
        ("provider" = String, Path, description = "Configured provider key"),
        ("code" = Option<String>, Query, description = "Authorization code"),
        ("state" = Option<String>, Query, description = "Authorization transaction state"),
        ("error" = Option<String>, Query, description = "Provider authorization error")
    ),
    responses(
        (status = 302, description = "A DaoYun session was created", headers(("location" = String), ("set-cookie" = String), ("x-request-id" = String))),
        (status = 400, description = "The authorization callback is invalid", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 404, description = "The provider is not configured", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 409, description = "The external identity is not linked to a DaoYun account", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String))),
        (status = 503, description = "The OIDC provider or identity service is unavailable", body = ErrorResponse, headers(("set-cookie" = String), ("x-request-id" = String)))
    )
)]
pub(crate) async fn complete_oidc_authorization(
    State(database): State<Database>,
    Path(provider_key): Path<String>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<OidcCallbackQuery>, QueryRejection>,
) -> Result<Response, ApiError> {
    let Query(query) =
        query.map_err(|_| oidc_failed(&runtime, request_id, StatusCode::BAD_REQUEST))?;
    let provider = oidc_provider(&runtime, &provider_key)
        .ok_or_else(|| oidc_provider_not_found(&runtime, request_id))?;
    let oidc = runtime
        .oidc
        .as_ref()
        .ok_or_else(|| oidc_failed(&runtime, request_id, StatusCode::SERVICE_UNAVAILABLE))?;
    let state = query
        .state
        .as_deref()
        .filter(|value| valid_token(value))
        .ok_or_else(|| oidc_failed(&runtime, request_id, StatusCode::BAD_REQUEST))?;
    let browser_binding = cookie_value(&headers, runtime.oidc_cookie_name())
        .filter(|value| valid_token(value))
        .ok_or_else(|| oidc_failed(&runtime, request_id, StatusCode::BAD_REQUEST))?;
    let transaction = oidc
        .consume(provider.provider_key(), state, browser_binding)
        .map_err(|_| oidc_failed(&runtime, request_id, StatusCode::BAD_REQUEST))?;
    if query.error.is_some() {
        record_oidc_failure(
            &database,
            provider.provider_key(),
            "authorization",
            request_id,
        )
        .await;
        return Err(oidc_failed(&runtime, request_id, StatusCode::BAD_REQUEST));
    }
    let code = query
        .code
        .as_deref()
        .ok_or_else(|| oidc_failed(&runtime, request_id, StatusCode::BAD_REQUEST))?;
    let verified = match oidc.verify_callback(provider, &transaction, code).await {
        Ok(verified) => verified,
        Err(error) => {
            let status = match error {
                OidcProtocolError::Invalid => StatusCode::BAD_REQUEST,
                OidcProtocolError::Capacity | OidcProtocolError::Unavailable => {
                    StatusCode::SERVICE_UNAVAILABLE
                }
            };
            tracing::warn!(
                request_id = %request_id,
                provider = provider.provider_key(),
                "OIDC authorization callback failed"
            );
            record_oidc_failure(
                &database,
                provider.provider_key(),
                "verification",
                request_id,
            )
            .await;
            return Err(oidc_failed(&runtime, request_id, status));
        }
    };
    let email_snapshot = validated_oidc_email(verified.email());
    if let Some(binding) = transaction.identity_binding() {
        let (current, _) = authenticate_session(&database, &runtime, &headers, request_id)
            .await
            .map_err(|error| clear_oidc_error(error, &runtime))?;
        if current.user.id != binding.user_id || current.id != binding.session_id {
            record_oidc_failure(&database, provider.provider_key(), "binding", request_id).await;
            return Err(oidc_failed(&runtime, request_id, StatusCode::BAD_REQUEST));
        }

        let csrf_token = random_token();
        let identity = NewExternalIdentityRecord {
            id: Uuid::now_v7(),
            user_id: current.user.id,
            provider_key: provider.provider_key().to_owned(),
            subject: verified.subject().to_owned(),
            issuer: verified.issuer().to_owned(),
            email_snapshot: email_snapshot.map(str::to_owned),
            email_verified: email_snapshot.and(verified.email_verified()),
        };
        match database
            .bind_external_identity(
                current.user.id,
                current.id,
                binding.replacement_identity_id,
                identity,
                token_hash(&csrf_token),
            )
            .await
        {
            Ok(()) => {}
            Err(BindExternalIdentityError::RecentAuthenticationRequired) => {
                record_oidc_failure(&database, provider.provider_key(), "binding", request_id)
                    .await;
                return Err(clear_oidc_error(
                    recent_authentication_required(request_id),
                    &runtime,
                ));
            }
            Err(BindExternalIdentityError::IdentityNotFound) => {
                record_oidc_failure(&database, provider.provider_key(), "binding", request_id)
                    .await;
                return Err(clear_oidc_error(identity_not_found(request_id), &runtime));
            }
            Err(BindExternalIdentityError::IdentityUnavailable) => {
                record_oidc_failure(&database, provider.provider_key(), "binding", request_id)
                    .await;
                return Err(clear_oidc_error(
                    external_identity_unavailable(request_id),
                    &runtime,
                ));
            }
            Err(BindExternalIdentityError::InvalidInput) => {
                record_oidc_failure(&database, provider.provider_key(), "binding", request_id)
                    .await;
                return Err(oidc_failed(&runtime, request_id, StatusCode::BAD_REQUEST));
            }
            Err(BindExternalIdentityError::Database(error)) => {
                tracing::warn!(request_id = %request_id, error = %error, "External identity binding transaction failed");
                record_oidc_failure(&database, provider.provider_key(), "binding", request_id)
                    .await;
                return Err(oidc_failed(
                    &runtime,
                    request_id,
                    StatusCode::SERVICE_UNAVAILABLE,
                ));
            }
        }
        let mut response_headers = csrf_cookie_header(&runtime, &csrf_token);
        append_set_cookie(&mut response_headers, clear_oidc_cookie_value(&runtime));
        return Ok(found_response("/", response_headers));
    }
    let user = database
        .find_external_identity_user(
            provider.provider_key(),
            verified.subject(),
            verified.issuer(),
            email_snapshot,
            email_snapshot.and(verified.email_verified()),
        )
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "OIDC identity lookup failed");
            oidc_failed(&runtime, request_id, StatusCode::SERVICE_UNAVAILABLE)
        })?;
    let Some(user) = user else {
        record_oidc_failure(&database, provider.provider_key(), "identity", request_id).await;
        let claim_token = oidc
            .issue_claim(provider, &verified)
            .map_err(|_| oidc_failed(&runtime, request_id, StatusCode::SERVICE_UNAVAILABLE))?;
        let mut response_headers = HeaderMap::new();
        append_set_cookie(
            &mut response_headers,
            format!(
                "{}={}; Path=/; Max-Age={OIDC_TRANSACTION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax{}",
                runtime.oidc_claim_cookie_name(),
                claim_token,
                runtime.secure_attribute()
            ),
        );
        append_set_cookie(&mut response_headers, clear_oidc_cookie_value(&runtime));
        return Ok(found_response("/#oidc-claim", response_headers));
    };
    let secrets =
        create_session(&database, user.user_id, device_label(&headers), request_id).await?;
    record_security_audit(
        &database,
        Some(user.user_id),
        Some(secrets.session_id),
        "auth.oidc.succeeded",
        json!({"provider": provider.provider_key()}),
        request_id,
    )
    .await;
    let mut response_headers = session_cookie_headers(&runtime, &secrets);
    append_set_cookie(&mut response_headers, clear_oidc_cookie_value(&runtime));
    Ok(found_response("/", response_headers))
}

async fn record_oidc_failure(
    database: &Database,
    provider_key: &str,
    stage: &'static str,
    request_id: RequestId,
) {
    record_security_audit(
        database,
        None,
        None,
        "auth.oidc.failed",
        json!({"provider": provider_key, "stage": stage}),
        request_id,
    )
    .await;
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/password",
    operation_id = "changePassword",
    tag = "auth",
    request_body = ChangePasswordRequest,
    responses(
        (status = 200, description = "The password was changed and the current CSRF token was rotated", body = ApiResponse<ChangePasswordData>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token or recent authentication is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The new password is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The identity service is not ready", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn change_password(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<ChangePasswordRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<ChangePasswordData>>), ApiError> {
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let new_password =
        validate_new_password(request).map_err(|fields| validation_error(request_id, fields))?;
    let current = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let password_hash = hash_password(new_password, request_id).await?;
    let csrf_token = random_token();
    match database
        .change_password(
            current.user.id,
            current.id,
            &password_hash,
            token_hash(&csrf_token),
        )
        .await
    {
        Ok(()) => {}
        Err(ChangePasswordError::RecentAuthenticationRequired) => {
            return Err(recent_authentication_required(request_id));
        }
        Err(ChangePasswordError::Database(error)) => {
            tracing::warn!(request_id = %request_id, error = %error, "Password change transaction failed");
            return Err(service_unavailable(request_id));
        }
    }
    Ok((
        csrf_cookie_header(&runtime, &csrf_token),
        Json(ApiResponse::new(
            ChangePasswordData { csrf_token },
            request_id,
        )),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/session",
    operation_id = "getCurrentSession",
    tag = "auth",
    responses(
        (status = 200, description = "The current authenticated session", body = ApiResponse<AuthenticatedSession>, headers(("x-request-id" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 503, description = "The session store is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn current_session(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<AuthenticatedSession>>), ApiError> {
    let (record, csrf_token) =
        authenticate_session(&database, &runtime, &headers, request_id).await?;
    Ok((
        HeaderMap::new(),
        Json(ApiResponse::new(
            AuthenticatedSession {
                user: authenticated_user(record),
                csrf_token,
            },
            request_id,
        )),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/logout",
    operation_id = "logoutCurrentSession",
    tag = "auth",
    responses(
        (status = 200, description = "The current session was revoked", body = ApiResponse<LogoutData>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The session store is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn logout(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<LogoutData>>), ApiError> {
    let session_token = cookie_value(&headers, runtime.session_cookie_name())
        .filter(|value| valid_token(value))
        .ok_or_else(|| unauthenticated(&runtime, request_id))?;
    let csrf_cookie = cookie_value(&headers, runtime.csrf_cookie_name())
        .filter(|value| valid_token(value))
        .ok_or_else(|| csrf_failed(request_id))?;
    let csrf_header = headers
        .get("x-csrf-token")
        .and_then(|value| value.to_str().ok())
        .filter(|value| valid_token(value))
        .ok_or_else(|| csrf_failed(request_id))?;

    let session_token_hash = token_hash(session_token);
    let record = database
        .touch_session(&session_token_hash)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Logout session lookup failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| unauthenticated(&runtime, request_id))?;

    if csrf_cookie != csrf_header || record.csrf_token_hash != token_hash(csrf_cookie) {
        return Err(csrf_failed(request_id));
    }

    database
        .revoke_session(&session_token_hash)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Session revoke failed");
            service_unavailable(request_id)
        })?;
    record_security_audit(
        &database,
        Some(record.user.id),
        Some(record.id),
        "auth.logout.succeeded",
        json!({}),
        request_id,
    )
    .await;

    Ok((
        clear_cookie_headers(&runtime),
        Json(ApiResponse::new(
            LogoutData { logged_out: true },
            request_id,
        )),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/sessions",
    operation_id = "listDeviceSessions",
    tag = "auth",
    responses(
        (status = 200, description = "The authenticated user's active device sessions", body = ApiResponse<Vec<DeviceSession>>, headers(("x-request-id" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 503, description = "The session store is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_device_sessions(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<Vec<DeviceSession>>>), ApiError> {
    let (current, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let sessions = database
        .list_device_sessions(current.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Device session list failed");
            service_unavailable(request_id)
        })?
        .into_iter()
        .map(|record| device_session(record, current.id))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| internal_error(request_id))?;
    Ok((
        HeaderMap::new(),
        Json(ApiResponse::new(sessions, request_id)),
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v1/auth/sessions/{session_id}",
    operation_id = "revokeDeviceSession",
    tag = "auth",
    params(("session_id" = Uuid, Path, description = "The device session to revoke")),
    responses(
        (status = 200, description = "The other device session was revoked", body = ApiResponse<RevokeDeviceSessionData>, headers(("x-request-id" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The device session is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The current session cannot be revoked through this endpoint", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The session identifier is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The session store is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn revoke_device_session(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<RevokeDeviceSessionData>>), ApiError> {
    let session_id = Uuid::parse_str(&session_id).map_err(|_| session_id_invalid(request_id))?;
    let current = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    if session_id == current.id {
        return Err(current_session_conflict(request_id));
    }
    let revoked = database
        .revoke_other_session(current.user.id, session_id, current.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Device session revoke failed");
            service_unavailable(request_id)
        })?;
    if !revoked {
        return Err(device_session_not_found(request_id));
    }
    record_security_audit(
        &database,
        Some(current.user.id),
        Some(current.id),
        "auth.session.revoked",
        json!({}),
        request_id,
    )
    .await;
    Ok((
        HeaderMap::new(),
        Json(ApiResponse::new(
            RevokeDeviceSessionData { revoked },
            request_id,
        )),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/identities/{identity_id}/unlink",
    operation_id = "unlinkExternalIdentity",
    tag = "auth",
    params(("identity_id" = Uuid, Path, description = "The external identity to unlink")),
    responses(
        (status = 200, description = "The external identity was unlinked and the current CSRF token was rotated", body = ApiResponse<UnlinkExternalIdentityData>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 401, description = "No active session is available", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token or recent authentication is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The external identity is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "Another login method is required", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The identity identifier is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The identity service is not ready", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn unlink_external_identity(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    Path(identity_id): Path<String>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<UnlinkExternalIdentityData>>), ApiError> {
    let identity_id = Uuid::parse_str(&identity_id).map_err(|_| identity_id_invalid(request_id))?;
    let current = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let csrf_token = random_token();
    match database
        .unlink_external_identity(
            current.user.id,
            current.id,
            identity_id,
            token_hash(&csrf_token),
        )
        .await
    {
        Ok(()) => {}
        Err(UnlinkExternalIdentityError::RecentAuthenticationRequired) => {
            return Err(recent_authentication_required(request_id));
        }
        Err(UnlinkExternalIdentityError::IdentityNotFound) => {
            return Err(identity_not_found(request_id));
        }
        Err(UnlinkExternalIdentityError::LastLoginMethodRequired) => {
            return Err(last_login_method_required(request_id));
        }
        Err(UnlinkExternalIdentityError::Database(error)) => {
            tracing::warn!(request_id = %request_id, error = %error, "External identity unlink transaction failed");
            return Err(service_unavailable(request_id));
        }
    }
    Ok((
        csrf_cookie_header(&runtime, &csrf_token),
        Json(ApiResponse::new(
            UnlinkExternalIdentityData {
                unlinked: true,
                csrf_token,
            },
            request_id,
        )),
    ))
}

pub(crate) async fn create_session(
    database: &Database,
    user_id: Uuid,
    device_label: String,
    request_id: RequestId,
) -> Result<SessionSecrets, ApiError> {
    let secrets = new_session_secrets();
    let session_id = Uuid::now_v7();
    database
        .create_session(
            session_id,
            user_id,
            token_hash(&secrets.session_token),
            token_hash(&secrets.csrf_token),
            device_label,
        )
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Session creation failed");
            service_unavailable(request_id)
        })?;
    Ok(SessionSecrets {
        session_id,
        ..secrets
    })
}

pub(crate) async fn record_security_audit(
    database: &Database,
    user_id: Option<Uuid>,
    session_id: Option<Uuid>,
    event_type: &'static str,
    metadata: serde_json::Value,
    request_id: RequestId,
) {
    if let Err(error) = database
        .insert_security_audit(SecurityAuditEvent {
            user_id,
            session_id,
            event_type: event_type.to_owned(),
            metadata,
        })
        .await
    {
        tracing::warn!(request_id = %request_id, error = %error, event_type, "Security audit write failed");
    }
}

fn new_session_secrets() -> SessionSecrets {
    SessionSecrets {
        session_id: Uuid::nil(),
        session_token: random_token(),
        csrf_token: random_token(),
    }
}

fn device_session(record: DeviceSessionRecord, current_id: Uuid) -> Result<DeviceSession, ()> {
    Ok(DeviceSession {
        id: record.id,
        device_label: record.device_label,
        created_at: format_timestamp(record.created_at)?,
        last_seen_at: format_timestamp(record.last_seen_at)?,
        is_current: record.id == current_id,
    })
}

fn external_identity(record: ExternalIdentityRecord) -> Result<ExternalIdentity, ()> {
    Ok(ExternalIdentity {
        id: record.id,
        provider_key: record.provider_key,
        created_at: format_timestamp(record.created_at)?,
        last_authenticated_at: record
            .last_authenticated_at
            .map(format_timestamp)
            .transpose()?,
    })
}

fn oidc_claim_data(claim: &OidcClaim) -> OidcClaimData {
    OidcClaimData {
        provider_key: claim.provider_key().to_owned(),
        provider_display_name: claim.provider_display_name().to_owned(),
        profile_name: claim.name().map(str::to_owned),
        preferred_username: claim.preferred_username().map(str::to_owned),
        email_hint: claim.email_snapshot().and_then(mask_email),
    }
}

fn mask_email(email: &str) -> Option<String> {
    let (local, domain) = email.split_once('@')?;
    let first = local.chars().next()?;
    Some(format!("{first}***@{domain}"))
}

fn format_timestamp(value: OffsetDateTime) -> Result<String, ()> {
    value
        .to_offset(UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|_| ())
}

fn device_label(headers: &HeaderMap) -> String {
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if user_agent.contains("iPhone")
        || user_agent.contains("iPad")
        || user_agent.contains("Android")
    {
        "移动设备".to_owned()
    } else if user_agent.contains("Windows") {
        "Windows 设备".to_owned()
    } else if user_agent.contains("Macintosh") || user_agent.contains("Mac OS") {
        "Mac 设备".to_owned()
    } else if user_agent.contains("Linux") {
        "Linux 设备".to_owned()
    } else {
        "未知设备".to_owned()
    }
}

fn oidc_provider<'a>(
    runtime: &'a AuthRuntime,
    provider_key: &str,
) -> Option<&'a OidcProviderConfig> {
    runtime
        .config
        .oidc_providers
        .iter()
        .find(|provider| provider.provider_key() == provider_key)
}

fn validated_oidc_email(value: Option<&str>) -> Option<&str> {
    value.filter(|email| {
        (3..=254).contains(&email.chars().count())
            && email.chars().all(|character| !character.is_control())
            && EmailAddress::from_str(email).is_ok()
    })
}

fn found_response(location: &str, headers: HeaderMap) -> Response {
    let mut response = Response::new(axum::body::Body::empty());
    *response.status_mut() = StatusCode::FOUND;
    *response.headers_mut() = headers;
    response.headers_mut().insert(
        header::LOCATION,
        HeaderValue::from_str(location).expect("validated redirect URLs are valid headers"),
    );
    response
}

pub(crate) async fn authenticate_session(
    database: &Database,
    runtime: &AuthRuntime,
    headers: &HeaderMap,
    request_id: RequestId,
) -> Result<(SessionRecord, String), ApiError> {
    let session_token = cookie_value(headers, runtime.session_cookie_name())
        .filter(|value| valid_token(value))
        .ok_or_else(|| unauthenticated(runtime, request_id))?;
    let csrf_token = cookie_value(headers, runtime.csrf_cookie_name())
        .filter(|value| valid_token(value))
        .ok_or_else(|| unauthenticated(runtime, request_id))?;
    let record = database
        .touch_session(&token_hash(session_token))
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Session lookup failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| unauthenticated(runtime, request_id))?;
    if record.csrf_token_hash != token_hash(csrf_token) {
        return Err(unauthenticated(runtime, request_id));
    }
    Ok((record, csrf_token.to_owned()))
}

pub(crate) async fn authenticate_optional_session(
    database: &Database,
    runtime: &AuthRuntime,
    headers: &HeaderMap,
    request_id: RequestId,
) -> Result<(Option<SessionRecord>, HeaderMap), ApiError> {
    let session_token = cookie_value(headers, runtime.session_cookie_name());
    let csrf_token = cookie_value(headers, runtime.csrf_cookie_name());
    if session_token.is_none() && csrf_token.is_none() {
        return Ok((None, HeaderMap::new()));
    }
    let (Some(session_token), Some(csrf_token)) = (session_token, csrf_token) else {
        return Ok((None, clear_cookie_headers(runtime)));
    };
    if !valid_token(session_token) || !valid_token(csrf_token) {
        return Ok((None, clear_cookie_headers(runtime)));
    }
    let record = database
        .touch_session(&token_hash(session_token))
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Optional session lookup failed");
            service_unavailable(request_id)
        })?;
    let Some(record) = record else {
        return Ok((None, clear_cookie_headers(runtime)));
    };
    if record.csrf_token_hash != token_hash(csrf_token) {
        return Ok((None, clear_cookie_headers(runtime)));
    }
    Ok((Some(record), HeaderMap::new()))
}

pub(crate) async fn authenticate_state_change(
    database: &Database,
    runtime: &AuthRuntime,
    headers: &HeaderMap,
    request_id: RequestId,
) -> Result<SessionRecord, ApiError> {
    let (record, csrf_token) = authenticate_session(database, runtime, headers, request_id).await?;
    let csrf_header = headers
        .get("x-csrf-token")
        .and_then(|value| value.to_str().ok())
        .filter(|value| valid_token(value))
        .ok_or_else(|| csrf_failed(request_id))?;
    if csrf_header != csrf_token {
        return Err(csrf_failed(request_id));
    }
    Ok(record)
}

pub(crate) fn authenticated_user(record: SessionRecord) -> AuthenticatedUser {
    AuthenticatedUser {
        id: record.user.id,
        username: record.user.username,
        email: record.user.email,
        display_name: record.user.display_name,
    }
}

async fn hash_password(
    password: Zeroizing<String>,
    request_id: RequestId,
) -> Result<String, ApiError> {
    let permit = PASSWORD_OPERATIONS
        .acquire()
        .await
        .expect("the static password semaphore is never closed");
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        let result = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string());
        drop(permit);
        result
    })
    .await
    .map_err(|error| {
        tracing::error!(request_id = %request_id, error = ?error, "Password hashing task failed");
        internal_error(request_id)
    })?
    .map_err(|error| {
        tracing::error!(request_id = %request_id, error = ?error, "Password hashing failed");
        internal_error(request_id)
    })
}

async fn verify_password(
    password: Zeroizing<String>,
    password_hash: String,
    request_id: RequestId,
) -> Result<bool, ApiError> {
    let permit = PASSWORD_OPERATIONS
        .acquire()
        .await
        .expect("the static password semaphore is never closed");
    tokio::task::spawn_blocking(move || {
        let is_valid = PasswordHash::new(&password_hash)
            .and_then(|hash| Argon2::default().verify_password(password.as_bytes(), &hash))
            .is_ok();
        drop(permit);
        is_valid
    })
    .await
    .map_err(|error| {
        tracing::error!(request_id = %request_id, error = ?error, "Password verification task failed");
        internal_error(request_id)
    })
}

fn validate_registration(request: RegisterRequest) -> Result<ValidatedRegistration, FieldErrors> {
    let mut fields = FieldErrors::new();
    let username = request.username;
    let email = request.email.trim().to_ascii_lowercase();
    let display_name = request.display_name.trim().to_owned();
    let password = Zeroizing::new(request.password);
    let email_challenge_id = request.email_challenge_id;
    let email_verification_code = request.email_verification_code.map(Zeroizing::new);

    if !valid_username(&username) {
        add_field_error(
            &mut fields,
            "username",
            "用户名必须以小写字母开头，且为 3 到 32 位小写字母、数字或下划线",
        );
    }
    if email.chars().count() > 254 || EmailAddress::from_str(&email).is_err() {
        add_field_error(&mut fields, "email", "邮箱地址格式不正确");
    }
    let display_name_length = display_name.chars().count();
    if !(1..=80).contains(&display_name_length) || display_name.chars().any(char::is_control) {
        add_field_error(
            &mut fields,
            "display_name",
            "显示名称必须为 1 到 80 个字符且不能包含控制字符",
        );
    }
    if !(6..=128).contains(&password.chars().count()) {
        add_field_error(
            &mut fields,
            "password",
            "密码长度必须在 6 到 128 个字符之间",
        );
    }
    if email_verification_code
        .as_deref()
        .is_some_and(|code| code.len() != 6 || !code.as_bytes().iter().all(u8::is_ascii_digit))
    {
        add_field_error(
            &mut fields,
            "email_verification_code",
            "邮箱验证码必须是 6 位数字",
        );
    }

    if fields.is_empty() {
        Ok(ValidatedRegistration {
            username,
            email,
            display_name,
            password,
            email_challenge_id,
            email_verification_code,
        })
    } else {
        Err(fields)
    }
}

fn validate_login(request: LoginRequest) -> Result<(String, Zeroizing<String>), FieldErrors> {
    let mut fields = FieldErrors::new();
    let identifier = request.identifier.trim().to_owned();
    let password = Zeroizing::new(request.password);
    if identifier.is_empty()
        || identifier.chars().count() > 254
        || identifier.chars().any(char::is_control)
    {
        add_field_error(&mut fields, "identifier", "请输入有效的用户名或邮箱");
    }
    if password.is_empty() || password.chars().count() > 128 {
        add_field_error(&mut fields, "password", "请输入有效密码");
    }
    if fields.is_empty() {
        Ok((identifier, password))
    } else {
        Err(fields)
    }
}

fn validate_recent_auth(
    request: RecentAuthRequest,
) -> Result<(String, Zeroizing<String>), FieldErrors> {
    let mut fields = FieldErrors::new();
    let operation = request.operation.trim().to_owned();
    let password = Zeroizing::new(request.password);
    if !RECENT_AUTH_OPERATIONS.contains(&operation.as_str()) {
        add_field_error(&mut fields, "operation", "不支持的近期认证操作");
    }
    if !(6..=128).contains(&password.chars().count()) {
        add_field_error(
            &mut fields,
            "password",
            "密码长度必须在 6 到 128 个字符之间",
        );
    }
    if fields.is_empty() {
        Ok((operation, password))
    } else {
        Err(fields)
    }
}

fn validate_new_password(request: ChangePasswordRequest) -> Result<Zeroizing<String>, FieldErrors> {
    let mut fields = FieldErrors::new();
    let password = Zeroizing::new(request.new_password);
    if !(6..=128).contains(&password.chars().count()) {
        add_field_error(
            &mut fields,
            "new_password",
            "密码长度必须在 6 到 128 个字符之间",
        );
    }
    if fields.is_empty() {
        Ok(password)
    } else {
        Err(fields)
    }
}

fn validate_passkey_rp_id(value: &str) -> Result<String, String> {
    let rp_id = value.trim();
    if rp_id.is_empty() {
        return Err("DAOYUN_PASSKEY_RP_ID must not be empty".to_owned());
    }
    if rp_id
        .chars()
        .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(
            "DAOYUN_PASSKEY_RP_ID must not contain whitespace or control characters".to_owned(),
        );
    }
    if rp_id.contains("://")
        || rp_id.contains('/')
        || rp_id.contains('?')
        || rp_id.contains('#')
        || rp_id.contains('@')
    {
        return Err(
            "DAOYUN_PASSKEY_RP_ID must be a bare host without scheme, path, query, or userinfo"
                .to_owned(),
        );
    }
    if rp_id.starts_with('.') || rp_id.ends_with('.') {
        return Err("DAOYUN_PASSKEY_RP_ID must not start or end with '.'".to_owned());
    }
    if IpAddr::from_str(rp_id).is_ok() || rp_id.eq_ignore_ascii_case("localhost") {
        return Ok(rp_id.to_owned());
    }
    if rp_id.contains(':') {
        return Err("DAOYUN_PASSKEY_RP_ID must not include a port".to_owned());
    }
    let labels = rp_id.split('.').collect::<Vec<_>>();
    if labels.len() < 2
        || labels.iter().any(|label| {
            label.is_empty()
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        return Err(
            "DAOYUN_PASSKEY_RP_ID must be a valid host name or loopback address".to_owned(),
        );
    }
    Ok(rp_id.to_ascii_lowercase())
}

fn validate_passkey_origin(value: &str) -> Result<String, String> {
    let origin = value.trim();
    let parsed = Url::parse(origin)
        .map_err(|_| "DAOYUN_PASSKEY_ORIGIN must be an absolute origin URL".to_owned())?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("DAOYUN_PASSKEY_ORIGIN must not contain userinfo".to_owned());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("DAOYUN_PASSKEY_ORIGIN must not contain a query or fragment".to_owned());
    }
    if parsed.path() != "/" {
        return Err("DAOYUN_PASSKEY_ORIGIN must not contain a path".to_owned());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "DAOYUN_PASSKEY_ORIGIN must include a host".to_owned())?;
    match parsed.scheme() {
        "https" => {}
        "http" if is_loopback_host(host) => {}
        _ => {
            return Err(
                "DAOYUN_PASSKEY_ORIGIN must use https, or http only for localhost/loopback"
                    .to_owned(),
            );
        }
    }
    Ok(parsed.to_string().trim_end_matches('/').to_owned())
}

fn validate_passkey_rp_name(value: &str) -> Result<String, String> {
    let rp_name = value.trim();
    let length = rp_name.chars().count();
    if !(1..=80).contains(&length) || rp_name.chars().any(char::is_control) {
        return Err("DAOYUN_PASSKEY_RP_NAME must be 1 to 80 printable characters".to_owned());
    }
    Ok(rp_name.to_owned())
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || IpAddr::from_str(host).is_ok_and(|address| address.is_loopback())
}

fn origin_matches_rp_id(origin_host: &str, rp_id: &str) -> bool {
    if origin_host.eq_ignore_ascii_case(rp_id) {
        return true;
    }
    if IpAddr::from_str(rp_id).is_ok() || rp_id.eq_ignore_ascii_case("localhost") {
        return false;
    }
    origin_host
        .to_ascii_lowercase()
        .ends_with(&format!(".{}", rp_id.to_ascii_lowercase()))
}

#[allow(clippy::result_large_err)]
fn passkey_webauthn(runtime: &AuthRuntime, request_id: RequestId) -> Result<Webauthn, ApiError> {
    let origin = Url::parse(&runtime.config.passkey_origin).map_err(|error| {
        tracing::error!(request_id = %request_id, error = %error, "Passkey origin parsing failed at runtime");
        service_unavailable(request_id)
    })?;
    let origin_host = origin.host_str().ok_or_else(|| {
        tracing::error!(request_id = %request_id, "Passkey origin is missing a host at runtime");
        service_unavailable(request_id)
    })?;
    if !origin_matches_rp_id(origin_host, &runtime.config.passkey_rp_id) {
        tracing::error!(
            request_id = %request_id,
            rp_id = %runtime.config.passkey_rp_id,
            origin = %runtime.config.passkey_origin,
            "Passkey origin host does not match the configured RP ID"
        );
        return Err(service_unavailable(request_id));
    }
    Ok(Webauthn::new(
        &runtime.config.passkey_rp_id,
        &runtime.config.passkey_rp_name,
        &runtime.config.passkey_origin,
    )
    .strict_base64(true)
    .require_user_verification(true)
    .require_user_handle(true))
}

fn registration_options_from_challenge(
    challenge: passkey_auth::RegistrationChallenge,
) -> PasskeyRegistrationOptions {
    PasskeyRegistrationOptions {
        challenge: challenge.challenge,
        rp: PasskeyRp {
            id: challenge.rp.id,
            name: challenge.rp.name,
        },
        user: PasskeyUser {
            id: challenge.user.id,
            name: challenge.user.name,
            display_name: challenge.user.display_name,
        },
        pub_key_cred_params: challenge
            .pub_key_cred_params
            .into_iter()
            .map(|parameter| PasskeyCredentialParameter {
                kind: parameter.kind.to_owned(),
                alg: parameter.alg,
            })
            .collect(),
        exclude_credentials: challenge
            .exclude_credentials
            .into_iter()
            .map(|descriptor| PasskeyCredentialDescriptor {
                kind: descriptor.kind.to_owned(),
                id: descriptor.id,
                transports: descriptor.transports,
            })
            .collect(),
        timeout: challenge.timeout,
        authenticator_selection: PasskeyAuthenticatorSelection {
            authenticator_attachment: challenge
                .authenticator_selection
                .authenticator_attachment
                .map(str::to_owned),
            resident_key: challenge
                .authenticator_selection
                .resident_key
                .map(|_| "required".to_owned()),
            user_verification: challenge
                .authenticator_selection
                .user_verification
                .to_owned(),
        },
        attestation: challenge.attestation.to_owned(),
    }
}

fn assertion_options_from_challenge(
    challenge: passkey_auth::AuthenticationChallenge,
) -> PasskeyAssertionOptions {
    PasskeyAssertionOptions {
        challenge: challenge.challenge,
        rp_id: challenge.rp_id,
        timeout: challenge.timeout,
        allow_credentials: challenge
            .allow_credentials
            .into_iter()
            .map(|descriptor| PasskeyCredentialDescriptor {
                kind: descriptor.kind.to_owned(),
                id: descriptor.id,
                transports: descriptor.transports,
            })
            .collect(),
        user_verification: challenge.user_verification.to_owned(),
    }
}

fn valid_username(username: &str) -> bool {
    let mut characters = username.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    let length = 1 + characters.clone().count();
    (3..=32).contains(&length)
        && first.is_ascii_lowercase()
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

pub(crate) fn random_token() -> String {
    // Source: https://docs.rs/rand_core/0.6.4/rand_core/struct.OsRng.html
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    encode_hex(&bytes)
}

fn generate_registration_code() -> String {
    const RANGE: u32 = 1_000_000;
    const ACCEPT_BELOW: u32 = u32::MAX - (u32::MAX % RANGE);
    loop {
        let value = OsRng.next_u32();
        if value < ACCEPT_BELOW {
            return format!("{:06}", value % RANGE);
        }
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub(crate) fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn cookie_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find_map(|(key, value)| (key == name).then_some(value))
}

pub(crate) fn session_cookie_headers(runtime: &AuthRuntime, secrets: &SessionSecrets) -> HeaderMap {
    // Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
    let mut headers = HeaderMap::new();
    append_set_cookie(
        &mut headers,
        format!(
            "{}={}; Path=/; Max-Age={SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict{}",
            runtime.session_cookie_name(),
            secrets.session_token,
            runtime.secure_attribute()
        ),
    );
    append_set_cookie(
        &mut headers,
        format!(
            "{}={}; Path=/; Max-Age={SESSION_MAX_AGE_SECONDS}; SameSite=Strict{}",
            runtime.csrf_cookie_name(),
            secrets.csrf_token,
            runtime.secure_attribute()
        ),
    );
    headers
}

pub(crate) fn csrf_cookie_header(runtime: &AuthRuntime, csrf_token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    append_set_cookie(
        &mut headers,
        format!(
            "{}={}; Path=/; Max-Age={SESSION_MAX_AGE_SECONDS}; SameSite=Strict{}",
            runtime.csrf_cookie_name(),
            csrf_token,
            runtime.secure_attribute()
        ),
    );
    headers
}

fn clear_cookie_headers(runtime: &AuthRuntime) -> HeaderMap {
    let mut headers = HeaderMap::new();
    append_set_cookie(
        &mut headers,
        format!(
            "{}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict{}",
            runtime.session_cookie_name(),
            runtime.secure_attribute()
        ),
    );
    append_set_cookie(
        &mut headers,
        format!(
            "{}=; Path=/; Max-Age=0; SameSite=Strict{}",
            runtime.csrf_cookie_name(),
            runtime.secure_attribute()
        ),
    );
    headers
}

fn clear_oidc_cookie_headers(runtime: &AuthRuntime) -> HeaderMap {
    let mut headers = HeaderMap::new();
    append_set_cookie(&mut headers, clear_oidc_cookie_value(runtime));
    headers
}

fn clear_oidc_cookie_value(runtime: &AuthRuntime) -> String {
    format!(
        "{}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax{}",
        runtime.oidc_cookie_name(),
        runtime.secure_attribute()
    )
}

fn clear_oidc_claim_cookie_value(runtime: &AuthRuntime) -> String {
    format!(
        "{}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax{}",
        runtime.oidc_claim_cookie_name(),
        runtime.secure_attribute()
    )
}

fn clear_oidc_error(error: ApiError, runtime: &AuthRuntime) -> ApiError {
    let (status, mut headers, body) = error;
    append_set_cookie(&mut headers, clear_oidc_cookie_value(runtime));
    (status, headers, body)
}

fn append_set_cookie(headers: &mut HeaderMap, value: String) {
    let value = HeaderValue::from_str(&value).expect("server-generated cookies are valid headers");
    headers.append(header::SET_COOKIE, value);
}

impl AuthRuntime {
    fn session_cookie_name(&self) -> &'static str {
        if self.config.secure_cookies {
            "__Host-daoyun_session"
        } else {
            "daoyun_session"
        }
    }

    fn csrf_cookie_name(&self) -> &'static str {
        if self.config.secure_cookies {
            "__Host-daoyun_csrf"
        } else {
            "daoyun_csrf"
        }
    }

    pub(crate) fn mfa_challenge_cookie_name(&self) -> &'static str {
        if self.config.secure_cookies {
            "__Host-daoyun_mfa_challenge"
        } else {
            "daoyun_mfa_challenge"
        }
    }

    fn oidc_cookie_name(&self) -> &'static str {
        if self.config.secure_cookies {
            "__Host-daoyun_oidc"
        } else {
            "daoyun_oidc"
        }
    }

    fn oidc_claim_cookie_name(&self) -> &'static str {
        if self.config.secure_cookies {
            "__Host-daoyun_oidc_claim"
        } else {
            "daoyun_oidc_claim"
        }
    }

    pub(crate) fn secure_attribute(&self) -> &'static str {
        if self.config.secure_cookies {
            "; Secure"
        } else {
            ""
        }
    }
}

fn check_rate_limit(
    runtime: &AuthRuntime,
    action: &str,
    identifier: &str,
    client_ip: Option<IpAddr>,
) -> Option<Duration> {
    let identifier = identifier.to_ascii_lowercase();
    let client_ip = client_ip
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_owned());
    let keys = [
        format!("{action}:identifier:{identifier}"),
        format!("{action}:ip:{client_ip}"),
    ];
    check_rate_limit_keys(runtime, &keys)
}

fn check_ip_rate_limit(
    runtime: &AuthRuntime,
    action: &str,
    client_ip: Option<IpAddr>,
) -> Option<Duration> {
    let client_ip = client_ip
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_owned());
    check_rate_limit_keys(runtime, &[format!("{action}:ip:{client_ip}")])
}

fn release_rate_limit(
    runtime: &AuthRuntime,
    action: &str,
    identifier: &str,
    client_ip: Option<IpAddr>,
) {
    let client_ip = client_ip
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_owned());
    let keys = [
        format!("{action}:identifier:{identifier}"),
        format!("{action}:ip:{client_ip}"),
    ];
    let mut attempts = runtime
        .attempts
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for key in keys {
        let remove = attempts.get_mut(&key).is_some_and(|window| {
            window.attempts = window.attempts.saturating_sub(1);
            window.attempts == 0
        });
        if remove {
            attempts.remove(&key);
        }
    }
}

fn check_rate_limit_keys(runtime: &AuthRuntime, keys: &[String]) -> Option<Duration> {
    let now = Instant::now();
    let mut attempts = runtime
        .attempts
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    for key in keys {
        let expired = attempts.get(key).is_some_and(|window| {
            now.duration_since(window.started_at) >= runtime.config.attempt_window
        });
        if expired {
            attempts.remove(key);
        }
    }

    let retry_after = keys
        .iter()
        .filter_map(|key| {
            let window = attempts.get(key)?;
            (window.attempts >= runtime.config.attempt_limit).then(|| {
                runtime
                    .config
                    .attempt_window
                    .saturating_sub(now.duration_since(window.started_at))
            })
        })
        .max();
    if let Some(retry_after) = retry_after {
        return Some(retry_after);
    }

    let missing_key_count = keys
        .iter()
        .filter(|key| !attempts.contains_key(*key))
        .count();
    if attempts.len().saturating_add(missing_key_count) > MAX_TRACKED_AUTH_ATTEMPT_WINDOWS {
        attempts.retain(|_, window| {
            now.duration_since(window.started_at) < runtime.config.attempt_window
        });
    }
    while attempts.len().saturating_add(
        keys.iter()
            .filter(|key| !attempts.contains_key(*key))
            .count(),
    ) > MAX_TRACKED_AUTH_ATTEMPT_WINDOWS
    {
        let oldest_key = attempts
            .iter()
            .filter(|(tracked_key, _)| !keys.iter().any(|key| key == *tracked_key))
            .min_by_key(|(_, window)| window.started_at)
            .map(|(key, _)| key.clone());
        let Some(oldest_key) = oldest_key else {
            break;
        };
        attempts.remove(&oldest_key);
    }

    for key in keys {
        let window = attempts.entry(key.clone()).or_insert(AttemptWindow {
            started_at: now,
            attempts: 0,
        });
        window.attempts += 1;
    }
    None
}

fn add_field_error(fields: &mut FieldErrors, field: &'static str, message: &'static str) {
    fields
        .entry(field.to_owned())
        .or_default()
        .push(message.to_owned());
}

pub(crate) fn malformed_body(request_id: RequestId) -> ApiError {
    let mut fields = FieldErrors::new();
    add_field_error(&mut fields, "body", "请求体必须是小于 4 KiB 的合法 JSON");
    validation_error(request_id, fields)
}

fn validation_error(request_id: RequestId, fields: FieldErrors) -> ApiError {
    let mut body = ErrorBody::new(
        ErrorCode::from_static(error_codes::VALIDATION_FAILED),
        "请求参数校验失败",
    );
    body.fields = fields;
    error(StatusCode::UNPROCESSABLE_ENTITY, body, request_id)
}

fn identity_unavailable(request_id: RequestId) -> ApiError {
    error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_IDENTITY_UNAVAILABLE),
            "用户名或邮箱暂不可用",
        ),
        request_id,
    )
}

fn email_verification_invalid(request_id: RequestId) -> ApiError {
    error(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_EMAIL_VERIFICATION_INVALID),
            "邮箱验证码无效或已过期，请重新获取",
        ),
        request_id,
    )
}

fn email_unavailable(request_id: RequestId) -> ApiError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_EMAIL_UNAVAILABLE),
            "邮件服务暂时不可用，请稍后重试",
        ),
        request_id,
    )
}

fn external_identity_unavailable(request_id: RequestId) -> ApiError {
    error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_IDENTITY_UNAVAILABLE),
            "外部身份无法绑定到当前账户",
        ),
        request_id,
    )
}

fn identity_not_found(request_id: RequestId) -> ApiError {
    error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_IDENTITY_NOT_FOUND),
            "外部身份不存在或已解绑",
        ),
        request_id,
    )
}

fn invalid_credentials(request_id: RequestId) -> ApiError {
    error(
        StatusCode::UNAUTHORIZED,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_INVALID_CREDENTIALS),
            "用户名、邮箱或密码不正确",
        ),
        request_id,
    )
}

fn oidc_provider_not_found(runtime: &AuthRuntime, request_id: RequestId) -> ApiError {
    error_with_headers(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_OIDC_PROVIDER_NOT_FOUND),
            "外部登录服务不存在或未启用",
        ),
        request_id,
        clear_oidc_cookie_headers(runtime),
    )
}

fn oidc_failed(runtime: &AuthRuntime, request_id: RequestId, status: StatusCode) -> ApiError {
    error_with_headers(
        status,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_OIDC_FAILED),
            "外部登录验证失败，请重新开始",
        ),
        request_id,
        clear_oidc_cookie_headers(runtime),
    )
}

fn oidc_claim_required(runtime: &AuthRuntime, request_id: RequestId) -> ApiError {
    error_with_headers(
        StatusCode::BAD_REQUEST,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_OIDC_CLAIM_REQUIRED),
            "外部身份确认已失效，请重新开始",
        ),
        request_id,
        {
            let mut headers = HeaderMap::new();
            append_set_cookie(&mut headers, clear_oidc_claim_cookie_value(runtime));
            headers
        },
    )
}

fn unauthenticated(runtime: &AuthRuntime, request_id: RequestId) -> ApiError {
    error_with_headers(
        StatusCode::UNAUTHORIZED,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_UNAUTHENTICATED),
            "当前请求未通过身份认证",
        ),
        request_id,
        clear_cookie_headers(runtime),
    )
}

pub(crate) fn csrf_failed(request_id: RequestId) -> ApiError {
    error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_CSRF_FAILED),
            "请求安全校验失败",
        ),
        request_id,
    )
}

pub(crate) fn recent_authentication_required(request_id: RequestId) -> ApiError {
    error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_RECENT_AUTH_REQUIRED),
            "请重新验证当前密码后再继续",
        ),
        request_id,
    )
}

fn last_login_method_required(request_id: RequestId) -> ApiError {
    error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_LAST_LOGIN_METHOD),
            "请先保留其他可用登录方式",
        ),
        request_id,
    )
}

fn current_session_conflict(request_id: RequestId) -> ApiError {
    error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_CURRENT_SESSION),
            "当前会话不能通过设备管理撤销",
        ),
        request_id,
    )
}

fn device_session_not_found(request_id: RequestId) -> ApiError {
    error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_SESSION_NOT_FOUND),
            "设备会话不存在或已失效",
        ),
        request_id,
    )
}

fn session_id_invalid(request_id: RequestId) -> ApiError {
    let mut fields = FieldErrors::new();
    add_field_error(&mut fields, "session_id", "会话标识格式不正确");
    validation_error(request_id, fields)
}

fn identity_id_invalid(request_id: RequestId) -> ApiError {
    let mut fields = FieldErrors::new();
    add_field_error(&mut fields, "identity_id", "外部身份标识格式不正确");
    validation_error(request_id, fields)
}

fn passkey_id_invalid(request_id: RequestId) -> ApiError {
    let mut fields = FieldErrors::new();
    add_field_error(&mut fields, "passkey_id", "通行密钥标识格式不正确");
    validation_error(request_id, fields)
}

fn passkey_not_found(request_id: RequestId) -> ApiError {
    error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_PASSKEY_NOT_FOUND),
            "通行密钥不存在或已失效",
        ),
        request_id,
    )
}

fn passkey_failed(request_id: RequestId) -> ApiError {
    error(
        StatusCode::FORBIDDEN,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_PASSKEY_FAILED),
            "通行密钥验证失败",
        ),
        request_id,
    )
}

fn rate_limited(request_id: RequestId, retry_after: Duration) -> ApiError {
    let mut headers = HeaderMap::new();
    let seconds = retry_after.as_secs().max(1).to_string();
    headers.insert(
        header::RETRY_AFTER,
        HeaderValue::from_str(&seconds).expect("retry seconds are a valid header"),
    );
    error_with_headers(
        StatusCode::TOO_MANY_REQUESTS,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::AUTH_RATE_LIMITED),
            "认证尝试过于频繁，请稍后重试",
        ),
        request_id,
        headers,
    )
}

fn not_ready(request_id: RequestId) -> ApiError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::NOT_READY),
            "实例尚未完成初始化",
        ),
        request_id,
    )
}

pub(crate) fn service_unavailable(request_id: RequestId) -> ApiError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "身份服务暂时不可用",
        ),
        request_id,
    )
}

fn internal_error(request_id: RequestId) -> ApiError {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::INTERNAL_ERROR),
            "身份凭据暂时无法处理",
        ),
        request_id,
    )
}

fn error(status: StatusCode, body: ErrorBody, request_id: RequestId) -> ApiError {
    error_with_headers(status, body, request_id, HeaderMap::new())
}

fn error_with_headers(
    status: StatusCode,
    body: ErrorBody,
    request_id: RequestId,
    headers: HeaderMap,
) -> ApiError {
    (status, headers, Json(ErrorResponse::new(body, request_id)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use serde_json::Value;
    use tower::ServiceExt;
    use url::Url;

    #[tokio::test]
    async fn oidc_start_and_error_callback_use_bound_single_use_http_state() {
        let config = AuthConfig::default()
            .with_secure_cookies(false)
            .with_attempt_limit(1)
            .with_oidc_provider_json(
                serde_json::json!([{
                    "provider_key": "google",
                    "display_name": "Google",
                    "issuer": "https://accounts.example.com",
                    "client_id": "client-id",
                    "client_secret": "client-secret",
                    "redirect_uri": "https://community.example.com/api/v1/auth/oidc/google/callback"
                }])
                .to_string(),
            )
            .expect("provider config must parse");
        let mut runtime = runtime(config);
        let provider = runtime.config.oidc_providers[0].clone();
        let metadata = serde_json::json!({
            "issuer": "https://accounts.example.com",
            "authorization_endpoint": "https://accounts.example.com/oauth2/authorize",
            "token_endpoint": "https://accounts.example.com/oauth2/token",
            "jwks_uri": "https://accounts.example.com/.well-known/jwks.json",
            "response_types_supported": ["code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "code_challenge_methods_supported": ["S256"]
        });
        let protocol = OidcRuntime::for_tests(&provider, metadata.to_string().as_bytes())
            .expect("test metadata must parse");
        let protocol_assertion = protocol.clone();
        runtime.oidc = Some(protocol);
        let request_id = RequestId::from(
            Uuid::parse_str("019fc800-0000-7000-8000-000000000001")
                .expect("request UUID must parse"),
        );
        let database = Database::from_pool(
            sqlx::postgres::PgPoolOptions::new()
                .acquire_timeout(Duration::from_millis(100))
                .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
                .expect("unavailable database URL must parse"),
        );
        let app = router(runtime)
            .with_state(database)
            .layer(Extension(request_id));

        let start = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/oidc/google/start")
                    .body(Body::empty())
                    .expect("start request must build"),
            )
            .await
            .expect("start route must respond");
        assert_eq!(start.status(), StatusCode::FOUND);
        let location = start.headers()[header::LOCATION]
            .to_str()
            .expect("location must be text");
        let authorization_url = Url::parse(location).expect("location must be a URL");
        let query = authorization_url
            .query_pairs()
            .into_owned()
            .collect::<HashMap<_, _>>();
        let state = query["state"].clone();
        assert_eq!(query["response_type"], "code");
        assert_eq!(query["scope"], "openid");
        assert_eq!(query["code_challenge_method"], "S256");
        let cookie = start
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .find_map(|value| {
                value
                    .to_str()
                    .ok()?
                    .split(';')
                    .next()
                    .filter(|pair| pair.starts_with("daoyun_oidc="))
            })
            .expect("browser binding cookie must be set")
            .to_owned();
        assert!(
            start
                .headers()
                .get_all(header::SET_COOKIE)
                .iter()
                .any(|value| value.to_str().is_ok_and(|value| {
                    value.contains("HttpOnly")
                        && value.contains("SameSite=Lax")
                        && value.contains("Max-Age=300")
                }))
        );

        let callback_uri = format!(
            "/api/v1/auth/oidc/google/callback?state={state}&error=access_denied&error_description=provider-secret"
        );
        let callback = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(callback_uri)
                    .header(header::COOKIE, &cookie)
                    .body(Body::empty())
                    .expect("callback request must build"),
            )
            .await
            .expect("callback route must respond");
        assert_eq!(callback.status(), StatusCode::BAD_REQUEST);
        let callback_body = axum::body::to_bytes(callback.into_body(), 16 * 1024)
            .await
            .expect("callback body must be readable");
        let callback_json =
            serde_json::from_slice::<Value>(&callback_body).expect("callback body must be JSON");
        assert_eq!(callback_json["error"]["code"], "auth.oidc_failed");
        assert!(!callback_json.to_string().contains("access_denied"));
        assert!(!callback_json.to_string().contains("provider-secret"));

        let browser_binding = cookie
            .split_once('=')
            .expect("cookie must contain a binding")
            .1;
        assert!(
            protocol_assertion
                .consume("google", &state, browser_binding)
                .is_err()
        );

        let limited = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/oidc/google/start")
                    .body(Body::empty())
                    .expect("limited start request must build"),
            )
            .await
            .expect("limited start route must respond");
        assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(limited.headers().contains_key(header::RETRY_AFTER));
    }

    #[test]
    fn auth_rate_limit_tracking_is_bounded() {
        let runtime = runtime(AuthConfig::default().with_attempt_limit(u32::MAX));
        for index in 0..(MAX_TRACKED_AUTH_ATTEMPT_WINDOWS + 32) {
            assert!(
                check_rate_limit_keys(&runtime, &[format!("test:{index}")]).is_none(),
                "tracking capacity must not create a synthetic rate limit"
            );
        }
        let attempts = runtime
            .attempts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(attempts.len() <= MAX_TRACKED_AUTH_ATTEMPT_WINDOWS);
    }

    #[test]
    fn passkey_configuration_accepts_loopback_http_and_rejects_url_rp_ids() {
        assert_eq!(
            validate_passkey_rp_id("127.0.0.1").expect("loopback RP ID should be valid"),
            "127.0.0.1"
        );
        assert_eq!(
            validate_passkey_origin("http://127.0.0.1:5173")
                .expect("loopback HTTP origin should be valid"),
            "http://127.0.0.1:5173"
        );
        assert!(validate_passkey_rp_id("https://example.com").is_err());
        assert!(validate_passkey_origin("http://example.com").is_err());
    }

    #[test]
    fn passkey_configuration_requires_origin_host_to_match_rp_id() {
        assert!(origin_matches_rp_id("login.example.com", "example.com"));
        assert!(!origin_matches_rp_id("example.net", "example.com"));
        assert!(!origin_matches_rp_id("localhost", "127.0.0.1"));
    }
}
