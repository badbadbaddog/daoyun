import { Aperture, Bookmark, Code2, Compass, Home, LayoutGrid, MessageSquareText, Users } from "lucide-react"

import { boards } from "../data/community"

const boardIcons = {
  code: Code2,
  layout: LayoutGrid,
  aperture: Aperture,
  messages: MessageSquareText,
} as const

export function LeftSidebar() {
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

      <div className="sidebar-section-heading">
        <span>社区板块</span>
        <a href="#boards">全部</a>
      </div>
      <nav className="sidebar-nav sidebar-nav--boards" id="boards">
        {boards.map((board) => {
          const Icon = boardIcons[board.icon as keyof typeof boardIcons]

          return (
            <a className="sidebar-link sidebar-link--board" href={`#${board.id}`} key={board.id} title={board.description}>
              <span className="board-icon"><Icon size={16} /></span>
              <span>{board.name}</span>
              <small>{board.count}</small>
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
