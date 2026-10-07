import {act,cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {afterEach,expect,it,vi} from "vitest"
import {EntitlementsWorkspace} from "./EntitlementsWorkspace"

const uid="019fc900-0000-7000-8000-000000000401", target="019fc900-0000-7000-8000-000000000801",kind="019fc900-0000-7000-8000-000000000802",rid="019fc900-0000-7000-8000-000000000001"
const fixedUser={id:uid,username:"member",displayName:"当前成员",avatarUrl:null,status:"active" as const,primaryRole:null,topicCount:0,postCount:0,reportCount:0,createdAt:"2026-01-01T00:00:00Z",lastSeenAt:null}
const entitlement={id:target,user_id:uid,entitlement_type_id:kind,entitlement_key:"monthly_vip",type_version:1,permission_snapshot:["topic.poll.create"],quota_snapshot:{"attachment.file.bytes":1048576},source:"admin",source_reference_id:null,reason:"原授予",starts_at:"2026-01-01T00:00:00Z",ends_at:"2090-01-01T00:00:00Z",revoked_at:null,revoked_by:null,revocation_reason:null,revision:1,granted_by:rid,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"}
function response(data:unknown,status=200){return new Response(JSON.stringify(status===200?{data,meta:{request_id:rid}}:{error:{code:status===409?"entitlement.conflict":"entitlement.not_found",message:"尚未确认"},meta:{request_id:rid}}),{status,headers:{"content-type":"application/json","x-request-id":rid}})}
function receipt(input:Record<string,unknown>){return {id:kind,user_id:uid,entitlement_id:target,actor_id:rid,expected_revision:input.expected_revision,previous_ends_at:entitlement.ends_at,ends_at:input.ends_at,reason:input.reason,idempotency_key:input.idempotency_key,revision:Number(input.expected_revision)+1,audit_id:rid,request_id:rid,type_version:1,starts_at:entitlement.starts_at,permission_snapshot:entitlement.permission_snapshot,quota_snapshot:entitlement.quota_snapshot,created_at:"2026-10-07T00:00:00Z"}}
function fixture(handler?:(url:string,init?:RequestInit)=>Response|Promise<Response>){
 const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
  if(init?.method==="POST"||url.includes("renewal-requests"))return handler!(url,init)
  if(url.includes("/types"))return response([{id:kind,internal_key:"monthly_vip",display_name:"月度会员",status:"active",current_version:2,permission_keys:["board.read"],quotas:{},revision:2,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"}])
  return response([entitlement])
 })
 vi.stubGlobal("fetch",fetchMock);return fetchMock
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
async function openAndFill(){
 await userEvent.click(await screen.findByRole("button",{name:"续期月度会员"}))
 fireEvent.change(screen.getByLabelText("新到期时间"),{target:{value:"2091-02-01T10:00"}})
 await userEvent.type(screen.getByLabelText("续期原因"),"延长有效期")
}
it("renews the fixed UID with the existing snapshot and refreshes its membership summary",async()=>{
 const changed=vi.fn();const fetchMock=fixture((_url,init)=>{const input=JSON.parse(init!.body as string);return response({receipt:receipt(input),entitlement:{...entitlement,ends_at:input.ends_at,revision:2},replayed:false})})
 render(<EntitlementsWorkspace fixedUser={fixedUser} csrfToken="csrf" onChanged={changed}/>)
 const snapshotList=await screen.findByRole("list",{name:"权益操作记录"})
 await userEvent.click(within(snapshotList).getByText("权限与额度快照"))
 expect(within(snapshotList).getByText("发起投票")).toBeInTheDocument()
 expect(within(snapshotList).getByText("单文件字节数：1 MiB")).toBeInTheDocument()
 await openAndFill()
 expect(screen.getByRole("dialog",{name:"续期会员权益"})).toHaveTextContent("原权益版本 1")
 await userEvent.click(screen.getByRole("button",{name:"确认续期"}))
 await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1))
 const call=fetchMock.mock.calls.find(([,init])=>init?.method==="POST")!
 expect(call[0]).toBe("/api/v1/admin/entitlements/"+target+"/renew")
 expect(JSON.parse(call[1]!.body as string)).toMatchObject({user_id:uid,expected_revision:1,reason:"延长有效期"})
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
 expect(screen.getByText("原续期回执")).toBeInTheDocument()
})
it("freezes unknown renewal input and navigation, keeps 404 unknown, and retries the exact command",async()=>{
 const bodies:string[]=[],busy=vi.fn(),changed=vi.fn()
 fixture((url,init)=>{if(url.includes("renewal-requests"))return response(null,404);bodies.push(init!.body as string);if(bodies.length===1)throw new TypeError("response lost");const input=JSON.parse(bodies[0]);return response({receipt:receipt(input),entitlement:{...entitlement,ends_at:input.ends_at,revision:2},replayed:true})})
 render(<EntitlementsWorkspace fixedUser={fixedUser} csrfToken="csrf" onBusyChange={busy} onChanged={changed}/>)
 await openAndFill();await userEvent.click(screen.getByRole("button",{name:"确认续期"}))
 await screen.findByRole("alert")
 expect(screen.getByLabelText("新到期时间")).toBeDisabled()
 expect(screen.getByLabelText("续期原因")).toBeDisabled()
 expect(busy).toHaveBeenLastCalledWith(true)
 await userEvent.keyboard("{Escape}");expect(screen.getByRole("dialog")).toBeInTheDocument()
 await userEvent.click(screen.getByRole("button",{name:"核实原续期回执"}))
 await screen.findByText(/尚未找到.*继续保留/)
 expect(changed).not.toHaveBeenCalled()
 await userEvent.click(screen.getByRole("button",{name:"使用原请求重试"}))
 await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1))
 expect(bodies[1]).toBe(bodies[0]);expect(busy).toHaveBeenLastCalledWith(false)
})
it("keeps renewal date and reason after a conflict and refreshes the target revision explicitly",async()=>{
 let attempts=0,listReads=0
 fixture((_url,init)=>{attempts++;if(attempts===1)return response(null,409);const input=JSON.parse(init!.body as string);return response({receipt:{...receipt(input),previous_ends_at:"2090-02-01T00:00:00Z"},entitlement:{...entitlement,ends_at:input.ends_at,revision:3},replayed:false})})
 const original=vi.mocked(fetch);const implementation=original.getMockImplementation()!
 original.mockImplementation(async(url,init)=>{if(String(url).includes("user_id=")&&++listReads>1)return response([{...entitlement,revision:2,ends_at:"2090-02-01T00:00:00Z"}]);return implementation(url,init)})
 render(<EntitlementsWorkspace fixedUser={fixedUser} csrfToken="csrf"/>)
 await openAndFill();await userEvent.click(screen.getByRole("button",{name:"确认续期"}))
 await screen.findByRole("alert");expect(screen.getByRole("button",{name:"确认续期"})).toBeDisabled()
 await userEvent.click(screen.getByRole("button",{name:"刷新续期基线"}))
 await waitFor(()=>expect(screen.getByRole("button",{name:"确认续期"})).toBeEnabled())
 expect(screen.getByLabelText("续期原因")).toHaveValue("延长有效期")
 expect(screen.getByLabelText("新到期时间")).toHaveValue("2091-02-01T10:00")
 await userEvent.click(screen.getByRole("button",{name:"确认续期"}))
 await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
 const inputs=original.mock.calls.filter(([,init])=>init?.method==="POST").map(([,init])=>JSON.parse(init!.body as string))
 expect(inputs[1].expected_revision).toBe(2);expect(inputs[1].idempotency_key).not.toBe(inputs[0].idempotency_key)
})
it("does not offer renewal to read-only users and explains non-renewable facts",async()=>{
 fixture()
 render(<EntitlementsWorkspace fixedUser={fixedUser} canWriteGrants={false}/>)
 await screen.findByText("原授予");expect(screen.queryByRole("button",{name:"续期月度会员"})).not.toBeInTheDocument()
 cleanup()
 vi.mocked(fetch).mockImplementation(async()=>response([
  {...entitlement,id:target,ends_at:null},
  {...entitlement,id:kind,ends_at:"2026-01-02T00:00:00Z"},
 ]))
 render(<EntitlementsWorkspace fixedUser={fixedUser} canReadTypes={false}/>)
 const list=await screen.findByRole("list",{name:"权益操作记录"})
 expect(within(list).getByText("永久权益无需续期")).toBeInTheDocument()
 expect(within(list).getByText("已到期，请重新发放")).toBeInTheDocument()
})

