import { useEffect, useState } from "react"
import { LoaderCircle, RefreshCw } from "lucide-react"

import { listBoards } from "./api/boards"
import { AuthApiError, getCurrentSession, logout } from "./api/auth"
import type { AuthSession } from "./api/auth"
import { getPublicSiteBranding } from "./api/branding"
import { getAdminAccess } from "./api/admin"
import { listModerationBoards } from "./api/moderation"
import type { SiteBranding } from "./api/admin"
import { getInstallationStatus } from "./api/installation"
import type { ConversationSummary } from "./api/messages"
import { setTopicBookmark } from "./api/relations"
import { listTags, listTopics } from "./api/topics"
import { BrandMark } from "./components/BrandMark"
import { AdminView } from "./components/AdminView"
import { AuthPanel } from "./components/AuthPanel"
import { OidcClaimView } from "./components/OidcClaimView"
import { BookmarksView } from "./components/BookmarksView"
import { NotificationsView } from "./components/NotificationsView"
import type { Notification } from "./api/notifications"
import { getUnreadNotificationCount } from "./api/notifications"
import { FeedTabs } from "./components/FeedTabs"
import { InstallationWizard } from "./components/InstallationWizard"
import { LeftSidebar } from "./components/LeftSidebar"
import { MobileNavigation } from "./components/MobileNavigation"
import { MessagesView } from "./components/MessagesView"
import { RightSidebar } from "./components/RightSidebar"
import { SiteHeader } from "./components/SiteHeader"
import { SiteFooter } from "./components/SiteFooter"
import { TopicComposer } from "./components/TopicComposer"
import { TopicFeed } from "./components/TopicFeed"
import { TopicDetailView } from "./components/TopicDetailView"
import { UserProfileView } from "./components/UserProfileView"
import type { Topic } from "./types/community"
import type { Board, FeedFilter, TopicTag } from "./types/community"
import { consumeOidcSettingsReturn } from "./utils/oidcSettingsReturn"

type Theme = "light" | "dark"
type BoardLoadStatus = "loading" | "ready" | "error"
type TopicLoadStatus = "loading" | "ready" | "error"
type InstallationGateState = "checking" | "error" | "required" | "initialized"
type AuthLoadStatus = "loading" | "ready" | "error"
type AdminAccess = "unknown" | "allowed" | "denied"

const DEFAULT_SITE_TITLE = "刀云社区"

const topicHashPattern = /^#topic\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const userHashPattern = /^#user\/([a-z][a-z0-9_]{2,31})$/
const messagesHashPattern = /^#messages(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$/i
const feedHashes: Record<FeedFilter, string> = {
  latest: "feed",
  hot: "hot",
  featured: "featured",
  following: "following",
}

function topicIdFromHash(): string | null {
  return window.location.hash.match(topicHashPattern)?.[1] ?? null
}

function usernameFromHash(): string | null {
  return window.location.hash.match(userHashPattern)?.[1] ?? null
}

function feedFromHash(): FeedFilter | null {
  const hash = window.location.hash.slice(1)
  return (Object.entries(feedHashes).find(([, value]) => value === hash)?.[0] as FeedFilter | undefined) ?? null
}

function bookmarksFromHash(): boolean {
  return window.location.hash === "#bookmarks"
}

function messagesFromHash(): { open: boolean; conversationId: string | null } {
  const match = window.location.hash.match(messagesHashPattern)
  return { open: Boolean(match), conversationId: match?.[1] ?? null }
}

