import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createAuthorizationAssignment,
  createAuthorizationRole,
  deleteAuthorizationAssignment,
  deleteAuthorizationRole,
  listAuthorizationAssignments,
  listAuthorizationPermissions,
  listAuthorizationRoles,
  updateAuthorizationRole,
} from "../api/admin"
import { AuthorizationAdminPanel } from "./AuthorizationAdminPanel"

vi.mock("../api/admin", async () => {
  const actual = await vi.importActual<typeof import("../api/admin")>("../api/admin")
  return {
    ...actual,
    createAuthorizationAssignment: vi.fn(),
    createAuthorizationRole: vi.fn(),
    deleteAuthorizationAssignment: vi.fn(),
    deleteAuthorizationRole: vi.fn(),
    listAuthorizationAssignments: vi.fn(),
    listAuthorizationPermissions: vi.fn(),
    listAuthorizationRoles: vi.fn(),
    updateAuthorizationRole: vi.fn(),
  }
})

const csrfToken = "a".repeat(64)
const board = { id: "019fc900-0000-7000-8000-000000000101", parentId: null, slug: "general", name: "社区广场", description: "公开讨论", icon: "messages", tone: "green" as const, position: 0, visibility: "public" as const, topicCount: 2, revision: 1 }
const customRole = {
  id: "019fc900-0000-7000-8000-000000000501",
  key: "board_moderator",
  name: "版主",
  scope: "board" as const,
  isSystem: false,
  permissionKeys: ["content.moderate"],
  assignmentCount: 0,
  revision: 1,
  createdAt: "2026-08-10T01:00:00Z",
  updatedAt: "2026-08-10T01:00:00Z",
}
const systemRole = { ...customRole, id: "019fc900-0000-7000-8000-000000000502", key: "super_admin", name: "超级管理员", scope: "instance" as const, isSystem: true }
const assignment = {
  id: "019fc900-0000-7000-8000-000000000601",
  user: { id: "019fc900-0000-7000-8000-000000000401", username: "demo_member", displayName: "演示成员", avatarUrl: null },
  role: { id: customRole.id, key: customRole.key, name: customRole.name, scope: customRole.scope, isSystem: false, revision: 1 },
  scopeId: board.id,
  assignedBy: { id: "019fc900-0000-7000-8000-000000000004", username: "admin", displayName: "管理员", avatarUrl: null },
  createdAt: "2026-08-10T02:00:00Z",
}

beforeEach(() => {
  vi.mocked(listAuthorizationPermissions).mockResolvedValue([{ key: "content.moderate", name: "内容管理", description: "管理主题与回复" }])
  vi.mocked(listAuthorizationRoles).mockResolvedValue([systemRole, customRole])
  vi.mocked(listAuthorizationAssignments).mockResolvedValue({ assignments: [], nextCursor: null })
  vi.mocked(createAuthorizationRole).mockResolvedValue(customRole)
  vi.mocked(updateAuthorizationRole).mockResolvedValue({ ...customRole, revision: 2 })
  vi.mocked(createAuthorizationAssignment).mockResolvedValue(assignment)
  vi.mocked(deleteAuthorizationRole).mockResolvedValue(true)
  vi.mocked(deleteAuthorizationAssignment).mockResolvedValue(true)
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("AuthorizationAdminPanel", () => {
  it("renders system roles as read-only and creates a custom role", async () => {
    const user = userEvent.setup()
    vi.mocked(createAuthorizationRole).mockResolvedValueOnce({ ...customRole, id: "019fc900-0000-7000-8000-000000000503", key: "topic_reviewer", name: "主题审核员" })
    render(<AuthorizationAdminPanel csrfToken={csrfToken} boards={[board]} />)

    expect(await screen.findByRole("heading", { name: "角色与权限" })).toBeInTheDocument()
    expect(screen.getByText("超级管理员")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "编辑角色：超级管理员" })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText("角色键"), "topic_reviewer")
    await user.type(screen.getByLabelText("角色名称"), "主题审核员")
    await user.click(screen.getByLabelText("内容管理 content.moderate"))
    await user.click(screen.getByRole("button", { name: "创建角色" }))

    expect(createAuthorizationRole).toHaveBeenCalledWith({
      key: "topic_reviewer",
      name: "主题审核员",
      scope: "instance",
      permissionKeys: ["content.moderate"],
    }, csrfToken)
  })

  it("assigns a board-scoped custom role by exact username", async () => {
    const user = userEvent.setup()
    render(<AuthorizationAdminPanel csrfToken={csrfToken} boards={[board]} />)
    await screen.findByRole("heading", { name: "角色与权限" })

    await user.type(screen.getByLabelText("用户名（精确匹配）"), "demo_member")
    await user.selectOptions(screen.getByLabelText("自定义角色"), customRole.id)
    await user.selectOptions(screen.getByLabelText("作用板块"), board.id)
    await user.click(screen.getByRole("button", { name: "分配角色" }))

    expect(createAuthorizationAssignment).toHaveBeenCalledWith({ username: "demo_member", roleId: customRole.id, scopeId: board.id }, csrfToken)
    expect(await screen.findByText("demo_member")).toBeInTheDocument()
  })

  it("edits a role using its current revision", async () => {
    const user = userEvent.setup()
    render(<AuthorizationAdminPanel csrfToken={csrfToken} boards={[board]} />)
    await screen.findByRole("heading", { name: "角色与权限" })

    await user.click(screen.getByRole("button", { name: "编辑角色：版主" }))
    const name = screen.getByLabelText("角色名称")
    await user.clear(name)
    await user.type(name, "高级版主")
    await user.click(screen.getByRole("button", { name: "保存角色" }))

    await waitFor(() => expect(updateAuthorizationRole).toHaveBeenCalledWith(customRole.id, {
      name: "高级版主",
      permissionKeys: ["content.moderate"],
      expectedRevision: 1,
    }, csrfToken))
  })
})
