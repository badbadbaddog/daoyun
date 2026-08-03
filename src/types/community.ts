export type FeedFilter = "latest" | "hot" | "featured" | "following"
export type BoardIcon = "code" | "layout" | "aperture" | "messages"
export type BoardTone = "green" | "blue" | "amber" | "rose"

export interface Topic {
  id: string
  title: string
  excerpt: string
  board: string
  boardTone: "green" | "blue" | "amber" | "rose"
  author: string
  avatarUrl: string
  publishedAt: string
  replies: number
  likes: number
  views: number
  featured?: boolean
  hot?: boolean
  followed?: boolean
  pinned?: boolean
  imageUrl?: string
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
