import { AlertTriangle, Ban, CheckCircle2, LoaderCircle, Settings2, ShieldAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  AdminUsersApiError,
  getAdminUser,
  updateAdminUserStatus,
  type AdminUserDetail,
  type AdminUserStatus,
  type AdminUserStatusUpdate,
} from "../api/adminUsers"
import { ConfirmDialog } from "./ui/ConfirmDialog"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"
import { AdminActionDialog } from "./admin/AdminActionDialog"

interface UserStatusActionProps {
  detail: AdminUserDetail
  csrfToken: string
  onUpdated: (update: AdminUserStatusUpdate) => void
  onRefreshed: (detail: AdminUserDetail) => void
}

type DurationOption = "7d" | "30d" | "permanent"

type PendingStatusChange = {
  status: AdminUserStatus
  reason: string
  expiresAt: string | null
  expectedRevision: number
  impact: string
}

const actionLabels: Record<AdminUserStatus, string> = {
  active: "恢复正常",
  restricted: "限制发布",
  suspended: "暂停账号",
}

export function UserStatusAction({ detail, csrfToken, onUpdated, onRefreshed }: UserStatusActionProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<AdminUserStatus>(nextAction(detail.status))
  const [reason, setReason] = useState(detail.restrictionReason ?? "")
  const [duration, setDuration] = useState<DurationOption>("7d")
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [conflict, setConflict] = useState(false)
  const requestPending = useRef(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<AdminUserStatusUpdate | null>(null)
  const [pendingChange, setPendingChange] = useState<PendingStatusChange | null>(null)
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setStatus(nextAction(detail.status))
    setReason(detail.restrictionReason ?? "")
    setDuration("7d")
    setError("")
    setResult(null)
    setConflict(false)
    setPendingChange(null)
  }, [detail.id])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (requestPending.current || pendingChange || conflict) return
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
    setPendingChange({ status, reason: status === "active" ? "" : normalizedReason, expiresAt, impact, expectedRevision: detail.revision })
  }

  async function confirmStatusChange() {
    if (!pendingChange || requestPending.current || conflict) return
    requestPending.current = true
    setSubmitting(true)
    setError("")
    setResult(null)
    try {
      const update = await updateAdminUserStatus(detail.id, {
        status: pendingChange.status,
        reason: pendingChange.reason,
        expiresAt: pendingChange.expiresAt,
        expectedRevision: pendingChange.expectedRevision,
      }, csrfToken)
      setResult(update)
      setPendingChange(null)
      setOpen(false)
      onUpdated(update)
    } catch (reasonValue) {
      setPendingChange(null)
      setConflict(reasonValue instanceof AdminUsersApiError && reasonValue.status === 409)
      const message = reasonValue instanceof AdminUsersApiError ? reasonValue.message : "账号状态暂时无法更新"
      setError(message)
    } finally {
      requestPending.current = false
      setSubmitting(false)
    }
  }

  async function refreshLatest() {
    if (requestPending.current) return
    requestPending.current = true
    setRefreshing(true)
    setError("")
    try {
      const latest = await getAdminUser(detail.id)
      onRefreshed(latest)
      setConflict(false)
    } catch (reasonValue) {
      setError(reasonValue instanceof AdminUsersApiError ? reasonValue.message : "最新用户资料暂时无法加载，请重试")
    } finally {
      requestPending.current = false
      setRefreshing(false)
    }
  }

  return <section className="user-admin-action-section" aria-label="账号状态管理">
    <div className="user-admin-action-heading">
      <div><h4><Settings2 size={15} aria-hidden="true" />账号操作</h4></div>
      <button className="secondary-button" type="button" aria-expanded={open} onClick={() => { setOpen((value) => !value); setError("") }}>
        管理账号状态
      </button>
    </div>
    <div className="user-account-shortcuts">
      {detail.status !== "active" && <button className="user-account-shortcut user-account-shortcut--restore" type="button" onClick={() => { setStatus("active"); setOpen(true); setError("") }}><CheckCircle2 size={16} aria-hidden="true" />恢复正常</button>}
      <button className="user-account-shortcut user-account-shortcut--restrict" type="button" onClick={() => { setStatus("restricted"); setOpen(true); setError("") }}><ShieldAlert size={16} aria-hidden="true" />限制发布</button>
      <button className="user-account-shortcut user-account-shortcut--suspend" type="button" onClick={() => { setStatus("suspended"); setOpen(true); setError("") }}><Ban size={16} aria-hidden="true" />暂停账号</button>
    </div>
    <p className="user-account-note">提交前需确认原因与期限，操作将写入管理记录。</p>
    {open ? <AdminActionDialog title="管理账号状态" onClose={() => setOpen(false)} busy={submitting || refreshing || Boolean(pendingChange)}>
    <form className="user-admin-action-form" onSubmit={(event) => void submit(event)}>
      <fieldset className="user-admin-action-fields" disabled={submitting || refreshing || Boolean(pendingChange)}>
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
      {conflict && <div className="user-admin-action-form__wide"><RevisionConflictNotice onRefresh={() => void refreshLatest()} /></div>}
      {error ? <div className="user-admin-action-form__wide" role="alert">{error}</div> : null}
      {refreshing && <p className="user-admin-action-form__wide" role="status">正在刷新用户资料，已保留填写内容…</p>}
      <div className="user-admin-action-buttons user-admin-action-form__wide">
        <button className="secondary-button" type="button" onClick={() => setOpen(false)}>取消</button>
        <button className="primary-button" type="submit" disabled={submitting || refreshing || conflict}>{submitting ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : null}确认提交</button>
      </div>
      </fieldset>
    </form>
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
    </AdminActionDialog> : null}
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
