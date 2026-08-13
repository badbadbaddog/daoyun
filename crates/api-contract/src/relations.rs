use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BookmarkState {
    pub topic_id: Uuid,
    pub bookmarked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PostLikeState {
    pub post_id: Uuid,
    pub liked: bool,
    pub like_count: u64,
}
