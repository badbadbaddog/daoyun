use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{ResponseMeta, TopicAuthorSummary};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateTopicSupplementRequest {
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TopicSupplementStatus {
    Approved,
    Hidden,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicSupplement {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub author: TopicAuthorSummary,
    pub content: String,
    pub status: TopicSupplementStatus,
    pub revision: u32,
    #[schema(format = DateTime)]
    pub created_at: String,
    #[schema(format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicSupplementListMeta {
    #[serde(flatten)]
    pub response: ResponseMeta,
    pub enabled: bool,
    pub max_per_topic: u32,
    pub used_count: u32,
    pub can_submit: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicSupplementListResponse {
    pub data: Vec<TopicSupplement>,
    pub meta: TopicSupplementListMeta,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TopicSupplementSettings {
    pub enabled: bool,
    #[schema(minimum = 0, maximum = 100)]
    pub max_per_topic: u32,
}
