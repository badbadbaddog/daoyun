import { useRef, useState } from "react"
import { Bookmark, Flame, Heart, LoaderCircle, MessageCircle, MessageSquareText, Pin, Sparkles } from "lucide-react"

import type { Topic } from "../types/community"
import { topicDisplayTitle, topicHasTitle } from "../utils/topicPresentation"
import { ImagePreviewDialog, type ImagePreviewSelection } from "./ImagePreviewDialog"
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

export function TopicRow({ topic, variant = "feed", statsPlacement = "content", identityVariant = "compact", onOpen, onToggleBookmark, onToggleLike, bookmarkPending, likePending = false }: TopicRowProps) {
  const [preview, setPreview] = useState<ImagePreviewSelection | null>(null)
  const titleRef = useRef<HTMLAnchorElement>(null)
  const isFeed = variant === "feed"
  const footerActions = isFeed || statsPlacement === "footer"
  // 只使用服务端提供的公开预览，站点默认封面不能充当帖子图片。
  const mediaUrls = (topic.imageUrls?.length ? topic.imageUrls : topic.imageUrl ? [topic.imageUrl] : []).slice(0, 3)
  const displayTitle = topicDisplayTitle(topic)
  const hasTitle = topicHasTitle(topic)
  const layout = mediaUrls.length ? "media" : "discussion"
  const rhythm = isFeed && layout === "discussion" && topic.replies >= 2 ? "conversation" : "standard"
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
  const bookmark = onToggleBookmark && (
    <button className={`topic-bookmark${topic.bookmarked ? " topic-bookmark--active" : ""}`} type="button"
      aria-label={`${bookmarkPending ? "正在" : ""}${topic.bookmarked ? "取消收藏" : "收藏"}主题：${displayTitle}`}
      aria-pressed={topic.bookmarked === true} title={topic.bookmarked ? "取消收藏" : "收藏"}
      disabled={bookmarkPending} onClick={() => onToggleBookmark(topic.id)}>
      {bookmarkPending
        ? <LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" />
        : <Bookmark size={16} fill={topic.bookmarked ? "currentColor" : "none"} aria-hidden="true" />}
      {isFeed ? <span>{topic.bookmarked ? "已收藏" : "收藏"}</span> : null}
    </button>
  )
  const stats = (
    <div className={`topic-stats topic-stats--${footerActions ? "footer" : "content"}`} role="group" aria-label="主题操作">
      {onToggleLike ? (
        <button className={`topic-like${topic.liked ? " topic-like--active" : ""}`} type="button"
          aria-label={`${topic.liked ? "取消点赞" : "点赞"}主题：${displayTitle}`} aria-pressed={topic.liked === true}
          title={topic.liked ? "取消点赞" : "点赞"} disabled={likePending} onClick={() => onToggleLike(topic.id)}>
          {likePending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />
            : <Heart size={14} fill={topic.liked ? "currentColor" : "none"} aria-hidden="true" />}
          <span>{topic.likes}</span>
        </button>
      ) : <span title={`${topic.likes} 次点赞`}><Heart size={14} fill={topic.liked ? "currentColor" : "none"} aria-hidden="true" />{topic.likes}</span>}
      <a className="topic-reply" href={`#topic/${topic.id}`} onClick={openTopic} aria-label={`回复主题：${displayTitle}`} title={`${topic.replies} 条回复`}>
          <MessageCircle size={14} aria-hidden="true" /><span>{topic.replies}</span>
      </a>
      {bookmark}
    </div>
  )
  const metadata = (
    <div className="topic-meta">
      {isFeed || identityVariant === "feed" ? <>
        {isFeed ? <a className="topic-avatar" href={`#user/${topic.authorUsername}`} aria-label={`查看 ${topic.author} 的主页`}>
          <UserAvatar username={topic.authorUsername} displayName={topic.author} avatarUrl={topic.avatarUrl} size="medium" />
        </a> : null}
        <span className="topic-author-meta">
          {!isFeed ? <a className="topic-author-avatar" href={`#user/${topic.authorUsername}`} aria-label={`查看 ${topic.author} 的主页`}>
            <UserAvatar username={topic.authorUsername} displayName={topic.author} avatarUrl={topic.avatarUrl} size="small" />
          </a> : null}
          <a href={`#user/${topic.authorUsername}`}>{topic.author}</a>
          <PublicMemberIdentity username={topic.authorUsername} variant="feed" />
        </span>
        <span className="topic-context-meta">
          <a className={`board-tag board-tag--${topic.boardTone}`} href={boardHref(topic.boardSlug)}>{topic.board}</a>
          <span aria-hidden="true">·</span>
          <time dateTime={topic.publishedAtIso}>{topic.publishedAt}</time>
          {topic.hot ? <span className="hot-label"><Flame size={12} aria-hidden="true" />热议</span> : null}
        </span>
      </> : <>
        <a className={`board-tag board-tag--${topic.boardTone}`} href={boardHref(topic.boardSlug)}>{topic.board}</a>
        <a href={`#user/${topic.authorUsername}`}>{topic.author}</a>
        <PublicMemberIdentity username={topic.authorUsername} />
        <span aria-hidden="true">·</span>
        <time dateTime={topic.publishedAtIso}>{topic.publishedAt}</time>
        {topic.hot ? <span className="hot-label"><Flame size={12} aria-hidden="true" />热议</span> : null}
      </>}
    </div>
  )

  return (
    <>
    <article className={`topic-row topic-row--${variant} topic-row--${layout}${rhythm === "conversation" ? " topic-row--conversation" : ""}${footerActions ? " topic-row--stats-footer" : ""}`}
      data-layout={layout} data-media-count={mediaUrls.length} data-rhythm={rhythm} data-variant={variant} onClick={openRow}>
      {!isFeed && (
        <span className={`board-topic-marker board-topic-marker--${topic.pinned ? "pin" : topic.featured ? "featured" : topic.hot ? "hot" : "discussion"}`}
          role="img" aria-label={topic.pinned ? "置顶主题" : topic.featured ? "精华主题" : topic.hot ? "热议主题" : "普通主题"}>
          {topic.pinned ? <Pin size={15} aria-hidden="true" /> : topic.featured ? <Sparkles size={15} aria-hidden="true" />
            : topic.hot ? <Flame size={15} aria-hidden="true" /> : <MessageSquareText size={15} aria-hidden="true" />}
        </span>
      )}
      <div className="topic-content">
        {isFeed ? metadata : null}
        {hasTitle ? <>
          <div className="topic-title-line">
            {isFeed && topic.pinned ? <Pin className="topic-status topic-status--pin" size={14} aria-label="置顶" /> : null}
            {isFeed && topic.featured ? <Sparkles className="topic-status topic-status--featured" size={14} aria-label="精华" /> : null}
            <a href={`#topic/${topic.id}`} className="topic-title" onClick={openTopic} ref={titleRef}><h2>{displayTitle}</h2></a>
            {!isFeed && (topic.pinned || topic.featured || topic.hot) ? (
              <span className="board-topic-badges" aria-label="主题状态">
                {topic.pinned ? <span className="board-topic-badge">置顶</span> : null}
                {topic.featured ? <span className="board-topic-badge board-topic-badge--featured">精华</span> : null}
                {topic.hot ? <span className="board-topic-badge board-topic-badge--hot">热议</span> : null}
              </span>
            ) : null}
          </div>
          {topic.excerpt ? <p className="topic-excerpt">{topic.excerpt}</p> : null}
        </> : topic.excerpt.trim() ? (
          <a className="topic-excerpt topic-excerpt--untitled" href={`#topic/${topic.id}`} onClick={openTopic} ref={titleRef}>{topic.excerpt}</a>
        ) : !isFeed ? (
          <a className="topic-excerpt topic-excerpt--untitled" href={`#topic/${topic.id}`} onClick={openTopic} ref={titleRef}>{mediaUrls.length ? "查看图片帖" : "查看帖子"}</a>
        ) : null}
        {topic.tags.length > 0 && <div className="topic-tags" aria-label="主题标签">
          {topic.tags.map(tag => <span className="topic-tag" key={tag.slug}>#{tag.name}</span>)}
        </div>}
        {!isFeed ? metadata : null}
        {!footerActions ? stats : null}
      </div>
      {mediaUrls.length > 0 ? (
        <div className={`topic-cover topic-cover--count-${mediaUrls.length}`} role="group" aria-label="帖子图片预览">
          {mediaUrls.slice(0, isFeed ? 3 : 1).map((imageUrl, index) => <button key={imageUrl} type="button" className="topic-image-trigger"
            aria-label={`查看第 ${index + 1} 张图片`} title={`查看第 ${index + 1} 张图片`}
            onClick={event => setPreview({ images: mediaUrls.map(src => ({ src, alt: "帖子图片" })), index, trigger: event.currentTarget })}>
            <img src={imageUrl} alt="" loading="lazy" decoding="async" />
          </button>)}
        </div>
      ) : null}
      {footerActions ? stats : null}
    </article>
    {preview && <ImagePreviewDialog selection={preview} onClose={() => setPreview(null)} />}
    </>
  )
}

function boardHref(slug: string | undefined): string {
  return slug && boardSlugPattern.test(slug) ? `#board/${slug}` : "#boards"
}
