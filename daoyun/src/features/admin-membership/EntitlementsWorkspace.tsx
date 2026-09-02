import { LoaderCircle, RefreshCw, Search, ShieldCheck } from "lucide-react"
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"

import {
  AdminApiError, grantStandardEntitlement, listAdminStandardEntitlements, listStandardEntitlementTypes,
  listStandardEntitlementVersions, putStandardEntitlementType, revokeStandardEntitlement,
  type AdminStandardEntitlement, type StandardEntitlementType, type StandardEntitlementVersion,
} from "../../api/admin"
import { AdminUsersApiError, listAdminUsers, type AdminUserSummary } from "../../api/adminUsers"
import { RevisionConflictNotice } from "../../components/admin/RevisionConflictNotice"
import { ModalDialog } from "../../components/ui/ModalDialog"

interface EntitlementsWorkspaceProps {
  children?: ReactNode
  csrfToken?: string
  canReadTypes?: boolean
  canWriteTypes?: boolean
  canReadGrants?: boolean
  canWriteGrants?: boolean
  canReadUsers?: boolean
  onPublishVersion?: (input: { internalKey: string; displayName: string; permissionKeys: string[]; quotas: Record<string, number> }) => void
}

type EntitlementTab = "types" | "users"

export function EntitlementsWorkspace({ children, csrfToken = "", canReadTypes = true, canWriteTypes = true, canReadGrants = true, canWriteGrants = true, canReadUsers = true, onPublishVersion }: EntitlementsWorkspaceProps) {
  const [tab, setTab] = useState<EntitlementTab>("types")
  const [types, setTypes] = useState<StandardEntitlementType[]>([])
  const [typesLoading, setTypesLoading] = useState(canReadTypes)
  const [versions, setVersions] = useState<StandardEntitlementVersion[]>([])
  const [selectedType, setSelectedType] = useState<StandardEntitlementType | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [conflict, setConflict] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [internalKey, setInternalKey] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [permissionSnapshot, setPermissionSnapshot] = useState("")
  const [quotaSnapshot, setQuotaSnapshot] = useState("")
  const [query, setQuery] = useState("")
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null)
  const [entitlements, setEntitlements] = useState<AdminStandardEntitlement[]>([])
  const [searching, setSearching] = useState(false)
  const [grantsLoading, setGrantsLoading] = useState(false)
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantTypeId, setGrantTypeId] = useState("")
  const [grantSource, setGrantSource] = useState("")
  const [grantReference, setGrantReference] = useState("")
  const [grantReason, setGrantReason] = useState("")
  const [grantStartsAt, setGrantStartsAt] = useState("")
  const [grantEndsAt, setGrantEndsAt] = useState("")
  const [mutating, setMutating] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<AdminStandardEntitlement | null>(null)
  const [revokeReason, setRevokeReason] = useState("")

  useEffect(() => {
    if (!canReadTypes) { setTypesLoading(false); return }
    const controller = new AbortController()
    void loadTypes(controller.signal)
    return () => controller.abort()
  }, [canReadTypes])

  const activeTypes = useMemo(() => types.filter((type) => type.status === "active"), [types])

  async function loadTypes(signal?: AbortSignal) {
    setTypesLoading(true); setError("")
    try {
      const result = await listStandardEntitlementTypes(signal)
      setTypes(result)
      setGrantTypeId((current) => result.some((type) => type.id === current) ? current : result.find((type) => type.status === "active")?.id ?? "")
    } catch (reason) { if (!signal?.aborted) setError(apiMessage(reason, "标准权益类型读取失败，请稍后重试。")) }
    finally { if (!signal?.aborted) setTypesLoading(false) }
  }

  async function showVersions(type: StandardEntitlementType) {
    setSelectedType(type); setVersions([]); setVersionsLoading(true); setError("")
    try { setVersions(await listStandardEntitlementVersions(type.internalKey)) }
    catch (reason) { setError(apiMessage(reason, "权益版本历史读取失败，请稍后重试。")) }
    finally { setVersionsLoading(false) }
  }

  function openPublisher(type?: StandardEntitlementType) {
    setInternalKey(type?.internalKey ?? ""); setDisplayName(type?.displayName ?? "")
    setPermissionSnapshot(type?.permissionKeys.join(", ") ?? "")
    setQuotaSnapshot(type ? quotaLines(type.quotas).join("\n") : "")
    setSelectedType(type ?? null); setError(""); setConflict(false); setPublishOpen(true)
  }

  async function publishVersion(event: FormEvent) {
    event.preventDefault()
    const permissions = permissionSnapshot.split(/\s*,\s*/).filter(Boolean)
    const quotas = parseQuotaSnapshot(quotaSnapshot)
    if (!validInternalKey(internalKey) || !displayName.trim() || permissions.length === 0 || !quotas) { setError("请填写有效内部键、显示名称、权限快照和 key=value 额度快照。"); return }
    if (permissions.some((permission) => !communityPermissions.has(permission))) { setError("标准权益只能授予社区权限，不能授予治理权限。"); return }
    setPublishing(true); setError(""); setConflict(false)
    try {
      if (onPublishVersion) onPublishVersion({ internalKey: internalKey.trim(), displayName: displayName.trim(), permissionKeys: permissions, quotas })
      else {
        const updated = await putStandardEntitlementType(internalKey.trim(), { displayName: displayName.trim(), permissionKeys: permissions, quotas, expectedRevision: selectedType?.revision ?? null }, csrfToken)
        setTypes((current) => [...current.filter((type) => type.id !== updated.id), updated].sort((left, right) => left.internalKey.localeCompare(right.internalKey)))
        setSelectedType(updated); setVersions(await listStandardEntitlementVersions(updated.internalKey))
      }
      setPublishOpen(false); setMessage(`${displayName.trim()}的新版本已发布，历史版本保持不变`)
    } catch (reason) { setConflict(reason instanceof AdminApiError && reason.status === 409); setError(apiMessage(reason, "权益版本发布失败，请稍后重试。")) }
    finally { setPublishing(false) }
  }

  async function searchUsers(event: FormEvent) {
    event.preventDefault(); const normalized = query.trim()
    if (!normalized || !canReadUsers) return
    setSearching(true); setError(""); setMessage("")
    try { const result = await listAdminUsers({ query: normalized, limit: 10 }); setUsers(result.users); if (result.users.length === 0) setError("没有找到匹配的用户。") }
    catch (reason) { setError(apiMessage(reason, "用户搜索失败，请稍后重试。")) }
    finally { setSearching(false) }
  }

  async function selectUser(user: AdminUserSummary) {
    setSelectedUser(user); setGrantsLoading(true); setEntitlements([]); setError(""); setMessage("")
    try { setEntitlements(canReadGrants ? await listAdminStandardEntitlements(user.id) : []) }
    catch (reason) { setError(apiMessage(reason, "用户权益记录读取失败，请稍后重试。")) }
    finally { setGrantsLoading(false) }
  }

  async function grantEntitlement(event: FormEvent) {
    event.preventDefault()
    if (!selectedUser || !grantTypeId || !grantSource.trim() || !grantReason.trim() || !grantStartsAt || mutating) return
    const startsAt = toIso(grantStartsAt); const endsAt = grantEndsAt ? toIso(grantEndsAt) : null
    if (!startsAt || (grantEndsAt && !endsAt) || (endsAt && endsAt <= startsAt)) { setError("结束时间必须晚于开始时间。"); return }
    setMutating(true); setError("")
    try {
      const result = await grantStandardEntitlement({ userId: selectedUser.id, entitlementTypeId: grantTypeId, source: grantSource.trim(), sourceReferenceId: grantReference.trim() || null, reason: grantReason.trim(), startsAt, endsAt, idempotencyKey: newIdempotencyKey("entitlement-grant") }, csrfToken)
      setEntitlements((current) => [result.entitlement, ...current.filter((item) => item.id !== result.entitlement.id)])
      setGrantOpen(false); setMessage(result.replayed ? "权益发放已幂等重放" : "标准权益已安全发放")
    } catch (reason) { setError(apiMessage(reason, "标准权益发放失败，请稍后重试。")) }
    finally { setMutating(false) }
  }

  function handleWorkspaceTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const tabs: EntitlementTab[] = ["types", "users"]
    let nextIndex: number | null = null
    if (event.key === "ArrowRight") nextIndex = index + 1
    else if (event.key === "ArrowLeft") nextIndex = index - 1
    else if (event.key === "Home") nextIndex = 0
    else if (event.key === "End") nextIndex = tabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = tabs[(nextIndex + tabs.length) % tabs.length]
    setTab(next)
    document.getElementById(`entitlement-tab-${next}`)?.focus()
  }

  async function revokeEntitlement(event: FormEvent) {
    event.preventDefault()
    if (!revokeTarget || revokeReason.trim().length < 2 || mutating) return
    const target = revokeTarget; setMutating(true); setError(""); setConflict(false)
    try {
      const result = await revokeStandardEntitlement(target.id, target.revision, revokeReason.trim(), newIdempotencyKey("entitlement-revoke"), csrfToken)
      setEntitlements((current) => current.map((item) => item.id === result.entitlement.id ? result.entitlement : item))
      setRevokeTarget(null); setRevokeReason(""); setMessage(result.replayed ? "权益撤销已幂等重放" : "标准权益已撤销")
    } catch (reason) { setConflict(reason instanceof AdminApiError && reason.status === 409); setError(apiMessage(reason, "标准权益撤销失败，请稍后重试。")) }
    finally { setMutating(false) }
  }

  return <section className="membership-rule-section entitlement-admin" aria-labelledby="entitlement-workspace-heading">
    <header className="membership-section-heading"><div><h2 id="entitlement-workspace-heading">标准权益</h2><p>权益版本固定权限与额度快照，不包含或授予治理角色。</p></div>{canWriteTypes && <button className="primary-button" type="button" onClick={() => openPublisher()}>发布新版本</button>}</header>
    <div role="tablist" aria-label="标准权益工作区"><button id="entitlement-tab-types" type="button" role="tab" aria-controls="entitlement-panel-types" aria-selected={tab === "types"} tabIndex={tab === "types" ? 0 : -1} onClick={() => setTab("types")} onKeyDown={(event) => handleWorkspaceTabKey(event, 0)}>权益类型</button><button id="entitlement-tab-users" type="button" role="tab" aria-controls="entitlement-panel-users" aria-selected={tab === "users"} tabIndex={tab === "users" ? 0 : -1} onClick={() => setTab("users")} onKeyDown={(event) => handleWorkspaceTabKey(event, 1)}>用户权益</button></div>
    {tab === "types" ? <section id="entitlement-panel-types" role="tabpanel" aria-labelledby="entitlement-tab-types"><h3>类型与版本历史</h3>{children ?? <>
      {typesLoading ? <p role="status">正在读取权益类型</p> : types.length === 0 ? <p role="status">尚未配置标准权益类型。</p> : <ul className="entitlement-type-list" aria-label="标准权益类型列表">{types.map((type) => <li key={type.id}><div><strong>{type.displayName}</strong><small>{type.internalKey} · 当前版本 {type.currentVersion} · revision {type.revision}</small></div><div><span>{type.permissionKeys.length} 项权限</span><span>{Object.keys(type.quotas).length} 项额度</span><button className="secondary-button" type="button" onClick={() => void showVersions(type)} aria-label={`查看${type.displayName}版本历史`}>版本历史</button>{canWriteTypes && <button className="secondary-button" type="button" onClick={() => openPublisher(type)}>发布下一版本</button>}</div></li>)}</ul>}
      {selectedType && <section className="entitlement-version-history" role="region" aria-label={`${selectedType.displayName}版本历史`}><h4>{selectedType.displayName}版本历史</h4>{versionsLoading ? <p role="status">正在读取版本历史</p> : <ol>{versions.map((version) => <li key={version.id}><strong>版本 {version.version}</strong><span>{version.permissionKeys.join("、") || "无权限"}</span>{quotaLines(version.quotas).map((line) => <code key={line}>{line}</code>)}</li>)}</ol>}</section>}
    </>}</section> : <section id="entitlement-panel-users" role="tabpanel" aria-labelledby="entitlement-tab-users">
      <form className="entitlement-user-search" role="search" onSubmit={(event) => void searchUsers(event)}><label>搜索权益用户<input type="search" aria-label="搜索权益用户" placeholder="用户名或显示名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="secondary-button" type="submit" disabled={searching || !canReadUsers}>{searching ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}搜索用户</button></form>
      {canWriteGrants && <button className="primary-button" type="button" disabled={!selectedUser || activeTypes.length === 0} onClick={() => { setGrantOpen(true); setError(""); setGrantTypeId(activeTypes[0]?.id ?? "") }}>发放标准权益</button>}
      {users.length > 0 && <ul aria-label="权益用户搜索结果">{users.map((user) => <li key={user.id}><button type="button" aria-label={`选择${user.displayName} @${user.username}`} aria-pressed={selectedUser?.id === user.id} onClick={() => void selectUser(user)}>{user.displayName} <small>@{user.username}</small></button></li>)}</ul>}
      {selectedUser && <section className="entitlement-user-detail" aria-label={`${selectedUser.displayName}的标准权益`}><header><div><h3>{selectedUser.displayName}</h3><small>@{selectedUser.username}</small></div><button className="icon-button" type="button" aria-label="刷新用户权益" title="刷新用户权益" onClick={() => void selectUser(selectedUser)}><RefreshCw size={14} aria-hidden="true" /></button></header>
        {grantsLoading ? <p role="status">正在读取用户权益</p> : entitlements.length === 0 ? <p role="status">当前用户没有权益操作记录。</p> : <ul className="entitlement-operation-list" aria-label="权益操作记录">{entitlements.map((entitlement) => <li key={entitlement.id}><div><strong>{typeName(types, entitlement)}</strong><span>{entitlementState(entitlement)}</span></div><small>版本 {entitlement.typeVersion} · 来源 {entitlement.source}{entitlement.sourceReferenceId ? ` / ${entitlement.sourceReferenceId}` : ""}</small><p>{entitlement.reason}</p><time>{formatWindow(entitlement.startsAt, entitlement.endsAt)}</time><details><summary>权限与额度快照</summary><span>{entitlement.permissionSnapshot.join("、") || "无权限"}</span>{quotaLines(entitlement.quotaSnapshot).map((line) => <code key={line}>{line}</code>)}</details>{entitlement.revokedAt ? <p>撤销：{entitlement.revocationReason}</p> : canWriteGrants && <button className="danger-button" type="button" onClick={() => { setRevokeTarget(entitlement); setRevokeReason(""); setError("") }} aria-label={`撤销${typeName(types, entitlement)}`}>撤销</button>}</li>)}</ul>}
      </section>}
    </section>}
    {publishOpen && <ModalDialog element="form" className="dialog-panel" titleId="publish-entitlement-heading" busy={publishing} initialFocusSelector="input:not(:disabled), textarea:not(:disabled), select:not(:disabled)" onClose={() => setPublishOpen(false)} onSubmit={(event) => void publishVersion(event)}><h3 id="publish-entitlement-heading">发布权益版本</h3><p>权限与额度快照发布后不可修改；变更必须创建新版本。</p><label>内部键<input value={internalKey} readOnly={Boolean(selectedType)} onChange={(event) => setInternalKey(event.target.value)} /></label><label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>权限快照<textarea aria-label="权限快照" value={permissionSnapshot} onChange={(event) => setPermissionSnapshot(event.target.value)} placeholder="attachment.upload, topic.poll.create" /></label><label>额度快照<textarea aria-label="额度快照" value={quotaSnapshot} onChange={(event) => setQuotaSnapshot(event.target.value)} placeholder="attachment.upload.daily=20" /></label><p><ShieldCheck size={14} aria-hidden="true" />仅允许社区权益权限，不允许任何治理、后台或角色权限。</p>{error && <p className="form-alert" role="alert">{error}</p>}{conflict && <RevisionConflictNotice onRefresh={() => void loadTypes()} />}<div><button className="secondary-button" type="button" disabled={publishing} onClick={() => setPublishOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={publishing || !internalKey.trim() || !displayName.trim() || !permissionSnapshot.trim() || !quotaSnapshot.trim()}>确认发布</button></div></ModalDialog>}
    {grantOpen && selectedUser && <ModalDialog element="form" className="dialog-panel" titleId="grant-entitlement-heading" busy={mutating} initialFocusSelector="select:not(:disabled), input:not(:disabled), textarea:not(:disabled)" onClose={() => setGrantOpen(false)} onSubmit={(event) => void grantEntitlement(event)}><h3 id="grant-entitlement-heading">发放标准权益</h3><p>发放给 {selectedUser.displayName}；写入时固定当前类型版本的权限与额度快照。</p><label>权益类型<select aria-label="权益类型" value={grantTypeId} onChange={(event) => setGrantTypeId(event.target.value)}>{activeTypes.map((type) => <option key={type.id} value={type.id}>{type.displayName} · v{type.currentVersion}</option>)}</select></label><label>发放来源<input aria-label="发放来源" value={grantSource} onChange={(event) => setGrantSource(event.target.value)} placeholder="operator" /></label><label>来源编号（可选）<input value={grantReference} onChange={(event) => setGrantReference(event.target.value)} /></label><label>发放原因<input aria-label="发放原因" value={grantReason} onChange={(event) => setGrantReason(event.target.value)} /></label><label>开始时间<input aria-label="开始时间" type="datetime-local" value={grantStartsAt} onChange={(event) => setGrantStartsAt(event.target.value)} /></label><label>结束时间（可选）<input aria-label="结束时间" type="datetime-local" value={grantEndsAt} onChange={(event) => setGrantEndsAt(event.target.value)} /></label>{error && <p className="form-alert" role="alert">{error}</p>}<div><button className="secondary-button" type="button" disabled={mutating} onClick={() => setGrantOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={mutating}>确认发放</button></div></ModalDialog>}
    {revokeTarget && <ModalDialog element="form" className="dialog-panel" titleId="revoke-entitlement-heading" busy={mutating} initialFocusSelector="input:not(:disabled), textarea:not(:disabled), select:not(:disabled)" onClose={() => setRevokeTarget(null)} onSubmit={(event) => void revokeEntitlement(event)}><h3 id="revoke-entitlement-heading">撤销{typeName(types, revokeTarget)}</h3><p>撤销立即生效，历史版本与发放记录仍会保留。</p><label>撤销原因<input aria-label="撤销原因" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} /></label>{error && <p className="form-alert" role="alert">{error}</p>}{conflict && <RevisionConflictNotice onRefresh={() => selectedUser && void selectUser(selectedUser)} />}<div><button className="secondary-button" type="button" disabled={mutating} onClick={() => setRevokeTarget(null)}>取消</button><button className="danger-button" type="submit" disabled={mutating || revokeReason.trim().length < 2}>确认撤销</button></div></ModalDialog>}
    {error && !publishOpen && !grantOpen && !revokeTarget && <p className="form-alert" role="alert">{error}</p>}{message && <p className="admin-success" role="status">{message}</p>}
  </section>
}

