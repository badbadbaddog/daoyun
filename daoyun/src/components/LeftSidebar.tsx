import { Aperture, Bookmark, Code2, Compass, Home, LayoutGrid, MessageSquareText, RefreshCw, Users } from "lucide-react"

import type { BrandLink } from "../api/admin"
import type { Board } from "../types/community"

const boardIcons = {
  code: Code2,
  layout: LayoutGrid,
  aperture: Aperture,
  messages: MessageSquareText,
} as const

interface LeftSidebarProps {
  boards: Board[]
  loadStatus: "loading" | "ready" | "error"
  onRetry: () => void
  navigationLinks: BrandLink[]
  active?: "home" | "following" | "community" | "bookmarks" | "none"
}

export function LeftSidebar({ boards, loadStatus, onRetry, navigationLinks, active = "home" }: LeftSidebarProps) {
  return (
    <aside className="left-sidebar" aria-label="社区导航">
      <nav className="sidebar-nav">
        <a className={sidebarLinkClass(active === "home")} href="#hot" aria-current={active === "home" ? "page" : undefined}>
          <Home size={18} />
          <span>首页</span>
        </a>
        <a className={sidebarLinkClass(active === "following")} href="#following" aria-current={active === "following" ? "page" : undefined}>
          <Users size={18} />
          <span>关注</span>
        </a>
        <a className={sidebarLinkClass(active === "community")} href="#boards" aria-current={active === "community" ? "page" : undefined}>
          <LayoutGrid size={18} />
          <span>社区</span>
        </a>
        <a className={sidebarLinkClass(active === "bookmarks")} href="#bookmarks" aria-current={active === "bookmarks" ? "page" : undefined}>
          <Bookmark size={18} />
          <span>收藏</span>
        </a>
      </nav>

      {navigationLinks.length > 0 && (
        <>
          <div className="sidebar-section-heading"><span>站点导航</span></div>
          <nav className="sidebar-nav sidebar-nav--custom" aria-label="站点导航">
            {navigationLinks.map((link) => <a className="sidebar-link" href={link.url} key={`${link.label}-${link.url}`}><Compass size={17} aria-hidden="true" /><span>{link.label}</span></a>)}
          </nav>
        </>
      )}

      <div className="sidebar-section-heading">
        <span>常用社区</span>
        <a href="#boards">全部</a>
      </div>
      <nav className="sidebar-nav sidebar-nav--boards" aria-label="常用社区" aria-busy={loadStatus === "loading"}>
        {loadStatus === "loading" && (
          <div className="board-loading" role="status">
            <span className="sr-only">正在加载社区</span>
            {Array.from({ length: 4 }, (_, index) => <span aria-hidden="true" key={index} />)}
          </div>
        )}

        {loadStatus === "error" && (
          <div className="board-load-error" role="alert">
            <span>社区加载失败</span>
            <button type="button" onClick={onRetry} aria-label="重试加载社区" title="重试">
              <RefreshCw size={14} />
              <span>重试</span>
            </button>
          </div>
        )}

        {loadStatus === "ready" && boards.length === 0 && (
          <p className="board-empty" role="status">暂无常用社区</p>
        )}

        {loadStatus === "ready" && boards.map((board) => {
          const Icon = boardIcons[board.icon] ?? MessageSquareText

          return (
            <a className="sidebar-link sidebar-link--board" href={`#board/${board.slug}`} key={board.id} title={board.description}>
              <span className="board-icon"><Icon size={16} /></span>
              <span>{board.name}</span>
              <small>{board.topicCount}</small>
            </a>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <a href="#guidelines">社区准则</a>
        <a href="#about">关于刀云</a>
        <span>DaoYun 0.1</span>
      </div>
    </aside>
  )
}

function sidebarLinkClass(active: boolean): string {
  return active ? "sidebar-link sidebar-link--active" : "sidebar-link"
}
