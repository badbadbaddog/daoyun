import type { components } from "./generated"

const SESSION_ENDPOINT = "/api/v1/auth/session"
const REGISTER_ENDPOINT = "/api/v1/auth/register"
const LOGIN_ENDPOINT = "/api/v1/auth/login"
const LOGOUT_ENDPOINT = "/api/v1/auth/logout"
const RECENT_AUTH_ENDPOINT = "/api/v1/auth/recent-auth"
const PASSWORD_ENDPOINT = "/api/v1/auth/password"
const DEVICE_SESSIONS_ENDPOINT = "/api/v1/auth/sessions"
const IDENTITIES_ENDPOINT = "/api/v1/auth/identities"
const OIDC_PROVIDERS_ENDPOINT = "/api/v1/auth/providers"
const OIDC_CLAIM_ENDPOINT = "/api/v1/auth/oidc/claim"
const PASSKEYS_ENDPOINT = "/api/v1/auth/passkeys"
const PASSKEY_REGISTRATION_OPTIONS_ENDPOINT = `${PASSKEYS_ENDPOINT}/registration/options`
const PASSKEY_REGISTRATION_VERIFY_ENDPOINT = `${PASSKEYS_ENDPOINT}/registration/verify`
const PASSKEY_ASSERTION_OPTIONS_ENDPOINT = `${PASSKEYS_ENDPOINT}/assertion/options`
const PASSKEY_ASSERTION_VERIFY_ENDPOINT = `${PASSKEYS_ENDPOINT}/assertion/verify`
const MFA_ENDPOINT = "/api/v1/auth/mfa"
const MFA_TOTP_SETUP_ENDPOINT = `${MFA_ENDPOINT}/totp/setup`
const MFA_TOTP_ENABLE_ENDPOINT = `${MFA_ENDPOINT}/totp/enable`
const MFA_DISABLE_ENDPOINT = `${MFA_ENDPOINT}/disable`
const MFA_RECOVERY_REGENERATE_ENDPOINT = `${MFA_ENDPOINT}/recovery-codes/regenerate`
const MFA_VERIFY_ENDPOINT = `${MFA_ENDPOINT}/verify`
const SECURITY_SETTINGS_OPERATION = "security.settings"
export const ADMIN_PRIVILEGED_WRITE_OPERATION = "admin.privileged_write"
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const tokenPattern = /^[0-9a-f]{64}$/i
const providerKeyPattern = /^[a-z][a-z0-9_-]{1,31}$/

export interface AuthUser {
  id: string
  username: string
  email: string
  displayName: string
}

export interface AuthSession {
  user: AuthUser
  csrfToken: string
}

export interface DeviceSession {
  id: string
  deviceLabel: string
  createdAt: string
  lastSeenAt: string
  isCurrent: boolean
}

export interface ExternalIdentity {
  id: string
  providerKey: string
  createdAt: string
  lastAuthenticatedAt: string | null
}

export interface OidcProvider {
  providerKey: string
  displayName: string
}

export interface OidcClaim {
  providerKey: string
  providerDisplayName: string
  profileName: string | null
  preferredUsername: string | null
  emailHint: string | null
}

export interface OidcClaimBinding {
  csrfToken: string
}

export interface RecentAuthentication {
  authenticated: true
  expiresAt: string
}

export interface PasskeyRegistrationOptions {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: Array<{ type: string; alg: number }>
  excludeCredentials: Array<{ type: string; id: string; transports?: string[] }>
  timeout: number
  authenticatorSelection: {
    authenticatorAttachment?: string
    residentKey?: string
    userVerification: string
  }
  attestation: string
}

export interface PasskeyAssertionOptions {
  challenge: string
  rpId: string
  timeout: number
  allowCredentials: Array<{ type: string; id: string; transports?: string[] }>
  userVerification: string
}

export interface PasskeyOptionsResponse<T> {
  challengeId: string
  options: T
}

export interface PasskeyCredentialSummary {
  id: string
  createdAt: string
  lastUsedAt: string | null
}

export interface RegisterInput {
  username: string
  email: string
  displayName: string
  password: string
}

export interface LoginInput {
  identifier: string
  password: string
}

export interface MfaStatus {
  enabled: boolean
  setupPending: boolean
  recoveryCodesRemaining: number
}

