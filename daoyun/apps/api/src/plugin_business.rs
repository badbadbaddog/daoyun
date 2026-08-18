use std::{
    error::Error,
    fmt,
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use infrastructure::{
    ClaimedPluginEventDelivery, ClaimedPluginTask, Database, ExecutePluginCommandRecord,
    PluginBusinessExecutableRecord, PluginCommandKind, PluginQueryKind, PluginRuntimeError,
    PutPluginStorageObjectRecord, SchedulePluginTaskRecord,
};
use plugin_host::{
    PluginHostError, UiBlock,
    business::{
        BusinessHostServices, CommandKind, CommandRequest, CommandResponse, Event, EventKind,
        QueryKind, QueryRequest, QueryResponse, QuotaSnapshot, RequestContext, StorageObject,
        StoragePutRequest, TaskRequest, UiAction, UiContribution, UiSlot,
    },
    validate_ui_schema_json,
};
use time::OffsetDateTime;
use tokio::sync::watch;
use uuid::Uuid;

use crate::plugins::{
    PluginBusinessExecutionPermit, PluginRuntime, business_executable_parts,
    compile_cached_business_component,
};

const PLUGIN_HOST_IO_TIMEOUT: Duration = Duration::from_secs(2);
const MIN_PLUGIN_BUSINESS_LEASE: Duration = Duration::from_secs(120);
const PLUGIN_UI_RENDER_TIMEOUT: Duration = Duration::from_secs(2);
const PLUGIN_UI_SURFACE_TIMEOUT: Duration = Duration::from_secs(5);
const PLUGIN_UI_ACTION_TIMEOUT: Duration = Duration::from_secs(5);
const PLUGIN_EXECUTION_LEASE: Duration = Duration::from_secs(120);
const MAX_PLUGIN_UI_SURFACE_CONTRIBUTIONS: usize = 32;
const MAX_PLUGIN_UI_SURFACE_BYTES: usize = 128 * 1024;

#[derive(Clone, Copy, Debug)]
pub struct PluginBusinessWorkerConfig {
    pub batch_size: i64,
    pub lease_duration: Duration,
    pub poll_interval: Duration,
}

impl Default for PluginBusinessWorkerConfig {
    fn default() -> Self {
        Self {
            batch_size: 10,
            lease_duration: Duration::from_secs(180),
            poll_interval: Duration::from_secs(1),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginBusinessWorkerConfigError {
    RuntimeDisabled,
    InvalidSchedule,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PluginBusinessWorkerRun {
    pub claimed_events: usize,
    pub completed_events: usize,
    pub failed_events: usize,
    pub claimed_tasks: usize,
    pub completed_tasks: usize,
    pub failed_tasks: usize,
}

pub struct PluginBusinessWorker {
    database: Database,
    runtime: PluginRuntime,
    tokio_handle: tokio::runtime::Handle,
    config: PluginBusinessWorkerConfig,
}

#[derive(Debug)]
enum PluginBusinessProcessError {
    Host(PluginHostError),
    CommandQuotaExceeded,
}

impl From<PluginHostError> for PluginBusinessProcessError {
    fn from(error: PluginHostError) -> Self {
        Self::Host(error)
    }
}

#[derive(Debug)]
pub(crate) enum PluginBusinessExecutionError {
    Runtime(PluginRuntimeError),
    Host(PluginHostError),
    Busy,
}

impl From<PluginRuntimeError> for PluginBusinessExecutionError {
    fn from(error: PluginRuntimeError) -> Self {
        Self::Runtime(error)
    }
}

impl From<PluginHostError> for PluginBusinessExecutionError {
    fn from(error: PluginHostError) -> Self {
        Self::Host(error)
    }
}

impl fmt::Display for PluginBusinessProcessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Host(error) => error.fmt(formatter),
            Self::CommandQuotaExceeded => formatter.write_str("plugin command quota exceeded"),
        }
    }
}

impl PluginBusinessWorker {
    pub fn new(
        database: Database,
        runtime: PluginRuntime,
        config: PluginBusinessWorkerConfig,
    ) -> Result<Self, PluginBusinessWorkerConfigError> {
        if !runtime.is_enabled() {
            return Err(PluginBusinessWorkerConfigError::RuntimeDisabled);
        }
        if !(1..=100).contains(&config.batch_size)
            || config.lease_duration < MIN_PLUGIN_BUSINESS_LEASE
            || config.lease_duration > Duration::from_secs(300)
            || config.poll_interval.is_zero()
        {
            return Err(PluginBusinessWorkerConfigError::InvalidSchedule);
        }
        Ok(Self {
            database,
            runtime,
            tokio_handle: tokio::runtime::Handle::current(),
            config,
        })
    }

    pub async fn run_once(&self) -> Result<PluginBusinessWorkerRun, PluginRuntimeError> {
        let mut run = PluginBusinessWorkerRun::default();
        for _ in 0..self.config.batch_size {
            let Some(event) = self
                .database
                .claim_plugin_event_deliveries(1, self.config.lease_duration)
                .await?
                .pop()
            else {
                break;
            };
            run.claimed_events += 1;
            let Some(permit) = self.runtime.try_business_execution_permit(event.plugin_id) else {
                self.database
                    .abandon_plugin_event_delivery_claim(
                        event.plugin_id,
                        event.outbox_event_id,
                        event.lock_token,
                    )
                    .await?;
                continue;
            };
            if !self
                .database
                .try_acquire_plugin_execution_lease(
                    event.plugin_id,
                    event.lock_token,
                    self.config.lease_duration,
                )
                .await?
            {
                self.database
                    .abandon_plugin_event_delivery_claim(
                        event.plugin_id,
                        event.outbox_event_id,
                        event.lock_token,
                    )
                    .await?;
                continue;
            }
            let transition = async {
                match self.process_event(&event, permit).await {
                    Ok(()) => {
                        if self
                            .database
                            .complete_plugin_event_delivery(
                                event.plugin_id,
                                event.outbox_event_id,
                                event.lock_token,
                            )
                            .await?
                        {
                            run.completed_events += 1;
                        } else {
                            run.failed_events += 1;
                            tracing::warn!(
                                plugin_id = %event.plugin_id,
                                outbox_event_id = %event.outbox_event_id,
                                "Plugin event lease was lost before completion"
                            );
                        }
                    }
                    Err(PluginBusinessProcessError::CommandQuotaExceeded) => {
                        run.failed_events += 1;
                        if !self
                            .database
                            .defer_plugin_event_delivery_until_quota_reset(
                                event.plugin_id,
                                event.outbox_event_id,
                                event.lock_token,
                            )
                            .await?
                        {
                            tracing::warn!(
                                plugin_id = %event.plugin_id,
                                outbox_event_id = %event.outbox_event_id,
                                "Plugin event lease was lost before quota deferral"
                            );
                        }
                    }
                    Err(error) => {
                        run.failed_events += 1;
                        if self
                            .database
                            .fail_plugin_event_delivery(
                                event.plugin_id,
                                event.outbox_event_id,
                                event.lock_token,
                                &error.to_string(),
                            )
                            .await?
                            .is_none()
                        {
                            tracing::warn!(
                                plugin_id = %event.plugin_id,
                                outbox_event_id = %event.outbox_event_id,
                                "Plugin event lease was lost before failure recording"
                            );
                        }
                    }
                }
                Ok::<(), PluginRuntimeError>(())
            }
            .await;
            if !self
                .database
                .release_plugin_execution_lease(event.plugin_id, event.lock_token)
                .await?
            {
                tracing::warn!(plugin_id = %event.plugin_id, "Plugin execution lease was lost");
            }
            transition?;
        }
        for _ in 0..self.config.batch_size {
            let Some(task) = self
                .database
                .claim_plugin_tasks(1, self.config.lease_duration)
                .await?
                .pop()
            else {
                break;
            };
            run.claimed_tasks += 1;
            let Some(permit) = self.runtime.try_business_execution_permit(task.plugin_id) else {
                self.database
                    .abandon_plugin_task_claim(task.id, task.lock_token)
                    .await?;
                continue;
            };
            if !self
                .database
                .try_acquire_plugin_execution_lease(
                    task.plugin_id,
                    task.lock_token,
                    self.config.lease_duration,
                )
                .await?
            {
                self.database
                    .abandon_plugin_task_claim(task.id, task.lock_token)
                    .await?;
                continue;
            }
            let transition = async {
                match self.process_task(&task, permit).await {
                    Ok(()) => {
                        if self
                            .database
                            .complete_plugin_task(task.id, task.lock_token)
                            .await?
                        {
                            run.completed_tasks += 1;
                        } else {
                            run.failed_tasks += 1;
                            tracing::warn!(task_id = %task.id, "Plugin task lease was lost before completion");
                        }
                    }
                    Err(PluginBusinessProcessError::CommandQuotaExceeded) => {
                        run.failed_tasks += 1;
                        if !self
                            .database
                            .defer_plugin_task_until_quota_reset(task.id, task.lock_token)
                            .await?
                        {
                            tracing::warn!(task_id = %task.id, "Plugin task lease was lost before quota deferral");
                        }
                    }
                    Err(error) => {
                        run.failed_tasks += 1;
                        if self
                            .database
                            .fail_plugin_task(
                                task.id,
                                task.lock_token,
                                "guest.execution_failed",
                                &error.to_string(),
                            )
                            .await?
                            .is_none()
                        {
                            tracing::warn!(task_id = %task.id, "Plugin task lease was lost before failure recording");
                        }
                    }
                }
                Ok::<(), PluginRuntimeError>(())
            }
            .await;
            if !self
                .database
                .release_plugin_execution_lease(task.plugin_id, task.lock_token)
                .await?
            {
                tracing::warn!(plugin_id = %task.plugin_id, "Plugin execution lease was lost");
            }
            transition?;
        }
        Ok(run)
    }

    pub async fn run(&self, mut shutdown: watch::Receiver<bool>) {
        loop {
            if *shutdown.borrow() {
                break;
            }
            if let Err(error) = self.run_once().await {
                tracing::error!(error = %error, "Plugin business worker polling failed");
            }
            tokio::select! {
                () = tokio::time::sleep(self.config.poll_interval) => {}
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break;
                    }
                }
            }
        }
        tracing::info!("Plugin business worker stopped");
    }

    async fn process_event(
        &self,
        delivery: &ClaimedPluginEventDelivery,
        permit: PluginBusinessExecutionPermit,
    ) -> Result<(), PluginBusinessProcessError> {
        let executable = self
            .database
            .load_plugin_for_business_runtime(delivery.plugin_id)
            .await
            .map_err(|_| PluginHostError::ExecutionFailed)?;
        let (manifest, bytes) =
            business_executable_parts(executable).map_err(|()| PluginHostError::InvalidManifest)?;
        let host = self
            .runtime
            .business_host()
            .ok_or(PluginHostError::InvalidConfiguration)?;
        let context = queue_context(delivery.outbox_event_id, delivery.created_at)?;
        let services = Arc::new(PluginBusinessServices::new(
            self.database.clone(),
            delivery.plugin_id,
            context.clone(),
            self.tokio_handle.clone(),
        ));
        let event = Event {
            id: delivery.outbox_event_id.to_string(),
            kind: event_kind(&delivery.event_type)?,
            aggregate_id: Some(delivery.aggregate_id.to_string()),
            payload_schema_version: u16::try_from(delivery.payload_schema_version)
                .map_err(|_| PluginHostError::ExecutionFailed)?,
            payload_json: serde_json::to_string(&delivery.payload)
                .map_err(|_| PluginHostError::ExecutionFailed)?,
        };
        let runtime = self.runtime.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let plugin = compile_cached_business_component(&runtime, &host, manifest, &bytes)?;
            let commands = match host.on_event(&plugin, services.clone(), context.clone(), event) {
                Ok(commands) => commands,
                Err(_) if services.command_quota_exceeded() => {
                    return Err(PluginBusinessProcessError::CommandQuotaExceeded);
                }
                Err(error) => return Err(error.into()),
            };
            for command in commands {
                if services.execute(context.clone(), command).is_err() {
                    return Err(if services.command_quota_exceeded() {
                        PluginBusinessProcessError::CommandQuotaExceeded
                    } else {
                        PluginHostError::ExecutionFailed.into()
                    });
                }
            }
            Ok(())
        })
        .await
        .map_err(|_| PluginBusinessProcessError::Host(PluginHostError::ExecutionFailed))?
    }

    async fn process_task(
        &self,
        task: &ClaimedPluginTask,
        permit: PluginBusinessExecutionPermit,
    ) -> Result<(), PluginBusinessProcessError> {
        let executable = self
            .database
            .load_plugin_for_business_runtime(task.plugin_id)
            .await
            .map_err(|_| PluginHostError::ExecutionFailed)?;
        let (manifest, bytes) =
            business_executable_parts(executable).map_err(|()| PluginHostError::InvalidManifest)?;
        let host = self
            .runtime
            .business_host()
            .ok_or(PluginHostError::InvalidConfiguration)?;
        let context = task_queue_context(task)?;
        let services = Arc::new(PluginBusinessServices::new(
            self.database.clone(),
            task.plugin_id,
            context.clone(),
            self.tokio_handle.clone(),
        ));
        let task_key = task.task_key.clone();
        let payload =
            serde_json::to_string(&task.payload).map_err(|_| PluginHostError::ExecutionFailed)?;
        let runtime = self.runtime.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let plugin = compile_cached_business_component(&runtime, &host, manifest, &bytes)?;
            let commands = match host.run_task(
                &plugin,
                services.clone(),
                context.clone(),
                &task_key,
                &payload,
            ) {
                Ok(commands) => commands,
                Err(_) if services.command_quota_exceeded() => {
                    return Err(PluginBusinessProcessError::CommandQuotaExceeded);
                }
                Err(error) => return Err(error.into()),
            };
            for command in commands {
                if services.execute(context.clone(), command).is_err() {
                    return Err(if services.command_quota_exceeded() {
                        PluginBusinessProcessError::CommandQuotaExceeded
                    } else {
                        PluginHostError::ExecutionFailed.into()
                    });
                }
            }
            Ok(())
        })
        .await
        .map_err(|_| PluginBusinessProcessError::Host(PluginHostError::ExecutionFailed))?
    }
}

