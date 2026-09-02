import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Check,
  Flag,
  Gavel,
  Gem,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  MailCheck,
  Moon,
  Palette,
  PanelsTopLeft,
  Plug,
  Plus,
  Save,
  ShieldAlert,
  Sun,
  Trash2,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  type AuthSession,
} from "../api/auth"
import {
  AdminApiError,
  deleteBrandAsset,
  getAdminAccess,
  getAdminSiteBranding,
  getSmtpSettings,
  listAdminBoards,
  getGovernancePolicy,
  listRiskAlerts,
  updateGovernancePolicy,
  updateRiskAlert,
  updateSiteBranding,
  updateSmtpSettings,
  testSmtpSettings,
  uploadBrandAsset,
} from "../api/admin"
import type { AdminBoard, BrandAssetKind, BrandLink, GovernancePolicy, RiskAlert, SiteBranding, SiteBrandingInput, SmtpSettings, SmtpSettingsInput } from "../api/admin"
import { listModerationBoards } from "../api/moderation"
import type { ModerationBoard } from "../api/moderation"
import { MembershipAdminPanel } from "./MembershipAdminPanel"
import { MembershipAdminPage } from "../features/admin-membership/MembershipAdminPage"
import { AuthorizationAdminPanel } from "./AuthorizationAdminPanel"
import { OperationsAdminPanel } from "./OperationsAdminPanel"
import { PluginAdminPanel } from "./PluginAdminPanel"
import { UserAdminPanel } from "./UserAdminPanel"
import { BoardAdminPanel } from "./BoardAdminPanel"
import { ReportAdminPanel, type ReportStatusFilter } from "./ReportAdminPanel"
import { AdminDashboard } from "./AdminDashboard"
import { ModerationAdminPanel } from "./ModerationAdminPanel"

export type AdminTab = "dashboard" | "users" | "branding" | "email" | "boards" | "reports" | "moderation" | "risk" | "membership" | "authorization" | "operations" | "plugins"
type LoadState = "loading" | "ready" | "forbidden" | "error"

interface AdminModuleDefinition {
  tab: AdminTab
  label: string
  description: string
  icon: LucideIcon
  requirements: string[]
  requirementMode?: "all" | "any"
}

const adminModules: AdminModuleDefinition[] = [
  { tab: "dashboard", label: "工作台", description: "聚合待处理事项与站点状态。", icon: LayoutDashboard, requirements: [] },
  { tab: "users", label: "用户管理", description: "检索用户并处理账号与角色。", icon: Users, requirements: ["admin.users.read"] },
  { tab: "boards", label: "版块管理", description: "维护社区结构、可见性与展示信息。", icon: PanelsTopLeft, requirements: ["admin.configuration.read"] },
  { tab: "reports", label: "举报处理", description: "集中核查举报并记录治理结论。", icon: Flag, requirements: ["governance.reports.read"] },
  { tab: "moderation", label: "内容治理", description: "管理主题状态与版块内容秩序。", icon: Gavel, requirements: ["moderation.topic"] },
  { tab: "risk", label: "风控告警", description: "查看风险信号并调整自动治理策略。", icon: ShieldAlert, requirements: ["governance.policy.read", "governance.alerts.read"] },
  { tab: "membership", label: "会员经济", description: "配置成长、积分、勋章、用户组与标准权益。", icon: Gem, requirements: ["membership.rules.read", "membership.rules.write", "membership.medals.read", "membership.medals.rules.write", "membership.points.grant", "membership.medals.grant", "community.groups.read", "entitlements.types.read", "entitlements.types.write", "entitlements.grants.read", "entitlements.grants.write"], requirementMode: "any" },
  { tab: "branding", label: "品牌配置", description: "统一站点品牌、主题与导航展示。", icon: Palette, requirements: ["admin.configuration.read"] },
  { tab: "email", label: "邮件服务", description: "配置 SMTP 发信与注册邮箱验证。", icon: MailCheck, requirements: ["admin.configuration.read"] },
  { tab: "authorization", label: "角色与权限", description: "管理角色能力与人员授权范围。", icon: KeyRound, requirements: ["authorization.roles.read", "authorization.assignments.read"] },
  { tab: "operations", label: "运维监控", description: "观察服务状态、告警与运行规则。", icon: Activity, requirements: ["operations.read"] },
  { tab: "plugins", label: "插件管理", description: "管理插件安装、启停与能力边界。", icon: Plug, requirements: ["plugins.read"] },
]
const tabOrder = adminModules.map(({ tab }) => tab)

interface AdminViewProps {
  session: AuthSession | null | undefined
  onBack: () => void
  onAccessChange?: (access: "allowed" | "denied") => void
  requestedTab?: string | null
  requestedQuery?: string
  onTabChange?: (tab: AdminTab) => void
  onQueryChange?: (query: string) => void
}

