import { HardDriveUpload, LoaderCircle, Save, ShieldCheck, X } from "lucide-react"
import { useEffect, useRef, type FormEvent, type KeyboardEvent, type MouseEvent } from "react"

import type { AdminCommunityGroup } from "../api/admin"

export interface CommunityGroupQuotaDraft {
  uploadDaily: string
  fileMegabytes: string
  storageMegabytes: string
  downloadMegabytesDaily: string
}

interface CommunityGroupQuotaDialogProps {
  group: AdminCommunityGroup
  value: CommunityGroupQuotaDraft
  pending: boolean
  error: string
  onChange: (patch: Partial<CommunityGroupQuotaDraft>) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}

const focusableSelector = "button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"

export function CommunityGroupQuotaDialog({ group, value, pending, error, onChange, onClose, onSubmit }: CommunityGroupQuotaDialogProps) {
  const dialogRef = useRef<HTMLFormElement | null>(null)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== "Tab") return
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
    if (controls.length === 0) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.currentTarget === event.target && !pending) onClose()
  }

  return (
    <div className="dialog-backdrop membership-growth-dialog-backdrop" onMouseDown={closeFromBackdrop}>
      <form ref={dialogRef} className="membership-growth-dialog community-group-quota-dialog" role="dialog" aria-modal="true" aria-labelledby="community-group-quota-title" aria-describedby="community-group-quota-description" onSubmit={onSubmit} onKeyDown={handleKeyDown}>
        <header className="membership-growth-dialog__header">
          <div className="membership-growth-dialog__heading">
            <span className="membership-growth-dialog__heading-icon"><HardDriveUpload size={17} aria-hidden="true" /></span>
            <div><h4 id="community-group-quota-title">配置附件额度</h4><p id="community-group-quota-description">{group.displayName} · {group.internalKey}</p></div>
          </div>
          <button className="icon-button" type="button" aria-label="关闭附件额度配置" title="关闭附件额度配置" disabled={pending} onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </header>

        <div className="community-group-quota-dialog__notice"><ShieldCheck size={17} aria-hidden="true" /><div><strong>额度只约束普通成员</strong><span>超级管理员仍需通过文件类型与 50 MB 系统安全限制。</span></div></div>

        <div className="membership-growth-dialog__body">
          <fieldset className="membership-growth-dialog__section">
            <legend><span aria-hidden="true">01</span><strong>上传限制</strong><small aria-hidden="true">控制上传频率与单个文件体积</small></legend>
            <div className="membership-growth-dialog__fields">
              <label htmlFor="community-group-upload-daily"><span>每日上传数量</span><div className="membership-growth-dialog__input-group membership-growth-dialog__input-group--suffix"><input ref={firstFieldRef} id="community-group-upload-daily" aria-label="每日上传数量" type="number" min={0} max={10_000} step={1} value={value.uploadDaily} disabled={pending} onChange={(event) => onChange({ uploadDaily: event.target.value })} required /><span>张 / 天</span></div><small>填写 0 表示禁止该组上传附件</small></label>
              <label htmlFor="community-group-file-size"><span>单文件大小</span><div className="membership-growth-dialog__input-group membership-growth-dialog__input-group--suffix"><input id="community-group-file-size" aria-label="单文件大小" type="number" min={0} max={50} step={1} value={value.fileMegabytes} disabled={pending} onChange={(event) => onChange({ fileMegabytes: event.target.value })} required /><span>MB</span></div><small>系统安全上限为 50 MB</small></label>
            </div>
          </fieldset>

          <fieldset className="membership-growth-dialog__section">
            <legend><span aria-hidden="true">02</span><strong>空间与流量</strong><small aria-hidden="true">控制累计占用和每日下载流量</small></legend>
            <div className="membership-growth-dialog__fields">
              <label htmlFor="community-group-storage"><span>总存储空间</span><div className="membership-growth-dialog__input-group membership-growth-dialog__input-group--suffix"><input id="community-group-storage" aria-label="总存储空间" type="number" min={0} max={1_048_576} step={1} value={value.storageMegabytes} disabled={pending} onChange={(event) => onChange({ storageMegabytes: event.target.value })} required /><span>MB</span></div><small>该用户全部有效附件的累计空间</small></label>
              <label htmlFor="community-group-download-daily"><span>每日下载流量</span><div className="membership-growth-dialog__input-group membership-growth-dialog__input-group--suffix"><input id="community-group-download-daily" aria-label="每日下载流量" type="number" min={0} max={1_048_576} step={1} value={value.downloadMegabytesDaily} disabled={pending} onChange={(event) => onChange({ downloadMegabytesDaily: event.target.value })} required /><span>MB / 天</span></div><small>填写 0 表示禁止该组下载附件</small></label>
            </div>
          </fieldset>
        </div>

        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="membership-growth-form-actions">
          <p><ShieldCheck size={16} aria-hidden="true" /><span><strong>保存后立即生效</strong><small>不会修改用户组的其他权限和额度</small></span></p>
          <div><button className="secondary-button" type="button" disabled={pending} onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}保存额度</button></div>
        </div>
      </form>
    </div>
  )
}
