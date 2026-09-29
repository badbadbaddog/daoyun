import type { PollInput } from "./polls"
import type { Topic, TopicTag } from "../types/community"
import { isRichTextDocument, type RichTextDocument } from "../editor/richContent"
import type { components } from "./generated"

const TOPICS_ENDPOINT = "/api/v1/topics"
const DEFAULT_LIMIT = 20
const MAX_SUPPLEMENT_LENGTH = 1000
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const boardSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const attachmentThumbnailPattern = /^\/api\/v1\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/thumbnail$/i
const topicTones = new Set(["green", "blue", "amber", "rose"])

export type TopicSort = components["schemas"]["TopicSort"]
export type TopicScope = components["schemas"]["TopicScope"]

export interface ListTopicsOptions {
  board?: string
  query?: string
  tag?: string
  author?: string
  from?: string
  through?: string
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
  richContent?: RichTextDocument | null
  authorId: string
  authorUsername: string
  contentRevision: number
  hasLockedContent: boolean
  editDisposition?: "published" | "pending_review"
  editReviewId?: string | null
}

export interface ReplyReference {
  id: string
  floorNumber: number
  author: TopicReply["author"]
  excerpt: string | null
  isDeleted: boolean
}

export interface TopicReply {
  id: string
  topicId: string
  floorNumber: number
  replyTo: ReplyReference | null
  author: {
    id: string
    username: string
    displayName: string
    avatarUrl: string | null
  }
  content: string
  richContent?: RichTextDocument | null
  hasLockedContent: boolean
  createdAt: string
  updatedAt: string
  revisionCount: number
  likeCount: number
  liked: boolean | null
  editDisposition?: "published" | "pending_review"
  editReviewId?: string | null
}

export interface TopicSupplement {
  id: string
  topicId: string
  content: string
  status: "approved" | "hidden"
  createdAt: string
  updatedAt: string
  author: {
    id: string
    username: string
    displayName: string
    avatarUrl: string | null
  }
}

export interface ReplyPage {
  replies: TopicReply[]
  nextCursor: string | null
}

export interface SupplementPage {
  supplements: TopicSupplement[]
  policy?: {
    enabled: boolean
    maxPerTopic: number
    usedCount: number
    canSubmit: boolean
  }
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
  replyToId?: string
}

export interface UpdateReplyInput {
  baseRevision: number
  content: string
  richContent?: RichTextDocument
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
  richContent?: RichTextDocument | null
  createdAt: string
}

export interface UpdateTopicInput {
  baseRevision: number
  title?: string
  content?: string
  richContent?: RichTextDocument
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
  richContent?: RichTextDocument | null
  createdAt: string
}

export interface CreateTopicInput {
  poll?: PollInput
  draft?: { id: string; revision: number }
  title?: string
  content: string
  richContent?: RichTextDocument
  boardId?: string
  tags?: TopicTag[]
}

export interface CreateTopicSupplementOptions {
  csrfToken: string
  idempotencyKey: string
  signal?: AbortSignal
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
  image_url?: string | null
  image_urls?: string[]
}
type TopicDetailDto = TopicSummaryDto & { content: string; rich_content?: unknown; content_revision: number; has_locked_content: boolean }
type TopicRevisionDto = Omit<components["schemas"]["TopicRevision"], "editor"> & { editor: TopicAuthorDto; rich_content?: unknown }
type ReplyRevisionDto = Omit<components["schemas"]["ReplyRevision"], "editor"> & { editor: TopicAuthorDto; rich_content?: unknown }
type TopicPageDto = Omit<components["schemas"]["PageResponse_TopicSummary"], "data" | "meta"> & {
  data: TopicSummaryDto[]
  meta: Required<components["schemas"]["PageMeta"]>
}
type TopicResponseDto = Omit<components["schemas"]["ApiResponse_TopicDetail"], "data"> & { data: TopicDetailDto }
type TopicEditResponseDto = {
  data: { topic: TopicDetailDto; disposition: "published" | "pending_review"; review_id: string | null }
  meta: { request_id: string }
}
type TopicReplyDto = Omit<components["schemas"]["TopicReply"], "author"> & {
  author: TopicAuthorDto
  floor_number: number
  reply_to: ReplyReferenceDto | null
  has_locked_content: boolean
  viewer_liked: boolean | null
  rich_content?: unknown
}
type ReplyEditResponseDto = {
  data: { reply: TopicReplyDto; disposition: "published" | "pending_review"; review_id: string | null }
  meta: { request_id: string }
}
type ReplyReferenceDto = {
  id: string
  floor_number: number
  author: TopicAuthorDto
  excerpt: string | null
  is_deleted: boolean
}

