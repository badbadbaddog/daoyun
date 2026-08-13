import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createRecentAuthentication,
  deletePasskey,
  listPasskeys,
} from "../api/auth"
import type { AuthSession } from "../api/auth"
import { PasskeysPanel } from "./PasskeysPanel"

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth")
  return {
    ...actual,
    createRecentAuthentication: vi.fn(),
    deletePasskey: vi.fn(),
    listPasskeys: vi.fn(),
  }
})

const session: AuthSession = {
  user: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

const passkey = {
  id: "019fc700-0000-7000-8000-000000000010",
  createdAt: "2026-08-08T10:00:00Z",
  lastUsedAt: null,
}

beforeEach(() => {
  vi.mocked(listPasskeys).mockReset()
  vi.mocked(createRecentAuthentication).mockReset()
  vi.mocked(deletePasskey).mockReset()
})

afterEach(() => cleanup())

describe("PasskeysPanel", () => {
  it("loads registered passkeys and deletes one after password re-authentication", async () => {
    vi.mocked(listPasskeys).mockResolvedValue([passkey])
    vi.mocked(createRecentAuthentication).mockResolvedValue({
      authenticated: true,
      expiresAt: "2026-08-08T10:10:00Z",
    })
    vi.mocked(deletePasskey).mockResolvedValue("b".repeat(64))
    const onSessionChange = vi.fn()
    const user = userEvent.setup()
    render(<PasskeysPanel session={session} onClose={vi.fn()} onSessionChange={onSessionChange} />)

    expect(await screen.findByText("设备通行密钥")).toBeInTheDocument()
    await user.type(screen.getByLabelText("当前密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "删除" }))

    await waitFor(() => expect(deletePasskey).toHaveBeenCalledWith(
      passkey.id,
      session.csrfToken,
    ))
    expect(createRecentAuthentication).toHaveBeenCalledWith(
      "correct horse battery staple",
      session.csrfToken,
    )
    expect(onSessionChange).toHaveBeenCalledWith({ ...session, csrfToken: "b".repeat(64) })
    expect(await screen.findByText("通行密钥已删除。")).toBeInTheDocument()
    expect(screen.queryByText("设备通行密钥")).not.toBeInTheDocument()
  })
})
