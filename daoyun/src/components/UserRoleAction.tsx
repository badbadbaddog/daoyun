import { LoaderCircle, ShieldCheck, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  AdminApiError,
  createAuthorizationAssignment,
  deleteAuthorizationAssignment,
  listAuthorizationAssignments,
  listAuthorizationRoles,
  type AdminBoard,
  type AuthorizationRole,
  type AuthorizationRoleAssignment,
} from "../api/admin"
import type { AdminUserDetail, AdminUserRole } from "../api/adminUsers"
import { ConfirmDialog } from "./ui/ConfirmDialog"

interface UserRoleActionProps {
  detail: AdminUserDetail
  csrfToken: string
  boards: AdminBoard[]
  onRoleAssigned: (role: AdminUserRole) => void
  onRoleRemoved: (roleId: string) => void
}

export function UserRoleAction({ detail, csrfToken, boards, onRoleAssigned, onRoleRemoved }: UserRoleActionProps) {
  const [roles, setRoles] = useState<AuthorizationRole[]>([])
  const [assignments, setAssignments] = useState<AuthorizationRoleAssignment[]>([])
  const [roleId, setRoleId] = useState("")
  const [scopeId, setScopeId] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [pendingRemoval, setPendingRemoval] = useState<AuthorizationRoleAssignment | null>(null)
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    setPendingRemoval(null)
    Promise.all([
      listAuthorizationRoles(controller.signal),
      listAuthorizationAssignments({ username: detail.username, limit: 50, signal: controller.signal }),
    ]).then(([loadedRoles, page]) => {
      if (controller.signal.aborted) return
      setRoles(loadedRoles)
      setAssignments(page.assignments)
      setLoading(false)
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      setError(reason instanceof AdminApiError ? reason.message : "角色信息暂时无法加载")
      setLoading(false)
    })
    return () => controller.abort()
  }, [detail.id, detail.username])

  const assignedRoleIds = useMemo(() => new Set([
    ...detail.roles.map((role) => role.id),
    ...assignments.map((assignment) => assignment.role.id),
  ]), [assignments, detail.roles])
  const availableRoles = useMemo(() => roles.filter((role) => !role.isSystem && !assignedRoleIds.has(role.id)), [assignedRoleIds, roles])
  const selectedRole = roles.find((role) => role.id === roleId) ?? null

  async function assign(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedRole) { setError("请选择要分配的角色"); return }
    if (selectedRole.scope === "board" && !scopeId) { setError("请选择角色生效的板块"); return }
    setSubmitting(true)
    setError("")
    setMessage("")
    try {
      const assignment = await createAuthorizationAssignment({ username: detail.username, roleId: selectedRole.id, scopeId: selectedRole.scope === "board" ? scopeId : null }, csrfToken)
      setAssignments((current) => [...current, assignment])
      setRoleId("")
      setScopeId("")
      setMessage(`角色已分配给${detail.displayName}`)
      onRoleAssigned(assignment.role)
    } catch (reason) {
      setError(reason instanceof AdminApiError ? reason.message : "角色暂时无法分配")
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(assignment: AuthorizationRoleAssignment) {
    setSubmitting(true)
    setError("")
    setMessage("")
    try {
      await deleteAuthorizationAssignment(assignment.id, csrfToken)
      setAssignments((current) => current.filter((item) => item.id !== assignment.id))
      setMessage(`已移除${detail.displayName}的“${assignment.role.name}”角色`)
      setPendingRemoval(null)
      onRoleRemoved(assignment.role.id)
    } catch (reason) {
      setError(reason instanceof AdminApiError ? reason.message : "角色暂时无法移除")
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="user-admin-role-action">
    {loading ? <p role="status"><LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />正在读取可分配角色</p> : <>
      <form className="user-admin-role-form" onSubmit={(event) => void assign(event)}>
        <label><span className="sr-only">添加角色</span><select aria-label="添加角色" value={roleId} onChange={(event) => { setRoleId(event.target.value); setScopeId("") }}>
          <option value="">选择要添加的自定义角色</option>
          {availableRoles.map((role) => <option key={role.id} value={role.id}>{role.name} · {scopeLabel(role.scope)}</option>)}
        </select></label>
        {selectedRole?.scope === "board" ? <label><span className="sr-only">生效板块</span><select aria-label="生效板块" value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
          <option value="">选择生效板块</option>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
        </select></label> : null}
        <button className="secondary-button" type="submit" disabled={submitting || !roleId}><ShieldCheck size={14} aria-hidden="true" />分配角色</button>
      </form>
      {assignments.filter((assignment) => !assignment.role.isSystem).map((assignment) => <div className="user-admin-role-assignment" key={assignment.id}>
        <span>{assignment.role.name}<small>{scopeLabel(assignment.role.scope)}</small></span>
        <button className="icon-button" type="button" aria-label={`移除${assignment.role.name}角色`} title={`移除${assignment.role.name}角色`} disabled={submitting} onClick={(event) => { confirmationReturnFocusRef.current = event.currentTarget; setPendingRemoval(assignment) }}><Trash2 size={14} aria-hidden="true" /></button>
      </div>)}
    </>}
    {pendingRemoval ? <ConfirmDialog
      title={`移除“${pendingRemoval.role.name}”角色`}
      confirmLabel="确认移除角色"
      busy={submitting}
      returnFocus={confirmationReturnFocusRef.current}
      onCancel={() => setPendingRemoval(null)}
      onConfirm={() => void remove(pendingRemoval)}
    >
      <p>将从 {detail.displayName} 移除此角色分配，相关权限会立即失效。</p>
    </ConfirmDialog> : null}
    {error ? <p role="alert">{error}</p> : null}
    {message ? <p className="admin-success" role="status">{message}</p> : null}
  </div>
}

function scopeLabel(scope: AuthorizationRole["scope"]): string {
  return scope === "board" ? "板块范围" : scope === "site" ? "站点范围" : "实例范围"
}
