import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getAdminExperience, listAdminExperienceLedger, adjustAdminExperience, listAdminPointsLedger, grantMembershipPoints, createAuthorizationAssignment, deleteAuthorizationAssignment, listAdminAudit, listAuthorizationAssignments, listAuthorizationRoles, listAdminCommunityGroups, listAdminCommunityGroupMemberships, getAdminGrowthLevels, listStandardEntitlementTypes } from "../api/admin"
import { AdminUsersApiError, getAdminUserMembershipSummary, type AdminUserMembershipSummary, getAdminUser, listAdminUserContent, listAdminUsers, updateAdminUserStatus } from "../api/adminUsers"
import { listAdminUserReports } from "../api/reports"
import { UserAdminPanel } from "./UserAdminPanel"

vi.mock("../api/adminUsers", async () => {
  const actual = await vi.importActual<typeof import("../api/adminUsers")>("../api/adminUsers")
  return { ...actual, getAdminUser: vi.fn(), getAdminUserMembershipSummary: vi.fn(), listAdminUserContent: vi.fn(), listAdminUsers: vi.fn(), updateAdminUserStatus: vi.fn() }
})

vi.mock("../api/admin", async () => {
  const actual = await vi.importActual<typeof import("../api/admin")>("../api/admin")
  return { ...actual, getAdminExperience: vi.fn(), listAdminExperienceLedger: vi.fn(), adjustAdminExperience: vi.fn(), listAdminPointsLedger: vi.fn(), grantMembershipPoints: vi.fn(), createAuthorizationAssignment: vi.fn(), deleteAuthorizationAssignment: vi.fn(), listAdminAudit: vi.fn(), listAuthorizationAssignments: vi.fn(), listAuthorizationRoles: vi.fn(), getAdminGrowthLevels: vi.fn(), listStandardEntitlementTypes: vi.fn(), listAdminCommunityGroups: vi.fn(), listAdminCommunityGroupMemberships: vi.fn() }
})

vi.mock("../api/reports", async () => {
  const actual = await vi.importActual<typeof import("../api/reports")>("../api/reports")
  return { ...actual, listAdminUserReports: vi.fn() }
})

const userId = "019fc800-0000-7000-8000-000000000002"
const secondUserId = "019fc800-0000-7000-8000-000000000003"
const summary = {
  id: userId, username: "member", displayName: "社区成员", avatarUrl: null,
  status: "restricted" as const, primaryRole: "版主", topicCount: 3, postCount: 8,
  reportCount: 2, createdAt: "2026-08-03T10:00:00Z", lastSeenAt: "2026-08-12T08:00:00Z",
}
const detail = {
  ...summary, bio: "保持好奇", location: "杭州", websiteUrl: null, followerCount: 12,
  followingCount: 4, roles: [{ id: userId, key: "moderator", name: "版主", scope: "site" as const, isSystem: false, revision: 1 }],
  restrictionReason: "等待人工复核", restrictionExpiresAt: null, revision: 2,
}

