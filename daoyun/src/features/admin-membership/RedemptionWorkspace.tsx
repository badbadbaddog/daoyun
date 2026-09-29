import { useEffect,useRef,useState,type FormEvent } from "react"
import { Plus,RefreshCw,Pencil } from "lucide-react"
import { listRedemptionProducts,putRedemptionProduct,RedemptionApiError,type RedemptionCatalog,type RedemptionProduct,type PutRedemptionProduct } from "../../api/redemptions"
import { listStandardEntitlementTypes,type StandardEntitlementType } from "../../api/admin"
import { AdminActionDialog } from "../../components/admin/AdminActionDialog"

export function RedemptionWorkspace({csrfToken,canWrite,canReadTypes}:{csrfToken:string;canWrite:boolean;canReadTypes:boolean}){
 const [catalog,setCatalog]=useState<RedemptionCatalog|null>(null)
 const [types,setTypes]=useState<StandardEntitlementType[]>([])
 const [version,setVersion]=useState(0)
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState("")
 const [notice,setNotice]=useState("")
 const [conflict,setConflict]=useState(false)
 const [draft,setDraft]=useState<(PutRedemptionProduct&{id:string})|null>(null)
 const pending=useRef(false)
 const mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError("")
  listRedemptionProducts({admin:true,signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setCatalog(value)})
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"商品加载失败")})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  if(canReadTypes)listStandardEntitlementTypes(controller.signal).then(value=>{if(!controller.signal.aborted)setTypes(value)})
   .catch(()=>{if(!controller.signal.aborted)setError("权益目录读取失败，请刷新重试。")})
  return()=>controller.abort()
 },[version,canReadTypes])
 function edit(item?:RedemptionProduct){
  setError("");setConflict(false)
  setDraft(item?{id:item.id,name:item.name,entitlement_type_id:item.entitlement_type_id,type_version:item.type_version,price:item.price,duration_days:item.duration_days,per_user_limit:item.per_user_limit,enabled:item.enabled,expected_revision:item.revision}:{id:crypto.randomUUID(),name:"",entitlement_type_id:"",type_version:1,price:100,duration_days:7,per_user_limit:1,enabled:false,expected_revision:null})
 }
 async function save(event:FormEvent){
  event.preventDefault();if(!draft||!canWrite||pending.current||conflict)return
  pending.current=true;setBusy(true);setError("")
  const {id,...input}=draft
  try{
   const value=await putRedemptionProduct(id,input,csrfToken)
   if(!mounted.current)return
   setCatalog(current=>current?{...current,products:[value,...current.products.filter(p=>p.id!==value.id)].sort((a,b)=>b.id.localeCompare(a.id))}:current)
   setDraft(null);setNotice("商品已保存")
  }catch(e){if(!mounted.current)return;setError(e instanceof Error?e.message:"保存失败");setConflict(e instanceof RedemptionApiError&&e.code==="redemption.conflict")}
  finally{pending.current=false;if(mounted.current)setBusy(false)}
 }
 async function more(){
  if(!catalog?.next_cursor||pending.current)return
  pending.current=true;setBusy(true)
  try{const page=await listRedemptionProducts({admin:true,cursor:catalog.next_cursor});if(!mounted.current)return;setCatalog(current=>({...page,products:[...(current?.products??[]),...page.products]}))}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:"加载失败")}finally{pending.current=false;if(mounted.current)setBusy(false)}
 }
 return <div className="redemption-workspace">
  <header className="redemption-heading"><div><h2>兑换商品</h2><p>配置积分价格与限时权益，历史兑换保留原始快照。</p></div><div className="redemption-actions"><button className="secondary-button" disabled={busy||loading} onClick={()=>setVersion(v=>v+1)}><RefreshCw size={15} aria-hidden="true"/>刷新商品</button>{canWrite&&<button className="primary-button" disabled={busy||loading||!catalog?.enabled||!canReadTypes||!types.some(t=>t.status==="active")} onClick={()=>edit()}><Plus size={15} aria-hidden="true"/>新增商品</button>}</div></header>
  {notice&&<p role="status">{notice}</p>}
  {error&&!draft&&<p role="alert" className="form-alert">{error}</p>}
  {!loading&&catalog&&!catalog.enabled&&<p role="status">请先在插件管理安装并启用积分兑换。</p>}
  {!loading&&canWrite&&canReadTypes&&catalog?.enabled&&!types.some(t=>t.status==="active")&&<p>暂无可用权益类型，请先在标准权益中创建并发布权益。</p>}
   {canWrite&&!canReadTypes&&<p>需要权益类型读取权限才能创建或更换商品权益。</p>}
  {loading?<p role="status">正在加载商品</p>:catalog?.products.length===0?<p>暂无兑换商品</p>:<ul className="redemption-products">{catalog?.products.map(item=><li key={item.id}><div><h3>{item.name}</h3><p>{item.price} 积分 · {item.duration_days} 天 · 每人限兑 {item.per_user_limit} 次</p><small>{item.enabled?"已上架":"已下架"} · 权益版本 {item.type_version}</small></div>{canWrite&&<button className="secondary-button" disabled={busy||!catalog.enabled} onClick={()=>edit(item)}><Pencil size={15} aria-hidden="true"/>编辑 {item.name}</button>}</li>)}</ul>}
  {catalog?.next_cursor&&<button className="secondary-button" disabled={busy} onClick={()=>void more()}>更多商品</button>}
  {draft&&<AdminActionDialog title={draft.expected_revision?"编辑兑换商品":"新增兑换商品"} busy={busy} onClose={()=>{if(!pending.current){setDraft(null);setError("")}}}>
   <form className="admin-form redemption-form" onSubmit={e=>void save(e)}>
    <label>商品名称<input required maxLength={80} value={draft.name} disabled={busy} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <label>兑换权益<select required value={draft.entitlement_type_id} disabled={busy||!canReadTypes} onChange={e=>{const kind=types.find(t=>t.id===e.target.value);if(kind)setDraft({...draft,entitlement_type_id:kind.id,type_version:kind.currentVersion})}}><option value="">选择权益</option>{draft.entitlement_type_id&&!types.some(t=>t.id===draft.entitlement_type_id)&&<option value={draft.entitlement_type_id}>当前商品权益</option>}{types.filter(t=>t.status==="active"||t.id===draft.entitlement_type_id).map(t=><option key={t.id} value={t.id}>{t.displayName}</option>)}</select></label>
    <p>固定权益版本：{draft.type_version}。更换权益时使用该类型当前发布版本。</p>
    <div className="redemption-fields">
     <label>所需积分<input type="number" required min={1} max={1000000} step={1} disabled={busy} value={draft.price} onChange={e=>setDraft({...draft,price:Number(e.target.value)})}/></label>
     <label>有效天数<input type="number" required min={1} max={3650} step={1} disabled={busy} value={draft.duration_days} onChange={e=>setDraft({...draft,duration_days:Number(e.target.value)})}/></label>
     <label>每人兑换上限<input type="number" required min={1} max={1000} step={1} disabled={busy} value={draft.per_user_limit} onChange={e=>setDraft({...draft,per_user_limit:Number(e.target.value)})}/></label>
    </div>
    <label className="redemption-checkbox"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>上架，允许成员兑换</label>
    {error&&<p className="form-alert" role="alert">{error}</p>}
    {conflict&&<button type="button" className="secondary-button" onClick={()=>{setDraft(null);setVersion(v=>v+1)}}>重新加载商品</button>}
    <footer className="redemption-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>{setDraft(null);setError("")}}>取消</button><button className="primary-button" type="submit" disabled={busy||conflict}>{busy?"正在保存":"保存商品"}</button></footer>
   </form>
  </AdminActionDialog>}
 </div>
}
