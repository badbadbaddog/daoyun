import { FileSearch, LoaderCircle, RefreshCw } from "lucide-react"

import type { BoardSummary } from "../../api/boards"
import type { UserSummary } from "../../api/users"
import type { SearchScope } from "../../router/communityRoute"
import type { Topic, TopicTag } from "../../types/community"
import { BoardSearchResults } from "./BoardSearchResults"
import { SearchTabs } from "./SearchTabs"
import { TopicSearchResults } from "./TopicSearchResults"
import { UserSearchResults } from "./UserSearchResults"
import { TagSearchResults } from "./TagSearchResults"

interface SearchPageProps {
  query: string
  scope: SearchScope
  topics: Topic[]
  boards: BoardSummary[]
  users: UserSummary[]
  tags: TopicTag[]
  loading: boolean
  error: string | null
  onScopeChange: (scope: SearchScope) => void
  onRetry?: () => void
  onLoadMore: () => void
  nextCursor: string | null
  loadingMore: boolean
  errorMore: string | null
}

export function SearchPage(props: SearchPageProps) {
  const showTopics = props.scope === "all" || props.scope === "topics"
  const showBoards = props.scope === "all" || props.scope === "boards"
  const showUsers = props.scope === "all" || props.scope === "users"
  const showTags = props.scope === "all" || props.scope === "tags"
  return (
    <section className="search-page" aria-labelledby="search-page-title">
      <header className="board-page-title">
        <p>全站发现</p>
        <h1 id="search-page-title">{props.query ? `搜索：${props.query}` : "搜索社区"}</h1>
        <p>{props.query ? "主题、版块和用户结果会保持在当前网址中。" : "输入关键词后按 Enter 开始搜索。"}</p>
      </header>
      <SearchTabs scope={props.scope} onChange={props.onScopeChange} />
      <div id="search-results-panel" role="tabpanel" tabIndex={0} aria-labelledby={`search-tab-${props.scope}`}>
        {!props.query ? (
        <div className="empty-state" role="status"><FileSearch size={28} /><h2>输入搜索词</h2><p>搜索词会保存到网址，可刷新或分享。</p></div>
      ) : props.loading ? (
        <div className="topic-loading" role="status"><LoaderCircle className="topic-loading__spinner" size={22} />正在搜索</div>
      ) : props.error ? (
        <div className="empty-state" role="alert"><FileSearch size={28} /><h2>搜索暂时不可用</h2><p>{props.error}</p>{props.onRetry && <button className="secondary-button" type="button" onClick={props.onRetry}><RefreshCw size={15} />重试</button>}</div>
      ) : (
        <div className="search-results">
          {showTopics && <TopicSearchResults topics={props.topics} />}
          {showBoards && <BoardSearchResults boards={props.boards} />}
          {showUsers && <UserSearchResults users={props.users} />}
          {showTags && <TagSearchResults tags={props.tags} />}
        </div>
      )}
      </div>
      {props.errorMore && <p className="interaction-alert" role="alert">{props.errorMore}</p>}
      {showTopics && props.nextCursor && <button className="secondary-button search-load-more" type="button" disabled={props.loadingMore} onClick={props.onLoadMore}>{props.loadingMore ? "正在加载" : "加载更多主题"}</button>}
    </section>
  )
}
