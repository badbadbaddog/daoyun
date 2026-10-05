import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createRecentAuthentication,
  enableMfaTotp,
  getMfaStatus,
  setupMfaTotp,
  regenerateMfaRecoveryCodes,
} from "../api/auth"
import type { AuthSession } from "../api/auth"
import { MfaPanel } from "./MfaPanel"

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth")
  return { ...actual, createRecentAuthentication: vi.fn(), enableMfaTotp: vi.fn(), getMfaStatus: vi.fn(), setupMfaTotp: vi.fn(), regenerateMfaRecoveryCodes: vi.fn() }
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
  vi.mocked(regenerateMfaRecoveryCodes).mockReset()
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

it("does not treat a failed status request as an unconfigured account and retries independently", async () => {
  vi.mocked(getMfaStatus).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({ enabled: true, setupPending: false, recoveryCodesRemaining: 8 })
  render(<MfaPanel session={session} onClose={vi.fn()} onSessionChange={vi.fn()} />)
  expect(await screen.findByRole("alert")).toHaveTextContent("无法读取多因素认证状态")
  expect(screen.queryByText("尚未启用")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "开始设置 TOTP" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "重试安全状态" }))
  expect(await screen.findByText("已启用 · 剩余 8 个恢复码")).toBeInTheDocument()
  expect(getMfaStatus).toHaveBeenCalledTimes(2)
})

it("ignores a late MFA enable response after the panel closes", async () => {
  vi.mocked(getMfaStatus).mockResolvedValue({ enabled: false, setupPending: false, recoveryCodesRemaining: 0 })
  vi.mocked(createRecentAuthentication).mockResolvedValue({ authenticated: true, expiresAt: "2026-10-03T23:00:00Z" })
  vi.mocked(setupMfaTotp).mockResolvedValue({ secretBase32: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/test", expiresAt: "2026-10-03T23:00:00Z" })
  let finish!: (value: { csrfToken: string; recoveryCodes: string[] }) => void
  vi.mocked(enableMfaTotp).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const changed = vi.fn()
  const view = render(<MfaPanel session={session} onClose={vi.fn()} onSessionChange={changed} />)
  await userEvent.type(await screen.findByLabelText("当前密码"), "current password")
  await userEvent.click(screen.getByRole("button", { name: "开始设置 TOTP" }))
  await userEvent.type(await screen.findByLabelText("验证器验证码"), "123456")
  await userEvent.click(screen.getByRole("button", { name: "验证并启用" }))
  await waitFor(() => expect(enableMfaTotp).toHaveBeenCalledOnce())
  view.unmount()
  await act(async () => finish({ csrfToken: "b".repeat(64), recoveryCodes: ["old-secret"] }))
  expect(changed).not.toHaveBeenCalled()
})

it("does not expose old recovery codes or replace a new account's session", async () => {
  vi.mocked(getMfaStatus).mockResolvedValue({ enabled: true, setupPending: false, recoveryCodesRemaining: 8 })
  vi.mocked(createRecentAuthentication).mockResolvedValue({ authenticated: true, expiresAt: "2026-10-03T23:00:00Z" })
  let finish!: (value: { csrfToken: string; recoveryCodes: string[] }) => void
  vi.mocked(regenerateMfaRecoveryCodes).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const changed = vi.fn()
  const view = render(<MfaPanel session={session} onClose={vi.fn()} onSessionChange={changed} />)
  await userEvent.type(await screen.findByLabelText("当前密码"), "current password")
  await userEvent.type(screen.getByLabelText("TOTP 或恢复码"), "123456")
  await userEvent.click(screen.getByRole("button", { name: "重新生成恢复码" }))
  await waitFor(() => expect(regenerateMfaRecoveryCodes).toHaveBeenCalledOnce())
  const next = { ...session, user: { ...session.user, id: "019fc700-0000-7000-8000-000000000005", username: "next" } }
  view.rerender(<MfaPanel session={next} onClose={vi.fn()} onSessionChange={changed} />)
  await act(async () => finish({ csrfToken: "b".repeat(64), recoveryCodes: ["old-private-recovery"] }))
  expect(changed).not.toHaveBeenCalled()
  expect(screen.queryByText("old-private-recovery")).not.toBeInTheDocument()
  expect(screen.getByLabelText("当前密码")).toHaveValue("")
})

it("stops setup after recent authentication if the panel was unmounted", async () => {
  vi.mocked(getMfaStatus).mockResolvedValue({ enabled: false, setupPending: false, recoveryCodesRemaining: 0 })
  let finish!: (value: { authenticated: true; expiresAt: string }) => void
  vi.mocked(createRecentAuthentication).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<MfaPanel session={session} onClose={vi.fn()} onSessionChange={vi.fn()} />)
  await userEvent.type(await screen.findByLabelText("当前密码"), "current password")
  await userEvent.click(screen.getByRole("button", { name: "开始设置 TOTP" }))
  await waitFor(() => expect(createRecentAuthentication).toHaveBeenCalledOnce())
  view.unmount()
  await act(async () => finish({ authenticated: true, expiresAt: "2026-10-03T23:00:00Z" }))
  expect(setupMfaTotp).not.toHaveBeenCalled()
})
