import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, ChevronDown, Download, Ellipsis, Eye, FileText, Filter, Layers, Pin, Star, LoaderCircle, MessageSquare, RefreshCw, Search, ThumbsUp, X } from "lucide-react"

import {
  governTopic,
  listModerationTopics,
  moderateTopic,
  ModerationApiError,
  type ModerationAction,
  type ModerationBoard,
  type ModerationStatus,
  type ModerationTopic,
} from "../api/moderation"
import type { AuthSession } from "../api/auth"
import { encodeCsv } from "../lib/csv"
import { AdminTopicPublisher } from "./admin/AdminTopicPublisher"
import { TopicModerationHistory } from "./TopicModerationHistory"
import { TopicRevisionDialog } from "./TopicRevisionDialog"
import { Drawer } from "./ui/Drawer"
import { ModalDialog } from "./ui/ModalDialog"

interface ModerationAdminPanelProps {
  boards: ModerationBoard[]
  csrfToken: string
  canReadAudit?: boolean
  session?: AuthSession | null
}

type ModerationIntent =
  | { topic: ModerationTopic; status: "hidden" | "rejected" }
  | { topic: ModerationTopic; action: ModerationAction; targetBoardId: string }

type ModerationGovernanceFilter = "all" | "pinned" | "featured" | "locked"

