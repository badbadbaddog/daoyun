import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthSession } from "../api/auth"
import { listBookmarks, setTopicBookmark } from "../api/relations"
import type { Topic } from "../types/community"
import { BookmarksView } from "./BookmarksView"

vi.mock("../api/relations", async () => {
  const actual = await vi.importActual<typeof import("../api/relations")>("../api/relations")
  return {
    ...actual,
    listBookmarks: vi.fn(),
    setTopicBookmark: vi.fn(),
  }
})

const session: AuthSession = {
  user: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

const topic: Topic = {
  id: "019fc800-0000-7000-8000-000000000101",
  title: "已收藏主题",
  excerpt: "摘要",
  board: "社区广场",
  boardTone: "green",
  authorId: session.user.id,
  authorUsername: session.user.username,
  author: session.user.displayName,
  avatarUrl: null,
  publishedAt: "刚刚",
  replies: 0,
  likes: 2,
  bookmarked: true,
  liked: false,
  views: 3,
  tags: [],
}

const secondTopic: Topic = {
  ...topic,
  id: "019fc800-0000-7000-8000-000000000102",
  title: "第二个收藏主题",
}

beforeEach(() => {
  vi.mocked(listBookmarks).mockReset().mockResolvedValue({ topics: [topic], nextCursor: null })
  vi.mocked(setTopicBookmark).mockReset().mockResolvedValue({
    topicId: topic.id,
    bookmarked: false,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("BookmarksView", () => {
  it("prompts signed-out visitors to log in without requesting private data", async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    render(<BookmarksView session={null} onBack={vi.fn()} onLogin={onLogin} onOpenTopic={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "登录查看收藏" }))
    expect(onLogin).toHaveBeenCalledTimes(1)
    expect(listBookmarks).not.toHaveBeenCalled()
  })

  it("loads bookmarks and removes a topic after unbookmarking", async () => {
    const user = userEvent.setup()
    render(<BookmarksView session={session} onBack={vi.fn()} onLogin={vi.fn()} onOpenTopic={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: "我的收藏" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: `取消收藏主题：${topic.title}` }))
    expect(setTopicBookmark).toHaveBeenCalledWith(topic.id, false, session.csrfToken)
    expect(await screen.findByText("还没有收藏主题")).toBeInTheDocument()
  })

  it("keeps each bookmark row pending until its own request finishes", async () => {
    vi.mocked(listBookmarks).mockResolvedValue({ topics: [topic, secondTopic], nextCursor: null })
    let resolveFirst!: (value: { topicId: string; bookmarked: boolean }) => void
    let resolveSecond!: (value: { topicId: string; bookmarked: boolean }) => void
    vi.mocked(setTopicBookmark)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
    const user = userEvent.setup()
    render(<BookmarksView session={session} onBack={vi.fn()} onLogin={vi.fn()} onOpenTopic={vi.fn()} />)

    const first = await screen.findByRole("button", { name: `取消收藏主题：${topic.title}` })
    const second = await screen.findByRole("button", { name: `取消收藏主题：${secondTopic.title}` })
    await user.click(first)
    await user.click(second)

    expect(first).toBeDisabled()
    expect(second).toBeDisabled()

    resolveFirst({ topicId: topic.id, bookmarked: false })
    await waitFor(() => expect(screen.queryByText(topic.title)).not.toBeInTheDocument())
    expect(second).toBeDisabled()

    resolveSecond({ topicId: secondTopic.id, bookmarked: false })
    expect(await screen.findByText("还没有收藏主题")).toBeInTheDocument()
  })

  it("retries a failed list request", async () => {
    const user = userEvent.setup()
    vi.mocked(listBookmarks)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ topics: [topic], nextCursor: null })
    render(<BookmarksView session={session} onBack={vi.fn()} onLogin={vi.fn()} onOpenTopic={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "重试加载收藏" }))
    expect(await screen.findByText(topic.title)).toBeInTheDocument()
    expect(listBookmarks).toHaveBeenCalledTimes(2)
  })
})