it("can retry the original command even if the displayed pre-renewal deadline expires while the result is unknown",async()=>{
 const changed=vi.fn(),bodies:string[]=[]
 fixture((_url,init)=>{bodies.push(init!.body as string);if(bodies.length===1)throw new TypeError("lost");const input=JSON.parse(bodies[0]);return response({receipt:receipt(input),entitlement:{...entitlement,ends_at:input.ends_at,revision:2},replayed:true})})
 render(<EntitlementsWorkspace fixedUser={fixedUser} csrfToken="csrf" onChanged={changed}/>)
 await openAndFill();await userEvent.click(screen.getByRole("button",{name:"确认续期"}));await screen.findByRole("alert")
 vi.spyOn(Date,"now").mockReturnValue(Date.parse("2090-01-02T00:00:00Z"))
 await userEvent.click(screen.getByRole("button",{name:"使用原请求重试"}))
 await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1))
 expect(bodies[1]).toBe(bodies[0])
})

it("blocks an already open publisher after its write permission is withdrawn",async()=>{
 const publish=vi.fn()
 const view=render(<EntitlementsWorkspace onPublishVersion={publish}/>)
 await userEvent.click(screen.getByRole("button",{name:"创建权益类型"}))
 fireEvent.change(screen.getByLabelText("内部键"),{target:{value:"monthly_vip"}})
 fireEvent.change(screen.getByLabelText("显示名称"),{target:{value:"月度会员"}})
 await userEvent.click(screen.getByLabelText("发起投票"))
 fireEvent.change(screen.getByLabelText("每日主题数"),{target:{value:"5"}})
 view.rerender(<EntitlementsWorkspace onPublishVersion={publish} canWriteTypes={false}/>)
 expect(screen.getByRole("button",{name:"确认发布"})).toBeDisabled()
 fireEvent.submit(screen.getByRole("dialog"))
 expect(publish).not.toHaveBeenCalled()
})
it("clears a visible type history when type read permission is withdrawn",async()=>{
 fixture()
 const view=render(<EntitlementsWorkspace/>)
 await userEvent.click(await screen.findByRole("button",{name:"查看月度会员版本历史"}))
 view.rerender(<EntitlementsWorkspace canReadTypes={false}/>)
 await waitFor(()=>expect(screen.queryByRole("region",{name:"月度会员版本历史"})).not.toBeInTheDocument())
 expect(screen.queryByRole("button",{name:"查看月度会员版本历史"})).not.toBeInTheDocument()
})