export function AdminView({ session, onBack, onAccessChange, requestedTab, requestedQuery, onTabChange, onQueryChange }: AdminViewProps) {
  const [tab, setTab] = useState<AdminTab>(isAdminTab(requestedTab) ? requestedTab : tabOrder[0])
  const [status, setStatus] = useState<LoadState>(session === undefined || session ? "loading" : "forbidden")
  const [branding, setBranding] = useState<SiteBranding | null>(null)
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings | null>(null)
  const [boards, setBoards] = useState<AdminBoard[]>([])
  const [moderationBoards, setModerationBoards] = useState<ModerationBoard[]>([])
  const [availableTabs, setAvailableTabs] = useState<AdminTab[]>([])
  const [capabilityKeys, setCapabilityKeys] = useState<string[]>([])
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (session === undefined) { setStatus("loading"); return }
    if (!session) { setStatus("forbidden"); onAccessChange?.("denied"); return }
    const controller = new AbortController()
    setStatus("loading")
    setError("")
    setAvailableTabs([])
    setCapabilityKeys([])
    Promise.all([
      getAdminAccess(controller.signal),
      listModerationBoards(controller.signal).catch(() => []),
    ])
      .then(async ([{ capabilityKeys }, scopedModerationBoards]) => {
        const capabilities = new Set(capabilityKeys)
        const allowedTaskTabs = adminModules
          .filter(({ tab: candidate, requirements, requirementMode }) => candidate !== "dashboard" && (
            candidate === "moderation"
              ? scopedModerationBoards.length > 0
              : (
            requirementMode === "any"
              ? requirements.some((key) => capabilities.has(key))
              : requirements.every((key) => capabilities.has(key))
              )
          ))
          .map(({ tab: candidate }) => candidate)
        if (allowedTaskTabs.length === 0) {
          if (!controller.signal.aborted) {
            setStatus("forbidden")
            onAccessChange?.("denied")
          }
          return
        }
        const allowedTabs: AdminTab[] = ["dashboard", ...allowedTaskTabs]

        const canReadConfiguration = capabilities.has("admin.configuration.read")
        const configuration = await (
          canReadConfiguration
            ? Promise.all([getAdminSiteBranding(controller.signal), listAdminBoards(controller.signal), getSmtpSettings(controller.signal)])
            : Promise.resolve(null)
        )
        if (controller.signal.aborted) return
        setAvailableTabs(allowedTabs)
        setCapabilityKeys(capabilityKeys)
        setModerationBoards(scopedModerationBoards)
        setTab((current) => allowedTabs.includes(current) ? current : allowedTabs[0])
        setBranding(configuration?.[0] ?? null)
        setBoards(configuration?.[1] ?? [])
        setSmtpSettings(configuration?.[2] ?? null)
        setStatus("ready")
        onAccessChange?.("allowed")
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        if (reason instanceof AdminApiError && reason.status === 403) {
          setStatus("forbidden")
          onAccessChange?.("denied")
          return
        }
        setStatus("error")
        setError("管理配置暂时无法加载，请稍后重试。")
      })
    return () => controller.abort()
  }, [onAccessChange, reload, session])

  useEffect(() => {
    if (availableTabs.length === 0) return
    const nextTab = isAdminTab(requestedTab) && availableTabs.includes(requestedTab)
      ? requestedTab
      : availableTabs[0]
    setTab(nextTab)
    if (requestedTab !== nextTab) onTabChange?.(nextTab)
  }, [availableTabs, onTabChange, requestedTab])

  if (status === "forbidden") {
    return <AdminShell session={session} onBack={onBack}><AdminState kind="forbidden" onRetry={session ? () => setReload((value) => value + 1) : undefined} /></AdminShell>
  }
  if (status === "loading") {
    return <AdminShell session={session} onBack={onBack}><AdminState kind="loading" /></AdminShell>
  }
  if (status === "error") {
    return <AdminShell session={session} onBack={onBack}><AdminState kind="error" message={error} onRetry={() => setReload((value) => value + 1)} /></AdminShell>
  }

  const availableModules = adminModules.filter(({ tab: candidate }) => availableTabs.includes(candidate))
  const activeModule = availableModules.find(({ tab: candidate }) => candidate === tab) ?? availableModules[0]
  const navigateTo = (nextTab: AdminTab) => {
    setTab(nextTab)
    onTabChange?.(nextTab)
  }
  const navigation = (
    <>
      <nav className="system-admin-nav" aria-label="站点管理导航">
        <p>管理任务</p>
        {availableModules.map((module) => (
          <div className="system-admin-nav__item" key={module.tab}>
            <button type="button" aria-label={module.label} title={module.label} aria-current={tab === module.tab ? "page" : undefined} onClick={() => navigateTo(module.tab)}>
              <module.icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <strong>{module.label}</strong>
            </button>
            {module.tab === "moderation" && tab === "moderation" ? (
              <div className="system-admin-nav__children" role="group" aria-label="内容治理子导航">
                <span aria-current="page">主题治理工作台</span>
              </div>
            ) : null}
          </div>
        ))}
      </nav>
      <label className="system-admin-mobile-nav">
        <span>管理模块</span>
        <select aria-label="管理模块" value={tab} onChange={(event) => navigateTo(event.target.value as AdminTab)}>
          {availableModules.map((module) => <option key={module.tab} value={module.tab}>{module.label}</option>)}
        </select>
      </label>
    </>
  )

  return (
    <AdminShell
      session={session}
      onBack={onBack}
      navigation={navigation}
      pageTitle={activeModule.label}
      pageDescription={activeModule.description}
      variant={tab === "moderation" ? "moderation" : "default"}
    >
      {tab === "dashboard" ? (
        <AdminDashboard
          capabilityKeys={capabilityKeys}
          boards={boards}
          onNavigate={(nextTab, query) => {
            navigateTo(nextTab)
            onQueryChange?.(query)
          }}
        />
      ) : tab === "users" ? (
        <UserAdminPanel
          requestedQuery={requestedQuery}
          onQueryChange={onQueryChange}
          csrfToken={session?.csrfToken ?? ""}
          canModerate={capabilityKeys.includes("admin.users.moderate")}
          canAssignRoles={[
            "authorization.roles.read",
            "authorization.assignments.read",
            "authorization.assignments.write",
          ].every((key) => capabilityKeys.includes(key))}
          canReadAudit={capabilityKeys.includes("audit.read")}
          boards={boards}
        />
      ) : tab === "branding" ? (
        branding
          ? <BrandingPanel branding={branding} csrfToken={session?.csrfToken ?? ""} onSaved={setBranding} />
          : <AdminState kind="error" message="品牌配置暂时无法加载。" onRetry={() => setReload((value) => value + 1)} />
      ) : tab === "boards" ? (
        <BoardAdminPanel boards={boards} csrfToken={session?.csrfToken ?? ""} canWrite={capabilityKeys.includes("admin.configuration.write")} onChange={setBoards} />
      ) : tab === "email" ? (
        smtpSettings
          ? <SmtpSettingsPanel settings={smtpSettings} csrfToken={session?.csrfToken ?? ""} canWrite={capabilityKeys.includes("admin.configuration.write")} onSaved={setSmtpSettings} />
          : <AdminState kind="error" message="邮件配置暂时无法加载。" onRetry={() => setReload((value) => value + 1)} />
      ) : tab === "reports" ? (
        <ReportAdminPanel
          csrfToken={session?.csrfToken ?? ""}
          requestedStatus={reportStatusFilterFromQuery(requestedQuery)}
          requestedReportId={reportIdFromQuery(requestedQuery)}
          onStatusChange={(statusFilter) => onQueryChange?.(statusFilter === "all" ? "" : `status=${statusFilter}`)}
          canResolve={capabilityKeys.includes("governance.reports.resolve")}
          canReadAudit={capabilityKeys.includes("audit.read")}
        />
      ) : tab === "moderation" ? (
        <ModerationAdminPanel
          boards={moderationBoards}
          csrfToken={session?.csrfToken ?? ""}
          canReadAudit={capabilityKeys.includes("audit.read")}
        />
      ) : tab === "risk" ? (
        <RiskPanel csrfToken={session?.csrfToken ?? ""} />
      ) : tab === "authorization" ? (
        <AuthorizationAdminPanel csrfToken={session?.csrfToken ?? ""} boards={boards} />
      ) : tab === "operations" ? (
        <OperationsAdminPanel csrfToken={session?.csrfToken ?? ""} canWrite={capabilityKeys.includes("operations.alerts.write")} />
      ) : tab === "plugins" ? (
        <PluginAdminPanel
          csrfToken={session?.csrfToken ?? ""}
          canInstall={capabilityKeys.includes("plugins.install")}
          canLifecycle={capabilityKeys.includes("plugins.lifecycle")}
          canInvoke={capabilityKeys.includes("plugins.invoke")}
        />
      ) : (
        <MembershipAdminPage>
          <MembershipAdminPanel
            csrfToken={session?.csrfToken ?? ""}
            canReadLevelRules={capabilityKeys.includes("membership.rules.read")}
            canWriteLevelRules={capabilityKeys.includes("membership.rules.write")}
            canReadMedalRules={capabilityKeys.includes("membership.medals.read")}
            canWriteMedalRules={capabilityKeys.includes("membership.medals.rules.write")}
            canGrantPoints={capabilityKeys.includes("membership.points.grant")}
            canGrantMedals={capabilityKeys.includes("membership.medals.grant")}
            canReadGroups={capabilityKeys.includes("community.groups.read")}
            canWriteGroups={capabilityKeys.includes("community.groups.write")}
            canReadGroupMemberships={capabilityKeys.includes("community.memberships.read")}
            canWriteGroupMemberships={capabilityKeys.includes("community.memberships.write")}
            canReadUsers={capabilityKeys.includes("admin.users.read")}
            canReadEntitlementTypes={capabilityKeys.includes("entitlements.types.read")}
            canWriteEntitlementTypes={capabilityKeys.includes("entitlements.types.write")}
            canReadEntitlementGrants={capabilityKeys.includes("entitlements.grants.read")}
            canWriteEntitlementGrants={capabilityKeys.includes("entitlements.grants.write")}
          />
        </MembershipAdminPage>
      )}
    </AdminShell>
  )
}

