import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AdminApiError, getAdminContentAccessPolicy, listAdminCommunityGroups, putAdminContentAccessPolicy, type AdminBoard, type AdminCommunityGroup } from "../api/admin"
import { listAdminUsers } from "../api/adminUsers"
import { getBoardPermissionMatrix, type BoardPermissionMatrix as MatrixData, type PermissionMatrixScenario } from "../api/boardPermissions"
import { BoardPermissionMatrix } from "./BoardPermissionMatrix"

vi.mock("../api/admin", async () => ({ ...await vi.importActual<typeof import("../api/admin")>("../api/admin"), listAdminCommunityGroups: vi.fn(), getAdminContentAccessPolicy: vi.fn(), putAdminContentAccessPolicy: vi.fn() }))
vi.mock("../api/adminUsers", () => ({ listAdminUsers: vi.fn() }))
vi.mock("../api/boardPermissions", () => ({ getBoardPermissionMatrix: vi.fn() }))
const stamp = "2026-10-03T00:00:00Z"
const board: AdminBoard = { id: "019fc900-0000-7000-8000-000000000101", parentId: null, slug: "development", name: "技术交流", description: "", icon: "code", tone: "blue", position: 0, visibility: "public", status: "open", mergedIntoBoardId: null, topicCount: 0, revision: 4 }
const groups: AdminCommunityGroup[] = Array.from({ length: 5 }, (_, index) => ({ id: "019fc900-0000-7000-8000-00000000020" + index, internalKey: "matrix_" + index, displayName: index === 0 ? "注册成员" : "场景组" + index, description: "", displayOrder: index, isBase: index === 0, isDefault: index === 0, status: "active", permissionKeys: [], quotas: {}, revision: 1, createdAt: stamp, updatedAt: stamp }))
const candidate = { id: "019fc900-0000-7000-8000-000000000401", username: "tester", displayName: "指定会员", avatarUrl: null, status: "active" as const, primaryRole: null, topicCount: 0, postCount: 0, reportCount: 0, createdAt: stamp, lastSeenAt: null }
const keys = ["content.access_policies.read", "content.access_policies.write", "community.groups.read", "admin.users.read", "community.memberships.read", "entitlements.types.read", "entitlements.grants.read", "authorization.assignments.read"]
const actionKeys = ["browse", "topic_create", "reply_create", "attachment_upload", "attachment_download"] as const
const policy = { id: "policy-a", targetType: "board" as const, targetId: board.id, operator: "all_of" as const, subjects: [{ subjectType: "authenticated" as const, communityGroupId: null, subjectKey: null }], revision: 7, createdAt: stamp, updatedAt: stamp }
function groupScenario(group: AdminCommunityGroup): PermissionMatrixScenario {
  return { id: group.id, kind: "group", display_name: group.displayName, complete: false, sources: [], quotas: [], actions: actionKeys.map(action => ({ action, decision: "not_provided", reason: "scenario.other_sources_unknown", permission_provided: false, source_ids: [] })) }
}
function userScenario(): PermissionMatrixScenario {
  const sourceId = "019fc900-0000-7000-8000-000000000501"
  return { id: candidate.id, kind: "user", display_name: candidate.displayName, complete: true,
    sources: [{ id: sourceId, kind: "entitlement", key: "matrix_upload", display_name: "上传权益", permission_keys: ["attachment.upload"], quotas: { "attachment.upload.daily": 20 }, type_version: 1, starts_at: stamp, ends_at: "2030-01-01T00:00:00Z" }],
    quotas: [{ key: "attachment.upload.daily", limit: 20, used: 3, source_ids: [sourceId] }],
    actions: actionKeys.map(action => ({ action, decision: "missing_context", reason: "resource.context_required", permission_provided: action === "attachment_upload", source_ids: action === "attachment_upload" ? [sourceId] : [] })) }
}
function data(ids: string[], userId?: string): MatrixData { return { board_id: board.id, visibility: "public", evaluated_at: stamp, policy_revision: 7, scenarios: [...ids.map(id => groupScenario(groups.find(g => g.id === id)!)), ...(userId ? [userScenario()] : [])] } }
beforeEach(() => {
  vi.mocked(listAdminCommunityGroups).mockResolvedValue(groups)
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [candidate], nextCursor: null })
  vi.mocked(getBoardPermissionMatrix).mockImplementation(async (_, ids, userId) => data(ids, userId))
  vi.mocked(getAdminContentAccessPolicy).mockResolvedValue(policy)
  vi.mocked(putAdminContentAccessPolicy).mockResolvedValue({ ...policy, operator: "any_of", revision: 8 })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
