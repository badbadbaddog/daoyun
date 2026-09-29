export type CommunityFeed = "latest" | "active" | "hot" | "featured" | "following"
export type SearchScope = "all" | "topics" | "boards" | "users" | "tags"
export type MemberTab = "overview" | "growth" | "points" | "benefits" | "medals"

export type CommunityRoute =
  | { kind: "feed"; feed: CommunityFeed }
  | { kind: "boardIndex" }
  | { kind: "board"; slug: string }
  | { kind: "search"; query: string; scope: SearchScope; filters?: SearchContentFilters }
  | { kind: "topic"; topicId: string; replyId?: string }
  | { kind: "user"; username: string }
  | { kind: "bookmarks" }
  | { kind: "messages"; conversationId: string | null }
  | { kind: "notifications" }
  | { kind: "member"; tab: MemberTab }
  | { kind: "admin"; tab: string | null; query: string }
  | { kind: "oidcClaim" }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,31}$/
const BOARD_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const ADMIN_TAB_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const MAX_SEARCH_QUERY_LENGTH = 200

const FEED_BY_HASH: Record<string, CommunityFeed> = {
  feed: "latest",
  active: "active",
  hot: "hot",
  featured: "featured",
  following: "following",
}

const HASH_BY_FEED: Record<CommunityFeed, string> = {
  latest: "feed",
  active: "active",
  hot: "hot",
  featured: "featured",
  following: "following",
}

const SEARCH_SCOPES = new Set<SearchScope>(["all", "topics", "boards", "users", "tags"])
const MEMBER_TABS = new Set<MemberTab>(["growth", "points", "benefits", "medals"])
const DEFAULT_ROUTE: CommunityRoute = { kind: "feed", feed: "hot" }

