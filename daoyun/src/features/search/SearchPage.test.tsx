import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { BoardSummary } from "../../api/boards"
import type { UserSummary } from "../../api/users"
import type { Topic } from "../../types/community"
import { SearchPage } from "./SearchPage"

afterEach(cleanup)

const topic = {
  id: "019fc630-0000-7000-8000-000000000101",
  title: "Rust 搜索主题",
  excerpt: "主题摘要",
  board: "工程实践",
  boardTone: "green",
  authorId: "019fc630-0000-7000-8000-000000000102",
  authorUsername: "rustacean",
  author: "Rust 用户",
  avatarUrl: null,
  publishedAt: "2026-08-27T10:00:00Z",
  replies: 2,
  likes: 3,
  bookmarked: false,
  liked: false,
  views: 10,
  tags: [{ slug: "rust", name: "Rust" }],
} satisfies Topic

const board = {
  id: "019fc630-0000-7000-8000-000000000103",
  parentId: null,
  slug: "engineering",
  name: "工程实践",
  description: "Rust 与架构",
  icon: "code",
  tone: "green",
  position: 10,
  depth: 0,
  childCount: 0,
  topicCount: 12,
} satisfies BoardSummary

const user = {
  id: "019fc630-0000-7000-8000-000000000104",
  username: "rustacean",
  displayName: "Rust 用户",
  avatarUrl: null,
} satisfies UserSummary

describe("SearchPage", () => {
  it("renders shareable topic, board and user results and changes scope", () => {
    const onScopeChange = vi.fn()
    render(
      <SearchPage
        query="Rust"
        scope="all"
        topics={[topic]}
        boards={[board]}
        users={[user]}
        tags={topic.tags}
        loading={false}
        error={null}
        onScopeChange={onScopeChange}
        onLoadMore={vi.fn()}
        nextCursor={null}
        loadingMore={false}
        errorMore={null}
      />,
    )

    expect(screen.getByRole("heading", { name: "搜索：Rust" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Rust 搜索主题/ })).toHaveAttribute("href", `#topic/${topic.id}`)
    expect(screen.getByRole("link", { name: /工程实践/ })).toHaveAttribute("href", "#board/engineering")
    expect(screen.getByRole("link", { name: /Rust 用户/ })).toHaveAttribute("href", "#user/rustacean")
    expect(screen.getByRole("link", { name: /#Rust/ })).toHaveAttribute("href", "#search?q=Rust&type=topics")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["全部", "内容", "社区", "用户", "标签"])
    fireEvent.click(screen.getByRole("tab", { name: "社区" }))
    expect(onScopeChange).toHaveBeenCalledWith("boards")
  })
})

it("shows filter-only content and clears filters without removing the search page",()=>{
 const onFiltersChange=vi.fn()
 render(<SearchPage query="" scope="topics" topics={[topic]} boards={[]} users={[]} tags={[]} loading={false} error={null} onScopeChange={vi.fn()} onLoadMore={vi.fn()} nextCursor={null} loadingMore={false} errorMore={null} filters={{author:"rustacean",from:"2026-08-01"}} onFiltersChange={onFiltersChange} availableBoards={[board]}/>)
 expect(screen.getByRole("link",{name:/Rust 搜索主题/})).toBeInTheDocument()
 expect(screen.getByLabelText("作者用户名")).toHaveValue("rustacean")
 expect(screen.getByLabelText("开始日期")).toHaveValue("2026-08-01")
 fireEvent.click(screen.getByRole("button",{name:"清除筛选"}))
 expect(onFiltersChange).toHaveBeenCalledWith({})
})