function AdminShell({ session, children, onBack, navigation, pageTitle = "站点管理", pageDescription = "管理社区配置与治理任务。", variant = "default" }: { session: AuthSession | null | undefined; children: React.ReactNode; onBack: () => void; navigation?: React.ReactNode; pageTitle?: string; pageDescription?: string; variant?: "default" | "moderation" }) {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const storedTheme = window.localStorage.getItem("daoyun-theme")
    if (storedTheme === "light" || storedTheme === "dark") return storedTheme
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem("daoyun-theme", theme)
  }, [theme])

  return (
    <div className={`admin-view admin-view--system${variant === "moderation" ? " admin-view--moderation" : ""}`}>
      <header className="system-admin-header">
        <div className="system-admin-brand"><span aria-hidden="true">刀</span><div><strong>刀云站点管理</strong><small>管理后台</small></div></div>
        <button className="system-admin-back" type="button" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />返回社区</button>
        <button className="system-admin-theme" type="button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={theme === "light" ? "切换为深色主题" : "切换为浅色主题"} title={theme === "light" ? "深色主题" : "浅色主题"}>{theme === "light" ? <Moon size={15} aria-hidden="true" /> : <Sun size={15} aria-hidden="true" />}</button>
        <div className="system-admin-account"><span>{session?.user.displayName ?? "未登录"}</span><small>{session ? `@${session.user.username}` : "需要管理员会话"}</small></div>
      </header>
      <div className="system-admin-layout">
        <aside className="system-admin-sidebar">
          {navigation}
          {variant === "moderation" ? (
            <div className="system-admin-sidebar-account" role="group" aria-label="当前管理员" hidden aria-hidden="true">
              <span className="system-admin-sidebar-account__avatar" aria-hidden="true">{(session?.user.displayName ?? "管").slice(0, 1)}</span>
              <div><strong>{session?.user.displayName ?? "未登录"}</strong><small>{session ? `@${session.user.username}` : "需要管理员会话"}</small></div>
            </div>
          ) : null}
        </aside>
        <main className="system-admin-main">
          <header className="system-admin-page-heading">
            <div><h1 id="admin-heading">{pageTitle}</h1><p>{pageDescription}</p></div>
          </header>
          <div className="system-admin-content">{children}</div>
        </main>
      </div>
    </div>
  )
}

