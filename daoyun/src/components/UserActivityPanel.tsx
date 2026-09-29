import { AlertCircle, ExternalLink, FileText, LoaderCircle, MessageSquare } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { AdminUsersApiError, listAdminUserContent, type AdminUserContentItem } from "../api/adminUsers"
import { listAdminUserReports, ReportApiError, type ContentReport } from "../api/reports"

type ActivityItem = AdminUserContentItem | ContentReport
const reportReasons = { spam: "广告垃圾", harassment: "骚扰攻击", illegal: "违法内容", copyright: "侵犯版权", other: "其他" }
const contentStates: Record<string, string> = { published: "已公开", hidden: "已隐藏", draft: "草稿" }
const reportStates = { open: "待处理", in_review: "处理中", resolved: "已解决", dismissed: "已驳回" }

export function UserActivityPanel({ userId, kind, preview = false, canReadReports = false }: { userId: string; kind: "content" | "reports"; preview?: boolean; canReadReports?: boolean }) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const label = kind === "content" ? "内容" : "举报"

  async function load(cursor?: string) {
    if (pending.current) return
    pending.current = true
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError("")
    try {
      const result = kind === "content"
        ? await listAdminUserContent(userId, cursor, controller.signal)
        : await listAdminUserReports(userId, cursor, controller.signal)
      if (controller.signal.aborted) return
      const loaded = "items" in result ? result.items : result.reports
      setItems((current) => cursor ? [...current, ...loaded.filter((item) => !current.some((existing) => existing.id === item.id))] : loaded)
      setNextCursor(result.nextCursor)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof AdminUsersApiError || reason instanceof ReportApiError ? reason.message : label + "暂时无法加载")
    } finally {
      if (!controller.signal.aborted) { pending.current = false; setLoading(false) }
    }
  }

  useEffect(() => {
    pending.current = false
    setItems([]); setNextCursor(null)
    void load()
    return () => request.current?.abort()
  }, [userId, kind])

  return <div className={"user-admin-items user-activity-panel" + (preview ? " user-activity-preview" : "")} aria-busy={loading}>
    {(preview ? items.slice(0, 3) : items).map((item) => {
      const report = "targetType" in item
      const href = report
        ? item.targetTopicId ? "#topic/" + item.targetTopicId + (item.targetType === "post" ? "?reply=" + item.targetId : "") : null
        : "#topic/" + item.topicId + (item.kind === "reply" ? "?reply=" + item.id : "")
      const title = report ? item.targetTitle ?? "目标内容已不可见" : item.title ?? "无标题内容"
      const Icon = report ? AlertCircle : item.kind === "topic" ? FileText : MessageSquare
      return <article key={item.id}>
        <header><div className="user-activity-kind"><span><Icon size={14} aria-hidden="true" />{report ? item.targetType === "topic" ? "主题" : "评论" : item.kind === "topic" ? "主题" : "回复"}</span><span className={"user-activity-state user-activity-state--" + item.status}>{report ? reportStates[item.status] : Object.hasOwn(contentStates, item.status) ? contentStates[item.status] : "未知状态"}</span></div><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></header>
        <h4>{href ? <a href={href}>{title}<ExternalLink size={12} aria-hidden="true" /></a> : title}</h4>
        {report && <div className="user-report-context"><small>{reportReasons[item.reason]}</small>{item.reporter.id === userId && <span>用户发起</span>}{item.targetAuthor?.id === userId && <span>其内容被举报</span>}</div>}
        <p>{report ? item.details || "未补充举报说明" : item.excerpt || "暂无摘要"}</p>
        {report && <div className="user-report-meta"><span>举报人：{item.reporter.displayName} <span>@{item.reporter.username}</span></span>{canReadReports && <a href={"#admin/reports?report_id=" + encodeURIComponent(item.id)}>查看举报详情<ExternalLink size={12} aria-hidden="true" /></a>}</div>}
      </article>
    })}
    {loading && <p className="user-activity-feedback" role="status"><LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" />正在读取{label}</p>}
    {error && <div className="user-activity-feedback" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span><button className="secondary-button" type="button" onClick={() => void load(nextCursor ?? undefined)}>重试</button></div>}
    {!loading && !error && !items.length && <p className="user-activity-feedback" role="status">{kind === "content" ? "暂无最近内容" : "暂无相关举报"}</p>}
    {!preview && items.length > 0 && <footer><span>已加载 {items.length} 条{label}</span>{nextCursor && !error ? <button className="secondary-button" type="button" disabled={loading} onClick={() => void load(nextCursor)}>加载更多{label}</button> : !nextCursor && !loading ? <span>已显示全部</span> : null}</footer>}
  </div>
}
