import { useEffect, useRef, useState } from "react"
import { AdminApiError, getAdminContentAccessPolicy, putAdminContentAccessPolicy, type AdminBoard, type AdminCommunityGroup, type AdminContentAccessPolicy, type AdminContentAccessPolicyInput } from "../api/admin"
import { ConfirmDialog } from "./ui/ConfirmDialog"

type Rules = Pick<AdminContentAccessPolicyInput, "operator" | "subjects">
const supported = new Set(["public", "authenticated", "selected_groups"])
const subject = (subjectType: "public" | "authenticated" | "community_group", communityGroupId: string | null = null) => ({ subjectType, communityGroupId, subjectKey: null })

export function BoardPermissionPresets({ board, groups, groupIds, csrfToken, canWrite, onBusyChange, onSaved }: {
  board: AdminBoard; groups: AdminCommunityGroup[]; groupIds: string[]; csrfToken: string; canWrite: boolean
  onBusyChange: (busy: boolean) => void; onSaved: () => void
}) {
  const [preset, setPreset] = useState("authenticated")
  const [preview, setPreview] = useState<{ key: string; before: AdminContentAccessPolicy | null; after: Rules } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const [feedback, setFeedback] = useState("")
  const mutation = useRef(false)
  const request = useRef<AbortController | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const key = board.id + ":" + preset + ":" + groupIds.join(",")
  const supportedSelection = supported.has(preset) && (preset !== "selected_groups" || (groupIds.length > 0 && groupIds.length <= 4 && groupIds.every(id => groups.some(group => group.id === id && group.status === "active"))))
  useEffect(() => { request.current?.abort(); setLoading(false); setPreview(null); setError(""); setConflict(false) }, [key])
  useEffect(() => () => request.current?.abort(), [])

  async function loadPreview() {
    if (!canWrite || !supportedSelection || mutation.current) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError(""); setFeedback(""); setConflict(false)
    const after: Rules = { operator: "any_of", subjects: preset === "selected_groups" ? groupIds.map(id => subject("community_group", id)) : [subject(preset as "public" | "authenticated")] }
    try {
      let before: AdminContentAccessPolicy | null = null
      try { before = await getAdminContentAccessPolicy("board", board.id, controller.signal) }
      catch (reason) { if (!(reason instanceof AdminApiError && reason.status === 404 && reason.code === "content.access_policy_not_found")) throw reason }
      if (!controller.signal.aborted) setPreview({ key, before, after })
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "当前策略读取失败，请重试。") }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  async function save() {
    if (!canWrite || !supportedSelection || !preview || preview.key !== key || mutation.current || conflict) return
    mutation.current = true; setSaving(true); onBusyChange(true); setError("")
    try {
      await putAdminContentAccessPolicy("board", board.id, { ...preview.after, expectedRevision: preview.before?.revision }, csrfToken)
      setPreview(null); setFeedback("访问预设已保存，已重新读取权限结果。"); onSaved()
    } catch (reason) {
      setConflict(reason instanceof AdminApiError && reason.status === 409)
      setError(reason instanceof Error ? reason.message : "预设保存失败，请重试。")
    } finally { mutation.current = false; setSaving(false); onBusyChange(false) }
  }
  function labels(rules: Rules) {
    return rules.subjects.map(s => s.subjectType === "public" ? "所有访客" : s.subjectType === "authenticated" ? "已登录用户" :
      s.subjectType === "community_group" ? "用户组：" + (groups.find(g => g.id === s.communityGroupId)?.displayName ?? "当前组") + " · " + s.communityGroupId :
      s.subjectType === "entitlement" ? "权益：" + s.subjectKey : "治理能力：" + s.subjectKey)
  }
  return <section className="admin-permission-presets" aria-label="访问预设配置">
    <h4>访问策略预设</h4>
    <p>预设只替换本版块的访问主体，不改变用户组动作、额度、可见状态或子版块策略。保存前必须核对全部差异。</p>
    <label><span>访问策略预设</span><select aria-label="访问策略预设" value={preset} disabled={!canWrite || loading || saving} onChange={event => setPreset(event.target.value)}>
      <option value="public">公开讨论：所有访客</option><option value="authenticated">成员讨论：已登录用户</option>
      <option value="selected_groups">指定用户组：满足任一所选组</option>
      <option value="deny_priority" disabled>显式拒绝优先（当前不支持）</option>
      <option value="inherit_parent" disabled>自动继承父版策略（当前不支持）</option>
    </select></label>
    <p>当前引擎不能表达显式拒绝优先或自动继承父版策略，这些预设不会保存。需要其他条件时，进入访问权限区逐项配置已有主体。</p>
    {preset === "selected_groups" && <p>使用上方所选的有效用户组；停用组不能应用预设。</p>}
    {!canWrite && <p>没有修改访问策略的权限。</p>}
    {loading && <p role="status">正在读取当前策略以比较差异…</p>}
    <button className="secondary-button" type="button" disabled={!canWrite || !supportedSelection || loading || saving} onClick={event => { returnFocus.current = event.currentTarget; void loadPreview() }}>预览访问预设</button>
    {error && !preview && <p className="form-alert" role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {preview?.key === key && <ConfirmDialog title="确认应用访问预设" confirmLabel="确认保存预设" confirmDisabled={conflict} busy={saving || loading} onConfirm={() => { if (!conflict) void save() }} onCancel={() => { if (!mutation.current) { setPreview(null); setError(""); setConflict(false) } }} returnFocus={returnFocus.current}>
      <p>版块：{board.name} · {board.visibility === "public" ? "公开" : "隐藏"}。可见状态保持原值。</p>
      <div className="admin-permission-presets__diff"><div><strong>保存前 · 修订 {preview.before?.revision ?? "未配置"}</strong>
        {preview.before ? <><p>{preview.before.operator === "any_of" ? "满足任一主体" : "满足全部主体"}</p><ul>{labels(preview.before).map((label, index) => <li key={index}>{label}</li>)}</ul></> : <p>未配置独立策略，访问由现有版块可见状态决定。</p>}</div>
        <div><strong>确认后 · 满足任一主体</strong><ul>{labels(preview.after).map((label, index) => <li key={index}>{label}</li>)}</ul></div></div>
      <p>将替换以上全部访问主体；树层级不自动继承。真实动作仍重新检查用户、所属版块和内容条件。</p>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {conflict && <><p>版本已变化，保留所选预设与组。重新读取后再次核对差异，未自动覆盖。</p><button className="secondary-button" type="button" onClick={() => void loadPreview()} disabled={saving || loading}>刷新当前策略重新比较</button></>}
    </ConfirmDialog>}
  </section>
}
