import type { UserSummary } from "./users"
import type { components } from "./generated"

const ENDPOINT = "/api/v1/notifications"
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type NotificationKind = components["schemas"]["NotificationKind"]
export type NotificationTarget = components["schemas"]["NotificationTarget"]

export interface Notification {
  id: string
  kind: NotificationKind
  actor: UserSummary | null
  target: NotificationTarget
  targetId: string
  readAt: string | null
  createdAt: string
}

export interface NotificationPage {
  notifications: Notification[]
  nextCursor: string | null
}

export class NotificationApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(status: number, code: string, message: string, fields: Record<string, string[]> = {}) {
    super(message)
    this.name = "NotificationApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function listNotifications(options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<NotificationPage> {
  const params = new URLSearchParams()
  if (options.cursor) params.set("cursor", options.cursor)
  params.set("limit", String(options.limit ?? 20))
  const response = await fetch(`${ENDPOINT}?${params.toString()}`, { headers: { Accept: "application/json" }, credentials: "include", signal: options.signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isPage(payload)) throw new Error("通知列表响应格式无效")
  return { notifications: payload.data.map(mapNotification), nextCursor: payload.meta.next_cursor }
}

export async function getUnreadNotificationCount(signal?: AbortSignal): Promise<number> {
  const response = await fetch(`${ENDPOINT}/unread-count`, { headers: { Accept: "application/json" }, credentials: "include", signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isCountEnvelope(payload)) throw new Error("未读通知响应格式无效")
  return payload.data.unread_count
}

export async function markNotificationRead(id: string, csrfToken: string, signal?: AbortSignal): Promise<Notification> {
  const response = await fetch(`${ENDPOINT}/${encodeURIComponent(id)}/read`, { method: "PATCH", headers: { Accept: "application/json", "x-csrf-token": csrfToken }, credentials: "include", signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isNotificationEnvelope(payload)) throw new Error("通知已读响应格式无效")
  return mapNotification(payload.data)
}

export async function markAllNotificationsRead(csrfToken: string, signal?: AbortSignal): Promise<number> {
  const response = await fetch(`${ENDPOINT}/read-all`, { method: "PATCH", headers: { Accept: "application/json", "x-csrf-token": csrfToken }, credentials: "include", signal })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isCountEnvelope(payload)) throw new Error("全部已读响应格式无效")
  return payload.data.unread_count
}

type UserSummaryDto = Required<components["schemas"]["UserSummary"]>
type NotificationDto = Omit<Required<components["schemas"]["Notification"]>, "actor"> & { actor: UserSummaryDto | null }
type NotificationPageDto = Omit<components["schemas"]["PageResponse_Notification"], "data" | "meta"> & {
  data: NotificationDto[]
  meta: Required<components["schemas"]["PageMeta"]>
}
type NotificationEnvelopeDto = Omit<components["schemas"]["ApiResponse_Notification"], "data"> & { data: NotificationDto }
type NotificationCountEnvelopeDto = components["schemas"]["ApiResponse_NotificationUnreadCount"]
type ErrorResponseDto = components["schemas"]["ErrorResponse"]

function mapNotification(value: NotificationDto): Notification {
  return { id: value.id, kind: value.kind, actor: value.actor && { id: value.actor.id, username: value.actor.username, displayName: value.actor.display_name, avatarUrl: value.actor.avatar_url }, target: value.target, targetId: value.target_id, readAt: value.read_at, createdAt: value.created_at }
}

function isPage(value: unknown): value is NotificationPageDto {
  return isRecord(value) && Array.isArray(value.data) && isRecord(value.meta) && isUuid(value.meta.request_id) && (value.meta.next_cursor === null || isUuid(value.meta.next_cursor)) && value.data.every(isNotification)
}
function isNotificationEnvelope(value: unknown): value is NotificationEnvelopeDto { return isRecord(value) && isRecord(value.data) && isUuid(value.meta?.request_id) && isNotification(value.data) }
function isCountEnvelope(value: unknown): value is NotificationCountEnvelopeDto { return isRecord(value) && isRecord(value.data) && isSafeInteger(value.data.unread_count) && isUuid(value.meta?.request_id) }
function isNotification(value: unknown): value is NotificationDto {
  return isRecord(value) && isUuid(value.id) && ["follow", "reply", "like", "message", "report"].includes(value.kind as string) && (value.actor === null || isUser(value.actor)) && ["user", "topic", "post", "conversation"].includes(value.target as string) && isUuid(value.target_id) && (value.read_at === null || typeof value.read_at === "string") && typeof value.created_at === "string"
}
function isUser(value: unknown): value is UserSummaryDto { return isRecord(value) && isUuid(value.id) && typeof value.username === "string" && typeof value.display_name === "string" && (value.avatar_url === null || typeof value.avatar_url === "string") }
function toApiError(status: number, payload: unknown): NotificationApiError { return isError(payload) ? new NotificationApiError(status, payload.error.code, payload.error.message, payload.error.fields) : new NotificationApiError(status, "response.invalid", "通知服务响应格式无效") }
async function readJson(response: Response): Promise<unknown> { try { return await response.json() as unknown } catch { return undefined } }
function isError(value: unknown): value is ErrorResponseDto { return isRecord(value) && isRecord(value.error) && isRecord(value.meta) && typeof value.error.code === "string" && typeof value.error.message === "string" && isUuid(value.meta.request_id) }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value) }
function isSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }
