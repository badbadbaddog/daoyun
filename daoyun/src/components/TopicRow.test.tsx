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
  boardSlug: "general",
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
  it("selects the media-card layout only when a cover is available", () => {
    const { rerender } = render(
      <TopicRow
        topic={topic}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )

    expect(screen.getByRole("article")).toHaveAttribute("data-layout", "discussion")

    rerender(
      <TopicRow
        topic={{ ...topic, imageUrl: "/cover.webp" }}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )

    expect(screen.getByRole("article")).toHaveAttribute("data-layout", "media")
  })

  it("uses a forum status marker instead of an author avatar in board lists", () => {
    const { container } = render(
      <TopicRow
        topic={{ ...topic, pinned: true, featured: true }}
        variant="board"
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )

    expect(container.querySelector(".board-topic-marker")).toHaveAttribute("aria-label", "置顶主题")
    expect(container.querySelector(".topic-avatar")).not.toBeInTheDocument()
    expect(screen.getByText("置顶")).toBeInTheDocument()
    expect(screen.getByText("精华")).toBeInTheDocument()
  })

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

  it("links the display board name through its canonical slug", () => {
    render(
      <TopicRow
        topic={topic}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        onToggleLike={vi.fn()}
        bookmarkPending={false}
        likePending={false}
      />,
    )

    expect(screen.getByRole("link", { name: topic.board }))
      .toHaveAttribute("href", "#board/general")
  })

  it("falls back to the board directory for an unroutable slug", () => {
    render(
      <TopicRow
        topic={{ ...topic, boardSlug: "general/escape" }}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )

    expect(screen.getByRole("link", { name: topic.board }))
      .toHaveAttribute("href", "#boards")
  })

  it("exposes the feed like action and its pressed state", async () => {
    const user = userEvent.setup()
    const onToggleLike = vi.fn()
    render(
      <TopicRow
        topic={topic}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        onToggleLike={onToggleLike}
        bookmarkPending={false}
        likePending={false}
      />,
    )

    const button = screen.getByRole("button", { name: `点赞主题：${topic.title}` })
    expect(button).toHaveAttribute("aria-pressed", "false")
    await user.click(button)
    expect(onToggleLike).toHaveBeenCalledWith(topic.id)
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