export function parseHash(input: string): CommunityRoute {
  const hash = stripHash(input)
  if (!hash || hash === "top") return DEFAULT_ROUTE
  if (hash === "discover") return { kind: "search", query: "", scope: "all" }

  const feed = FEED_BY_HASH[hash]
  if (feed) return { kind: "feed", feed }
  if (hash === "boards") return { kind: "boardIndex" }
  if (hash === "bookmarks") return { kind: "bookmarks" }
  if (hash === "notifications") return { kind: "notifications" }
  if (hash === "member") return { kind: "member", tab: "overview" }
  if (hash.startsWith("member/")) {
    const tab = hash.slice("member/".length) as MemberTab
    return MEMBER_TABS.has(tab) ? { kind: "member", tab } : DEFAULT_ROUTE
  }
  if (hash === "oidc-claim") return { kind: "oidcClaim" }

  if (hash === "search" || hash.startsWith("search?")) {
    return parseSearch(hash)
  }

  const legacyBoard = hash.match(/^board-(.+)$/)
  if (legacyBoard) return boardRoute(legacyBoard[1])

  const board = hash.match(/^board\/([^/?#]+)$/)
  if (board) return boardRoute(board[1])

  if (hash.startsWith("topic/")) return parseTopic(hash)

  const user = hash.match(/^user\/([^/?#]+)$/)
  if (user) {
    const username = decodeSegment(user[1])
    return USERNAME_PATTERN.test(username) ? { kind: "user", username } : DEFAULT_ROUTE
  }

  if (hash === "messages") return { kind: "messages", conversationId: null }
  const messages = hash.match(/^messages\/([^/?#]+)$/)
  if (messages) {
    const conversationId = decodeSegment(messages[1])
    return UUID_PATTERN.test(conversationId)
      ? { kind: "messages", conversationId }
      : DEFAULT_ROUTE
  }

  if (hash === "admin" || hash.startsWith("admin?") || hash.startsWith("admin/")) {
    return parseAdmin(hash)
  }

  return DEFAULT_ROUTE
}

export function formatRoute(route: CommunityRoute): string {
  switch (route.kind) {
    case "feed":
      return `#${HASH_BY_FEED[route.feed]}`
    case "boardIndex":
      return "#boards"
    case "board":
      return BOARD_SLUG_PATTERN.test(route.slug) ? `#board/${route.slug}` : "#hot"
    case "search": {
      const query = normalizeSearchQuery(route.query)
      const scope = SEARCH_SCOPES.has(route.scope) ? route.scope : "all"
      const filters = normalizeSearchFilters(route.filters)
      if (!query && scope === "all" && !Object.keys(filters).length) return "#search"
      const params = new URLSearchParams()
      if (query) params.set("q", query)
      if (scope !== "all") params.set("type", scope)
      Object.entries(filters).forEach(([key,value]) => params.set(key,value))
      return `#search?${params.toString()}`
    }
    case "topic": {
      if (!UUID_PATTERN.test(route.topicId)) return "#hot"
      const base = `#topic/${route.topicId}`
      return route.replyId && UUID_PATTERN.test(route.replyId)
        ? `${base}?reply=${route.replyId}`
        : base
    }
    case "user":
      return USERNAME_PATTERN.test(route.username) ? `#user/${route.username}` : "#hot"
    case "bookmarks":
      return "#bookmarks"
    case "messages":
      return route.conversationId && UUID_PATTERN.test(route.conversationId)
        ? `#messages/${route.conversationId}`
        : "#messages"
    case "notifications":
      return "#notifications"
    case "member":
      return route.tab === "overview" ? "#member" : `#member/${route.tab}`
    case "admin": {
      const tab = route.tab && ADMIN_TAB_PATTERN.test(route.tab) ? `/${route.tab}` : ""
      return `#admin${tab}${route.query ? `?${route.query}` : ""}`
    }
    case "oidcClaim":
      return "#oidc-claim"
  }
}

export function canonicalHashForLegacy(input: string): string | null {
  const hash = stripHash(input)
  if (!hash || hash === "top") return "#hot"
  if (hash === "discover") return "#search"
  if (/^board-/.test(hash)) {
    const route = parseHash(hash)
    return route.kind === "board" ? formatRoute(route) : null
  }
  return null
}

function boardRoute(rawSlug: string): CommunityRoute {
  const slug = decodeSegment(rawSlug)
  return BOARD_SLUG_PATTERN.test(slug) ? { kind: "board", slug } : DEFAULT_ROUTE
}

function parseTopic(hash: string): CommunityRoute {
  const [path, queryString = ""] = hash.split("?", 2)
  const match = path.match(/^topic\/([^/?#]+)$/)
  if (!match) return DEFAULT_ROUTE
  const topicId = decodeSegment(match[1])
  if (!UUID_PATTERN.test(topicId)) return DEFAULT_ROUTE

  const rawReplyId = new URLSearchParams(queryString).get("reply")
  if (!rawReplyId) return { kind: "topic", topicId }
  const replyId = decodeSegment(rawReplyId)
  return UUID_PATTERN.test(replyId)
    ? { kind: "topic", topicId, replyId }
    : { kind: "topic", topicId }
}

function parseSearch(hash: string): CommunityRoute {
  const queryString = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : ""
  const params = new URLSearchParams(queryString)
  const query = normalizeSearchQuery(params.get("q") ?? "")
  const requestedScope = params.get("type") as SearchScope | null
  const scope = requestedScope && SEARCH_SCOPES.has(requestedScope) ? requestedScope : "all"
  const filters = normalizeSearchFilters(Object.fromEntries(params.entries()) as SearchContentFilters)
  return { kind: "search", query, scope, ...(Object.keys(filters).length ? {filters} : {}) }
}

function parseAdmin(hash: string): CommunityRoute {
  const [path, query = ""] = hash.split("?", 2)
  if (path === "admin") return { kind: "admin", tab: null, query }
  const match = path.match(/^admin\/([^/]+)$/)
  if (!match) return DEFAULT_ROUTE
  const tab = decodeSegment(match[1])
  return ADMIN_TAB_PATTERN.test(tab) ? { kind: "admin", tab, query } : DEFAULT_ROUTE
}

function normalizeSearchQuery(query: string): string {
  return query.length <= MAX_SEARCH_QUERY_LENGTH ? query : query.slice(0, MAX_SEARCH_QUERY_LENGTH)
}

function stripHash(input: string): string {
  return input.startsWith("#") ? input.slice(1) : input
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return ""
  }
}

export interface SearchContentFilters {
  board?: string
  author?: string
  tag?: string
  from?: string
  through?: string
  sort?: "latest" | "popular" | "active"
}
export function normalizeSearchFilters(filters: SearchContentFilters = {}): SearchContentFilters {
  const result: SearchContentFilters = {}
  for (const key of ["board","author","tag","from","through"] as const) {
    const value = filters[key]?.trim()
    if (value) result[key] = value.slice(0,100)
  }
  if (filters.sort === "popular" || filters.sort === "active") result.sort = filters.sort
  return result
}
