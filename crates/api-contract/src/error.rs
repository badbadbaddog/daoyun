use std::{collections::BTreeMap, fmt};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{RequestId, ResponseMeta};

pub mod error_codes {
    pub const DATABASE_UNAVAILABLE: &str = "system.database_unavailable";
    pub const METHOD_NOT_ALLOWED: &str = "system.method_not_allowed";
    pub const NOT_READY: &str = "system.not_ready";
    pub const ROUTE_NOT_FOUND: &str = "system.route_not_found";
    pub const VALIDATION_FAILED: &str = "request.validation_failed";
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct ErrorCode(String);

impl ErrorCode {
    pub fn from_static(value: &'static str) -> Self {
        Self(value.to_owned())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

pub type FieldErrors = BTreeMap<String, Vec<String>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ErrorBody {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: FieldErrors,
}

impl ErrorBody {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            fields: BTreeMap::new(),
        }
    }

    pub fn with_field(mut self, field: impl Into<String>, message: impl Into<String>) -> Self {
        self.fields
            .entry(field.into())
            .or_default()
            .push(message.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ErrorResponse {
    pub error: ErrorBody,
    pub meta: ResponseMeta,
}

impl ErrorResponse {
    pub fn new(error: ErrorBody, request_id: RequestId) -> Self {
        Self {
            error,
            meta: ResponseMeta::new(request_id),
        }
    }
}
