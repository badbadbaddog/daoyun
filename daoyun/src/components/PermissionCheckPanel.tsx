import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { Search, RefreshCw } from "lucide-react"
import type { AdminBoard } from "../api/admin"
import { getAdminUser, listAdminUsers } from "../api/adminUsers"
import { getPermissionCheck, type PermissionCheck, type PermissionCheckInput, type PermissionMatrixAction } from "../api/boardPermissions"
import { AdminUserPicker, type AdminUserCandidate } from "./admin/AdminUserPicker"

export const permissionCheckCapabilities = ["content.access_policies.read", "community.groups.read", "admin.users.read", "community.memberships.read", "entitlements.grants.read", "entitlements.types.read", "authorization.assignments.read"]
const actions: Array<{ key: PermissionMatrixAction; label: string }> = [
  { key: "browse", label: "浏览版块／主题" }, { key: "topic_create", label: "发帖" }, { key: "reply_create", label: "回复主题" },
  { key: "attachment_upload", label: "主题附件上传" }, { key: "attachment_download", label: "原文件下载" },
]
const decisions = { allowed: "当前权限条件满足", denied: "当前条件被限制", missing_context: "需要补充资源条件", provided: "来源提供此动作", not_provided: "来源未提供此动作", not_applicable: "此条件不适用" }
const reasons: Record<string, string> = {
  "board.access_policy_matched": "当前版块访问条件满足。",
  "board.basic_conditions_matched": "当前版块发帖条件满足，提交时还会验证内容。",
  "board.hidden": "本版块隐藏，普通浏览与发帖被拒绝。",
  "content.access_policy_unmatched": "不满足资源当前访问策略。",
  "community.permission_not_provided": "当前有效用户组和权益未提供此动作。",
  "community.quota_exhausted": "本次操作超过当前可用额度。",
  "account.inactive": "账号当前不能执行此动作。",
  "account.restricted": "账号限制覆盖了此动作。",
  "board.action_restricted": "该用户在本版块被限制执行此动作。",
  "resource.context_required": "请补充具体主题、原文件或上传文件大小，再次检查。",
  "resource.context_required_upload_quota_exempt": "上传额度豁免；仍需主题归属、文件和访问条件。",
  "resource.unavailable": "资源当前不可用或不满足读取条件。",
  "resource.conditions_matched": "当前来源、额度与所选资源的权限条件满足。",
  "attachment.owner_required": "主题附件上传只允许主题作者操作。",
  "topic.locked": "主题已锁定，不能新增回复。",
}
const quotaLabels: Record<string, string> = {
  "topic.create.daily": "每日发帖", "reply.create.daily": "每日回复", "message.send.daily": "每日私信",
  "attachment.upload.daily": "每日上传", "attachment.file.bytes": "单文件字节", "attachment.storage.bytes": "附件总字节",
  "attachment.download.bytes.daily": "每日下载字节", "content.external_link.daily": "每日外链",
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function PermissionCheckPanel({ boards, capabilityKeys, query = "", fixedUser }: { boards: AdminBoard[]; capabilityKeys: string[]; query?: string; fixedUser?: AdminUserCandidate }) {
  const canRead = permissionCheckCapabilities.every(key => capabilityKeys.includes(key))
  const [userQuery, setUserQuery] = useState("")
  const [users, setUsers] = useState<AdminUserCandidate[]>([])
  const [pickedUser, setSelectedUser] = useState<AdminUserCandidate | null>(null)
  const selectedUser = fixedUser ?? pickedUser
  const [userLoading, setUserLoading] = useState(false)
  const [userError, setUserError] = useState("")
  const [userRetry, setUserRetry] = useState(0)
  const linkedRequest=useRef<AbortController | null>(null)
  const [linkLoading,setLinkLoading]=useState(false)
  const [linkError,setLinkError]=useState("")
  const [linkRetry,setLinkRetry]=useState(0)
  const [boardId, setBoardId] = useState("")
  const [action, setAction] = useState<PermissionMatrixAction>("browse")
  const [topicId, setTopicId] = useState("")
  const [attachmentId, setAttachmentId] = useState("")
  const [fileBytes, setFileBytes] = useState<number | undefined>()
  const [submitted, setSubmitted] = useState<{ key: string; input: PermissionCheckInput } | null>(null)
  const [result, setResult] = useState<{ key: string; data: PermissionCheck } | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify([selectedUser?.id, boardId, action, topicId.trim(), attachmentId.trim(), fileBytes])


  useEffect(() => {
    const params=new URLSearchParams(query)
    const linkedBoard=params.get("board_id") ?? ""
    const linkedAction=params.get("action")
    setBoardId(uuid.test(linkedBoard) ? linkedBoard : "")
    setAction(actions.find(entry => entry.key === linkedAction)?.key ?? "browse")
    setTopicId(""); setAttachmentId(""); setFileBytes(undefined); setSubmitted(null)
  }, [query])
  useEffect(() => {
    const controller=new AbortController()
    linkedRequest.current=controller
    setSelectedUser(null); setLinkError(""); setLinkLoading(false)
    const userId=new URLSearchParams(query).get("user_id")
    if(fixedUser || !canRead || !userId || !uuid.test(userId))return () => controller.abort()
    setLinkLoading(true)
    void getAdminUser(userId,controller.signal).then(user => {
      if(controller.signal.aborted)return
      if(user.id!==userId)throw new Error("链接用户响应对象不匹配。")
      setSelectedUser(user)
    }).catch(() => {if(!controller.signal.aborted)setLinkError("链接用户暂时无法加载，请搜索用户或重试。")})
      .finally(() => {if(!controller.signal.aborted)setLinkLoading(false)})
    return () => controller.abort()
  }, [canRead,query,linkRetry,fixedUser])

  useEffect(() => {
    const controller = new AbortController()
    setUsers([]); setUserError(""); setUserLoading(false)
    if (fixedUser || !canRead || userQuery.trim().length < 2) return () => controller.abort()
    setUserLoading(true)
    void listAdminUsers({ query: userQuery.trim(), limit: 10, signal: controller.signal }).then(page => {
      if (!controller.signal.aborted) setUsers(page.users)
    }).catch(() => { if (!controller.signal.aborted) setUserError("用户搜索失败，请重试。") })
      .finally(() => { if (!controller.signal.aborted) setUserLoading(false) })
    return () => controller.abort()
  }, [canRead, userQuery, userRetry, fixedUser])

  useEffect(() => {
    const controller = new AbortController()
    setResult(null); setError(""); setLoading(false)
    if (!canRead || !submitted || submitted.key !== key) return () => controller.abort()
    setLoading(true)
    void getPermissionCheck(submitted.input, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data })
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "权限检查失败，请重试。")
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [canRead, key, submitted])

  function check(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!canRead || loading) return
    if (!selectedUser || !uuid.test(boardId)) { setError("请选择用户和版块，或填写有效版块标识。"); return }
    if ((topicId && !uuid.test(topicId.trim())) || (attachmentId && !uuid.test(attachmentId.trim()))) { setError("主题或附件标识格式不正确。"); return }
    if (fileBytes !== undefined && (fileBytes <= 0 || fileBytes > 50 * 1024 * 1024)) { setError("文件大小需大于 0 且不超过 50 MiB。"); return }
    const input: PermissionCheckInput = { user_id: selectedUser.id, board_id: boardId, action }
    if (topicId.trim() && action !== "topic_create") input.topic_id = topicId.trim()
    if (attachmentId.trim() && action === "attachment_download") input.attachment_id = attachmentId.trim()
    if (fileBytes !== undefined && action === "attachment_upload") input.file_bytes = fileBytes
    setResult(null); setError(""); setLoading(true); setSubmitted({ key, input })
  }
  const snapshot = canRead && result?.key === key ? result.data : null
  if (!canRead) return <p role="status">没有查看指定用户权限与来源的完整读取能力。</p>

  return <section className="admin-permission-check" aria-label="只读权限检查">
    <p>检查当前用户在所选资源上的权限条件。检查不会预留或扣除额度，不会写入积分流水；真实请求仍会重新鉴权、验证文件并原子消费。</p>
    <form className="admin-permission-check__form" onSubmit={check}>
      {!fixedUser && <AdminUserPicker query={userQuery} users={users} selectedUser={selectedUser} loading={userLoading} onQueryChange={value => { linkedRequest.current?.abort(); setLinkLoading(false); setLinkError(""); setUserQuery(value); setSelectedUser(null) }} onSelect={setSelectedUser} />}
      {linkLoading && <p role="status">正在加载链接用户…</p>}
      {linkError && <><p role="alert">{linkError}</p><button type="button" className="secondary-button" onClick={() => setLinkRetry(value => value + 1)}>重试链接用户</button></>}
      {userError && <><p role="alert">{userError}</p><button type="button" className="secondary-button" onClick={event => { event.currentTarget.form?.querySelector<HTMLInputElement>('input[aria-label="搜索用户"]')?.focus(); setUserRetry(value => value + 1) }}>重试用户搜索</button></>}
      {selectedUser && <p>指定用户：{selectedUser.displayName} @{selectedUser.username} {!fixedUser && <button type="button" className="secondary-button" onClick={() => setSelectedUser(null)}>移除指定用户</button>}</p>}
      {boards.length > 0 ? <label><span>检查版块</span><select aria-label="检查版块" value={boards.some(board => board.id === boardId) ? boardId : ""} onChange={event => setBoardId(event.target.value)}><option value="">请选择版块</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name}{board.visibility === "hidden" ? "（隐藏）" : ""}</option>)}</select></label> : <p>可填写所需检查的版块标识。</p>}
      <label><span>版块标识</span><input aria-label="版块标识" value={boardId} onChange={event => setBoardId(event.target.value.trim())} autoComplete="off" spellCheck={false} /></label>
      <label><span>检查动作</span><select aria-label="检查动作" value={action} onChange={event => { setAction(event.target.value as PermissionMatrixAction); setTopicId(""); setAttachmentId(""); setFileBytes(undefined) }}>{actions.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
      {action !== "topic_create" && <label><span>主题标识{action === "browse" || action === "attachment_download" ? "（可选）" : ""}</span><input aria-label="主题标识" value={topicId} onChange={event => setTopicId(event.target.value)} autoComplete="off" spellCheck={false} /></label>}
      {action === "attachment_download" && <label><span>原文件附件标识</span><input aria-label="原文件附件标识" value={attachmentId} onChange={event => setAttachmentId(event.target.value)} autoComplete="off" spellCheck={false} /></label>}
      {action === "attachment_upload" && <label><span>检查文件大小</span><input aria-label="检查文件大小" type="file" onChange={event => setFileBytes(event.target.files?.[0]?.size)} /><small>只在本地读取大小，不上传文件内容。{fileBytes !== undefined ? " 已选 " + fileBytes + " 字节。" : ""}</small></label>}
      <p>检查时刻：服务端当前时刻。历史与未来权限不在本次检查范围内。</p>
      <button type="submit" className="primary-button" disabled={loading}><Search size={16} aria-hidden="true" />{loading ? "正在检查…" : "开始检查"}</button>
    </form>
    {loading && <p role="status">正在读取当前权限快照…</p>}
    {error && <div className="form-alert" role="alert"><p>{error}</p>{submitted?.key === key && <button type="button" className="secondary-button" onClick={() => check()}><RefreshCw size={16} aria-hidden="true" />重试权限检查</button>}</div>}
    {snapshot && <section aria-label="检查结果" className="admin-permission-check__result">
      <h2>{decisions[snapshot.scenario.actions[0].decision]}</h2>
      <p>{reasons[snapshot.scenario.actions[0].reason] ?? "请核对资源条件。"}</p>
      <p>{snapshot.scenario.display_name} · 检查时刻 <time dateTime={snapshot.evaluated_at}>{new Date(snapshot.evaluated_at).toLocaleString("zh-CN")}</time></p>
      <p>此结果不作为授权凭证，也不保证稍后提交成功。文件格式、扫描与存储可用性由实际提交验证。</p>
      <h3>有效来源</h3>
      <ul>{snapshot.scenario.sources.map(source => <li key={source.id}><strong>{source.kind === "group" ? "用户组：" : "权益："}{source.display_name}</strong>
        <p>{snapshot.scenario.actions[0].source_ids.includes(source.id) ? "提供此动作" : "未提供此动作"}{source.type_version !== null ? " · 快照版本 " + source.type_version : ""}</p>
        {source.starts_at && <p>生效：{new Date(source.starts_at).toLocaleString("zh-CN")} · 到期：{source.ends_at ? new Date(source.ends_at).toLocaleString("zh-CN") : "无到期时间"}</p>}</li>)}</ul>
      {snapshot.scenario.sources.length === 0 && <p>没有当前有效的用户组或权益来源。</p>}
      <h3>当前额度</h3>
      <dl>{snapshot.scenario.quotas.map(quota => <div key={quota.key}><dt>{quotaLabels[quota.key] ?? quota.key}</dt><dd>上限 {quota.limit} · 已用 {quota.used ?? "不适用"} · 取有效来源最大值，0 为无额度</dd></div>)}</dl>
      <button className="secondary-button" type="button" onClick={() => check()} disabled={loading}>重新检查当前条件</button>
    </section>}
  </section>
}
