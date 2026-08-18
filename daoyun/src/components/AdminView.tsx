import { AlertCircle, ArrowLeft, Check, LoaderCircle, Plus, Save, ShieldAlert, Trash2, Upload, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  ADMIN_PRIVILEGED_WRITE_OPERATION,
  createRecentAuthenticationForOperation,
  type AuthSession,
} from "../api/auth"
import {
  AdminApiError,
  deleteBrandAsset,
  getAdminAccess,
  getAdminSiteBranding,
  listAdminBoards,
  getGovernancePolicy,
  listRiskAlerts,
  updateGovernancePolicy,
  updateRiskAlert,
  updateSiteBranding,
  uploadBrandAsset,
} from "../api/admin"
import type { AdminBoard, BrandAssetKind, BrandLink, GovernancePolicy, RiskAlert, SiteBranding, SiteBrandingInput } from "../api/admin"
import { MembershipAdminPanel } from "./MembershipAdminPanel"
import { AuthorizationAdminPanel } from "./AuthorizationAdminPanel"
import { OperationsAdminPanel } from "./OperationsAdminPanel"
import { PluginAdminPanel } from "./PluginAdminPanel"
import { UserAdminPanel } from "./UserAdminPanel"
import { BoardAdminPanel } from "./BoardAdminPanel"
import { ReportAdminPanel, type ReportStatusFilter } from "./ReportAdminPanel"
import { AdminDashboard } from "./AdminDashboard"

export type AdminTab = "dashboard" | "users" | "branding" | "boards" | "reports" | "risk" | "membership" | "authorization" | "operations" | "plugins"
type LoadState = "loading" | "ready" | "forbidden" | "error"

interface AdminModuleDefinition {
  tab: AdminTab
  label: string
  requirements: string[]
  requirementMode?: "all" | "any"
}

const adminModules: AdminModuleDefinition[] = [
  { tab: "dashboard", label: "工作台", requirements: [] },
  { tab: "users", label: "用户管理", requirements: ["admin.users.read"] },
  { tab: "boards", label: "版块管理", requirements: ["admin.configuration.read"] },
  { tab: "reports", label: "举报处理", requirements: ["governance.reports.read"] },
  { tab: "risk", label: "风控告警", requirements: ["governance.policy.read", "governance.alerts.read"] },
  { tab: "membership", label: "会员经济", requirements: ["membership.rules.read", "membership.medals.read", "membership.points.grant", "membership.medals.grant"], requirementMode: "any" },
  { tab: "branding", label: "品牌配置", requirements: ["admin.configuration.read"] },
  { tab: "authorization", label: "角色与权限", requirements: ["authorization.roles.read", "authorization.assignments.read"] },
  { tab: "operations", label: "运维监控", requirements: ["operations.read"] },
  { tab: "plugins", label: "插件管理", requirements: ["plugins.read"] },
]
const tabOrder = adminModules.map(({ tab }) => tab)
const privilegedAdminWriteCapabilities = new Set([
  "authorization.roles.write",
  "authorization.assignments.write",
  "community.groups.write",
  "community.memberships.write",
  "content.access_policies.write",
  "entitlements.types.write",
  "entitlements.grants.write",
  "membership.rules.write",
  "membership.points.grant",
  "membership.medals.grant",
  "membership.medals.rules.write",
])

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
  const [boards, setBoards] = useState<AdminBoard[]>([])
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
    getAdminAccess(controller.signal)
      .then(async ({ capabilityKeys }) => {
        const capabilities = new Set(capabilityKeys)
        const allowedTaskTabs = adminModules
          .filter(({ tab: candidate, requirements, requirementMode }) => candidate !== "dashboard" && (
            requirementMode === "any"
              ? requirements.some((key) => capabilities.has(key))
              : requirements.every((key) => capabilities.has(key))
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
            ? Promise.all([getAdminSiteBranding(controller.signal), listAdminBoards(controller.signal)])
            : Promise.resolve(null)
        )
        if (controller.signal.aborted) return
        setAvailableTabs(allowedTabs)
        setCapabilityKeys(capabilityKeys)
        setTab((current) => allowedTabs.includes(current) ? current : allowedTabs[0])
        setBranding(configuration?.[0] ?? null)
        setBoards(configuration?.[1] ?? [])
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
  const navigateTo = (nextTab: AdminTab) => {
    setTab(nextTab)
    onTabChange?.(nextTab)
  }
  const navigation = (
    <nav className="system-admin-nav" aria-label="站点管理导航">
      <p>管理任务</p>
      {availableModules.map((module) => (
        <button key={module.tab} type="button" aria-label={module.label} aria-current={tab === module.tab ? "page" : undefined} onClick={() => navigateTo(module.tab)}>
          <strong>{module.label}</strong>
        </button>
      ))}
    </nav>
  )

  return (
    <AdminShell session={session} onBack={onBack} navigation={navigation}>
      {capabilityKeys.some((key) => privilegedAdminWriteCapabilities.has(key)) && (
        <AdminPrivilegedAuthPanel csrfToken={session?.csrfToken ?? ""} />
      )}
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
      ) : tab === "reports" ? (
        <ReportAdminPanel
          csrfToken={session?.csrfToken ?? ""}
          requestedStatus={reportStatusFilterFromQuery(requestedQuery)}
          requestedReportId={reportIdFromQuery(requestedQuery)}
          onStatusChange={(statusFilter) => onQueryChange?.(statusFilter === "all" ? "" : `status=${statusFilter}`)}
          canResolve={capabilityKeys.includes("governance.reports.resolve")}
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
        <MembershipAdminPanel
          csrfToken={session?.csrfToken ?? ""}
          canReadLevelRules={capabilityKeys.includes("membership.rules.read")}
          canReadMedalRules={capabilityKeys.includes("membership.medals.read")}
          canGrantPoints={capabilityKeys.includes("membership.points.grant")}
          canGrantMedals={capabilityKeys.includes("membership.medals.grant")}
        />
      )}
    </AdminShell>
  )
}

