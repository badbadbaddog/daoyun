import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAuthorizationAssignment, deleteAuthorizationAssignment, listAdminAudit, listAuthorizationAssignments, listAuthorizationRoles } from "../api/admin"
import { AdminUsersApiError, getAdminUser, listAdminUserContent, listAdminUsers, updateAdminUserStatus } from "../api/adminUsers"
import { listAdminUserReports } from "../api/reports"
import { UserAdminPanel } from "./UserAdminPanel"

vi.mock("../api/adminUsers", async () => {
  const actual = await vi.importActual<typeof import("../api/adminUsers")>("../api/adminUsers")
  return { ...actual, getAdminUser: vi.fn(), listAdminUserContent: vi.fn(), listAdminUsers: vi.fn(), updateAdminUserStatus: vi.fn() }
})

vi.mock("../api/admin", async () => {
  const actual = await vi.importActual<typeof import("../api/admin")>("../api/admin")
  return { ...actual, createAuthorizationAssignment: vi.fn(), deleteAuthorizationAssignment: vi.fn(), listAdminAudit: vi.fn(), listAuthorizationAssignments: vi.fn(), listAuthorizationRoles: vi.fn() }
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
  vi.mocked(listAdminUsers).mockReset().mockResolvedValue({ users: [summary], nextCursor: null })
  vi.mocked(getAdminUser).mockReset().mockResolvedValue(detail)
  vi.mocked(listAdminUserContent).mockReset().mockResolvedValue({ items: [{ id: userId, kind: "topic", topicId: userId, title: "社区主题", excerpt: "摘要", status: "published", createdAt: "2026-08-03T10:00:00Z" }], nextCursor: null })
  vi.mocked(listAdminUserReports).mockReset().mockResolvedValue({ reports: [], nextCursor: null })
  vi.mocked(updateAdminUserStatus).mockReset().mockResolvedValue({
    userId, status: "suspended", reason: "严重违规", expiresAt: null, revision: 3,
    auditId: secondUserId, actor: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null }, changedAt: "2026-08-12T08:00:00Z",
  })
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
  it("opens details only in a drawer and keeps action forms behind dialogs", async () => {
    const user = userEvent.setup()
    render(<UserAdminPanel canModerate canAssignRoles csrfToken="csrf-token" />)
    const opener = await screen.findByRole("button", { name: /社区成员/ })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("添加角色")).not.toBeInTheDocument()
    await user.click(opener)
    expect(await screen.findByRole("dialog", { name: "用户详情" })).toBeInTheDocument()
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
    expect(screen.getByText("等待人工复核")).toBeInTheDocument()
    expect(within(screen.getByRole("dialog", { name: "用户详情" })).getByText("版主")).toBeInTheDocument()
    const overviewTab = screen.getByRole("tab", { name: "概览" })
    const contentTab = screen.getByRole("tab", { name: "最近内容" })
    const reportsTab = screen.getByRole("tab", { name: "相关举报" })
    const overviewPanel = screen.getByRole("tabpanel")
    expect(overviewTab).toHaveAttribute("aria-controls", overviewPanel.id)
    expect(overviewPanel).toHaveAttribute("aria-labelledby", overviewTab.id)
    expect(overviewTab).toHaveAttribute("tabindex", "0")
    expect(contentTab).toHaveAttribute("tabindex", "-1")

    overviewTab.focus()
    await user.keyboard("{ArrowRight}")
    expect(contentTab).toHaveFocus()
    expect(contentTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("heading", { name: "社区主题" })).toBeInTheDocument()

    await user.keyboard("{End}")
    expect(reportsTab).toHaveFocus()
    expect(reportsTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("暂无相关举报")).toBeInTheDocument()

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
      scopeId: null, assignedBy: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null }, createdAt: "2026-08-12T08:00:00Z",
    })
    const user = userEvent.setup()
    render(<UserAdminPanel canAssignRoles csrfToken="csrf-token" />)
    await user.click(await screen.findByRole("button", { name: /社区成员/ }))
    expect(await screen.findByRole("heading", { name: "社区成员" })).toBeInTheDocument()
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
      assignedBy: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null },
      createdAt: "2026-08-12T08:00:00Z",
    }], nextCursor: null })
    const user = userEvent.setup()
    render(<UserAdminPanel canAssignRoles csrfToken="csrf-token" />)
    await user.click(await screen.findByRole("button", { name: /社区成员/ }))

    await user.click(await screen.findByRole("checkbox", { name: "版主" }))
    await user.click(screen.getByRole("button", { name: "保存角色" }))
    const dialog = screen.getByRole("alertdialog", { name: "确认角色变更" })
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus()
    expect(deleteAuthorizationAssignment).not.toHaveBeenCalled()

    vi.mocked(listAdminUsers).mockResolvedValue({ users: [{ ...summary, primaryRole: null }], nextCursor: null })
    await user.click(within(dialog).getByRole("button", { name: "确认保存角色" }))
    await waitFor(() => expect(deleteAuthorizationAssignment).toHaveBeenCalledWith(assignmentId, "csrf-token"))
    expect(await screen.findByText("角色已保存")).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByRole("table", { name: "用户列表" })).getByText("普通成员")).toBeInTheDocument())
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
  await user.click(await screen.findByRole("tab", { name: "最近内容" }))
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
  await user.click(await screen.findByRole("tab", { name: "最近内容" }))
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
  await user.click(await screen.findByRole("tab", { name: "最近内容" }))
  const signal = vi.mocked(listAdminUserContent).mock.calls[1][2]
  await user.click(screen.getByRole("tab", { name: "相关举报" }))
  expect(signal?.aborted).toBe(true)
  expect(await screen.findByText("暂无相关举报")).toBeInTheDocument()
  expect(listAdminUserReports).toHaveBeenCalledTimes(1)
  slow.resolve({ items: [], nextCursor: null })
  await Promise.resolve()
  expect(screen.getByRole("tab", { name: "相关举报" })).toHaveAttribute("aria-selected", "true")
})


it("refreshes a status conflict without discarding the user's draft", async () => {
  const user = userEvent.setup()
  vi.mocked(updateAdminUserStatus).mockRejectedValueOnce(new AdminUsersApiError(409, "user.revision_conflict", "账号已被其他管理员更新"))
  render(<UserAdminPanel canModerate csrfToken="csrf-token" />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
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
  await user.click(await screen.findByRole("checkbox", { name: "协管员" }))
  await user.click(screen.getByRole("button", { name: "保存角色" }))
  await user.dblClick(screen.getByRole("button", { name: "确认保存角色" }))
  expect(createAuthorizationAssignment).toHaveBeenCalledTimes(1)
  expect(screen.getByRole("checkbox", { name: "协管员" })).toBeDisabled()
  expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "取消" })).toBeDisabled()
  await user.keyboard("{Escape}")
  expect(screen.getByRole("alertdialog", { name: "确认角色变更" })).toBeInTheDocument()
  await act(async () => { pending.resolve({ id: secondUserId, role, user: { id: userId, username: summary.username, displayName: summary.displayName, avatarUrl: null }, scopeId: null, assignedBy: { id: secondUserId, username: "owner", displayName: "站长", avatarUrl: null }, createdAt: summary.createdAt }); await pending.promise })
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
  expect(screen.getByRole("tab", { name: "最近内容" })).toHaveFocus()
})

it("opens the requested quick account action without submitting it", async () => {
  const user = userEvent.setup()
  render(<UserAdminPanel canModerate csrfToken="csrf-token" />)
  await user.click(await screen.findByRole("button", { name: /社区成员/ }))
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
