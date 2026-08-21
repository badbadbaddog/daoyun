use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{BoardTone, TopicAuthorSummary, TopicBoardSummary};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ModerationBoard {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub tone: BoardTone,
    pub capability_keys: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TopicModerationStatus {
    Approved,
    Hidden,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct ModerateTopicRequest {
    pub status: TopicModerationStatus,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicModerationResult {
    pub topic_id: Uuid,
    pub status: TopicModerationStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TopicGovernanceAction {
    Pin,
    Unpin,
    Feature,
    Unfeature,
    Lock,
    Unlock,
    Move,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct GovernTopicRequest {
    pub action: TopicGovernanceAction,
    pub expected_revision: i64,
    pub target_board_id: Option<Uuid>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicGovernanceResult {
    pub topic_id: Uuid,
    pub board_id: Uuid,
    pub is_pinned: bool,
    pub is_featured: bool,
    pub is_locked: bool,
    pub governance_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ModerationTopic {
    pub id: Uuid,
    pub title: String,
    pub excerpt: String,
    pub author: TopicAuthorSummary,
    pub board: TopicBoardSummary,
    #[schema(value_type = String, format = DateTime)]
    pub published_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub last_activity_at: String,
    pub reply_count: u64,
    pub like_count: u64,
    pub view_count: u64,
    pub moderation_status: TopicModerationStatus,
    pub governance_revision: i64,
    pub is_featured: bool,
    pub is_pinned: bool,
    pub is_locked: bool,
}