type TopicSupplementAuthorDto = {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}

type TopicSupplementDto = {
  id: string
  topic_id: string
  content: string
  status: "approved" | "hidden"
  created_at: string
  updated_at: string
  author: TopicSupplementAuthorDto
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
type TopicSupplementListDto = {
  data: TopicSupplementDto[]
  meta: {
    request_id: string
    enabled?: boolean
    max_per_topic?: number
    used_count?: number
    can_submit?: boolean
  }
}
type TopicSupplementCreateResponseDto = {
  data: TopicSupplementDto
  meta: {
    request_id: string
  }
}
type ErrorResponseDto = components["schemas"]["ErrorResponse"]
type CreateTopicRequestDto = Omit<components["schemas"]["CreateTopicRequest"], "rich_content" | "title"> & {
  title?: string
  rich_content?: RichTextDocument
}
type UpdateTopicRequestDto = Omit<components["schemas"]["UpdateTopicRequest"], "rich_content"> & {
  rich_content?: RichTextDocument
}
type CreateReplyRequestDto = Omit<components["schemas"]["CreateReplyRequest"], "rich_content"> & {
  rich_content?: RichTextDocument
  reply_to_id?: string
}
type UpdateReplyRequestDto = Omit<components["schemas"]["UpdateReplyRequest"], "rich_content"> & {
  rich_content?: RichTextDocument
}

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
  if (options.from) params.set("from", options.from)
  if (options.through) params.set("through", options.through)
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
  const requestBody: CreateTopicRequestDto & { draft?: { id: string; revision: number }; poll?: PollInput } = {
    content: input.content,
  }
  if (input.poll) requestBody.poll = input.poll
  if (input.draft) requestBody.draft = input.draft
  if (input.title?.trim()) requestBody.title = input.title.trim()
  if (input.boardId) {
    requestBody.board_id = input.boardId
  }
  if (input.richContent) requestBody.rich_content = input.richContent
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
    richContent: readRichContent(payload.data.rich_content),
    authorId: payload.data.author.id,
    authorUsername: payload.data.author.username,
    contentRevision: payload.data.content_revision,
    hasLockedContent: payload.data.has_locked_content,
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
  if (input.richContent !== undefined) requestBody.rich_content = input.richContent
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
  if (response.status !== 200 || !isTopicEditResponse(payload)) {
    throw new Error("主题编辑响应格式无效")
  }
  return {
    ...mapTopic(payload.data.topic),
    content: payload.data.topic.content,
    richContent: readRichContent(payload.data.topic.rich_content),
    authorId: payload.data.topic.author.id,
    authorUsername: payload.data.topic.author.username,
    contentRevision: payload.data.topic.content_revision,
    hasLockedContent: payload.data.topic.has_locked_content,
    editDisposition: payload.data.disposition,
    editReviewId: payload.data.review_id,
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
  return fetchTopicRevisions(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}/revisions`, signal)
}

export async function listAdminTopicRevisions(topicId: string, signal?: AbortSignal): Promise<TopicRevision[]> {
  return fetchTopicRevisions(`/api/v1/admin/moderation/topics/${encodeURIComponent(topicId)}/revisions`, signal)
}

async function fetchTopicRevisions(url: string, signal?: AbortSignal): Promise<TopicRevision[]> {
  const response = await fetch(url, {
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

export async function listTopicSupplements(
  topicId: string,
  signal?: AbortSignal,
): Promise<SupplementPage> {
  const response = await fetch(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}/supplements`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 200 || !isTopicSupplementList(payload)) {
    throw new Error("补充列表响应格式无效")
  }
  return {
    supplements: payload.data.map(mapTopicSupplement),
    ...(payload.meta.enabled !== undefined ? {
      policy: {
        enabled: payload.meta.enabled,
        maxPerTopic: payload.meta.max_per_topic!,
        usedCount: payload.meta.used_count!,
        canSubmit: payload.meta.can_submit!,
      },
    } : {}),
  }
}

