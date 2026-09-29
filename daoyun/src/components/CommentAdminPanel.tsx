import { CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, Ellipsis, EyeOff, FileText, LoaderCircle, MessageSquare, RefreshCw, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { getAdminComment, listAdminComments, moderateAdminComment, type AdminComment } from "../api/adminComments"
import type { ModerationBoard } from "../api/moderation"
import { encodeCsv } from "../lib/csv"
import { Drawer } from "./ui/Drawer"

const message = (error: unknown) => error instanceof Error ? error.message : "评论管理暂时不可用"
const dateLabel = (date: string) => new Date(date).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
const statusLabel = (status: AdminComment["status"]) => status === "published" ? "已公开" : "已隐藏"
const commentLink = (item: AdminComment) => "#topic/" + item.topic_id + "?reply=" + item.id
export function CommentAdminPanel({ boards, csrfToken }: { boards: ModerationBoard[]; csrfToken: string }) {
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "")
  const activeBoardId = boards.find((board) => board.id === boardId)?.id ?? boards[0]?.id ?? ""
  const [status, setStatus] = useState<"all" | AdminComment["status"]>("all")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [dateFilter, setDateFilter] = useState("all")
  const [limit, setLimit] = useState(20)
  const [cursor, setCursor] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [items, setItems] = useState<AdminComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [reload, setReload] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [inspectorBusy, setInspectorBusy] = useState(false)
  const rowButtons = useRef(new Map<string, HTMLButtonElement>())
  const searchInput = useRef<HTMLInputElement>(null)
  const visibleItems = items.filter((item) => dateFilter === "all" || Date.parse(item.created_at) >= Date.now() - Number(dateFilter) * 86400000)
  const checkedItems = visibleItems.filter((item) => checkedIds.has(item.id))
  const selectedIndex = visibleItems.findIndex((item) => item.id === selectedId)

  useEffect(() => {
    if (!activeBoardId) { setItems([]); setNextCursor(null); setLoading(false); return }
    const controller = new AbortController()
    setLoading(true); setError(""); setNotice("")
    if (!cursor) { setItems([]); setNextCursor(null); setCheckedIds(new Set()) }
    listAdminComments({ boardId: activeBoardId, status, query, cursor, limit, signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return
        setItems((current) => cursor ? [...current, ...page.comments.filter((item) => !current.some((existing) => existing.id === item.id))] : page.comments)
        setNextCursor(page.nextCursor)
      })
      .catch((caught) => { if (!controller.signal.aborted) setError(message(caught)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [activeBoardId, cursor, limit, query, reload, status])

  function closeInspector() {
    setSelectedId(null)
    queueMicrotask(() => {
      if (document.activeElement === document.body) (rowButtons.current.get(selectedId ?? "") ?? searchInput.current)?.focus()
    })
  }
  function refresh() { setCursor(null); setSelectedId(null); setReload((value) => value + 1) }
  function changeStatus(value: typeof status) { setStatus(value); setCursor(null); setSelectedId(null) }
  function resetFilters() { setSearch(""); setQuery(""); setStatus("all"); setDateFilter("all"); setBoardId(boards[0]?.id ?? ""); refresh() }
  function updateComment(updated: AdminComment) {
    setItems((current) => {
      const others = current.filter((item) => item.id !== updated.id)
      if (status !== "all" && status !== updated.status) return others
      return [...others, updated].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || right.id.localeCompare(left.id))
    })
  }
  function exportComments() {
    const rows = checkedItems.length ? checkedItems : visibleItems
    const csv = encodeCsv([["评论 ID", "正文摘要", "摘要已截断", "作者", "用户名", "所属主题", "版块", "状态", "发布时间"], ...rows.map((item) => [item.id, item.content, item.content_truncated ? "是" : "否", item.author.display_name, item.author.username, item.topic_title, item.board_name, statusLabel(item.status), item.created_at])])
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url; link.download = "评论摘要-" + new Date().toLocaleDateString("sv-SE") + ".csv"; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice("已导出 " + rows.length + " 条评论摘要。")
  }

  if (!activeBoardId) return <p className="admin-empty" role="status">当前账号没有可管理评论的版块</p>
  return <section className="content-admin comment-catalog" aria-label="评论管理工作区">
    <div className="comment-catalog-main" inert={inspectorBusy}>
      <section className="comment-catalog-stats" aria-label="已加载评论统计">
        {[{ label: "已加载评论", value: items.length, icon: MessageSquare, tone: "blue" }, { label: "已公开", value: items.filter((item) => item.status === "published").length, icon: CheckCircle2, tone: "brand" }, { label: "已隐藏", value: items.filter((item) => item.status === "hidden").length, icon: EyeOff, tone: "rose" }, { label: "涉及主题", value: new Set(items.map((item) => item.topic_id)).size, icon: FileText, tone: "amber" }].map(({ label, value, icon: Icon, tone }) => <div className="comment-stat" key={label}><span className={"comment-stat-icon comment-stat-icon--" + tone}><Icon size={23} aria-hidden="true" /></span><div><span>{label}</span><strong>{loading && !cursor || error && !items.length ? "—" : value.toLocaleString("zh-CN")}</strong><small>当前查询 · 已加载结果</small></div></div>)}
      </section>
      <div className="comment-catalog-panel">
        <form className="comment-catalog-toolbar" onSubmit={(event) => { event.preventDefault(); setCursor(null); setSelectedId(null); setQuery(search.trim()); setReload((value) => value + 1) }}>
          <label className="comment-catalog-search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜索评论</span><input ref={searchInput} type="search" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索评论正文、用户名…" /></label>
          <label><span className="sr-only">评论状态</span><select aria-label="评论状态" value={status} onChange={(event) => changeStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="published">已公开</option><option value="hidden">已隐藏</option></select></label>
          <label><span className="sr-only">评论版块</span><select aria-label="评论版块" value={activeBoardId} onChange={(event) => { setBoardId(event.target.value); setCursor(null); setSelectedId(null) }}>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
          <label><span className="sr-only">评论发布时间</span><select aria-label="评论发布时间" value={dateFilter} onChange={(event) => { setDateFilter(event.target.value); setCheckedIds(new Set()); setSelectedId(null) }}><option value="all">全部时间</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></label>
          <button className="primary-button" type="submit"><Search size={15} aria-hidden="true" />搜索</button>
          <button className="secondary-button" type="button" onClick={resetFilters}>重置</button>
          <button className="icon-button" type="button" aria-label="刷新评论" title="刷新评论" disabled={loading} onClick={refresh}><RefreshCw size={16} aria-hidden="true" /></button>
        </form>
        <p className="comment-catalog-scope">仅显示有权管理版块中的评论。统计、时间筛选和导出基于已加载结果；导出内容为正文摘要。</p>
        <div className="comment-catalog-tabs" role="group" aria-label="评论状态快捷筛选">{([{ value: "all", label: "全部评论" }, { value: "published", label: "已公开" }, { value: "hidden", label: "已隐藏" }] as const).map((filter) => <button type="button" key={filter.value} aria-pressed={status === filter.value} onClick={() => changeStatus(filter.value)}>{filter.label}</button>)}<button className="comment-catalog-export" type="button" disabled={loading || !visibleItems.length} onClick={exportComments}><Download size={14} aria-hidden="true" />{checkedItems.length ? "导出选中 " + checkedItems.length + " 条摘要" : "导出当前摘要"}</button></div>
        {checkedItems.length > 0 && <div className="comment-catalog-selection" role="group" aria-label="已选评论操作"><span>已选择 {checkedItems.length} 条评论</span><button type="button" onClick={() => setCheckedIds(new Set())}>取消选择</button></div>}
        {notice && <p className="admin-inline-feedback" role="status">{notice}</p>}
        {error && <div className="form-alert" role="alert">{error}<button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)}>重试评论列表</button></div>}
        {loading && !cursor ? <p className="admin-empty" role="status"><LoaderCircle size={18} className="topic-loading__spinner" aria-hidden="true" />正在读取评论</p> : !error && visibleItems.length === 0 ? <p className="admin-empty" role="status">{nextCursor && items.length ? "已加载结果中暂无匹配评论，可继续加载更多。" : "当前筛选下暂无评论"}</p> : null}
        {visibleItems.length > 0 && <div className="comment-catalog-table" role="table" aria-label="评论列表">
          <div role="rowgroup"><div className="comment-catalog-columns" role="row"><span role="columnheader"><input type="checkbox" aria-label="选择当前评论" checked={checkedItems.length === visibleItems.length} ref={(input) => { if (input) input.indeterminate = checkedItems.length > 0 && checkedItems.length < visibleItems.length }} onChange={(event) => setCheckedIds(event.target.checked ? new Set(visibleItems.map((item) => item.id)) : new Set())} /></span><span role="columnheader">评论内容</span><span role="columnheader">作者</span><span role="columnheader">所属主题</span><span role="columnheader">发布时间</span><span role="columnheader">状态</span><span role="columnheader">操作</span></div></div>
          <div role="rowgroup">{visibleItems.map((item) => <div role="row" className={"content-admin-item comment-catalog-row" + (item.status === "hidden" ? " comment-catalog-row--hidden" : "")} data-active={selectedId === item.id || undefined} data-checked={checkedIds.has(item.id) || undefined} key={item.id}>
            <div role="cell" className="comment-catalog-check"><input type="checkbox" aria-label={"选择评论：" + item.author.display_name + " " + item.id} checked={checkedIds.has(item.id)} onChange={(event) => setCheckedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} /></div>
            <div role="cell" className="comment-catalog-copy"><p>{item.content}</p>{item.content_truncated && <small>正文较长，打开详情查看全文</small>}</div>
            <div role="cell" className="comment-catalog-author"><CommentAvatar item={item} /><div><strong title={item.author.display_name}>{item.author.display_name}</strong><span title={"@" + item.author.username}>@{item.author.username}</span></div></div>
            <div role="cell" className="comment-catalog-topic"><a href={commentLink(item)} title={item.topic_title}>{item.topic_title || "无标题主题"}</a><span>{item.board_name}</span></div>
            <div role="cell" className="comment-catalog-date"><time dateTime={item.created_at}>{dateLabel(item.created_at)}</time></div>
            <div role="cell" className="comment-catalog-status"><span className={"comment-status comment-status--" + item.status}>{statusLabel(item.status)}</span></div>
            <div role="cell" className="comment-catalog-row-actions"><button ref={(button) => { if (button) rowButtons.current.set(item.id, button); else rowButtons.current.delete(item.id) }} className="icon-button" type="button" aria-label={"查看评论：" + item.author.display_name} title="查看评论详情" aria-expanded={selectedId === item.id} onClick={() => setSelectedId(item.id)}><Ellipsis size={18} aria-hidden="true" /></button></div>
          </div>)}</div>
        </div>}
        <footer className="admin-catalog-footer"><span>当前显示 {visibleItems.length} 条 · 已加载 {items.length} 条评论</span><div className="comment-catalog-pagination"><label><span className="sr-only">每次加载评论条数</span><select aria-label="每次加载评论条数" value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setCursor(null); setSelectedId(null) }}><option value={20}>每次 20 条</option><option value={50}>每次 50 条</option></select></label>{nextCursor ? <button className="secondary-button" type="button" disabled={loading} onClick={() => { setCursor(nextCursor); setReload((value) => value + 1) }}>{loading ? "正在加载" : "加载更多评论"}</button> : <span>{loading ? "正在加载…" : error ? "加载失败" : "已加载全部结果"}</span>}</div></footer>
      </div>
    </div>
    {selectedId && <CommentInspector id={selectedId} onBusyChange={setInspectorBusy} csrfToken={csrfToken} onClose={closeInspector} onChanged={updateComment} previousId={visibleItems[selectedIndex - 1]?.id} nextId={selectedIndex >= 0 ? visibleItems[selectedIndex + 1]?.id : undefined} onNavigate={setSelectedId} />}
  </section>
}

