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
}

export function LeftSidebar({ boards, loadStatus, onRetry, navigationLinks }: LeftSidebarProps) {
  return (
    <aside className="left-sidebar" aria-label="社区导航">
      <nav className="sidebar-nav">
        <a className="sidebar-link sidebar-link--active" href="#feed" aria-current="page">
          <Home size={18} />
          <span>首页</span>
        </a>
        <a className="sidebar-link" href="#discover">
          <Compass size={18} />
          <span>发现</span>
        </a>
        <a className="sidebar-link" href="#following">
          <Users size={18} />
          <span>关注</span>
        </a>
        <a className="sidebar-link" href="#bookmarks">
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
        <span>社区板块</span>
        <a href="#boards">全部</a>
      </div>
      <nav className="sidebar-nav sidebar-nav--boards" id="boards" aria-label="社区板块" aria-busy={loadStatus === "loading"}>
        {loadStatus === "loading" && (
          <div className="board-loading" role="status">
            <span className="sr-only">正在加载板块</span>
            {Array.from({ length: 4 }, (_, index) => <span aria-hidden="true" key={index} />)}
          </div>
        )}

        {loadStatus === "error" && (
          <div className="board-load-error" role="alert">
            <span>板块加载失败</span>
            <button type="button" onClick={onRetry} aria-label="重试加载板块" title="重试">
              <RefreshCw size={14} />
              <span>重试</span>
            </button>
          </div>
        )}

        {loadStatus === "ready" && boards.length === 0 && (
          <p className="board-empty" role="status">暂无公开板块</p>
        )}

        {loadStatus === "ready" && boards.map((board) => {
          const Icon = boardIcons[board.icon] ?? MessageSquareText

          return (
            <a className="sidebar-link sidebar-link--board" href={`#board-${board.slug}`} key={board.id} title={board.description}>
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
