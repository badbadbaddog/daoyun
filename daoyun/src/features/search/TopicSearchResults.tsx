import type { Topic } from "../../types/community"
import { topicDisplayTitle, topicHasTitle } from "../../utils/topicPresentation"

export function TopicSearchResults({ topics }: { topics: Topic[] }) {
  return (
    <section className="search-result-section" aria-labelledby="topic-search-title">
      <h2 id="topic-search-title">主题</h2>
      {topics.length === 0 ? <p className="search-result-empty">没有匹配的主题</p> : (
        <ul>{topics.map((topic) => <li key={topic.id}><a href={`#topic/${topic.id}`}><strong>{topicDisplayTitle(topic)}</strong>{topicHasTitle(topic) && <span>{topic.excerpt}</span>}</a></li>)}</ul>
      )}
    </section>
  )
}
