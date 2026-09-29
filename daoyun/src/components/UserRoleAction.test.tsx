import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createAuthorizationAssignment, deleteAuthorizationAssignment, listAuthorizationAssignments, listAuthorizationRoles, type AuthorizationRole, type AuthorizationRoleAssignment, type AdminBoard } from "../api/admin"
import { type AdminUserDetail } from "../api/adminUsers"
import { UserRoleAction } from "./UserRoleAction"

vi.mock("../api/admin", async () => ({ ...await vi.importActual("../api/admin"), listAuthorizationRoles: vi.fn(), listAuthorizationAssignments: vi.fn(), createAuthorizationAssignment: vi.fn(), deleteAuthorizationAssignment: vi.fn() }))
const actor = { id: "u1", username: "member", displayName: "成员", avatarUrl: null }
const role: AuthorizationRole = { id: "r1", key: "helper", name: "协管员", scope: "site", isSystem: false, permissionKeys: [], assignmentCount: 0, revision: 1, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" }
const otherRole = { ...role, id: "r2", name: "编辑" }
const assignment = (r = role, scopeId: string | null = null): AuthorizationRoleAssignment => ({ id: r.id + (scopeId ?? ""), user: actor, role: r, scopeId, assignedBy: actor, createdAt: role.createdAt })
const detail: AdminUserDetail = { ...actor, status: "active", primaryRole: null, topicCount: 0, postCount: 0, reportCount: 0, createdAt: role.createdAt, lastSeenAt: null, bio: "", location: null, websiteUrl: null, followerCount: 0, followingCount: 0, roles: [], restrictionReason: null, restrictionExpiresAt: null, revision: 1 }
const updated = vi.fn()
function renderEditor(extra: Partial<Parameters<typeof UserRoleAction>[0]> = {}) {
  return render(<UserRoleAction detail={detail} csrfToken="csrf" boards={[]} onRolesUpdated={updated} {...extra} />)
}
beforeEach(() => {
  vi.mocked(listAuthorizationRoles).mockResolvedValue([role, otherRole])
  vi.mocked(listAuthorizationAssignments).mockResolvedValue({ assignments: [], nextCursor: null })
  vi.mocked(createAuthorizationAssignment).mockImplementation(async input => assignment(input.roleId === role.id ? role : otherRole, input.scopeId))
  vi.mocked(deleteAuthorizationAssignment).mockResolvedValue(true)
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it("stages several roles, resets locally, and saves only after confirmation", async () => {
  const user = userEvent.setup(); renderEditor()
  await user.click(await screen.findByRole("checkbox", { name: "协管员" }))
  await user.click(screen.getByRole("checkbox", { name: "编辑" }))
  expect(createAuthorizationAssignment).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "撤销更改" }))
  expect(screen.getByRole("checkbox", { name: "协管员" })).not.toBeChecked()
  await user.click(screen.getByRole("checkbox", { name: "协管员" }))
  await user.click(screen.getByRole("checkbox", { name: "编辑" }))
  await user.click(screen.getByRole("button", { name: "保存角色" }))
  expect(screen.getByRole("alertdialog")).toHaveTextContent("新增 2 项")
  expect(createAuthorizationAssignment).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "确认保存角色" }))
  expect(await screen.findByText("角色已保存")).toBeInTheDocument()
  expect(createAuthorizationAssignment).toHaveBeenCalledTimes(2)
  expect(updated).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: "r1" }), expect.objectContaining({ id: "r2" })]))
})

it("reads every assignment page and removes only the unchecked board scope for this user", async () => {
  const boardRole = { ...role, scope: "board" as const }
  vi.mocked(listAuthorizationRoles).mockResolvedValue([boardRole])
  vi.mocked(listAuthorizationAssignments).mockResolvedValueOnce({ assignments: [assignment(boardRole, "b1"), { ...assignment(boardRole, "b1"), id: "other-user", user: { ...actor, id: "u2" } }], nextCursor: "next" }).mockResolvedValueOnce({ assignments: [assignment(boardRole, "b2")], nextCursor: null })
  const user = userEvent.setup()
  renderEditor({ boards: [{ id: "b1", name: "交流" }, { id: "b2", name: "技术" }] as AdminBoard[] })
  const first = await screen.findByRole("checkbox", { name: "协管员 · 交流" })
  expect(first).toBeChecked()
  expect(screen.getByRole("checkbox", { name: "协管员 · 技术" })).toBeChecked()
  await user.click(first); await user.click(screen.getByRole("button", { name: "保存角色" }))
  await user.click(screen.getByRole("button", { name: "确认保存角色" }))
  await screen.findByText("角色已保存")
  expect(deleteAuthorizationAssignment).toHaveBeenCalledExactlyOnceWith("r1b1", "csrf")
  expect(updated).toHaveBeenLastCalledWith([expect.objectContaining({ id: "r1" })])
})

