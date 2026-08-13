import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AuthSession } from "../api/auth"
import { RightSidebar } from "./RightSidebar"

const session: AuthSession = {
  user: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

afterEach(cleanup)

describe("RightSidebar", () => {
  it("shows the authenticated user's real identity and profile link", () => {
    render(
      <RightSidebar
        topics={[]}
        session={session}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(screen.getByRole("link", { name: "查看我的个人主页" }))
      .toHaveAttribute("href", "#user/member")
    expect(screen.getByText("社区成员")).toBeInTheDocument()
    expect(screen.queryByText("12,680")).not.toBeInTheDocument()
  })

  it("offers login instead of simulated profile data to signed-out visitors", async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    render(
      <RightSidebar
        topics={[]}
        session={null}
        onCompose={vi.fn()}
        onLogin={onLogin}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "登录" }))
    expect(onLogin).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("林屿")).not.toBeInTheDocument()
  })
})
