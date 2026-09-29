import { LoaderCircle, Save, ShieldCheck, UsersRound, X } from "lucide-react"
import { useState, type FormEvent } from "react"

import type { AdminCommunityGroup, CommunityGroupStatus } from "../api/admin"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"
import { ModalDialog } from "./ui/ModalDialog"

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

export function CommunityGroupEditorDialog({ group, value, pending, error, conflict = false, onRefresh, onChange, onClose, onSubmit }: CommunityGroupEditorDialogProps) {
  const [section, setSection] = useState("基本信息")
  const readOnly = group?.status === "archived"
  const disabled = pending || readOnly
  function togglePermission(key: string, checked: boolean) { onChange({ permissionKeys: checked ? [...value.permissionKeys, key].sort() : value.permissionKeys.filter((item) => item !== key) }) }

  return <ModalDialog element="form" className="community-group-editor" titleId="community-group-editor-title" busy={pending} onClose={onClose} onSubmit={onSubmit} initialFocusSelector={readOnly ? "button" : group ? 'input[aria-label="显示名称"]' : 'input[aria-label="内部键"]'}>
    <header className="community-group-editor__header"><span className="community-group-editor__icon"><UsersRound size={22} aria-hidden="true" /></span><div><h3 id="community-group-editor-title">{group ? "编辑用户组" : "创建用户组"}</h3><p>{group ? `${group.displayName} · ${group.isBase ? "基础组" : "附加组"}` : "设置成员身份、可用权限与使用额度"}</p></div><button className="icon-button" type="button" aria-label="关闭用户组编辑" title="关闭用户组编辑" disabled={pending} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <div className="community-group-editor__nav" role="group" aria-label="用户组编辑区域">{["基本信息", "社区权限", "使用额度"].map(name => <button key={name} type="button" aria-pressed={section === name} onClick={() => setSection(name)}>{name}</button>)}</div>
    <div className="community-group-editor__body">
      {readOnly && <p className="community-group-editor__hint">该用户组已归档，仅可查看，无法恢复或修改。</p>}
      {section === "基本信息" && <section aria-label="基本信息">
        <div className="community-group-editor__fields">
          <label>显示名称<input aria-label="显示名称" value={value.displayName} maxLength={80} disabled={disabled} placeholder="例如：社区贡献者" onChange={event => onChange({ displayName: event.target.value })} /></label>
          <label>内部键<input aria-label="内部键" value={value.internalKey} readOnly={Boolean(group)} disabled={disabled} placeholder="例如：contributor" onChange={event => onChange({ internalKey: event.target.value })} /><small>{group ? "创建后不可更改" : "3–64 位小写字母、数字或下划线，以字母开头"}</small></label>
          <label className="community-group-editor__wide">说明<textarea aria-label="用户组说明" value={value.description} maxLength={500} disabled={disabled} placeholder="描述该用户组适用的成员与用途" onChange={event => onChange({ description: event.target.value })} /></label>
          <label>显示顺序<input aria-label="显示顺序" type="number" min={1} max={1_000_000} value={value.displayOrder} disabled={disabled} onChange={event => onChange({ displayOrder: event.target.value })} /><small>数字越小，排列越靠前</small></label>
          <label>状态<select aria-label="用户组状态" value={value.status} disabled={disabled || !group || group.isDefault} onChange={event => onChange({ status: event.target.value as CommunityGroupStatus })}><option value="active">启用</option><option value="disabled">停用</option>{readOnly && <option value="archived">已归档</option>}</select><small>{group?.isDefault ? "默认基础组须保持启用" : "停用后暂停提供权限与额度，可重新启用"}</small></label>
        </div>
        <label className="community-group-editor__type"><input type="checkbox" checked={value.isBase} disabled={disabled || Boolean(group)} onChange={event => onChange({ isBase: event.target.checked })} /><span><strong>基础组（否则为附加组）</strong><small>基础组代表主要社区身份，附加组用于叠加权限与额度。创建后不可更改类型。</small></span></label>
        <p className="community-group-editor__hint">不再使用时可以停用，需要时重新启用。成员关系与历史记录会保留。</p>
      </section>}
      {section === "社区权限" && <section aria-label="社区权限"><div className="community-group-editor__section-heading"><h4>允许成员做什么</h4><span>已选 {value.permissionKeys.length} 项</span></div><p className="community-group-editor__description">仅配置社区行为，后台管理能力请在“角色与权限”中设置。</p><div className="community-group-editor__permissions">{communityPermissionKeys.map(key => <label key={key}><input type="checkbox" aria-label={permissionLabels[key]} checked={value.permissionKeys.includes(key)} disabled={disabled} onChange={event => togglePermission(key, event.target.checked)} /><span>{permissionLabels[key]}</span></label>)}</div><p className="community-group-editor__hint"><ShieldCheck size={16} aria-hidden="true" />“内容须预审”是一项限制：勾选后发布内容需要先审核。</p></section>}
      {section === "使用额度" && <section aria-label="使用额度"><div className="community-group-editor__section-heading"><h4>设置使用上限</h4><span>{communityQuotaKeys.length} 项额度</span></div><p className="community-group-editor__description">填写非负整数；0 表示该组不提供对应额度。存储空间须不小于单文件上限。</p><div className="community-group-editor__fields">{communityQuotaKeys.map(({ key, label, maximum }) => <label key={key}>{label}<input aria-label={label} type="number" min={0} max={maximum} value={value.quotas[key] ?? "0"} disabled={disabled} onChange={event => onChange({ quotas: { ...value.quotas, [key]: event.target.value } })} />{key.includes("bytes") && <small>单位：字节 · 1 MiB = 1,048,576 字节</small>}</label>)}</div></section>}
    </div>
    <footer className="community-group-editor__footer">
      {error && <p className="form-alert" role="alert">{error}</p>}
      {conflict && onRefresh && <RevisionConflictNotice onRefresh={onRefresh} />}
      <div><span>保存后生效</span><button className="secondary-button" type="button" disabled={pending} onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={disabled}>{pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}{group ? "保存用户组" : "创建用户组"}</button></div>
    </footer>
  </ModalDialog>
}

export const communityPermissionKeys = ["board.read", "topic.read", "topic.create", "reply.create", "message.send", "attachment.upload", "attachment.download", "topic.poll.create", "topic.bounty.create", "topic.lottery.join", "content.external_link.use", "profile.signature.use", "content.pre_moderation.required"] as const
export const permissionLabels: Record<typeof communityPermissionKeys[number], string> = {
  "board.read": "浏览版块", "topic.read": "阅读主题", "topic.create": "发布主题", "reply.create": "回复主题",
  "message.send": "发送私信", "attachment.upload": "上传附件", "attachment.download": "下载附件",
  "topic.poll.create": "发起投票", "topic.bounty.create": "发布悬赏", "topic.lottery.join": "参与抽奖",
  "content.external_link.use": "使用外链", "profile.signature.use": "使用个人签名", "content.pre_moderation.required": "内容须预审",
}
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
