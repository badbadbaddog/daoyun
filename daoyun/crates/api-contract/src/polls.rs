use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PollInput {
    pub question: String,
    pub options: Vec<String>,
    pub ends_at: String,
}
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdatePollRequest {
    pub expected_revision: i64,
    pub poll: PollInput,
}
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct VotePollRequest {
    pub option_id: Uuid,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct PollPolicy {
    pub enabled: bool,
    pub can_create: bool,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct PollOption {
    pub id: Uuid,
    pub label: String,
    pub votes: Option<i64>,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct TopicPoll {
    pub topic_id: Uuid,
    pub question: String,
    pub ends_at: String,
    pub revision: i64,
    pub enabled: bool,
    pub closed: bool,
    pub can_vote: bool,
    pub can_edit: bool,
    pub selected_option: Option<Uuid>,
    pub total_votes: Option<i64>,
    pub options: Vec<PollOption>,
}
