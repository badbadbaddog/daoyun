import { useEffect, useRef, useState } from "react"

import {
  getSupplementSettings,
  putSupplementSettings,
  type SupplementSettings,
} from "../api/topicSupplementAdmin"

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试" }

export function TopicSupplementSettingsPanel({ csrfToken }: { csrfToken: string }) {
  const [settings, setSettings] = useState<SupplementSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    getSupplementSettings(controller.signal)
      .then((loaded) => { if (!controller.signal.aborted) setSettings(loaded) })
      .catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)) })
    return () => controller.abort()
  }, [])

  async function save() {
    if (busyRef.current || !settings) return
    busyRef.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      setSettings(await putSupplementSettings(settings, csrfToken))
      setNotice("全站补充设置已保存")
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return <div className="admin-form">
    {error && <p className="form-alert" role="alert">{error}</p>}
    {notice && <p className="admin-success" role="status">{notice}</p>}
    {!settings && !error && <p role="status">正在读取补充设置</p>}
    {settings && <form className="admin-form" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void save() }}>
      <h3>全站补充设置</h3>
      <label>
        <span>每帖最多补充次数</span>
        <input type="number" min={0} max={100} required value={settings.max_per_topic} disabled={busy}
          onChange={(event) => setSettings({ ...settings, max_per_topic: Number(event.target.value) })} />
      </label>
      <label className="admin-checkbox">
        <input type="checkbox" checked={settings.enabled} disabled={busy}
          onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
        <span>允许新增补充</span>
      </label>
      <p>补充保存后直接发布。全站默认每帖 1 次；隐藏记录仍占用次数，降低上限不会删除已有内容。</p>
      <button className="primary-button" disabled={busy} type="submit">保存全站设置</button>
    </form>}
  </div>
}
