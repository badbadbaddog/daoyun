import { FileSearch, LoaderCircle, PenLine, RefreshCw, Users2 } from "lucide-react"

import type { Topic } from "../types/community"
import type { FeedFilter, TopicTag } from "../types/community"
import { TopicRow } from "./TopicRow"

interface TopicFeedProps {
  topics: Topic[]
  activeFeed: FeedFilter
  tags: TopicTag[]
  selectedTag: string
  onTagChange: (tag: string) => void
  loadStatus: "loading" | "ready" | "error"
  onRetry: () => void
  onCompose: () => void
  onOpenTopic: (topicId: string) => void
  authenticated: boolean
  onLogin: () => void
  onToggleBookmark: (topicId: string) => void
  bookmarkPendingIds: ReadonlySet<string>
  onToggleLike: (topicId: string) => void
  likePendingIds: ReadonlySet<string>
  interactionError: string
  nextCursor?: string | null
  loadingMore?: boolean
  errorMore?: string | null
  onLoadMore?: () => void
  newTopicCount?: number
  onRevealNewTopics?: () => void
}
export function TopicFeed({
  topics,
  activeFeed,
  tags,
  selectedTag,
  onTagChange,
  loadStatus,
  onRetry,
  onCompose,
  onOpenTopic,
  authenticated,
  onLogin,
  onToggleBookmark,
  bookmarkPendingIds,
  onToggleLike,
  likePendingIds,
  interactionError,
  nextCursor = null,
  loadingMore = false,
  errorMore = null,
  onLoadMore,
  newTopicCount = 0,
  onRevealNewTopics,
}: TopicFeedProps) {
  const requiresLogin = activeFeed === "following" && !authenticated

  return (
    <section
      className="feed-section"
      id="feed-panel"
      role="tabpanel"
      tabIndex={0}
      aria-labelledby="feed-tabs feed-heading"
    >
      <div className="feed-heading-row">
        <div className="feed-heading-copy">
          <p>为你发现</p>
          <h1 id="feed-heading">社区发现</h1>
        </div>
        <button className="secondary-button mobile-compose" type="button" onClick={onCompose}>
          <PenLine size={16} />
          发布
        </button>
        <label className="tag-filter">
          <span className="sr-only">标签</span>
          <select aria-label="按标签筛选" value={selectedTag} onChange={(event) => onTagChange(event.target.value)}>
            <option value="">全部</option>
            {tags.map((tag) => <option value={tag.slug} key={tag.slug}>{tag.name}</option>)}
          </select>
        </label>
      </div>

      <div className="topic-list" aria-live="polite" aria-busy={loadStatus === "loading" || loadingMore}>
        {interactionError && <p className="interaction-alert" role="alert">{interactionError}</p>}
        {newTopicCount > 0 && onRevealNewTopics && (
          <button className="new-content-button" type="button" onClick={onRevealNewTopics}>
            有 {newTopicCount} 条新内容
          </button>
        )}
        {requiresLogin ? (
          <div className="empty-state" role="status">
            <Users2 size={28} aria-hidden="true" />
            <h2>登录后查看关注动态</h2>
            <p>这里会显示你所关注用户发布的公开主题。</p>
            <button className="primary-button empty-state__action" type="button" onClick={onLogin}>
              登录查看关注动态
            </button>
          </div>
        ) : loadStatus === "loading" ? (
          <div className="topic-loading topic-list-loading" role="status">
            <span className="sr-only">正在加载主题</span>
            <div aria-hidden="true">
              {[0, 1, 2, 3].map(index => <div className="topic-list-skeleton" key={index}>
                <span className="topic-list-skeleton__avatar" />
                <div className="topic-list-skeleton__copy"><span /><span /></div>
                <span className="topic-list-skeleton__stats" />
              </div>)}
            </div>
          </div>
        ) : loadStatus === "error" ? (
          <div className="empty-state" role="alert">
            <FileSearch size={28} aria-hidden="true" />
            <h2>主题暂时无法加载</h2>
            <p>请检查网络连接后重试。</p>
            <button className="secondary-button empty-state__action" type="button" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              重试加载主题
            </button>
          </div>
        ) : topics.length > 0 ? <>
          {topics.map((topic) => (
            <TopicRow
              topic={topic}
              key={topic.id}
              variant="list"
              statsPlacement="footer"
              identityVariant="feed"
              onOpen={onOpenTopic}
              onToggleBookmark={onToggleBookmark}
              bookmarkPending={bookmarkPendingIds.has(topic.id)}
              onToggleLike={onToggleLike}
              likePending={likePendingIds.has(topic.id)}
            />
          ))}
          {errorMore && <p className="interaction-alert" role="alert">{errorMore}</p>}
          {nextCursor && onLoadMore && (
            <button className="secondary-button feed-load-more" type="button" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? <><LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" />正在加载</> : errorMore ? "重试加载更多" : "加载更多"}
            </button>
          )}
        </> : (
          <div className="empty-state" role="status">
            <FileSearch size={28} aria-hidden="true" />
            <h2>{!selectedTag && activeFeed === "following" ? "关注的人还没有发布主题" : "没有找到相关主题"}</h2>
            <p>{selectedTag ? "试试其他标签，或查看全部主题。" : activeFeed === "following" ? "关注更多成员后，新主题会出现在这里。" : "切换上方分类，或分享你的第一篇主题。"}</p>
            {selectedTag ? <button className="secondary-button empty-state__action" type="button" onClick={() => onTagChange("")}>查看全部主题</button>
              : activeFeed === "following" ? <a className="secondary-button empty-state__action" href="#boards">浏览社区</a>
                : <button className="primary-button empty-state__action" type="button" onClick={onCompose}><PenLine size={15} aria-hidden="true" />发布第一篇主题</button>}
          </div>
        )}
      </div>
    </section>
  )
}