function parseQuotaSnapshot(value: string): Record<string, number> | null { const result: Record<string, number> = {}; for (const entry of value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)) { const [key, raw, ...rest] = entry.split("=").map((item) => item.trim()); const quota = Number(raw); if (!key || rest.length > 0 || !Number.isSafeInteger(quota) || quota < 0) return null; result[key] = quota } return Object.keys(result).length > 0 ? result : null }
function quotaLines(quotas: Record<string, number>): string[] { return Object.entries(quotas).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key} = ${value}`) }
function typeName(types: StandardEntitlementType[], entitlement: AdminStandardEntitlement): string { return types.find((type) => type.id === entitlement.entitlementTypeId)?.displayName ?? entitlement.entitlementKey }
function entitlementState(entitlement: AdminStandardEntitlement): string { if (entitlement.revokedAt) return "已撤销"; const now = Date.now(); if (Date.parse(entitlement.startsAt) > now) return "待生效"; if (entitlement.endsAt && Date.parse(entitlement.endsAt) <= now) return "已到期"; return entitlement.endsAt ? "有效期内" : "长期有效" }
function formatWindow(startsAt: string, endsAt: string | null): string { return `${new Date(startsAt).toLocaleString("zh-CN")} — ${endsAt ? new Date(endsAt).toLocaleString("zh-CN") : "长期"}` }
function toIso(value: string): string | null { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString() }
function validInternalKey(value: string): boolean { return /^[a-z][a-z0-9_]{2,63}$/.test(value.trim()) }
function apiMessage(reason: unknown, fallback: string): string { return reason instanceof AdminApiError || reason instanceof AdminUsersApiError ? reason.message : fallback }
function newIdempotencyKey(prefix: string): string { return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }
const communityPermissions = new Set(["board.read", "topic.read", "topic.create", "reply.create", "message.send", "attachment.upload", "attachment.download", "topic.poll.create", "topic.bounty.create", "topic.lottery.join", "content.external_link.use", "profile.signature.use", "content.pre_moderation.required"])
