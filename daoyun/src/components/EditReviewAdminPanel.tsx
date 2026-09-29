import { useEffect, useMemo, useRef, useState } from "react"

import {
  listEditReviewPolicies,
  listEditReviews,
  resolveEditReview,
  updateEditReviewPolicies,
  type EditReviewItem,
  type EditReviewPolicy,
} from "../api/editReviews"

function message(error: unknown) { return error instanceof Error ? error.message : "编辑审核操作失败" }

export function EditReviewAdminPanel({ csrfToken }: { csrfToken: string }) {
  const [policies, setPolicies] = useState<EditReviewPolicy[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [topicRequired, setTopicRequired] = useState(false)
  const [replyRequired, setReplyRequired] = useState(false)
  const [boardId, setBoardId] = useState("")
  const [status, setStatus] = useState<EditReviewItem["status"]>("pending")
  const [items, setItems] = useState<EditReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [reload, setReload] = useState(0)
  const [intent, setIntent] = useState<{ item: EditReviewItem; decision: "approve" | "reject" } | null>(null)
  const [reason, setReason] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    listEditReviewPolicies(controller.signal).then((loaded) => {
      if (controller.signal.aborted) return
      setPolicies(loaded)
      setBoardId((current) => current || loaded[0]?.board_id || "")
    }).catch((caught) => { if (!controller.signal.aborted) setError(message(caught)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!boardId) { setItems([]); return }
    const controller = new AbortController()
    listEditReviews(boardId, status, controller.signal)
      .then((loaded) => { if (!controller.signal.aborted) setItems(loaded) })
      .catch((caught) => { if (!controller.signal.aborted) setError(message(caught)) })
    return () => controller.abort()
  }, [boardId, reload, status])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  async function savePolicies() {
    if (busyRef.current || selected.length === 0) return
    busyRef.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const updates = policies.filter((policy) => selectedSet.has(policy.board_id)).map((policy) => ({
        ...policy,
        topic_edits_require_review: topicRequired,
        reply_edits_require_review: replyRequired,
      }))
      setPolicies(await updateEditReviewPolicies(updates, csrfToken))
      setNotice(`已更新 ${updates.length} 个版块的编辑审核设置`)
    } catch (caught) { setError(message(caught)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function resolve() {
    if (!intent || busyRef.current || !reason.trim()) return
    busyRef.current = true
    setBusy(true)
    setError("")
    try {
      await resolveEditReview(intent.item, intent.decision, reason.trim(), csrfToken)
      setIntent(null)
      setReason("")
      setNotice(intent.decision === "approve" ? "编辑已通过并发布" : "编辑已驳回")
      setReload((value) => value + 1)
    } catch (caught) { setError(message(caught)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  return <section className="admin-form" aria-label="编辑审核管理">
    {error && <p className="form-alert" role="alert">{error}</p>}
    {notice && <p className="admin-success" role="status">{notice}</p>}
    {loading ? <p role="status">正在读取编辑审核设置</p> : <>
      <fieldset className="admin-form">
        <legend>批量配置版块</legend>
        <p>选择一个或多个版块后统一应用。主题编辑和回复编辑互不影响。</p>
        <div className="admin-form__grid">
          {policies.map((policy) => <label className="admin-checkbox" key={policy.board_id}>
            <input type="checkbox" aria-label={`选择版块 ${policy.board_name}`} checked={selectedSet.has(policy.board_id)} disabled={busy}
              onChange={(event) => setSelected((current) => event.target.checked ? [...current, policy.board_id] : current.filter((id) => id !== policy.board_id))} />
            <span>{policy.board_name}</span>
          </label>)}
        </div>
        {policies.length === 0 && <p>当前账号没有可配置版块</p>}
        <label className="admin-checkbox"><input type="checkbox" checked={topicRequired} disabled={busy} onChange={(event) => setTopicRequired(event.target.checked)} /><span>主题编辑需要审核</span></label>
        <label className="admin-checkbox"><input type="checkbox" checked={replyRequired} disabled={busy} onChange={(event) => setReplyRequired(event.target.checked)} /><span>回复编辑需要审核</span></label>
        <button className="primary-button" type="button" disabled={busy || selected.length === 0} onClick={() => void savePolicies()}>应用到 {selected.length} 个版块</button>
      </fieldset>

      <div className="admin-form">
        <h3>编辑审核队列</h3>
        <div className="admin-form__grid">
          <label><span>版块</span><select value={boardId} disabled={busy} onChange={(event) => setBoardId(event.target.value)}>{policies.map((policy) => <option key={policy.board_id} value={policy.board_id}>{policy.board_name}</option>)}</select></label>
          <label><span>状态</span><select value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as EditReviewItem["status"])}><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option></select></label>
        </div>
        <button className="secondary-button" type="button" disabled={busy || !boardId} onClick={() => setReload((value) => value + 1)}>刷新审核队列</button>
        {boardId && items.length === 0 && <p>当前筛选下没有编辑审核记录</p>}
        {items.map((item) => <article className="plugin-row" key={item.id}>
          <header><strong>{item.target_type === "topic" ? "主题编辑" : "回复编辑"} · {item.editor.display_name}</strong><span className="admin-badge">{{ pending: "待审核", approved: "已通过", rejected: "已驳回" }[item.status]}</span></header>
          {item.current_title && <p>当前标题：{item.current_title}</p>}
          {item.proposed_title && <p>拟改标题：{item.proposed_title}</p>}
          <div className="admin-form__grid">
            <div><strong>当前公开内容</strong><p>{item.current_content}</p></div>
            <div><strong>待审内容</strong><p>{item.proposed_content ?? "正文未修改"}</p></div>
          </div>
          <a href={`#topic/${item.topic_id}`}>查看原帖</a>
          {item.status === "pending" && <div className="plugin-row__actions"><button className="primary-button" type="button" disabled={busy} onClick={() => { setIntent({ item, decision: "approve" }); setReason("") }}>通过并发布</button><button className="secondary-button" type="button" disabled={busy} onClick={() => { setIntent({ item, decision: "reject" }); setReason("") }}>驳回</button></div>}
        </article>)}
      </div>
    </>}
    {intent && <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void resolve() }}>
      <h3>{intent.decision === "approve" ? "通过编辑" : "驳回编辑"}</h3>
      <label><span>审核说明</span><textarea autoFocus required maxLength={500} rows={3} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="admin-form__actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setIntent(null)}>取消</button><button className="primary-button" type="submit" disabled={busy || !reason.trim()}>确认</button></div>
    </form>}
  </section>
}
