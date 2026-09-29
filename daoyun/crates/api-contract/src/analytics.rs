use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CommunityAnalytics {
    pub started_at: String,
    pub from: String,
    pub through: String,
    pub activity_complete: bool,
    pub content_complete: bool,
    pub new_users: i64,
    pub active_users: i64,
    pub topics: i64,
    pub replies: i64,
    pub points_issued: i64,
    pub points_spent: i64,
    pub retention_eligible: i64,
    pub retention_returned: i64,
    pub days: Vec<CommunityAnalyticsDay>,
    pub boards: Vec<CommunityAnalyticsBoard>,
}
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CommunityAnalyticsDay {
    pub day: String,
    pub activity_complete: bool,
    pub content_complete: bool,
    pub new_users: i64,
    pub active_users: i64,
    pub topics: i64,
    pub replies: i64,
    pub points_issued: i64,
    pub points_spent: i64,
}
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CommunityAnalyticsBoard {
    pub board_id: Uuid,
    pub name: String,
    pub topics: i64,
    pub replies: i64,
    pub participants: i64,
}
