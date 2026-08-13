#![forbid(unsafe_code)]

use std::{collections::HashSet, error::Error, fmt};

use serde::{Deserialize, Serialize};
use wasmtime::{Config, Engine, ResourceLimiter, Store, component};

// Bindings are generated from the versioned WIT world.  This keeps the guest
// ABI type checked at compilation and prevents ad-hoc host imports.
// References: https://docs.wasmtime.dev/api/wasmtime/component/macro.bindgen.html
wasmtime::component::bindgen!({
    path: "wit",
    world: "plugin",
});

pub const MAX_MANIFEST_BYTES: usize = 16 * 1024;
pub const MAX_COMPONENT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_UI_SCHEMA_BYTES: usize = 32 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PluginCapability {
    #[serde(rename = "content.transform")]
    ContentTransform,
    #[serde(rename = "ui.panel")]
    UiPanel,
}

impl PluginCapability {
    pub const fn operation(self) -> PluginOperation {
        match self {
            Self::ContentTransform => PluginOperation::ContentTransform,
            Self::UiPanel => PluginOperation::UiRender,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginOperation {
    ContentTransform,
    UiRender,
}

impl PluginOperation {
    pub const fn required_capability(self) -> PluginCapability {
        match self {
            Self::ContentTransform => PluginCapability::ContentTransform,
            Self::UiRender => PluginCapability::UiPanel,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginManifest {
    pub schema_version: u16,
    pub key: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub capabilities: Vec<PluginCapability>,
}

impl PluginManifest {
    pub fn validate(&self) -> Result<(), PluginValidationError> {
        if self.schema_version != 1 {
            return Err(PluginValidationError::InvalidManifest);
        }
        if !valid_key(&self.key) {
            return Err(PluginValidationError::InvalidManifest);
        }
        if !bounded_text(&self.name, 1, 80)
            || !bounded_text(&self.description, 0, 500)
            || !valid_version(&self.version)
        {
            return Err(PluginValidationError::InvalidManifest);
        }
        if !(1..=8).contains(&self.capabilities.len()) {
            return Err(PluginValidationError::InvalidManifest);
        }
        let unique = self.capabilities.iter().copied().collect::<HashSet<_>>();
        if unique.len() != self.capabilities.len() {
            return Err(PluginValidationError::InvalidManifest);
        }
        Ok(())
    }

    pub fn permits(&self, operation: PluginOperation) -> bool {
        self.capabilities.contains(&operation.required_capability())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PluginHostConfig {
    pub fuel: u64,
    pub memory_bytes: usize,
    pub table_elements: usize,
    pub instances: usize,
    pub tables: usize,
    pub memories: usize,
    pub max_input_bytes: usize,
    pub max_output_bytes: usize,
}

impl Default for PluginHostConfig {
    fn default() -> Self {
        Self {
            fuel: 10_000_000,
            memory_bytes: 32 * 1024 * 1024,
            table_elements: 10_000,
            instances: 16,
            tables: 4,
            memories: 2,
            max_input_bytes: 64 * 1024,
            max_output_bytes: 64 * 1024,
        }
    }
}

impl PluginHostConfig {
    pub fn validate(&self) -> Result<(), PluginValidationError> {
        if !(100_000..=100_000_000).contains(&self.fuel)
            || !(64 * 1024..=32 * 1024 * 1024).contains(&self.memory_bytes)
            || !(1..=10_000).contains(&self.table_elements)
            || !(1..=16).contains(&self.instances)
            || !(1..=4).contains(&self.tables)
            || !(1..=2).contains(&self.memories)
            || !(1..=64 * 1024).contains(&self.max_input_bytes)
            || !(1..=64 * 1024).contains(&self.max_output_bytes)
        {
            return Err(PluginValidationError::InvalidConfiguration);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiSchema {
    pub schema_version: u16,
    pub title: String,
    pub blocks: Vec<UiBlock>,
}

impl UiSchema {
    pub fn validate(&self) -> Result<(), PluginValidationError> {
        if self.schema_version != 1
            || !bounded_text(&self.title, 1, 80)
            || !(1..=32).contains(&self.blocks.len())
        {
            return Err(PluginValidationError::InvalidUiSchema);
        }
        for block in &self.blocks {
            match block {
                UiBlock::Text { text } => {
                    if !bounded_text(text, 1, 2_000) {
                        return Err(PluginValidationError::InvalidUiSchema);
                    }
                }
                UiBlock::Metric { label, value } => {
                    if !bounded_text(label, 1, 80) || !bounded_text(value, 1, 200) {
                        return Err(PluginValidationError::InvalidUiSchema);
                    }
                }
                UiBlock::Status { text, .. } => {
                    if !bounded_text(text, 1, 200) {
                        return Err(PluginValidationError::InvalidUiSchema);
                    }
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum UiBlock {
    Text { text: String },
    Metric { label: String, value: String },
    Status { tone: UiTone, text: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UiTone {
    Neutral,
    Success,
    Warning,
    Danger,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginValidationError {
    InvalidConfiguration,
    InvalidManifest,
    InvalidUiSchema,
}

impl fmt::Display for PluginValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration => "plugin host configuration is invalid",
            Self::InvalidManifest => "plugin manifest is invalid",
            Self::InvalidUiSchema => "plugin UI schema is invalid",
        })
    }
}

impl Error for PluginValidationError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginHostError {
    InvalidConfiguration,
    InvalidManifest,
    InvalidComponent,
    CapabilityDenied,
    InputTooLarge,
    OutputTooLarge,
    InvalidUiSchema,
    ResourceExhausted,
    ExecutionFailed,
}

impl fmt::Display for PluginHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration => "plugin host configuration is invalid",
            Self::InvalidManifest => "plugin manifest is invalid",
            Self::InvalidComponent => "plugin component is invalid",
            Self::CapabilityDenied => "plugin capability is not declared",
            Self::InputTooLarge => "plugin input exceeds the configured limit",
            Self::OutputTooLarge => "plugin output exceeds the configured limit",
            Self::InvalidUiSchema => "plugin UI schema is invalid",
            Self::ResourceExhausted => "plugin execution exhausted its resources",
            Self::ExecutionFailed => "plugin execution failed",
        })
    }
}

impl Error for PluginHostError {}

#[derive(Debug)]
struct ResourceLimitExceeded;

impl fmt::Display for ResourceLimitExceeded {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("plugin resource limit exceeded")
    }
}

impl Error for ResourceLimitExceeded {}

struct PluginResourceLimits {
    memory_bytes: usize,
    table_elements: usize,
    instances: usize,
    tables: usize,
    memories: usize,
}

impl ResourceLimiter for PluginResourceLimits {
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

struct PluginStoreState {
    limits: PluginResourceLimits,
}

pub struct PluginHost {
    engine: Engine,
    linker: component::Linker<PluginStoreState>,
    config: PluginHostConfig,
}

pub struct CompiledPlugin {
    manifest: PluginManifest,
    component: component::Component,
    component_size: usize,
}

impl CompiledPlugin {
    pub const fn component_size(&self) -> usize {
        self.component_size
    }

    pub fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }
}

impl PluginHost {
    pub fn new(config: PluginHostConfig) -> Result<Self, PluginHostError> {
        config
            .validate()
            .map_err(|_| PluginHostError::InvalidConfiguration)?;

        // Wasmtime fuel and store resource limiters are the documented
        // per-store controls for CPU and guest allocations.
        // References: https://docs.wasmtime.dev/api/wasmtime/struct.Config.html#method.consume_fuel
        // References: https://docs.wasmtime.dev/api/wasmtime/struct.Store.html#method.limiter
        let mut wasm_config = Config::new();
        wasm_config
            .wasm_component_model(true)
            .consume_fuel(true)
            .wasm_backtrace_max_frames(None);
        let engine =
            Engine::new(&wasm_config).map_err(|_| PluginHostError::InvalidConfiguration)?;
        let linker = component::Linker::new(&engine);
        Ok(Self {
            engine,
            linker,
            config,
        })
    }

    pub fn config(&self) -> PluginHostConfig {
        self.config
    }

    pub fn compile(
        &self,
        manifest: PluginManifest,
        bytes: &[u8],
    ) -> Result<CompiledPlugin, PluginHostError> {
        manifest
            .validate()
            .map_err(|_| PluginHostError::InvalidManifest)?;
        if bytes.is_empty() || bytes.len() > MAX_COMPONENT_BYTES {
            return Err(PluginHostError::InvalidComponent);
        }
        let component = component::Component::new(&self.engine, bytes)
            .map_err(|_| PluginHostError::InvalidComponent)?;

        // Instantiate during compilation so components with imports or a
        // different export signature never reach persistence.
        let mut store = self.store()?;
        Plugin::instantiate(&mut store, &component, &self.linker)
            .map_err(|_| PluginHostError::InvalidComponent)?;
        Ok(CompiledPlugin {
            manifest,
            component,
            component_size: bytes.len(),
        })
    }

    pub fn invoke(
        &self,
        plugin: &CompiledPlugin,
        operation: PluginOperation,
        input: &[u8],
    ) -> Result<Vec<u8>, PluginHostError> {
        if !plugin.manifest.permits(operation) {
            return Err(PluginHostError::CapabilityDenied);
        }
        if input.len() > self.config.max_input_bytes {
            return Err(PluginHostError::InputTooLarge);
        }
        let mut store = self.store()?;
        let bindings = Plugin::instantiate(&mut store, &plugin.component, &self.linker)
            .map_err(map_runtime_error)?;
        let operation = match operation {
            PluginOperation::ContentTransform => Operation::ContentTransform,
            PluginOperation::UiRender => Operation::UiRender,
        };
        let output = bindings
            .call_invoke(&mut store, operation, input)
            .map_err(map_runtime_error)?;
        if output.len() > self.config.max_output_bytes {
            return Err(PluginHostError::OutputTooLarge);
        }
        if matches!(operation, Operation::UiRender) {
            let text =
                std::str::from_utf8(&output).map_err(|_| PluginHostError::InvalidUiSchema)?;
            validate_ui_schema_json(text).map_err(|_| PluginHostError::InvalidUiSchema)?;
        }
        Ok(output)
    }

    fn store(&self) -> Result<Store<PluginStoreState>, PluginHostError> {
        let limits = PluginResourceLimits {
            memory_bytes: self.config.memory_bytes,
            table_elements: self.config.table_elements,
            instances: self.config.instances,
            tables: self.config.tables,
            memories: self.config.memories,
        };
        let mut store = Store::new(&self.engine, PluginStoreState { limits });
        store.limiter(|state| &mut state.limits);
        store
            .set_fuel(self.config.fuel)
            .map_err(|_| PluginHostError::InvalidConfiguration)?;
        Ok(store)
    }
}

fn map_runtime_error(error: wasmtime::Error) -> PluginHostError {
    if error.downcast_ref::<ResourceLimitExceeded>().is_some()
        || error
            .downcast_ref::<wasmtime::Trap>()
            .is_some_and(|trap| *trap == wasmtime::Trap::OutOfFuel)
    {
        PluginHostError::ResourceExhausted
    } else {
        PluginHostError::ExecutionFailed
    }
}

pub fn validate_manifest_json(value: &str) -> Result<PluginManifest, PluginValidationError> {
    if value.len() > MAX_MANIFEST_BYTES {
        return Err(PluginValidationError::InvalidManifest);
    }
    let manifest = serde_json::from_str::<PluginManifest>(value)
        .map_err(|_| PluginValidationError::InvalidManifest)?;
    manifest.validate()?;
    Ok(manifest)
}

pub fn validate_ui_schema_json(value: &str) -> Result<UiSchema, PluginValidationError> {
    if value.len() > MAX_UI_SCHEMA_BYTES {
        return Err(PluginValidationError::InvalidUiSchema);
    }
    let schema = serde_json::from_str::<UiSchema>(value)
        .map_err(|_| PluginValidationError::InvalidUiSchema)?;
    schema.validate()?;
    Ok(schema)
}

fn valid_key(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn valid_version(value: &str) -> bool {
    let mut parts = value.split('.');
    let valid = (0..3).all(|_| {
        parts.next().is_some_and(|part| {
            !part.is_empty()
                && (part == "0" || !part.starts_with('0'))
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && part.parse::<u32>().is_ok()
        })
    });
    valid && parts.next().is_none()
}

fn bounded_text(value: &str, minimum: usize, maximum: usize) -> bool {
    let count = value.chars().count();
    (minimum..=maximum).contains(&count) && !value.chars().any(char::is_control)
}