pub(crate) async fn render_plugin_ui_contributions(
    database: Database,
    runtime: PluginRuntime,
    plugin_id: Uuid,
    actor_id: Option<Uuid>,
    subject_id: Option<Uuid>,
    slot: UiSlot,
    request_id: Uuid,
) -> Result<Vec<UiContribution>, PluginBusinessExecutionError> {
    render_plugin_ui_plugin(
        database, runtime, plugin_id, actor_id, subject_id, slot, request_id,
    )
    .await
}

#[derive(Debug)]
pub(crate) struct RenderedPluginUiContribution {
    pub plugin_id: Uuid,
    pub plugin_key: String,
    pub contribution: UiContribution,
}

pub(crate) async fn render_plugin_ui_surface(
    database: Database,
    runtime: PluginRuntime,
    actor_id: Option<Uuid>,
    subject_id: Uuid,
    slot: UiSlot,
    request_id: Uuid,
) -> Result<Vec<RenderedPluginUiContribution>, PluginRuntimeError> {
    let plugins = database.list_enabled_business_ui_plugins().await?;
    let mut rendered = Vec::new();
    let mut rendered_bytes = 0_usize;
    let started_at = tokio::time::Instant::now();
    'plugins: for (plugin_id, plugin_key) in plugins {
        let elapsed = started_at.elapsed();
        if elapsed >= PLUGIN_UI_SURFACE_TIMEOUT {
            break;
        }
        let Some(permit) = runtime.try_business_execution_permit(plugin_id) else {
            tracing::warn!(
                request_id = %request_id,
                plugin_id = %plugin_id,
                plugin_key,
                "Busy plugin UI contribution was skipped"
            );
            continue;
        };
        let remaining = PLUGIN_UI_SURFACE_TIMEOUT.saturating_sub(elapsed);
        let timeout = PLUGIN_UI_RENDER_TIMEOUT.min(remaining);
        match tokio::time::timeout(
            timeout,
            render_plugin_ui_plugin_with_permit(
                database.clone(),
                runtime.clone(),
                plugin_id,
                actor_id,
                Some(subject_id),
                slot,
                request_id,
                permit,
            ),
        )
        .await
        {
            Ok(Ok(contributions)) => {
                for contribution in contributions {
                    let contribution_bytes = contribution.schema_json.len();
                    if rendered.len() >= MAX_PLUGIN_UI_SURFACE_CONTRIBUTIONS
                        || rendered_bytes
                            .checked_add(contribution_bytes)
                            .is_none_or(|size| size > MAX_PLUGIN_UI_SURFACE_BYTES)
                    {
                        break 'plugins;
                    }
                    rendered_bytes += contribution_bytes;
                    rendered.push(RenderedPluginUiContribution {
                        plugin_id,
                        plugin_key: plugin_key.clone(),
                        contribution,
                    });
                }
            }
            Ok(Err(error)) => tracing::warn!(
                request_id = %request_id,
                plugin_id = %plugin_id,
                plugin_key,
                error = ?error,
                "Plugin UI contribution was skipped"
            ),
            Err(_) => tracing::warn!(
                request_id = %request_id,
                plugin_id = %plugin_id,
                plugin_key,
                "Timed out plugin UI contribution was skipped"
            ),
        }
    }
    Ok(rendered)
}