export interface MfaSetup {
  secretBase32: string
  otpauthUrl: string
  expiresAt: string
}

export interface MfaChallenge {
  challengeId: string
  expiresAt: string
}

export interface MfaEnableResult {
  recoveryCodes: string[]
  csrfToken: string
}

export class MfaChallengeRequiredError extends Error {
  readonly challenge: MfaChallenge

  constructor(challenge: MfaChallenge) {
    super("需要完成多因素认证")
    this.name = "MfaChallengeRequiredError"
    this.challenge = challenge
  }
}

type AuthSessionDto = components["schemas"]["ApiResponse_AuthenticatedSession"]
type DeviceSessionDto = components["schemas"]["DeviceSession"]
type DeviceSessionsDto = components["schemas"]["ApiResponse_Vec_DeviceSession"]
type DeviceSessionRevokeDto = components["schemas"]["ApiResponse_RevokeDeviceSessionData"]
type ExternalIdentityDto = components["schemas"]["ExternalIdentity"]
type ExternalIdentitiesDto = components["schemas"]["ApiResponse_Vec_ExternalIdentity"]
type OidcProviderDto = components["schemas"]["OidcProvider"]
type OidcProvidersDto = components["schemas"]["ApiResponse_Vec_OidcProvider"]
type OidcAuthorizationStartDto = components["schemas"]["ApiResponse_OidcAuthorizationStartData"]
type RecentAuthDto = components["schemas"]["ApiResponse_RecentAuthData"]
type RecentAuthRequestDto = components["schemas"]["RecentAuthRequest"]
type ChangePasswordDto = components["schemas"]["ApiResponse_ChangePasswordData"]
type ChangePasswordRequestDto = components["schemas"]["ChangePasswordRequest"]
type UnlinkExternalIdentityDto = components["schemas"]["ApiResponse_UnlinkExternalIdentityData"]
type LogoutDto = components["schemas"]["ApiResponse_LogoutData"]
type ErrorResponseDto = components["schemas"]["ErrorResponse"]
type RegisterRequestDto = components["schemas"]["RegisterRequest"]
type LoginRequestDto = components["schemas"]["LoginRequest"]
type AuthEnvelope = { data: unknown; meta: components["schemas"]["ResponseMeta"] }
type OidcClaimResponse = AuthEnvelope & {
  data: {
    provider_key: string
    provider_display_name: string
    profile_name?: string | null
    preferred_username?: string | null
    email_hint?: string | null
  }
}
type OidcClaimBindResponse = AuthEnvelope & { data: { bound: true; csrf_token: string } }
type PasskeyOptionsEnvelope = AuthEnvelope & {
  data: { challenge_id: string; options: Record<string, unknown> }
}
type PasskeyListEnvelope = AuthEnvelope & {
  data: Array<{ id: string; created_at: string; last_used_at?: string | null }>
}
type PasskeyDeleteEnvelope = AuthEnvelope & {
  data: { deleted: true; csrf_token: string }
}
type MfaStatusEnvelope = AuthEnvelope & { data: { enabled: boolean; setup_pending: boolean; recovery_codes_remaining: number } }
type MfaChallengeEnvelope = AuthEnvelope & { data: { challenge_id: string; expires_at: string } }
type MfaSetupEnvelope = AuthEnvelope & { data: { secret_base32: string; otpauth_url: string; expires_at: string } }
type MfaEnableEnvelope = AuthEnvelope & { data: { enabled: true; csrf_token: string; recovery_codes: string[] } }
type MfaDisableEnvelope = AuthEnvelope & { data: { disabled: true; csrf_token: string } }
type MfaRecoveryEnvelope = AuthEnvelope & { data: { recovery_codes: string[]; csrf_token: string } }

