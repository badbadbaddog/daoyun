import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as api from "../api/admin"
import { listAdminUsers } from "../api/adminUsers"
import { BoardAdminPanel } from "./BoardAdminPanel"

vi.mock("../api/admin", async () => ({ ...await vi.importActual<typeof import("../api/admin")>("../api/admin"), listAdminCommunityGroups: vi.fn(), listStandardEntitlementTypes: vi.fn(), listAuthorizationPermissions: vi.fn(), listAuthorizationRoles: vi.fn(), listAuthorizationAssignments: vi.fn(), createAuthorizationAssignment: vi.fn(), getAdminContentAccessPolicy: vi.fn(), putAdminContentAccessPolicy: vi.fn(), updateAdminBoard: vi.fn(), createAdminBoard: vi.fn(), listAdminBoards: vi.fn() }))
vi.mock("../api/adminUsers", () => ({ listAdminUsers: vi.fn() }))
const stamp = "2026-10-03T00:00:00Z"
const board: api.AdminBoard = { id: "019fc900-0000-7000-8000-000000000101", parentId: null, slug: "development", name: "技术交流", description: "交流开发", icon: "code", tone: "blue", position: 0, visibility: "public", status: "open", mergedIntoBoardId: null, topicCount: 3, revision: 4 }
const group = (id: string, status: api.CommunityGroupStatus = "active"): api.AdminCommunityGroup => ({ id, internalKey: "internal_" + id.slice(-3), displayName: "内测成员", description: "", displayOrder: 0, isBase: false, isDefault: false, status, permissionKeys: [], quotas: {}, revision: 1, createdAt: stamp, updatedAt: stamp })
const groups = [group("019fc900-0000-7000-8000-000000000201"), group("019fc900-0000-7000-8000-000000000202"), group("019fc900-0000-7000-8000-000000000203", "disabled")]
const role: api.AuthorizationRole = { id: "019fc900-0000-7000-8000-000000000301", key: "development_moderator", name: "版主", scope: "board", isSystem: false, permissionKeys: ["moderation.topic"], assignmentCount: 0, revision: 1, createdAt: stamp, updatedAt: stamp }
const candidate = { id: "019fc900-0000-7000-8000-000000000401", username: "tester", displayName: "内测管理员", avatarUrl: null, status: "active" as const, primaryRole: null, topicCount: 0, postCount: 0, reportCount: 0, createdAt: stamp, lastSeenAt: null }
const assignment: api.AuthorizationRoleAssignment = { id: "019fc900-0000-7000-8000-000000000501", user: candidate, role, scopeId: board.id, scopeMode: "exact", assignedBy: candidate, createdAt: stamp }
const capabilities = ["content.access_policies.read", "content.access_policies.write", "community.groups.read", "entitlements.types.read", "authorization.roles.read", "authorization.assignments.read", "authorization.assignments.write", "admin.users.read"]
beforeEach(() => {
  vi.mocked(api.listAdminCommunityGroups).mockResolvedValue(groups)
  vi.mocked(api.listStandardEntitlementTypes).mockResolvedValue([{ id: "type-a", internalKey: "beta_access", displayName: "内测访问权", status: "active", currentVersion: 1, permissionKeys: [], quotas: {}, revision: 1, createdAt: stamp, updatedAt: stamp }])
  vi.mocked(api.listAuthorizationPermissions).mockResolvedValue([{ key: "moderation.topic", name: "管理主题", description: "" }, { key: "admin.configuration.write", name: "修改配置", description: "" }])
  vi.mocked(api.listAuthorizationRoles).mockResolvedValue([role, { ...role, id: "site-role", scope: "site", name: "站点管理员" }, { ...role, id: "system-role", isSystem: true, name: "系统角色" }])
  vi.mocked(api.listAuthorizationAssignments).mockResolvedValue({ assignments: [], nextCursor: null })
  vi.mocked(api.createAuthorizationAssignment).mockResolvedValue(assignment)
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [candidate], nextCursor: null })
  vi.mocked(api.getAdminContentAccessPolicy).mockResolvedValue({ id: "policy-a", targetType: "board", targetId: board.id, operator: "any_of", subjects: [{ subjectType: "authenticated", communityGroupId: null, subjectKey: null }], revision: 7, createdAt: stamp, updatedAt: stamp })
  vi.mocked(api.putAdminContentAccessPolicy).mockImplementation(async (_, targetId, input) => ({ id: "policy-a", targetType: "board", targetId, ...input, revision: 8, createdAt: stamp, updatedAt: stamp }))
  vi.mocked(api.updateAdminBoard).mockImplementation(async (_, input) => ({ ...board, ...input, revision: input.expectedRevision + 1 }))
  vi.mocked(api.createAdminBoard).mockImplementation(async input => ({ ...board, ...input }))
  vi.mocked(api.listAdminBoards).mockResolvedValue([board])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