export async function createTopicSupplement(
  topicId: string,
  content: string,
  options: CreateTopicSupplementOptions,
): Promise<TopicSupplement> {
  content = content.trim()
  if (![...content].length || [...content].length > MAX_SUPPLEMENT_LENGTH) {
    throw new TopicApiError(422, "request.validation_failed", "补充正文必须为 1 至 1,000 个字符")
  }
  const response = await fetch(`${TOPICS_ENDPOINT}/${encodeURIComponent(topicId)}/supplements`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": options.csrfToken,
      "idempotency-key": options.idempotencyKey,
    },
    credentials: "include",
    body: JSON.stringify({ content }),
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (!isTopicSupplementCreate(payload)) {
    throw new Error("帖子补充响应格式无效")
  }
  return mapTopicSupplement(payload.data)
}

export async function createReply(
  topicId: string,
  content: string,
  options: CreateReplyOptions,
  richContent?: RichTextDocument,
): Promise<TopicReply> {
  const requestBody: CreateReplyRequestDto = { content }
  if (richContent) requestBody.rich_content = richContent
  if (options.replyToId) requestBody.reply_to_id = options.replyToId
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
  if (input.richContent) requestBody.rich_content = input.richContent
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
  if (response.status !== 200 || !isReplyEditResponse(payload)) {
    throw new Error("回复编辑响应格式无效")
  }
  return {
    ...mapReply(payload.data.reply),
    editDisposition: payload.data.disposition,
    editReviewId: payload.data.review_id,
  }
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
    boardSlug: topic.board.slug,
    boardTone: topic.board.tone as Topic["boardTone"],
    authorId: topic.author.id,
    authorUsername: topic.author.username,
    author: topic.author.display_name,
    avatarUrl: topic.author.avatar_url,
    imageUrl: topic.image_url ?? topic.image_urls?.[0] ?? undefined,
    imageUrls: (topic.image_urls ?? (topic.image_url ? [topic.image_url] : [])).slice(0, 3),
    publishedAt: formatRelativeTime(topic.published_at),
    publishedAtIso: topic.published_at,
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
    richContent: readRichContent(revision.rich_content),
    createdAt: revision.created_at,
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
    richContent: readRichContent(revision.rich_content),
    createdAt: formatRelativeTime(revision.created_at),
  }
}

function mapReply(reply: TopicReplyDto): TopicReply {
  return {
    id: reply.id,
    topicId: reply.topic_id,
    floorNumber: reply.floor_number,
    replyTo: reply.reply_to ? {
      id: reply.reply_to.id,
      floorNumber: reply.reply_to.floor_number,
      author: {
        id: reply.reply_to.author.id,
        username: reply.reply_to.author.username,
        displayName: reply.reply_to.author.display_name,
        avatarUrl: reply.reply_to.author.avatar_url,
      },
      excerpt: reply.reply_to.excerpt,
      isDeleted: reply.reply_to.is_deleted,
    } : null,
    author: {
      id: reply.author.id,
      username: reply.author.username,
      displayName: reply.author.display_name,
      avatarUrl: reply.author.avatar_url,
    },
    content: reply.content,
    richContent: readRichContent(reply.rich_content),
    hasLockedContent: reply.has_locked_content,
    createdAt: formatRelativeTime(reply.created_at),
    updatedAt: formatRelativeTime(reply.updated_at),
    revisionCount: reply.revision_count,
    likeCount: reply.like_count,
    liked: reply.viewer_liked,
  }
}

