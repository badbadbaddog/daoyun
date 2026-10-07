import type { components } from "./generated"
import { isAdminCommunityGroupMembershipDto, isAdminStandardEntitlementDto, isMembershipMedalDto, mapAdminCommunityGroupMembership, mapAdminStandardEntitlement, type AdminCommunityGroupMembership, type AdminStandardEntitlement, type AdminGrowthLevel, type MembershipMedal } from "./admin"

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
  membership?: AdminUserMembershipOverview | null
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
  baseGroupId?: string
  additionalGroupId?: string
  growthLevelId?: string
  entitlementTypeId?: string
  lastActiveAfter?: string
  lastActiveBefore?: string
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

type SummaryDto = Omit<Required<components["schemas"]["AdminUserSummary"]>, "membership"> & { membership?: OverviewDto | null }
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
  for (const [key, value] of [["base_group_id", options.baseGroupId], ["additional_group_id", options.additionalGroupId], ["growth_level_id", options.growthLevelId], ["entitlement_type_id", options.entitlementTypeId], ["last_active_after", options.lastActiveAfter], ["last_active_before", options.lastActiveBefore]]) if (value) params.set(key!, value)
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
    ...(value.membership !== undefined ? { membership: value.membership ? mapMembershipOverview(value.membership) : null } : {}),
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
    && (value.membership == null || isMembershipOverviewDto(value.membership))
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

export type AdminUserMembershipSection = 'groups' | 'experience' | 'points' | 'medals' | 'entitlements'
export type AdminUserGrowthLevel = Pick<AdminGrowthLevel, 'id' | 'internalKey' | 'levelOrder' | 'displayName' | 'requiredExperience' | 'iconAssetId' | 'color' | 'description'>
export interface AdminUserPoints { userId: string; pointsBalance: number; lifetimePoints: number; revision: number; updatedAt: string }
export interface AdminUserMembershipSummary {
  account: AdminUserDetail
  groups: AdminCommunityGroupMembership[] | null
  experience: { userId: string; experience: number; currentLevel: AdminUserGrowthLevel; revision: number; updatedAt: string } | null
  nextLevel: AdminUserGrowthLevel | null
  points: AdminUserPoints | null
  medals: MembershipMedal[] | null
  entitlements: AdminStandardEntitlement[] | null
  readableSections: AdminUserMembershipSection[]
}
type MembershipSummaryDto = Required<components['schemas']['AdminUserMembershipSummary']>
type GrowthDto = components['schemas']['GrowthLevel']
const membershipSections: AdminUserMembershipSection[] = ['groups', 'experience', 'points', 'medals', 'entitlements']