export class AuthApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string[]> = {},
  ) {
    super(message)
    this.name = "AuthApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function getCurrentSession(signal?: AbortSignal): Promise<AuthSession | null> {
  const response = await fetch(SESSION_ENDPOINT, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (response.status === 401) {
    return null
  }
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (!isAuthSessionResponse(payload)) {
    throw new Error("会话响应格式无效")
  }
  return mapSession(payload)
}

export async function register(input: RegisterInput, signal?: AbortSignal): Promise<AuthSession> {
  const body: RegisterRequestDto = {
    username: input.username,
    email: input.email,
    display_name: input.displayName,
    password: input.password,
  }
  const response = await fetch(REGISTER_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 201 || !isAuthSessionResponse(payload)) {
    throw new Error("注册响应格式无效")
  }
  return mapSession(payload)
}

export async function login(input: LoginInput, signal?: AbortSignal): Promise<AuthSession> {
  const body: LoginRequestDto = input
  const response = await fetch(LOGIN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  })
  const payload = await readJson(response)
  if (response.status === 202 && isMfaChallengeResponse(payload)) {
    throw new MfaChallengeRequiredError(mapMfaChallenge(payload))
  }
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isAuthSessionResponse(payload)) {
    throw new Error("登录响应格式无效")
  }
  return mapSession(payload)
}

export async function logout(csrfToken: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(LOGOUT_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isLogoutResponse(payload)) {
    throw new Error("退出响应格式无效")
  }
  return payload.data.logged_out
}

export async function createRecentAuthentication(
  password: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<RecentAuthentication> {
  return createRecentAuthenticationForOperation(password, csrfToken, SECURITY_SETTINGS_OPERATION, signal)
}

export async function createRecentAuthenticationForOperation(
  password: string,
  csrfToken: string,
  operation: string,
  signal?: AbortSignal,
): Promise<RecentAuthentication> {
  const body: RecentAuthRequestDto = {
    operation,
    password,
  }
  const response = await fetch(RECENT_AUTH_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isRecentAuthResponse(payload)) {
    throw new Error("近期认证响应格式无效")
  }
  return {
    authenticated: true,
    expiresAt: payload.data.expires_at,
  }
}

export async function startPasskeyRegistration(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<PasskeyOptionsResponse<PasskeyRegistrationOptions>> {
  const response = await fetch(PASSKEY_REGISTRATION_OPTIONS_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isPasskeyOptionsResponse(payload)) {
    throw new Error("通行密钥注册选项响应格式无效")
  }
  return {
    challengeId: payload.data.challenge_id,
    options: mapRegistrationOptions(payload.data.options),
  }
}

export async function startPasskeyAssertion(
  signal?: AbortSignal,
): Promise<PasskeyOptionsResponse<PasskeyAssertionOptions>> {
  const response = await fetch(PASSKEY_ASSERTION_OPTIONS_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isPasskeyOptionsResponse(payload)) {
    throw new Error("通行密钥登录选项响应格式无效")
  }
  return {
    challengeId: payload.data.challenge_id,
    options: mapAssertionOptions(payload.data.options),
  }
}

export async function verifyPasskeyRegistration(
  challengeId: string,
  credential: PublicKeyCredential,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<{ credential: PasskeyCredentialSummary; csrfToken: string }> {
  if (!isUuid(challengeId)) {
    throw new Error("通行密钥挑战标识无效")
  }
  const attestation = credential.response as AuthenticatorAttestationResponse
  const response = await fetch(PASSKEY_REGISTRATION_VERIFY_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    body: JSON.stringify({
      challenge_id: challengeId,
      id: credential.id,
      transports: typeof attestation.getTransports === "function" ? attestation.getTransports() : [],
      attestationObject: encodeBase64Url(attestation.attestationObject),
      clientDataJSON: encodeBase64Url(attestation.clientDataJSON),
    }),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 201 || !isPasskeyRegistrationResponse(payload)) {
    throw new Error("通行密钥注册响应格式无效")
  }
  return {
    credential: mapPasskeySummary(payload.data.credential),
    csrfToken: payload.data.csrf_token,
  }
}

export async function verifyPasskeyAssertion(
  challengeId: string,
  credential: PublicKeyCredential,
  signal?: AbortSignal,
): Promise<AuthSession> {
  if (!isUuid(challengeId)) {
    throw new Error("通行密钥挑战标识无效")
  }
  const assertion = credential.response as AuthenticatorAssertionResponse
  const response = await fetch(PASSKEY_ASSERTION_VERIFY_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      challenge_id: challengeId,
      id: credential.id,
      authenticatorData: encodeBase64Url(assertion.authenticatorData),
      signature: encodeBase64Url(assertion.signature),
      clientDataJSON: encodeBase64Url(assertion.clientDataJSON),
      userHandle: assertion.userHandle ? encodeBase64Url(assertion.userHandle) : null,
    }),
    signal,
  })
  const payload = await readJson(response)
  if (response.status === 202 && isMfaChallengeResponse(payload)) {
    throw new MfaChallengeRequiredError(mapMfaChallenge(payload))
  }
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isAuthSessionResponse(payload)) {
    throw new Error("通行密钥登录响应格式无效")
  }
  return mapSession(payload)
}

