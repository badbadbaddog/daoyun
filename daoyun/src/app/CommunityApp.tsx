import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { BoardApiError, getBoard, listBoards } from "../api/boards"
import type { BoardDetail } from "../api/boards"
import { AUTH_SESSION_CHANGE_KEY, AuthApiError, getCurrentSession, isSessionExpiredError, logout } from "../api/auth"
import type { AuthSession } from "../api/auth"
import { getPublicSiteBranding } from "../api/branding"
import type { FeedMode } from "../api/feed"
import { getAdminAccess } from "../api/admin"
import type { SiteBranding } from "../api/admin"
import { listModerationBoards } from "../api/moderation"
import type { ConversationSummary } from "../api/messages"
import { getUnreadNotificationCount, markNotificationRead } from "../api/notifications"
import type { Notification } from "../api/notifications"
import { getCurrentExperience, listGrowthLevels, loadMembershipCenterData } from "../api/membership"
import { setPostLike, setTopicBookmark } from "../api/relations"
import { listTags, listTopics } from "../api/topics"
import { listUsers } from "../api/users"
import type { UserSummary } from "../api/users"
import { FeedTabs } from "../components/FeedTabs"
import { LeftSidebar } from "../components/LeftSidebar"
import { MobileNavigation } from "../components/MobileNavigation"
import { RightSidebar } from "../components/RightSidebar"
import { SiteFooter } from "../components/SiteFooter"
import { SiteHeader } from "../components/SiteHeader"
import { TopicFeed } from "../components/TopicFeed"
import type { BoardPageState } from "../features/boards/BoardPage"
import type { BoardTopicSort } from "../features/boards/BoardTopicFeed"
import type { MembershipSectionData, MembershipExperience } from "../features/membership/membershipTypes"
import { useFeedScrollRestoration } from "../features/feed/useFeedScrollRestoration"
import { useSearchParams } from "../features/search/useSearchParams"
import { useTopicFeed } from "../features/search/useTopicFeed"
import { formatRoute, type CommunityRoute } from "../router/communityRoute"
import type { NavigateOptions } from "../router/hashRouter"
import type { Board, FeedFilter, Topic, TopicTag } from "../types/community"
import { consumeOidcSettingsReturn } from "../utils/oidcSettingsReturn"
import { CommunityShell } from "./CommunityShell"

type Theme = "light" | "dark"
type BoardLoadStatus = "loading" | "ready" | "error"
type TopicLoadStatus = "loading" | "ready" | "error"
type AuthLoadStatus = "loading" | "ready" | "error"
type AdminAccess = "unknown" | "allowed" | "denied"
type Navigate = (route: CommunityRoute, options?: NavigateOptions) => void
type CommunityPageRoute = Exclude<CommunityRoute, { kind: "admin" }>

interface CommunityAppProps {
  route: CommunityPageRoute
  navigate: Navigate
}

const DEFAULT_SITE_TITLE = "刀云社区"

const AuthPanel = lazy(() => import("../components/AuthPanel").then((module) => ({ default: module.AuthPanel })))
const TopicComposer = lazy(() => import("../components/TopicComposer").then((module) => ({ default: module.TopicComposer })))
const BookmarksView = lazy(() => import("../components/BookmarksView").then((module) => ({ default: module.BookmarksView })))
const MessagesView = lazy(() => import("../components/MessagesView").then((module) => ({ default: module.MessagesView })))
const NotificationsView = lazy(() => import("../components/NotificationsView").then((module) => ({ default: module.NotificationsView })))
const OidcClaimView = lazy(() => import("../components/OidcClaimView").then((module) => ({ default: module.OidcClaimView })))
const TopicDetailView = lazy(() => import("../components/TopicDetailView").then((module) => ({ default: module.TopicDetailView })))
const UserProfileView = lazy(() => import("../components/UserProfileView").then((module) => ({ default: module.UserProfileView })))
const BoardDirectoryPage = lazy(() => import("../features/boards/BoardDirectoryPage").then((module) => ({ default: module.BoardDirectoryPage })))
const BoardPage = lazy(() => import("../features/boards/BoardPage").then((module) => ({ default: module.BoardPage })))
const MemberCenterPage = lazy(() => import("../features/membership/MemberCenterPage").then((module) => ({ default: module.MemberCenterPage })))
const SearchPage = lazy(() => import("../features/search/SearchPage").then((module) => ({ default: module.SearchPage })))

