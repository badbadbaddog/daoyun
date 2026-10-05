import { AdminApiError } from "./admin"
import type { components } from "./generated"

export type BoardPermissionMatrix = components["schemas"]["BoardPermissionMatrix"]
export type PermissionMatrixScenario = components["schemas"]["PermissionMatrixScenario"]
export type PermissionMatrixAction = components["schemas"]["PermissionMatrixAction"]
export type PermissionMatrixDecision = components["schemas"]["PermissionMatrixDecision"]
const actions = ["browse", "topic_create", "reply_create", "attachment_upload", "attachment_download"]
const decisions = ["allowed", "denied", "provided", "not_provided", "missing_context", "not_applicable"]
const quotaKeys = ["topic.create.daily", "reply.create.daily", "message.send.daily", "attachment.upload.daily", "attachment.file.bytes", "attachment.storage.bytes", "attachment.download.bytes.daily", "content.external_link.daily"]
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === "string" && uuid.test(v)
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v))
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => typeof item === "string")
const quotaMap = (v: unknown) => object(v) && Object.entries(v).every(([key, value]) => quotaKeys.includes(key) && integer(value))

function isMatrix(v: unknown): boolean {
  if (!object(v) || !id(v.board_id) || !["public", "hidden"].includes(String(v.visibility)) || !date(v.evaluated_at)
    || !(v.policy_revision === null || integer(v.policy_revision)) || !Array.isArray(v.scenarios) || v.scenarios.length > 5) return false
  return v.scenarios.every(s => isScenario(s, 5))
}

function isScenario(s: unknown, actionCount: number): boolean {
    if (!object(s) || !id(s.id) || !["group", "user"].includes(String(s.kind)) || typeof s.display_name !== "string" || typeof s.complete !== "boolean"
      || !Array.isArray(s.sources) || s.sources.length > 128 || !Array.isArray(s.actions) || s.actions.length !== actionCount || !Array.isArray(s.quotas) || s.quotas.length !== 8) return false
    if (!s.sources.every(source => object(source) && id(source.id) && ["group", "entitlement"].includes(String(source.kind)) && typeof source.key === "string"
      && typeof source.display_name === "string" && strings(source.permission_keys) && quotaMap(source.quotas)
      && (source.type_version === null || integer(source.type_version)) && (source.starts_at === null || date(source.starts_at)) && (source.ends_at === null || date(source.ends_at)))) return false
    const sourceIds = new Set(s.sources.map(source => (source as Record<string, unknown>).id))
    const sourceList = (value: unknown) => Array.isArray(value) && value.every(value => id(value) && sourceIds.has(value))
    return new Set(s.actions.map(action => object(action) ? action.action : null)).size === actionCount
      && s.actions.every(a => object(a) && actions.includes(String(a.action)) && decisions.includes(String(a.decision)) && typeof a.reason === "string"
        && typeof a.permission_provided === "boolean" && sourceList(a.source_ids))
      && new Set(s.quotas.map(q => object(q) ? q.key : null)).size === 8
      && s.quotas.every(q => object(q) && quotaKeys.includes(String(q.key)) && integer(q.limit) && (q.used === null || integer(q.used)) && sourceList(q.source_ids))
}

