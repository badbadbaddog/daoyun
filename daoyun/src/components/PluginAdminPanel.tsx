import { Box, ChartNoAxesCombined, FilePlus2, Gift, LoaderCircle, Play, Search, ShieldCheck, Trash2, Upload, Vote, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  PluginApiError,
  deletePlugin,
  executePluginUiAction,
  installPlugin,
  loadOfficialEditReviewPackage,
  loadOfficialRedemptionPackage,
  loadOfficialAnalyticsPackage,
  loadOfficialPollsPackage,
  loadOfficialSupplementPackage,
  parsePluginManifest,
  invokePlugin,
  listPluginUiContributions,
  listPlugins,
  updatePluginStatus,
  type Plugin,
  type PluginBusinessCapability,
  type PluginCapability,
  type PluginDataScope,
  type PluginEventSubscription,
  type PluginManifestInput,
  type PluginOperation,
  type PluginUiContribution,
  type PluginUiSchema,
} from "../api/plugins"
import { ActionMenu } from "./ui/ActionMenu"
import { ConfirmDialog } from "./ui/ConfirmDialog"
import { AdminActionDialog } from "./admin/AdminActionDialog"
import { TopicSupplementSettingsPanel } from "./TopicSupplementAdminPanel"
import { EditReviewAdminPanel } from "./EditReviewAdminPanel"


const OFFICIAL_PLUGINS = [
  { key: "official_topic_supplements", capability: "topic.supplements", name: "帖子补充", directory: "official-topic-supplements", icon: FilePlus2, description: "作者在正文下方追加补充，保存后直接发布。" },
  { key: "official_topic_edit_review", capability: "topic.edit_review", name: "编辑审核", directory: "official-topic-edit-review", icon: ShieldCheck, description: "按版块控制主题和回复编辑审核，待审期间保留旧版本。" },
  { key: "official_points_redemption", capability: "membership.redemption", name: "积分兑换", directory: "official-points-redemption", icon: Gift, description: "配置兑换商品，让成员使用积分兑换限时权益。" },
  { key: "official_community_analytics", capability: "community.analytics", name: "运营报表", directory: "official-community-analytics", icon: ChartNoAxesCombined, description: "查看社区增长、内容参与和积分收支。" },
  { key: "official_polls", capability: "topic.polls", name: "单选投票", directory: "official-polls", icon: Vote, description: "发布主题时创建单选投票，成员一人一票。" },
] satisfies { key: string; capability: PluginCapability; name: string; directory: string; icon: typeof Box; description: string }[]

const MAX_COMPONENT_BYTES = 8 * 1024 * 1024
const DEFAULT_UI_INPUT = JSON.stringify({
  schema_version: 1,
  title: "插件面板",
  blocks: [{ kind: "text", text: "就绪" }],
}, null, 2)

interface PluginAdminPanelProps {
  csrfToken: string
  canInstall: boolean
  canLifecycle: boolean
  canInvoke: boolean
  canConfigure?: boolean
}

interface InstallDraft {
  key: string
  name: string
  version: string
  description: string
  capabilities: PluginCapability[]
  dataScopes: PluginDataScope[]
  eventSubscriptions: PluginEventSubscription[]
}

const emptyDraft: InstallDraft = {
  key: "",
  name: "",
  version: "1.0.0",
  description: "",
  capabilities: ["content.transform"],
  dataScopes: [],
  eventSubscriptions: [],
}

const PLUGIN_CAPABILITIES: PluginCapability[] = [
  "content.transform", "ui.panel", "events.subscribe", "core.query", "points.write",
  "experience.write", "entitlements.write", "notifications.write", "storage.read_write",
  "tasks.schedule", "topic.supplements", "topic.edit_review", "membership.redemption", "community.analytics", "topic.polls",
]
const PLUGIN_DATA_SCOPES: PluginDataScope[] = [
  "site.read", "actor.read", "users.read.basic", "users.read.membership", "users.targeted", "boards.read",
]
const PLUGIN_EVENTS: PluginEventSubscription[] = [
  "user.created", "topic.published", "reply.created", "points.changed",
  "experience.changed", "entitlement.changed",
]
const TARGETED_WRITE_CAPABILITIES: PluginCapability[] = [
  "points.write", "experience.write", "entitlements.write", "notifications.write",
]