it("keeps the original command frozen if a found receipt is newer than the current projection",async()=>{
 let input:Record<string,unknown>|null=null
 fixture((url,init)=>{if(url.includes("renewal-requests"))return response(receipt(input!));input=JSON.parse(init!.body as string);throw new TypeError("lost")})
 render(<EntitlementsWorkspace fixedUser={fixedUser} csrfToken="csrf"/>)
 await openAndFill();await userEvent.click(screen.getByRole("button",{name:"确认续期"}));await screen.findByRole("alert")
 await userEvent.click(screen.getByRole("button",{name:"核实原续期回执"}))
 await screen.findByText(/当前权益.*不一致/)
 expect(screen.getByRole("dialog")).toBeInTheDocument()
 expect(screen.getByLabelText("新到期时间")).toBeDisabled()
})

it("keeps a late type conflict refresh hidden after read permission withdrawal",async()=>{
 let resolveRead:(value:Response)=>void=()=>{}
 const delayed=new Promise<Response>(resolve=>{resolveRead=resolve})
 const fetcher=fixture(),implementation=fetcher.getMockImplementation()!
 let reads=0
 fetcher.mockImplementation(async(url,init)=>{
  if(init?.method==="PUT")return response(null,409)
  if(String(url).includes("/types")&&++reads>1)return delayed
  return implementation(url,init)
 })
 const view=render(<EntitlementsWorkspace/>)
 await userEvent.click(await screen.findByRole("button",{name:"发布下一版本"}))
 fireEvent.change(screen.getByLabelText("每日主题数"),{target:{value:"1"}})
 await userEvent.click(screen.getByRole("button",{name:"确认发布"}))
 await screen.findByRole("button",{name:"刷新最新数据"})
 await userEvent.click(screen.getByRole("button",{name:"刷新最新数据"}))
 view.rerender(<EntitlementsWorkspace canReadTypes={false}/>)
 await act(async()=>{resolveRead(response([{id:kind,internal_key:"monthly_vip",display_name:"月度会员",status:"active",current_version:3,permission_keys:["board.read"],quotas:{"topic.create.daily":1},revision:3,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"}]));await delayed})
 await waitFor(()=>expect(screen.queryByRole("button",{name:"查看月度会员版本历史"})).not.toBeInTheDocument())
 expect(screen.queryByRole("region",{name:"月度会员版本历史"})).not.toBeInTheDocument()
})
