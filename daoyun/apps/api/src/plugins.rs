use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
    time::Instant,
};

use api_contract::{
    ApiResponse, BusinessPluginCapability as ContractBusinessPluginCapability, ErrorBody,
    ErrorCode, ErrorResponse, ExecutePluginUiActionRequest, FieldErrors, InstallPluginRequest,
    InvokePluginRequest, LegacyPluginCapability as ContractLegacyPluginCapability, Plugin,
    PluginBusinessApiVersion as ContractPluginBusinessApiVersion,
    PluginCapability as ContractPluginCapability, PluginDataScope as ContractPluginDataScope,
    PluginEventSubscription as ContractPluginEventSubscription, PluginInvocation,
    PluginOperation as ContractPluginOperation, PluginSchemaVersion, PluginStatus,
    PluginUiActionResult, PluginUiContribution, PluginUiSchema, PluginUiSlot,
    PluginUiSurfaceContribution, RequestId, UpdatePluginRequest, error_codes,
};
use axum::{
    Extension, Json, Router,
    body::to_bytes,
    extract::{
        DefaultBodyLimit, Path, Request, State, rejection::JsonRejection, rejection::PathRejection,
    },
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, RETRY_AFTER, VARY},
    },
    routing::get,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use infrastructure::{
    Database, InstallPluginRecord, ListPluginsError, PluginBusinessExecutableRecord,
    PluginExecutableRecord, PluginInvokeError, PluginMutationError, PluginRecord,
    PluginRuntimeError, UpdatePluginStatusRecord, permission_keys,
};
use plugin_host::{
    CompiledPlugin, MAX_MANIFEST_BYTES, PluginCapability, PluginDataScope, PluginEventSubscription,
    PluginHost, PluginHostConfig, PluginHostError, PluginManifest, PluginOperation,
    business::{BusinessPluginHost, CompiledBusinessPlugin},
    valid_ui_action_key,
};
use serde::Deserialize;
use serde_json::value::RawValue;
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use crate::admin::{authorize_capability_read, authorize_capability_write};
use crate::auth::{
    ApiError, AuthRuntime, authenticate_optional_session, authenticate_session,
    authenticate_state_change,
};
use crate::plugin_business::{
    PluginBusinessExecutionError, execute_plugin_ui_action, render_plugin_ui_contributions,
    render_plugin_ui_surface,
};

const PLUGIN_BODY_LIMIT: usize = 12 * 1024 * 1024;
const PLUGIN_UI_ACTION_BODY_LIMIT: usize = 16 * 1024;
const MAX_CONCURRENT_PLUGIN_JOBS: usize = 4;
const MAX_CONCURRENT_JOBS_PER_BUSINESS_PLUGIN: usize = 1;
const MAX_CACHED_PLUGIN_COMPONENTS: usize = 128;
const MAX_TRACKED_PLUGIN_UI_ACTION_ACTORS: usize = 4_096;
const PLUGIN_UI_ACTION_RATE_WINDOW: std::time::Duration = std::time::Duration::from_secs(1);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawInstallPluginRequest {
    manifest: Box<RawValue>,
    component_base64: String,
}

#[derive(Clone)]
pub struct PluginRuntime {
    host: Option<Arc<PluginHost>>,
    business_host: Option<Arc<BusinessPluginHost>>,
    execution_slots: Arc<Semaphore>,
    business_execution_slots: Arc<Mutex<HashMap<Uuid, Weak<Semaphore>>>>,
    ui_action_attempts: Arc<Mutex<HashMap<(Uuid, Uuid), Instant>>>,
    compiled_components: Arc<Mutex<HashMap<String, Arc<CompiledPlugin>>>>,
    compiled_business_components: Arc<Mutex<HashMap<String, Arc<CompiledBusinessPlugin>>>>,
}

impl Default for PluginRuntime {
    fn default() -> Self {
        Self::disabled()
    }
}

