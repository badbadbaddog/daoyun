use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BoardPostingRestrictionAction {
    TopicCreate,
    ReplyCreate,
    AttachmentUpload,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct PutBoardUserRestrictionRequest {
    pub actions: Vec<BoardPostingRestrictionAction>,
    pub starts_at: String,
    pub ends_at: Option<String>,
    pub reason: String,
    pub expected_revision: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BoardUserRestriction {
    pub id: Uuid,
    pub board_id: Uuid,
    pub user_id: Uuid,
    pub actions: Vec<BoardPostingRestrictionAction>,
    pub starts_at: String,
    pub ends_at: Option<String>,
    pub reason: String,
    pub created_by: Uuid,
    pub updated_by: Uuid,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}
