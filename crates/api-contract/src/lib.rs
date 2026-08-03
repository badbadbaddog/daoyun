#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(bound = "T: utoipa::ToSchema")]
pub struct ApiResponse<T> {
    pub data: T,
    pub meta: ResponseMeta,
}

impl<T> ApiResponse<T> {
    pub fn new(data: T, request_id: impl Into<String>) -> Self {
        Self {
            data,
            meta: ResponseMeta {
                request_id: request_id.into(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ResponseMeta {
    pub request_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Live,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct HealthData {
    pub status: HealthStatus,
    pub version: String,
}

impl HealthData {
    pub fn new(status: HealthStatus, version: impl Into<String>) -> Self {
        Self {
            status,
            version: version.into(),
        }
    }
}
