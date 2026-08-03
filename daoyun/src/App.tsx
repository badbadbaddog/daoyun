import { useMemo, useState } from "react"

import { FeedTabs } from "./components/FeedTabs"
import { LeftSidebar } from "./components/LeftSidebar"
import { MobileNavigation } from "./components/MobileNavigation"
import { RightSidebar } from "./components/RightSidebar"
import { SiteHeader } from "./components/SiteHeader"
import { TopicComposer } from "./components/TopicComposer"
import { TopicFeed } from "./components/TopicFeed"
import { topics } from "./data/community"
import type { FeedFilter } from "./types/community"

export function App() {
  const [activeFeed, setActiveFeed] = useState<FeedFilter>("latest")
  const [query, setQuery] = useState("")
  const [darkMode, setDarkMode] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)

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
    setDarkMode((current) => {
      const next = !current
      document.documentElement.dataset.theme = next ? "dark" : "light"
      return next
    })
  }

  return (
    <div className="app" id="top">
      <SiteHeader
        darkMode={darkMode}
        query={query}
        onQueryChange={setQuery}
        onCompose={() => setComposerOpen(true)}
        onToggleTheme={toggleTheme}
      />

      <div className="page-shell">
        <LeftSidebar />
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