export async function verifyMfaChallenge(
  challengeId: string,
  code: string,
  signal?: AbortSignal,
): Promise<AuthSession> {
  if (!isUuid(challengeId) || !code.trim()) {
    throw new Error("多因素认证挑战或验证码无效")
  }
  const response = await fetch(MFA_VERIFY_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ challenge_id: challengeId, code: code.trim() }),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isAuthSessionResponse(payload)) {
    throw new Error("多因素认证响应格式无效")
  }
  return mapSession(payload)
}

export async function getMfaStatus(signal?: AbortSignal): Promise<MfaStatus> {
  const response = await fetch(MFA_ENDPOINT, { headers: { Accept: "application/json" }, credentials: "include", signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isMfaStatusResponse(payload)) throw new Error("多因素认证状态响应格式无效")
  return {
    enabled: payload.data.enabled,
    setupPending: payload.data.setup_pending,
    recoveryCodesRemaining: payload.data.recovery_codes_remaining,
  }
}

export async function setupMfaTotp(csrfToken: string, signal?: AbortSignal): Promise<MfaSetup> {
  const response = await fetch(MFA_TOTP_SETUP_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isMfaSetupResponse(payload)) throw new Error("多因素认证设置响应格式无效")
  return { secretBase32: payload.data.secret_base32, otpauthUrl: payload.data.otpauth_url, expiresAt: payload.data.expires_at }
}

export async function enableMfaTotp(code: string, csrfToken: string, signal?: AbortSignal): Promise<MfaEnableResult> {
  return mutateMfaCode(MFA_TOTP_ENABLE_ENDPOINT, code, csrfToken, isMfaEnableResponse, signal).then((payload) => ({
    recoveryCodes: payload.data.recovery_codes,
    csrfToken: payload.data.csrf_token,
  }))
}

export async function disableMfa(code: string, csrfToken: string, signal?: AbortSignal): Promise<string> {
  const payload = await mutateMfaCode(MFA_DISABLE_ENDPOINT, code, csrfToken, isMfaDisableResponse, signal)
  return payload.data.csrf_token
}

export async function regenerateMfaRecoveryCodes(code: string, csrfToken: string, signal?: AbortSignal): Promise<MfaEnableResult> {
  return mutateMfaCode(MFA_RECOVERY_REGENERATE_ENDPOINT, code, csrfToken, isMfaRecoveryResponse, signal).then((payload) => ({
    recoveryCodes: payload.data.recovery_codes,
    csrfToken: payload.data.csrf_token,
  }))
}

export async function listPasskeys(signal?: AbortSignal): Promise<PasskeyCredentialSummary[]> {
  const response = await fetch(PASSKEYS_ENDPOINT, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isPasskeyListResponse(payload)) {
    throw new Error("通行密钥列表响应格式无效")
  }
  return payload.data.map((credential) => ({
    id: credential.id,
    createdAt: credential.created_at,
    lastUsedAt: credential.last_used_at ?? null,
  }))
}

export async function deletePasskey(
  passkeyId: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!isUuid(passkeyId)) {
    throw new Error("通行密钥标识无效")
  }
  const response = await fetch(`${PASSKEYS_ENDPOINT}/${passkeyId}`, {
    method: "DELETE",
    headers: { Accept: "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isPasskeyDeleteResponse(payload)) {
    throw new Error("通行密钥删除响应格式无效")
  }
  return payload.data.csrf_token
}

export async function changePassword(
  newPassword: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<string> {
  const body: ChangePasswordRequestDto = { new_password: newPassword }
  const response = await fetch(PASSWORD_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isChangePasswordResponse(payload)) {
    throw new Error("修改密码响应格式无效")
  }
  return payload.data.csrf_token
}

export async function listDeviceSessions(signal?: AbortSignal): Promise<DeviceSession[]> {
  const response = await fetch(DEVICE_SESSIONS_ENDPOINT, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isDeviceSessionsResponse(payload)) {
    throw new Error("设备会话响应格式无效")
  }
  return payload.data.map((session) => ({
    id: session.id,
    deviceLabel: session.device_label,
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at,
    isCurrent: session.is_current,
  }))
}

export async function revokeDeviceSession(
  sessionId: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!isUuid(sessionId)) {
    throw new Error("设备会话标识无效")
  }
  const response = await fetch(`${DEVICE_SESSIONS_ENDPOINT}/${sessionId}`, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isDeviceSessionRevokeResponse(payload)) {
    throw new Error("设备会话撤销响应格式无效")
  }
  return payload.data.revoked
}

export async function listExternalIdentities(signal?: AbortSignal): Promise<ExternalIdentity[]> {
  const response = await fetch(IDENTITIES_ENDPOINT, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isExternalIdentitiesResponse(payload)) {
    throw new Error("外部身份列表响应格式无效")
  }
  return payload.data.map((identity) => ({
    id: identity.id,
    providerKey: identity.provider_key,
    createdAt: identity.created_at,
    lastAuthenticatedAt: identity.last_authenticated_at ?? null,
  }))
}

export async function listOidcProviders(signal?: AbortSignal): Promise<OidcProvider[]> {
  const response = await fetch(OIDC_PROVIDERS_ENDPOINT, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isOidcProvidersResponse(payload)) {
    throw new Error("外部身份服务响应格式无效")
  }
  return payload.data.map((provider) => ({
    providerKey: provider.provider_key,
    displayName: provider.display_name,
  }))
}

export async function startOidcIdentityBinding(
  providerKey: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!isProviderKey(providerKey)) {
    throw new Error("外部身份服务标识无效")
  }
  return startOidcIdentityAuthorization(
    `/api/v1/auth/oidc/${providerKey}/bindings`,
    csrfToken,
    signal,
  )
}

export async function getOidcClaim(signal?: AbortSignal): Promise<OidcClaim> {
  const response = await fetch(OIDC_CLAIM_ENDPOINT, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isOidcClaimResponse(payload)) {
    throw new Error("外部身份确认响应格式无效")
  }
  return {
    providerKey: payload.data.provider_key,
    providerDisplayName: payload.data.provider_display_name,
    profileName: payload.data.profile_name ?? null,
    preferredUsername: payload.data.preferred_username ?? null,
    emailHint: payload.data.email_hint ?? null,
  }
}

export async function createOidcClaimAccount(
  input: RegisterInput,
  signal?: AbortSignal,
): Promise<AuthSession> {
  const response = await fetch(`${OIDC_CLAIM_ENDPOINT}/account`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      username: input.username,
      email: input.email,
      display_name: input.displayName,
      password: input.password,
    }),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 201 || !isAuthSessionResponse(payload)) {
    throw new Error("外部身份账户创建响应格式无效")
  }
  return mapSession(payload)
}

