import type { components } from "./generated"

export type AdminUserStatus = components["schemas"]["AdminUserStatus"]
export type AdminUserContentKind = components["schemas"]["AdminUserContentKind"]
export type AuthorizationRoleScope = components["schemas"]["AuthorizationRoleScope"]

export interface AdminUserSummary {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
  status: AdminUserStatus
  primaryRole: string | null
  topicCount: number
  postCount: number
  reportCount: number
  createdAt: string
  lastSeenAt: string | null
}

export interface AdminUserRole {
  id: string
  key: string
  name: string
  scope: AuthorizationRoleScope
  isSystem: boolean
  revision: number
}

export interface AdminUserDetail extends AdminUserSummary {
  bio: string
  location: string | null
  websiteUrl: string | null
  followerCount: number
  followingCount: number
  roles: AdminUserRole[]
  restrictionReason: string | null
  restrictionExpiresAt: string | null
  revision: number
}

export interface AdminUserContentItem {
  id: string
  kind: AdminUserContentKind
  topicId: string
  title: string | null
  excerpt: string
  status: string
  createdAt: string
}

export interface ListAdminUsersOptions {
  query?: string
  status?: AdminUserStatus
  roleId?: string
  registeredAfter?: string
  registeredBefore?: string
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface AdminUserPage {
  users: AdminUserSummary[]
  nextCursor: string | null
}

export interface AdminUserContentPage {
  items: AdminUserContentItem[]
  nextCursor: string | null
}

export interface UpdateAdminUserStatusInput {
  status: AdminUserStatus
  reason: string
  expiresAt: string | null
  expectedRevision: number
}

export interface AdminUserStatusUpdate {
  userId: string
  status: AdminUserStatus
  reason: string | null
  expiresAt: string | null
  revision: number
  auditId: string
  actor: { id: string; username: string; displayName: string; avatarUrl: string | null }
  changedAt: string
}

type SummaryDto = Required<components["schemas"]["AdminUserSummary"]>
type DetailDto = SummaryDto & {
  bio: string
  location: string | null
  website_url: string | null
  follower_count: number
  following_count: number
  roles: RoleDto[]
  restriction_reason: string | null
  restriction_expires_at: string | null
  revision: number
}
type ContentDto = Required<components["schemas"]["AdminUserContentItem"]>
type RoleDto = components["schemas"]["AuthorizationAssignedRole"]
type StatusUpdateDto = components["schemas"]["AdminUserStatusUpdate"]
type ErrorDto = components["schemas"]["ErrorResponse"]

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const userStatuses = new Set<AdminUserStatus>(["active", "restricted", "suspended"])
const contentKinds = new Set<AdminUserContentKind>(["topic", "reply"])
const roleScopes = new Set<AuthorizationRoleScope>(["instance", "site", "board"])

export class AdminUsersApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(status: number, code: string, message: string, fields: Record<string, string[]> = {}) {
    super(message)
    this.name = "AdminUsersApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function listAdminUsers(options: ListAdminUsersOptions = {}): Promise<AdminUserPage> {
  const params = new URLSearchParams()
  if (options.query) params.set("q", options.query)
  if (options.status) params.set("status", options.status)
  if (options.roleId) params.set("role_id", options.roleId)
  if (options.registeredAfter) params.set("registered_after", options.registeredAfter)
  if (options.registeredBefore) params.set("registered_before", options.registeredBefore)
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const response = await fetch(`/api/v1/admin/users${params.size ? `?${params}` : ""}`, {
    headers: { Accept: "application/json" }, credentials: "include", signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isPageEnvelope(payload, isSummaryDto)) throw invalidResponse(response.status)
  return { users: payload.data.map(mapSummary), nextCursor: payload.meta.next_cursor ?? null }
}

export async function getAdminUser(userId: string, signal?: AbortSignal): Promise<AdminUserDetail> {
  const response = await fetch(`/api/v1/admin/users/${userId}`, {
    headers: { Accept: "application/json" }, credentials: "include", signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isEnvelope(payload) || !isDetailDto(payload.data)) throw invalidResponse(response.status)
  return mapDetail(payload.data)
}

export async function listAdminUserContent(userId: string, cursor?: string, signal?: AbortSignal): Promise<AdminUserContentPage> {
  const params = new URLSearchParams()
  if (cursor) params.set("cursor", cursor)
  params.set("limit", "20")
  const response = await fetch(`/api/v1/admin/users/${userId}/content?${params}`, {
    headers: { Accept: "application/json" }, credentials: "include", signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isPageEnvelope(payload, isContentDto)) throw invalidResponse(response.status)
  return { items: payload.data.map(mapContent), nextCursor: payload.meta.next_cursor ?? null }
}

export async function updateAdminUserStatus(userId: string, input: UpdateAdminUserStatusInput, csrfToken: string, signal?: AbortSignal): Promise<AdminUserStatusUpdate> {
  const response = await fetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/status`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify({
      status: input.status,
      reason: input.reason,
      expires_at: input.expiresAt,
      expected_revision: input.expectedRevision,
    }),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isEnvelope(payload) || !isStatusUpdateDto(payload.data)) throw invalidResponse(response.status)
  return mapStatusUpdate(payload.data)
}

function mapSummary(value: SummaryDto): AdminUserSummary {
  return {
    id: value.id, username: value.username, displayName: value.display_name,
    avatarUrl: value.avatar_url, status: value.status, primaryRole: value.primary_role,
    topicCount: value.topic_count, postCount: value.post_count, reportCount: value.report_count,
    createdAt: value.created_at, lastSeenAt: value.last_seen_at,
  }
}

function mapDetail(value: DetailDto): AdminUserDetail {
  return {
    ...mapSummary(value), bio: value.bio, location: value.location, websiteUrl: value.website_url,
    followerCount: value.follower_count, followingCount: value.following_count,
    roles: value.roles.map(mapRole), restrictionReason: value.restriction_reason,
    restrictionExpiresAt: value.restriction_expires_at, revision: value.revision,
  }
}

function mapRole(value: RoleDto): AdminUserRole {
  return { id: value.id, key: value.key, name: value.name, scope: value.scope, isSystem: value.is_system, revision: value.revision }
}

function mapContent(value: ContentDto): AdminUserContentItem {
  return { id: value.id, kind: value.kind, topicId: value.topic_id, title: value.title, excerpt: value.excerpt, status: value.status, createdAt: value.created_at }
}

function mapStatusUpdate(value: StatusUpdateDto): AdminUserStatusUpdate {
  return {
    userId: value.user_id,
    status: value.status,
    reason: value.reason ?? null,
    expiresAt: value.expires_at ?? null,
    revision: value.revision,
    auditId: value.audit_id,
    actor: {
      id: value.actor.id,
      username: value.actor.username,
      displayName: value.actor.display_name,
      avatarUrl: value.actor.avatar_url ?? null,
    },
    changedAt: value.changed_at,
  }
}

function isSummaryDto(value: unknown): value is SummaryDto {
  return isRecord(value) && isUuid(value.id) && typeof value.username === "string"
    && typeof value.display_name === "string" && (value.avatar_url === null || typeof value.avatar_url === "string")
    && userStatuses.has(value.status as AdminUserStatus) && (value.primary_role === null || typeof value.primary_role === "string")
    && isCount(value.topic_count) && isCount(value.post_count) && isCount(value.report_count)
    && isDateTime(value.created_at) && (value.last_seen_at === null || isDateTime(value.last_seen_at))
}

function isDetailDto(value: unknown): value is DetailDto {
  if (!isSummaryDto(value)) return false
  const detail = value as Record<string, unknown>
  return typeof detail.bio === "string" && (detail.location === null || typeof detail.location === "string")
    && (detail.website_url === null || typeof detail.website_url === "string")
    && isCount(detail.follower_count) && isCount(detail.following_count) && Array.isArray(detail.roles) && detail.roles.every(isRoleDto)
    && (detail.restriction_reason === null || typeof detail.restriction_reason === "string")
    && (detail.restriction_expires_at === null || isDateTime(detail.restriction_expires_at)) && isCount(detail.revision)
}

function isRoleDto(value: unknown): value is RoleDto {
  return isRecord(value) && isUuid(value.id) && typeof value.key === "string" && typeof value.name === "string"
    && roleScopes.has(value.scope as AuthorizationRoleScope) && typeof value.is_system === "boolean" && isCount(value.revision)
}

function isContentDto(value: unknown): value is ContentDto {
  return isRecord(value) && isUuid(value.id) && contentKinds.has(value.kind as AdminUserContentKind)
    && isUuid(value.topic_id) && (value.title === null || typeof value.title === "string")
    && typeof value.excerpt === "string" && typeof value.status === "string" && isDateTime(value.created_at)
}

function isStatusUpdateDto(value: unknown): value is StatusUpdateDto {
  if (!isRecord(value) || !isUuid(value.user_id) || !userStatuses.has(value.status as AdminUserStatus)
    || !isCount(value.revision) || !isUuid(value.audit_id) || !isDateTime(value.changed_at)
    || (value.reason !== undefined && value.reason !== null && typeof value.reason !== "string")
    || (value.expires_at !== undefined && value.expires_at !== null && !isDateTime(value.expires_at))
    || !isRecord(value.actor)) return false
  return isUuid(value.actor.id) && typeof value.actor.username === "string" && typeof value.actor.display_name === "string"
    && (value.actor.avatar_url === undefined || value.actor.avatar_url === null || typeof value.actor.avatar_url === "string")
}

function isPageEnvelope<T>(value: unknown, guard: (item: unknown) => item is T): value is { data: T[]; meta: { request_id: string; next_cursor?: string | null } } {
  return isRecord(value) && Array.isArray(value.data) && value.data.every(guard) && isRecord(value.meta)
    && isUuid(value.meta.request_id) && (value.meta.next_cursor === undefined || value.meta.next_cursor === null || isUuid(value.meta.next_cursor))
}

function isEnvelope(value: unknown): value is { data: unknown; meta: { request_id: string } } {
  return isRecord(value) && "data" in value && isRecord(value.meta) && isUuid(value.meta.request_id)
}

function isCount(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }
function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value) }
function isDateTime(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
async function readJson(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return null }
}

function invalidResponse(status: number): AdminUsersApiError {
  return new AdminUsersApiError(status, "response.invalid", "用户管理服务响应格式无效")
}

function toApiError(status: number, payload: unknown): AdminUsersApiError {
  if (!isRecord(payload) || !isRecord(payload.error)) return new AdminUsersApiError(status, "response.invalid", "用户管理服务响应格式无效")
  const error = payload.error as ErrorDto["error"]
  return new AdminUsersApiError(status, typeof error.code === "string" ? error.code : "response.invalid", typeof error.message === "string" ? error.message : "用户管理请求失败", isRecord(error.fields) ? error.fields as Record<string, string[]> : {})
}
