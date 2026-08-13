use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, FieldErrors, InitialAdministrator,
    InitializeInstallationRequest, InstallationInitialization, InstallationStatus, RequestId,
    error_codes,
};
use argon2::{
    Argon2,
    password_hash::{PasswordHasher, SaltString},
};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State, rejection::JsonRejection},
    http::StatusCode,
    routing::get,
};
use email_address::EmailAddress;
use infrastructure::{Database, InitializeInstallationError, InstallationAdministrator};
use rand_core::OsRng;
use std::{
    str::FromStr,
    sync::{Arc, LazyLock},
};
use tokio::sync::Semaphore;
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_INITIALIZATION_BODY_BYTES: usize = 4 * 1024;
static INITIALIZATION_ATTEMPTS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(1)));

type ApiError = (StatusCode, Json<ErrorResponse>);

struct ValidatedInitialization {
    username: String,
    email: String,
    display_name: String,
    password: Zeroizing<String>,
}

pub(crate) fn router() -> Router<Database> {
    // Source: https://docs.rs/axum/0.8.9/axum/struct.Router.html#method.route
    Router::new()
        .route("/api/v1/installation", get(status).post(initialize))
        // Source: https://docs.rs/axum/0.8.9/axum/extract/struct.DefaultBodyLimit.html
        .layer(DefaultBodyLimit::max(MAX_INITIALIZATION_BODY_BYTES))
}

// Source: https://docs.rs/utoipa/5.5.0/utoipa/attr.path.html
#[utoipa::path(
    get,
    path = "/api/v1/installation",
    operation_id = "getInstallationStatus",
    tag = "installation",
    responses(
        (
            status = 200,
            description = "Whether this DaoYun instance has completed initial setup",
            body = ApiResponse<InstallationStatus>,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (
            status = 503,
            description = "The installation state is temporarily unavailable",
            body = ErrorResponse,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        )
    )
)]
pub(crate) async fn status(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<ApiResponse<InstallationStatus>>, (StatusCode, Json<ErrorResponse>)> {
    let is_initialized = database.installation_status().await.map_err(|error| {
        tracing::warn!(
            request_id = %request_id,
            error = %error,
            "Installation status query failed"
        );
        status_unavailable(request_id)
    })?;

    Ok(Json(ApiResponse::new(
        InstallationStatus { is_initialized },
        request_id,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/installation",
    operation_id = "initializeInstallation",
    tag = "installation",
    request_body = InitializeInstallationRequest,
    responses(
        (
            status = 201,
            description = "The first super administrator was created and setup completed",
            body = ApiResponse<InstallationInitialization>,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (
            status = 409,
            description = "This DaoYun instance has already completed setup",
            body = ErrorResponse,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (
            status = 422,
            description = "The request body or administrator fields are invalid",
            body = ErrorResponse,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (
            status = 500,
            description = "The password credential could not be prepared",
            body = ErrorResponse,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (
            status = 503,
            description = "The installation transaction is temporarily unavailable",
            body = ErrorResponse,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        )
    )
)]
pub(crate) async fn initialize(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    request: Result<Json<InitializeInstallationRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<InstallationInitialization>>), ApiError> {
    let Json(request) = request.map_err(|_| malformed_body(request_id))?;
    let input =
        validate_initialization(request).map_err(|fields| validation_error(request_id, fields))?;

    let attempt = Arc::clone(&INITIALIZATION_ATTEMPTS)
        .acquire_owned()
        .await
        .expect("the static initialization semaphore is never closed");
    let is_initialized = database.installation_status().await.map_err(|error| {
        tracing::warn!(
            request_id = %request_id,
            error = %error,
            "Installation preflight query failed"
        );
        initialization_unavailable(request_id)
    })?;

    if is_initialized {
        return Err(already_initialized(request_id));
    }

    let ValidatedInitialization {
        username,
        email,
        display_name,
        password,
    } = input;
    let (password_hash, _attempt) = tokio::task::spawn_blocking(move || {
        prepare_password_hash(password).map(|password_hash| (password_hash, attempt))
    })
    .await
    .map_err(|error| {
        tracing::error!(
            request_id = %request_id,
            error = ?error,
            "Password hashing task failed"
        );
        internal_error(request_id)
    })?
    .map_err(|error| {
        tracing::error!(
            request_id = %request_id,
            error = ?error,
            "Password hashing failed"
        );
        internal_error(request_id)
    })?;

    let administrator = InitialAdministrator {
        id: Uuid::now_v7(),
        username,
        email,
        display_name,
    };
    let persistence_input = InstallationAdministrator {
        id: administrator.id,
        username: administrator.username.clone(),
        email: administrator.email.clone(),
        display_name: administrator.display_name.clone(),
        password_hash,
    };

    match database.initialize_installation(persistence_input).await {
        Ok(()) => Ok((
            StatusCode::CREATED,
            Json(ApiResponse::new(
                InstallationInitialization {
                    is_initialized: true,
                    administrator,
                },
                request_id,
            )),
        )),
        Err(InitializeInstallationError::AlreadyInitialized) => {
            Err(already_initialized(request_id))
        }
        Err(InitializeInstallationError::Database(error)) => {
            tracing::warn!(
                request_id = %request_id,
                error = %error,
                "Installation transaction failed"
            );
            Err(initialization_unavailable(request_id))
        }
    }
}

fn validate_initialization(
    request: InitializeInstallationRequest,
) -> Result<ValidatedInitialization, FieldErrors> {
    let mut fields = FieldErrors::new();
    let username = request.username;
    let email = request.email.trim().to_owned();
    let display_name = request.display_name.trim().to_owned();
    let password = Zeroizing::new(request.password);

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

    let password_length = password.chars().count();
    if !(6..=128).contains(&password_length) {
        add_field_error(
            &mut fields,
            "password",
            "密码长度必须在 6 到 128 个字符之间",
        );
    }

    if fields.is_empty() {
        Ok(ValidatedInitialization {
            username,
            email,
            display_name,
            password,
        })
    } else {
        Err(fields)
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

fn prepare_password_hash(
    password: Zeroizing<String>,
) -> Result<String, argon2::password_hash::Error> {
    // Sources:
    // https://docs.rs/argon2/0.5.3/argon2/#password-hashing
    // https://docs.rs/zeroize/1.9.0/zeroize/struct.Zeroizing.html
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
}

fn add_field_error(fields: &mut FieldErrors, field: &'static str, message: &'static str) {
    fields
        .entry(field.to_owned())
        .or_default()
        .push(message.to_owned());
}

fn malformed_body(request_id: RequestId) -> ApiError {
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
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(ErrorResponse::new(body, request_id)),
    )
}

fn already_initialized(request_id: RequestId) -> ApiError {
    (
        StatusCode::CONFLICT,
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::INSTALLATION_ALREADY_INITIALIZED),
                "当前实例已经完成初始化",
            ),
            request_id,
        )),
    )
}

fn internal_error(request_id: RequestId) -> ApiError {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::INTERNAL_ERROR),
                "管理员凭据暂时无法创建",
            ),
            request_id,
        )),
    )
}

fn status_unavailable(request_id: RequestId) -> ApiError {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
                "安装状态暂时无法读取",
            ),
            request_id,
        )),
    )
}

fn initialization_unavailable(request_id: RequestId) -> ApiError {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
                "安装初始化暂时无法完成",
            ),
            request_id,
        )),
    )
}
