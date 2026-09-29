import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LeftSidebar } from "./LeftSidebar"

afterEach(cleanup)

describe("LeftSidebar", () => {
  it("keeps the primary community destinations compact and content-first", () => {
    render(
      <LeftSidebar
        boards={[]}
        loadStatus="ready"
        onRetry={vi.fn()}
        navigationLinks={[]}
        active="community"
      />,
    )

    const primaryNavigation = screen.getAllByRole("navigation")[0]
    expect(within(primaryNavigation).getAllByRole("link").map((link) => link.textContent))
      .toEqual(["首页", "关注", "社区", "收藏"])
    expect(within(primaryNavigation).getByRole("link", { name: "社区" }))
      .toHaveAttribute("href", "#boards")
    expect(within(primaryNavigation).getByRole("link", { name: "社区" }))
      .toHaveAttribute("aria-current", "page")
    expect(within(primaryNavigation).getByRole("link", { name: "首页" }))
      .toHaveAttribute("href", "#hot")
    expect(within(primaryNavigation).getByRole("link", { name: "首页" }))
      .not.toHaveAttribute("aria-current")
  })

  it("keeps the current board highlighted on board and topic routes", () => {
    render(
      <LeftSidebar
        boards={[{
          id: "board-1",
          parentId: null,
          slug: "general",
          name: "社区广场",
          description: "日常交流",
          icon: "messages",
          tone: "blue",
          position: 1,
          depth: 0,
          childCount: 0,
          topicCount: 19,
        }]}
        loadStatus="ready"
        onRetry={vi.fn()}
        navigationLinks={[]}
        active="community"
        activeBoardSlug="general"
      />,
    )

    const boardLink = screen.getByRole("link", { name: "社区广场 19" })
    expect(boardLink).toHaveClass("sidebar-link--active")
    expect(boardLink).toHaveAttribute("aria-current", "page")
  })
})
