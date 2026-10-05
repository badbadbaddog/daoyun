import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react"
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest"
import {createRef} from "react"
import {DraftShelf,type DraftHandle} from "./DraftShelf"
import {DraftApiError,saveDraft,listDrafts,getDraft} from "../api/drafts"
vi.mock("../api/drafts",async()=>{const actual=await vi.importActual<typeof import("../api/drafts")>("../api/drafts");return {...actual,saveDraft:vi.fn(),listDrafts:vi.fn(),getDraft:vi.fn(),deleteDraft:vi.fn()}})
const content={title:"本地内容",board_id:null,rich_content:{type:"doc" as const,content:[]},images:[],poll:null}
const row={id:"00000000-0000-4000-8000-000000000001",revision:1,content,updated_at:"2026-09-16T00:00:00Z"}
describe("DraftShelf",()=>{
 it("ignores a stale unauthorized save after the same owner rotates CSRF",async()=>{
  const handle=createRef<DraftHandle>();const expired=vi.fn();let reject!: (error:Error)=>void
  vi.mocked(saveDraft).mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail})).mockResolvedValue(row)
  const props={ref:handle,ownerId:"user-a",storageKey:"draft-test",ready:false,content,onRestore:vi.fn(),onSessionExpired:expired}
  const view=render(<DraftShelf {...props} csrfToken="old-csrf" />)
  let first!:Promise<unknown>
  act(()=>{first=handle.current!.flush().catch(()=>undefined)})
  await waitFor(()=>expect(saveDraft).toHaveBeenCalledTimes(1))
  view.rerender(<DraftShelf {...props} csrfToken="new-csrf" />)
  await act(async()=>{reject(new DraftApiError(401,"auth.unauthenticated","旧会话失效"));await first})
  expect(expired).not.toHaveBeenCalled()
  await act(async()=>{await handle.current!.flush()})
  expect(vi.mocked(saveDraft).mock.calls[1][3]).toBe("new-csrf")
 })

 it("stops queued writes and requests recovery after an unauthorized save",async()=>{
  const handle=createRef<DraftHandle>();const expired=vi.fn()
  vi.mocked(saveDraft).mockRejectedValue(new DraftApiError(401,"auth.unauthenticated","登录失效"))
  render(<DraftShelf ref={handle} ownerId="user-a" csrfToken="csrf" storageKey="draft-test" ready={false} content={content} onRestore={vi.fn()} onSessionExpired={expired} />)
  let first!:Promise<unknown>;let queued!:Promise<unknown>
  act(()=>{first=handle.current!.flush().catch(()=>undefined);queued=handle.current!.flush().catch(()=>undefined)})
  await act(async()=>{await Promise.all([first,queued])})
  expect(expired).toHaveBeenCalledTimes(1)
  expect(saveDraft).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem("draft-test:server:user-a")).toContain('"revision":0')
 })
 afterEach(cleanup)
 beforeEach(()=>{vi.clearAllMocks();localStorage.clear();vi.mocked(listDrafts).mockResolvedValue({drafts:[],next_cursor:null})})
 it("stops overwrites after a conflict and can save a separate copy",async()=>{
  vi.mocked(saveDraft).mockRejectedValueOnce(new DraftApiError(409,"draft.conflict","另一设备已更新草稿")).mockResolvedValue({...row,revision:1})
  render(<DraftShelf ownerId="user-a" csrfToken="csrf" storageKey="draft-test" ready content={content} onRestore={vi.fn()} />)
  await screen.findByText("另一设备已更新草稿")
  expect(saveDraft).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole("button",{name:"另存本地副本"}))
  await screen.findByText("已同步到草稿箱")
  expect(vi.mocked(saveDraft).mock.calls[1][0]).not.toBe(vi.mocked(saveDraft).mock.calls[0][0])
  expect(vi.mocked(saveDraft).mock.calls[1][1]).toBe(0)
 })
 it("loads a selected server draft rather than an old list snapshot",async()=>{
  vi.mocked(saveDraft).mockResolvedValue(row);vi.mocked(listDrafts).mockResolvedValue({drafts:[row],next_cursor:null});vi.mocked(getDraft).mockResolvedValue({...row,revision:3,content:{...content,title:"另一设备的新内容"}})
  const restore=vi.fn();render(<DraftShelf ownerId="user-a" csrfToken="csrf" storageKey="draft-test" ready content={{...content,title:""}} onRestore={restore} />)
  fireEvent.click(screen.getByRole("button",{name:"打开草稿箱"}));fireEvent.click(await screen.findByRole("button",{name:"继续编辑 本地内容"}))
  await waitFor(()=>expect(restore).toHaveBeenCalledWith(expect.objectContaining({title:"另一设备的新内容"})))
 })

it("cancels retired draft writes and drops queued saves and late metadata",async()=>{
 const handle=createRef<DraftHandle>();let finish!:()=>void
 vi.mocked(saveDraft).mockImplementationOnce((id,revision,payload)=>new Promise(resolve=>{finish=()=>resolve({...row,id,revision:revision+1,content:payload})})).mockResolvedValue(row)
 const view=render(<DraftShelf ref={handle} ownerId="user-a" csrfToken="csrf" storageKey="draft-test" ready={false} content={content} onRestore={vi.fn()} />)
 let first!:Promise<unknown>;let queued!:Promise<unknown>
 act(()=>{first=handle.current!.flush().catch(()=>undefined);queued=handle.current!.flush().catch(()=>undefined)})
 await waitFor(()=>expect(saveDraft).toHaveBeenCalledTimes(1))
 const before=localStorage.getItem("draft-test:server:user-a")
 const signal=(vi.mocked(saveDraft).mock.calls[0] as unknown[])[4] as AbortSignal|undefined
 view.unmount();await act(async()=>finish());await Promise.all([first,queued])
 expect(signal?.aborted).toBe(true)
 expect(saveDraft).toHaveBeenCalledTimes(1)
 expect(localStorage.getItem("draft-test:server:user-a")).toBe(before)
})
})
