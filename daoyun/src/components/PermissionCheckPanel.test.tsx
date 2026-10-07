import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getAdminUser, listAdminUsers } from "../api/adminUsers"
import { getPermissionCheck, type PermissionCheck } from "../api/boardPermissions"
import type { AdminBoard } from "../api/admin"
import { PermissionCheckPanel } from "./PermissionCheckPanel"
vi.mock("../api/adminUsers", () => ({ listAdminUsers: vi.fn(), getAdminUser: vi.fn() }))
vi.mock("../api/boardPermissions", () => ({ getPermissionCheck: vi.fn() }))
const board: AdminBoard = { id: "019fc900-0000-7000-8000-000000000101", parentId: null, slug: "general", name: "社区广场", description: "", icon: "messages", tone: "green", position: 0, visibility: "public", status: "open", mergedIntoBoardId: null, topicCount: 0, revision: 1 }
const candidate = { id: "019fc900-0000-7000-8000-000000000401", username: "tester", displayName: "检查会员", avatarUrl: null, status: "active" as const, primaryRole: null, topicCount: 0, postCount: 0, reportCount: 0, createdAt: "2026-10-03T00:00:00Z", lastSeenAt: null }
const capabilities = ["content.access_policies.read", "community.groups.read", "admin.users.read", "community.memberships.read", "entitlements.types.read", "entitlements.grants.read", "authorization.assignments.read", "authorization.roles.read"]
function data(): PermissionCheck { return { board_id: board.id, topic_id: null, attachment_id: null, file_bytes: null, target_board_id: null, policy_revision: null, topic_revision: null, evaluated_at: "2026-10-03T00:00:00Z",
  scenario: { id: candidate.id, kind: "user", account_status: "active", display_name: candidate.displayName, complete: true,
    sources: [{ id: candidate.id, kind: "group", key: "check_upload", display_name: "检查上传组", permission_keys: ["attachment.upload"], quotas: { "attachment.upload.daily": 20 }, type_version: null, membership_kind: "additional", role: null, starts_at: "2026-10-03T00:00:00Z", ends_at: null }],
    quotas: [{ key: "attachment.upload.daily", limit: 20, used: 19, source_ids: [candidate.id] }],
    actions: [{ action: "browse", decision: "allowed", reason: "resource.conditions_matched", permission_provided: true, source_ids: [candidate.id] }] } } }
