#![forbid(unsafe_code)]

mod error;
mod pagination;
mod request_id;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub use error::{ErrorBody, ErrorCode, ErrorResponse, FieldErrors, error_codes};
pub use pagination::{PageMeta, PageResponse};
pub use request_id::RequestId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(bound = "T: utoipa::ToSchema")]
pub struct ApiResponse<T> {
    pub data: T,
    pub meta: ResponseMeta,
}

impl<T> ApiResponse<T> {
    pub fn new(data: T, request_id: RequestId) -> Self {
        Self {
            data,
            meta: ResponseMeta::new(request_id),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ResponseMeta {
    pub request_id: RequestId,
}

impl ResponseMeta {
    pub fn new(request_id: RequestId) -> Self {
        Self { request_id }
    }
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
