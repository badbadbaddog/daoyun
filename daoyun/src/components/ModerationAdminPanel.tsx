import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, ChevronDown, Filter, Info, LoaderCircle, RefreshCw, Search, X } from "lucide-react"

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
import { TopicModerationHistory } from "./TopicModerationHistory"

interface ModerationAdminPanelProps {
  boards: ModerationBoard[]
  csrfToken: string
  canReadAudit?: boolean
}

type ModerationIntent =
  | { topic: ModerationTopic; status: "hidden" | "rejected" }
  | { topic: ModerationTopic; action: ModerationAction; targetBoardId: string }

type ModerationAuditFilter = "all" | ModerationStatus
type ModerationGovernanceFilter = "all" | "pinned" | "featured" | "locked"

export function ModerationAdminPanel({ boards, csrfToken, canReadAudit = false }: ModerationAdminPanelProps) {
  const [selectedBoardId, setSelectedBoardId] = useState(boards[0]?.id ?? "")
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
  const [visitedHistoryTopicIds, setVisitedHistoryTopicIds] = useState<Set<string>>(() => new Set())
  const [intentError, setIntentError] = useState("")
  const [auditFilter, setAuditFilter] = useState<ModerationAuditFilter>("all")
  const [governanceFilter, setGovernanceFilter] = useState<ModerationGovernanceFilter>("all")
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const listRequestVersion = useRef(0)
  const loadMoreController = useRef<AbortController | null>(null)
  const submittingRef = useRef(false)

  const selectedBoard = boards.find((board) => board.id === selectedBoardId) ?? boards[0] ?? null
  const selectedCapabilities = useMemo(() => new Set(selectedBoard?.capabilityKeys ?? []), [selectedBoard])
  const hasGovernancePermission = ["moderation.topic", "moderation.topic.pin", "moderation.topic.feature", "moderation.topic.lock", "moderation.topic.move"]
    .some((capability) => selectedCapabilities.has(capability))
  const canMove = selectedCapabilities.has("moderation.topic.move")
    && boards.some((board) => board.id !== selectedBoard?.id && board.capabilityKeys.includes("moderation.topic.move"))
  const visibleTopics = useMemo(() => topics.filter((topic) => {
    const matchesAudit = auditFilter === "all" || topic.moderationStatus === auditFilter
    const matchesGovernance = governanceFilter === "all" || topic[governanceFilter]
    return matchesAudit && matchesGovernance
  }), [auditFilter, governanceFilter, topics])

  useEffect(() => {
    if (!boards.some((board) => board.id === selectedBoardId)) setSelectedBoardId(boards[0]?.id ?? "")
  }, [boards, selectedBoardId])

  useEffect(() => {
    if (!selectedBoard) {
      setTopics([])
      setNextCursor(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const requestVersion = ++listRequestVersion.current
    loadMoreController.current?.abort()
    setLoading(true)
    setLoadingMore(false)
    setError("")
    setMessage("")
    setTopics([])
    setNextCursor(null)
    setExpandedHistoryTopicId(null)
    setVisitedHistoryTopicIds(new Set())
    listModerationTopics({ boardId: selectedBoard.id, query: appliedQuery, limit: 20, signal: controller.signal })
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
  }, [appliedQuery, reload, selectedBoard])

  async function loadMore() {
    if (!selectedBoard || !nextCursor || loadingMore) return
    const requestVersion = listRequestVersion.current
    const controller = new AbortController()
    loadMoreController.current?.abort()
    loadMoreController.current = controller
    setLoadingMore(true)
    setError("")
    try {
      const page = await listModerationTopics({ boardId: selectedBoard.id, query: appliedQuery, cursor: nextCursor, limit: 20, signal: controller.signal })
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
    setAuditFilter("all")
    setGovernanceFilter("all")
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
    setVisitedHistoryTopicIds((current) => {
      if (current.has(topicId)) return current
      const next = new Set(current)
      next.add(topicId)
      return next
    })
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
          setTopics((current) => current.filter((topic) => topic.id !== intent.topic.id))
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
  const emptyMessage = !selectedBoard || !hasGovernancePermission
    ? "当前账号没有主题治理权限"
    : appliedQuery
      ? `未找到匹配“${appliedQuery}”的已发布主题`
      : "当前板块暂无已发布主题"

  return (
    <div className="admin-panel moderation-admin-panel">
      <div className="moderation-workspace">
        <section className="moderation-main-column" aria-label="主题治理工作台">
          <nav className="moderation-breadcrumb" aria-label="面包屑">
            <span>站点管理</span><span aria-hidden="true">/</span><span>内容治理</span><span aria-hidden="true">/</span><strong>主题治理工作台</strong>
          </nav>
          <div className="moderation-workbench-bar" role="group" aria-label="主题治理工具栏">
            <div className="moderation-workbench-title"><h2>主题治理工作台</h2></div>
            {boards.length > 0 && <div className="moderation-toolbar">
              <label><span>治理板块</span><select aria-label="治理板块" value={selectedBoard?.id ?? ""} onChange={(event) => changeBoard(event.target.value)}>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
              <form className="moderation-search" onSubmit={submitSearch}>
                <label><input aria-label="搜索主题" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="请输入主题关键词" /></label>
                <button className="secondary-button" type="submit"><Search size={14} aria-hidden="true" />搜索</button>
              </form>
              <button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)} disabled={loading}><RefreshCw size={14} aria-hidden="true" />刷新</button>
            </div>}
            <p className="moderation-scope-note"><strong>权限范围：</strong>仅显示当前账号有权治理的已发布主题；支持加载更多。</p>
          </div>
          {error && !initialLoadFailed && <p className="form-alert" role="alert">{error}</p>}
          {loading ? <ModerationLoading /> : initialLoadFailed ? <ModerationLoadError message={error} onRetry={() => setReload((value) => value + 1)} /> : topics.length === 0 ? <div className="admin-empty moderation-empty" role="status"><CheckCircle2 size={22} aria-hidden="true" /><span>{emptyMessage}</span></div> : visibleTopics.length === 0 ? <div className="admin-empty moderation-empty" role="status"><Filter size={22} aria-hidden="true" /><span>当前筛选条件下暂无主题</span><button className="secondary-button" type="button" onClick={() => { setAuditFilter("all"); setGovernanceFilter("all") }}>清除筛选</button></div> : <div className="moderation-topic-list" role="table" aria-label="主题治理队列">
            <div className="moderation-topic-list__header" role="rowgroup">
              <div className="moderation-topic-list__columns" role="row" aria-label="主题治理字段">
                <span role="columnheader">所属板块</span><span role="columnheader">发布时间</span><span role="columnheader">主题标题 / 内容摘要</span><span role="columnheader">作者（昵称 / 用户名）</span><span role="columnheader">回复数</span><span role="columnheader">点赞数</span><span role="columnheader">浏览数</span><span role="columnheader">审核状态</span><span role="columnheader">治理状态</span><span role="columnheader">操作</span>
              </div>
            </div>
            <div className="moderation-topic-list__items" role="rowgroup">
              {visibleTopics.map((topic) => <ModerationTopicRow key={topic.id} topic={topic} capabilities={selectedCapabilities} canMove={canMove} canReadAudit={canReadAudit} historyExpanded={expandedHistoryTopicId === topic.id} historyVisited={visitedHistoryTopicIds.has(topic.id)} onToggleHistory={() => toggleHistory(topic.id)} onModerate={openModeration} onGovern={openGovernance} />)}
            </div>
          </div>}
          {nextCursor && <button className="secondary-button moderation-load-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}加载更多</button>}
        </section>
        <ModerationSidePanel auditFilter={auditFilter} governanceFilter={governanceFilter} message={message} error={intentError || error} open={sidePanelOpen} onAuditFilterChange={setAuditFilter} onGovernanceFilterChange={setGovernanceFilter} onClear={() => { setAuditFilter("all"); setGovernanceFilter("all") }} onClose={() => setSidePanelOpen(false)} />
      </div>
      <div className="moderation-mobile-toolbar" aria-label="移动端治理工具栏">
        <button type="button" aria-controls="moderation-side-panel" aria-expanded={sidePanelOpen} onClick={() => setSidePanelOpen((open) => !open)}><Filter size={15} aria-hidden="true" />筛选</button>
        <button type="button" onClick={() => setReload((value) => value + 1)} disabled={loading}><RefreshCw size={15} aria-hidden="true" />刷新</button>
        <button type="button" onClick={() => void loadMore()} disabled={!nextCursor || loadingMore}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}加载更多</button>
      </div>
      {intent && <ModerationIntentForm intent={intent} boards={boards} reason={reason} error={intentError} submitting={submitting} onReasonChange={(value) => { setReason(value); setIntentError("") }} onChangeTargetBoard={(targetBoardId) => { setIntent((current) => current && "action" in current ? { ...current, targetBoardId } : current); setIntentError("") }} onCancel={closeIntent} onSubmit={submitIntent} />}
    </div>
  )
}

function ModerationSidePanel({ auditFilter, governanceFilter, message, error, open, onAuditFilterChange, onGovernanceFilterChange, onClear, onClose }: { auditFilter: ModerationAuditFilter; governanceFilter: ModerationGovernanceFilter; message: string; error: string; open: boolean; onAuditFilterChange: (filter: ModerationAuditFilter) => void; onGovernanceFilterChange: (filter: ModerationGovernanceFilter) => void; onClear: () => void; onClose: () => void }) {
  return <aside id="moderation-side-panel" className={`moderation-side-panel${open ? " moderation-side-panel--open" : ""}`} aria-label="主题治理筛选与反馈">
    <header><strong>状态筛选</strong><button className="moderation-side-panel__clear" type="button" onClick={onClear}>清空</button><button className="icon-button moderation-side-panel__close" type="button" aria-label="关闭状态筛选" title="关闭状态筛选" onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
    <FilterGroup label="审核状态筛选" options={[{ value: "all", label: "全部" }, { value: "approved", label: "已公开" }, { value: "hidden", label: "已隐藏" }, { value: "rejected", label: "已驳回" }]} value={auditFilter} onChange={onAuditFilterChange} />
    <FilterGroup label="治理状态筛选" options={[{ value: "all", label: "全部" }, { value: "pinned", label: "已置顶" }, { value: "featured", label: "已精选" }, { value: "locked", label: "已锁定" }]} value={governanceFilter} onChange={onGovernanceFilterChange} />
    <section className="moderation-side-panel__section moderation-quick-actions" aria-labelledby="moderation-quick-actions-title">
      <h3 id="moderation-quick-actions-title">快捷操作</h3>
      <div><span>隐藏</span><span>驳回</span><span>移动板块</span></div>
      <p>请从对应主题的“操作”菜单执行</p>
    </section>
    <section className="moderation-side-panel__section" aria-label="近期反馈">
      <h3>近期反馈</h3>
      {message ? <div className="moderation-feedback moderation-feedback--success" role="status"><CheckCircle2 size={15} aria-hidden="true" /><div><strong>操作成功</strong><span>{message}</span></div></div> : error ? <div className="moderation-feedback moderation-feedback--error"><AlertCircle size={15} aria-hidden="true" /><div><strong>操作未完成</strong><span>{error}</span></div></div> : <div className="moderation-feedback moderation-feedback--empty"><Info size={15} aria-hidden="true" /><div><strong>暂无近期反馈</strong><span>完成治理操作后将在此显示结果</span></div></div>}
    </section>
    <section className="moderation-side-panel__section moderation-side-note" aria-labelledby="moderation-side-note-title">
      <h3 id="moderation-side-note-title"><Info size={14} aria-hidden="true" />说明</h3>
      <ul><li>隐藏或驳回的主题将从当前列表移除。</li><li>同一时间仅展开一条主题的处理记录。</li><li>必填备注至少 2 个字符，最多 1000 字。</li></ul>
    </section>
  </aside>
}

function FilterGroup<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return <div className="moderation-filter-group" role="group" aria-label={label}><strong>{label.replace("筛选", "")}</strong><div>{options.map((option) => <button key={option.value} className={`moderation-filter-chip moderation-filter-chip--${option.value}`} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></div>
}

function ModerationTopicRow({ topic, capabilities, canMove, canReadAudit, historyExpanded, historyVisited, onToggleHistory, onModerate, onGovern }: { topic: ModerationTopic; capabilities: Set<string>; canMove: boolean; canReadAudit: boolean; historyExpanded: boolean; historyVisited: boolean; onToggleHistory: () => void; onModerate: (topic: ModerationTopic, status: "hidden" | "rejected") => void; onGovern: (topic: ModerationTopic, action: ModerationAction) => void }) {
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
    <div className="moderation-topic-row__cells" role="row">
      <div className="moderation-topic-row__board" data-label="所属板块" role="cell">{topic.board.name}</div>
      <time className="moderation-topic-row__published" data-label="发布时间" dateTime={topic.publishedAt} role="cell">{formatDate(topic.publishedAt)}</time>
      <div className="moderation-topic-row__body" data-label="主题" role="cell">
        <h3><a href={`#topic/${topic.id}`}>{displayTitle}</a></h3>
        <p>{topic.excerpt || "暂无摘要"}</p>
      </div>
      <div className="moderation-topic-row__author" data-label="作者" role="cell"><span className="moderation-author-avatar" aria-hidden="true">{avatarInitial(topic.author.displayName)}</span><span className="moderation-author-identity"><strong>{topic.author.displayName}</strong><span>@{topic.author.username}</span></span></div>
      <div className="moderation-topic-row__metric" data-label="回复数" role="cell">{topic.replyCount}</div>
      <div className="moderation-topic-row__metric" data-label="点赞数" role="cell">{topic.likeCount}</div>
      <div className="moderation-topic-row__metric" data-label="浏览数" role="cell">{topic.viewCount}</div>
      <div className="moderation-topic-row__audit" data-label="审核状态" role="cell"><span className={`moderation-status moderation-status--${topic.moderationStatus}`}>{moderationStatusLabel(topic.moderationStatus)}</span></div>
      <div className="moderation-topic-row__state" data-label="治理状态" role="cell">{topic.pinned && <span className="moderation-state moderation-state--pinned">已置顶</span>}{topic.featured && <span className="moderation-state moderation-state--featured">已精选</span>}{topic.locked && <span className="moderation-state moderation-state--locked">已锁定</span>}{!topic.pinned && !topic.featured && !topic.locked && <span className="moderation-state--empty">—</span>}</div>
      <div ref={menuRef} className="moderation-topic-row__actions" data-label="操作" role="cell">
        {hasActions ? <>
          <button
            ref={menuTriggerRef}
            className="secondary-button moderation-action-trigger"
            type="button"
            aria-label={`操作：${displayTitle}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onKeyDown={handleTriggerKeyDown}
            onClick={() => {
              if (menuOpen) closeMenu(false)
              else openMenu("first")
            }}
          >
            操作<ChevronDown size={12} aria-hidden="true" />
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
              {canReadAudit && <button type="button" role="menuitem" aria-expanded={historyExpanded} aria-controls={historyId} onClick={() => runAction(onToggleHistory)}>处理记录</button>}
            </div>
          )}
        </> : <span className="moderation-state--empty">—</span>}
      </div>
    </div>
    {historyVisited && <div id={historyId} className="moderation-topic-row__history" role="row" hidden={!historyExpanded}><div role="cell" aria-colspan={10}><TopicModerationHistory topicId={topic.id} /></div></div>}
  </div>
}

function ModerationIntentForm({ intent, boards, reason, error, submitting, onReasonChange, onChangeTargetBoard, onCancel, onSubmit }: { intent: ModerationIntent; boards: ModerationBoard[]; reason: string; error: string; submitting: boolean; onReasonChange: (value: string) => void; onChangeTargetBoard: (value: string) => void; onCancel: () => void; onSubmit: (event: React.FormEvent) => void }) {
  const moving = "action" in intent && intent.action === "move"
  const title = "status" in intent ? `${intent.status === "hidden" ? "隐藏" : "驳回"}主题` : `${governanceLabel(intent.action)}主题`
  const requiresReason = "status" in intent || moving
  const consequence = "status" in intent
    ? `${intent.status === "hidden" ? "隐藏" : "驳回"}后，主题会从当前已发布队列中移除。`
    : moving
      ? "移动后，主题将从当前板块队列中移除。"
      : `确认后将${governanceLabel(intent.action)}该主题。`
  const dialogRef = useRef<HTMLFormElement | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    reasonRef.current?.focus()
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== "Tab") return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? [])
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function closeFromBackdrop(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !submitting) onCancel()
  }

  return <div className="dialog-backdrop moderation-intent-backdrop" onMouseDown={closeFromBackdrop}>
    <form ref={dialogRef} className={`moderation-intent${"status" in intent ? " moderation-intent--danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby="moderation-intent-title" aria-describedby="moderation-intent-description" aria-busy={submitting} onSubmit={onSubmit} onKeyDown={handleKeyDown}>
      <div className="moderation-intent__header">
        <div><h3 id="moderation-intent-title">{title}</h3><p id="moderation-intent-description" className="moderation-intent__description">{consequence}</p></div>
        <button className="icon-button" type="button" aria-label={`关闭${title}`} title={`关闭${title}`} onClick={onCancel} disabled={submitting}><X size={17} aria-hidden="true" /></button>
      </div>
      <div className="moderation-intent__topic"><span>当前主题</span><strong>{moderationTopicDisplayTitle(intent.topic)}</strong></div>
      {moving && <label><span>目标板块</span><select value={intent.targetBoardId} onChange={(event) => onChangeTargetBoard(event.target.value)} disabled={submitting}>{boards.filter((board) => board.id !== intent.topic.board.id && board.capabilityKeys.includes("moderation.topic.move")).map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>}
      <label><span>{requiresReason ? "处理备注" : "处理备注（可选）"}</span><textarea ref={reasonRef} value={reason} onChange={(event) => onReasonChange(event.target.value)} maxLength={1000} placeholder="记录本次操作原因，便于审计追溯" required={requiresReason} disabled={submitting} aria-invalid={Boolean(error)} aria-describedby="moderation-intent-note-help" /></label>
      <div id="moderation-intent-note-help" className="moderation-intent__note-help"><span>{requiresReason ? "必填，至少 2 个字符" : "可选"}</span><span aria-live="polite">{reason.length} / 1000</span></div>
      {error && <p className="form-alert moderation-intent__error" role="alert">{error}</p>}
      <div className="moderation-intent__actions"><button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>取消</button><button className={"status" in intent ? "danger-button" : "primary-button"} type="submit" disabled={submitting}>{submitting && <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />}确认{title}</button></div>
    </form>
  </div>
}

function ModerationLoading() { return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /><span>正在读取主题治理队列</span></div> }
function ModerationLoadError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="admin-state moderation-load-error" role="alert"><AlertCircle size={20} aria-hidden="true" /><span>{message}</span><button className="secondary-button" type="button" onClick={onRetry}>重试加载</button></div> }
function moderationTopicDisplayTitle(topic: ModerationTopic) { return topic.title.trim() || topic.excerpt.trim() || "无标题主题" }
function messageFor(reason: unknown, fallback: string) { return reason instanceof ModerationApiError && reason.status === 409 ? "主题已被其他操作更新，请刷新列表后重试" : reason instanceof ModerationApiError ? reason.message : fallback }
function moderationStatusLabel(status: ModerationStatus) { return status === "approved" ? "已公开" : status === "hidden" ? "已隐藏" : "已驳回" }
function governanceLabel(action: ModerationAction) { return ({ pin: "置顶", unpin: "取消置顶", feature: "精选", unfeature: "取消精选", lock: "锁定", unlock: "解锁", move: "移动" } as Record<ModerationAction, string>)[action] }
function avatarInitial(value: string) { return Array.from(value.trim())[0]?.toUpperCase() ?? "刀" }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }) }
