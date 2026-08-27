import { useEffect, useRef, useState } from "react"
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react"

import {
  listTopicModerationHistory,
  ModerationApiError,
  type TopicModerationHistoryAction,
  type TopicModerationHistoryEntry,
} from "../api/moderation"

interface TopicModerationHistoryProps {
  topicId: string
}

export function TopicModerationHistory({ topicId }: TopicModerationHistoryProps) {
  const [entries, setEntries] = useState<TopicModerationHistoryEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const requestVersion = useRef(0)
  const loadMoreController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const version = ++requestVersion.current
    loadMoreController.current?.abort()
    setLoading(true)
    setLoadingMore(false)
    setError("")
    setEntries([])
    setNextCursor(null)
    listTopicModerationHistory({ topicId, limit: 20, signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted || version !== requestVersion.current) return
        setEntries(sortHistoryNewestFirst(page.entries))
        setNextCursor(page.nextCursor)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && version === requestVersion.current) {
          setError(historyErrorMessage(reason))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && version === requestVersion.current) setLoading(false)
      })
    return () => {
      controller.abort()
      loadMoreController.current?.abort()
    }
  }, [reload, topicId])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    const version = requestVersion.current
    const controller = new AbortController()
    loadMoreController.current?.abort()
    loadMoreController.current = controller
    setLoadingMore(true)
    setError("")
    try {
      const page = await listTopicModerationHistory({ topicId, cursor: nextCursor, limit: 20, signal: controller.signal })
      if (controller.signal.aborted || version !== requestVersion.current) return
      setEntries((current) => sortHistoryNewestFirst([...current, ...page.entries]))
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (!controller.signal.aborted && version === requestVersion.current) setError(historyErrorMessage(reason))
    } finally {
      if (version === requestVersion.current) setLoadingMore(false)
      if (loadMoreController.current === controller) loadMoreController.current = null
    }
  }

  return (
    <section className="topic-moderation-history" aria-label="主题处理记录">
      <header><div><strong>处理记录</strong><span>审核与治理操作按时间倒序排列</span></div></header>
      {loading ? (
        <p className="topic-moderation-history__state" role="status"><LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />正在读取处理记录</p>
      ) : error && entries.length === 0 ? (
        <div className="topic-moderation-history__state" role="alert"><AlertCircle size={15} aria-hidden="true" /><span>{error}</span><button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>
      ) : entries.length === 0 ? (
        <p className="topic-moderation-history__state" role="status">暂无处理记录</p>
      ) : (
        <div className="topic-moderation-history__table" role="table" aria-label="处理记录">
          <div className="topic-moderation-history__columns" role="row" aria-label="处理记录字段"><span role="columnheader">操作类型</span><span role="columnheader">来源</span><span role="columnheader">处理时间</span><span role="columnheader">处理备注</span><span role="columnheader">管理员</span><span role="columnheader">记录编号</span></div>
          <ul className="topic-moderation-history__list" role="rowgroup">
            {entries.map((entry) => (
              <li key={entry.id} role="row">
                <strong className="topic-moderation-history__action" data-action={entry.action} data-label="操作类型" role="cell">{historyActionLabel(entry.action)}</strong>
                <span className="topic-moderation-history__source" data-label="来源" role="cell">{entry.source === "moderation" ? "审核" : "治理"}</span>
                <time data-label="处理时间" dateTime={entry.createdAt} role="cell">{formatDate(entry.createdAt)}</time>
                <p data-label="处理备注" role="cell">{entry.reason || "未填写处理备注"}</p>
                <span className="topic-moderation-history__actor" data-label="管理员" role="cell">{entry.actor.displayName}<small>@{entry.actor.username}</small></span>
                <code data-label="记录编号" title={entry.id} role="cell">{entry.id}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && entries.length > 0 && <p className="form-alert" role="alert">{error}</p>}
      {nextCursor && !loading && <button className="secondary-button topic-moderation-history__more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}加载更多记录</button>}
    </section>
  )
}

function historyErrorMessage(reason: unknown) {
  return reason instanceof ModerationApiError ? reason.message : "处理记录暂时无法加载，请稍后重试。"
}

function historyActionLabel(action: TopicModerationHistoryAction) {
  return ({ approved: "公开", hidden: "隐藏", rejected: "驳回", pin: "置顶", unpin: "取消置顶", feature: "精选", unfeature: "取消精选", lock: "锁定", unlock: "解锁", move: "移动" } as Record<TopicModerationHistoryAction, string>)[action]
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}

function sortHistoryNewestFirst(entries: TopicModerationHistoryEntry[]) {
  return [...entries].sort((left, right) => {
    const timeDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return Number.isNaN(timeDifference) || timeDifference === 0 ? right.id.localeCompare(left.id) : timeDifference
  })
}
