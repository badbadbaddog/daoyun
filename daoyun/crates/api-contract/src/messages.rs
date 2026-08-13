use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::UserSummary;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
pub struct CreateConversationRequest {
    pub recipient_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct SendDirectMessageRequest {
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
pub struct MarkConversationReadRequest {
    pub last_read_message_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConversationLastMessage {
    pub id: Uuid,
    pub sender_id: Uuid,
    pub content: String,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConversationSummary {
    pub id: Uuid,
    pub other_user: UserSummary,
    pub last_message: Option<ConversationLastMessage>,
    pub unread_count: u64,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DirectMessage {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub sender: UserSummary,
    pub content: String,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConversationReadState {
    pub conversation_id: Uuid,
    pub last_read_message_id: Uuid,
    pub unread_count: u64,
}
