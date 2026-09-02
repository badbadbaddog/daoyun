const MODERATION_BOARDS_ENDPOINT = "/api/v1/admin/moderation/boards"
const MODERATION_TOPICS_ENDPOINT = "/api/v1/admin/moderation/topics"
const TOPICS_ENDPOINT = "/api/v1/topics"
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const tones = new Set(["green", "blue", "amber", "rose"])
const moderationStatuses = new Set(["approved", "hidden", "rejected"])
const historySources = new Set(["moderation", "governance"])
const historyActions = new Set(["approved", "hidden", "rejected", "pin", "unpin", "feature", "unfeature", "lock", "unlock", "move"])

export type ModerationStatus = "approved" | "hidden" | "rejected"
export type ModerationAction = "pin" | "unpin" | "feature" | "unfeature" | "lock" | "unlock" | "move"
export type TopicModerationHistorySource = "moderation" | "governance"
export type TopicModerationHistoryAction = ModerationStatus | ModerationAction

export interface ModerationBoard {
  id: string
  slug: string
  name: string
  tone: "green" | "blue" | "amber" | "rose"
  capabilityKeys: string[]
}

export interface ModerationTopic {
  id: string
  title: string
  excerpt: string
  author: { id: string; username: string; displayName: string; avatarUrl: string | null }
  board: { id: string; slug: string; name: string; tone: ModerationBoard["tone"] }
  publishedAt: string
  lastActivityAt: string
  replyCount: number
  likeCount: number
  viewCount: number
  moderationStatus: ModerationStatus
  governanceRevision: number
  featured: boolean
  pinned: boolean
  locked: boolean
}

export interface ModerationTopicPage {
  topics: ModerationTopic[]
  nextCursor: string | null
}

export interface TopicModerationHistoryEntry {
  id: string
  source: TopicModerationHistorySource
  action: TopicModerationHistoryAction
  actor: { id: string; username: string; displayName: string; avatarUrl: string | null }
  reason: string | null
  createdAt: string
}

export interface TopicModerationHistoryPage {
  entries: TopicModerationHistoryEntry[]
  nextCursor: string | null
}