#[allow(clippy::too_many_arguments)]
async fn render_plugin_ui_plugin(
    database: Database,
    runtime: PluginRuntime,
    plugin_id: Uuid,
    actor_id: Option<Uuid>,
    subject_id: Option<Uuid>,
    slot: UiSlot,
    request_id: Uuid,
) -> Result<Vec<UiContribution>, PluginBusinessExecutionError> {
    let permit = runtime
        .try_business_execution_permit(plugin_id)
        .ok_or(PluginBusinessExecutionError::Busy)?;
    render_plugin_ui_plugin_with_permit(
        database, runtime, plugin_id, actor_id, subject_id, slot, request_id, permit,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn render_plugin_ui_plugin_with_permit(
    database: Database,
    runtime: PluginRuntime,
    plugin_id: Uuid,
    actor_id: Option<Uuid>,
    subject_id: Option<Uuid>,
    slot: UiSlot,
    request_id: Uuid,
    permit: PluginBusinessExecutionPermit,
) -> Result<Vec<UiContribution>, PluginBusinessExecutionError> {
    let executable = database.load_plugin_for_business_runtime(plugin_id).await?;
    render_plugin_ui_executable(
        database, runtime, executable, actor_id, subject_id, slot, request_id, permit,
    )
    .await
    .map_err(PluginBusinessExecutionError::Host)
}

#[allow(clippy::too_many_arguments)]
async fn render_plugin_ui_executable(
    database: Database,
    runtime: PluginRuntime,
    executable: PluginBusinessExecutableRecord,
    actor_id: Option<Uuid>,
    subject_id: Option<Uuid>,
    slot: UiSlot,
    request_id: Uuid,
    permit: PluginBusinessExecutionPermit,
) -> Result<Vec<UiContribution>, PluginHostError> {
    let plugin_id = executable.id;
    let (manifest, bytes) =
        business_executable_parts(executable).map_err(|()| PluginHostError::InvalidManifest)?;
    let host = runtime
        .business_host()
        .ok_or(PluginHostError::InvalidConfiguration)?;
    let context = RequestContext {
        request_id: request_id.to_string(),
        site_id: "default".to_owned(),
        actor_id: actor_id.map(|id| id.to_string()),
        subject_id: subject_id.map(|id| id.to_string()),
        ui_slot: Some(slot),
        occurred_at_unix_ms: current_unix_ms(),
    };
    let services = Arc::new(PluginBusinessServices::new(
        database,
        plugin_id,
        context.clone(),
        tokio::runtime::Handle::current(),
    ));
    let worker_runtime = runtime.clone();
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let plugin = compile_cached_business_component(&worker_runtime, &host, manifest, &bytes)?;
        host.ui_contributions(&plugin, services, context)
            .map(|contributions| {
                contributions
                    .into_iter()
                    .filter(|contribution| contribution.slot == slot)
                    .collect()
            })
    })
    .await
    .map_err(|_| PluginHostError::ExecutionFailed)?
}

