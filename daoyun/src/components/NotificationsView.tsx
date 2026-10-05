import { ArrowLeft, Bell, CheckCheck, FileSearch, LoaderCircle, RefreshCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { AuthSession } from "../api/auth"
import { getUnreadNotificationCount, listNotifications, markAllNotificationsRead, markNotificationRead } from "../api/notifications"
import type { Notification } from "../api/notifications"
import { UserAvatar } from "./UserAvatar"

interface NotificationsViewProps {
  session: AuthSession | null
  onBack: () => void
  onLogin: () => void
  onOpenTarget: (notification: Notification) => void
  onUnreadChange?: (count: number, version?: number) => void
  onUnreadRequest?: () => number
  globalUnreadCount?: number | null
}

type LoadStatus = "loading" | "ready" | "error"
type NotificationFilter = "all" | "unread"

export function NotificationsView({ session, onBack, onLogin, onOpenTarget, onUnreadChange, onUnreadRequest, globalUnreadCount }: NotificationsViewProps) {
  const [items, setItems] = useState<Notification[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<LoadStatus>(session ? "loading" : "ready")
  const [requestVersion, setRequestVersion] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<NotificationFilter>("all")
  const visibleItems = items
  const [unreadCount, setUnreadCount] = useState<number | null>(null)
  const authoritativeCount = globalUnreadCount === undefined ? unreadCount : globalUnreadCount
  const scope = useRef<AbortController | null>(null)
  const countVersion = useRef(0)
  const latestSession = useRef(session); latestSession.current = session
  const unreadChanged = useRef(onUnreadChange); unreadChanged.current = onUnreadChange
  const unreadRequested = useRef(onUnreadRequest); unreadRequested.current = onUnreadRequest
  function applyCount(count: number, version: number | undefined) {
    setUnreadCount(count)
    if (version === undefined) unreadChanged.current?.(count)
    else unreadChanged.current?.(count, version)
  }
  const notificationFilters: NotificationFilter[] = ["all", "unread"]
  const selectFilter = (index: number) => {
    const next = notificationFilters[(index + notificationFilters.length) % notificationFilters.length]
    setFilter(next)
    document.getElementById(`notifications-tab-${next}`)?.focus()
  }
  const handleFilterKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") { event.preventDefault(); selectFilter(index + 1) }
    else if (event.key === "ArrowLeft") { event.preventDefault(); selectFilter(index - 1) }
    else if (event.key === "Home") { event.preventDefault(); selectFilter(0) }
    else if (event.key === "End") { event.preventDefault(); selectFilter(notificationFilters.length - 1) }
  }

  useEffect(() => {
    const refresh = () => setRequestVersion(value => value + 1)
    const visible = () => { if (document.visibilityState === "visible") refresh() }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", visible)
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    scope.current = controller
    const version = ++countVersion.current
    setItems([]); setCursor(null); setBusyId(null); setLoadingMore(false); setError(""); setUnreadCount(null)
    if (!session) { setStatus("ready"); return () => controller.abort() }
    const active = () => !controller.signal.aborted && latestSession.current === session
    setStatus("loading")
    // Ignore cancelled effects: https://react.dev/reference/react/useEffect#fetching-data-with-effects
    void listNotifications({ unread: filter === "unread", signal: controller.signal }).then(page => {
      if (!active()) return
      setItems(page.notifications); setCursor(page.nextCursor); setStatus("ready")
    }).catch(() => { if (active()) setStatus("error") })
    const globalVersion = unreadRequested.current?.()
    void getUnreadNotificationCount(controller.signal).then(count => {
      if (!active() || version !== countVersion.current) return
      applyCount(count, globalVersion)
    }).catch(() => { if (active() && version === countVersion.current) setUnreadCount(null) })
    return () => controller.abort()
  }, [requestVersion, session, filter])

  async function markOne(item: Notification) {
    if (!session || !scope.current) return
    if (item.readAt) return
    if (busyId) return
    const controller = scope.current
    const version = ++countVersion.current
    const active = () => !controller.signal.aborted && scope.current === controller && latestSession.current === session
    setBusyId(item.id); setError("")
    try {
      const updated = await markNotificationRead(item.id, session.csrfToken, controller.signal)
      if (!active()) return
      setItems(current => filter === "unread" ? current.filter(entry => entry.id !== updated.id) : current.map(entry => entry.id === updated.id ? updated : entry))
      try {
        const globalVersion = unreadRequested.current?.()
        const count = await getUnreadNotificationCount(controller.signal)
        if (active() && version === countVersion.current) { applyCount(count, globalVersion) }
      } catch { if (active()) { setUnreadCount(null); setError("通知已标记为已读，未读计数暂时无法刷新。") } }
    } catch { if (active()) setError("通知已读状态暂时无法更新。") }
    finally { if (active()) setBusyId(null) }
  }

  async function markAll() {
    if (!session || busyId || !scope.current) return
    const controller = scope.current
    ++countVersion.current
    const active = () => !controller.signal.aborted && scope.current === controller && latestSession.current === session
    setBusyId("all"); setError("")
    try {
      const globalVersion = unreadRequested.current?.()
      const count = await markAllNotificationsRead(session.csrfToken, controller.signal)
      if (!active()) return
      applyCount(count, globalVersion)
      setRequestVersion(value => value + 1)
    } catch { if (active()) setError("通知已读状态暂时无法更新。") }
    finally { if (active()) setBusyId(null) }
  }

  async function loadMore() {
    if (!session || !cursor || loadingMore || !scope.current) return
    const controller = scope.current
    const active = () => !controller.signal.aborted && scope.current === controller && latestSession.current === session
    setLoadingMore(true); setError("")
    try {
      const page = await listNotifications({ cursor, unread: filter === "unread", signal: controller.signal })
      if (!active()) return
      setItems(current => [...current, ...page.notifications.filter(item => !current.some(entry => entry.id === item.id))])
      setCursor(page.nextCursor)
    } catch { if (active()) setError("更多通知暂时无法加载。") }
    finally { if (active()) setLoadingMore(false) }
  }

  return (
    <section className="notifications-view" aria-labelledby="notifications-heading">
      <button className="detail-back" type="button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />返回社区</button>
      <header className="notifications-view__header">
        <div><p>账户动态</p><h1 id="notifications-heading">通知</h1>{session && <p aria-live="polite">{authoritativeCount === null ? "未读计数暂不可用" : `全站未读 ${authoritativeCount}`}</p>}</div>
        <button className="icon-button" type="button" onClick={() => void markAll()} disabled={!session || status !== "ready" || busyId !== null || authoritativeCount === 0} aria-label="全部标记为已读" title="全部标记为已读"><CheckCheck size={19} /></button>
      </header>
      {session && (
        <div className="notifications-tabs" role="tablist" aria-label="通知筛选">
          <button id="notifications-tab-all" type="button" role="tab" aria-controls="notifications-panel" aria-selected={filter === "all"} tabIndex={filter === "all" ? 0 : -1} onClick={() => setFilter("all")} onKeyDown={(event) => handleFilterKey(event, 0)}>全部</button>
          <button id="notifications-tab-unread" type="button" role="tab" aria-controls="notifications-panel" aria-selected={filter === "unread"} tabIndex={filter === "unread" ? 0 : -1} onClick={() => setFilter("unread")} onKeyDown={(event) => handleFilterKey(event, 1)}>未读</button>
        </div>
      )}
      {!session ? (
        <div className="empty-state" role="status"><Bell size={28} aria-hidden="true" /><h2>登录后查看通知</h2><p>关注、回复、点赞和私信动态会显示在这里。</p><button className="primary-button empty-state__action" type="button" onClick={onLogin}>登录查看通知</button></div>
      ) : status === "loading" ? (
        <div className="topic-loading" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" />正在加载通知</div>
      ) : status === "error" ? (
        <div className="empty-state" role="alert"><FileSearch size={28} aria-hidden="true" /><h2>通知暂时无法加载</h2><button className="secondary-button empty-state__action" type="button" onClick={() => setRequestVersion((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" />重试加载通知</button></div>
      ) : (
        <>
          {error && <p className="interaction-alert" role="alert">{error}</p>}
          <div id="notifications-panel" role="tabpanel" aria-labelledby={`notifications-tab-${filter}`}>
            {visibleItems.length === 0 ? <div className="empty-state" role="status"><Bell size={28} aria-hidden="true" /><h2>{filter === "unread" ? "没有未读通知" : "还没有通知"}</h2><p>{filter === "unread" ? "新通知会在这里出现。" : "新的社区动态会显示在这里。"}</p></div> : <div className="notification-list">{visibleItems.map((item) => <NotificationItem key={item.id} item={item} busy={busyId === item.id} onRead={() => void markOne(item)} onOpen={() => onOpenTarget(item)} />)}</div>}
          </div>
          {cursor && <button className="secondary-button notifications-view__more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "正在加载" : "加载更多通知"}</button>}
        </>
      )}
    </section>
  )
}

function NotificationItem({ item, busy, onRead, onOpen }: { item: Notification; busy: boolean; onRead: () => void; onOpen: () => void }) {
  const actor = item.actor?.displayName ?? "有人"
  return <article className={item.readAt ? "notification-item notification-item--read" : "notification-item"}>
    {item.actor ? <UserAvatar username={item.actor.username} displayName={item.actor.displayName} avatarUrl={item.actor.avatarUrl} size="small" /> : <Bell size={18} aria-hidden="true" />}
    <button className="notification-item__body" type="button" onClick={onOpen}>
      <strong>{notificationText(item.kind, actor)}</strong>
      <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
    </button>
    {!item.readAt && <button className="icon-button" type="button" onClick={onRead} disabled={busy} aria-label="标记通知为已读" title="标记为已读"><CheckCheck size={16} /></button>}
  </article>
}

function notificationText(kind: Notification["kind"], actor: string): string { return kind === "follow" ? `${actor} 开始关注你` : kind === "reply" ? `${actor} 回复了你的主题` : kind === "like" ? `${actor} 赞了你的内容` : kind === "message" ? `${actor} 给你发来一条私信` : kind === "topic_governance" ? "主题治理状态有新的更新" : "内容举报状态有新的更新" }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) }
