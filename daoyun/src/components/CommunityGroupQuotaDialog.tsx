import { LoaderCircle, Save, ShieldCheck, X } from "lucide-react"
import { useEffect, useRef, type FormEvent, type KeyboardEvent, type MouseEvent } from "react"

import type { AdminCommunityGroup, CommunityGroupStatus } from "../api/admin"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"

export interface CommunityGroupDraft {
  internalKey: string
  displayName: string
  description: string
  isBase: boolean
  displayOrder: string
  status: CommunityGroupStatus
  permissionKeys: string[]
  quotas: Record<string, string>
}

interface CommunityGroupEditorDialogProps {
  group: AdminCommunityGroup | null
  value: CommunityGroupDraft
  pending: boolean
  error: string
  conflict?: boolean
  onRefresh?: () => void
  onChange: (patch: Partial<CommunityGroupDraft>) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}

const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"

export function CommunityGroupEditorDialog({ group, value, pending, error, conflict = false, onRefresh, onChange, onClose, onSubmit }: CommunityGroupEditorDialogProps) {
  const dialogRef = useRef<HTMLFormElement | null>(null)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { firstFieldRef.current?.focus() }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !pending) { event.preventDefault(); onClose(); return }
    if (event.key !== "Tab") return
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
    const first = controls[0]; const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) { if (event.currentTarget === event.target && !pending) onClose() }
  function togglePermission(key: string, checked: boolean) { onChange({ permissionKeys: checked ? [...value.permissionKeys, key].sort() : value.permissionKeys.filter((item) => item !== key) }) }

  return <div className="dialog-backdrop membership-growth-dialog-backdrop" onMouseDown={closeFromBackdrop}>
    <form ref={dialogRef} className="membership-growth-dialog community-group-quota-dialog" role="dialog" aria-modal="true" aria-labelledby="community-group-editor-title" onSubmit={onSubmit} onKeyDown={handleKeyDown}>
      <header className="membership-growth-dialog__header"><div><h4 id="community-group-editor-title">{group ? "编辑用户组" : "创建用户组"}</h4><p>{group ? `${group.displayName} · revision ${group.revision}` : "创建基础组或附加组"}</p></div><button className="icon-button" type="button" aria-label="关闭用户组编辑" title="关闭用户组编辑" disabled={pending} onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
      <div className="membership-growth-dialog__body">
        <fieldset className="membership-growth-dialog__section"><legend><strong>基本信息与排序</strong></legend><div className="membership-growth-dialog__fields">
          <label>内部键<input ref={firstFieldRef} aria-label="内部键" value={value.internalKey} readOnly={Boolean(group)} disabled={pending} onChange={(event) => onChange({ internalKey: event.target.value })} /></label>
          <label>显示名称<input aria-label="显示名称" value={value.displayName} disabled={pending} onChange={(event) => onChange({ displayName: event.target.value })} /></label>
          <label>说明<textarea aria-label="用户组说明" value={value.description} disabled={pending} onChange={(event) => onChange({ description: event.target.value })} /></label>
          <label>显示顺序<input aria-label="显示顺序" type="number" min={0} max={1_000_000} value={value.displayOrder} disabled={pending} onChange={(event) => onChange({ displayOrder: event.target.value })} /></label>
          <label>状态<select aria-label="用户组状态" value={value.status} disabled={pending || !group} onChange={(event) => onChange({ status: event.target.value as CommunityGroupStatus })}><option value="active">启用</option><option value="disabled">停用</option><option value="archived">归档</option></select></label>
          <label className="admin-checkbox"><input type="checkbox" checked={value.isBase} disabled={pending || Boolean(group)} onChange={(event) => onChange({ isBase: event.target.checked })} /><span>基础组（否则为附加组）</span></label>
        </div></fieldset>
        <fieldset className="membership-growth-dialog__section"><legend><strong>社区权限</strong></legend><div className="community-group-permission-grid">{communityPermissionKeys.map((key) => <label className="admin-checkbox" key={key}><input type="checkbox" checked={value.permissionKeys.includes(key)} disabled={pending} onChange={(event) => togglePermission(key, event.target.checked)} /><span>{key}</span></label>)}</div><small>用户组权限和标准权益只包含社区行为，不包含治理或后台能力。</small></fieldset>
        <fieldset className="membership-growth-dialog__section"><legend><strong>全部额度</strong></legend><div className="membership-growth-dialog__fields">{communityQuotaKeys.map(({ key, label, maximum }) => <label key={key}>{label}<input aria-label={label} type="number" min={0} max={maximum} value={value.quotas[key] ?? "0"} disabled={pending} onChange={(event) => onChange({ quotas: { ...value.quotas, [key]: event.target.value } })} /><small>{key}</small></label>)}</div></fieldset>
      </div>
      <div className="community-group-quota-dialog__notice"><ShieldCheck size={17} aria-hidden="true" /><span>保存受 CSRF、RBAC、审计和 revision 保护；标准权益与用户组保持分离。</span></div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {conflict && onRefresh && <RevisionConflictNotice onRefresh={onRefresh} />}
      <div className="membership-growth-form-actions"><button className="secondary-button" type="button" disabled={pending} onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}{group ? "保存用户组" : "创建用户组"}</button></div>
    </form>
  </div>
}

export const communityPermissionKeys = ["board.read", "topic.read", "topic.create", "reply.create", "message.send", "attachment.upload", "attachment.download", "topic.poll.create", "topic.bounty.create", "topic.lottery.join", "content.external_link.use", "profile.signature.use", "content.pre_moderation.required"] as const
export const communityQuotaKeys = [
  { key: "topic.create.daily", label: "每日主题数", maximum: 1_000_000 },
  { key: "reply.create.daily", label: "每日回复数", maximum: 1_000_000 },
  { key: "message.send.daily", label: "每日私信数", maximum: 1_000_000 },
  { key: "attachment.upload.daily", label: "每日上传数量", maximum: 10_000 },
  { key: "attachment.file.bytes", label: "单文件字节数", maximum: Number.MAX_SAFE_INTEGER },
  { key: "attachment.storage.bytes", label: "总存储字节数", maximum: Number.MAX_SAFE_INTEGER },
  { key: "attachment.download.bytes.daily", label: "每日下载字节数", maximum: Number.MAX_SAFE_INTEGER },
  { key: "content.external_link.daily", label: "每日外链数", maximum: 1_000_000 },
] as const
