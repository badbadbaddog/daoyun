import {afterEach,expect,it,vi} from "vitest"
import * as api from "./admin"
const uid="019fc800-0000-7000-8000-000000000001"
const requestId="019fc800-0000-7000-8000-000000000002"
const entry={id:requestId,amount:-10,reason:"operations.correction",balance_after:20,actor_id:uid,actor_username:"owner",actor_display_name:"管理员",operation_request_id:uid,created_at:"2026-10-06T00:00:00Z"}
afterEach(()=>vi.unstubAllGlobals())
it("reads administrator points ledger by exact UID and cursor with original operation metadata",async()=>{
 const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:[entry],meta:{request_id:requestId,next_cursor:requestId}}),{headers:{"x-request-id":requestId}})); vi.stubGlobal("fetch",fetchMock)
 const controller=new AbortController()
 expect(await api.listAdminPointsLedger(uid,{cursor:requestId,limit:20,signal:controller.signal})).toEqual({entries:[{id:requestId,amount:-10,reason:"operations.correction",balanceAfter:20,actorId:uid,actorUsername:"owner",actorDisplayName:"管理员",operationRequestId:uid,createdAt:entry.created_at}],nextCursor:requestId})
 expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/membership/users/'+uid+'/points/ledger?limit=20&cursor='+requestId,expect.objectContaining({credentials:"include",signal:controller.signal}))
})
it.each([{amount:1.5},{balance_after:-1},{id:"bad"},{actor_id:"bad"}])("rejects malformed ledger fields instead of displaying substitute data %j",async(patch)=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({data:[{...entry,...patch}],meta:{request_id:requestId,next_cursor:null}}),{headers:{"x-request-id":requestId}})))
 await expect(api.listAdminPointsLedger(uid)).rejects.toMatchObject({code:"response.invalid"})
})
it("rejects mismatched request IDs and keeps server forbidden errors",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({data:[],meta:{request_id:requestId,next_cursor:null}}),{headers:{"x-request-id":uid}})))
 await expect(api.listAdminPointsLedger(uid)).rejects.toMatchObject({code:"response.invalid"})
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:"admin.forbidden",message:"无权限"},meta:{request_id:requestId}}),{status:403})))
 await expect(api.listAdminPointsLedger(uid)).rejects.toMatchObject({status:403,code:"admin.forbidden"})
})

const growthLevel={id:uid,internal_key:"member",level_order:1,display_name:"成员",required_experience:0,icon_asset_id:null,color:null,description:""}
const experienceAccount={user_id:uid,experience:120,current_level:growthLevel,revision:2,updated_at:entry.created_at}
const experienceEntry={id:requestId,user_id:uid,amount:120,reason:"admin.adjustment",details:"补记贡献",source_resource_id:null,reversal_of:null,balance_after:120,revision_after:2,actor_id:uid,actor_username:"owner",actor_display_name:"管理员",operation_request_id:uid,audit_id:uid,created_at:entry.created_at}
it("reads real EXP and preserves explicitly uninitialized accounts",async()=>{
 const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:experienceAccount,meta:{request_id:requestId}}),{headers:{"x-request-id":requestId}})).mockResolvedValueOnce(new Response(JSON.stringify({data:null,meta:{request_id:requestId}}),{headers:{"x-request-id":requestId}}));vi.stubGlobal("fetch",fetchMock)
 expect(await api.getAdminExperience(uid)).toMatchObject({userId:uid,experience:120,revision:2,currentLevel:{requiredExperience:0,levelOrder:1}})
 expect(await api.getAdminExperience(uid)).toBeNull()
})
it("submits exact EXP amount, original reversal and version with CSRF and stable request key",async()=>{
 const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{account:experienceAccount,entry:experienceEntry,replayed:true},meta:{request_id:requestId}}),{headers:{"x-request-id":requestId}}));vi.stubGlobal("fetch",fetchMock)
 expect(await api.adjustAdminExperience({userId:uid,amount:120,reason:"补记贡献",expectedRevision:1,idempotencyKey:"stable",reversalOf:null},"csrf")).toMatchObject({replayed:true,entry:{balanceAfter:120,revisionAfter:2,operationRequestId:uid},requestId})
 expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/membership/experience",expect.objectContaining({method:"POST",headers:expect.objectContaining({"x-csrf-token":"csrf"}),body:JSON.stringify({user_id:uid,amount:120,reason:"补记贡献",expected_revision:1,idempotency_key:"stable",reversal_of:null})}))
})
it("reads EXP ledger pages with unknown historical metadata kept null",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({data:[{...experienceEntry,revision_after:null,actor_id:null,actor_username:null,actor_display_name:null,operation_request_id:null,audit_id:null,details:null}],meta:{request_id:requestId,next_cursor:null}}),{headers:{"x-request-id":requestId}})))
 expect((await api.listAdminExperienceLedger(uid)).entries[0]).toMatchObject({amount:120,revisionAfter:null,actorId:null,auditId:null,details:null})
})
it.each([{user_id:requestId},{experience:-1},{revision:0},{current_level:{...growthLevel,required_experience:0.5}}])("rejects malformed or mismatched EXP accounts %j",async patch=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{...experienceAccount,...patch},meta:{request_id:requestId}}),{headers:{"x-request-id":requestId}})))
 await expect(api.getAdminExperience(uid)).rejects.toMatchObject({code:"response.invalid"})
})

