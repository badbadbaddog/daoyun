import type { UserSummary } from "./users"
import type { components } from "./generated"

const CONVERSATIONS_ENDPOINT = "/api/v1/conversations"
const DEFAULT_LIMIT = 20
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ConversationLastMessage {
  id: string
  senderId: string
  content: string
  createdAt: string
}

export interface ConversationSummary {
  id: string
  otherUser: UserSummary
  lastMessage: ConversationLastMessage | null
  unreadCount: number
  updatedAt: string
}

export interface DirectMessage {
  id: string
  conversationId: string
  sender: UserSummary
  content: string
  createdAt: string
}

export interface ConversationPage {
  conversations: ConversationSummary[]
  nextCursor: string | null
}

export interface DirectMessagePage {
  messages: DirectMessage[]
  nextCursor: string | null
}

export interface ConversationReadState {
  conversationId: string
  lastReadMessageId: string
  unreadCount: number
}

interface PageOptions {
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

type UserSummaryDto = Required<components["schemas"]["UserSummary"]>
type ConversationLastMessageDto = Required<components["schemas"]["ConversationLastMessage"]>
type ConversationSummaryDto = Omit<Required<components["schemas"]["ConversationSummary"]>, "other_user" | "last_message"> & {
  other_user: UserSummaryDto
  last_message: ConversationLastMessageDto | null
}
type DirectMessageDto = Omit<components["schemas"]["DirectMessage"], "sender"> & { sender: UserSummaryDto }
type ConversationPageDto = Omit<components["schemas"]["PageResponse_ConversationSummary"], "data" | "meta"> & {
  data: ConversationSummaryDto[]
  meta: Required<components["schemas"]["PageMeta"]>
}
type DirectMessagePageDto = Omit<components["schemas"]["PageResponse_DirectMessage"], "data" | "meta"> & {
  data: DirectMessageDto[]
  meta: Required<components["schemas"]["PageMeta"]>
}
type ConversationEnvelopeDto = Omit<components["schemas"]["ApiResponse_ConversationSummary"], "data"> & { data: ConversationSummaryDto }
type DirectMessageEnvelopeDto = Omit<components["schemas"]["ApiResponse_DirectMessage"], "data"> & { data: DirectMessageDto }
type ConversationReadStateEnvelopeDto = components["schemas"]["ApiResponse_ConversationReadState"]
type BooleanEnvelopeDto = components["schemas"]["ApiResponse_bool"]
type ErrorResponseDto = components["schemas"]["ErrorResponse"]
type CreateConversationRequestDto = components["schemas"]["CreateConversationRequest"]
type SendDirectMessageRequestDto = components["schemas"]["SendDirectMessageRequest"]
type MarkConversationReadRequestDto = components["schemas"]["MarkConversationReadRequest"]
type MessageEnvelope = { data: unknown; meta: components["schemas"]["ResponseMeta"] }
type MessagePageEnvelope = { data: unknown[]; meta: Required<components["schemas"]["PageMeta"]> }

export class MessageApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>
  readonly retryAfter: number | null

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string[]> = {},
    retryAfter: number | null = null,
  ) {
    super(message)
    this.name = "MessageApiError"
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
  }
}

