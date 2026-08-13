import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthSession } from "../api/auth"
import {
  AdminApiError,
  getAdminAccess,
  getAdminSiteBranding,
  getMembershipLevelRules,
  grantMembershipPoints,
  listAuthorizationAssignments,
  listAuthorizationPermissions,
  listAuthorizationRoles,
  listAdminBoards,
  deleteBrandAsset,
  uploadBrandAsset,
  updateMembershipLevelRule,
  updateSiteBranding,
} from "../api/admin"
import { AdminView } from "./AdminView"

vi.mock("../api/admin", async () => {
  const actual = await vi.importActual<typeof import("../api/admin")>("../api/admin")
  return {
    ...actual,
    getAdminAccess: vi.fn(),
    getAdminSiteBranding: vi.fn(),
    listAdminBoards: vi.fn(),
    updateSiteBranding: vi.fn(),
    getMembershipLevelRules: vi.fn(),
    updateMembershipLevelRule: vi.fn(),
    grantMembershipPoints: vi.fn(),
    listAuthorizationAssignments: vi.fn(),
    listAuthorizationPermissions: vi.fn(),
    listAuthorizationRoles: vi.fn(),
    deleteBrandAsset: vi.fn(),
    uploadBrandAsset: vi.fn(),
  }
})

vi.mock("./OperationsAdminPanel", () => ({
  OperationsAdminPanel: () => <section><h2>运营概览</h2><p>运维监控面板</p></section>,
}))

vi.mock("./PluginAdminPanel", () => ({
  PluginAdminPanel: ({ canInstall, canLifecycle, canInvoke }: { canInstall: boolean; canLifecycle: boolean; canInvoke: boolean }) => <section><h2>插件平台</h2><p>{`${canInstall}/${canLifecycle}/${canInvoke}`}</p></section>,
}))

vi.mock("./UserAdminPanel", () => ({
  UserAdminPanel: ({ requestedQuery, canModerate, canAssignRoles }: { requestedQuery?: string; canModerate?: boolean; canAssignRoles?: boolean }) => <section><h2>用户管理台</h2><p>{requestedQuery}</p><span>{`${Boolean(canModerate)}/${Boolean(canAssignRoles)}`}</span></section>,
}))

vi.mock("./ReportAdminPanel", () => ({
  ReportAdminPanel: ({ requestedStatus, canResolve, onStatusChange }: { requestedStatus: string; canResolve: boolean; onStatusChange: (value: string) => void }) => <section><h2>举报处理工作台</h2><p>{`${requestedStatus}/${canResolve}`}</p><button type="button" onClick={() => onStatusChange("in_review")}>切换处理中</button></section>,
}))

vi.mock("./AdminDashboard", () => ({
  AdminDashboard: ({ capabilityKeys }: { capabilityKeys: string[] }) => <section><h2>今天需要处理什么</h2><p>{capabilityKeys.join(",")}</p></section>,
}))

const session: AuthSession = {
  user: { id: "019fc700-0000-7000-8000-000000000004", username: "admin", email: "admin@example.com", displayName: "管理员" },
  csrfToken: "a".repeat(64),
}
const branding = { siteName: "刀云", logoUrl: null, faviconUrl: null, defaultCoverUrl: null, navigationLinks: [], footerText: null, footerLinks: [], primaryColor: "#1f8f5f", accentColor: "#d97706", themePreset: "default" as const, listDensity: "comfortable" as const, homeMode: "latest" as const }
const board = { id: "019fc900-0000-7000-8000-000000000101", parentId: null, slug: "general", name: "社区广场", description: "公开讨论", icon: "messages", tone: "green" as const, position: 0, visibility: "public" as const, topicCount: 2, revision: 1 }
const membershipRules = [
  { levelKey: "lv_1", levelNumber: 1, levelDisplayName: "Lv1", requiredLifetimePoints: 0, enabled: true, updatedAt: "2026-08-07T01:00:00Z" },
  { levelKey: "lv_2", levelNumber: 2, levelDisplayName: "Lv2", requiredLifetimePoints: 25, enabled: true, updatedAt: "2026-08-07T01:00:00Z" },
]
const memberId = "019fc900-0000-7000-8000-000000000401"

