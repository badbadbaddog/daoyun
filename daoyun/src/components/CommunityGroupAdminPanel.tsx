import { Archive, LoaderCircle, Pencil, Plus, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"

import { AdminApiError, createAdminCommunityGroup, listAdminCommunityGroups, setAdminDefaultCommunityGroup, updateAdminCommunityGroup, type AdminCommunityGroup } from "../api/admin"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"
import { CommunityGroupMembershipManager } from "./CommunityGroupMembershipManager"
import { CommunityGroupEditorDialog, communityQuotaKeys, type CommunityGroupDraft } from "./CommunityGroupQuotaDialog"

interface CommunityGroupAdminPanelProps { csrfToken: string; canWrite: boolean; canReadMemberships?: boolean; canWriteMemberships?: boolean; canReadUsers?: boolean }

export function CommunityGroupAdminPanel({ csrfToken, canWrite, canReadMemberships = false, canWriteMemberships = false, canReadUsers = false }: CommunityGroupAdminPanelProps) {
  const [groups, setGroups] = useState<AdminCommunityGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [defaultGroupId, setDefaultGroupId] = useState("")
  const [defaultError, setDefaultError] = useState("")
  const [defaultSaving, setDefaultSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminCommunityGroup | null>(null)
  const [draft, setDraft] = useState<CommunityGroupDraft>(emptyDraft())
  const [archiveTarget, setArchiveTarget] = useState<AdminCommunityGroup | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => { const controller = new AbortController(); void loadGroups(controller.signal); return () => controller.abort() }, [])

  async function loadGroups(signal?: AbortSignal) {
    setLoading(true); setError(""); setConflict(false)
    try { const result = sortGroups(await listAdminCommunityGroups(signal)); setGroups(result); setDefaultGroupId(result.find((group) => group.isDefault)?.id ?? "") }
    catch (reason) { if (!signal?.aborted) setError(apiMessage(reason, "用户组读取失败，请稍后重试。")) }
    finally { if (!signal?.aborted) setLoading(false) }
  }

  async function saveDefaultGroup(event: FormEvent) {
    event.preventDefault(); const currentDefault = groups.find((group) => group.isDefault)
    if (!canWrite || !currentDefault || !defaultGroupId || defaultGroupId === currentDefault.id || defaultSaving) return
    setDefaultSaving(true); setDefaultError(""); setMessage("")
    try { await setAdminDefaultCommunityGroup(defaultGroupId, currentDefault.id, currentDefault.revision, csrfToken); await loadGroups(); setMessage("新用户默认组已更新") }
    catch (reason) { setDefaultError(apiMessage(reason, "默认用户组保存失败，请稍后重试。")) }
    finally { setDefaultSaving(false) }
  }

  function openEditor(group: AdminCommunityGroup | null, trigger: HTMLButtonElement) {
    triggerRef.current = trigger; setEditing(group); setDraft(group ? toDraft(group) : emptyDraft(nextDisplayOrder(groups))); setEditorOpen(true); setError(""); setMessage(""); setConflict(false)
  }
  function closeOverlay() { if (saving) return; setEditorOpen(false); setArchiveTarget(null); setEditing(null); setError(""); setConflict(false); queueMicrotask(() => triggerRef.current?.focus()) }

  async function saveGroup(event: FormEvent) {
    event.preventDefault(); if (!canWrite) return
    const input = parseDraft(draft)
    if (!input) { setError("请检查内部键、名称、排序、权限与全部额度；额度必须是非负安全整数，存储空间不得小于单文件大小。"); return }
    setSaving(true); setError(""); setConflict(false)
    try {
      const saved = editing ? await updateAdminCommunityGroup(editing.id, { expectedRevision: editing.revision, displayName: input.displayName, description: input.description, displayOrder: input.displayOrder, status: input.status, permissionKeys: input.permissionKeys, quotas: input.quotas }, csrfToken) : await createAdminCommunityGroup(input, csrfToken)
      setGroups((current) => sortGroups([...current.filter((group) => group.id !== saved.id), saved])); setEditorOpen(false); setEditing(null); setMessage(`${saved.displayName}${editing ? "已保存" : "已创建"}`); queueMicrotask(() => triggerRef.current?.focus())
    } catch (reason) { setConflict(reason instanceof AdminApiError && reason.status === 409); setError(apiMessage(reason, "用户组保存失败，请稍后重试。")) }
    finally { setSaving(false) }
  }

  async function archiveGroup() {
    if (!archiveTarget || archiveTarget.isDefault || saving) return
    const target = archiveTarget; setSaving(true); setError(""); setConflict(false)
    try {
      const saved = await updateAdminCommunityGroup(target.id, { expectedRevision: target.revision, displayName: target.displayName, description: target.description, displayOrder: target.displayOrder, status: "archived", permissionKeys: target.permissionKeys, quotas: target.quotas }, csrfToken)
      setGroups((current) => sortGroups(current.map((group) => group.id === saved.id ? saved : group))); setArchiveTarget(null); setMessage(`${target.displayName}已归档；成员关系和访问策略引用历史保留`); queueMicrotask(() => triggerRef.current?.focus())
    } catch (reason) { setConflict(reason instanceof AdminApiError && reason.status === 409); setError(apiMessage(reason, "用户组归档失败，请稍后重试。")) }
    finally { setSaving(false) }
  }

  const overlayOpen = editorOpen || Boolean(archiveTarget)
  return <>
    <div className="community-group-panel" inert={overlayOpen ? true : undefined} aria-hidden={overlayOpen ? "true" : undefined}>
      <div className="admin-form__heading membership-section-heading"><div><h3>用户组设置</h3><p>创建与维护基础/附加组、权限、全部额度、排序、状态和归档影响。</p></div>{canWrite && <button className="primary-button" type="button" aria-haspopup="dialog" onClick={(event) => openEditor(null, event.currentTarget)}><Plus size={14} aria-hidden="true" />创建用户组</button>}</div>
      {!loading && groups.length > 0 && <DefaultGroupSetting groups={groups} value={defaultGroupId} canWrite={canWrite} pending={defaultSaving} error={defaultError} onChange={(value) => { setDefaultGroupId(value); setDefaultError(""); setMessage("") }} onSubmit={(event) => void saveDefaultGroup(event)} />}
      <div className="community-group-admin-note"><ShieldCheck size={16} aria-hidden="true" /><span>基础组是账号主要社区身份；附加组叠加社区权限与额度。用户组与 VIP 标准权益、治理角色互相独立。</span></div>
      {loading ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" />正在读取用户组</div> : error && !overlayOpen ? <div className="admin-state" role="alert"><span>{error}</span><button className="secondary-button" type="button" onClick={() => void loadGroups()}>重新加载</button></div> : groups.length === 0 ? <div className="admin-empty" role="status">尚未配置用户组</div> : <ul className="community-group-list" aria-label="用户组列表">{groups.map((group) => <li className="community-group-row" key={group.id}>
        <header><span className="community-group-row__mark" aria-hidden="true">{group.isBase ? "基" : "附"}</span><div><strong>{group.displayName}{group.isDefault && <span className="community-group-default-badge">注册默认</span>}</strong><small>{group.internalKey} · 排序 {group.displayOrder} · {statusLabel(group.status)}</small></div></header>
        <div className="community-group-row__quota"><span>{group.permissionKeys.length} 项社区权限</span><span>{Object.keys(group.quotas).length} 项额度</span></div>
        <div className="community-group-row__impact"><span>{group.memberCount ?? 0} 位成员</span><span>{group.expiringMemberCount ?? 0} 位即将到期</span><span>{group.accessPolicyReferenceCount ?? 0} 个访问策略引用</span></div>
        {canWrite ? <div className="community-group-row__actions"><button className="secondary-button" type="button" aria-haspopup="dialog" aria-label={`编辑${group.displayName}`} onClick={(event) => openEditor(group, event.currentTarget)}><Pencil size={13} aria-hidden="true" />编辑</button><button className="danger-button" type="button" aria-haspopup="dialog" aria-label={`归档${group.displayName}`} disabled={group.isDefault || group.status === "archived"} onClick={(event) => { triggerRef.current = event.currentTarget; setArchiveTarget(group); setError(""); setConflict(false) }}><Archive size={13} aria-hidden="true" />归档</button>{group.isDefault && <small>默认基础组不可归档</small>}</div> : <small className="community-group-row__readonly">仅可查看</small>}
      </li>)}</ul>}
      {!canWrite && !loading && <p className="community-group-readonly">仅可查看用户组、权限与额度</p>}{message && <p className="admin-success" role="status">{message}</p>}
      {canReadMemberships && canReadUsers && !loading && !error && <CommunityGroupMembershipManager groups={groups} csrfToken={csrfToken} canWrite={canWriteMemberships} />}
    </div>
    {editorOpen && <CommunityGroupEditorDialog group={editing} value={draft} pending={saving} error={error} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} onClose={closeOverlay} onSubmit={(event) => void saveGroup(event)} />}
    {archiveTarget && <div className="dialog-backdrop"><section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="archive-group-heading"><h3 id="archive-group-heading">归档{archiveTarget.displayName}</h3><p>将影响 {archiveTarget.memberCount ?? 0} 位有效成员、{archiveTarget.expiringMemberCount ?? 0} 位即将到期成员，并保留 {archiveTarget.accessPolicyReferenceCount ?? 0} 个访问策略引用供后续调整。</p><p>归档后该组不再参与有效权限与额度计算；历史成员关系、审计记录和策略引用不会删除。</p>{error && <p className="form-alert" role="alert">{error}</p>}{conflict && <RevisionConflictNotice onRefresh={() => void loadGroups()} />}<div><button className="secondary-button" type="button" disabled={saving} onClick={closeOverlay}>取消</button><button className="danger-button" type="button" disabled={saving} onClick={() => void archiveGroup()}>确认归档</button></div></section></div>}
  </>
}

