const MODERATION_BOARDS_ENDPOINT = "/api/v1/admin/moderation/boards"
const MODERATION_TOPICS_ENDPOINT = "/api/v1/admin/moderation/topics"
const TOPICS_ENDPOINT = "/api/v1/topics"
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const tones = new Set(["green", "blue", "amber", "rose"])
const moderationStatuses = new Set(["approved", "hidden", "rejected"])

export type ModerationStatus = "approved" | "hidden" | "rejected"
export type ModerationAction = "pin" | "unpin" | "feature" | "unfeature" | "lock" | "unlock" | "move"

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
  if (!isEnvelope(payload) || !Array.isArray(payload.data) || !payload.data.every(isModerationBoardDto)) {
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
  if (!isPageEnvelope(payload) || !payload.data.every(isModerationTopicDto)) {
    throw new ModerationApiError(response.status, "response.invalid", "内容治理主题响应格式无效")
  }
  return {
    topics: payload.data.map(mapModerationTopic),
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
  if (!isEnvelope(payload) || !isModerationResultDto(payload.data)) {
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
  if (!isEnvelope(payload) || !isGovernanceResultDto(payload.data)) {
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
  meta?: { request_id?: unknown; next_cursor?: unknown }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function isEnvelope(value: unknown): value is EnvelopeDto {
  return isRecord(value) && "data" in value && isRecord(value.meta)
}

function isPageEnvelope(value: unknown): value is { data: ModerationTopicDto[]; meta: { next_cursor?: string | null } } {
  return isRecord(value)
    && Array.isArray(value.data)
    && isRecord(value.meta)
    && value.data.every(isModerationTopicDto)
    && (value.meta.next_cursor === undefined || value.meta.next_cursor === null || typeof value.meta.next_cursor === "string")
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
    && isNonEmptyString(value.title)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value) }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0 }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === "string" }
function isSafeNonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }
function isSafePositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 }
