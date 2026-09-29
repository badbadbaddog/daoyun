import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react"
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest"
import {DraftShelf} from "./DraftShelf"
import {DraftApiError,saveDraft,listDrafts,getDraft} from "../api/drafts"
vi.mock("../api/drafts",async()=>{const actual=await vi.importActual<typeof import("../api/drafts")>("../api/drafts");return {...actual,saveDraft:vi.fn(),listDrafts:vi.fn(),getDraft:vi.fn(),deleteDraft:vi.fn()}})
const content={title:"本地内容",board_id:null,rich_content:{type:"doc" as const,content:[]},images:[],poll:null}
const row={id:"00000000-0000-4000-8000-000000000001",revision:1,content,updated_at:"2026-09-16T00:00:00Z"}
describe("DraftShelf",()=>{
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
})