pub(crate) async fn execute_plugin_ui_action(
    database: Database,
    runtime: PluginRuntime,
    plugin_id: Uuid,
    actor_id: Uuid,
    request_id: Uuid,
    action: UiAction,
) -> Result<u32, PluginBusinessExecutionError> {
    let executable = database.load_plugin_for_business_runtime(plugin_id).await?;
    let (manifest, bytes) =
        business_executable_parts(executable).map_err(|()| PluginHostError::InvalidManifest)?;
    let host = runtime
        .business_host()
        .ok_or(PluginHostError::InvalidConfiguration)?;
    let context = RequestContext {
        request_id: request_id.to_string(),
        site_id: "default".to_owned(),
        actor_id: Some(actor_id.to_string()),
        subject_id: action.subject_id.clone(),
        ui_slot: Some(action.slot),
        occurred_at_unix_ms: current_unix_ms(),
    };
    let services = Arc::new(PluginBusinessServices::new(
        database.clone(),
        plugin_id,
        context.clone(),
        tokio::runtime::Handle::current(),
    ));
    let permit = runtime
        .try_business_execution_permit(plugin_id)
        .ok_or(PluginBusinessExecutionError::Busy)?;
    let execution_token = Uuid::now_v7();
    if !database
        .try_acquire_plugin_execution_lease(plugin_id, execution_token, PLUGIN_EXECUTION_LEASE)
        .await?
    {
        return Err(PluginBusinessExecutionError::Busy);
    }
    let worker_runtime = runtime.clone();
    let mut execution = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let plugin = compile_cached_business_component(&worker_runtime, &host, manifest, &bytes)?;
        let exposed = host
            .ui_contributions(&plugin, services.clone(), context.clone())?
            .into_iter()
            .filter(|contribution| contribution.slot == action.slot)
            .filter_map(|contribution| validate_ui_schema_json(&contribution.schema_json).ok())
            .flat_map(|schema| schema.blocks)
            .any(|block| {
                matches!(
                    block,
                    UiBlock::Action { action_key, .. } if action_key == action.action_key
                )
            });
        if !exposed {
            return Err(PluginHostError::CapabilityDenied);
        }
        let commands = host.on_ui_action(&plugin, services.clone(), context.clone(), action)?;
        let command_count =
            u32::try_from(commands.len()).map_err(|_| PluginHostError::OutputTooLarge)?;
        for command in commands {
            services
                .execute(context.clone(), command)
                .map_err(|_| PluginHostError::ExecutionFailed)?;
        }
        Ok(command_count)
    });
    match tokio::time::timeout(PLUGIN_UI_ACTION_TIMEOUT, &mut execution).await {
        Ok(result) => {
            let released = database
                .release_plugin_execution_lease(plugin_id, execution_token)
                .await?;
            if !released {
                return Err(PluginBusinessExecutionError::Busy);
            }
            result
                .map_err(|_| PluginHostError::ExecutionFailed)?
                .map_err(PluginBusinessExecutionError::Host)
        }
        Err(_) => {
            let release_database = database.clone();
            tokio::spawn(async move {
                let _ = execution.await;
                if let Err(error) = release_database
                    .release_plugin_execution_lease(plugin_id, execution_token)
                    .await
                {
                    tracing::warn!(plugin_id = %plugin_id, error = %error, "Timed-out plugin action lease release failed");
                }
            });
            Err(PluginBusinessExecutionError::Busy)
        }
    }
}

