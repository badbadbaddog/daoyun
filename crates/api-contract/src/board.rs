use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BoardTone {
    Green,
    Blue,
    Amber,
    Rose,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BoardSummary {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: BoardTone,
    pub topic_count: u64,
}
