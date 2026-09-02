import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthSession } from "../api/auth"
import {
  AdminApiError,
  createAdminGrowthLevel,
  deleteAdminGrowthLevel,
  getAdminAccess,
  getAdminSiteBranding,
  getSmtpSettings,
  getAdminGrowthLevels,
  getAdminMembershipAccount,
  listMembershipMedalOperations,
  getMembershipMedalRules,
  getMembershipLevelRules,
  grantMembershipMedal,
  grantMembershipPoints,
  revokeMembershipMedal,
  listAuthorizationAssignments,
  listAuthorizationPermissions,
  listAuthorizationRoles,
  listAdminBoards,
  deleteBrandAsset,
  uploadBrandAsset,
  updateMembershipLevelRule,
  updateAdminGrowthLevel,
  updateSiteBranding,
  updateSmtpSettings,
  testSmtpSettings,
} from "../api/admin"
import { listModerationBoards } from "../api/moderation"
import { listUsers } from "../api/users"
import { AdminView } from "./AdminView"

vi.mock("../api/admin", async () => {
  const actual = await vi.importActual<typeof import("../api/admin")>("../api/admin")
  return {
    ...actual,
    getAdminAccess: vi.fn(),
    getAdminSiteBranding: vi.fn(),
    getSmtpSettings: vi.fn(),
    listAdminBoards: vi.fn(),
    updateSiteBranding: vi.fn(),
    updateSmtpSettings: vi.fn(),
    testSmtpSettings: vi.fn(),
    getAdminGrowthLevels: vi.fn(),
    getAdminMembershipAccount: vi.fn(),
    getMembershipMedalRules: vi.fn(),
    listMembershipMedalOperations: vi.fn(),
    createAdminGrowthLevel: vi.fn(),
    deleteAdminGrowthLevel: vi.fn(),
    updateAdminGrowthLevel: vi.fn(),
    getMembershipLevelRules: vi.fn(),
    updateMembershipLevelRule: vi.fn(),
    grantMembershipMedal: vi.fn(),
    grantMembershipPoints: vi.fn(),
    revokeMembershipMedal: vi.fn(),
    listAuthorizationAssignments: vi.fn(),
    listAuthorizationPermissions: vi.fn(),
    listAuthorizationRoles: vi.fn(),
    deleteBrandAsset: vi.fn(),
    uploadBrandAsset: vi.fn(),
  }
})

vi.mock("../api/users", async () => {
  const actual = await vi.importActual<typeof import("../api/users")>("../api/users")
  return { ...actual, listUsers: vi.fn() }
})