beforeEach(() => {
  vi.mocked(getAdminExperience).mockReset().mockResolvedValue(membershipSummary.experience)
  vi.mocked(listAdminExperienceLedger).mockReset().mockResolvedValue({entries:[],nextCursor:null})
  vi.mocked(adjustAdminExperience).mockReset()
  vi.mocked(listAdminPointsLedger).mockReset().mockResolvedValue({entries:[],nextCursor:null})
  vi.mocked(listAdminUsers).mockReset().mockResolvedValue({ users: [summary], nextCursor: null })
  vi.mocked(getAdminUser).mockReset().mockResolvedValue(detail)
  vi.mocked(getAdminUserMembershipSummary).mockReset().mockImplementation(async id => ({ ...membershipSummary, account: { ...detail, id } }))
  vi.mocked(listAdminUserContent).mockReset().mockResolvedValue({ items: [{ id: userId, kind: "topic", topicId: userId, title: "社区主题", excerpt: "摘要", status: "published", createdAt: "2026-08-03T10:00:00Z" }], nextCursor: null })
  vi.mocked(listAdminUserReports).mockReset().mockResolvedValue({ reports: [], nextCursor: null })
  vi.mocked(updateAdminUserStatus).mockReset().mockResolvedValue({
    userId, status: "suspended", reason: "严重违规", expiresAt: null, revision: 3,
    auditId: secondUserId, actor: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null }, changedAt: "2026-08-12T08:00:00Z",
  })
  vi.mocked(getAdminGrowthLevels).mockReset().mockResolvedValue([])
  vi.mocked(listStandardEntitlementTypes).mockReset().mockResolvedValue([])
  vi.mocked(listAdminCommunityGroups).mockReset().mockResolvedValue([])
  vi.mocked(listAdminCommunityGroupMemberships).mockReset().mockResolvedValue([])
  vi.mocked(listAuthorizationRoles).mockReset().mockResolvedValue([])
  vi.mocked(listAuthorizationAssignments).mockReset().mockResolvedValue({ assignments: [], nextCursor: null })
  vi.mocked(createAuthorizationAssignment).mockReset()
  vi.mocked(deleteAuthorizationAssignment).mockReset().mockResolvedValue(true)
  vi.mocked(listAdminAudit).mockReset().mockResolvedValue({ entries: [{
    id: secondUserId,
    actor: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null },
    action: "user.status.update",
    resourceType: "user",
    resourceId: userId,
    summary: { reason: "绝密内部摘要" },
    createdAt: "2026-08-12T08:00:00Z",
  }], nextCursor: null })
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("UserAdminPanel", () => {
  it("offers community memberships as a separate lazy user-detail tab", async () => {
    const user = userEvent.setup()
    render(<UserAdminPanel canReadGroups canReadGroupMemberships canWriteGroupMemberships csrfToken="csrf-token" />)
    await user.click(await screen.findByRole("button", { name: /社区成员/ }))
    const tab = await screen.findByRole("tab", { name: "会员身份" })
    expect(tab).toHaveAttribute("aria-selected", "false")
    expect(screen.queryByRole("button", { name: "管理权限角色" })).not.toBeInTheDocument()
    expect(listAdminCommunityGroups).toHaveBeenCalledTimes(1)
    expect(listAdminCommunityGroupMemberships).not.toHaveBeenCalled()
    await user.click(tab)
    expect(tab).toHaveAttribute("aria-selected", "true")
    await waitFor(() => expect(listAdminCommunityGroupMemberships).toHaveBeenCalledWith(userId, expect.any(AbortSignal)))
    expect(screen.queryByRole("searchbox", { name: "搜索需要绑定用户组的用户" })).not.toBeInTheDocument()
    expect(createAuthorizationAssignment).not.toHaveBeenCalled()
  })

  it("opens details only in a drawer and keeps action forms behind dialogs", async () => {
    const user = userEvent.setup()
    render(<UserAdminPanel canModerate canAssignRoles csrfToken="csrf-token" />)
    const opener = await screen.findByRole("button", { name: /社区成员/ })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("添加角色")).not.toBeInTheDocument()
    await user.click(opener)
    expect(await screen.findByRole("dialog", { name: "用户详情" })).toBeInTheDocument()
    await user.click(await screen.findByRole("tab", { name: "账号安全" }))
    await user.click(await screen.findByRole("button", { name: "管理账号状态" }))
    expect(screen.getByRole("dialog", { name: "管理账号状态" })).toContainElement(screen.getByLabelText("账号动作"))
    await user.keyboard("{Escape}")
    expect(screen.queryByLabelText("账号动作")).not.toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: "用户详情" })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it("searches by plain-language identity and opens a complete user context", async () => {
    const user = userEvent.setup()
    render(<UserAdminPanel />)

    expect(await screen.findByRole("button", { name: /社区成员/ })).toBeInTheDocument()
    await user.type(screen.getByRole("searchbox", { name: "搜索用户" }), "成员")
    await user.click(screen.getByRole("button", { name: "搜索" }))
    await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ query: "成员" })))

    await user.click(screen.getByRole("button", { name: /社区成员/ }))
    expect(await screen.findByRole("heading", { name: "社区成员" })).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "账号安全" }))
    expect(screen.getByText("等待人工复核")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "概览" }))
    expect(within(screen.getByRole("dialog", { name: "用户详情" })).getByText("版主")).toBeInTheDocument()
    const overviewTab = screen.getByRole("tab", { name: "概览" })
    const contentTab = screen.getByRole("tab", { name: "内容" })
    const securityTab = screen.getByRole("tab", { name: "账号安全" })
    const overviewPanel = screen.getByRole("tabpanel")
    expect(overviewTab).toHaveAttribute("aria-controls", overviewPanel.id)
    expect(overviewPanel).toHaveAttribute("aria-labelledby", overviewTab.id)
    expect(overviewTab).toHaveAttribute("tabindex", "0")
    expect(contentTab).toHaveAttribute("tabindex", "-1")

    overviewTab.focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "会员身份" })).toHaveFocus()
    await user.click(contentTab)
    expect(contentTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("heading", { name: "社区主题" })).toBeInTheDocument()

    await user.keyboard("{End}")
    expect(securityTab).toHaveFocus()
    expect(securityTab).toHaveAttribute("aria-selected", "true")

    await user.keyboard("{Home}")
    expect(overviewTab).toHaveFocus()
    expect(overviewTab).toHaveAttribute("aria-selected", "true")
  })

  it("renders an empty result and a retryable forbidden state", async () => {
    vi.mocked(listAdminUsers).mockResolvedValueOnce({ users: [], nextCursor: null })
    render(<UserAdminPanel />)
    expect(await screen.findByText("没有找到符合条件的用户")).toBeInTheDocument()

    cleanup()
    vi.mocked(listAdminUsers).mockRejectedValueOnce(new AdminUsersApiError(403, "admin.forbidden", "没有权限"))
    render(<UserAdminPanel />)
    expect(await screen.findByRole("alert")).toHaveTextContent("没有权限")
  })

  it("loads the next cursor page without losing the current users", async () => {
    const nextSummary = { ...summary, id: secondUserId, username: "second", displayName: "第二位成员" }
    vi.mocked(listAdminUsers)
      .mockResolvedValueOnce({ users: [summary], nextCursor: userId })
      .mockResolvedValueOnce({ users: [nextSummary], nextCursor: null })
    const user = userEvent.setup()
    render(<UserAdminPanel />)

    expect(await screen.findByRole("button", { name: "加载更多用户" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "加载更多用户" }))

    expect(await screen.findByRole("button", { name: /第二位成员/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /社区成员/ })).toBeInTheDocument()
    expect(listAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: userId, limit: 20 }))
  })

  it("keeps the latest selected user when an earlier request finishes last", async () => {
    const firstSummary = { ...summary, displayName: "较慢用户" }
    const secondSummary = { ...summary, id: secondUserId, username: "latest", displayName: "最新用户", status: "active" as const }
    const slowDetail = deferred<typeof detail>()
    const slowContent = deferred<{ items: []; nextCursor: null }>()
    const slowReports = deferred<{ reports: []; nextCursor: null }>()
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [firstSummary, secondSummary], nextCursor: null })
    vi.mocked(getAdminUser).mockImplementation((id) => id === userId ? slowDetail.promise : Promise.resolve({ ...detail, ...secondSummary, bio: "最新资料" }))
    vi.mocked(listAdminUserContent).mockImplementation((id) => id === userId ? slowContent.promise : Promise.resolve({ items: [], nextCursor: null }))
    vi.mocked(listAdminUserReports).mockImplementation((id) => id === userId ? slowReports.promise : Promise.resolve({ reports: [], nextCursor: null }))
    const user = userEvent.setup()
    render(<UserAdminPanel />)

    await user.click(await screen.findByRole("button", { name: /较慢用户/ }))
    await user.click(screen.getByRole("button", { name: /最新用户/ }))
    expect(await screen.findByRole("heading", { name: "最新用户" })).toBeInTheDocument()

    slowDetail.resolve(detail)
    slowContent.resolve({ items: [], nextCursor: null })
    slowReports.resolve({ reports: [], nextCursor: null })
    await Promise.resolve()
    expect(screen.getByRole("heading", { name: "最新用户" })).toBeInTheDocument()
  })

  it("hides write actions without capabilities and confirms a status change when allowed", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<UserAdminPanel />)
    await user.click(await screen.findByRole("button", { name: /社区成员/ }))
    expect(await screen.findByRole("heading", { name: "社区成员" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "管理账号状态" })).not.toBeInTheDocument()

    rerender(<UserAdminPanel canModerate csrfToken="csrf-token" />)
    await user.click(await screen.findByRole("tab", { name: "账号安全" }))
    await user.click(screen.getByRole("button", { name: "管理账号状态" }))
    await user.selectOptions(screen.getByLabelText("账号动作"), "suspended")
    await user.clear(screen.getByLabelText("操作原因"))
    await user.type(screen.getByLabelText("操作原因"), "严重违规")
    await user.selectOptions(screen.getByLabelText("限制期限"), "permanent")
    const submit = screen.getByRole("button", { name: "确认提交" })
    await user.click(submit)

    const dialog = screen.getByRole("alertdialog", { name: "确认账号状态变更" })
    expect(dialog).toHaveTextContent("永久，直到手动恢复")
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus()
    expect(updateAdminUserStatus).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole("button", { name: "确认暂停账号" }))

    await waitFor(() => expect(updateAdminUserStatus).toHaveBeenCalledWith(userId, {
      status: "suspended", reason: "严重违规", expiresAt: null, expectedRevision: 2,
    }, "csrf-token"))
    expect(await screen.findByRole("status")).toHaveTextContent("站长")
    expect(screen.getByRole("status")).toHaveTextContent("永久有效")
    expect(screen.getByRole("status")).toHaveTextContent("操作于")
    expect(screen.getByText("审计编号")).toBeInTheDocument()
  })

  it("opens an active account on the safer restriction action instead of a no-op", async () => {
    vi.mocked(getAdminUser).mockResolvedValueOnce({
      ...detail,
      status: "active",
      restrictionReason: null,
      restrictionExpiresAt: null,
    })
    const user = userEvent.setup()
    render(<UserAdminPanel canModerate csrfToken="csrf-token" />)
    await user.click(await screen.findByRole("button", { name: /社区成员/ }))
    await user.click(await screen.findByRole("tab", { name: "账号安全" }))
    await user.click(await screen.findByRole("button", { name: "管理账号状态" }))

    expect(screen.getByLabelText("账号动作")).toHaveValue("restricted")
    expect(screen.getByLabelText("操作原因")).toBeInTheDocument()
  })

  it("assigns a loaded custom role from the selected user context without another username input", async () => {
    const role = {
      id: secondUserId, key: "content_moderator", name: "内容版主", scope: "site" as const,
      isSystem: false, permissionKeys: ["moderation.topic"], assignmentCount: 0, revision: 1,
      createdAt: "2026-08-12T08:00:00Z", updatedAt: "2026-08-12T08:00:00Z",
    }
    vi.mocked(listAuthorizationRoles).mockResolvedValue([role])
    vi.mocked(createAuthorizationAssignment).mockResolvedValue({
      id: secondUserId, user: { id: userId, username: "member", displayName: "社区成员", avatarUrl: null },
      role: { id: role.id, key: role.key, name: role.name, scope: role.scope, isSystem: false, revision: 1 },
      scopeId: null, scopeMode: "exact" as const, assignedBy: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null }, createdAt: "2026-08-12T08:00:00Z",
    })
    const user = userEvent.setup()
    render(<UserAdminPanel canAssignRoles csrfToken="csrf-token" />)
    await user.click(await screen.findByRole("button", { name: /社区成员/ }))
    expect(await screen.findByRole("heading", { name: "社区成员" })).toBeInTheDocument()
    await user.click(await screen.findByRole("tab", { name: "账号安全" }))
    await user.click(await screen.findByRole("checkbox", { name: "内容版主" }))
    await user.click(screen.getByRole("button", { name: "保存角色" }))
    await user.click(screen.getByRole("button", { name: "确认保存角色" }))

    await waitFor(() => expect(createAuthorizationAssignment).toHaveBeenCalledWith({
      username: "member", roleId: secondUserId, scopeId: null,
    }, "csrf-token"))
    expect(screen.queryByRole("textbox", { name: /用户名/ })).not.toBeInTheDocument()
    expect(await screen.findByText("角色已保存")).toBeInTheDocument()
  })

  it("requires confirmation before removing a user's custom role", async () => {
    const assignmentId = "019fc800-0000-7000-8000-000000000099"
    vi.mocked(listAuthorizationAssignments).mockResolvedValue({ assignments: [{
      id: assignmentId,
      user: { id: userId, username: "member", displayName: "社区成员", avatarUrl: null },
      role: { id: userId, key: "moderator", name: "版主", scope: "site", isSystem: false, revision: 1 },
      scopeId: null,
      scopeMode: "exact",
      assignedBy: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null },
      createdAt: "2026-08-12T08:00:00Z",
    }], nextCursor: null })
    const user = userEvent.setup()
    render(<UserAdminPanel canAssignRoles csrfToken="csrf-token" />)
    await user.click(await screen.findByRole("button", { name: /社区成员/ }))

    await user.click(await screen.findByRole("tab", { name: "账号安全" }))
    await user.click(await screen.findByRole("checkbox", { name: "版主" }))
    await user.click(screen.getByRole("button", { name: "保存角色" }))
    const dialog = screen.getByRole("alertdialog", { name: "确认角色变更" })
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus()
    expect(deleteAuthorizationAssignment).not.toHaveBeenCalled()

    const listCallsBeforeSave = vi.mocked(listAdminUsers).mock.calls.length
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, primaryRole: null, membership: { ...listMembership, readableSections: [...listMembership.readableSections] } }], nextCursor: null })
    await user.click(within(dialog).getByRole("button", { name: "确认保存角色" }))
    await waitFor(() => expect(deleteAuthorizationAssignment).toHaveBeenCalledWith(assignmentId, "csrf-token"))
    expect(await screen.findByText("角色已保存")).toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(listAdminUsers).mock.calls.length).toBeGreaterThan(listCallsBeforeSave))
    expect(await within(screen.getByRole("table", { name: "用户列表" })).findByText("注册会员")).toBeInTheDocument()
    expect(within(screen.getByRole("table", { name: "用户列表" })).queryByText("版主")).not.toBeInTheDocument()
  })

  it("shows capability-protected management records without rendering internal summaries", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<UserAdminPanel />)
    await user.click(await screen.findByRole("button", { name: /社区成员/ }))
    expect(screen.queryByRole("tab", { name: "管理记录" })).not.toBeInTheDocument()
    expect(listAdminAudit).not.toHaveBeenCalled()

    rerender(<UserAdminPanel canReadAudit />)
    await user.click(await screen.findByRole("tab", { name: "管理记录" }))
    expect(await screen.findByText("站长")).toBeInTheDocument()
    expect(listAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ userId, limit: 10 }))
    expect(screen.getByText(secondUserId)).toBeInTheDocument()
    expect(screen.queryByText("绝密内部摘要")).not.toBeInTheDocument()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}