function AdminState({ kind, message, onRetry }: { kind: "loading" | "forbidden" | "error"; message?: string; onRetry?: () => void }) {
  if (kind === "loading") return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" /><span>正在读取管理配置</span></div>
  if (kind === "forbidden") return <div className="admin-state" role="alert"><AlertCircle size={24} aria-hidden="true" /><h2>当前账号没有站点管理权限</h2><p>需要具备管理读取权限</p></div>
  return <div className="admin-state" role="alert"><AlertCircle size={24} aria-hidden="true" /><h2>管理配置加载失败</h2><p>{message || "请稍后重试。"}</p><button className="secondary-button" type="button" onClick={onRetry}>重试加载</button></div>
}

function isAdminTab(value: string | null | undefined): value is AdminTab {
  return Boolean(value && tabOrder.includes(value as AdminTab))
}

function BrandingPanel({ branding, csrfToken, onSaved }: { branding: SiteBranding; csrfToken: string; onSaved: (value: SiteBranding) => void }) {
  const [form, setForm] = useState<SiteBrandingInput>(() => ({ ...branding, homeMode: "hot" }))
  const receivedInitialBranding = useRef(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [fields, setFields] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (!receivedInitialBranding.current) {
      receivedInitialBranding.current = true
      return
    }
    setForm({ ...branding, homeMode: "hot" })
  }, [branding])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true); setMessage(""); setError(""); setFields({})
    try {
      const saved = await updateSiteBranding(form, csrfToken)
      onSaved(saved); setMessage("品牌配置已保存")
    } catch (reason) {
      if (reason instanceof AdminApiError) { setFields(reason.fields); setError(reason.message) } else setError("保存失败，请稍后重试。")
    } finally { setSaving(false) }
  }

  function change<K extends keyof SiteBrandingInput>(key: K, value: SiteBrandingInput[K]) { setForm((current) => ({ ...current, [key]: value })); setMessage("") }

  function changeLink(key: "navigationLinks" | "footerLinks", index: number, field: keyof BrandLink, value: string) {
    change(key, form[key].map((link, linkIndex) => linkIndex === index ? { ...link, [field]: value } : link))
  }

  function addLink(key: "navigationLinks" | "footerLinks") {
    if (form[key].length < 8) change(key, [...form[key], { label: "", url: "" }])
  }

  function removeLink(key: "navigationLinks" | "footerLinks", index: number) {
    change(key, form[key].filter((_, linkIndex) => linkIndex !== index))
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel__heading"><div><p>站点外观</p><h2>站点品牌</h2></div><span className="admin-badge">预览同步</span></div>
      <form className="admin-form" onSubmit={save}>
        <label><span>站点名称</span><input value={form.siteName} onChange={(event) => change("siteName", event.target.value)} aria-invalid={Boolean(fields.site_name)} />{fieldError(fields.site_name)}</label>
        <div className="admin-form__grid">
          <label><span>Logo HTTPS 地址</span><input type="url" value={form.logoUrl ?? ""} onChange={(event) => change("logoUrl", event.target.value || null)} aria-invalid={Boolean(fields.logo_url)} />{fieldError(fields.logo_url)}</label>
          <label><span>Favicon HTTPS 地址</span><input type="url" value={form.faviconUrl ?? ""} onChange={(event) => change("faviconUrl", event.target.value || null)} aria-invalid={Boolean(fields.favicon_url)} />{fieldError(fields.favicon_url)}</label>
        </div>
        <div className="admin-form__grid">
          <BrandAssetControl kind="logo" label="Logo" accept="image/png,image/webp" currentUrl={form.logoUrl} csrfToken={csrfToken} onSaved={onSaved} />
          <BrandAssetControl kind="favicon" label="Favicon" accept="image/png" currentUrl={form.faviconUrl} csrfToken={csrfToken} onSaved={onSaved} />
        </div>
        <label><span>默认主题封面 HTTPS 地址</span><input type="url" value={form.defaultCoverUrl ?? ""} onChange={(event) => change("defaultCoverUrl", event.target.value || null)} aria-invalid={Boolean(fields.default_cover_url)} />{fieldError(fields.default_cover_url)}</label>
        <BrandLinksEditor title="自定义导航" links={form.navigationLinks} fieldErrors={fields.navigation_links} onChange={(index, field, value) => changeLink("navigationLinks", index, field, value)} onAdd={() => addLink("navigationLinks")} onRemove={(index) => removeLink("navigationLinks", index)} />
        <label><span>页脚文字</span><input value={form.footerText ?? ""} onChange={(event) => change("footerText", event.target.value || null)} maxLength={160} aria-invalid={Boolean(fields.footer_text)} />{fieldError(fields.footer_text)}</label>
        <BrandLinksEditor title="页脚链接" links={form.footerLinks} fieldErrors={fields.footer_links} onChange={(index, field, value) => changeLink("footerLinks", index, field, value)} onAdd={() => addLink("footerLinks")} onRemove={(index) => removeLink("footerLinks", index)} />
        <div className="admin-form__grid">
          <label><span>主色</span><input type="color" value={form.primaryColor} onChange={(event) => change("primaryColor", event.target.value)} /><small>{form.primaryColor}</small>{fieldError(fields.primary_color)}</label>
          <label><span>强调色</span><input type="color" value={form.accentColor} onChange={(event) => change("accentColor", event.target.value)} /><small>{form.accentColor}</small>{fieldError(fields.accent_color)}</label>
        </div>
        <div className="admin-form__grid">
          <label><span>官方预设</span><select value={form.themePreset} onChange={(event) => change("themePreset", event.target.value as SiteBrandingInput["themePreset"])}><option value="default">默认</option><option value="dark">深色</option><option value="compact">紧凑</option><option value="high_contrast">高对比度</option></select></label>
          <label><span>列表密度</span><select value={form.listDensity} onChange={(event) => change("listDensity", event.target.value as SiteBrandingInput["listDensity"])}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
        </div>
        <label><span>首页模式</span><select value="hot" aria-label="首页模式" disabled><option value="hot">推荐（固定）</option></select><small>首页统一使用推荐发现；历史配置仍兼容读取，但保存时会收敛为推荐。</small></label>
        <div className="admin-preview" style={{ "--admin-primary": form.primaryColor, "--admin-accent": form.accentColor } as React.CSSProperties}><strong>{form.siteName || "站点名称"}</strong><span>这是保存后的颜色预览</span><i /></div>
        {(error || message) && <p className={error ? "form-alert" : "admin-success"} role={error ? "alert" : "status"}>{error || message}</p>}
        <div className="admin-form__actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}保存品牌配置</button></div>
      </form>
    </div>
  )
}