beforeEach(() => {
  vi.mocked(getAdminAccess).mockResolvedValue({ capabilityKeys: [
    "admin.configuration.read",
    "admin.configuration.write",
    "governance.reports.read",
    "governance.policy.read",
    "governance.alerts.read",
    "membership.rules.read",
    "membership.points.grant",
    "membership.medals.grant",
    "authorization.roles.read",
    "authorization.assignments.read",
    "operations.read",
    "plugins.read",
    "plugins.install",
    "plugins.lifecycle",
    "plugins.invoke",
  ] })
  vi.mocked(getAdminSiteBranding).mockResolvedValue(branding)
  vi.mocked(listAdminBoards).mockResolvedValue([board])
  vi.mocked(updateSiteBranding).mockResolvedValue(branding)
  vi.mocked(uploadBrandAsset).mockResolvedValue({ ...branding, logoUrl: "/api/v1/site-branding/assets/logo" })
  vi.mocked(deleteBrandAsset).mockResolvedValue(branding)
  vi.mocked(getMembershipLevelRules).mockResolvedValue(membershipRules)
  vi.mocked(updateMembershipLevelRule).mockResolvedValue({ ...membershipRules[1], requiredLifetimePoints: 30, enabled: true })
  vi.mocked(grantMembershipPoints).mockResolvedValue({
    created: true,
    account: { userId: memberId, pointsBalance: 30, lifetimePoints: 30, levelKey: "lv_2", levelNumber: 2, levelDisplayName: "Lv2", revision: 2, updatedAt: "2026-08-07T01:00:00Z" },
  })
  vi.mocked(listAuthorizationPermissions).mockResolvedValue([])
  vi.mocked(listAuthorizationRoles).mockResolvedValue([])
  vi.mocked(listAuthorizationAssignments).mockResolvedValue({ assignments: [], nextCursor: null })
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("AdminView", () => {
  it("keeps the main landmark outside a wrapping region landmark", async () => {
    render(<AdminView session={session} onBack={vi.fn()} />)

    expect(await screen.findByRole("main")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "站点管理" })).not.toBeInTheDocument()
  })

  it("shows a protected state without private requests when signed out", () => {
    render(<AdminView session={null} onBack={vi.fn()} />)
    expect(screen.getByRole("heading", { name: "站点管理" })).toBeInTheDocument()
    expect(screen.getByText("需要具备管理读取权限")).toBeInTheDocument()
    expect(getAdminAccess).not.toHaveBeenCalled()
    expect(getAdminSiteBranding).not.toHaveBeenCalled()
  })

  it("loads branding and saves edited values with the session csrf token", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)
    await user.click(await screen.findByRole("button", { name: "品牌配置" }))
    expect(await screen.findByRole("heading", { name: "站点品牌" })).toBeInTheDocument()
    const input = screen.getByLabelText("站点名称")
    await user.clear(input)
    await user.type(input, "新刀云")
    await user.click(screen.getByRole("button", { name: "保存品牌配置" }))
    expect(updateSiteBranding).toHaveBeenCalledWith(expect.objectContaining({ siteName: "新刀云" }), session.csrfToken)
    expect(await screen.findByText("品牌配置已保存")).toBeInTheDocument()
  })

  it("uploads a PNG logo with the session csrf token", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)
    await user.click(await screen.findByRole("button", { name: "品牌配置" }))
    expect(await screen.findByRole("heading", { name: "站点品牌" })).toBeInTheDocument()
    const file = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" })
    await user.upload(screen.getByLabelText("上传 Logo 文件"), file)
    await user.click(screen.getByRole("button", { name: "上传 Logo" }))
    expect(uploadBrandAsset).toHaveBeenCalledWith("logo", file, session.csrfToken)
    expect(await screen.findByText("Logo 已上传")).toBeInTheDocument()
  })

  it("shows a clear forbidden state", async () => {
    vi.mocked(getAdminSiteBranding).mockRejectedValueOnce(new AdminApiError(403, "admin.forbidden", "需要超级管理员权限"))
    render(<AdminView session={session} onBack={vi.fn()} />)
    expect(await screen.findByText("当前账号没有站点管理权限")).toBeInTheDocument()
  })

  it("does not treat the dashboard as an authorization boundary", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: [] })
    render(<AdminView session={session} onBack={vi.fn()} />)

    expect(await screen.findByText("当前账号没有站点管理权限")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "今天需要处理什么" })).not.toBeInTheDocument()
  })

  it("opens the operations monitoring tab", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "运维监控" }))
    expect(screen.getByRole("heading", { name: "运营概览" })).toBeInTheDocument()
  })

  it("opens directly into operations for an operations-only role", async () => {
    const onAccessChange = vi.fn()
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["operations.read"] })
    render(<AdminView session={session} onBack={vi.fn()} onAccessChange={onAccessChange} requestedTab="operations" />)

    expect(await screen.findByRole("heading", { name: "运营概览" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "运维监控" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "品牌配置" })).not.toBeInTheDocument()
    expect(getAdminSiteBranding).not.toHaveBeenCalled()
    expect(listAdminBoards).not.toHaveBeenCalled()
    expect(onAccessChange).toHaveBeenCalledWith("allowed")
  })

  it("opens the managed-user workspace directly and restores its query", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["admin.users.read"] })
    render(<AdminView session={session} onBack={vi.fn()} requestedTab="users" requestedQuery="status=restricted" />)

    expect(await screen.findByRole("heading", { name: "用户管理台" })).toBeInTheDocument()
    expect(screen.getByText("status=restricted")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "用户管理" })).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("button", { name: "品牌配置" })).not.toBeInTheDocument()
    expect(screen.getByText("false/false")).toBeInTheDocument()
  })

  it("passes user moderation and assignment capabilities without exposing internal keys", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: [
      "admin.users.read", "admin.users.moderate", "authorization.roles.read",
      "authorization.assignments.read", "authorization.assignments.write",
    ] })
    render(<AdminView session={session} onBack={vi.fn()} requestedTab="users" />)

    expect(await screen.findByRole("heading", { name: "用户管理台" })).toBeInTheDocument()
    expect(screen.getByText("true/true")).toBeInTheDocument()
  })

  it("opens directly into plugins for a plugin-only role and passes write capabilities", async () => {
    const onAccessChange = vi.fn()
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["plugins.read", "plugins.lifecycle"] })
    render(<AdminView session={session} onBack={vi.fn()} onAccessChange={onAccessChange} requestedTab="plugins" />)

    expect(await screen.findByRole("heading", { name: "插件平台" })).toBeInTheDocument()
    expect(screen.getByText("false/true/false")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "插件管理" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "品牌配置" })).not.toBeInTheDocument()
    expect(getAdminSiteBranding).not.toHaveBeenCalled()
    expect(listAdminBoards).not.toHaveBeenCalled()
    expect(onAccessChange).toHaveBeenCalledWith("allowed")
  })

  it("canonicalizes an unavailable module to the first capability-allowed task", async () => {
    const onTabChange = vi.fn()
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["admin.configuration.read"] })

    render(<AdminView session={session} onBack={vi.fn()} requestedTab="reports" onTabChange={onTabChange} />)

    expect(await screen.findByRole("heading", { name: "今天需要处理什么" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "工作台" })).toHaveAttribute("aria-current", "page")
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith("dashboard"))
  })

  it("restores the report status filter from the URL query", async () => {
    render(<AdminView session={session} onBack={vi.fn()} requestedTab="reports" requestedQuery="status=resolved" />)

    expect(await screen.findByRole("heading", { name: "举报处理工作台" })).toBeInTheDocument()
    expect(screen.getByText("resolved/false")).toBeInTheDocument()
  })

  it("passes the report resolution capability to the report workspace", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["governance.reports.read", "governance.reports.resolve"] })
    render(<AdminView session={session} onBack={vi.fn()} requestedTab="reports" />)

    expect(await screen.findByText("all/true")).toBeInTheDocument()
  })

  it("publishes report filter changes to the admin URL state", async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()
    render(<AdminView session={session} onBack={vi.fn()} requestedTab="reports" onQueryChange={onQueryChange} />)

    await user.click(await screen.findByRole("button", { name: "切换处理中" }))

    expect(onQueryChange).toHaveBeenCalledWith("status=in_review")
  })

  it("loads membership rules and saves a changed level name and threshold", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    expect(await screen.findByRole("heading", { name: "会员经济" })).toBeInTheDocument()
    const name = screen.getByLabelText("lv_2 展示名称")
    await user.clear(name)
    await user.type(name, "新会员")
    const threshold = screen.getByLabelText("lv_2 累计积分阈值")
    await user.clear(threshold)
    await user.type(threshold, "30")
    await user.click(screen.getByRole("button", { name: "保存 lv_2 规则" }))

    expect(updateMembershipLevelRule).toHaveBeenCalledWith("lv_2", { requiredLifetimePoints: 30, enabled: true, displayName: "新会员" }, session.csrfToken)
    expect(await screen.findByText("lv_2 规则已保存")).toBeInTheDocument()
  })

  it("keeps the lv_1 threshold fixed at zero", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    expect(screen.getByLabelText("lv_1 累计积分阈值")).toBeDisabled()
  })

  it("grants points and renders the resulting account level", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await screen.findByRole("heading", { name: "会员经济" })
    await user.type(screen.getByLabelText("目标用户 UUID"), memberId)
    await user.type(screen.getByLabelText("积分数量"), "30")
    await user.type(screen.getByLabelText(/^授予理由/), "campaign.reward")
    await user.click(screen.getByRole("button", { name: "授予积分" }))

    expect(grantMembershipPoints).toHaveBeenCalledWith({ userId: memberId, amount: 30, reason: "campaign.reward", idempotencyKey: expect.any(String) }, session.csrfToken)
    expect(await screen.findByText("已升级至 Lv2")).toBeInTheDocument()
  })

  it("lets a points-only operator use the grant workspace without loading rule catalogs", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["membership.points.grant"] })
    render(<AdminView session={session} onBack={vi.fn()} requestedTab="membership" />)

    expect(await screen.findByRole("heading", { name: "会员经济" })).toBeInTheDocument()
    expect(screen.getByLabelText("目标用户 UUID")).toBeInTheDocument()
    expect(screen.queryByLabelText("勋章目标用户 UUID")).not.toBeInTheDocument()
    expect(getMembershipLevelRules).not.toHaveBeenCalled()
  })

  it("opens the role and permission management tab", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "角色与权限" }))
    expect(await screen.findByRole("heading", { name: "角色与权限" })).toBeInTheDocument()
    expect(listAuthorizationPermissions).toHaveBeenCalled()
    expect(listAuthorizationRoles).toHaveBeenCalled()
    expect(listAuthorizationAssignments).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }))
  })

  it("shows system and governance tasks in one capability-filtered navigation", async () => {
    render(<AdminView session={session} onBack={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: "站点管理" })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "站点管理导航" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "品牌配置" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "举报处理" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "风控告警" })).toBeInTheDocument()
  })

  it("opens a governance-only account in the same site administration shell", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["governance.reports.read"] })
    render(<AdminView session={session} onBack={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: "站点管理" })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "站点管理导航" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "举报处理" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "品牌配置" })).not.toBeInTheDocument()
    expect(getAdminSiteBranding).not.toHaveBeenCalled()
    expect(listAdminBoards).not.toHaveBeenCalled()
  })
})
