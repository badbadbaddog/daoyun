import { useRef, useState } from "react"
import { getAdminReport, updateAdminReport, type ContentReport } from "../api/reports"
import { AdminActionDialog } from "./admin/AdminActionDialog"

type BatchItem = { report: ContentReport; status: "waiting" | "running" | "success" | "failure"; error?: string }

export function ReportBatchDialog({ reports, csrfToken, canResolve, onUpdated, onClose }: {
  reports: ContentReport[]
  csrfToken: string
  canResolve: boolean
  onUpdated: (report: ContentReport) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<BatchItem[]>(() => reports.map((report) => ({ report, status: "waiting" })))
  const [note, setNote] = useState("")
  const [started, setStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const allowed = useRef(canResolve)
  allowed.current = canResolve
  const successes = items.filter((item) => item.status === "success").length
  const failures = items.filter((item) => item.status === "failure").length
  const updateItem = (id: string, status: BatchItem["status"], error?: string) =>
    setItems((current) => current.map((item) => item.report.id === id ? { ...item, status, error } : item))

  async function processItem(item: BatchItem, checkRevision: boolean) {
    updateItem(item.report.id, "running")
    try {
      if (!allowed.current) throw new Error("处理权限已撤销")
      if (checkRevision) {
        const current = await getAdminReport(item.report.id)
        if (current.report.revision !== item.report.revision) throw new Error("版本已变化，请返回举报详情核实后重新选择。")
      }
      if (!allowed.current) throw new Error("处理权限已撤销")
      const updated = await updateAdminReport(item.report.id, {
        status: "in_review", resolution: "none", note: note.trim(), expectedRevision: item.report.revision,
      }, csrfToken)
      onUpdated(updated)
      updateItem(item.report.id, "success")
    } catch (error) {
      updateItem(item.report.id, "failure", error instanceof Error ? error.message : "处理失败，结果待核实")
    }
  }
  async function start() {
    if (busyRef.current || started || !canResolve || note.trim().length < 2) return
    busyRef.current = true; setBusy(true); setStarted(true)
    try { for (const item of items) await processItem(item, false) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function retry(item: BatchItem) {
    if (busyRef.current || !canResolve || item.status !== "failure") return
    busyRef.current = true; setBusy(true)
    try { await processItem(item, true) }
    finally { busyRef.current = false; setBusy(false) }
  }
  return <AdminActionDialog title="批量标为处理中" busy={busy} onClose={onClose}>
    <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void start() }}>
      <p>影响 {items.length} 条举报，仅更新举报状态与内部备注。每条单独检查权限和版本；内容与账号状态保持原有值。</p>
      <label><span>批处理原因</span><textarea aria-label="批处理原因" required minLength={2} maxLength={1000} rows={3} disabled={started || busy || !canResolve} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {!canResolve && <p className="form-alert" role="alert">当前账号没有举报处理权限</p>}
      {started && <p role="status">成功 {successes} 条，失败 {failures} 条{busy ? "，正在逐项处理" : ""}</p>}
      <div className="admin-form">{items.map((item) => <div key={item.report.id}>
        <strong>{item.report.targetTitle ?? item.report.id}</strong>
        <p className="content-admin-hint">举报 {item.report.id} · 版本 {item.report.revision} · {{ waiting: "待处理", running: "正在处理", success: "成功", failure: "失败" }[item.status]}</p>
        {item.error && <p className="form-alert">{item.error}</p>}
        {item.status === "failure" && <button className="secondary-button" type="button" aria-label={"重试举报 " + item.report.id} disabled={busy || !canResolve} onClick={() => void retry(item)}>核实并重试此项</button>}
      </div>)}</div>
      <div className="admin-form__actions"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>返回举报队列</button>{!started && <button className="primary-button" type="submit" disabled={busy || !canResolve || note.trim().length < 2}>确认逐项处理</button>}</div>
    </form>
  </AdminActionDialog>
}
