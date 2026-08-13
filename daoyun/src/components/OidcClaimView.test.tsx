import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  bindOidcClaim,
  createOidcClaimAccount,
  createRecentAuthentication,
  getOidcClaim,
  login,
} from "../api/auth"
import { OidcClaimView } from "./OidcClaimView"

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth")
  return {
    ...actual,
    bindOidcClaim: vi.fn(),
    createOidcClaimAccount: vi.fn(),
    createRecentAuthentication: vi.fn(),
    getOidcClaim: vi.fn(),
    login: vi.fn(),
  }
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const claim = {
  providerKey: "google",
  providerDisplayName: "Google",
  profileName: "社区成员",
  preferredUsername: "member",
  emailHint: "m***@example.com",
}

describe("OidcClaimView", () => {
  it("creates an account and completes the claim without exposing a provider subject", async () => {
    const user = userEvent.setup()
    const onSessionChange = vi.fn()
    const onComplete = vi.fn()
    vi.mocked(getOidcClaim).mockResolvedValue(claim)
    vi.mocked(createOidcClaimAccount).mockResolvedValue({
      user: {
        id: "019fc700-0000-7000-8000-000000000004",
        username: "member",
        email: "member@example.com",
        displayName: "社区成员",
      },
      csrfToken: "a".repeat(64),
    })

    render(<OidcClaimView session={null} onSessionChange={onSessionChange} onComplete={onComplete} />)
    expect(await screen.findByRole("heading", { name: "确认 Google 身份" })).toBeInTheDocument()
    expect(screen.getByText("m***@example.com")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "创建新账户" }))
    await user.clear(screen.getByRole("textbox", { name: "用户名" }))
    await user.type(screen.getByRole("textbox", { name: "用户名" }), "member")
    await user.type(screen.getByRole("textbox", { name: "邮箱" }), "member@example.com")
    await user.clear(screen.getByRole("textbox", { name: "显示名称" }))
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "社区成员")
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "创建并绑定" }))

    expect(createOidcClaimAccount).toHaveBeenCalledWith({
      username: "member",
      email: "member@example.com",
      displayName: "社区成员",
      password: "correct horse battery staple",
    })
    expect(onSessionChange).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("provider-subject")).not.toBeInTheDocument()
  })

  it("requires password login and recent authentication before binding an existing account", async () => {
    const user = userEvent.setup()
    const session = {
      user: {
        id: "019fc700-0000-7000-8000-000000000004",
        username: "member",
        email: "member@example.com",
        displayName: "社区成员",
      },
      csrfToken: "a".repeat(64),
    }
    const onSessionChange = vi.fn()
    const onComplete = vi.fn()
    vi.mocked(getOidcClaim).mockResolvedValue(claim)
    vi.mocked(login).mockResolvedValue(session)
    vi.mocked(createRecentAuthentication).mockResolvedValue({
      authenticated: true,
      expiresAt: "2026-08-08T12:10:00Z",
    })
    vi.mocked(bindOidcClaim).mockResolvedValue({ csrfToken: "b".repeat(64) })

    render(<OidcClaimView session={null} onSessionChange={onSessionChange} onComplete={onComplete} />)
    await screen.findByRole("heading", { name: "确认 Google 身份" })
    await user.click(screen.getByRole("button", { name: "登录已有账户" }))
    await user.type(screen.getByRole("textbox", { name: "用户名或邮箱" }), "member")
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "登录并继续" }))
    expect(await screen.findByRole("heading", { name: "确认当前账户" })).toBeInTheDocument()

    await user.type(screen.getByLabelText("当前密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "确认并绑定" }))

    expect(createRecentAuthentication).toHaveBeenCalledWith(
      "correct horse battery staple",
      "a".repeat(64),
    )
    expect(bindOidcClaim).toHaveBeenCalledWith("a".repeat(64))
    expect(onSessionChange).toHaveBeenLastCalledWith({ ...session, csrfToken: "b".repeat(64) })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("switches to recent authentication when the existing session finishes loading", async () => {
    const session = {
      user: {
        id: "019fc700-0000-7000-8000-000000000004",
        username: "member",
        email: "member@example.com",
        displayName: "社区成员",
      },
      csrfToken: "a".repeat(64),
    }
    vi.mocked(getOidcClaim).mockResolvedValue(claim)

    const rendered = render(
      <OidcClaimView session={null} onSessionChange={vi.fn()} onComplete={vi.fn()} />,
    )
    await screen.findByRole("heading", { name: "确认 Google 身份" })
    rendered.rerender(
      <OidcClaimView session={session} onSessionChange={vi.fn()} onComplete={vi.fn()} />,
    )

    expect(await screen.findByRole("heading", { name: "确认当前账户" })).toBeInTheDocument()
  })
})
