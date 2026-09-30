import {
  Award,
  Bell,
  Bookmark,
  LoaderCircle,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
  X,
} from "lucide-react"
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { createPortal } from "react-dom"

import type { BrandLink } from "../api/admin"
import { ModalDialog } from "./ui/ModalDialog"
import type { AuthSession } from "../api/auth"
import { BrandMark } from "./BrandMark"
import { PublicMemberIdentity } from "./PublicMemberIdentity"
import { UserAvatar } from "./UserAvatar"

interface SiteHeaderProps {
  navigationLinks?: BrandLink[]
  siteName: string
  logoUrl: string | null
  darkMode: boolean
  query: string
  onQueryChange: (value: string) => void
  onClearQuery: () => void
  onSearch?: (query: string) => void
  onCompose: () => void
  showCompose?: boolean
  showAccountSummary?: boolean
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
  navigationLinks = [],
  siteName,
  logoUrl,
  darkMode,
  query,
  onQueryChange,
  onClearQuery,
  onSearch,
  onCompose,
  showCompose = true,
  showAccountSummary = false,
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
  const navigationTitleId = useId()
  const navigationTriggerRef = useRef<HTMLButtonElement>(null)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key.toLocaleLowerCase() !== "k" || (!event.ctrlKey && !event.metaKey)) {
        return
      }

      event.preventDefault()
      setMobileSearchOpen(true)
      searchInputRef.current?.focus()
      queueMicrotask(() => searchInputRef.current?.focus())
    }

    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [])

  useEffect(() => {
    if (!session) {
      setAccountMenuOpen(false)
    }
  }, [session])

  useEffect(() => {
    if (!accountMenuOpen) return
    function closeAccountMenuFromPointer(event: PointerEvent) {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) {
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener("pointerdown", closeAccountMenuFromPointer)
    return () => document.removeEventListener("pointerdown", closeAccountMenuFromPointer)
  }, [accountMenuOpen])

  function accountMenuItems() {
    return [...(accountMenuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") ?? [])]
  }

  function openAccountMenu(target: "first" | "last" = "first") {
    setAccountMenuOpen(true)
    queueMicrotask(() => {
      const items = accountMenuItems()
      items[target === "last" ? items.length - 1 : 0]?.focus()
    })
  }

  function closeAccountMenu(restoreFocus: boolean) {
    setAccountMenuOpen(false)
    if (restoreFocus) queueMicrotask(() => accountMenuTriggerRef.current?.focus())
  }

  function handleAccountTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      openAccountMenu("first")
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      openAccountMenu("last")
    }
  }

  function handleAccountMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = accountMenuItems()
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === "Escape") {
      event.preventDefault()
      closeAccountMenu(true)
      return
    }
    if (event.key === "Tab") {
      closeAccountMenu(false)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      items[0]?.focus()
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      items.at(-1)?.focus()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      items[(index + 1 + items.length) % items.length]?.focus()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    }
  }

  useEffect(() => {
    if (!mobileSearchOpen) return
    function closeSearch(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileSearchOpen(false)
    }
    window.addEventListener("keydown", closeSearch)
    return () => window.removeEventListener("keydown", closeSearch)
  }, [mobileSearchOpen])

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="wordmark" href="#hot" aria-label={`${siteName}首页`}>
          <BrandMark logoUrl={logoUrl} />
          <span className="wordmark__text">{siteName}</span>
          <span className="wordmark__edition">社区</span>
        </a>

        <button
          className="header-mobile-search-toggle"
          type="button"
          aria-label="打开搜索"
          title="搜索"
          aria-expanded={mobileSearchOpen}
          onClick={() => {
            setMobileSearchOpen(true)
            queueMicrotask(() => searchInputRef.current?.focus())
          }}
        >
          <Search size={18} aria-hidden="true" />
        </button>

        <div className={`header-search${mobileSearchOpen ? " header-search--mobile-open" : ""}`} role="search">
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
                setMobileSearchOpen(false)
              }
            }}
          />
          {query && (
            <button className="header-search__clear" type="button" onClick={onClearQuery} aria-label="清空搜索" title="清空搜索">
              <X size={15} aria-hidden="true" />
            </button>
          )}
          <button
            className="header-search__mobile-close"
            type="button"
            aria-label="关闭搜索"
            title="关闭搜索"
            onClick={() => setMobileSearchOpen(false)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="header-actions">
          <button className="icon-button" type="button" onClick={onToggleTheme} aria-label={darkMode ? "切换浅色模式" : "切换深色模式"} title={darkMode ? "浅色模式" : "深色模式"}>
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="icon-button header-navigation-toggle" type="button" ref={navigationTriggerRef} aria-label="打开导航" title="导航" aria-haspopup="dialog" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><Menu size={18} aria-hidden="true" /></button>
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
            <div ref={accountMenuRef} className="account-menu">
              <button
                ref={accountMenuTriggerRef}
                className={`avatar-button${showAccountSummary ? " avatar-button--summary" : ""}`}
                type="button"
                aria-label="打开个人菜单"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                title="个人菜单"
                onKeyDown={handleAccountTriggerKeyDown}
                onClick={() => {
                  if (accountMenuOpen) closeAccountMenu(false)
                  else openAccountMenu("first")
                }}
              >
                <UserAvatar
                  username={session.user.username}
                  displayName={session.user.displayName}
                  avatarUrl={null}
                  size="small"
                />
                {showAccountSummary && (
                  <span className="avatar-button__summary" aria-hidden="true">
                    <strong>{session.user.displayName}</strong>
                    <PublicMemberIdentity username={session.user.username} maxMedals={0} />
                  </span>
                )}
              </button>
              {accountMenuOpen && (
                <div className="account-menu__popover" role="menu" aria-label="个人菜单" onKeyDown={handleAccountMenuKeyDown}>
                  <div className="account-menu__identity">
                    <strong>{session.user.displayName}</strong>
                    <span>@{session.user.username}</span>
                  </div>
                  <a className="account-menu__action" href={`#user/${session.user.username}`} role="menuitem" onClick={() => closeAccountMenu(false)}>
                    <UserRound size={15} aria-hidden="true" />
                    个人主页
                  </a>
                  <a className="account-menu__action" href="#member" role="menuitem" onClick={() => closeAccountMenu(false)}>
                    <Award size={15} aria-hidden="true" />
                    会员中心
                  </a>
                  <a className="account-menu__action" href="#bookmarks" role="menuitem" onClick={() => closeAccountMenu(false)}>
                    <Bookmark size={15} aria-hidden="true" />
                    收藏
                  </a>
                  <a className="account-menu__action" href="#messages" role="menuitem" onClick={() => closeAccountMenu(false)}>
                    <MessageCircle size={15} aria-hidden="true" />
                    私信
                  </a>
                  <a className="account-menu__action" href="#notifications" role="menuitem" onClick={() => closeAccountMenu(false)}>
                    <Bell size={15} aria-hidden="true" />
                    通知
                  </a>
                  {(systemAdminAccess === "allowed" || managementAccess === "allowed") && (
                    <a className="account-menu__action" href="#admin" role="menuitem" onClick={() => closeAccountMenu(false)}>
                      <ShieldCheck size={15} aria-hidden="true" />
                      站点管理
                    </a>
                  )}
                  <button className="account-menu__action" type="button" role="menuitem" onClick={() => { closeAccountMenu(false); void onLogout() }}>
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
      {navigationOpen && createPortal(
        <ModalDialog titleId={navigationTitleId} className="navigation-dialog" returnFocus={navigationTriggerRef.current} onClose={() => setNavigationOpen(false)}>
          <div className="dialog-header"><h2 id={navigationTitleId}>浏览社区</h2><button className="icon-button" type="button" aria-label="关闭导航" title="关闭导航" onClick={() => setNavigationOpen(false)}><X size={18} aria-hidden="true" /></button></div>
          <nav className="navigation-dialog__links" aria-label="社区快捷导航" onClick={event => { if (event.target instanceof Element && event.target.closest("a")) setNavigationOpen(false) }}>
            <a href="#hot">首页</a><a href="#boards">社区</a><a href="#bookmarks">收藏</a><a href="#featured">发现</a><a href="#active">排行榜</a>
            {navigationLinks.map(link => <a href={link.url} key={`${link.label}-${link.url}`}>{link.label}</a>)}
          </nav>
        </ModalDialog>, document.body,
      )}
    </header>
  )
}
