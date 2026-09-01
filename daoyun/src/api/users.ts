import type { components } from "./generated"

const USERS_ENDPOINT = "/api/v1/users"
const DEFAULT_LIMIT = 20
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface UserSummary {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
}

export interface UserProfileViewer {
  isSelf: boolean
  isFollowing: boolean
  isBlockedByViewer: boolean
  canMessage: boolean
}

export interface UserProfile extends UserSummary {
  bio: string
  location: string | null
  websiteUrl: string | null
  profileRevision: number
  createdAt: string
  topicCount: number
  followerCount: number
  followingCount: number
  viewer: UserProfileViewer | null
}

export interface UpdateUserProfileInput {
  baseRevision: number
  displayName: string
  bio: string
  location: string | null
  websiteUrl: string | null
  avatarUrl: string | null
}

export interface FollowState {
  userId: string
  following: boolean
  followerCount: number
  followingCount: number
}

export interface BlockState {
  userId: string
  blocked: boolean
}

export interface MembershipAccount {
  userId: string
  pointsBalance: number
  lifetimePoints: number
  levelKey: string
  levelNumber: number
  levelDisplayName: string
  revision: number
  updatedAt: string
}

export interface MembershipMedal {
  key: string
  displayName: string
  assetUrl: string
  sha256: string
  grantedAt: string
}

export type UserRelation = "followers" | "following"

export interface UserRelationPage {
  users: UserSummary[]
  nextCursor: string | null
}

export type UserSearchPage = UserRelationPage

type UserSummaryDto = Required<components["schemas"]["UserSummary"]>
type UserProfileDto = components["schemas"]["UserProfile"] & {
  avatar_url: string | null
  location: string | null
  website_url: string | null
  viewer: components["schemas"]["UserProfileViewer"] | null
}
type ProfileResponseDto = Omit<components["schemas"]["ApiResponse_UserProfile"], "data"> & { data: UserProfileDto }
type UserPageResponseDto = Omit<components["schemas"]["PageResponse_UserSummary"], "data" | "meta"> & {
  data: UserSummaryDto[]
  meta: Required<components["schemas"]["PageMeta"]>
}
type FollowStateResponseDto = components["schemas"]["ApiResponse_FollowState"]
type BlockStateResponseDto = components["schemas"]["ApiResponse_BlockState"]
type MembershipResponseDto = components["schemas"]["ApiResponse_MembershipAccount"]
type MembershipMedalsResponseDto = { data: MembershipMedalDto[]; meta: components["schemas"]["ResponseMeta"] }
type MembershipMedalDto = { key: string; display_name: string; asset_url: string; sha256: string; granted_at: string }
type ErrorResponseDto = components["schemas"]["ErrorResponse"]
type UpdateUserProfileRequestDto = components["schemas"]["UpdateUserProfileRequest"]
type UserEnvelope = { data: unknown; meta: components["schemas"]["ResponseMeta"] }