vi.mock("../api/moderation", async () => {
  const actual = await vi.importActual<typeof import("../api/moderation")>("../api/moderation")
  return { ...actual, listModerationBoards: vi.fn() }
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

vi.mock("./ModerationAdminPanel", () => ({
  ModerationAdminPanel: ({ boards }: { boards: Array<{ name: string }> }) => <section><h2>主题治理工作台</h2><p>{boards.map((board) => board.name).join(",")}</p></section>,
}))

vi.mock("./AdminDashboard", () => ({
  AdminDashboard: ({ capabilityKeys }: { capabilityKeys: string[] }) => <section><h2>今天需要处理什么</h2><p>{capabilityKeys.join(",")}</p></section>,
}))

const session: AuthSession = {
  user: { id: "019fc700-0000-7000-8000-000000000004", username: "admin", email: "admin@example.com", displayName: "管理员" },
  csrfToken: "a".repeat(64),
}
const branding = { siteName: "刀云", logoUrl: null, faviconUrl: null, defaultCoverUrl: null, navigationLinks: [], footerText: null, footerLinks: [], primaryColor: "#1f8f5f", accentColor: "#d97706", themePreset: "default" as const, listDensity: "comfortable" as const, homeMode: "latest" as const }
const smtpSettings = { host: "smtp.example.com", port: 587, username: "mailer", passwordConfigured: true, tlsMode: "starttls" as const, fromEmail: "noreply@example.com", fromName: "刀云", enabled: true, registrationEmailVerificationEnabled: true }
const board = { id: "019fc900-0000-7000-8000-000000000101", parentId: null, slug: "general", name: "社区广场", description: "公开讨论", icon: "messages", tone: "green" as const, position: 0, visibility: "public" as const, topicCount: 2, revision: 1, status: "open" as const, mergedIntoBoardId: null }
const membershipRules = [
  { levelKey: "lv_1", levelNumber: 1, levelDisplayName: "Lv1", requiredLifetimePoints: 0, enabled: true, updatedAt: "2026-08-07T01:00:00Z" },
  { levelKey: "lv_2", levelNumber: 2, levelDisplayName: "Lv2", requiredLifetimePoints: 25, enabled: true, updatedAt: "2026-08-07T01:00:00Z" },
]
const growthLevels = [{
  id: "019fc900-0000-7000-8000-000000000801",
  internalKey: "traveler",
  levelOrder: 2,
  displayName: "旅者",
  requiredExperience: 100,
  iconAssetId: null,
  color: "#1f8f5f",
  description: "完成首次成长阶段",
  status: "published" as const,
  revision: 1,
  publishedAt: "2026-08-20T01:00:00Z",
  createdAt: "2026-08-20T01:00:00Z",
  updatedAt: "2026-08-20T01:00:00Z",
}]
const memberId = "019fc900-0000-7000-8000-000000000401"
const medalRules = [
  { key: "medal_01", displayName: "勋章 01", enabled: true, requiredLifetimePoints: 0, updatedAt: "2026-08-20T01:00:00Z" },
]
const medalOperations = [{
  id: "019fc900-0000-7000-8000-000000000901",
  operation: "grant" as const,
  userId: memberId,
  username: "medal_member",
  userDisplayName: "勋章成员",
  medalKey: "medal_01",
  medalDisplayName: "勋章 01",
  reason: "operator.award",
  actorId: session.user.id,
  actorUsername: session.user.username,
  actorDisplayName: session.user.displayName,
  createdAt: "2026-08-22T01:00:00Z",
}]

beforeEach(() => {
  vi.mocked(getAdminAccess).mockResolvedValue({ capabilityKeys: [
    "admin.configuration.read",
    "admin.configuration.write",
    "governance.reports.read",
    "governance.policy.read",
    "governance.alerts.read",
    "membership.rules.read",
    "membership.rules.write",
    "membership.medals.read",
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
  vi.mocked(getSmtpSettings).mockResolvedValue(smtpSettings)
  vi.mocked(listAdminBoards).mockResolvedValue([board])
  vi.mocked(updateSiteBranding).mockResolvedValue(branding)
  vi.mocked(updateSmtpSettings).mockResolvedValue(smtpSettings)
  vi.mocked(testSmtpSettings).mockResolvedValue(true)
  vi.mocked(uploadBrandAsset).mockResolvedValue({ ...branding, logoUrl: "/api/v1/site-branding/assets/logo" })
  vi.mocked(deleteBrandAsset).mockResolvedValue(branding)
  vi.mocked(getMembershipLevelRules).mockResolvedValue(membershipRules)
  vi.mocked(getAdminGrowthLevels).mockResolvedValue(growthLevels)
  vi.mocked(getAdminMembershipAccount).mockResolvedValue({
    userId: memberId,
    pointsBalance: 50,
    lifetimePoints: 80,
    levelKey: "lv_2",
    levelNumber: 2,
    levelDisplayName: "Lv2",
    revision: 2,
    updatedAt: "2026-08-07T01:00:00Z",
  })
  vi.mocked(listUsers).mockResolvedValue({
    users: [{ id: memberId, username: "member", displayName: "会员", avatarUrl: null }],
    nextCursor: null,
  })
  vi.mocked(getMembershipMedalRules).mockResolvedValue(medalRules)
  vi.mocked(listMembershipMedalOperations).mockResolvedValue({ operations: medalOperations, nextCursor: null })
  vi.mocked(createAdminGrowthLevel).mockResolvedValue(growthLevels[0])
  vi.mocked(deleteAdminGrowthLevel).mockResolvedValue(true)
  vi.mocked(updateAdminGrowthLevel).mockResolvedValue({ ...growthLevels[0], displayName: "行者", revision: 2, status: "published" })
  vi.mocked(updateMembershipLevelRule).mockResolvedValue({ ...membershipRules[1], requiredLifetimePoints: 30, enabled: true })
  vi.mocked(grantMembershipMedal).mockResolvedValue({
    medal: { key: "medal_01", displayName: "勋章 01", assetUrl: "/assets/membership/medals/medal1.gif", sha256: "a".repeat(64), grantedAt: "2026-08-22T02:00:00Z" },
    created: true,
  })
  vi.mocked(grantMembershipPoints).mockResolvedValue({
    created: true,
    auditId: "019fc900-0000-7000-8000-000000000999",
    account: { userId: memberId, pointsBalance: 30, lifetimePoints: 30, levelKey: "lv_2", levelNumber: 2, levelDisplayName: "Lv2", revision: 2, updatedAt: "2026-08-07T01:00:00Z" },
  })
  vi.mocked(listAuthorizationPermissions).mockResolvedValue([])
  vi.mocked(listAuthorizationRoles).mockResolvedValue([])
  vi.mocked(listAuthorizationAssignments).mockResolvedValue({ assignments: [], nextCursor: null })
  vi.mocked(listModerationBoards).mockResolvedValue([])
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("AdminView", () => {
  it("keeps the main landmark outside a wrapping region landmark", async () => {
    render(<AdminView session={session} onBack={vi.fn()} />)

    expect(await screen.findByRole("main")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "站点管理" })).not.toBeInTheDocument()
  })

  it("keeps one administration shell when entering content moderation", async () => {
    vi.mocked(listModerationBoards).mockResolvedValueOnce([{
      id: "019fc900-0000-7000-8000-000000000102",
      slug: "general",
      name: "社区广场",
      tone: "green",
      capabilityKeys: ["moderation.topic"],
    }])

    render(<AdminView session={session} requestedTab="moderation" onBack={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: "内容治理", level: 1 })).toBeInTheDocument()
    expect(screen.getByText("刀云站点管理")).toBeInTheDocument()
    expect(screen.getByText("管理后台")).toBeInTheDocument()
    expect(screen.queryByText("Site Administration")).not.toBeInTheDocument()
    const adminHeader = document.querySelector<HTMLElement>(".system-admin-header")!
    expect(within(adminHeader).getByText("@admin")).toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "当前管理员" })).not.toBeInTheDocument()
  })

  it("switches the standalone administration shell between light and dark themes", async () => {
    const user = userEvent.setup()
    document.documentElement.dataset.theme = "light"
    localStorage.setItem("daoyun-theme", "light")

    render(<AdminView session={session} onBack={vi.fn()} />)
    await user.click(await screen.findByRole("button", { name: "切换为深色主题" }))

    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(localStorage.getItem("daoyun-theme")).toBe("dark")
    expect(screen.getByRole("button", { name: "切换为浅色主题" })).toBeInTheDocument()
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
    expect(screen.getByLabelText("首页模式")).toHaveValue("hot")
    expect(screen.getByLabelText("首页模式")).toBeDisabled()
    const input = screen.getByLabelText("站点名称")
    await user.clear(input)
    await user.type(input, "新刀云")
    await user.click(screen.getByRole("button", { name: "保存品牌配置" }))
    expect(updateSiteBranding).toHaveBeenCalledWith(expect.objectContaining({ siteName: "新刀云", homeMode: "hot" }), session.csrfToken)
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

  it("edits EXP growth levels without exposing lifecycle status", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    expect(await screen.findByRole("heading", { name: "会员经济", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "成长等级（EXP）" })).toBeInTheDocument()
    expect(screen.queryByText("已发布")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("traveler 状态")).not.toBeInTheDocument()
    const editTrigger = screen.getByRole("button", { name: "编辑 traveler" })
    await user.click(editTrigger)
    const dialog = screen.getByRole("dialog", { name: "编辑成长等级" })
    const name = within(dialog).getByLabelText("展示名称")
    expect(name).toHaveFocus()
    await user.clear(name)
    await user.type(name, "行者")
    const threshold = within(dialog).getByLabelText("EXP 阈值")
    await user.clear(threshold)
    await user.type(threshold, "120")
    await user.click(within(dialog).getByRole("button", { name: "保存更改" }))

    expect(updateAdminGrowthLevel).toHaveBeenCalledWith(growthLevels[0].id, expect.objectContaining({ expectedRevision: 1, displayName: "行者", requiredExperience: 120, status: "published" }), session.csrfToken)
    expect(await screen.findByText("traveler 已保存")).toBeInTheDocument()
  })

  it("configures and tests SMTP without exposing the saved password", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "邮件服务" }))
    expect(await screen.findByRole("heading", { name: "SMTP 邮件服务" })).toBeInTheDocument()
    expect(screen.getByLabelText("SMTP 密码")).toHaveAttribute("placeholder", "已保存，留空则不修改")
    expect(screen.queryByDisplayValue(/password/i)).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText("SMTP 主机"))
    await user.type(screen.getByLabelText("SMTP 主机"), "smtp2.example.com")
    await user.click(screen.getByRole("button", { name: "保存邮件配置" }))
    expect(updateSmtpSettings).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp2.example.com",
      password: "",
      clearPassword: false,
      registrationEmailVerificationEnabled: true,
    }), session.csrfToken)

    await user.type(screen.getByLabelText("测试收件邮箱"), "admin@example.com")
    await user.click(screen.getByRole("button", { name: "发送测试邮件" }))
    expect(testSmtpSettings).toHaveBeenCalledWith("admin@example.com", session.csrfToken)
    expect(await screen.findByText("测试邮件已发送")).toBeInTheDocument()
  })

  it("presents the growth-level editor as a grouped form with a live summary", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await user.click(screen.getByRole("button", { name: "编辑 traveler" }))
    const dialog = screen.getByRole("dialog", { name: "编辑成长等级" })
    const preview = within(dialog).getByRole("region", { name: "等级预览" })

    expect(preview).toHaveTextContent("Lv 2")
    expect(preview).toHaveTextContent("旅者")
    expect(preview).toHaveTextContent("100 EXP")
    expect(within(dialog).getByRole("group", { name: "基本信息" })).toBeInTheDocument()
    expect(within(dialog).getByRole("group", { name: "成长规则" })).toBeInTheDocument()
    expect(within(dialog).getByRole("group", { name: "视觉与说明" })).toBeInTheDocument()
    expect(within(dialog).getByText("保存后立即生效")).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText("展示名称"))
    await user.type(within(dialog).getByLabelText("展示名称"), "远行者")
    await user.clear(within(dialog).getByLabelText("EXP 阈值"))
    await user.type(within(dialog).getByLabelText("EXP 阈值"), "360")

    expect(preview).toHaveTextContent("远行者")
    expect(preview).toHaveTextContent("360 EXP")
  })
  vi.mocked(revokeMembershipMedal).mockResolvedValue({ userId: memberId, medalKey: "medal_01", revoked: true })

  it("shows every growth level without a status filter", async () => {
    const user = userEvent.setup()
    vi.mocked(getAdminGrowthLevels).mockResolvedValueOnce([
      ...growthLevels,
      {
        ...growthLevels[0],
        id: "019fc900-0000-7000-8000-000000000803",
        internalKey: "explorer",
        levelOrder: 3,
        displayName: "探索者",
        status: "published",
        publishedAt: "2026-08-20T01:00:00Z",
      },
    ])
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    expect(await screen.findByText("共 2 个等级")).toBeInTheDocument()
    expect(screen.getByText("explorer")).toBeInTheDocument()
    expect(screen.queryByLabelText("筛选成长等级")).not.toBeInTheDocument()
    expect(within(screen.getByRole("list", { name: "成长等级列表" })).getAllByRole("listitem")).toHaveLength(2)
  })

  it("separates growth, points, and medals into task-focused workspaces", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    expect(await screen.findByRole("heading", { name: "成长等级（EXP）" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "积分账本" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "勋章" })).not.toBeInTheDocument()
    const growthTab = screen.getByRole("tab", { name: "成长运营" })
    expect(growthTab).toHaveAttribute("tabindex", "0")
    expect(screen.getByRole("tabpanel", { name: "成长运营" })).toBeInTheDocument()

    growthTab.focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "积分运营" })).toHaveFocus()
    expect(screen.getByRole("tab", { name: "积分运营" })).toHaveAttribute("aria-selected", "true")

    await user.click(screen.getByRole("tab", { name: "积分运营" }))
    expect(screen.getByRole("heading", { name: "积分账本" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "成长等级（EXP）" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "勋章运营" }))
    expect(screen.getByRole("heading", { name: "勋章" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "标准权益" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("lv_1 累计积分阈值")).not.toBeInTheDocument()
  })

  it("presents growth levels and medal rules as scan-friendly lists", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    const growthList = await screen.findByRole("list", { name: "成长等级列表" })
    expect(within(growthList).getAllByRole("listitem")).toHaveLength(growthLevels.length)

    await user.click(screen.getByRole("tab", { name: "勋章运营" }))
    const medalList = await screen.findByRole("list", { name: "勋章规则列表" })
    expect(within(medalList).getAllByRole("listitem")).toHaveLength(medalRules.length)
  })

  it("renders the fixed medal catalog with its visual identifier", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await user.click(screen.getByRole("tab", { name: "勋章运营" }))

    expect(await screen.findByRole("img", { name: "勋章 01" })).toHaveAttribute("src", "/assets/membership/medals/medal1.gif")
  })

  it("loads medal operations and revokes an active medal with an audit reason", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await user.click(screen.getByRole("tab", { name: "勋章运营" }))
    expect(await screen.findByText("勋章成员")).toBeInTheDocument()
    expect(listMembershipMedalOperations).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, signal: expect.any(AbortSignal) }))

    await user.click(screen.getByRole("button", { name: "撤销 勋章 01" }))
    await user.type(screen.getByLabelText("撤销原因"), "运营调整")
    await user.click(screen.getByRole("button", { name: "确认撤销" }))

    expect(revokeMembershipMedal).toHaveBeenCalledWith({ userId: memberId, medalKey: "medal_01", reason: "运营调整" }, session.csrfToken)
    expect(await screen.findByText("勋章已撤销")).toBeInTheDocument()
    expect(listMembershipMedalOperations).toHaveBeenCalledTimes(2)
  })

  it("keeps the newest medal operation response when an older request finishes later", async () => {
    const user = userEvent.setup()
    let resolveInitial!: (value: Awaited<ReturnType<typeof listMembershipMedalOperations>>) => void
    const initialResponse = new Promise<Awaited<ReturnType<typeof listMembershipMedalOperations>>>((resolve) => { resolveInitial = resolve })
    const refreshedOperation = { ...medalOperations[0], id: "019fc900-0000-7000-8000-000000000902", reason: "latest.award", createdAt: "2026-08-22T02:00:00Z" }
    vi.mocked(listMembershipMedalOperations)
      .mockReturnValueOnce(initialResponse)
      .mockResolvedValueOnce({ operations: [refreshedOperation], nextCursor: null })
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await user.click(screen.getByRole("tab", { name: "勋章运营" }))
    await waitFor(() => expect(listMembershipMedalOperations).toHaveBeenCalledTimes(1))
    await user.type(await screen.findByLabelText("勋章目标用户 UUID"), memberId)
    await user.type(screen.getByLabelText("勋章授予理由"), "latest.award")
    await user.click(screen.getByRole("button", { name: "手动发放勋章" }))

    expect(await screen.findByText("latest.award", { exact: false })).toBeInTheDocument()
    resolveInitial({ operations: medalOperations, nextCursor: null })
    await waitFor(() => expect(screen.getByText("latest.award", { exact: false })).toBeInTheDocument())
    expect(screen.queryByText("operator.award", { exact: false })).not.toBeInTheDocument()
  })

  it("creates an immediately active EXP level from a modal form", async () => {
    const user = userEvent.setup()
    vi.mocked(createAdminGrowthLevel).mockResolvedValueOnce({
      ...growthLevels[0],
      id: "019fc900-0000-7000-8000-000000000802",
      internalKey: "explorer",
      levelOrder: 3,
      displayName: "探索者",
      requiredExperience: 300,
    })
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    expect(screen.queryByLabelText("内部键")).not.toBeInTheDocument()
    const createTrigger = screen.getByRole("button", { name: "新增等级" })
    await user.click(createTrigger)
    let dialog = screen.getByRole("dialog", { name: "新增成长等级" })
    expect(within(dialog).getByLabelText("内部键")).toHaveFocus()
    await user.type(within(dialog).getByLabelText("内部键"), "temporary")
    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    await waitFor(() => expect(createTrigger).toHaveFocus())
    expect(screen.queryByRole("dialog", { name: "新增成长等级" })).not.toBeInTheDocument()

    await user.click(createTrigger)
    dialog = screen.getByRole("dialog", { name: "新增成长等级" })
    expect(within(dialog).getByLabelText("内部键")).toHaveValue("")
    await user.type(within(dialog).getByLabelText("内部键"), "explorer")
    await user.type(within(dialog).getByLabelText("等级顺序"), "3")
    await user.type(within(dialog).getByLabelText("展示名称"), "探索者")
    await user.type(within(dialog).getByLabelText("EXP 阈值"), "300")
    await user.click(within(dialog).getByRole("button", { name: "创建并生效" }))

    expect(createAdminGrowthLevel).toHaveBeenCalledWith({
      internalKey: "explorer",
      levelOrder: 3,
      displayName: "探索者",
      requiredExperience: 300,
      iconAssetId: null,
      color: null,
      description: "",
    }, session.csrfToken)
    expect(grantMembershipPoints).not.toHaveBeenCalled()
    expect(await screen.findByText("explorer 已创建并生效")).toBeInTheDocument()
    expect(screen.queryByLabelText("内部键")).not.toBeInTheDocument()
  })

  it("closes the growth-level modal with Escape and restores focus", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    const editTrigger = screen.getByRole("button", { name: "编辑 traveler" })
    await user.click(editTrigger)
    expect(screen.getByRole("dialog", { name: "编辑成长等级" })).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog", { name: "编辑成长等级" })).not.toBeInTheDocument()
    await waitFor(() => expect(editTrigger).toHaveFocus())
    expect(screen.getByText("旅者")).toBeInTheDocument()
  })

  it("keeps keyboard focus inside the growth-level modal", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await user.click(screen.getByRole("button", { name: "新增等级" }))
    const dialog = screen.getByRole("dialog", { name: "新增成长等级" })
    const background = document.querySelector(".membership-admin-panel")
    expect(background).toHaveAttribute("inert")
    expect(background).toHaveAttribute("aria-hidden", "true")

    await user.keyboard("{Shift>}{Tab}{/Shift}")
    expect(within(dialog).getByRole("button", { name: "关闭新增成长等级" })).toHaveFocus()
    await user.keyboard("{Shift>}{Tab}{/Shift}")
    expect(within(dialog).getByRole("button", { name: "创建并生效" })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole("button", { name: "关闭新增成长等级" })).toHaveFocus()
  })

  it("submits the growth-level modal only once and cannot close it while pending", async () => {
    const user = userEvent.setup()
    let finishCreate!: () => void
    vi.mocked(createAdminGrowthLevel).mockImplementationOnce(() => new Promise((resolve) => {
      finishCreate = () => resolve({ ...growthLevels[0], id: "019fc900-0000-7000-8000-000000000802", internalKey: "explorer" })
    }))
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await user.click(screen.getByRole("button", { name: "新增等级" }))
    const dialog = screen.getByRole("dialog", { name: "新增成长等级" })
    await user.type(within(dialog).getByLabelText("内部键"), "explorer")
    await user.type(within(dialog).getByLabelText("等级顺序"), "3")
    await user.type(within(dialog).getByLabelText("展示名称"), "探索者")
    await user.type(within(dialog).getByLabelText("EXP 阈值"), "300")

    fireEvent.submit(dialog)
    fireEvent.submit(dialog)
    expect(createAdminGrowthLevel).toHaveBeenCalledTimes(1)
    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog", { name: "新增成长等级" })).toBeInTheDocument()

    finishCreate()
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新增成长等级" })).not.toBeInTheDocument())
  })

  it("requires confirmation before deleting a growth level", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await user.click(screen.getByRole("button", { name: "删除 traveler" }))
    const dialog = screen.getByRole("dialog", { name: "删除成长等级" })
    expect(within(dialog).getByText("旅者", { exact: false })).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus()
    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(deleteAdminGrowthLevel).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole("button", { name: "删除 traveler" })).toHaveFocus())

    await user.click(screen.getByRole("button", { name: "删除 traveler" }))
    await user.click(screen.getByRole("button", { name: "确认删除" }))
    expect(deleteAdminGrowthLevel).toHaveBeenCalledWith(growthLevels[0].id, session.csrfToken)
    await waitFor(() => expect(screen.queryByText("traveler")).not.toBeInTheDocument())
  })

  it("locks every growth-level action while a deletion is pending", async () => {
    const user = userEvent.setup()
    let finishDelete!: () => void
    vi.mocked(getAdminGrowthLevels).mockResolvedValueOnce([
      ...growthLevels,
      { ...growthLevels[0], id: "019fc900-0000-7000-8000-000000000803", internalKey: "explorer", levelOrder: 3, displayName: "探索者" },
    ])
    vi.mocked(deleteAdminGrowthLevel).mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishDelete = () => resolve(true)
    }))
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await user.click(screen.getByRole("button", { name: "删除 traveler" }))
    await user.click(screen.getByRole("button", { name: "确认删除" }))

    const background = document.querySelector(".membership-admin-panel") as HTMLElement
    expect(within(background).getByText("删除 traveler").closest("button")).toBeDisabled()
    expect(within(background).getByText("删除 explorer").closest("button")).toBeDisabled()
    expect(screen.getByRole("dialog", { name: "删除成长等级" })).toHaveTextContent("traveler")

    finishDelete()
    await waitFor(() => expect(screen.queryByText("traveler")).not.toBeInTheDocument())
  })

  it("searches a member, grants mapped-reason points, and renders the ledger result", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "会员经济" }))
    await screen.findByRole("heading", { name: "会员经济", level: 1 })
    await user.click(screen.getByRole("tab", { name: "积分运营" }))
    await user.type(screen.getByRole("searchbox", { name: "搜索用户" }), "会员")
    await user.click(await screen.findByRole("button", { name: "选择会员 @member" }))
    expect(await within(screen.getByLabelText("已选用户")).findByText("50")).toBeInTheDocument()
    await user.type(screen.getByLabelText("积分数量"), "30")
    await user.selectOptions(screen.getByLabelText("运营原因"), "operations.community_reward")
    await user.type(screen.getByLabelText("补充说明"), "季度社区贡献")
    await user.click(screen.getByRole("button", { name: "确认积分操作" }))

    expect(grantMembershipPoints).toHaveBeenCalledWith({ userId: memberId, amount: 30, reason: "operations.community_reward", details: "季度社区贡献", idempotencyKey: expect.stringMatching(/^admin-points:/) }, session.csrfToken)
    expect(await screen.findByText("积分操作完成")).toBeInTheDocument()
    expect(screen.getByText(/审计编号：019fc900/)).toBeInTheDocument()
  })

  it("lets a points-only operator use the grant workspace without loading rule catalogs", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["membership.points.grant"] })
    render(<AdminView session={session} onBack={vi.fn()} requestedTab="membership" />)

    expect(await screen.findByRole("heading", { name: "会员经济", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "搜索用户" })).toBeInTheDocument()
    expect(screen.queryByLabelText("勋章目标用户 UUID")).not.toBeInTheDocument()
    expect(getAdminGrowthLevels).not.toHaveBeenCalled()
  })

  it("lets an EXP write-only operator create an active level without loading the level catalog", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["membership.rules.write"] })
    render(<AdminView session={session} onBack={vi.fn()} requestedTab="membership" />)

    expect(await screen.findByRole("heading", { name: "会员经济", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "新增等级" })).toBeInTheDocument()
    expect(screen.getByText("当前账号可创建成长等级，但不具备等级目录读取权限。")).toBeInTheDocument()
    expect(getAdminGrowthLevels).not.toHaveBeenCalled()
  })

  it("opens the role and permission management tab", async () => {
    const user = userEvent.setup()
    render(<AdminView session={session} onBack={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "角色与权限" }))
    expect(await screen.findByRole("heading", { name: "角色与权限", level: 1 })).toBeInTheDocument()
    expect(listAuthorizationPermissions).toHaveBeenCalled()
    expect(listAuthorizationRoles).toHaveBeenCalled()
    expect(listAuthorizationAssignments).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }))
  })

  it("shows system and governance tasks in one capability-filtered navigation", async () => {
    render(<AdminView session={session} onBack={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument()
    expect(screen.getByText("聚合待处理事项与站点状态。")).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "站点管理导航" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "品牌配置" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "举报处理" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "风控告警" })).toBeInTheDocument()
  })

  it("offers a compact module selector that follows the same navigation state", async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(<AdminView session={session} onBack={vi.fn()} onTabChange={onTabChange} />)

    const selector = await screen.findByLabelText("管理模块")
    await user.selectOptions(selector, "reports")

    expect(screen.getByRole("heading", { name: "举报处理", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "举报处理" })).toHaveAttribute("aria-current", "page")
    expect(onTabChange).toHaveBeenCalledWith("reports")
  })

  it("does not require a separate sensitive-operation verification panel", async () => {
    render(<AdminView session={session} onBack={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "敏感管理操作" })).not.toBeInTheDocument()
  })

  it("opens a governance-only account in the same site administration shell", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: ["governance.reports.read"] })
    render(<AdminView session={session} onBack={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "站点管理导航" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "举报处理" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "品牌配置" })).not.toBeInTheDocument()
    expect(getAdminSiteBranding).not.toHaveBeenCalled()
    expect(listAdminBoards).not.toHaveBeenCalled()
  })

  it("opens content governance for a board-scoped moderator", async () => {
    vi.mocked(getAdminAccess).mockResolvedValueOnce({ capabilityKeys: [] })
    vi.mocked(listModerationBoards).mockResolvedValueOnce([{
      id: board.id,
      slug: board.slug,
      name: board.name,
      tone: board.tone,
      capabilityKeys: ["moderation.topic", "moderation.topic.pin"],
    }])

    render(<AdminView session={session} onBack={vi.fn()} requestedTab="moderation" />)

    expect(await screen.findByRole("heading", { name: "主题治理工作台" })).toBeInTheDocument()
    expect(document.querySelector(".admin-view--moderation")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "内容治理" })).toHaveAttribute("aria-current", "page")
    const contentGovernanceNavigation = screen.getByRole("group", { name: "内容治理子导航" })
    expect(within(contentGovernanceNavigation).getByText("主题治理工作台")).toHaveAttribute("aria-current", "page")
    const adminHeader = document.querySelector<HTMLElement>(".system-admin-header")!
    expect(within(adminHeader).getByText(session.user.displayName)).toBeInTheDocument()
    expect(within(adminHeader).getByText(`@${session.user.username}`)).toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "当前管理员" })).not.toBeInTheDocument()
    expect(screen.getByText("社区广场")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "品牌配置" })).not.toBeInTheDocument()
  })
})
