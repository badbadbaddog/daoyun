use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

// Source: https://docs.rs/utoipa/5.5.0/utoipa/derive.ToSchema.html
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InstallationStatus {
    pub is_initialized: bool,
}

#[derive(Deserialize, ToSchema)]
pub struct InitializeInstallationRequest {
    pub username: String,
    pub email: String,
    pub display_name: String,
    #[schema(value_type = String, format = Password, min_length = 6, max_length = 128)]
    pub password: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InitialAdministrator {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InstallationInitialization {
    pub is_initialized: bool,
    pub administrator: InitialAdministrator,
}