function setup(capabilityKeys = keys) { return render(<BoardPermissionMatrix board={board} capabilityKeys={capabilityKeys} csrfToken="csrf" onBusyChange={vi.fn()} />) }
async function selectGroup(user: ReturnType<typeof userEvent.setup>, name = "注册成员") { await user.click(await screen.findByRole("checkbox", { name: new RegExp(name) })) }
async function presetPreview(user: ReturnType<typeof userEvent.setup>) { await user.selectOptions(screen.getByLabelText("访问策略预设"), "selected_groups"); await user.click(screen.getByRole("button", { name: "预览访问预设" })); return screen.findByRole("alertdialog", { name: "确认应用访问预设" }) }

describe("V3 effective permission matrix", () => {
  it("loads groups locally and bounds the read-only scenario selection to four", async () => {
    const user = userEvent.setup(); setup(); await screen.findByRole("checkbox", { name: /注册成员/ })
    expect(getBoardPermissionMatrix).not.toHaveBeenCalled()
    for (const name of ["注册成员", "场景组1", "场景组2", "场景组3"]) await selectGroup(user, name)
    expect(screen.getByRole("checkbox", { name: /场景组4/ })).toBeDisabled()
    await screen.findByRole("table")
    expect(screen.getAllByText("本组未提供")).toHaveLength(20)
    expect(screen.queryByRole("button", { name: "保存版块" })).not.toBeInTheDocument()
    expect(getAdminContentAccessPolicy).not.toHaveBeenCalled()
  })
  it("shows actual entitlement upload sources and quota without claiming final permission", async () => {
    const user = userEvent.setup(); setup(); await selectGroup(user)
    await user.type(screen.getByLabelText("搜索用户"), "tester")
    await user.click(await screen.findByRole("button", { name: "选择指定会员 @tester" }))
    const sources = await screen.findByRole("button", { name: "指定会员 00000401 主题附件上传 来源" })
    await user.click(sources)
    const dialog = screen.getByRole("dialog")
    await waitFor(() => expect(within(dialog).getByRole("heading")).toHaveFocus())
    expect(within(dialog).getByText("权益：上传权益")).toBeInTheDocument()
    expect(within(dialog).getByText(/上限 20 · 已用 3/)).toBeInTheDocument()
    expect(within(dialog).getByText(/不是最终允许/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "关闭来源" }))
    await waitFor(() => expect(sources).toHaveFocus())
    expect(putAdminContentAccessPolicy).not.toHaveBeenCalled()
  })
  it("discards an old snapshot after the selected groups change even if transport ignores abort", async () => {
    const user = userEvent.setup(); let resolve!: (value: MatrixData) => void
    vi.mocked(getBoardPermissionMatrix).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    setup(); await selectGroup(user); await waitFor(() => expect(getBoardPermissionMatrix).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(getBoardPermissionMatrix).mock.calls[0][3]!
    await selectGroup(user, "场景组1"); await screen.findByRole("table")
    const old = data([groups[0].id]); old.scenarios[0].display_name = "过期旧响应"
    await act(async () => { resolve(old); await Promise.resolve() })
    expect(signal.aborted).toBe(true)
    expect(screen.queryByText("过期旧响应")).not.toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: /场景组1/ })).toBeInTheDocument()
  })
  it("retries a failed matrix locally and does not load strategy data", async () => {
    const user = userEvent.setup(); vi.mocked(getBoardPermissionMatrix).mockRejectedValueOnce(new Error("暂时不可用"))
    setup(); await screen.findByRole("checkbox", { name: /注册成员/ })
    fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "tester" } })
    await user.click(await screen.findByRole("button", { name: "选择指定会员 @tester" }))
    await screen.findByRole("alert")
    expect(listAdminUsers).toHaveBeenCalledTimes(1)
    vi.mocked(listAdminUsers).mockRejectedValue(new Error("用户搜索不可用"))
    await user.click(screen.getByRole("button", { name: "重试权限检查" })); await screen.findByRole("table")
    expect(listAdminUsers).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("用户搜索失败，请重新输入或重试。")).not.toBeInTheDocument()
    expect(getAdminContentAccessPolicy).not.toHaveBeenCalled()
  })
  it("does not search other users or offer writes without their explicit capabilities", async () => {
    setup(["content.access_policies.read", "community.groups.read"])
    await screen.findByRole("checkbox", { name: /注册成员/ })
    expect(screen.queryByLabelText("搜索用户")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "预览访问预设" })).toBeDisabled()
    expect(listAdminUsers).not.toHaveBeenCalled()
  })
  it("compares all current subjects, cancels without writing, then confirms the exact selected IDs and revision", async () => {
    const user = userEvent.setup(); setup(); await selectGroup(user); let dialog = await presetPreview(user)
    expect(within(dialog).getByText("保存前 · 修订 7")).toBeInTheDocument()
    expect(within(dialog).getByText("满足全部主体")).toBeInTheDocument()
    expect(within(dialog).getByText("确认后 · 满足任一主体")).toBeInTheDocument()
    expect(putAdminContentAccessPolicy).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(putAdminContentAccessPolicy).not.toHaveBeenCalled()
    dialog = await presetPreview(user)
    await user.click(within(dialog).getByRole("button", { name: "确认保存预设" }))
    await screen.findByText("访问预设已保存，已重新读取权限结果。")
    expect(putAdminContentAccessPolicy).toHaveBeenCalledWith("board", board.id, { operator: "any_of", subjects: [{ subjectType: "community_group", communityGroupId: groups[0].id, subjectKey: null }], expectedRevision: 7 }, "csrf")
  })
  it("rejects a forcibly selected unsupported preset without reading or writing a policy", async () => {
    setup(); fireEvent.change(screen.getByLabelText("访问策略预设"), { target: { value: "deny_priority" } })
    expect(screen.getByRole("button", { name: "预览访问预设" })).toBeDisabled()
    expect(getAdminContentAccessPolicy).not.toHaveBeenCalled()
    expect(putAdminContentAccessPolicy).not.toHaveBeenCalled()
  })
  it("preserves preset choices after 409 and blocks confirmation until the new baseline is compared", async () => {
    const user = userEvent.setup(); vi.mocked(putAdminContentAccessPolicy).mockRejectedValueOnce(new AdminApiError(409, "content.access_policy_conflict", "版本冲突"))
    setup(); await selectGroup(user); const dialog = await presetPreview(user)
    await user.click(within(dialog).getByRole("button", { name: "确认保存预设" }))
    await within(dialog).findByText("版本冲突")
    expect(within(dialog).getByRole("button", { name: "确认保存预设" })).toBeDisabled()
    expect(screen.getByLabelText("访问策略预设")).toHaveValue("selected_groups")
    vi.mocked(getAdminContentAccessPolicy).mockResolvedValueOnce({ ...policy, revision: 9 })
    await user.click(within(dialog).getByRole("button", { name: "刷新当前策略重新比较" }))
    await within(dialog).findByText("保存前 · 修订 9")
    await user.click(within(dialog).getByRole("button", { name: "确认保存预设" }))
    await screen.findByText("访问预设已保存，已重新读取权限结果。")
    expect(putAdminContentAccessPolicy).toHaveBeenLastCalledWith("board", board.id, expect.objectContaining({ expectedRevision: 9 }), "csrf")
  })
})

