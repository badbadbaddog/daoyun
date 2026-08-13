use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum PluginCapability {
    #[serde(rename = "content.transform")]
    ContentTransform,
    #[serde(rename = "ui.panel")]
    UiPanel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginStatus {
    Disabled,
    Enabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginOperation {
    ContentTransform,
    UiRender,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Plugin {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub capabilities: Vec<PluginCapability>,
    pub component_sha256: String,
    pub component_size: u64,
    pub status: PluginStatus,
    pub revision: u64,
    pub installed_by: Uuid,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PluginManifestRequest {
    pub schema_version: u16,
    pub key: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub capabilities: Vec<PluginCapability>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InstallPluginRequest {
    pub manifest: PluginManifestRequest,
    pub component_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdatePluginRequest {
    pub status: PluginStatus,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InvokePluginRequest {
    pub operation: PluginOperation,
    pub payload: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PluginInvocation {
    pub operation: PluginOperation,
    pub payload: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_schema: Option<PluginUiSchema>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PluginUiSchema {
    pub schema_version: u16,
    pub title: String,
    pub blocks: Vec<PluginUiBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PluginUiBlock {
    Text { text: String },
    Metric { label: String, value: String },
    Status { tone: PluginUiTone, text: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginUiTone {
    Neutral,
    Success,
    Warning,
    Danger,
}