export function PluginAdminPanel({ csrfToken, canInstall, canLifecycle, canInvoke, canConfigure = false }: PluginAdminPanelProps) {
  const [view, setView] = useState<"installed" | "official">("installed")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<"settings" | "permissions" | "details">("settings")
  const detailRef = useRef<HTMLElement | null>(null)
  const detailTriggerRef = useRef<HTMLElement | null>(null)

  const [editReviewPanelOpen, setEditReviewPanelOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const [toolsId, setToolsId] = useState<string | null>(null)
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [draft, setDraft] = useState<InstallDraft>(emptyDraft)
  const [installStep, setInstallStep] = useState<1 | 2 | 3 | 4>(1)
  const [componentFile, setComponentFile] = useState<File | null>(null)
  const [payloads, setPayloads] = useState<Record<string, string>>({})
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [schemas, setSchemas] = useState<Record<string, PluginUiSchema>>({})
  const [contributions, setContributions] = useState<Record<string, PluginUiContribution[]>>({})
  const [contributionErrors, setContributionErrors] = useState<Record<string, string>>({})
  const [pendingRemoval, setPendingRemoval] = useState<Plugin | null>(null)
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null)
  const selectedPlugin = plugins.find((plugin) => plugin.id === selectedId)
  const filteredPlugins = plugins.filter((plugin) => (statusFilter === "all" || plugin.status === statusFilter)
    && [plugin.name, plugin.key, plugin.description].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())))
  const enabledCount = plugins.filter((plugin) => plugin.status === "enabled").length

  function openPlugin(plugin: Plugin, trigger: HTMLElement) {
    detailTriggerRef.current = trigger
    setSelectedId(plugin.id)
    setDetailTab("settings")
    if (selectedId === plugin.id) {
      detailRef.current?.focus()
      detailRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" })
    }
  }

  function closePlugin() {
    setSelectedId(null)
    detailTriggerRef.current?.focus()
  }

  useEffect(() => {
    if (selectedId) {
      detailRef.current?.focus()
      detailRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" })
    }
  }, [selectedId])

  useEffect(() => { if (!canInvoke) setToolsId(null) }, [canInvoke])

  const load = useCallback(async (signal?: AbortSignal) => {
    const loaded = await listPlugins(signal)
    setPlugins(loaded)
    const results = await Promise.all(loaded
      .filter((plugin) => plugin.status === "enabled" && plugin.businessApiVersion && plugin.capabilities.includes("ui.panel"))
      .map(async (plugin) => {
        try {
          return { id: plugin.id, items: await listPluginUiContributions(plugin.id, signal), error: "" }
        } catch (reason) {
          return { id: plugin.id, items: [], error: apiMessage(reason, "扩展面板暂时无法加载。") }
        }
      }))
    setContributions(Object.fromEntries(results.map((result) => [result.id, result.items])))
    setContributionErrors(Object.fromEntries(results.filter((result) => result.error).map((result) => [result.id, result.error])))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    load(controller.signal)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(apiMessage(reason, "插件列表暂时无法加载。"))
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [load])

  async function submitInstall(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setError(""); setNotice("")
    if (!componentFile) { setError("请选择 WebAssembly Component 文件"); return }
    const componentError = validateComponentFile(componentFile)
    if (componentError) { setError(componentError); return }
    if (!(await hasWasmMagic(componentFile))) { setError("组件文件不是有效的 WebAssembly 二进制"); return }
    if (draft.capabilities.length === 0) { setError("至少选择一项插件能力"); return }
    if (draft.eventSubscriptions.length > 0 && !draft.capabilities.includes("events.subscribe")) { setError("声明事件订阅前需要勾选“订阅业务事件”能力"); return }
    if (draft.capabilities.some((capability) => TARGETED_WRITE_CAPABILITIES.includes(capability)) && !draft.dataScopes.includes("users.targeted")) {
      setError("写入用户数据的业务能力需要勾选“定向用户操作”范围"); return
    }
    const businessCapabilities = draft.capabilities.filter(
      (capability): capability is PluginBusinessCapability => capability !== "content.transform" && capability !== "ui.panel",
    )
    if (businessCapabilities.length === 0 && draft.dataScopes.length > 0) { setError("数据范围只能与业务能力一起申请"); return }
    if (businessCapabilities.length > 0 && draft.capabilities.includes("content.transform")) { setError("内容转换使用旧 ABI，不能与业务能力混装"); return }
    setBusyId("install")
    try {
      const componentBase64 = await fileToBase64(componentFile)
      const manifestBase = {
        schemaVersion: 1 as const,
        key: draft.key.trim(),
        name: draft.name.trim(),
        version: draft.version.trim(),
        description: draft.description,
      }
      const manifest: PluginManifestInput = businessCapabilities.length > 0
        ? {
            ...manifestBase,
            capabilities: [
              businessCapabilities[0],
              ...draft.capabilities
                .filter(
                  (capability): capability is Exclude<PluginCapability, "content.transform"> =>
                    capability !== "content.transform" && capability !== businessCapabilities[0],
                )
                .sort(),
            ],
            businessApiVersion: "0.1.0",
            dataScopes: [...draft.dataScopes].sort(),
            eventSubscriptions: [...draft.eventSubscriptions].sort(),
          }
        : {
            ...manifestBase,
            capabilities: draft.capabilities
              .filter((capability): capability is "content.transform" | "ui.panel" => capability === "content.transform" || capability === "ui.panel")
              .sort(),
          }
      const installed = await installPlugin({
        manifest,
        componentBase64,
      }, csrfToken)
      setPlugins((current) => [...current, installed].sort((left, right) => left.key.localeCompare(right.key)))
      setDraft(emptyDraft); setInstallStep(1); setComponentFile(null); setNotice("插件已安装，启用前仍会重新校验组件")
      form.reset()
      setInstallOpen(false)
      setView("installed"); setQuery(""); setStatusFilter("all")
    } catch (reason) {
      setError(apiMessage(reason, "插件安装失败，请稍后重试。"))
    } finally {
      setBusyId(null)
    }
  }

  function useManifest(manifest: PluginManifestInput) {
    setDraft({ key: manifest.key, name: manifest.name, version: manifest.version, description: manifest.description,
      capabilities: [...manifest.capabilities], dataScopes: manifest.dataScopes ?? [], eventSubscriptions: manifest.eventSubscriptions ?? [] })
  }

  async function prepareOfficial() {
    setBusyId("prepare-official"); setError(""); setNotice("")
    try {
      const input = await loadOfficialSupplementPackage()
      useManifest(input.manifest)
      const bytes = Uint8Array.from(atob(input.componentBase64), (character) => character.charCodeAt(0))
      setComponentFile(new File([bytes], "official-topic-supplements.wasm", { type: "application/wasm" }))
      setInstallStep(4); setInstallOpen(true)
    } catch (error) { setError(apiMessage(error, "官方插件文件暂时无法加载，请检查插件资源是否已发布。")) }
    finally { setBusyId(null) }
  }

  async function prepareOfficialEditReview() {
    setBusyId("official-edit-review")
    setError("")
    setNotice("")
    try {
      const { manifest, componentBase64 } = await loadOfficialEditReviewPackage()
      setDraft({
        key: manifest.key,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        capabilities: manifest.capabilities,
        dataScopes: manifest.dataScopes ?? [],
        eventSubscriptions: manifest.eventSubscriptions ?? [],
      })
      const bytes = Uint8Array.from(atob(componentBase64), (value) => value.charCodeAt(0))
      setComponentFile(new File([bytes], "official-topic-edit-review.wasm", { type: "application/wasm" }))
      setInstallStep(1)
      setInstallOpen(true)
    } catch (reason) {
      setError(apiMessage(reason, "编辑审核插件资源暂时不可用。"))
    } finally {
      setBusyId(null)
    }
  }

  async function prepareOfficialRedemption() {
    setBusyId("official-redemption")
    setError("")
    setNotice("")
    try {
      const { manifest, componentBase64 } = await loadOfficialRedemptionPackage()
      setDraft({
        key: manifest.key,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        capabilities: manifest.capabilities,
        dataScopes: manifest.dataScopes ?? [],
        eventSubscriptions: manifest.eventSubscriptions ?? [],
      })
      const bytes = Uint8Array.from(atob(componentBase64), (value) => value.charCodeAt(0))
      setComponentFile(new File([bytes], "official-points-redemption.wasm", { type: "application/wasm" }))
      setInstallStep(1)
      setInstallOpen(true)
    } catch (reason) {
      setError(apiMessage(reason, "积分兑换插件资源暂时不可用。"))
    } finally {
      setBusyId(null)
    }
  }

  async function prepareOfficialAnalytics() {
    setBusyId("official-analytics")
    setError("")
    setNotice("")
    try {
      const { manifest, componentBase64 } = await loadOfficialAnalyticsPackage()
      setDraft({
        key: manifest.key,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        capabilities: manifest.capabilities,
        dataScopes: manifest.dataScopes ?? [],
        eventSubscriptions: manifest.eventSubscriptions ?? [],
      })
      const bytes = Uint8Array.from(atob(componentBase64), (value) => value.charCodeAt(0))
      setComponentFile(new File([bytes], "official-community-analytics.wasm", { type: "application/wasm" }))
      setInstallStep(1)
      setInstallOpen(true)
    } catch (reason) {
      setError(apiMessage(reason, "运营报表插件资源暂时不可用。"))
    } finally {
      setBusyId(null)
    }
  }

  async function prepareOfficialPolls() {
    setBusyId("official-polls")
    setError("")
    setNotice("")
    try {
      const { manifest, componentBase64 } = await loadOfficialPollsPackage()
      setDraft({
        key: manifest.key,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        capabilities: manifest.capabilities,
        dataScopes: manifest.dataScopes ?? [],
        eventSubscriptions: manifest.eventSubscriptions ?? [],
      })
      const bytes = Uint8Array.from(atob(componentBase64), (value) => value.charCodeAt(0))
      setComponentFile(new File([bytes], "official-polls.wasm", { type: "application/wasm" }))
      setInstallStep(1)
      setInstallOpen(true)
    } catch (reason) {
      setError(apiMessage(reason, "单选投票插件资源暂时不可用。"))
    } finally {
      setBusyId(null)
    }
  }

  async function importManifest(file: File | undefined) {
    if (!file) return
    if (file.size > 16 * 1024) { setError("插件清单不能超过 16 KiB"); return }
    try {
      useManifest(parsePluginManifest(JSON.parse(new TextDecoder().decode(await readFileBytes(file)))))
      setError(""); setInstallStep(2)
    } catch (error) { setError(apiMessage(error, "插件清单不是有效的 JSON 文件")) }
  }

  async function changeStatus(plugin: Plugin) {
    const status = plugin.status === "enabled" ? "disabled" : "enabled"
    setBusyId(plugin.id); setError(""); setNotice("")
    try {
      const updated = await updatePluginStatus(plugin.id, status, plugin.revision, csrfToken)
      setPlugins((current) => current.map((item) => item.id === updated.id ? updated : item))
      if (status === "disabled") {
        setToolsId((current) => current === plugin.id ? null : current)
        setSchemas((current) => omitKey(current, plugin.id))
        setOutputs((current) => omitKey(current, plugin.id))
        setContributions((current) => omitKey(current, plugin.id))
        setContributionErrors((current) => omitKey(current, plugin.id))
      } else if (updated.businessApiVersion && updated.capabilities.includes("ui.panel")) {
        try {
          const items = await listPluginUiContributions(updated.id)
          setContributions((current) => ({ ...current, [updated.id]: items }))
          setContributionErrors((current) => omitKey(current, updated.id))
        } catch (reason) {
          setContributionErrors((current) => ({ ...current, [updated.id]: apiMessage(reason, "扩展面板暂时无法加载。") }))
        }
      }
      setNotice(status === "enabled" ? "插件已启用" : "插件已停用")
    } catch (reason) {
      if (reason instanceof PluginApiError && reason.status === 409) {
        try { await load() } catch { /* 原始冲突信息优先。 */ }
        setError("插件状态已变化，列表已刷新")
      } else {
        setError(apiMessage(reason, "插件状态更新失败，请稍后重试。"))
      }
    } finally {
      setBusyId(null)
    }
  }

  async function remove(plugin: Plugin) {
    setBusyId(plugin.id); setError(""); setNotice("")
    try {
      await deletePlugin(plugin.id, csrfToken)
      setPlugins((current) => current.filter((item) => item.id !== plugin.id))
      setPendingRemoval(null)
      setNotice("插件已卸载")
    } catch (reason) {
      setPendingRemoval(null)
      setError(apiMessage(reason, "插件卸载失败，请稍后重试。"))
    } finally {
      setBusyId(null)
    }
  }

  async function run(plugin: Plugin, operation: PluginOperation) {
    setBusyId(plugin.id); setError(""); setNotice("")
    try {
      const invocation = await invokePlugin(
        plugin.id,
        operation,
        payloads[plugin.id] ?? DEFAULT_UI_INPUT,
        csrfToken,
      )
      if (invocation.uiSchema) {
        setSchemas((current) => ({ ...current, [plugin.id]: invocation.uiSchema! }))
        setOutputs((current) => omitKey(current, plugin.id))
      } else {
        setOutputs((current) => ({ ...current, [plugin.id]: invocation.payload }))
        setSchemas((current) => omitKey(current, plugin.id))
      }
      setNotice("插件调用完成")
    } catch (reason) {
      setError(apiMessage(reason, "插件调用失败，请稍后重试。"))
    } finally {
      setBusyId(null)
    }
  }

  async function runUiAction(plugin: Plugin, actionKey: string) {
    setBusyId(plugin.id); setError(""); setNotice("")
    try {
      const result = await executePluginUiAction(
        plugin.id,
        actionKey,
        crypto.randomUUID(),
        csrfToken,
      )
      setNotice(`插件动作已执行（${result.executedCommands} 条命令）`)
      const items = await listPluginUiContributions(plugin.id)
      setContributions((current) => ({ ...current, [plugin.id]: items }))
      setContributionErrors((current) => omitKey(current, plugin.id))
    } catch (reason) {
      setError(apiMessage(reason, "插件动作执行失败，请稍后重试。"))
    } finally {
      setBusyId(null)
    }
  }


  return (
    <div className="admin-panel plugin-admin">
      <div className="plugin-admin__heading">
        <div><h1>插件管理</h1><p>扩展社区能力，集中管理插件与设置。</p></div>
        {canInstall && <button className="primary-button" type="button" onClick={() => setInstallOpen(true)}><Upload size={15} aria-hidden="true" />安装插件</button>}
      </div>
      {error && !installOpen && !toolsId && <p className="form-alert" role="alert">{error}</p>}
      {notice && <p className="admin-success" role="status">{notice}</p>}
      <div className="plugin-admin__tabs" role="tablist" aria-label="插件分类" onKeyDown={navigatePluginTabs}>
        <button id="plugins-installed-tab" role="tab" tabIndex={view === "installed" ? 0 : -1} aria-selected={view === "installed"} aria-controls="plugins-installed" type="button" onClick={() => setView("installed")}>已安装 <span>{plugins.length}</span></button>
        <button id="plugins-official-tab" role="tab" tabIndex={view === "official" ? 0 : -1} aria-selected={view === "official"} aria-controls="plugins-official" type="button" onClick={() => setView("official")}>官方插件</button>
      </div>
      {loading ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" /><span>正在读取插件列表</span></div> : view === "official" ? (
        <div className="plugin-catalog" role="tabpanel" id="plugins-official" aria-labelledby="plugins-official-tab">
          <p className="plugin-admin__hint">选择需要的社区功能，安装后可在“已安装”中启用和配置。</p>
          {OFFICIAL_PLUGINS.map((item, index) => {
            const installed = plugins.find((plugin) => plugin.capabilities.includes(item.capability))
            const Icon = item.icon
            return <article className="plugin-catalog__item" key={item.key} aria-label={"官方插件：" + item.name}>
              <span className="plugin-admin__icon"><Icon size={22} aria-hidden="true" /></span>
              <div className="plugin-catalog__info"><h3>{item.name} <span className="admin-badge">官方插件</span></h3><p>{item.description}</p>
                <details className="plugin-catalog__downloads"><summary>下载插件包</summary><a href={"/plugins/" + item.directory + "/plugin.wasm"} download={item.directory + ".wasm"}>下载插件文件</a><a href={"/plugins/" + item.directory + "/plugin.json"} download="plugin.json">下载插件清单</a></details>
              </div>
              {installed ? <span className="plugin-catalog__installed">已安装</span> : canInstall && <button className="secondary-button" type="button" disabled={busyId !== null} onClick={() => void [prepareOfficial, prepareOfficialEditReview, prepareOfficialRedemption, prepareOfficialAnalytics, prepareOfficialPolls][index]()}>{"安装" + item.name}</button>}
            </article>
          })}
        </div>
      ) : (
        <div role="tabpanel" id="plugins-installed" aria-labelledby="plugins-installed-tab">
          <div className="plugin-admin__toolbar">
            <div className="plugin-admin__counts"><span>全部 <strong>{plugins.length}</strong></span><span>已启用 <strong>{enabledCount}</strong></span><span>已停用 <strong>{plugins.length - enabledCount}</strong></span></div>
            <label className="plugin-admin__search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索插件" placeholder="搜索插件名称或关键词" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <select aria-label="插件状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select>
          </div>
          <div className={"plugin-admin__workspace" + (selectedPlugin ? " plugin-admin__workspace--selected" : "")}>
            <div className="plugin-admin__list">
              {plugins.length === 0 ? <div className="admin-empty" role="status"><Box size={24} aria-hidden="true" /><span>尚未安装插件</span><button className="secondary-button" type="button" onClick={() => setView("official")}>浏览官方插件</button></div> : filteredPlugins.length === 0 ? <div className="admin-empty" role="status"><Search size={24} aria-hidden="true" /><span>没有符合条件的插件</span><button className="secondary-button" type="button" onClick={() => { setQuery(""); setStatusFilter("all") }}>清除筛选</button></div> : <>
                <div className="plugin-admin__columns" aria-hidden="true"><span>插件</span><span>状态</span><span>操作</span></div>
                {filteredPlugins.map((plugin) => {
                  const official = OFFICIAL_PLUGINS.find((item) => item.key === plugin.key)
                  const Icon = official?.icon ?? Box
                  const configurable = canConfigure && plugin.capabilities.some((item) => item === "topic.supplements" || item === "topic.edit_review")
                  return <article className={"plugin-entry" + (selectedId === plugin.id ? " plugin-entry--selected" : "")} key={plugin.id} aria-label={"插件：" + plugin.name}>
                    <div className="plugin-entry__info"><span className="plugin-admin__icon"><Icon size={22} aria-hidden="true" /></span><div><h3>{plugin.name}</h3><p>{plugin.description || "暂无插件说明"}</p><small>{official ? "官方插件" : plugin.key} · {plugin.version}</small></div></div>
                    <div className="plugin-entry__status">{canLifecycle && <button className="plugin-switch" type="button" role="switch" aria-checked={plugin.status === "enabled"} aria-label={(plugin.status === "enabled" ? "停用" : "启用") + "插件：" + plugin.name} title={plugin.status === "enabled" ? "停用插件" : "启用插件"} disabled={busyId !== null} onClick={() => void changeStatus(plugin)}><span /></button>}<span>{plugin.status === "enabled" ? "已启用" : "已停用"}</span></div>
                    <div className="plugin-entry__actions"><button className="plugin-entry__open" type="button" aria-label={"查看插件：" + plugin.name} aria-expanded={selectedId === plugin.id} aria-controls="plugin-detail" onClick={(event) => openPlugin(plugin, event.currentTarget)}>{configurable ? "设置" : "详情"}</button>
                      {canLifecycle && plugin.status === "disabled" && <ActionMenu label={"更多操作：" + plugin.name} disabled={busyId !== null} items={[{ label: "卸载插件：" + plugin.name, danger: true, icon: <Trash2 size={14} aria-hidden="true" />, onSelect: () => { confirmationReturnFocusRef.current = document.activeElement as HTMLElement; setPendingRemoval(plugin) } }]} />}
                    </div>
                  </article>
                })}
              </>}
            </div>
            {selectedPlugin && [selectedPlugin].map((plugin) => <section ref={detailRef} tabIndex={-1} id="plugin-detail" className="plugin-detail" key={plugin.id} aria-label={"插件：" + plugin.name}>
              <header className="plugin-detail__heading"><div><h3>{plugin.name}</h3><p>{"v" + plugin.version} · {plugin.status === "enabled" ? "已启用" : "已停用"}</p></div><button className="icon-button" type="button" title="关闭" aria-label="关闭插件面板" onClick={closePlugin}><X size={18} aria-hidden="true" /></button></header>
              <div className="plugin-admin__tabs" role="tablist" aria-label="插件信息" onKeyDown={navigatePluginTabs}>
                {([["settings", "设置"], ["permissions", "权限"], ["details", "详情"]] as const).map(([tab, label]) => <button key={tab} id={"plugin-" + tab + "-tab"} type="button" role="tab" tabIndex={detailTab === tab ? 0 : -1} aria-selected={detailTab === tab} aria-controls="plugin-detail-content" onClick={() => setDetailTab(tab)}>{label}</button>)}
              </div>
              <div className="plugin-detail__body" id="plugin-detail-content" role="tabpanel" aria-labelledby={"plugin-" + detailTab + "-tab"}>
                <div hidden={detailTab !== "settings"}>
                  {plugin.capabilities.includes("topic.supplements") ? canConfigure ? <TopicSupplementSettingsPanel csrfToken={csrfToken} /> : <p className="plugin-admin__hint">你没有修改全站补充设置的权限。</p> : plugin.capabilities.includes("topic.edit_review") ? <><p className="plugin-admin__hint">按版块设置主题与回复的编辑审核策略，并处理待审内容。</p>{canConfigure && <button className="secondary-button" type="button" onClick={() => setEditReviewPanelOpen(true)}>编辑审核管理</button>}</> : <p className="plugin-admin__hint">{plugin.capabilities.includes("membership.redemption") ? "在后台「会员经济 → 积分兑换」中管理兑换商品。" : plugin.capabilities.includes("community.analytics") ? "在后台「运营数据」中查看社区报表。" : plugin.capabilities.includes("topic.polls") ? "启用后，可在发布主题时创建单选投票，无需额外配置。" : "此插件没有额外的全站设置。"}</p>}
                  {plugin.status === "disabled" && <p className="plugin-detail__note">插件已停用。启用后，新操作将使用当前配置。</p>}
                                {contributionErrors[plugin.id] && <p className="plugin-contribution-error" role="status"><strong>贡献加载故障</strong><span>{contributionErrors[plugin.id]}</span></p>}
              {(contributions[plugin.id] ?? []).filter((item) => item.slot === "admin_plugin").map((item, index) => (
                <section className="plugin-contribution" key={`${plugin.id}-${index}`} aria-label={`插件扩展：${item.schema.title}`}>
                  <PluginPanelFrame schema={item.schema} />
                  {canInvoke && item.schema.blocks.filter((block) => block.kind === "action").length > 0 && (
                    <div className="plugin-row__actions">
                      {item.schema.blocks.filter((block) => block.kind === "action").map((block) => (
                        <button
                          className="secondary-button"
                          type="button"
                          key={block.action_key}
                          disabled={busyId === plugin.id}
                          onClick={() => void runUiAction(plugin, block.action_key)}
                        >
                          <Play size={14} aria-hidden="true" />
                          {block.label}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              ))}
                  {canInvoke && plugin.status === "enabled" && <details className="plugin-detail__advanced"><summary>高级与开发者工具</summary><p>仅用于授权调试插件的输入与输出。</p><button className="secondary-button" type="button" onClick={() => { setError(""); setToolsId(plugin.id) }}>开发者工具</button></details>}
                </div>
                {detailTab === "permissions" && <dl className="plugin-detail__metadata">
                  <div><dt>风险等级</dt><dd><strong>{riskLabel(pluginRisk(plugin.capabilities, plugin.dataScopes)) + "风险"}</strong></dd></div>
                  <div><dt>能力</dt><dd>{plugin.capabilities.map(capabilityLabel).join("、")}</dd></div>
                  <div><dt>数据范围</dt><dd>{plugin.dataScopes.length ? plugin.dataScopes.map(dataScopeLabel).join("、") : "无"}</dd></div>
                  <div><dt>事件订阅</dt><dd>{plugin.eventSubscriptions.length ? plugin.eventSubscriptions.map(eventLabel).join("、") : "无"}</dd></div>
                </dl>}
                {detailTab === "details" && <dl className="plugin-detail__metadata">
                  <div><dt>插件键</dt><dd>{plugin.key}</dd></div><div><dt>运行状态</dt><dd>{plugin.status === "enabled" ? "正在运行" : "已停用"}</dd></div>
                  <div><dt>WIT / ABI</dt><dd>{plugin.businessApiVersion ? "业务 ABI " + plugin.businessApiVersion : "旧版 content-transform ABI"}</dd></div>
                  <div><dt>组件</dt><dd>Wasm Component · {formatBytes(plugin.componentSize)} · SHA-256 {plugin.componentSha256.slice(0, 12)}…</dd></div>
                  <div><dt>Revision</dt><dd>{plugin.revision}</dd></div>
                  <div><dt>隔离方式</dt><dd>组件不获得 WASI、网络、文件系统或环境变量；每次调用使用独立的资源配额。</dd></div>
                </dl>}
              </div>
            </section>)}
          </div>
        </div>
      )}
      {canInvoke && plugins.filter((plugin) => plugin.id === toolsId && plugin.status === "enabled").map((plugin) => <div key={plugin.id}>                {toolsId === plugin.id && <AdminActionDialog title={`开发者工具：${plugin.name}`} onClose={() => setToolsId(null)} busy={busyId === plugin.id}>
                {error && <p className="form-alert" role="alert">{error}</p>}
                <div className="plugin-runner">
                <div aria-label={`开发者工具：${plugin.name}`}>
                  <p>仅用于授权调试。原始 JSON 输入不会改变 manifest、WIT 或 capability 审批。</p>
                  <label><span>调用输入：{plugin.name}</span><textarea rows={5} value={payloads[plugin.id] ?? DEFAULT_UI_INPUT} onChange={(event) => setPayloads((current) => ({ ...current, [plugin.id]: event.target.value }))} /></label>
                  <div className="plugin-row__actions">
                    {!plugin.businessApiVersion && plugin.capabilities.includes("content.transform") && <button className="secondary-button" type="button" disabled={busyId === plugin.id} onClick={() => void run(plugin, "content_transform")} aria-label={`转换内容：${plugin.name}`}><Play size={14} aria-hidden="true" />转换内容</button>}
                    {!plugin.businessApiVersion && plugin.capabilities.includes("ui.panel") && <button className="secondary-button" type="button" disabled={busyId === plugin.id} onClick={() => void run(plugin, "ui_render")} aria-label={`渲染面板：${plugin.name}`}><Play size={14} aria-hidden="true" />渲染面板</button>}
                  </div>
                  {outputs[plugin.id] !== undefined && <pre className="plugin-output" aria-label={`插件输出：${plugin.name}`}>{outputs[plugin.id]}</pre>}
                  {schemas[plugin.id] && <PluginPanelFrame schema={schemas[plugin.id]} />}
                </div>
                </div></AdminActionDialog>}</div>)}
      {editReviewPanelOpen && <AdminActionDialog title="编辑审核管理" onClose={() => setEditReviewPanelOpen(false)}><EditReviewAdminPanel csrfToken={csrfToken} /></AdminActionDialog>}

      {pendingRemoval && <ConfirmDialog
        title={`卸载插件“${pendingRemoval.name}”`}
        confirmLabel="确认卸载插件"
        busy={busyId === pendingRemoval.id}
        returnFocus={confirmationReturnFocusRef.current}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => void remove(pendingRemoval)}
      >
        <p>卸载后该插件将从当前站点移除。已停用插件不会继续执行任何扩展逻辑。</p>
        <p>Manifest、WIT / ABI 与 capability 安全边界不会因此放宽。</p>
      </ConfirmDialog>}

      {canInstall && installOpen && <AdminActionDialog title="安装插件" onClose={() => setInstallOpen(false)} busy={busyId === "install"}>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <form className="admin-form plugin-install" onSubmit={submitInstall}>
        <div className="admin-form__heading"><span className="admin-badge">安装后默认停用</span></div>
        <p className="plugin-install__step">{installStepLabel(installStep)}</p>
        {installStep === 1 && <>
          <label><span>导入插件清单（可选）</span><input type="file" accept=".json,application/json" onChange={(event) => void importManifest(event.target.files?.[0])} /><small>选择插件附带的 plugin.json，自动填写名称、版本和申请的能力。</small></label>
          <div className="admin-form__grid">
            <label><span>插件键</span><input aria-label="插件键" required pattern="[a-z][a-z0-9_]{2,63}" value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} /></label>
            <label><span>名称</span><input aria-label="名称" required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label><span>版本</span><input aria-label="版本" required pattern="(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)" value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} /></label>
          </div>
          <label><span>说明</span><textarea rows={2} maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <div className="admin-form__actions"><button className="primary-button" type="button" onClick={() => setInstallStep(2)} disabled={!draft.key.trim() || !draft.name.trim()}>下一步：能力审批</button></div>
        </>}
        {installStep === 2 && <>
          <fieldset className="plugin-capabilities"><legend>声明能力</legend>
            {PLUGIN_CAPABILITIES.map((capability) => <label key={capability}><input type="checkbox" checked={draft.capabilities.includes(capability)} onChange={(event) => setDraft({ ...draft, capabilities: event.target.checked ? [...draft.capabilities, capability] : draft.capabilities.filter((item) => item !== capability) })} /><span>{capabilityLabel(capability)}</span></label>)}
          </fieldset>
          <fieldset className="plugin-capabilities"><legend>数据范围（安装审批）</legend>
            {PLUGIN_DATA_SCOPES.map((scope) => <label key={scope}><input type="checkbox" checked={draft.dataScopes.includes(scope)} onChange={(event) => setDraft({ ...draft, dataScopes: event.target.checked ? [...draft.dataScopes, scope] : draft.dataScopes.filter((item) => item !== scope) })} /><span>{dataScopeLabel(scope)}</span></label>)}
          </fieldset>
          <fieldset className="plugin-capabilities"><legend>事件订阅（安装审批）</legend>
            {PLUGIN_EVENTS.map((eventName) => <label key={eventName}><input type="checkbox" checked={draft.eventSubscriptions.includes(eventName)} onChange={(event) => setDraft({ ...draft, eventSubscriptions: event.target.checked ? [...draft.eventSubscriptions, eventName] : draft.eventSubscriptions.filter((item) => item !== eventName) })} /><span>{eventLabel(eventName)}</span></label>)}
          </fieldset>
          <p><strong>{`${riskLabel(pluginRisk(draft.capabilities, draft.dataScopes))}风险`}</strong> · 安装只批准 manifest 中声明的能力与数据范围。</p>
          <div className="admin-form__actions"><button className="secondary-button" type="button" onClick={() => setInstallStep(1)}>上一步</button><button className="primary-button" type="button" onClick={() => setInstallStep(3)}>下一步：组件文件</button></div>
        </>}
        {installStep === 3 && <>
          <label><span>WebAssembly Component 文件</span><input aria-label="WebAssembly Component 文件" type="file" accept=".wasm,application/wasm" required onChange={(event) => { const file = event.target.files?.[0] ?? null; setComponentFile(file); const nextError = file ? validateComponentFile(file) : ""; setError(nextError) }} /><small>仅接受 .wasm WebAssembly Component，最大 8 MiB；安装与启用时服务端继续执行 WIT/ABI 校验。</small></label>
          {componentFile && !validateComponentFile(componentFile) && <p role="status"><strong>文件预检通过</strong> · {componentFile.name} · {formatBytes(componentFile.size)}</p>}
          <div className="admin-form__actions"><button className="secondary-button" type="button" onClick={() => setInstallStep(2)}>上一步</button><button className="primary-button" type="button" onClick={() => { if (!componentFile) { setError("请选择 WebAssembly Component 文件"); return } const nextError = validateComponentFile(componentFile); if (nextError) { setError(nextError); return } setError(""); setInstallStep(4) }}>下一步：确认安装</button></div>
        </>}
        {installStep === 4 && <>
          <section className="plugin-install__review" aria-label="Manifest 摘要">
            <h4>Manifest 摘要</h4>
            <p><strong>{draft.key} · {draft.version}</strong></p>
            <p>能力：{draft.capabilities.map(capabilityLabel).join("、")}</p>
            <p>数据范围：{draft.dataScopes.length > 0 ? draft.dataScopes.map(dataScopeLabel).join("、") : "无"}</p>
            <p>事件订阅：{draft.eventSubscriptions.length > 0 ? draft.eventSubscriptions.map(eventLabel).join("、") : "无"}</p>
            <p><strong>{`${riskLabel(pluginRisk(draft.capabilities, draft.dataScopes))}风险`}</strong> · 安装后默认停用。</p>
          </section>
          <section className="plugin-install__review" aria-label="组件文件摘要">
            <h4>组件文件摘要</h4>
            <p>{componentFile?.name} · {componentFile ? formatBytes(componentFile.size) : "未选择"}</p>
            <p>服务端将在安装与启用时继续执行 manifest、Wasm Component、WIT / ABI 和 capability 校验。</p>
          </section>
          <div className="admin-form__actions"><button className="secondary-button" type="button" onClick={() => setInstallStep(3)}>上一步</button><button className="primary-button" type="submit" disabled={busyId === "install"}>{busyId === "install" ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}确认安装</button></div>
        </>}
      </form></AdminActionDialog>}
    </div>
  )
}


function navigatePluginTabs(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const index = tabs.indexOf(event.target as HTMLButtonElement)
  if (index < 0) return
  event.preventDefault()
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
  tabs[next]?.focus()
  tabs[next]?.click()
}

export function PluginPanelFrame({ schema }: { schema: PluginUiSchema }) {
  return <iframe className="plugin-frame" title={`插件面板：${schema.title}`} sandbox="" referrerPolicy="no-referrer" srcDoc={buildPluginFrameDocument(schema)} />
}

export function buildPluginFrameDocument(schema: PluginUiSchema): string {
  const blocks = schema.blocks.filter((block) => block.kind !== "action").map((block) => {
    if (block.kind === "text") return `<p class="block text">${escapeHtml(block.text)}</p>`
    if (block.kind === "metric") return `<div class="block metric"><span>${escapeHtml(block.label)}</span><strong>${escapeHtml(block.value)}</strong></div>`
    if (block.kind === "status") return `<p class="block status ${block.tone}">${escapeHtml(block.text)}</p>`
    return ""
  }).join("")
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:12px;font:14px/1.5 system-ui;color:CanvasText;background:Canvas}h1{margin:0 0 10px;font-size:17px}.block{margin:8px 0;padding:8px;border:1px solid GrayText;border-radius:6px;overflow-wrap:anywhere}.metric{display:flex;justify-content:space-between;gap:12px}.status{border-inline-start-width:4px}.success{font-weight:600}.warning{font-weight:600}.danger{font-weight:700}</style></head><body><h1>${escapeHtml(schema.title)}</h1>${blocks}</body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character)
}