it("renders a selectable user table and keeps it visible behind the detail drawer", async () => {
  const user = userEvent.setup()
  render(<UserAdminPanel />)
  const table = await screen.findByRole("table", { name: "用户列表" })
  expect(within(table).getAllByRole("columnheader")).toHaveLength(10)
  expect(screen.getByText("已加载用户")).toBeInTheDocument()
  await user.click(screen.getByRole("checkbox", { name: "选择当前用户" }))
  expect(screen.getByRole("button", { name: "导出选中 1 位" })).toBeEnabled()
  await user.click(screen.getByRole("button", { name: /社区成员/ }))
  const drawer = await screen.findByRole("dialog", { name: "用户详情" })
  expect(drawer).toHaveAttribute("aria-modal", "true")
  expect(table).toBeVisible()
  expect(await within(drawer).findByText(userId)).toBeInTheDocument()
})

it("sends role and inclusive local registration dates to the server and resets filters", async () => {
  const user = userEvent.setup()
  const onQueryChange = vi.fn()
  vi.mocked(listAuthorizationRoles).mockResolvedValue([{ id: userId, key: "moderator", name: "版主", scope: "site", isSystem: false, permissionKeys: [], assignmentCount: 1, revision: 1, createdAt: summary.createdAt, updatedAt: summary.createdAt }])
  render(<UserAdminPanel canAssignRoles onQueryChange={onQueryChange} />)
  await screen.findByRole("option", { name: "版主" })
  await user.selectOptions(screen.getByLabelText("用户角色"), userId)
  await user.type(screen.getByLabelText("注册开始日期"), "2026-09-01")
  await user.type(screen.getByLabelText("注册结束日期"), "2026-09-02")
  await user.click(screen.getByRole("button", { name: /^搜索$/ }))
  await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ roleId: userId, registeredAfter: new Date("2026-09-01T00:00:00").toISOString(), registeredBefore: new Date("2026-09-03T00:00:00").toISOString() })))
  expect(onQueryChange).toHaveBeenLastCalledWith(expect.stringContaining("from=2026-09-01"))
  await user.click(screen.getByRole("button", { name: "重置" }))
  await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ roleId: undefined, registeredAfter: undefined, registeredBefore: undefined })))
  expect(screen.getByLabelText("注册开始日期")).toHaveValue("")
  await user.selectOptions(screen.getByLabelText("每次加载用户数"), "50")
  await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 })))
})


