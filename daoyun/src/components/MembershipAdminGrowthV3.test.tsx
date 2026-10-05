import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AdminApiError, createAdminGrowthLevel, getAdminGrowthLevels, updateAdminGrowthLevel, type AdminGrowthLevel } from "../api/admin"
import { MembershipAdminPanel } from "./MembershipAdminPanel"

vi.mock("../api/admin", async importOriginal => ({ ...await importOriginal<typeof import("../api/admin")>(), getAdminGrowthLevels: vi.fn(), updateAdminGrowthLevel: vi.fn(), createAdminGrowthLevel: vi.fn() }))
const props = { csrfToken: "csrf", canReadLevelRules: true, canWriteLevelRules: true, canReadMedalRules: false, canWriteMedalRules: false, canGrantPoints: false, canGrantMedals: false, canReadGroups: false, canWriteGroups: false, canReadGroupMemberships: false, canWriteGroupMemberships: false, canReadUsers: false, canReadEntitlementTypes: false, canWriteEntitlementTypes: false, canReadEntitlementGrants: false, canWriteEntitlementGrants: false }
const level: AdminGrowthLevel = { id: "019fc900-0000-7000-8000-000000000801", internalKey: "traveler", levelOrder: 2, displayName: "旅者", requiredExperience: 100, iconAssetId: null, color: null, description: "成长阶段", status: "draft", revision: 1, publishedAt: null, createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z" }
beforeEach(() => { vi.mocked(getAdminGrowthLevels).mockResolvedValue([level]); vi.mocked(updateAdminGrowthLevel).mockResolvedValue({ ...level, revision: 2 }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

it.each([["draft", "草稿"], ["disabled", "已停用"]] as const)("keeps %s levels out of published rules when only changing a name", async (status, label) => {
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([{ ...level, status }])
  vi.mocked(updateAdminGrowthLevel).mockResolvedValue({ ...level, status, displayName: "行者", revision: 2 })
  const user = userEvent.setup()
  render(<MembershipAdminPanel {...props} />)
  await user.click(await screen.findByRole("button", { name: "编辑 traveler" }))
  const dialog = screen.getByRole("dialog", { name: "编辑成长等级" })
  const name = within(dialog).getByLabelText("展示名称")
  await user.clear(name); await user.type(name, "行者")
  await user.click(within(dialog).getByRole("button", { name: "保存更改" }))
  expect(updateAdminGrowthLevel).toHaveBeenCalledWith(level.id, expect.objectContaining({ displayName: "行者", status }), "csrf")
  expect(screen.getByRole("list", { name: "成长等级列表" })).toHaveTextContent(label)
})

it("previews a chosen level status locally and writes only on explicit save", async () => {
  const user = userEvent.setup()
  render(<MembershipAdminPanel {...props} />)
  await user.click(await screen.findByRole("button", { name: "编辑 traveler" }))
  const dialog = screen.getByRole("dialog", { name: "编辑成长等级" })
  await user.selectOptions(within(dialog).getByLabelText("等级状态"), "published")
  const threshold = within(dialog).getByLabelText("EXP 阈值")
  await user.clear(threshold); await user.type(threshold, "250")
  expect(within(dialog).getByRole("region", { name: "等级预览" })).toHaveTextContent("250")
  expect(within(dialog).getByRole("region", { name: "等级预览" })).toHaveTextContent("已发布")
  expect(within(dialog).getByText("仅本地预览，不修改真实账户或奖励账本。")).toBeInTheDocument()
  expect(updateAdminGrowthLevel).not.toHaveBeenCalled(); expect(createAdminGrowthLevel).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole("button", { name: "保存更改" }))
  expect(updateAdminGrowthLevel).toHaveBeenCalledWith(level.id, expect.objectContaining({ requiredExperience: 250, status: "published" }), "csrf")
})

it("does not apply a late conflict refresh to a newly opened edit of the same level", async () => {
  let finish!: (levels: AdminGrowthLevel[]) => void
  vi.mocked(getAdminGrowthLevels).mockResolvedValueOnce([level]).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  vi.mocked(updateAdminGrowthLevel).mockRejectedValueOnce(new AdminApiError(409, "membership.level_revision_conflict", "版本冲突")).mockResolvedValueOnce({ ...level, revision: 2 })
  const user = userEvent.setup()
  render(<MembershipAdminPanel {...props} />)
  await user.click(await screen.findByRole("button", { name: "编辑 traveler" }))
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "保存更改" }))
  await user.click(await screen.findByRole("button", { name: "刷新最新数据" }))
  await waitFor(() => expect(getAdminGrowthLevels).toHaveBeenCalledTimes(2))
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }))
  await user.click(screen.getByRole("button", { name: "编辑 traveler" }))
  await act(async () => finish([{ ...level, revision: 9, displayName: "远端旧刷新" }]))
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "保存更改" }))
  expect(updateAdminGrowthLevel).toHaveBeenLastCalledWith(level.id, expect.objectContaining({ expectedRevision: 1, status: "draft" }), "csrf")
})

it("allows only transitions from the persisted lifecycle state", async () => {
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([{ ...level, status: "published" }])
  const user = userEvent.setup(); render(<MembershipAdminPanel {...props} />)
  await user.click(await screen.findByRole("button", { name: "编辑 traveler" }))
  const status = within(screen.getByRole("dialog")).getByLabelText("等级状态")
  expect(within(status).queryByRole("option", { name: "草稿" })).not.toBeInTheDocument()
  await user.selectOptions(status, "archived")
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "保存更改" })).toBeEnabled()
})
it("shows archived rules in a read-only dialog without an unsupported save", async () => {
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([{ ...level, status: "archived" }])
  const user = userEvent.setup(); render(<MembershipAdminPanel {...props} />)
  const view = await screen.findByRole("button", { name: "查看 traveler" })
  expect(screen.queryByRole("button", { name: "删除 traveler" })).not.toBeInTheDocument()
  await user.click(view)
  const dialog = screen.getByRole("dialog", { name: "查看成长等级" })
  expect(within(dialog).getByLabelText("展示名称")).toBeDisabled()
  expect(within(dialog).getByLabelText("等级状态")).toBeDisabled()
  expect(within(dialog).queryByRole("button", { name: "保存更改" })).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole("button", { name: "取消" }))
  expect(updateAdminGrowthLevel).not.toHaveBeenCalled()
})
