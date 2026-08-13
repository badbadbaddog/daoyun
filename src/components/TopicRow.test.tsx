import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Topic } from "../types/community"
import { TopicRow } from "./TopicRow"

const topic: Topic = {
  id: "019fc800-0000-7000-8000-000000000101",
  title: "收藏按钮测试",
  excerpt: "摘要",
  board: "社区广场",
  boardTone: "green",
  authorId: "019fc700-0000-7000-8000-000000000004",
  authorUsername: "member",
  author: "社区成员",
  avatarUrl: null,
  publishedAt: "刚刚",
  replies: 0,
  likes: 2,
  bookmarked: true,
  liked: false,
  views: 3,
  tags: [],
}

afterEach(cleanup)

describe("TopicRow", () => {
  it("exposes bookmark target state and invokes the container action", async () => {
    const user = userEvent.setup()
    const onToggleBookmark = vi.fn()
    render(
      <TopicRow
        topic={topic}
        onOpen={vi.fn()}
        onToggleBookmark={onToggleBookmark}
        bookmarkPending={false}
      />,
    )

    const button = screen.getByRole("button", { name: `取消收藏主题：${topic.title}` })
    expect(button).toHaveAttribute("aria-pressed", "true")
    await user.click(button)
    expect(onToggleBookmark).toHaveBeenCalledWith(topic.id)
  })

  it("keeps the control stable and disabled while a mutation is pending", () => {
    render(
      <TopicRow
        topic={{ ...topic, bookmarked: false }}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending
      />,
    )
    expect(screen.getByRole("button", { name: `正在收藏主题：${topic.title}` }))
      .toBeDisabled()
  })
})