struct PluginBusinessServices {
    database: Database,
    plugin_id: Uuid,
    authoritative_context: RequestContext,
    tokio_handle: tokio::runtime::Handle,
    command_quota_exceeded: AtomicBool,
}

impl PluginBusinessServices {
    fn new(
        database: Database,
        plugin_id: Uuid,
        authoritative_context: RequestContext,
        tokio_handle: tokio::runtime::Handle,
    ) -> Self {
        Self {
            database,
            plugin_id,
            authoritative_context,
            tokio_handle,
            command_quota_exceeded: AtomicBool::new(false),
        }
    }

    fn validate_context(&self, context: &RequestContext) -> Result<(), String> {
        if context.request_id == self.authoritative_context.request_id
            && context.site_id == self.authoritative_context.site_id
            && context.actor_id == self.authoritative_context.actor_id
            && context.subject_id == self.authoritative_context.subject_id
            && context.ui_slot == self.authoritative_context.ui_slot
            && context.occurred_at_unix_ms == self.authoritative_context.occurred_at_unix_ms
        {
            Ok(())
        } else {
            Err("context.invalid".to_owned())
        }
    }

    fn block_on_runtime<T, F>(&self, future: F) -> Result<T, String>
    where
        F: Future<Output = Result<T, PluginRuntimeError>>,
    {
        self.tokio_handle.block_on(async {
            tokio::time::timeout(PLUGIN_HOST_IO_TIMEOUT, future)
                .await
                .map_err(|_| "io.timeout".to_owned())?
                .map_err(runtime_error_key)
        })
    }

