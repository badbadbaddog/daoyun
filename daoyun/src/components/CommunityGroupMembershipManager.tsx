import { LoaderCircle, RefreshCw, Search, UserMinus, UserPlus, UsersRound } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"

import {
  AdminApiError,
  grantAdminCommunityGroupMembership,
  listAdminCommunityGroupMemberships,
  revokeAdminCommunityGroupMembership,
  type AdminCommunityGroup,
  type GrantAdminCommunityGroupMembershipInput,
  type AdminCommunityGroupMembership,
} from "../api/admin"
import { AdminUsersApiError, listAdminUsers, type AdminUserSummary } from "../api/adminUsers"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"

interface CommunityGroupMembershipManagerProps {
  groups: AdminCommunityGroup[]
  csrfToken: string
  canWrite: boolean
  canRead?: boolean
  user?: AdminUserSummary
  onChanged?: () => void
  onBusyChange?: (busy: boolean) => void
}

export function CommunityGroupMembershipManager({ groups, csrfToken, canWrite, canRead = true, user, onBusyChange, onChanged }: CommunityGroupMembershipManagerProps) {
  const [query, setQuery] = useState("")
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(user ?? null)
  const [memberships, setMemberships] = useState<AdminCommunityGroupMembership[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [conflict, setConflict] = useState(false)
  const [groupId, setGroupId] = useState("")
  const [grantReason, setGrantReason] = useState("")
  const [duration, setDuration] = useState("permanent")
  const [membershipsReady, setMembershipsReady] = useState(false)
  const membershipRequestVersion = useRef(0)

  const [grantAttempt, setGrantAttempt] = useState<GrantAdminCommunityGroupMembershipInput | null>(null)
  const [revokeAttempt, setRevokeAttempt] = useState<{ id: string; revision: number; reason: string; key: string } | null>(null)
  const pending = useRef(false)
  const unconfirmed = Boolean(grantAttempt || revokeAttempt)
  useEffect(() => { onBusyChange?.(busy || unconfirmed) }, [busy, unconfirmed, onBusyChange])
  function setOperationBusy(value: boolean) { pending.current = value; setBusy(value) }
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])
  const [removalTarget, setRemovalTarget] = useState<AdminCommunityGroupMembership | null>(null)
  const [removalReason, setRemovalReason] = useState("")

  useEffect(() => {
    if (!canRead) { setMemberships([]); setMembershipsReady(false); setLoading(false); return }
    if (!selectedUser) return
    const controller = new AbortController()
    void loadMemberships(selectedUser.id, controller.signal)
    return () => { controller.abort(); membershipRequestVersion.current += 1 }
  }, [selectedUser, canRead])

  const availableGroups = groups.filter((group) => group.status === "active" && !group.isBase && !memberships.some((membership) => membership.group.id === group.id))

  useEffect(() => {
    if (!availableGroups.some((group) => group.id === groupId)) setGroupId(availableGroups[0]?.id ?? "")
  }, [availableGroups, groupId])

  async function searchUsers(event: FormEvent) {
    event.preventDefault()
    if (searching || busy) return
    const normalized = query.trim()
    if (!normalized) {
      setError("请输入用户名或昵称。")
      return
    }
    setSearching(true)
    setError("")
    setMessage("")
    try {
      const result = await listAdminUsers({ query: normalized, limit: 10 })
      setUsers(result.users)
      if (result.users.length === 0) setError("没有找到匹配的用户。")
    } catch (reason) {
      setError(apiMessage(reason, "用户搜索失败，请稍后重试。"))
    } finally {
      setSearching(false)
    }
  }

  async function loadMemberships(userId: string, signal?: AbortSignal) {
    const version = ++membershipRequestVersion.current
    setMembershipsReady(false)
    setLoading(true)
    setError("")
    setMessage("")
    setMemberships([])
    setRemovalTarget(null)
    try {
      const result = await listAdminCommunityGroupMemberships(userId, signal)
      if (!signal?.aborted && version === membershipRequestVersion.current) { setMemberships(result); setMembershipsReady(true) }
    } catch (reason) {
      if (!signal?.aborted && version === membershipRequestVersion.current) setError(apiMessage(reason, "用户组成员关系读取失败，请稍后重试。"))
    } finally {
      if (!signal?.aborted && version === membershipRequestVersion.current) setLoading(false)
    }
  }

  async function grantMembership(event: FormEvent) {
    event.preventDefault()
    if (!selectedUser || !groupId || pending.current || !canRead || !canWrite || !membershipsReady) return
    const reason = grantReason.trim()
    if (!validReason(reason)) {
      setError("加入原因需填写 3 至 200 个字符。")
      return
    }
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    setOperationBusy(true)
    setError("")
    setMessage("")
    const startsAt = new Date()
    const endsAt = duration === "permanent" ? null : new Date(startsAt.getTime() + Number(duration) * 86400000).toISOString()
    const input = grantAttempt ?? {
        userId: selectedUser.id,
        groupId,
        reason,
        startsAt: startsAt.toISOString(),
        endsAt,
        idempotencyKey: newIdempotencyKey("community-group-grant"),
      }
    try {
      const result = await grantAdminCommunityGroupMembership(input, csrfToken)
      setGrantAttempt(null)
      setMemberships((current) => [...current.filter(item => item.id !== result.membership.id), result.membership])
      setGrantReason("")
      setMessage(`已将${selectedUser.displayName}加入${group.displayName}`)
      onChanged?.()
    } catch (reason) {
      if (grantAttempt || unknownResult(reason)) { setGrantAttempt(input); setError("加入结果尚未确认，请使用保留的原请求重试核实。") }
      else setError(apiMessage(reason, "加入用户组失败，请稍后重试。"))
    } finally {
      setOperationBusy(false)
    }
  }

  async function refreshRemovalConflictBaseline() {
    if (!selectedUser || !removalTarget) return
    setLoading(true)
    try {
      const latestMemberships = await listAdminCommunityGroupMemberships(selectedUser.id)
      setMemberships(latestMemberships)
      const latest = latestMemberships.find((membership) => membership.id === removalTarget.id)
      if (!latest) {
        setRemovalTarget(null)
        setConflict(false)
        setError("")
        setMessage("该成员关系已被其他操作移除，当前列表已刷新。")
        return
      }
      setRemovalTarget(latest)
      setConflict(false)
      setError("")
    } catch (reason) {
      setError(apiMessage(reason, "最新成员关系暂时无法加载，请稍后重试。"))
    } finally {
      setLoading(false)
    }
  }

  async function revokeMembership(event: FormEvent) {
    event.preventDefault()
    if (!selectedUser || !removalTarget || pending.current || !canRead || !canWrite || conflict) return
    const reason = removalReason.trim()
    if (!validReason(reason)) {
      setError("移出原因需填写 3 至 200 个字符。")
      return
    }
    const target = removalTarget
    setOperationBusy(true)
    setError("")
    setMessage("")
    setConflict(false)
    const input = revokeAttempt ?? { id: target.id, revision: target.revision, reason, key: newIdempotencyKey("community-group-revoke") }
    try {
      await revokeAdminCommunityGroupMembership(input.id, input.revision, input.reason, input.key, csrfToken)
      setRevokeAttempt(null)
      setMemberships((current) => current.filter((membership) => membership.id !== target.id))
      setRemovalTarget(null)
      setRemovalReason("")
      setMessage(`已将${selectedUser.displayName}移出${target.group.displayName}`)
      onChanged?.()
    } catch (reason) {
      if (revokeAttempt || unknownResult(reason)) { setRevokeAttempt(input); setError("移出结果尚未确认，请使用保留的原请求重试核实。") }
      else { setConflict(reason instanceof AdminApiError && reason.status === 409); setError(apiMessage(reason, "移出用户组失败，请稍后重试。")) }
    } finally {
      setOperationBusy(false)
    }
  }

  return <section className="community-membership-manager" role="region" aria-labelledby="community-membership-heading">
    <div className="admin-form__heading membership-section-heading">
      <div><h3 id="community-membership-heading">附加组成员管理</h3><p>{user ? "查看此用户的有效身份；附加组授予与撤销保留原因和历史。" : "按用户处理例外的附加组归属；基础组和注册默认组在上方统一配置。"}</p></div>
      <UsersRound size={18} aria-hidden="true" />
    </div>
    {!user && <form className="community-membership-search" role="search" onSubmit={(event) => void searchUsers(event)}>
      <label htmlFor="community-membership-user-search"><span>用户</span><input id="community-membership-user-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索需要绑定用户组的用户" placeholder="用户名或昵称" maxLength={80} /></label>
      <button className="secondary-button" type="submit" disabled={searching || busy}>{searching ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}搜索用户</button>
    </form>}
    {!user && users.length > 0 && <ul className="community-membership-user-results" aria-label="用户搜索结果">{users.map((user) => <li key={user.id}><button type="button" aria-label={`选择${user.displayName} @${user.username}`} aria-pressed={selectedUser?.id === user.id} onClick={() => setSelectedUser(user)}><span>{user.displayName}</span><small>@{user.username} · {user.status === "active" ? "正常" : "受限"}</small></button></li>)}</ul>}
    {selectedUser && <div className="community-membership-detail">
      <header><div><strong>{selectedUser.displayName}</strong><small>@{selectedUser.username}</small></div><button className="icon-button" type="button" aria-label="刷新成员关系" title="刷新成员关系" disabled={loading || busy || unconfirmed} onClick={() => void loadMemberships(selectedUser.id)}><RefreshCw size={14} aria-hidden="true" /></button></header>
      {loading ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={18} aria-hidden="true" /><span>正在读取成员关系</span></div> : !membershipsReady ? <p>无法确认当前用户组，请刷新成员关系。</p> : <>
        {memberships.length === 0 ? <div className="admin-empty" role="status">当前用户没有有效用户组</div> : <ul className="community-membership-list" aria-label={`${selectedUser.displayName}的用户组`}>{memberships.map((membership) => <li key={membership.id}>
          <div><strong>{membership.group.displayName}</strong><small>{membership.group.id.slice(-8)} · {membership.source === "registration" || membership.source === "account_creation" ? "注册默认" : membership.source === "operator" || membership.source === "admin.manual" ? "管理员授予" : "其他来源"}</small><small>{membership.endsAt ? `到期：${new Date(membership.endsAt).toLocaleString("zh-CN", { hour12: false })}` : "长期有效"} · 版本 {membership.revision}</small><small>原因：{membership.source === "account_creation" ? "注册时加入默认基础组" : membership.reason}</small></div>
          <span className={`community-membership-kind community-membership-kind--${membership.membershipKind}`}>{membership.membershipKind === "base" ? "基础组 · 自动归属" : "附加组"}</span>
          {membership.membershipKind === "additional" && canWrite && <button className="secondary-button community-membership-remove" type="button" disabled={busy || unconfirmed} aria-label={`移出${membership.group.displayName}`} onClick={() => { setRemovalTarget(membership); setRemovalReason(""); setError(""); setMessage("") }}><UserMinus size={13} aria-hidden="true" />移出</button>}
        </li>)}</ul>}
        {canWrite && <form className="community-membership-grant" onSubmit={(event) => void grantMembership(event)}>
          <label><span>加入用户组</span><select aria-label="加入用户组" value={groupId} onChange={(event) => setGroupId(event.target.value)} disabled={busy || unconfirmed || availableGroups.length === 0}>{availableGroups.length === 0 ? <option value="">没有可加入的附加组</option> : availableGroups.map((group) => <option key={group.id} value={group.id}>{group.displayName} · 附加组 · {group.id.slice(-8)}</option>)}</select></label>
          <label><span>授予期限</span><select aria-label="授予期限" value={duration} onChange={event => setDuration(event.target.value)} disabled={busy || unconfirmed}><option value="permanent">长期有效</option><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option></select></label>
          <p className="community-group-editor__hint">{duration === "permanent" ? "长期有效，直到撤销" : `将在 ${duration} 天后到期，到期自动停止提供权限与额度`}；仅授予社区附加身份，管理角色需独立授权。</p>
          <label><span>加入原因</span><input aria-label="加入原因" value={grantReason} onChange={(event) => setGrantReason(event.target.value)} minLength={3} maxLength={200} placeholder="说明加入原因" disabled={busy || unconfirmed || availableGroups.length === 0} /></label>
          <button className="primary-button" type="submit" aria-label="确认加入用户组" disabled={busy || !groupId}>{busy && !removalTarget ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}加入</button>
        </form>}
      </>}
    </div>}
    {removalTarget && <form className="community-membership-removal" onSubmit={(event) => void revokeMembership(event)}>
      <div><strong>移出“{removalTarget.group.displayName}”</strong><span>该用户将立即失去此附加组提供的权限和额度。</span></div>
      <label><span>移出原因</span><input aria-label="移出原因" value={removalReason} onChange={(event) => setRemovalReason(event.target.value)} minLength={3} maxLength={200} autoFocus disabled={busy || unconfirmed} /></label>
      <div><button className="secondary-button" type="button" disabled={busy || unconfirmed} onClick={() => { setRemovalTarget(null); setRemovalReason("") }}>取消</button><button className="danger-button" type="submit" disabled={busy || conflict || !canWrite}>{busy ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <UserMinus size={14} aria-hidden="true" />}确认移出</button></div>
    </form>}
    {unconfirmed && <p role="status">原请求编号：<code>{grantAttempt?.idempotencyKey ?? revokeAttempt?.key}</code>；核实完成前保留当前用户与表单。</p>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    {conflict && removalTarget && <RevisionConflictNotice onRefresh={() => void refreshRemovalConflictBaseline()} />}
    {message && <p className="admin-success" role="status">{message}</p>}
    {!canWrite && selectedUser && <p className="community-group-readonly">当前账号仅可查看成员关系</p>}
  </section>
}

function validReason(reason: string): boolean {
  const length = Array.from(reason).length
  return length >= 3 && length <= 200
}

function apiMessage(reason: unknown, fallback: string): string {
  return reason instanceof AdminApiError || reason instanceof AdminUsersApiError ? reason.message : fallback
}

function newIdempotencyKey(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function unknownResult(reason: unknown) { return !(reason instanceof AdminApiError && reason.status >= 400 && reason.status < 500 && reason.code !== "response.invalid") }