function SmtpSettingsPanel({ settings, csrfToken, canWrite, onSaved }: { settings: SmtpSettings; csrfToken: string; canWrite: boolean; onSaved: (value: SmtpSettings) => void }) {
  const [form, setForm] = useState<SmtpSettingsInput>(() => smtpForm(settings))
  const [testRecipient, setTestRecipient] = useState("")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [fields, setFields] = useState<Record<string, string[]>>({})

  useEffect(() => setForm(smtpForm(settings)), [settings])

  function change<K extends keyof SmtpSettingsInput>(key: K, value: SmtpSettingsInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setMessage("")
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!canWrite || saving) return
    setSaving(true); setMessage(""); setError(""); setFields({})
    try {
      const saved = await updateSmtpSettings(form, csrfToken)
      onSaved(saved)
      setMessage("邮件配置已保存")
    } catch (reason) {
      if (reason instanceof AdminApiError) { setFields(reason.fields); setError(reason.message) } else setError("邮件配置保存失败，请稍后重试。")
    } finally { setSaving(false) }
  }

  async function sendTest() {
    if (!canWrite || testing || !testRecipient.trim()) return
    setTesting(true); setMessage(""); setError("")
    try {
      await testSmtpSettings(testRecipient.trim(), csrfToken)
      setMessage("测试邮件已发送")
    } catch (reason) {
      setError(reason instanceof AdminApiError ? reason.message : "测试邮件发送失败，请检查服务器与账号配置。")
    } finally { setTesting(false) }
  }

  return (
    <div className="admin-panel smtp-settings-panel">
      <div className="admin-panel__heading">
        <div><p>出站邮件</p><h2>SMTP 邮件服务</h2></div>
        <span className="admin-badge">{settings.enabled ? "已启用" : "未启用"}</span>
      </div>
      <form className="admin-form" onSubmit={save}>
        <div className="admin-form__grid">
          <label><span>SMTP 主机</span><input value={form.host} onChange={(event) => change("host", event.target.value)} placeholder="smtp.example.com" aria-invalid={Boolean(fields.host)} />{fieldError(fields.host)}</label>
          <label><span>端口</span><input type="number" min={1} max={65535} value={form.port} onChange={(event) => change("port", Number(event.target.value))} aria-invalid={Boolean(fields.port)} />{fieldError(fields.port)}</label>
          <label><span>连接加密</span><select value={form.tlsMode} onChange={(event) => change("tlsMode", event.target.value as SmtpSettingsInput["tlsMode"])}><option value="starttls">STARTTLS（常用端口 587）</option><option value="tls">TLS（常用端口 465）</option><option value="none">不加密（仅限可信内网）</option></select></label>
        </div>
        <div className="admin-form__grid">
          <label><span>SMTP 用户名</span><input value={form.username ?? ""} onChange={(event) => change("username", event.target.value || null)} autoComplete="username" aria-invalid={Boolean(fields.username)} />{fieldError(fields.username)}</label>
          <label><span>SMTP 密码</span><input type="password" value={form.password} onChange={(event) => change("password", event.target.value)} placeholder={settings.passwordConfigured ? "已保存，留空则不修改" : "输入 SMTP 密码"} autoComplete="new-password" aria-invalid={Boolean(fields.password)} />{fieldError(fields.password)}</label>
        </div>
        {settings.passwordConfigured && <label className="admin-checkbox"><input type="checkbox" checked={form.clearPassword} onChange={(event) => change("clearPassword", event.target.checked)} /><span>清除已保存的 SMTP 密码</span></label>}
        <div className="admin-form__grid">
          <label><span>发件人名称</span><input value={form.fromName} onChange={(event) => change("fromName", event.target.value)} aria-invalid={Boolean(fields.from_name)} />{fieldError(fields.from_name)}</label>
          <label><span>发件邮箱</span><input type="email" value={form.fromEmail} onChange={(event) => change("fromEmail", event.target.value)} placeholder="noreply@example.com" aria-invalid={Boolean(fields.from_email)} />{fieldError(fields.from_email)}</label>
        </div>
        <fieldset className="smtp-settings-panel__switches">
          <legend>启用范围</legend>
          <label className="admin-checkbox"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked, registrationEmailVerificationEnabled: event.target.checked ? current.registrationEmailVerificationEnabled : false }))} /><span><strong>启用 SMTP 发信</strong><small>关闭后不会发送任何系统邮件。</small></span></label>
          <label className="admin-checkbox"><input type="checkbox" checked={form.registrationEmailVerificationEnabled} disabled={!form.enabled} onChange={(event) => change("registrationEmailVerificationEnabled", event.target.checked)} /><span><strong>注册时验证邮箱</strong><small>新用户需要填写邮件中的 6 位验证码。</small></span></label>
        </fieldset>
        {(error || message) && <p className={error ? "form-alert" : "admin-success"} role={error ? "alert" : "status"}>{error || message}</p>}
        <div className="admin-form__actions"><button className="primary-button" type="submit" disabled={!canWrite || saving}>{saving ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}保存邮件配置</button></div>
      </form>
      <div className="smtp-settings-panel__test">
        <div><strong>发送测试邮件</strong><small>测试使用当前已保存的配置，请先保存上方修改。</small></div>
        <label><span>测试收件邮箱</span><input type="email" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} placeholder="admin@example.com" /></label>
        <button className="secondary-button" type="button" onClick={() => void sendTest()} disabled={!canWrite || testing || !testRecipient.trim()}>{testing ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <MailCheck size={15} aria-hidden="true" />}发送测试邮件</button>
      </div>
      {!canWrite && <p className="admin-empty">当前账号只有查看权限。</p>}
    </div>
  )
}

