import { CircleUserRound, FileSearch, Image, Link2, LoaderCircle, PenLine, RefreshCw, Users2 } from "lucide-react"

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
          <span>标签</span>
          <select aria-label="按标签筛选" value={selectedTag} onChange={(event) => onTagChange(event.target.value)}>
            <option value="">全部标签</option>
            {tags.map((tag) => <option value={tag.slug} key={tag.slug}>{tag.name}</option>)}
          </select>
        </label>
      </div>

      <div className="composer-prompt">
        <span className="composer-prompt__icon" aria-hidden="true"><CircleUserRound size={18} /></span>
        <button className="composer-prompt__text" type="button" onClick={onCompose}>分享此刻的想法</button>
        <button className="composer-prompt__action" type="button" onClick={onCompose} aria-label="添加图片" title="添加图片">
          <Image size={17} aria-hidden="true" />
        </button>
        <button className="composer-prompt__action" type="button" onClick={onCompose} aria-label="添加链接" title="添加链接">
          <Link2 size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="topic-list" aria-live="polite" aria-busy={loadStatus === "loading"}>
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
          <div className="topic-loading" role="status">
            <LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" />
            <span>正在加载主题</span>
          </div>
        ) : loadStatus === "error" ? (
          <div className="empty-state" role="alert">
            <FileSearch size={28} />
            <h2>主题暂时无法加载</h2>
            <p>请检查网络连接后重试。</p>
            <button className="secondary-button" type="button" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              重试加载主题
            </button>
          </div>
        ) : topics.length > 0 ? <>
          {topics.map((topic) => (
            <TopicRow
              topic={topic}
              key={topic.id}
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
              {loadingMore ? <><LoaderCircle className="topic-loading__spinner" size={16} />正在加载</> : "加载更多"}
            </button>
          )}
        </> : (
          <div className="empty-state" role="status">
            <FileSearch size={28} />
            <h2>{activeFeed === "following" ? "关注的人还没有发布主题" : "没有找到相关主题"}</h2>
            <p>{activeFeed === "following" ? "关注更多成员后，新主题会出现在这里。" : "换一个关键词或 Feed 分类。"}</p>
          </div>
        )}
      </div>
    </section>
  )
}
