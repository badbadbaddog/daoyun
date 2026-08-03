use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::RequestId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(bound = "T: utoipa::ToSchema")]
pub struct PageResponse<T> {
    pub data: Vec<T>,
    pub meta: PageMeta,
}

impl<T> PageResponse<T> {
    pub fn new(data: Vec<T>, request_id: RequestId, next_cursor: Option<String>) -> Self {
        Self {
            data,
            meta: PageMeta {
                request_id,
                next_cursor,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PageMeta {
    pub request_id: RequestId,
    pub next_cursor: Option<String>,
}
