import { useEffect, useId, useRef, useState } from "react"
import { listAdminCommunityGroups, type AdminBoard, type AdminCommunityGroup } from "../api/admin"
import { listAdminUsers } from "../api/adminUsers"
import { getBoardPermissionMatrix, type BoardPermissionMatrix as MatrixData, type PermissionMatrixScenario, type PermissionMatrixAction, type PermissionMatrixDecision } from "../api/boardPermissions"
import { AdminUserPicker, type AdminUserCandidate } from "./admin/AdminUserPicker"
import { ModalDialog } from "./ui/ModalDialog"
import { BoardPermissionPresets } from "./BoardPermissionPresets"

const actions: Array<{ key: PermissionMatrixAction; label: string }> = [
  { key: "browse", label: "浏览版块" }, { key: "topic_create", label: "发帖" },
  { key: "reply_create", label: "回复" }, { key: "attachment_upload", label: "主题附件上传" },
  { key: "attachment_download", label: "原文件下载" },
]
const decisionLabels: Record<PermissionMatrixDecision, string> = {
  allowed: "当前条件满足", denied: "被限制", provided: "本组提供", not_provided: "本组未提供",
  missing_context: "缺少上下文", not_applicable: "不适用",
}
const reasons: Record<string, string> = {
  "scenario.specific_user_required": "仍需具体用户、其他来源及资源上下文。",
  "scenario.other_sources_unknown": "本组未提供；其他组或权益可能提供。",
  "group.inactive": "该组已停用。",
  "board.hidden": "本版块隐藏，公共目录及普通直达访问被拒绝。",
  "content.access_policy_unmatched": "不满足本版块当前访问策略。",
  "board.access_policy_matched": "满足本版块当前访问策略。",
  "board.basic_conditions_matched": "本版块基础发帖条件满足；提交时还会检查正文、附件等条件。",
  "community.permission_not_provided": "当前有效组及权益均未提供这个动作。",
  "account.inactive": "账号当前不可执行社区动作。",
  "account.restricted": "账号限制覆盖了此写入动作。",
  "board.action_restricted": "该用户在本版块被限制执行此动作。",
  "community.quota_exhausted": "当前有效额度为 0 或已用尽。",
  "resource.context_required": "还需具体主题、状态、归属或文件信息；这不是最终允许。",
  "resource.context_required_upload_quota_exempt": "站点最高管理身份免上传额度；仍需主题归属、文件和访问条件。",
}
const quotaLabels: Record<string, string> = {
  "topic.create.daily": "每日发帖", "reply.create.daily": "每日回复", "message.send.daily": "每日私信",
  "attachment.upload.daily": "每日上传", "attachment.file.bytes": "单文件字节",
  "attachment.storage.bytes": "附件总字节", "attachment.download.bytes.daily": "每日下载字节",
  "content.external_link.daily": "每日外链",
}
const userCapabilities = ["admin.users.read", "community.memberships.read", "entitlements.grants.read", "entitlements.types.read", "authorization.assignments.read"]