function CommentAvatar({ item }: { item: AdminComment }) {
  return <span className="comment-avatar" aria-hidden="true">{item.author.avatar_url ? <img src={item.author.avatar_url} alt="" /> : Array.from(item.author.display_name)[0] || "用"}</span>
}

function CommentInspector({ id, onBusyChange, csrfToken, onClose, onChanged, previousId, nextId, onNavigate }: { id: string; onBusyChange: (busy: boolean) => void; csrfToken: string; onClose: () => void; onChanged: (item: AdminComment) => void; previousId?: string; nextId?: string; onNavigate: (id: string) => void }) {
  const [item, setItem] = useState<AdminComment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [reload, setReload] = useState(0)
  const [intent, setIntent] = useState<AdminComment["status"] | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setItem(null); setError(""); setNotice(""); setIntent(null); setReason("")
    getAdminComment(id, controller.signal).then((loaded) => { if (!controller.signal.aborted) setItem(loaded) })
      .catch((caught) => { if (!controller.signal.aborted) setError(message(caught)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, reload])
  async function submit() {
    if (!item || !intent || busyRef.current || reason.trim().length < 2) return
    busyRef.current = true; setBusy(true); onBusyChange(true); setError(""); setNotice("")
    try {
      const updated = await moderateAdminComment(item.id, { status: intent, expected_updated_at: item.updated_at, reason: reason.trim() }, csrfToken)
      setItem(updated); setIntent(null); setReason(""); setNotice(intent === "hidden" ? "评论已隐藏" : "评论已恢复"); onChanged(updated)
    } catch (caught) { setError(message(caught)) }
    finally { busyRef.current = false; setBusy(false); onBusyChange(false) }
  }
  async function copyLink() {
    if (!item) return
    try { await navigator.clipboard.writeText(new URL(commentLink(item), window.location.href).href); setNotice("评论链接已复制") }
    catch { setError("链接复制失败，可使用“查看原帖”链接打开评论。") }
  }
  const content = <div ref={contentRef} tabIndex={-1} className="comment-inspector-content">
    {loading && <p className="admin-empty" role="status">正在读取完整评论</p>}
    {error && <div className="form-alert" role="alert">{error}<button className="secondary-button" type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>刷新详情</button></div>}
    {notice && <p className="admin-success" role="status">{notice}</p>}
    {item && <>
      <div className="comment-inspector-author"><CommentAvatar item={item} /><div><strong>{item.author.display_name}</strong><span>@{item.author.username}</span><time dateTime={item.created_at}>{dateLabel(item.created_at)}</time></div><span className={"comment-status comment-status--" + item.status}>{statusLabel(item.status)}</span></div>
      <p className="content-admin-body">{item.content}</p>
      <a className="comment-inspector-topic" href={commentLink(item)}><MessageSquare size={18} aria-hidden="true" /><span><strong>查看原帖：{item.topic_title || "无标题主题"}</strong><small>{item.board_name}</small></span><ChevronRight size={15} aria-hidden="true" /></a>
      <section className="comment-inspector-info" aria-label="评论信息"><h3>评论信息</h3><dl><dt>评论 ID</dt><dd>{item.id}</dd><dt>所属版块</dt><dd>{item.board_name}</dd><dt>发布时间</dt><dd>{dateLabel(item.created_at)}</dd><dt>更新时间</dt><dd>{dateLabel(item.updated_at)}</dd><dt>内容状态</dt><dd>{statusLabel(item.status)}</dd></dl></section>
      <section className="comment-inspector-operations" aria-label="评论操作"><h3>操作</h3>
        {!intent ? <div className="comment-inspector-buttons"><button className={item.status === "published" ? "secondary-button" : "primary-button"} type="button" onClick={() => { setIntent(item.status === "published" ? "hidden" : "published"); setReason(""); setNotice("") }}>{item.status === "published" ? <EyeOff size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}{item.status === "published" ? "隐藏评论" : "恢复评论"}</button><button className="secondary-button" type="button" onClick={() => void copyLink()}><Copy size={14} aria-hidden="true" />复制链接</button></div> : <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <h4>{intent === "hidden" ? "隐藏这条评论" : "恢复这条评论"}</h4><p className="comment-inspector-hint">{intent === "hidden" ? "隐藏后，公开页面将不再展示这条评论。" : "恢复后，这条评论将重新在公开页面展示。"}</p>
          <label><span>处理说明</span><textarea autoFocus required minLength={2} maxLength={500} rows={3} disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <div className="admin-form__actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setIntent(null)}>取消</button><button className="primary-button" type="submit" disabled={busy || reason.trim().length < 2}>{busy ? "正在提交" : intent === "hidden" ? "确认隐藏" : "确认恢复"}</button></div>
        </form>}
      </section>
    </>}
    <footer className="comment-inspector-navigation"><button className="secondary-button" type="button" aria-label="上一条评论" disabled={!previousId || loading || busy || Boolean(intent)} onClick={() => { contentRef.current?.focus(); if (previousId) onNavigate(previousId) }}><ChevronLeft size={15} aria-hidden="true" />上一条</button><button className="secondary-button" type="button" aria-label="下一条评论" disabled={!nextId || loading || busy || Boolean(intent)} onClick={() => { contentRef.current?.focus(); if (nextId) onNavigate(nextId) }}>下一条<ChevronRight size={15} aria-hidden="true" /></button></footer>
  </div>
  return <Drawer title="评论详情" onClose={onClose} busy={busy}>{content}</Drawer>
}
