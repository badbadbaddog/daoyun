import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { BoardApiError, getBoard, listBoards } from "../api/boards"
import type { BoardDetail } from "../api/boards"
import { AuthApiError, getCurrentSession, logout } from "../api/auth"
import type { AuthSession } from "../api/auth"
import { getPublicSiteBranding } from "../api/branding"
import type { FeedMode } from "../api/feed"
import { getAdminAccess } from "../api/admin"
import type { SiteBranding } from "../api/admin"
import { listModerationBoards } from "../api/moderation"
import type { ConversationSummary } from "../api/messages"
import { getUnreadNotificationCount } from "../api/notifications"
import type { Notification } from "../api/notifications"
import { loadMembershipCenterData } from "../api/membership"
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
import type { MembershipCenterData } from "../features/membership/membershipTypes"
import { useFeedScrollRestoration } from "../features/feed/useFeedScrollRestoration"
import { useSearchParams } from "../features/search/useSearchParams"
import { useTopicFeed } from "../features/search/useTopicFeed"
import type { CommunityRoute } from "../router/communityRoute"
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

interface CommunityAppProps {
  route: Exclude<CommunityRoute, { kind: "admin" }>
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
  const [boardTopicState, setBoardTopicState] = useState<TopicLoadStatus>("loading")
  const [boardTopicError, setBoardTopicError] = useState<string | null>(null)
  const [boardNextCursor, setBoardNextCursor] = useState<string | null>(null)
  const [boardLoadingMore, setBoardLoadingMore] = useState(false)
  const [boardErrorMore, setBoardErrorMore] = useState<string | null>(null)
  const [boardSearchQuery, setBoardSearchQuery] = useState("")
  const [boardTopicSort, setBoardTopicSort] = useState<BoardTopicSort>("latest")
  const [boardTopicRequestVersion, setBoardTopicRequestVersion] = useState(0)
  const [composerBoardId, setComposerBoardId] = useState<string | null>(null)
  const [topicRequestVersion, setTopicRequestVersion] = useState(0)
  const [topicDetailSidebarTopic, setTopicDetailSidebarTopic] = useState<Topic | null>(null)
  const [availableTags, setAvailableTags] = useState<TopicTag[]>([])
  const [selectedTag, setSelectedTag] = useState("")
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [branding, setBranding] = useState<SiteBranding | null>(null)
  const [authLoadStatus, setAuthLoadStatus] = useState<AuthLoadStatus>("loading")
  const [authRequestVersion, setAuthRequestVersion] = useState(0)
  const [authPanelOpen, setAuthPanelOpen] = useState(false)
  const [systemAdminAccess, setSystemAdminAccess] = useState<AdminAccess>("unknown")
  const [managementAccess, setManagementAccess] = useState<AdminAccess>("unknown")
  const [notificationsUnread, setNotificationsUnread] = useState(0)
  const [initialConversation, setInitialConversation] = useState<ConversationSummary | null>(null)
  const [bookmarkPendingId, setBookmarkPendingId] = useState<string | null>(null)
  const [likePendingId, setLikePendingId] = useState<string | null>(null)
  const [interactionError, setInteractionError] = useState("")
  const [openIdentitySettingsFor, setOpenIdentitySettingsFor] = useState<string | null>(null)
  const [searchUsers, setSearchUsers] = useState<UserSummary[]>([])
  const [searchUsersLoading, setSearchUsersLoading] = useState(false)
  const [searchUsersError, setSearchUsersError] = useState<string | null>(null)
  const [searchUsersRequestVersion, setSearchUsersRequestVersion] = useState(0)
  const [membershipData, setMembershipData] = useState<MembershipCenterData | null>(null)
  const [membershipStatus, setMembershipStatus] = useState<"loading" | "ready" | "error">("loading")
  const [membershipRequestVersion, setMembershipRequestVersion] = useState(0)
  const searchParams = useSearchParams(route, navigate)
  const searchingTopics = route.kind === "search"
    && Boolean(route.query)
    && (route.scope === "all" || route.scope === "topics")
  const feedMode: FeedMode | undefined = !searchingTopics && !selectedTag
    ? activeFeed === "hot" ? "recommended"
      : activeFeed === "following" ? "following"
        : activeFeed === "latest" ? "latest"
          : undefined
    : undefined
  const topicFeed = useTopicFeed({
    enabled: searchingTopics || (route.kind !== "search"
      && !(activeFeed === "following" && (authLoadStatus !== "ready" || !authSession))),
    mode: feedMode,
    query: searchingTopics ? route.query : undefined,
    tag: searchingTopics ? undefined : selectedTag || undefined,
    sort: feedMode ? undefined : searchingTopics ? "latest" : activeFeed === "hot" ? "popular" : activeFeed === "active" ? "active" : "latest",
    scope: feedMode ? undefined : searchingTopics ? undefined : activeFeed === "following" ? "following" : undefined,
    featured: feedMode ? false : searchingTopics ? false : activeFeed === "featured",
    requestVersion: topicRequestVersion,
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
    if (route.kind === "search") setQuery(route.query)
  }, [route])