function setup(keys = capabilities) { return render(<BoardAdminPanel boards={[board]} csrfToken="csrf" canWrite onChange={vi.fn()} capabilityKeys={keys} />) }
async function openAccess(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByRole("button", { name: "更多操作：技术交流" })); await user.click(screen.getByRole("menuitem", { name: "访问策略" })); await screen.findByLabelText("访问主体 1") }
async function openGovernance(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByRole("button", { name: "更多操作：技术交流" })); await user.click(screen.getByRole("menuitem", { name: "治理人员" })) }

describe("V3 board settings", () => {
  it("selects groups by searchable names while saving their stable IDs", async () => {
    const user = userEvent.setup(); setup(); await openAccess(user)
    expect(api.listAdminCommunityGroups).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByLabelText("访问主体 1"), "community_group")
    const picker = await screen.findByLabelText("社区用户组 1")
    await screen.findByRole("option", { name: "内测成员 · 00000202" })
    expect(screen.queryByLabelText("社区用户组 ID 1")).not.toBeInTheDocument()
    expect(within(picker).queryByRole("option", { name: "内测成员 · 00000203" })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText("搜索社区用户组 1"), "内测")
    await user.selectOptions(picker, groups[1].id)
    await user.click(screen.getByRole("button", { name: "保存访问策略" }))
    expect(api.putAdminContentAccessPolicy).toHaveBeenCalledWith("board", board.id, { operator: "any_of", subjects: [{ subjectType: "community_group", communityGroupId: groups[1].id, subjectKey: null }], expectedRevision: 7 }, "csrf")
  })
  it("selects entitlement and governance names without entering technical keys", async () => {
    const user = userEvent.setup(); setup(); await openAccess(user)
    await user.selectOptions(screen.getByLabelText("访问主体 1"), "entitlement")
    await screen.findByRole("option", { name: "内测访问权 · beta_access" })
    await user.selectOptions(screen.getByLabelText("标准权益 1"), "beta_access")
    await user.click(screen.getByRole("button", { name: "添加访问主体" }))
    await user.selectOptions(screen.getByLabelText("访问主体 2"), "governance")
    await screen.findByRole("option", { name: "管理主题 · moderation.topic" })
    expect(screen.queryByRole("option", { name: "修改配置 · admin.configuration.write" })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("治理权限 2"), "moderation.topic")
    await user.click(screen.getByRole("button", { name: "保存访问策略" }))
    expect(api.putAdminContentAccessPolicy).toHaveBeenCalledWith("board", board.id, expect.objectContaining({ subjects: [{ subjectType: "entitlement", communityGroupId: null, subjectKey: "beta_access" }, { subjectType: "governance", communityGroupId: null, subjectKey: "moderation.topic" }] }), "csrf")
  })
  it("keeps selected IDs when the catalog fails and retries only the required source", async () => {
    const user = userEvent.setup(); setup(); await openAccess(user)
    vi.mocked(api.listAdminCommunityGroups).mockRejectedValueOnce(new Error("offline"))
    await user.selectOptions(screen.getByLabelText("访问主体 1"), "community_group")
    await screen.findByText("社区用户组暂时无法加载。")
    await user.click(screen.getByRole("button", { name: "重试社区用户组" }))
    await screen.findByRole("option", { name: "内测成员 · 00000201" })
    expect(api.listStandardEntitlementTypes).not.toHaveBeenCalled()
  })
  it("does not load unauthorized subject catalogs", async () => {
    const user = userEvent.setup(); setup(["content.access_policies.read", "content.access_policies.write"]); await openAccess(user)
    await user.selectOptions(screen.getByLabelText("访问主体 1"), "community_group")
    expect(await screen.findByText("没有读取社区用户组的权限。" )).toBeInTheDocument()
    expect(api.listAdminCommunityGroups).not.toHaveBeenCalled()
  })
  it("offers a named icon and previews its actual appearance", async () => {
    const user = userEvent.setup(); setup(); await user.click(screen.getByRole("button", { name: "编辑设置：技术交流" })); await user.click(screen.getByRole("button", { name: "外观展示" }))
    await user.selectOptions(screen.getByLabelText("版块图标"), "aperture")
    expect(screen.getByTestId("board-icon-preview").querySelector(".lucide-aperture")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "保存版块" }))
    expect(api.updateAdminBoard).toHaveBeenCalledWith(board.id, expect.objectContaining({ icon: "aperture", slug: "development", expectedRevision: 4 }), "csrf")
  })
  it("creates from a name with an automatically generated fixed slug", async () => {
    const user = userEvent.setup(); setup(); await user.click(screen.getByRole("button", { name: "新建顶级版块" })); await user.type(screen.getByLabelText("版块名称"), "内测讨论")
    await user.click(screen.getByRole("button", { name: "创建顶级版块" }))
    expect(api.createAdminBoard).toHaveBeenCalledWith(expect.objectContaining({ name: "内测讨论", slug: expect.stringMatching(/^board-[a-f0-9-]{36}$/) }), "csrf")
  })
  it("explains that hidden boards are absent from the directory and reject direct reads", async () => {
    const user = userEvent.setup(); setup(); await user.click(screen.getByRole("button", { name: "编辑设置：技术交流" }))
    expect(screen.getByText("隐藏版块不出现在公共目录，直接访问也会被拒绝；公开版块仍需满足自身访问策略。" )).toBeInTheDocument()
  })
  it("confirms a local appointment with the fixed board ID and exact scope", async () => {
    const user = userEvent.setup(); setup(); await openGovernance(user)
    await screen.findByRole("option", { name: "版主 · 00000301" })
    expect(screen.queryByRole("option", { name: /站点管理员|系统角色/ })).not.toBeInTheDocument()
    expect(api.listAuthorizationAssignments).toHaveBeenCalledWith(expect.objectContaining({ scopeId: board.id }))
    await user.type(screen.getByLabelText("搜索用户"), "tester")
    await user.click(await screen.findByRole("button", { name: "选择内测管理员 @tester" }))
    await user.selectOptions(screen.getByLabelText("版块角色"), role.id)
    await user.click(screen.getByRole("button", { name: "添加管理人员" }))
    const dialog = screen.getByRole("alertdialog", { name: "确认版块任命" })
    expect(within(dialog).getByText("技术交流（仅本版块）")).toBeInTheDocument()
    expect(api.createAuthorizationAssignment).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole("button", { name: "确认任命" }))
    expect(api.createAuthorizationAssignment).toHaveBeenCalledWith({ username: "tester", roleId: role.id, scopeId: board.id, scopeMode: "exact" }, "csrf")
    expect(await screen.findByText("任命已保存")).toBeInTheDocument()
    expect(api.updateAdminBoard).not.toHaveBeenCalled()
  })
  it("blocks duplicate appointments, closing and section switches while saving", async () => {
    const user = userEvent.setup(); let resolve!: (value: api.AuthorizationRoleAssignment) => void
    vi.mocked(api.createAuthorizationAssignment).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    setup(); await openGovernance(user); await screen.findByRole("option", { name: "版主 · 00000301" }); await user.type(screen.getByLabelText("搜索用户"), "tester"); await user.click(await screen.findByRole("button", { name: "选择内测管理员 @tester" })); await user.selectOptions(screen.getByLabelText("版块角色"), role.id); await user.click(screen.getByRole("button", { name: "添加管理人员" }))
    const confirm = screen.getByRole("button", { name: "确认任命" }); act(() => { fireEvent.click(confirm); fireEvent.click(confirm) })
    expect(api.createAuthorizationAssignment).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "基本信息" })).toBeDisabled()
    await user.keyboard("{Escape}")
    expect(screen.getByRole("alertdialog", { name: "确认版块任命" })).toBeInTheDocument()
    await act(async () => { resolve(assignment); await Promise.resolve() })
    expect(await screen.findByText("任命已保存")).toBeInTheDocument()
  })
  it("does not search users or appoint without the assignment write capability", async () => {
    const user = userEvent.setup(); setup(capabilities.filter(key => key !== "authorization.assignments.write")); await openGovernance(user); await screen.findByText("没有任命管理人员的权限。")
    expect(screen.queryByRole("button", { name: "添加管理人员" })).not.toBeInTheDocument()
    expect(listAdminUsers).not.toHaveBeenCalled()
  })
})

