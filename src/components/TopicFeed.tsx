import { FileSearch, PenLine } from "lucide-react"

import type { Topic } from "../types/community"
import { TopicRow } from "./TopicRow"

interface TopicFeedProps {
  topics: Topic[]
  onCompose: () => void
}
export function TopicFeed({ topics, onCompose }: TopicFeedProps) {
  return (
    <section className="feed-section" id="feed" aria-labelledby="feed-heading">
      <div className="feed-heading-row">
        <div>
          <p>正在发生</p>
          <h1 id="feed-heading">社区动态</h1>
        </div>
        <button className="secondary-button mobile-compose" type="button" onClick={onCompose}>
          <PenLine size={16} />
          发布
        </button>
      </div>

      <button className="composer-prompt" type="button" onClick={onCompose} aria-label="发布主题">
        <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80" alt="" />
        <span>分享一个值得讨论的话题</span>
        <PenLine size={17} />
      </button>

      <div className="topic-list" aria-live="polite">
        {topics.length > 0 ? topics.map((topic) => <TopicRow topic={topic} key={topic.id} />) : (
          <div className="empty-state" role="status">
            <FileSearch size={28} />
            <h2>没有找到相关主题</h2>
            <p>换一个关键词或 Feed 分类。</p>
          </div>
        )}
      </div>
    </section>
  )
}
