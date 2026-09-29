import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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
    expect(screen.getByRole("article")).toHaveAttribute("data-variant", "feed")
    expect(screen.getByRole("article")).toHaveClass("topic-row--feed", "topic-row--discussion")

    rerender(
      <TopicRow
        topic={{ ...topic, imageUrl: "/cover.webp" }}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )

    expect(screen.getByRole("article")).toHaveAttribute("data-layout", "media")
    expect(screen.getByRole("article")).toHaveClass("topic-row--feed", "topic-row--media")
  })

  it("renders at most three public preview images", () => {
    const { container } = render(
      <TopicRow
        topic={{ ...topic, imageUrls: ["/one.webp", "/two.webp", "/three.webp", "/four.webp"] }}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )

    const article = screen.getByRole("article")
    expect(article).toHaveAttribute("data-layout", "media")
    expect(article).toHaveAttribute("data-media-count", "3")
    expect(container.querySelector(".topic-cover")).toHaveClass("topic-cover--count-3")
    expect(container.querySelectorAll(".topic-cover img")).toHaveLength(3)
    expect(container.querySelector('img[src="/four.webp"]')).not.toBeInTheDocument()
  })

  it("gives active text discussions a feed-only conversation rhythm without changing media or board layouts", () => {
    const { rerender } = render(
      <TopicRow
        topic={{ ...topic, replies: 2 }}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )

    expect(screen.getByRole("article")).toHaveAttribute("data-rhythm", "conversation")
    expect(screen.getByRole("article")).toHaveClass("topic-row--conversation")

    rerender(
      <TopicRow
        topic={{ ...topic, replies: 2, imageUrl: "/cover.webp" }}
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )
    expect(screen.getByRole("article")).toHaveAttribute("data-rhythm", "standard")
    expect(screen.getByRole("article")).not.toHaveClass("topic-row--conversation")

    rerender(
      <TopicRow
        topic={{ ...topic, replies: 2 }}
        variant="board"
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )
    expect(screen.getByRole("article")).toHaveAttribute("data-rhythm", "standard")
    expect(screen.getByRole("article")).not.toHaveClass("topic-row--conversation")
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

    expect(screen.getByRole("article")).toHaveAttribute("data-variant", "board")
    expect(screen.getByRole("article")).toHaveClass("topic-row--board", "topic-row--discussion")
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
    const { container } = render(
      <TopicRow
        topic={topic}
        identityVariant="feed"
        onOpen={vi.fn()}
        onToggleBookmark={vi.fn()}
        onToggleLike={vi.fn()}
        bookmarkPending={false}
        likePending={false}
      />,
    )

    expect(screen.getByRole("link", { name: topic.board }))
      .toHaveAttribute("href", "#board/general")
    expect(container.querySelector(".topic-author-meta"))
      .toContainElement(screen.getByRole("link", { name: topic.author }))
    expect(container.querySelector(".topic-context-meta"))
      .toContainElement(screen.getByRole("link", { name: topic.board }))
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

  it("keeps row actions from accidentally opening the topic", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onToggleBookmark = vi.fn()
    const onToggleLike = vi.fn()
    render(
      <TopicRow
        topic={topic}
        onOpen={onOpen}
        onToggleBookmark={onToggleBookmark}
        onToggleLike={onToggleLike}
        bookmarkPending={false}
        likePending={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: `取消收藏主题：${topic.title}` }))
    await user.click(screen.getByRole("button", { name: `点赞主题：${topic.title}` }))
    expect(onOpen).not.toHaveBeenCalled()

    await user.click(screen.getByRole("heading", { name: topic.title }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(topic.id)
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
  it.each([
    ["feed", undefined], ["board", undefined], ["feed", "/cover.webp"], ["board", "/cover.webp"],
  ] as const)("opens %s posts from the excerpt and row background (cover: %s)", async (variant, imageUrl) => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<div role="tabpanel" tabIndex={0}><TopicRow topic={{ ...topic, imageUrl }} variant={variant} onOpen={onOpen} bookmarkPending={false} /></div>)
    await user.click(screen.getByText(topic.excerpt))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenLastCalledWith(topic.id)
    await user.click(screen.getByRole("article"))
    expect(onOpen).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole("heading", { name: topic.title }))
    expect(onOpen).toHaveBeenCalledTimes(3)
  })

  it("preserves author and board links and does not open when selecting text", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<TopicRow topic={topic} onOpen={onOpen} bookmarkPending={false} />)
    await user.click(screen.getByRole("link", { name: topic.author }))
    await user.click(screen.getByRole("link", { name: topic.board }))
    await user.click(screen.getByRole("link", { name: `查看 ${topic.author} 的主页` }))
    expect(onOpen).not.toHaveBeenCalled()
    const range = document.createRange()
    range.selectNodeContents(screen.getByText(topic.excerpt))
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    expect(window.getSelection()!.toString()).toBe(topic.excerpt)
    try {
      fireEvent.click(screen.getByRole("article"))
      expect(onOpen).not.toHaveBeenCalled()
    } finally {
      window.getSelection()!.removeAllRanges()
    }
  })

  it("retains native modified title clicks and keyboard navigation", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<TopicRow topic={topic} onOpen={onOpen} bookmarkPending={false} />)
    const link = screen.getByRole("link", { name: topic.title })
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(onOpen).not.toHaveBeenCalled()
    link.focus()
    await user.keyboard("{Enter}")
    expect(onOpen).toHaveBeenCalledOnce()
  })

})
