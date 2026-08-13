import { AlertCircle, History, LoaderCircle, RefreshCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { AdminApiError, listAdminAudit, type AdminAuditEntry, type ListAdminAuditOptions } from "../api/admin"

interface RelatedAuditLogProps {
  filter: Pick<ListAdminAuditOptions, "userId" | "reportId" | "resourceId">
  title?: string
}

const actionLabels: Record<string, string> = {
  "user.status.update": "更新账号状态",
  "user.status.expire": "恢复到期限制",
  "report.review": "标记举报处理中",
  "report.moderate": "完成举报处置",
  "report.user_action": "处置举报目标账号",
}

const resourceLabels: Record<string, string> = {
  user: "用户账号",
  content_report: "内容举报",
  topic: "主题",
  reply: "回复",
  board: "版块",
}

export function RelatedAuditLog({ filter, title = "相关操作记录" }: RelatedAuditLogProps) {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestVersion = useRef(0)
  const { userId, reportId, resourceId } = filter

  useEffect(() => {
    const controller = new AbortController()
    const version = ++requestVersion.current
    setState("loading")
    setLoadingMore(false)
    setError("")
    listAdminAudit({ userId, reportId, resourceId, limit: 10, signal: controller.signal })
      .then((page) => {
        if (!controller.signal.aborted && version === requestVersion.current) {
          setEntries(page.entries)
          setNextCursor(page.nextCursor)
          setState("ready")
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && version === requestVersion.current) {
          setError(reason instanceof AdminApiError ? reason.message : "相关操作记录暂时无法加载")
          setState("error")
        }
      })
    return () => {
      controller.abort()
      if (version === requestVersion.current) requestVersion.current += 1
    }
  }, [reload, reportId, resourceId, userId])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    const version = requestVersion.current
    setLoadingMore(true)
    setError("")
    try {
      const page = await listAdminAudit({ userId, reportId, resourceId, cursor: nextCursor, limit: 10 })
      if (version !== requestVersion.current) return
      setEntries((current) => [...current, ...page.entries])
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (version === requestVersion.current) setError(reason instanceof AdminApiError ? reason.message : "更多操作记录暂时无法加载")
    } finally {
      if (version === requestVersion.current) setLoadingMore(false)
    }
  }

  return <section className="related-audit-log" aria-labelledby={`audit-${title}`}>
    <h4 id={`audit-${title}`}><History size={15} aria-hidden="true" />{title}</h4>
    {state === "loading" ? <div className="related-audit-log__state" role="status"><LoaderCircle className="topic-loading__spinner" size={18} aria-hidden="true" />正在读取操作记录</div> : null}
    {state === "error" ? <div className="related-audit-log__state" role="alert"><AlertCircle size={18} aria-hidden="true" />{error}<button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)}><RefreshCw size={14} aria-hidden="true" />重试</button></div> : null}
    {state === "ready" && entries.length === 0 ? <p role="status">暂无相关操作记录。</p> : null}
    {entries.length > 0 ? <ul>{entries.map((entry) => <li key={entry.id}>
      <div><strong>{entry.actor.displayName}</strong><span>{actionLabels[entry.action] ?? entry.action}</span></div>
      <dl><div><dt>对象</dt><dd>{resourceLabels[entry.resourceType] ?? entry.resourceType}{entry.resourceId ? ` · ${entry.resourceId}` : ""}</dd></div><div><dt>时间</dt><dd>{formatDateTime(entry.createdAt)}</dd></div><div><dt>审计 ID</dt><dd>{entry.id}</dd></div></dl>
    </li>)}</ul> : null}
    {error && state === "ready" ? <p className="form-alert" role="alert">{error}</p> : null}
    {nextCursor ? <button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}加载更多操作记录</button> : null}
  </section>
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}
