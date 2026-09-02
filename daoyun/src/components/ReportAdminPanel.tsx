import { ArrowLeft, Check, ChevronRight, Flag, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  getAdminReport,
  listAdminReports,
  moderateAdminReport,
  ReportApiError,
  updateAdminReport,
  type ContentReport,
  type ReportDetail,
  type ReportDisposition,
  type ReportModerationInput,
  type ReportStatus,
  type ReportUserActionKind,
} from "../api/reports"
import { RelatedAuditLog } from "./RelatedAuditLog"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"
import { ConfirmDialog } from "./ui/ConfirmDialog"

export type ReportStatusFilter = ReportStatus | "all"

interface ReportAdminPanelProps {
  requestedStatus: ReportStatusFilter
  requestedReportId?: string | null
  onStatusChange: (status: ReportStatusFilter) => void
  csrfToken: string
  canResolve: boolean
  canReadAudit?: boolean
}

const filters: Array<{ value: ReportStatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "open", label: "待处理" },
  { value: "in_review", label: "处理中" },
  { value: "resolved", label: "已解决" },
  { value: "dismissed", label: "已驳回" },
]

export function ReportAdminPanel({ requestedStatus, requestedReportId = null, onStatusChange, csrfToken, canResolve, canReadAudit = false }: ReportAdminPanelProps) {
  const [reports, setReports] = useState<ContentReport[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState("")
  const detailRequestVersion = useRef(0)
  const listRequestVersion = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    const requestVersion = ++listRequestVersion.current
    detailRequestVersion.current += 1
    setLoading(true)
    setLoadingMore(false)
    setError("")
    setSelectedId(null)
    setDetail(null)
    listAdminReports({ status: requestedStatus === "all" ? undefined : requestedStatus, limit: 20, signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted || requestVersion !== listRequestVersion.current) return
        setReports(page.reports)
        setNextCursor(page.nextCursor)
        const requested = requestedReportId ? page.reports.find((report) => report.id === requestedReportId) : null
        if (requestedReportId) void openReport(requested ?? requestedReportId)
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted && requestVersion === listRequestVersion.current) setError(messageFor(reason, "举报列表暂时无法加载，请稍后重试。")) })
      .finally(() => { if (!controller.signal.aborted && requestVersion === listRequestVersion.current) setLoading(false) })
    return () => {
      controller.abort()
      if (requestVersion === listRequestVersion.current) listRequestVersion.current += 1
    }
  }, [requestedReportId, requestedStatus])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    const requestVersion = listRequestVersion.current
    setLoadingMore(true); setError("")
    try {
      const page = await listAdminReports({ status: requestedStatus === "all" ? undefined : requestedStatus, cursor: nextCursor, limit: 20 })
      if (requestVersion !== listRequestVersion.current) return
      setReports((current) => [...current, ...page.reports])
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (requestVersion === listRequestVersion.current) setError(messageFor(reason, "更多举报暂时无法加载，请稍后重试。"))
    } finally { if (requestVersion === listRequestVersion.current) setLoadingMore(false) }
  }

  async function openReport(report: ContentReport | string) {
    const reportId = typeof report === "string" ? report : report.id
    const requestVersion = ++detailRequestVersion.current
    setSelectedId(reportId); setDetail(null); setDetailLoading(true); setError("")
    try {
      const loaded = await getAdminReport(reportId)
      if (requestVersion === detailRequestVersion.current) setDetail(loaded)
    } catch (reason) {
      if (requestVersion === detailRequestVersion.current) setError(messageFor(reason, "举报详情暂时无法加载，请稍后重试。"))
    } finally {
      if (requestVersion === detailRequestVersion.current) setDetailLoading(false)
    }
  }

  function closeDetail() {
    detailRequestVersion.current += 1
    setSelectedId(null)
    setDetail(null)
    setDetailLoading(false)
  }

  function acceptUpdatedReport(updated: ContentReport) {
    const remainsVisible = requestedStatus === "all" || updated.status === requestedStatus
    setReports((current) => remainsVisible
      ? current.map((item) => item.id === updated.id ? updated : item)
      : current.filter((item) => item.id !== updated.id))
    if (!remainsVisible) {
      closeDetail()
    }
  }

  return (
    <div className="admin-panel report-admin-panel">
      <div className="admin-panel__heading">
        <div><p>内容治理</p><h2>举报处理</h2></div>
        <span className="admin-badge">{reports.filter((report) => report.status === "open").length} 条待处理</span>
      </div>
      <div className="admin-report-filters" aria-label="举报状态筛选">
        {filters.map((filter) => <button key={filter.value} className="secondary-button" type="button" aria-pressed={requestedStatus === filter.value} onClick={() => onStatusChange(filter.value)}>{filter.label}</button>)}
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className={`report-workspace${selectedId ? " report-workspace--detail" : ""}`}>
        <section className="report-queue" aria-label="举报队列">
          {loading ? <Loading label="正在读取举报队列" /> : reports.length === 0 ? <div className="admin-empty" role="status"><Flag size={22} aria-hidden="true" /><span>当前筛选下暂无举报</span></div> : (
            <div className="admin-report-list">
              {reports.map((report) => <ReportQueueItem key={report.id} report={report} selected={selectedId === report.id} onOpen={() => void openReport(report)} />)}
            </div>
          )}
          {nextCursor && <button className="secondary-button report-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}加载更多</button>}
        </section>
        <section className="report-detail" aria-label="举报详情">
          {selectedId && <button className="secondary-button report-detail__back" type="button" onClick={closeDetail}><ArrowLeft size={14} aria-hidden="true" />返回举报队列</button>}
          {!selectedId ? <div className="report-detail__placeholder"><ShieldAlert size={24} aria-hidden="true" /><strong>选择一条举报查看详情</strong><span>这里会显示内容上下文、作者风险和处理记录。</span></div> : detailLoading ? <Loading label="正在读取举报详情" /> : detail ? <ReportDetailWorkspace key={detail.report.id} detail={detail} csrfToken={csrfToken} canResolve={canResolve} canReadAudit={canReadAudit} onUpdated={acceptUpdatedReport} onDetailChange={setDetail} /> : null}
        </section>
      </div>
    </div>
  )
}