it("keeps user details usable when the recent preview fails and retries only that preview", async () => {
  const user = userEvent.setup()
  vi.mocked(listAdminUserContent).mockRejectedValueOnce(new AdminUsersApiError(503, "unavailable", "内容暂时不可用"))
  render(<UserAdminPanel />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  expect(await screen.findByRole("heading", { name: "社区成员" })).toBeInTheDocument()
  expect(listAdminUserContent).toHaveBeenCalledTimes(1)
  expect(listAdminUserReports).not.toHaveBeenCalled()
  expect(await screen.findByRole("alert")).toHaveTextContent("内容暂时不可用")
  await user.click(screen.getByRole("button", { name: "重试" }))
  expect(await screen.findByRole("link", { name: "社区主题" })).toHaveAttribute("href", "#topic/" + userId)
  expect(getAdminUser).toHaveBeenCalledTimes(1)
})

it("loads more activity without duplicating items and links replies to their original topic", async () => {
  const user = userEvent.setup()
  const first = { id: userId, kind: "topic" as const, topicId: userId, title: "第一页主题", excerpt: "摘要", status: "published", createdAt: summary.createdAt }
  vi.mocked(listAdminUserContent).mockResolvedValueOnce({ items: [first], nextCursor: userId }).mockResolvedValueOnce({ items: [first], nextCursor: userId }).mockResolvedValueOnce({ items: [first, { ...first, id: secondUserId, kind: "reply", title: "第二页回复" }], nextCursor: null })
  render(<UserAdminPanel />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  await user.click(await screen.findByRole("tab", { name: "内容" }))
  await user.click(await screen.findByRole("button", { name: "加载更多内容" }))
  expect(await screen.findByRole("link", { name: "第二页回复" })).toHaveAttribute("href", "#topic/" + userId + "?reply=" + secondUserId)
  expect(screen.getAllByRole("link", { name: "第一页主题" })).toHaveLength(1)
  expect(listAdminUserContent).toHaveBeenLastCalledWith(userId, userId, expect.any(AbortSignal))
  expect(screen.queryByRole("button", { name: "加载更多内容" })).not.toBeInTheDocument()
})


it("preserves loaded activity after a later page fails and retries that cursor", async () => {
  const user = userEvent.setup()
  const item = { id: userId, kind: "topic" as const, topicId: userId, title: "已加载主题", excerpt: "摘要", status: "published", createdAt: summary.createdAt }
  vi.mocked(listAdminUserContent).mockResolvedValueOnce({ items: [item], nextCursor: userId }).mockResolvedValueOnce({ items: [item], nextCursor: userId }).mockRejectedValueOnce(new AdminUsersApiError(503, "unavailable", "后续内容暂时不可用")).mockResolvedValueOnce({ items: [{ ...item, id: secondUserId, title: "后续主题" }], nextCursor: null })
  render(<UserAdminPanel />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  await user.click(await screen.findByRole("tab", { name: "内容" }))
  await user.click(await screen.findByRole("button", { name: "加载更多内容" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("后续内容暂时不可用")
  expect(screen.getByRole("link", { name: "已加载主题" })).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "重试" }))
  expect(await screen.findByRole("link", { name: "后续主题" })).toBeInTheDocument()
  expect(listAdminUserContent).toHaveBeenLastCalledWith(userId, userId, expect.any(AbortSignal))
})

it("aborts activity requests when leaving their tab and loads reports only on demand", async () => {
  const user = userEvent.setup()
  const slow = deferred<{ items: []; nextCursor: null }>()
  vi.mocked(listAdminUserContent).mockResolvedValueOnce({ items: [], nextCursor: null }).mockReturnValueOnce(slow.promise)
  render(<UserAdminPanel />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  await user.click(await screen.findByRole("tab", { name: "内容" }))
  const signal = vi.mocked(listAdminUserContent).mock.calls[1][2]
  await user.click(screen.getByRole("button", { name: "相关举报" }))
  expect(signal?.aborted).toBe(true)
  expect(await screen.findByText("暂无相关举报")).toBeInTheDocument()
  expect(listAdminUserReports).toHaveBeenCalledTimes(1)
  slow.resolve({ items: [], nextCursor: null })
  await Promise.resolve()
  expect(screen.getByRole("button", { name: "相关举报" })).toHaveAttribute("aria-pressed", "true")
})


it("refreshes a status conflict without discarding the user's draft", async () => {
  const user = userEvent.setup()
  vi.mocked(updateAdminUserStatus).mockRejectedValueOnce(new AdminUsersApiError(409, "user.revision_conflict", "账号已被其他管理员更新"))
  render(<UserAdminPanel canModerate csrfToken="csrf-token" />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  await user.click(await screen.findByRole("tab", { name: "账号安全" }))
  await user.click(await screen.findByRole("button", { name: "管理账号状态" }))
  await user.selectOptions(screen.getByLabelText("账号动作"), "suspended")
  await user.clear(screen.getByLabelText("操作原因"))
  await user.type(screen.getByLabelText("操作原因"), "保留这份处置原因")
  await user.selectOptions(screen.getByLabelText("限制期限"), "30d")
  await user.click(screen.getByRole("button", { name: "确认提交" }))
  await user.click(screen.getByRole("button", { name: "确认暂停账号" }))
  const refresh = await screen.findByRole("button", { name: "刷新最新数据" })
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled()
  vi.mocked(getAdminUser).mockRejectedValueOnce(new AdminUsersApiError(503, "unavailable", "刷新暂时失败")).mockResolvedValue({ ...detail, revision: 9 })
  await user.click(refresh)
  expect(await screen.findByText("刷新暂时失败")).toBeInTheDocument()
  expect(screen.getByLabelText("操作原因")).toHaveValue("保留这份处置原因")
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled()
  await user.click(refresh)
  await waitFor(() => expect(screen.getByRole("button", { name: "确认提交" })).toBeEnabled())
  expect(screen.getByLabelText("操作原因")).toHaveValue("保留这份处置原因")
  expect(screen.getByLabelText("限制期限")).toHaveValue("30d")
  expect(screen.getByLabelText("账号动作")).toHaveValue("suspended")
  await user.click(screen.getByRole("button", { name: "确认提交" }))
  await user.click(screen.getByRole("button", { name: "确认暂停账号" }))
  await waitFor(() => expect(updateAdminUserStatus).toHaveBeenLastCalledWith(userId, expect.objectContaining({ expectedRevision: 9, reason: "保留这份处置原因" }), "csrf-token"))
})

it("locks account fields and dismissal until the status mutation completes", async () => {
  const user = userEvent.setup()
  const pending = deferred<Awaited<ReturnType<typeof updateAdminUserStatus>>>()
  vi.mocked(updateAdminUserStatus).mockReturnValue(pending.promise)
  render(<UserAdminPanel canModerate csrfToken="csrf-token" />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  await user.click(await screen.findByRole("tab", { name: "账号安全" }))
  await user.click(await screen.findByRole("button", { name: "管理账号状态" }))
  await user.click(screen.getByRole("button", { name: "确认提交" }))
  await user.dblClick(screen.getByRole("button", { name: "确认恢复账号" }))
  expect(updateAdminUserStatus).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText("账号动作")).toBeDisabled()
  expect(screen.getByRole("button", { name: "关闭管理账号状态" })).toBeDisabled()
  await user.keyboard("{Escape}")
  expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  await act(async () => { pending.resolve({ userId, status: "active", reason: null, expiresAt: null, revision: 3, auditId: secondUserId, actor: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null }, changedAt: summary.lastSeenAt }); await pending.promise })
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
})

it("retries role data failures within the detail drawer", async () => {
  const user = userEvent.setup()
  vi.mocked(listAuthorizationAssignments).mockRejectedValueOnce(new Error("offline"))
  render(<UserAdminPanel canAssignRoles csrfToken="csrf-token" />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  await user.click(await screen.findByRole("tab", { name: "账号安全" }))
  await user.click(await screen.findByRole("button", { name: "重试角色数据" }))
  expect(await screen.findByText("暂无可分配的自定义角色")).toBeInTheDocument()
  expect(listAuthorizationAssignments).toHaveBeenCalledTimes(2)
})


it("locks role assignment fields and rejects duplicate submissions until completion", async () => {
  const user = userEvent.setup()
  const role = { id: secondUserId, key: "helper", name: "协管员", scope: "site" as const, isSystem: false, permissionKeys: [], assignmentCount: 0, revision: 1, createdAt: summary.createdAt, updatedAt: summary.createdAt }
  const pending = deferred<Awaited<ReturnType<typeof createAuthorizationAssignment>>>()
  vi.mocked(listAuthorizationRoles).mockResolvedValue([role])
  vi.mocked(createAuthorizationAssignment).mockReturnValue(pending.promise)
  render(<UserAdminPanel canAssignRoles csrfToken="csrf-token" />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  await user.click(await screen.findByRole("tab", { name: "账号安全" }))
  await user.click(await screen.findByRole("checkbox", { name: "协管员" }))
  await user.click(screen.getByRole("button", { name: "保存角色" }))
  await user.dblClick(screen.getByRole("button", { name: "确认保存角色" }))
  expect(createAuthorizationAssignment).toHaveBeenCalledTimes(1)
  expect(screen.getByRole("checkbox", { name: "协管员" })).toBeDisabled()
  expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "取消" })).toBeDisabled()
  await user.keyboard("{Escape}")
  expect(screen.getByRole("alertdialog", { name: "确认角色变更" })).toBeInTheDocument()
  await act(async () => { pending.resolve({ id: secondUserId, role, user: { id: userId, username: summary.username, displayName: summary.displayName, avatarUrl: null }, scopeId: null, scopeMode: "exact" as const, assignedBy: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null }, createdAt: summary.createdAt }); await pending.promise })
  expect(await screen.findByText("角色已保存")).toBeInTheDocument()
  expect(screen.getByRole("checkbox", { name: "协管员" })).toBeEnabled()
})


it("shows a compact recent activity preview and copies the user ID", async () => {
  const user = userEvent.setup()
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
  const items = Array.from({ length: 4 }, (_, index) => ({ id: userId + index, kind: "topic" as const, topicId: userId, title: "最近动态 " + index, excerpt: "摘要", status: "published", createdAt: summary.createdAt }))
  vi.mocked(listAdminUserContent).mockResolvedValue({ items, nextCursor: null })
  render(<UserAdminPanel />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  expect(await screen.findByRole("link", { name: "最近动态 0" })).toBeInTheDocument()
  expect(screen.queryByRole("link", { name: "最近动态 3" })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "复制用户 ID" }))
  expect(copy).toHaveBeenCalledWith(userId)
  expect(await screen.findByText("用户 ID 已复制")).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "查看全部动态" }))
  expect(await screen.findByRole("link", { name: "最近动态 3" })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: "内容" })).toHaveFocus()
})

it("opens the requested quick account action without submitting it", async () => {
  const user = userEvent.setup()
  render(<UserAdminPanel canModerate csrfToken="csrf-token" />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  await user.click(await screen.findByRole("tab", { name: "账号安全" }))
  await user.click(await screen.findByRole("button", { name: /^暂停账号$/ }))
  expect(screen.getByLabelText("账号动作")).toHaveValue("suspended")
  expect(updateAdminUserStatus).not.toHaveBeenCalled()
})


it("navigates loaded users within the drawer and locks navigation while details load", async () => {
  const user = userEvent.setup()
  const nextUser = { ...detail, id: secondUserId, username: "second", displayName: "第二位成员" }
  const pending = deferred<typeof detail>()
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [summary, nextUser], nextCursor: null })
  vi.mocked(getAdminUser).mockImplementation((id) => id === secondUserId ? pending.promise : Promise.resolve(detail))
  render(<UserAdminPanel />)
  const opener = await screen.findByRole("button", { name: /社区成员/ })
  await user.click(opener)
  await screen.findByRole("heading", { name: "社区成员" })
  expect(screen.getByRole("button", { name: "上一位用户" })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "下一位用户" }))
  expect(screen.getByRole("button", { name: "上一位用户" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "下一位用户" })).toBeDisabled()
  await act(async () => { pending.resolve(nextUser); await pending.promise })
  expect(screen.getByRole("heading", { name: "第二位成员" })).toBeInTheDocument()
  expect(screen.getByText("已加载用户 2 / 2")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "下一位用户" })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "上一位用户" }))
  expect(await screen.findByRole("heading", { name: "社区成员" })).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "关闭抽屉" }))
  await waitFor(() => expect(opener).toHaveFocus())
})

