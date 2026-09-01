import { Box, LoaderCircle, Play, Power, PowerOff, Trash2, Upload } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  PluginApiError,
  deletePlugin,
  executePluginUiAction,
  installPlugin,
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
  "tasks.schedule",
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

export function PluginAdminPanel({ csrfToken, canInstall, canLifecycle, canInvoke }: PluginAdminPanelProps) {
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
    } catch (reason) {
      setError(apiMessage(reason, "插件安装失败，请稍后重试。"))
    } finally {
      setBusyId(null)
    }
  }

  async function changeStatus(plugin: Plugin) {
    const status = plugin.status === "enabled" ? "disabled" : "enabled"
    setBusyId(plugin.id); setError(""); setNotice("")
    try {
      const updated = await updatePluginStatus(plugin.id, status, plugin.revision, csrfToken)
      setPlugins((current) => current.map((item) => item.id === updated.id ? updated : item))
      if (status === "disabled") {
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
    if (!window.confirm(`确定卸载插件“${plugin.name}”吗？`)) return
    setBusyId(plugin.id); setError(""); setNotice("")
    try {
      await deletePlugin(plugin.id, csrfToken)
      setPlugins((current) => current.filter((item) => item.id !== plugin.id))
      setNotice("插件已卸载")
    } catch (reason) {
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
      <div className="admin-panel__heading">
        <div><p>受限扩展</p><h2>插件平台</h2></div>
        <span className="admin-badge">{plugins.length} 个插件</span>
      </div>
      <p className="plugin-admin__intro">组件不获得 WASI、网络、文件系统或环境变量；每次调用使用独立的资源配额。</p>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {notice && <p className="admin-success" role="status">{notice}</p>}

      {loading ? (
        <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" /><span>正在读取插件列表</span></div>
      ) : plugins.length === 0 ? (
        <div className="admin-empty" role="status"><Box size={22} aria-hidden="true" /><span>尚未安装插件</span></div>
      ) : (
        <div className="plugin-list">
          {plugins.map((plugin) => (
            <article className="plugin-row" key={plugin.id}>
              <header>
                <div><strong>{plugin.name}</strong><span>{plugin.key} · {plugin.version}</span></div>
                <span className={`plugin-status plugin-status--${plugin.status}`}>{plugin.status === "enabled" ? "已启用" : "已停用"}</span>
              </header>
              {plugin.description && <p>{plugin.description}</p>}
              <dl>
                <div><dt>运行状态</dt><dd>{plugin.status === "enabled" ? "正在运行" : "已停用"}</dd></div>
                <div><dt>风险等级</dt><dd><strong>{`${riskLabel(pluginRisk(plugin.capabilities, plugin.dataScopes))}风险`}</strong></dd></div>
                <div><dt>能力</dt><dd>{plugin.capabilities.map(capabilityLabel).join("、")}</dd></div>
                <div><dt>WIT / ABI</dt><dd>{plugin.businessApiVersion ? `业务 ABI ${plugin.businessApiVersion}` : "旧版 content-transform ABI"}</dd></div>
                {plugin.dataScopes.length > 0 && <div><dt>数据范围</dt><dd>{plugin.dataScopes.map(dataScopeLabel).join("、")}</dd></div>}
                {plugin.eventSubscriptions.length > 0 && <div><dt>事件订阅</dt><dd>{plugin.eventSubscriptions.map(eventLabel).join("、")}</dd></div>}
                <div><dt>组件</dt><dd>Wasm Component · {formatBytes(plugin.componentSize)} · SHA-256 {plugin.componentSha256.slice(0, 12)}…</dd></div>
                <div><dt>Revision</dt><dd>{plugin.revision}</dd></div>
              </dl>
              {canLifecycle && <div className="plugin-row__actions">
                <button className="secondary-button" type="button" disabled={busyId === plugin.id} onClick={() => void changeStatus(plugin)} aria-label={`${plugin.status === "enabled" ? "停用" : "启用"}插件：${plugin.name}`}>
                  {plugin.status === "enabled" ? <PowerOff size={14} aria-hidden="true" /> : <Power size={14} aria-hidden="true" />}
                  {plugin.status === "enabled" ? "停用" : "启用"}
                </button>
                {plugin.status === "disabled" && <button className="secondary-button" type="button" disabled={busyId === plugin.id} onClick={() => void remove(plugin)} aria-label={`卸载插件：${plugin.name}`}><Trash2 size={14} aria-hidden="true" />卸载</button>}
              </div>}
              {canInvoke && plugin.status === "enabled" && <details className="plugin-runner">
                <summary>开发者工具</summary>
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
              </details>}
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
            </article>
          ))}
        </div>
      )}

      {canInstall && <form className="admin-form plugin-install" onSubmit={submitInstall}>
        <div className="admin-form__heading"><h3>安装插件</h3><span className="admin-badge">默认停用</span></div>
        <p className="plugin-install__step">{installStepLabel(installStep)}</p>
        {installStep === 1 && <>
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
      </form>}
    </div>
  )
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
  if (capabilities.some((capability) => capability === "points.write" || capability === "experience.write" || capability === "entitlements.write")) return "high"
  if (capabilities.includes("storage.read_write") || capabilities.includes("tasks.schedule") || dataScopes.includes("users.read.membership") || dataScopes.includes("users.targeted")) return "high"
  if (capabilities.includes("events.subscribe")) return "medium"
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
