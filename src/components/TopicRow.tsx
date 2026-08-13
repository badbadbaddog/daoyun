import { Bookmark, Eye, Flame, LoaderCircle, MessageCircle, Pin, Sparkles, ThumbsUp } from "lucide-react"

import type { Topic } from "../types/community"
import { UserAvatar } from "./UserAvatar"

interface TopicRowProps {
  topic: Topic
  onOpen: (topicId: string) => void
  onToggleBookmark: (topicId: string) => void
  bookmarkPending: boolean
  defaultCoverUrl?: string | null
}
export function TopicRow({ topic, onOpen, onToggleBookmark, bookmarkPending, defaultCoverUrl = null }: TopicRowProps) {
  const coverUrl = topic.imageUrl ?? defaultCoverUrl
  const openTopic = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    onOpen(topic.id)
  }

  return (
    <article className={`topic-row${coverUrl ? " topic-row--with-image" : ""}`}>
      <a className="topic-avatar" href={`#user/${topic.authorUsername}`} aria-label={`查看 ${topic.author} 的主页`}>
        <UserAvatar
          username={topic.authorUsername}
          displayName={topic.author}
          avatarUrl={topic.avatarUrl}
          size="medium"
        />
      </a>

      <div className="topic-content">
        <div className="topic-title-line">
          {topic.pinned ? <Pin className="topic-status topic-status--pin" size={14} aria-label="置顶" /> : null}
          {topic.featured ? <Sparkles className="topic-status topic-status--featured" size={14} aria-label="精华" /> : null}
          <a href={`#topic/${topic.id}`} className="topic-title" onClick={openTopic}>
            <h2>{topic.title}</h2>
          </a>
        </div>

        <p className="topic-excerpt">{topic.excerpt}</p>

        {topic.tags.length > 0 && (
          <div className="topic-tags" aria-label="主题标签">
            {topic.tags.map((tag) => <span className="topic-tag" key={tag.slug}>#{tag.name}</span>)}
          </div>
        )}

        <div className="topic-meta">
          <a className={`board-tag board-tag--${topic.boardTone}`} href={`#board-${topic.board}`}>{topic.board}</a>
          <a href={`#user/${topic.authorUsername}`}>{topic.author}</a>
          <span aria-hidden="true">·</span>
          <time>{topic.publishedAt}</time>
          {topic.hot ? (
            <span className="hot-label"><Flame size={12} />热议</span>
          ) : null}
        </div>

        <div className="topic-stats" aria-label="主题数据">
          <span title={`${topic.replies} 条回复`}><MessageCircle size={14} />{topic.replies}</span>
          <span title={`${topic.likes} 次点赞`}><ThumbsUp size={14} />{topic.likes}</span>
          <span title={`${topic.views} 次浏览`}><Eye size={14} />{topic.views}</span>
        </div>
      </div>

      {coverUrl ? (
        <a className="topic-cover" href={`#topic/${topic.id}`} tabIndex={-1} aria-hidden="true" onClick={openTopic}>
          <img src={coverUrl} alt="" />
        </a>
      ) : null}

      <button
        className={`topic-bookmark${topic.bookmarked ? " topic-bookmark--active" : ""}`}
        type="button"
        aria-label={bookmarkPending
          ? `正在${topic.bookmarked ? "取消收藏" : "收藏"}主题：${topic.title}`
          : `${topic.bookmarked ? "取消收藏" : "收藏"}主题：${topic.title}`}
        aria-pressed={topic.bookmarked === true}
        title={topic.bookmarked ? "取消收藏" : "收藏"}
        disabled={bookmarkPending}
        onClick={() => onToggleBookmark(topic.id)}
      >
        {bookmarkPending
          ? <LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" />
          : <Bookmark size={16} fill={topic.bookmarked ? "currentColor" : "none"} aria-hidden="true" />}
      </button>
    </article>
  )
}
