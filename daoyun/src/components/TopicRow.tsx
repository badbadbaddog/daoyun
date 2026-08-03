import { Bookmark, Eye, Flame, MessageCircle, Pin, Sparkles, ThumbsUp } from "lucide-react"

import type { Topic } from "../types/community"

interface TopicRowProps {
  topic: Topic
}
export function TopicRow({ topic }: TopicRowProps) {
  return (
    <article className={`topic-row${topic.imageUrl ? " topic-row--with-image" : ""}`}>
      <a className="topic-avatar" href={`#author-${topic.author}`} aria-label={`查看 ${topic.author} 的主页`}>
        <img src={topic.avatarUrl} alt="" />
      </a>

      <div className="topic-content">
        <div className="topic-title-line">
          {topic.pinned ? <Pin className="topic-status topic-status--pin" size={14} aria-label="置顶" /> : null}
          {topic.featured ? <Sparkles className="topic-status topic-status--featured" size={14} aria-label="精华" /> : null}
          <a href={`#${topic.id}`} className="topic-title">
            <h2>{topic.title}</h2>
          </a>
        </div>

        <p className="topic-excerpt">{topic.excerpt}</p>

        <div className="topic-meta">
          <a className={`board-tag board-tag--${topic.boardTone}`} href={`#board-${topic.board}`}>{topic.board}</a>
          <a href={`#author-${topic.author}`}>{topic.author}</a>
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

      {topic.imageUrl ? (
        <a className="topic-cover" href={`#${topic.id}`} tabIndex={-1} aria-hidden="true">
          <img src={topic.imageUrl} alt="" />
        </a>
      ) : null}

      <button className="topic-bookmark" type="button" aria-label={`收藏主题：${topic.title}`} title="收藏">
        <Bookmark size={16} />
      </button>
    </article>
  )
}
