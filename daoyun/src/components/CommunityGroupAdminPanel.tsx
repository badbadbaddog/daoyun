import { HardDriveUpload, LoaderCircle, Pencil, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"

import { AdminApiError, listAdminCommunityGroups, setAdminDefaultCommunityGroup, updateAdminCommunityGroup } from "../api/admin"
import type { AdminCommunityGroup } from "../api/admin"
import { CommunityGroupMembershipManager } from "./CommunityGroupMembershipManager"
import { CommunityGroupQuotaDialog, type CommunityGroupQuotaDraft } from "./CommunityGroupQuotaDialog"

interface CommunityGroupAdminPanelProps {
  csrfToken: string
  canWrite: boolean
  canReadMemberships?: boolean
  canWriteMemberships?: boolean
  canReadUsers?: boolean
}

const bytesPerMegabyte = 1024 * 1024

export function CommunityGroupAdminPanel({ csrfToken, canWrite, canReadMemberships = false, canWriteMemberships = false, canReadUsers = false }: CommunityGroupAdminPanelProps) {
  const [groups, setGroups] = useState<AdminCommunityGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [defaultGroupId, setDefaultGroupId] = useState("")
  const [defaultError, setDefaultError] = useState("")
  const [defaultSaving, setDefaultSaving] = useState(false)
  const [editing, setEditing] = useState<AdminCommunityGroup | null>(null)
  const [draft, setDraft] = useState<CommunityGroupQuotaDraft>(emptyQuotaDraft)
  const [saving, setSaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void loadGroups(controller.signal)
    return () => controller.abort()
  }, [])

  async function loadGroups(signal?: AbortSignal) {
    setLoading(true)
    setError("")
    try {
      const loadedGroups = sortGroups(await listAdminCommunityGroups(signal))
      setGroups(loadedGroups)
      setDefaultGroupId(loadedGroups.find((group) => group.isDefault)?.id ?? "")
    } catch (reason) {
      if (signal?.aborted) return
      setError(reason instanceof AdminApiError ? reason.message : "用户组读取失败，请稍后重试。")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  async function saveDefaultGroup(event: FormEvent) {
    event.preventDefault()
    const currentDefault = groups.find((group) => group.isDefault)
    if (!canWrite || !currentDefault || !defaultGroupId || defaultGroupId === currentDefault.id || defaultSaving) return
    setDefaultSaving(true)
    setDefaultError("")
    setMessage("")
    try {
      await setAdminDefaultCommunityGroup(defaultGroupId, currentDefault.id, currentDefault.revision, csrfToken)
      const loadedGroups = sortGroups(await listAdminCommunityGroups())
      setGroups(loadedGroups)
      setDefaultGroupId(loadedGroups.find((group) => group.isDefault)?.id ?? "")
      setMessage("新用户默认组已更新")
    } catch (reason) {
      setDefaultError(reason instanceof AdminApiError ? reason.message : "默认用户组保存失败，请稍后重试。")
    } finally {
      setDefaultSaving(false)
    }
  }

  function openEditor(group: AdminCommunityGroup, trigger: HTMLButtonElement) {
    triggerRef.current = trigger
    setEditing(group)
    setDraft(toQuotaDraft(group))
    setError("")
    setMessage("")
  }

  function closeEditor() {
    if (saving) return
    setEditing(null)
    setError("")
    queueMicrotask(() => triggerRef.current?.focus())
  }

  async function saveQuotas(event: FormEvent) {
    event.preventDefault()
    if (!editing || !canWrite) return
    const quotaPatch = parseQuotaDraft(draft)
    if (!quotaPatch) {
      setError("额度必须是有效整数，单文件不超过 50 MB，且总空间不能小于单文件大小。")
      return
    }
    setSaving(true)
    setError("")
    try {
      const updated = await updateAdminCommunityGroup(editing.id, {
        expectedRevision: editing.revision,
        displayName: editing.displayName,
        description: editing.description,
        displayOrder: editing.displayOrder,
        status: editing.status,
        permissionKeys: editing.permissionKeys,
        quotas: { ...editing.quotas, ...quotaPatch },
      }, csrfToken)
      setGroups((current) => sortGroups(current.map((group) => group.id === updated.id ? updated : group)))
      setEditing(null)
      setMessage("附件额度已保存")
      queueMicrotask(() => triggerRef.current?.focus())
    } catch (reason) {
      setError(reason instanceof AdminApiError ? reason.message : "附件额度保存失败，请稍后重试。")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="community-group-panel" inert={editing ? true : undefined} aria-hidden={editing ? "true" : undefined}>
        <div className="admin-form__heading membership-section-heading"><div><h3>用户组设置</h3><p>配置新用户默认基础组，并维护各组附件额度。</p></div><UsersRound size={18} aria-hidden="true" /></div>
        {!loading && groups.length > 0 && <DefaultGroupSetting groups={groups} value={defaultGroupId} canWrite={canWrite} pending={defaultSaving} error={defaultError} onChange={(value) => { setDefaultGroupId(value); setDefaultError(""); setMessage("") }} onSubmit={(event) => void saveDefaultGroup(event)} />}
        <div className="community-group-admin-note"><ShieldCheck size={16} aria-hidden="true" /><span>基础组是账号的主要社区身份；附加组叠加权限与额度。超级管理员不受附件业务额度限制。</span></div>
        {loading ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /><span>正在读取用户组</span></div> : error && !editing ? <div className="admin-state" role="alert"><span>{error}</span><button className="secondary-button" type="button" onClick={() => void loadGroups()}>重新加载</button></div> : groups.length === 0 ? <div className="admin-empty" role="status"><UsersRound size={20} aria-hidden="true" /><span>尚未配置用户组</span></div> : <ul className="community-group-list" aria-label="用户组列表">
          {groups.map((group) => <li className="community-group-row" key={group.id}>
            <header><span className="community-group-row__mark" aria-hidden="true">{group.isBase ? "基" : "附"}</span><div><strong>{group.displayName}{group.isDefault && <span className="community-group-default-badge">注册默认</span>}</strong><small>{group.internalKey}</small></div></header>
            <div className="community-group-row__quota"><HardDriveUpload size={15} aria-hidden="true" /><span>每日 {quota(group, "attachment.upload.daily").toLocaleString("zh-CN")} 张</span><span>单张 {formatMegabytes(quota(group, "attachment.file.bytes"))}</span></div>
            <div className="community-group-row__quota community-group-row__quota--secondary"><span>空间 {formatMegabytes(quota(group, "attachment.storage.bytes"))}</span><span>下载 {formatMegabytes(quota(group, "attachment.download.bytes.daily"))} / 天</span></div>
            {canWrite ? <button className="secondary-button" type="button" aria-haspopup="dialog" aria-label={`配置${group.displayName}的附件额度`} onClick={(event) => openEditor(group, event.currentTarget)}><Pencil size={13} aria-hidden="true" />配置额度</button> : <small className="community-group-row__readonly">仅可查看</small>}
          </li>)}
        </ul>}
        {!canWrite && !loading && <p className="community-group-readonly"><ShieldCheck size={14} aria-hidden="true" />仅可查看用户组与附件额度</p>}
        {message && <p className="admin-success" role="status">{message}</p>}
        {canReadMemberships && canReadUsers && !loading && !error && <CommunityGroupMembershipManager groups={groups} csrfToken={csrfToken} canWrite={canWriteMemberships} />}
      </div>
      {editing && <CommunityGroupQuotaDialog group={editing} value={draft} pending={saving} error={error} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} onClose={closeEditor} onSubmit={(event) => void saveQuotas(event)} />}
    </>
  )
}

interface DefaultGroupSettingProps {
  groups: AdminCommunityGroup[]
  value: string
  canWrite: boolean
  pending: boolean
  error: string
  onChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}

function DefaultGroupSetting({ groups, value, canWrite, pending, error, onChange, onSubmit }: DefaultGroupSettingProps) {
  const currentDefault = groups.find((group) => group.isDefault)
  const eligibleGroups = groups.filter((group) => group.isBase && group.status === "active")
  return <section className="community-default-group" role="region" aria-labelledby="community-default-group-heading">
    <div className="community-default-group__copy">
      <UserRoundCheck size={18} aria-hidden="true" />
      <div><h4 id="community-default-group-heading">新用户默认用户组</h4><p>仅影响之后注册的新用户，不会迁移现有用户。</p></div>
      {currentDefault && <span className="community-default-group__current">当前：{currentDefault.displayName}</span>}
    </div>
    {canWrite ? <form className="community-default-group__form" onSubmit={onSubmit}>
      <label htmlFor="community-default-group-select"><span>默认用户组</span><select id="community-default-group-select" aria-label="默认用户组" value={value} onChange={(event) => onChange(event.target.value)} disabled={pending || eligibleGroups.length === 0}>{eligibleGroups.length === 0 ? <option value="">没有可用的基础组</option> : eligibleGroups.map((group) => <option key={group.id} value={group.id}>{group.displayName} · {group.internalKey}</option>)}</select></label>
      <button className="primary-button" type="submit" disabled={pending || !currentDefault || !value || value === currentDefault.id}>{pending && <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />}保存默认组</button>
    </form> : <div className="community-default-group__readonly"><ShieldCheck size={14} aria-hidden="true" /><span>{currentDefault ? `${currentDefault.displayName}（${currentDefault.internalKey}）` : "尚未配置默认基础组"}</span></div>}
    {error && <p className="form-alert" role="alert">{error}</p>}
  </section>
}

function toQuotaDraft(group: AdminCommunityGroup): CommunityGroupQuotaDraft {
  return {
    uploadDaily: String(quota(group, "attachment.upload.daily")),
    fileMegabytes: String(toMegabytes(quota(group, "attachment.file.bytes"))),
    storageMegabytes: String(toMegabytes(quota(group, "attachment.storage.bytes"))),
    downloadMegabytesDaily: String(toMegabytes(quota(group, "attachment.download.bytes.daily"))),
  }
}

function parseQuotaDraft(value: CommunityGroupQuotaDraft): Record<string, number> | null {
  const uploadDaily = parseInteger(value.uploadDaily, 10_000)
  const fileMegabytes = parseInteger(value.fileMegabytes, 50)
  const storageMegabytes = parseInteger(value.storageMegabytes, 1_048_576)
  const downloadMegabytesDaily = parseInteger(value.downloadMegabytesDaily, 1_048_576)
  if (uploadDaily === null || fileMegabytes === null || storageMegabytes === null || downloadMegabytesDaily === null || storageMegabytes < fileMegabytes) return null
  return {
    "attachment.upload.daily": uploadDaily,
    "attachment.file.bytes": fileMegabytes * bytesPerMegabyte,
    "attachment.storage.bytes": storageMegabytes * bytesPerMegabyte,
    "attachment.download.bytes.daily": downloadMegabytesDaily * bytesPerMegabyte,
  }
}

function parseInteger(value: string, maximum: number): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null
}

function quota(group: AdminCommunityGroup, key: string): number {
  return group.quotas[key] ?? 0
}

function toMegabytes(bytes: number): number {
  return Math.round(bytes / bytesPerMegabyte)
}

function formatMegabytes(bytes: number): string {
  return `${toMegabytes(bytes).toLocaleString("zh-CN")} MB`
}

function sortGroups(groups: AdminCommunityGroup[]): AdminCommunityGroup[] {
  return [...groups].sort((left, right) => left.displayOrder - right.displayOrder || left.internalKey.localeCompare(right.internalKey))
}

const emptyQuotaDraft: CommunityGroupQuotaDraft = { uploadDaily: "", fileMegabytes: "", storageMegabytes: "", downloadMegabytesDaily: "" }
