import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createRecentAuthentication,
  enableMfaTotp,
  getMfaStatus,
  setupMfaTotp,
} from "../api/auth"
import type { AuthSession } from "../api/auth"
import { MfaPanel } from "./MfaPanel"

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth")
  return { ...actual, createRecentAuthentication: vi.fn(), enableMfaTotp: vi.fn(), getMfaStatus: vi.fn(), setupMfaTotp: vi.fn() }
})

const session: AuthSession = {
  user: { id: "019fc700-0000-7000-8000-000000000004", username: "member", email: "member@example.com", displayName: "社区成员" },
  csrfToken: "a".repeat(64),
}

beforeEach(() => {
  vi.mocked(getMfaStatus).mockReset()
  vi.mocked(createRecentAuthentication).mockReset()
  vi.mocked(setupMfaTotp).mockReset()
  vi.mocked(enableMfaTotp).mockReset()
})
afterEach(() => cleanup())

describe("MfaPanel", () => {
  it("reauthenticates before setup and displays recovery codes only after enabling", async () => {
    vi.mocked(getMfaStatus).mockResolvedValue({ enabled: false, setupPending: false, recoveryCodesRemaining: 0 })
    vi.mocked(createRecentAuthentication).mockResolvedValue({ authenticated: true, expiresAt: "2026-08-08T10:10:00Z" })
    vi.mocked(setupMfaTotp).mockResolvedValue({ secretBase32: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/DaoYun:test", expiresAt: "2026-08-08T10:10:00Z" })
    vi.mocked(enableMfaTotp).mockResolvedValue({ recoveryCodes: ["ABCD-EFGH"], csrfToken: "b".repeat(64) })
    const onSessionChange = vi.fn()
    const user = userEvent.setup()
    render(<MfaPanel session={session} onClose={vi.fn()} onSessionChange={onSessionChange} />)

    await user.type(await screen.findByLabelText("当前密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "开始设置 TOTP" }))
    await waitFor(() => expect(setupMfaTotp).toHaveBeenCalledWith(session.csrfToken))
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument()
    await user.type(screen.getByLabelText("验证器验证码"), "123456")
    await user.click(screen.getByRole("button", { name: "验证并启用" }))
    await waitFor(() => expect(enableMfaTotp).toHaveBeenCalledWith("123456", session.csrfToken))
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument()
    expect(onSessionChange).toHaveBeenCalledWith({ ...session, csrfToken: "b".repeat(64) })
  })
})
