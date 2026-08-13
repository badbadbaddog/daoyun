use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TopicAttachment {
    pub id: Uuid,
    pub topic_id: Uuid,
    pub original_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub status: AttachmentStatus,
    pub scan_status: AttachmentScanStatus,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    pub download_url: String,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentStatus {
    Pending,
    Ready,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentScanStatus {
    Pending,
    Clean,
    Infected,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AttachmentCleanupResult {
    pub deleted_records: u64,
    pub deleted_objects: u64,
    pub failed_objects: u64,
}
