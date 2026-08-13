import { useEffect, useRef, useState } from "react"
import { Laptop, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react"

import type { AuthSession, DeviceSession } from "../api/auth"
import { listDeviceSessions, revokeDeviceSession } from "../api/auth"

interface DeviceSessionsPanelProps {
  session: AuthSession
  onClose: () => void
}

export function DeviceSessionsPanel({ session, onClose }: DeviceSessionsPanelProps) {
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [requestVersion, setRequestVersion] = useState(0)
  const [pendingSession, setPendingSession] = useState<DeviceSession | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [message, setMessage] = useState("")
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    setMessage("")
    listDeviceSessions(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setSessions(loaded)
          setStatus("ready")
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error")
      })
    return () => controller.abort()
  }, [requestVersion])

  useEffect(() => {
    if (pendingSession) confirmButtonRef.current?.focus()
  }, [pendingSession])

  async function confirmRevoke() {
    if (!pendingSession || pendingSession.isCurrent || revoking) return
    setRevoking(true)
    setMessage("")
    try {
      await revokeDeviceSession(pendingSession.id, session.csrfToken)
      setSessions((current) => current.filter((item) => item.id !== pendingSession.id))
      setPendingSession(null)
      setMessage("设备会话已撤销")
    } catch {
      setMessage("设备会话暂时无法撤销。")
    } finally {
      setRevoking(false)
    }
  }

  return (
    <section className="device-sessions" aria-labelledby="device-sessions-heading">
      <div className="device-sessions__heading">
        <div>
          <span className="device-sessions__icon" aria-hidden="true"><ShieldCheck size={18} /></span>
          <div>
            <h2 id="device-sessions-heading">设备会话</h2>
            <p>查看并撤销其他已登录设备。</p>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭设备会话" title="关闭">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {status === "loading" ? (
        <div className="topic-loading" role="status"><LoaderCircle className="topic-loading__spinner" size={18} aria-hidden="true" />正在加载设备会话</div>
      ) : status === "error" ? (
        <div className="device-sessions__state" role="alert">
          <p>设备会话暂时无法加载。</p>
          <button className="secondary-button" type="button" onClick={() => setRequestVersion((value) => value + 1)}>
            <RefreshCw size={15} aria-hidden="true" />重试
          </button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="device-sessions__state" role="status">没有可用的设备会话。</div>
      ) : (
        <ul className="device-sessions__list">
          {sessions.map((item) => (
            <li key={item.id}>
              <Laptop size={17} aria-hidden="true" />
              <div className="device-sessions__details">
                <strong>{item.deviceLabel}</strong>
                <span>{item.isCurrent ? "当前会话" : `最近活跃于 ${formatDateTime(item.lastSeenAt)}`}</span>
              </div>
              {item.isCurrent ? (
                <button className="secondary-button" type="button" disabled>当前会话</button>
              ) : (
                <button className="danger-button" type="button" onClick={() => setPendingSession(item)} aria-label={`撤销会话：${item.deviceLabel}`}>
                  撤销
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {message && <p className={message.endsWith("。") ? "form-alert" : "device-sessions__success"} role="status">{message}</p>}

      {pendingSession && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="revoke-device-session-title">
            <h2 id="revoke-device-session-title">确认撤销设备会话</h2>
            <p>撤销后，该设备需要重新登录。</p>
            <div className="confirm-dialog__actions">
              <button className="secondary-button" type="button" onClick={() => setPendingSession(null)} disabled={revoking}>取消</button>
              <button ref={confirmButtonRef} className="danger-button" type="button" onClick={() => void confirmRevoke()} disabled={revoking}>
                {revoking ? "正在撤销" : "确认撤销"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "未知时间"
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`
}
