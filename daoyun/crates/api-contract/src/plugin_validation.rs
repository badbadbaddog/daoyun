//! Runtime-independent plugin metadata and validation shared by API and Wasm host.

use serde::{Deserialize, Serialize};
use std::{collections::HashSet, error::Error, fmt};

pub const MAX_MANIFEST_BYTES: usize = 16 * 1024;
pub const MAX_COMPONENT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_UI_SCHEMA_BYTES: usize = 32 * 1024;
pub const BUSINESS_API_VERSION: &str = "0.1.0";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PluginCapability {
    #[serde(rename = "content.transform")]
    ContentTransform,
    #[serde(rename = "ui.panel")]
    UiPanel,
    #[serde(rename = "events.subscribe")]
    EventsSubscribe,
    #[serde(rename = "core.query")]
    CoreQuery,
    #[serde(rename = "points.write")]
    PointsWrite,
    #[serde(rename = "experience.write")]
    ExperienceWrite,
    #[serde(rename = "entitlements.write")]
    EntitlementsWrite,
    #[serde(rename = "notifications.write")]
    NotificationsWrite,
    #[serde(rename = "storage.read_write")]
    StorageReadWrite,
    #[serde(rename = "tasks.schedule")]
    TasksSchedule,
    #[serde(rename = "topic.supplements")]
    TopicSupplements,
    #[serde(rename = "topic.edit_review")]
    TopicEditReview,
    #[serde(rename = "membership.redemption")]
    MembershipRedemption,
    #[serde(rename = "community.analytics")]
    CommunityAnalytics,
    #[serde(rename = "topic.polls")]
    TopicPolls,
}

impl PluginCapability {
    pub const fn operation(self) -> Option<PluginOperation> {
        match self {
            Self::ContentTransform => Some(PluginOperation::ContentTransform),
            Self::UiPanel => Some(PluginOperation::UiRender),
            Self::EventsSubscribe
            | Self::CoreQuery
            | Self::PointsWrite
            | Self::ExperienceWrite
            | Self::EntitlementsWrite
            | Self::NotificationsWrite
            | Self::StorageReadWrite
            | Self::TasksSchedule
            | Self::TopicSupplements
            | Self::TopicEditReview
            | Self::MembershipRedemption
            | Self::CommunityAnalytics
            | Self::TopicPolls => None,
        }
    }

    const fn is_business(self) -> bool {
        self.operation().is_none()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PluginDataScope {
    #[serde(rename = "site.read")]
    SiteRead,
    #[serde(rename = "actor.read")]
    ActorRead,
    #[serde(rename = "users.read.basic")]
    UsersReadBasic,
    #[serde(rename = "users.read.membership")]
    UsersReadMembership,
    #[serde(rename = "users.targeted")]
    UsersTargeted,
    #[serde(rename = "boards.read")]
    BoardsRead,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PluginEventSubscription {
    #[serde(rename = "user.created")]
    UserCreated,
    #[serde(rename = "topic.published")]
    TopicPublished,
    #[serde(rename = "reply.created")]
    ReplyCreated,
    #[serde(rename = "points.changed")]
    PointsChanged,
    #[serde(rename = "experience.changed")]
    ExperienceChanged,
    #[serde(rename = "entitlement.changed")]
    EntitlementChanged,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_api_version: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data_scopes: Vec<PluginDataScope>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub event_subscriptions: Vec<PluginEventSubscription>,
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
        if !(1..=16).contains(&self.capabilities.len()) {
            return Err(PluginValidationError::InvalidManifest);
        }
        let unique = self.capabilities.iter().copied().collect::<HashSet<_>>();
        if unique.len() != self.capabilities.len() {
            return Err(PluginValidationError::InvalidManifest);
        }
        if self.data_scopes.len() > 8
            || self
                .data_scopes
                .iter()
                .copied()
                .collect::<HashSet<_>>()
                .len()
                != self.data_scopes.len()
        {
            return Err(PluginValidationError::InvalidManifest);
        }
        if self.event_subscriptions.len() > 6
            || self
                .event_subscriptions
                .iter()
                .copied()
                .collect::<HashSet<_>>()
                .len()
                != self.event_subscriptions.len()
            || (!self.event_subscriptions.is_empty()
                && !self
                    .capabilities
                    .contains(&PluginCapability::EventsSubscribe))
        {
            return Err(PluginValidationError::InvalidManifest);
        }
        let has_business_capability = self
            .capabilities
            .iter()
            .copied()
            .any(PluginCapability::is_business);
        let has_legacy_component_capability = self
            .capabilities
            .contains(&PluginCapability::ContentTransform);
        if has_business_capability {
            if self.business_api_version.as_deref() != Some(BUSINESS_API_VERSION)
                || has_legacy_component_capability
            {
                return Err(PluginValidationError::InvalidManifest);
            }
        } else if self.business_api_version.is_some() || !self.data_scopes.is_empty() {
            return Err(PluginValidationError::InvalidManifest);
        }
        let targets_users = self.data_scopes.contains(&PluginDataScope::UsersTargeted);
        if self.capabilities.iter().any(|capability| {
            matches!(
                capability,
                PluginCapability::PointsWrite
                    | PluginCapability::ExperienceWrite
                    | PluginCapability::EntitlementsWrite
                    | PluginCapability::NotificationsWrite
            ) && !targets_users
        }) {
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
                UiBlock::Action { label, action_key } => {
                    if !bounded_text(label, 1, 80) || !valid_ui_action_key(action_key) {
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
    Action { label: String, action_key: String },
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

pub fn valid_ui_action_key(value: &str) -> bool {
    (3..=80).contains(&value.len())
        && value.split('.').all(|segment| {
            segment
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_lowercase())
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        })
}
