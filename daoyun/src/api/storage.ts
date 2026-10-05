import type { components } from "./generated"
import { AdminApiError } from "./admin"
export type AttachmentStorageConfiguration = components["schemas"]["AttachmentStorageConfiguration"]
export async function getAttachmentStorageConfiguration(signal?: AbortSignal): Promise<AttachmentStorageConfiguration> {
  const response = await fetch("/api/v1/admin/attachments/storage", { headers: { Accept: "application/json" }, credentials: "include", signal })
  const body: unknown = await response.json()
  if (!response.ok) throw new AdminApiError(response.status, response.status === 403 ? "admin.forbidden" : "storage.unavailable", "存储配置暂时无法加载")
  if (!body || typeof body !== "object" || !("data" in body) || !("meta" in body)) throw new Error("Invalid storage response")
  const {data, meta} = body
  if (!meta || typeof meta !== "object" || !("request_id" in meta) || typeof meta.request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(meta.request_id)
    || !data || typeof data !== "object" || !("write_provider" in data) || !("legacy_provider" in data)
    || !(data.write_provider === "local" || data.write_provider === "s3") || !(data.legacy_provider === "local" || data.legacy_provider === "s3")
    || !("local_configured" in data) || typeof data.local_configured !== "boolean"
    || !("s3_configured" in data) || typeof data.s3_configured !== "boolean"
    || !("s3_supported" in data) || typeof data.s3_supported !== "boolean") throw new Error("Invalid storage response")
  return data as AttachmentStorageConfiguration
}