function notificationsFromHash(): boolean { return window.location.hash === "#notifications" }
function adminRouteFromHash(): { requestedTab: string | null; requestedQuery: string } | null {
  const match = window.location.hash.match(/^#admin(?:\/([a-z-]+))?(?:\?(.*))?$/)
  return match ? { requestedTab: match[1] ?? null, requestedQuery: match[2] ?? "" } : null
}
function oidcClaimFromHash(): boolean { return window.location.hash === "#oidc-claim" }

function getInitialTheme(): Theme {
  return localStorage.getItem("daoyun-theme") === "dark" ? "dark" : "light"
}

export function App() {
  const [installationState, setInstallationState] = useState<InstallationGateState>("checking")
  const [installationRequestVersion, setInstallationRequestVersion] = useState(0)
  const [adminRoute, setAdminRoute] = useState(adminRouteFromHash)

  useEffect(() => {
    const handleHashChange = () => setAdminRoute(adminRouteFromHash())
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setInstallationState("checking")

    getInstallationStatus(controller.signal).then((status) => {
      if (!controller.signal.aborted) {
        setInstallationState(status.isInitialized ? "initialized" : "required")
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setInstallationState("error")
      }
    })

    return () => controller.abort()
  }, [installationRequestVersion])

  async function confirmInstallation(): Promise<boolean> {
    const status = await getInstallationStatus()
    if (status.isInitialized) {
      setInstallationState("initialized")
    }
    return status.isInitialized
  }

  if (installationState === "checking") {
    return <InstallationGateStatus kind="checking" />
  }
  if (installationState === "error") {
    return (
      <InstallationGateStatus
        kind="error"
        onRetry={() => setInstallationRequestVersion((version) => version + 1)}
      />
    )
  }
  if (installationState === "required") {
    return <InstallationWizard onConfirmInstallation={confirmInstallation} />
  }

  return adminRoute ? <SiteAdminPage requestedTab={adminRoute.requestedTab} requestedQuery={adminRoute.requestedQuery} /> : <CommunityHome />
}

function SiteAdminPage({ requestedTab, requestedQuery }: { requestedTab: string | null; requestedQuery: string }) {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    getCurrentSession(controller.signal)
      .then((current) => { if (!controller.signal.aborted) setSession(current) })
      .catch(() => { if (!controller.signal.aborted) setSession(null) })
    return () => controller.abort()
  }, [])

  return (
    <div className="system-admin-app">
      <AdminView
        session={session}
        requestedTab={requestedTab}
        requestedQuery={requestedQuery}
        onTabChange={(tab) => { window.location.hash = `admin/${tab}` }}
        onQueryChange={(query) => {
          const tab = adminRouteFromHash()?.requestedTab ?? "dashboard"
          window.location.hash = `admin/${tab}${query ? `?${query}` : ""}`
        }}
        onBack={() => { window.location.hash = "top" }}
      />
    </div>
  )
}

interface InstallationGateStatusProps {
  kind: "checking" | "error"
  onRetry?: () => void
}

