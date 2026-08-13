import type { components } from "./generated"

export type ReportTargetType = components["schemas"]["ReportTargetType"]
export type ReportReason = components["schemas"]["ReportReason"]
export type ReportStatus = components["schemas"]["ReportStatus"]
export type ReportResolution = components["schemas"]["ReportResolution"]

export interface ReportUser {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
}

export interface ContentReport {
  id: string
  targetType: ReportTargetType
  targetId: string
  targetTopicId: string | null
  targetTitle: string | null
  targetAuthor: ReportUser | null
  reporter: ReportUser
  reason: ReportReason
  details: string | null
  status: ReportStatus
  resolution: ReportResolution
  resolutionNote: string | null
  reviewer: ReportUser | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  revision: number
}

export type ReportDisposition = "resolved" | "dismissed"
export type ReportContentAction = "none" | "hide"
export type ReportUserActionKind = "restricted" | "suspended"

export interface ReportContextItem {
  id: string
  author: ReportUser | null
  content: string
  status: string
  isTarget: boolean
  createdAt: string
}

export interface ReportDetail {
  report: ContentReport
  context: { topicId: string; title: string; items: ReportContextItem[] }
  author: { user: ReportUser; status: "active" | "restricted" | "suspended"; reportCount: number; revision: number } | null
  relatedReports: Array<{ id: string; reason: ReportReason; status: ReportStatus; resolution: ReportResolution; createdAt: string; resolvedAt: string | null }>
  handlingHistory: Array<{ id: string; action: string; actor: ReportUser; createdAt: string }>
}

export interface ReportModerationInput {
  disposition: ReportDisposition
  contentAction: ReportContentAction
  userAction: { kind: ReportUserActionKind; reason: string; expiresAt: string | null } | null
  publicReason: string | null
  note: string
  expectedRevision: number
}

export interface ReportModerationResult {
  report: ContentReport
  content: { action: ReportContentAction; targetId: string; changed: boolean }
  user: { userId: string; status: "restricted" | "suspended"; reason: string; expiresAt: string | null; revision: number } | null
  auditId: string
  notificationQueued: boolean
}

export interface ReportReceipt {
  id: string
  created: boolean
}

