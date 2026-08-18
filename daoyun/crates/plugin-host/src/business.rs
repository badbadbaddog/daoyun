use std::{sync::Arc, time::Duration};

use wasmtime::{Config, Engine, ResourceLimiter, Store, component, component::HasData};
use wasmtime_wasi::{
    ResourceTable,
    cli::{WasiCli, WasiCliCtx, WasiCliCtxView},
    p2::bindings::sync as wasi_bindings,
};

use crate::{
    MAX_COMPONENT_BYTES, PluginCapability, PluginHostConfig, PluginHostError, PluginManifest,
    ResourceLimitExceeded,
};

const BUSINESS_GUEST_MEMORY_CEILING_BYTES: usize = 4 * 1024 * 1024;
const BUSINESS_MAX_HOST_CALLS: u32 = 32;
const BUSINESS_MAX_COMMANDS: usize = 32;
const BUSINESS_MAX_UI_CONTRIBUTIONS: usize = 8;
const BUSINESS_MAX_WASI_RESOURCES: usize = 64;
const BUSINESS_EPOCH_TICK: Duration = Duration::from_millis(10);
const BUSINESS_EXECUTION_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InvocationPhase {
    Initialization,
    Event,
    Task,
    PublicUiRender,
    PrivateUiRender,
    UiAction,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HostCall {
    Query,
    Execute,
    Schedule,
    Quotas,
    StorageGet,
    StoragePut,
    StorageDelete,
}

impl InvocationPhase {
    const fn permits(self, call: HostCall) -> bool {
        match self {
            Self::Initialization => false,
            Self::PublicUiRender => false,
            Self::PrivateUiRender => matches!(
                call,
                HostCall::Query | HostCall::Quotas | HostCall::StorageGet
            ),
            Self::Event | Self::Task | Self::UiAction => true,
        }
    }
}

struct HostCallBudget {
    remaining: u32,
}

impl HostCallBudget {
    const fn new(limit: u32) -> Self {
        Self { remaining: limit }
    }

    fn charge(&mut self) -> Result<(), ()> {
        self.remaining = self.remaining.checked_sub(1).ok_or(())?;
        Ok(())
    }
}

pub mod bindings {
    wasmtime::component::bindgen!({
        path: "wit-business",
        world: "business-plugin",
    });
}

pub use bindings::daoyun::plugin_business::types::{
    CommandKind, CommandRequest, CommandResponse, Event, EventKind, QueryKind, QueryRequest,
    QueryResponse, QuotaSnapshot, RequestContext, StorageObject, StoragePutRequest, TaskRequest,
    UiAction, UiContribution, UiSlot,
};

pub trait BusinessHostServices: Send + Sync {
    fn query(
        &self,
        context: RequestContext,
        request: QueryRequest,
    ) -> Result<QueryResponse, String>;

    fn execute(
        &self,
        context: RequestContext,
        request: CommandRequest,
    ) -> Result<CommandResponse, String>;

    fn schedule(&self, context: RequestContext, request: TaskRequest) -> Result<String, String>;

    fn quotas(&self, context: RequestContext) -> QuotaSnapshot;

    fn storage_get(
        &self,
        context: RequestContext,
        key: String,
    ) -> Result<Option<StorageObject>, String>;

    fn storage_put(
        &self,
        context: RequestContext,
        request: StoragePutRequest,
    ) -> Result<StorageObject, String>;

    fn storage_delete(
        &self,
        context: RequestContext,
        key: String,
        expected_revision: u64,
    ) -> Result<bool, String>;
}

struct BusinessResourceLimits {
    memory_bytes: usize,
    table_elements: usize,
    instances: usize,
    tables: usize,
    memories: usize,
}

impl ResourceLimiter for BusinessResourceLimits {
    fn memory_growing(
        &mut self,
        _current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        if desired > self.memory_bytes || maximum.is_some_and(|maximum| desired > maximum) {
            Err(wasmtime::Error::new(ResourceLimitExceeded))
        } else {
            Ok(true)
        }
    }

    fn memory_grow_failed(&mut self, _error: wasmtime::Error) -> wasmtime::Result<()> {
        Err(wasmtime::Error::new(ResourceLimitExceeded))
    }

    fn table_growing(
        &mut self,
        _current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        if desired > self.table_elements || maximum.is_some_and(|maximum| desired > maximum) {
            Err(wasmtime::Error::new(ResourceLimitExceeded))
        } else {
            Ok(true)
        }
    }

    fn table_grow_failed(&mut self, _error: wasmtime::Error) -> wasmtime::Result<()> {
        Err(wasmtime::Error::new(ResourceLimitExceeded))
    }

    fn instances(&self) -> usize {
        self.instances
    }

    fn tables(&self) -> usize {
        self.tables
    }

    fn memories(&self) -> usize {
        self.memories
    }
}

struct BusinessStoreState {
    limits: BusinessResourceLimits,
    services: Arc<dyn BusinessHostServices>,
    phase: InvocationPhase,
    host_calls: HostCallBudget,
    max_input_bytes: usize,
    wasi_cli: WasiCliCtx,
    wasi_resources: ResourceTable,
}

impl BusinessStoreState {
    fn authorize_host_call(&mut self, call: HostCall) -> Result<(), String> {
        if !self.phase.permits(call) {
            return Err("capability.denied".to_owned());
        }
        self.host_calls
            .charge()
            .map_err(|()| "resource.exhausted".to_owned())
    }
}

struct BusinessData;

impl HasData for BusinessData {
    type Data<'a> = &'a mut BusinessStoreState;
}

struct BusinessWasiIo;

impl HasData for BusinessWasiIo {
    type Data<'a> = &'a mut ResourceTable;
}

impl bindings::daoyun::plugin_business::host::Host for BusinessStoreState {
    fn query(
        &mut self,
        context: RequestContext,
        request: QueryRequest,
    ) -> Result<QueryResponse, String> {
        self.authorize_host_call(HostCall::Query)?;
        validate_query_input(self.max_input_bytes, &context, &request).map_err(host_input_error)?;
        let response = self.services.query(context, request)?;
        validate_query_response(self.max_input_bytes, &response).map_err(host_input_error)?;
        Ok(response)
    }

    fn execute(
        &mut self,
        context: RequestContext,
        request: CommandRequest,
    ) -> Result<CommandResponse, String> {
        self.authorize_host_call(HostCall::Execute)?;
        validate_command_input(self.max_input_bytes, &context, &request)
            .map_err(host_input_error)?;
        let response = self.services.execute(context, request)?;
        validate_command_response(self.max_input_bytes, &response).map_err(host_input_error)?;
        Ok(response)
    }

    fn schedule(
        &mut self,
        context: RequestContext,
        request: TaskRequest,
    ) -> Result<String, String> {
        self.authorize_host_call(HostCall::Schedule)?;
        validate_task_request_input(self.max_input_bytes, &context, &request)
            .map_err(host_input_error)?;
        let task_id = self.services.schedule(context, request)?;
        validate_single_string(self.max_input_bytes, &task_id).map_err(host_input_error)?;
        Ok(task_id)
    }

    fn quotas(&mut self, context: RequestContext) -> QuotaSnapshot {
        if self.authorize_host_call(HostCall::Quotas).is_err()
            || validate_context_input(self.max_input_bytes, &context).is_err()
        {
            return empty_quota_snapshot();
        }
        self.services.quotas(context)
    }

    fn storage_get(
        &mut self,
        context: RequestContext,
        key: String,
    ) -> Result<Option<StorageObject>, String> {
        self.authorize_host_call(HostCall::StorageGet)?;
        validate_storage_get_input(self.max_input_bytes, &context, &key)
            .map_err(host_input_error)?;
        let object = self.services.storage_get(context, key)?;
        if let Some(object) = &object {
            validate_storage_object(self.max_input_bytes, object).map_err(host_input_error)?;
        }
        Ok(object)
    }

    fn storage_put(
        &mut self,
        context: RequestContext,
        request: StoragePutRequest,
    ) -> Result<StorageObject, String> {
        self.authorize_host_call(HostCall::StoragePut)?;
        validate_storage_put_input(self.max_input_bytes, &context, &request)
            .map_err(host_input_error)?;
        let object = self.services.storage_put(context, request)?;
        validate_storage_object(self.max_input_bytes, &object).map_err(host_input_error)?;
        Ok(object)
    }

    fn storage_delete(
        &mut self,
        context: RequestContext,
        key: String,
        expected_revision: u64,
    ) -> Result<bool, String> {
        self.authorize_host_call(HostCall::StorageDelete)?;
        validate_storage_delete_input(self.max_input_bytes, &context, &key)
            .map_err(host_input_error)?;
        self.services
            .storage_delete(context, key, expected_revision)
    }
}

impl bindings::daoyun::plugin_business::types::Host for BusinessStoreState {}

pub struct BusinessPluginHost {
    engine: Engine,
    linker: component::Linker<BusinessStoreState>,
    config: PluginHostConfig,
}

pub struct CompiledBusinessPlugin {
    manifest: PluginManifest,
    component: component::Component,
    component_size: usize,
}

impl CompiledBusinessPlugin {
    pub fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    pub const fn component_size(&self) -> usize {
        self.component_size
    }
}

impl BusinessPluginHost {
    pub fn new(config: PluginHostConfig) -> Result<Self, PluginHostError> {
        config
            .validate()
            .map_err(|_| PluginHostError::InvalidConfiguration)?;
        let mut wasm_config = Config::new();
        wasm_config
            .wasm_component_model(true)
            .consume_fuel(true)
            .epoch_interruption(true)
            .wasm_backtrace_max_frames(None);
        let engine =
            Engine::new(&wasm_config).map_err(|_| PluginHostError::InvalidConfiguration)?;
        let weak_engine = engine.weak();
        std::thread::Builder::new()
            .name("daoyun-plugin-epoch".to_owned())
            .spawn(move || {
                loop {
                    std::thread::sleep(BUSINESS_EPOCH_TICK);
                    let Some(engine) = weak_engine.upgrade() else {
                        break;
                    };
                    engine.increment_epoch();
                    drop(engine);
                }
            })
            .map_err(|_| PluginHostError::InvalidConfiguration)?;
        let mut linker = component::Linker::new(&engine);
        add_minimal_wasi_cli_to_linker(&mut linker)
            .map_err(|_| PluginHostError::InvalidConfiguration)?;
        bindings::BusinessPlugin::add_to_linker::<BusinessStoreState, BusinessData>(
            &mut linker,
            |state| state,
        )
        .map_err(|_| PluginHostError::InvalidConfiguration)?;
        Ok(Self {
            engine,
            linker,
            config,
        })
    }

    pub fn compile(
        &self,
        manifest: PluginManifest,
        bytes: &[u8],
    ) -> Result<CompiledBusinessPlugin, PluginHostError> {
        manifest
            .validate()
            .map_err(|_| PluginHostError::InvalidManifest)?;
        if manifest.business_api_version.as_deref() != Some(crate::BUSINESS_API_VERSION)
            || bytes.is_empty()
            || bytes.len() > MAX_COMPONENT_BYTES
        {
            return Err(PluginHostError::InvalidComponent);
        }
        let component = component::Component::new(&self.engine, bytes)
            .map_err(|_| PluginHostError::InvalidComponent)?;
        if component
            .component_type()
            .imports(&self.engine)
            .any(|(name, _)| !business_component_import_allowed(name))
        {
            return Err(PluginHostError::InvalidComponent);
        }
        let mut store = self.store(
            Arc::new(UnavailableServices),
            InvocationPhase::Initialization,
        )?;
        bindings::BusinessPlugin::instantiate(&mut store, &component, &self.linker)
            .map_err(|_| PluginHostError::InvalidComponent)?;
        Ok(CompiledBusinessPlugin {
            manifest,
            component,
            component_size: bytes.len(),
        })
    }

    pub fn on_event(
        &self,
        plugin: &CompiledBusinessPlugin,
        services: Arc<dyn BusinessHostServices>,
        context: RequestContext,
        event: Event,
    ) -> Result<Vec<CommandRequest>, PluginHostError> {
        validate_event_input(self.config.max_input_bytes, &context, &event)?;
        let mut store = self.store(services, InvocationPhase::Event)?;
        let bindings =
            bindings::BusinessPlugin::instantiate(&mut store, &plugin.component, &self.linker)
                .map_err(super::map_runtime_error)?;
        let result = bindings
            .daoyun_plugin_business_guest()
            .call_on_event(&mut store, &context, &event)
            .map_err(super::map_runtime_error)?;
        validate_guest_commands(self.config.max_output_bytes, result)
    }

    pub fn run_task(
        &self,
        plugin: &CompiledBusinessPlugin,
        services: Arc<dyn BusinessHostServices>,
        context: RequestContext,
        task_key: &str,
        payload_json: &str,
    ) -> Result<Vec<CommandRequest>, PluginHostError> {
        validate_task_input(
            self.config.max_input_bytes,
            &context,
            task_key,
            payload_json,
        )?;
        let mut store = self.store(services, InvocationPhase::Task)?;
        let bindings =
            bindings::BusinessPlugin::instantiate(&mut store, &plugin.component, &self.linker)
                .map_err(super::map_runtime_error)?;
        let result = bindings
            .daoyun_plugin_business_guest()
            .call_run_task(&mut store, &context, task_key, payload_json)
            .map_err(super::map_runtime_error)?;
        validate_guest_commands(self.config.max_output_bytes, result)
    }

    pub fn ui_contributions(
        &self,
        plugin: &CompiledBusinessPlugin,
        services: Arc<dyn BusinessHostServices>,
        context: RequestContext,
    ) -> Result<Vec<UiContribution>, PluginHostError> {
        require_ui_capability(plugin)?;
        validate_context_input(self.config.max_input_bytes, &context)?;
        let phase = if context.ui_slot == Some(UiSlot::UserProfile) {
            InvocationPhase::PublicUiRender
        } else {
            InvocationPhase::PrivateUiRender
        };
        let mut store = self.store(services, phase)?;
        let bindings =
            bindings::BusinessPlugin::instantiate(&mut store, &plugin.component, &self.linker)
                .map_err(super::map_runtime_error)?;
        let result = bindings
            .daoyun_plugin_business_guest()
            .call_ui_contributions(&mut store, &context)
            .map_err(super::map_runtime_error)?;
        let contributions = validate_guest_contributions(self.config.max_output_bytes, result)?;
        for contribution in &contributions {
            crate::validate_ui_schema_json(&contribution.schema_json)
                .map_err(|_| PluginHostError::InvalidUiSchema)?;
        }
        Ok(contributions)
    }

    pub fn on_ui_action(
        &self,
        plugin: &CompiledBusinessPlugin,
        services: Arc<dyn BusinessHostServices>,
        context: RequestContext,
        action: UiAction,
    ) -> Result<Vec<CommandRequest>, PluginHostError> {
        require_ui_capability(plugin)?;
        validate_ui_action_input(self.config.max_input_bytes, &context, &action)?;
        let mut store = self.store(services, InvocationPhase::UiAction)?;
        let bindings =
            bindings::BusinessPlugin::instantiate(&mut store, &plugin.component, &self.linker)
                .map_err(super::map_runtime_error)?;
        let result = bindings
            .daoyun_plugin_business_guest()
            .call_on_ui_action(&mut store, &context, &action)
            .map_err(super::map_runtime_error)?;
        validate_guest_commands(self.config.max_output_bytes, result)
    }

    fn store(
        &self,
        services: Arc<dyn BusinessHostServices>,
        phase: InvocationPhase,
    ) -> Result<Store<BusinessStoreState>, PluginHostError> {
        let limits = BusinessResourceLimits {
            memory_bytes: business_guest_memory_limit(self.config.memory_bytes),
            table_elements: self.config.table_elements,
            instances: self.config.instances,
            tables: self.config.tables,
            // A single linear memory makes the byte limit a store-wide total,
            // rather than a per-memory allowance that a component can multiply.
            memories: 1,
        };
        let mut wasi_resources = ResourceTable::new();
        wasi_resources.set_max_capacity(BUSINESS_MAX_WASI_RESOURCES);
        let mut store = Store::new(
            &self.engine,
            BusinessStoreState {
                limits,
                services,
                phase,
                host_calls: HostCallBudget::new(BUSINESS_MAX_HOST_CALLS),
                max_input_bytes: self.config.max_input_bytes,
                wasi_cli: WasiCliCtx::default(),
                wasi_resources,
            },
        );
        store.limiter(|state| &mut state.limits);
        let tick_millis = BUSINESS_EPOCH_TICK.as_millis();
        let deadline_ticks = BUSINESS_EXECUTION_TIMEOUT
            .as_millis()
            .div_ceil(tick_millis)
            .try_into()
            .map_err(|_| PluginHostError::InvalidConfiguration)?;
        store.set_epoch_deadline(deadline_ticks);
        store.epoch_deadline_trap();
        store
            .set_fuel(self.config.fuel)
            .map_err(|_| PluginHostError::InvalidConfiguration)?;
        Ok(store)
    }
}

fn add_minimal_wasi_cli_to_linker(
    linker: &mut component::Linker<BusinessStoreState>,
) -> wasmtime::Result<()> {
    wasi_bindings::io::error::add_to_linker::<BusinessStoreState, BusinessWasiIo>(
        linker,
        business_wasi_resources,
    )?;
    wasi_bindings::io::poll::add_to_linker::<BusinessStoreState, BusinessWasiIo>(
        linker,
        business_wasi_resources,
    )?;
    wasi_bindings::io::streams::add_to_linker::<BusinessStoreState, BusinessWasiIo>(
        linker,
        business_wasi_resources,
    )?;

    macro_rules! add_cli_interface {
        ($interface:ident) => {
            wasi_bindings::cli::$interface::add_to_linker::<BusinessStoreState, WasiCli>(
                linker,
                |state| WasiCliCtxView {
                    ctx: &mut state.wasi_cli,
                    table: &mut state.wasi_resources,
                },
            )?;
        };
    }
    add_cli_interface!(environment);
    add_cli_interface!(exit);
    add_cli_interface!(stdin);
    add_cli_interface!(stdout);
    add_cli_interface!(stderr);
    add_cli_interface!(terminal_input);
    add_cli_interface!(terminal_output);
    add_cli_interface!(terminal_stdin);
    add_cli_interface!(terminal_stdout);
    add_cli_interface!(terminal_stderr);
    Ok(())
}

fn business_wasi_resources(state: &mut BusinessStoreState) -> &mut ResourceTable {
    &mut state.wasi_resources
}

fn business_component_import_allowed(name: &str) -> bool {
    let interface = name
        .split_once('@')
        .map_or(name, |(interface, _)| interface);
    interface.starts_with("daoyun:plugin-business/")
        || matches!(
            interface,
            "wasi:io/error"
                | "wasi:io/poll"
                | "wasi:io/streams"
                | "wasi:cli/environment"
                | "wasi:cli/exit"
                | "wasi:cli/stdin"
                | "wasi:cli/stdout"
                | "wasi:cli/stderr"
                | "wasi:cli/terminal-input"
                | "wasi:cli/terminal-output"
                | "wasi:cli/terminal-stdin"
                | "wasi:cli/terminal-stdout"
                | "wasi:cli/terminal-stderr"
        )
}

fn require_ui_capability(plugin: &CompiledBusinessPlugin) -> Result<(), PluginHostError> {
    if plugin
        .manifest
        .capabilities
        .contains(&PluginCapability::UiPanel)
    {
        Ok(())
    } else {
        Err(PluginHostError::CapabilityDenied)
    }
}

fn validate_guest_commands(
    max_output_bytes: usize,
    result: Result<Vec<CommandRequest>, String>,
) -> Result<Vec<CommandRequest>, PluginHostError> {
    match result {
        Ok(commands) => {
            validate_command_output(max_output_bytes, &commands)?;
            Ok(commands)
        }
        Err(error) => {
            validate_output_string(max_output_bytes, &error)?;
            Err(PluginHostError::ExecutionFailed)
        }
    }
}

fn validate_guest_contributions(
    max_output_bytes: usize,
    result: Result<Vec<UiContribution>, String>,
) -> Result<Vec<UiContribution>, PluginHostError> {
    match result {
        Ok(contributions) => {
            validate_contribution_output(max_output_bytes, &contributions)?;
            Ok(contributions)
        }
        Err(error) => {
            validate_output_string(max_output_bytes, &error)?;
            Err(PluginHostError::ExecutionFailed)
        }
    }
}

fn validate_event_input(
    max_input_bytes: usize,
    context: &RequestContext,
    event: &Event,
) -> Result<(), PluginHostError> {
    let size = context_input_size(context)
        .and_then(|size| checked_add_string(size, &event.id))
        .and_then(|size| size.checked_add(3))
        .and_then(|size| checked_add_optional_string(size, event.aggregate_id.as_deref()))
        .and_then(|size| checked_add_string(size, &event.payload_json));
    validate_input_size(max_input_bytes, size)
}

fn validate_task_input(
    max_input_bytes: usize,
    context: &RequestContext,
    task_key: &str,
    payload_json: &str,
) -> Result<(), PluginHostError> {
    let size = context_input_size(context)
        .and_then(|size| checked_add_string(size, task_key))
        .and_then(|size| checked_add_string(size, payload_json));
    validate_input_size(max_input_bytes, size)
}

fn validate_ui_action_input(
    max_input_bytes: usize,
    context: &RequestContext,
    action: &UiAction,
) -> Result<(), PluginHostError> {
    let size = context_input_size(context)
        .and_then(|size| size.checked_add(1))
        .and_then(|size| checked_add_string(size, &action.action_key))
        .and_then(|size| checked_add_optional_string(size, action.subject_id.as_deref()))
        .and_then(|size| checked_add_string(size, &action.idempotency_key));
    validate_input_size(max_input_bytes, size)
}

fn validate_context_input(
    max_input_bytes: usize,
    context: &RequestContext,
) -> Result<(), PluginHostError> {
    validate_input_size(max_input_bytes, context_input_size(context))
}

fn validate_query_input(
    max_input_bytes: usize,
    context: &RequestContext,
    request: &QueryRequest,
) -> Result<(), PluginHostError> {
    let size = context_input_size(context)
        .and_then(|size| size.checked_add(1))
        .and_then(|size| checked_add_optional_string(size, request.subject_id.as_deref()));
    validate_input_size(max_input_bytes, size)
}

fn validate_command_input(
    max_input_bytes: usize,
    context: &RequestContext,
    request: &CommandRequest,
) -> Result<(), PluginHostError> {
    let size = context_input_size(context)
        .and_then(|size| size.checked_add(1))
        .and_then(|size| checked_add_string(size, &request.subject_id))
        .and_then(|size| checked_add_string(size, &request.idempotency_key))
        .and_then(|size| checked_add_string(size, &request.payload_json));
    validate_input_size(max_input_bytes, size)
}

fn validate_task_request_input(
    max_input_bytes: usize,
    context: &RequestContext,
    request: &TaskRequest,
) -> Result<(), PluginHostError> {
    let size = context_input_size(context)
        .and_then(|size| checked_add_string(size, &request.task_key))
        .and_then(|size| checked_add_string(size, &request.idempotency_key))
        .and_then(|size| checked_add_string(size, &request.payload_json))
        .and_then(|size| size.checked_add(8));
    validate_input_size(max_input_bytes, size)
}

fn validate_storage_get_input(
    max_input_bytes: usize,
    context: &RequestContext,
    key: &str,
) -> Result<(), PluginHostError> {
    let size = context_input_size(context).and_then(|size| checked_add_string(size, key));
    validate_input_size(max_input_bytes, size)
}

fn validate_storage_put_input(
    max_input_bytes: usize,
    context: &RequestContext,
    request: &StoragePutRequest,
) -> Result<(), PluginHostError> {
    let size = context_input_size(context)
        .and_then(|size| checked_add_string(size, &request.key))
        .and_then(|size| checked_add_bytes(size, &request.value))
        .and_then(|size| checked_add_string(size, &request.content_type))
        .and_then(|size| size.checked_add(9));
    validate_input_size(max_input_bytes, size)
}

fn validate_storage_delete_input(
    max_input_bytes: usize,
    context: &RequestContext,
    key: &str,
) -> Result<(), PluginHostError> {
    let size = context_input_size(context)
        .and_then(|size| checked_add_string(size, key))
        .and_then(|size| size.checked_add(8));
    validate_input_size(max_input_bytes, size)
}

fn validate_query_response(
    max_input_bytes: usize,
    response: &QueryResponse,
) -> Result<(), PluginHostError> {
    validate_single_string(max_input_bytes, &response.payload_json)
}

fn validate_command_response(
    max_input_bytes: usize,
    response: &CommandResponse,
) -> Result<(), PluginHostError> {
    let size = checked_add_string(1, &response.resource_id)
        .and_then(|size| checked_add_string(size, &response.payload_json));
    validate_input_size(max_input_bytes, size)
}

fn validate_storage_object(
    max_input_bytes: usize,
    object: &StorageObject,
) -> Result<(), PluginHostError> {
    let size = checked_add_string(8, &object.key)
        .and_then(|size| checked_add_bytes(size, &object.value))
        .and_then(|size| checked_add_string(size, &object.content_type));
    validate_input_size(max_input_bytes, size)
}

fn validate_single_string(max_input_bytes: usize, value: &str) -> Result<(), PluginHostError> {
    validate_input_size(max_input_bytes, checked_add_string(0, value))
}

fn validate_output_string(max_output_bytes: usize, value: &str) -> Result<(), PluginHostError> {
    let size = checked_add_string(0, value).ok_or(PluginHostError::OutputTooLarge)?;
    if size > max_output_bytes {
        Err(PluginHostError::OutputTooLarge)
    } else {
        Ok(())
    }
}

fn validate_input_size(max_input_bytes: usize, size: Option<usize>) -> Result<(), PluginHostError> {
    if size.is_some_and(|size| size <= max_input_bytes) {
        Ok(())
    } else {
        Err(PluginHostError::InputTooLarge)
    }
}

fn context_input_size(context: &RequestContext) -> Option<usize> {
    checked_add_string(8, &context.request_id)
        .and_then(|size| checked_add_string(size, &context.site_id))
        .and_then(|size| checked_add_optional_string(size, context.actor_id.as_deref()))
        .and_then(|size| checked_add_optional_string(size, context.subject_id.as_deref()))
        .and_then(|size| size.checked_add(2))
}

fn checked_add_optional_string(size: usize, value: Option<&str>) -> Option<usize> {
    let size = size.checked_add(1)?;
    match value {
        Some(value) => checked_add_string(size, value),
        None => Some(size),
    }
}

fn checked_add_bytes(size: usize, value: &[u8]) -> Option<usize> {
    size.checked_add(4)?.checked_add(value.len())
}

fn host_input_error(_error: PluginHostError) -> String {
    "input.too_large".to_owned()
}

const fn business_guest_memory_limit(configured: usize) -> usize {
    if configured < BUSINESS_GUEST_MEMORY_CEILING_BYTES {
        configured
    } else {
        BUSINESS_GUEST_MEMORY_CEILING_BYTES
    }
}

const fn empty_quota_snapshot() -> QuotaSnapshot {
    QuotaSnapshot {
        storage_bytes_limit: 0,
        storage_bytes_used: 0,
        pending_task_limit: 0,
        pending_task_used: 0,
        command_daily_limit: 0,
        command_daily_used: 0,
    }
}

fn validate_command_output(
    max_output_bytes: usize,
    commands: &[CommandRequest],
) -> Result<(), PluginHostError> {
    if commands.len() > BUSINESS_MAX_COMMANDS {
        return Err(PluginHostError::OutputTooLarge);
    }
    let mut size = 4_usize;
    for command in commands {
        size = size
            .checked_add(1)
            .and_then(|size| checked_add_string(size, &command.subject_id))
            .and_then(|size| checked_add_string(size, &command.idempotency_key))
            .and_then(|size| checked_add_string(size, &command.payload_json))
            .ok_or(PluginHostError::OutputTooLarge)?;
        if size > max_output_bytes {
            return Err(PluginHostError::OutputTooLarge);
        }
    }
    Ok(())
}

fn validate_contribution_output(
    max_output_bytes: usize,
    contributions: &[UiContribution],
) -> Result<(), PluginHostError> {
    if contributions.len() > BUSINESS_MAX_UI_CONTRIBUTIONS {
        return Err(PluginHostError::OutputTooLarge);
    }
    let mut size = 4_usize;
    for contribution in contributions {
        size = size
            .checked_add(1)
            .and_then(|size| checked_add_string(size, &contribution.schema_json))
            .ok_or(PluginHostError::OutputTooLarge)?;
        if size > max_output_bytes {
            return Err(PluginHostError::OutputTooLarge);
        }
    }
    Ok(())
}

fn checked_add_string(size: usize, value: &str) -> Option<usize> {
    size.checked_add(4)?.checked_add(value.len())
}

struct UnavailableServices;

impl BusinessHostServices for UnavailableServices {
    fn query(
        &self,
        _context: RequestContext,
        _request: QueryRequest,
    ) -> Result<QueryResponse, String> {
        Err("host.unavailable".to_owned())
    }

    fn execute(
        &self,
        _context: RequestContext,
        _request: CommandRequest,
    ) -> Result<CommandResponse, String> {
        Err("host.unavailable".to_owned())
    }

    fn schedule(&self, _context: RequestContext, _request: TaskRequest) -> Result<String, String> {
        Err("host.unavailable".to_owned())
    }

    fn quotas(&self, _context: RequestContext) -> QuotaSnapshot {
        QuotaSnapshot {
            storage_bytes_limit: 0,
            storage_bytes_used: 0,
            pending_task_limit: 0,
            pending_task_used: 0,
            command_daily_limit: 0,
            command_daily_used: 0,
        }
    }

    fn storage_get(
        &self,
        _context: RequestContext,
        _key: String,
    ) -> Result<Option<StorageObject>, String> {
        Err("host.unavailable".to_owned())
    }

    fn storage_put(
        &self,
        _context: RequestContext,
        _request: StoragePutRequest,
    ) -> Result<StorageObject, String> {
        Err("host.unavailable".to_owned())
    }

    fn storage_delete(
        &self,
        _context: RequestContext,
        _key: String,
        _expected_revision: u64,
    ) -> Result<bool, String> {
        Err("host.unavailable".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_output_limit_applies_to_the_whole_guest_result() {
        let command = CommandRequest {
            kind: CommandKind::ExperienceAppend,
            subject_id: "subject".to_owned(),
            idempotency_key: "growth:claim".to_owned(),
            payload_json: r#"{"amount":10}"#.to_owned(),
        };

        assert!(validate_command_output(128, std::slice::from_ref(&command)).is_ok());
        assert_eq!(
            validate_command_output(16, &[command]),
            Err(PluginHostError::OutputTooLarge)
        );
    }

    #[test]
    fn contribution_output_limit_applies_across_all_slots() {
        let contributions = vec![
            UiContribution {
                slot: UiSlot::UserProfile,
                schema_json: "12345678".to_owned(),
            },
            UiContribution {
                slot: UiSlot::MembershipPanel,
                schema_json: "12345678".to_owned(),
            },
        ];

        assert!(validate_contribution_output(64, &contributions).is_ok());
        assert_eq!(
            validate_contribution_output(12, &contributions),
            Err(PluginHostError::OutputTooLarge)
        );
    }

    #[test]
    fn ui_render_callbacks_have_read_only_host_imports() {
        for denied in [
            HostCall::Query,
            HostCall::Execute,
            HostCall::Schedule,
            HostCall::Quotas,
            HostCall::StorageGet,
            HostCall::StoragePut,
            HostCall::StorageDelete,
        ] {
            assert!(!InvocationPhase::PublicUiRender.permits(denied));
        }
        assert!(InvocationPhase::PrivateUiRender.permits(HostCall::Query));
        assert!(InvocationPhase::PrivateUiRender.permits(HostCall::Quotas));
        assert!(InvocationPhase::PrivateUiRender.permits(HostCall::StorageGet));
        for denied in [
            HostCall::Execute,
            HostCall::Schedule,
            HostCall::StoragePut,
            HostCall::StorageDelete,
        ] {
            assert!(!InvocationPhase::PrivateUiRender.permits(denied));
        }
    }

    #[test]
    fn business_export_inputs_are_limited_as_a_whole() {
        let context = RequestContext {
            request_id: "request".to_owned(),
            site_id: "default".to_owned(),
            actor_id: None,
            subject_id: None,
            ui_slot: None,
            occurred_at_unix_ms: 0,
        };
        let event = Event {
            id: "event".to_owned(),
            kind: EventKind::TopicPublished,
            aggregate_id: None,
            payload_schema_version: 1,
            payload_json: "x".repeat(128),
        };

        assert_eq!(
            validate_event_input(64, &context, &event),
            Err(PluginHostError::InputTooLarge)
        );
        assert!(validate_event_input(512, &context, &event).is_ok());
    }

    #[test]
    fn business_guest_memory_has_a_hard_native_lifting_ceiling() {
        assert_eq!(
            business_guest_memory_limit(PluginHostConfig::default().memory_bytes),
            BUSINESS_GUEST_MEMORY_CEILING_BYTES
        );
        assert_eq!(business_guest_memory_limit(64 * 1024), 64 * 1024);
    }

    #[test]
    fn host_call_budget_is_finite() {
        let mut budget = HostCallBudget::new(2);
        assert!(budget.charge().is_ok());
        assert!(budget.charge().is_ok());
        assert!(budget.charge().is_err());
    }

    #[test]
    fn business_import_allowlist_excludes_authority_and_blocking_time_sources() {
        for denied in [
            "wasi:clocks/wall-clock@0.2.6",
            "wasi:clocks/monotonic-clock@0.2.6",
            "wasi:random/random@0.2.6",
            "wasi:filesystem/types@0.2.6",
            "wasi:sockets/tcp@0.2.6",
        ] {
            assert!(!business_component_import_allowed(denied));
        }
        for allowed in [
            "daoyun:plugin-business/host@0.1.0",
            "wasi:io/poll@0.2.6",
            "wasi:cli/environment@0.2.6",
        ] {
            assert!(business_component_import_allowed(allowed));
        }
    }
}
