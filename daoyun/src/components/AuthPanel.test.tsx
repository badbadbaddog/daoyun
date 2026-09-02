import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AuthApiError,
  getRegistrationPolicy,
  MfaChallengeRequiredError,
  login,
  register,
  requestRegistrationEmailChallenge,
  startPasskeyAssertion,
  verifyPasskeyAssertion,
  verifyMfaChallenge,
} from "../api/auth"
import type { AuthSession } from "../api/auth"
import { AuthPanel } from "./AuthPanel"

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth")
  return {
    ...actual,
    login: vi.fn(),
    getRegistrationPolicy: vi.fn(),
    register: vi.fn(),
    requestRegistrationEmailChallenge: vi.fn(),
    startPasskeyAssertion: vi.fn(),
    verifyPasskeyAssertion: vi.fn(),
    verifyMfaChallenge: vi.fn(),
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

beforeEach(() => {
  vi.mocked(login).mockReset()
  vi.mocked(getRegistrationPolicy).mockReset()
  vi.mocked(getRegistrationPolicy).mockResolvedValue({ emailVerificationRequired: false, codeExpiresInSeconds: 600, resendAfterSeconds: 60 })
  vi.mocked(register).mockReset()
  vi.mocked(requestRegistrationEmailChallenge).mockReset()
  vi.mocked(startPasskeyAssertion).mockReset()
  vi.mocked(verifyPasskeyAssertion).mockReset()
  vi.mocked(verifyMfaChallenge).mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("AuthPanel", () => {
  it("switches between login and registration fields", async () => {
    const user = userEvent.setup()
    render(<AuthPanel open mode="login" onClose={vi.fn()} onAuthenticated={vi.fn()} />)

    expect(screen.getByRole("heading", { name: "登录刀云" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "用户名或邮箱" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "显示名称" })).not.toBeInTheDocument()

    const loginTab = screen.getByRole("tab", { name: "登录" })
    const registerTab = screen.getByRole("tab", { name: "注册" })
    expect(loginTab).toHaveAttribute("tabindex", "0")
    expect(registerTab).toHaveAttribute("tabindex", "-1")
    await waitFor(() => expect(screen.getByRole("textbox", { name: "用户名或邮箱" })).toHaveFocus())

    loginTab.focus()
    await user.keyboard("{ArrowRight}")
    expect(registerTab).toHaveFocus()
    expect(registerTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("heading", { name: "注册刀云" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "显示名称" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "邮箱" })).toBeInTheDocument()

    await user.keyboard("{Home}")
    expect(loginTab).toHaveFocus()
    expect(loginTab).toHaveAttribute("aria-selected", "true")
  })

  it("focuses the login field and blocks Escape or backdrop dismissal while login is pending", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onAuthenticated = vi.fn()
    let resolveLogin!: (value: AuthSession) => void
    vi.mocked(login).mockImplementationOnce(() => new Promise((resolve) => { resolveLogin = resolve }))
    render(<AuthPanel open mode="login" onClose={onClose} onAuthenticated={onAuthenticated} />)

    const identifier = screen.getByRole("textbox", { name: "用户名或邮箱" })
    await waitFor(() => expect(identifier).toHaveFocus())
    await user.type(identifier, "member")
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "登录" }))

    const dialog = screen.getByRole("dialog", { name: "登录刀云" })
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "true"))
    expect(screen.getByRole("button", { name: "关闭身份窗口" })).toBeDisabled()
    await user.keyboard("{Escape}")
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()

    resolveLogin(session)
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(session))
  })

  it("submits login credentials and reports a successful session", async () => {
    const user = userEvent.setup()
    const onAuthenticated = vi.fn()
    vi.mocked(login).mockResolvedValue(session)
    render(<AuthPanel open mode="login" onClose={vi.fn()} onAuthenticated={onAuthenticated} />)

    await user.type(screen.getByRole("textbox", { name: "用户名或邮箱" }), "member")
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "登录" }))

    expect(login).toHaveBeenCalledWith({
      identifier: "member",
      password: "correct horse battery staple",
    })
    expect(onAuthenticated).toHaveBeenCalledWith(session)
  })

  it("completes passkey login with the browser credential API", async () => {
    class FakePublicKeyCredential {}
    vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential)
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: FakePublicKeyCredential,
    })
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        get: vi.fn().mockResolvedValue(new FakePublicKeyCredential()),
      },
    })
    vi.mocked(startPasskeyAssertion).mockResolvedValue({
      challengeId: "019fc700-0000-7000-8000-000000000009",
      options: {
        challenge: "AQID",
        rpId: "127.0.0.1",
        timeout: 60_000,
        allowCredentials: [],
        userVerification: "required",
      },
    })
    vi.mocked(verifyPasskeyAssertion).mockResolvedValue(session)
    const user = userEvent.setup()
    const onAuthenticated = vi.fn()
    render(<AuthPanel open mode="login" onClose={vi.fn()} onAuthenticated={onAuthenticated} />)

    await user.click(screen.getByRole("button", { name: "使用通行密钥登录" }))

    await waitFor(() => expect(verifyPasskeyAssertion).toHaveBeenCalledWith(
      "019fc700-0000-7000-8000-000000000009",
      expect.any(FakePublicKeyCredential),
    ))
    expect(startPasskeyAssertion).toHaveBeenCalledTimes(1)
    expect(onAuthenticated).toHaveBeenCalledWith(session)
  })

  it("completes a pending MFA challenge before reporting login success", async () => {
    const user = userEvent.setup()
    const onAuthenticated = vi.fn()
    vi.mocked(login).mockRejectedValue(new MfaChallengeRequiredError({
      challengeId: "019fc700-0000-7000-8000-000000000009",
      expiresAt: "2026-08-08T10:05:00Z",
    }))
    vi.mocked(verifyMfaChallenge).mockResolvedValue(session)
    render(<AuthPanel open mode="login" onClose={vi.fn()} onAuthenticated={onAuthenticated} />)
    await user.type(screen.getByRole("textbox", { name: "用户名或邮箱" }), "member")
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "登录" }))
    expect(await screen.findByRole("heading", { name: "请输入验证码" })).toBeInTheDocument()
    await user.type(screen.getByLabelText("验证码或恢复码"), "123456")
    await user.click(screen.getByRole("button", { name: "完成登录" }))
    await waitFor(() => expect(verifyMfaChallenge).toHaveBeenCalledWith("019fc700-0000-7000-8000-000000000009", "123456"))
    expect(onAuthenticated).toHaveBeenCalledWith(session)
  })

  it("accepts a six-character registration password", async () => {
    const user = userEvent.setup()
    vi.mocked(register).mockResolvedValue(session)
    render(<AuthPanel open mode="register" onClose={vi.fn()} onAuthenticated={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "用户名" }), "member")
    await user.type(screen.getByRole("textbox", { name: "邮箱" }), "member@example.com")
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "社区成员")
    await user.type(screen.getByLabelText("密码"), "123456")
    await user.click(screen.getByRole("button", { name: "注册" }))

    expect(register).toHaveBeenCalledWith({
      username: "member",
      email: "member@example.com",
      displayName: "社区成员",
      password: "123456",
    })
  })

  it("requests and submits the registration email verification code when required", async () => {
    vi.mocked(getRegistrationPolicy).mockResolvedValue({ emailVerificationRequired: true, codeExpiresInSeconds: 600, resendAfterSeconds: 60 })
    vi.mocked(requestRegistrationEmailChallenge).mockResolvedValue({
      challengeId: "019fc700-0000-7000-8000-000000000045",
      expiresAt: "2026-08-24T12:10:00Z",
      resendAfterSeconds: 60,
    })
    vi.mocked(register).mockResolvedValue(session)
    const user = userEvent.setup()
    render(<AuthPanel open mode="register" onClose={vi.fn()} onAuthenticated={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "用户名" }), "member")
    await user.type(screen.getByRole("textbox", { name: "邮箱" }), "member@example.com")
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "社区成员")
    await user.type(screen.getByLabelText("密码"), "123456")
    const send = await screen.findByRole("button", { name: "发送验证码" })
    await user.click(send)
    expect(requestRegistrationEmailChallenge).toHaveBeenCalledWith("member@example.com")
    await user.type(screen.getByRole("textbox", { name: "邮箱验证码" }), "654321")
    await user.click(screen.getByRole("button", { name: "注册" }))

    expect(register).toHaveBeenCalledWith({
      username: "member",
      email: "member@example.com",
      displayName: "社区成员",
      password: "123456",
      emailChallengeId: "019fc700-0000-7000-8000-000000000045",
      emailVerificationCode: "654321",
    })
  })

  it("maps server field and summary errors while preserving values", async () => {
    const user = userEvent.setup()
    vi.mocked(register).mockRejectedValue(new AuthApiError(
      422,
      "request.validation_failed",
      "请求参数校验失败",
      { username: ["用户名不可用"], body: ["请检查表单"] },
    ))
    render(<AuthPanel open mode="register" onClose={vi.fn()} onAuthenticated={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "用户名" }), "member")
    await user.type(screen.getByRole("textbox", { name: "邮箱" }), "member@example.com")
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "社区成员")
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple")
    await user.click(screen.getByRole("button", { name: "注册" }))

    expect(await screen.findByText("用户名不可用")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("请检查表单")
    expect(screen.getByRole("textbox", { name: "用户名" })).toHaveValue("member")
  })

  it("validates required fields and closes on Escape", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AuthPanel open mode="login" onClose={onClose} onAuthenticated={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "登录" }))
    expect(screen.getByText("请输入用户名或邮箱")).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