    fn command_quota_exceeded(&self) -> bool {
        self.command_quota_exceeded.load(Ordering::Acquire)
    }
}

impl BusinessHostServices for PluginBusinessServices {
    fn query(
        &self,
        context: RequestContext,
        request: QueryRequest,
    ) -> Result<QueryResponse, String> {
        self.validate_context(&context)?;
        if context.ui_slot == Some(UiSlot::UserProfile) {
            return Err("capability.denied".to_owned());
        }
        let kind = match request.kind {
            QueryKind::Site => PluginQueryKind::Site,
            QueryKind::Actor => PluginQueryKind::Actor,
            QueryKind::UserBasic => PluginQueryKind::UserBasic,
            QueryKind::Membership => PluginQueryKind::Membership,
            QueryKind::Board => PluginQueryKind::Board,
        };
        let subject_id = if request.kind == QueryKind::Actor {
            context.actor_id.as_deref().map(parse_uuid).transpose()?
        } else {
            request.subject_id.as_deref().map(parse_uuid).transpose()?
        };
        if context.ui_slot.is_some()
            && !matches!(request.kind, QueryKind::Site | QueryKind::Actor)
            && subject_id != context.subject_id.as_deref().map(parse_uuid).transpose()?
        {
            return Err("context.invalid".to_owned());
        }
        let value = self.block_on_runtime(self.database.query_plugin_data(
            self.plugin_id,
            kind,
            subject_id,
        ))?;
        Ok(QueryResponse {
            payload_json: serde_json::to_string(&value).map_err(|_| "json.invalid".to_owned())?,
        })
    }

    fn execute(
        &self,
        context: RequestContext,
        request: CommandRequest,
    ) -> Result<CommandResponse, String> {
        self.validate_context(&context)?;
        let kind = match request.kind {
            CommandKind::PointsAppend => PluginCommandKind::PointsAppend,
            CommandKind::ExperienceAppend => PluginCommandKind::ExperienceAppend,
            CommandKind::EntitlementGrant => PluginCommandKind::EntitlementGrant,
            CommandKind::EntitlementRevoke => PluginCommandKind::EntitlementRevoke,
            CommandKind::NotificationSend => PluginCommandKind::NotificationSend,
        };
        let payload = serde_json::from_str(&request.payload_json)
            .map_err(|_| "payload.invalid".to_owned())?;
        let command_subject_id = parse_uuid(&request.subject_id)?;
        if context.ui_slot.is_some() {
            let authoritative_subject_id = context
                .subject_id
                .as_deref()
                .map(parse_uuid)
                .transpose()?
                .ok_or_else(|| "context.invalid".to_owned())?;
            let entitlement_subject_id = if kind == PluginCommandKind::EntitlementRevoke {
                Some(self.block_on_runtime(async {
                    self.database
                        .standard_entitlement_subject(command_subject_id)
                        .await
                        .map_err(PluginRuntimeError::Database)
                })?)
            } else {
                None
            };
            authorize_ui_command_subject(
                kind,
                command_subject_id,
                authoritative_subject_id,
                entitlement_subject_id.flatten(),
            )?;
        }
        let result = self.block_on_runtime(self.database.execute_plugin_command(
            ExecutePluginCommandRecord {
                plugin_id: self.plugin_id,
                kind,
                subject_id: command_subject_id,
                idempotency_key: request.idempotency_key,
                payload,
            },
        ));
        if matches!(&result, Err(error) if error == "quota.exceeded") {
            self.command_quota_exceeded.store(true, Ordering::Release);
        }
        let result = result?;
        Ok(CommandResponse {
            resource_id: result.resource_id.to_string(),
            replayed: result.replayed,
            payload_json: serde_json::to_string(&result.payload)
                .map_err(|_| "json.invalid".to_owned())?,
        })
    }

