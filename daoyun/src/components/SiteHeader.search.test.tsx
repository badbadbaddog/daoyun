import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SiteHeader } from "./SiteHeader"

afterEach(cleanup)

describe("SiteHeader search", () => {
  it("opens and closes the compact mobile search affordance", () => {
    render(
      <SiteHeader
        siteName="刀云"
        logoUrl={null}
        darkMode={false}
        query=""
        onQueryChange={vi.fn()}
        onClearQuery={vi.fn()}
        onSearch={vi.fn()}
        onCompose={vi.fn()}
        onToggleTheme={vi.fn()}
        session={null}
        onOpenAuth={vi.fn()}
        onLogout={vi.fn()}
        authPending={false}
        notificationsUnread={0}
        onOpenNotifications={vi.fn()}
        systemAdminAccess="denied"
        managementAccess="denied"
      />,
    )

    expect(screen.getByRole("link", { name: "刀云首页" })).toHaveAttribute("href", "#hot")
    const open = screen.getByRole("button", { name: "打开搜索" })
    expect(open).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(open)
    expect(open).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(screen.getByRole("button", { name: "关闭搜索" }))
    expect(open).toHaveAttribute("aria-expanded", "false")
  })

  it("submits the current query with Enter", () => {
    const onSearch = vi.fn()
    render(
      <SiteHeader
        siteName="刀云"
        logoUrl={null}
        darkMode={false}
        query="Rust"
        onQueryChange={vi.fn()}
        onClearQuery={vi.fn()}
        onSearch={onSearch}
        onCompose={vi.fn()}
        onToggleTheme={vi.fn()}
        session={null}
        onOpenAuth={vi.fn()}
        onLogout={vi.fn()}
        authPending={false}
        notificationsUnread={0}
        onOpenNotifications={vi.fn()}
        systemAdminAccess="denied"
        managementAccess="denied"
      />,
    )
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索社区内容" }), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith("Rust")
  })
})
