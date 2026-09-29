use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DraftContent {
    pub title: String,
    pub board_id: Option<Uuid>,
    pub rich_content: Value,
    #[serde(default)]
    pub images: Vec<DraftImage>,
    // Poll configuration is private draft data; publication validates the enabled provider and permissions.
    #[serde(default)]
    pub poll: Option<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DraftImage {
    pub attachment_id: Uuid,
    pub file_name: String,
}
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SaveDraftRequest {
    pub expected_revision: i64,
    pub content: DraftContent,
}
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DraftReference {
    pub id: Uuid,
    pub revision: i64,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct MemberDraft {
    pub id: Uuid,
    pub revision: i64,
    pub content: DraftContent,
    pub updated_at: String,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct MemberDraftPage {
    pub drafts: Vec<MemberDraft>,
    pub next_cursor: Option<Uuid>,
}
