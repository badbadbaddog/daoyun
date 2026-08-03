export type FeedFilter = "latest" | "hot" | "featured" | "following"

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
  name: string
  description: string
  icon: string
  count: number
}
