import { RefreshCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { listEditReviewPage, resolveEditReview, type EditReviewItem } from "../api/editReviews"
import type { ModerationBoard } from "../api/moderation"
import { sanitizeRichContent } from "../editor/richContent"
import { RichTextContent } from "./RichTextContent"
import { AdminActionDialog } from "./admin/AdminActionDialog"

const message = (error: unknown) => error instanceof Error ? error.message : "审核队列暂时不可用"

export function ContentReviewAdminPanel({ boards, csrfToken }: { boards: ModerationBoard[]; csrfToken: string }) {
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "")
  const activeBoardId = boards.find((board) => board.id === boardId)?.id ?? boards[0]?.id ?? ""
  const [status, setStatus] = useState<EditReviewItem["status"]>("pending")
  const [targetType, setTargetType] = useState<"all" | EditReviewItem["target_type"]>("all")
  const [cursor, setCursor] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [items, setItems] = useState<EditReviewItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [reload, setReload] = useState(0)
  const [intent, setIntent] = useState<{ item: EditReviewItem; decision: "approve" | "reject" } | null>(null)
  const [reason, setReason] = useState("")
  const [actionError, setActionError] = useState("")
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  useEffect(() => {
    if (!activeBoardId) return
    const controller = new AbortController()
    setLoading(true); setError("")
    if (!cursor) { setItems([]); setNextCursor(null) }
    listEditReviewPage({ boardId: activeBoardId, status, targetType, cursor, signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return
        setItems((current) => cursor ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))] : page.items)
        setNextCursor(page.nextCursor)
      })
      .catch((caught) => { if (!controller.signal.aborted) setError(message(caught)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [activeBoardId, cursor, reload, status, targetType])
  function refresh() { setCursor(null); setReload((value) => value + 1) }
  function open(item: EditReviewItem, decision: "approve" | "reject") { setIntent({ item, decision }); setReason(""); setActionError(""); setNotice("") }
  async function submit() {
    if (!intent || busyRef.current || reason.trim().length < 2) return
    busyRef.current = true; setBusy(true); setActionError("")
    try {
      await resolveEditReview(intent.item, intent.decision, reason.trim(), csrfToken)
      setNotice(intent.decision === "approve" ? "编辑已通过并发布" : "编辑已驳回")
      setIntent(null); refresh()
    } catch (caught) { setActionError(message(caught)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  if (!activeBoardId) return <p className="admin-empty" role="status">当前账号没有可审核的版块</p>
  return <section className="content-admin" aria-label="内容审核工作区">
    <div className="content-admin-toolbar">
      <label><span>版块</span><select aria-label="审核版块" value={activeBoardId} onChange={(event) => { setBoardId(event.target.value); setCursor(null); setNotice("") }}>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
      <label><span>状态</span><select aria-label="审核状态" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setCursor(null); setNotice("") }}><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option></select></label>
      <label><span>内容类型</span><select aria-label="审核类型" value={targetType} onChange={(event) => { setTargetType(event.target.value as typeof targetType); setCursor(null); setNotice("") }}><option value="all">全部编辑</option><option value="topic">主题编辑</option><option value="reply">回复编辑</option></select></label>
      <button className="secondary-button" type="button" disabled={loading} onClick={refresh}><RefreshCw size={15} aria-hidden="true" />刷新队列</button>
    </div>
    <p className="content-admin-hint">编辑审核 · 待审版本通过前，公开页面继续展示原有内容。审核策略在编辑审核插件中配置。</p>
    {notice && <p className="admin-success" role="status">{notice}</p>}
    {error && <div className="form-alert" role="alert">{error}<button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)}>重试审核列表</button></div>}
    {loading && !cursor ? <p className="admin-empty" role="status">正在读取审核队列</p> : !error && items.length === 0 ? <p className="admin-empty" role="status">当前筛选下暂无审核记录</p> : null}
    <div className="content-review-list">{items.map((item) => <article className="content-review-item" key={item.id}>
      <header><div><strong>{item.target_type === "topic" ? "主题编辑" : "回复编辑"}</strong><span>{item.editor.display_name} · {new Date(item.created_at).toLocaleString("zh-CN", { hour12: false })}</span></div><span className="admin-badge">{{ pending: "待审核", approved: "已通过", rejected: "已驳回" }[item.status]}</span></header>
      <div className="content-review-compare">
        <section aria-label="当前公开版本"><h3>当前公开版本</h3>{item.current_title && <h4>{item.current_title}</h4>}<p>{item.current_content}</p></section>
        <section aria-label="提交的编辑版本"><h3>提交的编辑版本</h3>{item.proposed_title !== null && <h4>{item.proposed_title || "已清空标题"}</h4>}{item.proposed_rich_content ? <RichTextContent document={sanitizeRichContent(item.proposed_rich_content)} /> : <p>{item.proposed_content ?? "正文未修改"}</p>}{item.proposed_excerpt !== null && <><h4>摘要</h4><p>{item.proposed_excerpt || "已清空摘要"}</p></>}{item.proposed_tags !== null && <><h4>标签</h4><p>{item.proposed_tags.length ? item.proposed_tags.map((tag) => <span className="admin-badge" key={tag.slug}>{tag.name}</span>) : "已清空标签"}</p></>}</section>
      </div>
      {item.review_reason && <p className="content-admin-hint">审核说明：{item.review_reason}</p>}
      <footer><a href={"#topic/" + item.topic_id}>查看原帖</a>{item.status === "pending" && <div><button className="secondary-button" type="button" disabled={busy || loading} onClick={() => open(item, "reject")}>驳回</button><button className="primary-button" type="button" disabled={busy || loading} onClick={() => open(item, "approve")}>通过并发布</button></div>}</footer>
    </article>)}</div>
    <footer className="admin-catalog-footer"><span>已加载 {items.length} 条审核记录</span>{nextCursor && <button className="secondary-button" type="button" disabled={loading || busy} onClick={() => setCursor(nextCursor)}>{loading ? "正在加载" : "加载更多审核记录"}</button>}</footer>
    {intent && <AdminActionDialog title={intent.decision === "approve" ? "通过编辑" : "驳回编辑"} busy={busy} onClose={() => setIntent(null)}>
      <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        {actionError && <div className="form-alert" role="alert">{actionError}<button className="secondary-button" type="button" disabled={busy} onClick={() => { setIntent(null); refresh() }}>关闭并刷新队列</button></div>}
        <p>{intent.decision === "approve" ? "确认后将发布此待审版本。公开版本已变化时，本次操作会被拒绝。" : "驳回后保留当前公开版本。"}</p>
        <label><span>审核说明</span><textarea required minLength={2} maxLength={500} rows={3} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="admin-form__actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setIntent(null)}>取消</button><button className="primary-button" type="submit" disabled={busy || reason.trim().length < 2}>{busy ? "正在提交" : intent.decision === "approve" ? "确认通过" : "确认驳回"}</button></div>
      </form>
    </AdminActionDialog>}
  </section>
}
