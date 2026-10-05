#![forbid(unsafe_code)]

pub mod business;

use std::{error::Error, fmt};

pub use api_contract::plugin_validation::*;
use wasmtime::{Config, Engine, ResourceLimiter, Store, component};

// Bindings are generated from the versioned WIT world.  This keeps the guest
// ABI type checked at compilation and prevents ad-hoc host imports.
// References: https://docs.wasmtime.dev/api/wasmtime/component/macro.bindgen.html
wasmtime::component::bindgen!({
    path: "wit",
    world: "plugin",
});

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
