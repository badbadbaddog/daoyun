import { Copy, GitCompareArrows, LoaderCircle, Pencil, Plus, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"

import { AdminApiError, createAdminCommunityGroup, listAdminCommunityGroups, setAdminDefaultCommunityGroup, updateAdminCommunityGroup, type AdminCommunityGroup } from "../api/admin"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"
import { CommunityGroupMembershipManager } from "./CommunityGroupMembershipManager"
import { CommunityGroupEditorDialog, type CommunityGroupDraft } from "./CommunityGroupQuotaDialog"
import { CommunityGroupComparison } from "./CommunityGroupComparison"
import { communityGroupQuotaKeys as communityQuotaKeys, parseQuotaInput, quotaInputValue } from "./communityGroupRules"

interface CommunityGroupAdminPanelProps { csrfToken: string; canWrite: boolean; canReadMemberships?: boolean; canWriteMemberships?: boolean; canReadUsers?: boolean; canReadAudit?: boolean }

export function CommunityGroupAdminPanel({ csrfToken, canWrite, canReadMemberships = false, canWriteMemberships = false, canReadUsers = false, canReadAudit = false }: CommunityGroupAdminPanelProps) {
  const [groups, setGroups] = useState<AdminCommunityGroup[]>([])
  const [query, setQuery] = useState("")
  const [groupType, setGroupType] = useState("all")
  const [groupStatus, setGroupStatus] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState("")
  const [defaultGroupId, setDefaultGroupId] = useState("")
  const [defaultError, setDefaultError] = useState("")
  const [defaultSaving, setDefaultSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [editing, setEditing] = useState<AdminCommunityGroup | null>(null)
  const [draft, setDraft] = useState<CommunityGroupDraft>(emptyDraft())
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

  async function refreshGroupConflictBaseline() {
    try {
      const result = sortGroups(await listAdminCommunityGroups())
      setGroups(result)
      setDefaultGroupId(result.find((group) => group.isDefault)?.id ?? "")
      const latestEditing = editing ? result.find((group) => group.id === editing.id) : null
      if (editing && !latestEditing) {
        setConflict(false)
        setError("该用户组已不存在，请关闭编辑器后刷新目录。")
        return
      }
      if (latestEditing) setEditing(latestEditing)
      setPreview(false)
      setConflict(false)
      setError("")
    } catch (reason) {
      setError(apiMessage(reason, "最新用户组数据读取失败，请稍后重试。"))
    }
  }

  async function refreshDefaultGroupBaseline(desiredGroupId: string) {
    try {
      const result = sortGroups(await listAdminCommunityGroups())
      setGroups(result)
      setDefaultGroupId(result.some((group) => group.id === desiredGroupId) ? desiredGroupId : result.find((group) => group.isDefault)?.id ?? "")
      setDefaultError("默认用户组已被其他管理员更新，已刷新最新数据，请确认后重试。")
    } catch (reason) {
      setDefaultError(apiMessage(reason, "默认用户组已变化，但最新数据暂时无法加载。"))
    }
  }

  async function saveDefaultGroup(event: FormEvent) {
    event.preventDefault(); const currentDefault = groups.find((group) => group.isDefault)
    if (!canWrite || !currentDefault || !defaultGroupId || defaultGroupId === currentDefault.id || defaultSaving) return
    setDefaultSaving(true); setDefaultError(""); setMessage("")
    try { await setAdminDefaultCommunityGroup(defaultGroupId, currentDefault.id, currentDefault.revision, csrfToken); await loadGroups(); setMessage("新用户默认组已更新") }
    catch (reason) {
      if (reason instanceof AdminApiError && reason.status === 409) await refreshDefaultGroupBaseline(defaultGroupId)
      else setDefaultError(apiMessage(reason, "默认用户组保存失败，请稍后重试。"))
    }
    finally { setDefaultSaving(false) }
  }

  function openEditor(group: AdminCommunityGroup | null, trigger: HTMLButtonElement) {
    if (!comparisonOpen) triggerRef.current = trigger; setComparisonOpen(false); setPreview(false); setEditing(group); setDraft(group ? toDraft(group) : { ...emptyDraft(nextDisplayOrder(groups)), internalKey: "group_" + crypto.randomUUID().replaceAll("-", "") }); setEditorOpen(true); setFieldErrors({}); setError(""); setMessage(""); setConflict(false)
  }
  function copyGroup(group: AdminCommunityGroup, trigger: HTMLButtonElement) {
    openEditor(null, trigger)
    setDraft(current => ({ ...toDraft(group), internalKey: current.internalKey, displayName: group.displayName.slice(0, 77) + " 副本", displayOrder: String(nextDisplayOrder(groups)), status: "active" }))
  }
  function closeOverlay() { if (saving) return; setPreview(false); setComparisonOpen(false); setEditorOpen(false); setEditing(null); setError(""); setConflict(false); queueMicrotask(() => triggerRef.current?.focus()) }

  async function saveGroup(event: FormEvent) {
    event.preventDefault(); if (!canWrite || saving || editing?.status === "archived") return
    const { input, fields } = parseDraft(draft)
    setFieldErrors(fields)
    if (!input) { setError("请检查内部键、名称、排序、权限与全部额度；数量必须是非负安全整数，MiB 须精确到字节且不超过安全整数范围；存储空间不得小于单文件大小。"); return }
    if (!preview) { setPreview(true); setError(""); return }
    setSaving(true); setError(""); setConflict(false)
    try {
      const saved = editing ? await updateAdminCommunityGroup(editing.id, { expectedRevision: editing.revision, displayName: input.displayName, description: input.description, displayOrder: input.displayOrder, status: input.status, permissionKeys: input.permissionKeys, quotas: input.quotas }, csrfToken) : await createAdminCommunityGroup(input, csrfToken)
      setGroups((current) => sortGroups([...current.filter((group) => group.id !== saved.id), saved])); setEditorOpen(false); setEditing(null); setMessage(`${saved.displayName}${editing ? "已保存" : "已创建"}`); queueMicrotask(() => triggerRef.current?.focus())
    } catch (reason) { setPreview(false); setConflict(reason instanceof AdminApiError && reason.status === 409); setError(apiMessage(reason, "用户组保存失败，请稍后重试。")) }
    finally { setSaving(false) }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleGroups = groups.filter(group => (groupType === "all" || (groupType === "base") === group.isBase) && (groupStatus === "all" || group.status === groupStatus) && [group.displayName, group.description, group.internalKey, group.id].some(value => value.toLocaleLowerCase().includes(normalizedQuery)))
  const groupLabel = (group: AdminCommunityGroup) => groups.filter(item => item.displayName === group.displayName).length > 1 ? `${group.displayName} · ${group.id.slice(-8)}` : group.displayName
  const overlayOpen = editorOpen || comparisonOpen
  return <>
    <div className="community-group-panel" inert={overlayOpen ? true : undefined} aria-hidden={overlayOpen ? "true" : undefined}>
      <div className="admin-form__heading membership-section-heading"><div><h2>用户组设置</h2><p>维护基础组与附加组，设置社区权限、使用额度和启用状态。</p></div><div className="community-group-panel__tools">{groups.length >= 2 && <button className="secondary-button" type="button" aria-haspopup="dialog" onClick={event => { triggerRef.current = event.currentTarget; setComparisonOpen(true) }}><GitCompareArrows size={14} aria-hidden="true" />比较用户组</button>}{canWrite && <button className="primary-button" type="button" aria-haspopup="dialog" onClick={(event) => openEditor(null, event.currentTarget)}><Plus size={14} aria-hidden="true" />创建用户组</button>}</div></div>
      <div className="community-group-filters" role="search" aria-label="用户组目录筛选"><label>搜索用户组<input aria-label="搜索用户组" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="名称、说明或高级标识" /></label><label>身份类型<select aria-label="身份类型" value={groupType} onChange={event => setGroupType(event.target.value)}><option value="all">全部身份</option><option value="base">基础组</option><option value="additional">附加组</option></select></label><label>用户组状态筛选<select aria-label="用户组状态筛选" value={groupStatus} onChange={event => setGroupStatus(event.target.value)}><option value="all">全部状态</option><option value="active">启用</option><option value="disabled">停用</option><option value="archived">已归档</option></select></label></div>
      {!loading && groups.length > 0 && <DefaultGroupSetting groups={groups} value={defaultGroupId} canWrite={canWrite} pending={defaultSaving} error={defaultError} onChange={(value) => { setDefaultGroupId(value); setDefaultError(""); setMessage("") }} onSubmit={(event) => void saveDefaultGroup(event)} />}
      <div className="community-group-admin-note"><ShieldCheck size={16} aria-hidden="true" /><span>基础组是账号主要社区身份；附加组叠加社区权限与额度。用户组与 VIP 标准权益、治理角色互相独立。</span></div>
      {loading ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" />正在读取用户组</div> : error && !overlayOpen ? <div className="admin-state" role="alert"><span>{error}</span><button className="secondary-button" type="button" onClick={() => void loadGroups()}>重新加载</button></div> : visibleGroups.length === 0 ? <div className="admin-empty" role="status">{groups.length === 0 ? "尚未配置用户组" : "没有匹配的用户组"}</div> : <ul className="community-group-list" aria-label="用户组列表">{visibleGroups.map((group) => <li className="community-group-row" key={group.id}>
        <header><span className="community-group-row__mark" aria-hidden="true">{group.isBase ? "基" : "附"}</span><div><strong>{group.displayName}{group.isDefault && <span className="community-group-default-badge">注册默认</span>}</strong><small>{group.isBase ? "基础组" : "附加组"} · {group.isDefault ? "注册默认加入" : group.isBase ? "基础身份配置" : "管理员授予"} · {statusLabel(group.status)} · {group.id.slice(-8)}</small></div></header>
        <div className="community-group-row__quota"><span>{group.permissionKeys.length} 项社区权限</span><span>{Object.keys(group.quotas).length} 项额度</span></div>
        <div className="community-group-row__impact"><span>{group.memberCount === undefined ? "成员统计暂不可用" : `${group.memberCount} 位成员`}</span><span>{group.expiringMemberCount === undefined ? "到期统计暂不可用" : `${group.expiringMemberCount} 位即将到期`}</span><span>{group.accessPolicyReferenceCount === undefined ? "引用统计暂不可用" : `${group.accessPolicyReferenceCount} 个访问策略引用`}</span></div>
        {canWrite ? <div className="community-group-row__actions"><button className="secondary-button" type="button" aria-haspopup="dialog" aria-label={`编辑${groupLabel(group)}`} onClick={(event) => openEditor(group, event.currentTarget)}><Pencil size={13} aria-hidden="true" />编辑</button><button className="secondary-button" type="button" aria-haspopup="dialog" aria-label={`复制${groupLabel(group)}`} onClick={event => copyGroup(group, event.currentTarget)}><Copy size={13} aria-hidden="true" />复制</button></div> : <small className="community-group-row__readonly">仅可查看</small>}
      </li>)}</ul>}
      {!canWrite && !loading && <p className="community-group-readonly">仅可查看用户组、权限与额度</p>}{message && <p className="admin-success" role="status">{message}</p>}
      {canReadMemberships && canReadUsers && !loading && !error && <CommunityGroupMembershipManager groups={groups} csrfToken={csrfToken} canWrite={canWriteMemberships} />}
    </div>
    {comparisonOpen && <CommunityGroupComparison groups={groups} canWrite={canWrite} onClose={closeOverlay} onEdit={openEditor} />}
    {editorOpen && <CommunityGroupEditorDialog group={editing} value={draft} pending={saving} error={error} fieldErrors={fieldErrors} conflict={conflict} preview={preview} canReadAudit={canReadAudit} canReadUsers={canReadUsers} onBack={() => setPreview(false)} onRefresh={() => void refreshGroupConflictBaseline()} onChange={(patch) => { setDraft((current) => ({ ...current, ...patch })); if (Object.keys(fieldErrors).length) { setFieldErrors({}); setError("") } }} onClose={closeOverlay} onSubmit={(event) => void saveGroup(event)} />}
  </>
}

function DefaultGroupSetting({ groups, value, canWrite, pending, error, onChange, onSubmit }: { groups: AdminCommunityGroup[]; value: string; canWrite: boolean; pending: boolean; error: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void }) {
  const current = groups.find((group) => group.isDefault); const eligible = groups.filter((group) => group.isBase && group.status === "active")
  return <section className="community-default-group" role="region" aria-labelledby="community-default-group-heading"><div className="community-default-group__copy"><UserRoundCheck size={18} aria-hidden="true" /><div><h3 id="community-default-group-heading">新用户默认用户组</h3><p>仅影响之后注册的新用户，不会迁移现有用户。</p></div>{current && <span>当前：{current.displayName}</span>}</div>{canWrite ? <form className="community-default-group__form" onSubmit={onSubmit}><label>默认用户组<select aria-label="默认用户组" value={value} onChange={(event) => onChange(event.target.value)} disabled={pending}>{eligible.map((group) => <option key={group.id} value={group.id}>{group.displayName} · 基础组 · {group.id.slice(-8)}</option>)}</select></label><button className="primary-button" type="submit" disabled={pending || !current || !value || value === current.id}>{pending && <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />}保存默认组</button></form> : <span>{current?.displayName ?? "尚未配置"}</span>}{error && <p className="form-alert" role="alert">{error}</p>}</section>
}

function emptyDraft(displayOrder = 10): CommunityGroupDraft { return { internalKey: "", displayName: "", description: "", isBase: false, displayOrder: String(displayOrder), status: "active", permissionKeys: [], quotas: Object.fromEntries(communityQuotaKeys.map(({ key }) => [key, "0"])) } }
function toDraft(group: AdminCommunityGroup): CommunityGroupDraft { return { internalKey: group.internalKey, displayName: group.displayName, description: group.description, isBase: group.isBase, displayOrder: String(group.displayOrder), status: group.status, permissionKeys: [...group.permissionKeys], quotas: Object.fromEntries(communityQuotaKeys.map(({ key }) => [key, quotaInputValue(key, group.quotas[key] ?? 0)])) } }
function parseDraft(value: CommunityGroupDraft) {
  const fields: Record<string, string> = {}
  const displayOrder = Number(value.displayOrder)
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(value.internalKey.trim())) fields.internalKey = "内部键须以小写字母开头，包含 3–64 个小写字母、数字或下划线。"
  if (!value.displayName.trim()) fields.displayName = "请输入显示名称。"
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 1 || displayOrder > 1_000_000) fields.displayOrder = "显示顺序须为 1–1,000,000 的整数。"
  const quotas: Record<string, number> = {}
  for (const { key, maximum } of communityQuotaKeys) {
    const quota = parseQuotaInput(key, value.quotas[key])
    if (quota === null) fields[key] = "请填写非负整数；MiB 须精确到字节。"
    else if (quota > maximum) fields[key] = "不能超过 " + quotaInputValue(key, maximum) + "。"
    else quotas[key] = quota
  }
  if (quotas["attachment.storage.bytes"] < quotas["attachment.file.bytes"]) fields["attachment.storage.bytes"] = "总存储空间须不小于单文件上限。"
  const input = Object.keys(fields).length ? null : { internalKey: value.internalKey.trim(), displayName: value.displayName.trim(), description: value.description.trim(), isBase: value.isBase, displayOrder, status: value.status, permissionKeys: [...new Set(value.permissionKeys)].sort(), quotas }
  return { input, fields }
}
function nextDisplayOrder(groups: AdminCommunityGroup[]): number { return Math.max(0, ...groups.map((group) => group.displayOrder)) + 10 }
function sortGroups(groups: AdminCommunityGroup[]): AdminCommunityGroup[] { return [...groups].sort((left, right) => left.displayOrder - right.displayOrder || left.internalKey.localeCompare(right.internalKey)) }
function statusLabel(status: AdminCommunityGroup["status"]): string { return status === "active" ? "启用" : status === "disabled" ? "停用" : "已归档" }
function apiMessage(reason: unknown, fallback: string): string { return reason instanceof AdminApiError ? reason.message : fallback }
