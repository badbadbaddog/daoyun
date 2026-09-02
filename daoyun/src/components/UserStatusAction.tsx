import { AlertTriangle, CheckCircle2, LoaderCircle, Settings2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  AdminUsersApiError,
  updateAdminUserStatus,
  type AdminUserDetail,
  type AdminUserStatus,
  type AdminUserStatusUpdate,
} from "../api/adminUsers"
import { ConfirmDialog } from "./ui/ConfirmDialog"

interface UserStatusActionProps {
  detail: AdminUserDetail
  csrfToken: string
  onUpdated: (update: AdminUserStatusUpdate) => void
  onReload: () => void
}

type DurationOption = "7d" | "30d" | "permanent"

type PendingStatusChange = {
  status: AdminUserStatus
  reason: string
  expiresAt: string | null
  impact: string
}

const actionLabels: Record<AdminUserStatus, string> = {
  active: "恢复正常",
  restricted: "限制发布",
  suspended: "暂停账号",
}

export function UserStatusAction({ detail, csrfToken, onUpdated, onReload }: UserStatusActionProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<AdminUserStatus>(nextAction(detail.status))
  const [reason, setReason] = useState(detail.restrictionReason ?? "")
  const [duration, setDuration] = useState<DurationOption>("permanent")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<AdminUserStatusUpdate | null>(null)
  const [pendingChange, setPendingChange] = useState<PendingStatusChange | null>(null)
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setStatus(nextAction(detail.status))
    setReason(detail.restrictionReason ?? "")
    setDuration("permanent")
    setError("")
    setResult(null)
    setPendingChange(null)
  }, [detail.id])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const normalizedReason = reason.trim()
    if (status !== "active" && (normalizedReason.length < 2 || normalizedReason.length > 500)) {
      setError("操作原因需填写 2 至 500 个字符")
      return
    }
    if (status === detail.status && status === "active") {
      setError("请选择与当前状态不同的账号动作")
      return
    }

    const expiresAt = status === "active" || duration === "permanent" ? null : expiryFor(duration)
    const expiryLabel = expiresAt ? formatExpiry(expiresAt) : "永久，直到手动恢复"
    const impact = status === "active"
      ? `确认恢复 ${detail.displayName} 的正常账号权限？`
      : status === "restricted"
        ? `确认限制 ${detail.displayName} 发布主题、回复、私信和上传附件？期限：${expiryLabel}。`
        : `确认暂停 ${detail.displayName} 的账号并使现有会话失效？期限：${expiryLabel}。`
    confirmationReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPendingChange({ status, reason: status === "active" ? "" : normalizedReason, expiresAt, impact })
  }

  async function confirmStatusChange() {
    if (!pendingChange) return
    setSubmitting(true)
    setError("")
    setResult(null)
    try {
      const update = await updateAdminUserStatus(detail.id, {
        status: pendingChange.status,
        reason: pendingChange.reason,
        expiresAt: pendingChange.expiresAt,
        expectedRevision: detail.revision,
      }, csrfToken)
      setResult(update)
      setPendingChange(null)
      setOpen(false)
      onUpdated(update)
    } catch (reasonValue) {
      const message = reasonValue instanceof AdminUsersApiError ? reasonValue.message : "账号状态暂时无法更新"
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return <section className="user-admin-action-section" aria-label="账号状态管理">
    <div className="user-admin-action-heading">
      <div><h4><Settings2 size={15} aria-hidden="true" />账号状态</h4><p>限制发布或暂停登录，所有操作都会进入审计日志。</p></div>
      <button className="secondary-button" type="button" aria-expanded={open} onClick={() => { setOpen((value) => !value); setError("") }}>
        管理账号状态
      </button>
    </div>
    {open ? <form className="user-admin-action-form" onSubmit={(event) => void submit(event)}>
      <label><span>账号动作</span><select aria-label="账号动作" value={status} onChange={(event) => setStatus(event.target.value as AdminUserStatus)}>
        <option value="active">恢复正常</option>
        <option value="restricted">限制发布</option>
        <option value="suspended">暂停账号</option>
      </select></label>
      {status !== "active" ? <>
        <label><span>限制期限</span><select aria-label="限制期限" value={duration} onChange={(event) => setDuration(event.target.value as DurationOption)}>
          <option value="7d">7 天</option><option value="30d">30 天</option><option value="permanent">永久，直到手动恢复</option>
        </select></label>
        <label className="user-admin-action-form__wide"><span>操作原因</span><textarea aria-label="操作原因" minLength={2} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      </> : null}
      <div className="user-admin-impact user-admin-action-form__wide"><AlertTriangle size={15} aria-hidden="true" /><span>{status === "active" ? "恢复该用户的正常使用权限。" : status === "restricted" ? "用户仍可登录和阅读，但不能发布、回复、私信或上传。" : "用户将无法登录，现有会话也会立即失效。"}</span></div>
      {error ? <div className="user-admin-action-form__wide" role="alert">{error}<button className="link-button" type="button" onClick={onReload}>刷新用户</button></div> : null}
      <div className="user-admin-action-buttons user-admin-action-form__wide">
        <button className="secondary-button" type="button" onClick={() => setOpen(false)}>取消</button>
        <button className="primary-button" type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : null}确认提交</button>
      </div>
    </form> : null}
    {pendingChange ? <ConfirmDialog
      title="确认账号状态变更"
      confirmLabel={pendingChange.status === "active" ? "确认恢复账号" : pendingChange.status === "restricted" ? "确认限制账号" : "确认暂停账号"}
      danger={pendingChange.status !== "active"}
      busy={submitting}
      returnFocus={confirmationReturnFocusRef.current}
      onCancel={() => setPendingChange(null)}
      onConfirm={() => void confirmStatusChange()}
    >
      <p>{pendingChange.impact}</p>
      <p>该操作会进入审计日志。</p>
    </ConfirmDialog> : null}
    {result ? <p className="admin-success user-admin-action-result" role="status"><CheckCircle2 size={14} aria-hidden="true" />{result.actor.displayName} 已执行“{actionLabels[result.status]}” · {result.status === "active" ? "立即生效" : result.expiresAt ? `到期 ${formatExpiry(result.expiresAt)}` : "永久有效"} · {formatChangedAt(result.changedAt)} <span>审计编号</span> {result.auditId}</p> : null}
  </section>
}

function expiryFor(duration: Exclude<DurationOption, "permanent">): string {
  const days = duration === "7d" ? 7 : 30
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function nextAction(current: AdminUserStatus): AdminUserStatus {
  return current === "active" ? "restricted" : "active"
}

function formatExpiry(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "未知时间" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function formatChangedAt(value: string): string {
  return `操作于 ${formatExpiry(value)}`
}
