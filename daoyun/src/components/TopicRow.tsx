import { useRef } from "react"
import { Bookmark, Eye, Flame, Heart, LoaderCircle, MessageCircle, MessageSquareText, Pin, Sparkles } from "lucide-react"

import type { Topic } from "../types/community"
import { topicDisplayTitle, topicHasTitle } from "../utils/topicPresentation"
import { PublicMemberIdentity } from "./PublicMemberIdentity"
import { UserAvatar } from "./UserAvatar"

const boardSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

interface TopicRowProps {
  topic: Topic
  variant?: "feed" | "board"
  statsPlacement?: "content" | "footer"
  identityVariant?: "compact" | "feed"
  onOpen?: (topicId: string) => void
  onToggleBookmark?: (topicId: string) => void
  onToggleLike?: (topicId: string) => void
  bookmarkPending: boolean
  likePending?: boolean
}
export function TopicRow({
  topic,
  variant = "feed",
  statsPlacement = "content",
  identityVariant = "compact",
  onOpen,
  onToggleBookmark,
  onToggleLike,
  bookmarkPending,
  likePending = false,
}: TopicRowProps) {
  const titleRef = useRef<HTMLAnchorElement>(null)
  // 展示类型只由 Post 自身内容决定；站点默认封面不能把纯文字讨论伪装成媒体内容。
  const mediaUrls = (topic.imageUrls?.length ? topic.imageUrls : topic.imageUrl ? [topic.imageUrl] : []).slice(0, 3)
  const displayTitle = topicDisplayTitle(topic)
  const hasTitle = topicHasTitle(topic)
  const layout = mediaUrls.length > 0 ? "media" : "discussion"
  const rhythm = variant === "feed" && layout === "discussion" && topic.replies >= 2
    ? "conversation"
    : "standard"
  const openTopic = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(topic.id)
  }

  const openRow = (event: React.MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (!(event.target instanceof Element)) return
    const control = event.target.closest("a, button, input, textarea, select, summary, [role='button'], [role='link'], [contenteditable], [tabindex]")
    if (control && event.currentTarget.contains(control)) return
    if (window.getSelection()?.toString()) return
    titleRef.current?.click()
  }

  const stats = (
    <div className={`topic-stats${statsPlacement === "footer" ? " topic-stats--footer" : ""}`} aria-label="主题数据">
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
  )

  return (
    <article
      className={`topic-row topic-row--${variant} topic-row--${layout}${rhythm === "conversation" ? " topic-row--conversation" : ""}${statsPlacement === "footer" ? " topic-row--stats-footer" : ""}`}
      data-layout={layout}
      data-media-count={mediaUrls.length}
      data-rhythm={rhythm}
      data-variant={variant}
      onClick={openRow}
    >
      {variant === "board" ? (
        <span
          className={`board-topic-marker board-topic-marker--${topic.pinned ? "pin" : topic.featured ? "featured" : topic.hot ? "hot" : "discussion"}`}
          role="img"
          aria-label={topic.pinned ? "置顶主题" : topic.featured ? "精华主题" : topic.hot ? "热议主题" : "普通主题"}
        >
          {topic.pinned
            ? <Pin size={15} aria-hidden="true" />
            : topic.featured
              ? <Sparkles size={15} aria-hidden="true" />
              : topic.hot
                ? <Flame size={15} aria-hidden="true" />
                : <MessageSquareText size={15} aria-hidden="true" />}
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
          <a href={`#topic/${topic.id}`} className="topic-title" onClick={openTopic} ref={titleRef}>
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
          {identityVariant === "feed" ? <>
            <span className="topic-author-meta">
              {variant === "board" ? (
                <a className="topic-author-avatar" href={`#user/${topic.authorUsername}`} aria-label={`查看 ${topic.author} 的主页`}>
                  <UserAvatar
                    username={topic.authorUsername}
                    displayName={topic.author}
                    avatarUrl={topic.avatarUrl}
                    size="small"
                  />
                </a>
              ) : null}
              <a href={`#user/${topic.authorUsername}`}>{topic.author}</a>
              <PublicMemberIdentity
                username={topic.authorUsername}
                variant={identityVariant}
                maxMedals={identityVariant === "feed" ? 1 : 2}
              />
            </span>
            <span className="topic-context-meta">
              <a className={`board-tag board-tag--${topic.boardTone}`} href={boardHref(topic.boardSlug)}>{topic.board}</a>
              <span aria-hidden="true">·</span>
              <time dateTime={topic.publishedAtIso}>{topic.publishedAt}</time>
              {topic.hot ? <span className="hot-label"><Flame size={12} />热议</span> : null}
            </span>
          </> : <>
            <a className={`board-tag board-tag--${topic.boardTone}`} href={boardHref(topic.boardSlug)}>{topic.board}</a>
            <a href={`#user/${topic.authorUsername}`}>{topic.author}</a>
            <PublicMemberIdentity username={topic.authorUsername} />
            <span aria-hidden="true">·</span>
            <time dateTime={topic.publishedAtIso}>{topic.publishedAt}</time>
            {topic.hot ? <span className="hot-label"><Flame size={12} />热议</span> : null}
          </>}
        </div>

        <div className="topic-stats topic-stats--content" aria-label="主题数据" hidden={statsPlacement === "footer"}>
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

      {mediaUrls.length > 0 ? (
        <a className={`topic-cover topic-cover--count-${mediaUrls.length}`} href={`#topic/${topic.id}`} tabIndex={-1} aria-hidden="true" onClick={openTopic}>
          {mediaUrls.map((imageUrl) => (
            <img key={imageUrl} src={imageUrl} alt="" loading="lazy" decoding="async" />
          ))}
        </a>
      ) : null}

      {statsPlacement === "footer" ? stats : null}

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
