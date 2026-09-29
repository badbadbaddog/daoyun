import { isRichTextDocument, type RichTextDocument } from "../editor/richContent"
import { PluginApiError } from "./plugins"

export interface EditReviewPolicy {
  board_id: string
  board_name: string
  topic_edits_require_review: boolean
  reply_edits_require_review: boolean
}

export interface EditReviewItem {
  id: string
  board_id: string
  board_name: string
  topic_id: string
  post_id: string
  target_type: "topic" | "reply"
  editor: { id: string; username: string; display_name: string; avatar_url: string | null }
  base_revision: number
  current_title: string | null
  current_content: string
  proposed_title: string | null
  proposed_content: string | null
  proposed_rich_content: RichTextDocument | null
  proposed_excerpt: string | null
  proposed_tags: Array<{ slug: string; name: string }> | null
  status: "pending" | "approved" | "rejected"
  revision: number
  review_reason: string | null
  created_at: string
  reviewed_at: string | null
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
function validPolicy(value: unknown): value is EditReviewPolicy {
  return record(value) && typeof value.board_id === "string" && uuid.test(value.board_id)
    && typeof value.board_name === "string" && typeof value.topic_edits_require_review === "boolean"
    && typeof value.reply_edits_require_review === "boolean"
}
function validItem(value: unknown): value is EditReviewItem {
  return record(value) && typeof value.id === "string" && uuid.test(value.id)
    && typeof value.board_id === "string" && uuid.test(value.board_id)
    && typeof value.topic_id === "string" && uuid.test(value.topic_id)
    && typeof value.post_id === "string" && uuid.test(value.post_id)
    && (value.target_type === "topic" || value.target_type === "reply")
    && record(value.editor) && typeof value.editor.display_name === "string"
    && typeof value.current_content === "string"
    && (value.current_title === null || typeof value.current_title === "string")
    && (value.proposed_title === null || typeof value.proposed_title === "string")
    && (value.proposed_content === null || typeof value.proposed_content === "string")
    && (value.proposed_rich_content === null || isRichTextDocument(value.proposed_rich_content))
    && (value.proposed_excerpt === null || typeof value.proposed_excerpt === "string")
    && (value.proposed_tags === null || (Array.isArray(value.proposed_tags) && value.proposed_tags.every((tag) => record(tag) && typeof tag.slug === "string" && typeof tag.name === "string")))
    && ["pending", "approved", "rejected"].includes(String(value.status))
    && Number.isSafeInteger(value.revision) && Number(value.revision) > 0
    && typeof value.created_at === "string"
}

async function request<T>(path: string, validate: (value: unknown) => value is T, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...options })
  const payload: unknown = await response.json()
  if (!response.ok) {
    const error = record(payload) && record(payload.error) ? payload.error : {}
    throw new PluginApiError(response.status, String(error.code ?? "response.invalid"), String(error.message ?? "编辑审核请求失败"))
  }
  if (!record(payload) || !record(payload.meta) || typeof payload.meta.request_id !== "string" || !uuid.test(payload.meta.request_id) || !validate(payload.data)) {
    throw new Error("编辑审核响应格式无效")
  }
  return payload.data
}

const validPolicies = (value: unknown): value is EditReviewPolicy[] => Array.isArray(value) && value.every(validPolicy)
const validItems = (value: unknown): value is EditReviewItem[] => Array.isArray(value) && value.every(validItem)

export function listEditReviewPolicies(signal?: AbortSignal) {
  return request("/api/v1/admin/edit-review/policies", validPolicies, { signal })
}

export function updateEditReviewPolicies(policies: EditReviewPolicy[], csrfToken: string) {
  return request("/api/v1/admin/edit-review/policies", validPolicies, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ policies: policies.map(({ board_name: _, ...policy }) => policy) }),
  })
}

export function listEditReviews(boardId: string, status: EditReviewItem["status"], signal?: AbortSignal) {
  return request(`/api/v1/admin/edit-reviews?board_id=${encodeURIComponent(boardId)}&status=${status}`, validItems, { signal })
}

export function resolveEditReview(item: EditReviewItem, decision: "approve" | "reject", reason: string, csrfToken: string) {
  return request(`/api/v1/admin/edit-reviews/${encodeURIComponent(item.id)}`, validItem, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ decision, base_revision: item.revision, reason }),
  })
}

export async function listEditReviewPage({ boardId, status, targetType, cursor, signal }: { boardId: string; status: EditReviewItem["status"]; targetType?: "all" | EditReviewItem["target_type"]; cursor?: string | null; signal?: AbortSignal }) {
  const params = new URLSearchParams({ board_id: boardId, status, limit: "20" })
  if (targetType && targetType !== "all") params.set("target_type", targetType)
  if (cursor) params.set("cursor", cursor)
  const items = await request("/api/v1/admin/edit-reviews?" + params, validItems, { signal })
  return { items, nextCursor: items.length === 20 ? items[items.length - 1].id : null }
}