export interface ListTopicModerationHistoryOptions {
  topicId: string
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface ListModerationTopicsOptions {
  boardId?: string
  query?: string
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface GovernTopicInput {
  action: ModerationAction
  expectedRevision: number
  targetBoardId?: string
  reason?: string
}

export class ModerationApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(status: number, code: string, message: string, fields: Record<string, string[]> = {}) {
    super(message)
    this.name = "ModerationApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function listModerationBoards(signal?: AbortSignal): Promise<ModerationBoard[]> {
  const response = await fetch(MODERATION_BOARDS_ENDPOINT, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isEnvelope(response, payload) || !Array.isArray(payload.data) || !payload.data.every(isModerationBoardDto)) {
    throw new ModerationApiError(response.status, "response.invalid", "内容治理板块响应格式无效")
  }
  return payload.data.map(mapModerationBoard)
}

export async function listModerationTopics(options: ListModerationTopicsOptions = {}): Promise<ModerationTopicPage> {
  const limit = options.limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ModerationApiError(422, "validation.failed", "主题数量必须在 1 到 50 之间")
  }
  const params = new URLSearchParams()
  if (options.boardId) params.set("board_id", options.boardId)
  if (options.query?.trim()) params.set("query", options.query.trim())
  if (options.cursor) params.set("cursor", options.cursor)
  params.set("limit", String(limit))
  const response = await fetch(`${MODERATION_TOPICS_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isPageEnvelope(response, payload) || !payload.data.every(isModerationTopicDto)) {
    throw new ModerationApiError(response.status, "response.invalid", "内容治理主题响应格式无效")
  }
  return {
    topics: payload.data.map(mapModerationTopic),
    nextCursor: payload.meta.next_cursor ?? null,
  }
}

export async function listTopicModerationHistory(options: ListTopicModerationHistoryOptions): Promise<TopicModerationHistoryPage> {
  const limit = options.limit ?? DEFAULT_LIMIT
  if (!isUuid(options.topicId) || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ModerationApiError(422, "validation.failed", "处理记录查询参数无效")
  }
  const params = new URLSearchParams()
  if (options.cursor) params.set("cursor", options.cursor)
  params.set("limit", String(limit))
  const response = await fetch(`${MODERATION_TOPICS_ENDPOINT}/${encodeURIComponent(options.topicId)}/history?${params.toString()}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isHistoryPageEnvelope(response, payload)) {
    throw new ModerationApiError(response.status, "response.invalid", "主题处理记录响应格式无效")
  }
  return {
    entries: payload.data.map(mapTopicModerationHistory),
    nextCursor: payload.meta.next_cursor ?? null,
  }
}

export async function moderateTopic(
  topicId: string,
  input: { status: ModerationStatus; reason?: string },
  csrfToken: string,
  signal?: AbortSignal,
): Promise<{ topicId: string; status: ModerationStatus }> {
  const response = await fetch(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}/moderation`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify({ status: input.status, reason: input.reason }),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isEnvelope(response, payload) || !isModerationResultDto(payload.data)) {
    throw new ModerationApiError(response.status, "response.invalid", "主题审核响应格式无效")
  }
  return { topicId: payload.data.topic_id, status: payload.data.status }
}

export async function governTopic(
  topicId: string,
  input: GovernTopicInput,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<{ topicId: string; boardId: string; isPinned: boolean; isFeatured: boolean; isLocked: boolean; governanceRevision: number }> {
  const response = await fetch(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}/governance`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify({
      action: input.action,
      expected_revision: input.expectedRevision,
      ...(input.targetBoardId ? { target_board_id: input.targetBoardId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    }),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isEnvelope(response, payload) || !isGovernanceResultDto(payload.data)) {
    throw new ModerationApiError(response.status, "response.invalid", "主题治理响应格式无效")
  }
  return {
    topicId: payload.data.topic_id,
    boardId: payload.data.board_id,
    isPinned: payload.data.is_pinned,
    isFeatured: payload.data.is_featured,
    isLocked: payload.data.is_locked,
    governanceRevision: payload.data.governance_revision,
  }
}

interface EnvelopeDto {
  data: unknown
  meta: { request_id: string; next_cursor?: unknown }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function isEnvelope(response: Response, value: unknown): value is EnvelopeDto {
  return isRecord(value) && "data" in value && isResponseMeta(response, value.meta)
}

function isPageEnvelope(response: Response, value: unknown): value is { data: ModerationTopicDto[]; meta: { request_id: string; next_cursor?: string | null } } {
  return isRecord(value)
    && Array.isArray(value.data)
    && isResponseMeta(response, value.meta)
    && value.data.every(isModerationTopicDto)
    && (value.meta.next_cursor === undefined || value.meta.next_cursor === null || typeof value.meta.next_cursor === "string")
}

function isHistoryPageEnvelope(response: Response, value: unknown): value is { data: TopicModerationHistoryDto[]; meta: { request_id: string; next_cursor?: string | null } } {
  return isRecord(value)
    && Array.isArray(value.data)
    && isResponseMeta(response, value.meta)
    && value.data.every(isTopicModerationHistoryDto)
    && (value.meta.next_cursor === undefined || value.meta.next_cursor === null || typeof value.meta.next_cursor === "string")
}

function isResponseMeta(response: Response, value: unknown): value is { request_id: string; next_cursor?: unknown } {
  return isRecord(value)
    && isUuid(value.request_id)
    && response.headers.get("x-request-id") === value.request_id
}

function isModerationBoardDto(value: unknown): value is ModerationBoardDto {
  return isRecord(value)
    && isUuid(value.id)
    && isNonEmptyString(value.slug)
    && isNonEmptyString(value.name)
    && typeof value.tone === "string"
    && tones.has(value.tone)
    && Array.isArray(value.capability_keys)
    && value.capability_keys.every((key) => isNonEmptyString(key))
}

function isModerationTopicDto(value: unknown): value is ModerationTopicDto {
  return isRecord(value)
    && isUuid(value.id)
    && typeof value.title === "string"
    && typeof value.excerpt === "string"
    && isAuthorDto(value.author)
    && isBoardDto(value.board)
    && isNonEmptyString(value.published_at)
    && isNonEmptyString(value.last_activity_at)
    && isSafeNonNegativeInteger(value.reply_count)
    && isSafeNonNegativeInteger(value.like_count)
    && isSafeNonNegativeInteger(value.view_count)
    && typeof value.moderation_status === "string"
    && moderationStatuses.has(value.moderation_status)
    && isSafePositiveInteger(value.governance_revision)
    && typeof value.is_featured === "boolean"
    && typeof value.is_pinned === "boolean"
    && typeof value.is_locked === "boolean"
}

function isModerationResultDto(value: unknown): value is { topic_id: string; status: ModerationStatus } {
  return isRecord(value) && isUuid(value.topic_id) && typeof value.status === "string" && moderationStatuses.has(value.status)
}

function isGovernanceResultDto(value: unknown): value is GovernanceResultDto {
  return isRecord(value)
    && isUuid(value.topic_id)
    && isUuid(value.board_id)
    && typeof value.is_pinned === "boolean"
    && typeof value.is_featured === "boolean"
    && typeof value.is_locked === "boolean"
    && isSafePositiveInteger(value.governance_revision)
}

function isTopicModerationHistoryDto(value: unknown): value is TopicModerationHistoryDto {
  return isRecord(value)
    && isUuid(value.id)
    && typeof value.source === "string"
    && historySources.has(value.source)
    && typeof value.action === "string"
    && historyActions.has(value.action)
    && isAuthorDto(value.actor)
    && isNullableString(value.reason)
    && isNonEmptyString(value.created_at)
}

function isAuthorDto(value: unknown): value is AuthorDto {
  return isRecord(value) && isUuid(value.id) && isNonEmptyString(value.username) && isNonEmptyString(value.display_name) && isNullableString(value.avatar_url)
}

function isBoardDto(value: unknown): value is BoardDto {
  return isRecord(value) && isUuid(value.id) && isNonEmptyString(value.slug) && isNonEmptyString(value.name) && typeof value.tone === "string" && tones.has(value.tone)
}

function mapModerationBoard(value: ModerationBoardDto): ModerationBoard {
  return { id: value.id, slug: value.slug, name: value.name, tone: value.tone as ModerationBoard["tone"], capabilityKeys: value.capability_keys }
}

function mapModerationTopic(value: ModerationTopicDto): ModerationTopic {
  return {
    id: value.id,
    title: value.title,
    excerpt: value.excerpt,
    author: { id: value.author.id, username: value.author.username, displayName: value.author.display_name, avatarUrl: value.author.avatar_url },
    board: { id: value.board.id, slug: value.board.slug, name: value.board.name, tone: value.board.tone as ModerationBoard["tone"] },
    publishedAt: value.published_at,
    lastActivityAt: value.last_activity_at,
    replyCount: value.reply_count,
    likeCount: value.like_count,
    viewCount: value.view_count,
    moderationStatus: value.moderation_status as ModerationStatus,
    governanceRevision: value.governance_revision,
    featured: value.is_featured,
    pinned: value.is_pinned,
    locked: value.is_locked,
  }
}

function mapTopicModerationHistory(value: TopicModerationHistoryDto): TopicModerationHistoryEntry {
  return {
    id: value.id,
    source: value.source as TopicModerationHistorySource,
    action: value.action as TopicModerationHistoryAction,
    actor: { id: value.actor.id, username: value.actor.username, displayName: value.actor.display_name, avatarUrl: value.actor.avatar_url },
    reason: value.reason,
    createdAt: value.created_at,
  }
}

function toApiError(status: number, payload: unknown): ModerationApiError {
  if (!isRecord(payload) || !isRecord(payload.error) || typeof payload.error.code !== "string" || typeof payload.error.message !== "string") {
    return new ModerationApiError(status, "response.invalid", "内容治理服务响应格式无效")
  }
  const fields = isRecord(payload.error.fields)
    ? Object.fromEntries(Object.entries(payload.error.fields).filter(([, value]) => Array.isArray(value) && value.every((item) => typeof item === "string"))) as Record<string, string[]>
    : {}
  return new ModerationApiError(status, payload.error.code, payload.error.message, fields)
}

type ModerationBoardDto = { id: string; slug: string; name: string; tone: string; capability_keys: string[] }
type AuthorDto = { id: string; username: string; display_name: string; avatar_url: string | null }
type BoardDto = { id: string; slug: string; name: string; tone: string }
type ModerationTopicDto = {
  id: string
  title: string
  excerpt: string
  author: AuthorDto
  board: BoardDto
  published_at: string
  last_activity_at: string
  reply_count: number
  like_count: number
  view_count: number
  moderation_status: string
  governance_revision: number
  is_featured: boolean
  is_pinned: boolean
  is_locked: boolean
}
type GovernanceResultDto = {
  topic_id: string
  board_id: string
  is_pinned: boolean
  is_featured: boolean
  is_locked: boolean
  governance_revision: number
}
type TopicModerationHistoryDto = {
  id: string
  source: string
  action: string
  actor: AuthorDto
  reason: string | null
  created_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value) }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0 }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === "string" }
function isSafeNonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }
function isSafePositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 }