impl PluginRuntime {
    pub fn disabled() -> Self {
        Self {
            host: None,
            business_host: None,
            execution_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_PLUGIN_JOBS)),
            business_execution_slots: Arc::new(Mutex::new(HashMap::new())),
            ui_action_attempts: Arc::new(Mutex::new(HashMap::new())),
            compiled_components: Arc::new(Mutex::new(HashMap::new())),
            compiled_business_components: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn enabled(config: PluginHostConfig) -> Result<Self, PluginHostError> {
        Ok(Self {
            host: Some(Arc::new(PluginHost::new(config)?)),
            business_host: Some(Arc::new(BusinessPluginHost::new(config)?)),
            execution_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_PLUGIN_JOBS)),
            business_execution_slots: Arc::new(Mutex::new(HashMap::new())),
            ui_action_attempts: Arc::new(Mutex::new(HashMap::new())),
            compiled_components: Arc::new(Mutex::new(HashMap::new())),
            compiled_business_components: Arc::new(Mutex::new(HashMap::new())),
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

    pub(crate) fn host(&self) -> Option<Arc<PluginHost>> {
        self.host.clone()
    }

    pub(crate) fn business_host(&self) -> Option<Arc<BusinessPluginHost>> {
        self.business_host.clone()
    }

    pub(crate) async fn execution_permit(&self) -> OwnedSemaphorePermit {
        self.execution_slots
            .clone()
            .acquire_owned()
            .await
            .expect("plugin execution semaphore is never closed")
    }

    pub(crate) fn try_business_execution_permit(
        &self,
        plugin_id: Uuid,
    ) -> Option<PluginBusinessExecutionPermit> {
        let plugin = self
            .business_execution_slots(plugin_id)
            .try_acquire_owned()
            .ok()?;
        let global = self.execution_slots.clone().try_acquire_owned().ok()?;
        Some(PluginBusinessExecutionPermit {
            _plugin: plugin,
            _global: global,
        })
    }

    pub(crate) fn allow_plugin_ui_action(&self, actor_id: Uuid, plugin_id: Uuid) -> bool {
        let now = Instant::now();
        let mut attempts = self
            .ui_action_attempts
            .lock()
            .expect("plugin UI action registry is never poisoned");
        if attempts.len() >= MAX_TRACKED_PLUGIN_UI_ACTION_ACTORS {
            attempts.retain(|_, attempted_at| now.duration_since(*attempted_at).as_secs() < 60);
            if attempts.len() >= MAX_TRACKED_PLUGIN_UI_ACTION_ACTORS
                && !attempts.contains_key(&(actor_id, plugin_id))
            {
                return false;
            }
        }
        let key = (actor_id, plugin_id);
        if attempts.get(&key).is_some_and(|attempted_at| {
            now.duration_since(*attempted_at) < PLUGIN_UI_ACTION_RATE_WINDOW
        }) {
            return false;
        }
        attempts.insert(key, now);
        true
    }

    fn business_execution_slots(&self, plugin_id: Uuid) -> Arc<Semaphore> {
        {
            let mut slots = self
                .business_execution_slots
                .lock()
                .expect("plugin execution slot registry is never poisoned");
            if slots.len() >= MAX_CACHED_PLUGIN_COMPONENTS {
                slots.retain(|_, semaphore| semaphore.strong_count() > 0);
            }
            if let Some(semaphore) = slots.get(&plugin_id).and_then(Weak::upgrade) {
                semaphore
            } else {
                let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_JOBS_PER_BUSINESS_PLUGIN));
                slots.insert(plugin_id, Arc::downgrade(&semaphore));
                semaphore
            }
        }
    }

    fn cached_component(&self, key: &str) -> Option<Arc<CompiledPlugin>> {
        self.compiled_components.lock().ok()?.get(key).cloned()
    }

    fn cache_component(&self, key: String, component: Arc<CompiledPlugin>) {
        let Ok(mut cache) = self.compiled_components.lock() else {
            return;
        };
        if cache.len() >= MAX_CACHED_PLUGIN_COMPONENTS && !cache.contains_key(&key) {
            cache.clear();
        }
        cache.insert(key, component);
    }

    pub(crate) fn cached_business_component(
        &self,
        key: &str,
    ) -> Option<Arc<CompiledBusinessPlugin>> {
        self.compiled_business_components
            .lock()
            .ok()?
            .get(key)
            .cloned()
    }

    pub(crate) fn cache_business_component(
        &self,
        key: String,
        component: Arc<CompiledBusinessPlugin>,
    ) {
        let Ok(mut cache) = self.compiled_business_components.lock() else {
            return;
        };
        if cache.len() >= MAX_CACHED_PLUGIN_COMPONENTS && !cache.contains_key(&key) {
            cache.clear();
        }
        cache.insert(key, component);
    }
}

