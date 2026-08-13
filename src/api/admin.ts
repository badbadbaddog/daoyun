import type { components } from "./generated"
import type { MembershipAccount } from "./users"

export type BrandThemePreset = components["schemas"]["BrandThemePreset"]
export type BrandListDensity = components["schemas"]["BrandListDensity"]
export type BrandHomeMode = components["schemas"]["BrandHomeMode"]
export type AdminBoardVisibility = components["schemas"]["AdminBoardVisibility"]
export type BoardTone = components["schemas"]["BoardTone"]
export type BrandAssetKind = "logo" | "favicon"

export interface BrandLink {
  label: string
  url: string
}

export interface AdminCapabilityAccess {
  capabilityKeys: string[]
}

export interface SiteBranding {
  siteName: string
  logoUrl: string | null
  faviconUrl: string | null
  defaultCoverUrl: string | null
  navigationLinks: BrandLink[]
  footerText: string | null
  footerLinks: BrandLink[]
  primaryColor: string
  accentColor: string
  themePreset: BrandThemePreset
  listDensity: BrandListDensity
  homeMode: BrandHomeMode
}

export interface SiteBrandingInput extends SiteBranding {}

export interface AdminBoard {
  id: string
  parentId: string | null
  slug: string
  name: string
  description: string
  icon: string
  tone: BoardTone
  position: number
  visibility: AdminBoardVisibility
  topicCount: number
  revision: number
}

export interface AdminBoardInput {
  parentId: string | null
  slug: string
  name: string
  description: string
  icon: string
  tone: BoardTone
  position: number
  visibility: AdminBoardVisibility
}

export interface AdminBoardUpdateInput extends AdminBoardInput {
  expectedRevision: number
}

export interface AdminBoardDeletionImpact {
  boardId: string
  childCount: number
  topicCount: number
  replyCount: number
  canDelete: boolean
}

export interface GovernancePolicy {
  enabled: boolean
  alertScoreThreshold: number
  reporterWindowMinutes: number
  reporterAlertLimit: number
}

export type RiskAlertKind = components["schemas"]["RiskAlertKind"]
export type RiskAlertSeverity = components["schemas"]["RiskAlertSeverity"]
export type RiskAlertStatus = components["schemas"]["RiskAlertStatus"]

export interface MembershipLevelRule {
  levelKey: string
  levelNumber: number
  levelDisplayName: string
  requiredLifetimePoints: number
  enabled: boolean
  updatedAt: string
}

export interface MembershipLevelRuleInput {
  requiredLifetimePoints?: number
  enabled?: boolean
  displayName?: string
}

export interface MembershipPointsGrantInput {
  userId: string
  amount: number
  reason: string
  idempotencyKey?: string | null
}

export interface MembershipPointsGrant {
  account: MembershipAccount
  created: boolean
}

export interface MembershipMedalRule {
  key: string
  displayName: string
  enabled: boolean
  requiredLifetimePoints: number | null
  updatedAt: string
}

export interface MembershipMedalGrantInput {
  userId: string
  medalKey: string
  reason: string
}

export interface MembershipMedal {
  key: string
  displayName: string
  assetUrl: string
  sha256: string
  grantedAt: string
}

export interface MembershipMedalGrant {
  medal: MembershipMedal
  created: boolean
}

export interface RiskAlert {
  id: string
  kind: RiskAlertKind
  severity: RiskAlertSeverity
  score: number
  targetType: string | null
  targetId: string | null
  reporterId: string | null
  reportId: string | null
  status: RiskAlertStatus
  details: Record<string, unknown>
  acknowledgedBy: { id: string; username: string; displayName: string; avatarUrl: string | null } | null
  createdAt: string
  acknowledgedAt: string | null
}

export interface AdminAuditEntry {
  id: string
  actor: { id: string; username: string; displayName: string; avatarUrl: string | null }
  action: string
  resourceType: string
  resourceId: string | null
  summary: Record<string, unknown>
  createdAt: string
}

