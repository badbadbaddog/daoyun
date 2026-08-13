import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthSession } from "../api/auth"
import {
  createRecentAuthentication,
  listExternalIdentities,
  listOidcProviders,
  startOidcIdentityBinding,
  startOidcIdentityReplacement,
  unlinkExternalIdentity,
} from "../api/auth"
import { ExternalIdentitiesPanel } from "./ExternalIdentitiesPanel"

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth")
  return {
    ...actual,
    createRecentAuthentication: vi.fn(),
    listExternalIdentities: vi.fn(),
    listOidcProviders: vi.fn(),
    startOidcIdentityBinding: vi.fn(),
    startOidcIdentityReplacement: vi.fn(),
    unlinkExternalIdentity: vi.fn(),
  }
})

const session: AuthSession = {
  user: {
    id: "019fc800-0000-7000-8000-000000000001",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

const identityId = "019fc800-0000-7000-8000-000000000099"

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(listOidcProviders).mockReset().mockResolvedValue([
    { providerKey: "google", displayName: "Google" },
    { providerKey: "github", displayName: "GitHub" },
  ])
  vi.mocked(listExternalIdentities).mockReset().mockResolvedValue([{
    id: identityId,
    providerKey: "google",
    createdAt: "2026-08-08T10:00:00Z",
    lastAuthenticatedAt: "2026-08-08T10:05:00Z",
  }])
  vi.mocked(createRecentAuthentication).mockReset().mockResolvedValue({
    authenticated: true,
    expiresAt: "2026-08-08T12:10:00Z",
  })
  vi.mocked(startOidcIdentityBinding).mockReset().mockResolvedValue(
    "https://accounts.example.com/oauth2/authorize?state=binding",
  )
  vi.mocked(startOidcIdentityReplacement).mockReset().mockResolvedValue(
    "https://github.example.com/oauth2/authorize?state=replacement",
  )
  vi.mocked(unlinkExternalIdentity).mockReset().mockResolvedValue("b".repeat(64))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ExternalIdentitiesPanel", () => {
  it("verifies the password before starting an additional provider binding", async () => {
    const user = userEvent.setup()
    const onAuthorizationRedirect = vi.fn()
    render(
      <ExternalIdentitiesPanel
        session={session}
        onClose={vi.fn()}
        onSessionChange={vi.fn()}
        onAuthorizationRedirect={onAuthorizationRedirect}
      />,
    )

    expect(await screen.findByText("最近验证于 2026-08-08 10:05")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "绑定另一个 Google 身份" }))
    await user.type(screen.getByLabelText("当前密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "继续绑定" }))

    expect(createRecentAuthentication).toHaveBeenCalledWith(
      "correct horse battery staple",
      session.csrfToken,
    )
    expect(startOidcIdentityBinding).toHaveBeenCalledWith("google", session.csrfToken)
    expect(onAuthorizationRedirect).toHaveBeenCalledWith(
      "https://accounts.example.com/oauth2/authorize?state=binding",
    )
    expect(sessionStorage.getItem("daoyun-oidc-settings-return")).toContain("member")
  })

  it("replaces a selected identity with an explicitly selected provider", async () => {
    const user = userEvent.setup()
    const onAuthorizationRedirect = vi.fn()
    render(
      <ExternalIdentitiesPanel
        session={session}
        onClose={vi.fn()}
        onSessionChange={vi.fn()}
        onAuthorizationRedirect={onAuthorizationRedirect}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "替换 Google 身份" }))
    await user.selectOptions(screen.getByLabelText("新的身份服务"), "github")
    await user.type(screen.getByLabelText("当前密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "继续替换" }))

    expect(startOidcIdentityReplacement).toHaveBeenCalledWith(
      "github",
      identityId,
      session.csrfToken,
    )
    expect(onAuthorizationRedirect).toHaveBeenCalledWith(
      "https://github.example.com/oauth2/authorize?state=replacement",
    )
  })

  it("unlinks after recent authentication and publishes the rotated CSRF token", async () => {
    const user = userEvent.setup()
    const onSessionChange = vi.fn()
    render(
      <ExternalIdentitiesPanel
        session={session}
        onClose={vi.fn()}
        onSessionChange={onSessionChange}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "解绑 Google 身份" }))
    await user.type(screen.getByLabelText("当前密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "确认解绑" }))

    expect(unlinkExternalIdentity).toHaveBeenCalledWith(identityId, session.csrfToken)
    expect(onSessionChange).toHaveBeenCalledWith({ ...session, csrfToken: "b".repeat(64) })
    expect(await screen.findByRole("status")).toHaveTextContent("Google 身份已解绑")
    expect(screen.queryByRole("button", { name: "解绑 Google 身份" })).not.toBeInTheDocument()
  })

  it("offers an explicit retry when identities cannot be loaded", async () => {
    const user = userEvent.setup()
    vi.mocked(listExternalIdentities)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce([])
    render(
      <ExternalIdentitiesPanel
        session={session}
        onClose={vi.fn()}
        onSessionChange={vi.fn()}
      />,
    )

    expect(await screen.findByRole("alert")).toHaveTextContent("登录方式暂时无法加载")
    await user.click(screen.getByRole("button", { name: "重新加载" }))

    expect(await screen.findByText("还没有绑定外部身份")).toBeInTheDocument()
    expect(listExternalIdentities).toHaveBeenCalledTimes(2)
  })
})