it("links a source snapshot to a specific user check with the exact board and action", async () => {
  const user=userEvent.setup();setup();fireEvent.change(screen.getByLabelText("搜索用户"),{target:{value:"tester"}})
  await user.click(await screen.findByRole("button",{name:"选择指定会员 @tester"}))
  await user.click(await screen.findByRole("button",{name:"指定会员 00000401 主题附件上传 来源"}))
  const link=screen.getByRole("link",{name:"检查具体用户与资源"})
  expect(link).toHaveAttribute("href","#admin/inspect?"+new URLSearchParams({board_id:board.id,action:"attachment_upload",user_id:candidate.id}))
})

it("changes the single scenario view without fetching or mutating and falls back after removal", async () => {
  const user = userEvent.setup(); setup(); await selectGroup(user); await selectGroup(user, "场景组1")
  const selector = await screen.findByRole("combobox", { name: "查看权限场景" })
  const calls = vi.mocked(getBoardPermissionMatrix).mock.calls.length
  await user.selectOptions(selector, "group:" + groups[1].id)
  await user.click(screen.getByRole("button", { name: "场景组1 00000201 浏览版块 来源" }))
  expect(screen.getByRole("dialog")).toHaveAccessibleName("场景组1 · 浏览版块来源")
  await user.keyboard("{Escape}")
  expect(getBoardPermissionMatrix).toHaveBeenCalledTimes(calls)
  expect(putAdminContentAccessPolicy).not.toHaveBeenCalled()
  await selectGroup(user, "场景组1")
  await waitFor(() => expect(screen.getByRole("combobox", { name: "查看权限场景" })).toHaveValue("group:" + groups[0].id))
})