function DefaultGroupSetting({ groups, value, canWrite, pending, error, onChange, onSubmit }: { groups: AdminCommunityGroup[]; value: string; canWrite: boolean; pending: boolean; error: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void }) {
  const current = groups.find((group) => group.isDefault); const eligible = groups.filter((group) => group.isBase && group.status === "active")
  return <section className="community-default-group" role="region" aria-labelledby="community-default-group-heading"><div className="community-default-group__copy"><UserRoundCheck size={18} aria-hidden="true" /><div><h4 id="community-default-group-heading">新用户默认用户组</h4><p>仅影响之后注册的新用户，不会迁移现有用户。</p></div>{current && <span>当前：{current.displayName}</span>}</div>{canWrite ? <form className="community-default-group__form" onSubmit={onSubmit}><label>默认用户组<select aria-label="默认用户组" value={value} onChange={(event) => onChange(event.target.value)} disabled={pending}>{eligible.map((group) => <option key={group.id} value={group.id}>{group.displayName} · {group.internalKey}</option>)}</select></label><button className="primary-button" type="submit" disabled={pending || !current || !value || value === current.id}>{pending && <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />}保存默认组</button></form> : <span>{current?.displayName ?? "尚未配置"}</span>}{error && <p className="form-alert" role="alert">{error}</p>}</section>
}

