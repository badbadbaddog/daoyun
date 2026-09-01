import { Award, Bell, LoaderCircle, LogIn, LogOut, MessageCircle, Moon, Plus, Search, ShieldCheck, Sun, UserRound, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { AuthSession } from "../api/auth"
import { BrandMark } from "./BrandMark"
import { UserAvatar } from "./UserAvatar"

interface SiteHeaderProps {
  siteName: string
  logoUrl: string | null
  darkMode: boolean
  query: string
  onQueryChange: (value: string) => void
  onClearQuery: () => void
  onSearch?: (query: string) => void
  onCompose: () => void
  showCompose?: boolean
  onToggleTheme: () => void
  session: AuthSession | null
  onOpenAuth: () => void
  onLogout: () => Promise<void>
  authPending: boolean
  notificationsUnread: number
  onOpenNotifications: () => void
  systemAdminAccess: "unknown" | "allowed" | "denied"
  managementAccess: "unknown" | "allowed" | "denied"
}

export function SiteHeader({
  siteName,
  logoUrl,
  darkMode,
  query,
  onQueryChange,
  onClearQuery,
  onSearch,
  onCompose,
  showCompose = true,
  onToggleTheme,
  session,
  onOpenAuth,
  onLogout,
  authPending,
  notificationsUnread,
  onOpenNotifications,
  systemAdminAccess,
  managementAccess,
}: SiteHeaderProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key.toLocaleLowerCase() !== "k" || (!event.ctrlKey && !event.metaKey)) {
        return
      }

      event.preventDefault()
      searchInputRef.current?.focus()
    }

    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [])

  useEffect(() => {
    if (!session) {
      setAccountMenuOpen(false)
    }
  }, [session])

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="wordmark" href="#top" aria-label={`${siteName}首页`}>
          <BrandMark logoUrl={logoUrl} />
          <span className="wordmark__text">{siteName}</span>
          <span className="wordmark__edition">社区</span>
        </a>

        <label className="header-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索社区内容</span>
          <input
            ref={searchInputRef}
            type="search"
            aria-label="搜索社区内容"
            aria-keyshortcuts="Control+K Meta+K"
            placeholder="搜索内容、社区或用户"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && onSearch) {
                event.preventDefault()
                onSearch(query)
              }
            }}
          />
          {query && (
            <button className="header-search__clear" type="button" onClick={onClearQuery} aria-label="清空搜索">
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </label>

        <div className="header-actions">
          <button className="icon-button" type="button" onClick={onToggleTheme} aria-label={darkMode ? "切换浅色模式" : "切换深色模式"} title={darkMode ? "浅色模式" : "深色模式"}>
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <a className="icon-button notification-button" href="#messages" aria-label="查看私信" title="私信">
            <MessageCircle size={18} />
          </a>
          <button className="icon-button notification-button" type="button" onClick={onOpenNotifications} aria-label={notificationsUnread > 0 ? `查看通知，${notificationsUnread} 条未读` : "查看通知"} title="通知">
            <Bell size={18} />
            {notificationsUnread > 0 && <span className="notification-badge">{notificationsUnread > 99 ? "99+" : notificationsUnread}</span>}
          </button>
          {showCompose && (
            <button className="primary-button header-compose" type="button" onClick={onCompose} aria-label="从顶部发布新主题">
              <Plus size={17} />
              <span>发布</span>
            </button>
          )}
          {authPending ? (
            <button className="secondary-button header-login" type="button" disabled aria-label="正在读取登录状态">
              <LoaderCircle className="auth-loading-icon" size={15} aria-hidden="true" />
              登录状态
            </button>
          ) : session ? (
            <div className="account-menu">
              <button
                className="avatar-button"
                type="button"
                aria-label="打开个人菜单"
                aria-expanded={accountMenuOpen}
                title="个人菜单"
                onClick={() => setAccountMenuOpen((open) => !open)}
              >
                <UserAvatar
                  username={session.user.username}
                  displayName={session.user.displayName}
                  avatarUrl={null}
                  size="small"
                />
              </button>
              {accountMenuOpen && (
                <div className="account-menu__popover" role="menu" aria-label="个人菜单">
                  <div className="account-menu__identity">
                    <strong>{session.user.displayName}</strong>
                    <span>@{session.user.username}</span>
                  </div>
                  <a className="account-menu__action" href={`#user/${session.user.username}`} role="menuitem" onClick={() => setAccountMenuOpen(false)}>
                    <UserRound size={15} aria-hidden="true" />
                    个人主页
                  </a>
                  <a className="account-menu__action" href="#member" role="menuitem" onClick={() => setAccountMenuOpen(false)}>
                    <Award size={15} aria-hidden="true" />
                    会员中心
                  </a>
                  <a className="account-menu__action" href="#messages" role="menuitem" onClick={() => setAccountMenuOpen(false)}>
                    <MessageCircle size={15} aria-hidden="true" />
                    私信
                  </a>
                  <a className="account-menu__action" href="#notifications" role="menuitem" onClick={() => setAccountMenuOpen(false)}>
                    <Bell size={15} aria-hidden="true" />
                    通知
                  </a>
                  {(systemAdminAccess === "allowed" || managementAccess === "allowed") && (
                    <a className="account-menu__action" href="#admin" role="menuitem" onClick={() => setAccountMenuOpen(false)}>
                      <ShieldCheck size={15} aria-hidden="true" />
                      站点管理
                    </a>
                  )}
                  <button className="account-menu__action" type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); void onLogout() }}>
                    <LogOut size={15} aria-hidden="true" />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="secondary-button header-login" type="button" onClick={onOpenAuth}>
              <LogIn size={15} aria-hidden="true" />
              登录
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