beforeEach(() => { vi.mocked(getAdminUser).mockResolvedValue({...candidate,bio:"",location:null,websiteUrl:null,followerCount:0,followingCount:0,roles:[],restrictionReason:null,restrictionExpiresAt:null,revision:1}); vi.mocked(listAdminUsers).mockResolvedValue({ users: [candidate], nextCursor: null }); vi.mocked(getPermissionCheck).mockResolvedValue(data()) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
async function selectUser(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "tester" } })
  await user.click(await screen.findByRole("button", { name: "选择检查会员 @tester" }))
  await user.selectOptions(screen.getByLabelText("检查版块"), board.id)
}
describe("permission check page", () => {
  it("performs an explicit read-only check and shows source, quota and server time", async () => {
    const user = userEvent.setup(); render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} />)
    expect(getPermissionCheck).not.toHaveBeenCalled()
    await selectUser(user); await user.click(screen.getByRole("button", { name: "开始检查" }))
    expect(await screen.findByRole("heading", { name: "当前权限条件满足" })).toBeInTheDocument()
    expect(screen.getByText("用户组：检查上传组")).toBeInTheDocument()
    expect(screen.getByText(/上限 20 个 · 已用 19 个/)).toBeInTheDocument()
    expect(screen.getByText(/不会预留或扣除额度/)).toBeInTheDocument()
    expect(screen.getByText(/服务端当前时刻/)).toBeInTheDocument()
    expect(getPermissionCheck).toHaveBeenCalledWith({ user_id: candidate.id, board_id: board.id, action: "browse" }, expect.any(AbortSignal))
    expect(screen.queryByRole("button", { name: /保存|应用|授予/ })).not.toBeInTheDocument()
  })
  it("reads a selected file size locally and never passes its content to the request", async () => {
    const user = userEvent.setup(); render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} />)
    await selectUser(user); await user.selectOptions(screen.getByLabelText("检查动作"), "attachment_upload")
    fireEvent.change(screen.getByLabelText("主题标识"), { target: { value: "019fc900-0000-7000-8000-000000000501" } })
    await user.upload(screen.getByLabelText("检查文件大小"), new File([new Uint8Array(68)], "check.png", { type: "image/png" }))
    await user.click(screen.getByRole("button", { name: "开始检查" }))
    await waitFor(() => expect(getPermissionCheck).toHaveBeenCalled())
    const input = vi.mocked(getPermissionCheck).mock.calls[0][0]
    expect(input.file_bytes).toBe(68)
    expect(Object.keys(input).sort()).toEqual(["action", "board_id", "file_bytes", "topic_id", "user_id"])
  })
  it("aborts and hides a stale result after a condition changes even if transport ignores abort", async () => {
    let resolve!: (value: PermissionCheck) => void
    vi.mocked(getPermissionCheck).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const user = userEvent.setup(); render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} />)
    await selectUser(user); await user.click(screen.getByRole("button", { name: "开始检查" }))
    await waitFor(() => expect(getPermissionCheck).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(getPermissionCheck).mock.calls[0][1]!
    await user.selectOptions(screen.getByLabelText("检查动作"), "reply_create")
    await act(async () => { const old=data(); old.scenario.display_name="过期检查用户"; resolve(old); await Promise.resolve() })
    expect(signal.aborted).toBe(true)
    expect(screen.queryByText(/过期检查用户/)).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "检查结果" })).not.toBeInTheDocument()
  })
  it("retries only the check and retains user and resource input", async () => {
    vi.mocked(getPermissionCheck).mockRejectedValueOnce(new Error("检查暂时不可用"))
    const user=userEvent.setup(); render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} />)
    await selectUser(user); await user.click(screen.getByRole("button", { name: "开始检查" }))
    await screen.findByRole("alert")
    await user.click(screen.getByRole("button", { name: "重试权限检查" }))
    await screen.findByRole("region", { name: "检查结果" })
    expect(listAdminUsers).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("检查版块")).toHaveValue(board.id)
    expect(getPermissionCheck).toHaveBeenCalledTimes(2)
  })
  it("hides private sources immediately when a required read capability is revoked", async () => {
    const user=userEvent.setup(); const view=render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} />)
    await selectUser(user); await user.click(screen.getByRole("button", { name: "开始检查" }))
    await screen.findByText("用户组：检查上传组")
    view.rerender(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities.slice(1)} />)
    expect(screen.queryByText("用户组：检查上传组")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("搜索用户")).not.toBeInTheDocument()
    expect(screen.getByText(/没有查看指定用户权限/)).toBeInTheDocument()
  })
  it("does not search or diagnose another user without every required read capability", () => {
    render(<PermissionCheckPanel boards={[board]} capabilityKeys={[]} />)
    expect(listAdminUsers).not.toHaveBeenCalled()
    expect(getPermissionCheck).not.toHaveBeenCalled()
  })
  it("blocks malformed resource input before any diagnostic request", async () => {
    const user=userEvent.setup(); render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} />)
    await selectUser(user); await user.selectOptions(screen.getByLabelText("检查动作"), "reply_create")
    fireEvent.change(screen.getByLabelText("主题标识"), { target: { value: "invalid-topic" } })
    await user.click(screen.getByRole("button", { name: "开始检查" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/标识/)
    expect(getPermissionCheck).not.toHaveBeenCalled()
  })
})

it("prefills a linked user's current identity and board without running a diagnostic automatically", async () => {
  const user=userEvent.setup()
  render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} query={"board_id="+board.id+"&user_id="+candidate.id+"&action=attachment_upload"} />)
  await waitFor(() => expect(screen.getByLabelText("检查版块")).toHaveValue(board.id))
  await screen.findByText("指定用户：检查会员 @tester")
  expect(getAdminUser).toHaveBeenCalledWith(candidate.id,expect.any(AbortSignal))
  expect(getPermissionCheck).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button",{name:"开始检查"}))
  await waitFor(() => expect(getPermissionCheck).toHaveBeenCalledWith({board_id:board.id,user_id:candidate.id,action:"attachment_upload"},expect.any(AbortSignal)))
})
it("does not let a late linked-user lookup replace a newly searched user", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getAdminUser>>) => void
  vi.mocked(getAdminUser).mockImplementationOnce(() => new Promise(done => { resolve=done }))
  const user=userEvent.setup();render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} query={"board_id="+board.id+"&user_id="+candidate.id} />)
  await waitFor(() => expect(getAdminUser).toHaveBeenCalledTimes(1));const signal=vi.mocked(getAdminUser).mock.calls[0][1]!
  await selectUser(user)
  await act(async () => { resolve({...candidate,displayName:"过期链接用户",bio:"",location:null,websiteUrl:null,followerCount:0,followingCount:0,roles:[],restrictionReason:null,restrictionExpiresAt:null,revision:1});await Promise.resolve() })
  expect(signal.aborted).toBe(true)
  expect(screen.queryByText(/过期链接用户/)).not.toBeInTheDocument()
})

