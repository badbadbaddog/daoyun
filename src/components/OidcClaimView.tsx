import { ArrowLeft, KeyRound, Link, LogIn, ShieldCheck, UserPlus } from "lucide-react"
import { useEffect, useState } from "react"

import {
  AuthApiError,
  bindOidcClaim,
  createOidcClaimAccount,
  createRecentAuthentication,
  getOidcClaim,
  login,
} from "../api/auth"
import type { AuthSession, OidcClaim, RegisterInput } from "../api/auth"

type View = "choice" | "account" | "login" | "reauth"
type LoadState = "loading" | "ready" | "invalid"

interface OidcClaimViewProps {
  session: AuthSession | null
  onSessionChange: (session: AuthSession) => void
  onComplete: () => void
}

export function OidcClaimView({ session, onSessionChange, onComplete }: OidcClaimViewProps) {
  const [claim, setClaim] = useState<OidcClaim | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [view, setView] = useState<View>(session ? "reauth" : "choice")
  const [activeSession, setActiveSession] = useState<AuthSession | null>(session)

  useEffect(() => {
    const controller = new AbortController()
    getOidcClaim(controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setClaim(value)
        setLoadState("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) setLoadState("invalid")
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    setActiveSession(session)
    if (session) setView("reauth")
  }, [session])

  if (loadState === "loading") {
    return <ClaimState title="正在确认外部身份" detail="请稍候。" />
  }
  if (loadState === "invalid" || !claim) {
    return <ClaimState title="外部身份确认已失效" detail="请重新发起外部登录后继续。" />
  }

  return (
    <main className="oidc-claim-page" aria-labelledby="oidc-claim-title">
      <section className="oidc-claim-panel">
        <header className="oidc-claim-panel__header">
          <span className="oidc-claim-panel__icon" aria-hidden="true"><ShieldCheck size={22} /></span>
          <div>
            <p>外部身份</p>
            <h1 id="oidc-claim-title">确认 {claim.providerDisplayName} 身份</h1>
          </div>
        </header>
        <dl className="oidc-claim-summary">
          <div><dt>服务</dt><dd>{claim.providerDisplayName}</dd></div>
          {claim.profileName && <div><dt>资料名称</dt><dd>{claim.profileName}</dd></div>}
          {claim.emailHint && <div><dt>邮箱提示</dt><dd>{claim.emailHint}</dd></div>}
        </dl>
        {view === "choice" && <ClaimChoice onCreate={() => setView("account")} onLogin={() => setView("login")} />}
        {view === "account" && (
          <AccountForm
            claim={claim}
            onBack={() => setView("choice")}
            onComplete={(nextSession) => {
              setActiveSession(nextSession)
              onSessionChange(nextSession)
              onComplete()
            }}
          />
        )}
        {view === "login" && (
          <LoginForm
            onBack={() => setView("choice")}
            onAuthenticated={(nextSession) => {
              setActiveSession(nextSession)
              onSessionChange(nextSession)
              setView("reauth")
            }}
          />
        )}
        {view === "reauth" && activeSession && (
          <ReauthenticateForm
            session={activeSession}
            onComplete={(csrfToken) => {
              const nextSession = { ...activeSession, csrfToken }
              setActiveSession(nextSession)
              onSessionChange(nextSession)
              onComplete()
            }}
          />
        )}
      </section>
    </main>
  )
}

function ClaimChoice({ onCreate, onLogin }: { onCreate: () => void; onLogin: () => void }) {
  return (
    <div className="oidc-claim-actions">
      <button className="primary-button" type="button" onClick={onCreate}>
        <UserPlus size={16} aria-hidden="true" />
        创建新账户
      </button>
      <button className="secondary-button" type="button" onClick={onLogin}>
        <LogIn size={16} aria-hidden="true" />
        登录已有账户
      </button>
    </div>
  )
}

function AccountForm({ claim, onBack, onComplete }: {
  claim: OidcClaim
  onBack: () => void
  onComplete: (session: AuthSession) => void
}) {
  const [input, setInput] = useState<RegisterInput>({
    username: claim.preferredUsername?.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32) ?? "",
    email: "",
    displayName: claim.profileName ?? "",
    password: "",
  })
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError("")
    try {
      onComplete(await createOidcClaimAccount(input))
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="oidc-claim-form" onSubmit={(event) => { void submit(event) }}>
      <ClaimBack onClick={onBack} />
      <Field label="用户名" value={input.username} onChange={(username) => setInput({ ...input, username })} autoComplete="username" />
      <Field label="邮箱" type="email" value={input.email} onChange={(email) => setInput({ ...input, email })} autoComplete="email" />
      <Field label="显示名称" value={input.displayName} onChange={(displayName) => setInput({ ...input, displayName })} autoComplete="name" />
      <Field label="密码" type="password" value={input.password} onChange={(password) => setInput({ ...input, password })} autoComplete="new-password" />
      {error && <p className="auth-form__error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={submitting}>
        <Link size={16} aria-hidden="true" />
        {submitting ? "正在创建" : "创建并绑定"}
      </button>
    </form>
  )
}

function LoginForm({ onBack, onAuthenticated }: {
  onBack: () => void
  onAuthenticated: (session: AuthSession) => void
}) {
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError("")
    try {
      onAuthenticated(await login({ identifier, password }))
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="oidc-claim-form" onSubmit={(event) => { void submit(event) }}>
      <ClaimBack onClick={onBack} />
      <Field label="用户名或邮箱" value={identifier} onChange={setIdentifier} autoComplete="username" />
      <Field label="密码" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
      {error && <p className="auth-form__error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={submitting}>
        <LogIn size={16} aria-hidden="true" />
        {submitting ? "正在登录" : "登录并继续"}
      </button>
    </form>
  )
}

function ReauthenticateForm({ session, onComplete }: {
  session: AuthSession
  onComplete: (csrfToken: string) => void
}) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError("")
    try {
      await createRecentAuthentication(password, session.csrfToken)
      const result = await bindOidcClaim(session.csrfToken)
      onComplete(result.csrfToken)
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="oidc-claim-form" onSubmit={(event) => { void submit(event) }}>
      <div className="oidc-claim-account"><KeyRound size={16} aria-hidden="true" /><span>{session.user.username}</span></div>
      <h2>确认当前账户</h2>
      <Field label="当前密码" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
      {error && <p className="auth-form__error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={submitting}>
        <Link size={16} aria-hidden="true" />
        {submitting ? "正在确认" : "确认并绑定"}
      </button>
    </form>
  )
}

function Field({ label, value, onChange, type = "text", autoComplete }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "email" | "password"
  autoComplete: string
}) {
  const id = `oidc-claim-${label}`
  return <label className="auth-field" htmlFor={id}>{label}<input id={id} type={type} value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} /></label>
}

function ClaimBack({ onClick }: { onClick: () => void }) {
  return <button className="oidc-claim-back" type="button" onClick={onClick}><ArrowLeft size={15} aria-hidden="true" />返回</button>
}

function ClaimState({ title, detail }: { title: string; detail: string }) {
  return <main className="oidc-claim-page"><section className="oidc-claim-panel oidc-claim-panel--state" role="status"><h1>{title}</h1><p>{detail}</p></section></main>
}

function messageFor(cause: unknown): string {
  if (cause instanceof AuthApiError) return cause.fields.body?.[0] ?? cause.message
  return "身份服务暂时不可用，请稍后重试"
}
