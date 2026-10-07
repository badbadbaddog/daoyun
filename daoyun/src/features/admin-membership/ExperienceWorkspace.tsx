import {useCallback,useEffect,useRef,useState,type FormEvent} from "react"
import {AdminApiError,getAdminExperience,adjustAdminExperience,type AdminExperienceAccount,type AdminExperienceInput,type AdminExperienceAdjustment,type AdminExperienceLedgerEntry} from "../../api/admin"
import {listUsers} from "../../api/users"
import {AdminUserPicker,type AdminUserCandidate} from "../../components/admin/AdminUserPicker"
import {OperationalLedger} from "./OperationalLedger"

export function ExperienceWorkspace({csrfToken,canRead,canWrite,canReadUsers,onBusyChange}:{csrfToken:string;canRead:boolean;canWrite:boolean;canReadUsers:boolean;onBusyChange:(busy:boolean)=>void}) {
  const [query,setQuery]=useState("")
  const [users,setUsers]=useState<AdminUserCandidate[]>([])
  const [selected,setSelected]=useState<AdminUserCandidate|null>(null)
  const [loading,setLoading]=useState(false)
  const [busy,setBusy]=useState(false)
  const changeBusy=useCallback((value:boolean)=>{setBusy(value);onBusyChange(value)},[onBusyChange])
  useEffect(()=>{
    const controller=new AbortController()
    if(!canReadUsers || query.trim().length<2){setUsers([]);setLoading(false);return}
    const timer=window.setTimeout(()=>{setLoading(true);listUsers(query.trim(),{limit:10,signal:controller.signal}).then(page=>{if(!controller.signal.aborted)setUsers(page.users.map(user=>({...user,status:"active"})))}).catch(()=>{if(!controller.signal.aborted)setUsers([])}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})},250)
    return()=>{window.clearTimeout(timer);controller.abort()}
  },[query,canReadUsers])
  return <section className="experience-workspace" aria-label="用户 EXP 管理"><h3>用户 EXP 管理</h3>{canReadUsers ? <AdminUserPicker query={query} users={users} selectedUser={selected} loading={loading} disabled={busy} onQueryChange={setQuery} onSelect={user=>{if(!busy)setSelected(user)}}/> : <p>需要用户读取权限才能在此选择成员；也可从用户详情进入。</p>}{selected ? <UserExperienceAction key={selected.id} userId={selected.id} csrfToken={csrfToken} canRead={canRead} canWrite={canWrite} onChanged={()=>{}} onBusyChange={changeBusy}/> : <p>请选择成员查看 EXP 与流水。</p>}</section>
}