  useEffect(() => {
    if (route.kind !== "member") return
    if (authLoadStatus !== "ready") {
      setMembershipStatus("loading")
      return
    }
    if (!authSession) {
      setMembershipData(null)
      setMembershipStatus("error")
      return
    }
    const controller = new AbortController()
    setMembershipStatus("loading")
    loadMembershipCenterData(authSession.user.username, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setMembershipData(data)
        setMembershipStatus("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) setMembershipStatus("error")
    })
    return () => controller.abort()
  }, [authLoadStatus, authSession, membershipRequestVersion, route.kind])

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
      current?.id === selectedConversationId ? current : null
    ))
  }, [selectedConversationId])

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
    if (!authSession) { setNotificationsUnread(0); return }
    const controller = new AbortController()
    getUnreadNotificationCount(controller.signal).then((count) => {
      if (!controller.signal.aborted) setNotificationsUnread(count)
    }).catch(() => undefined)
    return () => controller.abort()
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
    localStorage.setItem("daoyun-theme", theme)
  }, [theme])

  useEffect(() => {
    applyBrandingToDocument(branding)
    if (branding?.themePreset === "dark" && localStorage.getItem("daoyun-theme") === null) {
      setTheme("dark")
    }
    if (branding && !window.location.hash) {
      navigate({ kind: "feed", feed: branding.homeMode }, { replace: true })
    }
  }, [branding, navigate])

  useEffect(() => {
    const controller = new AbortController()
    setBoardLoadStatus("loading")

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
  }, [boardRequestVersion])

  useEffect(() => {
    if (!selectedBoardSlug) return
    const controller = new AbortController()
    setBoardPageState({ kind: "loading" })
    setBoardTopics([])
    setBoardTopicState("loading")
    setBoardTopicError(null)
    setBoardNextCursor(null)
    setBoardErrorMore(null)
    setBoardSearchQuery("")
    setBoardTopicSort("latest")
    getBoard(selectedBoardSlug, controller.signal).then((board) => {
      if (!controller.signal.aborted) setBoardPageState({ kind: "ready", board })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof BoardApiError && error.status === 403) setBoardPageState({ kind: "forbidden" })
      else if (error instanceof BoardApiError && error.status === 404) setBoardPageState({ kind: "notFound" })
      else setBoardPageState({ kind: "error", message: "请检查网络连接后重试。" })
    })
    return () => controller.abort()
  }, [selectedBoardSlug, boardPageRequestVersion])

  useEffect(() => {
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
    return () => controller.abort()
  }, [boardPageState, boardSearchQuery, boardTopicRequestVersion, boardTopicSort, selectedBoardSlug])

  useEffect(() => {
    const controller = new AbortController()
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

  function handleAuthenticated(session: AuthSession) {
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
    if (!selectedBoardSlug || !boardNextCursor || boardLoadingMore) return
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
      })
      setBoardTopics((current) => {
        const topicsById = new Map(current.map((topic) => [topic.id, topic]))
        page.topics.forEach((topic) => topicsById.set(topic.id, topic))
        return [...topicsById.values()]
      })
      setBoardNextCursor(page.nextCursor)
    } catch {
      setBoardErrorMore("更多主题加载失败，已保留当前内容。")
    } finally {
      setBoardLoadingMore(false)
    }
  }

  function handleTopicUpdated(updatedTopic: Topic) {
    topicFeed.updateTopics((current) => current.map((topic) => topic.id === updatedTopic.id ? updatedTopic : topic))
    setTopicDetailSidebarTopic((current) => current?.id === updatedTopic.id ? updatedTopic : current)
    setAvailableTags((current) => mergeTags(current, updatedTopic.tags))
  }

  function openTopic(topicId: string) {
    setInitialConversation(null)
    setTopicDetailSidebarTopic(null)
    navigate({ kind: "topic", topicId })
  }

  function openConversation(
    conversationId: string | null,
    conversation: ConversationSummary | null = null,
  ) {
    setInitialConversation((current) => {
      if (conversation?.id === conversationId) return conversation
      return current?.id === conversationId ? current : null
    })
    navigate({ kind: "messages", conversationId })
  }

  function openNotifications() {
    setInitialConversation(null)
    navigate({ kind: "notifications" })
  }

  function openNotificationTarget(notification: Notification) {
    if (notification.target === "topic") openTopic(notification.targetId)
    else if (notification.target === "conversation") openConversation(notification.targetId)
    else if (notification.target === "user" && notification.actor) {
      navigate({ kind: "user", username: notification.actor.username })
    }
  }

  function closeMainView() {
    setInitialConversation(null)
    setTopicDetailSidebarTopic(null)
    navigate({ kind: "feed", feed: "latest" })
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
    const topic = topics.find((item) => item.id === topicId)
      ?? boardTopics.find((item) => item.id === topicId)
    if (!topic) return
    const bookmarked = topic.bookmarked !== true
    setBookmarkPendingId(topicId)
    setInteractionError("")
    try {
      const state = await setTopicBookmark(topicId, bookmarked, authSession.csrfToken)
      applyTopicBookmark(state.topicId, state.bookmarked)
    } catch {
      setInteractionError("收藏状态暂时无法更新。")
    } finally {
      setBookmarkPendingId(null)
    }
  }

  async function handleTopicLike(topicId: string) {
    if (!authSession) {
      setAuthPanelOpen(true)
      return
    }
    const topic = topics.find((item) => item.id === topicId)
      ?? boardTopics.find((item) => item.id === topicId)
    if (!topic) return
    const liked = topic.liked !== true
    setLikePendingId(topicId)
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
      setLikePendingId(null)
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
    navigate({ kind: "feed", feed: "latest" })
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
      onSessionChange={setAuthSession}
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
      onUnreadChange={setNotificationsUnread}
    />
  ) : route.kind === "messages" ? (
    <MessagesView
      session={authSession}
      conversationId={selectedConversationId}
      initialConversation={initialConversation}
      onSelectConversation={openConversation}
      onBack={closeMainView}
      onLogin={() => setAuthPanelOpen(true)}
    />
  ) : route.kind === "search" ? (
    <SearchPage
      query={route.query}
      scope={route.scope}
      topics={topics}
      boards={searchBoards}
      users={searchUsers}
      tags={availableTags.filter((tag) => {
        const normalizedQuery = route.query.trim().toLocaleLowerCase("zh-CN")
        return !normalizedQuery || `${tag.name} ${tag.slug}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
      })}
      loading={(searchingTopics && topicFeed.loadingInitial) || searchUsersLoading}
      error={route.scope === "topics"
        ? topicFeed.errorInitial
        : route.scope === "users" ? searchUsersError : null}
      onScopeChange={searchParams.setScope}
      onRetry={() => {
        topicFeed.retry()
        setSearchUsersRequestVersion((version) => version + 1)
      }}
      onLoadMore={() => void topicFeed.loadMore()}
      nextCursor={topicFeed.nextCursor}
      loadingMore={topicFeed.loadingMore}
      errorMore={topicFeed.errorMore}
    />
  ) : route.kind === "member" ? (
    <MemberCenterPage
      activeTab={route.tab}
      data={membershipData}
      status={membershipStatus}
      onTabChange={(tab) => navigate({ kind: "member", tab })}
      onRetry={() => {
        if (!authSession) setAuthPanelOpen(true)
        else setMembershipRequestVersion((version) => version + 1)
      }}
    />
  ) : route.kind === "boardIndex" ? (
    <BoardDirectoryPage
      boards={boards}
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
      onSearchChange={setBoardSearchQuery}
      onSortChange={setBoardTopicSort}
      onCreateTopic={(boardId) => openComposer(boardId)}
      onLoadMore={() => void loadMoreBoardTopics()}
      onRetryTopics={() => setBoardTopicRequestVersion((version) => version + 1)}
      onRetryBoard={() => setBoardPageRequestVersion((version) => version + 1)}
      onOpenTopic={openTopic}
      onToggleBookmark={handleTopicBookmark}
      bookmarkPendingId={bookmarkPendingId}
      onToggleLike={handleTopicLike}
      likePendingId={likePendingId}
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
        bookmarkPendingId={bookmarkPendingId}
        onToggleLike={handleTopicLike}
        likePendingId={likePendingId}
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
      header={(
        <SiteHeader
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
          onToggleTheme={toggleTheme}
          session={authSession}
          authPending={authLoadStatus === "loading"}
          onOpenAuth={() => setAuthPanelOpen(true)}
          onLogout={handleLogout}
          notificationsUnread={notificationsUnread}
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
        />
      )}
      main={main}
      rightSidebar={(
        <RightSidebar
          variant={route.kind === "boardIndex" ? "boardDirectory" : route.kind === "board" ? "boardDetail" : route.kind === "topic" ? "topicDetail" : "default"}
          topics={route.kind === "board" ? boardTopics : topics}
          boards={boards}
          currentBoard={boardPageState.kind === "ready" ? boardPageState.board : undefined}
          currentTopic={topicDetailSidebarTopic}
          session={authSession}
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

function primaryNavigationActive(route: Exclude<CommunityRoute, { kind: "admin" }>) {
  if (route.kind === "board" || route.kind === "boardIndex") return "community" as const
  if (route.kind === "bookmarks") return "bookmarks" as const
  if (route.kind === "feed") return route.feed === "following" ? "following" as const : "home" as const
  return "none" as const
}

function mobileNavigationActive(route: Exclude<CommunityRoute, { kind: "admin" }>) {
  if (route.kind === "board" || route.kind === "boardIndex") return "community" as const
  if (route.kind === "notifications") return "notifications" as const
  if (route.kind === "user" || route.kind === "member") return "profile" as const
  if (route.kind === "feed") return "home" as const
  return "none" as const
}

function getInitialTheme(): Theme {
  return localStorage.getItem("daoyun-theme") === "dark" ? "dark" : "light"
}

function applyBrandingToDocument(branding: SiteBranding | null) {
  const root = document.documentElement
  const usesClearCommunityBlue = branding?.primaryColor.toLowerCase() === "#2f7bff"
  const customPrimaryColor = branding && !usesClearCommunityBlue ? branding.primaryColor : null
  root.dataset.brandPreset = branding?.themePreset ?? "default"
  root.dataset.listDensity = branding?.listDensity ?? "comfortable"
  setRootProperty(root, "--brand", branding?.primaryColor)
  setRootProperty(root, "--brand-hover", customPrimaryColor
    ? `color-mix(in srgb, ${customPrimaryColor} 88%, #000)`
    : undefined)
  setRootProperty(root, "--brand-active", customPrimaryColor
    ? `color-mix(in srgb, ${customPrimaryColor} 78%, #000)`
    : undefined)
  setRootProperty(root, "--brand-strong", customPrimaryColor
    ? `color-mix(in srgb, ${customPrimaryColor} 78%, #000)`
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
