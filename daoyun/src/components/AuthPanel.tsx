import { Fingerprint, LogIn, MailCheck, UserPlus, X } from "lucide-react"
import { forwardRef, useEffect, useState } from "react"

import {
  AuthApiError,
  MfaChallengeRequiredError,
  getRegistrationPolicy,
  login,
  register,
  requestRegistrationEmailChallenge,
  startPasskeyAssertion,
  verifyPasskeyAssertion,
  verifyMfaChallenge,
} from "../api/auth"
import type { AuthSession, MfaChallenge, PasskeyAssertionOptions } from "../api/auth"
import { ModalDialog } from "./ui/ModalDialog"

type AuthMode = "login" | "register"
type FieldErrors = Record<string, string[]>

interface AuthPanelProps {
  open: boolean
  mode: AuthMode
  onClose: () => void
  onAuthenticated: (session: AuthSession) => void
}

export function AuthPanel({ open, mode, onClose, onAuthenticated }: AuthPanelProps) {
  const [currentMode, setCurrentMode] = useState<AuthMode>(mode)
  const [identifier, setIdentifier] = useState("")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false)
  const [emailChallengeId, setEmailChallengeId] = useState("")
  const [emailVerificationCode, setEmailVerificationCode] = useState("")
  const [requestingCode, setRequestingCode] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [codeMessage, setCodeMessage] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [passkeySubmitting, setPasskeySubmitting] = useState(false)
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null)
  const [mfaCode, setMfaCode] = useState("")

  useEffect(() => {
    setCurrentMode(mode)
    setFieldErrors({})
    setFormError("")
    setMfaChallenge(null)
    setMfaCode("")
  }, [mode, open])

  useEffect(() => {
    if (!open || currentMode !== "register") {
      return
    }

    const controller = new AbortController()
    void getRegistrationPolicy(controller.signal)
      .then((policy) => setEmailVerificationRequired(policy.emailVerificationRequired))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setFormError("注册设置暂时无法加载，请稍后重试")
        }
      })
    return () => controller.abort()
  }, [currentMode, open])

  useEffect(() => {
    if (resendSeconds <= 0) {
      return
    }
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1_000)
    return () => window.clearInterval(timer)
  }, [resendSeconds])

  if (!open) {
    return null
  }

  const isRegister = currentMode === "register"
  const submitLabel = submitting ? (isRegister ? "正在注册" : "正在登录") : (isRegister ? "注册" : "登录")
  const dialogBusy = submitting || passkeySubmitting || requestingCode

  function switchMode(nextMode: AuthMode) {
    if (submitting || nextMode === currentMode) {
      return
    }
    setCurrentMode(nextMode)
    setFieldErrors({})
    setFormError("")
    setEmailChallengeId("")
    setEmailVerificationCode("")
    setResendSeconds(0)
    setCodeMessage("")
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    if (isRegister) {
      if (!/^[a-z][a-z0-9_]{2,31}$/.test(username)) {
        errors.username = ["用户名需以小写字母开头，只能包含小写字母、数字或下划线，共 3-32 位"]
      }
      if (!/^[^\s@]+@[^\s@]+$/.test(email) || countCharacters(email) > 254) {
        errors.email = ["请输入有效的邮箱地址"]
      }
      if (emailVerificationRequired && !emailChallengeId) {
        errors.email_verification_code = ["请先发送邮箱验证码"]
      } else if (emailVerificationRequired && !/^\d{6}$/.test(emailVerificationCode)) {
        errors.email_verification_code = ["请输入 6 位邮箱验证码"]
      }
      if (countCharacters(displayName.trim()) < 1 || countCharacters(displayName.trim()) > 80) {
        errors.display_name = ["显示名称需为 1-80 个字符"]
      }
      if (countCharacters(password) < 6 || countCharacters(password) > 128) {
        errors.password = ["密码长度需为 6-128 个字符"]
      }
    } else {
      if (!identifier.trim()) {
        errors.identifier = ["请输入用户名或邮箱"]
      }
      if (!password) {
        errors.password = ["请输入密码"]
      }
    }
    return errors
  }

  async function submit() {
    if (submitting) {
      return
    }
    const errors = validate()
    setFieldErrors(errors)
    setFormError("")
    if (Object.keys(errors).length > 0) {
      return
    }

    setSubmitting(true)
    try {
      const session = isRegister
        ? await register({
            username,
            email,
            displayName,
            password,
            ...(emailVerificationRequired ? {
              emailChallengeId,
              emailVerificationCode,
            } : {}),
          })
        : await login({ identifier, password })
      onAuthenticated(session)
    } catch (error) {
      if (error instanceof MfaChallengeRequiredError) {
        setMfaChallenge(error.challenge)
        setFormError("")
      } else if (error instanceof AuthApiError) {
        setFieldErrors(error.fields)
        setFormError(error.fields.body?.[0] ?? error.message)
      } else {
        setFormError("身份服务暂时不可用，请稍后重试")
      }
    } finally {
      setSubmitting(false)
    }
  }

  function changeEmail(value: string) {
    setEmail(value)
    setEmailChallengeId("")
    setEmailVerificationCode("")
    setResendSeconds(0)
    setCodeMessage("")
  }

  async function requestEmailCode() {
    if (requestingCode || resendSeconds > 0) {
      return
    }
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+$/.test(normalizedEmail) || countCharacters(normalizedEmail) > 254) {
      setFieldErrors((current) => ({ ...current, email: ["请输入有效的邮箱地址"] }))
      return
    }

    setRequestingCode(true)
    setFieldErrors((current) => ({ ...current, email: [], email_verification_code: [] }))
    setFormError("")
    try {
      const challenge = await requestRegistrationEmailChallenge(normalizedEmail)
      setEmailChallengeId(challenge.challengeId)
      setResendSeconds(challenge.resendAfterSeconds)
      setCodeMessage("如果该邮箱可用于注册，验证码已发送，请检查收件箱。")
    } catch (error) {
      setFormError(error instanceof AuthApiError ? error.message : "验证码暂时无法发送，请稍后重试")
    } finally {
      setRequestingCode(false)
    }
  }

  async function submitMfa() {
    if (!mfaChallenge || submitting || mfaCode.trim().length < 6) return
    setSubmitting(true)
    setFormError("")
    try {
      onAuthenticated(await verifyMfaChallenge(mfaChallenge.challengeId, mfaCode))
    } catch (error) {
      setFormError(error instanceof AuthApiError ? error.message : "多因素认证暂时无法完成")
    } finally {
      setSubmitting(false)
    }
  }

  async function submitPasskey() {
    if (passkeySubmitting || isRegister) return
    if (!window.PublicKeyCredential) {
      setFormError("当前浏览器不支持通行密钥")
      return
    }
    setPasskeySubmitting(true)
    setFormError("")
    try {
      const ceremony = await startPasskeyAssertion()
      const credential = await navigator.credentials.get({ publicKey: assertionOptions(ceremony.options) })
      if (!(credential instanceof PublicKeyCredential)) throw new Error("浏览器未返回通行密钥")
      onAuthenticated(await verifyPasskeyAssertion(ceremony.challengeId, credential))
    } catch (cause) {
      setFormError(cause instanceof AuthApiError ? cause.message : "通行密钥登录暂时无法完成")
    } finally {
      setPasskeySubmitting(false)
    }
  }

  const inputError = (field: string) => fieldErrors[field]?.[0]
  const describedBy = (field: string) => inputError(field) ? `${field}-error` : undefined

  return (
    <ModalDialog backdropClassName="auth-overlay" className="auth-panel" titleId="auth-panel-title" busy={dialogBusy} initialFocusSelector="input:not(:disabled)" onClose={onClose}>
        <header className="auth-panel__header">
          <div>
            <span className="auth-panel__eyebrow">刀云社区</span>
            <h2 id="auth-panel-title">{isRegister ? "注册刀云" : "登录刀云"}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭身份窗口" title="关闭" disabled={dialogBusy} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="auth-panel__tabs" role="tablist" aria-label="身份操作">
          <button
            className={currentMode === "login" ? "auth-tab auth-tab--active" : "auth-tab"}
            type="button"
            role="tab"
            aria-selected={currentMode === "login"}
            onClick={() => switchMode("login")}
          >
            <LogIn size={15} aria-hidden="true" />
            登录
          </button>
          <button
            className={currentMode === "register" ? "auth-tab auth-tab--active" : "auth-tab"}
            type="button"
            role="tab"
            aria-selected={currentMode === "register"}
            onClick={() => switchMode("register")}
          >
            <UserPlus size={15} aria-hidden="true" />
            注册
          </button>
        </div>

        {mfaChallenge ? (
          <form className="auth-form" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void submitMfa() }}>
            <p className="auth-panel__eyebrow">登录安全校验</p>
            <h3>请输入验证码</h3>
            <p className="auth-form__hint">输入身份验证器的 6 位验证码，也可以输入恢复码。</p>
            <AuthField
              id="auth-mfa-code"
              label="验证码或恢复码"
              value={mfaCode}
              onChange={setMfaCode}
              autoComplete="one-time-code"
              autoFocus
            />
            {formError && <p className="auth-form__error" role="alert">{formError}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={submitting || mfaCode.trim().length < 6}>
              {submitting ? "正在验证" : "完成登录"}
            </button>
          </form>
        ) : <form className="auth-form" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void submit() }}>
          {isRegister ? (
            <>
              <AuthField
                id="auth-username"
                label="用户名"
                value={username}
                onChange={setUsername}
                error={inputError("username")}
                describedBy={describedBy("username")}
                autoComplete="username"
              />
              <AuthField
                id="auth-email"
                label="邮箱"
                type="email"
                value={email}
                onChange={changeEmail}
                error={inputError("email")}
                describedBy={describedBy("email")}
                autoComplete="email"
              />
              {emailVerificationRequired && (
                <div className="auth-email-verification">
                  <div className="auth-email-verification__heading">
                    <span><MailCheck size={15} aria-hidden="true" />邮箱验证</span>
                    <button
                      className="secondary-button auth-email-verification__send"
                      type="button"
                      disabled={requestingCode || resendSeconds > 0}
                      onClick={() => void requestEmailCode()}
                    >
                      {requestingCode
                        ? "正在发送"
                        : resendSeconds > 0
                          ? `${resendSeconds} 秒后重发`
                          : emailChallengeId
                            ? "重新发送"
                            : "发送验证码"}
                    </button>
                  </div>
                  <AuthField
                    id="auth-email-verification-code"
                    label="邮箱验证码"
                    value={emailVerificationCode}
                    onChange={(value) => setEmailVerificationCode(value.replace(/\D/g, "").slice(0, 6))}
                    error={inputError("email_verification_code")}
                    describedBy={describedBy("email_verification_code")}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                  />
                  {codeMessage && <p className="auth-form__hint" role="status">{codeMessage}</p>}
                </div>
              )}
              <AuthField
                id="auth-display-name"
                label="显示名称"
                value={displayName}
                onChange={setDisplayName}
                error={inputError("display_name")}
                describedBy={describedBy("display_name")}
                autoComplete="name"
              />
            </>
          ) : (
            <AuthField
              id="auth-identifier"
              label="用户名或邮箱"
              value={identifier}
              onChange={setIdentifier}
              error={inputError("identifier")}
              describedBy={describedBy("identifier")}
              autoComplete="username"
            />
          )}

          <AuthField
            id="auth-password"
            label="密码"
            type="password"
            value={password}
            onChange={setPassword}
            error={inputError("password")}
            describedBy={describedBy("password")}
            autoComplete={isRegister ? "new-password" : "current-password"}
          />

          {formError && !fieldErrors.body && <p className="auth-form__error" role="alert">{formError}</p>}
          {fieldErrors.body && <p className="auth-form__error" role="alert">{formError}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting}>
            {submitLabel}
          </button>
          {!isRegister && (
            <button className="secondary-button auth-submit" type="button" onClick={() => void submitPasskey()} disabled={submitting || passkeySubmitting}>
              <Fingerprint size={15} aria-hidden="true" />
              {passkeySubmitting ? "验证中" : "使用通行密钥登录"}
            </button>
          )}
        </form>}
    </ModalDialog>
  )
}

interface AuthFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "email" | "password"
  error?: string
  describedBy?: string
  autoComplete?: string
  autoFocus?: boolean
  inputMode?: "numeric"
  maxLength?: number
}

const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField({
  id,
  label,
  value,
  onChange,
  type = "text",
  error,
  describedBy,
  autoComplete,
  autoFocus,
  inputMode,
  maxLength,
}, ref) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        ref={ref}
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <p id={describedBy} className="auth-field__error">{error}</p>}
    </div>
  )
})

function countCharacters(value: string): number {
  return [...value].length
}

function assertionOptions(options: PasskeyAssertionOptions): PublicKeyCredentialRequestOptions {
  return {
    challenge: decodeBase64Url(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    allowCredentials: options.allowCredentials.map((item) => ({
      type: "public-key" as const,
      id: decodeBase64Url(item.id),
      transports: item.transports as AuthenticatorTransport[] | undefined,
    })),
    userVerification: options.userVerification as UserVerificationRequirement,
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = globalThis.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