export async function bindOidcClaim(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<OidcClaimBinding> {
  const response = await fetch(`${OIDC_CLAIM_ENDPOINT}/bind`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isOidcClaimBindResponse(payload)) {
    throw new Error("外部身份绑定响应格式无效")
  }
  return { csrfToken: payload.data.csrf_token }
}

export async function startOidcIdentityReplacement(
  providerKey: string,
  identityId: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!isProviderKey(providerKey)) {
    throw new Error("外部身份服务标识无效")
  }
  if (!isUuid(identityId)) {
    throw new Error("外部身份标识无效")
  }
  return startOidcIdentityAuthorization(
    `/api/v1/auth/oidc/${providerKey}/bindings/${identityId}/replacement`,
    csrfToken,
    signal,
  )
}

export async function unlinkExternalIdentity(
  identityId: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!isUuid(identityId)) {
    throw new Error("外部身份标识无效")
  }
  const response = await fetch(`${IDENTITIES_ENDPOINT}/${identityId}/unlink`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isUnlinkExternalIdentityResponse(payload)) {
    throw new Error("外部身份解绑响应格式无效")
  }
  return payload.data.csrf_token
}

async function startOidcIdentityAuthorization(
  endpoint: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isOidcAuthorizationStartResponse(payload)) {
    throw new Error("外部身份授权响应格式无效")
  }
  return payload.data.authorization_url
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