export function BoardPermissionMatrix({ board, capabilityKeys, csrfToken, onBusyChange }: { board: AdminBoard; capabilityKeys: string[]; csrfToken: string; onBusyChange: (busy: boolean) => void }) {
  const canRead = capabilityKeys.includes("content.access_policies.read") && capabilityKeys.includes("community.groups.read")
  const canCheckUser = canRead && userCapabilities.every(key => capabilityKeys.includes(key))
  const [groups, setGroups] = useState<AdminCommunityGroup[]>([])
  const [groupStatus, setGroupStatus] = useState<"loading" | "ready" | "error">("loading")
  const [groupRetry, setGroupRetry] = useState(0)
  const [groupQuery, setGroupQuery] = useState("")
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [userQuery, setUserQuery] = useState("")
  const [users, setUsers] = useState<AdminUserCandidate[]>([])
  const [selectedUser, setSelectedUser] = useState<AdminUserCandidate | null>(null)
  const [userLoading, setUserLoading] = useState(false)
  const [userError, setUserError] = useState("")
  const [result, setResult] = useState<{ key: string; data: MatrixData } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [matrixRetry, setMatrixRetry] = useState(0)
  const [userRetry, setUserRetry] = useState(0)
  const [scenarioKey, setScenarioKey] = useState("")
  const [sourceView, setSourceView] = useState<{ scenario: PermissionMatrixScenario; action: PermissionMatrixAction } | null>(null)
  const sourceReturn = useRef<HTMLElement | null>(null)
  const sourceHeading = "matrix-source-" + useId().replaceAll(":", "")
  const selectedGroupsKey = groupIds.join(",")
  const userId = canCheckUser ? selectedUser?.id : undefined
  const requestKey = board.id + ":" + selectedGroupsKey + ":" + (userId ?? "")

  useEffect(() => {
    const controller = new AbortController()
    setGroupStatus("loading")
    if (!canRead) return () => controller.abort()
    void listAdminCommunityGroups(controller.signal).then(groups => {
      if (!controller.signal.aborted) { setGroups(groups); setGroupStatus("ready") }
    }).catch(() => { if (!controller.signal.aborted) setGroupStatus("error") })
    return () => controller.abort()
  }, [board.id, canRead, groupRetry])

  useEffect(() => {
    const controller = new AbortController()
    setUsers([]); setUserError(""); setUserLoading(false)
    if (!canCheckUser || userQuery.trim().length < 2) return () => controller.abort()
    setUserLoading(true)
    void listAdminUsers({ query: userQuery.trim(), limit: 10, signal: controller.signal }).then(page => {
      if (!controller.signal.aborted) setUsers(page.users)
    }).catch(() => { if (!controller.signal.aborted) setUserError("用户搜索失败，请重新输入或重试。") })
      .finally(() => { if (!controller.signal.aborted) setUserLoading(false) })
    return () => controller.abort()
  }, [canCheckUser, userQuery, userRetry])

  useEffect(() => {
    const controller = new AbortController()
    setResult(null); setError(""); setSourceView(null); setLoading(false)
    if (!canRead || (!selectedGroupsKey && !userId)) return () => controller.abort()
    setLoading(true)
    void getBoardPermissionMatrix(board.id, selectedGroupsKey ? selectedGroupsKey.split(",") : [], userId, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key: requestKey, data })
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "权限检查失败，请重试。")
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [board.id, canRead, selectedGroupsKey, userId, matrixRetry, requestKey])
  const matrix = canRead && result?.key === requestKey ? result.data : null
  const activeScenario = matrix?.scenarios.find(s => s.kind + ":" + s.id === scenarioKey) ?? matrix?.scenarios[0]
  const visibleGroups = groups.filter(group => (group.displayName + " " + group.id).toLocaleLowerCase().includes(groupQuery.trim().toLocaleLowerCase()))

  return <section className="admin-permission-matrix" aria-label="版块有效权限">
    <h4>版块有效权限</h4>
    <p>只读检查。用户组列只说明本组提供哪些动作，不能代表某个用户的最终权限；不提供不等于全局拒绝。</p>
    <p>树层级不继承版块访问策略。主题、回复和附件仍检查所属版块及自身条件。原文件下载需要登录，缩略图使用独立读取规则。</p>
    {!canRead ? <p>没有读取用户组与访问策略的权限。</p> : <>
      <fieldset><legend>选择最多四个用户组场景</legend>
        <label><span>搜索场景用户组</span><input type="search" aria-label="搜索场景用户组" value={groupQuery} onChange={event => setGroupQuery(event.target.value)} /></label>
        {groupStatus === "loading" ? <p role="status">正在加载场景用户组…</p> : groupStatus === "error" ? <><p role="alert">场景用户组加载失败。</p><button className="secondary-button" type="button" onClick={() => setGroupRetry(value => value + 1)}>重试场景用户组</button></> :
          <div className="admin-permission-matrix__groups">{visibleGroups.map(group => <label key={group.id}><input type="checkbox" checked={groupIds.includes(group.id)} disabled={!groupIds.includes(group.id) && groupIds.length >= 4} onChange={event => setGroupIds(ids => event.target.checked ? [...ids, group.id] : ids.filter(id => id !== group.id))} /><span>{group.displayName}<small>{group.id.slice(-8)} · {group.status === "active" ? "有效" : "已停用"}</small></span></label>)}
          {visibleGroups.length === 0 && <p>没有匹配用户组。</p>}</div>}
      </fieldset>
      {canCheckUser ? <><AdminUserPicker query={userQuery} users={users} selectedUser={selectedUser} loading={userLoading} onQueryChange={query => { setUserQuery(query); setSelectedUser(null) }} onSelect={setSelectedUser} />{userError && <><p role="alert">{userError}</p><button type="button" className="secondary-button" onClick={() => setUserRetry(value => value + 1)}>重试用户搜索</button></>}{selectedUser && <p>指定用户：{selectedUser.displayName} @{selectedUser.username} <button type="button" className="secondary-button" onClick={() => setSelectedUser(null)}>移除指定用户</button></p>}</> : <p>指定用户检查还需用户、成员授予、权益类型／授予及管理任命读取权限。</p>}
      {loading && <p role="status">正在读取有效权限快照…</p>}
      {error && <><p className="form-alert" role="alert">{error}</p><button className="secondary-button" type="button" onClick={() => setMatrixRetry(value => value + 1)}>重试权限检查</button></>}
      {!loading && !error && !matrix && <p>选择用户组或具体用户后显示结果。</p>}
      {matrix && <><p>计算时刻：<time dateTime={matrix.evaluated_at}>{new Date(matrix.evaluated_at).toLocaleString("zh-CN")}</time> · 本版块{matrix.visibility === "public" ? "公开" : "隐藏"} · 策略修订 {matrix.policy_revision ?? "未配置"}</p>
        <p>结果不会预留或扣除额度，也不保证稍后提交成功；真实请求重新检查并原子消费。每日额度沿用当前业务日。</p>
        <label className="admin-permission-matrix__scenario"><span>查看权限场景</span><select value={activeScenario ? activeScenario.kind + ":" + activeScenario.id : ""} onChange={event => setScenarioKey(event.target.value)}>{matrix.scenarios.map(s => <option key={s.kind + s.id} value={s.kind + ":" + s.id}>{s.display_name} · {s.kind === "group" ? "用户组场景" : "指定用户"} · {s.id.slice(-8)}</option>)}</select></label>
        <div className="admin-permission-matrix__scroll" tabIndex={0} role="region" aria-label="有效权限结果"><table>
          <caption>动作与来源检查结果</caption><thead><tr><th scope="col">动作</th>{matrix.scenarios.map(s => <th scope="col" key={s.kind + s.id}>{s.display_name}<small>{s.kind === "group" ? "用户组场景 · 需具体用户" : "指定用户"} · {s.id.slice(-8)}</small></th>)}</tr></thead>
          <tbody>{actions.map(({ key, label }) => <tr key={key}><th scope="row">{label}</th>{matrix.scenarios.map(s => { const action = s.actions.find(a => a.action === key)!; return <td key={s.kind + s.id} data-scenario-selected={s === activeScenario}><strong>{decisionLabels[action.decision]}</strong><p>{reasons[action.reason] ?? "该条件需要进一步检查。"}</p><button className="secondary-button" type="button" onClick={event => { sourceReturn.current = event.currentTarget; setSourceView({ scenario: s, action: key }) }} aria-label={s.display_name + " " + s.id.slice(-8) + " " + label + " 来源"}>查看来源</button></td> })}</tr>)}</tbody>
        </table></div><button className="secondary-button" type="button" onClick={() => setMatrixRetry(value => value + 1)}>刷新权限快照</button></>}
    </>}
    <BoardPermissionPresets board={board} groups={groups} groupIds={groupIds} csrfToken={csrfToken} canWrite={canRead && capabilityKeys.includes("content.access_policies.write")} onBusyChange={onBusyChange} onSaved={() => setMatrixRetry(value => value + 1)} />
    {canRead && sourceView && (sourceView.scenario.kind === "group" || canCheckUser) && <ModalDialog titleId={sourceHeading} returnFocus={sourceReturn.current} onClose={() => setSourceView(null)} className="admin-permission-source" initialFocusSelector={"#" + sourceHeading}>
      <h3 id={sourceHeading} tabIndex={-1}>{sourceView.scenario.display_name} · {actions.find(a => a.key === sourceView.action)?.label}来源</h3>
      <p>{reasons[sourceView.scenario.actions.find(a => a.action === sourceView.action)!.reason]}</p>
      <ul>{sourceView.scenario.sources.map(source => <li key={source.id}><strong>{source.kind === "group" ? "用户组" : "权益"}：{source.display_name}</strong><p>{source.key} · {source.id}{source.type_version != null ? " · 快照版本 " + source.type_version : ""}</p>
        <p>{sourceView.scenario.actions.find(a => a.action === sourceView.action)!.source_ids.includes(source.id) ? "提供该动作" : "未提供该动作"}</p>
        {source.starts_at && <p>生效：{new Date(source.starts_at).toLocaleString("zh-CN")} · 到期：{source.ends_at ? new Date(source.ends_at).toLocaleString("zh-CN") : "无到期时间"}</p>}</li>)}</ul>
      {sourceView.scenario.sources.length === 0 && <p>没有有效的组或权益来源。</p>}
      <dl>{sourceView.scenario.quotas.map(quota => <div key={quota.key}><dt>{quotaLabels[quota.key] ?? quota.key}</dt><dd>上限 {quota.limit} · 已用 {quota.used ?? "缺少具体用户或不适用"} · 额度取来源 MAX，0 为无额度</dd></div>)}</dl>
      {canCheckUser && <a className="secondary-button" href={"#admin/inspect?" + new URLSearchParams({ board_id: board.id, action: sourceView.action, ...(sourceView.scenario.kind === "user" ? { user_id: sourceView.scenario.id } : {}) })}>检查具体用户与资源</a>}
      <button className="secondary-button" type="button" onClick={() => setSourceView(null)}>关闭来源</button>
    </ModalDialog>}
  </section>
}