it("allows access-policy writers without granting configuration writes", async () => {
  const user = userEvent.setup()
  render(<BoardAdminPanel boards={[board]} csrfToken="csrf" canWrite={false} capabilityKeys={["content.access_policies.read", "content.access_policies.write"]} onChange={vi.fn()} requestedQuery={"board_id=" + board.id} />)
  await screen.findByRole("dialog", { name: "查看“技术交流”" }); await user.click(screen.getByRole("button", { name: "访问权限" }))
  await screen.findByLabelText("访问策略匹配方式")
  expect(screen.getByLabelText("访问策略匹配方式")).toBeEnabled()
  await user.selectOptions(screen.getByLabelText("访问策略匹配方式"), "all_of"); await user.click(screen.getByRole("button", { name: "保存访问策略" }))
  expect(api.putAdminContentAccessPolicy).toHaveBeenCalledWith("board", board.id, expect.objectContaining({ operator: "all_of" }), "csrf")
  expect(api.updateAdminBoard).not.toHaveBeenCalled()
})
it("does not infer access-policy writes from configuration writes", async () => {
  const user = userEvent.setup(); setup(["content.access_policies.read"]); await openAccess(user)
  expect(screen.getByLabelText("访问策略匹配方式")).toBeDisabled()
  expect(screen.queryByRole("button", { name: "保存访问策略" })).not.toBeInTheDocument()
})
it("does not request access policies without their read capability", async () => {
  const user = userEvent.setup(); setup([]); await user.click(screen.getByRole("button", { name: "编辑设置：技术交流" })); await user.click(screen.getByRole("button", { name: "访问权限" }))
  expect(screen.getByText("没有读取访问策略的权限。")).toBeInTheDocument()
  expect(api.getAdminContentAccessPolicy).not.toHaveBeenCalled()
})