export interface ListAdminReportsOptions {
  status?: ReportStatus
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface ReportPage {
  reports: ContentReport[]
  nextCursor: string | null
}

export interface UpdateReportInput {
  status: ReportStatus
  resolution: ReportResolution
  note?: string | null
  expectedRevision: number
}

export interface BatchReportResult {
  updated: number
  reportIds: string[]
}

export type BatchUpdateReportInput = Omit<UpdateReportInput, "expectedRevision">

type Envelope<T> = { data: T; meta: components["schemas"]["ResponseMeta"] }
type ErrorDto = components["schemas"]["ErrorResponse"]
type UserDto = Required<components["schemas"]["UserSummary"]>
type ReportDto = components["schemas"]["ContentReport"] & {
  target_topic_id: string | null
  target_title: string | null
  target_author: UserDto | null
  reporter: UserDto
  details: string | null
  resolution_note: string | null
  reviewer: UserDto | null
  resolved_at: string | null
  revision: number
}
type ReportPageEnvelopeDto = Omit<components["schemas"]["PageResponse_ContentReport"], "data" | "meta"> & {
  data: ReportDto[]
  meta: components["schemas"]["PageMeta"]
}
type ReportReceiptDto = components["schemas"]["ContentReportReceipt"]
type BatchReportResultDto = components["schemas"]["BatchReportResult"]
type CreateReportRequestDto = components["schemas"]["CreateReportRequest"]
type UpdateReportRequestDto = { status: ReportStatus; resolution: ReportResolution; note: string | null; expected_revision: number }
type BatchUpdateReportsRequestDto = components["schemas"]["BatchUpdateReportsRequest"]

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const targetTypes = new Set<ReportTargetType>(["topic", "post"])
const reasons = new Set<ReportReason>(["spam", "harassment", "illegal", "copyright", "other"])
const statuses = new Set<ReportStatus>(["open", "in_review", "resolved", "dismissed"])
const resolutions = new Set<ReportResolution>(["none", "hide_topic", "hide_post", "suspend_author", "dismiss"])

export class ReportApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(status: number, code: string, message: string, fields: Record<string, string[]> = {}) {
    super(message)
    this.name = "ReportApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function createReport(
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  details: string | null,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<ReportReceipt> {
  const body: CreateReportRequestDto = { target_type: targetType, target_id: targetId, reason, details }
  const response = await fetch("/api/v1/reports", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  })
  return parseResponse(response, isReceipt)
}

export async function listAdminReports(options: ListAdminReportsOptions = {}): Promise<ReportPage> {
  const params = new URLSearchParams()
  if (options.status) params.set("status", options.status)
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const query = params.toString()
  return listReportsAtPath(`/api/v1/admin/reports${query ? `?${query}` : ""}`, options.signal)
}

export async function listAdminUserReports(userId: string, cursor?: string, signal?: AbortSignal): Promise<ReportPage> {
  const params = new URLSearchParams({ limit: "20" })
  if (cursor) params.set("cursor", cursor)
  return listReportsAtPath(`/api/v1/admin/users/${userId}/reports?${params}`, signal)
}

export async function getAdminReport(reportId: string, signal?: AbortSignal): Promise<ReportDetail> {
  const response = await fetch(`/api/v1/admin/reports/${reportId}`, {
    headers: { Accept: "application/json" }, credentials: "include", signal,
  })
  return parseResponse(response, isReportDetailDto).then(mapReportDetail)
}

export async function moderateAdminReport(
  reportId: string,
  input: ReportModerationInput,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<ReportModerationResult> {
  const response = await fetch(`/api/v1/admin/reports/${reportId}/moderations`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify({
      disposition: input.disposition,
      content_action: input.contentAction,
      user_action: input.userAction ? { kind: input.userAction.kind, reason: input.userAction.reason, expires_at: input.userAction.expiresAt } : null,
      public_reason: input.publicReason,
      note: input.note,
      expected_revision: input.expectedRevision,
    }),
    signal,
  })
  return parseResponse(response, isModerationResultDto).then(mapModerationResult)
}

async function listReportsAtPath(path: string, signal?: AbortSignal): Promise<ReportPage> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" }, credentials: "include", signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isReportPageEnvelope(payload)) {
    throw new ReportApiError(response.status, "response.invalid", "举报服务响应格式无效")
  }
  return { reports: payload.data.map(mapReport), nextCursor: payload.meta.next_cursor ?? null }
}