export class UserApiError extends Error {
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
    this.name = "UserApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function getUserProfile(username: string, signal?: AbortSignal): Promise<UserProfile> {
  const response = await fetch(`${USERS_ENDPOINT}/${encodeURIComponent(username)}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isProfileResponse(payload)) {
    throw new Error("用户资料响应格式无效")
  }
  return mapProfile(payload.data)
}

export async function listUsers(
  query: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<UserSearchPage> {
  const params = new URLSearchParams({ q: query, limit: String(options.limit ?? DEFAULT_LIMIT) })
  if (options.cursor) params.set("cursor", options.cursor)
  const response = await fetch(`${USERS_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isUserPageResponse(payload)) {
    throw new Error("用户搜索响应格式无效")
  }
  return { users: payload.data.map(mapSummary), nextCursor: payload.meta.next_cursor }
}

export async function getCurrentMembership(signal?: AbortSignal): Promise<MembershipAccount> {
  const response = await fetch(`${USERS_ENDPOINT}/me/membership`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isMembershipResponse(payload)) {
    throw new Error("会员账户响应格式无效")
  }
  return {
    userId: payload.data.user_id,
    pointsBalance: payload.data.points_balance,
    lifetimePoints: payload.data.lifetime_points,
    levelKey: payload.data.level_key,
    levelNumber: payload.data.level_number,
    levelDisplayName: payload.data.level_display_name,
    revision: payload.data.revision,
    updatedAt: payload.data.updated_at,
  }
}

export async function listUserMedals(username: string, signal?: AbortSignal): Promise<MembershipMedal[]> {
  const response = await fetch(`${USERS_ENDPOINT}/${encodeURIComponent(username)}/medals`, {
    headers: { Accept: "application/json" }, credentials: "include", signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isMembershipMedalsResponse(payload)) throw new Error("用户勋章响应格式无效")
  return payload.data.map((medal) => ({ key: medal.key, displayName: medal.display_name, assetUrl: medal.asset_url, sha256: medal.sha256, grantedAt: medal.granted_at }))
}

export async function updateUserProfile(
  input: UpdateUserProfileInput,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<UserProfile> {
  const body: UpdateUserProfileRequestDto = {
    base_revision: input.baseRevision,
    display_name: input.displayName,
    bio: input.bio,
    location: input.location,
    website_url: input.websiteUrl,
    avatar_url: input.avatarUrl,
  }
  const response = await fetch(`${USERS_ENDPOINT}/me`, {
    method: "PATCH",
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
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isProfileResponse(payload)) {
    throw new Error("用户资料响应格式无效")
  }
  return mapProfile(payload.data)
}

export async function setUserFollowing(
  userId: string,
  following: boolean,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<FollowState> {
  const payload = await relationMutation(
    `${USERS_ENDPOINT}/${encodeURIComponent(userId)}/follow`,
    following ? "PUT" : "DELETE",
    csrfToken,
    signal,
  )
  if (!isFollowStateResponse(payload)) throw new Error("关注响应格式无效")
  return {
    userId: payload.data.user_id,
    following: payload.data.following,
    followerCount: payload.data.follower_count,
    followingCount: payload.data.following_count,
  }
}

export async function setUserBlocked(
  userId: string,
  blocked: boolean,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<BlockState> {
  const payload = await relationMutation(
    `${USERS_ENDPOINT}/${encodeURIComponent(userId)}/block`,
    blocked ? "PUT" : "DELETE",
    csrfToken,
    signal,
  )
  if (!isBlockStateResponse(payload)) throw new Error("屏蔽响应格式无效")
  return { userId: payload.data.user_id, blocked: payload.data.blocked }
}

export async function listUserRelations(
  username: string,
  relation: UserRelation,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<UserRelationPage> {
  const params = new URLSearchParams()
  if (options.cursor) params.set("cursor", options.cursor)
  params.set("limit", String(options.limit ?? DEFAULT_LIMIT))
  const response = await fetch(
    `${USERS_ENDPOINT}/${encodeURIComponent(username)}/${relation}?${params.toString()}`,
    {
      headers: { Accept: "application/json" },
      credentials: "include",
      signal: options.signal,
    },
  )
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isUserPageResponse(payload)) {
    throw new Error("用户关系列表响应格式无效")
  }
  return {
    users: payload.data.map(mapSummary),
    nextCursor: payload.meta.next_cursor,
  }
}

async function relationMutation(
  endpoint: string,
  method: "PUT" | "DELETE",
  csrfToken: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method,
    headers: { Accept: "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  return payload
}

function mapSummary(user: UserSummaryDto): UserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
  }
}

function mapProfile(profile: UserProfileDto): UserProfile {
  return {
    ...mapSummary(profile),
    bio: profile.bio,
    location: profile.location,
    websiteUrl: profile.website_url,
    profileRevision: profile.profile_revision,
    createdAt: profile.created_at,
    topicCount: profile.topic_count,
    followerCount: profile.follower_count,
    followingCount: profile.following_count,
    viewer: profile.viewer === null ? null : {
      isSelf: profile.viewer.is_self,
      isFollowing: profile.viewer.is_following,
      isBlockedByViewer: profile.viewer.is_blocked_by_viewer,
      canMessage: profile.viewer.can_message,
    },
  }
}

function isProfileResponse(value: unknown): value is ProfileResponseDto {
  return isEnvelope(value) && isUserProfile(value.data)
}

function isUserPageResponse(value: unknown): value is UserPageResponseDto {
  return isRecord(value)
    && Array.isArray(value.data)
    && value.data.every(isUserSummary)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && (value.meta.next_cursor === null || isUuid(value.meta.next_cursor))
}

function isFollowStateResponse(value: unknown): value is FollowStateResponseDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && isUuid(value.data.user_id)
    && typeof value.data.following === "boolean"
    && isNonNegativeInteger(value.data.follower_count)
    && isNonNegativeInteger(value.data.following_count)
}

function isBlockStateResponse(value: unknown): value is BlockStateResponseDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && isUuid(value.data.user_id)
    && typeof value.data.blocked === "boolean"
}

function isMembershipResponse(value: unknown): value is MembershipResponseDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && isUuid(value.data.user_id)
    && isNonNegativeInteger(value.data.points_balance)
    && isNonNegativeInteger(value.data.lifetime_points)
    && typeof value.data.level_key === "string"
    && /^[a-z][a-z0-9_]{1,63}$/.test(value.data.level_key)
    && typeof value.data.level_number === "number"
    && Number.isSafeInteger(value.data.level_number)
    && value.data.level_number >= 1
    && typeof value.data.level_display_name === "string"
    && value.data.level_display_name.trim().length > 0
    && isPositiveInteger(value.data.revision)
    && isNonEmptyString(value.data.updated_at)
}

function isMembershipMedalsResponse(value: unknown): value is MembershipMedalsResponseDto {
  return isEnvelope(value) && Array.isArray(value.data) && value.data.every(isMembershipMedalDto)
}

function isMembershipMedalDto(value: unknown): value is MembershipMedalDto {
  return isRecord(value)
    && typeof value.key === "string"
    && /^medal_(?:0[1-9]|1[0-7])$/.test(value.key)
    && value.display_name === `勋章 ${value.key.slice(-2)}`
    && typeof value.asset_url === "string"
    && value.asset_url.startsWith("/assets/membership/medals/")
    && typeof value.sha256 === "string"
    && /^[0-9a-f]{64}$/.test(value.sha256)
    && typeof value.granted_at === "string"
}

function isUserProfile(value: unknown): value is UserProfileDto {
  if (!isUserSummary(value) || !isRecord(value)) return false
  const profile = value as unknown as UserProfileDto
  return typeof profile.bio === "string"
    && isNullableString(profile.location)
    && isNullableHttpUrl(profile.website_url)
    && isPositiveInteger(profile.profile_revision)
    && isNonEmptyString(profile.created_at)
    && isNonNegativeInteger(profile.topic_count)
    && isNonNegativeInteger(profile.follower_count)
    && isNonNegativeInteger(profile.following_count)
    && (profile.viewer === null || isProfileViewer(profile.viewer))
}

function isUserSummary(value: unknown): value is UserSummaryDto {
  return isRecord(value)
    && isUuid(value.id)
    && isNonEmptyString(value.username)
    && isNonEmptyString(value.display_name)
    && isNullableHttpsUrl(value.avatar_url)
}

function isProfileViewer(value: unknown): boolean {
  return isRecord(value)
    && typeof value.is_self === "boolean"
    && typeof value.is_following === "boolean"
    && typeof value.is_blocked_by_viewer === "boolean"
    && typeof value.can_message === "boolean"
}

function isEnvelope(value: unknown): value is UserEnvelope {
  return isRecord(value) && isRecord(value.meta) && isUuid(value.meta.request_id) && "data" in value
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

function toApiError(status: number, payload: unknown): UserApiError {
  if (!isErrorResponse(payload)) {
    return new UserApiError(status, "response.invalid", "用户服务响应格式无效")
  }
  return new UserApiError(status, payload.error.code, payload.error.message, payload.error.fields)
}

function isErrorResponse(value: unknown): value is ErrorResponseDto {
  return isRecord(value)
    && isRecord(value.error)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && isNonEmptyString(value.error.code)
    && isNonEmptyString(value.error.message)
    && (value.error.fields === undefined || isFieldErrors(value.error.fields))
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every((messages) => (
    Array.isArray(messages) && messages.length > 0 && messages.every(isNonEmptyString)
  ))
}

function isNullableHttpsUrl(value: unknown): value is string | null {
  return value === null || (isNonEmptyString(value) && value.startsWith("https://"))
}

function isNullableHttpUrl(value: unknown): value is string | null {
  return value === null || (isNonEmptyString(value)
    && (value.startsWith("http://") || value.startsWith("https://")))
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}
