import {useEffect,useRef,useState,type FormEvent} from "react"
import {AdminApiError,getStandardEntitlementRenewalReceipt,listAdminStandardEntitlements,renewStandardEntitlement,
  type AdminStandardEntitlement,type RenewStandardEntitlementInput,type StandardEntitlementRenewal} from "../../api/admin"
import {permissionLabels,communityQuotaKeys,formatCommunityQuota} from "../../components/communityGroupRules"
import {ModalDialog} from "../../components/ui/ModalDialog"

export function entitlementRenewalUnavailable(target:AdminStandardEntitlement):string|null {
  if(target.revokedAt)return "已撤销，不能续期"
  if(!target.endsAt)return "永久权益无需续期"
  if(Date.parse(target.endsAt)<=Date.now())return "已到期，请重新发放"
  return null
}
export function EntitlementRenewalDialog({entitlement,csrfToken,canWrite,canRead,onSaved,onClose,onBusyChange}:{
  entitlement:AdminStandardEntitlement;csrfToken:string;canWrite:boolean;canRead:boolean
  onSaved:(result:StandardEntitlementRenewal)=>void;onClose:()=>void;onBusyChange:(busy:boolean)=>void
}){
  const [target,setTarget]=useState(entitlement)
  const [endsAt,setEndsAt]=useState("")
  const [reason,setReason]=useState("")
  const [error,setError]=useState("")
  const [conflict,setConflict]=useState(false)
  const [pending,setPending]=useState(false)
  const [attempt,setAttempt]=useState<RenewStandardEntitlementInput|null>(null)
  const pendingRef=useRef(false),mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{onBusyChange(pending||Boolean(attempt))},[pending,attempt,onBusyChange])
  useEffect(()=>()=>onBusyChange(false),[onBusyChange])
  function begin(){if(pendingRef.current)return false;pendingRef.current=true;setPending(true);setError("");return true}
  function finish(){pendingRef.current=false;if(mounted.current)setPending(false)}
  async function submit(event:FormEvent){
    event.preventDefault()
    if(!canWrite||conflict||(!attempt&&entitlementRenewalUnavailable(target))||pendingRef.current)return
    const parsed=new Date(endsAt)
    if(!attempt&&(!Number.isFinite(parsed.getTime())||parsed.getTime()<=Date.parse(target.endsAt!)||!reason.trim())){
      setError("请填写晚于原期限的新到期时间和续期原因。");return
    }
    const input=attempt??{userId:target.userId,expectedRevision:target.revision,endsAt:parsed.toISOString(),reason:reason.trim(),idempotencyKey:crypto.randomUUID()}
    if(!begin())return
    setAttempt(input)
    try{
      const saved=await renewStandardEntitlement(target.id,input,csrfToken)
      if(!mounted.current)return
      setAttempt(null);onSaved(saved)
    }catch(cause){
      if(!mounted.current)return
      if(attempt||!(cause instanceof AdminApiError)||cause.status>=500||cause.code==="response.invalid"){
        setError("续期结果尚未确认；原参数和请求编号已保留，请核实原回执或使用原请求重试。")
      }else{
        setAttempt(null);setConflict(cause.status===409);setError(cause.message)
      }
    }finally{finish()}
  }
  async function refresh(){
    if(!canRead||!begin())return
    try{
      const list=await listAdminStandardEntitlements(target.userId)
      if(!mounted.current)return
      const latest=list.find(item=>item.id===target.id&&item.userId===target.userId)
      if(!latest){setError("该权益记录已不存在，无法刷新续期基线。");return}
      setTarget(latest);setConflict(false);setError(entitlementRenewalUnavailable(latest)??"")
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:"续期基线读取失败。")}
    finally{finish()}
  }
  async function verify(){
    if(!attempt||!canRead||!begin())return
    const input=attempt
    try{
      const receipt=await getStandardEntitlementRenewalReceipt(input.userId,input.idempotencyKey)
      if(receipt.entitlementId!==target.id||receipt.expectedRevision!==input.expectedRevision||receipt.reason!==input.reason
        ||Date.parse(receipt.endsAt)!==Date.parse(input.endsAt)){
        throw new Error("续期回执与原命令不一致；继续保留原请求。")
      }
      const list=await listAdminStandardEntitlements(input.userId)
      if(!mounted.current)return
      const current=list.find(item=>item.id===target.id&&item.userId===input.userId)
      if(!current)throw new Error("原回执已找到，当前权益暂时无法读取；继续保留原请求。")
      if(current.revision<receipt.revision||!current.endsAt||Date.parse(current.endsAt)<Date.parse(receipt.endsAt)
        ||current.typeVersion!==receipt.typeVersion||Date.parse(current.startsAt)!==Date.parse(receipt.startsAt)
        ||JSON.stringify(current.permissionSnapshot)!==JSON.stringify(receipt.permissionSnapshot)
        ||Object.keys(current.quotaSnapshot).length!==Object.keys(receipt.quotaSnapshot).length
        ||Object.entries(receipt.quotaSnapshot).some(([key,value])=>current.quotaSnapshot[key]!==value)
        ||(current.revision===receipt.revision&&(current.revokedAt!==null||Date.parse(current.endsAt)!==Date.parse(receipt.endsAt)))){
        throw new Error("原回执与当前权益投影不一致；继续保留原请求。")
      }
      setAttempt(null);onSaved({receipt,entitlement:current,replayed:true})
    }catch(cause){
      if(mounted.current)setError(cause instanceof AdminApiError&&cause.status===404
        ?"尚未找到续期回执，继续保留原请求；404 不能确认原操作失败。"
        :cause instanceof Error?cause.message:"回执核实失败；继续保留原请求。")
    }finally{finish()}
  }
  const locked=pending||Boolean(attempt)
  return <ModalDialog element="form" className="admin-action-dialog admin-form entitlement-dialog" titleId="renew-entitlement-heading"
    busy={locked} initialFocusSelector="input:not(:disabled)" onClose={onClose} onSubmit={event=>void submit(event)}>
    <h2 id="renew-entitlement-heading">续期会员权益</h2>
    <p>原权益版本 {target.typeVersion}；沿用原权限与额度快照，仅延长到期时间。</p>
    <p>原到期时间：<time>{target.endsAt?new Date(target.endsAt).toLocaleString("zh-CN"):"永久"}</time></p>
    <details><summary>原权限与额度快照</summary><p>{target.permissionSnapshot.map(key=>permissionLabels[key as keyof typeof permissionLabels]??key).join("、")||"无普通能力"}</p>
      {Object.entries(target.quotaSnapshot).map(([key,value])=><p key={key}>{communityQuotaKeys.find(quota=>quota.key===key)?.label??key}：{formatCommunityQuota(key,value)}</p>)}</details>
    <label>新到期时间<input aria-label="新到期时间" type="datetime-local" required disabled={locked||!canWrite} value={endsAt} onChange={event=>setEndsAt(event.target.value)}/></label>
    <label>续期原因<input aria-label="续期原因" required maxLength={200} disabled={locked||!canWrite} value={reason} onChange={event=>setReason(event.target.value)}/></label>
    {attempt&&<p role="status">原续期编号：<code>{attempt.idempotencyKey}</code></p>}
    {error&&<p className="form-alert" role="alert">{error}</p>}
    {conflict&&<button type="button" className="secondary-button" disabled={pending||!canRead} onClick={()=>void refresh()}>刷新续期基线</button>}
    <footer className="admin-form__actions">
      <button type="button" className="secondary-button" disabled={locked} onClick={onClose}>取消</button>
      {attempt&&<button type="button" className="secondary-button" disabled={pending||!canRead} onClick={()=>void verify()}>核实原续期回执</button>}
      <button type="submit" className="primary-button" disabled={pending||conflict||!canWrite||(!attempt&&Boolean(entitlementRenewalUnavailable(target)))}>
        {pending?"正在核实":attempt?"使用原请求重试":"确认续期"}</button>
    </footer>
  </ModalDialog>
}
