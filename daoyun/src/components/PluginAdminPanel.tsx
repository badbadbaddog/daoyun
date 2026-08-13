import { Box, LoaderCircle, Play, Power, PowerOff, Trash2, Upload } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  PluginApiError,
  deletePlugin,
  installPlugin,
  invokePlugin,
  listPlugins,
  updatePluginStatus,
  type Plugin,
  type PluginCapability,
  type PluginOperation,
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
}

const emptyDraft: InstallDraft = {
  key: "",
  name: "",
  version: "1.0.0",
  description: "",
  capabilities: ["content.transform"],
}

export function PluginAdminPanel({ csrfToken, canInstall, canLifecycle, canInvoke }: PluginAdminPanelProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [draft, setDraft] = useState<InstallDraft>(emptyDraft)
  const [componentFile, setComponentFile] = useState<File | null>(null)
  const [payloads, setPayloads] = useState<Record<string, string>>({})
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [schemas, setSchemas] = useState<Record<string, PluginUiSchema>>({})

  const load = useCallback(async (signal?: AbortSignal) => {
    const loaded = await listPlugins(signal)
    setPlugins(loaded)
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
    if (componentFile.size > MAX_COMPONENT_BYTES) { setError("组件文件不能超过 8 MiB"); return }
    if (componentFile.size === 0) { setError("组件文件不能为空"); return }
    if (draft.capabilities.length === 0) { setError("至少选择一项插件能力"); return }
    setBusyId("install")
    try {
      const componentBase64 = await fileToBase64(componentFile)
      const installed = await installPlugin({
        manifest: {
          schemaVersion: 1,
          key: draft.key.trim(),
          name: draft.name.trim(),
          version: draft.version.trim(),
          description: draft.description,
          capabilities: [...draft.capabilities].sort(),
        },
        componentBase64,
      }, csrfToken)
      setPlugins((current) => [...current, installed].sort((left, right) => left.key.localeCompare(right.key)))
      setDraft(emptyDraft); setComponentFile(null); setNotice("插件已安装，启用前仍会重新校验组件")
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
                <div><dt>能力</dt><dd>{plugin.capabilities.map(capabilityLabel).join("、")}</dd></div>
                <div><dt>组件</dt><dd>{formatBytes(plugin.componentSize)} · SHA-256 {plugin.componentSha256.slice(0, 12)}…</dd></div>
                <div><dt>修订</dt><dd>{plugin.revision}</dd></div>
              </dl>
              {canLifecycle && <div className="plugin-row__actions">
                <button className="secondary-button" type="button" disabled={busyId === plugin.id} onClick={() => void changeStatus(plugin)} aria-label={`${plugin.status === "enabled" ? "停用" : "启用"}插件：${plugin.name}`}>
                  {plugin.status === "enabled" ? <PowerOff size={14} aria-hidden="true" /> : <Power size={14} aria-hidden="true" />}
                  {plugin.status === "enabled" ? "停用" : "启用"}
                </button>
                {plugin.status === "disabled" && <button className="secondary-button" type="button" disabled={busyId === plugin.id} onClick={() => void remove(plugin)} aria-label={`卸载插件：${plugin.name}`}><Trash2 size={14} aria-hidden="true" />卸载</button>}
              </div>}
              {canInvoke && plugin.status === "enabled" && <div className="plugin-runner">
                <label><span>调用输入：{plugin.name}</span><textarea rows={5} value={payloads[plugin.id] ?? DEFAULT_UI_INPUT} onChange={(event) => setPayloads((current) => ({ ...current, [plugin.id]: event.target.value }))} /></label>
                <div className="plugin-row__actions">
                  {plugin.capabilities.includes("content.transform") && <button className="secondary-button" type="button" disabled={busyId === plugin.id} onClick={() => void run(plugin, "content_transform")} aria-label={`转换内容：${plugin.name}`}><Play size={14} aria-hidden="true" />转换内容</button>}
                  {plugin.capabilities.includes("ui.panel") && <button className="secondary-button" type="button" disabled={busyId === plugin.id} onClick={() => void run(plugin, "ui_render")} aria-label={`渲染面板：${plugin.name}`}><Play size={14} aria-hidden="true" />渲染面板</button>}
                </div>
                {outputs[plugin.id] !== undefined && <pre className="plugin-output" aria-label={`插件输出：${plugin.name}`}>{outputs[plugin.id]}</pre>}
                {schemas[plugin.id] && <PluginPanelFrame schema={schemas[plugin.id]} />}
              </div>}
            </article>
          ))}
        </div>
      )}

      {canInstall && <form className="admin-form plugin-install" onSubmit={submitInstall}>
        <div className="admin-form__heading"><h3>安装插件</h3><span className="admin-badge">默认停用</span></div>
        <div className="admin-form__grid">
          <label><span>插件键</span><input required pattern="[a-z][a-z0-9_]{2,63}" value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} /></label>
          <label><span>名称</span><input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label><span>版本</span><input required pattern="(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)" value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} /></label>
        </div>
        <label><span>说明</span><textarea rows={2} maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <fieldset className="plugin-capabilities"><legend>声明能力</legend>
          {(["content.transform", "ui.panel"] as const).map((capability) => <label key={capability}><input type="checkbox" checked={draft.capabilities.includes(capability)} onChange={(event) => setDraft({ ...draft, capabilities: event.target.checked ? [...draft.capabilities, capability] : draft.capabilities.filter((item) => item !== capability) })} /><span>{capabilityLabel(capability)}</span></label>)}
        </fieldset>
        <label><span>WebAssembly Component 文件</span><input aria-label="WebAssembly Component 文件" type="file" accept=".wasm,application/wasm" required onChange={(event) => { const file = event.target.files?.[0] ?? null; setComponentFile(file); if (file && file.size > MAX_COMPONENT_BYTES) setError("组件文件不能超过 8 MiB") }} /><small>解码后最大 8 MiB，安装前校验 WIT 接口。</small></label>
        <div className="admin-form__actions"><button className="primary-button" type="submit" disabled={busyId === "install"}>{busyId === "install" ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}安装插件</button></div>
      </form>}
    </div>
  )
}

export function PluginPanelFrame({ schema }: { schema: PluginUiSchema }) {
  return <iframe className="plugin-frame" title={`插件面板：${schema.title}`} sandbox="" referrerPolicy="no-referrer" srcDoc={buildPluginFrameDocument(schema)} />
}

export function buildPluginFrameDocument(schema: PluginUiSchema): string {
  const blocks = schema.blocks.map((block) => {
    if (block.kind === "text") return `<p class="block text">${escapeHtml(block.text)}</p>`
    if (block.kind === "metric") return `<div class="block metric"><span>${escapeHtml(block.label)}</span><strong>${escapeHtml(block.value)}</strong></div>`
    return `<p class="block status ${block.tone}">${escapeHtml(block.text)}</p>`
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

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return btoa(chunks.join(""))
}

function capabilityLabel(capability: PluginCapability): string {
  return capability === "content.transform" ? "内容转换" : "静态管理面板"
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
