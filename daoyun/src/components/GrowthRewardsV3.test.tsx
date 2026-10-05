import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { getAdminGrowthLevels } from "../api/admin"
import { listPlugins, type Plugin } from "../api/plugins"
import { MembershipAdminPanel } from "./MembershipAdminPanel"

vi.mock("../api/admin", async importOriginal => ({ ...await importOriginal<typeof import("../api/admin")>(), getAdminGrowthLevels: vi.fn() }))
vi.mock("../api/plugins", async importOriginal => ({ ...await importOriginal<typeof import("../api/plugins")>(), listPlugins: vi.fn() }))
const props = { csrfToken: "csrf", canReadLevelRules: true, canWriteLevelRules: false, canReadMedalRules: false, canWriteMedalRules: false, canGrantPoints: false, canGrantMedals: false, canReadGroups: false, canWriteGroups: false, canReadGroupMemberships: false, canWriteGroupMemberships: false, canReadUsers: false, canReadEntitlementTypes: false, canWriteEntitlementTypes: false, canReadEntitlementGrants: false, canWriteEntitlementGrants: false }
const plugin: Plugin = { id: "019fc900-0000-7000-8000-000000000811", key: "official_growth_rewards", name: "Official Growth", version: "0.1.0", description: "", manifestSchemaVersion: 1, businessApiVersion: "0.1.0", capabilities: ["events.subscribe", "experience.write"], dataScopes: ["users.targeted"], eventSubscriptions: ["topic.published", "reply.created"], componentSha256: "a".repeat(64), componentSize: 123, status: "disabled", revision: 1, installedBy: "admin", createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z" }
beforeEach(() => { vi.mocked(getAdminGrowthLevels).mockResolvedValue([]); vi.mocked(listPlugins).mockResolvedValue([plugin]) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

it("shows the original UTC daily rules without fetching private plugin state without permission", async () => {
  render(<MembershipAdminPanel {...props} />)
  const rules = await screen.findByRole("region", { name: "成长奖励规则" })
  expect(rules).toHaveTextContent("UTC"); expect(rules).toHaveTextContent("10 EXP"); expect(rules).toHaveTextContent("3 EXP")
  expect(rules).toHaveTextContent("每人每规则每天最多一次")
  expect(rules).toHaveTextContent("未开放内置执行器切换")
  expect(rules).toHaveTextContent("无插件状态读取权限")
  expect(listPlugins).not.toHaveBeenCalled()
})

it("keeps a disabled installation explicit and retries a local plugin status failure", async () => {
  vi.mocked(listPlugins).mockRejectedValueOnce(new Error("状态离线")).mockResolvedValueOnce([plugin])
  const user = userEvent.setup()
  render(<MembershipAdminPanel {...props} canReadPlugins />)
  const rules = await screen.findByRole("region", { name: "成长奖励规则" })
  expect(await within(rules).findByRole("alert")).toHaveTextContent("状态离线")
  expect(screen.getByRole("heading", { name: "成长等级（EXP）" })).toBeInTheDocument()
  await user.click(within(rules).getByRole("button", { name: "重新读取奖励安装状态" }))
  expect(await within(rules).findByText("安装状态：已停用")).toBeInTheDocument()
  expect(listPlugins).toHaveBeenCalledTimes(2)
})

it("distinguishes an absent installation and ignores late private status after permission removal", async () => {
  let finish!: (plugins: Plugin[]) => void
  vi.mocked(listPlugins).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = render(<MembershipAdminPanel {...props} canReadPlugins />)
  const rules = await screen.findByRole("region", { name: "成长奖励规则" })
  view.rerender(<MembershipAdminPanel {...props} canReadPlugins={false} />)
  await act(async () => finish([plugin]))
  expect(rules).toHaveTextContent("无插件状态读取权限")
  expect(rules).not.toHaveTextContent("安装状态：已停用")
  vi.mocked(listPlugins).mockResolvedValue([])
  view.rerender(<MembershipAdminPanel {...props} canReadPlugins />)
  expect(await within(rules).findByText("安装状态：未安装")).toBeInTheDocument()
})