    fn schedule(&self, context: RequestContext, request: TaskRequest) -> Result<String, String> {
        self.validate_context(&context)?;
        if context.ui_slot.is_some() {
            return Err("capability.denied".to_owned());
        }
        let run_at = OffsetDateTime::from_unix_timestamp_nanos(
            i128::from(request.run_at_unix_ms) * 1_000_000,
        )
        .map_err(|_| "schedule.invalid".to_owned())?;
        let payload = serde_json::from_str(&request.payload_json)
            .map_err(|_| "payload.invalid".to_owned())?;
        let task = self.block_on_runtime(self.database.schedule_plugin_task(
            SchedulePluginTaskRecord {
                plugin_id: self.plugin_id,
                task_key: request.task_key,
                idempotency_key: request.idempotency_key,
                payload,
                run_at,
            },
        ))?;
        Ok(task.id.to_string())
    }

    fn quotas(&self, context: RequestContext) -> QuotaSnapshot {
        if self.validate_context(&context).is_err() {
            return empty_quota_snapshot();
        }
        self.block_on_runtime(self.database.plugin_quota_snapshot(self.plugin_id))
            .map(|quota| QuotaSnapshot {
                storage_bytes_limit: u64::try_from(quota.storage_bytes_limit).unwrap_or_default(),
                storage_bytes_used: u64::try_from(quota.storage_bytes_used).unwrap_or_default(),
                pending_task_limit: u32::try_from(quota.pending_task_limit).unwrap_or_default(),
                pending_task_used: u32::try_from(quota.pending_tasks).unwrap_or(u32::MAX),
                command_daily_limit: u32::try_from(quota.command_daily_limit).unwrap_or_default(),
                command_daily_used: u32::try_from(quota.command_daily_used).unwrap_or_default(),
            })
            .unwrap_or_else(|_| empty_quota_snapshot())
    }

    fn storage_get(
        &self,
        context: RequestContext,
        key: String,
    ) -> Result<Option<StorageObject>, String> {
        self.validate_context(&context)?;
        if context.ui_slot == Some(UiSlot::UserProfile) {
            return Err("capability.denied".to_owned());
        }
        self.block_on_runtime(
            self.database
                .get_plugin_storage_object(self.plugin_id, &key),
        )?
        .map(map_storage_object)
        .transpose()
    }

    fn storage_put(
        &self,
        context: RequestContext,
        request: StoragePutRequest,
    ) -> Result<StorageObject, String> {
        self.validate_context(&context)?;
        let expected_revision = request
            .expected_revision
            .map(i64::try_from)
            .transpose()
            .map_err(|_| "revision.invalid".to_owned())?;
        let object = self.block_on_runtime(self.database.put_plugin_storage_object(
            PutPluginStorageObjectRecord {
                plugin_id: self.plugin_id,
                key: request.key,
                value: request.value,
                content_type: request.content_type,
                expected_revision,
            },
        ))?;
        map_storage_object(object)
    }

    fn storage_delete(
        &self,
        context: RequestContext,
        key: String,
        expected_revision: u64,
    ) -> Result<bool, String> {
        self.validate_context(&context)?;
        self.block_on_runtime(self.database.delete_plugin_storage_object(
            self.plugin_id,
            &key,
            i64::try_from(expected_revision).map_err(|_| "revision.invalid".to_owned())?,
        ))
    }
}

fn queue_context(id: Uuid, occurred_at: OffsetDateTime) -> Result<RequestContext, PluginHostError> {
    let occurred_at_unix_ms = u64::try_from(occurred_at.unix_timestamp_nanos() / 1_000_000)
        .map_err(|_| PluginHostError::ExecutionFailed)?;
    Ok(RequestContext {
        request_id: id.to_string(),
        site_id: "default".to_owned(),
        actor_id: None,
        subject_id: None,
        ui_slot: None,
        occurred_at_unix_ms,
    })
}

