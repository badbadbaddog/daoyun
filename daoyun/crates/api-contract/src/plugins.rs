use std::collections::BTreeSet;

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::DeserializeOwned};
use utoipa::{PartialSchema, ToSchema};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum PluginBusinessApiVersion {
    #[serde(rename = "0.1.0")]
    V0_1_0,
}

impl PluginBusinessApiVersion {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::V0_1_0 => "0.1.0",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum PluginSchemaVersion {
    V1 = 1,
}

impl PluginSchemaVersion {
    pub const fn as_u16(self) -> u16 {
        self as u16
    }
}

impl Serialize for PluginSchemaVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u16(self.as_u16())
    }
}

impl<'de> Deserialize<'de> for PluginSchemaVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u16::deserialize(deserializer)? {
            1 => Ok(Self::V1),
            _ => Err(serde::de::Error::custom(
                "unsupported plugin schema version",
            )),
        }
    }
}

impl PartialSchema for PluginSchemaVersion {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::schema::ObjectBuilder::new()
            .schema_type(utoipa::openapi::schema::Type::Integer)
            .enum_values(Some([Self::V1.as_u16()]))
            .into()
    }
}

impl ToSchema for PluginSchemaVersion {}

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
    pub manifest_schema_version: PluginSchemaVersion,
    #[schema(required = true, nullable)]
    pub business_api_version: Option<PluginBusinessApiVersion>,
    #[schema(min_items = 1, max_items = 16)]
    pub capabilities: BTreeSet<PluginCapability>,
    #[schema(max_items = 8)]
    pub data_scopes: BTreeSet<PluginDataScope>,
    #[schema(max_items = 6)]
    pub event_subscriptions: BTreeSet<PluginEventSubscription>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[allow(dead_code)]
pub enum LegacyPluginCapability {
    #[serde(rename = "content.transform")]
    ContentTransform,
    #[serde(rename = "ui.panel")]
    UiPanel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[allow(dead_code)]
pub enum BusinessPluginCapability {
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LegacyPluginManifestSchema {
    pub schema_version: PluginSchemaVersion,
    pub key: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(deserialize_with = "deserialize_legacy_capabilities")]
    #[schema(min_items = 1, max_items = 16)]
    pub capabilities: BTreeSet<LegacyPluginCapability>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BusinessPluginManifestSchema {
    pub schema_version: PluginSchemaVersion,
    pub key: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(deserialize_with = "deserialize_business_capabilities")]
    #[schema(min_items = 1, max_items = 16)]
    pub capabilities: BTreeSet<BusinessPluginCapability>,
    pub business_api_version: PluginBusinessApiVersion,
    #[serde(deserialize_with = "deserialize_data_scopes")]
    #[schema(max_items = 8)]
    pub data_scopes: BTreeSet<PluginDataScope>,
    #[serde(deserialize_with = "deserialize_event_subscriptions")]
    #[schema(max_items = 6)]
    pub event_subscriptions: BTreeSet<PluginEventSubscription>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum PluginManifestRequest {
    Legacy(LegacyPluginManifestSchema),
    Business(BusinessPluginManifestSchema),
}

fn deserialize_unique_set<'de, D, T>(
    deserializer: D,
    minimum: usize,
    maximum: usize,
) -> Result<BTreeSet<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned + Ord,
{
    let values = Vec::<T>::deserialize(deserializer)?;
    if !(minimum..=maximum).contains(&values.len()) {
        return Err(serde::de::Error::custom(
            "array length is outside the supported range",
        ));
    }
    let value_count = values.len();
    let set = values.into_iter().collect::<BTreeSet<_>>();
    if set.len() != value_count {
        return Err(serde::de::Error::custom("array entries must be unique"));
    }
    Ok(set)
}

fn deserialize_legacy_capabilities<'de, D>(
    deserializer: D,
) -> Result<BTreeSet<LegacyPluginCapability>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_unique_set(deserializer, 1, 16)
}

fn deserialize_business_capabilities<'de, D>(
    deserializer: D,
) -> Result<BTreeSet<BusinessPluginCapability>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_unique_set(deserializer, 1, 16)
}

fn deserialize_data_scopes<'de, D>(deserializer: D) -> Result<BTreeSet<PluginDataScope>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_unique_set(deserializer, 0, 8)
}

fn deserialize_event_subscriptions<'de, D>(
    deserializer: D,
) -> Result<BTreeSet<PluginEventSubscription>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_unique_set(deserializer, 0, 6)
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
    pub schema_version: PluginSchemaVersion,
    pub title: String,
    pub blocks: Vec<PluginUiBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PluginUiBlock {
    Text { text: String },
    Metric { label: String, value: String },
    Status { tone: PluginUiTone, text: String },
    Action { label: String, action_key: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginUiTone {
    Neutral,
    Success,
    Warning,
    Danger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginUiSlot {
    UserProfile,
    MembershipPanel,
    AdminUser,
    AdminPlugin,
    TopicDetail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PluginUiContribution {
    pub slot: PluginUiSlot,
    pub schema: PluginUiSchema,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PluginUiSurfaceContribution {
    pub plugin_id: Uuid,
    pub plugin_key: String,
    pub slot: PluginUiSlot,
    pub schema: PluginUiSchema,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ExecutePluginUiActionRequest {
    pub slot: PluginUiSlot,
    pub action_key: String,
    pub idempotency_key: String,
    pub subject_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PluginUiActionResult {
    pub executed_commands: u32,
}
