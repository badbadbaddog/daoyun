import type { FeedFilter } from "../types/community"

const tabs: Array<{ id: FeedFilter; label: string }> = [
  { id: "hot", label: "推荐" },
  { id: "following", label: "关注" },
  { id: "latest", label: "最新" },
]

interface FeedTabsProps {
  active: FeedFilter
  onChange: (filter: FeedFilter) => void
}
export function FeedTabs({ active, onChange }: FeedTabsProps) {
  const visibleActive = tabs.some((tab) => tab.id === active)
    ? active
    : active === "featured" ? "hot" : "latest"

  const selectFromKeyboard = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length]
    onChange(next.id)
    document.getElementById(`feed-tab-${next.id}`)?.focus()
  }

  return (
    <div className="feed-tabs" id="feed-tabs" role="tablist" aria-label="首页内容流">
      {tabs.map((tab) => {
        const isActive = visibleActive === tab.id

        return (
          <button
            className={`feed-tab${isActive ? " feed-tab--active" : ""}`}
            type="button"
            role="tab"
            id={`feed-tab-${tab.id}`}
            aria-controls="feed-panel"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              const index = tabs.findIndex((item) => item.id === tab.id)
              if (event.key === "ArrowRight") {
                event.preventDefault()
                selectFromKeyboard(index + 1)
              } else if (event.key === "ArrowLeft") {
                event.preventDefault()
                selectFromKeyboard(index - 1)
              } else if (event.key === "Home") {
                event.preventDefault()
                selectFromKeyboard(0)
              } else if (event.key === "End") {
                event.preventDefault()
                selectFromKeyboard(tabs.length - 1)
              }
            }}
          >
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
