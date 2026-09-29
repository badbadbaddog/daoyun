export interface RedemptionProduct {
  id: string
  name: string
  entitlement_type_id: string
  type_version: number
  price: number
  duration_days: number
  per_user_limit: number
  enabled: boolean
  revision: number
  permission_keys: string[]
  quotas: Record<string, number>
  unavailable_reason: string | null
}
export interface RedemptionReceipt {
  id: string
  product_id: string
  product_name: string
  product_revision: number
  price: number
  balance_after: number
  entitlement_id: string
  created_at: string
  ends_at: string
}
export interface RedemptionCatalog { enabled: boolean; products: RedemptionProduct[]; next_cursor: string | null }
export interface RedemptionHistory { records: RedemptionReceipt[]; next_cursor: string | null }
export type PutRedemptionProduct = Pick<RedemptionProduct, "name" | "entitlement_type_id" | "type_version" | "price" | "duration_days" | "per_user_limit" | "enabled"> & { expected_revision: number | null }

export class RedemptionApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === "string" && uuid.test(v)
const integer = (v: unknown, min=0): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v))
const cursor = (v: unknown): v is string | null => v === null || id(v)
function product(v: unknown): v is RedemptionProduct {
  return object(v) && id(v.id) && typeof v.name === "string" && v.name.length > 0 && id(v.entitlement_type_id)
    && integer(v.type_version,1) && integer(v.price,1) && integer(v.duration_days,1)
    && integer(v.per_user_limit,1) && typeof v.enabled === "boolean" && integer(v.revision,1)
    && Array.isArray(v.permission_keys) && v.permission_keys.every(k=>typeof k==="string")
    && object(v.quotas) && Object.values(v.quotas).every(q=>integer(q))
    && (v.unavailable_reason===null || typeof v.unavailable_reason==="string")
}
function receipt(v: unknown): v is RedemptionReceipt {
  return object(v) && id(v.id) && id(v.product_id) && typeof v.product_name==="string"
    && integer(v.product_revision,1) && integer(v.price,1) && integer(v.balance_after)
    && id(v.entitlement_id) && date(v.created_at) && date(v.ends_at)
}
async function request<T>(path: string, guard: (value: unknown) => value is T, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init })
  const payload: unknown = await response.json().catch(()=>null)
  if (!response.ok) {
    const error = object(payload) && object(payload.error) ? payload.error : {}
    throw new RedemptionApiError(response.status, String(error.code ?? "response.invalid"), String(error.message ?? "兑换请求失败"))
  }
  if (!object(payload) || !object(payload.meta) || !id(payload.meta.request_id) || !guard(payload.data)) throw new Error("兑换响应格式无效")
  return payload.data
}
export function listRedemptionProducts(options: { admin?: boolean; cursor?: string; signal?: AbortSignal } = {}) {
  const path = options.admin ? "/api/v1/admin/redemption-products" : "/api/v1/membership/redemption-products"
  const params = new URLSearchParams({ limit: "20" })
  if (options.cursor) params.set("cursor",options.cursor)
  return request(path+"?"+params, (v): v is RedemptionCatalog => object(v) && typeof v.enabled==="boolean"
    && Array.isArray(v.products) && v.products.every(product) && cursor(v.next_cursor), { signal: options.signal })
}
export function listRedemptions(options: { cursor?: string; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams({ limit: "20" })
  if (options.cursor) params.set("cursor",options.cursor)
  return request("/api/v1/users/me/redemptions?"+params, (v): v is RedemptionHistory => object(v)
    && Array.isArray(v.records) && v.records.every(receipt) && cursor(v.next_cursor), { signal: options.signal })
}
export function putRedemptionProduct(productId: string, input: PutRedemptionProduct, csrfToken: string) {
  return request("/api/v1/admin/redemption-products/"+encodeURIComponent(productId), product, {
    method: "PUT", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(input),
  })
}
export function redeemPoints(productId: string, expectedRevision: number, idempotencyKey: string, csrfToken: string) {
  return request("/api/v1/users/me/redemptions", receipt, {
    method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ product_id: productId, expected_revision: expectedRevision, idempotency_key: idempotencyKey }),
  })
}
