import { useCallback, useEffect, useRef, useState } from "react"

import { listFeed, type FeedMode } from "../../api/feed"
import { listTopics } from "../../api/topics"
import type { ListTopicsOptions, TopicPage } from "../../api/topics"
import type { Topic } from "../../types/community"

type FeedOptions = Omit<ListTopicsOptions, "cursor" | "signal"> & {
  enabled?: boolean
  mode?: FeedMode
  requestVersion?: number
}

export interface TopicFeedState {
  topics: Topic[]
  newTopicCount: number
  nextCursor: string | null
  loadingInitial: boolean
  loadingMore: boolean
  errorInitial: string | null
  errorMore: string | null
  loadMore: () => Promise<void>
  retry: () => void
  revealNewTopics: () => void
  updateTopics: (update: (topics: Topic[]) => Topic[]) => void
}

export function useTopicFeed(options: FeedOptions): TopicFeedState {
  const {
    enabled = true,
    mode,
    requestVersion = 0,
    board,
    query,
    tag,
    author,
    from,
    through,
    scope,
    featured,
    sort,
    limit,
  } = options
  const [topics, setTopics] = useState<Topic[]>([])
  const topicsRef = useRef<Topic[]>([])
  topicsRef.current = topics
  const [pendingPage, setPendingPage] = useState<TopicPage | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingInitial, setLoadingInitial] = useState(enabled)
  const [loadingMore, setLoadingMore] = useState(false)
  const [errorInitial, setErrorInitial] = useState<string | null>(null)
  const [errorMore, setErrorMore] = useState<string | null>(null)
  const [retryVersion, setRetryVersion] = useState(0)
  const requestKeyRef = useRef(0)
  const sourceKeyRef = useRef("")
  const optionsRef = useRef<Omit<ListTopicsOptions, "cursor" | "signal">>({})
  optionsRef.current = { board, query, tag, author, from, through, scope, featured, sort, limit }

  useEffect(() => {
    const sourceKey = JSON.stringify({ author, board, enabled, featured, from, through, limit, mode, query, scope, sort, tag })
    const refreshingCurrentSource = sourceKeyRef.current === sourceKey && topicsRef.current.length > 0
    sourceKeyRef.current = sourceKey
    const requestKey = requestKeyRef.current + 1
    requestKeyRef.current = requestKey
    setNextCursor(null)
    setLoadingMore(false)
    setErrorInitial(null)
    setErrorMore(null)
    if (!enabled) {
      setTopics([])
      setPendingPage(null)
      setLoadingInitial(false)
      return
    }
    const controller = new AbortController()
    if (!refreshingCurrentSource) setPendingPage(null)
    setLoadingInitial(!refreshingCurrentSource)
    loadTopicPage(mode, optionsRef.current, undefined, controller.signal).then((page) => {
      if (controller.signal.aborted || requestKeyRef.current !== requestKey) return
      if (refreshingCurrentSource) {
        const currentIds = new Set(topicsRef.current.map((topic) => topic.id))
        const newTopicCount = page.topics.filter((topic) => !currentIds.has(topic.id)).length
        if (newTopicCount > 0) {
          setPendingPage(page)
          setLoadingInitial(false)
          return
        }
      }
      setTopics(deduplicateTopics([], page.topics))
      setPendingPage(null)
      setNextCursor(page.nextCursor)
      setLoadingInitial(false)
    }).catch(() => {
      if (controller.signal.aborted || requestKeyRef.current !== requestKey) return
      if (refreshingCurrentSource) {
        setErrorMore("刷新失败，已保留当前内容。")
      } else {
        setErrorInitial("主题暂时无法加载，请稍后重试。")
      }
      setLoadingInitial(false)
    })
    return () => controller.abort()
  }, [author, board, enabled, featured, from, through, limit, mode, query, requestVersion, retryVersion, scope, sort, tag])

  const revealNewTopics = useCallback(() => {
    if (!pendingPage) return
    setTopics(deduplicateTopics([], pendingPage.topics))
    setNextCursor(pendingPage.nextCursor)
    setPendingPage(null)
  }, [pendingPage])

  const currentIds = new Set(topics.map((topic) => topic.id))
  const newTopicCount = pendingPage?.topics.filter((topic) => !currentIds.has(topic.id)).length ?? 0

  const loadMore = useCallback(async () => {
    if (!enabled || !nextCursor || loadingMore) return
    const requestKey = requestKeyRef.current
    setLoadingMore(true)
    setErrorMore(null)
    try {
      const page = await loadTopicPage(mode, optionsRef.current, nextCursor)
      if (requestKeyRef.current !== requestKey) return
      setTopics((current) => deduplicateTopics(current, page.topics))
      setNextCursor(page.nextCursor)
    } catch {
      if (requestKeyRef.current === requestKey) setErrorMore("更多主题加载失败，已保留当前内容。")
    } finally {
      if (requestKeyRef.current === requestKey) setLoadingMore(false)
    }
  }, [enabled, loadingMore, mode, nextCursor])

  return {
    topics,
    newTopicCount,
    nextCursor,
    loadingInitial,
    loadingMore,
    errorInitial,
    errorMore,
    loadMore,
    retry: () => setRetryVersion((version) => version + 1),
    revealNewTopics,
    updateTopics: (update) => setTopics((current) => update(current)),
  }
}

function loadTopicPage(
  mode: FeedMode | undefined,
  options: Omit<ListTopicsOptions, "cursor" | "signal">,
  cursor?: string,
  signal?: AbortSignal,
): Promise<TopicPage> {
  if (mode) {
    return listFeed(mode, { cursor, limit: options.limit, signal })
  }
  return listTopics({ ...options, cursor, signal })
}

function deduplicateTopics(current: Topic[], incoming: Topic[]): Topic[] {
  const topics = new Map(current.map((topic) => [topic.id, topic]))
  incoming.forEach((topic) => topics.set(topic.id, topic))
  return [...topics.values()]
}
