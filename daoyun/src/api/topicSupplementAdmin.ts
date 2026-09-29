import { PluginApiError } from "./plugins"

export interface SupplementSettings { enabled: boolean; max_per_topic: number }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
function validSettings(value: unknown): value is SupplementSettings {
  return record(value) && typeof value.enabled === "boolean" && typeof value.max_per_topic === "number"
    && Number.isInteger(value.max_per_topic) && value.max_per_topic >= 0 && value.max_per_topic <= 100
}

async function request(path: string, options: RequestInit = {}): Promise<SupplementSettings> {
  const response = await fetch(path, { credentials: "include", ...options })
  const payload: unknown = await response.json()
  if (!response.ok) {
    const error = record(payload) && record(payload.error) ? payload.error : {}
    throw new PluginApiError(response.status, String(error.code ?? "response.invalid"), String(error.message ?? "补充管理请求失败"))
  }
  if (!record(payload) || !record(payload.meta) || typeof payload.meta.request_id !== "string"
    || !uuid.test(payload.meta.request_id) || !validSettings(payload.data)) throw new Error("补充管理响应格式无效")
  return payload.data
}

export function getSupplementSettings(signal?: AbortSignal) {
  return request("/api/v1/admin/topic-supplements/settings", { signal })
}

export function putSupplementSettings(settings: SupplementSettings, csrfToken: string) {
  return request("/api/v1/admin/topic-supplements/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(settings),
  })
}
