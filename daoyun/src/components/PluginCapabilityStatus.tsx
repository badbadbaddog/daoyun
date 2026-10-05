import { useEffect, useState } from "react"
import { listPluginCapabilities, type PluginCapabilitiesSnapshot } from "../api/plugins"

interface PluginCapabilityStatusProps { csrfToken: string; revisionKey: string }
const labels = { available: "可用", disabled: "已停用", not_configured: "未配置", runtime_disabled: "运行时未启用", unsupported: "本构建不支持" }

export function PluginCapabilityStatus({ csrfToken, revisionKey }: PluginCapabilityStatusProps) {
  const [attempt, setAttempt] = useState(0)
  const key = csrfToken + ":" + revisionKey + ":" + attempt
  const [result, setResult] = useState<{ key: string; snapshot?: PluginCapabilitiesSnapshot; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    listPluginCapabilities(controller.signal).then(snapshot => {
      if (!controller.signal.aborted) setResult({ key, snapshot })
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ key, error: "扩展状态暂时无法读取。" })
    })
    return () => controller.abort()
  }, [key])
  const current = result?.key === key ? result : null
  const snapshot = current?.snapshot
  return <section className="plugin-capability-status" aria-labelledby="plugin-capability-heading">
    <h2 id="plugin-capability-heading">扩展能力状态</h2>
    {!current ? <p role="status">正在读取扩展状态</p> : current.error ? <div><p role="alert">{current.error}</p><button className="secondary-button" type="button" onClick={() => setAttempt(value => value + 1)}>重试扩展状态</button></div> : snapshot && <>
      <p>{!snapshot.wasm_supported ? "当前构建不支持 Wasm" : snapshot.wasm_runtime_enabled ? "Wasm 运行时已启用" : "Wasm 运行时未启用"}</p>
      <p className="plugin-admin__hint">内置业务独立于 Wasm。状态为当前服务器快照；具体用户与内容权限由提交时检查。</p>
      {!snapshot.can_manage_lifecycle && <p>当前账号不能更改启停状态。</p>}
      <div className="plugin-capability-status__modules">{snapshot.modules.map(module => <article key={module.capability} aria-label={module.name}>
        <div><strong>{module.name}</strong><span className="admin-badge">{labels[module.status]}</span></div>
        <p>{module.execution === "native" ? "内置业务" : "Wasm 执行"} · {module.supported ? "本构建支持" : "本构建不支持"} · {module.runtime_ready ? "运行条件就绪" : "运行条件未就绪"} · {module.business_enabled ? "业务已启用" : "业务未启用"}</p>
      </article>)}</div>
    </>}
  </section>
}