function mapSession(payload: AuthSessionDto): AuthSession {
  return {
    user: {
      id: payload.data.user.id,
      username: payload.data.user.username,
      email: payload.data.user.email,
      displayName: payload.data.user.display_name,
    },
    csrfToken: payload.data.csrf_token,
  }
}

function mapMfaChallenge(payload: MfaChallengeEnvelope): MfaChallenge {
  return { challengeId: payload.data.challenge_id, expiresAt: payload.data.expires_at }
}

async function mutateMfaCode<T>(
  endpoint: string,
  code: string,
  csrfToken: string,
  isResponse: (value: unknown) => value is AuthEnvelope & { data: T },
  signal?: AbortSignal,
): Promise<AuthEnvelope & { data: T }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify({ code }),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isResponse(payload)) throw new Error("多因素认证响应格式无效")
  return payload
}

function toApiError(status: number, payload: unknown): AuthApiError {
  if (!isErrorResponse(payload)) {
    return new AuthApiError(status, "response.invalid", "身份服务响应格式无效")
  }
  return new AuthApiError(
    status,
    payload.error.code,
    payload.error.message,
    payload.error.fields,
  )
}

function isAuthSessionResponse(value: unknown): value is AuthSessionDto {
  if (!isEnvelope(value) || !isRecord(value.data) || !isRecord(value.data.user)) {
    return false
  }
  const user = value.data.user
  return isUuid(user.id)
    && isNonEmptyString(user.username)
    && isNonEmptyString(user.email)
    && isNonEmptyString(user.display_name)
    && typeof value.data.csrf_token === "string"
    && tokenPattern.test(value.data.csrf_token)
}

function isLogoutResponse(value: unknown): value is LogoutDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && value.data.logged_out === true
}

function isDeviceSessionsResponse(value: unknown): value is DeviceSessionsDto {
  return isEnvelope(value)
    && Array.isArray(value.data)
    && value.data.every(isDeviceSession)
}

function isDeviceSessionRevokeResponse(value: unknown): value is DeviceSessionRevokeDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && value.data.revoked === true
}

function isExternalIdentitiesResponse(value: unknown): value is ExternalIdentitiesDto {
  return isEnvelope(value)
    && Array.isArray(value.data)
    && value.data.every(isExternalIdentity)
}

function isOidcProvidersResponse(value: unknown): value is OidcProvidersDto {
  return isEnvelope(value)
    && Array.isArray(value.data)
    && value.data.every(isOidcProvider)
}

function isOidcAuthorizationStartResponse(value: unknown): value is OidcAuthorizationStartDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && isSafeHttpsUrl(value.data.authorization_url)
}

function isOidcClaimResponse(value: unknown): value is OidcClaimResponse {
  return isEnvelope(value)
    && isRecord(value.data)
    && isProviderKey(value.data.provider_key)
    && isNonEmptyString(value.data.provider_display_name)
    && optionalString(value.data.profile_name)
    && optionalString(value.data.preferred_username)
    && optionalString(value.data.email_hint)
}

function isOidcClaimBindResponse(value: unknown): value is OidcClaimBindResponse {
  return isEnvelope(value)
    && isRecord(value.data)
    && value.data.bound === true
    && typeof value.data.csrf_token === "string"
    && tokenPattern.test(value.data.csrf_token)
}

function isRecentAuthResponse(value: unknown): value is RecentAuthDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && value.data.authenticated === true
    && isTimestamp(value.data.expires_at)
}

function isMfaChallengeResponse(value: unknown): value is MfaChallengeEnvelope {
  return isEnvelope(value) && isRecord(value.data) && isUuid(value.data.challenge_id) && isTimestamp(value.data.expires_at)
}

function isMfaStatusResponse(value: unknown): value is MfaStatusEnvelope {
  return isEnvelope(value) && isRecord(value.data)
    && typeof value.data.enabled === "boolean"
    && typeof value.data.setup_pending === "boolean"
    && typeof value.data.recovery_codes_remaining === "number"
}