async function readFileBytes(file: Blob): Promise<Uint8Array> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("读取组件文件失败"))
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result)
      else reject(new Error("读取组件文件失败"))
    }
    reader.readAsArrayBuffer(file)
  })
  return new Uint8Array(buffer)
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = await readFileBytes(file)
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return btoa(chunks.join(""))
}

function validateComponentFile(file: File): string {
  if (file.size > MAX_COMPONENT_BYTES) return "组件文件不能超过 8 MiB"
  if (file.size === 0) return "组件文件不能为空"
  const nameIsWasm = file.name.toLowerCase().endsWith(".wasm")
  const mimeIsWasm = file.type === "" || file.type === "application/wasm" || file.type === "application/octet-stream"
  return nameIsWasm && mimeIsWasm ? "" : "请选择 .wasm WebAssembly Component 文件"
}

async function hasWasmMagic(file: File): Promise<boolean> {
  const bytes = await readFileBytes(file.slice(0, 4))
  return bytes.length === 4 && bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d
}

type PluginRisk = "low" | "medium" | "high" | "critical"

function pluginRisk(capabilities: PluginCapability[], dataScopes: PluginDataScope[]): PluginRisk {
  if (capabilities.includes("notifications.write")) return "critical"
  if (capabilities.some((capability) => capability === "points.write" || capability === "experience.write" || capability === "entitlements.write" || capability === "membership.redemption")) return "high"
  if (capabilities.includes("storage.read_write") || capabilities.includes("tasks.schedule") || dataScopes.includes("users.read.membership") || dataScopes.includes("users.targeted")) return "high"
  if (capabilities.includes("events.subscribe") || capabilities.includes("topic.supplements") || capabilities.includes("topic.edit_review")) return "medium"
  return "low"
}

