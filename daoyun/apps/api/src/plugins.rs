use std::{sync::Arc, time::Instant};

use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, FieldErrors, InstallPluginRequest,
    InvokePluginRequest, Plugin, PluginCapability as ContractPluginCapability, PluginInvocation,
    PluginOperation as ContractPluginOperation, PluginStatus, PluginUiSchema, RequestId,
    UpdatePluginRequest, error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::{HeaderMap, StatusCode},
    routing::get,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use infrastructure::{
    Database, InstallPluginRecord, ListPluginsError, PluginExecutableRecord, PluginInvokeError,
    PluginMutationError, PluginRecord, UpdatePluginStatusRecord, permission_keys,
};
use plugin_host::{
    MAX_MANIFEST_BYTES, PluginCapability, PluginHost, PluginHostConfig, PluginHostError,
    PluginManifest, PluginOperation,
};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::admin::{authorize_capability_read, authorize_capability_write};
use crate::auth::{ApiError, AuthRuntime};

const PLUGIN_BODY_LIMIT: usize = 12 * 1024 * 1024;

#[derive(Clone, Default)]
pub struct PluginRuntime {
    host: Option<Arc<PluginHost>>,
}

impl PluginRuntime {
    pub const fn disabled() -> Self {
        Self { host: None }
    }

    pub fn enabled(config: PluginHostConfig) -> Result<Self, PluginHostError> {
        Ok(Self {
            host: Some(Arc::new(PluginHost::new(config)?)),
        })
    }

    pub fn from_environment() -> Result<Self, PluginHostError> {
        match std::env::var("DAOYUN_PLUGINS_ENABLED").as_deref() {
            Err(std::env::VarError::NotPresent) | Ok("false" | "0") => Ok(Self::disabled()),
            Ok("true" | "1") => Self::enabled(PluginHostConfig::default()),
            Err(std::env::VarError::NotUnicode(_)) | Ok(_) => {
                Err(PluginHostError::InvalidConfiguration)
            }
        }
    }

    pub const fn is_enabled(&self) -> bool {
        self.host.is_some()
    }

