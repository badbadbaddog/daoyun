use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContentAccessTargetType {
    Board,
    Topic,
    Post,
    Attachment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContentAccessOperator {
    AnyOf,
    AllOf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContentAccessSubjectType {
    Public,
    Authenticated,
    CommunityGroup,
    Entitlement,
    Governance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ContentAccessSubject {
    pub subject_type: ContentAccessSubjectType,
    pub community_group_id: Option<Uuid>,
    pub subject_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ContentAccessPolicy {
    pub id: Uuid,
    pub target_type: ContentAccessTargetType,
    pub target_id: Uuid,
    pub operator: ContentAccessOperator,
    pub subjects: Vec<ContentAccessSubject>,
    pub revision: i64,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct PutContentAccessPolicyRequest {
    pub operator: ContentAccessOperator,
    pub subjects: Vec<ContentAccessSubject>,
    pub expected_revision: Option<i64>,
}