function isMfaSetupResponse(value: unknown): value is MfaSetupEnvelope {
  return isEnvelope(value) && isRecord(value.data)
    && isNonEmptyString(value.data.secret_base32)
    && isNonEmptyString(value.data.otpauth_url)
    && isTimestamp(value.data.expires_at)
}

function isMfaEnableResponse(value: unknown): value is MfaEnableEnvelope {
  return isEnvelope(value) && isRecord(value.data) && value.data.enabled === true
    && Array.isArray(value.data.recovery_codes)
    && value.data.recovery_codes.length === 10
    && value.data.recovery_codes.every(isNonEmptyString)
    && typeof value.data.csrf_token === "string" && tokenPattern.test(value.data.csrf_token)
}

function isMfaDisableResponse(value: unknown): value is MfaDisableEnvelope {
  return isEnvelope(value) && isRecord(value.data) && value.data.disabled === true
    && typeof value.data.csrf_token === "string" && tokenPattern.test(value.data.csrf_token)
}

function isMfaRecoveryResponse(value: unknown): value is MfaRecoveryEnvelope {
  return isEnvelope(value) && isRecord(value.data)
    && Array.isArray(value.data.recovery_codes)
    && value.data.recovery_codes.length === 10
    && value.data.recovery_codes.every(isNonEmptyString)
    && typeof value.data.csrf_token === "string" && tokenPattern.test(value.data.csrf_token)
}

function isPasskeyOptionsResponse(value: unknown): value is PasskeyOptionsEnvelope {
  return isEnvelope(value)
    && isRecord(value.data)
    && isUuid(value.data.challenge_id)
    && isRecord(value.data.options)
}

function isPasskeyListResponse(value: unknown): value is PasskeyListEnvelope {
  return isEnvelope(value)
    && Array.isArray(value.data)
    && value.data.every((credential) => isRecord(credential)
      && isUuid(credential.id)
      && isTimestamp(credential.created_at)
      && (credential.last_used_at === null || credential.last_used_at === undefined || isTimestamp(credential.last_used_at)))
}

function isPasskeyDeleteResponse(value: unknown): value is PasskeyDeleteEnvelope {
  return isEnvelope(value)
    && isRecord(value.data)
    && value.data.deleted === true
    && typeof value.data.csrf_token === "string"
    && tokenPattern.test(value.data.csrf_token)
}

function isPasskeyRegistrationResponse(value: unknown): value is AuthEnvelope & {
  data: { credential: Record<string, unknown>; csrf_token: string }
} {
  return isEnvelope(value)
    && isRecord(value.data)
    && isRecord(value.data.credential)
    && isUuid(value.data.credential.id)
    && isTimestamp(value.data.credential.created_at)
    && (value.data.credential.last_used_at === null
      || value.data.credential.last_used_at === undefined
      || isTimestamp(value.data.credential.last_used_at))
    && typeof value.data.csrf_token === "string"
    && tokenPattern.test(value.data.csrf_token)
}

function mapPasskeySummary(value: Record<string, unknown>): PasskeyCredentialSummary {
  return {
    id: requiredString(value, "id"),
    createdAt: requiredString(value, "created_at"),
    lastUsedAt: typeof value.last_used_at === "string" ? value.last_used_at : null,
  }
}

function mapRegistrationOptions(value: Record<string, unknown>): PasskeyRegistrationOptions {
  const rp = requiredRecord(value, "rp")
  const user = requiredRecord(value, "user")
  const selection = requiredRecord(value, "authenticatorSelection")
  const parameters = requiredArray(value, "pubKeyCredParams")
    .map((parameter) => {
      const item = asRecord(parameter)
      return { type: requiredString(item, "type"), alg: requiredNumber(item, "alg") }
    })
  return {
    challenge: requiredString(value, "challenge"),
    rp: { id: requiredString(rp, "id"), name: requiredString(rp, "name") },
    user: {
      id: requiredString(user, "id"),
      name: requiredString(user, "name"),
      displayName: requiredString(user, "displayName"),
    },
    pubKeyCredParams: parameters,
    excludeCredentials: mapCredentialDescriptors(value, "excludeCredentials"),
    timeout: requiredNumber(value, "timeout"),
    authenticatorSelection: {
      authenticatorAttachment: optionalStringValue(selection.authenticatorAttachment),
      residentKey: optionalStringValue(selection.residentKey),
      userVerification: requiredString(selection, "userVerification"),
    },
    attestation: requiredString(value, "attestation"),
  }
}

