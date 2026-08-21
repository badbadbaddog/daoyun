import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRightLeft, CheckCircle2, EyeOff, LoaderCircle, Lock, Pin, RefreshCw, Search, Sparkles } from "lucide-react"

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

interface ModerationAdminPanelProps {
  boards: ModerationBoard[]
  csrfToken: string
}

type ModerationIntent =
  | { topic: ModerationTopic; status: "hidden" | "rejected" }
  | { topic: ModerationTopic; action: ModerationAction; targetBoardId: string }

export function ModerationAdminPanel({ boards, csrfToken }: ModerationAdminPanelProps) {
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
  const listRequestVersion = useRef(0)
  const loadMoreController = useRef<AbortController | null>(null)

  const selectedBoard = boards.find((board) => board.id === selectedBoardId) ?? boards[0] ?? null
  const selectedCapabilities = useMemo(() => new Set(selectedBoard?.capabilityKeys ?? []), [selectedBoard])
  const canModerate = selectedCapabilities.has("moderation.topic")
  const canMove = selectedCapabilities.has("moderation.topic.move")
    && boards.some((board) => board.id !== selectedBoard?.id && board.capabilityKeys.includes("moderation.topic.move"))

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
  }

  function openModeration(topic: ModerationTopic, status: "hidden" | "rejected") {
    setIntent({ topic, status })
    setReason("")
    setError("")
  }

  function openGovernance(topic: ModerationTopic, action: ModerationAction) {
    setIntent({ topic, action, targetBoardId: boards.find((board) => board.id !== topic.board.id && board.capabilityKeys.includes("moderation.topic.move"))?.id ?? "" })
    setReason("")
    setError("")
  }

  function closeIntent() {
    if (!submitting) setIntent(null)
  }

  async function submitIntent(event: React.FormEvent) {
    event.preventDefault()
    if (!intent) return
    const trimmedReason = reason.trim()
    if (("status" in intent || intent.action === "move") && trimmedReason.length < 2) {
      setError("请填写至少 2 个字符的处理备注。")
      return
    }
    if ("action" in intent && intent.action === "move" && !intent.targetBoardId) {
      setError("请选择目标板块。")
      return
    }
    setSubmitting(true)
    setError("")
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
      setError(messageFor(reasonValue, "主题操作失败，请刷新后重试。"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-panel moderation-admin-panel">
      <div className="admin-panel__heading">
        <div><p>内容治理</p><h2>主题治理工作台</h2></div>
        <span className="admin-badge">{selectedBoard ? selectedBoard.name : "无可治理板块"}</span>
      </div>
      <p className="moderation-scope-note">仅显示当前账号有权治理的已发布主题；隐藏或驳回后，主题会从当前队列移除。</p>
      {boards.length > 0 && <div className="moderation-toolbar">
        <label><span>治理板块</span><select value={selectedBoard?.id ?? ""} onChange={(event) => changeBoard(event.target.value)}>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
        <form className="moderation-search" onSubmit={submitSearch}>
          <label><span>搜索主题</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题或正文摘要" /></label>
          <button className="secondary-button" type="submit"><Search size={14} aria-hidden="true" />搜索</button>
        </form>
        <button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)} disabled={loading}><RefreshCw size={14} aria-hidden="true" />刷新</button>
      </div>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
      {loading ? <ModerationLoading /> : topics.length === 0 ? <div className="admin-empty" role="status"><CheckCircle2 size={22} aria-hidden="true" /><span>{canModerate ? "当前板块暂无已发布主题" : "当前账号没有主题治理权限"}</span></div> : <div className="moderation-topic-list" aria-label="主题治理队列">
        {topics.map((topic) => <ModerationTopicRow key={topic.id} topic={topic} capabilities={selectedCapabilities} canMove={canMove} onModerate={openModeration} onGovern={openGovernance} />)}
      </div>}
      {nextCursor && <button className="secondary-button moderation-load-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}加载更多</button>}
      {intent && <ModerationIntentForm intent={intent} boards={boards} reason={reason} submitting={submitting} onReasonChange={setReason} onChangeTargetBoard={(targetBoardId) => setIntent((current) => current && "action" in current ? { ...current, targetBoardId } : current)} onCancel={closeIntent} onSubmit={submitIntent} />}
    </div>
  )
}

function ModerationTopicRow({ topic, capabilities, canMove, onModerate, onGovern }: { topic: ModerationTopic; capabilities: Set<string>; canMove: boolean; onModerate: (topic: ModerationTopic, status: "hidden" | "rejected") => void; onGovern: (topic: ModerationTopic, action: ModerationAction) => void }) {
  return <article className="moderation-topic-row">
    <div className="moderation-topic-row__body">
      <header><span>{topic.board.name}</span><time dateTime={topic.publishedAt}>{formatDate(topic.publishedAt)}</time></header>
      <h3><a href={`#topic/${topic.id}`}>{topic.title}</a></h3>
      <p>{topic.excerpt || "暂无摘要"}</p>
      <footer><span>{topic.author.displayName} · @{topic.author.username}</span><span>{topic.replyCount} 回复 · {topic.likeCount} 赞 · {topic.viewCount} 浏览</span></footer>
    </div>
    <div className="moderation-topic-row__state"><span className="moderation-status">{moderationStatusLabel(topic.moderationStatus)}</span>{topic.pinned && <span>已置顶</span>}{topic.featured && <span>已精选</span>}{topic.locked && <span>已锁定</span>}</div>
    <div className="moderation-topic-row__actions" aria-label={`主题操作：${topic.title}`}>
      {capabilities.has("moderation.topic") && <><button className="secondary-button" type="button" onClick={() => onModerate(topic, "hidden")}><EyeOff size={14} aria-hidden="true" />隐藏</button><button className="secondary-button" type="button" onClick={() => onModerate(topic, "rejected")}>驳回</button></>}
      {capabilities.has("moderation.topic.pin") && <button className="secondary-button" type="button" onClick={() => onGovern(topic, topic.pinned ? "unpin" : "pin")}><Pin size={14} aria-hidden="true" />{topic.pinned ? "取消置顶" : "置顶"}</button>}
      {capabilities.has("moderation.topic.feature") && <button className="secondary-button" type="button" onClick={() => onGovern(topic, topic.featured ? "unfeature" : "feature")}><Sparkles size={14} aria-hidden="true" />{topic.featured ? "取消精选" : "精选"}</button>}
      {capabilities.has("moderation.topic.lock") && <button className="secondary-button" type="button" onClick={() => onGovern(topic, topic.locked ? "unlock" : "lock")}><Lock size={14} aria-hidden="true" />{topic.locked ? "解锁" : "锁定"}</button>}
      {canMove && <button className="secondary-button" type="button" onClick={() => onGovern(topic, "move")}><ArrowRightLeft size={14} aria-hidden="true" />移动</button>}
    </div>
  </article>
}

function ModerationIntentForm({ intent, boards, reason, submitting, onReasonChange, onChangeTargetBoard, onCancel, onSubmit }: { intent: ModerationIntent; boards: ModerationBoard[]; reason: string; submitting: boolean; onReasonChange: (value: string) => void; onChangeTargetBoard: (value: string) => void; onCancel: () => void; onSubmit: (event: React.FormEvent) => void }) {
  const moving = "action" in intent && intent.action === "move"
  const title = "status" in intent ? `${intent.status === "hidden" ? "隐藏" : "驳回"}主题` : `${governanceLabel(intent.action)}主题`
  return <form className="moderation-intent" aria-label={title} onSubmit={onSubmit}>
    <div><h3>{title}</h3><p>{intent.topic.title}</p></div>
    {moving && <label><span>目标板块</span><select value={intent.targetBoardId} onChange={(event) => onChangeTargetBoard(event.target.value)}>{boards.filter((board) => board.id !== intent.topic.board.id && board.capabilityKeys.includes("moderation.topic.move")).map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>}
    <label><span>{"status" in intent || moving ? "处理备注" : "处理备注（可选）"}</span><textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} maxLength={1000} placeholder="记录本次操作原因，便于审计追溯" required={"status" in intent || moving} /></label>
    <div className="moderation-intent__actions"><button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>取消</button><button className="primary-button" type="submit" disabled={submitting}>{submitting && <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />}确认{title}</button></div>
  </form>
}

function ModerationLoading() { return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /><span>正在读取主题治理队列</span></div> }
function messageFor(reason: unknown, fallback: string) { return reason instanceof ModerationApiError && reason.status === 409 ? "主题已被其他操作更新，请刷新列表后重试。" : reason instanceof ModerationApiError ? reason.message : fallback }
function moderationStatusLabel(status: ModerationStatus) { return status === "approved" ? "已公开" : status === "hidden" ? "已隐藏" : "已驳回" }
function governanceLabel(action: ModerationAction) { return ({ pin: "置顶", unpin: "取消置顶", feature: "精选", unfeature: "取消精选", lock: "锁定", unlock: "解锁", move: "移动" } as Record<ModerationAction, string>)[action] }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }) }