const medalReceipt={id:requestId,user_id:uid,medal_key:"medal_01",medal_display_name:"勋章 01",operation:"grant",reason:"operator.award",actor_id:uid,idempotency_key:"medal-command",expected_revision:0,revision:1,affected:true,owned_after:true,audit_id:uid,operation_request_id:uid,created_at:entry.created_at,replayed:false}
const medal={key:"medal_01",display_name:"勋章 01",asset_url:"/assets/membership/medals/medal1.gif",sha256:"a".repeat(64),granted_at:entry.created_at}
it("loads current medal revision and original command receipt independently",async()=>{
 const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:{user_id:uid,revision:2,medals:[]},meta:{request_id:requestId}}),{headers:{"x-request-id":requestId}})).mockResolvedValueOnce(new Response(JSON.stringify({data:medalReceipt,meta:{request_id:requestId}}),{headers:{"x-request-id":requestId}}));vi.stubGlobal("fetch",fetchMock)
 expect(await api.getAdminMedalState(uid)).toEqual({userId:uid,revision:2,medals:[]})
 expect(await api.getAdminMedalReceipt(uid,"medal-command")).toMatchObject({userId:uid,revision:1,operationRequestId:uid,ownedAfter:true})
})
it("sends a medal command with frozen key and revision and validates original receipt",async()=>{
 const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{medal,created:true,receipt:medalReceipt},meta:{request_id:requestId}}),{headers:{"x-request-id":requestId}}));vi.stubGlobal("fetch",fetchMock)
 const input={userId:uid,medalKey:"medal_01",reason:"operator.award",expectedRevision:0,idempotencyKey:"medal-command"}
 expect(await api.grantMembershipMedal(input,"csrf")).toMatchObject({receipt:{expectedRevision:0,idempotencyKey:"medal-command",replayed:false}})
 expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({user_id:uid,medal_key:"medal_01",reason:"operator.award",expected_revision:0,idempotency_key:"medal-command"})
})
it.each([{user_id:requestId},{idempotency_key:"other"},{expected_revision:2},{operation:"revoke"}])("rejects a medal receipt for a different frozen command %j",async patch=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{medal,created:true,receipt:{...medalReceipt,...patch}},meta:{request_id:requestId}}),{headers:{"x-request-id":requestId}})))
 await expect(api.grantMembershipMedal({userId:uid,medalKey:"medal_01",reason:"operator.award",expectedRevision:0,idempotencyKey:"medal-command"},"csrf")).rejects.toMatchObject({code:"response.invalid"})
})

it.each([
 ['points',()=>api.listAdminPointsLedger(uid),{data:[],meta:{request_id:requestId,next_cursor:null}}],
 ['EXP',()=>api.getAdminExperience(uid),{data:experienceAccount,meta:{request_id:requestId}}],
 ['medals',()=>api.getAdminMedalState(uid),{data:{user_id:uid,revision:0,medals:[]},meta:{request_id:requestId}}],
 ['medal history',()=>api.listMembershipMedalOperations(),{data:[],meta:{request_id:requestId,next_cursor:null}}],
] as const)('rejects missing request headers in %s responses',async(_name,call,payload)=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))))
 await expect(call()).rejects.toMatchObject({code:'response.invalid'})
})
