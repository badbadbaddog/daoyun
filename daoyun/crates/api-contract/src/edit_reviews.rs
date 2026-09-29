use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{TopicAuthorSummary, TopicDetail, TopicReply, TopicTag};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EditReviewTargetType {
    Topic,
    Reply,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EditReviewStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EditSubmissionDisposition {
    Published,
    PendingReview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicEditSubmission {
    pub topic: TopicDetail,
    pub disposition: EditSubmissionDisposition,
    pub review_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReplyEditSubmission {
    pub reply: TopicReply,
    pub disposition: EditSubmissionDisposition,
    pub review_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EditReviewPolicy {
    pub board_id: Uuid,
    pub board_name: String,
    pub topic_edits_require_review: bool,
    pub reply_edits_require_review: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EditReviewPolicyUpdate {
    pub board_id: Uuid,
    pub topic_edits_require_review: bool,
    pub reply_edits_require_review: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateEditReviewPoliciesRequest {
    #[schema(min_items = 1, max_items = 100)]
    pub policies: Vec<EditReviewPolicyUpdate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EditReviewItem {
    pub id: Uuid,
    pub board_id: Uuid,
    pub board_name: String,
    pub topic_id: Uuid,
    pub post_id: Uuid,
    pub target_type: EditReviewTargetType,
    pub editor: TopicAuthorSummary,
    pub base_revision: u32,
    pub current_title: Option<String>,
    pub current_content: String,
    pub proposed_title: Option<String>,
    pub proposed_content: Option<String>,
    pub proposed_rich_content: Option<Value>,
    pub proposed_excerpt: Option<String>,
    pub proposed_tags: Option<Vec<TopicTag>>,
    pub status: EditReviewStatus,
    pub revision: u32,
    pub reviewer: Option<TopicAuthorSummary>,
    pub review_reason: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub reviewed_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EditReviewDecision {
    Approve,
    Reject,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ResolveEditReviewRequest {
    pub decision: EditReviewDecision,
    #[schema(minimum = 1)]
    pub base_revision: u32,
    pub reason: String,
}