export async function updateAdminReport(
  reportId: string,
  input: UpdateReportInput,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<ContentReport> {
  const body: UpdateReportRequestDto = { status: input.status, resolution: input.resolution, note: input.note ?? null, expected_revision: input.expectedRevision }
  const response = await fetch(`/api/v1/admin/reports/${reportId}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  })
  return parseResponse(response, isReportDto).then(mapReport)
}

export async function updateAdminReportsBatch(
  reportIds: string[],
  input: BatchUpdateReportInput,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<BatchReportResult> {
  const body: BatchUpdateReportsRequestDto = { report_ids: reportIds, status: input.status, resolution: input.resolution, note: input.note ?? null }
  const response = await fetch("/api/v1/admin/reports/batch", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  })
  return parseResponse(response, isBatchResult).then((value) => ({ updated: value.updated, reportIds: value.report_ids }))
}

async function parseResponse<T>(response: Response, guard: (value: unknown) => value is T): Promise<T> {
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isEnvelope(payload) || !guard(payload.data)) throw new ReportApiError(response.status, "response.invalid", "举报服务响应格式无效")
  return payload.data
}

function mapReport(value: ReportDto): ContentReport {
  return {
    id: value.id,
    targetType: value.target_type,
    targetId: value.target_id,
    targetTopicId: value.target_topic_id,
    targetTitle: value.target_title,
    targetAuthor: value.target_author ? mapUser(value.target_author) : null,
    reporter: mapUser(value.reporter),
    reason: value.reason,
    details: value.details,
    status: value.status,
    resolution: value.resolution,
    resolutionNote: value.resolution_note,
    reviewer: value.reviewer ? mapUser(value.reviewer) : null,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    resolvedAt: value.resolved_at,
    revision: value.revision,
  }
}

function mapReportDetail(value: any): ReportDetail {
  return {
    report: mapReport(value.report),
    context: {
      topicId: value.context.topic_id,
      title: value.context.title,
      items: value.context.items.map((item: any) => ({
        id: item.id,
        author: item.author ? mapUser(item.author) : null,
        content: item.content,
        status: item.status,
        isTarget: item.is_target,
        createdAt: item.created_at,
      })),
    },
    author: value.author ? {
      user: mapUser(value.author.user),
      status: value.author.status,
      reportCount: value.author.report_count,
      revision: value.author.revision,
    } : null,
    relatedReports: value.related_reports.map((item: any) => ({
      id: item.id, reason: item.reason, status: item.status, resolution: item.resolution,
      createdAt: item.created_at, resolvedAt: item.resolved_at,
    })),
    handlingHistory: value.handling_history.map((item: any) => ({
      id: item.id, action: item.action, actor: mapUser(item.actor), createdAt: item.created_at,
    })),
  }
}

function mapModerationResult(value: any): ReportModerationResult {
  return {
    report: mapReport(value.report),
    content: { action: value.content.action, targetId: value.content.target_id, changed: value.content.changed },
    user: value.user ? {
      userId: value.user.user_id,
      status: value.user.status,
      reason: value.user.reason,
      expiresAt: value.user.expires_at,
      revision: value.user.revision,
    } : null,
    auditId: value.audit_id,
    notificationQueued: value.notification_queued,
  }
}

function mapUser(value: UserDto): ReportUser {
  return { id: value.id, username: value.username, displayName: value.display_name, avatarUrl: value.avatar_url }
}

function isReceipt(value: unknown): value is ReportReceiptDto {
  return isRecord(value) && isUuid(value.id) && typeof value.created === "boolean"
}

function isBatchResult(value: unknown): value is BatchReportResultDto {
  return isRecord(value)
    && typeof value.updated === "number"
    && Number.isInteger(value.updated)
    && value.updated >= 0
    && Array.isArray(value.report_ids)
    && value.report_ids.every(isUuid)
}

function isReportDto(value: unknown): value is ReportDto {
  return isRecord(value)
    && isUuid(value.id)
    && targetTypes.has(value.target_type as ReportTargetType)
    && isUuid(value.target_id)
    && (value.target_topic_id === null || isUuid(value.target_topic_id))
    && (value.target_title === null || typeof value.target_title === "string")
    && (value.target_author === null || isUserDto(value.target_author))
    && isUserDto(value.reporter)
    && reasons.has(value.reason as ReportReason)
    && (value.details === null || typeof value.details === "string")
    && statuses.has(value.status as ReportStatus)
    && resolutions.has(value.resolution as ReportResolution)
    && (value.resolution_note === null || typeof value.resolution_note === "string")
    && (value.reviewer === null || isUserDto(value.reviewer))
    && typeof value.created_at === "string"
    && typeof value.updated_at === "string"
    && (value.resolved_at === null || typeof value.resolved_at === "string")
    && typeof value.revision === "number"
    && Number.isInteger(value.revision)
    && value.revision >= 1
}

function isReportDetailDto(value: unknown): value is any {
  return isRecord(value)
    && isReportDto(value.report)
    && isRecord(value.context)
    && isUuid(value.context.topic_id)
    && typeof value.context.title === "string"
    && Array.isArray(value.context.items)
    && value.context.items.length <= 5
    && value.context.items.every(isContextItemDto)
    && (value.author === null || isAuthorContextDto(value.author))
    && Array.isArray(value.related_reports)
    && value.related_reports.every(isHistoryItemDto)
    && Array.isArray(value.handling_history)
    && value.handling_history.every(isHandlingRecordDto)
}

function isContextItemDto(value: unknown): boolean {
  return isRecord(value) && isUuid(value.id) && (value.author === null || isUserDto(value.author))
    && typeof value.content === "string" && value.content.length <= 2000
    && typeof value.status === "string" && typeof value.is_target === "boolean"
    && typeof value.created_at === "string"
}

function isAuthorContextDto(value: unknown): boolean {
  return isRecord(value) && isUserDto(value.user)
    && ["active", "restricted", "suspended"].includes(value.status)
    && Number.isInteger(value.report_count) && value.report_count >= 0
    && Number.isInteger(value.revision) && value.revision >= 1
}

function isHistoryItemDto(value: unknown): boolean {
  return isRecord(value) && isUuid(value.id) && reasons.has(value.reason as ReportReason)
    && statuses.has(value.status as ReportStatus) && resolutions.has(value.resolution as ReportResolution)
    && typeof value.created_at === "string"
    && (value.resolved_at === null || typeof value.resolved_at === "string")
}

function isHandlingRecordDto(value: unknown): boolean {
  return isRecord(value) && isUuid(value.id) && typeof value.action === "string"
    && isUserDto(value.actor) && typeof value.created_at === "string"
}

function isModerationResultDto(value: unknown): value is any {
  return isRecord(value) && isReportDto(value.report)
    && isRecord(value.content) && ["none", "hide"].includes(value.content.action)
    && isUuid(value.content.target_id) && typeof value.content.changed === "boolean"
    && (value.user === null || (
      isRecord(value.user) && isUuid(value.user.user_id)
      && ["restricted", "suspended"].includes(value.user.status)
      && typeof value.user.reason === "string"
      && (value.user.expires_at === null || typeof value.user.expires_at === "string")
      && Number.isInteger(value.user.revision) && value.user.revision >= 1
    ))
    && isUuid(value.audit_id) && typeof value.notification_queued === "boolean"
}

function isUserDto(value: unknown): value is UserDto {
  return isRecord(value) && isUuid(value.id) && typeof value.username === "string" && typeof value.display_name === "string" && (value.avatar_url === null || typeof value.avatar_url === "string")
}

function isReportPageEnvelope(value: unknown): value is ReportPageEnvelopeDto {
  return isEnvelope(value) && Array.isArray(value.data) && value.data.every(isReportDto)
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return isRecord(value) && "data" in value && isRecord(value.meta) && isUuid(value.meta.request_id) && (value.meta.next_cursor === undefined || value.meta.next_cursor === null || isUuid(value.meta.next_cursor))
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value) }
function isError(value: unknown): value is ErrorDto { return isRecord(value) && isRecord(value.error) && isRecord(value.meta) && isUuid(value.meta.request_id) && typeof value.error.code === "string" && typeof value.error.message === "string" && (value.error.fields === undefined || isFields(value.error.fields)) }
function isFields(value: unknown): value is Record<string, string[]> { return isRecord(value) && Object.values(value).every((messages) => Array.isArray(messages) && messages.length > 0 && messages.every((message) => typeof message === "string" && message.trim().length > 0)) }
function toApiError(status: number, payload: unknown): ReportApiError { return isError(payload) ? new ReportApiError(status, payload.error.code, payload.error.message, payload.error.fields ?? {}) : new ReportApiError(status, "response.invalid", "举报服务响应格式无效") }
async function readJson(response: Response): Promise<unknown> { try { return await response.json() as unknown } catch { return undefined } }
