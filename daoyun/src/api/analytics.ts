export interface AnalyticsCounts {
  new_users: number
  active_users: number
  topics: number
  replies: number
  points_issued: number
  points_spent: number
}
export interface CommunityAnalytics extends AnalyticsCounts {
  started_at: string
  from: string
  through: string
  activity_complete: boolean
  content_complete: boolean
  retention_eligible: number
  retention_returned: number
  days: (AnalyticsCounts & { day: string; activity_complete: boolean; content_complete: boolean })[]
  boards: { board_id: string; name: string; topics: number; replies: number; participants: number }[]
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)
const number = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))
const counts = (v: Record<string, unknown>) => ["new_users","active_users","topics","replies","points_issued","points_spent"].every(key => number(v[key]))
function valid(v: unknown): v is CommunityAnalytics {
  return object(v) && counts(v) && date(v.from) && date(v.through)
    && typeof v.started_at === "string" && Number.isFinite(Date.parse(v.started_at))
    && typeof v.activity_complete === "boolean" && typeof v.content_complete === "boolean"
    && number(v.retention_eligible) && number(v.retention_returned) && v.retention_returned <= v.retention_eligible
    && Array.isArray(v.days) && v.days.length <= 90 && v.days.every(d => object(d) && counts(d) && date(d.day) && typeof d.activity_complete === "boolean" && typeof d.content_complete === "boolean")
    && Array.isArray(v.boards) && v.boards.length <= 20 && v.boards.every(b => object(b) && typeof b.board_id === "string" && typeof b.name === "string" && number(b.topics) && number(b.replies) && number(b.participants))
}
export async function getCommunityAnalytics(days: 7 | 30 | 90, signal?: AbortSignal): Promise<CommunityAnalytics> {
  const response = await fetch("/api/v1/admin/community-analytics?days=" + days, { credentials: "include", signal })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(object(body) && object(body.error) && typeof body.error.message === "string" ? body.error.message : "运营数据暂时无法读取")
  if (!object(body) || !object(body.meta) || typeof body.meta.request_id !== "string" || !valid(body.data)) throw new Error("运营数据响应格式无效")
  return body.data
}
