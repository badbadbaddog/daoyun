import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SiteHeader } from "./SiteHeader"

afterEach(cleanup)

describe("SiteHeader search", () => {
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
