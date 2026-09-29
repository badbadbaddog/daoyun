import type { components } from "./generated"
import { AdminApiError } from "./admin"

export type AdminComment = components["schemas"]["AdminComment"]
export type ModerateCommentInput = components["schemas"]["ModerateAdminCommentRequest"]
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === "string" && uuid.test(v)
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v))
function valid(v: unknown): v is AdminComment {
  return record(v) && id(v.id) && id(v.topic_id) && id(v.board_id)
    && typeof v.topic_title === "string" && typeof v.board_name === "string" && typeof v.content === "string"
    && typeof v.content_truncated === "boolean" && (v.status === "published" || v.status === "hidden")
    && date(v.created_at) && date(v.updated_at) && record(v.author) && id(v.author.id)
    && typeof v.author.username === "string" && typeof v.author.display_name === "string"
    && (v.author.avatar_url === null || typeof v.author.avatar_url === "string")
}
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { credentials: "include", ...options })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = record(body) && record(body.error) ? body.error : {}
    throw new AdminApiError(response.status, String(error.code ?? "response.invalid"), String(error.message ?? "评论管理请求失败"))
  }
  if (!record(body) || !record(body.meta) || !id(body.meta.request_id)) throw new Error("评论管理响应格式无效")
  return body
}
export async function listAdminComments({ boardId, status, query, cursor, limit = 20, signal }: { boardId: string; status?: "all" | AdminComment["status"]; query?: string; cursor?: string | null; limit?: number; signal?: AbortSignal }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("评论数量必须在 1 到 100 之间")
  const params = new URLSearchParams({ board_id: boardId, limit: String(limit) })
  if (status && status !== "all") params.set("status", status)
  if (query) params.set("q", query)
  if (cursor) params.set("cursor", cursor)
  const body = await request("/api/v1/admin/comments?" + params, { signal })
  if (!Array.isArray(body.data) || !body.data.every(valid) || !record(body.meta)
    || !(body.meta.next_cursor === null || id(body.meta.next_cursor))) throw new Error("评论管理响应格式无效")
  return { comments: body.data, nextCursor: body.meta.next_cursor }
}
export async function getAdminComment(commentId: string, signal?: AbortSignal) {
  const body = await request("/api/v1/admin/comments/" + encodeURIComponent(commentId), { signal })
  if (!valid(body.data)) throw new Error("评论管理响应格式无效")
  return body.data
}
export async function moderateAdminComment(commentId: string, input: ModerateCommentInput, csrfToken: string) {
  const body = await request("/api/v1/admin/comments/" + encodeURIComponent(commentId), {
    method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(input),
  })
  if (!valid(body.data)) throw new Error("评论管理响应格式无效")
  return body.data
}