function emptyDraft(displayOrder = 10): CommunityGroupDraft { return { internalKey: "", displayName: "", description: "", isBase: false, displayOrder: String(displayOrder), status: "active", permissionKeys: [], quotas: Object.fromEntries(communityQuotaKeys.map(({ key }) => [key, "0"])) } }
function toDraft(group: AdminCommunityGroup): CommunityGroupDraft { return { internalKey: group.internalKey, displayName: group.displayName, description: group.description, isBase: group.isBase, displayOrder: String(group.displayOrder), status: group.status, permissionKeys: [...group.permissionKeys], quotas: Object.fromEntries(communityQuotaKeys.map(({ key }) => [key, String(group.quotas[key] ?? 0)])) } }
function parseDraft(value: CommunityGroupDraft) {
  const displayOrder = Number(value.displayOrder); if (!/^[a-z][a-z0-9_]{2,63}$/.test(value.internalKey.trim()) || !value.displayName.trim() || !Number.isSafeInteger(displayOrder) || displayOrder < 0) return null
  const quotas: Record<string, number> = {}; for (const { key } of communityQuotaKeys) { const quota = Number(value.quotas[key]); if (!Number.isSafeInteger(quota) || quota < 0) return null; quotas[key] = quota }
  if (quotas["attachment.storage.bytes"] < quotas["attachment.file.bytes"]) return null
  return { internalKey: value.internalKey.trim(), displayName: value.displayName.trim(), description: value.description.trim(), isBase: value.isBase, displayOrder, status: value.status, permissionKeys: [...new Set(value.permissionKeys)].sort(), quotas }
}
function nextDisplayOrder(groups: AdminCommunityGroup[]): number { return Math.max(0, ...groups.map((group) => group.displayOrder)) + 10 }
function sortGroups(groups: AdminCommunityGroup[]): AdminCommunityGroup[] { return [...groups].sort((left, right) => left.displayOrder - right.displayOrder || left.internalKey.localeCompare(right.internalKey)) }
function statusLabel(status: AdminCommunityGroup["status"]): string { return status === "active" ? "启用" : status === "disabled" ? "停用" : "已归档" }
function apiMessage(reason: unknown, fallback: string): string { return reason instanceof AdminApiError ? reason.message : fallback }