function smtpForm(settings: SmtpSettings): SmtpSettingsInput {
  return { ...settings, password: "", clearPassword: false }
}

function BrandAssetControl({ kind, label, accept, currentUrl, csrfToken, onSaved }: { kind: BrandAssetKind; label: string; accept: string; currentUrl: string | null; csrfToken: string; onSaved: (value: SiteBranding) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const internalUrl = `/api/v1/site-branding/assets/${kind}`

  async function upload() {
    if (!file || pending) return
    setPending(true); setMessage("")
    try {
      const saved = await uploadBrandAsset(kind, file, csrfToken)
      onSaved(saved); setFile(null); setMessage(`${label} 已上传`)
    } catch (reason) {
      setMessage(reason instanceof AdminApiError ? reason.message : `${label} 上传失败，请稍后重试。`)
    } finally { setPending(false) }
  }

  async function remove() {
    if (pending) return
    setPending(true); setMessage("")
    try {
      const saved = await deleteBrandAsset(kind, csrfToken)
      onSaved(saved); setMessage(`${label} 已删除`)
    } catch (reason) {
      setMessage(reason instanceof AdminApiError ? reason.message : `${label} 删除失败，请稍后重试。`)
    } finally { setPending(false) }
  }

  return (
    <fieldset className="brand-asset-control">
      <legend>{label} 文件</legend>
      <label><span className="sr-only">上传 {label} 文件</span><input type="file" accept={accept} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setMessage("") }} /></label>
      <div className="brand-asset-control__actions">
        <button className="secondary-button" type="button" onClick={() => void upload()} disabled={!file || pending}><Upload size={14} aria-hidden="true" />上传 {label}</button>
        {currentUrl === internalUrl && <button className="icon-button" type="button" onClick={() => void remove()} disabled={pending} aria-label={`删除已上传的 ${label}`} title="删除"><Trash2 size={14} aria-hidden="true" /></button>}
      </div>
      {message && <small role="status">{message}</small>}
    </fieldset>
  )
}