it("shows follow counts and a safe personal website without linking unsafe schemes", async () => {
  const user = userEvent.setup()
  vi.mocked(getAdminUser).mockResolvedValueOnce({ ...detail, websiteUrl: "https://example.com/profile" })
  render(<UserAdminPanel />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  expect(await screen.findByRole("link", { name: "https://example.com/profile" })).toHaveAttribute("rel", "noopener noreferrer")
  expect(screen.getByText("已关注 4 人")).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "关闭抽屉" }))
  vi.mocked(getAdminUser).mockResolvedValueOnce({ ...detail, websiteUrl: "javascript:alert(1)" })
  await user.click(screen.getByRole("button", { name: /社区成员/ }))
  expect(await screen.findByText("javascript:alert(1)")).toBeInTheDocument()
  expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).not.toBeInTheDocument()
})

it("shows loaded status counts beside the reference-style filters", async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [summary, { ...summary, id: secondUserId, username: "active", displayName: "正常成员", status: "active" }], nextCursor: null })
  render(<UserAdminPanel />)
  await screen.findByRole("button", { name: /社区成员/ })
  expect(screen.getByRole("heading", { name: "用户管理", level: 1 })).toBeInTheDocument()
  const filters = within(screen.getByRole("group", { name: "按用户状态筛选" }))
  expect(within(filters.getByRole("button", { name: "全部" })).getByText("2")).toBeInTheDocument()
  expect(within(filters.getByRole("button", { name: "正常" })).getByText("1")).toBeInTheDocument()
  expect(within(filters.getByRole("button", { name: "已限制" })).getByText("1")).toBeInTheDocument()
  expect(screen.getAllByText("占已加载 50.0%")).toHaveLength(2)
})

it("opens the requested user outside the loaded page and returns with filters intact", async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [], nextCursor: null })
  const onQueryChange = vi.fn()
  const query = "q=member&status=restricted&from=2026-08-01&user_id=" + userId
  const view = render(<UserAdminPanel requestedQuery={query} onQueryChange={onQueryChange} />)
  expect(await screen.findByRole("dialog", { name: "用户详情" })).toBeInTheDocument()
  await screen.findByRole("heading", { name: "社区成员" })
  expect(getAdminUser).toHaveBeenCalledWith(userId, expect.any(AbortSignal))
  expect(listAdminUsers).toHaveBeenCalledTimes(1)
  await userEvent.setup().click(screen.getByRole("button", { name: "返回列表" }))
  expect(onQueryChange).toHaveBeenLastCalledWith("q=member&status=restricted&from=2026-08-01")
  view.rerender(<UserAdminPanel requestedQuery="q=member&status=restricted&from=2026-08-01" onQueryChange={onQueryChange} />)
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(screen.getByRole("searchbox", { name: "搜索用户" })).toHaveValue("member")
  expect(screen.getByRole("button", { name: "已限制" })).toHaveAttribute("aria-pressed", "true")
  expect(listAdminUsers).toHaveBeenCalledTimes(1)
})

it("publishes the selected user without dropping the current filters", async () => {
  const onQueryChange = vi.fn()
  render(<UserAdminPanel requestedQuery="status=restricted&q=member" onQueryChange={onQueryChange} />)
  await userEvent.setup().click(await screen.findByRole("button", { name: /社区成员/ }))
  const params = new URLSearchParams(onQueryChange.mock.calls.at(-1)?.[0])
  expect(params.get("user_id")).toBe(userId)
  expect(params.get("status")).toBe("restricted")
  expect(params.get("q")).toBe("member")
})

it("ignores an invalid user ID and cancels the previous direct-detail request", async () => {
  const view = render(<UserAdminPanel requestedQuery="user_id=invalid" />)
  await screen.findByRole("button", { name: /社区成员/ })
  expect(getAdminUser).not.toHaveBeenCalled()
  vi.mocked(getAdminUser).mockImplementationOnce((_id, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))))
  view.rerender(<UserAdminPanel requestedQuery={"user_id=" + userId} />)
  await screen.findByRole("dialog", { name: "用户详情" })
  const signal = vi.mocked(getAdminUser).mock.calls.at(-1)?.[1]
  view.rerender(<UserAdminPanel requestedQuery="status=restricted" />)
  expect(signal?.aborted).toBe(true)
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

it("does not apply a previous user's pending status result to a new detail", async () => {
  let finish!: (value: Awaited<ReturnType<typeof updateAdminUserStatus>>) => void
  vi.mocked(updateAdminUserStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  vi.mocked(getAdminUser).mockImplementation(async id => id === userId ? detail : { ...detail, id: secondUserId, username: "second", displayName: "第二位成员", status: "active", restrictionReason: null })
  const view = render(<UserAdminPanel canModerate csrfToken="csrf" requestedQuery={"user_id=" + userId} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole("tab", { name: "账号安全" }))
  await user.click(await screen.findByRole("button", { name: "管理账号状态" }))
  await user.selectOptions(screen.getByLabelText("账号动作"), "suspended")
  await user.clear(screen.getByLabelText("操作原因"))
  await user.type(screen.getByLabelText("操作原因"), "来自旧用户的原因")
  await user.click(screen.getByRole("button", { name: "确认提交" }))
  await user.click(screen.getByRole("button", { name: "确认暂停账号" }))
  view.rerender(<UserAdminPanel canModerate csrfToken="csrf" requestedQuery={"user_id=" + secondUserId} />)
  await screen.findByRole("heading", { name: "第二位成员" })
  await act(async () => finish({ userId, status: "suspended", reason: "来自旧用户的原因", expiresAt: null, revision: 3, auditId: userId, actor: { id: userId, username: "admin", displayName: "管理员", avatarUrl: null }, changedAt: "2026-08-12T08:00:00Z" }))
  expect(screen.queryByText("来自旧用户的原因")).not.toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "第二位成员" })).toBeInTheDocument()
})


it.each([[true, false], [false, true]])("requires both group and membership read access for the user tab (%s, %s)", async (canReadGroups, canReadGroupMemberships) => {
  const user = userEvent.setup()
  render(<UserAdminPanel canReadGroups={canReadGroups} canReadGroupMemberships={canReadGroupMemberships} canWriteGroupMemberships />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
  expect(await screen.findByRole("dialog", { name: "用户详情" })).toBeInTheDocument()
  expect(screen.queryByRole("tab", { name: "用户组" })).not.toBeInTheDocument()
  expect(listAdminCommunityGroups).not.toHaveBeenCalled()
  expect(listAdminCommunityGroupMemberships).not.toHaveBeenCalled()
})

it("loads final permission sources only from a separate authorized user-detail tab",async()=>{
  const user=userEvent.setup()
  const keys=["content.access_policies.read","community.groups.read","admin.users.read","community.memberships.read","entitlements.types.read","entitlements.grants.read","authorization.assignments.read","authorization.roles.read"]
  const view=render(<UserAdminPanel capabilityKeys={keys} />)
  await user.click(await screen.findByRole("button",{name:/社区成员/}))
  await user.click(await screen.findByRole("tab",{name:"有效权限"}))
  expect(await screen.findByRole("region",{name:"只读权限检查"})).toBeInTheDocument()
  expect(screen.getByText("指定用户：社区成员 @member")).toBeInTheDocument()
  expect(within(screen.getByRole("dialog",{name:"用户详情"})).queryByLabelText("搜索用户")).not.toBeInTheDocument()
  expect(getAdminUser).toHaveBeenCalledTimes(1)
  view.rerender(<UserAdminPanel capabilityKeys={keys.filter(key=>key!=="entitlements.grants.read")} />)
  expect(screen.queryByRole("region",{name:"只读权限检查"})).not.toBeInTheDocument()
  expect(screen.queryByRole("tab",{name:"有效权限"})).not.toBeInTheDocument()
})

const listMembership = { groups: [{ id: userId, displayName: '注册会员', membershipKind: 'base' as const }, { id: secondUserId, displayName: '摄影达人', membershipKind: 'additional' as const }], experience: 120, level: { id: userId, displayName: '成长二级', levelOrder: 2 }, pointsBalance: 77, entitlements: [{ typeId: userId, internalKey: 'premium', displayName: '高级会员' }], medalCount: 3, readableSections: ['groups', 'experience', 'points', 'medals', 'entitlements'] as const }

it('prioritizes real community identity and membership fields over governance role and content counts', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: { ...listMembership, readableSections: [...listMembership.readableSections] } }], nextCursor: null })
  render(<UserAdminPanel />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['', '用户', '基础身份 / 附加身份', '成长等级 / EXP', '积分', '会员权益', '账号状态', '注册时间', '最后活跃', '操作'])
  for (const text of ['注册会员', '摄影达人', 'Lv.2 · 成长二级', 'EXP 120', '77', '高级会员']) expect(within(table).getByText(text)).toBeInTheDocument()
  expect(within(table).queryByText('版主')).not.toBeInTheDocument()
  expect(within(table).queryByRole('columnheader', { name: '主题' })).not.toBeInTheDocument()
})

