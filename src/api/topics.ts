import type { Topic, TopicTag } from "../types/community"
import type { components } from "./generated"

const TOPICS_ENDPOINT = "/api/v1/topics"
const DEFAULT_LIMIT = 20
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const topicTones = new Set(["green", "blue", "amber", "rose"])

export type TopicSort = components["schemas"]["TopicSort"]
export type TopicScope = components["schemas"]["TopicScope"]

export interface ListTopicsOptions {
  board?: string
  query?: string
  tag?: string
  author?: string
  scope?: TopicScope
  featured?: boolean
  sort?: TopicSort
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface TopicPage {
  topics: Topic[]
  nextCursor: string | null
}

export interface TopicDetail extends Topic {
  content: string
  authorId: string
  authorUsername: string
  contentRevision: number
}

export interface TopicReply {
  id: string
  topicId: string
  author: {
    id: string
    username: string
    displayName: string
    avatarUrl: string | null
  }
  content: string
  createdAt: string
  updatedAt: string
  revisionCount: number
  likeCount: number
  liked: boolean | null
}

export interface ReplyPage {
  replies: TopicReply[]
  nextCursor: string | null
}

export interface ListRepliesOptions {
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface CreateReplyOptions {
  csrfToken: string
  idempotencyKey: string
  signal?: AbortSignal
}

export interface UpdateReplyInput {
  baseRevision: number
  content: string
}

export interface ReplyMutationOptions {
  csrfToken: string
  signal?: AbortSignal
}

export interface ReplyRevision {
  id: string
  replyId: string
  revisionNumber: number
  editor: {
    id: string
    username: string
    displayName: string
    avatarUrl: string | null
  }
  content: string
  createdAt: string
}

export interface UpdateTopicInput {
  baseRevision: number
  title?: string
  content?: string
  tags?: TopicTag[]
}

export interface UpdateTopicOptions {
  csrfToken: string
  signal?: AbortSignal
}

export interface TopicRevision {
  id: string
  topicId: string
  revisionNumber: number
  editor: {
    id: string
    username: string
    displayName: string
    avatarUrl: string | null
  }
  content: string
  createdAt: string
}

export interface CreateTopicInput {
  title: string
  content: string
  boardId?: string
  tags?: TopicTag[]
}

export interface CreateTopicOptions {
  csrfToken: string
  idempotencyKey: string
  signal?: AbortSignal
}

type TopicAuthorDto = Required<components["schemas"]["TopicAuthorSummary"]>
type TopicBoardDto = components["schemas"]["TopicBoardSummary"]
type TopicTagDto = components["schemas"]["TopicTag"]
type TopicSummaryDto = components["schemas"]["TopicSummary"] & {
  author: TopicAuthorDto
  board: TopicBoardDto
  tags: TopicTagDto[]
  viewer_bookmarked: boolean | null
  viewer_liked: boolean | null
}
type TopicDetailDto = TopicSummaryDto & { content: string; content_revision: number }
type TopicRevisionDto = Omit<components["schemas"]["TopicRevision"], "editor"> & { editor: TopicAuthorDto }
type ReplyRevisionDto = Omit<components["schemas"]["ReplyRevision"], "editor"> & { editor: TopicAuthorDto }
type TopicPageDto = Omit<components["schemas"]["PageResponse_TopicSummary"], "data" | "meta"> & {
  data: TopicSummaryDto[]
  meta: Required<components["schemas"]["PageMeta"]>
}
type TopicResponseDto = Omit<components["schemas"]["ApiResponse_TopicDetail"], "data"> & { data: TopicDetailDto }
type TopicReplyDto = Omit<components["schemas"]["TopicReply"], "author"> & {
  author: TopicAuthorDto
  viewer_liked: boolean | null
}
type ReplyPageDto = Omit<components["schemas"]["PageResponse_TopicReply"], "data" | "meta"> & {
  data: TopicReplyDto[]
  meta: Required<components["schemas"]["PageMeta"]>
}
type ReplyResponseDto = Omit<components["schemas"]["ApiResponse_TopicReply"], "data"> & { data: TopicReplyDto }
type TagsResponseDto = components["schemas"]["ApiResponse_Vec_TopicTag"]
type RevisionsResponseDto = Omit<components["schemas"]["ApiResponse_Vec_TopicRevision"], "data"> & { data: TopicRevisionDto[] }
type ReplyRevisionsResponseDto = Omit<components["schemas"]["ApiResponse_Vec_ReplyRevision"], "data"> & { data: ReplyRevisionDto[] }
type BooleanResponseDto = components["schemas"]["ApiResponse_bool"]
type ErrorResponseDto = components["schemas"]["ErrorResponse"]
type CreateTopicRequestDto = components["schemas"]["CreateTopicRequest"]
type UpdateTopicRequestDto = components["schemas"]["UpdateTopicRequest"]
type CreateReplyRequestDto = components["schemas"]["CreateReplyRequest"]
type UpdateReplyRequestDto = components["schemas"]["UpdateReplyRequest"]

export class TopicApiError extends Error {
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
    this.name = "TopicApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function listTopics(options: ListTopicsOptions = {}): Promise<TopicPage> {
  const params = new URLSearchParams()
  if (options.board) params.set("board", options.board)
  if (options.query?.trim()) params.set("query", options.query.trim())
  if (options.tag?.trim()) params.set("tag", options.tag.trim())
  if (options.author?.trim()) params.set("author", options.author.trim())
  if (options.scope) params.set("scope", options.scope)
  if (options.featured) params.set("featured", "true")
  if (options.sort) params.set("sort", options.sort)
  if (options.cursor) params.set("cursor", options.cursor)
  params.set("limit", String(options.limit ?? DEFAULT_LIMIT))

