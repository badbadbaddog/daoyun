import { LoaderCircle, RefreshCw, Search, UserMinus, UserPlus, UsersRound } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"

import {
  AdminApiError,
  grantAdminCommunityGroupMembership,
  listAdminCommunityGroupMemberships,
  revokeAdminCommunityGroupMembership,
  type AdminCommunityGroup,
  type AdminCommunityGroupMembership,
} from "../api/admin"
import { AdminUsersApiError, listAdminUsers, type AdminUserSummary } from "../api/adminUsers"

interface CommunityGroupMembershipManagerProps {
  groups: AdminCommunityGroup[]
  csrfToken: string
  canWrite: boolean
}

export function CommunityGroupMembershipManager({ groups, csrfToken, canWrite }: CommunityGroupMembershipManagerProps) {
  const [query, setQuery] = useState("")
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null)
  const [memberships, setMemberships] = useState<AdminCommunityGroupMembership[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [groupId, setGroupId] = useState("")
  const [grantReason, setGrantReason] = useState("")
  const [removalTarget, setRemovalTarget] = useState<AdminCommunityGroupMembership | null>(null)
  const [removalReason, setRemovalReason] = useState("")

  useEffect(() => {
    if (!selectedUser) return
    const controller = new AbortController()
    void loadMemberships(selectedUser.id, controller.signal)
    return () => controller.abort()
  }, [selectedUser])

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
    setLoading(true)
    setError("")
    setMessage("")
    setMemberships([])
    setRemovalTarget(null)
    try {
      setMemberships(await listAdminCommunityGroupMemberships(userId, signal))
    } catch (reason) {
      if (!signal?.aborted) setError(apiMessage(reason, "用户组成员关系读取失败，请稍后重试。"))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  async function grantMembership(event: FormEvent) {
    event.preventDefault()
    if (!selectedUser || !groupId || busy || !canWrite) return
    const reason = grantReason.trim()
    if (!validReason(reason)) {
      setError("加入原因需填写 3 至 200 个字符。")
      return
    }
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const result = await grantAdminCommunityGroupMembership({
        userId: selectedUser.id,
        groupId,
        reason,
        startsAt: new Date().toISOString(),
        idempotencyKey: newIdempotencyKey("community-group-grant"),
      }, csrfToken)
      setMemberships((current) => [...current, result.membership])
      setGrantReason("")
      setMessage(`已将${selectedUser.displayName}加入${group.displayName}`)
    } catch (reason) {
      setError(apiMessage(reason, "加入用户组失败，请稍后重试。"))
    } finally {
      setBusy(false)
    }
  }

  async function revokeMembership(event: FormEvent) {
    event.preventDefault()
    if (!selectedUser || !removalTarget || busy || !canWrite) return
    const reason = removalReason.trim()
    if (!validReason(reason)) {
      setError("移出原因需填写 3 至 200 个字符。")
      return
    }
    const target = removalTarget
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await revokeAdminCommunityGroupMembership(target.id, target.revision, reason, newIdempotencyKey("community-group-revoke"), csrfToken)
      setMemberships((current) => current.filter((membership) => membership.id !== target.id))
      setRemovalTarget(null)
      setRemovalReason("")
      setMessage(`已将${selectedUser.displayName}移出${target.group.displayName}`)
    } catch (reason) {
      setError(apiMessage(reason, "移出用户组失败，请稍后重试。"))
    } finally {
      setBusy(false)
    }
  }

  return <section className="community-membership-manager" role="region" aria-labelledby="community-membership-heading">
    <div className="admin-form__heading membership-section-heading">
      <div><h3 id="community-membership-heading">附加组成员管理</h3><p>按用户处理例外的附加组归属；基础组和注册默认组在上方统一配置。</p></div>
      <UsersRound size={18} aria-hidden="true" />
    </div>
    <form className="community-membership-search" role="search" onSubmit={(event) => void searchUsers(event)}>
      <label htmlFor="community-membership-user-search"><span>用户</span><input id="community-membership-user-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索需要绑定用户组的用户" placeholder="用户名或昵称" maxLength={80} /></label>
      <button className="secondary-button" type="submit" disabled={searching || busy}>{searching ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}搜索用户</button>
    </form>
    {users.length > 0 && <ul className="community-membership-user-results" aria-label="用户搜索结果">{users.map((user) => <li key={user.id}><button type="button" aria-label={`选择${user.displayName} @${user.username}`} aria-pressed={selectedUser?.id === user.id} onClick={() => setSelectedUser(user)}><span>{user.displayName}</span><small>@{user.username} · {user.status === "active" ? "正常" : "受限"}</small></button></li>)}</ul>}
    {selectedUser && <div className="community-membership-detail">
      <header><div><strong>{selectedUser.displayName}</strong><small>@{selectedUser.username}</small></div><button className="icon-button" type="button" aria-label="刷新成员关系" title="刷新成员关系" disabled={loading || busy} onClick={() => void loadMemberships(selectedUser.id)}><RefreshCw size={14} aria-hidden="true" /></button></header>
      {loading ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={18} aria-hidden="true" /><span>正在读取成员关系</span></div> : <>
        {memberships.length === 0 ? <div className="admin-empty" role="status">当前用户没有有效用户组</div> : <ul className="community-membership-list" aria-label={`${selectedUser.displayName}的用户组`}>{memberships.map((membership) => <li key={membership.id}>
          <div><strong>{membership.group.displayName}</strong><small>{membership.group.internalKey}</small></div>
          <span className={`community-membership-kind community-membership-kind--${membership.membershipKind}`}>{membership.membershipKind === "base" ? "基础组 · 自动归属" : "附加组"}</span>
          {membership.membershipKind === "additional" && canWrite && <button className="text-button text-button--danger" type="button" disabled={busy} aria-label={`移出${membership.group.displayName}`} onClick={() => { setRemovalTarget(membership); setRemovalReason(""); setError(""); setMessage("") }}><UserMinus size={13} aria-hidden="true" />移出</button>}
        </li>)}</ul>}
        {canWrite && <form className="community-membership-grant" onSubmit={(event) => void grantMembership(event)}>
          <label><span>加入用户组</span><select aria-label="加入用户组" value={groupId} onChange={(event) => setGroupId(event.target.value)} disabled={busy || availableGroups.length === 0}>{availableGroups.length === 0 ? <option value="">没有可加入的附加组</option> : availableGroups.map((group) => <option key={group.id} value={group.id}>{group.displayName}</option>)}</select></label>
          <label><span>加入原因</span><input aria-label="加入原因" value={grantReason} onChange={(event) => setGrantReason(event.target.value)} minLength={3} maxLength={200} placeholder="说明加入原因" disabled={busy || availableGroups.length === 0} /></label>
          <button className="primary-button" type="submit" aria-label="确认加入用户组" disabled={busy || !groupId}>{busy && !removalTarget ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}加入</button>
        </form>}
      </>}
    </div>}
    {removalTarget && <form className="community-membership-removal" onSubmit={(event) => void revokeMembership(event)}>
      <div><strong>移出“{removalTarget.group.displayName}”</strong><span>该用户将立即失去此附加组提供的权限和额度。</span></div>
      <label><span>移出原因</span><input aria-label="移出原因" value={removalReason} onChange={(event) => setRemovalReason(event.target.value)} minLength={3} maxLength={200} autoFocus disabled={busy} /></label>
      <div><button className="secondary-button" type="button" disabled={busy} onClick={() => { setRemovalTarget(null); setRemovalReason("") }}>取消</button><button className="danger-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <UserMinus size={14} aria-hidden="true" />}确认移出</button></div>
    </form>}
    {error && <p className="form-alert" role="alert">{error}</p>}
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
