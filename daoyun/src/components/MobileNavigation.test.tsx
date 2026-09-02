import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MobileNavigation } from "./MobileNavigation"

afterEach(cleanup)

describe("MobileNavigation", () => {
  it("prioritizes community discovery and notifications", () => {
    render(
      <MobileNavigation
        onCompose={vi.fn()}
        sessionUsername="member"
        onLogin={vi.fn()}
        active="community"
      />,
    )

    expect(screen.getByRole("link", { name: "移动端社区" })).toHaveAttribute("href", "#boards")
    expect(screen.getByRole("link", { name: "移动端社区" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "移动端首页" })).toHaveAttribute("href", "#hot")
    expect(screen.getByRole("link", { name: "移动端首页" })).not.toHaveAttribute("aria-current")
    expect(screen.getByRole("link", { name: "移动端通知" })).toHaveAttribute("href", "#notifications")
    expect(screen.queryByText("私信")).not.toBeInTheDocument()
    expect(screen.queryByText("收藏")).not.toBeInTheDocument()
  })

  it("uses an even four-item layout when publishing is unavailable", () => {
    render(
      <MobileNavigation
        onCompose={vi.fn()}
        showCompose={false}
        sessionUsername={null}
        onLogin={vi.fn()}
        active="home"
      />,
    )

    expect(screen.getByRole("navigation", { name: "移动端导航" }))
      .toHaveClass("mobile-navigation--without-create")
    expect(screen.queryByRole("button", { name: "从移动导航发布新主题" }))
      .not.toBeInTheDocument()
  })
})
