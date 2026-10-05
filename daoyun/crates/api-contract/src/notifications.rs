use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
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
    TopicGovernance,
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
    /// Parent topic of a post target; floor content is still authorized by topic endpoints.
    pub topic_id: Option<Uuid>,
    pub read_at: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct NotificationUnreadCount {
    pub unread_count: u64,
}

#[derive(Debug, Default, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct NotificationPageQuery {
    /// Cursor returned for the same filter; legacy UUID cursors select all notifications.
    pub cursor: Option<String>,
    pub limit: Option<u16>,
    /// When true, filter unread notifications before applying pagination.
    pub unread: Option<bool>,
}
