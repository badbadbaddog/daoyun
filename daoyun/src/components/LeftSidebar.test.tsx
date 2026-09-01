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
      .not.toHaveAttribute("aria-current")
  })
})
