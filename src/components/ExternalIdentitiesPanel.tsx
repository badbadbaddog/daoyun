import { useEffect, useState } from "react"
import {
  Fingerprint,
  Link2,
  LoaderCircle,
  RefreshCw,
  Replace,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react"

import {
  AuthApiError,
  createRecentAuthentication,
  listExternalIdentities,
  listOidcProviders,
  startOidcIdentityBinding,
  startOidcIdentityReplacement,
  unlinkExternalIdentity,
} from "../api/auth"
import type { AuthSession, ExternalIdentity, OidcProvider } from "../api/auth"
import { rememberOidcSettingsReturn } from "../utils/oidcSettingsReturn"

type LoadStatus = "loading" | "ready" | "error"
type IdentityAction =
  | { kind: "bind"; providerKey: string }
  | { kind: "replace"; identity: ExternalIdentity; providerKey: string }
  | { kind: "unlink"; identity: ExternalIdentity }

interface ExternalIdentitiesPanelProps {
  session: AuthSession
  onClose: () => void
  onSessionChange: (session: AuthSession) => void
  onAuthorizationRedirect?: (url: string) => void
}

export function ExternalIdentitiesPanel({
  session,
  onClose,
  onSessionChange,
  onAuthorizationRedirect = redirectToAuthorization,
}: ExternalIdentitiesPanelProps) {
  const [providers, setProviders] = useState<OidcProvider[]>([])
  const [identities, setIdentities] = useState<ExternalIdentity[]>([])
  const [status, setStatus] = useState<LoadStatus>("loading")
  const [requestVersion, setRequestVersion] = useState(0)
  const [action, setAction] = useState<IdentityAction | null>(null)
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    setError("")
    Promise.all([
      listOidcProviders(controller.signal),
      listExternalIdentities(controller.signal),
    ]).then(([loadedProviders, loadedIdentities]) => {
      if (!controller.signal.aborted) {
        setProviders(loadedProviders)
        setIdentities(loadedIdentities)
        setStatus("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) setStatus("error")
    })
    return () => controller.abort()
  }, [requestVersion])

  function providerName(providerKey: string): string {
    return providers.find((provider) => provider.providerKey === providerKey)?.displayName
      ?? providerKey
  }

  function beginAction(nextAction: IdentityAction) {
    setAction(nextAction)
    setPassword("")
    setError("")
    setMessage("")
  }

  function cancelAction() {
    if (pending) return
    setAction(null)
    setPassword("")
    setError("")
  }

  async function submitAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!action || pending) return
    if (!password) {
      setError("请输入当前密码。")
      return
    }
    setPending(true)
    setError("")
    setMessage("")
    try {
      await createRecentAuthentication(password, session.csrfToken)
      if (action.kind === "unlink") {
        const csrfToken = await unlinkExternalIdentity(action.identity.id, session.csrfToken)
        const name = providerName(action.identity.providerKey)
        setIdentities((current) => current.filter((identity) => identity.id !== action.identity.id))
        onSessionChange({ ...session, csrfToken })
        setAction(null)
        setPassword("")
        setMessage(`${name} 身份已解绑`)
        return
      }

      const authorizationUrl = action.kind === "bind"
        ? await startOidcIdentityBinding(action.providerKey, session.csrfToken)
        : await startOidcIdentityReplacement(
          action.providerKey,
          action.identity.id,
          session.csrfToken,
        )
      rememberOidcSettingsReturn(session.user.username)
      onAuthorizationRedirect(authorizationUrl)
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "登录方式暂时无法更新。")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="external-identities" aria-labelledby="external-identities-heading">
      <header className="external-identities__heading">
        <div>
          <Fingerprint size={18} aria-hidden="true" />
          <div>
            <h2 id="external-identities-heading">登录方式</h2>
            <p>管理当前账户绑定的外部身份。</p>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭登录方式" title="关闭">
          <X size={17} aria-hidden="true" />
        </button>
      </header>

      {status === "loading" ? (
        <div className="topic-loading" role="status">
          <LoaderCircle className="topic-loading__spinner" size={18} aria-hidden="true" />
          正在加载登录方式
        </div>
      ) : status === "error" ? (
        <div className="external-identities__state" role="alert">
          <p>登录方式暂时无法加载。</p>
          <button className="secondary-button" type="button" onClick={() => setRequestVersion((value) => value + 1)}>
            <RefreshCw size={15} aria-hidden="true" />重新加载
          </button>
        </div>
      ) : (
        <>
          <div className="external-identities__section">
            <h3>已绑定身份</h3>
            {identities.length === 0 ? (
              <p className="external-identities__empty">还没有绑定外部身份</p>
            ) : (
              <ul className="external-identities__list">
                {identities.map((identity) => {
                  const name = providerName(identity.providerKey)
                  return (
                    <li key={identity.id}>
                      <ShieldCheck size={17} aria-hidden="true" />
                      <div className="external-identities__details">
                        <strong>{name}</strong>
                        <span>
                          {identity.lastAuthenticatedAt
                            ? `最近验证于 ${formatDateTime(identity.lastAuthenticatedAt)}`
                            : `绑定于 ${formatDateTime(identity.createdAt)}`}
                        </span>
                      </div>
                      <div className="external-identities__actions">
                        <button
                          className="secondary-button"
                          type="button"
                          aria-label={`替换 ${name} 身份`}
                          onClick={() => beginAction({
                            kind: "replace",
                            identity,
                            providerKey: identity.providerKey,
                          })}
                        >
                          <Replace size={14} aria-hidden="true" />替换
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          aria-label={`解绑 ${name} 身份`}
                          onClick={() => beginAction({ kind: "unlink", identity })}
                        >
                          <Trash2 size={14} aria-hidden="true" />解绑
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="external-identities__section">
            <h3>可用身份服务</h3>
            {providers.length === 0 ? (
              <p className="external-identities__empty">当前没有可用的外部身份服务</p>
            ) : (
              <ul className="external-identities__providers">
                {providers.map((provider) => {
                  const alreadyBound = identities.some((identity) => identity.providerKey === provider.providerKey)
                  const label = alreadyBound
                    ? `绑定另一个 ${provider.displayName} 身份`
                    : `绑定 ${provider.displayName} 身份`
                  return (
                    <li key={provider.providerKey}>
                      <span><Link2 size={15} aria-hidden="true" />{provider.displayName}</span>
                      <button
                        className="secondary-button"
                        type="button"
                        aria-label={label}
                        onClick={() => beginAction({ kind: "bind", providerKey: provider.providerKey })}
                      >
                        {alreadyBound ? "绑定另一个" : "绑定"}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {action && (
            <form className="external-identities__form" onSubmit={(event) => void submitAction(event)}>
              <div>
                <h3>{actionTitle(action, providerName)}</h3>
                {action.kind === "unlink" && <p>解绑后，这个外部身份将不能再用于登录。</p>}
              </div>
              {action.kind === "replace" && (
                <label>
                  新的身份服务
                  <select
                    value={action.providerKey}
                    onChange={(event) => setAction({ ...action, providerKey: event.target.value })}
                    disabled={pending}
                  >
                    {providers.map((provider) => (
                      <option key={provider.providerKey} value={provider.providerKey}>{provider.displayName}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                当前密码
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={pending}
                  required
                />
              </label>
              {error && <p className="form-alert" role="alert">{error}</p>}
              <div className="external-identities__form-actions">
                <button className="secondary-button" type="button" onClick={cancelAction} disabled={pending}>取消</button>
                <button className={action.kind === "unlink" ? "danger-button" : "primary-button"} type="submit" disabled={pending}>
                  {pending && <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />}
                  {pending ? "正在验证" : actionSubmitLabel(action.kind)}
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {message && <p className="external-identities__success" role="status">{message}</p>}
    </section>
  )
}

function actionTitle(
  action: IdentityAction,
  providerName: (providerKey: string) => string,
): string {
  if (action.kind === "bind") return `绑定 ${providerName(action.providerKey)}`
  if (action.kind === "replace") return `替换 ${providerName(action.identity.providerKey)} 身份`
  return `解绑 ${providerName(action.identity.providerKey)} 身份`
}

function actionSubmitLabel(kind: IdentityAction["kind"]): string {
  if (kind === "bind") return "继续绑定"
  if (kind === "replace") return "继续替换"
  return "确认解绑"
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "未知时间"
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`
}

function redirectToAuthorization(url: string): void {
  window.location.assign(url)
}