export interface ListAdminAuditOptions {
  actorId?: string
  action?: string
  resourceType?: string
  resourceId?: string
  userId?: string
  reportId?: string
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export type AuthorizationRoleScope = components["schemas"]["AuthorizationRoleScope"]

export interface AuthorizationPermission {
  key: string
  name: string
  description: string
}

export interface AuthorizationRole {
  id: string
  key: string
  name: string
  scope: AuthorizationRoleScope
  isSystem: boolean
  permissionKeys: string[]
  assignmentCount: number
  revision: number
  createdAt: string
  updatedAt: string
}

export interface AuthorizationAssignedRole {
  id: string
  key: string
  name: string
  scope: AuthorizationRoleScope
  isSystem: boolean
  revision: number
}

export interface AuthorizationUserSummary {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
}

export interface AuthorizationRoleAssignment {
  id: string
  user: AuthorizationUserSummary
  role: AuthorizationAssignedRole
  scopeId: string | null
  assignedBy: AuthorizationUserSummary
  createdAt: string
}

export interface CreateAuthorizationRoleInput {
  key: string
  name: string
  scope: AuthorizationRoleScope
  permissionKeys: string[]
}

export interface UpdateAuthorizationRoleInput {
  name: string
  permissionKeys: string[]
  expectedRevision: number
}

export interface CreateAuthorizationAssignmentInput {
  username: string
  roleId: string
  scopeId: string | null
}

export type OperationsAlertRuleKind = components["schemas"]["OperationsAlertRuleKind"]
export type OperationsAlertStatus = components["schemas"]["OperationsAlertStatus"]

export interface OperationsSummary {
  observedAt: string
  uptimeSeconds: number
  http: { totalRequests: number; inFlightRequests: number; errors5m: number; p95Ms5m: number }
  database: { ready: boolean; connections: number; idleConnections: number }
  outbox: { pending: number; processing: number; dead: number }
  riskAlertsOpen: number
  alerts: { open: number; acknowledged: number }
}

export interface OperationsAlertRule {
  id: string
  key: string
  name: string
  kind: OperationsAlertRuleKind
  threshold: number
  windowSeconds: number
  enabled: boolean
  revision: number
  createdAt: string
  updatedAt: string
}

export interface OperationsAlertRuleReference {
  id: string
  key: string
  name: string
  kind: OperationsAlertRuleKind
}

export interface OperationsAlert {
  id: string
  rule: OperationsAlertRuleReference
  status: OperationsAlertStatus
  observedValue: number
  threshold: number
  firstTriggeredAt: string
  lastTriggeredAt: string
  acknowledgedBy: AuthorizationUserSummary | null
  acknowledgedAt: string | null
  resolvedAt: string | null
}

export interface UpdateOperationsAlertRuleInput {
  name: string
  threshold: number
  windowSeconds: number
  enabled: boolean
  expectedRevision: number
}

type Envelope<T> = { data: T; meta: components["schemas"]["ResponseMeta"] }
type ErrorDto = components["schemas"]["ErrorResponse"]

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const presets = new Set<BrandThemePreset>(["default", "dark", "compact", "high_contrast"])
const densities = new Set<BrandListDensity>(["comfortable", "compact"])
const homeModes = new Set<BrandHomeMode>(["latest", "hot", "featured"])
const visibilities = new Set<AdminBoardVisibility>(["public", "hidden"])
const tones = new Set<BoardTone>(["green", "blue", "amber", "rose"])
const membershipLevelPattern = /^lv_(?:[1-9]|1[0-9]|20)$/
const membershipMedalPattern = /^medal_(?:0[1-9]|1[0-7])$/
const capabilityKeyPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/

export class AdminApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(status: number, code: string, message: string, fields: Record<string, string[]> = {}) {
    super(message)
    this.name = "AdminApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function getAdminAccess(signal?: AbortSignal): Promise<AdminCapabilityAccess> {
  const response = await fetch("/api/v1/admin/access", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse(response, isAdminCapabilityAccessDto)
}

export async function getAdminSiteBranding(signal?: AbortSignal): Promise<SiteBranding> {
  const response = await fetch("/api/v1/admin/site-branding", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse(response, isBranding)
}

export async function updateSiteBranding(input: SiteBrandingInput, csrfToken: string, signal?: AbortSignal): Promise<SiteBranding> {
  const body = toBrandingDto(input)
  const response = await fetch("/api/v1/admin/site-branding", {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(body), signal,
  })
  return parseResponse(response, isBranding)
}

export async function uploadBrandAsset(kind: BrandAssetKind, file: File, csrfToken: string, signal?: AbortSignal): Promise<SiteBranding> {
  const response = await fetch(`/api/v1/admin/site-branding/assets/${kind}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": file.type, "x-csrf-token": csrfToken },
    credentials: "include",
    body: file,
    signal,
  })
  return parseResponse(response, isBranding)
}

export async function deleteBrandAsset(kind: BrandAssetKind, csrfToken: string, signal?: AbortSignal): Promise<SiteBranding> {
  const response = await fetch(`/api/v1/admin/site-branding/assets/${kind}`, {
    method: "DELETE",
    headers: { Accept: "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    signal,
  })
  return parseResponse(response, isBranding)
}

export async function listAdminBoards(signal?: AbortSignal): Promise<AdminBoard[]> {
  const response = await fetch("/api/v1/admin/boards", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse<AdminBoard[]>(response, (value): value is AdminBoardDto[] => Array.isArray(value) && value.every(isBoard))
}

export async function createAdminBoard(input: AdminBoardInput, csrfToken: string, signal?: AbortSignal): Promise<AdminBoard> {
  const response = await fetch("/api/v1/admin/boards", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(toCreateBoardDto(input)), signal,
  })
  return parseResponse(response, isBoard)
}

export async function updateAdminBoard(boardId: string, input: AdminBoardUpdateInput, csrfToken: string, signal?: AbortSignal): Promise<AdminBoard> {
  const response = await fetch(`/api/v1/admin/boards/${boardId}`, {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(toUpdateBoardDto(input)), signal,
  })
  return parseResponse(response, isBoard)
}

export async function deleteAdminBoard(boardId: string, csrfToken: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(`/api/v1/admin/boards/${boardId}`, {
    method: "DELETE", headers: { Accept: "application/json", "x-csrf-token": csrfToken }, credentials: "include", signal,
  })
  return parseResponse(response, (value): value is true => value === true)
}

export async function getAdminBoardDeletionImpact(boardId: string, signal?: AbortSignal): Promise<AdminBoardDeletionImpact> {
  const response = await fetch(`/api/v1/admin/boards/${boardId}/deletion-impact`, {
    headers: { Accept: "application/json" }, credentials: "include", signal,
  })
  return parseResponse(response, isBoardDeletionImpactDto)
}

export async function getGovernancePolicy(signal?: AbortSignal): Promise<GovernancePolicy> {
  const response = await fetch("/api/v1/admin/governance/policy", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse(response, isGovernancePolicy)
}

export async function updateGovernancePolicy(input: GovernancePolicy, csrfToken: string, signal?: AbortSignal): Promise<GovernancePolicy> {
  const body: UpdateGovernancePolicyRequestDto = { enabled: input.enabled, alert_score_threshold: input.alertScoreThreshold, reporter_window_minutes: input.reporterWindowMinutes, reporter_alert_limit: input.reporterAlertLimit }
  const response = await fetch("/api/v1/admin/governance/policy", {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(body), signal,
  })
  return parseResponse(response, isGovernancePolicy)
}

export async function listRiskAlerts(options: { status?: RiskAlertStatus; cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<{ alerts: RiskAlert[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (options.status) params.set("status", options.status)
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const response = await fetch(`/api/v1/admin/risk-alerts${params.size ? `?${params}` : ""}`, { headers: { Accept: "application/json" }, credentials: "include", signal: options.signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isRiskAlertPage(payload)) throw new AdminApiError(response.status, "response.invalid", "风险告警响应格式无效")
  return { alerts: payload.data.map(mapValue) as RiskAlert[], nextCursor: payload.meta.next_cursor }
}

export async function updateRiskAlert(alertId: string, status: Exclude<RiskAlertStatus, "open">, csrfToken: string, signal?: AbortSignal): Promise<RiskAlert> {
  const body: UpdateRiskAlertRequestDto = { status }
  const response = await fetch(`/api/v1/admin/risk-alerts/${alertId}`, {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(body), signal,
  })
  return parseResponse(response, isRiskAlertDto)
}

export async function listAdminAuditAlerts(options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<{ entries: AdminAuditEntry[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ resource_type: "risk_alert" })
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const response = await fetch(`/api/v1/admin/audit/alerts?${params}`, { headers: { Accept: "application/json" }, credentials: "include", signal: options.signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isAuditPage(payload)) throw new AdminApiError(response.status, "response.invalid", "审计告警响应格式无效")
  return { entries: payload.data.map(mapValue) as AdminAuditEntry[], nextCursor: payload.meta.next_cursor }
}

export async function listAdminAudit(options: ListAdminAuditOptions = {}): Promise<{ entries: AdminAuditEntry[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (options.actorId) params.set("actor_id", options.actorId)
  if (options.action) params.set("action", options.action)
  if (options.resourceType) params.set("resource_type", options.resourceType)
  if (options.resourceId) params.set("resource_id", options.resourceId)
  if (options.userId) params.set("user_id", options.userId)
  if (options.reportId) params.set("report_id", options.reportId)
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const response = await fetch(`/api/v1/admin/audit${params.size ? `?${params}` : ""}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isAuditPage(payload)) throw new AdminApiError(response.status, "response.invalid", "审计记录响应格式无效")
  return { entries: payload.data.map(mapValue) as AdminAuditEntry[], nextCursor: payload.meta.next_cursor }
}

export async function getMembershipLevelRules(signal?: AbortSignal): Promise<MembershipLevelRule[]> {
  const response = await fetch("/api/v1/admin/membership/level-rules", {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  return parseResponse<MembershipLevelRule[]>(response, (value): value is MembershipLevelRuleDto[] => Array.isArray(value) && value.every(isMembershipLevelRuleDto))
}

export async function updateMembershipLevelRule(levelKey: string, input: MembershipLevelRuleInput, csrfToken: string, signal?: AbortSignal): Promise<MembershipLevelRule> {
  if (!membershipLevelPattern.test(levelKey)) throw new AdminApiError(422, "validation.failed", "等级键必须是 lv_1 至 lv_20")
  const response = await fetch(`/api/v1/admin/membership/level-rules/${encodeURIComponent(levelKey)}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify(toMembershipLevelRuleDto(input)),
    signal,
  })
  return parseResponse(response, isMembershipLevelRuleDto)
}

export async function grantMembershipPoints(input: MembershipPointsGrantInput, csrfToken: string, signal?: AbortSignal): Promise<MembershipPointsGrant> {
  const response = await fetch("/api/v1/admin/membership/points", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify(toMembershipPointsGrantDto(input)),
    signal,
  })
  return parseResponse(response, isMembershipPointsGrantDto)
}

export async function getMembershipMedalRules(signal?: AbortSignal): Promise<MembershipMedalRule[]> {
  const response = await fetch("/api/v1/admin/membership/medal-rules", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse<MembershipMedalRule[]>(response, (value): value is MembershipMedalRuleDto[] => Array.isArray(value) && value.every(isMembershipMedalRuleDto))
}

export async function updateMembershipMedalRule(key: string, input: Pick<MembershipMedalRule, "enabled" | "requiredLifetimePoints">, csrfToken: string, signal?: AbortSignal): Promise<MembershipMedalRule> {
  if (!membershipMedalPattern.test(key)) throw new AdminApiError(422, "validation.failed", "勋章键必须是 medal_01 至 medal_17")
  const response = await fetch(`/api/v1/admin/membership/medal-rules/${encodeURIComponent(key)}`, {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include",
    body: JSON.stringify({ enabled: input.enabled, required_lifetime_points: input.requiredLifetimePoints }), signal,
  })
  return parseResponse(response, isMembershipMedalRuleDto)
}

export async function grantMembershipMedal(input: MembershipMedalGrantInput, csrfToken: string, signal?: AbortSignal): Promise<MembershipMedalGrant> {
  const response = await fetch("/api/v1/admin/membership/medals", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include",
    body: JSON.stringify({ user_id: input.userId, medal_key: input.medalKey, reason: input.reason }), signal,
  })
  return parseResponse(response, isMembershipMedalGrantDto)
}

export async function listAuthorizationPermissions(signal?: AbortSignal): Promise<AuthorizationPermission[]> {
  const response = await fetch("/api/v1/admin/authorization/permissions", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse(response, (value): value is AuthorizationPermissionDto[] => Array.isArray(value) && value.every(isAuthorizationPermissionDto))
}

export async function listAuthorizationRoles(signal?: AbortSignal): Promise<AuthorizationRole[]> {
  const response = await fetch("/api/v1/admin/authorization/roles", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse(response, (value): value is AuthorizationRoleDto[] => Array.isArray(value) && value.every(isAuthorizationRoleDto))
}

export async function listAuthorizationAssignments(options: { username?: string; roleId?: string; scopeId?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<{ assignments: AuthorizationRoleAssignment[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (options.username) params.set("username", options.username)
  if (options.roleId) params.set("role_id", options.roleId)
  if (options.scopeId) params.set("scope_id", options.scopeId)
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const response = await fetch(`/api/v1/admin/authorization/assignments${params.size ? `?${params}` : ""}`, { headers: { Accept: "application/json" }, credentials: "include", signal: options.signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isAuthorizationAssignmentPage(payload)) throw new AdminApiError(response.status, "response.invalid", "角色分配响应格式无效")
  return { assignments: payload.data.map(mapValue) as AuthorizationRoleAssignment[], nextCursor: payload.meta.next_cursor ?? null }
}

export async function createAuthorizationRole(input: CreateAuthorizationRoleInput, csrfToken: string, signal?: AbortSignal): Promise<AuthorizationRole> {
  const body: CreateAuthorizationRoleRequestDto = { key: input.key, name: input.name, scope: input.scope, permission_keys: input.permissionKeys }
  const response = await fetch("/api/v1/admin/authorization/roles", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(body), signal,
  })
  return parseResponse(response, isAuthorizationRoleDto)
}

export async function updateAuthorizationRole(roleId: string, input: UpdateAuthorizationRoleInput, csrfToken: string, signal?: AbortSignal): Promise<AuthorizationRole> {
  const body: UpdateAuthorizationRoleRequestDto = { name: input.name, permission_keys: input.permissionKeys, expected_revision: input.expectedRevision }
  const response = await fetch(`/api/v1/admin/authorization/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(body), signal,
  })
  return parseResponse(response, isAuthorizationRoleDto)
}

export async function deleteAuthorizationRole(roleId: string, csrfToken: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(`/api/v1/admin/authorization/roles/${encodeURIComponent(roleId)}`, {
    method: "DELETE", headers: { Accept: "application/json", "x-csrf-token": csrfToken }, credentials: "include", signal,
  })
  return parseResponse(response, (value): value is true => value === true)
}

export async function createAuthorizationAssignment(input: CreateAuthorizationAssignmentInput, csrfToken: string, signal?: AbortSignal): Promise<AuthorizationRoleAssignment> {
  const body: CreateAuthorizationAssignmentRequestDto = { username: input.username, role_id: input.roleId, scope_id: input.scopeId }
  const response = await fetch("/api/v1/admin/authorization/assignments", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(body), signal,
  })
  return parseResponse(response, isAuthorizationRoleAssignmentDto)
}

export async function deleteAuthorizationAssignment(assignmentId: string, csrfToken: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(`/api/v1/admin/authorization/assignments/${encodeURIComponent(assignmentId)}`, {
    method: "DELETE", headers: { Accept: "application/json", "x-csrf-token": csrfToken }, credentials: "include", signal,
  })
  return parseResponse(response, (value): value is true => value === true)
}

export async function getOperationsSummary(signal?: AbortSignal): Promise<OperationsSummary> {
  const response = await fetch("/api/v1/admin/operations/summary", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse(response, isOperationsSummaryDto)
}

export async function listOperationsAlertRules(signal?: AbortSignal): Promise<OperationsAlertRule[]> {
  const response = await fetch("/api/v1/admin/operations/alert-rules", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse(response, (value): value is OperationsAlertRuleDto[] => Array.isArray(value) && value.every(isOperationsAlertRuleDto))
}

export async function updateOperationsAlertRule(ruleId: string, input: UpdateOperationsAlertRuleInput, csrfToken: string, signal?: AbortSignal): Promise<OperationsAlertRule> {
  const body: UpdateOperationsAlertRuleRequestDto = { name: input.name, threshold: input.threshold, window_seconds: input.windowSeconds, enabled: input.enabled, expected_revision: input.expectedRevision }
  const response = await fetch(`/api/v1/admin/operations/alert-rules/${encodeURIComponent(ruleId)}`, {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(body), signal,
  })
  return parseResponse(response, isOperationsAlertRuleDto)
}

export async function listOperationsAlerts(options: { status?: OperationsAlertStatus; cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<{ alerts: OperationsAlert[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (options.status) params.set("status", options.status)
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const response = await fetch(`/api/v1/admin/operations/alerts${params.size ? `?${params}` : ""}`, { headers: { Accept: "application/json" }, credentials: "include", signal: options.signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isOperationsAlertPage(payload)) throw new AdminApiError(response.status, "response.invalid", "运营告警响应格式无效")
  return { alerts: payload.data.map(mapValue) as OperationsAlert[], nextCursor: payload.meta.next_cursor }
}

export async function acknowledgeOperationsAlert(alertId: string, csrfToken: string, signal?: AbortSignal): Promise<OperationsAlert> {
  const body: UpdateOperationsAlertRequestDto = { status: "acknowledged" }
  const response = await fetch(`/api/v1/admin/operations/alerts/${encodeURIComponent(alertId)}`, {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(body), signal,
  })
  return parseResponse(response, isOperationsAlertDto)
}

type BrandingDto = Required<components["schemas"]["SiteBranding"]>
type AdminCapabilityAccessDto = components["schemas"]["AdminCapabilityAccess"]
type AdminBoardDto = components["schemas"]["AdminBoard"]
type AdminBoardDeletionImpactDto = components["schemas"]["AdminBoardDeletionImpact"]
type GovernancePolicyDto = components["schemas"]["GovernancePolicy"]
type UserSummaryDto = Required<components["schemas"]["UserSummary"]>
type RiskAlertDto = Omit<components["schemas"]["RiskAlert"], "acknowledged_at" | "acknowledged_by" | "report_id" | "reporter_id" | "target_id" | "target_type" | "details"> & {
  acknowledged_at: string | null
  acknowledged_by: UserSummaryDto | null
  report_id: string | null
  reporter_id: string | null
  target_id: string | null
  target_type: string | null
  details: Record<string, unknown>
}
type AuditEntryDto = Omit<components["schemas"]["AdminAuditEntry"], "actor" | "resource_id" | "summary"> & {
  actor: UserSummaryDto
  resource_id: string | null
  summary: Record<string, unknown>
}
type RiskAlertPageDto = Omit<components["schemas"]["PageResponse_RiskAlert"], "data" | "meta"> & { data: RiskAlertDto[]; meta: Required<components["schemas"]["PageMeta"]> }
type AuditPageDto = Omit<components["schemas"]["PageResponse_AdminAuditEntry"], "data" | "meta"> & { data: AuditEntryDto[]; meta: Required<components["schemas"]["PageMeta"]> }
type UpdateSiteBrandingRequestDto = components["schemas"]["UpdateSiteBrandingRequest"]
type CreateAdminBoardRequestDto = components["schemas"]["CreateAdminBoardRequest"]
type UpdateAdminBoardRequestDto = components["schemas"]["UpdateAdminBoardRequest"]
type UpdateGovernancePolicyRequestDto = components["schemas"]["UpdateGovernancePolicyRequest"]
type UpdateRiskAlertRequestDto = components["schemas"]["UpdateRiskAlertRequest"]
type MembershipLevelRuleDto = components["schemas"]["MembershipLevelRule"]
type UpdateMembershipLevelRuleRequestDto = components["schemas"]["UpdateMembershipLevelRuleRequest"]
type GrantMembershipPointsRequestDto = components["schemas"]["GrantMembershipPointsRequest"]
type MembershipPointsGrantDto = components["schemas"]["MembershipPointsGrant"]
type MembershipAccountDto = components["schemas"]["MembershipAccount"]
type MembershipMedalRuleDto = { key: string; display_name: string; enabled: boolean; required_lifetime_points: number | null; updated_at: string }
type MembershipMedalDto = { key: string; display_name: string; asset_url: string; sha256: string; granted_at: string }
type MembershipMedalGrantDto = { medal: MembershipMedalDto; created: boolean }
type AuthorizationPermissionDto = components["schemas"]["AuthorizationPermission"]
type AuthorizationRoleDto = components["schemas"]["AuthorizationRole"]
type AuthorizationAssignedRoleDto = components["schemas"]["AuthorizationAssignedRole"]
type AuthorizationRoleAssignmentDto = components["schemas"]["AuthorizationRoleAssignment"]
type CreateAuthorizationRoleRequestDto = components["schemas"]["CreateAuthorizationRoleRequest"]
type UpdateAuthorizationRoleRequestDto = components["schemas"]["UpdateAuthorizationRoleRequest"]
type CreateAuthorizationAssignmentRequestDto = components["schemas"]["CreateAuthorizationAssignmentRequest"]
type OperationsSummaryDto = components["schemas"]["OperationsSummary"]
type OperationsAlertRuleDto = components["schemas"]["OperationsAlertRule"]
type OperationsAlertRuleReferenceDto = components["schemas"]["OperationsAlertRuleReference"]
type OperationsAlertDto = Omit<components["schemas"]["OperationsAlert"], "acknowledged_at" | "acknowledged_by" | "resolved_at"> & {
  acknowledged_at: string | null
  acknowledged_by: UserSummaryDto | null
  resolved_at: string | null
}
type UpdateOperationsAlertRuleRequestDto = components["schemas"]["UpdateOperationsAlertRuleRequest"]
type UpdateOperationsAlertRequestDto = components["schemas"]["UpdateOperationsAlertRequest"]

async function parseResponse<T>(response: Response, guard: (value: unknown) => boolean): Promise<T> {
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isEnvelope(payload) || !guard(payload.data)) throw new AdminApiError(response.status, "response.invalid", "管理服务响应格式无效")
  return mapValue(payload.data) as T
}

function mapValue(value: unknown): unknown {
  if (isAdminCapabilityAccessDto(value)) return { capabilityKeys: value.capability_keys }
  if (isOperationsSummaryDto(value)) return { observedAt: value.observed_at, uptimeSeconds: value.uptime_seconds, http: { totalRequests: value.http.total_requests, inFlightRequests: value.http.in_flight_requests, errors5m: value.http.errors_5m, p95Ms5m: value.http.p95_ms_5m }, database: { ready: value.database.ready, connections: value.database.connections, idleConnections: value.database.idle_connections }, outbox: { pending: value.outbox.pending, processing: value.outbox.processing, dead: value.outbox.dead }, riskAlertsOpen: value.risk_alerts_open, alerts: { open: value.alerts.open, acknowledged: value.alerts.acknowledged } }
  if (isOperationsAlertDto(value)) return { id: value.id, rule: { id: value.rule.id, key: value.rule.key, name: value.rule.name, kind: value.rule.kind }, status: value.status, observedValue: value.observed_value, threshold: value.threshold, firstTriggeredAt: value.first_triggered_at, lastTriggeredAt: value.last_triggered_at, acknowledgedBy: value.acknowledged_by ? mapAuthorizationUser(value.acknowledged_by) : null, acknowledgedAt: value.acknowledged_at, resolvedAt: value.resolved_at }
  if (isOperationsAlertRuleDto(value)) return { id: value.id, key: value.key, name: value.name, kind: value.kind, threshold: value.threshold, windowSeconds: value.window_seconds, enabled: value.enabled, revision: value.revision, createdAt: value.created_at, updatedAt: value.updated_at }
  if (isBrandingDto(value)) return { siteName: value.site_name, logoUrl: value.logo_url, faviconUrl: value.favicon_url, defaultCoverUrl: value.default_cover_url, navigationLinks: value.navigation_links, footerText: value.footer_text, footerLinks: value.footer_links, primaryColor: value.primary_color, accentColor: value.accent_color, themePreset: value.theme_preset, listDensity: value.list_density, homeMode: value.home_mode }
  if (isBoardDto(value)) return { id: value.id, parentId: value.parent_id ?? null, slug: value.slug, name: value.name, description: value.description, icon: value.icon, tone: value.tone, position: value.position, visibility: value.visibility, topicCount: value.topic_count, revision: value.revision }
  if (isBoardDeletionImpactDto(value)) return { boardId: value.board_id, childCount: value.child_count, topicCount: value.topic_count, replyCount: value.reply_count, canDelete: value.can_delete }
  if (isGovernancePolicyDto(value)) return { enabled: value.enabled, alertScoreThreshold: value.alert_score_threshold, reporterWindowMinutes: value.reporter_window_minutes, reporterAlertLimit: value.reporter_alert_limit }
  if (isMembershipLevelRuleDto(value)) return { levelKey: value.level_key, levelNumber: value.level_number, levelDisplayName: value.level_display_name, requiredLifetimePoints: value.required_lifetime_points, enabled: value.enabled, updatedAt: value.updated_at }
  if (isMembershipPointsGrantDto(value)) return { account: mapValue(value.account) as MembershipAccount, created: value.created }
  if (isMembershipAccountDto(value)) return { userId: value.user_id, pointsBalance: value.points_balance, lifetimePoints: value.lifetime_points, levelKey: value.level_key, levelNumber: value.level_number, levelDisplayName: value.level_display_name, revision: value.revision, updatedAt: value.updated_at }
  if (isMembershipMedalRuleDto(value)) return { key: value.key, displayName: value.display_name, enabled: value.enabled, requiredLifetimePoints: value.required_lifetime_points, updatedAt: value.updated_at }
  if (isMembershipMedalGrantDto(value)) return { medal: mapValue(value.medal) as MembershipMedal, created: value.created }
  if (isMembershipMedalDto(value)) return { key: value.key, displayName: value.display_name, assetUrl: value.asset_url, sha256: value.sha256, grantedAt: value.granted_at }
  if (isAuthorizationRoleAssignmentDto(value)) return { id: value.id, user: mapAuthorizationUser(value.user), role: { id: value.role.id, key: value.role.key, name: value.role.name, scope: value.role.scope, isSystem: value.role.is_system, revision: value.role.revision }, scopeId: value.scope_id ?? null, assignedBy: mapAuthorizationUser(value.assigned_by), createdAt: value.created_at }
  if (isAuthorizationRoleDto(value)) return { id: value.id, key: value.key, name: value.name, scope: value.scope, isSystem: value.is_system, permissionKeys: value.permission_keys, assignmentCount: value.assignment_count, revision: value.revision, createdAt: value.created_at, updatedAt: value.updated_at }
  if (isAuthorizationPermissionDto(value)) return { key: value.key, name: value.name, description: value.description }
  if (isRiskAlertDto(value)) return { id: value.id, kind: value.kind, severity: value.severity, score: value.score, targetType: value.target_type, targetId: value.target_id, reporterId: value.reporter_id, reportId: value.report_id, status: value.status, details: value.details, acknowledgedBy: value.acknowledged_by ? { id: value.acknowledged_by.id, username: value.acknowledged_by.username, displayName: value.acknowledged_by.display_name, avatarUrl: value.acknowledged_by.avatar_url } : null, createdAt: value.created_at, acknowledgedAt: value.acknowledged_at }
  if (isAuditEntryDto(value)) return { id: value.id, actor: { id: value.actor.id, username: value.actor.username, displayName: value.actor.display_name, avatarUrl: value.actor.avatar_url }, action: value.action, resourceType: value.resource_type, resourceId: value.resource_id, summary: value.summary, createdAt: value.created_at }
  if (Array.isArray(value)) return value.map((item) => mapValue(item))
  return value
}

function toBrandingDto(value: SiteBrandingInput): UpdateSiteBrandingRequestDto { return { site_name: value.siteName, logo_url: value.logoUrl, favicon_url: value.faviconUrl, default_cover_url: value.defaultCoverUrl, navigation_links: value.navigationLinks, footer_text: value.footerText, footer_links: value.footerLinks, primary_color: value.primaryColor, accent_color: value.accentColor, theme_preset: value.themePreset, list_density: value.listDensity, home_mode: value.homeMode } }
function toCreateBoardDto(value: AdminBoardInput): CreateAdminBoardRequestDto { return { parent_id: value.parentId, slug: value.slug, name: value.name, description: value.description, icon: value.icon, tone: value.tone, position: value.position, visibility: value.visibility } }
function toUpdateBoardDto(value: AdminBoardUpdateInput): UpdateAdminBoardRequestDto { return { parent_id: value.parentId, slug: value.slug, name: value.name, description: value.description, icon: value.icon, tone: value.tone, position: value.position, visibility: value.visibility, expected_revision: value.expectedRevision } }
function toMembershipLevelRuleDto(value: MembershipLevelRuleInput): UpdateMembershipLevelRuleRequestDto { return { required_lifetime_points: value.requiredLifetimePoints, enabled: value.enabled, display_name: value.displayName } }
function toMembershipPointsGrantDto(value: MembershipPointsGrantInput): GrantMembershipPointsRequestDto { return { user_id: value.userId, amount: value.amount, reason: value.reason, idempotency_key: value.idempotencyKey ?? null } }

function isEnvelope(value: unknown): value is Envelope<unknown> { return isRecord(value) && "data" in value && isRecord(value.meta) && isUuid(value.meta.request_id) }
function isAdminCapabilityAccessDto(value: unknown): value is AdminCapabilityAccessDto { return isRecord(value) && Array.isArray(value.capability_keys) && value.capability_keys.every((key: unknown) => typeof key === "string" && capabilityKeyPattern.test(key)) && new Set(value.capability_keys).size === value.capability_keys.length }
function isBranding(value: unknown): value is SiteBranding { return isBrandingDto(value) }
function isBrandingDto(value: unknown): value is BrandingDto { return isRecord(value) && typeof value.site_name === "string" && isOptionalBrandAssetUrl(value.logo_url, "logo") && isOptionalBrandAssetUrl(value.favicon_url, "favicon") && isOptionalHttpsUrl(value.default_cover_url) && isBrandLinks(value.navigation_links) && (value.footer_text === null || typeof value.footer_text === "string") && isBrandLinks(value.footer_links) && typeof value.primary_color === "string" && typeof value.accent_color === "string" && typeof value.theme_preset === "string" && presets.has(value.theme_preset as BrandThemePreset) && typeof value.list_density === "string" && densities.has(value.list_density as BrandListDensity) && typeof value.home_mode === "string" && homeModes.has(value.home_mode as BrandHomeMode) }
function isOptionalBrandAssetUrl(value: unknown, kind: BrandAssetKind): value is string | null { return value === null || value === `/api/v1/site-branding/assets/${kind}` || isHttpsUrl(value) }
function isOptionalHttpsUrl(value: unknown): value is string | null { return value === null || isHttpsUrl(value) }
function isHttpsUrl(value: unknown): value is string { if (typeof value !== "string") return false; try { return new URL(value).protocol === "https:" } catch { return false } }
function isBrandLinks(value: unknown): value is BrandLink[] { return Array.isArray(value) && value.length <= 8 && value.every((link) => isRecord(link) && typeof link.label === "string" && link.label.trim().length > 0 && link.label.length <= 40 && typeof link.url === "string" && isSafeBrandLinkUrl(link.url)) }
function isSafeBrandLinkUrl(value: string): boolean { if (value.startsWith("https://")) return isHttpsUrl(value); return (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) || value.startsWith("#") }
function isBoard(value: unknown): value is AdminBoardDto { return isBoardDto(value) }
function isBoardDto(value: unknown): value is AdminBoardDto { return isRecord(value) && isUuid(value.id) && "parent_id" in value && (value.parent_id === null || isUuid(value.parent_id)) && typeof value.slug === "string" && typeof value.name === "string" && typeof value.description === "string" && typeof value.icon === "string" && typeof value.tone === "string" && tones.has(value.tone as BoardTone) && Number.isSafeInteger(value.position) && value.position >= 0 && typeof value.visibility === "string" && visibilities.has(value.visibility as AdminBoardVisibility) && Number.isSafeInteger(value.topic_count) && value.topic_count >= 0 && Number.isSafeInteger(value.revision) && value.revision > 0 }
function isBoardDeletionImpactDto(value: unknown): value is AdminBoardDeletionImpactDto { return isRecord(value) && isUuid(value.board_id) && Number.isSafeInteger(value.child_count) && value.child_count >= 0 && Number.isSafeInteger(value.topic_count) && value.topic_count >= 0 && Number.isSafeInteger(value.reply_count) && value.reply_count >= 0 && typeof value.can_delete === "boolean" && value.can_delete === (value.child_count === 0 && value.topic_count === 0) }
function isGovernancePolicy(value: unknown): value is GovernancePolicy { return isGovernancePolicyDto(value) }
function isGovernancePolicyDto(value: unknown): value is GovernancePolicyDto { return isRecord(value) && typeof value.enabled === "boolean" && Number.isSafeInteger(value.alert_score_threshold) && value.alert_score_threshold >= 1 && value.alert_score_threshold <= 100 && Number.isSafeInteger(value.reporter_window_minutes) && value.reporter_window_minutes >= 1 && value.reporter_window_minutes <= 1440 && Number.isSafeInteger(value.reporter_alert_limit) && value.reporter_alert_limit >= 1 && value.reporter_alert_limit <= 100 }
function isMembershipLevelRuleDto(value: unknown): value is MembershipLevelRuleDto { return isRecord(value) && typeof value.level_key === "string" && membershipLevelPattern.test(value.level_key) && Number.isSafeInteger(value.level_number) && value.level_number >= 1 && value.level_number <= 20 && value.level_key === `lv_${value.level_number}` && typeof value.level_display_name === "string" && value.level_display_name.trim().length > 0 && Number.isSafeInteger(value.required_lifetime_points) && value.required_lifetime_points >= 0 && typeof value.enabled === "boolean" && typeof value.updated_at === "string" }
function isMembershipAccountDto(value: unknown): value is MembershipAccountDto { return isRecord(value) && isUuid(value.user_id) && Number.isSafeInteger(value.points_balance) && value.points_balance >= 0 && Number.isSafeInteger(value.lifetime_points) && value.lifetime_points >= 0 && typeof value.level_key === "string" && membershipLevelPattern.test(value.level_key) && Number.isSafeInteger(value.level_number) && value.level_number >= 1 && value.level_number <= 20 && value.level_key === `lv_${value.level_number}` && typeof value.level_display_name === "string" && value.level_display_name.trim().length > 0 && Number.isSafeInteger(value.revision) && value.revision >= 0 && typeof value.updated_at === "string" }
function isMembershipPointsGrantDto(value: unknown): value is MembershipPointsGrantDto { return isRecord(value) && typeof value.created === "boolean" && isMembershipAccountDto(value.account) }
function isMembershipMedalRuleDto(value: unknown): value is MembershipMedalRuleDto { return isRecord(value) && typeof value.key === "string" && membershipMedalPattern.test(value.key) && value.display_name === `勋章 ${value.key.slice(-2)}` && typeof value.enabled === "boolean" && (value.required_lifetime_points === null || (Number.isSafeInteger(value.required_lifetime_points) && value.required_lifetime_points >= 0)) && typeof value.updated_at === "string" }
function isMembershipMedalDto(value: unknown): value is MembershipMedalDto { return isRecord(value) && typeof value.key === "string" && membershipMedalPattern.test(value.key) && value.display_name === `勋章 ${value.key.slice(-2)}` && typeof value.asset_url === "string" && value.asset_url.startsWith("/assets/membership/medals/") && typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256) && typeof value.granted_at === "string" }
function isMembershipMedalGrantDto(value: unknown): value is MembershipMedalGrantDto { return isRecord(value) && typeof value.created === "boolean" && isMembershipMedalDto(value.medal) }
function isAuthorizationRoleScope(value: unknown): value is AuthorizationRoleScope { return value === "instance" || value === "site" || value === "board" }
function isAuthorizationPermissionDto(value: unknown): value is AuthorizationPermissionDto { return isRecord(value) && isNonEmptyString(value.key) && isNonEmptyString(value.name) && typeof value.description === "string" }
function isAuthorizationRoleDto(value: unknown): value is AuthorizationRoleDto { return isRecord(value) && isUuid(value.id) && isNonEmptyString(value.key) && isNonEmptyString(value.name) && isAuthorizationRoleScope(value.scope) && typeof value.is_system === "boolean" && Array.isArray(value.permission_keys) && value.permission_keys.every(isNonEmptyString) && Number.isSafeInteger(value.assignment_count) && value.assignment_count >= 0 && Number.isSafeInteger(value.revision) && value.revision >= 1 && typeof value.created_at === "string" && typeof value.updated_at === "string" }
function isAuthorizationAssignedRoleDto(value: unknown): value is AuthorizationAssignedRoleDto { return isRecord(value) && isUuid(value.id) && isNonEmptyString(value.key) && isNonEmptyString(value.name) && isAuthorizationRoleScope(value.scope) && typeof value.is_system === "boolean" && Number.isSafeInteger(value.revision) && value.revision >= 1 }
function isAuthorizationRoleAssignmentDto(value: unknown): value is AuthorizationRoleAssignmentDto { return isRecord(value) && isUuid(value.id) && isUserSummaryDto(value.user) && isAuthorizationAssignedRoleDto(value.role) && (value.scope_id === undefined || value.scope_id === null || isUuid(value.scope_id)) && isUserSummaryDto(value.assigned_by) && typeof value.created_at === "string" }
function isAuthorizationAssignmentPage(value: unknown): value is { data: AuthorizationRoleAssignmentDto[]; meta: { request_id: string; next_cursor?: string | null } } { return isRecord(value) && Array.isArray(value.data) && value.data.every(isAuthorizationRoleAssignmentDto) && isRecord(value.meta) && isUuid(value.meta.request_id) && (value.meta.next_cursor === undefined || value.meta.next_cursor === null || typeof value.meta.next_cursor === "string") }
function mapAuthorizationUser(value: components["schemas"]["UserSummary"]): AuthorizationUserSummary { return { id: value.id, username: value.username, displayName: value.display_name, avatarUrl: value.avatar_url ?? null } }
function isOperationsRuleKind(value: unknown): value is OperationsAlertRuleKind { return value === "http_5xx_count" || value === "http_p95_ms" || value === "outbox_dead_count" || value === "risk_alert_open_count" }
function isOperationsAlertStatus(value: unknown): value is OperationsAlertStatus { return value === "open" || value === "acknowledged" || value === "resolved" }
function isSafeCount(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 }
function isTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) }
function isOperationsSummaryDto(value: unknown): value is OperationsSummaryDto { return isRecord(value) && isTimestamp(value.observed_at) && isSafeCount(value.uptime_seconds) && isRecord(value.http) && isSafeCount(value.http.total_requests) && isSafeCount(value.http.in_flight_requests) && isSafeCount(value.http.errors_5m) && isSafeCount(value.http.p95_ms_5m) && isRecord(value.database) && typeof value.database.ready === "boolean" && isSafeCount(value.database.connections) && isSafeCount(value.database.idle_connections) && isRecord(value.outbox) && isSafeCount(value.outbox.pending) && isSafeCount(value.outbox.processing) && isSafeCount(value.outbox.dead) && isSafeCount(value.risk_alerts_open) && isRecord(value.alerts) && isSafeCount(value.alerts.open) && isSafeCount(value.alerts.acknowledged) }
function isOperationsAlertRuleDto(value: unknown): value is OperationsAlertRuleDto { return isRecord(value) && isUuid(value.id) && isNonEmptyString(value.key) && isNonEmptyString(value.name) && isOperationsRuleKind(value.kind) && isSafeCount(value.threshold) && Number.isSafeInteger(value.window_seconds) && value.window_seconds >= 30 && value.window_seconds <= 86_400 && typeof value.enabled === "boolean" && Number.isSafeInteger(value.revision) && value.revision >= 1 && isTimestamp(value.created_at) && isTimestamp(value.updated_at) }
function isOperationsAlertRuleReferenceDto(value: unknown): value is OperationsAlertRuleReferenceDto { return isRecord(value) && isUuid(value.id) && isNonEmptyString(value.key) && isNonEmptyString(value.name) && isOperationsRuleKind(value.kind) }
function isOperationsAlertDto(value: unknown): value is OperationsAlertDto { if (!isRecord(value) || !isUuid(value.id) || !isOperationsAlertRuleReferenceDto(value.rule) || !isOperationsAlertStatus(value.status) || !isSafeCount(value.observed_value) || !isSafeCount(value.threshold) || !isTimestamp(value.first_triggered_at) || !isTimestamp(value.last_triggered_at) || !(value.acknowledged_by === null || isUserSummaryDto(value.acknowledged_by)) || !(value.acknowledged_at === null || isTimestamp(value.acknowledged_at)) || !(value.resolved_at === null || isTimestamp(value.resolved_at))) return false; if (value.status === "open") return value.acknowledged_by === null && value.acknowledged_at === null && value.resolved_at === null; if (value.status === "acknowledged") return value.acknowledged_by !== null && value.acknowledged_at !== null && value.resolved_at === null; return value.resolved_at !== null }
function isOperationsAlertPage(value: unknown): value is { data: OperationsAlertDto[]; meta: { request_id: string; next_cursor: string | null } } { return isPageEnvelope(value) && value.data.every(isOperationsAlertDto) }
function isRiskAlertDto(value: unknown): value is RiskAlertDto { return isRecord(value) && isUuid(value.id) && (value.kind === "high_risk_report" || value.kind === "reporter_spike") && (value.severity === "medium" || value.severity === "high" || value.severity === "critical") && Number.isSafeInteger(value.score) && value.score >= 1 && value.score <= 100 && (value.target_type === null || typeof value.target_type === "string") && (value.target_id === null || isUuid(value.target_id)) && (value.reporter_id === null || isUuid(value.reporter_id)) && (value.report_id === null || isUuid(value.report_id)) && (value.status === "open" || value.status === "acknowledged" || value.status === "dismissed") && isRecord(value.details) && (value.acknowledged_by === null || isUserSummaryDto(value.acknowledged_by)) && typeof value.created_at === "string" && (value.acknowledged_at === null || typeof value.acknowledged_at === "string") }
function isUserSummaryDto(value: unknown): value is UserSummaryDto { return isRecord(value) && isUuid(value.id) && typeof value.username === "string" && typeof value.display_name === "string" && (value.avatar_url === null || typeof value.avatar_url === "string") }
function isAuditEntryDto(value: unknown): value is AuditEntryDto { return isRecord(value) && isUuid(value.id) && isUserSummaryDto(value.actor) && typeof value.action === "string" && typeof value.resource_type === "string" && (value.resource_id === null || isUuid(value.resource_id)) && isRecord(value.summary) && typeof value.created_at === "string" }
function isPageEnvelope(value: unknown): value is { data: unknown[]; meta: Required<components["schemas"]["PageMeta"]> } { return isRecord(value) && Array.isArray(value.data) && isRecord(value.meta) && isUuid(value.meta.request_id) && (value.meta.next_cursor === null || typeof value.meta.next_cursor === "string") }
function isRiskAlertPage(value: unknown): value is RiskAlertPageDto { return isPageEnvelope(value) && value.data.every(isRiskAlertDto) }
function isAuditPage(value: unknown): value is AuditPageDto { return isPageEnvelope(value) && value.data.every(isAuditEntryDto) }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value) }
function isError(value: unknown): value is ErrorDto { return isRecord(value) && isRecord(value.error) && isRecord(value.meta) && isUuid(value.meta.request_id) && typeof value.error.code === "string" && typeof value.error.message === "string" && (value.error.fields === undefined || isFieldErrors(value.error.fields)) }
function isFieldErrors(value: unknown): value is Record<string, string[]> { return isRecord(value) && Object.values(value).every((messages) => Array.isArray(messages) && messages.length > 0 && messages.every((message) => typeof message === "string" && message.trim().length > 0)) }
function toApiError(status: number, payload: unknown): AdminApiError { return isError(payload) ? new AdminApiError(status, payload.error.code, payload.error.message, payload.error.fields ?? {}) : new AdminApiError(status, "response.invalid", "管理服务响应格式无效") }
async function readJson(response: Response): Promise<unknown> { try { return await response.json() as unknown } catch { return undefined } }