export function CommunityApp({ route, navigate }: CommunityAppProps) {
  const previousRouteKindRef = useRef<CommunityRoute["kind"]>(route.kind)
  const previousRouteRef = useRef<CommunityPageRoute>(route)
  const returnRouteStackRef = useRef<CommunityPageRoute[]>([])
  const routeBackNavigationRef = useRef(false)
  const lastFeedRef = useRef<FeedFilter>(route.kind === "feed" ? route.feed : "latest")
  if (route.kind === "feed") lastFeedRef.current = route.feed
  const activeFeed = route.kind === "feed" ? route.feed : lastFeedRef.current

  const selectedTopicId = route.kind === "topic" ? route.topicId : null
  const selectedReplyId = route.kind === "topic" ? route.replyId ?? null : null
  const selectedUsername = route.kind === "user" ? route.username : null
  const selectedConversationId = route.kind === "messages" ? route.conversationId : null
  const selectedBoardSlug = route.kind === "board" ? route.slug : null

  const [query, setQuery] = useState("")
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [composerOpen, setComposerOpen] = useState(false)
  const [boards, setBoards] = useState<Board[]>([])
  const [boardLoadStatus, setBoardLoadStatus] = useState<BoardLoadStatus>("loading")
  const [boardRequestVersion, setBoardRequestVersion] = useState(0)
  const [boardPageState, setBoardPageState] = useState<BoardPageState>({ kind: "loading" })
  const [boardPageRequestVersion, setBoardPageRequestVersion] = useState(0)
  const [boardTopics, setBoardTopics] = useState<Topic[]>([])
  const boardLoadMoreControllerRef = useRef<AbortController | null>(null)
  const [boardTopicState, setBoardTopicState] = useState<TopicLoadStatus>("loading")
  const [boardTopicError, setBoardTopicError] = useState<string | null>(null)
  const [boardNextCursor, setBoardNextCursor] = useState<string | null>(null)
  const [boardLoadingMore, setBoardLoadingMore] = useState(false)
  const [boardErrorMore, setBoardErrorMore] = useState<string | null>(null)
  const boardSearchQuery = route.kind === "board" ? route.query ?? "" : ""
  const boardTopicSort: BoardTopicSort = route.kind === "board" ? route.sort ?? "latest" : "latest"
  const [boardTopicRequestVersion, setBoardTopicRequestVersion] = useState(0)
  const [composerBoardId, setComposerBoardId] = useState<string | null>(null)
  const [topicRequestVersion, setTopicRequestVersion] = useState(0)
  const [topicDetailSidebarTopic, setTopicDetailSidebarTopic] = useState<Topic | null>(null)
  const [availableTags, setAvailableTags] = useState<TopicTag[]>([])
  const [selectedTag, setSelectedTag] = useState("")
  const authControllerRef = useRef<AbortController | null>(null)
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [branding, setBranding] = useState<SiteBranding | null>(null)
  const [authLoadStatus, setAuthLoadStatus] = useState<AuthLoadStatus>("loading")
  const [authRequestVersion, setAuthRequestVersion] = useState(0)
  const [authPanelOpen, setAuthPanelOpen] = useState(false)
  const [systemAdminAccess, setSystemAdminAccess] = useState<AdminAccess>("unknown")
  const [managementAccess, setManagementAccess] = useState<AdminAccess>("unknown")
  const [notificationsUnread, setNotificationsUnread] = useState<number | null>(null)
  const notificationCountVersion = useRef(0)
  const notificationSession = useRef(authSession); notificationSession.current = authSession
  const notificationLifetime = useRef<AbortController | null>(null)
  const notificationRefresh = useRef<() => void>(() => {})
  const [initialConversation, setInitialConversation] = useState<{ conversation: ConversationSummary; ownerId: string } | null>(null)
  const bookmarkControllersRef = useRef(new Map<string, AbortController>())
  const [bookmarkPendingIds, setBookmarkPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [likePendingIds, setLikePendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [interactionError, setInteractionError] = useState("")
  const [openIdentitySettingsFor, setOpenIdentitySettingsFor] = useState<string | null>(null)
  const [searchUsers, setSearchUsers] = useState<UserSummary[]>([])
  const [searchUsersLoading, setSearchUsersLoading] = useState(false)
  const [searchUsersError, setSearchUsersError] = useState<string | null>(null)
  const [searchUsersRequestVersion, setSearchUsersRequestVersion] = useState(0)
  const [membershipData, setMembershipData] = useState<MembershipSectionData | null>(null)
  const [membershipError, setMembershipError] = useState<string | null>(null)
  const [membershipStatus, setMembershipStatus] = useState<"loading" | "ready" | "error">("loading")
  const [membershipRequestVersion, setMembershipRequestVersion] = useState(0)
  const [membershipLoadedKey, setMembershipLoadedKey] = useState("")
  const memberTab = route.kind === "member" ? route.tab : null
  const membershipKey = `${authSession?.user.id ?? "guest"}:${memberTab}`
  const [homeMembershipExperience, setHomeMembershipExperience] = useState<MembershipExperience | null>(null)
  const searchParams = useSearchParams(route, navigate)
  const searchingTopics = route.kind === "search"
    && Boolean(route.query || Object.keys(route.filters??{}).length)
    && (route.scope === "all" || route.scope === "topics")
  const feedMode: FeedMode | undefined = !searchingTopics && !selectedTag
    ? activeFeed === "hot" ? "recommended"
      : activeFeed === "following" ? "following"
        : activeFeed === "latest" ? "latest"
          : undefined
    : undefined
  const topicFeed = useTopicFeed({
    enabled: searchingTopics || route.kind === "boardIndex" || route.kind === "topic"
      || (route.kind === "feed" && !(activeFeed === "following" && (authLoadStatus !== "ready" || !authSession))),
    mode: route.kind === "boardIndex" || route.kind === "topic" ? "recommended" : feedMode,
    query: searchingTopics ? route.query : undefined,
    board: searchingTopics ? route.filters?.board : undefined,
    author: searchingTopics ? route.filters?.author : undefined,
    from: searchingTopics ? route.filters?.from : undefined,
    through: searchingTopics ? route.filters?.through : undefined,
    tag: searchingTopics ? route.filters?.tag : route.kind === "feed" ? selectedTag || undefined : undefined,
    sort: feedMode ? undefined : searchingTopics ? route.filters?.sort ?? "latest" : activeFeed === "hot" ? "popular" : activeFeed === "active" ? "active" : "latest",
    scope: feedMode ? undefined : searchingTopics ? undefined : activeFeed === "following" ? "following" : undefined,
    featured: feedMode ? false : searchingTopics ? false : activeFeed === "featured",
    requestVersion: topicRequestVersion,
    viewerKey: authSession?.csrfToken ?? "guest",
  })
  const topics = topicFeed.topics
  const topicLoadStatus: TopicLoadStatus = topicFeed.loadingInitial
    ? "loading"
    : topicFeed.errorInitial ? "error" : "ready"
  useFeedScrollRestoration(route, topicLoadStatus === "ready")

  useEffect(() => {
    const previousKind = previousRouteKindRef.current
    previousRouteKindRef.current = route.kind
    if (route.kind === "feed" && previousKind !== "feed") {
      setTopicRequestVersion((version) => version + 1)
    }
  }, [route.kind])

  useEffect(() => {
    const previousRoute = previousRouteRef.current
    previousRouteRef.current = route
    if (formatRoute(previousRoute) === formatRoute(route)) return

    if (routeBackNavigationRef.current) {
      routeBackNavigationRef.current = false
      return
    }

    if (isBackableRoute(route)) {
      if (!sameBackableView(previousRoute, route)) returnRouteStackRef.current.push(previousRoute)
      return
    }

    returnRouteStackRef.current = []
  }, [route])

  useEffect(() => {
    if (route.kind === "search") setQuery(route.query)
  }, [route])

  useEffect(() => {
    if (route.kind !== "member") return
    if (authLoadStatus !== "ready") {
      setMembershipData(null)
      setMembershipStatus(authLoadStatus === "error" ? "error" : "loading")
      return
    }
    if (!authSession) {
      setMembershipLoadedKey(membershipKey)
      setMembershipData(null)
      setMembershipError("请登录后查看自己的会员信息。")
      setMembershipStatus("error")
      return
    }
    const controller = new AbortController()
    setMembershipLoadedKey(membershipKey)
    setMembershipData(null)
    setMembershipStatus("loading")
    setMembershipError(null)
    loadMembershipCenterData(authSession.user.username, controller.signal, route.tab).then((data) => {
      if (!controller.signal.aborted) {
        setMembershipData(data)
        setMembershipStatus("ready")
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setMembershipError(error instanceof Error ? error.message : "会员信息暂时不可用")
        setMembershipStatus("error")
        if (isSessionExpiredError(error)) handleComposerSessionExpired()
      }
    })
    return () => controller.abort()
  }, [authLoadStatus, authSession, membershipRequestVersion, route.kind, memberTab, membershipKey])

  useEffect(() => {
    if (route.kind !== "feed" || authLoadStatus !== "ready" || !authSession) {
      setHomeMembershipExperience(null)
      return
    }
    const controller = new AbortController()
    Promise.all([
      getCurrentExperience(controller.signal),
      listGrowthLevels(controller.signal),
    ]).then(([account, levels]) => {
      if (controller.signal.aborted) return
      const nextLevel = levels
        .filter((level) => level.requiredExperience > account.experience)
        .sort((left, right) => left.requiredExperience - right.requiredExperience)[0] ?? null
      setHomeMembershipExperience({ experience: account.experience, level: account.currentLevel, nextLevel })
    }).catch(() => {
      if (!controller.signal.aborted) setHomeMembershipExperience(null)
    })
    return () => controller.abort()
  }, [authLoadStatus, authSession, route.kind])

  useEffect(() => {
    if (route.kind !== "search" || !route.query || (route.scope !== "all" && route.scope !== "users")) {
      setSearchUsers([])
      setSearchUsersLoading(false)
      setSearchUsersError(null)
      return
    }
    const controller = new AbortController()
    setSearchUsersLoading(true)
    setSearchUsersError(null)
    listUsers(route.query, { signal: controller.signal }).then((page) => {
      if (!controller.signal.aborted) {
        setSearchUsers(page.users)
        setSearchUsersLoading(false)
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setSearchUsersError("用户搜索暂时不可用。")
        setSearchUsersLoading(false)
      }
    })
    return () => controller.abort()
  }, [route, searchUsersRequestVersion])

  useEffect(() => {
    setInitialConversation((current) => (
      current?.conversation.id === selectedConversationId ? current : null
    ))
  }, [selectedConversationId])

  useEffect(() => {
    const controllers = bookmarkControllersRef.current
    controllers.forEach(controller => controller.abort())
    controllers.clear()
    setBookmarkPendingIds(new Set())
    setInitialConversation(null)
    return () => { controllers.forEach(controller => controller.abort()); controllers.clear() }
  }, [authSession])

  useEffect(() => {
    const controller = new AbortController()
    getPublicSiteBranding(controller.signal).then((loadedBranding) => {
      if (!controller.signal.aborted) setBranding(loadedBranding)
    }).catch(() => {
      if (!controller.signal.aborted) setBranding(null)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    let controller: AbortController | null = null
    if (!authSession) { ++notificationCountVersion.current; setNotificationsUnread(0); return }
    const lifetime = new AbortController()
    notificationLifetime.current = lifetime
    setNotificationsUnread(null)
    const refresh = () => {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      const version = ++notificationCountVersion.current
      void getUnreadNotificationCount(signal).then(count => {
        if (!signal.aborted && version === notificationCountVersion.current) setNotificationsUnread(count)
      }).catch(() => { if (!signal.aborted && version === notificationCountVersion.current) setNotificationsUnread(null) })
    }
    notificationRefresh.current = refresh
    const visible = () => { if (document.visibilityState === "visible") refresh() }
    refresh()
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", visible)
    return () => { lifetime.abort(); controller?.abort(); notificationRefresh.current = () => {}; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible) }
  }, [authSession])

  useEffect(() => {
    if (!authSession) {
      setSystemAdminAccess("unknown")
      setManagementAccess("unknown")
      return
    }

    const controller = new AbortController()
    Promise.all([
      getAdminAccess(controller.signal),
      listModerationBoards(controller.signal).catch(() => []),
    ]).then(([{ capabilityKeys }, moderationBoards]) => {
      if (controller.signal.aborted) return
      const capabilities = new Set(capabilityKeys)
      const hasSystemAccess = [
        ["admin.configuration.read"],
        ["membership.rules.read"],
        ["authorization.roles.read", "authorization.assignments.read"],
        ["operations.read"],
        ["community.analytics.read"],
        ["plugins.read"],
      ].some((requirement) => requirement.every((key) => capabilities.has(key)))
      const hasManagementAccess = [
        ["governance.reports.read"],
        ["governance.policy.read", "governance.alerts.read"],
      ].some((requirement) => requirement.every((key) => capabilities.has(key)))
      setSystemAdminAccess(hasSystemAccess ? "allowed" : "denied")
      setManagementAccess(hasManagementAccess || moderationBoards.length > 0 ? "allowed" : "denied")
    }).catch(() => {
      if (!controller.signal.aborted) {
        setSystemAdminAccess("unknown")
        setManagementAccess("unknown")
      }
    })

    return () => controller.abort()
  }, [authSession])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem("daoyun-theme", theme) } catch { /* Keep the active theme in memory when storage is unavailable. */ }
  }, [theme])

  useEffect(() => {
    applyBrandingToDocument(branding)
    if (branding?.themePreset === "dark" && getSavedTheme() === null) {
      setTheme("dark")
    }
  }, [branding, navigate])

  useEffect(() => {
    const controller = new AbortController()
    setBoardLoadStatus("loading")
    setBoards([])

    listBoards(controller.signal).then((loadedBoards) => {
      if (!controller.signal.aborted) {
        setBoards(loadedBoards)
        setBoardLoadStatus("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setBoards([])
        setBoardLoadStatus("error")
      }
    })

    return () => controller.abort()
  }, [authSession?.user.id, boardRequestVersion])

  useEffect(() => {
    if (!selectedBoardSlug) return
    const controller = new AbortController()
    setBoardPageState({ kind: "loading" })
    setBoardTopics([])
    setBoardTopicState("loading")
    setBoardTopicError(null)
    setBoardNextCursor(null)
    setBoardErrorMore(null)
    getBoard(selectedBoardSlug, controller.signal).then((board) => {
      if (!controller.signal.aborted) setBoardPageState({ kind: "ready", board })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof BoardApiError && error.status === 403) setBoardPageState({ kind: "forbidden" })
      else if (error instanceof BoardApiError && error.status === 404) setBoardPageState({ kind: "notFound" })
      else setBoardPageState({ kind: "error", message: "请检查网络连接后重试。" })
    })
    return () => controller.abort()
  }, [authSession?.user.id, selectedBoardSlug, boardPageRequestVersion])

  useEffect(() => {
    boardLoadMoreControllerRef.current?.abort()
    boardLoadMoreControllerRef.current = null
    setBoardLoadingMore(false)
    if (!selectedBoardSlug || boardPageState.kind !== "ready") return
    const controller = new AbortController()
    setBoardTopicState("loading")
    setBoardTopicError(null)
    setBoardErrorMore(null)
    setBoardNextCursor(null)
    const sort = boardTopicSort === "hot" ? "popular" : boardTopicSort === "active" ? "active" : "latest"
    listTopics({
      board: selectedBoardSlug,
      query: boardSearchQuery || undefined,
      sort,
      featured: boardTopicSort === "featured",
      signal: controller.signal,
    }).then((page) => {
      if (!controller.signal.aborted) {
        setBoardTopics(page.topics)
        setBoardNextCursor(page.nextCursor)
        setBoardTopicState("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setBoardTopics([])
        setBoardTopicError("主题暂时无法加载，请稍后重试。")
        setBoardTopicState("error")
      }
    })
    return () => {
      controller.abort()
      boardLoadMoreControllerRef.current?.abort()
      boardLoadMoreControllerRef.current = null
    }
  }, [boardPageState, boardSearchQuery, boardTopicRequestVersion, boardTopicSort, selectedBoardSlug])

  useEffect(() => {
    const onSessionChange = (event: StorageEvent) => {
      if (event.key !== AUTH_SESSION_CHANGE_KEY) return
      authControllerRef.current?.abort()
      setAuthSession(null)
      setInitialConversation(null)
      setAuthLoadStatus("loading")
      setAuthRequestVersion(version => version + 1)
    }
    window.addEventListener("storage", onSessionChange)
    return () => window.removeEventListener("storage", onSessionChange)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    authControllerRef.current = controller
    setAuthLoadStatus("loading")

    getCurrentSession(controller.signal).then((session) => {
      if (!controller.signal.aborted) {
        setAuthSession(session)
        setAuthLoadStatus("ready")
        if (session) {
          const returnUsername = consumeOidcSettingsReturn()
          if (returnUsername === session.user.username) {
            setOpenIdentitySettingsFor(returnUsername)
            navigate({ kind: "user", username: returnUsername })
          }
        }
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setAuthSession(null)
        setAuthLoadStatus("error")
      }
    })

    return () => controller.abort()
  }, [authRequestVersion, navigate])

  useEffect(() => {
    const controller = new AbortController()
    listTags(controller.signal).then((loadedTags) => {
      if (!controller.signal.aborted) setAvailableTags(loadedTags)
    }).catch(() => {
      if (!controller.signal.aborted) setAvailableTags([])
    })
    return () => controller.abort()
  }, [])

  function toggleTheme() {
    setTheme((current) => current === "dark" ? "light" : "dark")
  }

  function selectFeed(feed: FeedFilter) {
    if (route.kind === "feed" && route.feed === feed) {
      setTopicRequestVersion((version) => version + 1)
      return
    }
    navigate({ kind: "feed", feed })
  }

  function handleComposerSessionExpired() {
    authControllerRef.current?.abort()
    setAuthSession(null)
    setAuthLoadStatus("ready")
    setInitialConversation(null)
  }

  function handleSecuritySessionChange(updated: AuthSession) {
    setAuthSession(current => current === authSession && current?.user.id === updated.user.id ? updated : current)
  }

  function handleAuthenticated(session: AuthSession) {
    authControllerRef.current?.abort()
    setAuthSession(session)
    setAuthLoadStatus("ready")
    setAuthPanelOpen(false)
  }

  function handlePublished(topic: Topic) {
    topicFeed.updateTopics((current) => [topic, ...current.filter((item) => item.id !== topic.id)])
    setAvailableTags((current) => mergeTags(current, topic.tags))
    setBoardRequestVersion((version) => version + 1)
    if (composerBoardId && boardPageState.kind === "ready" && composerBoardId === boardPageState.board.id) {
      setBoardTopics((current) => [topic, ...current.filter((item) => item.id !== topic.id)])
    }
    setComposerOpen(false)
    setComposerBoardId(null)
    setTopicDetailSidebarTopic(topic)
    navigate({ kind: "topic", topicId: topic.id })
  }

  function openComposer(boardId: string | null = null) {
    setComposerBoardId(boardId)
    setComposerOpen(true)
  }

  async function loadMoreBoardTopics() {
    if (!selectedBoardSlug || !boardNextCursor || boardLoadingMore || boardLoadMoreControllerRef.current) return
    const controller = new AbortController()
    boardLoadMoreControllerRef.current = controller
    setBoardLoadingMore(true)
    setBoardErrorMore(null)
    const sort = boardTopicSort === "hot" ? "popular" : boardTopicSort === "active" ? "active" : "latest"
    try {
      const page = await listTopics({
        board: selectedBoardSlug,
        query: boardSearchQuery || undefined,
        sort,
        featured: boardTopicSort === "featured",
        cursor: boardNextCursor,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setBoardTopics((current) => {
        const topicsById = new Map(current.map((topic) => [topic.id, topic]))
        page.topics.forEach((topic) => topicsById.set(topic.id, topic))
        return [...topicsById.values()]
      })
      setBoardNextCursor(page.nextCursor)
    } catch {
      if (!controller.signal.aborted) setBoardErrorMore("更多主题加载失败，已保留当前内容。")
    } finally {
      if (boardLoadMoreControllerRef.current === controller) {
        boardLoadMoreControllerRef.current = null
        setBoardLoadingMore(false)
      }
    }
  }

  function handleTopicUpdated(updatedTopic: Topic) {
    topicFeed.updateTopics((current) => current.map((topic) => topic.id === updatedTopic.id ? updatedTopic : topic))
    setTopicDetailSidebarTopic((current) => current?.id === updatedTopic.id ? updatedTopic : current)
    setAvailableTags((current) => mergeTags(current, updatedTopic.tags))
  }

  function openTopic(topicId: string, replyId?: string) {
    setInitialConversation(null)
    setTopicDetailSidebarTopic(null)
    navigate({ kind: "topic", topicId, replyId })
  }

  function openConversation(
    conversationId: string | null,
    conversation: ConversationSummary | null = null,
  ) {
    if (notificationSession.current !== authSession) return
    setInitialConversation((current) => {
      if (conversation?.id === conversationId && authSession) return { conversation, ownerId: authSession.user.id }
      return current?.conversation.id === conversationId ? current : null
    })
    navigate({ kind: "messages", conversationId })
  }

  function openNotifications() {
    setInitialConversation(null)
    navigate({ kind: "notifications" })
  }

  function openNotificationTarget(notification: Notification) {
    const session = authSession
    const signal = notificationLifetime.current?.signal
    if (session && signal && !signal.aborted && !notification.readAt) {
      ++notificationCountVersion.current
      // The application owns this request so immediate navigation does not cancel it.
      void markNotificationRead(notification.id, session.csrfToken, signal).catch(() => undefined).then(() => {
        if (!signal.aborted && notificationSession.current === session) notificationRefresh.current()
      })
    }
    if (notification.target === "post" && notification.topicId) openTopic(notification.topicId, notification.targetId)
    else if (notification.target === "topic") openTopic(notification.targetId)
    else if (notification.target === "conversation") openConversation(notification.targetId)
    else if (notification.target === "user" && notification.actor) {
      navigate({ kind: "user", username: notification.actor.username })
    }
  }

  function closeMainView() {
    const returnRoute = returnRouteStackRef.current.pop() ?? { kind: "feed", feed: "hot" as const }
    routeBackNavigationRef.current = true
    setInitialConversation(null)
    setTopicDetailSidebarTopic(null)
    navigate(returnRoute)
  }

  function applyTopicBookmark(topicId: string, bookmarked: boolean) {
    topicFeed.updateTopics((current) => current.map((topic) => (
      topic.id === topicId ? { ...topic, bookmarked } : topic
    )))
    setBoardTopics((current) => current.map((topic) => (
      topic.id === topicId ? { ...topic, bookmarked } : topic
    )))
  }

  async function handleTopicBookmark(topicId: string) {
    if (!authSession) {
      setAuthPanelOpen(true)
      return
    }
    if (bookmarkControllersRef.current.has(topicId)) return
    const topic = topics.find((item) => item.id === topicId)
      ?? boardTopics.find((item) => item.id === topicId)
    if (!topic) return
    const bookmarked = topic.bookmarked !== true
    const controller = new AbortController()
    bookmarkControllersRef.current.set(topicId, controller)
    const current = () => !controller.signal.aborted && notificationSession.current === authSession
    setBookmarkPendingIds((current) => new Set(current).add(topicId))
    setInteractionError("")
    try {
      const state = await setTopicBookmark(topicId, bookmarked, authSession.csrfToken, controller.signal)
      if (current()) applyTopicBookmark(state.topicId, state.bookmarked)
    } catch {
      if (current()) setInteractionError("收藏状态暂时无法更新。")
    } finally {
      if (!current() || bookmarkControllersRef.current.get(topicId) !== controller) return
      bookmarkControllersRef.current.delete(topicId)
      setBookmarkPendingIds((current) => {
        const next = new Set(current)
        next.delete(topicId)
        return next
      })
    }
  }

  async function handleTopicLike(topicId: string) {
    if (!authSession) {
      setAuthPanelOpen(true)
      return
    }
    if (likePendingIds.has(topicId)) return
    const topic = topics.find((item) => item.id === topicId)
      ?? boardTopics.find((item) => item.id === topicId)
    if (!topic) return
    const liked = topic.liked !== true
    setLikePendingIds((current) => new Set(current).add(topicId))
    setInteractionError("")
    try {
      const state = await setPostLike(topicId, liked, authSession.csrfToken)
      topicFeed.updateTopics((current) => current.map((item) => (
        item.id === state.postId
          ? { ...item, liked: state.liked, likes: state.likeCount }
          : item
      )))
      setBoardTopics((current) => current.map((item) => (
        item.id === state.postId
          ? { ...item, liked: state.liked, likes: state.likeCount }
          : item
      )))
    } catch {
      setInteractionError("点赞状态暂时无法更新。")
    } finally {
      setLikePendingIds((current) => {
        const next = new Set(current)
        next.delete(topicId)
        return next
      })
    }
  }

  function handleReplyPublished(topicId: string) {
    topicFeed.updateTopics((current) => current.map((topic) => (
      topic.id === topicId ? { ...topic, replies: topic.replies + 1 } : topic
    )))
    setTopicDetailSidebarTopic((current) => current?.id === topicId
      ? { ...current, replies: current.replies + 1 }
      : current)
  }

  function handleReplyDeleted(topicId: string) {
    topicFeed.updateTopics((current) => current.map((topic) => (
      topic.id === topicId ? { ...topic, replies: Math.max(0, topic.replies - 1) } : topic
    )))
    setTopicDetailSidebarTopic((current) => current?.id === topicId
      ? { ...current, replies: Math.max(0, current.replies - 1) }
      : current)
  }

  function handleTopicDeleted(topicId: string) {
    topicFeed.updateTopics((current) => current.filter((topic) => topic.id !== topicId))
    closeMainView()
    setBoardRequestVersion((version) => version + 1)
  }

  async function handleLogout() {
    if (!authSession) return
    try {
      await logout(authSession.csrfToken)
      authControllerRef.current?.abort()
      setAuthSession(null)
      setAuthLoadStatus("ready")
      setInitialConversation(null)
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        setAuthSession(null)
        setAuthLoadStatus("ready")
        setInitialConversation(null)
      } else {
        setAuthLoadStatus("error")
      }
    }
  }

  function completeOidcClaim() {
    navigate({ kind: "feed", feed: "hot" })
  }

  if (route.kind === "oidcClaim") {
    return (
      <Suspense fallback={<CommunityRouteLoading />}>
        <OidcClaimView
          session={authSession}
          onSessionChange={setAuthSession}
          onComplete={completeOidcClaim}
        />
      </Suspense>
    )
  }

  const normalizedSearchQuery = route.kind === "search" ? route.query.trim().toLocaleLowerCase() : ""
  const searchBoards = normalizedSearchQuery
    ? boards.filter((board) => [board.name, board.slug, board.description]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery)))
    : []

  const mainContent = selectedTopicId ? (
    <TopicDetailView
      topicId={selectedTopicId}
      focusReplyId={selectedReplyId}
      session={authSession}
      onBack={closeMainView}
      onLogin={() => setAuthPanelOpen(true)}
      onReplyPublished={handleReplyPublished}
      onReplyDeleted={handleReplyDeleted}
      onTopicUpdated={handleTopicUpdated}
      onTopicDeleted={handleTopicDeleted}
      onTopicLoaded={setTopicDetailSidebarTopic}
    />
  ) : selectedUsername ? (
    <UserProfileView
      username={selectedUsername}
      session={authSession}
      onBack={closeMainView}
      onLogin={() => setAuthPanelOpen(true)}
      onOpenTopic={openTopic}
      onOpenConversation={(conversation) => openConversation(conversation.id, conversation)}
      onBookmarkChanged={applyTopicBookmark}
      onSessionChange={handleSecuritySessionChange}
      onSessionExpired={handleComposerSessionExpired}
      openExternalIdentities={openIdentitySettingsFor === selectedUsername}
    />
  ) : route.kind === "bookmarks" ? (
    <BookmarksView
      session={authSession}
      onBack={closeMainView}
      onLogin={() => setAuthPanelOpen(true)}
      onOpenTopic={openTopic}
      onBookmarkChanged={applyTopicBookmark}
    />
  ) : route.kind === "notifications" ? (
    <NotificationsView
      session={authSession}
      onBack={closeMainView}
      onLogin={() => setAuthPanelOpen(true)}
      onOpenTarget={openNotificationTarget}
      globalUnreadCount={notificationsUnread}
      onUnreadRequest={() => ++notificationCountVersion.current}
      onUnreadChange={(count, version) => { if (version === notificationCountVersion.current) setNotificationsUnread(count) }}
    />
  ) : route.kind === "messages" ? (
    <MessagesView
      session={authSession}
      conversationId={selectedConversationId}
      initialConversation={initialConversation?.conversation ?? null}
      initialConversationOwnerId={initialConversation?.ownerId ?? null}
      onSelectConversation={openConversation}
      onBack={closeMainView}
      onLogin={() => setAuthPanelOpen(true)}
    />
  ) : route.kind === "search" ? (
    <SearchPage
      query={route.query}
      filters={route.filters}
      availableBoards={boards}
      availableTags={availableTags}
      onFiltersChange={searchParams.setFilters}
      scope={route.scope}
      topics={topics}
      boards={searchBoards}
      users={searchUsers}
      tags={availableTags.filter((tag) => {
        const normalizedQuery = route.query.trim().toLocaleLowerCase("zh-CN")
        return !normalizedQuery || `${tag.name} ${tag.slug}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
      })}
      contentLoading={searchingTopics && topicFeed.loadingInitial}
      userLoading={searchUsersLoading}
      contentError={topicFeed.errorInitial}
      userError={searchUsersError}
      onScopeChange={searchParams.setScope}
      onContentRetry={topicFeed.retry}
      onUserRetry={() => setSearchUsersRequestVersion((version) => version + 1)}
      onLoadMore={() => void topicFeed.loadMore()}
      nextCursor={topicFeed.nextCursor}
      loadingMore={topicFeed.loadingMore}
      errorMore={topicFeed.errorMore}
    />
  ) : route.kind === "member" ? (
    <MemberCenterPage
      activeTab={route.tab}
      error={membershipLoadedKey === membershipKey ? membershipError : null}
      csrfToken={authSession?.csrfToken}
      onChanged={() => setMembershipRequestVersion(version => version + 1)}
      data={membershipLoadedKey === membershipKey && authLoadStatus === "ready" ? membershipData : null}
      status={authLoadStatus === "error" ? "error" : membershipLoadedKey === membershipKey && authLoadStatus === "ready" ? membershipStatus : "loading"}
      onTabChange={(tab) => navigate({ kind: "member", tab })}
      onRetry={() => {
        if (!authSession) setAuthPanelOpen(true)
        else setMembershipRequestVersion((version) => version + 1)
      }}
    />
  ) : route.kind === "boardIndex" ? (
    <BoardDirectoryPage
      boards={boards}
      searchQuery={route.query ?? ""}
      onSearchChange={(query) => navigate({ ...route, query }, { replace: true })}
      expandedIds={route.expanded}
      onExpandedChange={(expanded) => navigate({ ...route, expanded }, { replace: true })}
      status={boardLoadStatus}
      error={boardLoadStatus === "error" ? "请检查网络连接后重试。" : null}
      onRetry={() => setBoardRequestVersion((version) => version + 1)}
    />
  ) : route.kind === "board" ? (
    <BoardPage
      slug={route.slug}
      state={boardPageState}
      topics={boardTopics}
      topicState={boardTopicState}
      topicError={boardTopicError}
      nextCursor={boardNextCursor}
      loadingMore={boardLoadingMore}
      errorMore={boardErrorMore}
      searchQuery={boardSearchQuery}
      sort={boardTopicSort}
      onSearchChange={(query) => navigate({ ...route, query }, { replace: true })}
      onSortChange={(sort) => navigate({ ...route, sort })}
      onCreateTopic={(boardId) => openComposer(boardId)}
      onLoadMore={() => void loadMoreBoardTopics()}
      onRetryTopics={() => setBoardTopicRequestVersion((version) => version + 1)}
      onRetryBoard={() => setBoardPageRequestVersion((version) => version + 1)}
      onOpenTopic={openTopic}
      onToggleBookmark={handleTopicBookmark}
      bookmarkPendingIds={bookmarkPendingIds}
      onToggleLike={handleTopicLike}
      likePendingIds={likePendingIds}
      interactionError={interactionError}
    />
  ) : (
    <>
      <FeedTabs active={activeFeed} onChange={selectFeed} />
      <TopicFeed
        topics={topics}
        activeFeed={activeFeed}
        tags={availableTags}
        selectedTag={selectedTag}
        onTagChange={setSelectedTag}
        loadStatus={topicLoadStatus}
        onRetry={topicFeed.retry}
        onCompose={() => openComposer()}
        onOpenTopic={openTopic}
        authenticated={Boolean(authSession)}
        onLogin={() => setAuthPanelOpen(true)}
        onToggleBookmark={handleTopicBookmark}
        bookmarkPendingIds={bookmarkPendingIds}
        onToggleLike={handleTopicLike}
        likePendingIds={likePendingIds}
        interactionError={interactionError}
        nextCursor={topicFeed.nextCursor}
        loadingMore={topicFeed.loadingMore}
        errorMore={topicFeed.errorMore}
        onLoadMore={() => void topicFeed.loadMore()}
        newTopicCount={topicFeed.newTopicCount}
        onRevealNewTopics={() => {
          topicFeed.revealNewTopics()
          const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
          window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })
        }}
      />
    </>
  )

  const main = <Suspense fallback={<CommunityRouteLoading />}>{mainContent}</Suspense>

  return (
    <CommunityShell
      surface={route.kind === "feed" || route.kind === "boardIndex" || route.kind === "board" ? "home" : "default"}
      header={(
        <SiteHeader
          navigationLinks={branding?.navigationLinks ?? []}
          siteName={branding?.siteName ?? "刀云"}
          logoUrl={branding?.logoUrl ?? null}
          darkMode={theme === "dark"}
          query={query}
          onQueryChange={setQuery}
          onClearQuery={() => {
            setQuery("")
            if (route.kind === "search") navigate({ kind: "search", query: "", scope: route.scope })
          }}
          onSearch={searchParams.submit}
          onCompose={() => openComposer(boardPageState.kind === "ready" ? boardPageState.board.id : null)}
          showCompose={route.kind !== "board" || (boardPageState.kind === "ready" && boardPageState.board.viewer.canCreateTopic)}
          showAccountSummary
          onToggleTheme={toggleTheme}
          session={authSession}
          authPending={authLoadStatus === "loading"}
          onOpenAuth={() => setAuthPanelOpen(true)}
          onLogout={handleLogout}
          notificationsUnread={notificationsUnread ?? 0}
          onOpenNotifications={openNotifications}
          systemAdminAccess={systemAdminAccess}
          managementAccess={managementAccess}
        />
      )}
      authStatus={authLoadStatus === "error" ? (
        <div className="auth-status-banner" role="alert">
          <span>登录状态暂时无法同步</span>
          <button className="secondary-button" type="button" onClick={() => setAuthRequestVersion((version) => version + 1)}>
            重试
          </button>
        </div>
      ) : null}
      leftSidebar={(
        <LeftSidebar
          boards={boards}
          loadStatus={boardLoadStatus}
          onRetry={() => setBoardRequestVersion((version) => version + 1)}
          navigationLinks={branding?.navigationLinks ?? []}
          active={primaryNavigationActive(route)}
          activeBoardSlug={route.kind === "board" ? route.slug : route.kind === "topic" ? topicDetailSidebarTopic?.boardSlug : undefined}
        />
      )}
      main={main}
      rightSidebar={(
        <RightSidebar
          variant={route.kind === "feed" ? "home" : route.kind === "boardIndex" ? "boardDirectory" : route.kind === "board" ? "boardDetail" : route.kind === "topic" ? "topicDetail" : "default"}
          showDiscovery={route.kind === "feed" || route.kind === "boardIndex" || route.kind === "topic"}
          topics={route.kind === "board" ? boardTopics : topics}
          boards={boards}
          currentBoard={boardPageState.kind === "ready" ? boardPageState.board : undefined}
          currentTopic={topicDetailSidebarTopic}
          session={authSession}
          membershipExperience={homeMembershipExperience}
          onCompose={() => openComposer()}
          onLogin={() => setAuthPanelOpen(true)}
          onOpenTopic={openTopic}
        />
      )}
      footer={(
        <SiteFooter
          siteName={branding?.siteName ?? "刀云"}
          text={branding?.footerText ?? null}
          links={branding?.footerLinks ?? []}
        />
      )}
      mobileNavigation={(
        <MobileNavigation
          onCompose={() => openComposer(boardPageState.kind === "ready" ? boardPageState.board.id : null)}
          showCompose={route.kind !== "board" || (boardPageState.kind === "ready" && boardPageState.board.viewer.canCreateTopic)}
          sessionUsername={authSession?.user.username ?? null}
          onLogin={() => setAuthPanelOpen(true)}
          active={mobileNavigationActive(route)}
        />
      )}
      overlays={(
        <>
          {composerOpen && <Suspense fallback={null}>
            <TopicComposer
              open
              boards={boards}
              session={authSession}
              suspended={authPanelOpen}
              onSessionExpired={handleComposerSessionExpired}
              onLogin={() => setAuthPanelOpen(true)}
              availableTags={availableTags}
              defaultBoardId={composerBoardId}
              onClose={() => { setComposerOpen(false); setComposerBoardId(null) }}
              onPublished={handlePublished}
            />
          </Suspense>}
          {authPanelOpen && <Suspense fallback={null}>
            <AuthPanel
              open
              mode="login"
              onClose={() => setAuthPanelOpen(false)}
              onAuthenticated={handleAuthenticated}
            />
          </Suspense>}
        </>
      )}
    />
  )
}

function CommunityRouteLoading() {
  return <div className="route-loading" role="status" aria-live="polite">正在加载页面…</div>
}

function isBackableRoute(route: CommunityPageRoute): boolean {
  return route.kind === "topic"
    || route.kind === "user"
    || route.kind === "bookmarks"
    || route.kind === "messages"
    || route.kind === "notifications"
}

function sameBackableView(left: CommunityPageRoute, right: CommunityPageRoute): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === "topic" && right.kind === "topic") return left.topicId === right.topicId
  if (left.kind === "user" && right.kind === "user") return left.username === right.username
  if (left.kind === "messages" && right.kind === "messages") return true
  return left.kind === "bookmarks" || left.kind === "notifications"
}

function primaryNavigationActive(route: CommunityPageRoute) {
  if (route.kind === "board" || route.kind === "boardIndex" || route.kind === "topic") return "community" as const
  if (route.kind === "bookmarks") return "bookmarks" as const
  if (route.kind === "feed") return route.feed === "following" ? "following" as const : "home" as const
  return "none" as const
}


function mobileNavigationActive(route: CommunityPageRoute) {
  if (route.kind === "board" || route.kind === "boardIndex" || route.kind === "topic") return "community" as const
  if (route.kind === "notifications") return "notifications" as const
  if (route.kind === "user" || route.kind === "member") return "profile" as const
  if (route.kind === "feed") return "home" as const
  return "none" as const
}

function getSavedTheme(): string | null {
  try { return localStorage.getItem("daoyun-theme") } catch { return null }
}

function getInitialTheme(): Theme {
  return getSavedTheme() === "dark" ? "dark" : "light"
}

function applyBrandingToDocument(branding: SiteBranding | null) {
  const root = document.documentElement
  const normalizedPrimaryColor = branding?.primaryColor.toLowerCase()
  const usesBuiltInCommunityBlue = normalizedPrimaryColor === "#2563eb" || normalizedPrimaryColor === "#2f7bff"
  const customPrimaryColor = branding && !usesBuiltInCommunityBlue ? branding.primaryColor : null
  root.dataset.brandPreset = branding?.themePreset ?? "default"
  root.dataset.listDensity = branding?.listDensity ?? "comfortable"
  setRootProperty(root, "--brand", customPrimaryColor ?? undefined)
  setRootProperty(root, "--brand-hover", customPrimaryColor
    ? `color-mix(in srgb, ${customPrimaryColor} 88%, #000)`
    : undefined)
  setRootProperty(root, "--brand-active", customPrimaryColor
    ? `color-mix(in srgb, ${customPrimaryColor} 78%, #000)`
    : undefined)
  setRootProperty(root, "--brand-strong", customPrimaryColor
    ? `color-mix(in srgb, var(--text) 70%, ${customPrimaryColor})`
    : undefined)
  setRootProperty(root, "--brand-soft", customPrimaryColor
    ? `color-mix(in srgb, ${customPrimaryColor} 14%, var(--surface))`
    : undefined)
  setRootProperty(root, "--brand-foreground", customPrimaryColor ? "#ffffff" : undefined)
  setRootProperty(root, "--brand-strong-foreground", customPrimaryColor ? "#ffffff" : undefined)
  setRootProperty(root, "--accent", branding?.accentColor)
  setRootProperty(root, "--accent-soft", branding ? `color-mix(in srgb, ${branding.accentColor} 14%, var(--surface))` : undefined)
  document.title = branding?.siteName ?? DEFAULT_SITE_TITLE

  const selector = 'link[data-daoyun-favicon="true"]'
  const existing = document.head.querySelector<HTMLLinkElement>(selector)
  if (!branding?.faviconUrl) {
    existing?.remove()
    return
  }

  const favicon = existing ?? (() => {
    const link = document.createElement("link")
    document.head.appendChild(link)
    return link
  })()
  favicon.dataset.daoyunFavicon = "true"
  favicon.rel = "icon"
  favicon.href = branding.faviconUrl
}

function setRootProperty(root: HTMLElement, name: string, value: string | undefined) {
  if (value) root.style.setProperty(name, value)
  else root.style.removeProperty(name)
}

function mergeTags(current: TopicTag[], incoming: TopicTag[]): TopicTag[] {
  const tags = new Map(current.map((tag) => [tag.slug, tag]))
  incoming.forEach((tag) => tags.set(tag.slug, tag))
  return [...tags.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
}