function InstallationGateStatus({ kind, onRetry }: InstallationGateStatusProps) {
  return (
    <div className="installation-page">
      <header className="installation-header">
        <span className="installation-brand">
          <BrandMark />
          <strong>刀云</strong>
        </span>
        <span>实例初始化</span>
      </header>
      <main className="installation-gate-state">
        {kind === "checking" ? (
          <div role="status" aria-live="polite">
            <LoaderCircle className="installation-spinner" size={22} aria-hidden="true" />
            <p>正在检查安装状态</p>
          </div>
        ) : (
          <div role="alert">
            <h1>无法确认安装状态</h1>
            <p>请检查 API 与数据库连接后重试。</p>
            <button className="secondary-button" type="button" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              重试检查
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function CommunityHome() {
  const [activeFeed, setActiveFeed] = useState<FeedFilter>(() => feedFromHash() ?? "latest")
  const [query, setQuery] = useState("")
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [composerOpen, setComposerOpen] = useState(false)
  const [boards, setBoards] = useState<Board[]>([])
  const [boardLoadStatus, setBoardLoadStatus] = useState<BoardLoadStatus>("loading")
  const [boardRequestVersion, setBoardRequestVersion] = useState(0)
  const [topics, setTopics] = useState<Topic[]>([])
  const [topicLoadStatus, setTopicLoadStatus] = useState<TopicLoadStatus>("loading")
  const [topicRequestVersion, setTopicRequestVersion] = useState(0)
  const [availableTags, setAvailableTags] = useState<TopicTag[]>([])
  const [selectedTag, setSelectedTag] = useState("")
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [branding, setBranding] = useState<SiteBranding | null>(null)
  const [authLoadStatus, setAuthLoadStatus] = useState<AuthLoadStatus>("loading")
  const [authRequestVersion, setAuthRequestVersion] = useState(0)
  const [authPanelOpen, setAuthPanelOpen] = useState(false)
  const [selectedTopicId, setSelectedTopicId] = useState(topicIdFromHash)
  const [selectedUsername, setSelectedUsername] = useState(usernameFromHash)
  const [bookmarksOpen, setBookmarksOpen] = useState(bookmarksFromHash)
  const [messagesOpen, setMessagesOpen] = useState(() => messagesFromHash().open)
  const [notificationsOpen, setNotificationsOpen] = useState(() => notificationsFromHash())
  const [oidcClaimOpen, setOidcClaimOpen] = useState(() => oidcClaimFromHash())
  const [systemAdminAccess, setSystemAdminAccess] = useState<AdminAccess>("unknown")
  const [managementAccess, setManagementAccess] = useState<AdminAccess>("unknown")
  const [notificationsUnread, setNotificationsUnread] = useState(0)
  const [selectedConversationId, setSelectedConversationId] = useState(
    () => messagesFromHash().conversationId,
  )
  const [initialConversation, setInitialConversation] = useState<ConversationSummary | null>(null)
  const [bookmarkPendingId, setBookmarkPendingId] = useState<string | null>(null)
  const [interactionError, setInteractionError] = useState("")
  const [openIdentitySettingsFor, setOpenIdentitySettingsFor] = useState<string | null>(null)

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
    const handleHashChange = () => {
      setSelectedTopicId(topicIdFromHash())
      setSelectedUsername(usernameFromHash())
      setBookmarksOpen(bookmarksFromHash())
      const messageRoute = messagesFromHash()
      setMessagesOpen(messageRoute.open)
      setNotificationsOpen(notificationsFromHash())
      setOidcClaimOpen(oidcClaimFromHash())
      setSelectedConversationId(messageRoute.conversationId)
      setInitialConversation((current) => (
        current?.id === messageRoute.conversationId ? current : null
      ))
      const nextFeed = feedFromHash()
      if (nextFeed) {
        setActiveFeed(nextFeed)
        setTopicRequestVersion((version) => version + 1)
      }
    }
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
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
      setActiveFeed(branding.homeMode)
    }
  }, [branding])

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
            setSelectedTopicId(null)
            setSelectedUsername(returnUsername)
            setBookmarksOpen(false)
            setMessagesOpen(false)
            setNotificationsOpen(false)
            window.location.hash = `user/${returnUsername}`
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
  }, [authRequestVersion])

  useEffect(() => {
    const controller = new AbortController()
    listTags(controller.signal).then((loadedTags) => {
      if (!controller.signal.aborted) setAvailableTags(loadedTags)
    }).catch(() => {
      if (!controller.signal.aborted) setAvailableTags([])
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (activeFeed === "following" && (authLoadStatus !== "ready" || !authSession)) {
      setTopics([])
      setTopicLoadStatus("ready")
      return
    }

    const controller = new AbortController()
    setTopicLoadStatus("loading")
    const sort = activeFeed === "hot" ? "popular" : "latest"
    listTopics({
      query,
      tag: selectedTag || undefined,
      sort,
      scope: activeFeed === "following" ? "following" : undefined,
      featured: activeFeed === "featured",
      signal: controller.signal,
    }).then((page) => {
      if (!controller.signal.aborted) {
        setTopics(page.topics)
        setTopicLoadStatus("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setTopics([])
        setTopicLoadStatus("error")
      }
    })

    return () => controller.abort()
  }, [activeFeed, authLoadStatus, authSession, query, selectedTag, topicRequestVersion])

  function toggleTheme() {
    setTheme((current) => current === "dark" ? "light" : "dark")
  }

  function selectFeed(feed: FeedFilter) {
    if (window.location.hash === `#${feedHashes[feed]}`) {
      setActiveFeed(feed)
      setTopicRequestVersion((version) => version + 1)
      return
    }
    window.location.hash = feedHashes[feed]
  }

  function handleAuthenticated(session: AuthSession) {
    setAuthSession(session)
    setAuthLoadStatus("ready")
    setAuthPanelOpen(false)
  }

  function handlePublished(topic: Topic) {
    setTopics((current) => [topic, ...current.filter((item) => item.id !== topic.id)])
    setAvailableTags((current) => mergeTags(current, topic.tags))
    setTopicLoadStatus("ready")
    setBoardRequestVersion((version) => version + 1)
    setComposerOpen(false)
  }

  function handleTopicUpdated(updatedTopic: Topic) {
    setTopics((current) => current.map((topic) => topic.id === updatedTopic.id ? updatedTopic : topic))
    setAvailableTags((current) => mergeTags(current, updatedTopic.tags))
  }

  function openTopic(topicId: string) {
    window.location.hash = `topic/${topicId}`
    setSelectedTopicId(topicId)
    setSelectedUsername(null)
    setBookmarksOpen(false)
    setMessagesOpen(false)
    setNotificationsOpen(false)
    setSelectedConversationId(null)
    setInitialConversation(null)
  }

  function openConversation(
    conversationId: string | null,
    conversation: ConversationSummary | null = null,
  ) {
    window.location.hash = conversationId ? `messages/${conversationId}` : "messages"
    setSelectedTopicId(null)
    setSelectedUsername(null)
    setBookmarksOpen(false)
    setMessagesOpen(true)
    setNotificationsOpen(false)
    setSelectedConversationId(conversationId)
    setInitialConversation((current) => {
      if (conversation?.id === conversationId) return conversation
      return current?.id === conversationId ? current : null
    })
  }

  function openNotifications() {
    window.location.hash = "notifications"
    setSelectedTopicId(null)
    setSelectedUsername(null)
    setBookmarksOpen(false)
    setMessagesOpen(false)
    setNotificationsOpen(true)
    setSelectedConversationId(null)
    setInitialConversation(null)
  }

  function openNotificationTarget(notification: Notification) {
    if (notification.target === "topic") openTopic(notification.targetId)
    else if (notification.target === "conversation") openConversation(notification.targetId)
    else if (notification.target === "user" && notification.actor) {
      window.location.hash = `user/${notification.actor.username}`
      setSelectedUsername(notification.actor.username)
      setNotificationsOpen(false)
    }
  }

  function closeMainView() {
    window.location.hash = "top"
    setSelectedTopicId(null)
    setSelectedUsername(null)
    setBookmarksOpen(false)
    setMessagesOpen(false)
    setNotificationsOpen(false)
    setSelectedConversationId(null)
    setInitialConversation(null)
  }

  function applyTopicBookmark(topicId: string, bookmarked: boolean) {
    setTopics((current) => current.map((topic) => (
      topic.id === topicId ? { ...topic, bookmarked } : topic
    )))
  }

  async function handleTopicBookmark(topicId: string) {
    if (!authSession) {
      setAuthPanelOpen(true)
      return
    }
    const topic = topics.find((item) => item.id === topicId)
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

  function handleReplyPublished(topicId: string) {
    setTopics((current) => current.map((topic) => (
      topic.id === topicId ? { ...topic, replies: topic.replies + 1 } : topic
    )))
  }

  function handleReplyDeleted(topicId: string) {
    setTopics((current) => current.map((topic) => (
      topic.id === topicId ? { ...topic, replies: Math.max(0, topic.replies - 1) } : topic
    )))
  }

  function handleTopicDeleted(topicId: string) {
    setTopics((current) => current.filter((topic) => topic.id !== topicId))
    closeMainView()
    setBoardRequestVersion((version) => version + 1)
  }

  async function handleLogout() {
    if (!authSession) {
      return
    }
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
    setOidcClaimOpen(false)
    window.location.hash = "top"
  }

  if (oidcClaimOpen) {
    return (
      <OidcClaimView
        session={authSession}
        onSessionChange={setAuthSession}
        onComplete={completeOidcClaim}
      />
    )
  }

  return (
    <div className="app" id="top">
      <SiteHeader
        siteName={branding?.siteName ?? "刀云"}
        logoUrl={branding?.logoUrl ?? null}
        darkMode={theme === "dark"}
        query={query}
        onQueryChange={setQuery}
        onClearQuery={() => setQuery("")}
        onCompose={() => setComposerOpen(true)}
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

      {authLoadStatus === "error" && (
        <div className="auth-status-banner" role="alert">
          <span>登录状态暂时无法同步</span>
          <button className="secondary-button" type="button" onClick={() => setAuthRequestVersion((version) => version + 1)}>
            重试
          </button>
        </div>
      )}

      <div className="page-shell">
        <LeftSidebar
          boards={boards}
          loadStatus={boardLoadStatus}
          onRetry={() => setBoardRequestVersion((version) => version + 1)}
          navigationLinks={branding?.navigationLinks ?? []}
        />
        <main className="main-column">
          {selectedTopicId ? (
            <TopicDetailView
              topicId={selectedTopicId}
              session={authSession}
              onBack={closeMainView}
              onLogin={() => setAuthPanelOpen(true)}
              onReplyPublished={handleReplyPublished}
              onReplyDeleted={handleReplyDeleted}
              onTopicUpdated={handleTopicUpdated}
              onTopicDeleted={handleTopicDeleted}
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
          ) : bookmarksOpen ? (
            <BookmarksView
              session={authSession}
              onBack={closeMainView}
              onLogin={() => setAuthPanelOpen(true)}
              onOpenTopic={openTopic}
              onBookmarkChanged={applyTopicBookmark}
            />
          ) : notificationsOpen ? (
            <NotificationsView
              session={authSession}
              onBack={closeMainView}
              onLogin={() => setAuthPanelOpen(true)}
              onOpenTarget={openNotificationTarget}
              onUnreadChange={setNotificationsUnread}
            />
          ) : messagesOpen ? (
            <MessagesView
              session={authSession}
              conversationId={selectedConversationId}
              initialConversation={initialConversation}
              onSelectConversation={openConversation}
              onBack={closeMainView}
              onLogin={() => setAuthPanelOpen(true)}
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
                onRetry={() => setTopicRequestVersion((version) => version + 1)}
                onCompose={() => setComposerOpen(true)}
                onOpenTopic={openTopic}
                authenticated={Boolean(authSession)}
                onLogin={() => setAuthPanelOpen(true)}
                onToggleBookmark={handleTopicBookmark}
                bookmarkPendingId={bookmarkPendingId}
                interactionError={interactionError}
                defaultCoverUrl={branding?.defaultCoverUrl ?? null}
              />
            </>
          )}
        </main>
        <RightSidebar
          topics={topics}
          session={authSession}
          onCompose={() => setComposerOpen(true)}
          onLogin={() => setAuthPanelOpen(true)}
          onOpenTopic={openTopic}
        />
      </div>

      <SiteFooter
        siteName={branding?.siteName ?? "刀云"}
        text={branding?.footerText ?? null}
        links={branding?.footerLinks ?? []}
      />

      <MobileNavigation
        onCompose={() => setComposerOpen(true)}
        sessionUsername={authSession?.user.username ?? null}
        onLogin={() => setAuthPanelOpen(true)}
        active={messagesOpen
          ? "messages"
          : bookmarksOpen
            ? "bookmarks"
            : selectedUsername
              ? "profile"
              : "home"}
      />
      <TopicComposer
        open={composerOpen}
        boards={boards}
        session={authSession}
        availableTags={availableTags}
        onClose={() => setComposerOpen(false)}
        onPublished={handlePublished}
      />
      <AuthPanel
        open={authPanelOpen}
        mode="login"
        onClose={() => setAuthPanelOpen(false)}
        onAuthenticated={handleAuthenticated}
      />
    </div>
  )
}

function applyBrandingToDocument(branding: SiteBranding | null) {
  const root = document.documentElement
  root.dataset.brandPreset = branding?.themePreset ?? "default"
  root.dataset.listDensity = branding?.listDensity ?? "comfortable"
  setRootProperty(root, "--brand", branding?.primaryColor)
  setRootProperty(root, "--brand-strong", branding ? `color-mix(in srgb, ${branding.primaryColor} 78%, #000)` : undefined)
  setRootProperty(root, "--brand-soft", branding ? `color-mix(in srgb, ${branding.primaryColor} 14%, var(--surface))` : undefined)
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
