import { useEffect, useRef, useState } from "react"
import { Coins, RefreshCw } from "lucide-react"
import { listRedemptionProducts, listRedemptions, redeemPoints, type RedemptionCatalog, type RedemptionHistory, type RedemptionProduct } from "../../api/redemptions"
import { ModalDialog } from "../../components/ui/ModalDialog"
import { permissionLabels, communityQuotaKeys } from "../../components/CommunityGroupQuotaDialog"

export function RedemptionPanel({balance,csrfToken,onChanged}:{balance:number;csrfToken:string;onChanged:()=>void}) {
 const [catalog,setCatalog]=useState<RedemptionCatalog|null>(null)
 const [history,setHistory]=useState<RedemptionHistory|null>(null)
 const [error,setError]=useState("")
 const [version,setVersion]=useState(0)
 const [loading,setLoading]=useState(true)
 const [target,setTarget]=useState<RedemptionProduct|null>(null)
 const [busy,setBusy]=useState(false)
 const [notice,setNotice]=useState("")
 const pending=useRef(false)
 const attempt=useRef<{product:string;revision:number;key:string}|null>(null)
 const alive=useRef(true)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError("")
  Promise.all([listRedemptionProducts({signal:controller.signal}),listRedemptions({signal:controller.signal})])
   .then(([a,b])=>{if(!controller.signal.aborted){setCatalog(a);setHistory(b)}})
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"兑换服务加载失败")})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[version])
 async function more(kind:"products"|"records") {
  if(pending.current)return
  pending.current=true;setBusy(true);setError("")
  try {
   if(kind==="products"&&catalog?.next_cursor){
    const page=await listRedemptionProducts({cursor:catalog.next_cursor})
    if(alive.current)setCatalog(current=>({...page,products:[...(current?.products??[]),...page.products]}))
   }else if(kind==="records"&&history?.next_cursor){
    const page=await listRedemptions({cursor:history.next_cursor})
    if(alive.current)setHistory(current=>({...page,records:[...(current?.records??[]),...page.records]}))
   }
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:"加载失败")}
  finally{pending.current=false;if(alive.current)setBusy(false)}
 }
 async function confirm(){
  if(!target||pending.current||target.price>balance||!catalog?.enabled)return
  pending.current=true;setBusy(true);setError("")
  if(attempt.current?.product!==target.id||attempt.current.revision!==target.revision)
   attempt.current={product:target.id,revision:target.revision,key:crypto.randomUUID()}
  try{
   const result=await redeemPoints(target.id,target.revision,attempt.current.key,csrfToken)
   if(!alive.current)return
   setTarget(null);attempt.current=null
   setNotice("兑换成功："+result.product_name+"，有效期至 "+new Date(result.ends_at).toLocaleString())
   setVersion(v=>v+1);onChanged()
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:"兑换失败，请重试")}
  finally{pending.current=false;if(alive.current)setBusy(false)}
 }
 return <section className="member-panel redemption-panel" aria-label="积分兑换">
  <header className="redemption-heading"><div><p className="member-panel__eyebrow">使用积分获得权益</p><h2>积分兑换</h2></div><button className="secondary-button" disabled={busy||loading} onClick={()=>{setTarget(null);setVersion(v=>v+1)}}><RefreshCw size={15} aria-hidden="true"/>刷新</button></header>
  {notice&&<p role="status">{notice}</p>}
  {error&&!target&&<p role="alert" className="interaction-alert">{error}</p>}
  {loading?<p role="status">正在加载兑换商品</p>:catalog&&!catalog.enabled?<p role="status">积分兑换暂未开放，历史兑换记录仍可查看。</p>:catalog?.products.length===0?<p>暂无可兑换权益</p>:<ul className="redemption-products">
   {catalog?.products.map(p=><li key={p.id}><div><h3>{p.name}</h3><p>{p.price.toLocaleString()} 积分 · {p.duration_days} 天 · 每人限兑 {p.per_user_limit} 次</p>
    <p>{p.permission_keys.map(k=>permissionLabels[k as keyof typeof permissionLabels]??"社区权限").join("、")}</p>
    {Object.entries(p.quotas).map(([key,value])=><small key={key}>{communityQuotaKeys.find(q=>q.key===key)?.label??"使用额度"}：{value.toLocaleString()} </small>)}
   </div><button className="secondary-button" disabled={busy||!!p.unavailable_reason||p.price>balance} onClick={()=>{setError("");setNotice("");setTarget(p)}} aria-label={p.unavailable_reason??(p.price>balance?"积分不足":"兑换 "+p.name)}><Coins size={15} aria-hidden="true"/>{p.unavailable_reason??(p.price>balance?"积分不足":"兑换")}</button></li>)}
  </ul>}
  {catalog?.enabled&&catalog.next_cursor&&<button className="secondary-button" disabled={busy} onClick={()=>void more("products")}>更多商品</button>}
  <h3>兑换记录</h3>
  {history?.records.length===0?<p>暂无兑换记录</p>:<ul className="redemption-history">{history?.records.map(r=><li key={r.id}><strong>{r.product_name}</strong><span>−{r.price} 积分 · {new Date(r.created_at).toLocaleString()}</span><small>有效期至 {new Date(r.ends_at).toLocaleString()}</small></li>)}</ul>}
  {history?.next_cursor&&<button className="secondary-button" disabled={busy} onClick={()=>void more("records")}>更早记录</button>}
  {target&&<ModalDialog titleId="redemption-confirm-title" className="dialog-panel redemption-confirm" onClose={()=>{if(!pending.current){setTarget(null);setError("")}}} busy={busy}>
   <h2 id="redemption-confirm-title">确认兑换</h2><h3>{target.name}</h3><p>当前余额：{balance.toLocaleString()}</p><p>本次扣除：{target.price.toLocaleString()}</p><p>兑换后余额：{(balance-target.price).toLocaleString()}</p><p>成功后立即生效，有效期 {target.duration_days} 天。</p>
   {error&&<p className="interaction-alert" role="alert">{error}</p>}
   <footer className="redemption-actions"><button className="secondary-button" disabled={busy} onClick={()=>{setTarget(null);setError("")}}>取消</button><button className="primary-button" disabled={busy||target.price>balance} onClick={()=>void confirm()}>{busy?"正在兑换":"确认兑换"}</button></footer>
  </ModalDialog>}
 </section>
}
