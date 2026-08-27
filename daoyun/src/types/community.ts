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
  boardTone: "green" | "blue" | "amber" | "rose"
  authorId: string
  authorUsername: string
  author: string
  avatarUrl: string | null
  publishedAt: string
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
  tags: TopicTag[]
}
export interface Board {
  id: string
  slug: string
  name: string
  description: string
  icon: BoardIcon
  tone: BoardTone
  topicCount: number
}
