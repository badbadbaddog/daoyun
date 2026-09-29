import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SiteHeader } from "./SiteHeader"

afterEach(cleanup)

describe("SiteHeader search", () => {
  it("shows the desktop discovery navigation on the home surface", () => {
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
        showAccountSummary
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

    const navigation = screen.getByRole("navigation", { name: "主导航" })
    expect(navigation).toHaveTextContent("首页")
    expect(navigation).toHaveTextContent("社区")
    expect(navigation).toHaveTextContent("发现")
    expect(navigation).toHaveTextContent("排行榜")
  })

  it("marks the route-owned primary destination instead of always marking home", () => {
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
        showAccountSummary
        activeNavigation="community"
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

    expect(screen.getByRole("link", { name: "社区" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "首页" })).not.toHaveAttribute("aria-current")
  })

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

  it("keeps bookmarks reachable from the signed-in account menu on compact layouts", () => {
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
        session={{
          user: {
            id: "019fc700-0000-7000-8000-000000000004",
            username: "member",
            email: "member@example.com",
            displayName: "社区成员",
          },
          csrfToken: "a".repeat(64),
        }}
        onOpenAuth={vi.fn()}
        onLogout={vi.fn()}
        authPending={false}
        notificationsUnread={0}
        onOpenNotifications={vi.fn()}
        systemAdminAccess="denied"
        managementAccess="denied"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "打开个人菜单" }))
    expect(screen.getByRole("menuitem", { name: "收藏" })).toHaveAttribute("href", "#bookmarks")
    expect(screen.getByRole("menuitem", { name: "私信" })).toHaveAttribute("href", "#messages")
  })

  it("supports keyboard navigation, Escape focus restore, and outside dismissal for the account menu", async () => {
    const user = userEvent.setup()
    render(
      <div>
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
          session={{
            user: {
              id: "019fc700-0000-7000-8000-000000000004",
              username: "member",
              email: "member@example.com",
              displayName: "社区成员",
            },
            csrfToken: "a".repeat(64),
          }}
          onOpenAuth={vi.fn()}
          onLogout={vi.fn()}
          authPending={false}
          notificationsUnread={0}
          onOpenNotifications={vi.fn()}
          systemAdminAccess="allowed"
          managementAccess="denied"
        />
        <button type="button">页面其他操作</button>
      </div>,
    )

    const trigger = screen.getByRole("button", { name: "打开个人菜单" })
    trigger.focus()
    await user.keyboard("{ArrowDown}")
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "个人主页" })).toHaveFocus())
    expect(trigger).toHaveAttribute("aria-expanded", "true")

    await user.keyboard("{End}")
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("menuitem", { name: "个人主页" })).toHaveFocus()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu", { name: "个人菜单" })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.keyboard("{ArrowUp}")
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "退出登录" })).toHaveFocus())
    const outside = screen.getByRole("button", { name: "页面其他操作" })
    outside.focus()
    fireEvent.pointerDown(outside)
    expect(screen.queryByRole("menu", { name: "个人菜单" })).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
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
