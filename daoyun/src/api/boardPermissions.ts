import { AdminApiError } from "./admin"
import type { components } from "./generated"

export type BoardPermissionMatrix = components["schemas"]["BoardPermissionMatrix"]
export type PermissionMatrixScenario = components["schemas"]["PermissionMatrixScenario"]
export type PermissionMatrixAction = components["schemas"]["PermissionMatrixAction"]
export type PermissionMatrixDecision = components["schemas"]["PermissionMatrixDecision"]
const actions = ["browse", "topic_create", "reply_create", "attachment_upload", "attachment_download", "moderation_browse", "topic_pin", "topic_feature", "topic_lock", "topic_move"]
const governanceActions = ["moderation_browse", "topic_pin", "topic_feature", "topic_lock", "topic_move"]
const decisions = ["allowed", "denied", "provided", "not_provided", "missing_context", "not_applicable"]
const quotaKeys = ["topic.create.daily", "reply.create.daily", "message.send.daily", "attachment.upload.daily", "attachment.file.bytes", "attachment.storage.bytes", "attachment.download.bytes.daily", "content.external_link.daily"]
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === "string" && uuid.test(v)
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v))
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => typeof item === "string")
const quotaMap = (v: unknown): v is Record<string, number> => object(v) && Object.entries(v).every(([key, value]) => quotaKeys.includes(key) && integer(value))

function isMatrix(v: unknown): boolean {
  if (!object(v) || !id(v.board_id) || !["public", "hidden"].includes(String(v.visibility)) || !date(v.evaluated_at)
    || !(v.policy_revision === null || integer(v.policy_revision)) || !Array.isArray(v.scenarios) || v.scenarios.length > 5) return false
  return v.scenarios.every(s => isScenario(s, 10))
}

function isScenario(s: unknown, actionCount: number): boolean {
  if (!object(s) || !id(s.id) || !["group", "user"].includes(String(s.kind)) || typeof s.display_name !== "string"
    || s.complete !== (s.kind === "user") || (s.kind === "user" ? !["active", "restricted", "suspended"].includes(String(s.account_status)) : s.account_status !== null)
    || !Array.isArray(s.sources) || s.sources.length > 128 || !Array.isArray(s.actions) || s.actions.length !== actionCount || !Array.isArray(s.quotas) || s.quotas.length !== 8) return false
  if (!s.sources.every(source => {
    if (!object(source) || !id(source.id) || typeof source.key !== "string" || typeof source.display_name !== "string"
      || !strings(source.permission_keys) || !quotaMap(source.quotas)
      || !(source.starts_at === null || date(source.starts_at)) || !(source.ends_at === null || date(source.ends_at))) return false
    if (source.kind === "group") return source.role === null && source.type_version === null && ["base", "additional"].includes(String(source.membership_kind))
    if (source.kind === "entitlement") return source.role === null && source.membership_kind === null && integer(source.type_version) && Number(source.type_version) > 0
    const role = source.role
    return source.kind === "role" && source.type_version === null && source.membership_kind === null && source.ends_at === null && Object.keys(source.quotas).length === 0
      && object(role) && id(role.id) && integer(role.revision) && Number(role.revision) > 0 && ["instance", "site", "board"].includes(String(role.scope))
      && ["exact", "subtree"].includes(String(role.scope_mode)) && (role.scope === "board" ? id(role.scope_id) : role.scope_id === null && role.scope_mode === "exact")
      && (role.target_scope_matches === null || typeof role.target_scope_matches === "boolean")
      && typeof role.scope_matches === "boolean" && typeof role.is_system === "boolean" && id(role.assigned_by)
  })) return false
  const sources = new Map(s.sources.map(source => [(source as Record<string, unknown>).id, source as Record<string, unknown>]))
  if (sources.size !== s.sources.length) return false
  const sourceList = (value: unknown, governance: boolean) => Array.isArray(value) && new Set(value).size === value.length
    && value.every(value => id(value) && sources.has(value) && (governance ? sources.get(value)!.kind === "role" : sources.get(value)!.kind !== "role"))
  return new Set(s.actions.map(action => object(action) ? action.action : null)).size === actionCount
    && s.actions.every(a => object(a) && actions.includes(String(a.action)) && decisions.includes(String(a.decision)) && typeof a.reason === "string"
      && typeof a.permission_provided === "boolean" && sourceList(a.source_ids, governanceActions.includes(String(a.action))))
    && new Set(s.quotas.map(q => object(q) ? q.key : null)).size === 8
    && s.quotas.every(q => object(q) && quotaKeys.includes(String(q.key)) && integer(q.limit) && (q.used === null || integer(q.used)) && sourceList(q.source_ids, false))
}

export async function getBoardPermissionMatrix(boardId: string, groupIds: string[], userId?: string, signal?: AbortSignal): Promise<BoardPermissionMatrix> {
  if (!id(boardId) || groupIds.length > 4 || groupIds.some(value => !id(value)) || new Set(groupIds).size !== groupIds.length
    || (userId !== undefined && !id(userId)) || (groupIds.length === 0 && !userId)) throw new AdminApiError(422, "validation.failed", "请选择最多四个不同用户组或一个具体用户")
  boardId = boardId.toLowerCase(); groupIds = groupIds.map(value => value.toLowerCase()); userId = userId?.toLowerCase()
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
  target_board_id?: string
}
export async function getPermissionCheck(input: PermissionCheckInput, signal?: AbortSignal): Promise<PermissionCheck> {
  if (!id(input.board_id) || !id(input.user_id) || !actions.includes(input.action)
    || (input.topic_id !== undefined && (!id(input.topic_id) || input.action === "topic_create"))
    || (input.target_board_id !== undefined && (!id(input.target_board_id) || input.action !== "topic_move"))
    || (input.attachment_id !== undefined && (!id(input.attachment_id) || input.action !== "attachment_download"))
    || (input.file_bytes !== undefined && (!integer(input.file_bytes) || input.file_bytes === 0 || input.file_bytes > 50 * 1024 * 1024 || input.action !== "attachment_upload")))
    throw new AdminApiError(422, "validation.failed", "检查条件不正确，请检查用户、版块和文件大小。")
  input = { ...input, board_id: input.board_id.toLowerCase(), user_id: input.user_id.toLowerCase(),
    topic_id: input.topic_id?.toLowerCase(), attachment_id: input.attachment_id?.toLowerCase(), target_board_id: input.target_board_id?.toLowerCase() }
  const params = new URLSearchParams({ board_id: input.board_id, user_id: input.user_id, action: input.action })
  if (input.topic_id) params.set("topic_id", input.topic_id)
  if (input.attachment_id) params.set("attachment_id", input.attachment_id)
  if (input.target_board_id) params.set("target_board_id", input.target_board_id)
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
    || data.target_board_id !== (input.target_board_id ?? null) || !(data.policy_revision === null || integer(data.policy_revision))
    || !(data.topic_revision === null || integer(data.topic_revision) && Number(data.topic_revision) > 0)
    || data.file_bytes !== (input.file_bytes ?? null) || !date(data.evaluated_at) || !isScenario(data.scenario, 1)
    || !object(data.scenario) || data.scenario.id !== input.user_id || data.scenario.kind !== "user" || data.scenario.complete !== true
    || !Array.isArray(data.scenario.actions) || !object(data.scenario.actions[0]) || data.scenario.actions[0].action !== input.action)
    throw new AdminApiError(response.status, "response.invalid", "权限检查响应对象或格式不一致")
  return data as PermissionCheck
}
