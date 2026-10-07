import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { getAdminGrowthLevels, getMembershipMedalRules } from "../api/admin"
import { MembershipAdminPanel } from "./MembershipAdminPanel"

vi.mock("../api/admin", async importOriginal => ({ ...await importOriginal<typeof import("../api/admin")>(), getAdminGrowthLevels: vi.fn(), getMembershipMedalRules: vi.fn() }))
vi.mock("./CommunityGroupAdminPanel", () => ({ CommunityGroupAdminPanel: () => <p>用户组目录</p> }))
vi.mock("../features/admin-membership/RedemptionWorkspace", () => ({ RedemptionWorkspace: () => <p>兑换商品目录</p> }))

const props = { csrfToken: "csrf", canReadLevelRules: true, canWriteLevelRules: false, canReadMedalRules: true, canWriteMedalRules: false, canGrantPoints: true, canGrantMedals: false, canReadGroups: true, canWriteGroups: false, canReadGroupMemberships: false, canWriteGroupMemberships: false, canReadUsers: false, canReadEntitlementTypes: true, canWriteEntitlementTypes: false, canReadEntitlementGrants: false, canWriteEntitlementGrants: false, canReadRedemptions: true }
beforeEach(() => { vi.mocked(getAdminGrowthLevels).mockResolvedValue([]); vi.mocked(getMembershipMedalRules).mockResolvedValue([]) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

it("opens community identities first and follows the membership navigation order by keyboard", async () => {
  const user = userEvent.setup()
  render(<MembershipAdminPanel {...props} />)
  const tabs = within(screen.getByRole("tablist", { name: "会员体系工作区" })).getAllByRole("tab")
  expect(tabs.map(tab => tab.textContent)).toEqual(["用户组", "成长等级", "积分管理", "勋章管理", "会员权益", "兑换商品"])
  expect(tabs[0]).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("tabpanel", { name: "用户组" })).toHaveTextContent("用户组目录")
  tabs[0].focus()
  await user.keyboard("{ArrowRight}")
  expect(tabs[1]).toHaveFocus()
  expect(tabs[1]).toHaveAttribute("aria-selected", "true")
  await user.keyboard("{End}")
  expect(tabs[5]).toHaveFocus()
  expect(screen.getByRole("tabpanel", { name: "兑换商品" })).toHaveTextContent("兑换商品目录")
  await user.keyboard("{Home}")
  expect(tabs[0]).toHaveFocus()
})

it("falls back to an authorized workspace when community identity access is withdrawn", async () => {
  const { rerender } = render(<MembershipAdminPanel {...props} />)
  expect(screen.getByRole("tab", { name: "用户组" })).toHaveAttribute("aria-selected", "true")
  rerender(<MembershipAdminPanel {...props} canReadGroups={false} canReadLevelRules={false} canReadMedalRules={false} canReadEntitlementTypes={false} canReadRedemptions={false} />)
  expect(screen.queryByRole("tab", { name: "用户组" })).not.toBeInTheDocument()
  expect(screen.getAllByRole("tab")).toHaveLength(1)
  expect(screen.getByRole("tab", { name: "积分管理" })).toHaveAttribute("aria-selected", "true")
})

it.each(["用户组", "成长等级", "积分管理", "勋章管理", "会员权益", "兑换商品"])("lets keyboard users enter the named %s panel and return to its tab", async label => {
  const user = userEvent.setup()
  render(<MembershipAdminPanel {...props} />)
  const tab = screen.getByRole("tab", { name: label })
  await user.click(tab)
  const panel = screen.getByRole("tabpanel", { name: label })
  await user.tab()
  expect(panel).toHaveFocus()
  await user.tab({ shift: true })
  expect(tab).toHaveFocus()
  expect(screen.queryByRole("tabpanel", { name: label === "积分管理" ? "用户组" : "积分管理" })).not.toBeInTheDocument()
})

it("keeps every authorized tab linked to a panel while inactive content stays hidden", () => {
  render(<MembershipAdminPanel {...props} />)
  for (const tab of within(screen.getByRole("tablist", { name: "会员体系工作区" })).getAllByRole("tab")) {
    const panel = document.getElementById(tab.getAttribute("aria-controls")!)
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute("aria-labelledby", tab.id)
    if (tab.getAttribute("aria-selected") === "false") expect(panel).toHaveAttribute("hidden")
  }
})
