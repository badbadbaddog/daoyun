import { CircleCheck, LoaderCircle, Plus, Save, Sparkles, X } from "lucide-react"
import { useEffect, useRef, type FormEvent, type KeyboardEvent, type MouseEvent } from "react"

import type { AdminGrowthLevel } from "../api/admin"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"

export interface GrowthLevelDraft {
  internalKey: string
  levelOrder: string
  displayName: string
  requiredExperience: string
  color: string
  description: string
}

interface SharedDialogProps {
  pending: boolean
  error: string
  conflict?: boolean
  onRefresh?: () => void
  onClose: () => void
}

interface CreateDialogProps extends SharedDialogProps {
  mode: "create"
  value: GrowthLevelDraft
  onChange: (patch: Partial<GrowthLevelDraft>) => void
  onSubmit: (event: FormEvent) => void
}

interface EditDialogProps extends SharedDialogProps {
  mode: "edit"
  value: AdminGrowthLevel
  onChange: (patch: Partial<AdminGrowthLevel>) => void
  onSubmit: (event: FormEvent) => void
}

type GrowthLevelFormDialogProps = CreateDialogProps | EditDialogProps

const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"

export function GrowthLevelFormDialog(props: GrowthLevelFormDialogProps) {
  const dialogRef = useRef<HTMLFormElement | null>(null)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)
  const isCreate = props.mode === "create"
  const title = isCreate ? "新增成长等级" : "编辑成长等级"
  const description = isCreate ? "设置等级名称、成长门槛和前台展示信息。" : `正在调整 ${props.value.internalKey} 的等级规则。`
  const internalKey = props.value.internalKey.trim()
  const displayName = props.value.displayName.trim()
  const levelOrder = String(props.value.levelOrder).trim()
  const requiredExperience = String(props.value.requiredExperience).trim()
  const normalizedColor = (props.value.color ?? "").trim()
  const previewColor = /^#[0-9a-f]{6}$/i.test(normalizedColor) ? normalizedColor : undefined

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !props.pending) {
      event.preventDefault()
      props.onClose()
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
    if (event.currentTarget === event.target && !props.pending) props.onClose()
  }

  function changeLevelOrder(value: string) {
    if (props.mode === "create") props.onChange({ levelOrder: value })
    else props.onChange({ levelOrder: Number(value) })
  }

  function changeRequiredExperience(value: string) {
    if (props.mode === "create") props.onChange({ requiredExperience: value })
    else props.onChange({ requiredExperience: Number(value) })
  }

  function changeColor(value: string) {
    if (props.mode === "create") props.onChange({ color: value })
    else props.onChange({ color: value || null })
  }

  return (
    <div className="dialog-backdrop membership-growth-dialog-backdrop" onMouseDown={closeFromBackdrop}>
      <form ref={dialogRef} className="membership-growth-dialog" role="dialog" aria-modal="true" aria-labelledby="membership-growth-form-title" aria-describedby="membership-growth-form-description" onSubmit={props.onSubmit} onKeyDown={handleKeyDown}>
        <header className="membership-growth-dialog__header">
          <div className="membership-growth-dialog__heading">
            <span className="membership-growth-dialog__heading-icon"><Sparkles size={17} aria-hidden="true" /></span>
            <div>
              <h4 id="membership-growth-form-title">{title}</h4>
              <p id="membership-growth-form-description">{description}</p>
            </div>
          </div>
          <button className="icon-button" type="button" aria-label={`关闭${title}`} title={`关闭${title}`} disabled={props.pending} onClick={props.onClose}><X size={16} aria-hidden="true" /></button>
        </header>

        <section className="membership-growth-dialog__preview" aria-label="等级预览">
          <span className="membership-growth-dialog__preview-mark" style={previewColor ? { borderColor: previewColor, color: previewColor } : undefined}>Lv {levelOrder || "—"}</span>
          <div className="membership-growth-dialog__preview-copy">
            <span>等级预览</span>
            <strong>{displayName || "未命名等级"}</strong>
            <small>{internalKey || "内部键待填写"}</small>
          </div>
          <div className="membership-growth-dialog__preview-exp">
            <span>升级门槛</span>
            <strong>{requiredExperience || "0"} <small>EXP</small></strong>
          </div>
        </section>

        <div className="membership-growth-dialog__body">
          <fieldset className="membership-growth-dialog__section">
            <legend><span aria-hidden="true">01</span><strong>基本信息</strong><small aria-hidden="true">用于识别和展示这个等级</small></legend>
            <div className="membership-growth-dialog__fields">
              {isCreate && <label htmlFor="growth-dialog-key"><span>内部键</span><input ref={firstFieldRef} id="growth-dialog-key" aria-label="内部键" value={props.value.internalKey} maxLength={64} placeholder="例如 traveler" disabled={props.pending} onChange={(event) => props.onChange({ internalKey: event.target.value })} required /><small>创建后不可修改，使用小写字母、数字和下划线</small></label>}
              <label htmlFor="growth-dialog-name"><span>展示名称</span><input ref={isCreate ? undefined : firstFieldRef} id="growth-dialog-name" aria-label="展示名称" value={props.value.displayName} maxLength={80} placeholder="例如 旅者" disabled={props.pending} onChange={(event) => props.onChange({ displayName: event.target.value })} required /><small>显示在会员资料和等级列表中</small></label>
            </div>
          </fieldset>

          <fieldset className="membership-growth-dialog__section">
            <legend><span aria-hidden="true">02</span><strong>成长规则</strong><small aria-hidden="true">决定等级顺序和升级门槛</small></legend>
            <div className="membership-growth-dialog__fields">
              <label htmlFor="growth-dialog-order"><span>等级顺序</span><div className="membership-growth-dialog__input-group membership-growth-dialog__input-group--prefix"><span>Lv</span><input id="growth-dialog-order" aria-label="等级顺序" type="number" min={1} step={1} value={props.value.levelOrder} disabled={props.pending} onChange={(event) => changeLevelOrder(event.target.value)} required /></div><small>数字越大，等级越高</small></label>
              <label htmlFor="growth-dialog-experience"><span>EXP 阈值</span><div className="membership-growth-dialog__input-group membership-growth-dialog__input-group--suffix"><input id="growth-dialog-experience" aria-label="EXP 阈值" type="number" min={0} step={1} value={props.value.requiredExperience} disabled={props.pending} onChange={(event) => changeRequiredExperience(event.target.value)} required /><span>EXP</span></div><small>达到该累计经验后进入此等级</small></label>
            </div>
          </fieldset>

          <fieldset className="membership-growth-dialog__section">
            <legend><span aria-hidden="true">03</span><strong>视觉与说明</strong><small aria-hidden="true">补充前台辨识信息</small></legend>
            <div className="membership-growth-dialog__fields">
              <label htmlFor="growth-dialog-color"><span>主题颜色（可选）</span><div className="membership-growth-dialog__color-control"><span className="membership-growth-dialog__color-swatch" style={previewColor ? { backgroundColor: previewColor } : undefined} aria-hidden="true" /><input id="growth-dialog-color" aria-label="主题颜色（可选）" value={props.value.color ?? ""} placeholder="#1f8f5f" maxLength={7} disabled={props.pending} onChange={(event) => changeColor(event.target.value)} /></div><small>填写 6 位十六进制颜色</small></label>
              <label className="membership-growth-dialog__wide" htmlFor="growth-dialog-description"><span>等级说明（可选）</span><textarea id="growth-dialog-description" aria-label="等级说明（可选）" value={props.value.description} maxLength={500} rows={3} placeholder="简要说明这个等级的成长阶段" disabled={props.pending} onChange={(event) => props.onChange({ description: event.target.value })} /></label>
            </div>
          </fieldset>
        </div>

        {props.error && <p className="form-alert" role="alert">{props.error}</p>}
        {props.conflict && props.onRefresh && <RevisionConflictNotice onRefresh={props.onRefresh} />}
        <div className="membership-growth-form-actions">
          <p><CircleCheck size={16} aria-hidden="true" /><span><strong>{isCreate ? "创建后立即生效" : "保存后立即生效"}</strong><small>前台等级计算将使用最新设置</small></span></p>
          <div>
            <button className="secondary-button" type="button" disabled={props.pending} onClick={props.onClose}>取消</button>
            <button className="primary-button" type="submit" disabled={props.pending}>{props.pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : isCreate ? <Plus size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}{isCreate ? "创建并生效" : "保存更改"}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
