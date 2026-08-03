import { useEffect, useMemo, useState } from "react"

import { listBoards } from "./api/boards"
import { FeedTabs } from "./components/FeedTabs"
import { LeftSidebar } from "./components/LeftSidebar"
import { MobileNavigation } from "./components/MobileNavigation"
import { RightSidebar } from "./components/RightSidebar"
import { SiteHeader } from "./components/SiteHeader"
import { TopicComposer } from "./components/TopicComposer"
import { TopicFeed } from "./components/TopicFeed"
import { topics } from "./data/community"
import type { Board, FeedFilter } from "./types/community"

type Theme = "light" | "dark"
type BoardLoadStatus = "loading" | "ready" | "error"

function getInitialTheme(): Theme {
  return localStorage.getItem("daoyun-theme") === "dark" ? "dark" : "light"
}

export function App() {
  const [activeFeed, setActiveFeed] = useState<FeedFilter>("latest")
  const [query, setQuery] = useState("")
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [composerOpen, setComposerOpen] = useState(false)
  const [boards, setBoards] = useState<Board[]>([])
  const [boardLoadStatus, setBoardLoadStatus] = useState<BoardLoadStatus>("loading")
  const [boardRequestVersion, setBoardRequestVersion] = useState(0)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem("daoyun-theme", theme)
  }, [theme])

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

  const visibleTopics = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN")

    return topics.filter((topic) => {
      const matchesFeed = activeFeed === "latest"
        || (activeFeed === "hot" && topic.hot)
        || (activeFeed === "featured" && topic.featured)
        || (activeFeed === "following" && topic.followed)

      const searchableText = `${topic.title} ${topic.excerpt} ${topic.board} ${topic.author}`.toLocaleLowerCase("zh-CN")
      return matchesFeed && (!normalizedQuery || searchableText.includes(normalizedQuery))
    })
  }, [activeFeed, query])

  function toggleTheme() {
    setTheme((current) => current === "dark" ? "light" : "dark")
  }

  return (
    <div className="app" id="top">
      <SiteHeader
        darkMode={theme === "dark"}
        query={query}
        onQueryChange={setQuery}
        onCompose={() => setComposerOpen(true)}
        onToggleTheme={toggleTheme}
      />

      <div className="page-shell">
        <LeftSidebar
          boards={boards}
          loadStatus={boardLoadStatus}
          onRetry={() => setBoardRequestVersion((version) => version + 1)}
        />
        <main className="main-column">
          <FeedTabs active={activeFeed} onChange={setActiveFeed} />
          <TopicFeed topics={visibleTopics} onCompose={() => setComposerOpen(true)} />
        </main>
        <RightSidebar onCompose={() => setComposerOpen(true)} />
      </div>

      <MobileNavigation onCompose={() => setComposerOpen(true)} />
      <TopicComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
    </div>
  )
}
