import { afterEach, expect, it, vi } from "vitest"
import { listRedemptionProducts, redeemPoints, RedemptionApiError } from "./redemptions"

const id = "019fc800-0000-7000-8000-000000000001"
afterEach(() => vi.unstubAllGlobals())
it("rejects malformed catalog prices instead of allowing an unsafe balance preview", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    data: { enabled: true, products: [{ id, name: "权益", price: -1 }], next_cursor: null },
    meta: { request_id: id },
  }))))
  await expect(listRedemptionProducts()).rejects.toThrow("兑换响应格式无效")
})
it("keeps the expected product revision and idempotency key on retries", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: { code: "redemption.insufficient_balance", message: "积分不足" }, meta: { request_id: id },
  }), { status: 409 }))
  vi.stubGlobal("fetch", fetcher)
  for (let i=0;i<2;i++) await expect(redeemPoints(id, 2, "retry-key", "csrf")).rejects.toBeInstanceOf(RedemptionApiError)
  const [, init] = fetcher.mock.calls[1]
  expect(init.credentials).toBe("include")
  expect(init.headers["x-csrf-token"]).toBe("csrf")
  expect(JSON.parse(init.body)).toEqual({ product_id: id, expected_revision: 2, idempotency_key: "retry-key" })
})
