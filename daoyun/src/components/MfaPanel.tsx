import { useEffect, useRef, useState } from "react"
import { Check, Copy, RefreshCw, ShieldCheck, X } from "lucide-react"

import {
  createRecentAuthentication,
  disableMfa,
  enableMfaTotp,
  getMfaStatus,
  regenerateMfaRecoveryCodes,
  setupMfaTotp,
} from "../api/auth"
import type { AuthSession, MfaSetup, MfaStatus } from "../api/auth"

interface MfaPanelProps {
  session: AuthSession
  onClose: () => void
  onSessionChange: (session: AuthSession) => void
}

export function MfaPanel({ session, onClose, onSessionChange }: MfaPanelProps) {
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const operationScope = `${session.user.id}:${session.csrfToken}`
  const currentScope = useRef(operationScope); currentScope.current = operationScope
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [])
  useEffect(() => {
    setSetup(null); setRecoveryCodes([]); setPassword(""); setCode(""); setBusy(false); setNotice("")
  }, [session.user.id])

  function activeOperation() {
    const controller = lifetime.current
    return () => !!controller && !controller.signal.aborted && currentScope.current === operationScope
  }

  const [requestVersion, setRequestVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError(""); setStatus(null)
    getMfaStatus(controller.signal).then(value => {
      if (!controller.signal.aborted) setStatus(value)
    }).catch(() => {
      if (!controller.signal.aborted) setError("无法读取多因素认证状态")
    })
    return () => controller.abort()
  }, [requestVersion, session.user.id])

  async function reauthenticate() {
    if (!password) throw new Error("请输入当前密码")
    await createRecentAuthentication(password, session.csrfToken)
  }

  async function beginSetup() {
    const active = activeOperation()
    setBusy(true); setError(""); setNotice("")
    try {
      await reauthenticate()
      if (!active()) return
      const result = await setupMfaTotp(session.csrfToken)
      if (!active()) return
      setSetup(result)
      setPassword("")
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "多因素认证设置失败")
    } finally { if (active()) setBusy(false) }
  }

  async function enable() {
    const active = activeOperation()
    setBusy(true); setError("")
    try {
      const result = await enableMfaTotp(code, session.csrfToken)
      if (!active()) return
      onSessionChange({ ...session, csrfToken: result.csrfToken })
      setRecoveryCodes(result.recoveryCodes); setSetup(null); setCode("")
      setStatus({ enabled: true, setupPending: false, recoveryCodesRemaining: 10 })
      setNotice("多因素认证已启用，请立即保存恢复码。")
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "多因素认证启用失败")
    } finally { if (active()) setBusy(false) }
  }

  async function regenerate() {
    const active = activeOperation()
    setBusy(true); setError("")
    try {
      await reauthenticate()
      if (!active()) return
      const result = await regenerateMfaRecoveryCodes(code, session.csrfToken)
      if (!active()) return
      onSessionChange({ ...session, csrfToken: result.csrfToken })
      setRecoveryCodes(result.recoveryCodes); setCode(""); setPassword("")
      setStatus((current) => current && { ...current, recoveryCodesRemaining: 10 })
      setNotice("恢复码已重新生成，旧恢复码已失效。")
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "恢复码生成失败")
    } finally { if (active()) setBusy(false) }
  }

  async function disable() {
    const active = activeOperation()
    setBusy(true); setError("")
    try {
      await reauthenticate()
      if (!active()) return
      const csrfToken = await disableMfa(code, session.csrfToken)
      if (!active()) return
      onSessionChange({ ...session, csrfToken }); setStatus({ enabled: false, setupPending: false, recoveryCodesRemaining: 0 })
      setCode(""); setPassword(""); setNotice("多因素认证已停用。")
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "多因素认证停用失败")
    } finally { if (active()) setBusy(false) }
  }

  return (
    <section className="security-panel" aria-labelledby="mfa-heading">
      <div className="security-panel__header">
        <div><p className="security-panel__eyebrow">登录安全</p><h2 id="mfa-heading"><ShieldCheck size={17} aria-hidden="true" />多因素认证</h2></div>
        <button className="icon-button" type="button" aria-label="关闭多因素认证设置" title="关闭" onClick={onClose}><X size={17} aria-hidden="true" /></button>
      </div>
      {status && <p className="security-panel__summary">{status.enabled ? `已启用 · 剩余 ${status.recoveryCodesRemaining} 个恢复码` : "尚未启用"}</p>}
      {!status && !error && <p role="status">正在读取安全状态</p>}
      {!status && error && <button className="secondary-button" type="button" onClick={() => setRequestVersion(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />重试安全状态</button>}
      {status && !status.enabled && !setup && <>
        <label className="security-panel__field">当前密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void beginSetup()}>开始设置 TOTP</button>
      </>}
      {setup && <div className="security-panel__setup">
        <p>用身份验证器扫描二维码，或手动输入密钥：</p><code>{setup.secretBase32}</code>
        <a href={setup.otpauthUrl}>打开身份验证器</a>
        <label className="security-panel__field">验证器验证码<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void enable()}>验证并启用</button>
      </div>}
      {status?.enabled && !setup && <>
        <label className="security-panel__field">当前密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="security-panel__field">TOTP 或恢复码<input autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <div className="security-panel__actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void regenerate()}>重新生成恢复码</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void disable()}>停用 MFA</button></div>
      </>}
      {recoveryCodes.length > 0 && <div className="security-panel__recovery" role="status"><strong>恢复码（仅显示一次）</strong><button className="icon-button" type="button" aria-label="复制恢复码" title="复制" onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n"))}><Copy size={15} aria-hidden="true" /></button><pre>{recoveryCodes.join("\n")}</pre></div>}
      {notice && <p className="security-panel__success" role="status"><Check size={15} aria-hidden="true" />{notice}</p>}
      {error && <p className="security-panel__error" role="alert">{error}</p>}
    </section>
  )
}