function ReportQueueItem({ report, selected, onOpen }: { report: ContentReport; selected: boolean; onOpen: () => void }) {
  return <article className={`admin-report-row report-queue-item${selected ? " report-queue-item--selected" : ""}`}>
    <header><span>{report.targetType === "topic" ? "主题" : "回复"}</span><strong>{statusLabel(report.status)}</strong><time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time></header>
    <h3>{report.targetTitle || "目标内容已不可见"}</h3>
    <p>原因：{reasonLabel(report.reason)} · 举报者：{report.reporter.displayName}</p>
    {report.details && <p className="admin-report-row__details">{report.details}</p>}
    <button className="report-queue-item__open" type="button" aria-label={`查看举报：${report.targetTitle || report.id}`} onClick={onOpen}>查看详情<ChevronRight size={14} aria-hidden="true" /></button>
  </article>
}

function ReportDetailWorkspace({ detail, csrfToken, canResolve, canReadAudit, onUpdated, onDetailChange }: { detail: ReportDetail; csrfToken: string; canResolve: boolean; canReadAudit: boolean; onUpdated: (report: ContentReport) => void; onDetailChange: (detail: ReportDetail) => void }) {
  const [disposition, setDisposition] = useState<ReportDisposition>("resolved")
  const [hideContent, setHideContent] = useState(false)
  const [userAction, setUserAction] = useState<ReportUserActionKind | "none">("none")
  const [userReason, setUserReason] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [publicReason, setPublicReason] = useState("")
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [marking, setMarking] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<{ effects: string; input: ReportModerationInput } | null>(null)
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null)
  const report = detail.report
  const actionable = report.status === "open" || report.status === "in_review"

  async function markInReview() {
    setMarking(true); setError(""); setMessage(""); setConflict(false)
    try {
      const updated = await updateAdminReport(report.id, { status: "in_review", resolution: "none", expectedRevision: report.revision }, csrfToken)
      onUpdated(updated); onDetailChange({ ...detail, report: updated }); setMessage("已标记为处理中。")
    } catch (reason) {
      setConflict(reason instanceof ReportApiError && reason.status === 409)
      setError(messageFor(reason, "状态更新失败，请稍后重试。"))
    }
    finally { setMarking(false) }
  }

  async function refreshConflictBaseline() {
    try {
      const latest = await getAdminReport(report.id)
      onUpdated(latest.report)
      onDetailChange(latest)
      setConflict(false)
      setError("")
    } catch (reason) {
      setError(messageFor(reason, "最新举报详情暂时无法加载，请稍后重试。"))
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(""); setMessage("")
    if (note.trim().length < 2) { setError("请填写至少 2 个字符的内部处理备注。"); return }
    if (userAction !== "none" && userReason.trim().length < 2) { setError("请填写至少 2 个字符的作者处置原因。"); return }
    const effects = [hideContent ? "隐藏内容" : null, userAction === "restricted" ? "限制作者账号" : userAction === "suspended" ? "暂停作者账号" : null, disposition === "resolved" ? "解决举报" : "驳回举报"].filter(Boolean).join("、")
    const input: ReportModerationInput = {
      disposition,
      contentAction: hideContent ? "hide" : "none",
      userAction: userAction === "none" ? null : { kind: userAction, reason: userReason.trim(), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null },
      publicReason: publicReason.trim() || null,
      note: note.trim(),
      expectedRevision: report.revision,
    }
    confirmationReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPendingDecision({ effects, input })
  }

  async function confirmDecision() {
    if (!pendingDecision) return
    setPending(true)
    setError(""); setMessage(""); setConflict(false)
    try {
      const result = await moderateAdminReport(report.id, pendingDecision.input, csrfToken)
      onUpdated(result.report)
      onDetailChange({ ...detail, report: result.report, author: detail.author && result.user ? { ...detail.author, status: result.user.status, revision: result.user.revision } : detail.author })
      setMessage(`处置已完成：${result.content.changed ? "内容已隐藏，" : ""}${result.user ? `作者账号已${result.user.status === "restricted" ? "限制" : "暂停"}，` : ""}${result.notificationQueued ? "举报人通知已入队。" : "举报已更新。"}`)
      setPendingDecision(null)
    } catch (reason) {
      setPendingDecision(null)
      setConflict(reason instanceof ReportApiError && reason.status === 409)
      setError(messageFor(reason, "举报处置失败，请刷新后重试。"))
    }
    finally { setPending(false) }
  }

  return <div className="report-detail__content">
    <header className="report-detail__heading"><div><p>{report.targetType === "topic" ? "主题举报" : "回复举报"}</p><h3>{report.targetTitle || "目标内容已不可见"}</h3></div><span className="admin-badge">{statusLabel(report.status)}</span></header>
    <dl className="report-facts"><div><dt>举报原因</dt><dd>{reasonLabel(report.reason)}</dd></div><div><dt>举报人</dt><dd>{report.reporter.displayName}</dd></div><div><dt>目标作者</dt><dd>{report.targetAuthor?.displayName ?? "未知"}</dd></div><div><dt>提交时间</dt><dd>{formatDate(report.createdAt)}</dd></div></dl>
    {report.details && <section className="report-detail__section"><h4>举报说明</h4><p>{report.details}</p></section>}
    <section className="report-detail__section"><h4>内容上下文</h4><strong>{detail.context.title}</strong><div className="report-context-list">{detail.context.items.map((item) => <article key={item.id} className={item.isTarget ? "report-context-item report-context-item--target" : "report-context-item"}><header><span>{item.author?.displayName ?? "已注销用户"}</span>{item.isTarget && <em>被举报内容</em>}<time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></header><p>{item.content}</p></article>)}</div></section>
    {detail.author && <section className="report-detail__section"><h4>作者风险</h4><p>{detail.author.user.displayName} · 账号状态：{accountStatusLabel(detail.author.status)}</p><p>该作者共有 {detail.author.reportCount} 条举报记录</p></section>}
    <section className="report-detail__section"><h4>处理记录</h4>{detail.handlingHistory.length === 0 ? <p>尚无管理员处理记录。</p> : <ul className="report-history">{detail.handlingHistory.map((item) => <li key={item.id}><span>{item.actor.displayName} · {actionLabel(item.action)}</span><time>{formatDate(item.createdAt)}</time></li>)}</ul>}</section>
    {canReadAudit ? <RelatedAuditLog filter={{ reportId: report.id }} /> : null}
    {(error || message) && <p className={error ? "form-alert" : "admin-success"} role={error ? "alert" : "status"}>{error || message}</p>}
    {conflict && <RevisionConflictNotice onRefresh={() => void refreshConflictBaseline()} />}
    {!canResolve ? <p className="report-readonly-note">当前权限仅允许查看举报详情。</p> : actionable ? <form className="report-moderation-form" onSubmit={(event) => void submit(event)}>
      <div className="report-moderation-form__heading"><div><h4>处置方案</h4><p>内容、作者账号和举报结论会在一次确认后同时生效。</p></div>{report.status === "open" && <button className="secondary-button" type="button" disabled={marking} onClick={() => void markInReview()}><Check size={14} aria-hidden="true" />标记处理中</button>}</div>
      <label><span>举报结论</span><select value={disposition} onChange={(event) => setDisposition(event.target.value as ReportDisposition)}><option value="resolved">举报成立</option><option value="dismissed">驳回举报</option></select></label>
      <label className="admin-checkbox"><input type="checkbox" checked={hideContent} onChange={(event) => setHideContent(event.target.checked)} /><span>隐藏被举报内容</span></label>
      <label><span>作者处置</span><select value={userAction} onChange={(event) => setUserAction(event.target.value as ReportUserActionKind | "none")}><option value="none">不处理作者账号</option><option value="restricted">限制账号</option><option value="suspended">暂停账号</option></select></label>
      {userAction !== "none" && <><label><span>作者处置原因</span><input value={userReason} onChange={(event) => setUserReason(event.target.value)} maxLength={500} /></label><label><span>到期时间（可选）</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></>}
      <label><span>对举报人的说明</span><textarea value={publicReason} onChange={(event) => setPublicReason(event.target.value)} maxLength={500} placeholder="可选；举报人会看到这段说明" /></label>
      <label><span>内部处理备注</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} required placeholder="仅管理员可见，不会发送给举报人" /></label>
      <div className="report-impact"><strong>即将执行</strong><span>{hideContent ? "隐藏内容；" : "保留内容；"}{userAction === "none" ? "不处理作者；" : `${userAction === "restricted" ? "限制" : "暂停"}作者账号；`}{disposition === "resolved" ? "举报成立" : "驳回举报"}</span></div>
      <button className="primary-button" type="submit" disabled={pending}>{pending && <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />}确认并完成处置</button>
    </form> : <p className="report-readonly-note">该举报已完成处理，仅保留查看权限。</p>}
    {pendingDecision ? <ConfirmDialog
      title="确认举报处置"
      confirmLabel="确认执行处置"
      busy={pending}
      returnFocus={confirmationReturnFocusRef.current}
      onCancel={() => setPendingDecision(null)}
      onConfirm={() => void confirmDecision()}
    >
      <p>即将执行：{pendingDecision.effects}。</p>
      <p>内容、作者账号与举报结论会在一次写入中生效，并记录审计信息。</p>
    </ConfirmDialog> : null}
  </div>
}

function Loading({ label }: { label: string }) { return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /><span>{label}</span></div> }
function messageFor(reason: unknown, fallback: string) { return reason instanceof ReportApiError ? reason.message : fallback }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }) }
function statusLabel(status: ReportStatus) { return status === "open" ? "待处理" : status === "in_review" ? "处理中" : status === "resolved" ? "已解决" : "已驳回" }
function reasonLabel(reason: ContentReport["reason"]) { return ({ spam: "垃圾广告", harassment: "骚扰攻击", illegal: "违法内容", copyright: "版权问题", other: "其他" } as const)[reason] }
function accountStatusLabel(status: "active" | "restricted" | "suspended") { return status === "active" ? "正常" : status === "restricted" ? "受限" : "已暂停" }
function actionLabel(action: string) { return ({ "report.create": "创建举报", "report.review": "标记处理中", "report.moderate": "完成处置" } as Record<string, string>)[action] ?? action }