fn task_queue_context(task: &ClaimedPluginTask) -> Result<RequestContext, PluginHostError> {
    queue_context(task.id, task.run_at)
}

fn current_unix_ms() -> u64 {
    u64::try_from(OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000).unwrap_or_default()
}

fn event_kind(event_type: &str) -> Result<EventKind, PluginHostError> {
    Ok(match event_type {
        "user.created" => EventKind::UserCreated,
        "topic.published" => EventKind::TopicPublished,
        "reply.created" => EventKind::ReplyCreated,
        "points.changed" => EventKind::PointsChanged,
        "experience.changed" => EventKind::ExperienceChanged,
        "entitlement.changed" => EventKind::EntitlementChanged,
        _ => return Err(PluginHostError::ExecutionFailed),
    })
}

fn parse_uuid(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| "subject.invalid".to_owned())
}

fn authorize_ui_command_subject(
    kind: PluginCommandKind,
    command_subject_id: Uuid,
    authoritative_subject_id: Uuid,
    entitlement_subject_id: Option<Uuid>,
) -> Result<(), String> {
    let authorized_subject_id = if kind == PluginCommandKind::EntitlementRevoke {
        entitlement_subject_id.ok_or_else(|| "resource.not_found".to_owned())?
    } else {
        command_subject_id
    };
    if authorized_subject_id == authoritative_subject_id {
        Ok(())
    } else {
        Err("context.invalid".to_owned())
    }
}

fn runtime_error_key(error: PluginRuntimeError) -> String {
    match error {
        PluginRuntimeError::NotFound => "resource.not_found",
        PluginRuntimeError::Disabled => "plugin.disabled",
        PluginRuntimeError::CapabilityDenied => "capability.denied",
        PluginRuntimeError::InvalidInput => "input.invalid",
        PluginRuntimeError::Conflict => "revision.conflict",
        PluginRuntimeError::IdempotencyConflict => "idempotency.conflict",
        PluginRuntimeError::QuotaExceeded => "quota.exceeded",
        PluginRuntimeError::Busy => "execution.busy",
        PluginRuntimeError::Database(_) => "database.unavailable",
    }
    .to_owned()
}

fn map_storage_object(
    object: infrastructure::PluginStorageObjectRecord,
) -> Result<StorageObject, String> {
    Ok(StorageObject {
        key: object.key,
        value: object.value,
        content_type: object.content_type,
        revision: u64::try_from(object.revision).map_err(|_| "revision.invalid".to_owned())?,
    })
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

impl fmt::Display for PluginBusinessWorkerConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::RuntimeDisabled => "plugin business worker requires an enabled runtime",
            Self::InvalidSchedule => "plugin business worker schedule is invalid",
        })
    }
}

impl Error for PluginBusinessWorkerConfigError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_worker_lease_covers_the_bounded_guest_and_command_budget() {
        let config = PluginBusinessWorkerConfig::default();

        assert!(config.lease_duration >= MIN_PLUGIN_BUSINESS_LEASE);
        assert!(config.lease_duration <= Duration::from_secs(300));
    }

    #[test]
    fn event_queue_context_uses_the_original_outbox_time() {
        let occurred_at = OffsetDateTime::from_unix_timestamp(1_700_000_000)
            .expect("timestamp fixture must be valid");

        let context = queue_context(Uuid::nil(), occurred_at)
            .expect("valid event time must produce a request context");

        assert_eq!(context.occurred_at_unix_ms, 1_700_000_000_000);
    }

    #[test]
    fn task_queue_context_is_stable_across_retries() {
        let run_at = OffsetDateTime::from_unix_timestamp(1_700_000_000)
            .expect("timestamp fixture must be valid");
        let task = ClaimedPluginTask {
            id: Uuid::now_v7(),
            plugin_id: Uuid::now_v7(),
            task_key: "daily.run".to_owned(),
            payload: serde_json::json!({}),
            run_at,
            attempts: 2,
            max_attempts: 8,
            lock_token: Uuid::now_v7(),
            locked_until: OffsetDateTime::now_utc(),
        };

        let context = task_queue_context(&task).expect("valid task time must produce a context");

        assert_eq!(context.occurred_at_unix_ms, 1_700_000_000_000);
    }

    #[test]
    fn ui_commands_cannot_target_a_different_page_subject() {
        let page_subject = Uuid::now_v7();
        let different_subject = Uuid::now_v7();

        assert_eq!(
            authorize_ui_command_subject(
                PluginCommandKind::PointsAppend,
                different_subject,
                page_subject,
                None,
            ),
            Err("context.invalid".to_owned())
        );
        assert_eq!(
            authorize_ui_command_subject(
                PluginCommandKind::EntitlementRevoke,
                Uuid::now_v7(),
                page_subject,
                Some(different_subject),
            ),
            Err("context.invalid".to_owned())
        );
    }
}
