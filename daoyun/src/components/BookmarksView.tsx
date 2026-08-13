import { useEffect, useState } from "react"
import { ArrowLeft, Bookmark, FileSearch, LoaderCircle, RefreshCw } from "lucide-react"

import type { AuthSession } from "../api/auth"
import { listBookmarks, setTopicBookmark } from "../api/relations"
import type { Topic } from "../types/community"
import { TopicRow } from "./TopicRow"

interface BookmarksViewProps {
  session: AuthSession | null
  onBack: () => void
  onLogin: () => void
  onOpenTopic: (topicId: string) => void
  onBookmarkChanged?: (topicId: string, bookmarked: boolean) => void
}

type LoadStatus = "loading" | "ready" | "error"

export function BookmarksView({
  session,
  onBack,
  onLogin,
  onOpenTopic,
  onBookmarkChanged,
}: BookmarksViewProps) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<LoadStatus>(session ? "loading" : "ready")
  const [requestVersion, setRequestVersion] = useState(0)
  const [bookmarkPendingId, setBookmarkPendingId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [interactionError, setInteractionError] = useState("")

  useEffect(() => {
    if (!session) {
      setTopics([])
      setNextCursor(null)
      setStatus("ready")
      return
    }

    const controller = new AbortController()
    setStatus("loading")
    setInteractionError("")
    listBookmarks({ signal: controller.signal }).then((page) => {
      if (!controller.signal.aborted) {
        setTopics(page.topics)
        setNextCursor(page.nextCursor)
        setStatus("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) setStatus("error")
    })
    return () => controller.abort()
  }, [requestVersion, session])

  async function handleToggleBookmark(topicId: string) {
    if (!session) {
      onLogin()
      return
    }
    setBookmarkPendingId(topicId)
    setInteractionError("")
    try {
      const state = await setTopicBookmark(topicId, false, session.csrfToken)
      if (!state.bookmarked) {
        setTopics((current) => current.filter((topic) => topic.id !== topicId))
        onBookmarkChanged?.(topicId, false)
      }
    } catch {
      setInteractionError("收藏状态暂时无法更新。")
    } finally {
      setBookmarkPendingId(null)
    }
  }

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setInteractionError("")
    try {
      const page = await listBookmarks({ cursor: nextCursor })
      setTopics((current) => [
        ...current,
        ...page.topics.filter((topic) => !current.some((item) => item.id === topic.id)),
      ])
      setNextCursor(page.nextCursor)
    } catch {
      setInteractionError("更多收藏暂时无法加载。")
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section className="bookmarks-view" aria-labelledby="bookmarks-heading">
      <button className="detail-back" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        返回社区
      </button>
      <header className="bookmarks-view__header">
        <div>
          <p>个人内容</p>
          <h1 id="bookmarks-heading">我的收藏</h1>
        </div>
        <Bookmark size={20} aria-hidden="true" />
      </header>

      {!session ? (
        <div className="empty-state" role="status">
          <Bookmark size={28} aria-hidden="true" />
          <h2>登录后查看收藏</h2>
          <p>收藏的公开主题会集中显示在这里。</p>
          <button className="primary-button empty-state__action" type="button" onClick={onLogin}>
            登录查看收藏
          </button>
        </div>
      ) : status === "loading" ? (
        <div className="topic-loading" role="status">
          <LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" />
          正在加载收藏
        </div>
      ) : status === "error" ? (
        <div className="empty-state" role="alert">
          <FileSearch size={28} aria-hidden="true" />
          <h2>收藏暂时无法加载</h2>
          <p>请检查网络连接后重试。</p>
          <button className="secondary-button empty-state__action" type="button" onClick={() => setRequestVersion((value) => value + 1)}>
            <RefreshCw size={15} aria-hidden="true" />
            重试加载收藏
          </button>
        </div>
      ) : (
        <>
          {interactionError && <p className="interaction-alert" role="alert">{interactionError}</p>}
          {topics.length > 0 ? (
            <div className="topic-list">
              {topics.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  onOpen={onOpenTopic}
                  onToggleBookmark={handleToggleBookmark}
                  bookmarkPending={bookmarkPendingId === topic.id}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state" role="status">
              <Bookmark size={28} aria-hidden="true" />
              <h2>还没有收藏主题</h2>
              <p>在主题列表或详情中点击收藏即可添加。</p>
            </div>
          )}
          {nextCursor && (
            <div className="bookmarks-view__more">
              <button className="secondary-button" type="button" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore && <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />}
                {loadingMore ? "正在加载" : "加载更多"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