it("explains that hiding a parent does not change each child's visibility", async () => {
  const user = userEvent.setup(); setup(); await user.click(screen.getByRole("button", { name: "编辑设置：技术交流" }))
  expect(screen.getByText("可见状态仅作用于本版块，不会自动隐藏子版块；子版块需分别设置。" )).toBeInTheDocument()
})

it("explains that tree parents do not automatically apply their access policy to children", async () => {
  const user = userEvent.setup(); setup(); await user.click(screen.getByRole("button", { name: "编辑设置：技术交流" })); await user.click(screen.getByRole("button", { name: "访问权限" }))
  expect(screen.getByText("树层级不会自动继承版块访问策略；子版块需分别设置。主题、回复和附件仍须满足所属版块及自身内容的访问条件。" )).toBeInTheDocument()
})

it("opens a read-only effective permission matrix without loading unrelated settings", async () => {
  const user = userEvent.setup(); setup();
  await user.click(screen.getByRole("button", { name: "编辑设置：技术交流" }));
  expect(api.listAdminCommunityGroups).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "有效权限" }));
  expect(await screen.findByRole("heading", { name: "版块有效权限" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存版块" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存访问策略" })).not.toBeInTheDocument();
  expect(api.listStandardEntitlementTypes).not.toHaveBeenCalled();
});

it("disables unsupported permission presets instead of dropping conditions", async () => {
  const user = userEvent.setup(); setup();
  await user.click(screen.getByRole("button", { name: "编辑设置：技术交流" }));
  await user.click(screen.getByRole("button", { name: "有效权限" }));
  const presets = screen.getByLabelText("访问策略预设");
  expect(within(presets).getByRole("option", { name: "显式拒绝优先（当前不支持）" })).toBeDisabled();
  expect(within(presets).getByRole("option", { name: "自动继承父版策略（当前不支持）" })).toBeDisabled();
  expect(api.putAdminContentAccessPolicy).not.toHaveBeenCalled();
});
