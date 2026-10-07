import { afterEach, expect, it, vi } from "vitest"
import { listRedemptionProducts, putRedemptionProduct, redeemPoints, RedemptionApiError } from "./redemptions"

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
  }), { status: 409, headers: { "x-request-id": id } }))
  vi.stubGlobal("fetch", fetcher)
  for (let i=0;i<2;i++) await expect(redeemPoints(id, 2, "retry-key", "csrf")).rejects.toBeInstanceOf(RedemptionApiError)
  const [, init] = fetcher.mock.calls[1]
  expect(init.credentials).toBe("include")
  expect(init.headers["x-csrf-token"]).toBe("csrf")
  expect(JSON.parse(init.body)).toEqual({ product_id: id, expected_revision: 2, idempotency_key: "retry-key" })
})

it.each([null,"019fc800-0000-7000-8000-000000000999"])("rejects missing or mismatched request headers on product reads and writes: %s",async header=>{
 const payload={data:{enabled:true,products:[],next_cursor:null},meta:{request_id:id}}
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(payload),{headers:header?{"x-request-id":header}:{}})))
 await expect(listRedemptionProducts({admin:true})).rejects.toMatchObject({code:"response.invalid"})
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({error:{code:"redemption.conflict",message:"冲突"},meta:{request_id:id}}),{status:409,headers:header?{"x-request-id":header}:{}}))
 await expect(putRedemptionProduct(id,{name:"商品",entitlement_type_id:id,type_version:1,price:1,duration_days:1,per_user_limit:1,enabled:true,expected_revision:1},"csrf")).rejects.toMatchObject({code:"response.invalid"})
})

it.each([{id:"019fc800-0000-7000-8000-000000000999"},{revision:3}])("keeps a product response with different target or revision unconfirmed: %j",async patch=>{
 const input={name:"商品",entitlement_type_id:id,type_version:1,price:100,duration_days:7,per_user_limit:1,enabled:false,expected_revision:null}
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{id,...input,revision:1,permission_keys:[],quotas:{},unavailable_reason:null,...patch},meta:{request_id:id}}),{headers:{"x-request-id":id}})))
 await expect(putRedemptionProduct(id,input,"csrf")).rejects.toThrow("兑换响应格式无效")
})