export async function createConversation(
  recipientId: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<ConversationSummary> {
  const body: CreateConversationRequestDto = { recipient_id: recipientId }
  const response = await fetch(CONVERSATIONS_ENDPOINT, {
    method: "POST",
    headers: jsonHeaders(csrfToken),
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response, payload)
  if (
    response.status !== 200
    || !isConversationEnvelope(payload)
    || !isSameUuid(payload.data.other_user.id, recipientId)
  ) {
    throw new Error("会话响应格式无效")
  }
  return mapConversation(payload.data)
}

export async function listConversations(options: PageOptions = {}): Promise<ConversationPage> {
  const params = pageParams(options)
  const response = await fetch(`${CONVERSATIONS_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response, payload)
  if (response.status !== 200 || !isConversationPageEnvelope(payload)) {
    throw new Error("会话列表响应格式无效")
  }
  return {
    conversations: payload.data.map(mapConversation),
    nextCursor: payload.meta.next_cursor,
  }
}

export async function listMessages(
  conversationId: string,
  options: PageOptions = {},
): Promise<DirectMessagePage> {
  const params = pageParams(options)
  const response = await fetch(
    `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
    {
      headers: { Accept: "application/json" },
      credentials: "include",
      signal: options.signal,
    },
  )
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response, payload)
  if (
    response.status !== 200
    || !isMessagePageEnvelope(payload)
    || payload.data.some((message) => !isSameUuid(message.conversation_id, conversationId))
  ) {
    throw new Error("消息列表响应格式无效")
  }
  return {
    messages: payload.data.map(mapMessage),
    nextCursor: payload.meta.next_cursor,
  }
}

export async function sendMessage(
  conversationId: string,
  content: string,
  csrfToken: string,
  idempotencyKey?: string,
  signal?: AbortSignal,
): Promise<DirectMessage> {
  const body: SendDirectMessageRequestDto = { content }
  const headers = jsonHeaders(csrfToken)
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey
  const response = await fetch(
    `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(body),
      signal,
    },
  )
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response, payload)
  if (
    response.status !== 201
    || !isMessageEnvelope(payload)
    || !isSameUuid(payload.data.conversation_id, conversationId)
  ) {
    throw new Error("消息响应格式无效")
  }
  return mapMessage(payload.data)
}

export async function markConversationRead(
  conversationId: string,
  lastReadMessageId: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<ConversationReadState> {
  const body: MarkConversationReadRequestDto = { last_read_message_id: lastReadMessageId }
  const response = await fetch(
    `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(conversationId)}/read`,
    {
      method: "PATCH",
      headers: jsonHeaders(csrfToken),
      credentials: "include",
      body: JSON.stringify(body),
      signal,
    },
  )
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response, payload)
  if (
    response.status !== 200
    || !isReadStateEnvelope(payload)
    || !isSameUuid(payload.data.conversation_id, conversationId)
  ) {
    throw new Error("已读状态响应格式无效")
  }
  return {
    conversationId: payload.data.conversation_id,
    lastReadMessageId: payload.data.last_read_message_id,
    unreadCount: payload.data.unread_count,
  }
}

export async function archiveConversation(
  conversationId: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await fetch(
    `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(conversationId)}`,
    {
      method: "DELETE",
      headers: { Accept: "application/json", "x-csrf-token": csrfToken },
      credentials: "include",
      signal,
    },
  )
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response, payload)
  if (response.status !== 200 || !isBooleanEnvelope(payload) || payload.data !== true) {
    throw new Error("归档响应格式无效")
  }
  return true
}

function pageParams(options: PageOptions): URLSearchParams {
  const params = new URLSearchParams()
  if (options.cursor) params.set("cursor", options.cursor)
  params.set("limit", String(options.limit ?? DEFAULT_LIMIT))
  return params
}

function jsonHeaders(csrfToken: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-csrf-token": csrfToken,
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

function toApiError(response: Response, payload: unknown): MessageApiError {
  const retryAfterValue = Number.parseInt(response.headers.get("retry-after") ?? "", 10)
  const retryAfter = Number.isSafeInteger(retryAfterValue) && retryAfterValue > 0
    ? retryAfterValue
    : null
  if (!isErrorResponse(payload)) {
    return new MessageApiError(
      response.status,
      "response.invalid",
      "私信服务响应格式无效",
      {},
      retryAfter,
    )
  }
  return new MessageApiError(
    response.status,
    payload.error.code,
    payload.error.message,
    payload.error.fields,
    retryAfter,
  )
}

function mapUser(value: UserSummaryDto): UserSummary {
  return {
    id: value.id,
    username: value.username,
    displayName: value.display_name,
    avatarUrl: value.avatar_url,
  }
}

function mapConversation(value: ConversationSummaryDto): ConversationSummary {
  return {
    id: value.id,
    otherUser: mapUser(value.other_user),
    lastMessage: value.last_message && {
      id: value.last_message.id,
      senderId: value.last_message.sender_id,
      content: value.last_message.content,
      createdAt: value.last_message.created_at,
    },
    unreadCount: value.unread_count,
    updatedAt: value.updated_at,
  }
}

function mapMessage(value: DirectMessageDto): DirectMessage {
  return {
    id: value.id,
    conversationId: value.conversation_id,
    sender: mapUser(value.sender),
    content: value.content,
    createdAt: value.created_at,
  }
}

function isConversationEnvelope(value: unknown): value is ConversationEnvelopeDto {
  return isEnvelope(value) && isConversation(value.data)
}

function isConversationPageEnvelope(value: unknown): value is ConversationPageDto {
  return isPageEnvelope(value) && value.data.every(isConversation)
}

function isMessageEnvelope(value: unknown): value is DirectMessageEnvelopeDto {
  return isEnvelope(value) && isMessage(value.data)
}

function isMessagePageEnvelope(value: unknown): value is DirectMessagePageDto {
  return isPageEnvelope(value) && value.data.every(isMessage)
}

function isReadStateEnvelope(value: unknown): value is ConversationReadStateEnvelopeDto {
  return isEnvelope(value)
    && isRecord(value.data)
    && isUuid(value.data.conversation_id)
    && isUuid(value.data.last_read_message_id)
    && isSafeNonNegativeInteger(value.data.unread_count)
}

function isBooleanEnvelope(value: unknown): value is BooleanEnvelopeDto {
  return isRecord(value)
    && typeof value.data === "boolean"
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
}

function isEnvelope(value: unknown): value is MessageEnvelope {
  return isRecord(value) && isRecord(value.meta) && isUuid(value.meta.request_id)
}

function isPageEnvelope(value: unknown): value is MessagePageEnvelope {
  return isEnvelope(value)
    && Array.isArray(value.data)
    && "next_cursor" in value.meta
    && (value.meta.next_cursor === null || isUuid(value.meta.next_cursor))
}

function isConversation(value: unknown): value is ConversationSummaryDto {
  return isRecord(value)
    && isUuid(value.id)
    && isUser(value.other_user)
    && (value.last_message === null || isLastMessage(value.last_message))
    && isSafeNonNegativeInteger(value.unread_count)
    && isTimestamp(value.updated_at)
}

function isLastMessage(value: unknown): boolean {
  return isRecord(value)
    && isUuid(value.id)
    && isUuid(value.sender_id)
    && typeof value.content === "string"
    && isTimestamp(value.created_at)
}

function isMessage(value: unknown): value is DirectMessageDto {
  return isRecord(value)
    && isUuid(value.id)
    && isUuid(value.conversation_id)
    && isUser(value.sender)
    && typeof value.content === "string"
    && isTimestamp(value.created_at)
}

function isUser(value: unknown): value is UserSummaryDto {
  return isRecord(value)
    && isUuid(value.id)
    && isNonEmptyString(value.username)
    && isNonEmptyString(value.display_name)
    && (value.avatar_url === null || isNonEmptyString(value.avatar_url))
}

function isErrorResponse(value: unknown): value is ErrorResponseDto {
  return isRecord(value)
    && isRecord(value.error)
    && isRecord(value.meta)
    && isNonEmptyString(value.error.code)
    && isNonEmptyString(value.error.message)
    && isUuid(value.meta.request_id)
    && (value.error.fields === undefined || isFieldErrors(value.error.fields))
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every((messages) => (
    Array.isArray(messages) && messages.length > 0 && messages.every(isNonEmptyString)
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}

function isSameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
