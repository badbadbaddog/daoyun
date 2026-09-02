import { KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, UserPlus, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  AdminApiError,
  createAuthorizationAssignment,
  createAuthorizationRole,
  deleteAuthorizationAssignment,
  deleteAuthorizationRole,
  listAuthorizationAssignments,
  listAuthorizationPermissions,
  listAuthorizationRoles,
  updateAuthorizationRole,
} from "../api/admin"
import type { AdminBoard, AuthorizationPermission, AuthorizationRole, AuthorizationRoleAssignment, AuthorizationRoleScope } from "../api/admin"
import { ConfirmDialog } from "./ui/ConfirmDialog"

interface AuthorizationAdminPanelProps {
  csrfToken: string
  boards: AdminBoard[]
}

interface RoleDraft {
  key: string
  name: string
  scope: AuthorizationRoleScope
  permissionKeys: string[]
}

type AuthorizationConfirmation =
  | { kind: "role"; role: AuthorizationRole }
  | { kind: "assignment"; assignment: AuthorizationRoleAssignment }

const emptyRole: RoleDraft = { key: "", name: "", scope: "instance", permissionKeys: [] }

export function AuthorizationAdminPanel({ csrfToken, boards }: AuthorizationAdminPanelProps) {
  const [permissions, setPermissions] = useState<AuthorizationPermission[]>([])
  const [roles, setRoles] = useState<AuthorizationRole[]>([])
  const [assignments, setAssignments] = useState<AuthorizationRoleAssignment[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(emptyRole)
  const [username, setUsername] = useState("")
  const [assignmentRoleId, setAssignmentRoleId] = useState("")
  const [assignmentScopeId, setAssignmentScopeId] = useState("")
  const [confirmation, setConfirmation] = useState<AuthorizationConfirmation | null>(null)
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null)
  const busyRef = useRef(false)

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError("")
    try {
      const [loadedPermissions, loadedRoles, loadedAssignments] = await Promise.all([
        listAuthorizationPermissions(signal),
        listAuthorizationRoles(signal),
        listAuthorizationAssignments({ limit: 50, signal }),
      ])
      if (signal?.aborted) return
      setPermissions(loadedPermissions)
      setRoles(loadedRoles)
      setAssignments(loadedAssignments.assignments)
      setNextCursor(loadedAssignments.nextCursor)
    } catch (reason) {
      if (!signal?.aborted) setError(apiMessage(reason, "角色与权限暂时无法加载，请稍后重试。"))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadData(controller.signal)
    return () => controller.abort()
  }, [loadData])

  const customRoles = useMemo(() => roles.filter((role) => !role.isSystem), [roles])
  const selectedAssignmentRole = customRoles.find((role) => role.id === assignmentRoleId)

  function beginBusy() {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    return true
  }

  function endBusy() {
    busyRef.current = false
    setBusy(false)
  }

  async function saveRole(event: React.FormEvent) {
    event.preventDefault()
    if (!beginBusy()) return
    setError(""); setMessage("")
    try {
      if (editingRoleId) {
        const current = roles.find((role) => role.id === editingRoleId)
        if (!current) throw new Error("role disappeared")
        const saved = await updateAuthorizationRole(editingRoleId, { name: roleDraft.name.trim(), permissionKeys: roleDraft.permissionKeys, expectedRevision: current.revision }, csrfToken)
        setRoles((values) => values.map((role) => role.id === saved.id ? saved : role))
        setMessage("角色已保存")
      } else {
        const saved = await createAuthorizationRole({ key: roleDraft.key.trim(), name: roleDraft.name.trim(), scope: roleDraft.scope, permissionKeys: roleDraft.permissionKeys }, csrfToken)
        setRoles((values) => [...values, saved])
        setMessage("角色已创建")
      }
      cancelRoleEdit()
    } catch (reason) {
      if (reason instanceof AdminApiError && reason.code === "authorization.role_conflict") {
        setError("角色已被其他管理员更新，已刷新最新数据。")
        await loadData()
      } else {
        setError(apiMessage(reason, "角色保存失败，请稍后重试。"))
      }
    } finally { endBusy() }
  }

  function editRole(role: AuthorizationRole) {
    setEditingRoleId(role.id)
    setRoleDraft({ key: role.key, name: role.name, scope: role.scope, permissionKeys: [...role.permissionKeys] })
    setError(""); setMessage("")
  }

  function cancelRoleEdit() {
    setEditingRoleId(null)
    setRoleDraft(emptyRole)
  }

  async function removeRole(role: AuthorizationRole) {
    if (!beginBusy()) return
    setError(""); setMessage("")
    try {
      await deleteAuthorizationRole(role.id, csrfToken)
      setRoles((values) => values.filter((value) => value.id !== role.id))
      if (assignmentRoleId === role.id) setAssignmentRoleId("")
      setMessage("角色已删除")
      setConfirmation(null)
    } catch (reason) { setError(apiMessage(reason, "角色删除失败，请稍后重试。")) } finally { endBusy() }
  }

  async function assignRole(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedAssignmentRole || !beginBusy()) return
    setError(""); setMessage("")
    try {
      const saved = await createAuthorizationAssignment({ username: username.trim(), roleId: selectedAssignmentRole.id, scopeId: selectedAssignmentRole.scope === "board" ? assignmentScopeId : null }, csrfToken)
      setAssignments((values) => [saved, ...values])
      setRoles((values) => values.map((role) => role.id === saved.role.id ? { ...role, assignmentCount: role.assignmentCount + 1 } : role))
      setUsername(""); setAssignmentRoleId(""); setAssignmentScopeId("")
      setMessage("角色已分配")
    } catch (reason) { setError(apiMessage(reason, "角色分配失败，请核对用户名与作用域。")) } finally { endBusy() }
  }

  async function revokeAssignment(assignment: AuthorizationRoleAssignment) {
    if (!beginBusy()) return
    setError(""); setMessage("")
    try {
      await deleteAuthorizationAssignment(assignment.id, csrfToken)
      setAssignments((values) => values.filter((value) => value.id !== assignment.id))
      setRoles((values) => values.map((role) => role.id === assignment.role.id ? { ...role, assignmentCount: Math.max(0, role.assignmentCount - 1) } : role))
      setMessage("角色分配已撤销")
      setConfirmation(null)
    } catch (reason) { setError(apiMessage(reason, "撤销失败，请稍后重试。")) } finally { endBusy() }
  }

  async function loadMore() {
    if (!nextCursor || !beginBusy()) return
    setError("")
    try {
      const page = await listAuthorizationAssignments({ cursor: nextCursor, limit: 50 })
      setAssignments((values) => [...values, ...page.assignments])
      setNextCursor(page.nextCursor)
    } catch (reason) { setError(apiMessage(reason, "更多角色分配加载失败。")) } finally { endBusy() }
  }

  if (loading) return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" /><span>正在读取角色与权限</span></div>

  return (
    <div className="admin-panel authorization-admin-panel">
      <div className="admin-panel__heading">
        <div><p>访问控制</p><h2>角色与权限</h2></div>
        <button className="secondary-button" type="button" onClick={() => void loadData()} disabled={busy}><RefreshCw size={14} aria-hidden="true" />刷新</button>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}

      <section className="authorization-section" aria-labelledby="authorization-role-heading">
        <div className="admin-form__heading"><h3 id="authorization-role-heading">角色目录</h3><span className="admin-badge">{roles.length} 个角色</span></div>
        <div className="authorization-role-list">
          {roles.map((role) => (
            <article className="authorization-role-row" key={role.id}>
              <div><strong>{role.name}</strong><span>{role.key} · {scopeLabel(role.scope)} · {role.permissionKeys.length} 项权限 · {role.assignmentCount} 个分配</span></div>
              <div>
                {role.isSystem ? <span className="admin-badge"><ShieldCheck size={13} aria-hidden="true" />系统只读</span> : <>
                  <button className="icon-button" type="button" onClick={() => editRole(role)} aria-label={`编辑角色：${role.name}`} title="编辑"><Pencil size={15} /></button>
                  <button className="icon-button" type="button" onClick={(event) => { confirmationReturnFocusRef.current = event.currentTarget; setConfirmation({ kind: "role", role }) }} disabled={role.assignmentCount > 0 || busy} aria-label={`删除角色：${role.name}`} title={role.assignmentCount > 0 ? "请先撤销全部分配" : "删除"}><Trash2 size={15} /></button>
                </>}
              </div>
            </article>
          ))}
        </div>

        <form className="admin-form authorization-role-form" onSubmit={saveRole}>
          <div className="admin-form__heading"><h3>{editingRoleId ? "编辑自定义角色" : "新建自定义角色"}</h3>{editingRoleId && <button className="icon-button" type="button" onClick={cancelRoleEdit} aria-label="取消编辑角色" title="取消"><X size={15} /></button>}</div>
          <div className="admin-form__grid">
            <label><span>角色键</span><input value={roleDraft.key} onChange={(event) => setRoleDraft({ ...roleDraft, key: event.target.value })} pattern="[a-z][a-z0-9_]{2,63}" required disabled={Boolean(editingRoleId)} /></label>
            <label><span>角色名称</span><input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} maxLength={80} required /></label>
          </div>
          <label><span>作用域</span><select value={roleDraft.scope} onChange={(event) => setRoleDraft({ ...roleDraft, scope: event.target.value as AuthorizationRoleScope })} disabled={Boolean(editingRoleId)}><option value="instance">实例</option><option value="site">站点</option><option value="board">板块</option></select></label>
          <fieldset className="authorization-permission-fieldset"><legend>权限清单</legend><div className="authorization-permission-grid">{permissions.map((permission) => <label key={permission.key}><input type="checkbox" aria-label={`${permission.name} ${permission.key}`} checked={roleDraft.permissionKeys.includes(permission.key)} onChange={(event) => setRoleDraft((current) => ({ ...current, permissionKeys: event.target.checked ? [...current.permissionKeys, permission.key] : current.permissionKeys.filter((key) => key !== permission.key) }))} /><span><strong>{permission.name} {permission.key}</strong><small>{permission.description}</small></span></label>)}</div></fieldset>
          <button className="primary-button" type="submit" disabled={busy || roleDraft.permissionKeys.length === 0}>{busy ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : editingRoleId ? <Save size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}{editingRoleId ? "保存角色" : "创建角色"}</button>
        </form>
      </section>

      <section className="authorization-section" aria-labelledby="authorization-assignment-heading">
        <div className="admin-form__heading"><h3 id="authorization-assignment-heading">角色分配</h3><span className="admin-badge">{assignments.length} 条</span></div>
        <form className="admin-form authorization-assignment-form" onSubmit={assignRole}>
          <div className="admin-form__grid">
            <label><span>用户名（精确匹配）</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" required /></label>
            <label><span>自定义角色</span><select value={assignmentRoleId} onChange={(event) => { setAssignmentRoleId(event.target.value); setAssignmentScopeId("") }} required><option value="">请选择</option>{customRoles.map((role) => <option key={role.id} value={role.id}>{role.name}（{scopeLabel(role.scope)}）</option>)}</select></label>
          </div>
          {selectedAssignmentRole?.scope === "board" && <label><span>作用板块</span>{boards.length > 0
            ? <select value={assignmentScopeId} onChange={(event) => setAssignmentScopeId(event.target.value)} required><option value="">请选择板块</option>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select>
            : <input value={assignmentScopeId} onChange={(event) => setAssignmentScopeId(event.target.value)} placeholder="板块 UUID" pattern="[0-9a-fA-F-]{36}" required />}</label>}
          <button className="primary-button" type="submit" disabled={busy || !selectedAssignmentRole || (selectedAssignmentRole.scope === "board" && !assignmentScopeId)}><UserPlus size={15} aria-hidden="true" />分配角色</button>
        </form>
        {assignments.length === 0 ? <div className="admin-empty" role="status"><KeyRound size={21} aria-hidden="true" /><span>暂无自定义角色分配</span></div> : <div className="authorization-assignment-list">{assignments.map((assignment) => <article className="authorization-assignment-row" key={assignment.id}><div><strong>{assignment.user.username}</strong><span>{assignment.user.displayName} · {assignment.role.name} · {assignment.scopeId ? boardName(boards, assignment.scopeId) : scopeLabel(assignment.role.scope)}</span></div><button className="secondary-button" type="button" onClick={(event) => { confirmationReturnFocusRef.current = event.currentTarget; setConfirmation({ kind: "assignment", assignment }) }} disabled={busy}><Trash2 size={14} aria-hidden="true" />撤销</button></article>)}</div>}
        {nextCursor && <button className="secondary-button authorization-load-more" type="button" onClick={() => void loadMore()} disabled={busy}>加载更多分配</button>}
      </section>
      {confirmation && <ConfirmDialog
        title={confirmation.kind === "role" ? `删除角色“${confirmation.role.name}”` : "撤销角色分配"}
        confirmLabel={confirmation.kind === "role" ? "确认删除角色" : "确认撤销角色"}
        busy={busy}
        returnFocus={confirmationReturnFocusRef.current}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation.kind === "role") void removeRole(confirmation.role)
          else void revokeAssignment(confirmation.assignment)
        }}
      >
        <p>{confirmation.kind === "role"
          ? "删除后该自定义角色将无法继续分配；已有分配必须先撤销。"
          : `将撤销 ${confirmation.assignment.user.username} 的“${confirmation.assignment.role.name}”角色分配。`}</p>
      </ConfirmDialog>}
    </div>
  )
}

function scopeLabel(scope: AuthorizationRoleScope) { return scope === "instance" ? "实例" : scope === "site" ? "站点" : "板块" }
function boardName(boards: AdminBoard[], boardId: string) { return boards.find((board) => board.id === boardId)?.name ?? "未知板块" }
function apiMessage(reason: unknown, fallback: string) { return reason instanceof AdminApiError ? reason.message : fallback }