it('does not invent membership identity or zero points for redacted server fields', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: { groups: null, experience: null, level: null, pointsBalance: null, entitlements: null, medalCount: null, readableSections: [] } }], nextCursor: null })
  render(<UserAdminPanel />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  expect(within(table).getAllByText('无权查看')).toHaveLength(4)
  expect(within(table).queryByText('普通成员')).not.toBeInTheDocument()
  expect(within(table).queryByText('0')).not.toBeInTheDocument()
})

it('restores membership and activity URL facets and sends them with a pagination cursor', async () => {
  const user = userEvent.setup()
  const onQueryChange = vi.fn()
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [summary], nextCursor: secondUserId })
  render(<UserAdminPanel requestedQuery={'base_group=' + userId + '&additional_group=' + secondUserId + '&growth_level=' + userId + '&entitlement_type=' + secondUserId + '&active_from=2026-09-01&active_through=2026-09-02'} canReadGroups canReadGroupMemberships capabilityKeys={['membership.rules.read', 'entitlements.types.read', 'entitlements.grants.read']} onQueryChange={onQueryChange} />)
  await screen.findByRole('table', { name: '用户列表' })
  await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ baseGroupId: userId, additionalGroupId: secondUserId, growthLevelId: userId, entitlementTypeId: secondUserId, lastActiveAfter: new Date('2026-09-01T00:00:00').toISOString(), lastActiveBefore: new Date('2026-09-03T00:00:00').toISOString() })))
  await user.click(screen.getByRole('button', { name: '加载更多用户' }))
  await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ baseGroupId: userId, additionalGroupId: secondUserId, growthLevelId: userId, entitlementTypeId: secondUserId, cursor: secondUserId })))
  await user.click(screen.getByRole('button', { name: '重置' }))
  await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ baseGroupId: undefined, additionalGroupId: undefined, growthLevelId: undefined, entitlementTypeId: undefined, lastActiveAfter: undefined, lastActiveBefore: undefined })))
})

it('recovers real membership filter catalog failures without affecting user records', async () => {
  vi.mocked(listAdminCommunityGroups).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
  const user = userEvent.setup()
  render(<UserAdminPanel canReadGroups canReadGroupMemberships />)
  expect(await screen.findByRole('alert')).toHaveTextContent('用户组筛选暂时无法加载')
  await user.click(screen.getByRole('button', { name: '重试会员筛选目录' }))
  await waitFor(() => expect(screen.queryByText('用户组筛选暂时无法加载')).not.toBeInTheDocument())
  expect(listAdminCommunityGroups).toHaveBeenCalledTimes(2)
  expect(await screen.findByRole('table', { name: '用户列表' })).toBeInTheDocument()
})

const growthLevel = { id: userId, internalKey: 'growth_2', levelOrder: 2, displayName: '成长二级', requiredExperience: 100, iconAssetId: null, color: null, description: '', status: 'published' as const, revision: 1, publishedAt: summary.createdAt, createdAt: summary.createdAt, updatedAt: summary.createdAt }
const nextGrowthLevel = { ...growthLevel, id: secondUserId, internalKey: 'growth_3', levelOrder: 3, displayName: '成长三级', requiredExperience: 300 }
const readableMembership = { ...listMembership, readableSections: [...listMembership.readableSections] }

it('shows Lv, EXP and progress together using the existing published growth catalog', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: readableMembership }], nextCursor: null })
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([nextGrowthLevel, { ...nextGrowthLevel, id: '019fc800-0000-7000-8000-000000000004', levelOrder: 4, requiredExperience: 150, status: 'draft' }, growthLevel])
  render(<UserAdminPanel capabilityKeys={['membership.rules.read']} />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  const growthCell = within(table).getByRole('cell', { name: /Lv.2 · 成长二级/ })
  expect(within(growthCell).getByText('EXP 120')).toBeInTheDocument()
  expect(await within(growthCell).findByRole('progressbar', { name: '成长等级进度' })).toHaveAttribute('value', '10')
  expect(within(growthCell).getByText('距成长三级还需 180 EXP')).toBeInTheDocument()
  expect(getAdminGrowthLevels).toHaveBeenCalledTimes(1)
  expect(getAdminUser).not.toHaveBeenCalled()
})

it('keeps the assigned Lv when reversed EXP falls below its threshold', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: { ...readableMembership, experience: 0, pointsBalance: 7777 } }], nextCursor: null })
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([growthLevel, nextGrowthLevel])
  render(<UserAdminPanel capabilityKeys={['membership.rules.read']} />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  expect(within(table).getByText('Lv.2 · 成长二级')).toBeInTheDocument()
  expect(within(table).getByText('EXP 0')).toBeInTheDocument()
  expect(await within(table).findByRole('progressbar')).toHaveAttribute('value', '0')
  expect(within(table).getByText('7,777')).toBeInTheDocument()
})

it('marks the highest published growth stage without deriving a new Lv from EXP', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: { ...readableMembership, experience: 500 } }], nextCursor: null })
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([growthLevel, { ...nextGrowthLevel, status: 'draft' }])
  render(<UserAdminPanel capabilityKeys={['membership.rules.read']} />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  expect(await within(table).findByRole('progressbar')).toHaveAttribute('value', '100')
  expect(within(table).getByText('已达到当前最高成长阶段')).toBeInTheDocument()
  expect(within(table).getByText('Lv.2 · 成长二级')).toBeInTheDocument()
})

it('retains Lv and EXP while the shared catalog loads and uses it for paginated users', async () => {
  const catalog = deferred<Awaited<ReturnType<typeof getAdminGrowthLevels>>>()
  vi.mocked(getAdminGrowthLevels).mockReturnValue(catalog.promise)
  vi.mocked(listAdminUsers).mockResolvedValueOnce({ users: [{ ...summary, membership: readableMembership }], nextCursor: secondUserId }).mockResolvedValueOnce({ users: [{ ...summary, id: secondUserId, username: 'second', membership: { ...readableMembership, experience: 200 } }], nextCursor: null })
  const user = userEvent.setup()
  render(<UserAdminPanel capabilityKeys={['membership.rules.read']} />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  expect(within(table).getByText('EXP 120')).toBeInTheDocument()
  expect(within(table).getByText('进度暂不可用')).toBeInTheDocument()
  expect(within(table).queryByRole('progressbar')).not.toBeInTheDocument()
  await act(async () => catalog.resolve([growthLevel, nextGrowthLevel]))
  expect(await within(table).findByRole('progressbar')).toHaveAttribute('value', '10')
  await user.click(screen.getByRole('button', { name: '加载更多用户' }))
  await waitFor(() => expect(within(table).getAllByRole('progressbar')).toHaveLength(2))
  expect(within(table).getAllByRole('progressbar').map(bar => bar.getAttribute('value'))).toEqual(['10', '50'])
  expect(getAdminGrowthLevels).toHaveBeenCalledTimes(1)
  expect(getAdminUser).not.toHaveBeenCalled()
})

it('recovers growth progress through the existing catalog retry without replacing user rows', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: readableMembership }], nextCursor: null })
  vi.mocked(getAdminGrowthLevels).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([growthLevel, nextGrowthLevel])
  const user = userEvent.setup()
  render(<UserAdminPanel capabilityKeys={['membership.rules.read']} />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  expect(await screen.findByRole('alert')).toHaveTextContent('成长等级筛选暂时无法加载')
  expect(within(table).getByText('EXP 120')).toBeInTheDocument()
  expect(within(table).queryByRole('progressbar')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重试会员筛选目录' }))
  expect(await within(table).findByRole('progressbar')).toHaveAttribute('value', '10')
  expect(listAdminUsers).toHaveBeenCalledTimes(1)
})

it('does not mark progress complete when the current level is missing from the catalog', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: readableMembership }], nextCursor: null })
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([nextGrowthLevel])
  render(<UserAdminPanel capabilityKeys={['membership.rules.read']} />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  expect(within(table).getByText('进度暂不可用')).toBeInTheDocument()
  expect(within(table).queryByRole('progressbar')).not.toBeInTheDocument()
})

it('distinguishes an uninitialized growth account from redacted or absent membership', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: { ...readableMembership, experience: null, level: null } }], nextCursor: null })
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([growthLevel, nextGrowthLevel])
  render(<UserAdminPanel capabilityKeys={['membership.rules.read']} />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  expect(within(table).getAllByText('未初始化')).toHaveLength(1)
  expect(within(table).queryByRole('progressbar')).not.toBeInTheDocument()
  expect(within(table).queryByText('EXP 0')).not.toBeInTheDocument()
})