    fn host(&self) -> Option<Arc<PluginHost>> {
        self.host.clone()
    }
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route(
            "/api/v1/admin/plugins",
            get(list_plugins).post(install_plugin),
        )
        .route(
            "/api/v1/admin/plugins/{plugin_id}",
            axum::routing::patch(update_plugin).delete(delete_plugin),
        )
        .route(
            "/api/v1/admin/plugins/{plugin_id}/invoke",
            axum::routing::post(invoke_plugin),
        )
        .layer(DefaultBodyLimit::max(PLUGIN_BODY_LIMIT))
        .layer(Extension(runtime))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/plugins",
    operation_id = "listPlugins",
    tag = "plugins",
    responses(
        (status = 200, body = ApiResponse<Vec<Plugin>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn list_plugins(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Plugin>>>, ApiError> {
    let session = authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::PLUGINS_READ,
    )
    .await?;
    let plugins = database
        .list_plugins(session.user.id)
        .await
        .map_err(|error| list_error(request_id, error))?
        .into_iter()
        .map(map_plugin)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| invalid_record(request_id))?;
    Ok(Json(ApiResponse::new(plugins, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/plugins",
    operation_id = "installPlugin",
    tag = "plugins",
    params(("x-csrf-token" = String, Header)),
    request_body = InstallPluginRequest,
    responses(
        (status = 201, body = ApiResponse<Plugin>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 413, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn install_plugin(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(plugin_runtime): Extension<PluginRuntime>,
    headers: HeaderMap,
    request: Result<Json<InstallPluginRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<Plugin>>), ApiError> {
    let session = authorize_capability_write(
        &database,
        &auth_runtime,
        &headers,
        request_id,
        permission_keys::PLUGINS_INSTALL,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let manifest = map_manifest(request.manifest)
        .map_err(|()| plugin_error(request_id, error_codes::PLUGIN_INVALID_MANIFEST))?;
    validate_manifest_size(&manifest)
        .map_err(|()| plugin_error(request_id, error_codes::PLUGIN_INVALID_MANIFEST))?;
    let component = STANDARD
        .decode(request.component_base64.as_bytes())
        .map_err(|_| {
            field_plugin_error(
                request_id,
                error_codes::PLUGIN_INVALID_COMPONENT,
                "component_base64",
                "组件必须是有效的 base64",
            )
        })?;
    compile_component(
        &plugin_runtime,
        manifest.clone(),
        component.clone(),
        request_id,
    )
    .await?;
    let component_sha256 = format!("{:x}", Sha256::digest(&component));
    let capabilities = manifest
        .capabilities
        .iter()
        .copied()
        .map(capability_key)
        .map(str::to_owned)
        .collect();
    let plugin = database
        .install_plugin(
            session.user.id,
            InstallPluginRecord {
                id: Uuid::now_v7(),
                key: manifest.key,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
                capabilities,
                component_bytes: component,
                component_sha256,
            },
        )
        .await
        .map_err(|error| mutation_error(request_id, error))?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse::new(
            map_plugin(plugin).map_err(|()| invalid_record(request_id))?,
            request_id,
        )),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/plugins/{plugin_id}",
    operation_id = "updatePlugin",
    tag = "plugins",
    params(("plugin_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = UpdatePluginRequest,
    responses(
        (status = 200, body = ApiResponse<Plugin>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update_plugin(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(plugin_runtime): Extension<PluginRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<UpdatePluginRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<Plugin>>, ApiError> {
    let Path(plugin_id) =
        path.map_err(|_| validation_error(request_id, "plugin_id", "插件路径参数必须是 UUID"))?;
    let session = authorize_capability_write(
        &database,
        &auth_runtime,
        &headers,
        request_id,
        permission_keys::PLUGINS_LIFECYCLE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let expected_revision = i64::try_from(request.expected_revision)
        .map_err(|_| validation_error(request_id, "expected_revision", "插件版本号超出范围"))?;
    if request.status == PluginStatus::Enabled {
        let executable = database
            .load_plugin_for_lifecycle(session.user.id, plugin_id)
            .await
            .map_err(|error| mutation_error(request_id, error))?;
        let (manifest, bytes) =
            executable_parts(executable).map_err(|()| invalid_record(request_id))?;
        compile_component(&plugin_runtime, manifest, bytes, request_id).await?;
    }
    let plugin = database
        .update_plugin_status(
            session.user.id,
            UpdatePluginStatusRecord {
                plugin_id,
                status: status_key(request.status).to_owned(),
                expected_revision,
            },
        )
        .await
        .map_err(|error| mutation_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        map_plugin(plugin).map_err(|()| invalid_record(request_id))?,
        request_id,
    )))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/plugins/{plugin_id}",
    operation_id = "deletePlugin",
    tag = "plugins",
    params(("plugin_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    responses(
        (status = 200, body = ApiResponse<bool>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn delete_plugin(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<bool>>, ApiError> {
    let Path(plugin_id) =
        path.map_err(|_| validation_error(request_id, "plugin_id", "插件路径参数必须是 UUID"))?;
    let session = authorize_capability_write(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::PLUGINS_LIFECYCLE,
    )
    .await?;
    database
        .delete_plugin(session.user.id, plugin_id)
        .await
        .map_err(|error| mutation_error(request_id, error))?;
    Ok(Json(ApiResponse::new(true, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/plugins/{plugin_id}/invoke",
    operation_id = "invokePlugin",
    tag = "plugins",
    params(("plugin_id" = Uuid, Path), ("x-csrf-token" = String, Header)),
    request_body = InvokePluginRequest,
    responses(
        (status = 200, body = ApiResponse<PluginInvocation>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn invoke_plugin(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(plugin_runtime): Extension<PluginRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<InvokePluginRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<PluginInvocation>>, ApiError> {
    let Path(plugin_id) =
        path.map_err(|_| validation_error(request_id, "plugin_id", "插件路径参数必须是 UUID"))?;
    let session = authorize_capability_write(
        &database,
        &auth_runtime,
        &headers,
        request_id,
        permission_keys::PLUGINS_INVOKE,
    )
    .await?;
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    let operation = map_operation(request.operation);
    let executable = database
        .load_plugin_for_invoke(
            session.user.id,
            plugin_id,
            capability_key(operation.required_capability()),
        )
        .await
        .map_err(|error| invoke_error(request_id, error))?;
    let plugin_key = executable.key.clone();
    let (manifest, bytes) =
        executable_parts(executable).map_err(|()| invalid_record(request_id))?;
    let output = invoke_component(
        &plugin_runtime,
        manifest,
        bytes,
        operation,
        request.payload.into_bytes(),
        plugin_id,
        plugin_key,
        request_id,
    )
    .await?;
    let payload = String::from_utf8(output)
        .map_err(|_| plugin_error(request_id, error_codes::PLUGIN_OUTPUT_INVALID))?;
    let ui_schema = if request.operation == ContractPluginOperation::UiRender {
        Some(
            serde_json::from_str::<PluginUiSchema>(&payload)
                .map_err(|_| plugin_error(request_id, error_codes::PLUGIN_OUTPUT_INVALID))?,
        )
    } else {
        None
    };
    Ok(Json(ApiResponse::new(
        PluginInvocation {
            operation: request.operation,
            payload,
            ui_schema,
        },
        request_id,
    )))
}

async fn compile_component(
    runtime: &PluginRuntime,
    manifest: PluginManifest,
    bytes: Vec<u8>,
    request_id: RequestId,
) -> Result<(), ApiError> {
    let host = runtime
        .host()
        .ok_or_else(|| plugin_runtime_unavailable(request_id))?;
    tokio::task::spawn_blocking(move || host.compile(manifest, &bytes).map(|_| ()))
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Plugin compiler task failed");
            plugin_error(request_id, error_codes::PLUGIN_EXECUTION_FAILED)
        })?
        .map_err(|error| host_error(request_id, error))
}

#[allow(clippy::too_many_arguments)]
async fn invoke_component(
    runtime: &PluginRuntime,
    manifest: PluginManifest,
    bytes: Vec<u8>,
    operation: PluginOperation,
    input: Vec<u8>,
    plugin_id: Uuid,
    plugin_key: String,
    request_id: RequestId,
) -> Result<Vec<u8>, ApiError> {
    let host = runtime
        .host()
        .ok_or_else(|| plugin_runtime_unavailable(request_id))?;
    let started = Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        let plugin = host.compile(manifest, &bytes)?;
        host.invoke(&plugin, operation, &input)
    })
    .await
    .map_err(|error| {
        tracing::warn!(request_id = %request_id, plugin_id = %plugin_id, plugin_key, error = %error, "Plugin invocation task failed");
        plugin_error(request_id, error_codes::PLUGIN_EXECUTION_FAILED)
    })?;
    let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    match result {
        Ok(output) => {
            tracing::info!(request_id = %request_id, plugin_id = %plugin_id, plugin_key, elapsed_ms, "Plugin invocation completed");
            Ok(output)
        }
        Err(error) => {
            tracing::warn!(request_id = %request_id, plugin_id = %plugin_id, plugin_key, error = ?error, elapsed_ms, "Plugin invocation rejected");
            Err(host_error(request_id, error))
        }
    }
}

fn map_manifest(request: api_contract::PluginManifestRequest) -> Result<PluginManifest, ()> {
    let mut capabilities = request
        .capabilities
        .into_iter()
        .map(map_capability)
        .collect::<Vec<_>>();
    capabilities.sort_by_key(|capability| capability_key(*capability));
    let manifest = PluginManifest {
        schema_version: request.schema_version,
        key: request.key,
        name: request.name,
        version: request.version,
        description: request.description,
        capabilities,
    };
    manifest.validate().map_err(|_| ())?;
    Ok(manifest)
}

fn validate_manifest_size(manifest: &PluginManifest) -> Result<(), ()> {
    let bytes = serde_json::to_vec(manifest).map_err(|_| ())?;
    (bytes.len() <= MAX_MANIFEST_BYTES).then_some(()).ok_or(())
}

fn executable_parts(record: PluginExecutableRecord) -> Result<(PluginManifest, Vec<u8>), ()> {
    if format!("{:x}", Sha256::digest(&record.component_bytes)) != record.component_sha256 {
        return Err(());
    }
    let capabilities = record
        .capabilities
        .iter()
        .map(|capability| parse_host_capability(capability))
        .collect::<Option<Vec<_>>>()
        .ok_or(())?;
    let manifest = PluginManifest {
        schema_version: 1,
        key: record.key,
        name: record.name,
        version: record.version,
        description: record.description,
        capabilities,
    };
    manifest.validate().map_err(|_| ())?;
    Ok((manifest, record.component_bytes))
}

fn map_plugin(record: PluginRecord) -> Result<Plugin, ()> {
    Ok(Plugin {
        id: record.id,
        key: record.key,
        name: record.name,
        version: record.version,
        description: record.description,
        capabilities: record
            .capabilities
            .iter()
            .map(|capability| parse_contract_capability(capability))
            .collect::<Option<Vec<_>>>()
            .ok_or(())?,
        component_sha256: record.component_sha256,
        component_size: u64::try_from(record.component_size).map_err(|_| ())?,
        status: match record.status.as_str() {
            "disabled" => PluginStatus::Disabled,
            "enabled" => PluginStatus::Enabled,
            _ => return Err(()),
        },
        revision: u64::try_from(record.revision).map_err(|_| ())?,
        installed_by: record.installed_by,
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
    })
}

const fn map_capability(capability: ContractPluginCapability) -> PluginCapability {
    match capability {
        ContractPluginCapability::ContentTransform => PluginCapability::ContentTransform,
        ContractPluginCapability::UiPanel => PluginCapability::UiPanel,
    }
}

const fn map_operation(operation: ContractPluginOperation) -> PluginOperation {
    match operation {
        ContractPluginOperation::ContentTransform => PluginOperation::ContentTransform,
        ContractPluginOperation::UiRender => PluginOperation::UiRender,
    }
}

const fn capability_key(capability: PluginCapability) -> &'static str {
    match capability {
        PluginCapability::ContentTransform => "content.transform",
        PluginCapability::UiPanel => "ui.panel",
    }
}

const fn status_key(status: PluginStatus) -> &'static str {
    match status {
        PluginStatus::Disabled => "disabled",
        PluginStatus::Enabled => "enabled",
    }
}

fn parse_host_capability(value: &str) -> Option<PluginCapability> {
    Some(match value {
        "content.transform" => PluginCapability::ContentTransform,
        "ui.panel" => PluginCapability::UiPanel,
        _ => return None,
    })
}

fn parse_contract_capability(value: &str) -> Option<ContractPluginCapability> {
    Some(match value {
        "content.transform" => ContractPluginCapability::ContentTransform,
        "ui.panel" => ContractPluginCapability::UiPanel,
        _ => return None,
    })
}

fn list_error(request_id: RequestId, error: ListPluginsError) -> ApiError {
    match error {
        ListPluginsError::Forbidden => forbidden(request_id),
        ListPluginsError::Database(error) => database_error(request_id, error),
    }
}

fn mutation_error(request_id: RequestId, error: PluginMutationError) -> ApiError {
    match error {
        PluginMutationError::Forbidden => forbidden(request_id),
        PluginMutationError::NotFound => error_response(
            StatusCode::NOT_FOUND,
            error_codes::PLUGIN_NOT_FOUND,
            "插件不存在",
            request_id,
        ),
        PluginMutationError::Conflict | PluginMutationError::MustBeDisabled => error_response(
            StatusCode::CONFLICT,
            error_codes::PLUGIN_CONFLICT,
            "插件键、状态或版本已变化",
            request_id,
        ),
        PluginMutationError::InvalidInput => {
            plugin_error(request_id, error_codes::PLUGIN_INVALID_MANIFEST)
        }
        PluginMutationError::Database(error) => database_error(request_id, error),
    }
}

fn invoke_error(request_id: RequestId, error: PluginInvokeError) -> ApiError {
    match error {
        PluginInvokeError::Forbidden => forbidden(request_id),
        PluginInvokeError::NotFound => error_response(
            StatusCode::NOT_FOUND,
            error_codes::PLUGIN_NOT_FOUND,
            "插件不存在",
            request_id,
        ),
        PluginInvokeError::Disabled => error_response(
            StatusCode::CONFLICT,
            error_codes::PLUGIN_DISABLED,
            "插件当前未启用",
            request_id,
        ),
        PluginInvokeError::CapabilityDenied => error_response(
            StatusCode::FORBIDDEN,
            error_codes::PLUGIN_CAPABILITY_DENIED,
            "插件未声明所需能力",
            request_id,
        ),
        PluginInvokeError::Database(error) => database_error(request_id, error),
    }
}

fn plugin_runtime_unavailable(request_id: RequestId) -> ApiError {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::PLUGIN_EXECUTION_FAILED,
        "插件运行时未启用",
        request_id,
    )
}

fn host_error(request_id: RequestId, error: PluginHostError) -> ApiError {
    match error {
        PluginHostError::InvalidManifest => {
            plugin_error(request_id, error_codes::PLUGIN_INVALID_MANIFEST)
        }
        PluginHostError::InvalidComponent => {
            plugin_error(request_id, error_codes::PLUGIN_INVALID_COMPONENT)
        }
        PluginHostError::CapabilityDenied => error_response(
            StatusCode::FORBIDDEN,
            error_codes::PLUGIN_CAPABILITY_DENIED,
            "插件未声明所需能力",
            request_id,
        ),
        PluginHostError::InputTooLarge => {
            validation_error(request_id, "payload", "插件输入超出大小限制")
        }
        PluginHostError::OutputTooLarge | PluginHostError::InvalidUiSchema => {
            plugin_error(request_id, error_codes::PLUGIN_OUTPUT_INVALID)
        }
        PluginHostError::ResourceExhausted => {
            plugin_error(request_id, error_codes::PLUGIN_RESOURCE_EXHAUSTED)
        }
        PluginHostError::ExecutionFailed | PluginHostError::InvalidConfiguration => {
            plugin_error(request_id, error_codes::PLUGIN_EXECUTION_FAILED)
        }
    }
}

fn forbidden(request_id: RequestId) -> ApiError {
    error_response(
        StatusCode::FORBIDDEN,
        error_codes::ADMIN_FORBIDDEN,
        "当前账号没有执行此插件操作的权限",
        request_id,
    )
}

fn validation_error(request_id: RequestId, field: &'static str, message: &'static str) -> ApiError {
    let mut fields = FieldErrors::new();
    fields.insert(field.to_owned(), vec![message.to_owned()]);
    let mut body = ErrorBody::new(
        ErrorCode::from_static(error_codes::VALIDATION_FAILED),
        "请求参数校验失败",
    );
    body.fields = fields;
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        HeaderMap::new(),
        Json(ErrorResponse::new(body, request_id)),
    )
}

fn plugin_error(request_id: RequestId, code: &'static str) -> ApiError {
    error_response(
        StatusCode::UNPROCESSABLE_ENTITY,
        code,
        "插件请求无法完成",
        request_id,
    )
}

fn field_plugin_error(
    request_id: RequestId,
    code: &'static str,
    field: &'static str,
    message: &'static str,
) -> ApiError {
    let mut body = ErrorBody::new(ErrorCode::from_static(code), "插件请求无法完成");
    body.fields
        .insert(field.to_owned(), vec![message.to_owned()]);
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        HeaderMap::new(),
        Json(ErrorResponse::new(body, request_id)),
    )
}

fn database_error(request_id: RequestId, error: infrastructure::DatabaseError) -> ApiError {
    tracing::warn!(request_id = %request_id, error = %error, "Plugin database operation failed");
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::DATABASE_UNAVAILABLE,
        "插件管理暂时不可用",
        request_id,
    )
}

fn invalid_record(request_id: RequestId) -> ApiError {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        error_codes::DATABASE_UNAVAILABLE,
        "插件管理暂时不可用",
        request_id,
    )
}

fn error_response(
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

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .expect("plugin timestamp must format")
}
