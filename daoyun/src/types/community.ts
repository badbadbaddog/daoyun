export type FeedFilter = "latest" | "active" | "hot" | "featured" | "following"
export type BoardIcon = "code" | "layout" | "aperture" | "messages"
export type BoardTone = "green" | "blue" | "amber" | "rose"

export interface TopicTag {
  slug: string
  name: string
}

export interface Topic {
  id: string
  title: string
  excerpt: string
  board: string
  boardSlug?: string
  boardTone: "green" | "blue" | "amber" | "rose"
  authorId: string
  authorUsername: string
  author: string
  avatarUrl: string | null
  publishedAt: string
  publishedAtIso?: string
  replies: number
  likes: number
  bookmarked: boolean | null
  liked: boolean | null
  views: number
  featured?: boolean
  hot?: boolean
  followed?: boolean
  pinned?: boolean
  imageUrl?: string
  imageUrls?: string[]
  tags: TopicTag[]
}
export interface Board {
  id: string
  parentId: string | null
  slug: string
  name: string
  description: string
  icon: BoardIcon
  tone: BoardTone
  position: number
  depth: number
  childCount: number
  topicCount: number
}