it("keeps system roles read-only and requires a real board for a new board assignment", async () => {
  vi.mocked(listAuthorizationRoles).mockResolvedValue([{ ...role, isSystem: true }, { ...otherRole, scope: "board" }])
  renderEditor({ detail: { ...detail, roles: [{ ...role, isSystem: true }] } })
  const system = await screen.findByRole("checkbox", { name: "协管员" })
  expect(system).toBeChecked(); expect(system).toBeDisabled()
  expect(screen.getByText("没有可选择的板块")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "保存角色" })).toBeDisabled()
})

it("reconciles partial saves and retries only unfinished changes", async () => {
  const user = userEvent.setup()
  vi.mocked(createAuthorizationAssignment).mockResolvedValueOnce(assignment()).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(assignment(otherRole))
  vi.mocked(listAuthorizationAssignments).mockResolvedValueOnce({ assignments: [], nextCursor: null }).mockResolvedValueOnce({ assignments: [assignment()], nextCursor: null })
  renderEditor()
  await user.click(await screen.findByRole("checkbox", { name: "协管员" })); await user.click(screen.getByRole("checkbox", { name: "编辑" }))
  await user.click(screen.getByRole("button", { name: "保存角色" })); await user.click(screen.getByRole("button", { name: "确认保存角色" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("已保存 1 项")
  expect(screen.getByRole("checkbox", { name: "编辑" })).toBeChecked()
  await user.click(screen.getByRole("button", { name: "保存角色" }))
  expect(screen.getByRole("alertdialog")).toHaveTextContent("新增 1 项")
  await user.click(screen.getByRole("button", { name: "确认保存角色" }))
  await screen.findByText("角色已保存")
  expect(vi.mocked(createAuthorizationAssignment).mock.calls.map(([input]) => input.roleId)).toEqual(["r1", "r2", "r2"])
})

it("locks fields and confirmation while a save is pending", async () => {
  let resolve!: (value: AuthorizationRoleAssignment) => void
  const pending = new Promise<AuthorizationRoleAssignment>(r => { resolve = r })
  vi.mocked(createAuthorizationAssignment).mockReturnValue(pending)
  const user = userEvent.setup(); renderEditor()
  await user.click(await screen.findByRole("checkbox", { name: "协管员" }))
  await user.click(screen.getByRole("button", { name: "保存角色" }))
  await user.dblClick(screen.getByRole("button", { name: "确认保存角色" }))
  expect(createAuthorizationAssignment).toHaveBeenCalledTimes(1)
  expect(screen.getByRole("checkbox", { name: "协管员" })).toBeDisabled()
  expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "取消" })).toBeDisabled()
  await user.keyboard("{Escape}"); expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  await act(async () => { resolve(assignment()); await pending })
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
})

it("blocks further saving until failed reconciliation can be retried", async () => {
  const user = userEvent.setup()
  vi.mocked(createAuthorizationAssignment).mockRejectedValueOnce(new Error("lost response"))
  vi.mocked(listAuthorizationAssignments).mockResolvedValueOnce({ assignments: [], nextCursor: null }).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ assignments: [assignment()], nextCursor: null })
  renderEditor()
  await user.click(await screen.findByRole("checkbox", { name: "协管员" }))
  await user.click(screen.getByRole("button", { name: "保存角色" }))
  await user.click(screen.getByRole("button", { name: "确认保存角色" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("请先重新读取角色数据")
  expect(screen.queryByRole("button", { name: "保存角色" })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "重试角色数据" }))
  expect(await screen.findByRole("checkbox", { name: "协管员" })).toBeChecked()
  expect(screen.getByRole("button", { name: "保存角色" })).toBeDisabled()
  expect(updated).toHaveBeenLastCalledWith([expect.objectContaining({ id: "r1" })])
  expect(createAuthorizationAssignment).toHaveBeenCalledTimes(1)
})
