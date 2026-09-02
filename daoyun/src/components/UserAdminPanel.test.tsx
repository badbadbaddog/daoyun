import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
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
    expect(screen.getByText("版主")).toBeInTheDocument()
    const overviewTab = screen.getByRole("tab", { name: "概览" })
    const overviewPanel = screen.getByRole("tabpanel")
    expect(overviewTab).toHaveAttribute("aria-controls", overviewPanel.id)
    expect(overviewPanel).toHaveAttribute("aria-labelledby", overviewTab.id)
    await user.click(screen.getByRole("tab", { name: "最近内容" }))
    expect(screen.getByRole("heading", { name: "社区主题" })).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "相关举报" }))
    expect(screen.getByText("暂无相关举报")).toBeInTheDocument()
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
    await user.selectOptions(screen.getByLabelText("添加角色"), secondUserId)
    await user.click(screen.getByRole("button", { name: "分配角色" }))

    await waitFor(() => expect(createAuthorizationAssignment).toHaveBeenCalledWith({
      username: "member", roleId: secondUserId, scopeId: null,
    }, "csrf-token"))
    expect(screen.queryByRole("textbox", { name: /用户名/ })).not.toBeInTheDocument()
    expect(await screen.findByText("角色已分配给社区成员")).toBeInTheDocument()
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

    const trigger = await screen.findByRole("button", { name: "移除版主角色" })
    await user.click(trigger)
    const dialog = screen.getByRole("alertdialog", { name: "移除“版主”角色" })
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus()
    expect(deleteAuthorizationAssignment).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "确认移除角色" }))
    await waitFor(() => expect(deleteAuthorizationAssignment).toHaveBeenCalledWith(assignmentId, "csrf-token"))
    expect(await screen.findByText("已移除社区成员的“版主”角色")).toBeInTheDocument()
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
