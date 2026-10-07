import { useEffect, useRef, useState, type FormEvent } from "react"
import { AdminApiError, getAdminMedalState, getAdminMedalReceipt, getMembershipMedalRules, grantMembershipMedal, listMembershipMedalOperations, revokeMembershipMedal, type MembershipMedal, type MembershipMedalGrantInput, type MembershipMedalOperation, type MembershipMedalRule, type MembershipMedalReceipt, type AdminMedalState } from "../api/admin"

export function UserMedalAction({ userId, csrfToken, canRead, canWrite, onChanged, onBusyChange, initialRevokeKey }: { userId: string; medals: MembershipMedal[]; csrfToken: string; canRead: boolean; canWrite: boolean; onChanged: () => void; onBusyChange: (busy: boolean) => void; initialRevokeKey?: string }) {
  const [rules, setRules] = useState<MembershipMedalRule[]>([])
  const [state, setState] = useState<AdminMedalState | null>(null)
  const [operations, setOperations] = useState<MembershipMedalOperation[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState<MembershipMedalReceipt | null>(null)
  const [medalKey, setMedalKey] = useState("")
  const [reason, setReason] = useState("operator.award")
  const [revokeTarget, setRevokeTarget] = useState<MembershipMedal | null>(null)
  const [revokeReason, setRevokeReason] = useState("")
  const pending = useRef(false)
  const attempt = useRef<{ input: MembershipMedalGrantInput; revoke: boolean } | null>(null)
  const readVersion = useRef(0)
  const identity = useRef(userId)
  identity.current = userId
  useEffect(() => {
    setState(null); setRules([]); setOperations([]); setNextCursor(null)
    if (!canRead) { setLoading(false); return }
    const controller = new AbortController()
    void load(undefined, controller.signal)
    return () => { controller.abort(); readVersion.current += 1 }
  }, [userId, canRead])
  useEffect(() => { onBusyChange(busy || unknown) }, [busy, unknown, onBusyChange])
  useEffect(() => () => onBusyChange(false), [onBusyChange])
  async function load(cursor?: string, signal?: AbortSignal) {
    if (!canRead) return false
    const version = ++readVersion.current
    setLoading(true); setError("")
    try {
      const [catalog, page, latest] = await Promise.all([getMembershipMedalRules(signal), listMembershipMedalOperations({userId, limit:20, cursor, signal}), getAdminMedalState(userId,signal)])
      if (signal?.aborted || version !== readVersion.current) return false
      setRules(catalog); setState(latest)
      setMedalKey(current => catalog.some(item => item.key === current) ? current : catalog[0]?.key ?? "")
      if (initialRevokeKey && !revokeTarget && !receipt) setRevokeTarget(latest.medals.find(item => item.key === initialRevokeKey) ?? null)
      setOperations(current => cursor ? [...new Map([...current, ...page.operations].map(item => [item.id,item])).values()] : page.operations)
      setNextCursor(page.nextCursor)
      return true
    } catch (failure) { if (!signal?.aborted && version === readVersion.current) {setState(null);setError(failure instanceof AdminApiError ? failure.message : "勋章记录暂时无法读取")}; return false }
    finally { if (!signal?.aborted && version === readVersion.current) setLoading(false) }
  }
  async function complete(saved: MembershipMedalReceipt) {
    setReceipt(saved);setUnknown(false);setConflict(false);setError("");setRevokeTarget(null);setRevokeReason("");attempt.current=null
    onChanged();await load()
  }
  async function submit(event?: FormEvent, revoke = false) {
    event?.preventDefault()
    if (!canRead || !canWrite || pending.current || (!unknown && (!state || conflict))) return
    if (!unknown) {
      const text = revoke ? revokeReason.trim() : reason.trim()
      if (revoke ? text.length < 1 || Array.from(text).length > 64 || /\p{Cc}/u.test(text) : !/^[a-z][a-z0-9._-]{1,63}$/.test(text)) { setError("请填写有效的勋章操作原因"); return }
      if (revoke ? !revokeTarget : !rules.some(item => item.key === medalKey)) return
      attempt.current = { input:{userId,medalKey:revoke && revokeTarget ? revokeTarget.key : medalKey,reason:text,expectedRevision:state!.revision,idempotencyKey:"medal:"+crypto.randomUUID()},revoke }
    }
    const command=attempt.current
    if(!command) return
    pending.current=true;setBusy(true);setError("")
    try {
      const result=command.revoke ? await revokeMembershipMedal(command.input,csrfToken) : await grantMembershipMedal(command.input,csrfToken)
      if(identity.current===command.input.userId) await complete(result.receipt)
    } catch(failure) {
      if(identity.current!==command.input.userId) return
      const uncertain=unknown || !(failure instanceof AdminApiError && failure.status>=400 && failure.status<500 && failure.code!=="response.invalid")
      if(uncertain){setUnknown(true);setError("提交结果尚未确认，原请求已保留。请核验回执或使用原请求重试确认。")} else {
        attempt.current=null;setConflict(failure instanceof AdminApiError && failure.status===409)
        setError(failure instanceof Error ? failure.message : "勋章操作未被接受")
      }
    } finally {pending.current=false;setBusy(false)}
  }
  async function verify() {
    const command=attempt.current;if(!command || pending.current || !canRead) return
    pending.current=true;setBusy(true)
    try {
      const saved=await getAdminMedalReceipt(userId,command.input.idempotencyKey)
      if(saved.medalKey!==command.input.medalKey || saved.reason!==command.input.reason || saved.expectedRevision!==command.input.expectedRevision || saved.operation!==(command.revoke?"revoke":"grant")) throw new Error("回执与保留请求不一致")
      await complete(saved)
    } catch(failure){setError(failure instanceof AdminApiError && failure.status===404 ? "尚未找到回执，不能据此认定请求失败。原请求仍保留，可使用原请求重试确认。" : "回执暂时无法核验，原请求仍保留。")} finally {pending.current=false;setBusy(false)}
  }
  if(!canRead) return null
  const locked=busy || unknown
  return <section className="user-medal-action" aria-label="当前用户勋章操作">
    <h3>勋章操作与记录</h3>
    <p>当前持有 {state ? state.medals.length+" 枚 · 修订 "+state.revision : "暂不可用"}。勋章不提供社区或治理权限。</p>
    {canWrite && !initialRevokeKey && <form className="admin-form" onSubmit={event=>void submit(event)}><label>勋章<select aria-label="发放勋章" value={medalKey} disabled={loading || locked} onChange={event=>setMedalKey(event.target.value)}>{rules.map(item=><option key={item.key} value={item.key}>{item.displayName}</option>)}</select></label><label>授予理由<input aria-label="勋章授予理由" value={reason} disabled={locked} pattern={"[a-z][a-z0-9._\\-]{1,63}"} onChange={event=>setReason(event.target.value)}/><small>填写 2 到 64 位小写运营理由标识。</small></label><button type="submit" className="primary-button" disabled={loading || locked || conflict || !state || !medalKey}>确认发放勋章</button></form>}
    {canWrite && !initialRevokeKey && state && state.medals.length>0 && <ul className="user-membership-records">{state.medals.map(item=><li key={item.key}><span>{item.displayName}</span><button type="button" className="danger-button" disabled={locked || conflict} onClick={()=>{setRevokeTarget(item);setRevokeReason("")}}>撤销{item.displayName}</button></li>)}</ul>}
    {canWrite && revokeTarget && <form className="admin-form" onSubmit={event=>void submit(event,true)}><p>撤销 {revokeTarget.displayName}，保留历史记录。</p><label>撤销原因<input aria-label={initialRevokeKey ? "撤销原因" : "勋章撤销原因"} value={revokeReason} maxLength={64} disabled={locked} onChange={event=>setRevokeReason(event.target.value)}/></label><button type="submit" className="danger-button" disabled={locked || loading || conflict || !state}>{initialRevokeKey ? "确认撤销" : "确认撤销勋章"}</button></form>}
    {initialRevokeKey && state && !state.medals.some(item=>item.key===initialRevokeKey) && !receipt && <p role="status">勋章已不在当前持有列表中。</p>}
    {unknown && attempt.current && <div className="membership-feedback"><p>待核验操作编号 <code>{attempt.current.input.idempotencyKey}</code></p><button type="button" className="secondary-button" disabled={busy || !canRead} onClick={()=>void verify()}>核验操作回执</button><button type="button" className="secondary-button" disabled={busy || !canWrite} onClick={()=>void submit()}>使用原请求重试确认</button></div>}
    {conflict && <button type="button" className="secondary-button" disabled={loading || busy} onClick={async()=>{if(await load()){setConflict(false);attempt.current=null}}}>刷新勋章基线</button>}
    {receipt && <dl className="points-receipt" aria-label="勋章操作回执"><div><dt>原始操作</dt><dd>{receipt.operation==="grant" ? "授予" : "撤销"} · {receipt.medalDisplayName} · {receipt.affected ? "已变更" : "无需变更"}{receipt.replayed ? " · 原请求重放" : ""}</dd></div><div><dt>原始持有结果</dt><dd>{receipt.ownedAfter ? "当时持有" : "当时未持有"} · 修订 {receipt.revision}</dd></div><div><dt>操作编号</dt><dd><code>{receipt.idempotencyKey}</code></dd></div><div><dt>原始请求号</dt><dd><code>{receipt.operationRequestId}</code></dd></div><div><dt>审计编号</dt><dd>{receipt.auditId ?? "无需变更，未产生审计事实"}</dd></div></dl>}
    {loading ? <p role="status">正在读取勋章操作记录</p> : !operations.length ? <p>没有勋章操作记录</p> : <ol className="user-membership-records">{operations.map(item=><li key={item.id}><strong>{item.medalDisplayName} · {item.operation==="revoke" ? "撤销" : item.operation==="automatic_grant" ? "自动授予" : "授予"}</strong><span>{item.reason} · 操作人 {item.actorDisplayName}</span><time>{new Date(item.createdAt).toLocaleString("zh-CN")}</time></li>)}</ol>}
    {nextCursor && <button type="button" className="secondary-button" disabled={loading || locked} onClick={()=>void load(nextCursor)}>加载更早勋章记录</button>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    {!unknown && <button type="button" className="secondary-button" disabled={loading || busy} onClick={()=>void load()}>刷新勋章记录</button>}
  </section>
}