it("locks the subject to a user detail and does not refetch or search that identity", async () => {
  const user=userEvent.setup()
  render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} fixedUser={candidate} />)
  expect(screen.queryByLabelText("搜索用户")).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"移除指定用户"})).not.toBeInTheDocument()
  expect(getAdminUser).not.toHaveBeenCalled()
  await user.selectOptions(screen.getByLabelText("检查版块"),board.id)
  await user.click(screen.getByRole("button",{name:"开始检查"}))
  await screen.findByRole("region",{name:"检查结果"})
  expect(getPermissionCheck).toHaveBeenCalledWith({user_id:candidate.id,board_id:board.id,action:"browse"},expect.any(AbortSignal))
})

it("shows governance source layers with folded technical facts and hides them when role read is revoked", async () => {
  const snapshot=data();snapshot.scenario.account_status="restricted"
  snapshot.scenario.sources.push({ id:"019fc900-0000-7000-8000-000000000701",kind:"role",key:"board_moderator",display_name:"版主",permission_keys:["moderation.topic.move"],quotas:{},type_version:null,membership_kind:null,starts_at:"2026-10-01T00:00:00Z",ends_at:null,
    role:{id:"019fc900-0000-7000-8000-000000000601",revision:2,scope:"board",scope_id:board.id,scope_mode:"subtree",scope_matches:true,target_scope_matches:null,is_system:false,assigned_by:candidate.id} })
  vi.mocked(getPermissionCheck).mockResolvedValue(snapshot)
  const user=userEvent.setup();const keys=capabilities
  const view=render(<PermissionCheckPanel boards={[board]} capabilityKeys={keys} fixedUser={candidate} />)
  await user.selectOptions(screen.getByLabelText("检查版块"),board.id);await user.click(screen.getByRole("button",{name:"开始检查"}))
  await screen.findByRole("region",{name:"检查结果"})
  expect(screen.getByRole("heading",{name:"账号状态"})).toBeInTheDocument()
  expect(screen.getByText(/当前及全部后代/)).toBeInTheDocument()
  const technical=screen.getByText("技术详情").closest("details")!
  expect(technical).not.toHaveAttribute("open")
  await user.click(screen.getByText("技术详情"));expect(technical).toHaveAttribute("open")
  expect(screen.getByText(/resource.conditions_matched/)).toBeInTheDocument()
  view.rerender(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities.filter(key=>key!=="authorization.roles.read")} fixedUser={candidate} />)
  expect(screen.queryByRole("region",{name:"检查结果"})).not.toBeInTheDocument()
})
it("sends explicit governance move context and invalidates the old result when its destination changes", async () => {
  const user=userEvent.setup();render(<PermissionCheckPanel boards={[board]} capabilityKeys={[...capabilities,"authorization.roles.read"]} fixedUser={candidate} />)
  await user.selectOptions(screen.getByLabelText("检查版块"),board.id)
  await user.selectOptions(screen.getByLabelText("检查动作"),"topic_move")
  fireEvent.change(screen.getByLabelText("主题标识"),{target:{value:"019fc900-0000-7000-8000-000000000501"}})
  fireEvent.change(screen.getByLabelText("目标版块标识"),{target:{value:"019fc900-0000-7000-8000-000000000102"}})
  await user.click(screen.getByRole("button",{name:"开始检查"}))
  await screen.findByRole("region",{name:"检查结果"})
  expect(getPermissionCheck).toHaveBeenCalledWith({user_id:candidate.id,board_id:board.id,action:"topic_move",topic_id:"019fc900-0000-7000-8000-000000000501",target_board_id:"019fc900-0000-7000-8000-000000000102"},expect.any(AbortSignal))
  fireEvent.change(screen.getByLabelText("目标版块标识"),{target:{value:board.id}})
  expect(screen.queryByRole("region",{name:"检查结果"})).not.toBeInTheDocument()
})

it("shows an unrecognized server reason as needing review instead of inventing an allowed explanation", async () => {
  const snapshot=data();snapshot.scenario.actions[0].reason="future.unrecognized"
  vi.mocked(getPermissionCheck).mockResolvedValue(snapshot)
  const user=userEvent.setup();render(<PermissionCheckPanel boards={[board]} capabilityKeys={capabilities} fixedUser={candidate} />)
  await user.selectOptions(screen.getByLabelText("检查版块"),board.id);await user.click(screen.getByRole("button",{name:"开始检查"}))
  expect(await screen.findByRole("heading",{name:"结果需要核对"})).toBeInTheDocument()
  expect(screen.queryByRole("heading",{name:"当前权限条件满足"})).not.toBeInTheDocument()
})
