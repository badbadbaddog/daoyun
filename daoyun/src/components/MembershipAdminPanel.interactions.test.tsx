import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { MembershipAdminPanel } from "./MembershipAdminPanel"
import { getAdminGrowthLevels, getAdminMembershipAccount } from "../api/admin"
import { listUsers } from "../api/users"

vi.mock("../api/admin", async importOriginal => ({ ...await importOriginal<typeof import("../api/admin")>(), getAdminGrowthLevels: vi.fn(), getAdminMembershipAccount: vi.fn() }))
vi.mock("../api/users", () => ({ listUsers: vi.fn() }))
const first = { id: "first", username: "first", displayName: "第一位", avatarUrl: null }
const second = { id: "second", username: "second", displayName: "第二位", avatarUrl: null }
const props = { csrfToken: "csrf", canReadLevelRules: true, canWriteLevelRules: false, canReadMedalRules: false, canWriteMedalRules: false, canGrantPoints: true, canGrantMedals: false, canReadGroups: false, canWriteGroups: false, canReadGroupMemberships: false, canWriteGroupMemberships: false, canReadUsers: true, canReadEntitlementTypes: false, canWriteEntitlementTypes: false, canReadEntitlementGrants: false, canWriteEntitlementGrants: false }
const account = (balance: number) => ({ userId: "first", pointsBalance: balance, lifetimePoints: balance, growthExp: 0, growthLevel: null, levelKey: "lv_1", levelNumber: 1, levelDisplayName: "Lv1", revision: 1, createdAt: "", updatedAt: "" })
beforeEach(() => {
  vi.mocked(getAdminGrowthLevels).mockResolvedValue([])
  vi.mocked(listUsers).mockResolvedValue({ users: [first, second], nextCursor: null })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it("ignores an old balance response after selecting another member", async () => {
  let finish!: (value: Awaited<ReturnType<typeof getAdminMembershipAccount>>) => void
  vi.mocked(getAdminMembershipAccount).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(account(20))
  const user = userEvent.setup()
  render(<MembershipAdminPanel {...props} />)
  await user.click(screen.getByRole("tab", { name: "积分运营" }))
  await user.type(screen.getByLabelText("搜索用户"), "member")
  await user.click(await screen.findByRole("button", { name: "选择第一位 @first" }))
  await user.click(screen.getByRole("button", { name: "选择第二位 @second" }))
  expect(await within(screen.getByLabelText("已选用户")).findByText("20")).toBeInTheDocument()
  await act(async () => finish(account(90)))
  expect(within(screen.getByLabelText("已选用户")).getByText("20")).toBeInTheDocument()
  expect(screen.queryByText("90")).not.toBeInTheDocument()
})

it("offers a balance retry and preserves a points draft across workspaces", async () => {
  vi.mocked(getAdminMembershipAccount).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(account(50))
  const user = userEvent.setup()
  render(<MembershipAdminPanel {...props} />)
  await user.click(screen.getByRole("tab", { name: "积分运营" }))
  await user.type(screen.getByLabelText("搜索用户"), "member")
  await user.click(await screen.findByRole("button", { name: "选择第一位 @first" }))
  await user.click(await screen.findByRole("button", { name: "重新读取余额" }))
  await within(screen.getByLabelText("已选用户")).findByText("50")
  await user.type(screen.getByLabelText("积分数量"), "30")
  await user.selectOptions(screen.getByLabelText("运营原因"), "operations.correction")
  await user.click(screen.getByRole("tab", { name: "成长运营" }))
  expect(screen.queryByRole("spinbutton", { name: "积分数量" })).not.toBeInTheDocument()
  await user.click(screen.getByRole("tab", { name: "积分运营" }))
  expect(screen.getByLabelText("积分数量")).toHaveValue(30)
  expect(screen.getByLabelText("运营原因")).toHaveValue("operations.correction")
})
