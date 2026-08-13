import { useState } from "react"
import { Check, KeyRound, LoaderCircle, X } from "lucide-react"

import type { AuthSession } from "../api/auth"
import { AuthApiError, changePassword, createRecentAuthentication } from "../api/auth"

interface PasswordChangePanelProps {
  session: AuthSession
  onClose: () => void
  onSessionChange: (session: AuthSession) => void
}

export function PasswordChangePanel({
  session,
  onClose,
  onSessionChange,
}: PasswordChangePanelProps) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致。")
      return
    }
    if (Array.from(newPassword).length < 6 || Array.from(newPassword).length > 128) {
      setError("新密码长度必须在 6 到 128 个字符之间。")
      return
    }
    setPending(true)
    setError("")
    try {
      await createRecentAuthentication(currentPassword, session.csrfToken)
      const csrfToken = await changePassword(newPassword, session.csrfToken)
      onSessionChange({ ...session, csrfToken })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmation("")
      setSuccess(true)
    } catch (cause) {
      setSuccess(false)
      setError(cause instanceof AuthApiError ? cause.message : "修改密码暂时无法完成。")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="password-change-panel" aria-labelledby="password-change-heading">
      <div className="password-change-panel__heading">
        <div>
          <h2 id="password-change-heading"><KeyRound size={17} aria-hidden="true" />修改密码</h2>
          <p>需要先验证当前密码，成功后其他设备会退出登录。</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭修改密码" title="关闭">
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="password-change-panel__grid">
          <label>
            当前密码
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label>
            新密码
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
          <label>
            确认新密码
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </label>
        </div>
        {error && <p className="form-alert" role="alert">{error}</p>}
        {success && <p className="password-change-panel__success" role="status"><Check size={15} aria-hidden="true" />密码已更新</p>}
        <div className="password-change-panel__actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={pending}>取消</button>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending && <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />}
            {pending ? "验证中" : "更新密码"}
          </button>
        </div>
      </form>
    </section>
  )
}
