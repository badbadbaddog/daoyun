import { ArrowRight, Compass, Sparkles } from "lucide-react"

import type { Topic } from "../types/community"
import { topicDisplayTitle } from "../utils/topicPresentation"

interface HomeShowcaseProps {
  topics: Topic[]
  onCompose: () => void
  onOpenTopic: (topicId: string) => void
}

export function HomeShowcase({ topics, onCompose, onOpenTopic }: HomeShowcaseProps) {
  const mediaTopics = topics.filter(topicMediaUrl)
  const primary = mediaTopics[0] ?? topics[0]
  const primaryImage = primary ? topicMediaUrl(primary) : null
  const secondaryTopics = mediaTopics.filter((topic) => topic.id !== primary?.id).slice(0, 2)

  return (
    <section className="home-showcase" aria-labelledby="home-showcase-title">
      <article className="home-showcase__lead">
        {primaryImage && (
          <img
            src={primaryImage}
            alt={`${topicDisplayTitle(primary)} 配图`}
            loading="eager"
            decoding="async"
          />
        )}
        <div className="home-showcase__lead-content">
          <span>刀云社区 · 今日精选</span>
          <h1 id="home-showcase-title">记录每一种热爱</h1>
          <p>遇见同好，分享你的世界</p>
          <button type="button" onClick={onCompose}>
            立即发布
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </article>

      <div className="home-showcase__rail" aria-label="精选内容">
        {Array.from({ length: 2 }, (_, index) => {
          const topic = secondaryTopics[index]
          if (!topic) return <ShowcasePlaceholder key={index} index={index} />
          const title = topicDisplayTitle(topic)

          return (
            <a
              className="home-showcase__feature"
              href={`#topic/${topic.id}`}
              key={topic.id}
              onClick={(event) => {
                event.preventDefault()
                onOpenTopic(topic.id)
              }}
            >
              <img src={topicMediaUrl(topic)!} alt="" loading="lazy" decoding="async" />
              <span>{topic.board}</span>
              <strong>{title}</strong>
            </a>
          )
        })}
      </div>
    </section>
  )
}

function ShowcasePlaceholder({ index }: { index: number }) {
  const Icon = index === 0 ? Compass : Sparkles
  return (
    <a className="home-showcase__feature home-showcase__feature--placeholder" href={index === 0 ? "#boards" : "#featured"}>
      <Icon size={28} aria-hidden="true" />
      <span>{index === 0 ? "发现社区" : "灵感精选"}</span>
      <strong>{index === 0 ? "找到属于你的兴趣圈" : "看看大家正在分享什么"}</strong>
    </a>
  )
}

function topicMediaUrl(topic: Topic): string | null {
  return topic.imageUrls?.[0] ?? topic.imageUrl ?? null
}
