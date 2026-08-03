use std::fmt;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct RequestId(Uuid);

impl From<Uuid> for RequestId {
    fn from(value: Uuid) -> Self {
        Self(value)
    }
}

impl From<RequestId> for Uuid {
    fn from(value: RequestId) -> Self {
        value.0
    }
}

impl fmt::Display for RequestId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}