function riskLabel(risk: PluginRisk): string {
  return ({ low: "低", medium: "中", high: "高", critical: "严重" } satisfies Record<PluginRisk, string>)[risk]
}

function installStepLabel(step: 1 | 2 | 3 | 4): string {
  return ({ 1: "步骤 1 / 4 · 基本信息", 2: "步骤 2 / 4 · 能力审批", 3: "步骤 3 / 4 · 组件文件", 4: "步骤 4 / 4 · 确认安装" } as const)[step]
}

function capabilityLabel(capability: PluginCapability): string {
  return ({
    "content.transform": "内容转换",
    "ui.panel": "静态管理面板",
    "events.subscribe": "订阅业务事件",
    "core.query": "读取核心数据",
    "points.write": "写入积分",
    "experience.write": "写入经验",
    "entitlements.write": "写入标准权益",
    "notifications.write": "发送通知",
    "storage.read_write": "插件专属存储",
    "tasks.schedule": "计划后台任务",
    "topic.supplements": "帖子补充（作者追加与限额）",
    "topic.edit_review": "编辑审核（主题与回复）",
    "membership.redemption": "积分兑换（原子扣分与权益发放）",
    "community.analytics": "社区运营数据（聚合报表）",
    "topic.polls": "主题单选投票",
  } satisfies Record<PluginCapability, string>)[capability]
}

function dataScopeLabel(scope: PluginDataScope): string {
  return ({
    "site.read": "站点只读",
    "actor.read": "当前操作者",
    "users.read.basic": "用户基础资料",
    "users.read.membership": "用户积分与经验账户",
    "users.targeted": "定向用户操作",
    "boards.read": "板块只读",
  } satisfies Record<PluginDataScope, string>)[scope]
}

function eventLabel(eventName: PluginEventSubscription): string {
  return ({
    "user.created": "用户创建",
    "topic.published": "主题发布",
    "reply.created": "回复创建",
    "points.changed": "积分变化",
    "experience.changed": "经验变化",
    "entitlement.changed": "权益变化",
  } satisfies Record<PluginEventSubscription, string>)[eventName]
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function apiMessage(reason: unknown, fallback: string): string {
  return reason instanceof PluginApiError ? reason.message : fallback
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}
