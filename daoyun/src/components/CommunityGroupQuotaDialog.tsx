import { LoaderCircle, Save, ShieldCheck, UsersRound, X } from "lucide-react"
import { useEffect, useId, useRef, useState, type FormEvent } from "react"

import type { AdminCommunityGroup, CommunityGroupStatus } from "../api/admin"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"
import { RelatedAuditLog } from "./RelatedAuditLog"
import { ModalDialog } from "./ui/ModalDialog"
import { communityPermissionKeys, communityGroupQuotaKeys as communityQuotaKeys, formatCommunityQuota, isByteQuota, parseQuotaInput, permissionLabels } from "./communityGroupRules"

export { communityPermissionKeys, communityQuotaKeys, permissionLabels } from "./communityGroupRules"

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
  fieldErrors?: Record<string, string>
  conflict?: boolean
  preview: boolean
  canReadAudit?: boolean
  canReadUsers?: boolean
  onBack: () => void
  onRefresh?: () => void
  onChange: (patch: Partial<CommunityGroupDraft>) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}

const emptyFieldErrors: Record<string, string> = {}

export function CommunityGroupEditorDialog({ group, value, pending, error, fieldErrors = emptyFieldErrors, conflict = false, preview, canReadAudit = false, canReadUsers = false, onBack, onRefresh, onChange, onClose, onSubmit }: CommunityGroupEditorDialogProps) {
  const errorId = "community-group-error-" + useId().replaceAll(":", "")
  const errorRef = useRef<HTMLParagraphElement>(null)
  const handledError = useRef<{ fields: Record<string, string>; message: string } | null>(null)
  const firstError = Object.keys(fieldErrors)[0]
  const [section, setSection] = useState("基本信息")
  const bodyRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const wasPreview = useRef(false)
  const readOnly = group?.status === "archived"
  const disabled = pending || readOnly
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    if (preview) backRef.current?.focus()
    else if (wasPreview.current) submitRef.current?.focus()
    wasPreview.current = preview
  }, [preview, section])
  useEffect(() => {
    if (!error || preview || (handledError.current?.fields === fieldErrors && handledError.current.message === error)) return
    if (!firstError) { errorRef.current?.focus(); handledError.current = { fields: fieldErrors, message: error }; return }
    const targetSection = firstError.includes(".") ? "使用额度" : "基本信息"
    if (section !== targetSection) { setSection(targetSection); return }
    const field = bodyRef.current?.querySelector<HTMLElement>('[data-field="' + firstError + '"]')
    field?.closest("details")?.setAttribute("open", "")
    field?.focus()
    field?.scrollIntoView?.({ block: "nearest" })
    handledError.current = { fields: fieldErrors, message: error }
  }, [error, fieldErrors, firstError, preview, section])
  function fieldProps(key: string) { return { "data-field": key, "aria-invalid": fieldErrors[key] ? true : undefined, "aria-describedby": fieldErrors[key] ? errorId + "-" + key : undefined } }
  function fieldError(key: string) { return fieldErrors[key] ? <small className="form-alert" id={errorId + "-" + key}>{fieldErrors[key]}</small> : null }
  function togglePermission(key: string, checked: boolean) { onChange({ permissionKeys: checked ? [...value.permissionKeys, key].sort() : value.permissionKeys.filter(item => item !== key) }) }
  const sections = ["基本信息", "社区权限", "审核要求", "使用额度", ...(group ? ["成员", "变更记录"] : [])]

  return <ModalDialog element="form" noValidate className="community-group-editor" describedBy={error ? errorId : undefined} titleId="community-group-editor-title" busy={pending} onClose={onClose} onSubmit={onSubmit} initialFocusSelector={readOnly ? "button" : 'input[aria-label="显示名称"]'}>
    <header className="community-group-editor__header"><span className="community-group-editor__icon"><UsersRound size={22} aria-hidden="true" /></span><div><h3 id="community-group-editor-title">{group ? "编辑用户组" : "创建用户组"}</h3><p>{group ? group.displayName + " · " + (group.isBase ? "基础组" : "附加组") : "设置成员身份、可用权限与使用额度"}</p></div><button className="icon-button" type="button" aria-label="关闭用户组编辑" title="关闭用户组编辑" disabled={pending} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    {!preview && <div className="community-group-editor__nav" role="group" aria-label="用户组编辑区域">{sections.map(name => <button key={name} type="button" disabled={pending} aria-pressed={section === name} onClick={() => setSection(name)}>{name}</button>)}</div>}
    <div ref={bodyRef} className="community-group-editor__body">
      {readOnly && <p className="community-group-editor__hint">该用户组已归档，仅可查看，无法恢复或修改。</p>}
      {preview ? <GroupChangePreview group={group} value={value} /> : <>
        {section === "基本信息" && <section aria-label="基本信息">
          <div className="community-group-editor__fields">
            <label>显示名称<input {...fieldProps("displayName")} aria-label="显示名称" value={value.displayName} maxLength={80} disabled={disabled} placeholder="例如：社区贡献者" onChange={event => onChange({ displayName: event.target.value })} />{fieldError("displayName")}</label>
            <details className="community-group-editor__wide"><summary>高级标识</summary><label>内部键<input {...fieldProps("internalKey")} aria-label="内部键" value={value.internalKey} readOnly disabled={disabled} />{fieldError("internalKey")}<small>自动生成，创建后不可更改；同名用户组以独立标识区分。</small></label>{group && <small>用户组 ID：{group.id}</small>}</details>
            <label className="community-group-editor__wide">说明<textarea aria-label="用户组说明" value={value.description} maxLength={500} disabled={disabled} placeholder="描述该用户组适用的成员与用途" onChange={event => onChange({ description: event.target.value })} /></label>
            <label>显示顺序<input {...fieldProps("displayOrder")} aria-label="显示顺序" type="number" min={1} max={1000000} value={value.displayOrder} disabled={disabled} onChange={event => onChange({ displayOrder: event.target.value })} />{fieldError("displayOrder")}<small>数字越小，排列越靠前</small></label>
            <label>状态<select aria-label="用户组状态" value={value.status} disabled={disabled || !group || group.isDefault} onChange={event => onChange({ status: event.target.value as CommunityGroupStatus })}><option value="active">启用</option><option value="disabled">停用</option>{readOnly && <option value="archived">已归档</option>}</select><small>{group?.isDefault ? "默认基础组须保持启用" : "停用后暂停提供权限与额度，可重新启用"}</small></label>
          </div>
          <label className="community-group-editor__type"><input type="checkbox" checked={value.isBase} disabled={disabled || Boolean(group)} onChange={event => onChange({ isBase: event.target.checked })} /><span><strong>基础组（否则为附加组）</strong><small>基础组代表主要社区身份，附加组用于叠加权限与额度。创建后不可更改类型。</small></span></label>
          <p className="community-group-editor__hint">不再使用时可以停用，需要时重新启用。成员关系与历史记录会保留。</p>
        </section>}
        {section === "社区权限" && <section aria-label="社区权限"><div className="community-group-editor__section-heading"><h4>本组提供的能力</h4><span>已选 {value.permissionKeys.filter(key => key !== "content.pre_moderation.required").length} 项</span></div><p className="community-group-editor__description">未选择表示本组不提供该能力；用户仍可能从其他组或有效权益获得。后台管理能力在“角色与权限”设置。</p><div className="community-group-editor__permissions">{communityPermissionKeys.filter(key => key !== "content.pre_moderation.required").map(key => <label key={key}><input type="checkbox" aria-label={permissionLabels[key]} checked={value.permissionKeys.includes(key)} disabled={disabled} onChange={event => togglePermission(key, event.target.checked)} /><span>{permissionLabels[key]}<small>{value.permissionKeys.includes(key) ? "本组提供" : "本组不提供"}</small></span></label>)}</div></section>}
        {section === "审核要求" && <section aria-label="审核要求"><h4>发布前审核</h4><div className="community-group-editor__permissions"><label><input type="checkbox" aria-label="发布内容需要审核" checked={value.permissionKeys.includes("content.pre_moderation.required")} disabled={disabled} onChange={event => togglePermission("content.pre_moderation.required", event.target.checked)} /><span>发布内容需要审核</span></label></div><p className="community-group-editor__hint"><ShieldCheck size={16} aria-hidden="true" />这是对本组成员的审核要求；取消此项也不会取消其他来源施加的审核要求。</p></section>}
        {section === "使用额度" && <section aria-label="使用额度"><div className="community-group-editor__section-heading"><h4>设置使用上限</h4><span>{communityQuotaKeys.length} 项额度</span></div><p className="community-group-editor__description">0 表示本组不提供对应额度。数量填写非负整数；MiB 可填写小数，须精确到字节。存储空间须不小于单文件上限。</p><div className="community-group-editor__fields">{communityQuotaKeys.map(({ key, label, maximum }) => <label key={key}>{label}<input {...fieldProps(key)} aria-label={label} type="number" min={0} step={isByteQuota(key) ? "any" : 1} max={isByteQuota(key) ? maximum / 1048576 : maximum} value={value.quotas[key] ?? "0"} disabled={disabled} onChange={event => onChange({ quotas: { ...value.quotas, [key]: event.target.value } })} />{fieldError(key)}{isByteQuota(key) && <small>1 MiB = 1,048,576 字节；0 为无额度</small>}</label>)}</div></section>}
        {section === "成员" && group && <section aria-label="成员摘要"><h4>成员与引用</h4><p>{group.memberCount === undefined ? "成员统计暂不可用" : group.memberCount + " 位成员"}</p><p>{group.expiringMemberCount === undefined ? "到期统计暂不可用" : group.expiringMemberCount + " 位即将到期"}</p><p>{group.accessPolicyReferenceCount === undefined ? "引用统计暂不可用" : group.accessPolicyReferenceCount + " 个访问策略引用"}</p><p>在用户详情的“用户组”页查看、授予或撤销该用户的身份。</p>{canReadUsers && <a className="secondary-button" href="#admin/users">打开用户列表</a>}</section>}
        {section === "变更记录" && group && <section aria-label="变更记录"><p>当前修订 {group.revision} · 更新时间 {new Date(group.updatedAt).toLocaleString("zh-CN", { hour12: false })}</p>{canReadAudit ? <RelatedAuditLog filter={{ resourceId: group.id }} title="用户组操作记录" /> : <p>当前账号没有审计读取权限。</p>}</section>}
      </>}
    </div>
    <footer className="community-group-editor__footer">
      {error && <p ref={errorRef} id={errorId} tabIndex={-1} className="form-alert" role="alert">{error}</p>}
      {conflict && onRefresh && <RevisionConflictNotice onRefresh={onRefresh} />}
      <div><span>{preview ? "确认后保存" : "先预览，再保存"}</span>{preview && <button ref={backRef} className="secondary-button" type="button" disabled={pending} onClick={onBack}>返回编辑</button>}<button className="secondary-button" type="button" disabled={pending} onClick={onClose}>取消</button><button ref={submitRef} className="primary-button" type="submit" disabled={disabled}>{pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}{preview ? group ? "确认保存" : "确认创建" : group ? "保存用户组" : "创建用户组"}</button></div>
    </footer>
  </ModalDialog>
}

