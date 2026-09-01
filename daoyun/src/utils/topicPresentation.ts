import type { Topic } from "../types/community"

export function topicDisplayTitle(
  topic: Pick<Topic, "title" | "excerpt">,
  fallback = "内容详情",
): string {
  const title = topic.title.trim()
  if (title) return title

  const excerpt = topic.excerpt.trim().replace(/\s+/g, " ")
  if (!excerpt) return fallback
  return [...excerpt].slice(0, 80).join("")
}

export function topicHasTitle(topic: Pick<Topic, "title">): boolean {
  return Boolean(topic.title.trim())
}