export function ModerationAdminPanel({ boards, csrfToken, canReadAudit = false, session }: ModerationAdminPanelProps) {
  const [selectedBoardId, setSelectedBoardId] = useState("")
  const [query, setQuery] = useState("")
  const [appliedQuery, setAppliedQuery] = useState("")
  const [topics, setTopics] = useState<ModerationTopic[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [intent, setIntent] = useState<ModerationIntent | null>(null)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [reload, setReload] = useState(0)
  const [expandedHistoryTopicId, setExpandedHistoryTopicId] = useState<string | null>(null)
  const [revisionTopic, setRevisionTopic] = useState<ModerationTopic | null>(null)
  const [intentError, setIntentError] = useState("")
  const [governanceFilter, setGovernanceFilter] = useState<ModerationGovernanceFilter>("all")
  const [dateFilter, setDateFilter] = useState("all")
  const [pageSize, setPageSize] = useState(20)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const listRequestVersion = useRef(0)
  const loadMoreController = useRef<AbortController | null>(null)
  const submittingRef = useRef(false)

  const selectedBoard = boards.find((board) => board.id === selectedBoardId) ?? null
  const capabilitiesByBoard = useMemo(() => new Map(boards.map((board) => [board.id, new Set(board.capabilityKeys)])), [boards])
  const hasGovernancePermission = (selectedBoard ? [selectedBoard] : boards).some((board) =>
    ["moderation.topic", "moderation.topic.pin", "moderation.topic.feature", "moderation.topic.lock", "moderation.topic.move"].some((capability) => board.capabilityKeys.includes(capability)))
  const visibleTopics = useMemo(() => topics.filter((topic) => {
    const matchesGovernance = governanceFilter === "all" || topic[governanceFilter]
    const matchesDate = dateFilter === "all" || Date.parse(topic.publishedAt) >= Date.now() - Number(dateFilter) * 86_400_000
    return matchesGovernance && matchesDate
  }), [dateFilter, governanceFilter, topics])

  useEffect(() => {
    if (selectedBoardId && !boards.some((board) => board.id === selectedBoardId)) setSelectedBoardId("")
  }, [boards, selectedBoardId])

  useEffect(() => {
    if (!boards.length) {
      setTopics([])
      setNextCursor(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const requestVersion = ++listRequestVersion.current
    loadMoreController.current?.abort()
    setSelectedIds(new Set())
    setLoading(true)
    setLoadingMore(false)
    setError("")
    setMessage("")
    setTopics([])
    setNextCursor(null)
    setExpandedHistoryTopicId(null)
    setRevisionTopic(null)
    listModerationTopics({ boardId: selectedBoard?.id, query: appliedQuery, limit: pageSize, signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted || requestVersion !== listRequestVersion.current) return
        setTopics(page.topics)
        setNextCursor(page.nextCursor)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && requestVersion === listRequestVersion.current) setError(messageFor(reason, "主题治理队列暂时无法加载，请稍后重试。"))
      })
      .finally(() => { if (!controller.signal.aborted && requestVersion === listRequestVersion.current) setLoading(false) })
    return () => {
      controller.abort()
      loadMoreController.current?.abort()
    }
  }, [appliedQuery, boards.length, pageSize, reload, selectedBoard])

  async function loadMore() {
    if (!boards.length || !nextCursor || loadingMore) return
    const requestVersion = listRequestVersion.current
    const controller = new AbortController()
    loadMoreController.current?.abort()
    loadMoreController.current = controller
    setLoadingMore(true)
    setError("")
    try {
      const page = await listModerationTopics({ boardId: selectedBoard?.id, query: appliedQuery, cursor: nextCursor, limit: pageSize, signal: controller.signal })
      if (requestVersion !== listRequestVersion.current) return
      setTopics((current) => [...current, ...page.topics])
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (requestVersion === listRequestVersion.current && !controller.signal.aborted) setError(messageFor(reason, "更多主题暂时无法加载，请稍后重试。"))
    } finally {
      if (requestVersion === listRequestVersion.current) setLoadingMore(false)
      if (loadMoreController.current === controller) loadMoreController.current = null
    }
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    setAppliedQuery(query.trim())
  }

  function changeBoard(boardId: string) {
    setSelectedBoardId(boardId)
    setIntent(null)
    setExpandedHistoryTopicId(null)
    setGovernanceFilter("all")
  }

  const selectedTopics = visibleTopics.filter((topic) => selectedIds.has(topic.id))

  function resetFilters() {
    setSelectedBoardId("")
    setMessage("")
    setQuery("")
    setAppliedQuery("")
    setGovernanceFilter("all")
    setDateFilter("all")
    setSelectedIds(new Set())
  }

  function exportTopics() {
    const rows = selectedTopics.length ? selectedTopics : visibleTopics
    const csv = encodeCsv([
      ["主题 ID", "标题", "摘要", "作者", "用户名", "板块", "浏览", "回复", "点赞", "状态", "置顶", "精选", "锁定", "发布时间"],
      ...rows.map((topic) => [topic.id, moderationTopicDisplayTitle(topic), topic.excerpt, topic.author.displayName, topic.author.username, topic.board.name, topic.viewCount, topic.replyCount, topic.likeCount, moderationStatusLabel(topic.moderationStatus), topic.pinned ? "是" : "否", topic.featured ? "是" : "否", topic.locked ? "是" : "否", topic.publishedAt]),
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "主题管理-" + new Date().toLocaleDateString("sv-SE") + ".csv"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage("已导出 " + rows.length + " 条主题。")
  }

  function openModeration(topic: ModerationTopic, status: "hidden" | "rejected") {
    setIntent({ topic, status })
    setReason("")
    setIntentError("")
  }

  function openGovernance(topic: ModerationTopic, action: ModerationAction) {
    setIntent({ topic, action, targetBoardId: boards.find((board) => board.id !== topic.board.id && board.capabilityKeys.includes("moderation.topic.move"))?.id ?? "" })
    setReason("")
    setIntentError("")
  }

  function closeIntent() {
    if (!submitting) {
      setIntent(null)
      setIntentError("")
    }
  }

  function toggleHistory(topicId: string) {
    setExpandedHistoryTopicId((current) => current === topicId ? null : topicId)
  }

  async function submitIntent(event: React.FormEvent) {
    event.preventDefault()
    if (!intent || submittingRef.current) return
    const trimmedReason = reason.trim()
    if (("status" in intent || intent.action === "move") && trimmedReason.length < 2) {
      setIntentError("请填写至少 2 个字符的处理备注。")
      return
    }
    if ("action" in intent && intent.action === "move" && !intent.targetBoardId) {
      setIntentError("请选择目标板块。")
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setIntentError("")
    setMessage("")
    try {
      if ("status" in intent) {
        await moderateTopic(intent.topic.id, { status: intent.status, reason: trimmedReason }, csrfToken)
        setTopics((current) => current.filter((topic) => topic.id !== intent.topic.id))
        setMessage(`主题已${intent.status === "hidden" ? "隐藏" : "驳回"}。`)
      } else {
        const result = await governTopic(intent.topic.id, {
          action: intent.action,
          expectedRevision: intent.topic.governanceRevision,
          targetBoardId: intent.action === "move" ? intent.targetBoardId : undefined,
          reason: trimmedReason || undefined,
        }, csrfToken)
        if (intent.action === "move") {
          const destination = boards.find((board) => board.id === result.boardId)
          setTopics((current) => selectedBoardId || !destination
            ? current.filter((topic) => topic.id !== intent.topic.id)
            : current.map((topic) => topic.id === intent.topic.id ? { ...topic, board: { id: destination.id, slug: destination.slug, name: destination.name, tone: destination.tone }, pinned: result.isPinned, featured: result.isFeatured, locked: result.isLocked, governanceRevision: result.governanceRevision } : topic))
          setMessage("主题已移动到目标板块。")
        } else {
          setTopics((current) => current.map((topic) => topic.id === intent.topic.id
            ? { ...topic, pinned: result.isPinned, featured: result.isFeatured, locked: result.isLocked, governanceRevision: result.governanceRevision }
            : topic))
          setMessage(`主题已${governanceLabel(intent.action)}。`)
        }
      }
      setIntent(null)
    } catch (reasonValue) {
      setIntentError(messageFor(reasonValue, "主题操作失败，请刷新后重试。"))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const initialLoadFailed = !loading && topics.length === 0 && Boolean(error)
  const emptyMessage = !hasGovernancePermission
    ? "当前账号没有主题治理权限"
    : appliedQuery
      ? `未找到匹配“${appliedQuery}”的已发布主题`
      : selectedBoard ? "当前板块暂无已发布主题" : "当前权限范围内暂无已发布主题"

  return (
    <div className="admin-panel moderation-admin-panel moderation-admin-panel--focused moderation-admin-panel--catalog">
      <header className="topic-catalog-actions">
        <div className="topic-catalog-heading"><h1 id="admin-heading">主题管理</h1><p>管理社区已发布的主题，支持搜索、置顶、精选与内容治理。</p></div>
        <div><button type="button" className="secondary-button" disabled={loading || visibleTopics.length === 0} onClick={exportTopics}><Download size={15} aria-hidden="true" />{selectedTopics.length ? "导出选中 " + selectedTopics.length + " 条" : "导出当前结果"}</button>{session && <AdminTopicPublisher session={session} defaultBoardId={selectedBoard?.id} onPublished={() => setReload((value) => value + 1)} />}</div>
      </header>
      <section className="topic-catalog-stats" aria-label="已加载主题统计">
        {[{ label: "已加载主题", value: topics.length, icon: FileText, tone: "blue", detail: selectedBoard?.name ?? "全部有权治理的板块" }, { label: "已公开主题", value: topics.filter((topic) => topic.moderationStatus === "approved").length, icon: CheckCircle2, tone: "green", detail: "当前已加载的公开内容" }, { label: "已置顶", value: topics.filter((topic) => topic.pinned).length, icon: Pin, tone: "amber", detail: "当前已加载的置顶内容" }, { label: "已精选", value: topics.filter((topic) => topic.featured).length, icon: Star, tone: "rose", detail: "当前已加载的精选内容" }].map(({ label, value, icon: Icon, tone, detail }) => <div className="topic-catalog-stat" key={label}><span className={"topic-catalog-stat__icon topic-catalog-stat__icon--" + tone}><Icon size={24} aria-hidden="true" /></span><div><span>{label}</span><strong>{loading || initialLoadFailed ? "—" : value.toLocaleString("zh-CN")}</strong><small>{detail}</small></div></div>)}
      </section>
      <div className="moderation-workspace admin-catalog">
        <section className="moderation-main-column" aria-label="主题治理工作台">
          <div className="moderation-workbench-bar" role="group" aria-label="主题治理工具栏">
            <h2 className="sr-only">主题治理工作台</h2>
            {boards.length > 0 && <div className="moderation-toolbar">
              <label><span className="sr-only">治理板块</span><select aria-label="治理板块" value={selectedBoard?.id ?? ""} onChange={(event) => changeBoard(event.target.value)}><option value="">全部板块</option>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
              <form className="moderation-search" onSubmit={submitSearch}>
                <label><Search size={16} aria-hidden="true" /><input aria-label="搜索主题" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主题标题或内容关键词" /></label>
                <button className="primary-button" type="submit"><Search size={14} aria-hidden="true" />搜索</button>
              </form>
              <label><span className="sr-only">治理状态筛选</span><select aria-label="治理状态筛选" value={governanceFilter} onChange={(event) => setGovernanceFilter(event.target.value as ModerationGovernanceFilter)}><option value="all">全部治理状态</option><option value="pinned">已置顶</option><option value="featured">已精选</option><option value="locked">已锁定</option></select></label>
              <label><span className="sr-only">发布时间筛选</span><select aria-label="发布时间筛选" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">全部发布时间</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></label>
              <button className="secondary-button" type="button" onClick={resetFilters}>重置</button>
              <button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)} disabled={loading}><RefreshCw size={14} aria-hidden="true" />刷新</button>
            </div>}
            <p className="moderation-scope-note"><strong>权限范围：</strong>仅显示当前账号有权治理的内容；筛选、统计与导出基于已加载结果。</p>
          </div>
          <div className="admin-catalog-tabs" role="group" aria-label="治理快捷筛选">
            {([{ value: "all", label: "全部内容" }, { value: "pinned", label: "已置顶" }, { value: "featured", label: "已精选" }, { value: "locked", label: "已锁定" }] as const).map((filter) => <button key={filter.value} type="button" aria-pressed={governanceFilter === filter.value} onClick={() => setGovernanceFilter(filter.value)}>{filter.label}<span>{topics.filter((topic) => filter.value === "all" || topic[filter.value]).length}</span></button>)}
          </div>
          {selectedTopics.length > 0 && <div className="topic-catalog-selection-bar" role="group" aria-label="已选主题操作"><span>已选择 <strong>{selectedTopics.length}</strong> 条主题</span><button type="button" onClick={exportTopics}><Download size={14} aria-hidden="true" />导出所选</button><button type="button" onClick={() => setSelectedIds(new Set())}>取消选择</button></div>}
          {message && <p className="admin-inline-feedback" role="status"><CheckCircle2 size={16} aria-hidden="true" />{message}</p>}
          {error && !initialLoadFailed && <p className="form-alert" role="alert">{error}</p>}
          {loading ? <ModerationLoading /> : initialLoadFailed ? <ModerationLoadError message={error} onRetry={() => setReload((value) => value + 1)} /> : topics.length === 0 ? <div className="admin-empty moderation-empty" role="status"><CheckCircle2 size={22} aria-hidden="true" /><span>{emptyMessage}</span></div> : visibleTopics.length === 0 ? <div className="admin-empty moderation-empty" role="status"><Filter size={22} aria-hidden="true" /><span>{nextCursor ? "已加载结果中暂无匹配主题，可继续加载更多。" : "当前筛选条件下暂无主题"}</span><button className="secondary-button" type="button" onClick={resetFilters}>清除筛选</button></div> : <div className="moderation-topic-list" role="table" aria-label="主题治理队列">
            <div className="moderation-topic-list__header" role="rowgroup">
              <div className="moderation-topic-list__columns" role="row" aria-label="主题治理字段">
                <span role="columnheader"><input type="checkbox" aria-label="选择当前筛选结果" checked={visibleTopics.length > 0 && selectedTopics.length === visibleTopics.length} ref={(input) => { if (input) input.indeterminate = selectedTopics.length > 0 && selectedTopics.length < visibleTopics.length }} onChange={(event) => setSelectedIds(event.target.checked ? new Set(visibleTopics.map((topic) => topic.id)) : new Set())} /></span><span role="columnheader">主题内容</span><span role="columnheader">作者</span><span role="columnheader">所属板块</span><span role="columnheader">互动数据</span><span role="columnheader">内容状态</span><span role="columnheader">发布时间</span><span role="columnheader">操作</span>
              </div>
            </div>
            <div className="moderation-topic-list__items" role="rowgroup">
              {visibleTopics.map((topic) => <ModerationTopicRow key={topic.id} topic={topic} selected={selectedIds.has(topic.id)} onSelect={(checked) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(topic.id); else next.delete(topic.id); return next })} capabilities={capabilitiesByBoard.get(topic.board.id) ?? new Set()} canMove={Boolean(capabilitiesByBoard.get(topic.board.id)?.has("moderation.topic.move")) && boards.some((board) => board.id !== topic.board.id && board.capabilityKeys.includes("moderation.topic.move"))} canReadAudit={canReadAudit} historyExpanded={expandedHistoryTopicId === topic.id} onToggleHistory={() => toggleHistory(topic.id)} onViewRevisions={() => setRevisionTopic(topic)} onModerate={openModeration} onGovern={openGovernance} />)}
            </div>
          </div>}
          <footer className="admin-catalog-footer"><span>当前显示 {visibleTopics.length} 条 · 已加载 {topics.length} 条{selectedTopics.length > 0 && " · 已选 " + selectedTopics.length + " 条"}</span><div className="topic-catalog-pagination"><label><span className="sr-only">每次加载条数</span><select aria-label="每次加载条数" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={20}>每次 20 条</option><option value={50}>每次 50 条</option></select></label>{nextCursor ? <button className="secondary-button" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}加载更多</button> : <span>{loading ? "正在加载主题…" : initialLoadFailed ? "加载失败，请重试" : "已加载全部结果"}</span>}</div></footer>
        </section>
      </div>
      {expandedHistoryTopicId && <Drawer title="主题处理记录" onClose={() => setExpandedHistoryTopicId(null)}><div id={`topic-moderation-history-${expandedHistoryTopicId}`} className="admin-history-content"><TopicModerationHistory topicId={expandedHistoryTopicId} /></div></Drawer>}
      {canReadAudit && revisionTopic && <TopicRevisionDialog key={revisionTopic.id} topicId={revisionTopic.id} title={moderationTopicDisplayTitle(revisionTopic)} onClose={() => setRevisionTopic(null)} />}
      {intent && <ModerationIntentForm intent={intent} boards={boards} reason={reason} error={intentError} submitting={submitting} onReasonChange={(value) => { setReason(value); setIntentError("") }} onChangeTargetBoard={(targetBoardId) => { setIntent((current) => current && "action" in current ? { ...current, targetBoardId } : current); setIntentError("") }} onCancel={closeIntent} onSubmit={submitIntent} />}
    </div>
  )
}

function ModerationTopicRow({ topic, selected, onSelect, capabilities, canMove, canReadAudit, historyExpanded, onToggleHistory, onViewRevisions, onModerate, onGovern }: { topic: ModerationTopic; selected: boolean; onSelect: (checked: boolean) => void; capabilities: Set<string>; canMove: boolean; canReadAudit: boolean; historyExpanded: boolean; onToggleHistory: () => void; onViewRevisions: () => void; onModerate: (topic: ModerationTopic, status: "hidden" | "rejected") => void; onGovern: (topic: ModerationTopic, action: ModerationAction) => void }) {
  const historyId = `topic-moderation-history-${topic.id}`
  const menuId = `topic-moderation-actions-${topic.id}`
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const hasActions = capabilities.has("moderation.topic") || capabilities.has("moderation.topic.pin") || capabilities.has("moderation.topic.feature") || capabilities.has("moderation.topic.lock") || canMove || canReadAudit
  const displayTitle = moderationTopicDisplayTitle(topic)

  useEffect(() => {
    if (!menuOpen) return
    function closeMenu(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener("pointerdown", closeMenu)
    return () => document.removeEventListener("pointerdown", closeMenu)
  }, [menuOpen])

  function menuItems() {
    return [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [])]
  }

  function openMenu(target: "first" | "last" = "first") {
    setMenuOpen(true)
    queueMicrotask(() => {
      const items = menuItems()
      items[target === "last" ? items.length - 1 : 0]?.focus()
    })
  }

  function closeMenu(restoreFocus: boolean) {
    setMenuOpen(false)
    if (restoreFocus) queueMicrotask(() => menuTriggerRef.current?.focus())
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      openMenu("first")
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      openMenu("last")
    }
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = menuItems()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu(true)
      return
    }
    if (event.key === "Tab") {
      closeMenu(false)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      items[0]?.focus()
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      items.at(-1)?.focus()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      items[(index + 1 + items.length) % items.length]?.focus()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    }
  }

  function runAction(action: () => void) {
    menuTriggerRef.current?.focus()
    setMenuOpen(false)
    action()
  }

  return <div className={`moderation-topic-row${historyExpanded ? " moderation-topic-row--expanded" : ""}`} role="presentation">
    <div className="moderation-topic-row__cells" role="row" data-selected={selected || undefined}>
      <div className="topic-catalog-selection" role="cell"><input type="checkbox" aria-label={`选择主题：${displayTitle}`} checked={selected} onChange={(event) => onSelect(event.target.checked)} /></div>
      <div className="moderation-topic-row__body" data-label="主题" role="cell">
        <span className="topic-catalog-document" aria-hidden="true"><FileText size={23} /></span><div>
        <h3><a href={`#topic/${topic.id}`} title={displayTitle}>{displayTitle}</a></h3>
        <p>{topic.excerpt || "暂无摘要"}</p>
        </div>
      </div>
      <div className="moderation-topic-row__author" data-label="作者" role="cell"><span className="moderation-author-avatar" aria-hidden="true">{topic.author.avatarUrl ? <img src={topic.author.avatarUrl} alt="" /> : avatarInitial(topic.author.displayName)}</span><span className="moderation-author-identity"><strong>{topic.author.displayName}</strong><span>@{topic.author.username}</span></span></div>
      <div className="topic-catalog-board" data-label="所属板块" role="cell"><span className={`topic-catalog-board__badge topic-catalog-board__badge--${topic.board.tone}`}><Layers size={14} aria-hidden="true" />{topic.board.name}</span></div>
      <div className="moderation-topic-row__engagement" data-label="互动数据" role="cell"><span title="回复数"><MessageSquare size={13} aria-hidden="true" /><span className="sr-only">回复</span>{topic.replyCount}</span><span title="点赞数"><ThumbsUp size={13} aria-hidden="true" /><span className="sr-only">点赞</span>{topic.likeCount}</span><span title="浏览数"><Eye size={13} aria-hidden="true" /><span className="sr-only">浏览</span>{topic.viewCount}</span></div>
      <div className="moderation-topic-row__state" data-label="内容状态" role="cell"><span className={`moderation-status moderation-status--${topic.moderationStatus}`}>{moderationStatusLabel(topic.moderationStatus)}</span>{topic.pinned && <span className="moderation-state moderation-state--pinned">已置顶</span>}{topic.featured && <span className="moderation-state moderation-state--featured">已精选</span>}{topic.locked && <span className="moderation-state moderation-state--locked">已锁定</span>}</div>
      <div className="topic-catalog-date" data-label="发布时间" role="cell"><time dateTime={topic.publishedAt}>{formatDate(topic.publishedAt)}</time></div>
      <div ref={menuRef} className="moderation-topic-row__actions" data-label="操作" role="cell">
        {hasActions ? <>
          <button
            ref={menuTriggerRef}
            className="secondary-button moderation-action-trigger"
            type="button"
            aria-label={`操作：${displayTitle}`}
            title={`操作：${displayTitle}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onKeyDown={handleTriggerKeyDown}
            onClick={() => {
              if (menuOpen) closeMenu(false)
              else openMenu("first")
            }}
          >
            <Ellipsis size={18} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div id={menuId} className="moderation-action-menu" role="menu" aria-label={`主题操作：${displayTitle}`} onKeyDown={handleMenuKeyDown}>
              {capabilities.has("moderation.topic") && <>
                <button className="moderation-action--danger" type="button" role="menuitem" onClick={() => runAction(() => onModerate(topic, "hidden"))}>隐藏</button>
                <button className="moderation-action--danger" type="button" role="menuitem" onClick={() => runAction(() => onModerate(topic, "rejected"))}>驳回</button>
              </>}
              {capabilities.has("moderation.topic.pin") && <button className={topic.pinned ? "moderation-action--active" : ""} type="button" role="menuitem" onClick={() => runAction(() => onGovern(topic, topic.pinned ? "unpin" : "pin"))}>{topic.pinned ? "取消置顶" : "置顶"}</button>}
              {capabilities.has("moderation.topic.feature") && <button className={topic.featured ? "moderation-action--active" : ""} type="button" role="menuitem" onClick={() => runAction(() => onGovern(topic, topic.featured ? "unfeature" : "feature"))}>{topic.featured ? "取消精选" : "精选"}</button>}
              {capabilities.has("moderation.topic.lock") && <button type="button" role="menuitem" onClick={() => runAction(() => onGovern(topic, topic.locked ? "unlock" : "lock"))}>{topic.locked ? "解锁" : "锁定"}</button>}
              {canMove && <button type="button" role="menuitem" onClick={() => runAction(() => onGovern(topic, "move"))}>移动</button>}
              {canReadAudit && <button type="button" role="menuitem" aria-haspopup="dialog" onClick={() => runAction(onViewRevisions)}>查看修订历史</button>}
              {canReadAudit && <button type="button" role="menuitem" aria-expanded={historyExpanded} aria-controls={historyId} onClick={() => runAction(onToggleHistory)}>处理记录</button>}
            </div>
          )}
        </> : <span className="moderation-state--empty">—</span>}
      </div>
    </div>
  </div>
}

function ModerationIntentForm({ intent, boards, reason, error, submitting, onReasonChange, onChangeTargetBoard, onCancel, onSubmit }: { intent: ModerationIntent; boards: ModerationBoard[]; reason: string; error: string; submitting: boolean; onReasonChange: (value: string) => void; onChangeTargetBoard: (value: string) => void; onCancel: () => void; onSubmit: (event: React.FormEvent) => void }) {
  const moving = "action" in intent && intent.action === "move"
  const title = "status" in intent ? `${intent.status === "hidden" ? "隐藏" : "驳回"}主题` : `${governanceLabel(intent.action)}主题`
  const requiresReason = "status" in intent || moving
  const consequence = "status" in intent
    ? `${intent.status === "hidden" ? "隐藏" : "驳回"}后，主题会从当前已发布队列中移除。`
    : moving
      ? "移动后，主题将归入目标板块，原有内容和互动数据保留。"
      : `确认后将${governanceLabel(intent.action)}该主题。`
  return <ModalDialog titleId="moderation-intent-title" describedBy="moderation-intent-description" element="form" className={`moderation-intent${"status" in intent ? " moderation-intent--danger" : ""}`} backdropClassName="dialog-backdrop moderation-intent-backdrop" busy={submitting} onClose={onCancel} onSubmit={onSubmit} initialFocusSelector="textarea">
      <div className="moderation-intent__header">
        <div><h3 id="moderation-intent-title">{title}</h3><p id="moderation-intent-description" className="moderation-intent__description">{consequence}</p></div>
        <button className="icon-button" type="button" aria-label={`关闭${title}`} title={`关闭${title}`} onClick={onCancel} disabled={submitting}><X size={17} aria-hidden="true" /></button>
      </div>
      <div className="moderation-intent__topic"><span>当前主题</span><strong>{moderationTopicDisplayTitle(intent.topic)}</strong></div>
      {moving && <label><span>目标板块</span><select value={intent.targetBoardId} onChange={(event) => onChangeTargetBoard(event.target.value)} disabled={submitting}>{boards.filter((board) => board.id !== intent.topic.board.id && board.capabilityKeys.includes("moderation.topic.move")).map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>}
      <label><span>{requiresReason ? "处理备注" : "处理备注（可选）"}</span><textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} maxLength={1000} placeholder="记录本次操作原因，便于审计追溯" required={requiresReason} disabled={submitting} aria-invalid={Boolean(error)} aria-describedby="moderation-intent-note-help" /></label>
      <div id="moderation-intent-note-help" className="moderation-intent__note-help"><span>{requiresReason ? "必填，至少 2 个字符" : "可选"}</span><span aria-live="polite">{reason.length} / 1000</span></div>
      {error && <p className="form-alert moderation-intent__error" role="alert">{error}</p>}
      <div className="moderation-intent__actions"><button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>取消</button><button className={"status" in intent ? "danger-button" : "primary-button"} type="submit" disabled={submitting}>{submitting && <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />}确认{title}</button></div>
  </ModalDialog>
}

function ModerationLoading() { return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /><span>正在读取主题治理队列</span></div> }
function ModerationLoadError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="admin-state moderation-load-error" role="alert"><AlertCircle size={20} aria-hidden="true" /><span>{message}</span><button className="secondary-button" type="button" onClick={onRetry}>重试加载</button></div> }
function moderationTopicDisplayTitle(topic: ModerationTopic) { return topic.title.trim() || topic.excerpt.trim() || "无标题主题" }
function messageFor(reason: unknown, fallback: string) { return reason instanceof ModerationApiError && reason.status === 409 ? "主题已被其他操作更新，请刷新列表后重试" : reason instanceof ModerationApiError ? reason.message : fallback }
function moderationStatusLabel(status: ModerationStatus) { return status === "approved" ? "已公开" : status === "hidden" ? "已隐藏" : "已驳回" }
function governanceLabel(action: ModerationAction) { return ({ pin: "置顶", unpin: "取消置顶", feature: "精选", unfeature: "取消精选", lock: "锁定", unlock: "解锁", move: "移动" } as Record<ModerationAction, string>)[action] }
function avatarInitial(value: string) { return Array.from(value.trim())[0]?.toUpperCase() ?? "刀" }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) }