function mapTopicSupplement(supplement: TopicSupplementDto): TopicSupplement {
  return {
    id: supplement.id,
    topicId: supplement.topic_id,
    content: supplement.content,
    status: supplement.status,
    createdAt: formatRelativeTime(supplement.created_at),
    updatedAt: formatRelativeTime(supplement.updated_at),
    author: {
      id: supplement.author.id,
      username: supplement.author.username,
      displayName: supplement.author.display_name,
      avatarUrl: supplement.author.avatar_url,
    },
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
    && (value.meta.next_cursor === null || isUuid(value.meta.next_cursor) || (typeof value.meta.next_cursor === "string" && /^[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(value.meta.next_cursor)))
    && value.data.every(isTopicSummary)
}

function isTopicResponse(value: unknown): value is TopicResponseDto {
  return isRecord(value)
    && isRecord(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && isTopicDetail(value.data)
}

function isTopicEditResponse(value: unknown): value is TopicEditResponseDto {
  return isRecord(value)
    && isRecord(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && isTopicDetail(value.data.topic)
    && (value.data.disposition === "published" || value.data.disposition === "pending_review")
    && (value.data.review_id === null || isUuid(value.data.review_id))
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

function isReplyEditResponse(value: unknown): value is ReplyEditResponseDto {
  return isRecord(value)
    && isRecord(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && isTopicReply(value.data.reply)
    && (value.data.disposition === "published" || value.data.disposition === "pending_review")
    && (value.data.review_id === null || isUuid(value.data.review_id))
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
    && isSafePositiveInteger(value.floor_number)
    && isReplyReference(value.reply_to)
    && isUuid(value.author.id)
    && isNonEmptyString(value.author.username)
    && isNonEmptyString(value.author.display_name)
    && isNullableHttpsUrl(value.author.avatar_url)
    && isNonEmptyString(value.content)
    && isOptionalRichContent(value.rich_content)
    && typeof value.has_locked_content === "boolean"
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
    && isOptionalRichContent(value.rich_content)
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
    && isOptionalRichContent(value.rich_content)
    && isNonEmptyString(value.created_at)
}

function isTopicSupplement(value: unknown): value is TopicSupplementDto {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.topic_id)) {
    return false
  }
  if (!isSupplementStatus(value.status) || !isNonEmptyString(value.content)) return false
  if (!isNonEmptyString(value.created_at) || !isNonEmptyString(value.updated_at)) return false
  if (!isRecord(value.author)
    || !isUuid(value.author.id)
    || !isNonEmptyString(value.author.username)
    || !isNonEmptyString(value.author.display_name)
    || typeof value.author.avatar_url !== "string" && value.author.avatar_url !== null) {
    return false
  }
  return true
}

function isTopicSupplementList(value: unknown): value is TopicSupplementListDto {
  return isRecord(value)
    && Array.isArray(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && (value.meta.enabled === undefined || (
      typeof value.meta.enabled === "boolean"
      && isSafeNonNegativeInteger(value.meta.max_per_topic)
      && value.meta.max_per_topic <= 100
      && isSafeNonNegativeInteger(value.meta.used_count)
      && typeof value.meta.can_submit === "boolean"
    ))
    && value.data.every(isTopicSupplement)
}

function isTopicSupplementCreate(value: unknown): value is TopicSupplementCreateResponseDto {
  return isRecord(value)
    && isRecord(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && isTopicSupplement(value.data)
}

function isSupplementStatus(value: unknown): value is TopicSupplement["status"] {
  return value === "approved" || value === "hidden"
}

function isTopicDetail(value: unknown): value is TopicDetailDto {
  return isTopicSummary(value)
    && typeof (value as unknown as Record<string, unknown>).content === "string"
    && isOptionalRichContent((value as unknown as Record<string, unknown>).rich_content)
    && typeof (value as unknown as Record<string, unknown>).has_locked_content === "boolean"
    && isSafeNonNegativeInteger((value as unknown as Record<string, unknown>).content_revision)
}

function isReplyReference(value: unknown): value is ReplyReferenceDto | null {
  if (value === null) return true
  return isRecord(value)
    && isUuid(value.id)
    && isSafePositiveInteger(value.floor_number)
    && isRecord(value.author)
    && isUuid(value.author.id)
    && isNonEmptyString(value.author.username)
    && isNonEmptyString(value.author.display_name)
    && isNullableHttpsUrl(value.author.avatar_url)
    && (value.excerpt === null || typeof value.excerpt === "string")
    && typeof value.is_deleted === "boolean"
}

function isOptionalRichContent(value: unknown): boolean {
  return value === undefined || value === null || isRichTextDocument(value)
}

function readRichContent(value: unknown): RichTextDocument | null {
  return isRichTextDocument(value) ? value : null
}

function isTopicSummary(value: unknown): value is TopicSummaryDto {
  if (!isRecord(value) || !isRecord(value.author) || !isRecord(value.board)) {
    return false
  }
  return isUuid(value.id)
    && typeof value.title === "string"
    && typeof value.excerpt === "string"
    && (value.image_url === undefined || isNullableTopicImageUrl(value.image_url))
    && (value.image_urls === undefined || isTopicImageUrls(value.image_urls))
    && isUuid(value.author.id)
    && isNonEmptyString(value.author.username)
    && isNonEmptyString(value.author.display_name)
    && isNullableHttpsUrl(value.author.avatar_url)
    && isUuid(value.board.id)
    && typeof value.board.slug === "string"
    && boardSlugPattern.test(value.board.slug)
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

function isNullableTopicImageUrl(value: unknown): value is string | null {
  return isNullableHttpsUrl(value)
    || (isNonEmptyString(value)
      && attachmentThumbnailPattern.test(value))
}

function isTopicImageUrls(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 3
    && value.every((imageUrl) => isNullableTopicImageUrl(imageUrl) && imageUrl !== null)
}