function GroupChangePreview({ group, value }: { group: AdminCommunityGroup | null; value: CommunityGroupDraft }) {
  const statusLabel = (status: CommunityGroupStatus) => status === "active" ? "启用" : status === "disabled" ? "停用" : "已归档"
  const rows: [string, string, string][] = [
    ["显示名称", group?.displayName ?? "—", value.displayName.trim()],
    ["说明", group?.description || "无", value.description.trim() || "无"],
    ["身份类型", group ? group.isBase ? "基础组" : "附加组" : "—", value.isBase ? "基础组" : "附加组"],
    ["显示顺序", group ? String(group.displayOrder) : "—", String(Number(value.displayOrder))],
    ["状态", group ? statusLabel(group.status) : "—", statusLabel(value.status)],
    ...communityPermissionKeys.map(key => {
      const label = (provided: boolean) => key === "content.pre_moderation.required" ? provided ? "需要审核" : "本组无审核要求" : provided ? "本组提供" : "本组不提供"
      return [permissionLabels[key], label(group?.permissionKeys.includes(key) ?? false), label(value.permissionKeys.includes(key))] as [string, string, string]
    }),
    ...communityQuotaKeys.map(({ key, label }) => [label, formatCommunityQuota(key, group?.quotas[key] ?? 0), formatCommunityQuota(key, parseQuotaInput(key, value.quotas[key]) ?? 0)] as [string, string, string]),
  ]
  const changes = rows.filter(row => !group || row[1] !== row[2])
  return <section aria-label="保存前变更预览"><h4>保存前变更预览</h4><p>{group ? "基于修订 " + group.revision + "；服务端将检查该版本。" : "创建独立用户组；不复制成员、历史记录或管理角色。"}</p><details><summary>高级标识</summary><small>内部键：{value.internalKey}</small>{group && <small>用户组 ID：{group.id}</small>}</details><div className="community-group-table-scroll" tabIndex={0} role="region" aria-label="变更表格"><table aria-label="用户组变更"><thead><tr><th scope="col">配置</th><th scope="col">保存前</th><th scope="col">确认后</th></tr></thead><tbody>{changes.map(([label, before, after]) => <tr key={label}><th scope="row">{label}</th><td>{before}</td><td>{after}</td></tr>)}</tbody></table></div>{changes.length === 0 && <p>没有配置变化。</p>}<p className="community-group-editor__hint">移除本组能力不代表用户必然失去能力；具体结果须结合该用户的其他身份、权益和限制。</p></section>
}
