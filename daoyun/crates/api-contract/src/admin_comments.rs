use crate::TopicAuthorSummary;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdminCommentStatus {
    Published,
    Hidden,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdminComment {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub topic_title: String,
    pub board_id: Uuid,
    pub board_name: String,
    pub author: TopicAuthorSummary,
    pub content: String,
    pub content_truncated: bool,
    pub status: AdminCommentStatus,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ModerateAdminCommentRequest {
    pub status: AdminCommentStatus,
    #[schema(value_type = String, format = DateTime)]
    pub expected_updated_at: String,
    pub reason: String,
}