export async function getBoardPermissionMatrix(boardId: string, groupIds: string[], userId?: string, signal?: AbortSignal): Promise<BoardPermissionMatrix> {
  if (!id(boardId) || groupIds.length > 4 || groupIds.some(value => !id(value)) || new Set(groupIds).size !== groupIds.length
    || (userId !== undefined && !id(userId)) || (groupIds.length === 0 && !userId)) throw new AdminApiError(422, "validation.failed", "请选择最多四个不同用户组或一个具体用户")
  const params = new URLSearchParams()
  if (groupIds.length) params.set("group_ids", groupIds.join(","))
  if (userId) params.set("user_id", userId)
  const response = await fetch("/api/v1/admin/boards/" + boardId + "/permission-matrix?" + params, { credentials: "include", headers: { Accept: "application/json" }, signal })
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = object(payload) && object(payload.error) ? payload.error : null
    throw new AdminApiError(response.status, typeof error?.code === "string" ? error.code : "request.failed", typeof error?.message === "string" ? error.message : "权限检查失败，请重试。")
  }
  if (!object(payload) || !object(payload.meta) || typeof payload.meta.request_id !== "string" || response.headers.get("x-request-id") !== payload.meta.request_id
    || !isMatrix(payload.data)) throw new AdminApiError(response.status, "response.invalid", "权限检查响应格式无效")
  const data = payload.data as BoardPermissionMatrix
  const expected = [...groupIds.map(id => "group:" + id), ...(userId ? ["user:" + userId] : [])]
  if (data.board_id !== boardId || data.scenarios.length !== expected.length || data.scenarios.some((s, index) => s.kind + ":" + s.id !== expected[index]))
    throw new AdminApiError(response.status, "response.invalid", "权限检查响应对象不一致")
  return data
}

export type PermissionCheck = components["schemas"]["PermissionCheck"]
export interface PermissionCheckInput {
  board_id: string
  user_id: string
  action: PermissionMatrixAction
  topic_id?: string
  attachment_id?: string
  file_bytes?: number
}
export async function getPermissionCheck(input: PermissionCheckInput, signal?: AbortSignal): Promise<PermissionCheck> {
  if (!id(input.board_id) || !id(input.user_id) || !actions.includes(input.action)
    || (input.topic_id !== undefined && (!id(input.topic_id) || input.action === "topic_create"))
    || (input.attachment_id !== undefined && (!id(input.attachment_id) || input.action !== "attachment_download"))
    || (input.file_bytes !== undefined && (!integer(input.file_bytes) || input.file_bytes === 0 || input.file_bytes > 50 * 1024 * 1024 || input.action !== "attachment_upload")))
    throw new AdminApiError(422, "validation.failed", "检查条件不正确，请检查用户、版块和文件大小。")
  input = { ...input, board_id: input.board_id.toLowerCase(), user_id: input.user_id.toLowerCase(),
    topic_id: input.topic_id?.toLowerCase(), attachment_id: input.attachment_id?.toLowerCase() }
  const params = new URLSearchParams({ board_id: input.board_id, user_id: input.user_id, action: input.action })
  if (input.topic_id) params.set("topic_id", input.topic_id)
  if (input.attachment_id) params.set("attachment_id", input.attachment_id)
  if (input.file_bytes !== undefined) params.set("file_bytes", String(input.file_bytes))
  const response = await fetch("/api/v1/admin/permission-check?" + params, { credentials: "include", headers: { Accept: "application/json" }, signal })
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = object(payload) && object(payload.error) ? payload.error : null
    throw new AdminApiError(response.status, typeof error?.code === "string" ? error.code : "request.failed", typeof error?.message === "string" ? error.message : "权限检查失败，请重试。")
  }
  const data = object(payload) && object(payload.data) ? payload.data : null
  if (!object(payload) || !object(payload.meta) || typeof payload.meta.request_id !== "string" || response.headers.get("x-request-id") !== payload.meta.request_id
    || !data || data.board_id !== input.board_id || data.topic_id !== (input.topic_id ?? null) || data.attachment_id !== (input.attachment_id ?? null)
    || data.file_bytes !== (input.file_bytes ?? null) || !date(data.evaluated_at) || !isScenario(data.scenario, 1)
    || !object(data.scenario) || data.scenario.id !== input.user_id || data.scenario.kind !== "user" || data.scenario.complete !== true
    || !Array.isArray(data.scenario.actions) || !object(data.scenario.actions[0]) || data.scenario.actions[0].action !== input.action)
    throw new AdminApiError(response.status, "response.invalid", "权限检查响应对象或格式不一致")
  return data as PermissionCheck
}