function mapAssertionOptions(value: Record<string, unknown>): PasskeyAssertionOptions {
  return {
    challenge: requiredString(value, "challenge"),
    rpId: requiredString(value, "rpId"),
    timeout: requiredNumber(value, "timeout"),
    allowCredentials: mapCredentialDescriptors(value, "allowCredentials"),
    userVerification: requiredString(value, "userVerification"),
  }
}

function mapCredentialDescriptors(
  value: Record<string, unknown>,
  field: string,
): Array<{ type: string; id: string; transports?: string[] }> {
  const descriptors = value[field]
  if (!Array.isArray(descriptors)) {
    throw new Error("通行密钥选项中的凭据描述符无效")
  }
  return descriptors.map((descriptor) => {
    const item = asRecord(descriptor)
    const transports = item.transports
    return {
      type: requiredString(item, "type"),
      id: requiredString(item, "id"),
      ...(Array.isArray(transports) ? { transports: transports.filter(isNonEmptyString) } : {}),
    }
  })
}

function requiredRecord(value: Record<string, unknown>, field: string): Record<string, unknown> {
  return asRecord(value[field])
}

function requiredArray(value: Record<string, unknown>, field: string): unknown[] {
  const result = value[field]
  if (!Array.isArray(result)) {
    throw new Error("通行密钥选项中的算法参数无效")
  }
  return result
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("通行密钥响应格式无效")
  }
  return value
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const result = value[field]
  if (!isNonEmptyString(result)) {
    throw new Error("通行密钥响应格式无效")
  }
  return result
}

function requiredNumber(value: Record<string, unknown>, field: string): number {
  const result = value[field]
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("通行密钥响应格式无效")
  }
  return result
}

function optionalStringValue(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined
}

function encodeBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "")
}

function isChangePasswordResponse(value: unknown): value is ChangePasswordDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && typeof value.data.csrf_token === "string"
    && tokenPattern.test(value.data.csrf_token)
}

function isUnlinkExternalIdentityResponse(value: unknown): value is UnlinkExternalIdentityDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && value.data.unlinked === true
    && typeof value.data.csrf_token === "string"
    && tokenPattern.test(value.data.csrf_token)
}

function isDeviceSession(value: unknown): value is DeviceSessionDto {
  return isRecord(value)
    && isUuid(value.id)
    && isNonEmptyString(value.device_label)
    && isTimestamp(value.created_at)
    && isTimestamp(value.last_seen_at)
    && typeof value.is_current === "boolean"
}

function isExternalIdentity(value: unknown): value is ExternalIdentityDto {
  return isRecord(value)
    && isUuid(value.id)
    && isProviderKey(value.provider_key)
    && isTimestamp(value.created_at)
    && (value.last_authenticated_at === null || isTimestamp(value.last_authenticated_at))
}

function isOidcProvider(value: unknown): value is OidcProviderDto {
  return isRecord(value)
    && isProviderKey(value.provider_key)
    && isNonEmptyString(value.display_name)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function isEnvelope(value: unknown): value is AuthEnvelope {
  return isRecord(value)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
}

function isErrorResponse(value: unknown): value is ErrorResponseDto {
  if (!isRecord(value)
    || !isRecord(value.error)
    || !isRecord(value.meta)
    || !isUuid(value.meta.request_id)
    || !isNonEmptyString(value.error.code)
    || !isNonEmptyString(value.error.message)) {
    return false
  }
  return value.error.fields === undefined || isFieldErrors(value.error.fields)
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return isRecord(value)
    && Object.values(value).every((messages) => (
      Array.isArray(messages)
      && messages.length > 0
      && messages.every(isNonEmptyString)
    ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}

function isProviderKey(value: unknown): value is string {
  return typeof value === "string" && providerKeyPattern.test(value)
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false
  }
  try {
    const url = new URL(value)
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.hash
  } catch {
    return false
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function optionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isNonEmptyString(value)
}
