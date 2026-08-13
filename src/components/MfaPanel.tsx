import { useEffect, useState } from "react"
import { Check, Copy, ShieldCheck, X } from "lucide-react"

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

  useEffect(() => {
    getMfaStatus().then(setStatus).catch(() => setError("无法读取多因素认证状态"))
  }, [])

  async function reauthenticate() {
    if (!password) throw new Error("请输入当前密码")
    await createRecentAuthentication(password, session.csrfToken)
  }

  async function beginSetup() {
    setBusy(true); setError(""); setNotice("")
    try {
      await reauthenticate()
      setSetup(await setupMfaTotp(session.csrfToken))
      setPassword("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "多因素认证设置失败")
    } finally { setBusy(false) }
  }

  async function enable() {
    setBusy(true); setError("")
    try {
      const result = await enableMfaTotp(code, session.csrfToken)
      onSessionChange({ ...session, csrfToken: result.csrfToken })
      setRecoveryCodes(result.recoveryCodes); setSetup(null); setCode("")
      setStatus({ enabled: true, setupPending: false, recoveryCodesRemaining: 10 })
      setNotice("多因素认证已启用，请立即保存恢复码。")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "多因素认证启用失败")
    } finally { setBusy(false) }
  }

  async function regenerate() {
    setBusy(true); setError("")
    try {
      await reauthenticate()
      const result = await regenerateMfaRecoveryCodes(code, session.csrfToken)
      onSessionChange({ ...session, csrfToken: result.csrfToken })
      setRecoveryCodes(result.recoveryCodes); setCode(""); setPassword("")
      setStatus((current) => current && { ...current, recoveryCodesRemaining: 10 })
      setNotice("恢复码已重新生成，旧恢复码已失效。")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复码生成失败")
    } finally { setBusy(false) }
  }

  async function disable() {
    setBusy(true); setError("")
    try {
      await reauthenticate()
      const csrfToken = await disableMfa(code, session.csrfToken)
      onSessionChange({ ...session, csrfToken }); setStatus({ enabled: false, setupPending: false, recoveryCodesRemaining: 0 })
      setCode(""); setPassword(""); setNotice("多因素认证已停用。")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "多因素认证停用失败")
    } finally { setBusy(false) }
  }

  return (
    <section className="security-panel" aria-labelledby="mfa-heading">
      <div className="security-panel__header">
        <div><p className="security-panel__eyebrow">登录安全</p><h2 id="mfa-heading"><ShieldCheck size={17} aria-hidden="true" />多因素认证</h2></div>
        <button className="icon-button" type="button" aria-label="关闭多因素认证设置" title="关闭" onClick={onClose}><X size={17} aria-hidden="true" /></button>
      </div>
      {status && <p className="security-panel__summary">{status.enabled ? `已启用 · 剩余 ${status.recoveryCodesRemaining} 个恢复码` : "尚未启用"}</p>}
      {!status?.enabled && !setup && <>
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