function BrandLinksEditor({ title, links, fieldErrors, onChange, onAdd, onRemove }: { title: string; links: BrandLink[]; fieldErrors?: string[]; onChange: (index: number, field: keyof BrandLink, value: string) => void; onAdd: () => void; onRemove: (index: number) => void }) {
  return (
    <fieldset className="brand-links-editor">
      <div className="brand-links-editor__heading"><legend>{title}</legend><button className="secondary-button" type="button" onClick={onAdd} disabled={links.length >= 8}><Plus size={14} aria-hidden="true" />添加链接</button></div>
      {links.length === 0 ? <small>尚未配置链接</small> : links.map((link, index) => (
        <div className="brand-link-row" key={`${title}-${index}`}>
          <label><span>名称 {index + 1}</span><input value={link.label} onChange={(event) => onChange(index, "label", event.target.value)} maxLength={40} /></label>
          <label><span>地址 {index + 1}</span><input value={link.url} onChange={(event) => onChange(index, "url", event.target.value)} placeholder="#about 或 https://…" /></label>
          <button className="icon-button" type="button" onClick={() => onRemove(index)} aria-label={`删除${title} ${index + 1}`} title="删除"><Trash2 size={14} aria-hidden="true" /></button>
        </div>
      ))}
      {fieldError(fieldErrors)}
    </fieldset>
  )
}

