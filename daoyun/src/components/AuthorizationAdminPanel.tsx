import { ArrowLeft, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react"
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
import { AdminActionDialog } from "./admin/AdminActionDialog"

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
  const [view, setView] = useState<"roles" | "assignments" | "edit">("roles")
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [roleQuery, setRoleQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [permissionQuery, setPermissionQuery] = useState("")
  const [permissionSection, setPermissionSection] = useState("")
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
  const editingRole = roles.find((role) => role.id === editingRoleId)
  const readOnlyRole = Boolean(editingRole?.isSystem)
  const visibleRoles = roles.filter((role) => `${role.name} ${role.key}`.toLocaleLowerCase().includes(roleQuery.trim().toLocaleLowerCase()) && (roleFilter === "all" || (roleFilter === "system" ? role.isSystem : !role.isSystem)))
  const permissionGroups = ["内容与版块", "用户与权限", "社区运营", "站点与系统"].filter((group) => permissions.some((permission) => permissionGroup(permission.key) === group))
  const activePermissionGroup = permissionGroups.find((group) => group === permissionSection) ?? permissionGroups[0]
  const visiblePermissions = permissions.filter((permission) => permissionQuery.trim()
    ? `${permission.name} ${permission.description} ${permission.key}`.toLocaleLowerCase().includes(permissionQuery.trim().toLocaleLowerCase())
    : permissionGroup(permission.key) === activePermissionGroup)

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
    if (readOnlyRole || !beginBusy()) return
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
        try {
          const latestRoles = await listAuthorizationRoles()
          setRoles(latestRoles)
          if (editingRoleId && !latestRoles.some((role) => role.id === editingRoleId)) {
            setError("该角色已不存在，请取消编辑后刷新角色目录。")
          } else {
            setMessage("角色已被其他管理员更新，最新 revision 已刷新；本地草稿已保留，请确认后重新保存。")
          }
        } catch (refreshReason) {
          setError(apiMessage(refreshReason, "角色已发生冲突，但最新角色数据暂时无法加载。"))
        }
      } else {
        setError(apiMessage(reason, "角色保存失败，请稍后重试。"))
      }
    } finally { endBusy() }
  }

  function editRole(role: AuthorizationRole) {
    setPermissionQuery("")
    setPermissionSection("")
    setView("edit")
    setEditingRoleId(role.id)
    setRoleDraft({ key: role.key, name: role.name, scope: role.scope, permissionKeys: [...role.permissionKeys] })
    setError(""); setMessage("")
  }

  function cancelRoleEdit() {
    setView("roles")
    setEditingRoleId(null)
    setRoleDraft(emptyRole)
    setPermissionQuery("")
    setPermissionSection("")
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
      setAssignmentOpen(false)
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
    <div className={`admin-panel authorization-admin-panel authorization-admin-panel--focused admin-catalog${view === "edit" ? " authorization-admin-panel--editing" : ""}`}>
      <h2 className="sr-only">角色与权限</h2>
      {view !== "edit" ? <nav className="admin-catalog-tabs" aria-label="权限管理分类">
        <button type="button" aria-pressed={view === "roles"} onClick={() => setView("roles")}>角色目录<span>{roles.length}</span></button>
        <button type="button" aria-pressed={view === "assignments"} onClick={() => setView("assignments")}>人员授权</button>
        <button className="admin-catalog-refresh" type="button" onClick={() => void loadData()} disabled={busy} aria-label="刷新角色与权限" title="刷新"><RefreshCw size={16} aria-hidden="true" /></button>
      </nav> : <div className="admin-role-editor-heading"><button className="secondary-button" type="button" disabled={busy} onClick={cancelRoleEdit}><ArrowLeft size={15} aria-hidden="true" />返回角色目录</button><span>{readOnlyRole ? "系统角色 · 只读" : editingRoleId ? "编辑角色" : "新建角色"}</span></div>}
      {error && !assignmentOpen && !confirmation && <p className="form-alert" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
      {view === "roles" && <section className="authorization-section" aria-label="角色目录">
        <div className="admin-catalog-toolbar">
          <label className="admin-catalog-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索角色" placeholder="搜索角色名称或标识" value={roleQuery} onChange={(event) => setRoleQuery(event.target.value)} /></label>
          <select aria-label="角色类型" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">全部角色</option><option value="system">系统角色</option><option value="custom">自定义角色</option></select>
          <button className="primary-button" type="button" onClick={() => { setRoleDraft(emptyRole); setEditingRoleId(null); setPermissionQuery(""); setPermissionSection(""); setError(""); setMessage(""); setView("edit") }}><Plus size={16} aria-hidden="true" />新建角色</button>
        </div>
        <div className="authorization-role-columns" aria-hidden="true"><span>角色名称</span><span>作用范围</span><span>权限</span><span>授权人数</span><span>操作</span></div>
        <div className="authorization-role-list">
          {visibleRoles.map((role) => <article className="authorization-role-row" key={role.id}>
            <div className="authorization-role-identity"><span className={`authorization-role-icon${role.isSystem ? " authorization-role-icon--system" : ""}`} aria-hidden="true">{role.isSystem ? <ShieldCheck size={19} /> : <KeyRound size={19} />}</span><div><strong>{role.name}</strong><span>{role.isSystem ? "系统内置" : "自定义角色"} · {role.key}</span></div></div>
            <span className="authorization-role-scope">{scopeLabel(role.scope)}</span>
            <span className="authorization-role-count">{role.permissionKeys.length}<small> 项权限</small></span>
            <span className="authorization-role-count">{role.assignmentCount}<small> 个分配</small></span>
            <div className="authorization-role-actions">
              {role.isSystem ? <button className="admin-text-button" type="button" onClick={() => editRole(role)} aria-label={`查看权限：${role.name}`}>查看权限</button> : <>
                <button className="admin-text-button" type="button" onClick={() => editRole(role)} aria-label={`编辑角色：${role.name}`}><Pencil size={14} aria-hidden="true" />编辑权限</button>
                <button className="icon-button" type="button" onClick={(event) => { confirmationReturnFocusRef.current = event.currentTarget; setError(""); setConfirmation({ kind: "role", role }) }} disabled={role.assignmentCount > 0 || busy} aria-label={`删除角色：${role.name}`} title={role.assignmentCount > 0 ? "请先撤销全部分配" : "删除角色"}><Trash2 size={15} aria-hidden="true" /></button>
              </>}
            </div>
          </article>)}
        </div>
        {visibleRoles.length === 0 && <p className="admin-empty" role="status">没有匹配的角色，请调整搜索或筛选条件。</p>}
        <footer className="admin-catalog-footer"><span>共 {roles.length} 个角色 · {customRoles.length} 个自定义</span><span>系统角色可查看，自定义角色可编辑与分配。</span></footer>
      </section>}
      {view === "edit" && <section className="authorization-section authorization-editor">
        <form className="admin-form authorization-role-form" onSubmit={saveRole}>
          <div className="authorization-editor-intro"><h3>{readOnlyRole ? editingRole?.name : editingRoleId ? "编辑自定义角色" : "新建自定义角色"}</h3><p>{readOnlyRole ? "系统预设权限仅供查看，不能在这里修改。" : "先定义角色与作用范围，再选择需要的权限。创建后可在人员授权中分配给成员。"}</p></div>
          <fieldset className="authorization-basic-fields" disabled={busy || readOnlyRole}>
            <legend>基本信息</legend>
            <div className="admin-form__grid"><label><span>角色名称</span><input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} maxLength={80} required placeholder="例如：内容审核员" /></label><label><span>角色键</span><input aria-label="角色键" value={roleDraft.key} onChange={(event) => setRoleDraft({ ...roleDraft, key: event.target.value })} pattern="[a-z][a-z0-9_]{2,63}" required disabled={Boolean(editingRoleId)} placeholder="content_reviewer" /><small>英文标识，创建后不可修改。</small></label></div>
            <label><span>作用域</span><select aria-label="作用域" value={roleDraft.scope} onChange={(event) => setRoleDraft({ ...roleDraft, scope: event.target.value as AuthorizationRoleScope })} disabled={Boolean(editingRoleId)}><option value="instance">实例</option><option value="site">站点</option><option value="board">板块</option></select><small>{roleDraft.scope === "board" ? "授权时选择具体板块，权限仅在该板块生效。" : "授权后在对应管理范围内生效，请按实际职责分配。"}</small></label>
          </fieldset>
          <fieldset className="authorization-permission-fieldset">
            <legend>权限清单 <span>已选择 {roleDraft.permissionKeys.length} 项</span></legend>
            <div className="authorization-permission-browser">
              <nav aria-label="权限分类" className="authorization-permission-nav">{permissionGroups.map((group) => <button key={group} type="button" aria-pressed={!permissionQuery && activePermissionGroup === group} onClick={() => { setPermissionSection(group); setPermissionQuery("") }}>{group}<span>{permissions.filter((permission) => permissionGroup(permission.key) === group && roleDraft.permissionKeys.includes(permission.key)).length} / {permissions.filter((permission) => permissionGroup(permission.key) === group).length}</span></button>)}</nav>
              <div className="authorization-permission-content">
                <label className="admin-catalog-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="搜索权限" placeholder="搜索全部权限" value={permissionQuery} onChange={(event) => setPermissionQuery(event.target.value)} /></label>
                {!readOnlyRole && visiblePermissions.length > 0 && <label className="authorization-select-group"><input type="checkbox" disabled={busy} checked={visiblePermissions.every((permission) => roleDraft.permissionKeys.includes(permission.key))} onChange={(event) => setRoleDraft((current) => ({ ...current, permissionKeys: event.target.checked ? [...new Set([...current.permissionKeys, ...visiblePermissions.map((permission) => permission.key)])] : current.permissionKeys.filter((key) => !visiblePermissions.some((permission) => permission.key === key)) }))} /><span>选择当前显示的 {visiblePermissions.length} 项权限</span></label>}
                <div className="authorization-permission-grid">{visiblePermissions.map((permission) => <label key={permission.key} className={roleDraft.permissionKeys.includes(permission.key) ? "is-selected" : ""}><input type="checkbox" disabled={busy || readOnlyRole} aria-label={`${permission.name} ${permission.key}`} checked={roleDraft.permissionKeys.includes(permission.key)} onChange={(event) => setRoleDraft((current) => ({ ...current, permissionKeys: event.target.checked ? [...current.permissionKeys, permission.key] : current.permissionKeys.filter((key) => key !== permission.key) }))} /><span><strong title={permission.key}>{permission.name}</strong><small>{permission.description}</small></span></label>)}</div>
                {visiblePermissions.length === 0 && <p className="admin-empty">没有匹配的权限。</p>}
              </div>
            </div>
          </fieldset>
          <div className="admin-editor-footer"><span>{readOnlyRole ? "系统角色只读" : `已选择 ${roleDraft.permissionKeys.length} 项权限`}</span><button className="secondary-button" type="button" onClick={cancelRoleEdit} disabled={busy}>{readOnlyRole ? "返回" : "取消"}</button>{!readOnlyRole && <button className="primary-button" type="submit" disabled={busy || roleDraft.permissionKeys.length === 0}>{busy ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}{editingRoleId ? "保存角色" : "创建角色"}</button>}</div>
        </form>
      </section>}

      {view === "assignments" && <section className="authorization-section" aria-labelledby="authorization-assignment-heading">
        <div className="admin-form__heading"><h3 id="authorization-assignment-heading">角色分配</h3><span className="admin-badge">{assignments.length} 条</span><button className="primary-button" type="button" onClick={() => setAssignmentOpen(true)}><UserPlus size={15} aria-hidden="true" />新增授权</button></div>
        {assignmentOpen && <AdminActionDialog title="分配角色" onClose={() => setAssignmentOpen(false)} busy={busy}>
        {error && <p className="form-alert" role="alert">{error}</p>}
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
        </AdminActionDialog>}
        {assignments.length === 0 ? <div className="admin-empty" role="status"><KeyRound size={21} aria-hidden="true" /><span>暂无自定义角色分配</span></div> : <div className="authorization-assignment-list">{assignments.map((assignment) => <article className="authorization-assignment-row" key={assignment.id}><div><strong>{assignment.user.username}</strong><span>{assignment.user.displayName} · {assignment.role.name} · {assignment.scopeId ? boardName(boards, assignment.scopeId) : scopeLabel(assignment.role.scope)}</span></div><button className="secondary-button" type="button" onClick={(event) => { confirmationReturnFocusRef.current = event.currentTarget; setConfirmation({ kind: "assignment", assignment }) }} disabled={busy}><Trash2 size={14} aria-hidden="true" />撤销</button></article>)}</div>}
        {nextCursor && <button className="secondary-button authorization-load-more" type="button" onClick={() => void loadMore()} disabled={busy}>加载更多分配</button>}
      </section>}
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
        {error && <p className="form-alert" role="alert">{error}</p>}
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

function permissionGroup(key: string) {
  if (/^(moderation\.|content\.|reports?\.|boards?\.|governance\.|admin\.(boards|reports)\.)/.test(key)) return "内容与版块"
  if (/^(authorization\.|admin\.users\.)/.test(key)) return "用户与权限"
  if (/^(membership\.|community\.|points\.|medals?\.|entitlements?\.|growth\.)/.test(key)) return "社区运营"
  return "站点与系统"
}
