import type { ComponentProps } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TopicFeed } from "./TopicFeed"

afterEach(cleanup)

function feedProps(overrides: Partial<ComponentProps<typeof TopicFeed>> = {}): ComponentProps<typeof TopicFeed> {
  return {
    topics: [{ id: "019fc800-0000-7000-8000-000000000101", title: "社区发帖规范与内容管理公告", excerpt: "正文在详情中展示", board: "社区公告", boardSlug: "general", boardTone: "blue", authorId: "author", authorUsername: "member", author: "DaoYun 官方", avatarUrl: null, publishedAt: "2 天前", replies: 128, likes: 12, views: 3600, liked: false, bookmarked: false, pinned: true, tags: [{ slug: "experience", name: "经验" }], imageUrl: "/cover.webp" }],
    activeFeed: "hot", tags: [], selectedTag: "", onTagChange: vi.fn(), loadStatus: "ready", onRetry: vi.fn(), onCompose: vi.fn(), onOpenTopic: vi.fn(), authenticated: true, onLogin: vi.fn(), onToggleBookmark: vi.fn(), bookmarkPendingIds: new Set(), onToggleLike: vi.fn(), likePendingIds: new Set(), interactionError: "", ...overrides,
  }
}

describe("TopicFeed", () => {
  it("shows compact rows directly beneath filters without a banner or composer card", () => {
    const { container } = render(<TopicFeed {...feedProps()} />)
    expect(screen.getByRole("article")).toHaveAttribute("data-variant", "list")
    expect(screen.getByRole("heading", { name: "社区发帖规范与内容管理公告" })).toBeInTheDocument()
    expect(screen.getByText("置顶")).toBeInTheDocument()
    expect(screen.getByText("128")).toBeInTheDocument()
    expect(screen.getByText("3.6k")).toBeInTheDocument()
    expect(screen.queryByText("正文在详情中展示")).not.toBeInTheDocument()
    expect(container.querySelector(".composer-prompt, .topic-cover")).not.toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "按标签筛选" })).toBeInTheDocument()
  })

  it("keeps loading in the compact row layout without showing an empty result", () => {
    const { container } = render(<TopicFeed {...feedProps({ topics: [], loadStatus: "loading" })} />)
    expect(screen.getByRole("status")).toHaveTextContent("正在加载主题")
    expect(container.querySelectorAll(".topic-list-skeleton")).toHaveLength(4)
    expect(container.querySelector(".topic-list")).toHaveAttribute("aria-busy", "true")
    expect(screen.queryByText("没有找到相关主题")).not.toBeInTheDocument()
  })

  it("lets an empty filtered feed clear the tag and an unfiltered feed start a topic", async () => {
    const user = userEvent.setup()
    const props = feedProps({ topics: [], selectedTag: "rust" })
    const { rerender } = render(<TopicFeed {...props} />)
    await user.click(screen.getByRole("button", { name: "查看全部主题" }))
    expect(props.onTagChange).toHaveBeenCalledWith("")
    expect(screen.queryByRole("button", { name: "发布第一篇主题" })).not.toBeInTheDocument()
    rerender(<TopicFeed {...props} selectedTag="" />)
    await user.click(screen.getByRole("button", { name: "发布第一篇主题" }))
    expect(props.onCompose).toHaveBeenCalledOnce()
  })

  it("keeps following empty states relevant to signing in and discovering members", async () => {
    const user = userEvent.setup()
    const props = feedProps({ topics: [], activeFeed: "following", authenticated: false })
    const { rerender } = render(<TopicFeed {...props} />)
    await user.click(screen.getByRole("button", { name: "登录查看关注动态" }))
    expect(props.onLogin).toHaveBeenCalledOnce()
    rerender(<TopicFeed {...props} authenticated />)
    expect(screen.getByRole("link", { name: "浏览社区" })).toHaveAttribute("href", "#boards")
    expect(screen.queryByRole("button", { name: "发布第一篇主题" })).not.toBeInTheDocument()
  })

  it("allows initial errors to retry without an empty-state action", async () => {
    const props = feedProps({ topics: [], loadStatus: "error" })
    render(<TopicFeed {...props} />)
    expect(screen.getByRole("alert")).toHaveTextContent("主题暂时无法加载")
    await userEvent.setup().click(screen.getByRole("button", { name: "重试加载主题" }))
    expect(props.onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByRole("button", { name: "发布第一篇主题" })).not.toBeInTheDocument()
  })

  it("retains current rows while loading more and gives a failed page a clear retry action", async () => {
    const props = feedProps({ nextCursor: "next", loadingMore: true, onLoadMore: vi.fn() })
    const { container, rerender } = render(<TopicFeed {...props} />)
    expect(screen.getByRole("article")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "正在加载" })).toBeDisabled()
    expect(container.querySelector(".topic-list")).toHaveAttribute("aria-busy", "true")
    rerender(<TopicFeed {...props} loadingMore={false} errorMore="更多主题加载失败，已保留当前内容。" />)
    expect(screen.getByRole("article")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("已保留当前内容")
    await userEvent.setup().click(screen.getByRole("button", { name: "重试加载更多" }))
    expect(props.onLoadMore).toHaveBeenCalledOnce()
  })
})