  const response = await fetch(`${TOPICS_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isTopicPage(payload)) {
    throw new Error("主题列表响应格式无效")
  }

  return parseTopicPage(payload) as TopicPage
}

export async function createTopic(
  input: CreateTopicInput,
  options: CreateTopicOptions,
): Promise<Topic> {
  const requestBody: CreateTopicRequestDto = {
    title: input.title,
    content: input.content,
  }
  if (input.boardId) {
    requestBody.board_id = input.boardId
  }
  if (input.tags && input.tags.length > 0) {
    requestBody.tags = input.tags
  }

  const response = await fetch(TOPICS_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": options.csrfToken,
      "idempotency-key": options.idempotencyKey,
    },
    credentials: "include",
    body: JSON.stringify(requestBody),
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if ((response.status !== 200 && response.status !== 201) || !isTopicResponse(payload)) {
    throw new Error("主题发布响应格式无效")
  }
  return mapTopic(payload.data)
}

export async function getTopic(topicId: string, signal?: AbortSignal): Promise<TopicDetail> {
  const response = await fetch(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isTopicResponse(payload)) {
    throw new Error("主题详情响应格式无效")
  }
  return {
    ...mapTopic(payload.data),
    content: payload.data.content,
    authorId: payload.data.author.id,
    authorUsername: payload.data.author.username,
    contentRevision: payload.data.content_revision,
  }
}

export async function listTags(signal?: AbortSignal): Promise<TopicTag[]> {
  const response = await fetch("/api/v1/tags", {
    headers: { Accept: "application/json" },
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isTagsResponse(payload)) {
    throw new Error("标签列表响应格式无效")
  }
  return payload.data.map(mapTag)
}

export async function updateTopic(
  topicId: string,
  input: UpdateTopicInput,
  options: UpdateTopicOptions,
): Promise<TopicDetail> {
  const requestBody: UpdateTopicRequestDto = {
    base_revision: input.baseRevision,
  }
  if (input.title !== undefined) requestBody.title = input.title
  if (input.content !== undefined) requestBody.content = input.content
  if (input.tags !== undefined) requestBody.tags = input.tags
  const response = await fetch(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": options.csrfToken,
    },
    credentials: "include",
    body: JSON.stringify(requestBody),
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isTopicResponse(payload)) {
    throw new Error("主题编辑响应格式无效")
  }
  return {
    ...mapTopic(payload.data),
    content: payload.data.content,
    authorId: payload.data.author.id,
    authorUsername: payload.data.author.username,
    contentRevision: payload.data.content_revision,
  }
}

export async function deleteTopic(
  topicId: string,
  options: UpdateTopicOptions,
): Promise<boolean> {
  const response = await fetch(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}`, {
    method: "DELETE",
    headers: { Accept: "application/json", "x-csrf-token": options.csrfToken },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isBooleanResponse(payload)) {
    throw new Error("主题删除响应格式无效")
  }
  return payload.data
}

export async function listRevisions(
  topicId: string,
  signal?: AbortSignal,
): Promise<TopicRevision[]> {
  const response = await fetch(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}/revisions`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isRevisionsResponse(payload)) {
    throw new Error("修订历史响应格式无效")
  }
  return payload.data.map(mapRevision)
}

export async function listReplies(
  topicId: string,
  options: ListRepliesOptions = {},
): Promise<ReplyPage> {
  const params = new URLSearchParams()
  if (options.cursor) params.set("cursor", options.cursor)
  params.set("limit", String(options.limit ?? DEFAULT_LIMIT))
  const response = await fetch(
    `${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}/replies?${params.toString()}`,
    {
      headers: { Accept: "application/json" },
      credentials: "include",
      signal: options.signal,
    },
  )
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isReplyPage(payload)) {
    throw new Error("回复列表响应格式无效")
  }
  return {
    replies: payload.data.map(mapReply),
    nextCursor: payload.meta.next_cursor,
  }
}

export async function createReply(
  topicId: string,
  content: string,
  options: CreateReplyOptions,
): Promise<TopicReply> {
  const requestBody: CreateReplyRequestDto = { content }
  const response = await fetch(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}/replies`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": options.csrfToken,
      "idempotency-key": options.idempotencyKey,
    },
    credentials: "include",
    body: JSON.stringify(requestBody),
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if ((response.status !== 200 && response.status !== 201) || !isReplyResponse(payload)) {
    throw new Error("回复发布响应格式无效")
  }
  return mapReply(payload.data)
}

export async function updateReply(
  topicId: string,
  replyId: string,
  input: UpdateReplyInput,
  options: ReplyMutationOptions,
): Promise<TopicReply> {
  const requestBody: UpdateReplyRequestDto = {
    base_revision: input.baseRevision,
    content: input.content,
  }
  const response = await fetch(replyItemEndpoint(topicId, replyId), {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": options.csrfToken,
    },
    credentials: "include",
    body: JSON.stringify(requestBody),
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isReplyResponse(payload)) {
    throw new Error("回复编辑响应格式无效")
  }
  return mapReply(payload.data)
}

export async function listReplyRevisions(
  topicId: string,
  replyId: string,
  signal?: AbortSignal,
): Promise<ReplyRevision[]> {
  const response = await fetch(`${replyItemEndpoint(topicId, replyId)}/revisions`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isReplyRevisionsResponse(payload)) {
    throw new Error("回复修订历史响应格式无效")
  }
  return payload.data.map(mapReplyRevision)
}

export async function deleteReply(
  topicId: string,
  replyId: string,
  options: ReplyMutationOptions,
): Promise<boolean> {
  const response = await fetch(replyItemEndpoint(topicId, replyId), {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "x-csrf-token": options.csrfToken,
    },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isBooleanResponse(payload)) {
    throw new Error("回复删除响应格式无效")
  }
  return payload.data
}

function replyItemEndpoint(topicId: string, replyId: string): string {
  return `${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}/replies/${encodeURIComponent(replyId)}`
}

function mapTopic(topic: TopicSummaryDto): Topic {
  return {
    id: topic.id,
    title: topic.title,
    excerpt: topic.excerpt,
    board: topic.board.name,
    boardTone: topic.board.tone as Topic["boardTone"],
    authorId: topic.author.id,
    authorUsername: topic.author.username,
    author: topic.author.display_name,
    avatarUrl: topic.author.avatar_url,
    publishedAt: formatRelativeTime(topic.published_at),
    replies: topic.reply_count,
    likes: topic.like_count,
    bookmarked: topic.viewer_bookmarked,
    liked: topic.viewer_liked,
    views: topic.view_count,
    featured: topic.is_featured,
    pinned: topic.is_pinned,
    hot: false,
    followed: false,
    tags: topic.tags.map(mapTag),
  }
}

function mapTag(tag: TopicTagDto): TopicTag {
  return { slug: tag.slug, name: tag.name }
}

function mapRevision(revision: TopicRevisionDto): TopicRevision {
  return {
    id: revision.id,
    topicId: revision.topic_id,
    revisionNumber: revision.revision_number,
    editor: {
      id: revision.editor.id,
      username: revision.editor.username,
      displayName: revision.editor.display_name,
      avatarUrl: revision.editor.avatar_url,
    },
    content: revision.content,
    createdAt: formatRelativeTime(revision.created_at),
  }
}

function mapReplyRevision(revision: ReplyRevisionDto): ReplyRevision {
  return {
    id: revision.id,
    replyId: revision.reply_id,
    revisionNumber: revision.revision_number,
    editor: {
      id: revision.editor.id,
      username: revision.editor.username,
      displayName: revision.editor.display_name,
      avatarUrl: revision.editor.avatar_url,
    },
    content: revision.content,
    createdAt: formatRelativeTime(revision.created_at),
  }
}

function mapReply(reply: TopicReplyDto): TopicReply {
  return {
    id: reply.id,
    topicId: reply.topic_id,
    author: {
      id: reply.author.id,
      username: reply.author.username,
      displayName: reply.author.display_name,
      avatarUrl: reply.author.avatar_url,
    },
    content: reply.content,
    createdAt: formatRelativeTime(reply.created_at),
    updatedAt: formatRelativeTime(reply.updated_at),
    revisionCount: reply.revision_count,
    likeCount: reply.like_count,
    liked: reply.viewer_liked,
  }
}

export function parseTopicPage(value: unknown): TopicPage | null {
  if (!isTopicPage(value)) return null
  return {
    topics: value.data.map(mapTopic),
    nextCursor: value.meta.next_cursor,
  }
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return value
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return "刚刚"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86_400)} 天前`
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

function toApiError(status: number, payload: unknown): TopicApiError {
  if (!isErrorResponse(payload)) {
    return new TopicApiError(status, "response.invalid", "主题服务响应格式无效")
  }
  return new TopicApiError(
    status,
    payload.error.code,
    payload.error.message,
    payload.error.fields,
  )
}

function isTopicPage(value: unknown): value is TopicPageDto {
  return isRecord(value)
    && Array.isArray(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && (value.meta.next_cursor === null || isUuid(value.meta.next_cursor))
    && value.data.every(isTopicSummary)
}

function isTopicResponse(value: unknown): value is TopicResponseDto {
  return isRecord(value)
    && isRecord(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && isTopicDetail(value.data)
}

function isReplyPage(value: unknown): value is ReplyPageDto {
  return isRecord(value)
    && Array.isArray(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && (value.meta.next_cursor === null || isUuid(value.meta.next_cursor))
    && value.data.every(isTopicReply)
}

function isReplyResponse(value: unknown): value is ReplyResponseDto {
  return isRecord(value)
    && isRecord(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && isTopicReply(value.data)
}

function isTagsResponse(value: unknown): value is TagsResponseDto {
  return isRecord(value)
    && Array.isArray(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && value.data.every(isTopicTag)
}

function isRevisionsResponse(value: unknown): value is RevisionsResponseDto {
  return isRecord(value)
    && Array.isArray(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && value.data.every(isTopicRevision)
}

function isReplyRevisionsResponse(value: unknown): value is ReplyRevisionsResponseDto {
  return isRecord(value)
    && Array.isArray(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && value.data.every(isReplyRevision)
}

function isBooleanResponse(value: unknown): value is BooleanResponseDto {
  return isRecord(value)
    && typeof value.data === "boolean"
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
}

function isTopicReply(value: unknown): value is TopicReplyDto {
  if (!isRecord(value) || !isRecord(value.author)) {
    return false
  }
  return isUuid(value.id)
    && isUuid(value.topic_id)
    && isUuid(value.author.id)
    && isNonEmptyString(value.author.username)
    && isNonEmptyString(value.author.display_name)
    && isNullableHttpsUrl(value.author.avatar_url)
    && isNonEmptyString(value.content)
    && isNonEmptyString(value.created_at)
    && isNonEmptyString(value.updated_at)
    && isSafePositiveInteger(value.revision_count)
    && isSafeNonNegativeInteger(value.like_count)
    && isNullableBoolean(value.viewer_liked)
}

function isTopicTag(value: unknown): value is TopicTagDto {
  return isRecord(value)
    && isNonEmptyString(value.slug)
    && isNonEmptyString(value.name)
    && value.slug.length <= 40
    && value.name.length <= 40
}

function isTopicRevision(value: unknown): value is TopicRevisionDto {
  if (!isRecord(value) || !isRecord(value.editor)) return false
  return isUuid(value.id)
    && isUuid(value.topic_id)
    && isSafeNonNegativeInteger(value.revision_number)
    && isUuid(value.editor.id)
    && isNonEmptyString(value.editor.username)
    && isNonEmptyString(value.editor.display_name)
    && isNullableHttpsUrl(value.editor.avatar_url)
    && isNonEmptyString(value.content)
    && isNonEmptyString(value.created_at)
}

function isReplyRevision(value: unknown): value is ReplyRevisionDto {
  if (!isRecord(value) || !isRecord(value.editor)) return false
  return isUuid(value.id)
    && isUuid(value.reply_id)
    && isSafePositiveInteger(value.revision_number)
    && isUuid(value.editor.id)
    && isNonEmptyString(value.editor.username)
    && isNonEmptyString(value.editor.display_name)
    && isNullableHttpsUrl(value.editor.avatar_url)
    && isNonEmptyString(value.content)
    && isNonEmptyString(value.created_at)
}

function isTopicDetail(value: unknown): value is TopicDetailDto {
  return isTopicSummary(value)
    && typeof (value as unknown as Record<string, unknown>).content === "string"
    && isSafeNonNegativeInteger((value as unknown as Record<string, unknown>).content_revision)
}

function isTopicSummary(value: unknown): value is TopicSummaryDto {
  if (!isRecord(value) || !isRecord(value.author) || !isRecord(value.board)) {
    return false
  }
  return isUuid(value.id)
    && isNonEmptyString(value.title)
    && typeof value.excerpt === "string"
    && isUuid(value.author.id)
    && isNonEmptyString(value.author.username)
    && isNonEmptyString(value.author.display_name)
    && isNullableHttpsUrl(value.author.avatar_url)
    && isUuid(value.board.id)
    && isNonEmptyString(value.board.slug)
    && isNonEmptyString(value.board.name)
    && typeof value.board.tone === "string"
    && topicTones.has(value.board.tone)
    && isNonEmptyString(value.published_at)
    && isNonEmptyString(value.last_activity_at)
    && isSafeNonNegativeInteger(value.reply_count)
    && isSafeNonNegativeInteger(value.like_count)
    && isNullableBoolean(value.viewer_bookmarked)
    && isNullableBoolean(value.viewer_liked)
    && isSafeNonNegativeInteger(value.view_count)
    && typeof value.is_featured === "boolean"
    && typeof value.is_pinned === "boolean"
    && Array.isArray(value.tags)
    && value.tags.every(isTopicTag)
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

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean"
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isNullableHttpsUrl(value: unknown): value is string | null {
  return value === null || (isNonEmptyString(value) && value.startsWith("https://"))
}
