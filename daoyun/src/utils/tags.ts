import type { TopicTag } from "../types/community"

export interface TopicHashtag {
  name: string
  start: number
  end: number
}

export function parseTopicTags(value: string, availableTags: TopicTag[] = []): TopicTag[] {
  const known = new Map(availableTags.flatMap((tag) => [
    [tag.slug.toLocaleLowerCase(), tag],
    [tag.name.toLocaleLowerCase(), tag],
  ]))
  const seen = new Set<string>()
  return value.split(",").map((item) => item.trim()).filter(Boolean).flatMap((item) => {
    const knownTag = known.get(item.toLocaleLowerCase())
    const slug = knownTag?.slug ?? slugFromName(item)
    if (!slug || seen.has(slug)) return []
    seen.add(slug)
    return [{ slug, name: knownTag?.name ?? item.slice(0, 40) }]
  }).slice(0, 5)
}

export function findTopicHashtags(value: string): TopicHashtag[] {
  return Array.from(value.matchAll(/#([\p{L}\p{N}_-]+)/gu), (match) => ({
    name: match[1],
    start: match.index,
    end: match.index + match[0].length,
  }))
}

export function extractTopicTags(value: string, availableTags: TopicTag[] = []): TopicTag[] {
  return parseTopicTags(findTopicHashtags(value).map((match) => match.name).join(","), availableTags)
}

function slugFromName(name: string): string {
  const ascii = name.normalize("NFKD").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (ascii) return ascii.slice(0, 40).replace(/-+$/g, "")

  const codePoints = [...name].map((character) => character.codePointAt(0)?.toString(36) ?? "")
  return `tag-${codePoints.join("-")}`.slice(0, 40).replace(/-+$/g, "")
}