it('drops catalog-based progress when growth capability is withdrawn', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: readableMembership }], nextCursor: null })
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([growthLevel, nextGrowthLevel])
  const view = render(<UserAdminPanel capabilityKeys={['membership.rules.read']} />)
  const table = await screen.findByRole('table', { name: '用户列表' })
  await within(table).findByRole('progressbar')
  view.rerender(<UserAdminPanel capabilityKeys={[]} />)
  expect(within(table).queryByRole('progressbar')).not.toBeInTheDocument()
  expect(getAdminGrowthLevels).toHaveBeenCalledTimes(1)
})

it('exports selected membership values with separate Lv and EXP fields and redacts denied sections', async () => {
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, membership: readableMembership }, { ...summary, id: secondUserId, username: 'redacted', displayName: '不可读用户', membership: { ...readableMembership, experience: null, level: null, groups: null, pointsBalance: null, entitlements: null, readableSections: [] } }], nextCursor: null })
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:users')
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    const user = userEvent.setup()
    render(<UserAdminPanel />)
    await screen.findByRole('table', { name: '用户列表' })
    await user.click(screen.getByRole('checkbox', { name: '选择用户：redacted' }))
    await user.click(screen.getByRole('button', { name: '导出选中 1 位' }))
    const csv = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsText(createObjectURL.mock.calls[0][0] as Blob) })
    expect(csv).toContain('"成长等级","EXP","积分"')
    expect(csv).toContain('"不可读用户","redacted","无权查看","无权查看","无权查看","无权查看","无权查看"')
    expect(csv).not.toContain('成长二级')
    expect(csv).not.toContain('摄影达人')
    expect(click).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:users'), { timeout: 1500 })
  } finally { click.mockRestore(); vi.unstubAllGlobals() }
})

const growthIdentity = { id: userId, internalKey: 'level_2', levelOrder: 2, displayName: '成长二级', requiredExperience: 100, iconAssetId: null, color: null, description: '' }
const membershipSummary: AdminUserMembershipSummary = { account: detail, groups: [], experience: { userId, experience: 120, currentLevel: growthIdentity, revision: 1, updatedAt: summary.createdAt }, nextLevel: { ...growthIdentity, id: secondUserId, internalKey: 'level_3', levelOrder: 3, displayName: '成长三级', requiredExperience: 300 }, points: { userId, pointsBalance: 777, lifetimePoints: 888, revision: 1, updatedAt: summary.createdAt }, medals: [], entitlements: [], readableSections: ['groups','experience','points','medals','entitlements'] }

it('loads an independent membership summary and presents the new six detail categories', async () => {
  const user=userEvent.setup()
  const keys=['membership.rules.read','membership.points.grant','membership.medals.read','content.access_policies.read','community.groups.read','admin.users.read','community.memberships.read','entitlements.types.read','entitlements.grants.read','authorization.assignments.read','authorization.roles.read']
  render(<UserAdminPanel canReadGroups canReadGroupMemberships canReadAudit capabilityKeys={keys} />)
  await user.click(await screen.findByRole('button',{name:/社区成员/}))
  const dialog=await screen.findByRole('dialog',{name:'用户详情'})
  await waitFor(()=>expect(getAdminUserMembershipSummary).toHaveBeenCalledWith(userId,expect.any(AbortSignal)))
  expect(within(dialog).getAllByRole('tab').map(item=>item.textContent)).toEqual(['概览','会员身份','有效权限','内容','账号安全','管理记录'])
  expect(within(dialog).getByRole('region',{name:'会员身份摘要'})).toHaveTextContent('Lv.2 · 成长二级')
  expect(within(dialog).getByRole('region',{name:'会员身份摘要'})).toHaveTextContent('777')
  expect(within(dialog).getByRole('progressbar')).toHaveAttribute('value','10')
  for(const tab of within(dialog).getAllByRole('tab')) expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBeInTheDocument()
})
it('retries only the membership summary while retaining account details',async()=>{
  vi.mocked(getAdminUserMembershipSummary).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(membershipSummary)
  const user=userEvent.setup(); render(<UserAdminPanel capabilityKeys={['membership.rules.read']} />)
  await user.click(await screen.findByRole('button',{name:/社区成员/}))
  expect(await screen.findByRole('heading',{name:'社区成员'})).toBeInTheDocument()
  await user.click(await screen.findByRole('button',{name:'重试会员档案'}))
  expect(await screen.findByRole('progressbar')).toHaveAttribute('value','10')
  expect(getAdminUser).toHaveBeenCalledTimes(1)
})
it('redacts a readable server snapshot immediately when local capabilities are withdrawn',async()=>{
  const user=userEvent.setup();const view=render(<UserAdminPanel capabilityKeys={['membership.rules.read','membership.points.grant']} />)
  await user.click(await screen.findByRole('button',{name:/社区成员/}))
  expect(await screen.findByRole('progressbar')).toBeInTheDocument()
  const pending=deferred<AdminUserMembershipSummary>();vi.mocked(getAdminUserMembershipSummary).mockReturnValueOnce(pending.promise)
  view.rerender(<UserAdminPanel capabilityKeys={[]} />)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  pending.resolve(membershipSummary)
  await waitFor(()=>expect(within(screen.getByRole('region',{name:'会员身份摘要'})).getAllByText('无权查看').length).toBeGreaterThan(0))
  expect(screen.queryByText('777')).not.toBeInTheDocument()
})
it('ignores a late membership response after switching UID',async()=>{
  const pending=deferred<AdminUserMembershipSummary>()
  vi.mocked(listAdminUsers).mockResolvedValue({users:[summary,{...summary,id:secondUserId,displayName:'第二位成员',username:'second'}],nextCursor:null})
  vi.mocked(getAdminUser).mockImplementation(async id=>id===userId?detail:{...detail,id:secondUserId,displayName:'第二位成员',username:'second'})
  vi.mocked(getAdminUserMembershipSummary).mockImplementation(id=>id===userId?pending.promise:Promise.resolve({...membershipSummary,account:{...detail,id:secondUserId},points:{...membershipSummary.points!,userId:secondUserId,pointsBalance:42}}))
  const user=userEvent.setup();render(<UserAdminPanel capabilityKeys={['membership.points.grant']} />)
  await user.click(await screen.findByRole('button',{name:/社区成员/}))
  await screen.findByRole('heading',{name:'社区成员'})
  await user.click(screen.getByRole('button',{name:'下一位用户'}))
  expect(await screen.findByRole('heading',{name:'第二位成员'})).toBeInTheDocument()
  await act(async()=>pending.resolve(membershipSummary))
  expect(screen.getByRole('region',{name:'会员身份摘要'})).toHaveTextContent('42')
  expect(screen.getByRole('region',{name:'会员身份摘要'})).not.toHaveTextContent('777')
})

it('writes points only for the current UID, refreshes identity and retains the immutable receipt across tabs',async()=>{
  const saved={account:{userId,pointsBalance:807,lifetimePoints:918,levelKey:'legacy_1',levelNumber:1,levelDisplayName:'兼容等级',revision:2,updatedAt:summary.createdAt},created:true,auditId:secondUserId,ledgerEntryId:secondUserId,balanceBefore:777,balanceAfter:807,requestId:'request-1'}
  vi.mocked(grantMembershipPoints).mockImplementation(async()=>{vi.mocked(getAdminUserMembershipSummary).mockResolvedValue({...membershipSummary,points:{...membershipSummary.points!,pointsBalance:807}});return saved})
  const user=userEvent.setup();render(<UserAdminPanel csrfToken="csrf" capabilityKeys={['membership.points.grant','membership.rules.read']} />)
  await user.click(await screen.findByRole('button',{name:/社区成员/}));await user.click(await screen.findByRole('tab',{name:'会员身份'}))
  await user.type(await screen.findByRole('spinbutton',{name:'积分数量'}),'30');await user.selectOptions(screen.getByRole('combobox',{name:'运营原因'}),'operations.community_reward');await user.click(screen.getByRole('button',{name:'确认积分操作'}))
  expect(await screen.findByLabelText('积分操作回执')).toHaveTextContent('777 → 807')
  await waitFor(()=>expect(screen.getByRole('region',{name:'会员身份摘要'})).toHaveTextContent('807'))
  expect(screen.getByRole('region',{name:'会员身份摘要'})).toHaveTextContent('EXP 120')
  expect(grantMembershipPoints).toHaveBeenCalledWith(expect.objectContaining({userId,amount:30,idempotencyKey:expect.any(String)}),'csrf')
  await waitFor(()=>expect(listAdminUsers).toHaveBeenCalledTimes(2))
  await user.click(screen.getByRole('tab',{name:'概览'}));await user.click(screen.getByRole('tab',{name:'会员身份'}))
  expect(screen.getByLabelText('积分操作回执')).toHaveTextContent('request-1')
})
it('blocks leaving a detail until an unknown points request is confirmed with the same key',async()=>{
  vi.mocked(grantMembershipPoints).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({account:{userId,pointsBalance:807,lifetimePoints:918,levelKey:'legacy_1',levelNumber:1,levelDisplayName:'兼容等级',revision:2,updatedAt:summary.createdAt},created:true,auditId:null,ledgerEntryId:null,balanceBefore:777,balanceAfter:807})
  const user=userEvent.setup();render(<UserAdminPanel csrfToken="csrf" capabilityKeys={['membership.points.grant']} />)
  await user.click(await screen.findByRole('button',{name:/社区成员/}));await user.click(await screen.findByRole('tab',{name:'会员身份'}));await user.type(await screen.findByRole('spinbutton',{name:'积分数量'}),'30');await user.selectOptions(screen.getByRole('combobox',{name:'运营原因'}),'operations.community_reward');await user.click(screen.getByRole('button',{name:'确认积分操作'}));await screen.findByRole('alert')
  expect(screen.getByRole('button',{name:'返回列表'})).toBeDisabled();expect(screen.getByRole('tab',{name:'概览'})).toBeDisabled()
  await user.keyboard('{Escape}');expect(screen.getByRole('dialog',{name:'用户详情'})).toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'确认积分操作'}));await screen.findByText('积分操作完成')
  expect(vi.mocked(grantMembershipPoints).mock.calls[1][0].idempotencyKey).toBe(vi.mocked(grantMembershipPoints).mock.calls[0][0].idempotencyKey)
  await waitFor(()=>expect(screen.getByRole('button',{name:'返回列表'})).toBeEnabled())
})

