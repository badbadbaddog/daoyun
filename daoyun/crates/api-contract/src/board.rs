use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BoardTone {
    Green,
    Blue,
    Amber,
    Rose,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BoardSummary {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: BoardTone,
    pub position: i32,
    pub depth: u32,
    pub child_count: u64,
    pub topic_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BoardBreadcrumbItem {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BoardViewerCapabilities {
    pub can_read: bool,
    pub can_create_topic: bool,
    pub can_reply: bool,
    pub can_upload_attachment: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BoardDetail {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: BoardTone,
    pub parent_id: Option<Uuid>,
    pub topic_count: u64,
    pub children: Vec<BoardSummary>,
    pub breadcrumb: Vec<BoardBreadcrumbItem>,
    pub viewer: BoardViewerCapabilities,
}