export async function getAdminUserMembershipSummary(userId: string, signal?: AbortSignal): Promise<AdminUserMembershipSummary> {
  if (!isUuid(userId)) throw new AdminUsersApiError(422, 'validation.failed', '用户标识格式无效')
  const response = await fetch('/api/v1/admin/users/' + encodeURIComponent(userId) + '/membership-summary', { headers: { Accept: 'application/json' }, credentials: 'include', signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isEnvelope(payload) || !isMembershipSummaryDto(payload.data, userId)) throw invalidResponse(response.status)
  const value = payload.data
  return {
    account: mapDetail(value.account as DetailDto),
    groups: value.groups?.map(mapAdminCommunityGroupMembership) ?? null,
    experience: value.experience ? { userId: value.experience.user_id, experience: value.experience.experience, currentLevel: mapAdminUserGrowth(value.experience.current_level), revision: value.experience.revision, updatedAt: value.experience.updated_at } : null,
    nextLevel: value.next_level ? mapAdminUserGrowth(value.next_level) : null,
    points: value.points ? { userId: value.points.user_id, pointsBalance: value.points.points_balance, lifetimePoints: value.points.lifetime_points, revision: value.points.revision, updatedAt: value.points.updated_at } : null,
    medals: value.medals?.map(medal => ({ key: medal.key, displayName: medal.display_name, assetUrl: medal.asset_url, sha256: medal.sha256, grantedAt: medal.granted_at })) ?? null,
    entitlements: value.entitlements?.map(mapAdminStandardEntitlement) ?? null,
    readableSections: value.readable_sections,
  }
}

function isMembershipSummaryDto(value: unknown, userId: string): value is MembershipSummaryDto {
  if (!isRecord(value) || !isDetailDto(value.account) || value.account.id !== userId || !Array.isArray(value.readable_sections)
    || !value.readable_sections.every(section => membershipSections.includes(section)) || new Set(value.readable_sections).size !== value.readable_sections.length) return false
  const readable = new Set(value.readable_sections)
  if (!membershipSections.every(section => readable.has(section) || value[section] === null)) return false
  if (readable.has('groups') && (!Array.isArray(value.groups) || !value.groups.every(group => isAdminCommunityGroupMembershipDto(group) && group.user_id === userId))) return false
  if (value.experience !== null && (!isRecord(value.experience) || value.experience.user_id !== userId || !isCount(value.experience.experience) || !isGrowthDto(value.experience.current_level) || !isCount(value.experience.revision) || !isDateTime(value.experience.updated_at))) return false
  if (value.points !== null && (!isRecord(value.points) || value.points.user_id !== userId || !isCount(value.points.points_balance) || !isCount(value.points.lifetime_points) || !isCount(value.points.revision) || !isDateTime(value.points.updated_at))) return false
  if (readable.has('medals') && (!Array.isArray(value.medals) || !value.medals.every(medal => isMembershipMedalDto(medal) && isDateTime(medal.granted_at)))) return false
  if (readable.has('entitlements') && (!Array.isArray(value.entitlements) || !value.entitlements.every(entitlement => isAdminStandardEntitlementDto(entitlement) && entitlement.user_id === userId))) return false
  return value.next_level === null || (readable.has('experience') && value.experience !== null && isGrowthDto(value.next_level))
}

function isGrowthDto(value: unknown): value is GrowthDto {
  return isRecord(value) && isUuid(value.id) && typeof value.internal_key === 'string' && typeof value.display_name === 'string'
    && isCount(value.level_order) && value.level_order > 0 && isCount(value.required_experience)
    && (value.icon_asset_id == null || isUuid(value.icon_asset_id)) && (value.color == null || typeof value.color === 'string') && typeof value.description === 'string'
}
function mapAdminUserGrowth(value: GrowthDto): AdminUserGrowthLevel {
  return { id: value.id, internalKey: value.internal_key, levelOrder: value.level_order, displayName: value.display_name, requiredExperience: value.required_experience, iconAssetId: value.icon_asset_id ?? null, color: value.color ?? null, description: value.description }
}

export interface AdminUserMembershipOverview {
  groups: { id: string; displayName: string; membershipKind: 'base' | 'additional' }[] | null
  experience: number | null
  level: { id: string; displayName: string; levelOrder: number } | null
  pointsBalance: number | null
  entitlements: { typeId: string; internalKey: string; displayName: string }[] | null
  medalCount: number | null
  readableSections: AdminUserMembershipSection[]
}

type OverviewDto = Required<components['schemas']['AdminUserMembershipOverview']>
function isMembershipOverviewDto(value: unknown): value is OverviewDto {
  if (!isRecord(value) || !Array.isArray(value.readable_sections) || !value.readable_sections.every(section => ['groups', 'experience', 'points', 'medals', 'entitlements'].includes(section)) || new Set(value.readable_sections).size !== value.readable_sections.length) return false
  const readable = (section: string) => value.readable_sections instanceof Array && value.readable_sections.includes(section)
  if (!readable('groups') ? value.groups !== null : !Array.isArray(value.groups) || !value.groups.every(group => isRecord(group) && isUuid(group.id) && typeof group.display_name === 'string' && ['base', 'additional'].includes(String(group.membership_kind)))) return false
  if (!readable('experience') ? value.experience !== null || value.level !== null : !((value.experience === null && value.level === null) || (isCount(value.experience) && isRecord(value.level) && isUuid(value.level.id) && typeof value.level.display_name === 'string' && isCount(value.level.level_order)))) return false
  if (!readable('points') ? value.points_balance !== null : value.points_balance !== null && !isCount(value.points_balance)) return false
  if (!readable('medals') ? value.medal_count !== null : !isCount(value.medal_count)) return false
  return !readable('entitlements') ? value.entitlements === null : Array.isArray(value.entitlements) && value.entitlements.every(entitlement => isRecord(entitlement) && isUuid(entitlement.type_id) && typeof entitlement.internal_key === 'string' && typeof entitlement.display_name === 'string')
}
function mapMembershipOverview(value: OverviewDto): AdminUserMembershipOverview {
  return {
    groups: value.groups?.map(group => ({ id: group.id, displayName: group.display_name, membershipKind: group.membership_kind as 'base' | 'additional' })) ?? null,
    experience: value.experience, level: value.level ? { id: value.level.id, displayName: value.level.display_name, levelOrder: value.level.level_order } : null,
    pointsBalance: value.points_balance, medalCount: value.medal_count,
    entitlements: value.entitlements?.map(entitlement => ({ typeId: entitlement.type_id, internalKey: entitlement.internal_key, displayName: entitlement.display_name })) ?? null,
    readableSections: value.readable_sections,
  }
}
