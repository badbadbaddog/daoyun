import { FileSearch, LoaderCircle, RefreshCw, Search } from "lucide-react"

import type { Topic } from "../../types/community"
import { TopicRow } from "../../components/TopicRow"

export type BoardTopicSort = "latest" | "active" | "hot" | "featured"

interface BoardTopicFeedProps {
  topics: Topic[]
  state: "loading" | "ready" | "error"
  error: string | null
  nextCursor: string | null
  loadingMore: boolean
  errorMore: string | null
  searchQuery: string
  sort: BoardTopicSort
  onSearchChange: (query: string) => void
  onSortChange: (sort: BoardTopicSort) => void
  onLoadMore: () => void
  onRetry: () => void
  onOpenTopic?: (topicId: string) => void
  onToggleBookmark?: (topicId: string) => void
  bookmarkPendingIds?: ReadonlySet<string>
  onToggleLike?: (topicId: string) => void
  likePendingIds?: ReadonlySet<string>
  interactionError?: string
}

const tabs: { value: BoardTopicSort; label: string }[] = [
  { value: "latest", label: "最新" },
  { value: "active", label: "活跃" },
  { value: "hot", label: "热门" },
  { value: "featured", label: "精华" },
]

export function BoardTopicFeed(props: BoardTopicFeedProps) {
  return (
    <section className="board-topic-feed" aria-labelledby="board-topics-title">
      <div className="board-feed-controls">
        <h2 id="board-topics-title">主题</h2>
        <label className="board-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">搜索本社区</span>
          <input
            id="board-search-input"
            type="search"
            aria-label="搜索本社区"
            value={props.searchQuery}
            placeholder="搜索社区内容"
            onChange={(event) => props.onSearchChange(event.target.value)}
          />
        </label>
      </div>
      <div className="board-feed-tabs" role="group" aria-label="主题排序">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={props.sort === tab.value}
            onClick={() => props.onSortChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {props.state === "loading" ? (
        <div className="topic-loading" role="status"><LoaderCircle className="topic-loading__spinner" size={22} />正在加载主题</div>
      ) : props.state === "error" ? (
        <div className="empty-state" role="alert">
          <FileSearch size={28} aria-hidden="true" />
          <h3>主题暂时无法加载</h3>
          <p>{props.error ?? "请稍后重试。"}</p>
          <button className="secondary-button" type="button" onClick={props.onRetry}><RefreshCw size={15} />重试</button>
        </div>
      ) : props.topics.length === 0 ? (
        <div className="empty-state" role="status"><FileSearch size={28} /><h3>这个社区还没有主题</h3><p>发布第一个主题，开始讨论。</p></div>
      ) : (
        <>
          <div id="board-topic-columns" className="board-topic-columns" aria-label="主题列表列名">
            <span>主题</span>
            <span>作者 / 时间</span>
            <span>回复 / 浏览</span>
          </div>
          <div className="topic-list board-topic-list" role="feed" aria-label="主题列表" aria-describedby="board-topic-columns">
            {props.topics.map((topic) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                variant="board"
                onOpen={props.onOpenTopic}
                onToggleBookmark={props.onToggleBookmark}
                bookmarkPending={props.bookmarkPendingIds?.has(topic.id) === true}
                onToggleLike={props.onToggleLike}
                likePending={props.likePendingIds?.has(topic.id) === true}
              />
            ))}
          </div>
        </>
      )}
      {props.interactionError && <p className="interaction-alert" role="alert">{props.interactionError}</p>}
      {props.errorMore && <p className="interaction-alert" role="alert">{props.errorMore}</p>}
      {props.nextCursor && (
        <button className="secondary-button board-load-more" type="button" disabled={props.loadingMore} onClick={props.onLoadMore}>
          {props.loadingMore ? "正在加载" : "加载更多"}
        </button>
      )}
    </section>
  )
}
