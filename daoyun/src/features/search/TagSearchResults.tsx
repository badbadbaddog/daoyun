import type { TopicTag } from "../../types/community"

export function TagSearchResults({ tags }: { tags: TopicTag[] }) {
  return (
    <section className="search-result-section" aria-labelledby="tag-search-title">
      <h2 id="tag-search-title">标签</h2>
      {tags.length === 0 ? <p className="search-result-empty">没有匹配的标签</p> : (
        <ul className="tag-search-results">
          {tags.map((tag) => (
            <li key={tag.slug}>
              <a href={`#search?q=${encodeURIComponent(tag.name)}&type=topics`}>
                <strong>#{tag.name}</strong>
                <span>查看使用此标签的内容</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
