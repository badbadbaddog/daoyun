use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// Source: https://docs.rs/utoipa/5.5.0/utoipa/derive.ToSchema.html
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InstallationStatus {
    pub is_initialized: bool,
}
