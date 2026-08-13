use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::UserSummary;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    Follow,
    Reply,
    Like,
    Message,
    Report,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotificationTarget {
    User,
    Topic,
    Post,
    Conversation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Notification {
    pub id: Uuid,
    pub kind: NotificationKind,
    pub actor: Option<UserSummary>,
    pub target: NotificationTarget,
    pub target_id: Uuid,
    pub read_at: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct NotificationUnreadCount {
    pub unread_count: u64,
}