function reportStatusFilterFromQuery(query = ""): ReportStatusFilter {
  const status = new URLSearchParams(query).get("status")
  return status === "open" || status === "in_review" || status === "resolved" || status === "dismissed" ? status : "all"
}

function reportIdFromQuery(query = ""): string | null {
  const reportId = new URLSearchParams(query).get("report_id")
  return reportId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId) ? reportId : null
}

function RiskPanel({ csrfToken }: { csrfToken: string }) {
  const [policy, setPolicy] = useState<GovernancePolicy | null>(null)
  const [alerts, setAlerts] = useState<RiskAlert[]>([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([getGovernancePolicy(), listRiskAlerts({ limit: 50 })])
      .then(([loadedPolicy, loadedAlerts]) => { if (active) { setPolicy(loadedPolicy); setAlerts(loadedAlerts.alerts); setError("") } })
      .catch(() => { if (active) setError("风控策略或告警暂时无法加载，请稍后重试。") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault()
    if (!policy) return
    setSaving(true); setError("")
    try { setPolicy(await updateGovernancePolicy(policy, csrfToken)) } catch { setError("风控策略保存失败，请稍后重试。") } finally { setSaving(false) }
  }

  async function changeAlert(alert: RiskAlert, status: "acknowledged" | "dismissed") {
    try {
      const updated = await updateRiskAlert(alert.id, status, csrfToken)
      setAlerts((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch { setError("风险告警更新失败，请稍后重试。") }
  }

  if (loading) return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" /><span>正在读取风控策略</span></div>
  if (!policy) return <div className="admin-state" role="alert"><AlertCircle size={22} aria-hidden="true" /><h2>风控策略无法加载</h2><p>{error}</p></div>

  return <div className="admin-panel">
    <div className="admin-panel__heading"><div><p>自动治理</p><h2>风控告警</h2></div><span className="admin-badge">{alerts.filter((alert) => alert.status === "open").length} 条待处理</span></div>
    <form className="admin-form" onSubmit={savePolicy}>
      <label className="admin-checkbox"><input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })} /><span>启用自动风险评分</span></label>
      <div className="admin-form__grid">
        <label><span>告警分数阈值</span><input type="number" min={1} max={100} value={policy.alertScoreThreshold} onChange={(event) => setPolicy({ ...policy, alertScoreThreshold: Number(event.target.value) })} /></label>
        <label><span>举报窗口（分钟）</span><input type="number" min={1} max={1440} value={policy.reporterWindowMinutes} onChange={(event) => setPolicy({ ...policy, reporterWindowMinutes: Number(event.target.value) })} /></label>
        <label><span>窗口内告警次数</span><input type="number" min={1} max={100} value={policy.reporterAlertLimit} onChange={(event) => setPolicy({ ...policy, reporterAlertLimit: Number(event.target.value) })} /></label>
      </div>
      <button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}保存风控策略</button>
    </form>
    {error && <p className="form-alert" role="alert">{error}</p>}
    {alerts.length === 0 ? <div className="admin-empty" role="status"><ShieldAlert size={22} aria-hidden="true" /><span>暂无风险告警</span></div> : <div className="admin-report-list">
      {alerts.map((alert) => <article className="admin-report-row" key={alert.id}>
        <header><span><ShieldAlert size={14} aria-hidden="true" />{alert.kind === "reporter_spike" ? "举报频次" : "高风险举报"}</span><strong>{alert.severity} · {alert.score} 分</strong><time>{alert.createdAt}</time></header>
        <p>状态：{alert.status === "open" ? "待处理" : alert.status === "acknowledged" ? "已确认" : "已驳回"}</p>
        {alert.status === "open" && <div className="admin-report-row__actions"><button className="secondary-button" type="button" onClick={() => void changeAlert(alert, "acknowledged")}><Check size={14} aria-hidden="true" />确认告警</button><button className="secondary-button" type="button" onClick={() => void changeAlert(alert, "dismissed")}><X size={14} aria-hidden="true" />驳回告警</button></div>}
      </article>)}
    </div>}
  </div>
}

function fieldError(messages?: string[]) { return messages?.[0] ? <small className="field-error">{messages[0]}</small> : null }