pub(crate) struct PluginBusinessExecutionPermit {
    _plugin: OwnedSemaphorePermit,
    _global: OwnedSemaphorePermit,
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
        .route(
            "/api/v1/admin/plugins/{plugin_id}/ui-contributions",
            get(plugin_ui_contributions),
        )
        .route(
            "/api/v1/admin/plugins/{plugin_id}/ui-actions",
            axum::routing::post(plugin_ui_action),
        )
        .route(
            "/api/v1/plugin-ui/{slot}/{subject_id}",
            get(plugin_ui_surface),
        )
        .route(
            "/api/v1/plugin-ui/{slot}/{subject_id}/{plugin_id}/actions",
            axum::routing::post(plugin_ui_surface_action),
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
    request: Request,
) -> Result<(StatusCode, Json<ApiResponse<Plugin>>), ApiError> {
    let headers = request.headers().clone();
    let session = authorize_capability_write(
        &database,
        &auth_runtime,
        &headers,
        request_id,
        permission_keys::PLUGINS_INSTALL,
    )
    .await?;
    let body = to_bytes(request.into_body(), PLUGIN_BODY_LIMIT)
        .await
        .map_err(|_| body_too_large(request_id))?;
    let request = serde_json::from_slice::<RawInstallPluginRequest>(&body)
        .map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    if request.manifest.get().len() > MAX_MANIFEST_BYTES {
        return Err(plugin_error(
            request_id,
            error_codes::PLUGIN_INVALID_MANIFEST,
        ));
    }
    let manifest_request = serde_json::from_str(request.manifest.get())
        .map_err(|_| plugin_error(request_id, error_codes::PLUGIN_INVALID_MANIFEST))?;
    let manifest = map_manifest(manifest_request)
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
    let mut capabilities: Vec<_> = manifest
        .capabilities
        .iter()
        .copied()
        .map(capability_key)
        .map(str::to_owned)
        .collect();
    capabilities.sort_unstable();
    let mut data_scopes: Vec<_> = manifest
        .data_scopes
        .iter()
        .copied()
        .map(data_scope_key)
        .map(str::to_owned)
        .collect();
    data_scopes.sort_unstable();
    let mut event_subscriptions: Vec<_> = manifest
        .event_subscriptions
        .iter()
        .copied()
        .map(event_subscription_key)
        .map(str::to_owned)
        .collect();
    event_subscriptions.sort_unstable();
    let plugin = database
        .install_plugin(
            session.user.id,
            InstallPluginRecord {
                id: Uuid::now_v7(),
                key: manifest.key,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
                manifest_schema_version: i16::try_from(manifest.schema_version)
                    .map_err(|_| invalid_record(request_id))?,
                business_api_version: manifest.business_api_version,
                capabilities,
                data_scopes,
                event_subscriptions,
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

#[utoipa::path(
    get,
    path = "/api/v1/admin/plugins/{plugin_id}/ui-contributions",
    operation_id = "listPluginUiContributions",
    tag = "plugins",
    params(("plugin_id" = Uuid, Path)),
    responses(
        (status = 200, body = ApiResponse<Vec<PluginUiContribution>>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn plugin_ui_contributions(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    Extension(plugin_runtime): Extension<PluginRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<Vec<PluginUiContribution>>>, ApiError> {
    let Path(plugin_id) =
        path.map_err(|_| validation_error(request_id, "plugin_id", "插件路径参数必须是 UUID"))?;
    let session = authorize_capability_read(
        &database,
        &runtime,
        &headers,
        request_id,
        permission_keys::PLUGINS_READ,
    )
    .await?;
    let rendered_contributions = render_plugin_ui_contributions(
        database,
        plugin_runtime,
        plugin_id,
        Some(session.user.id),
        None,
        plugin_host::business::UiSlot::AdminPlugin,
        request_id.into(),
    )
    .await
    .map_err(|error| business_execution_error(request_id, error))?;
    let mut contributions = Vec::with_capacity(rendered_contributions.len());
    for contribution in rendered_contributions {
        let schema = match serde_json::from_str::<PluginUiSchema>(&contribution.schema_json) {
            Ok(schema) => schema,
            Err(_) => {
                return Err(plugin_error(request_id, error_codes::PLUGIN_OUTPUT_INVALID));
            }
        };
        let slot = match contribution.slot {
            plugin_host::business::UiSlot::UserProfile => PluginUiSlot::UserProfile,
            plugin_host::business::UiSlot::MembershipPanel => PluginUiSlot::MembershipPanel,
            plugin_host::business::UiSlot::AdminUser => PluginUiSlot::AdminUser,
            plugin_host::business::UiSlot::AdminPlugin => PluginUiSlot::AdminPlugin,
        };
        contributions.push(PluginUiContribution { slot, schema });
    }
    Ok(Json(ApiResponse::new(contributions, request_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/plugins/{plugin_id}/ui-actions",
    operation_id = "executePluginUiAction",
    tag = "plugins",
    params(
        ("plugin_id" = Uuid, Path),
        ("x-csrf-token" = String, Header)
    ),
    request_body = ExecutePluginUiActionRequest,
    responses(
        (status = 200, body = ApiResponse<PluginUiActionResult>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn plugin_ui_action(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(plugin_runtime): Extension<PluginRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    request: Result<Json<ExecutePluginUiActionRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<PluginUiActionResult>>, ApiError> {
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
    if !plugin_runtime.allow_plugin_ui_action(session.user.id, plugin_id) {
        return Err(plugin_action_rate_limited(request_id));
    }
    let Json(request) =
        request.map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    if request.slot != PluginUiSlot::AdminPlugin
        || request.subject_id.is_some()
        || !valid_ui_action_key(&request.action_key)
        || !(1..=160).contains(&request.idempotency_key.len())
        || request.idempotency_key.chars().any(char::is_control)
    {
        return Err(validation_error(request_id, "body", "插件动作参数不正确"));
    }
    let executed_commands = execute_plugin_ui_action(
        database,
        plugin_runtime,
        plugin_id,
        session.user.id,
        request_id.into(),
        plugin_host::business::UiAction {
            slot: plugin_host::business::UiSlot::AdminPlugin,
            action_key: request.action_key,
            subject_id: None,
            idempotency_key: request.idempotency_key,
        },
    )
    .await
    .map_err(|error| business_execution_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        PluginUiActionResult { executed_commands },
        request_id,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/plugin-ui/{slot}/{subject_id}",
    operation_id = "listPluginUiSurfaceContributions",
    tag = "plugins",
    params(
        ("slot" = PluginUiSlot, Path),
        ("subject_id" = Uuid, Path)
    ),
    responses(
        (status = 200, body = ApiResponse<Vec<PluginUiSurfaceContribution>>, headers(("x-request-id" = String), ("set-cookie" = String), ("cache-control" = String), ("vary" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 413, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 429, body = ErrorResponse, headers(("x-request-id" = String), ("retry-after" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn plugin_ui_surface(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(plugin_runtime): Extension<PluginRuntime>,
    headers: HeaderMap,
    path: Result<Path<(PluginUiSlot, Uuid)>, PathRejection>,
) -> Result<
    (
        HeaderMap,
        Json<ApiResponse<Vec<PluginUiSurfaceContribution>>>,
    ),
    ApiError,
> {
    let Path((slot, subject_id)) =
        path.map_err(|_| validation_error(request_id, "path", "插件插槽路径参数不正确"))?;
    let (actor_id, mut response_headers) = match slot {
        PluginUiSlot::TopicDetail => {
            let (session, mut headers) =
                authenticate_optional_session(&database, &auth_runtime, &headers, request_id)
                    .await?;
            database
                .list_topic_supplements(subject_id, session.map(|s| s.user.id))
                .await
                .map_err(|_| {
                    error_response(
                        StatusCode::NOT_FOUND,
                        error_codes::TOPIC_NOT_FOUND,
                        "帖子不可访问",
                        request_id,
                    )
                })?;
            headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
            headers.insert(VARY, HeaderValue::from_static("Cookie"));
            // The 0.1.0 guest ABI has no topic slot. Never reinterpret a topic as a user.
            return Ok((headers, Json(ApiResponse::new(Vec::new(), request_id))));
        }
        PluginUiSlot::UserProfile => {
            let (session, response_headers) =
                authenticate_optional_session(&database, &auth_runtime, &headers, request_id)
                    .await?;
            (session.map(|session| session.user.id), response_headers)
        }
        PluginUiSlot::MembershipPanel => {
            let (session, _) =
                authenticate_session(&database, &auth_runtime, &headers, request_id).await?;
            if session.user.id != subject_id {
                return Err(forbidden(request_id));
            }
            (Some(session.user.id), HeaderMap::new())
        }
        PluginUiSlot::AdminUser => {
            let session = authorize_capability_read(
                &database,
                &auth_runtime,
                &headers,
                request_id,
                permission_keys::ADMIN_USERS_READ,
            )
            .await?;
            (Some(session.user.id), HeaderMap::new())
        }
        PluginUiSlot::AdminPlugin => {
            return Err(validation_error(request_id, "slot", "该插槽不属于业务页面"));
        }
    };
    response_headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    response_headers.insert(VARY, HeaderValue::from_static("Cookie"));
    ensure_surface_subject(&database, slot, subject_id, request_id).await?;
    let rendered_contributions = render_plugin_ui_surface(
        database,
        plugin_runtime,
        actor_id,
        subject_id,
        map_host_ui_slot(slot, request_id)?,
        request_id.into(),
    )
    .await
    .map_err(|error| surface_runtime_error(request_id, error))?;
    let mut contributions = Vec::with_capacity(rendered_contributions.len());
    for rendered in rendered_contributions {
        let schema =
            match serde_json::from_str::<PluginUiSchema>(&rendered.contribution.schema_json) {
                Ok(schema) => schema,
                Err(_) => {
                    return Err(plugin_error(request_id, error_codes::PLUGIN_OUTPUT_INVALID));
                }
            };
        contributions.push(PluginUiSurfaceContribution {
            plugin_id: rendered.plugin_id,
            plugin_key: rendered.plugin_key,
            slot: map_contract_ui_slot(rendered.contribution.slot),
            schema,
        });
    }
    Ok((
        response_headers,
        Json(ApiResponse::new(contributions, request_id)),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/plugin-ui/{slot}/{subject_id}/{plugin_id}/actions",
    operation_id = "executePluginUiSurfaceAction",
    tag = "plugins",
    params(
        ("slot" = PluginUiSlot, Path),
        ("subject_id" = Uuid, Path),
        ("plugin_id" = Uuid, Path),
        ("x-csrf-token" = String, Header)
    ),
    request_body = ExecutePluginUiActionRequest,
    responses(
        (status = 200, body = ApiResponse<PluginUiActionResult>, headers(("x-request-id" = String))),
        (status = 401, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 403, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn plugin_ui_surface_action(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(auth_runtime): Extension<AuthRuntime>,
    Extension(plugin_runtime): Extension<PluginRuntime>,
    path: Result<Path<(PluginUiSlot, Uuid, Uuid)>, PathRejection>,
    request: Request,
) -> Result<Json<ApiResponse<PluginUiActionResult>>, ApiError> {
    let Path((slot, subject_id, plugin_id)) =
        path.map_err(|_| validation_error(request_id, "path", "插件动作路径参数不正确"))?;
    let headers = request.headers().clone();
    let actor_id = match slot {
        PluginUiSlot::TopicDetail => {
            return Err(validation_error(
                request_id,
                "slot",
                "当前插件契约尚不支持帖子动作",
            ));
        }
        PluginUiSlot::UserProfile => {
            let session =
                authenticate_state_change(&database, &auth_runtime, &headers, request_id).await?;
            if session.user.id != subject_id {
                return Err(forbidden(request_id));
            }
            session.user.id
        }
        PluginUiSlot::MembershipPanel => {
            let session =
                authenticate_state_change(&database, &auth_runtime, &headers, request_id).await?;
            if session.user.id != subject_id {
                return Err(forbidden(request_id));
            }
            session.user.id
        }
        PluginUiSlot::AdminUser => {
            authorize_capability_write(
                &database,
                &auth_runtime,
                &headers,
                request_id,
                permission_keys::ADMIN_USERS_MODERATE,
            )
            .await?
            .user
            .id
        }
        PluginUiSlot::AdminPlugin => {
            return Err(validation_error(request_id, "slot", "该插槽不属于业务页面"));
        }
    };
    ensure_surface_subject(&database, slot, subject_id, request_id).await?;
    if !plugin_runtime.allow_plugin_ui_action(actor_id, plugin_id) {
        return Err(plugin_action_rate_limited(request_id));
    }
    let body = to_bytes(request.into_body(), PLUGIN_UI_ACTION_BODY_LIMIT)
        .await
        .map_err(|_| body_too_large(request_id))?;
    let request = serde_json::from_slice::<ExecutePluginUiActionRequest>(&body)
        .map_err(|_| validation_error(request_id, "body", "请求体格式不正确"))?;
    if request.slot != slot
        || request.subject_id != Some(subject_id)
        || !valid_ui_action_key(&request.action_key)
        || !(1..=160).contains(&request.idempotency_key.len())
        || request.idempotency_key.chars().any(char::is_control)
    {
        return Err(validation_error(request_id, "body", "插件动作参数不正确"));
    }
    let executed_commands = execute_plugin_ui_action(
        database,
        plugin_runtime,
        plugin_id,
        actor_id,
        request_id.into(),
        plugin_host::business::UiAction {
            slot: map_host_ui_slot(slot, request_id)?,
            action_key: request.action_key,
            subject_id: Some(subject_id.to_string()),
            idempotency_key: request.idempotency_key,
        },
    )
    .await
    .map_err(|error| business_execution_error(request_id, error))?;
    Ok(Json(ApiResponse::new(
        PluginUiActionResult { executed_commands },
        request_id,
    )))
}

async fn ensure_surface_subject(
    database: &Database,
    slot: PluginUiSlot,
    subject_id: Uuid,
    request_id: RequestId,
) -> Result<(), ApiError> {
    let exists = match slot {
        PluginUiSlot::TopicDetail => {
            return Err(validation_error(
                request_id,
                "slot",
                "帖子插槽需要帖子访问校验",
            ));
        }
        PluginUiSlot::UserProfile => database.active_user_exists(subject_id).await,
        PluginUiSlot::MembershipPanel | PluginUiSlot::AdminUser => {
            database.admin_user_exists(subject_id).await
        }
        PluginUiSlot::AdminPlugin => {
            return Err(validation_error(request_id, "slot", "插槽不正确"));
        }
    }
    .map_err(|error| database_error(request_id, error))?;
    if exists {
        Ok(())
    } else {
        Err(error_response(
            StatusCode::NOT_FOUND,
            error_codes::USER_NOT_FOUND,
            "用户不存在",
            request_id,
        ))
    }
}

#[allow(clippy::result_large_err)]
fn map_host_ui_slot(
    slot: PluginUiSlot,
    request_id: RequestId,
) -> Result<plugin_host::business::UiSlot, ApiError> {
    Ok(match slot {
        PluginUiSlot::UserProfile => plugin_host::business::UiSlot::UserProfile,
        PluginUiSlot::MembershipPanel => plugin_host::business::UiSlot::MembershipPanel,
        PluginUiSlot::AdminUser => plugin_host::business::UiSlot::AdminUser,
        PluginUiSlot::AdminPlugin => plugin_host::business::UiSlot::AdminPlugin,
        PluginUiSlot::TopicDetail => {
            return Err(validation_error(
                request_id,
                "slot",
                "当前插件契约尚不支持帖子插槽",
            ));
        }
    })
}

const fn map_contract_ui_slot(slot: plugin_host::business::UiSlot) -> PluginUiSlot {
    match slot {
        plugin_host::business::UiSlot::UserProfile => PluginUiSlot::UserProfile,
        plugin_host::business::UiSlot::MembershipPanel => PluginUiSlot::MembershipPanel,
        plugin_host::business::UiSlot::AdminUser => PluginUiSlot::AdminUser,
        plugin_host::business::UiSlot::AdminPlugin => PluginUiSlot::AdminPlugin,
    }
}

async fn compile_component(
    runtime: &PluginRuntime,
    manifest: PluginManifest,
    bytes: Vec<u8>,
    request_id: RequestId,
) -> Result<(), ApiError> {
    let is_business_component = manifest.business_api_version.is_some();
    let permit = runtime.execution_permit().await;
    let runtime = runtime.clone();
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if is_business_component {
            let host = runtime
                .business_host()
                .ok_or(PluginHostError::InvalidConfiguration)?;
            compile_cached_business_component(&runtime, &host, manifest, &bytes).map(|_| ())
        } else {
            let host = runtime
                .host()
                .ok_or(PluginHostError::InvalidConfiguration)?;
            compile_cached_component(&runtime, &host, manifest, &bytes).map(|_| ())
        }
    })
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
    let permit = runtime.execution_permit().await;
    let runtime = runtime.clone();
    let started = Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let plugin = compile_cached_component(&runtime, &host, manifest, &bytes)?;
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

fn compile_cached_component(
    runtime: &PluginRuntime,
    host: &PluginHost,
    manifest: PluginManifest,
    bytes: &[u8],
) -> Result<Arc<CompiledPlugin>, PluginHostError> {
    let cache_key = component_cache_key(&manifest, bytes);
    if let Some(component) = runtime.cached_component(&cache_key) {
        return Ok(component);
    }
    let component = Arc::new(host.compile(manifest, bytes)?);
    runtime.cache_component(cache_key, component.clone());
    Ok(component)
}

pub(crate) fn compile_cached_business_component(
    runtime: &PluginRuntime,
    host: &BusinessPluginHost,
    manifest: PluginManifest,
    bytes: &[u8],
) -> Result<Arc<CompiledBusinessPlugin>, PluginHostError> {
    let cache_key = component_cache_key(&manifest, bytes);
    if let Some(component) = runtime.cached_business_component(&cache_key) {
        return Ok(component);
    }
    let component = Arc::new(host.compile(manifest, bytes)?);
    runtime.cache_business_component(cache_key, component.clone());
    Ok(component)
}

fn component_cache_key(manifest: &PluginManifest, bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    digest.update([0]);
    digest.update(
        serde_json::to_vec(manifest).expect("validated plugin manifest must serialize as JSON"),
    );
    let digest = digest.finalize();
    format!("{digest:x}")
}

fn map_manifest(request: api_contract::PluginManifestRequest) -> Result<PluginManifest, ()> {
    let manifest = match request {
        api_contract::PluginManifestRequest::Legacy(request) => PluginManifest {
            schema_version: request.schema_version.as_u16(),
            key: request.key,
            name: request.name,
            version: request.version,
            description: request.description,
            capabilities: request
                .capabilities
                .into_iter()
                .map(|capability| match capability {
                    ContractLegacyPluginCapability::ContentTransform => {
                        PluginCapability::ContentTransform
                    }
                    ContractLegacyPluginCapability::UiPanel => PluginCapability::UiPanel,
                })
                .collect(),
            business_api_version: None,
            data_scopes: Vec::new(),
            event_subscriptions: Vec::new(),
        },
        api_contract::PluginManifestRequest::Business(request) => PluginManifest {
            schema_version: request.schema_version.as_u16(),
            key: request.key,
            name: request.name,
            version: request.version,
            description: request.description,
            capabilities: request
                .capabilities
                .into_iter()
                .map(|capability| match capability {
                    ContractBusinessPluginCapability::TopicSupplements => {
                        PluginCapability::TopicSupplements
                    }
                    ContractBusinessPluginCapability::TopicEditReview => {
                        PluginCapability::TopicEditReview
                    }
                    ContractBusinessPluginCapability::MembershipRedemption => {
                        PluginCapability::MembershipRedemption
                    }
                    ContractBusinessPluginCapability::CommunityAnalytics => {
                        PluginCapability::CommunityAnalytics
                    }
                    ContractBusinessPluginCapability::TopicPolls => PluginCapability::TopicPolls,
                    ContractBusinessPluginCapability::UiPanel => PluginCapability::UiPanel,
                    ContractBusinessPluginCapability::EventsSubscribe => {
                        PluginCapability::EventsSubscribe
                    }
                    ContractBusinessPluginCapability::CoreQuery => PluginCapability::CoreQuery,
                    ContractBusinessPluginCapability::PointsWrite => PluginCapability::PointsWrite,
                    ContractBusinessPluginCapability::ExperienceWrite => {
                        PluginCapability::ExperienceWrite
                    }
                    ContractBusinessPluginCapability::EntitlementsWrite => {
                        PluginCapability::EntitlementsWrite
                    }
                    ContractBusinessPluginCapability::NotificationsWrite => {
                        PluginCapability::NotificationsWrite
                    }
                    ContractBusinessPluginCapability::StorageReadWrite => {
                        PluginCapability::StorageReadWrite
                    }
                    ContractBusinessPluginCapability::TasksSchedule => {
                        PluginCapability::TasksSchedule
                    }
                })
                .collect(),
            business_api_version: Some(request.business_api_version.as_str().to_owned()),
            data_scopes: request
                .data_scopes
                .into_iter()
                .map(map_data_scope)
                .collect(),
            event_subscriptions: request
                .event_subscriptions
                .into_iter()
                .map(map_event_subscription)
                .collect(),
        },
    };
    manifest.validate().map_err(|_| ())?;
    Ok(manifest)
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
    let data_scopes = record
        .data_scopes
        .iter()
        .map(|scope| parse_host_data_scope(scope))
        .collect::<Option<Vec<_>>>()
        .ok_or(())?;
    let event_subscriptions = record
        .event_subscriptions
        .iter()
        .map(|event| parse_host_event_subscription(event))
        .collect::<Option<Vec<_>>>()
        .ok_or(())?;
    let manifest = PluginManifest {
        schema_version: u16::try_from(record.manifest_schema_version).map_err(|_| ())?,
        key: record.key,
        name: record.name,
        version: record.version,
        description: record.description,
        capabilities,
        business_api_version: record.business_api_version,
        data_scopes,
        event_subscriptions,
    };
    manifest.validate().map_err(|_| ())?;
    Ok((manifest, record.component_bytes))
}

pub(crate) fn business_executable_parts(
    record: PluginBusinessExecutableRecord,
) -> Result<(PluginManifest, Vec<u8>), ()> {
    if format!("{:x}", Sha256::digest(&record.component_bytes)) != record.component_sha256 {
        return Err(());
    }
    let capabilities = record
        .capabilities
        .iter()
        .map(|capability| parse_host_capability(capability))
        .collect::<Option<Vec<_>>>()
        .ok_or(())?;
    let data_scopes = record
        .data_scopes
        .iter()
        .map(|scope| parse_host_data_scope(scope))
        .collect::<Option<Vec<_>>>()
        .ok_or(())?;
    let event_subscriptions = record
        .event_subscriptions
        .iter()
        .map(|event| parse_host_event_subscription(event))
        .collect::<Option<Vec<_>>>()
        .ok_or(())?;
    let manifest = PluginManifest {
        schema_version: u16::try_from(record.manifest_schema_version).map_err(|_| ())?,
        key: record.key,
        name: record.name,
        version: record.version,
        description: record.description,
        capabilities,
        business_api_version: Some(record.business_api_version),
        data_scopes,
        event_subscriptions,
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
        manifest_schema_version: match record.manifest_schema_version {
            1 => PluginSchemaVersion::V1,
            _ => return Err(()),
        },
        business_api_version: match record.business_api_version.as_deref() {
            None => None,
            Some("0.1.0") => Some(ContractPluginBusinessApiVersion::V0_1_0),
            Some(_) => return Err(()),
        },
        capabilities: record
            .capabilities
            .iter()
            .map(|capability| parse_contract_capability(capability))
            .collect::<Option<std::collections::BTreeSet<_>>>()
            .ok_or(())?,
        data_scopes: record
            .data_scopes
            .iter()
            .map(|scope| parse_contract_data_scope(scope))
            .collect::<Option<std::collections::BTreeSet<_>>>()
            .ok_or(())?,
        event_subscriptions: record
            .event_subscriptions
            .iter()
            .map(|event| parse_contract_event_subscription(event))
            .collect::<Option<std::collections::BTreeSet<_>>>()
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

const fn map_data_scope(scope: ContractPluginDataScope) -> PluginDataScope {
    match scope {
        ContractPluginDataScope::SiteRead => PluginDataScope::SiteRead,
        ContractPluginDataScope::ActorRead => PluginDataScope::ActorRead,
        ContractPluginDataScope::UsersReadBasic => PluginDataScope::UsersReadBasic,
        ContractPluginDataScope::UsersReadMembership => PluginDataScope::UsersReadMembership,
        ContractPluginDataScope::UsersTargeted => PluginDataScope::UsersTargeted,
        ContractPluginDataScope::BoardsRead => PluginDataScope::BoardsRead,
    }
}

const fn map_event_subscription(event: ContractPluginEventSubscription) -> PluginEventSubscription {
    match event {
        ContractPluginEventSubscription::UserCreated => PluginEventSubscription::UserCreated,
        ContractPluginEventSubscription::TopicPublished => PluginEventSubscription::TopicPublished,
        ContractPluginEventSubscription::ReplyCreated => PluginEventSubscription::ReplyCreated,
        ContractPluginEventSubscription::PointsChanged => PluginEventSubscription::PointsChanged,
        ContractPluginEventSubscription::ExperienceChanged => {
            PluginEventSubscription::ExperienceChanged
        }
        ContractPluginEventSubscription::EntitlementChanged => {
            PluginEventSubscription::EntitlementChanged
        }
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
        PluginCapability::EventsSubscribe => "events.subscribe",
        PluginCapability::CoreQuery => "core.query",
        PluginCapability::PointsWrite => "points.write",
        PluginCapability::ExperienceWrite => "experience.write",
        PluginCapability::EntitlementsWrite => "entitlements.write",
        PluginCapability::NotificationsWrite => "notifications.write",
        PluginCapability::StorageReadWrite => "storage.read_write",
        PluginCapability::TasksSchedule => "tasks.schedule",
        PluginCapability::TopicSupplements => "topic.supplements",
        PluginCapability::TopicEditReview => "topic.edit_review",
        PluginCapability::MembershipRedemption => "membership.redemption",
        PluginCapability::CommunityAnalytics => "community.analytics",
        PluginCapability::TopicPolls => "topic.polls",
    }
}

const fn data_scope_key(scope: PluginDataScope) -> &'static str {
    match scope {
        PluginDataScope::SiteRead => "site.read",
        PluginDataScope::ActorRead => "actor.read",
        PluginDataScope::UsersReadBasic => "users.read.basic",
        PluginDataScope::UsersReadMembership => "users.read.membership",
        PluginDataScope::UsersTargeted => "users.targeted",
        PluginDataScope::BoardsRead => "boards.read",
    }
}

const fn event_subscription_key(event: PluginEventSubscription) -> &'static str {
    match event {
        PluginEventSubscription::UserCreated => "user.created",
        PluginEventSubscription::TopicPublished => "topic.published",
        PluginEventSubscription::ReplyCreated => "reply.created",
        PluginEventSubscription::PointsChanged => "points.changed",
        PluginEventSubscription::ExperienceChanged => "experience.changed",
        PluginEventSubscription::EntitlementChanged => "entitlement.changed",
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
        "events.subscribe" => PluginCapability::EventsSubscribe,
        "core.query" => PluginCapability::CoreQuery,
        "points.write" => PluginCapability::PointsWrite,
        "experience.write" => PluginCapability::ExperienceWrite,
        "entitlements.write" => PluginCapability::EntitlementsWrite,
        "notifications.write" => PluginCapability::NotificationsWrite,
        "storage.read_write" => PluginCapability::StorageReadWrite,
        "tasks.schedule" => PluginCapability::TasksSchedule,
        "topic.supplements" => PluginCapability::TopicSupplements,
        "topic.edit_review" => PluginCapability::TopicEditReview,
        "membership.redemption" => PluginCapability::MembershipRedemption,
        "community.analytics" => PluginCapability::CommunityAnalytics,
        "topic.polls" => PluginCapability::TopicPolls,
        _ => return None,
    })
}

fn parse_contract_capability(value: &str) -> Option<ContractPluginCapability> {
    Some(match value {
        "content.transform" => ContractPluginCapability::ContentTransform,
        "ui.panel" => ContractPluginCapability::UiPanel,
        "events.subscribe" => ContractPluginCapability::EventsSubscribe,
        "core.query" => ContractPluginCapability::CoreQuery,
        "points.write" => ContractPluginCapability::PointsWrite,
        "experience.write" => ContractPluginCapability::ExperienceWrite,
        "entitlements.write" => ContractPluginCapability::EntitlementsWrite,
        "notifications.write" => ContractPluginCapability::NotificationsWrite,
        "storage.read_write" => ContractPluginCapability::StorageReadWrite,
        "tasks.schedule" => ContractPluginCapability::TasksSchedule,
        "topic.supplements" => ContractPluginCapability::TopicSupplements,
        "topic.edit_review" => ContractPluginCapability::TopicEditReview,
        "membership.redemption" => ContractPluginCapability::MembershipRedemption,
        "community.analytics" => ContractPluginCapability::CommunityAnalytics,
        "topic.polls" => ContractPluginCapability::TopicPolls,
        _ => return None,
    })
}

fn parse_host_data_scope(value: &str) -> Option<PluginDataScope> {
    Some(match value {
        "site.read" => PluginDataScope::SiteRead,
        "actor.read" => PluginDataScope::ActorRead,
        "users.read.basic" => PluginDataScope::UsersReadBasic,
        "users.read.membership" => PluginDataScope::UsersReadMembership,
        "users.targeted" => PluginDataScope::UsersTargeted,
        "boards.read" => PluginDataScope::BoardsRead,
        _ => return None,
    })
}

fn parse_contract_data_scope(value: &str) -> Option<ContractPluginDataScope> {
    Some(match value {
        "site.read" => ContractPluginDataScope::SiteRead,
        "actor.read" => ContractPluginDataScope::ActorRead,
        "users.read.basic" => ContractPluginDataScope::UsersReadBasic,
        "users.read.membership" => ContractPluginDataScope::UsersReadMembership,
        "users.targeted" => ContractPluginDataScope::UsersTargeted,
        "boards.read" => ContractPluginDataScope::BoardsRead,
        _ => return None,
    })
}

fn parse_host_event_subscription(value: &str) -> Option<PluginEventSubscription> {
    Some(match value {
        "user.created" => PluginEventSubscription::UserCreated,
        "topic.published" => PluginEventSubscription::TopicPublished,
        "reply.created" => PluginEventSubscription::ReplyCreated,
        "points.changed" => PluginEventSubscription::PointsChanged,
        "experience.changed" => PluginEventSubscription::ExperienceChanged,
        "entitlement.changed" => PluginEventSubscription::EntitlementChanged,
        _ => return None,
    })
}

fn parse_contract_event_subscription(value: &str) -> Option<ContractPluginEventSubscription> {
    Some(match value {
        "user.created" => ContractPluginEventSubscription::UserCreated,
        "topic.published" => ContractPluginEventSubscription::TopicPublished,
        "reply.created" => ContractPluginEventSubscription::ReplyCreated,
        "points.changed" => ContractPluginEventSubscription::PointsChanged,
        "experience.changed" => ContractPluginEventSubscription::ExperienceChanged,
        "entitlement.changed" => ContractPluginEventSubscription::EntitlementChanged,
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
        PluginMutationError::Busy => error_response(
            StatusCode::CONFLICT,
            error_codes::PLUGIN_CONFLICT,
            "插件仍有执行中的任务",
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

fn business_execution_error(
    request_id: RequestId,
    error: PluginBusinessExecutionError,
) -> ApiError {
    match error {
        PluginBusinessExecutionError::Host(error) => host_error(request_id, error),
        PluginBusinessExecutionError::Busy
        | PluginBusinessExecutionError::Runtime(PluginRuntimeError::Busy) => error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            error_codes::PLUGIN_RESOURCE_EXHAUSTED,
            "插件当前繁忙，请稍后重试",
            request_id,
        ),
        PluginBusinessExecutionError::Runtime(PluginRuntimeError::NotFound) => error_response(
            StatusCode::NOT_FOUND,
            error_codes::PLUGIN_NOT_FOUND,
            "插件不存在",
            request_id,
        ),
        PluginBusinessExecutionError::Runtime(PluginRuntimeError::Disabled) => error_response(
            StatusCode::CONFLICT,
            error_codes::PLUGIN_DISABLED,
            "插件当前未启用",
            request_id,
        ),
        PluginBusinessExecutionError::Runtime(PluginRuntimeError::CapabilityDenied) => {
            error_response(
                StatusCode::FORBIDDEN,
                error_codes::PLUGIN_CAPABILITY_DENIED,
                "插件未声明所需能力",
                request_id,
            )
        }
        PluginBusinessExecutionError::Runtime(PluginRuntimeError::Database(error)) => {
            database_error(request_id, error)
        }
        PluginBusinessExecutionError::Runtime(other) => {
            tracing::warn!(request_id = %request_id, error = %other, "Plugin business execution failed");
            plugin_error(request_id, error_codes::PLUGIN_EXECUTION_FAILED)
        }
    }
}

fn plugin_action_rate_limited(request_id: RequestId) -> ApiError {
    let mut headers = HeaderMap::new();
    headers.insert(RETRY_AFTER, HeaderValue::from_static("1"));
    (
        StatusCode::TOO_MANY_REQUESTS,
        headers,
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::PLUGIN_RATE_LIMITED),
                "插件操作过于频繁，请稍后重试",
            ),
            request_id,
        )),
    )
}

fn surface_runtime_error(request_id: RequestId, error: PluginRuntimeError) -> ApiError {
    match error {
        PluginRuntimeError::Database(error) => database_error(request_id, error),
        other => {
            tracing::warn!(request_id = %request_id, error = %other, "Plugin UI surface failed");
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

fn body_too_large(request_id: RequestId) -> ApiError {
    error_response(
        StatusCode::PAYLOAD_TOO_LARGE,
        error_codes::VALIDATION_FAILED,
        "请求体超出大小限制",
        request_id,
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use plugin_host::{PluginCapability, PluginHostConfig, PluginManifest};

    use super::{MAX_CONCURRENT_PLUGIN_JOBS, PluginRuntime, component_cache_key};

    #[tokio::test]
    async fn plugin_runtime_limits_concurrent_work() {
        let runtime = PluginRuntime::enabled(PluginHostConfig::default())
            .expect("plugin runtime must configure");
        let mut permits = Vec::new();
        for _ in 0..MAX_CONCURRENT_PLUGIN_JOBS {
            permits.push(runtime.execution_permit().await);
        }

        assert!(
            tokio::time::timeout(Duration::from_millis(10), runtime.execution_permit())
                .await
                .is_err()
        );
        permits.pop();
        assert!(
            tokio::time::timeout(Duration::from_millis(10), runtime.execution_permit())
                .await
                .is_ok()
        );
    }

    #[test]
    fn business_plugins_have_independent_single_execution_slots() {
        let runtime = PluginRuntime::enabled(PluginHostConfig::default())
            .expect("plugin runtime must configure");
        let first_plugin = uuid::Uuid::now_v7();
        let second_plugin = uuid::Uuid::now_v7();
        let first = runtime
            .try_business_execution_permit(first_plugin)
            .expect("first plugin execution slot must be available");

        assert!(
            runtime
                .try_business_execution_permit(first_plugin)
                .is_none()
        );
        assert!(
            runtime
                .try_business_execution_permit(second_plugin)
                .is_some()
        );

        drop(first);
        assert!(
            runtime
                .try_business_execution_permit(first_plugin)
                .is_some()
        );
    }

    #[test]
    fn component_cache_is_scoped_to_bytes_and_manifest() {
        let manifest = PluginManifest {
            schema_version: 1,
            key: "cache_test".to_owned(),
            name: "Cache test".to_owned(),
            version: "1.0.0".to_owned(),
            description: String::new(),
            capabilities: vec![PluginCapability::ContentTransform],
            business_api_version: None,
            data_scopes: Vec::new(),
            event_subscriptions: Vec::new(),
        };
        let mut other_manifest = manifest.clone();
        other_manifest.capabilities = vec![PluginCapability::UiPanel];

        assert_ne!(
            component_cache_key(&manifest, b"component-a"),
            component_cache_key(&other_manifest, b"component-a")
        );
        assert_ne!(
            component_cache_key(&manifest, b"component-a"),
            component_cache_key(&manifest, b"component-b")
        );
    }
}
