import { Bookmark, Eye, Flame, Heart, LoaderCircle, MessageCircle, Pin, Sparkles } from "lucide-react"

import type { Topic } from "../types/community"
import { topicDisplayTitle, topicHasTitle } from "../utils/topicPresentation"
import { PublicMemberIdentity } from "./PublicMemberIdentity"
import { UserAvatar } from "./UserAvatar"

const boardSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

interface TopicRowProps {
  topic: Topic
  variant?: "feed" | "board"
  onOpen?: (topicId: string) => void
  onToggleBookmark?: (topicId: string) => void
  onToggleLike?: (topicId: string) => void
  bookmarkPending: boolean
  likePending?: boolean
}
export function TopicRow({
  topic,
  variant = "feed",
  onOpen,
  onToggleBookmark,
  onToggleLike,
  bookmarkPending,
  likePending = false,
}: TopicRowProps) {
  // 展示类型只由 Post 自身内容决定；站点默认封面不能把纯文字讨论伪装成媒体内容。
  const coverUrl = topic.imageUrl
  const displayTitle = topicDisplayTitle(topic)
  const hasTitle = topicHasTitle(topic)
  const layout = coverUrl ? "media" : "discussion"
  const rhythm = variant === "feed" && layout === "discussion" && topic.replies >= 2
    ? "conversation"
    : "standard"
  const boardMarker = topic.pinned
    ? { Icon: Pin, label: "置顶主题", tone: "pin" }
    : topic.hot
      ? { Icon: Flame, label: "热门主题", tone: "hot" }
      : topic.featured
        ? { Icon: Sparkles, label: "精华主题", tone: "featured" }
        : { Icon: MessageCircle, label: "讨论主题", tone: "discussion" }
  const BoardMarkerIcon = boardMarker.Icon
  const openTopic = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen) return
    event.preventDefault()
    onOpen(topic.id)
  }

  return (
    <article
      className={`topic-row topic-row--${variant} topic-row--${layout}${rhythm === "conversation" ? " topic-row--conversation" : ""}`}
      data-layout={layout}
      data-rhythm={rhythm}
      data-variant={variant}
    >
      {variant === "board" ? (
        <span
          className={`board-topic-marker board-topic-marker--${boardMarker.tone}`}
          role="img"
          aria-label={boardMarker.label}
        >
          <BoardMarkerIcon size={15} aria-hidden="true" />
        </span>
      ) : (
        <a className="topic-avatar" href={`#user/${topic.authorUsername}`} aria-label={`查看 ${topic.author} 的主页`}>
          <UserAvatar
            username={topic.authorUsername}
            displayName={topic.author}
            avatarUrl={topic.avatarUrl}
            size="medium"
          />
        </a>
      )}

      <div className="topic-content">
        <div className="topic-title-line">
          {variant === "feed" && topic.pinned ? <Pin className="topic-status topic-status--pin" size={14} aria-label="置顶" /> : null}
          {variant === "feed" && topic.featured ? <Sparkles className="topic-status topic-status--featured" size={14} aria-label="精华" /> : null}
          <a href={`#topic/${topic.id}`} className="topic-title" onClick={openTopic}>
            <h2>{displayTitle}</h2>
          </a>
          {variant === "board" && (topic.pinned || topic.featured || topic.hot) ? (
            <span className="board-topic-badges" aria-label="主题状态">
              {topic.pinned ? <span className="board-topic-badge">置顶</span> : null}
              {topic.featured ? <span className="board-topic-badge board-topic-badge--featured">精华</span> : null}
              {topic.hot ? <span className="board-topic-badge board-topic-badge--hot">热议</span> : null}
            </span>
          ) : null}
        </div>

        {hasTitle && <p className="topic-excerpt">{topic.excerpt}</p>}

        {topic.tags.length > 0 && (
          <div className="topic-tags" aria-label="主题标签">
            {topic.tags.map((tag) => <span className="topic-tag" key={tag.slug}>#{tag.name}</span>)}
          </div>
        )}

        <div className="topic-meta">
          <a className={`board-tag board-tag--${topic.boardTone}`} href={boardHref(topic.boardSlug)}>{topic.board}</a>
          <a href={`#user/${topic.authorUsername}`}>{topic.author}</a>
          <PublicMemberIdentity username={topic.authorUsername} />
          <span aria-hidden="true">·</span>
          <time dateTime={topic.publishedAtIso}>{topic.publishedAt}</time>
          {topic.hot ? (
            <span className="hot-label"><Flame size={12} />热议</span>
          ) : null}
        </div>

        <div className="topic-stats" aria-label="主题数据">
          <span title={`${topic.replies} 条回复`}><MessageCircle size={14} />{topic.replies}</span>
          {onToggleLike ? (
            <button
              className={`topic-like${topic.liked ? " topic-like--active" : ""}`}
              type="button"
              aria-label={`${topic.liked ? "取消点赞" : "点赞"}主题：${displayTitle}`}
              aria-pressed={topic.liked === true}
              title={topic.liked ? "取消点赞" : "点赞"}
              disabled={likePending}
              onClick={() => onToggleLike(topic.id)}
            >
              {likePending
                ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />
                : <Heart size={14} fill={topic.liked ? "currentColor" : "none"} aria-hidden="true" />}
              <span>{topic.likes}</span>
            </button>
          ) : (
            <span title={`${topic.likes} 次点赞`}><Heart size={14} fill={topic.liked ? "currentColor" : "none"} />{topic.likes}</span>
          )}
          <span title={`${topic.views} 次浏览`}><Eye size={14} />{topic.views}</span>
        </div>
      </div>

      {coverUrl ? (
        <a className="topic-cover" href={`#topic/${topic.id}`} tabIndex={-1} aria-hidden="true" onClick={openTopic}>
          <img src={coverUrl} alt="" />
        </a>
      ) : null}

      {onToggleBookmark && <button
        className={`topic-bookmark${topic.bookmarked ? " topic-bookmark--active" : ""}`}
        type="button"
        aria-label={bookmarkPending
          ? `正在${topic.bookmarked ? "取消收藏" : "收藏"}主题：${displayTitle}`
          : `${topic.bookmarked ? "取消收藏" : "收藏"}主题：${displayTitle}`}
        aria-pressed={topic.bookmarked === true}
        title={topic.bookmarked ? "取消收藏" : "收藏"}
        disabled={bookmarkPending}
        onClick={() => onToggleBookmark(topic.id)}
      >
        {bookmarkPending
          ? <LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" />
          : <Bookmark size={16} fill={topic.bookmarked ? "currentColor" : "none"} aria-hidden="true" />}
      </button>}
    </article>
  )
}

function boardHref(slug: string | undefined): string {
  return slug && boardSlugPattern.test(slug) ? `#board/${slug}` : "#boards"
}
