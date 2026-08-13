import { useEffect, useState } from "react"
import { Fingerprint, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react"

import {
  AuthApiError,
  createRecentAuthentication,
  deletePasskey,
  listPasskeys,
  startPasskeyRegistration,
  verifyPasskeyRegistration,
} from "../api/auth"
import type { AuthSession, PasskeyCredentialSummary } from "../api/auth"

interface PasskeysPanelProps {
  session: AuthSession
  onClose: () => void
  onSessionChange: (session: AuthSession) => void
}

type LoadStatus = "loading" | "ready" | "error"

export function PasskeysPanel({ session, onClose, onSessionChange }: PasskeysPanelProps) {
  const [passkeys, setPasskeys] = useState<PasskeyCredentialSummary[]>([])
  const [status, setStatus] = useState<LoadStatus>("loading")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    listPasskeys(controller.signal).then((loaded) => {
      if (!controller.signal.aborted) {
        setPasskeys(loaded)
        setStatus("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) setStatus("error")
    })
    return () => controller.abort()
  }, [requestVersion])

  async function register() {
    if (pending) return
    if (!password) {
      setError("请输入当前密码以确认操作。")
      return
    }
    if (!window.PublicKeyCredential) {
      setError("当前浏览器不支持通行密钥。")
      return
    }
    setPending(true)
    setError("")
    setMessage("")
    try {
      await createRecentAuthentication(password, session.csrfToken)
      const ceremony = await startPasskeyRegistration(session.csrfToken)
      const credential = await navigator.credentials.create({ publicKey: creationOptions(ceremony.options) })
      if (!(credential instanceof PublicKeyCredential)) throw new Error("浏览器未返回通行密钥")
      const result = await verifyPasskeyRegistration(ceremony.challengeId, credential, session.csrfToken)
      setPasskeys((current) => [result.credential, ...current])
      onSessionChange({ ...session, csrfToken: result.csrfToken })
      setPassword("")
      setMessage("通行密钥已添加。")
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "通行密钥暂时无法添加。")
    } finally {
      setPending(false)
    }
  }

  async function remove(passkeyId: string) {
    if (pending) return
    if (!password) {
      setError("请输入当前密码以确认删除。")
      return
    }
    setPending(true)
    setError("")
    setMessage("")
    try {
      await createRecentAuthentication(password, session.csrfToken)
      const csrfToken = await deletePasskey(passkeyId, session.csrfToken)
      setPasskeys((current) => current.filter((item) => item.id !== passkeyId))
      onSessionChange({ ...session, csrfToken })
      setPassword("")
      setMessage("通行密钥已删除。")
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "通行密钥暂时无法删除。")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="external-identities passkeys-panel" aria-labelledby="passkeys-heading">
      <div className="external-identities__heading">
        <div><Fingerprint size={18} aria-hidden="true" /><span><h2 id="passkeys-heading">通行密钥</h2><p>使用设备生物识别或系统 PIN 登录。</p></span></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭通行密钥" title="关闭"><X size={16} aria-hidden="true" /></button>
      </div>
      <label className="passkeys-panel__password">当前密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {status === "loading" ? <div className="topic-loading" role="status"><LoaderCircle className="topic-loading__spinner" size={18} aria-hidden="true" />正在加载通行密钥</div> : status === "error" ? <div className="external-identities__state" role="alert"><p>通行密钥暂时无法加载。</p><button className="secondary-button" type="button" onClick={() => setRequestVersion((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" />重试</button></div> : (
        <div className="external-identities__section">
          <div className="external-identities__form-actions"><button className="primary-button" type="button" onClick={() => void register()} disabled={pending}><Fingerprint size={15} aria-hidden="true" />{pending ? "处理中" : "添加通行密钥"}</button></div>
          {passkeys.length === 0 ? <p className="external-identities__empty">还没有添加通行密钥。</p> : <ul className="external-identities__list">{passkeys.map((passkey) => <li key={passkey.id}><Fingerprint size={16} aria-hidden="true" /><div className="external-identities__details"><strong>设备通行密钥</strong><span>添加于 {formatDate(passkey.createdAt)}{passkey.lastUsedAt ? `，最近使用于 ${formatDate(passkey.lastUsedAt)}` : ""}</span></div><div className="external-identities__actions"><button className="danger-button" type="button" onClick={() => void remove(passkey.id)} disabled={pending}><Trash2 size={14} aria-hidden="true" />删除</button></div></li>)}</ul>}
        </div>
      )}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {message && <p className="external-identities__success" role="status">{message}</p>}
    </section>
  )
}

function creationOptions(options: import("../api/auth").PasskeyRegistrationOptions): PublicKeyCredentialCreationOptions {
  return {
    challenge: decodeBase64Url(options.challenge),
    rp: options.rp,
    user: { ...options.user, id: decodeBase64Url(options.user.id) },
    pubKeyCredParams: options.pubKeyCredParams.map((item) => ({ ...item, type: "public-key" as const })),
    excludeCredentials: options.excludeCredentials.map((item) => ({
      ...item,
      type: "public-key" as const,
      id: decodeBase64Url(item.id),
      transports: item.transports as AuthenticatorTransport[] | undefined,
    })),
    timeout: options.timeout,
    authenticatorSelection: {
      authenticatorAttachment: options.authenticatorSelection.authenticatorAttachment as AuthenticatorAttachment | undefined,
      residentKey: options.authenticatorSelection.residentKey as ResidentKeyRequirement | undefined,
      userVerification: options.authenticatorSelection.userVerification as UserVerificationRequirement,
    },
    attestation: options.attestation as AttestationConveyancePreference,
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const binary = globalThis.atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleDateString("zh-CN")
}
