import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { Search, RefreshCw } from "lucide-react"
import type { AdminBoard } from "../api/admin"
import { getAdminUser, listAdminUsers } from "../api/adminUsers"
import { getPermissionCheck, type PermissionCheck, type PermissionCheckInput, type PermissionMatrixAction } from "../api/boardPermissions"
import { AdminUserPicker, type AdminUserCandidate } from "./admin/AdminUserPicker"
import { PermissionExplanation, permissionActions, permissionReasons } from "./PermissionExplanation"

export const permissionCheckCapabilities = ["content.access_policies.read", "community.groups.read", "admin.users.read", "community.memberships.read", "entitlements.grants.read", "entitlements.types.read", "authorization.assignments.read", "authorization.roles.read"]
const actions = permissionActions
const decisions = { allowed: "当前权限条件满足", denied: "当前条件被限制", missing_context: "需要补充资源条件", provided: "来源提供此动作", not_provided: "来源未提供此动作", not_applicable: "此条件不适用" }
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
  const [targetBoardId, setTargetBoardId] = useState("")
  const [attachmentId, setAttachmentId] = useState("")
  const [fileBytes, setFileBytes] = useState<number | undefined>()
  const [submitted, setSubmitted] = useState<{ key: string; input: PermissionCheckInput } | null>(null)
  const [result, setResult] = useState<{ key: string; data: PermissionCheck } | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify([selectedUser?.id, boardId, action, topicId.trim(), attachmentId.trim(), fileBytes, targetBoardId.trim()])


  useEffect(() => {
    const params=new URLSearchParams(query)
    const linkedBoard=params.get("board_id") ?? ""
    const linkedAction=params.get("action")
    setBoardId(uuid.test(linkedBoard) ? linkedBoard : "")
    setAction(actions.find(entry => entry.key === linkedAction)?.key ?? "browse")
    setTopicId(""); setAttachmentId(""); setFileBytes(undefined); setTargetBoardId(""); setSubmitted(null)
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
    if (targetBoardId && !uuid.test(targetBoardId.trim())) { setError("目标版块标识格式不正确。"); return }
    if (fileBytes !== undefined && (fileBytes <= 0 || fileBytes > 50 * 1024 * 1024)) { setError("文件大小需大于 0 且不超过 50 MiB。"); return }
    const input: PermissionCheckInput = { user_id: selectedUser.id, board_id: boardId, action }
    if (topicId.trim() && action !== "topic_create") input.topic_id = topicId.trim()
    if (attachmentId.trim() && action === "attachment_download") input.attachment_id = attachmentId.trim()
    if (fileBytes !== undefined && action === "attachment_upload") input.file_bytes = fileBytes
    if (targetBoardId.trim() && action === "topic_move") input.target_board_id = targetBoardId.trim()
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
      <label><span>检查动作</span><select aria-label="检查动作" value={action} onChange={event => { setAction(event.target.value as PermissionMatrixAction); setTopicId(""); setAttachmentId(""); setFileBytes(undefined); setTargetBoardId("") }}>{actions.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
      {action !== "topic_create" && <label><span>主题标识{action === "browse" || action === "attachment_download" ? "（可选）" : ""}</span><input aria-label="主题标识" value={topicId} onChange={event => setTopicId(event.target.value)} autoComplete="off" spellCheck={false} /></label>}
      {action === "topic_move" && <label><span>目标版块标识</span><input aria-label="目标版块标识" value={targetBoardId} onChange={event => setTargetBoardId(event.target.value)} autoComplete="off" spellCheck={false} /><small>需要目标版块的移动权限；缺少目标时只能返回待补充条件。</small></label>}
      {action === "attachment_download" && <label><span>原文件附件标识</span><input aria-label="原文件附件标识" value={attachmentId} onChange={event => setAttachmentId(event.target.value)} autoComplete="off" spellCheck={false} /></label>}
      {action === "attachment_upload" && <label><span>检查文件大小</span><input aria-label="检查文件大小" type="file" onChange={event => setFileBytes(event.target.files?.[0]?.size)} /><small>只在本地读取大小，不上传文件内容。{fileBytes !== undefined ? " 已选 " + fileBytes + " 字节。" : ""}</small></label>}
      <p>检查时刻：服务端当前时刻。历史与未来权限不在本次检查范围内。</p>
      <button type="submit" className="primary-button" disabled={loading}><Search size={16} aria-hidden="true" />{loading ? "正在检查…" : "开始检查"}</button>
    </form>
    {loading && <p role="status">正在读取当前权限快照…</p>}
    {error && <div className="form-alert" role="alert"><p>{error}</p>{submitted?.key === key && <button type="button" className="secondary-button" onClick={() => check()}><RefreshCw size={16} aria-hidden="true" />重试权限检查</button>}</div>}
    {snapshot && <section aria-label="检查结果" className="admin-permission-check__result">
      <h2>{permissionReasons[snapshot.scenario.actions[0].reason] ? decisions[snapshot.scenario.actions[0].decision] : "结果需要核对"}</h2>
      <p>{snapshot.scenario.display_name} · 检查时刻 <time dateTime={snapshot.evaluated_at}>{new Date(snapshot.evaluated_at).toLocaleString("zh-CN")}</time></p>
      <p>此结果不作为授权凭证，也不保证稍后提交成功。文件格式、扫描与存储可用性由实际提交验证。</p>
      <PermissionExplanation key={key} scenario={snapshot.scenario} action={snapshot.scenario.actions[0].action} boards={boards} policyRevision={snapshot.policy_revision} topicRevision={snapshot.topic_revision} targetBoardId={snapshot.target_board_id} />
      <button className="secondary-button" type="button" onClick={() => check()} disabled={loading}>重新检查当前条件</button>
    </section>}
  </section>
}