function AdminShell({ session, children, onBack, navigation }: { session: AuthSession | null | undefined; children: React.ReactNode; onBack: () => void; navigation?: React.ReactNode }) {
  return (
    <div className="admin-view admin-view--system">
      <header className="system-admin-header">
        <div className="system-admin-brand"><span aria-hidden="true">刀</span><div><strong>刀云站点管理</strong><small>Site Administration</small></div></div>
        <button className="system-admin-back" type="button" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />返回社区</button>
        <div className="system-admin-account"><span>{session?.user.displayName ?? "未登录"}</span><small>{session ? `@${session.user.username}` : "需要管理员会话"}</small></div>
      </header>
      <div className="system-admin-layout">
        <aside className="system-admin-sidebar">{navigation}</aside>
        <main className="system-admin-main">
          <header className="system-admin-page-heading">
            <div><p>站点管理</p><h1 id="admin-heading">站点管理</h1></div>
          </header>
          <div className="system-admin-content">{children}</div>
        </main>
      </div>
    </div>
  )
}

function AdminPrivilegedAuthPanel({ csrfToken }: { csrfToken: string }) {
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const verify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password) {
      setError("请输入当前密码")
      return
    }
    setSubmitting(true)
    setMessage("")
    setError("")
    try {
      const result = await createRecentAuthenticationForOperation(
        password,
        csrfToken,
        ADMIN_PRIVILEGED_WRITE_OPERATION,
      )
      setPassword("")
      setMessage(`敏感管理操作验证已通过，有效至 ${new Date(result.expiresAt).toLocaleTimeString()}`)
    } catch {
      setError("当前密码验证失败，请检查后重试")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-panel" aria-label="敏感管理操作验证">
      <div className="admin-panel__heading">
        <div><p>安全验证</p><h2>敏感管理操作</h2></div>
        <span className="admin-badge">10 分钟有效</span>
      </div>
      <form className="admin-form" onSubmit={(event) => void verify(event)}>
        <label>当前密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <div className="admin-form__actions"><button className="secondary-button" type="submit" disabled={submitting}>{submitting ? "验证中…" : "验证敏感操作"}</button></div>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
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
  const [form, setForm] = useState<SiteBrandingInput>(branding)
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
    setForm(branding)
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
        <label><span>首页模式</span><select value={form.homeMode} onChange={(event) => change("homeMode", event.target.value as SiteBrandingInput["homeMode"])}><option value="latest">最新</option><option value="hot">热门</option><option value="featured">精华</option></select></label>
        <div className="admin-preview" style={{ "--admin-primary": form.primaryColor, "--admin-accent": form.accentColor } as React.CSSProperties}><strong>{form.siteName || "站点名称"}</strong><span>这是保存后的颜色预览</span><i /></div>
        {(error || message) && <p className={error ? "form-alert" : "admin-success"} role={error ? "alert" : "status"}>{error || message}</p>}
        <div className="admin-form__actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}保存品牌配置</button></div>
      </form>
    </div>
  )
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
