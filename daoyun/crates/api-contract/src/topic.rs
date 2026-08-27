use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::BoardTone;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateTopicRequest {
    #[serde(default)]
    pub board_id: Option<Uuid>,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub rich_content: Option<Value>,
    #[serde(default)]
    pub tags: Vec<TopicTagInput>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateReplyRequest {
    pub content: String,
    #[serde(default)]
    pub rich_content: Option<Value>,
    #[serde(default)]
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateReplyRequest {
    pub base_revision: u32,
    pub content: String,
    #[serde(default)]
    pub rich_content: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct TopicTagInput {
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicTag {
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTopicRequest {
    pub base_revision: u32,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub rich_content: Option<Value>,
    #[serde(default)]
    pub tags: Option<Vec<TopicTagInput>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicRevision {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub revision_number: u32,
    pub editor: TopicAuthorSummary,
    pub content: String,
    pub rich_content: Option<Value>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReplyRevision {
    pub id: Uuid,
    pub reply_id: Uuid,
    pub revision_number: u32,
    pub editor: TopicAuthorSummary,
    pub content: String,
    pub rich_content: Option<Value>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TopicSort {
    #[default]
    Latest,
    Popular,
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TopicScope {
    Following,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicAuthorSummary {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicBoardSummary {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub tone: BoardTone,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicSummary {
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
    pub viewer_bookmarked: Option<bool>,
    pub viewer_liked: Option<bool>,
    pub view_count: u64,
    pub is_featured: bool,
    pub is_pinned: bool,
    pub tags: Vec<TopicTag>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicDetail {
    #[serde(flatten)]
    #[schema(inline)]
    pub summary: TopicSummary,
    pub content: String,
    pub rich_content: Option<Value>,
    pub has_locked_content: bool,
    pub content_revision: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicReply {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub floor_number: u64,
    pub reply_to: Option<ReplyReference>,
    pub author: TopicAuthorSummary,
    pub content: String,
    pub rich_content: Option<Value>,
    pub has_locked_content: bool,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
    pub revision_count: u32,
    pub like_count: u64,
    pub viewer_liked: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReplyReference {
    pub id: Uuid,
    pub floor_number: u64,
    pub author: TopicAuthorSummary,
    pub excerpt: Option<String>,
    pub is_deleted: bool,
}
