import { ArrowLeft, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  AdminApiError,
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
import { TeamAppointmentForm } from "./TeamAppointmentForm"
import { authorizationRoleTemplates, isHighRiskAuthorizationPermission } from "../features/authorization/roleTemplates"

interface AuthorizationAdminPanelProps {
  csrfToken: string
  boards: AdminBoard[]
  capabilityKeys: string[]
  query?: string
  onQueryChange?: (query: string) => void
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

export function AuthorizationAdminPanel({ csrfToken, boards, capabilityKeys, query = "", onQueryChange }: AuthorizationAdminPanelProps) {
  const [filters, setFilters] = useState(() => teamFilters(query))
  const [usernameFilterDraft, setUsernameFilterDraft] = useState(filters.username)
  const [view, setView] = useState<"roles" | "assignments" | "edit">(() => query ? "assignments" : "roles")
  const canReadRoles = capabilityKeys.includes("authorization.roles.read")
  const canReadAssignments = capabilityKeys.includes("authorization.assignments.read")
  const canWriteRoles = canReadRoles && capabilityKeys.includes("authorization.roles.write")
  const canWriteAssignments = canReadAssignments && capabilityKeys.includes("authorization.assignments.write")
  const canSearchUsers = capabilityKeys.includes("admin.users.read")
  const canAppoint = canReadRoles && canWriteAssignments && canSearchUsers
  const requestRef = useRef<AbortController | null>(null)
  const listingKey = filters.scopeId + ":" + filters.roleId + ":" + filters.username
  const listingKeyRef = useRef(listingKey)
  listingKeyRef.current = listingKey
  useEffect(() => { const incoming = teamFilters(query); setFilters(incoming); setUsernameFilterDraft(incoming.username); if (query) setView("assignments") }, [query])
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
  const [templateKey, setTemplateKey] = useState("")
  const [roleConfirmation, setRoleConfirmation] = useState<{ draft: RoleDraft; roleId: string | null; revision?: number; changedRisk: string[] } | null>(null)
  const [confirmation, setConfirmation] = useState<AuthorizationConfirmation | null>(null)
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null)
  const busyRef = useRef(false)
  const assignmentTriggerRef = useRef<HTMLButtonElement | null>(null)
  const assignmentFocusPendingRef = useRef(false)

  const loadData = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const signal = controller.signal
    setLoading(true)
    setError("")
    setAssignments([]); setNextCursor(null)
    if (!canReadRoles) {
      setRoles([]); setPermissions([]); setEditingRoleId(null); setRoleDraft(emptyRole); setTemplateKey("")
      setView(current => current === "edit" ? "roles" : current)
    }
    try {
      const [loadedPermissions, loadedRoles, loadedAssignments] = await Promise.all([
        canReadRoles ? listAuthorizationPermissions(signal) : Promise.resolve([]),
        canReadRoles ? listAuthorizationRoles(signal) : Promise.resolve([]),
        canReadAssignments ? listAuthorizationAssignments({ limit: 50, signal, scopeId: filters.scopeId || undefined, roleId: filters.roleId || undefined, username: filters.username || undefined }) : Promise.resolve({ assignments: [], nextCursor: null }),
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
  }, [canReadRoles, canReadAssignments, filters.scopeId, filters.roleId, filters.username])

  useEffect(() => {
    void loadData()
    return () => requestRef.current?.abort()
  }, [loadData])
  useEffect(() => {
    if (!canWriteRoles) setRoleConfirmation(null)
    setConfirmation(current => current && (current.kind === "role" ? !canWriteRoles : !canWriteAssignments) ? null : current)
    if (!canAppoint) setAssignmentOpen(false)
  }, [canWriteRoles, canWriteAssignments, canAppoint])

  useEffect(() => {
    if (!assignmentFocusPendingRef.current || loading || busy || assignmentOpen) return
    assignmentFocusPendingRef.current = false
    const trigger = assignmentTriggerRef.current
    if (trigger?.isConnected && !trigger.disabled) trigger.focus()
  }, [loading, busy, assignmentOpen, view])

  const customRoles = useMemo(() => roles.filter((role) => !role.isSystem), [roles])
  const editingRole = roles.find((role) => role.id === editingRoleId)
  const readOnlyRole = Boolean(editingRole?.isSystem) || !canWriteRoles
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

  function saveRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (readOnlyRole || busyRef.current) return
    const current = roles.find(role => role.id === editingRoleId)
    const previousKeys = current?.permissionKeys ?? []
    const changedRisk = [...new Set([...previousKeys, ...roleDraft.permissionKeys])].filter(key => isHighRiskAuthorizationPermission(key) && previousKeys.includes(key) !== roleDraft.permissionKeys.includes(key))
    const change = { draft: { ...roleDraft, permissionKeys: [...roleDraft.permissionKeys] }, roleId: editingRoleId, revision: current?.revision, changedRisk }
    if (changedRisk.length > 0) {
      confirmationReturnFocusRef.current = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')
      setRoleConfirmation(change)
    } else void persistRole(change)
  }

  async function persistRole(change: { draft: RoleDraft; roleId: string | null; revision?: number }) {
    if (!canWriteRoles || readOnlyRole || !beginBusy()) return
    const draft = change.draft
    setError(""); setMessage("")
    try {
      if (change.roleId) {
        if (!change.revision) throw new Error("role disappeared")
        const saved = await updateAuthorizationRole(change.roleId, { name: draft.name.trim(), permissionKeys: draft.permissionKeys, expectedRevision: change.revision }, csrfToken)
        setRoles(values => values.map(role => role.id === saved.id ? saved : role))
        setMessage("角色已保存")
      } else {
        const saved = await createAuthorizationRole({ key: draft.key.trim(), name: draft.name.trim(), scope: draft.scope, permissionKeys: draft.permissionKeys }, csrfToken)
        setRoles(values => [...values, saved])
        setMessage("角色已创建")
      }
      setRoleConfirmation(null)
      cancelRoleEdit()
    } catch (reason) {
      if (reason instanceof AdminApiError && reason.code === "authorization.role_conflict") {
        setRoleConfirmation(null)
        try {
          const latestRoles = await listAuthorizationRoles()
          setRoles(latestRoles)
          if (change.roleId && !latestRoles.some(role => role.id === change.roleId)) setError("该角色已不存在，请取消编辑后刷新角色目录。")
          else setMessage("角色已被其他管理员更新，最新 revision 已刷新；本地草稿已保留，请确认后重新保存。")
        } catch (refreshReason) { setError(apiMessage(refreshReason, "角色已发生冲突，但最新角色数据暂时无法加载。")) }
      } else setError(apiMessage(reason, "角色保存失败，请稍后重试。"))
    } finally { endBusy() }
  }

  function chooseTemplate(key: string) {
    if (!canWriteRoles) return
    if (!key) { setTemplateKey(""); return }
    const template = authorizationRoleTemplates.find(template => template.key === key)
    if (!canWriteRoles || !template || !template.permissionKeys.every(key => permissions.some(permission => permission.key === key)) || (editingRoleId && template.scope !== roleDraft.scope)) return
    setTemplateKey(key)
    setRoleDraft(current => ({ ...current, name: template.name, key: current.key || "role_" + crypto.randomUUID().replaceAll("-", ""), scope: editingRoleId ? current.scope : template.scope, permissionKeys: [...template.permissionKeys] }))
    setPermissionQuery(""); setPermissionSection("")
  }

  function editRole(role: AuthorizationRole) {
    setTemplateKey("")
    setPermissionQuery("")
    setPermissionSection("")
    setView("edit")
    setEditingRoleId(role.id)
    setRoleDraft({ key: role.key, name: role.name, scope: role.scope, permissionKeys: [...role.permissionKeys] })
    setError(""); setMessage("")
  }

  function cancelRoleEdit() {
    setTemplateKey(""); setRoleConfirmation(null)
    setView("roles")
    setEditingRoleId(null)
    setRoleDraft(emptyRole)
    setPermissionQuery("")
    setPermissionSection("")
  }

  async function removeRole(role: AuthorizationRole) {
    if (!canWriteRoles || role.isSystem || !beginBusy()) return
    setError(""); setMessage("")
    try {
      await deleteAuthorizationRole(role.id, csrfToken)
      setRoles((values) => values.filter((value) => value.id !== role.id))
      setMessage("角色已删除")
      setConfirmation(null)
    } catch (reason) { setError(apiMessage(reason, "角色删除失败，请稍后重试。")) } finally { endBusy() }
  }

  async function revokeAssignment(assignment: AuthorizationRoleAssignment) {
    if (!canWriteAssignments || assignment.role.isSystem || !beginBusy()) return
    setError(""); setMessage("")
    try {
      await deleteAuthorizationAssignment(assignment.id, csrfToken)
      setAssignments((values) => values.filter((value) => value.id !== assignment.id))
      setRoles((values) => values.map((role) => role.id === assignment.role.id ? { ...role, assignmentCount: Math.max(0, role.assignmentCount - 1) } : role))
      setMessage("角色分配已撤销")
      setConfirmation(null)
    } catch (reason) { setError(apiMessage(reason, "撤销失败，请稍后重试。")) } finally { endBusy() }
  }

  function changeTeamFilters(next: ReturnType<typeof teamFilters>) {
    setFilters(next)
    const params = new URLSearchParams({ view: "assignments" })
    if (next.scopeId) params.set("scope_id", next.scopeId)
    if (next.roleId) params.set("role_id", next.roleId)
    if (next.username) params.set("username", next.username)
    onQueryChange?.(params.toString())
  }

  async function loadMore() {
    if (!nextCursor || !beginBusy()) return
    const key = listingKey
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setError("")
    try {
      const page = await listAuthorizationAssignments({ cursor: nextCursor, limit: 50, scopeId: filters.scopeId || undefined, roleId: filters.roleId || undefined, username: filters.username || undefined, signal: controller.signal })
      if (controller.signal.aborted || listingKeyRef.current !== key) return
      setAssignments(values => [...values, ...page.assignments.filter(assignment => !values.some(value => value.id === assignment.id))])
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (!controller.signal.aborted && listingKeyRef.current === key) setError(apiMessage(reason, "更多角色分配加载失败。"))
    } finally { endBusy() }
  }

  if (loading) return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" /><span>正在读取角色与权限</span></div>

  return (
    <div className={`admin-panel authorization-admin-panel authorization-admin-panel--focused admin-catalog${view === "edit" ? " authorization-admin-panel--editing" : ""}`}>
      <h2 className="sr-only">角色与权限</h2>
      {view !== "edit" ? <nav className="admin-catalog-tabs" aria-label="权限管理分类">
        <button type="button" aria-pressed={view === "roles"} disabled={busy} onClick={() => setView("roles")}>角色目录<span>{canReadRoles ? roles.length : 0}</span></button>
        <button type="button" aria-pressed={view === "assignments"} disabled={busy} onClick={() => setView("assignments")}>人员授权</button>
        <button className="admin-catalog-refresh" type="button" onClick={() => void loadData()} disabled={busy} aria-label="刷新角色与权限" title="刷新"><RefreshCw size={16} aria-hidden="true" /></button>
      </nav> : <div className="admin-role-editor-heading"><button className="secondary-button" type="button" disabled={busy} onClick={cancelRoleEdit}><ArrowLeft size={15} aria-hidden="true" />返回角色目录</button><span>{readOnlyRole ? "角色权限 · 只读" : editingRoleId ? "编辑角色" : "新建角色"}</span></div>}
      {error && !assignmentOpen && !confirmation && <p className="form-alert" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
      <p>管理角色决定治理与后台管理能力。普通社区能力来自用户组和标准权益，账号限制仍优先。</p>
      {view === "roles" && !canReadRoles && <p>没有读取角色与权限的权限。</p>}
      {view === "roles" && canReadRoles && <section className="authorization-section" aria-label="角色目录">
        <div className="admin-catalog-toolbar">
          <label className="admin-catalog-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索角色" placeholder="搜索角色名称或标识" value={roleQuery} onChange={(event) => setRoleQuery(event.target.value)} /></label>
          <select aria-label="角色类型" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">全部角色</option><option value="system">系统角色</option><option value="custom">自定义角色</option></select>
          <button className="primary-button" type="button" disabled={!canWriteRoles || busy} onClick={() => { if (!canWriteRoles) return; setTemplateKey(""); setRoleDraft(emptyRole); setEditingRoleId(null); setPermissionQuery(""); setPermissionSection(""); setError(""); setMessage(""); setView("edit") }}><Plus size={16} aria-hidden="true" />新建角色</button>
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
                <button className="icon-button" type="button" onClick={(event) => { confirmationReturnFocusRef.current = event.currentTarget; setError(""); setConfirmation({ kind: "role", role }) }} disabled={!canWriteRoles || role.assignmentCount > 0 || busy} aria-label={`删除角色：${role.name}`} title={role.assignmentCount > 0 ? "请先撤销全部分配" : "删除角色"}><Trash2 size={15} aria-hidden="true" /></button>
              </>}
            </div>
          </article>)}
        </div>
        {visibleRoles.length === 0 && <p className="admin-empty" role="status">没有匹配的角色，请调整搜索或筛选条件。</p>}
        <footer className="admin-catalog-footer"><span>共 {roles.length} 个角色 · {customRoles.length} 个自定义</span><span>系统角色可查看，自定义角色可编辑与分配。</span></footer>
      </section>}
      {view === "edit" && canReadRoles && <section className="authorization-section authorization-editor">
        <form className="admin-form authorization-role-form" onSubmit={saveRole}>
          <div className="authorization-editor-intro"><h3>{readOnlyRole ? editingRole?.name : editingRoleId ? "编辑自定义角色" : "新建自定义角色"}</h3><p>{readOnlyRole ? "当前角色权限只读，不能在这里修改。" : "先定义角色与作用范围，再选择需要的权限。创建后可在人员授权中分配给成员。"}</p></div>
          <label className="admin-role-template"><span>职务模板</span><select aria-label="职务模板" value={templateKey} disabled={busy || readOnlyRole} onChange={event => chooseTemplate(event.target.value)}>
            <option value="">自定义能力组合</option>{authorizationRoleTemplates.map(template => <option key={template.key} value={template.key} disabled={!template.permissionKeys.every(key => permissions.some(permission => permission.key === key)) || Boolean(editingRoleId && template.scope !== roleDraft.scope)}>{template.name}{template.scope === "board" ? " · 版块职务" : " · 全站职务"}</option>)}
          </select><small>{authorizationRoleTemplates.find(template => template.key === templateKey)?.description ?? "模板只组合现有权限。目录缺少能力或与现有角色范围不同的模板不可用。"}可继续逐项调整权限，系统角色保持只读。</small></label>
          <fieldset className="authorization-basic-fields" disabled={busy || readOnlyRole}>
            <legend>基本信息</legend>
            <div className="admin-form__grid"><label><span>角色名称</span><input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} maxLength={80} required placeholder="例如：内容审核员" /></label><label><span>角色键</span><input aria-label="角色键" value={roleDraft.key} onChange={(event) => setRoleDraft({ ...roleDraft, key: event.target.value })} pattern="[a-z][a-z0-9_]{2,63}" required disabled={Boolean(editingRoleId)} placeholder="content_reviewer" /><small>英文标识，创建后不可修改。</small></label></div>
            <label><span>作用域</span><select aria-label="作用域" value={roleDraft.scope} onChange={(event) => setRoleDraft({ ...roleDraft, scope: event.target.value as AuthorizationRoleScope })} disabled={Boolean(editingRoleId)}><option value="instance">实例</option><option value="site">站点</option><option value="board">板块</option></select><small>{roleDraft.scope === "board" ? "授权时选择仅本版块或包含全部子版块；包含子版块的范围随当前版块树变化，移动版块后重新核验。" : "授权后在对应管理范围内生效，请按实际职责分配。"}</small></label>
          </fieldset>
          <fieldset className="authorization-permission-fieldset">
            <legend>权限清单 <span>已选择 {roleDraft.permissionKeys.length} 项</span></legend>
            <div className="authorization-permission-browser">
              <nav aria-label="权限分类" className="authorization-permission-nav">{permissionGroups.map((group) => <button key={group} type="button" aria-pressed={!permissionQuery && activePermissionGroup === group} onClick={() => { setPermissionSection(group); setPermissionQuery("") }}>{group}<span>{permissions.filter((permission) => permissionGroup(permission.key) === group && roleDraft.permissionKeys.includes(permission.key)).length} / {permissions.filter((permission) => permissionGroup(permission.key) === group).length}</span></button>)}</nav>
              <div className="authorization-permission-content">
                <label className="admin-catalog-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="搜索权限" placeholder="搜索全部权限" value={permissionQuery} onChange={(event) => setPermissionQuery(event.target.value)} /></label>
                {!readOnlyRole && visiblePermissions.length > 0 && <label className="authorization-select-group"><input type="checkbox" disabled={busy} checked={visiblePermissions.every((permission) => roleDraft.permissionKeys.includes(permission.key))} onChange={(event) => setRoleDraft((current) => ({ ...current, permissionKeys: event.target.checked ? [...new Set([...current.permissionKeys, ...visiblePermissions.map((permission) => permission.key)])] : current.permissionKeys.filter((key) => !visiblePermissions.some((permission) => permission.key === key)) }))} /><span>选择当前显示的 {visiblePermissions.length} 项权限</span></label>}
                <div className="authorization-permission-grid" role="region" aria-label="角色权限清单" tabIndex={0}>{visiblePermissions.map((permission) => <label key={permission.key} className={roleDraft.permissionKeys.includes(permission.key) ? "is-selected" : ""}><input type="checkbox" disabled={busy || readOnlyRole} aria-label={`${permission.name} ${permission.key}`} checked={roleDraft.permissionKeys.includes(permission.key)} onChange={(event) => setRoleDraft((current) => ({ ...current, permissionKeys: event.target.checked ? [...current.permissionKeys, permission.key] : current.permissionKeys.filter((key) => key !== permission.key) }))} /><span><strong title={permission.key}>{permission.name}</strong><small>{permission.description}</small></span></label>)}</div>
                {visiblePermissions.length === 0 && <p className="admin-empty">没有匹配的权限。</p>}
              </div>
            </div>
          </fieldset>
          <div className="admin-editor-footer"><span>{readOnlyRole ? "角色权限只读" : `已选择 ${roleDraft.permissionKeys.length} 项权限`}</span><button className="secondary-button" type="button" onClick={cancelRoleEdit} disabled={busy}>{readOnlyRole ? "返回" : "取消"}</button>{!readOnlyRole && <button className="primary-button" type="submit" disabled={busy || roleDraft.permissionKeys.length === 0}>{busy ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}{editingRoleId ? "保存角色" : "创建角色"}</button>}</div>
        </form>
      </section>}

      {view === "assignments" && <section className="authorization-section" aria-labelledby="authorization-assignment-heading">
        <div className="admin-form__heading"><h3 id="authorization-assignment-heading">管理人员</h3><button ref={assignmentTriggerRef} className="primary-button" type="button" disabled={!canAppoint || busy} onClick={() => { if (canAppoint) setAssignmentOpen(true) }}><UserPlus size={15} aria-hidden="true" />新增授权</button></div>
        <form className="admin-team-filters" onSubmit={event => { event.preventDefault(); changeTeamFilters({ ...filters, username: usernameFilterDraft.trim() }) }}>
          <label><span>精确用户名筛选</span><input type="search" value={usernameFilterDraft} maxLength={40} disabled={busy} onChange={event => setUsernameFilterDraft(event.target.value)} /></label>
          <label><span>按职务筛选</span><select value={filters.roleId} disabled={busy} onChange={event => changeTeamFilters({ ...filters, roleId: event.target.value })}><option value="">全部职务</option>{canReadRoles && roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <label><span>按任命版块筛选</span><select value={filters.scopeId} disabled={busy} onChange={event => changeTeamFilters({ ...filters, scopeId: event.target.value })}><option value="">全部范围</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
          <button type="submit" className="secondary-button" disabled={busy}>筛选人员授权</button>
        </form>
        <p>按任命时选择的版块筛选。包含子版的范围按当前树计算；当前版块的祖先任命不会被这个筛选列入。</p>
        {assignmentOpen && canAppoint && <AdminActionDialog title="分配角色" onClose={() => { if (!busyRef.current) setAssignmentOpen(false) }} busy={busy}>
          <TeamAppointmentForm boards={boards} roles={roles} permissions={permissions} csrfToken={csrfToken} initialScopeId={filters.scopeId} canWrite={canWriteAssignments} canSearchUsers={canSearchUsers} onBusyChange={value => { busyRef.current = value; setBusy(value) }} onCreated={() => { assignmentFocusPendingRef.current = true; setAssignmentOpen(false); setMessage("角色已分配"); void loadData() }} />
        </AdminActionDialog>}
        {!canReadAssignments ? <p>没有读取人员授权的权限。</p> : assignments.length === 0 ? <div className="admin-empty" role="status"><KeyRound size={21} aria-hidden="true" /><span>{error ? "人员授权暂不可用，请刷新。" : "没有匹配的人员授权"}</span></div> :
          <div className="authorization-assignment-list">{assignments.map(assignment => <article className="authorization-assignment-row" key={assignment.id}><div><strong>{assignment.user.displayName} @{assignment.user.username}</strong><span>{assignment.role.name} · {assignment.scopeId ? boardName(boards, assignment.scopeId) + " · " + (assignment.scopeMode === "subtree" ? "当前及全部后代" : "仅本版块") : scopeLabel(assignment.role.scope)}</span><small>长期任命</small><small>任命者：{assignment.assignedBy.displayName} @{assignment.assignedBy.username} · {new Date(assignment.createdAt).toLocaleString("zh-CN")}</small></div>
            {assignment.role.isSystem ? <span>系统任命受保护</span> : <button className="secondary-button" type="button" onClick={event => { if (!canWriteAssignments) return; confirmationReturnFocusRef.current = event.currentTarget; setConfirmation({ kind: "assignment", assignment }) }} disabled={!canWriteAssignments || busy}><Trash2 size={14} aria-hidden="true" />撤销</button>}</article>)}</div>}
        <p>当前已加载 {assignments.length} 条任命{nextCursor ? "，还有后续页。" : "。"}角色模板只组合管理能力，不改变会员身份。</p>
        {nextCursor && <button className="secondary-button authorization-load-more" type="button" onClick={() => void loadMore()} disabled={busy}>加载更多分配</button>}
      </section>}
      {canWriteRoles && roleConfirmation && <ConfirmDialog title="确认高危角色变更" confirmLabel="确认保存角色" busy={busy} returnFocus={confirmationReturnFocusRef.current} onCancel={() => { if (!busyRef.current) setRoleConfirmation(null) }} onConfirm={() => void persistRole(roleConfirmation)}>
        <p>角色：{roleConfirmation.draft.name} · {scopeLabel(roleConfirmation.draft.scope)} · {roleConfirmation.roleId ? "当前修订 " + roleConfirmation.revision : "新建角色"}。</p>
        <p>请核对这些高危能力的变化。已任命人员将使用保存后的角色权限，服务器仍检查操作者的授权上限。</p>
        <ul className="admin-team-capability-preview" tabIndex={0} aria-label="高危能力变化">{roleConfirmation.changedRisk.map(key => <li key={key}>{roleConfirmation.draft.permissionKeys.includes(key) ? "新增" : "撤除"}：{permissions.find(permission => permission.key === key)?.name ?? key} · {key}</li>)}</ul>
        {error && <p role="alert" className="form-alert">{error}</p>}
      </ConfirmDialog>}
      {confirmation && (confirmation.kind === "role" ? canReadRoles : canReadAssignments) && <ConfirmDialog
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

function teamFilters(query: string) { const params = new URLSearchParams(query); return { scopeId: params.get("scope_id") ?? "", roleId: params.get("role_id") ?? "", username: params.get("username") ?? "" } }