export function UserExperienceAction({userId,csrfToken,canRead,canWrite,onChanged,onBusyChange}:{userId:string;csrfToken:string;canRead:boolean;canWrite:boolean;onChanged:()=>void;onBusyChange:(busy:boolean)=>void}) {
  const [account,setAccount]=useState<AdminExperienceAccount|null>(null)
  const [loading,setLoading]=useState(true)
  const [readError,setReadError]=useState("")
  const [amount,setAmount]=useState("")
  const [reason,setReason]=useState("")
  const [reversal,setReversal]=useState<AdminExperienceLedgerEntry|null>(null)
  const [busy,setBusy]=useState(false)
  const [unknown,setUnknown]=useState(false)
  const [conflict,setConflict]=useState(false)
  const [error,setError]=useState("")
  const [result,setResult]=useState<AdminExperienceAdjustment|null>(null)
  const [refreshKey,setRefreshKey]=useState(0)
  const pending=useRef(false)
  const attempt=useRef<AdminExperienceInput|null>(null)
  const version=useRef(0)
  const identity=useRef(userId);identity.current=userId
  useEffect(()=>{const controller=new AbortController();setAccount(null);void read(controller.signal);return()=>{controller.abort();version.current+=1}},[userId,canRead])
  useEffect(()=>{onBusyChange(busy || unknown)},[busy,unknown,onBusyChange])
  useEffect(()=>()=>onBusyChange(false),[onBusyChange])
  async function read(signal?:AbortSignal){
    if(!canRead){setLoading(false);return false}
    const request=++version.current;setLoading(true);setReadError("")
    try{const latest=await getAdminExperience(userId,signal);if(signal?.aborted || request!==version.current)return false;setAccount(latest);return true}
    catch(failure){if(!signal?.aborted && request===version.current){setAccount(null);setReadError(failure instanceof AdminApiError ? failure.message : "EXP 账户暂不可用")};return false}
    finally{if(!signal?.aborted && request===version.current)setLoading(false)}
  }
  async function submit(event?:FormEvent){
    event?.preventDefault();if(!canRead || !canWrite || pending.current || (!unknown && (!account || conflict || loading)))return
    if(!unknown){
      const delta=reversal ? -reversal.amount : Number(amount),text=reason.trim()
      if(!Number.isSafeInteger(delta) || delta===0 || Math.abs(delta)>1000000 || (!reversal && delta<0) || Array.from(text).length<2 || Array.from(text).length>500 || /\p{Cc}/u.test(text)){setError("请填写 1 到 1,000,000 的整数 EXP 与 2 到 500 字原因");return}
      attempt.current={userId,amount:delta,reason:text,reversalOf:reversal?.id ?? null,expectedRevision:account!.revision,idempotencyKey:"experience:"+crypto.randomUUID()}
    }
    const input=attempt.current;if(!input)return
    pending.current=true;setBusy(true);setError("")
    try{const saved=await adjustAdminExperience(input,csrfToken);if(identity.current!==input.userId)return;setResult(saved);setAccount(saved.account);setUnknown(false);setConflict(false);setAmount("");setReason("");setReversal(null);attempt.current=null;setRefreshKey(current=>current+1);onChanged()}
    catch(failure){if(identity.current!==input.userId)return;const uncertain=unknown || !(failure instanceof AdminApiError && failure.status>=400 && failure.status<500 && failure.code!=="response.invalid");setUnknown(uncertain);if(!uncertain)attempt.current=null;setConflict(!uncertain && failure instanceof AdminApiError && failure.status===409);setError(uncertain ? "EXP 操作结果尚未确认，原请求已保留。请使用原请求重试确认。" : failure instanceof Error ? failure.message : "EXP 操作未被接受")}
    finally{pending.current=false;setBusy(false)}
  }
  if(!canRead)return null
  const locked=busy || unknown
  return <section className="experience-workspace" aria-label="当前用户 EXP 操作"><p>EXP 用于成长等级；积分、勋章与管理角色独立。</p>
    {loading ? <p role="status">正在读取 EXP 账户</p> : readError ? <div><p className="form-alert" role="alert">{readError}</p><button type="button" className="secondary-button" onClick={()=>void read()}>重新读取 EXP 账户</button></div> : !account ? <p>EXP 账户尚未初始化</p> : <>
      <dl className="points-receipt"><div><dt>当前 EXP</dt><dd>{account.experience.toLocaleString()}</dd></div><div><dt>已达等级</dt><dd>Lv {account.currentLevel.levelOrder} · {account.currentLevel.displayName}</dd></div><div><dt>账户修订</dt><dd>{account.revision}</dd></div></dl>
      {canWrite && <form className="admin-form" onSubmit={event=>void submit(event)}>
        {reversal ? <div><p>冲正原流水 <code>{reversal.id}</code>：-{reversal.amount.toLocaleString()} EXP。保持已达等级。</p><button type="button" className="secondary-button" disabled={locked} onClick={()=>setReversal(null)}>取消冲正</button></div> : <label>增加 EXP 数量<input aria-label="增加 EXP 数量" type="number" min={1} max={1000000} step={1} value={amount} disabled={locked} onChange={event=>setAmount(event.target.value)}/></label>}
        <label>EXP 调整原因<textarea aria-label="EXP 调整原因" maxLength={500} value={reason} disabled={locked} onChange={event=>setReason(event.target.value)}/></label>
        <p>本次 {reversal ? "-"+reversal.amount : amount ? "+"+amount : "—"} EXP；实际余额以回执为准。扣减须选择原始正向流水进行完整冲正。</p>
        <button className={reversal ? "danger-button" : "primary-button"} type="submit" disabled={locked || conflict}>{reversal ? "确认 EXP 冲正" : "确认 EXP 调整"}</button>
      </form>}
    </>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    {unknown && attempt.current && <div><p>重试编号 <code>{attempt.current.idempotencyKey}</code></p><button type="button" className="secondary-button" disabled={busy || !canWrite} onClick={()=>void submit()}>使用原请求重试确认</button></div>}
    {conflict && <button type="button" className="secondary-button" disabled={loading || busy} onClick={async()=>{if(await read()){setConflict(false);setError("");setRefreshKey(current=>current+1)}}}>刷新 EXP 基线</button>}
    {result && <dl className="points-receipt" aria-label="EXP 操作回执"><div><dt>原始变更后 EXP</dt><dd>{result.entry.balanceAfter.toLocaleString()} · 修订 {result.entry.revisionAfter ?? "历史记录未提供"}</dd></div><div><dt>最新账户 EXP</dt><dd>{result.account.experience.toLocaleString()}{result.replayed ? " · 原请求重放" : ""}</dd></div><div><dt>流水编号</dt><dd><code>{result.entry.id}</code></dd></div><div><dt>原始请求号</dt><dd>{result.entry.operationRequestId ?? "历史记录未提供"}</dd></div><div><dt>审计编号</dt><dd>{result.entry.auditId ?? "历史记录未提供"}</dd></div></dl>}
    <OperationalLedger kind="experience" userId={userId} canRead={canRead} refreshKey={refreshKey} onReverse={canWrite && !locked && !conflict && !!account ? entry=>{setReversal(entry);setReason("");setError("")} : undefined}/>
  </section>
}
