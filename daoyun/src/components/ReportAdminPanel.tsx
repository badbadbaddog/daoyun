import { Check, CheckCircle2, Clock3, Download, ExternalLink, FileText, Flag, LoaderCircle, MessageSquare, RefreshCw, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { getAdminReport, listAdminReports, moderateAdminReport, ReportApiError, updateAdminReport, type ContentReport, type ReportDetail, type ReportDisposition, type ReportModerationInput, type ReportStatus, type ReportUserActionKind } from "../api/reports"
import { encodeCsv } from "../lib/csv"
import { RelatedAuditLog } from "./RelatedAuditLog"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"
import { ConfirmDialog } from "./ui/ConfirmDialog"
import { Drawer } from "./ui/Drawer"

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
  { value: "all", label: "全部" }, { value: "open", label: "待处理" }, { value: "in_review", label: "处理中" }, { value: "resolved", label: "已解决" }, { value: "dismissed", label: "已驳回" },
]
const reportReasons = ["spam", "harassment", "illegal", "copyright", "other"] as const
const targetLink = (report: ContentReport) => report.targetTopicId ? "#topic/" + report.targetTopicId + (report.targetType === "post" ? "?reply=" + report.targetId : "") : null

export function ReportAdminPanel({ requestedStatus, requestedReportId = null, onStatusChange, csrfToken, canResolve, canReadAudit = false }: ReportAdminPanelProps) {
  const [reports, setReports] = useState<ContentReport[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailBusy, setDetailBusy] = useState(false)
  const [error, setError] = useState("")
  const [detailError, setDetailError] = useState("")
  const [notice, setNotice] = useState("")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [reason, setReason] = useState("all")
  const [targetType, setTargetType] = useState("all")
  const [from, setFrom] = useState("")
  const [through, setThrough] = useState("")
  const [limit, setLimit] = useState(20)
  const [reload, setReload] = useState(0)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const detailRequestVersion = useRef(0)
  const listRequestVersion = useRef(0)
  const detailReturnFocus = useRef<HTMLElement | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const morePending = useRef(false)
  const invalidDates = Boolean(from && through && from > through)
  const visible = reports.filter((report) => {
    const day = new Date(report.createdAt).toLocaleDateString("sv-SE")
    return !invalidDates && (reason === "all" || report.reason === reason) && (targetType === "all" || report.targetType === targetType)
      && (!from || day >= from) && (!through || day <= through)
      && (!query || [report.targetTitle, report.details, report.reporter.displayName, report.reporter.username, report.id, reasonLabel(report.reason)].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  })
  const checked = visible.filter((report) => checkedIds.has(report.id))

  useEffect(() => {
    const controller = new AbortController()
    const version = ++listRequestVersion.current
    detailRequestVersion.current += 1
    morePending.current = false
    setLoading(true); setLoadingMore(false); setError(""); setNotice(""); setReports([]); setNextCursor(null); setCheckedIds(new Set())
    setSelectedId(null); setDetail(null); setDetailBusy(false)
    listAdminReports({ status: requestedStatus === "all" ? undefined : requestedStatus, limit, signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted || version !== listRequestVersion.current) return
        setReports(page.reports); setNextCursor(page.nextCursor)
        if (requestedReportId) void openReport(requestedReportId)
      })
      .catch((caught) => { if (!controller.signal.aborted && version === listRequestVersion.current) setError(messageFor(caught, "举报列表暂时无法加载，请稍后重试。")) })
      .finally(() => { if (!controller.signal.aborted && version === listRequestVersion.current) setLoading(false) })
    return () => { controller.abort(); if (version === listRequestVersion.current) listRequestVersion.current += 1 }
  }, [requestedReportId, requestedStatus, limit, reload])
  useEffect(() => () => { detailRequestVersion.current += 1 }, [])

  async function loadMore() {
    if (!nextCursor || morePending.current) return
    const version = listRequestVersion.current
    morePending.current = true; setLoadingMore(true); setError("")
    try {
      const page = await listAdminReports({ status: requestedStatus === "all" ? undefined : requestedStatus, cursor: nextCursor, limit })
      if (version !== listRequestVersion.current) return
      setReports((current) => [...current, ...page.reports.filter((report) => !current.some((item) => item.id === report.id))]); setNextCursor(page.nextCursor)
    } catch (caught) { if (version === listRequestVersion.current) setError(messageFor(caught, "更多举报暂时无法加载，请稍后重试。")) }
    finally { if (version === listRequestVersion.current) { morePending.current = false; setLoadingMore(false) } }
  }
  async function openReport(reportId: string) {
    if (!selectedId) detailReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const version = ++detailRequestVersion.current
    setSelectedId(reportId); setDetail(null); setDetailLoading(true); setDetailError("")
    try { const loaded = await getAdminReport(reportId); if (version === detailRequestVersion.current) setDetail(loaded) }
    catch (caught) { if (version === detailRequestVersion.current) setDetailError(messageFor(caught, "举报详情暂时无法加载，请稍后重试。")) }
    finally { if (version === detailRequestVersion.current) setDetailLoading(false) }
  }
  function closeDetail() {
    if (detailBusy) return
    detailRequestVersion.current += 1; setSelectedId(null); setDetail(null); setDetailLoading(false)
    queueMicrotask(() => { (detailReturnFocus.current?.isConnected ? detailReturnFocus.current : searchInput.current)?.focus() })
  }
  function acceptUpdatedReport(updated: ContentReport) {
    setReports((current) => current.flatMap((item) => item.id !== updated.id ? [item] : requestedStatus === "all" || updated.status === requestedStatus ? [updated] : []))
  }
  function resetFilters() { setSearch(""); setQuery(""); setReason("all"); setTargetType("all"); setFrom(""); setThrough(""); setCheckedIds(new Set()); onStatusChange("all") }
  function exportReports() {
    const rows = checked.length ? checked : visible
    const csv = encodeCsv([["举报 ID", "内容", "内容类型", "举报原因", "举报说明", "举报人", "用户名", "状态", "举报时间"], ...rows.map((report) => [report.id, report.targetTitle ?? "", report.targetType === "topic" ? "主题" : "评论", reasonLabel(report.reason), report.details ?? "", report.reporter.displayName, report.reporter.username, statusLabel(report.status), report.createdAt])])
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a"); link.href = url; link.download = "举报记录-" + new Date().toLocaleDateString("sv-SE") + ".csv"; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("已导出 " + rows.length + " 条举报记录。")
  }
  return <section className="report-catalog" aria-label="举报处理工作区">
    <div inert={detailBusy}>
      <section className="report-catalog-stats" aria-label="已加载举报统计">
        {[{ label: "已加载举报", value: reports.length, icon: Flag, tone: "blue" }, { label: "待处理", value: reports.filter((item) => item.status === "open").length, icon: Clock3, tone: "rose" }, { label: "处理中", value: reports.filter((item) => item.status === "in_review").length, icon: LoaderCircle, tone: "amber" }, { label: "已完成", value: reports.filter((item) => ["resolved", "dismissed"].includes(item.status)).length, icon: CheckCircle2, tone: "brand" }].map(({ label, value, icon: Icon, tone }) => <div className="report-stat" key={label}><span className={"report-stat-icon report-stat-icon--" + tone}><Icon size={23} aria-hidden="true" /></span><div><span>{label}</span><strong>{loading || error && !reports.length ? "—" : value.toLocaleString("zh-CN")}</strong><small>当前状态 · 已加载结果</small></div></div>)}
      </section>
      <section className="report-catalog-panel" aria-label="举报队列">
        <form className="report-catalog-toolbar" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setCheckedIds(new Set()) }}>
          <label><span className="sr-only">举报状态</span><select aria-label="举报状态" value={requestedStatus} onChange={(event) => onStatusChange(event.target.value as ReportStatusFilter)}>{filters.map((filter) => <option value={filter.value} key={filter.value}>{filter.value === "all" ? "全部状态" : filter.label}</option>)}</select></label>
          <label><span className="sr-only">举报类型</span><select aria-label="举报类型" value={reason} onChange={(event) => { setReason(event.target.value); setCheckedIds(new Set()) }}><option value="all">全部举报类型</option>{reportReasons.map((value) => <option key={value} value={value}>{reasonLabel(value)}</option>)}</select></label>
          <label><span className="sr-only">被举报内容类型</span><select aria-label="被举报内容类型" value={targetType} onChange={(event) => { setTargetType(event.target.value); setCheckedIds(new Set()) }}><option value="all">全部内容类型</option><option value="topic">主题</option><option value="post">评论</option></select></label>
          <label className="report-date-filter"><span>开始日期</span><input aria-label="举报开始日期" type="date" value={from} max={through || undefined} onChange={(event) => { setFrom(event.target.value); setCheckedIds(new Set()) }} /></label>
          <label className="report-date-filter"><span>结束日期</span><input aria-label="举报结束日期" type="date" value={through} min={from || undefined} onChange={(event) => { setThrough(event.target.value); setCheckedIds(new Set()) }} /></label>
          <div className="report-catalog-search-row"><label className="report-catalog-search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜索举报</span><input ref={searchInput} type="search" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索举报原因、内容、举报人或 ID…" /></label><button className="primary-button" type="submit"><Search size={15} aria-hidden="true" />搜索</button><button className="secondary-button" type="button" onClick={resetFilters}>重置</button><button className="icon-button" aria-label="刷新举报" title="刷新举报" type="button" disabled={loading || loadingMore} onClick={() => setReload((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" /></button></div>
        </form>
        <p className="report-catalog-scope">统计、关键词、类型、日期筛选及导出基于已加载结果；可继续加载更多举报。</p>
        {invalidDates && <p className="form-alert" role="alert">结束日期不能早于开始日期。</p>}
        <div className="report-catalog-tabs" role="group" aria-label="举报状态筛选">{filters.map((filter) => <button type="button" key={filter.value} aria-pressed={requestedStatus === filter.value} onClick={() => onStatusChange(filter.value)}>{filter.label}</button>)}<button className="report-catalog-export" type="button" disabled={loading || !visible.length} onClick={exportReports}><Download size={14} aria-hidden="true" />{checked.length ? "导出选中 " + checked.length + " 条" : "导出当前结果"}</button></div>
        {checked.length > 0 && <div className="report-catalog-selection"><span>已选择 {checked.length} 条举报</span><button type="button" onClick={() => setCheckedIds(new Set())}>取消选择</button></div>}
        {notice && <p className="admin-inline-feedback" role="status">{notice}</p>}
        {error && <div className="form-alert" role="alert">{error}<button className="secondary-button" type="button" onClick={() => reports.length && nextCursor ? void loadMore() : setReload((value) => value + 1)}>重试举报列表</button></div>}
        {loading ? <Loading label="正在读取举报队列" /> : visible.length === 0 && !error ? <div className="admin-empty" role="status"><Flag size={22} aria-hidden="true" /><span>{nextCursor && reports.length ? "已加载结果中暂无匹配举报，可继续加载更多。" : "当前筛选下暂无举报"}</span></div> : null}
        {visible.length > 0 && <div className="report-catalog-table" role="table" aria-label="举报列表"><div role="rowgroup"><div className="report-catalog-columns" role="row"><span role="columnheader"><input type="checkbox" aria-label="选择当前举报" checked={checked.length === visible.length} ref={(input) => { if (input) input.indeterminate = checked.length > 0 && checked.length < visible.length }} onChange={(event) => setCheckedIds(event.target.checked ? new Set(visible.map((report) => report.id)) : new Set())} /></span><span role="columnheader">内容</span><span role="columnheader">举报类型</span><span role="columnheader">举报人</span><span role="columnheader">举报时间</span><span role="columnheader">状态</span><span role="columnheader">操作</span></div></div><div role="rowgroup">{visible.map((report) => <ReportQueueItem key={report.id} report={report} selected={selectedId === report.id} checked={checkedIds.has(report.id)} onCheck={(value) => setCheckedIds((current) => { const next = new Set(current); if (value) next.add(report.id); else next.delete(report.id); return next })} onOpen={() => void openReport(report.id)} />)}</div></div>}
        <footer className="admin-catalog-footer"><span>当前显示 {visible.length} 条 · 已加载 {reports.length} 条举报</span><div className="report-catalog-pagination"><label><span className="sr-only">每次加载举报条数</span><select aria-label="每次加载举报条数" value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={20}>每次 20 条</option><option value={50}>每次 50 条</option></select></label>{nextCursor ? <button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在加载" : "加载更多"}</button> : <span>{loading ? "正在加载…" : error ? "加载失败" : "已加载全部结果"}</span>}</div></footer>
      </section>
    </div>
    {selectedId && <Drawer title="举报详情" busy={detailBusy} onClose={closeDetail}><section className="report-catalog-detail" aria-label="举报详情">{detailLoading ? <Loading label="正在读取举报详情" /> : detailError ? <div className="form-alert" role="alert">{detailError}<button className="secondary-button" type="button" onClick={() => void openReport(selectedId)}>重试举报详情</button></div> : detail ? <ReportDetailWorkspace key={detail.report.id} detail={detail} csrfToken={csrfToken} canResolve={canResolve} canReadAudit={canReadAudit} onUpdated={acceptUpdatedReport} onDetailChange={setDetail} onBusyChange={setDetailBusy} /> : null}<button className="secondary-button report-catalog-back" type="button" disabled={detailBusy} onClick={closeDetail}>返回举报队列</button></section></Drawer>}
  </section>
}

function ReportQueueItem({ report, selected, checked, onCheck, onOpen }: { report: ContentReport; selected: boolean; checked: boolean; onCheck: (checked: boolean) => void; onOpen: () => void }) {
  const Icon = report.targetType === "topic" ? FileText : MessageSquare
  return <div className="report-catalog-row" role="row" data-active={selected || undefined} data-checked={checked || undefined}>
    <div className="report-catalog-check" role="cell"><input type="checkbox" aria-label={"选择举报：" + report.id} checked={checked} onChange={(event) => onCheck(event.target.checked)} /></div>
    <div className="report-catalog-content" role="cell"><span className={"report-target-icon report-target-icon--" + report.targetType}><Icon size={22} aria-hidden="true" /></span><div><h3>{report.targetTitle || "目标内容已不可见"}</h3><p>{report.details || "未填写补充说明"}</p><small>{report.targetType === "topic" ? "主题" : "评论"}</small></div></div>
    <div className="report-catalog-reason" role="cell"><span className={"report-reason report-reason--" + report.reason}>{reasonLabel(report.reason)}</span></div>
    <div className="report-catalog-reporter" role="cell"><span className="report-avatar" aria-hidden="true">{report.reporter.avatarUrl ? <img src={report.reporter.avatarUrl} alt="" /> : Array.from(report.reporter.displayName)[0] || "用"}</span><div><strong>{report.reporter.displayName}</strong><span>@{report.reporter.username}</span></div></div>
    <div className="report-catalog-date" role="cell"><time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time></div>
    <div className="report-catalog-status" role="cell"><span className={"report-status report-status--" + report.status}>{statusLabel(report.status)}</span></div>
    <div className="report-catalog-actions" role="cell"><button className="secondary-button" type="button" aria-label={"查看举报：" + (report.targetTitle || report.id)} aria-expanded={selected} onClick={onOpen}>查看</button></div>
  </div>
}

function ReportDetailWorkspace({ detail, csrfToken, canResolve, canReadAudit, onUpdated, onDetailChange, onBusyChange }: { detail: ReportDetail; csrfToken: string; canResolve: boolean; canReadAudit: boolean; onUpdated: (report: ContentReport) => void; onDetailChange: (detail: ReportDetail) => void; onBusyChange: (busy: boolean) => void }) {
  const [actionOpen, setActionOpen] = useState(false)
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
  const actionTrigger = useRef<HTMLButtonElement>(null)
  const mutationPending = useRef(false)
  useEffect(() => { onBusyChange(pending || marking || Boolean(pendingDecision)); return () => onBusyChange(false) }, [pending, marking, pendingDecision, onBusyChange])
  const report = detail.report
  const actionable = report.status === "open" || report.status === "in_review"

  async function markInReview() {
    if (mutationPending.current) return
    mutationPending.current = true
    setMarking(true); setError(""); setMessage(""); setConflict(false)
    try {
      const updated = await updateAdminReport(report.id, { status: "in_review", resolution: "none", expectedRevision: report.revision }, csrfToken)
      onUpdated(updated); onDetailChange({ ...detail, report: updated }); setMessage("已标记为处理中。")
    } catch (reason) {
      setConflict(reason instanceof ReportApiError && reason.status === 409)
      setError(messageFor(reason, "状态更新失败，请稍后重试。"))
    }
    finally { mutationPending.current = false; setMarking(false) }
  }

  async function refreshConflictBaseline() {
    if (mutationPending.current) return
    mutationPending.current = true; setMarking(true)
    try {
      const latest = await getAdminReport(report.id)
      onUpdated(latest.report)
      onDetailChange(latest)
      setConflict(false)
      setError("")
    } catch (reason) {
      setError(messageFor(reason, "最新举报详情暂时无法加载，请稍后重试。"))
    } finally { mutationPending.current = false; setMarking(false) }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (mutationPending.current || pendingDecision || conflict) return
    setError(""); setMessage("")
    if (note.trim().length < 2) { setError("请填写至少 2 个字符的内部处理备注。"); return }
    if (userAction !== "none" && userReason.trim().length < 2) { setError("请填写至少 2 个字符的作者处置原因。"); return }
    if (userAction !== "none" && expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) { setError("到期时间必须晚于当前时间。"); return }
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
    if (!pendingDecision || mutationPending.current) return
    mutationPending.current = true
    setPending(true)
    setError(""); setMessage(""); setConflict(false)
    try {
      const result = await moderateAdminReport(report.id, pendingDecision.input, csrfToken)
      onUpdated(result.report)
      onDetailChange({ ...detail, report: result.report, author: detail.author && result.user ? { ...detail.author, status: result.user.status, revision: result.user.revision } : detail.author })
      setMessage(`处置已完成：${result.content.changed ? "内容已隐藏，" : ""}${result.user ? `作者账号已${result.user.status === "restricted" ? "限制" : "暂停"}，` : ""}${result.notificationQueued ? "举报人通知已入队。" : "举报已更新。"}`)
      setPendingDecision(null)
      setActionOpen(false)
    } catch (reason) {
      setPendingDecision(null)
      setConflict(reason instanceof ReportApiError && reason.status === 409)
      setError(messageFor(reason, "举报处置失败，请刷新后重试。"))
    }
    finally { mutationPending.current = false; setPending(false) }
  }

  return <div className="report-detail__content">
    <header className="report-detail__heading"><div><p>{report.targetType === "topic" ? "主题举报" : "回复举报"}</p><h3>{report.targetTitle || "目标内容已不可见"}</h3></div><span className={"report-status report-status--" + report.status}>{statusLabel(report.status)}</span></header>
    {targetLink(report) && <a className="report-original-link" href={targetLink(report)!}>查看原文<ExternalLink size={14} aria-hidden="true" /></a>}
    <dl className="report-facts"><div><dt>举报 ID</dt><dd>{report.id}</dd></div><div><dt>举报原因</dt><dd>{reasonLabel(report.reason)}</dd></div><div><dt>举报人</dt><dd>{report.reporter.displayName} <span>@{report.reporter.username}</span></dd></div><div><dt>目标作者</dt><dd>{report.targetAuthor?.displayName ?? "未知"}</dd></div><div><dt>提交时间</dt><dd>{formatDate(report.createdAt)}</dd></div></dl>
    {report.details && <section className="report-detail__section"><h4>举报说明</h4><p>{report.details}</p></section>}
    <section className="report-detail__section"><h4>内容上下文</h4><strong>{detail.context.title}</strong><div className="report-context-list">{detail.context.items.map((item) => <article key={item.id} className={item.isTarget ? "report-context-item report-context-item--target" : "report-context-item"}><header><span>{item.author?.displayName ?? "已注销用户"}</span>{item.isTarget && <em>被举报内容</em>}<time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></header><p>{item.content}</p></article>)}</div></section>
    {detail.author && <section className="report-detail__section"><h4>作者风险</h4><p>{detail.author.user.displayName} · 账号状态：{accountStatusLabel(detail.author.status)}</p><p>该作者共有 {detail.author.reportCount} 条举报记录</p></section>}
    {detail.relatedReports.some((item) => item.id !== report.id) && <section className="report-detail__section"><h4>相关举报</h4><ul className="report-related-list">{detail.relatedReports.filter((item) => item.id !== report.id).map((item) => <li key={item.id}><span>{reasonLabel(item.reason)}</span><span className={"report-status report-status--" + item.status}>{statusLabel(item.status)}</span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></li>)}</ul></section>}
    <section className="report-detail__section"><h4>处理记录</h4>{detail.handlingHistory.length === 0 ? <p>尚无管理员处理记录。</p> : <ul className="report-history">{detail.handlingHistory.map((item) => <li key={item.id}><span>{item.actor.displayName} · {actionLabel(item.action)}</span><time>{formatDate(item.createdAt)}</time></li>)}</ul>}</section>
    {canReadAudit ? <RelatedAuditLog filter={{ reportId: report.id }} /> : null}
    {!actionOpen && (error || message) && <p className={error ? "form-alert" : "admin-success"} role={error ? "alert" : "status"}>{error || message}</p>}
    {!actionOpen && conflict && <RevisionConflictNotice onRefresh={() => void refreshConflictBaseline()} />}
    {!canResolve ? <p className="report-readonly-note">当前权限仅允许查看举报详情。</p> : actionable && !actionOpen ? <div className="admin-workspace-actions">
      {report.status === "open" && <button className="secondary-button" type="button" disabled={marking} onClick={() => void markInReview()}><Check size={14} aria-hidden="true" />标记处理中</button>}
      <button ref={actionTrigger} className="primary-button" type="button" disabled={marking} onClick={() => setActionOpen(true)}>处理举报</button>
    </div> : !actionable ? <p className="report-readonly-note">该举报已完成处理，仅保留查看权限。</p> : null}
    {canResolve && actionable && actionOpen ? <section className="report-inline-action" aria-label="处理举报">
    {(error || message) && <p className={error ? "form-alert" : "admin-success"} role={error ? "alert" : "status"}>{error || message}</p>}
    {conflict && <RevisionConflictNotice onRefresh={() => void refreshConflictBaseline()} />}
    <form className="report-moderation-form" onSubmit={(event) => void submit(event)}><fieldset disabled={pending || marking || Boolean(pendingDecision)}>
      <div className="report-moderation-form__heading"><div><h4>处置方案</h4><p>内容、作者账号和举报结论会在一次确认后同时生效。</p></div></div>
      <label><span>举报结论</span><select autoFocus value={disposition} onChange={(event) => setDisposition(event.target.value as ReportDisposition)}><option value="resolved">举报成立</option><option value="dismissed">驳回举报</option></select></label>
      <label className="admin-checkbox"><input type="checkbox" checked={hideContent} onChange={(event) => setHideContent(event.target.checked)} /><span>隐藏被举报内容</span></label>
      <label><span>作者处置</span><select value={userAction} onChange={(event) => setUserAction(event.target.value as ReportUserActionKind | "none")}><option value="none">不处理作者账号</option><option value="restricted">限制账号</option><option value="suspended">暂停账号</option></select></label>
      {userAction !== "none" && <><label><span>作者处置原因</span><input value={userReason} onChange={(event) => setUserReason(event.target.value)} maxLength={500} /></label><label><span>到期时间（可选）</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></>}
      <label><span>对举报人的说明</span><textarea value={publicReason} onChange={(event) => setPublicReason(event.target.value)} maxLength={500} placeholder="可选；举报人会看到这段说明" /></label>
      <label><span>内部处理备注</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} required placeholder="仅管理员可见，不会发送给举报人" /></label>
      <div className="report-impact"><strong>即将执行</strong><span>{hideContent ? "隐藏内容；" : "保留内容；"}{userAction === "none" ? "不处理作者；" : `${userAction === "restricted" ? "限制" : "暂停"}作者账号；`}{disposition === "resolved" ? "举报成立" : "驳回举报"}</span></div>
      <div className="admin-form__actions"><button className="secondary-button" type="button" onClick={() => { setActionOpen(false); queueMicrotask(() => actionTrigger.current?.focus()) }}>取消处置</button><button className="primary-button" type="submit" disabled={pending || conflict}>{pending && <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />}确认并完成处置</button></div>
    </fieldset></form>
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
    </section> : null}
  </div>
}

function Loading({ label }: { label: string }) { return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /><span>{label}</span></div> }
function messageFor(reason: unknown, fallback: string) { return reason instanceof ReportApiError ? reason.message : fallback }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) }
function statusLabel(status: ReportStatus) { return status === "open" ? "待处理" : status === "in_review" ? "处理中" : status === "resolved" ? "已解决" : "已驳回" }
function reasonLabel(reason: ContentReport["reason"]) { return ({ spam: "垃圾广告", harassment: "骚扰攻击", illegal: "违法内容", copyright: "版权问题", other: "其他" } as const)[reason] }
function accountStatusLabel(status: "active" | "restricted" | "suspended") { return status === "active" ? "正常" : status === "restricted" ? "受限" : "已暂停" }
function actionLabel(action: string) { return ({ "report.create": "创建举报", "report.review": "标记处理中", "report.moderate": "完成处置" } as Record<string, string>)[action] ?? action }
