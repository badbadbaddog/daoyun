import { Bell, Moon, Plus, Search, Sun } from "lucide-react"
import { useEffect, useRef } from "react"

import { BrandMark } from "./BrandMark"

interface SiteHeaderProps {
  darkMode: boolean
  query: string
  onQueryChange: (value: string) => void
  onCompose: () => void
  onToggleTheme: () => void
}

export function SiteHeader({
  darkMode,
  query,
  onQueryChange,
  onCompose,
  onToggleTheme,
}: SiteHeaderProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="wordmark" href="#top" aria-label="刀云首页">
          <BrandMark />
          <span className="wordmark__text">刀云</span>
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
            placeholder="搜索主题、板块或成员"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>

        <div className="header-actions">
          <button className="icon-button" type="button" onClick={onToggleTheme} aria-label={darkMode ? "切换浅色模式" : "切换深色模式"} title={darkMode ? "浅色模式" : "深色模式"}>
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="icon-button notification-button" type="button" aria-label="查看通知" title="通知">
            <Bell size={18} />
            <span className="notification-dot" />
          </button>
          <button className="primary-button header-compose" type="button" onClick={onCompose} aria-label="从顶部发布新主题">
            <Plus size={17} />
            <span>发布主题</span>
          </button>
          <button className="avatar-button" type="button" aria-label="打开个人菜单" title="个人菜单">
            <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80" alt="林屿" />
          </button>
        </div>
      </div>
    </header>
  )
}