it('updates account details from a newer aggregate account revision',async()=>{
  vi.mocked(getAdminUserMembershipSummary).mockResolvedValue({...membershipSummary,account:{...detail,status:'active',restrictionReason:null,revision:9}})
  const user=userEvent.setup();render(<UserAdminPanel />);await user.click(await screen.findByRole('button',{name:/社区成员/}))
  await waitFor(()=>expect(within(screen.getByRole('dialog',{name:'用户详情'})).getByText('正常')).toBeInTheDocument())
  expect(within(screen.getByRole('dialog',{name:'用户详情'})).queryByText('等待人工复核')).not.toBeInTheDocument()
})
it('honors server redaction even when local membership capabilities are available',async()=>{
  vi.mocked(getAdminUserMembershipSummary).mockResolvedValue({...membershipSummary,groups:null,experience:null,nextLevel:null,points:null,medals:null,entitlements:null,readableSections:[]})
  const user=userEvent.setup();render(<UserAdminPanel canReadGroups canReadGroupMemberships capabilityKeys={['membership.rules.read','membership.points.grant','membership.medals.read','entitlements.grants.read']} />)
  await user.click(await screen.findByRole('button',{name:/社区成员/}));await user.click(await screen.findByRole('tab',{name:'会员身份'}))
  await waitFor(()=>expect(within(screen.getByRole('region',{name:'会员身份摘要'})).getAllByText('无权查看')).toHaveLength(5))
  expect(screen.queryByRole('spinbutton',{name:'积分数量'})).not.toBeInTheDocument();expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();expect(screen.queryByText('777')).not.toBeInTheDocument()
})
it('distinguishes uninitialized growth and points from legitimate empty honors and identities',async()=>{
  vi.mocked(getAdminUserMembershipSummary).mockResolvedValue({...membershipSummary,experience:null,nextLevel:null,points:null})
  const user=userEvent.setup();render(<UserAdminPanel canReadGroups canReadGroupMemberships capabilityKeys={['membership.rules.read','membership.points.grant','membership.medals.read']} />)
  await user.click(await screen.findByRole('button',{name:/社区成员/}))
  await waitFor(()=>expect(within(screen.getByRole('region',{name:'会员身份摘要'})).getAllByText('未初始化')).toHaveLength(2))
  expect(screen.getByRole('region',{name:'会员身份摘要'})).toHaveTextContent('无有效身份');expect(screen.getByRole('region',{name:'会员身份摘要'})).toHaveTextContent('勋章数量0');expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})

it('rejects an aggregate account revision older than a completed status mutation',async()=>{
  const pending=deferred<AdminUserMembershipSummary>();vi.mocked(getAdminUserMembershipSummary).mockReturnValueOnce(pending.promise)
  vi.mocked(updateAdminUserStatus).mockResolvedValue({userId,status:'suspended',reason:'违规复核',expiresAt:null,revision:4,auditId:secondUserId,actor:{id:secondUserId,username:'owner',displayName:'站长',avatarUrl:null},changedAt:summary.createdAt})
  const user=userEvent.setup();render(<UserAdminPanel canModerate csrfToken="csrf" />);await user.click(await screen.findByRole('button',{name:/社区成员/}));await user.click(await screen.findByRole('tab',{name:'账号安全'}));await user.click(await screen.findByRole('button',{name:'管理账号状态'}));await user.selectOptions(screen.getByLabelText('账号动作'),'suspended');await user.clear(screen.getByLabelText('操作原因'));await user.type(screen.getByLabelText('操作原因'),'违规复核');await user.click(screen.getByRole('button',{name:'确认提交'}));await user.click(screen.getByRole('button',{name:'确认暂停账号'}));await screen.findByText('审计编号')
  await act(async()=>pending.resolve({...membershipSummary,account:{...detail,status:'active',restrictionReason:null,revision:3}}))
  expect(within(screen.getByRole('dialog',{name:'用户详情'})).getByText('已暂停',{exact:true})).toBeInTheDocument()
})

it('retains an unconfirmed points attempt when the requested UID changes externally',async()=>{
  vi.mocked(grantMembershipPoints).mockRejectedValue(new Error('offline'))
  vi.mocked(getAdminUser).mockImplementation(async id=>id===userId?detail:{...detail,id:secondUserId,displayName:'第二位成员',username:'second'})
  const user=userEvent.setup(),publish=vi.fn(),keys=['membership.points.grant'];const view=render(<UserAdminPanel requestedQuery={'user_id='+userId} onQueryChange={publish} csrfToken="csrf" capabilityKeys={keys} />)
  await user.click(await screen.findByRole('tab',{name:'会员身份'}));await user.type(await screen.findByRole('spinbutton',{name:'积分数量'}),'30');await user.selectOptions(screen.getByLabelText('运营原因'),'operations.community_reward');await user.click(screen.getByRole('button',{name:'确认积分操作'}));await screen.findByRole('alert');await waitFor(()=>expect(screen.getByRole('button',{name:'返回列表'})).toBeDisabled())
  view.rerender(<UserAdminPanel requestedQuery={'user_id='+secondUserId} onQueryChange={publish} csrfToken="csrf" capabilityKeys={keys} />)
  await waitFor(()=>expect(publish).toHaveBeenLastCalledWith('user_id='+userId))
  expect(screen.getByRole('heading',{name:'社区成员'})).toBeInTheDocument();expect(screen.getByRole('spinbutton',{name:'积分数量'})).toHaveValue(30)
  const leave = new MouseEvent('click', { bubbles: true, cancelable: true })
  act(() => { screen.getByRole('link', { name: '查看用户主页' }).dispatchEvent(leave) })
  expect(leave.defaultPrevented).toBe(true)
})

it('locks other membership writes and UID navigation while EXP is unconfirmed',async()=>{
  vi.mocked(adjustAdminExperience).mockRejectedValue(new Error('offline'))
  const user=userEvent.setup();render(<UserAdminPanel csrfToken="csrf" capabilityKeys={['membership.points.grant','membership.rules.read','membership.rules.write']} />)
  await user.click(await screen.findByRole('button',{name:/社区成员/}));await user.click(await screen.findByRole('tab',{name:'会员身份'}))
  await user.type(await screen.findByRole('spinbutton',{name:'积分数量'}),'30')
  await user.type(await screen.findByRole('spinbutton',{name:'增加 EXP 数量'}),'10');await user.type(screen.getByRole('textbox',{name:'EXP 调整原因'}),'补记贡献')
  await user.click(screen.getByRole('button',{name:'确认 EXP 调整'}))
  await screen.findByText(/EXP 操作结果尚未确认/)
  expect(screen.getByRole('button',{name:'确认积分操作'})).toBeDisabled()
  expect(screen.getByRole('button',{name:'返回列表'})).toBeDisabled()
  expect(screen.getByRole('tab',{name:'概览'})).toBeDisabled()
  expect(screen.getByRole('button',{name:'使用原请求重试确认'})).toBeEnabled()
  expect(grantMembershipPoints).not.toHaveBeenCalled()
})
