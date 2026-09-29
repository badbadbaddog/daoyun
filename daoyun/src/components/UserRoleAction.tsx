import { LoaderCircle, LockKeyhole } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  AdminApiError, createAuthorizationAssignment, deleteAuthorizationAssignment,
  listAuthorizationAssignments, listAuthorizationRoles,
  type AdminBoard, type AuthorizationRole, type AuthorizationRoleAssignment,
} from "../api/admin"
import type { AdminUserDetail, AdminUserRole } from "../api/adminUsers"
import { ConfirmDialog } from "./ui/ConfirmDialog"

interface UserRoleActionProps {
  detail: AdminUserDetail
  csrfToken: string
  boards: AdminBoard[]
  onRolesUpdated: (roles: AdminUserRole[]) => void
}

const assignmentKey = (roleId: string, scopeId: string | null) => roleId + ":" + (scopeId ?? "")
const scopeLabel = (scope: AdminUserRole["scope"]) => scope === "board" ? "板块范围" : scope === "site" ? "站点范围" : "实例范围"

export function UserRoleAction({ detail, csrfToken, boards, onRolesUpdated }: UserRoleActionProps) {
  const [roles, setRoles] = useState<AuthorizationRole[]>([])
  const [assignments, setAssignments] = useState<AuthorizationRoleAssignment[]>([])
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const request = useRef<AbortController | null>(null)
  const requestPending = useRef(false)
  const preserveDraft = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)

  async function load(keepDraft = false) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setLoadError(false)
    try {
      const loadedRoles = await listAuthorizationRoles(controller.signal)
      const loaded: AuthorizationRoleAssignment[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await listAuthorizationAssignments({ username: detail.username, cursor, limit: 50, signal: controller.signal })
        if (controller.signal.aborted) return null
        loaded.push(...page.assignments.filter(item => item.user.id === detail.id && !loaded.some(existing => existing.id === item.id)))
        cursor = page.nextCursor ?? undefined
        if (cursor && cursors.has(cursor)) throw new Error("重复的角色分配游标")
        if (cursor) cursors.add(cursor)
      } while (cursor)
      setRoles(loadedRoles); setAssignments(loaded)
      if (!keepDraft) setDraft(new Set(loaded.filter(item => !item.role.isSystem).map(item => assignmentKey(item.role.id, item.scopeId))))
      return loaded
    } catch (reason) {
      if (!controller.signal.aborted) {
        setLoadError(true)
        setError(reason instanceof AdminApiError ? reason.message : "角色信息暂时无法加载，请重试")
      }
      return null
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    preserveDraft.current = false
    void load()
    return () => request.current?.abort()
  }, [detail.id, detail.username])

  const systemRoles = [...roles.filter(role => role.isSystem), ...detail.roles.filter(role => role.isSystem && !roles.some(item => item.id === role.id))]
  const choices: Array<{ role: AdminUserRole; scopeId: string | null; label: string }> = roles.filter(role => !role.isSystem).flatMap<{ role: AdminUserRole; scopeId: string | null; label: string }>(role =>
    role.scope === "board"
      ? boards.map(board => ({ role, scopeId: board.id, label: role.name + " · " + board.name }))
      : [{ role, scopeId: null, label: role.name }],
  )
  for (const item of assignments) {
    if (!item.role.isSystem && !choices.some(choice => assignmentKey(choice.role.id, choice.scopeId) === assignmentKey(item.role.id, item.scopeId))) {
      choices.push({ role: item.role, scopeId: item.scopeId, label: item.role.name + (item.scopeId ? " · 板块 " + item.scopeId : "") })
    }
  }
  const assignedKeys = new Set(assignments.map(item => assignmentKey(item.role.id, item.scopeId)))
  const additions = choices.filter(choice => draft.has(assignmentKey(choice.role.id, choice.scopeId)) && !assignedKeys.has(assignmentKey(choice.role.id, choice.scopeId)))
  const removals = assignments.filter(item => !item.role.isSystem && !draft.has(assignmentKey(item.role.id, item.scopeId)))
  const changeCount = additions.length + removals.length
  const busy = loading || submitting || confirming

  function publishRoles(current: AuthorizationRoleAssignment[]) {
    const unique = new Map<string, AdminUserRole>()
    for (const role of [...detail.roles.filter(role => role.isSystem), ...current.map(item => item.role)]) unique.set(role.id, role)
    onRolesUpdated([...unique.values()])
  }

  async function save() {
    if (requestPending.current || loading || loadError || !changeCount) return
    requestPending.current = true
    setSubmitting(true); setError(""); setMessage("")
    let current = [...assignments]
    let saved = 0
    try {
      // Existing endpoints commit one assignment at a time; preserve each successful result.
      for (const choice of additions) {
        const created = await createAuthorizationAssignment({ username: detail.username, roleId: choice.role.id, scopeId: choice.scopeId }, csrfToken)
        current = [...current, created]; saved += 1; setAssignments(current)
      }
      for (const item of removals) {
        await deleteAuthorizationAssignment(item.id, csrfToken)
        current = current.filter(existing => existing.id !== item.id); saved += 1; setAssignments(current)
      }
      publishRoles(current)
      setDraft(new Set(current.filter(item => !item.role.isSystem).map(item => assignmentKey(item.role.id, item.scopeId))))
      preserveDraft.current = false
      setMessage("角色已保存")
    } catch (reason) {
      preserveDraft.current = true
      const refreshed = await load(true)
      publishRoles(refreshed ?? current)
      const explanation = reason instanceof AdminApiError ? reason.message : "保存未完成，请重试剩余更改"
      setError((saved ? "已保存 " + saved + " 项。" : "") + explanation + (refreshed ? "" : "；请先重新读取角色数据"))
    } finally {
      requestPending.current = false
      setSubmitting(false); setConfirming(false)
    }
  }

  return <div className="user-role-editor">
    {loading && <p className="user-role-feedback" role="status"><LoaderCircle size={14} className="topic-loading__spinner" aria-hidden="true" />正在读取角色</p>}
    {loadError && <button className="secondary-button" type="button" disabled={submitting} onClick={() => { setError(""); void load(preserveDraft.current).then(loaded => { if (loaded && preserveDraft.current) publishRoles(loaded) }) }}>重试角色数据</button>}
    {!loading && !loadError && <>
      <form onSubmit={event => { event.preventDefault(); if (!busy && changeCount) { returnFocus.current = document.activeElement as HTMLElement; setConfirming(true) } }}>
        <fieldset disabled={busy} className="user-role-options">
          <legend className="sr-only">权限角色选择</legend>
          {systemRoles.map(role => <label key={role.id} className="user-role-option user-role-option--system"><input type="checkbox" checked={detail.roles.some(item => item.id === role.id) || assignments.some(item => item.role.id === role.id)} disabled aria-label={role.name} /><span>{role.name}<small><LockKeyhole size={10} aria-hidden="true" />系统角色</small></span></label>)}
          {choices.map(choice => {
            const key = assignmentKey(choice.role.id, choice.scopeId)
            return <label key={key} className="user-role-option"><input type="checkbox" aria-label={choice.label} checked={draft.has(key)} onChange={event => { const checked = event.target.checked; setDraft(current => { const next = new Set(current); if (checked) next.add(key); else next.delete(key); return next }); setMessage(""); setError("") }} /><span>{choice.label}<small>{scopeLabel(choice.role.scope)}</small></span></label>
          })}
        </fieldset>
        {!choices.length && <p className="user-role-feedback">暂无可分配的自定义角色</p>}
        {roles.some(role => !role.isSystem && role.scope === "board") && !boards.length && <p className="user-role-feedback">没有可选择的板块</p>}
        <p className="user-role-hint">可同时拥有多个权限角色，保存后生效。</p>
        <div className="user-role-actions"><span>{changeCount ? "已更改 " + changeCount + " 项" : "未修改"}</span><button className="secondary-button" type="button" disabled={busy || !changeCount} onClick={() => { setDraft(new Set(assignments.filter(item => !item.role.isSystem).map(item => assignmentKey(item.role.id, item.scopeId)))); setError(""); setMessage("") }}>撤销更改</button><button className="primary-button" type="submit" disabled={busy || !changeCount}>保存角色</button></div>
      </form>
    </>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    {message && <p className="admin-success" role="status">{message}</p>}
    {confirming && <ConfirmDialog title="确认角色变更" confirmLabel="确认保存角色" danger={removals.length > 0} busy={submitting} returnFocus={returnFocus.current} onCancel={() => setConfirming(false)} onConfirm={() => void save()}>
      <p>将更新 {detail.displayName} 的权限角色。</p>
      {additions.length > 0 && <div><strong>新增 {additions.length} 项</strong><ul>{additions.map(choice => <li key={assignmentKey(choice.role.id, choice.scopeId)}>{choice.label}</li>)}</ul></div>}
      {removals.length > 0 && <div><strong>移除 {removals.length} 项</strong><ul>{removals.map(item => <li key={item.id}>{choices.find(choice => assignmentKey(choice.role.id, choice.scopeId) === assignmentKey(item.role.id, item.scopeId))?.label ?? item.role.name}</li>)}</ul></div>}
      <p>已保存的角色变更会立即生效。</p>
    </ConfirmDialog>}
  </div>
}
