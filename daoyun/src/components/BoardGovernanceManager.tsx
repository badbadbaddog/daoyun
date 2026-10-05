import { useEffect, useRef, useState } from "react"
import { AdminApiError, createAuthorizationAssignment, listAuthorizationAssignments, listAuthorizationRoles, type AdminBoard, type AuthorizationRole, type AuthorizationRoleAssignment } from "../api/admin"
import { listAdminUsers } from "../api/adminUsers"
import { AdminUserPicker, type AdminUserCandidate } from "./admin/AdminUserPicker"
import { ConfirmDialog } from "./ui/ConfirmDialog"

export function BoardGovernanceManager({ board, csrfToken, capabilityKeys, onBusyChange }: { board: AdminBoard; csrfToken: string; capabilityKeys: string[]; onBusyChange: (busy: boolean) => void }) {
  const canRead = capabilityKeys.includes("authorization.roles.read") && capabilityKeys.includes("authorization.assignments.read")
  const canAppoint = canRead && capabilityKeys.includes("authorization.assignments.write") && capabilityKeys.includes("admin.users.read")
  const [roles, setRoles] = useState<AuthorizationRole[]>([])
  const [assignments, setAssignments] = useState<AuthorizationRoleAssignment[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState("")
  const [users, setUsers] = useState<AdminUserCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [selected, setSelected] = useState<AdminUserCandidate | null>(null)
  const [roleId, setRoleId] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const pending = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading"); setError("")
    if (!canRead) return () => controller.abort()
    async function loadAssignments() {
      const items: AuthorizationRoleAssignment[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await listAuthorizationAssignments({ scopeId: board.id, cursor, limit: 50, signal: controller.signal })
        if (controller.signal.aborted) return items
        for (const item of page.assignments) if (item.scopeId === board.id && item.role.scope === "board" && !items.some(existing => existing.id === item.id)) items.push(item)
        cursor = page.nextCursor ?? undefined
        if (cursor && seen.has(cursor)) throw new Error("重复的任命游标")
        if (cursor) seen.add(cursor)
      } while (cursor)
      return items
    }
    void Promise.all([listAuthorizationRoles(controller.signal), loadAssignments()]).then(([loadedRoles, loadedAssignments]) => {
      if (controller.signal.aborted) return
      setRoles(loadedRoles.filter(item => item.scope === "board" && !item.isSystem)); setAssignments(loadedAssignments); setStatus("ready")
    }).catch(reason => { if (!controller.signal.aborted) { setStatus("error"); setError(reason instanceof AdminApiError ? reason.message : "版块治理人员暂时无法加载。") } })
    return () => controller.abort()
  }, [board.id, canRead, retry])
  useEffect(() => {
    const controller = new AbortController()
    setUsers([]); setSearching(false); setSearchError("")
    if (!canAppoint || status !== "ready" || query.trim().length < 2) return () => controller.abort()
    setSearching(true)
    void listAdminUsers({ query: query.trim(), limit: 20, signal: controller.signal }).then(page => {
      if (!controller.signal.aborted) setUsers(page.users)
    }).catch(reason => { if (!controller.signal.aborted) setSearchError(reason instanceof AdminApiError ? reason.message : "用户搜索失败，请重新输入后重试。") }).finally(() => { if (!controller.signal.aborted) setSearching(false) })
    return () => controller.abort()
  }, [query, canAppoint, status])
  const selectedRole = roles.find(item => item.id === roleId)
  const assigned = selected && assignments.some(item => item.user.id === selected.id && item.role.id === roleId)
  const busy = saving || confirming
  async function appoint() {
    if (pending.current || status !== "ready" || !canAppoint || !selected || !selectedRole || assigned) return
    pending.current = true; setSaving(true); onBusyChange(true); setError(""); setMessage("")
    try {
      const saved = await createAuthorizationAssignment({ username: selected.username, roleId: selectedRole.id, scopeId: board.id, scopeMode: "exact" }, csrfToken)
      setAssignments(items => [...items.filter(item => item.id !== saved.id), saved]); setMessage("任命已保存"); setSelected(null); setQuery(""); setRoleId("")
    } catch (reason) { setError(reason instanceof AdminApiError ? reason.message : "任命失败，请确认当前人员和角色后重试。") }
    finally { pending.current = false; setSaving(false); setConfirming(false); onBusyChange(false) }
  }
  return <section className="admin-board-governance">
    <h4>为这个版块分配管理人员</h4><p>范围：{board.name}（仅本版块）。新增任命只作用于这里，不包含子版块。</p>
    {!canRead ? <p>没有读取版块治理人员的权限。</p> : status === "loading" ? <p role="status">正在加载版块治理人员…</p> : status === "error" ? <><p className="form-alert" role="alert">{error}</p><button className="secondary-button" type="button" onClick={() => setRetry(count => count + 1)}>重试治理人员</button></> : <>
      <h5>当前直接任命</h5>{assignments.length ? <ul>{assignments.map(item => <li key={item.id}><strong>{item.user.displayName}</strong> @{item.user.username} · {item.role.name}</li>)}</ul> : <p>当前版块没有直接任命；站点角色及上级范围权限需在管理团队中查看。</p>}
      {!canAppoint ? <p>没有任命管理人员的权限。</p> : <div className="admin-board-appointment">
        <AdminUserPicker query={query} users={users} selectedUser={selected} loading={searching} disabled={busy} onQueryChange={value => { setQuery(value); setSelected(null); setMessage("") }} onSelect={setSelected} />
        {searchError && <p className="form-alert" role="alert">{searchError}</p>}
        <label><span>版块角色</span><select aria-label="版块角色" value={roleId} disabled={busy} onChange={event => setRoleId(event.target.value)}><option value="">请选择版块角色</option>{roles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id.slice(-8)}</option>)}</select></label>
        {!roles.length && <p>暂无可任命的版块角色，请先在管理团队创建版块角色。</p>}
        {assigned && <p>该用户已持有此版块角色。</p>}
        <button className="primary-button" type="button" disabled={busy || searching || !selected || !selectedRole || Boolean(assigned)} onClick={event => { returnFocus.current = event.currentTarget; setConfirming(true) }}>添加管理人员</button>
      </div>}
      {error && <p className="form-alert" role="alert">{error}</p>}{message && <p className="admin-success" role="status">{message}</p>}
    </>}
    <a className="secondary-button" href={"#admin/authorization?scope_id=" + encodeURIComponent(board.id)} aria-disabled={saving} onClick={event => { if (saving) event.preventDefault() }}>查看管理团队</a>
    {confirming && selected && selectedRole && <ConfirmDialog title="确认版块任命" confirmLabel="确认任命" danger={false} busy={saving} returnFocus={returnFocus.current} onConfirm={() => void appoint()} onCancel={() => { if (!pending.current) setConfirming(false) }}><dl><div><dt>人员</dt><dd>{selected.displayName} @{selected.username}</dd></div><div><dt>角色</dt><dd>{selectedRole.name}</dd></div><div><dt>范围</dt><dd>{board.name}（仅本版块）</dd></div></dl></ConfirmDialog>}
  </section>
}
