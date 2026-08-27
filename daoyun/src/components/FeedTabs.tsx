import { Clock3, Flame, MessageCircle, Sparkles, Users2 } from "lucide-react"

import type { FeedFilter } from "../types/community"

const tabs: Array<{ id: FeedFilter; label: string; icon: typeof Clock3 }> = [
  { id: "latest", label: "最新发帖", icon: Clock3 },
  { id: "active", label: "最新回复", icon: MessageCircle },
  { id: "hot", label: "热门讨论", icon: Flame },
  { id: "featured", label: "精华", icon: Sparkles },
  { id: "following", label: "关注", icon: Users2 },
]

interface FeedTabsProps {
  active: FeedFilter
  onChange: (filter: FeedFilter) => void
}
export function FeedTabs({ active, onChange }: FeedTabsProps) {
  return (
    <div className="feed-tabs" role="tablist" aria-label="主题排序">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = active === tab.id

        return (
          <button
            className={`feed-tab${isActive ? " feed-tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            key={tab.id}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={16} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
