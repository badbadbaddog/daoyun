import type { SearchScope } from "../../router/communityRoute"

const tabs: { scope: SearchScope; label: string }[] = [
  { scope: "all", label: "全部" },
  { scope: "topics", label: "内容" },
  { scope: "boards", label: "社区" },
  { scope: "users", label: "用户" },
  { scope: "tags", label: "标签" },
]

export function SearchTabs({ scope, onChange }: { scope: SearchScope; onChange: (scope: SearchScope) => void }) {
  const selectAt = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length]
    onChange(next.scope)
    document.getElementById(`search-tab-${next.scope}`)?.focus()
  }

  return (
    <div className="search-tabs" role="tablist" aria-label="搜索类型">
      {tabs.map((tab, index) => (
        <button
          id={`search-tab-${tab.scope}`}
          key={tab.scope}
          type="button"
          role="tab"
          aria-controls="search-results-panel"
          aria-selected={scope === tab.scope}
          tabIndex={scope === tab.scope ? 0 : -1}
          onClick={() => onChange(tab.scope)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); selectAt(index + 1) }
            else if (event.key === "ArrowLeft") { event.preventDefault(); selectAt(index - 1) }
            else if (event.key === "Home") { event.preventDefault(); selectAt(0) }
            else if (event.key === "End") { event.preventDefault(); selectAt(tabs.length - 1) }
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
