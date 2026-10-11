import { useEffect, useRef, useState } from "react"
import { Bookmark, Eye, Flame, Heart, LoaderCircle, MessageCircle, MessageSquareText, MoreVertical, Pin, Sparkles, ThumbsUp } from "lucide-react"

import { getTopic } from "../api/topics"
import type { Topic } from "../types/community"
import { topicDisplayTitle, topicHasTitle } from "../utils/topicPresentation"
import { ImagePreviewDialog, type ImagePreviewSelection } from "./ImagePreviewDialog"
import { PublicMemberIdentity } from "./PublicMemberIdentity"
import { UserAvatar } from "./UserAvatar"
import { ActionMenu } from "./ui/ActionMenu"

const boardSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

interface TopicRowProps {
  topic: Topic
  variant?: "feed" | "board" | "list"
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
  const [singleImage, setSingleImage] = useState<{ key: string; wide: boolean } | null>(null)
  const titleRef = useRef<HTMLAnchorElement>(null)
  const isFeed = variant === "feed"
  const footerActions = isFeed || statsPlacement === "footer"
  // 只使用服务端提供的公开预览，站点默认封面不能充当帖子图片。
  const mediaUrls = (topic.imageUrls?.length ? topic.imageUrls : topic.imageUrl ? [topic.imageUrl] : []).slice(0, 3)
  const previewKey = `${topic.id}:${topic.visibleImageCount}:${mediaUrls.join(",")}`
  useEffect(() => setPreview(null), [previewKey])
  const remainingCount = Math.max(0, (topic.visibleImageCount ?? 0) - (isFeed ? mediaUrls.length : 1))
  const displayTitle = topicDisplayTitle(topic)
  const hasTitle = topicHasTitle(topic)
  const singleWide = singleImage?.key === previewKey ? singleImage.wide : true
  const mediaLayout = !mediaUrls.length ? "none" : mediaUrls.length > 1 ? "strip" : singleWide || !topic.excerpt.trim() ? "wide" : "thumbnail"
  const LikeIcon = isFeed ? ThumbsUp : Heart
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
  if (variant === "list") {
    return (
      <article className="topic-row topic-row--list" data-variant="list" onClick={openRow}>
        <a className="topic-list-avatar" href={"#user/" + topic.authorUsername} aria-label={"查看 " + topic.author + " 的主页"}>
          <UserAvatar username={topic.authorUsername} displayName={topic.author} avatarUrl={topic.avatarUrl} size="medium" />
        </a>
        <div className="topic-list-content">
          <div className="topic-list-title">
            <div className="topic-list-heading">
              {topic.pinned && <span className="topic-list-pin"><Pin size={12} aria-hidden="true" />置顶</span>}
              <a className="topic-title" href={"#topic/" + topic.id} onClick={openTopic} ref={titleRef} title={displayTitle}><h2>{displayTitle}</h2></a>
            </div>
            {topic.featured && <span className="topic-list-tag topic-list-tag--featured">精华</span>}
            {topic.tags.map(tag => <a className={"topic-list-tag topic-list-tag--" + topic.boardTone} key={tag.slug} href={"#search?tag=" + encodeURIComponent(tag.slug)} title={tag.name}>{tag.name}</a>)}
          </div>
          <div className="topic-list-meta">
            <a href={"#user/" + topic.authorUsername}>{topic.author}</a><span aria-hidden="true">·</span>
            <time dateTime={topic.publishedAtIso}>{topic.publishedAt}</time><span aria-hidden="true">·</span>
            <a href={boardHref(topic.boardSlug)}>{topic.board}</a>
          </div>
        </div>
        <div className="topic-list-stats" role="group" aria-label="主题统计">
          <a href={"#topic/" + topic.id} onClick={openTopic} aria-label={topic.replies + " 条回复：" + displayTitle} title={topic.replies + " 条回复"}><MessageCircle size={16} aria-hidden="true" />{compactCount(topic.replies)}</a>
          <span aria-label={topic.views + " 次浏览"} title={topic.views + " 次浏览"}><Eye size={16} aria-hidden="true" />{compactCount(topic.views)}</span>
        </div>
        {(onToggleLike || onToggleBookmark) && <div className="topic-list-menu"><ActionMenu label={"主题操作：" + displayTitle} items={[
          ...(onToggleLike ? [{ label: topic.liked ? "取消点赞" : "点赞", onSelect: () => onToggleLike(topic.id), disabled: likePending, icon: <ThumbsUp size={14} aria-hidden="true" /> }] : []),
          ...(onToggleBookmark ? [{ label: topic.bookmarked ? "取消收藏" : "收藏", onSelect: () => onToggleBookmark(topic.id), disabled: bookmarkPending, icon: <Bookmark size={14} aria-hidden="true" /> }] : []),
        ]} /></div>}
      </article>
    )
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
            : <LikeIcon size={14} fill={topic.liked ? "currentColor" : "none"} aria-hidden="true" />}
          <span>{topic.likes}</span>
        </button>
      ) : <span title={`${topic.likes} 次点赞`}><LikeIcon size={14} fill={topic.liked ? "currentColor" : "none"} aria-hidden="true" />{topic.likes}</span>}
      <a className="topic-reply" href={`#topic/${topic.id}`} onClick={openTopic} aria-label={`回复主题：${displayTitle}`} title={`${topic.replies} 条回复`}>
          <MessageCircle size={14} aria-hidden="true" /><span>{topic.replies}</span>
      </a>
      {bookmark}
      {isFeed && <span className="topic-views" title={`${topic.views} 次浏览`}><Eye size={16} aria-hidden="true" />{topic.views.toLocaleString("zh-CN")}</span>}
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
          <time dateTime={topic.publishedAtIso}>{topic.publishedAt}</time>
          <span aria-hidden="true">·</span>
          <span>来自 <a className={`board-tag board-tag--${topic.boardTone}`} href={boardHref(topic.boardSlug)}>{topic.board}</a></span>
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

  const body = (
    <>
      {hasTitle ? <>
          <div className="topic-title-line">
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
    </>
  )
  const tags = (
    <>
      {topic.tags.length > 0 && <div className="topic-tags" aria-label="主题标签">
          {topic.tags.map(tag => <span className="topic-tag" key={tag.slug}>#{tag.name}</span>)}
        </div>}
    </>
  )
  const cover = (
    <>
      {mediaUrls.length > 0 ? (
        <div className={`topic-cover topic-cover--count-${mediaUrls.length}`} role="group" aria-label="帖子图片预览">
          {mediaUrls.slice(0, isFeed ? 3 : 1).map((imageUrl, index) => <button key={imageUrl} type="button" className="topic-image-trigger"
            aria-label={`查看第 ${index + 1} 张图片`} title={`查看第 ${index + 1} 张图片`}
            onClick={event => setPreview({
              images: mediaUrls.map(src => ({ src, alt: "帖子图片" })), index, trigger: event.currentTarget,
              loadImages: (topic.visibleImageCount ?? 0) > mediaUrls.length
                ? async signal => (await getTopic(topic.id, signal)).mediaUrls!.map(src => ({ src, alt: "帖子图片" }))
                : undefined,
            })}>
            <img src={imageUrl} alt="" loading="lazy" decoding="async" onLoad={event => {
              const image = event.currentTarget
              if (isFeed && mediaUrls.length === 1 && image.naturalHeight > 0) setSingleImage({ key: previewKey, wide: image.naturalWidth / image.naturalHeight >= 1.5 })
            }} />
            {index === (isFeed ? mediaUrls.length - 1 : 0) && remainingCount > 0 && <span className="topic-image-more" aria-hidden="true">+{remainingCount}</span>}
          </button>)}
        </div>
      ) : null}
    </>
  )

  return (
    <>
      <article className={`topic-row topic-row--${variant} topic-row--${layout}${rhythm === "conversation" ? " topic-row--conversation" : ""}${footerActions ? " topic-row--stats-footer" : ""}`}
        data-layout={layout} data-media-count={mediaUrls.length} data-media-layout={mediaLayout} data-rhythm={rhythm} data-variant={variant} onClick={openRow}>
      {!isFeed && (
        <span className={`board-topic-marker board-topic-marker--${topic.pinned ? "pin" : topic.featured ? "featured" : topic.hot ? "hot" : "discussion"}`}
          role="img" aria-label={topic.pinned ? "置顶主题" : topic.featured ? "精华主题" : topic.hot ? "热议主题" : "普通主题"}>
          {topic.pinned ? <Pin size={15} aria-hidden="true" /> : topic.featured ? <Sparkles size={15} aria-hidden="true" />
            : topic.hot ? <Flame size={15} aria-hidden="true" /> : <MessageSquareText size={15} aria-hidden="true" />}
        </span>
      )}

        {isFeed ? <>
          {(topic.pinned || topic.featured) && <span className="topic-feed-status">
            {topic.pinned ? <><Pin size={12} aria-hidden="true" />版块置顶</> : <><Sparkles size={12} aria-hidden="true" />精华</>}
          </span>}
          <div className="topic-content">
            {metadata}
            <div className="topic-main"><div className="topic-body">{body}</div>{cover}</div>
            {tags}
          </div>
          <div className="topic-footer">{stats}<a className="topic-more" href={`#topic/${topic.id}`} onClick={openTopic} title="查看主题详情" aria-label={`查看主题详情：${displayTitle}`}><MoreVertical size={18} aria-hidden="true" /></a></div>
        </> : <>
          <div className="topic-content">{body}{tags}{metadata}{!footerActions ? stats : null}</div>
          {cover}
          {footerActions ? stats : null}
        </>}
      </article>
      {preview && <ImagePreviewDialog selection={preview} onClose={() => setPreview(null)} />}
    </>
  )
}

function boardHref(slug: string | undefined): string {
  return slug && boardSlugPattern.test(slug) ? `#board/${slug}` : "#boards"
}

function compactCount(count: number): string {
  return count >= 1000 ? (count / 1000).toFixed(1).replace(/\.0$/, "") + "k" : count.toLocaleString("zh-CN")
}
