import { useEffect, useRef, useState } from "react"
import { createAuthorizationAssignment, type AdminBoard, type AuthorizationPermission, type AuthorizationRole, type AuthorizationRoleAssignment } from "../api/admin"
import { listAdminUsers } from "../api/adminUsers"
import { AdminUserPicker, type AdminUserCandidate } from "./admin/AdminUserPicker"
import { ConfirmDialog } from "./ui/ConfirmDialog"
import { isHighRiskAuthorizationPermission } from "../features/authorization/roleTemplates"

export function TeamAppointmentForm({ boards, roles, permissions, csrfToken, initialScopeId, canWrite, canSearchUsers, onBusyChange, onCreated }: {
  boards: AdminBoard[]; roles: AuthorizationRole[]; permissions: AuthorizationPermission[]; csrfToken: string; initialScopeId: string
  canWrite: boolean; canSearchUsers: boolean; onBusyChange: (busy: boolean) => void; onCreated: (assignment: AuthorizationRoleAssignment) => void
}) {
  const [query, setQuery] = useState("")
  const [users, setUsers] = useState<AdminUserCandidate[]>([])
  const [selectedUser, setSelectedUser] = useState<AdminUserCandidate | null>(null)
  const [userLoading, setUserLoading] = useState(false)
  const [userError, setUserError] = useState("")
  const [userRetry, setUserRetry] = useState(0)
  const [roleId, setRoleId] = useState("")
  const [scopeId, setScopeId] = useState(initialScopeId)
  const [scopeMode, setScopeMode] = useState<"exact" | "subtree">("exact")
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const mutation = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const role = roles.find(role => role.id === roleId && !role.isSystem)
  const scopeBoard = boards.find(board => board.id === scopeId)
  const valid = canWrite && canSearchUsers && selectedUser && role && (role.scope !== "board" || scopeBoard)

  useEffect(() => {
    const controller = new AbortController()
    setUsers([]); setUserError(""); setUserLoading(false)
    if (!canSearchUsers || query.trim().length < 2) return () => controller.abort()
    setUserLoading(true)
    void listAdminUsers({ query: query.trim(), limit: 10, signal: controller.signal }).then(page => {
      if (!controller.signal.aborted) setUsers(page.users)
    }).catch(() => { if (!controller.signal.aborted) setUserError("人员搜索失败，请重试。") })
      .finally(() => { if (!controller.signal.aborted) setUserLoading(false) })
    return () => controller.abort()
  }, [canSearchUsers, query, userRetry])
  useEffect(() => { setPreview(false) }, [selectedUser?.id, roleId, scopeId, scopeMode, canWrite, canSearchUsers])
  useEffect(() => { setScopeId(initialScopeId); setScopeMode("exact") }, [roleId, initialScopeId])

  async function save() {
    if (!valid || !selectedUser || !role || mutation.current) return
    mutation.current = true; setBusy(true); onBusyChange(true); setError("")
    try {
      const saved = await createAuthorizationAssignment({ username: selectedUser.username, roleId: role.id, scopeId: role.scope === "board" ? scopeId : null, scopeMode: role.scope === "board" ? scopeMode : "exact" }, csrfToken)
      setPreview(false); onCreated(saved)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "任命失败，请保留选择后重试。") }
    finally { mutation.current = false; setBusy(false); onBusyChange(false) }
  }
  return <form className="admin-form authorization-assignment-form" onSubmit={event => {
    event.preventDefault()
    if (valid && !mutation.current) { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setError(""); setPreview(true) }
  }}>
    <p>先选择人员、职务和真实管理范围，再确认任命。管理职务与社区用户组、权益分开。</p>
    <fieldset disabled={busy || !canWrite} className="admin-team-appointment-fields"><legend>人员与范围</legend>
      {canSearchUsers ? <AdminUserPicker query={query} users={users} selectedUser={selectedUser} loading={userLoading} onQueryChange={value => { setQuery(value); setSelectedUser(null) }} onSelect={setSelectedUser} /> : <p>人员选择需要用户读取权限。</p>}
      {userError && <><p role="alert">{userError}</p><button type="button" className="secondary-button" onClick={event => { event.currentTarget.form?.querySelector<HTMLInputElement>('input[aria-label="搜索用户"]')?.focus(); setUserRetry(value => value + 1) }}>重试人员搜索</button></>}
      {selectedUser && <p>已选：{selectedUser.displayName} @{selectedUser.username} · {selectedUser.id}</p>}
      <label><span>自定义角色</span><select value={roleId} onChange={event => setRoleId(event.target.value)} required><option value="">请选择</option>{roles.filter(role => !role.isSystem).map(role => <option key={role.id} value={role.id}>{role.name}（{role.scope === "board" ? "版块" : role.scope === "site" ? "站点" : "全站"}）</option>)}</select></label>
      {role?.scope === "board" && <label><span>作用板块</span><select value={scopeId} onChange={event => setScopeId(event.target.value)} required><option value="">请选择板块</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select>{boards.length === 0 && <small>没有可选择的版块，请刷新版块目录。</small>}</label>}
      <label><span>包含子版块</span><select value={role?.scope === "board" ? scopeMode : "exact"} disabled={role?.scope !== "board"} onChange={event => { if (event.target.value === "exact" || event.target.value === "subtree") setScopeMode(event.target.value) }}><option value="exact">否 · 仅本版块</option><option value="subtree">是 · 当前及全部后代</option></select></label>
      <p>{role?.scope === "board" ? "包含子版块按当前树计算，子版移动后范围随树变化。" : "全站与站点任命使用自身范围，子版块选项不适用。"}</p>
      <label><span>任命到期时间</span><input type="datetime-local" disabled aria-describedby="team-expiry-support" /></label>
      <p id="team-expiry-support">当前契约不支持到期任命，只能长期任命。</p>
      <label><span>任命原因</span><textarea disabled rows={2} placeholder="当前契约未支持独立任命原因" /></label>
    </fieldset>
    {!canWrite && <p>没有人员任命写入权限。</p>}
    {error && !preview && <p role="alert" className="form-alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={!valid || busy}>预览任命</button>
    {preview && valid && selectedUser && role && <ConfirmDialog title="确认任命管理人员" confirmLabel="确认任命" busy={busy} returnFocus={returnFocus.current} onCancel={() => { if (!mutation.current) setPreview(false) }} onConfirm={() => void save()}>
      <p>人员：{selectedUser.displayName} @{selectedUser.username} · {selectedUser.id}</p>
      <p>职务：{role.name} · {role.id}</p>
      <p>管理范围：{role.scope === "board" ? (scopeBoard?.name + " · " + (scopeMode === "subtree" ? "当前及全部后代" : "仅本版块")) : role.scope === "site" ? "站点" : "全站"}。</p>
      <p>期限：长期（当前契约不支持到期任命）</p>
      <p>授予以下 {role.permissionKeys.length} 项管理能力。服务器重新检查授权上限、角色与真实范围。</p>
      <ul className="admin-team-capability-preview" tabIndex={0} aria-label="任命能力清单">{role.permissionKeys.map(key => <li key={key}>{permissions.find(permission => permission.key === key)?.name ?? key} · {key}</li>)}</ul>
      {role.permissionKeys.some(isHighRiskAuthorizationPermission) && <p className="form-alert">包含内容治理或其他高危能力，请逐项核对人员与范围。</p>}
      {error && <p role="alert" className="form-alert">{error}</p>}
    </ConfirmDialog>}
  </form>
}
