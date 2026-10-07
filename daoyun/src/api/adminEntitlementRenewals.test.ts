import {afterEach,expect,it,vi} from "vitest"
import {AdminApiError,getStandardEntitlementRenewalReceipt,renewStandardEntitlement} from "./admin"
const uid="019fc900-0000-7000-8000-000000000401",eid="019fc900-0000-7000-8000-000000000801",rid="019fc900-0000-7000-8000-000000000001"
const input={userId:uid,expectedRevision:1,endsAt:"2091-01-01T00:00:00Z",reason:"续期",idempotencyKey:"same/key"}
const receipt={id:rid,user_id:uid,entitlement_id:eid,actor_id:rid,expected_revision:1,previous_ends_at:"2090-01-01T00:00:00Z",ends_at:input.endsAt,reason:input.reason,idempotency_key:input.idempotencyKey,revision:2,audit_id:rid,request_id:rid,type_version:1,starts_at:"2026-01-01T00:00:00Z",permission_snapshot:["topic.poll.create"],quota_snapshot:{},created_at:"2026-10-07T00:00:00Z"}
const entitlement={id:eid,user_id:uid,entitlement_type_id:rid,entitlement_key:"monthly_vip",type_version:1,permission_snapshot:receipt.permission_snapshot,quota_snapshot:{},source:"admin",source_reference_id:null,reason:"原授予",starts_at:receipt.starts_at,ends_at:input.endsAt,revoked_at:null,revoked_by:null,revocation_reason:null,revision:2,granted_by:rid,created_at:receipt.starts_at,updated_at:receipt.created_at}
function reply(data:unknown,header:string|null=rid,status=200){return new Response(JSON.stringify({data,meta:{request_id:rid},...(status!==200?{error:{code:"entitlement.conflict",message:"冲突"}}:{})}),{status,headers:{"content-type":"application/json",...(header?{"x-request-id":header}:{})}})}
afterEach(()=>vi.unstubAllGlobals())
it("sends revision, UID, exact command and CSRF and retains the original receipt",async()=>{
 const mock=vi.fn().mockResolvedValue(reply({receipt,entitlement,replayed:false}));vi.stubGlobal("fetch",mock)
 const result=await renewStandardEntitlement(eid,input,"csrf")
 expect(mock.mock.calls[0][0]).toBe("/api/v1/admin/entitlements/"+eid+"/renew")
 expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({user_id:uid,expected_revision:1,ends_at:input.endsAt,reason:"续期",idempotency_key:"same/key"})
 expect(mock.mock.calls[0][1].headers["x-csrf-token"]).toBe("csrf")
 expect(result.receipt).toMatchObject({userId:uid,entitlementId:eid,expectedRevision:1,revision:2,idempotencyKey:"same/key",requestId:rid})
})
it("encodes the lookup key and enforces its UID",async()=>{
 const mock=vi.fn().mockResolvedValue(reply(receipt));vi.stubGlobal("fetch",mock)
 expect((await getStandardEntitlementRenewalReceipt(uid,"same/key")).entitlementId).toBe(eid)
 expect(mock.mock.calls[0][0]).toBe("/api/v1/admin/entitlements/users/"+uid+"/renewal-requests/same%2Fkey")
 mock.mockResolvedValue(reply({...receipt,user_id:rid}))
 await expect(getStandardEntitlementRenewalReceipt(uid,"same/key")).rejects.toMatchObject({code:"response.invalid"})
})
it.each([null,"019fc900-0000-7000-8000-000000000999"])("rejects missing or mismatched request headers even on an error response: %s",async header=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(reply({receipt,entitlement,replayed:false},header,409)))
 await expect(renewStandardEntitlement(eid,input,"csrf")).rejects.toMatchObject({code:"response.invalid"})
})
it.each([{reason:"不同原因"},{expected_revision:2},{revision:4},{entitlement_id:rid},{ends_at:"2092-01-01T00:00:00Z"}])("rejects a receipt for different command facts: %j",async patch=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(reply({receipt:{...receipt,...patch},entitlement,replayed:true})))
 await expect(renewStandardEntitlement(eid,input,"csrf")).rejects.toBeInstanceOf(AdminApiError)
})
it("validates input before any request",async()=>{
 const mock=vi.fn();vi.stubGlobal("fetch",mock)
 await expect(renewStandardEntitlement(eid,{...input,expectedRevision:0},"csrf")).rejects.toMatchObject({status:422})
 await expect(getStandardEntitlementRenewalReceipt(uid," ")).rejects.toMatchObject({status:422})
 expect(mock).not.toHaveBeenCalled()
})

it.each([
 {ends_at:"2090-01-01T00:00:00Z"}, {ends_at:null}, {revision:1},
 {revision:2,ends_at:"2092-01-01T00:00:00Z"},
 {revoked_at:"2026-10-07T01:00:00Z",revoked_by:rid,revocation_reason:"撤销"},
])("rejects current facts inconsistent with the renewal receipt: %j",async patch=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(reply({receipt,entitlement:{...entitlement,...patch},replayed:true})))
 await expect(renewStandardEntitlement(eid,input,"csrf")).rejects.toMatchObject({code:"response.invalid"})
})
it("accepts a replay receipt alongside a later revoked state but rejects that state for a fresh command",async()=>{
 const current={...entitlement,revision:3,revoked_at:"2026-10-07T01:00:00Z",revoked_by:rid,revocation_reason:"撤销"}
 const fetcher=vi.fn().mockResolvedValueOnce(reply({receipt,entitlement:current,replayed:true})).mockResolvedValueOnce(reply({receipt,entitlement:current,replayed:false}))
 vi.stubGlobal("fetch",fetcher)
 expect((await renewStandardEntitlement(eid,input,"csrf")).entitlement.revision).toBe(3)
 await expect(renewStandardEntitlement(eid,input,"csrf")).rejects.toMatchObject({code:"response.invalid"})
})
