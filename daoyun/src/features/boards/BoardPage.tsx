import { FileQuestion, LockKeyhole, RefreshCw } from "lucide-react"

import type { BoardDetail } from "../../api/boards"
import type { Topic } from "../../types/community"
import { BoardBreadcrumb } from "./BoardBreadcrumb"
import { BoardChildren } from "./BoardChildren"
import { BoardHeader } from "./BoardHeader"
import { BoardMobileToolbar } from "./BoardMobileToolbar"
import { BoardTopicFeed, type BoardTopicSort } from "./BoardTopicFeed"

export type BoardPageState =
  | { kind: "loading" }
  | { kind: "ready"; board: BoardDetail }
  | { kind: "forbidden" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }

interface BoardPageProps {
  slug: string
  state: BoardPageState
  topics?: Topic[]
  topicState?: "loading" | "ready" | "error"
  topicError?: string | null
  nextCursor?: string | null
  loadingMore?: boolean
  errorMore?: string | null
  searchQuery?: string
  sort?: BoardTopicSort
  onSearchChange?: (query: string) => void
  onSortChange?: (sort: BoardTopicSort) => void
  onCreateTopic?: (boardId: string) => void
  onLoadMore?: () => void
  onRetryTopics?: () => void
  onRetryBoard?: () => void
  onOpenTopic?: (topicId: string) => void
  onToggleBookmark?: (topicId: string) => void
  bookmarkPendingId?: string | null
  onToggleLike?: (topicId: string) => void
  likePendingId?: string | null
  interactionError?: string
}

export function BoardPage({ state, ...props }: BoardPageProps) {
  if (state.kind === "loading") return <div className="topic-loading" role="status">正在加载社区</div>
  if (state.kind === "forbidden") return <BoardUnavailable icon="forbidden" title="你没有访问这个社区的权限" detail="请切换有权访问的账号或返回社区目录。" />
  if (state.kind === "notFound") return <BoardUnavailable icon="missing" title="社区不存在" detail="这个地址可能已失效，或社区已经被移除。" />
  if (state.kind === "error") {
    return (
      <BoardUnavailable icon="missing" title="社区暂时无法加载" detail={state.message}>
        {props.onRetryBoard && <button className="secondary-button" type="button" onClick={props.onRetryBoard}><RefreshCw size={15} />重试</button>}
      </BoardUnavailable>
    )
  }
  return (
    <article className="board-page">
      <BoardMobileToolbar board={state.board} />
      <BoardBreadcrumb items={state.board.breadcrumb} />
      <BoardHeader board={state.board} onCreateTopic={props.onCreateTopic} />
      <BoardChildren boards={state.board.children} />
      <BoardTopicFeed
        topics={props.topics ?? []}
        state={props.topicState ?? "ready"}
        error={props.topicError ?? null}
        nextCursor={props.nextCursor ?? null}
        loadingMore={props.loadingMore ?? false}
        errorMore={props.errorMore ?? null}
        searchQuery={props.searchQuery ?? ""}
        sort={props.sort ?? "latest"}
        onSearchChange={props.onSearchChange ?? (() => undefined)}
        onSortChange={props.onSortChange ?? (() => undefined)}
        onLoadMore={props.onLoadMore ?? (() => undefined)}
        onRetry={props.onRetryTopics ?? (() => undefined)}
        onOpenTopic={props.onOpenTopic}
        onToggleBookmark={props.onToggleBookmark}
        bookmarkPendingId={props.bookmarkPendingId}
        onToggleLike={props.onToggleLike}
        likePendingId={props.likePendingId}
        interactionError={props.interactionError}
      />
    </article>
  )
}

function BoardUnavailable({ icon, title, detail, children }: { icon: "forbidden" | "missing"; title: string; detail: string; children?: React.ReactNode }) {
  return (
    <section className="empty-state board-unavailable" role={icon === "forbidden" ? "alert" : "status"}>
      {icon === "forbidden" ? <LockKeyhole size={30} /> : <FileQuestion size={30} />}
      <h1>{title}</h1>
      <p>{detail}</p>
      {children}
      <a className="secondary-button" href="#boards">返回社区目录</a>
    </section>
  )
}
