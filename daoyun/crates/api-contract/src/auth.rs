use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub display_name: String,
    #[schema(value_type = String, format = Password, min_length = 6, max_length = 128)]
    pub password: String,
    pub email_challenge_id: Option<Uuid>,
    #[schema(value_type = Option<String>, format = Password, min_length = 6, max_length = 6)]
    pub email_verification_code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RegistrationPolicy {
    pub email_verification_required: bool,
    pub code_expires_in_seconds: u32,
    pub resend_after_seconds: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
pub struct RegistrationEmailChallengeRequest {
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RegistrationEmailChallengeData {
    pub challenge_id: Uuid,
    #[schema(value_type = String, format = DateTime)]
    pub expires_at: String,
    pub resend_after_seconds: u32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    pub identifier: String,
    #[schema(value_type = String, format = Password)]
    pub password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RecentAuthRequest {
    #[schema(min_length = 1, max_length = 64)]
    pub operation: String,
    #[schema(value_type = String, format = Password, min_length = 6, max_length = 128)]
    pub password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ChangePasswordRequest {
    #[schema(value_type = String, format = Password, min_length = 6, max_length = 128)]
    pub new_password: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthenticatedUser {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthenticatedSession {
    pub user: AuthenticatedUser,
    #[schema(value_type = String, format = Password)]
    pub csrf_token: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LogoutData {
    pub logged_out: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DeviceSession {
    pub id: Uuid,
    pub device_label: String,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = String, format = DateTime)]
    pub last_seen_at: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RevokeDeviceSessionData {
    pub revoked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RecentAuthData {
    pub authenticated: bool,
    #[schema(value_type = String, format = DateTime)]
    pub expires_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MfaStatus {
    pub enabled: bool,
    pub setup_pending: bool,
    pub recovery_codes_remaining: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MfaSetupData {
    #[schema(value_type = String, format = Password)]
    pub secret_base32: String,
    pub otpauth_url: String,
    #[schema(value_type = String, format = DateTime)]
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MfaCodeRequest {
    #[schema(value_type = String, format = Password, min_length = 6, max_length = 32)]
    pub code: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MfaEnableData {
    pub enabled: bool,
    #[schema(value_type = String, format = Password)]
    pub csrf_token: String,
    #[schema(value_type = Vec<String>, format = Password)]
    pub recovery_codes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MfaDisableData {
    pub disabled: bool,
    #[schema(value_type = String, format = Password)]
    pub csrf_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MfaRecoveryCodesData {
    #[schema(value_type = Vec<String>, format = Password)]
    pub recovery_codes: Vec<String>,
    #[schema(value_type = String, format = Password)]
    pub csrf_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MfaChallengeData {
    pub challenge_id: Uuid,
    #[schema(value_type = String, format = DateTime)]
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MfaVerifyRequest {
    pub challenge_id: Uuid,
    #[schema(value_type = String, format = Password, min_length = 6, max_length = 32)]
    pub code: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OidcProvider {
    pub provider_key: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ExternalIdentity {
    pub id: Uuid,
    pub provider_key: String,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub last_authenticated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OidcAuthorizationStartData {
    pub authorization_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OidcClaimData {
    pub provider_key: String,
    pub provider_display_name: String,
    pub profile_name: Option<String>,
    pub preferred_username: Option<String>,
    pub email_hint: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct OidcClaimAccountRequest {
    pub username: String,
    pub email: String,
    pub display_name: String,
    #[schema(value_type = String, format = Password, min_length = 6, max_length = 128)]
    pub password: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OidcClaimBindData {
    pub bound: bool,
    #[schema(value_type = String, format = Password)]
    pub csrf_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ChangePasswordData {
    #[schema(value_type = String, format = Password)]
    pub csrf_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UnlinkExternalIdentityData {
    pub unlinked: bool,
    #[schema(value_type = String, format = Password)]
    pub csrf_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyCredentialParameter {
    #[serde(rename = "type")]
    pub kind: String,
    pub alg: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyRp {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyUser {
    pub id: String,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyCredentialDescriptor {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub transports: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyAuthenticatorSelection {
    #[serde(
        rename = "authenticatorAttachment",
        skip_serializing_if = "Option::is_none"
    )]
    pub authenticator_attachment: Option<String>,
    #[serde(rename = "residentKey", skip_serializing_if = "Option::is_none")]
    pub resident_key: Option<String>,
    #[serde(rename = "userVerification")]
    pub user_verification: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyRegistrationOptions {
    pub challenge: String,
    pub rp: PasskeyRp,
    pub user: PasskeyUser,
    #[serde(rename = "pubKeyCredParams")]
    pub pub_key_cred_params: Vec<PasskeyCredentialParameter>,
    #[serde(
        rename = "excludeCredentials",
        skip_serializing_if = "Vec::is_empty",
        default
    )]
    pub exclude_credentials: Vec<PasskeyCredentialDescriptor>,
    pub timeout: u32,
    #[serde(rename = "authenticatorSelection")]
    pub authenticator_selection: PasskeyAuthenticatorSelection,
    pub attestation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyRegistrationOptionsData {
    pub challenge_id: Uuid,
    pub options: PasskeyRegistrationOptions,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyAssertionOptions {
    pub challenge: String,
    #[serde(rename = "rpId")]
    pub rp_id: String,
    pub timeout: u32,
    #[serde(
        rename = "allowCredentials",
        skip_serializing_if = "Vec::is_empty",
        default
    )]
    pub allow_credentials: Vec<PasskeyCredentialDescriptor>,
    #[serde(rename = "userVerification")]
    pub user_verification: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyAssertionOptionsData {
    pub challenge_id: Uuid,
    pub options: PasskeyAssertionOptions,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PasskeyRegistrationVerifyRequest {
    pub challenge_id: Uuid,
    pub id: String,
    #[serde(default)]
    pub transports: Vec<String>,
    #[serde(rename = "attestationObject")]
    pub attestation_object: String,
    #[serde(rename = "clientDataJSON")]
    pub client_data_json: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PasskeyAssertionVerifyRequest {
    pub challenge_id: Uuid,
    pub id: String,
    #[serde(rename = "authenticatorData")]
    pub authenticator_data: String,
    pub signature: String,
    #[serde(rename = "clientDataJSON")]
    pub client_data_json: String,
    #[serde(rename = "userHandle", default)]
    pub user_handle: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyCredentialSummary {
    pub id: Uuid,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyRegistrationData {
    pub credential: PasskeyCredentialSummary,
    #[schema(value_type = String, format = Password)]
    pub csrf_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasskeyDeleteData {
    pub deleted: bool,
    #[schema(value_type = String, format = Password)]
    pub csrf_token: String,
}
