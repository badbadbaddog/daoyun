import {useEffect,useRef,useState,type FormEvent} from "react"
import {Plus,RefreshCw,Pencil} from "lucide-react"
import {listRedemptionProducts,putRedemptionProduct,RedemptionApiError,type RedemptionCatalog,type RedemptionProduct,type PutRedemptionProduct} from "../../api/redemptions"
import {listStandardEntitlementTypes,type StandardEntitlementType} from "../../api/admin"
import {AdminActionDialog} from "../../components/admin/AdminActionDialog"
import {permissionLabels,communityQuotaKeys,formatCommunityQuota} from "../../components/communityGroupRules"

type ProductDraft=PutRedemptionProduct&{id:string}
export function RedemptionWorkspace({csrfToken,canWrite,canReadTypes}:{csrfToken:string;canWrite:boolean;canReadTypes:boolean}){
 const [catalog,setCatalog]=useState<RedemptionCatalog|null>(null)
 const [types,setTypes]=useState<StandardEntitlementType[]>([])
 const [version,setVersion]=useState(0)
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState("")
 const [notice,setNotice]=useState("")
 const [conflict,setConflict]=useState(false)
 const [draft,setDraft]=useState<ProductDraft|null>(null)
 const [attempt,setAttempt]=useState<ProductDraft|null>(null)
 const [observed,setObserved]=useState<RedemptionProduct|null>(null)
 const pending=useRef(false),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError("")
  listRedemptionProducts({admin:true,signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setCatalog(value)})
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"商品加载失败")})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  if(canReadTypes)listStandardEntitlementTypes(controller.signal).then(value=>{if(!controller.signal.aborted)setTypes(value)})
   .catch(()=>{if(!controller.signal.aborted)setError("权益目录读取失败，请刷新重试。")})
  else setTypes([])
  return()=>controller.abort()
 },[version,canReadTypes])
 const locked=busy||Boolean(attempt)
 function begin(){if(pending.current)return false;pending.current=true;setBusy(true);setError("");return true}
 function finish(){pending.current=false;if(mounted.current)setBusy(false)}
 function close(){if(locked||pending.current)return;setDraft(null);setError("");setConflict(false);setObserved(null)}
 function edit(item?:RedemptionProduct){
  if(locked||!canWrite)return
  setError("");setConflict(false);setObserved(null)
  setDraft(item?{id:item.id,name:item.name,entitlement_type_id:item.entitlement_type_id,type_version:item.type_version,price:item.price,duration_days:item.duration_days,per_user_limit:item.per_user_limit,enabled:item.enabled,expected_revision:item.revision}:{id:crypto.randomUUID(),name:"",entitlement_type_id:"",type_version:1,price:100,duration_days:7,per_user_limit:1,enabled:false,expected_revision:null})
 }
 async function save(event:FormEvent){
  event.preventDefault();if(!draft||!canWrite||!canReadTypes||!catalog?.enabled||pending.current||conflict)return
  const command=attempt??{...draft},wasUnknown=Boolean(attempt)
  if(!begin())return
  const {id,...input}=command
  setAttempt(command);setObserved(null)
  try{
   const value=await putRedemptionProduct(id,input,csrfToken)
   if(!mounted.current)return
   setCatalog(current=>current?{...current,products:[value,...current.products.filter(p=>p.id!==value.id)].sort((a,b)=>b.id.localeCompare(a.id))}:current)
   setAttempt(null);setDraft(null);setNotice("商品已保存")
  }catch(e){
   if(!mounted.current)return
   // A later 4xx cannot disprove an earlier command whose response was lost.
   if(wasUnknown||!(e instanceof RedemptionApiError)||e.status>=500||e.code==="response.invalid"){
    setError("商品保存结果尚未确认；原商品 UUID 和输入已保留，请核实当前商品或使用原请求重试。")
   }else{
    setAttempt(null);setConflict(e.status===409);setError(e.message)
   }
  }finally{finish()}
 }
 async function refreshTarget(){
  if(!draft||!begin())return
  const command=attempt??draft
  try{
   let cursor:string|undefined
   const seen=new Set<string>()
   // Existing paginated reads are sufficient; never invent an order/receipt API.
   for(let pageNumber=0;pageNumber<100;pageNumber++){
    const page=await listRedemptionProducts({admin:true,cursor})
    if(!mounted.current)return
    setCatalog(current=>current?{...current,enabled:page.enabled}:page)
    const current=page.products.find(item=>item.id===command.id)
    if(current){
     if(attempt){
      if(current.revision<=(command.expected_revision??0)){
       setError("当前商品尚未出现新的版本，仍不能确认原保存结果；继续保留原请求。");return
      }
      setObserved(current)
      setError("已读取当前商品版本 "+current.revision+"；当前状态不能替代原保存回执。显式采用该版本后可继续编辑原商品。")
     }else{
      setDraft(previous=>previous?{...previous,expected_revision:current.revision}:previous)
      setConflict(false);setError("");setNotice("已刷新商品版本，编辑草稿已保留。")
     }
     return
    }
    if(!page.next_cursor){setError("尚未找到原商品，不能确认原保存失败；继续保留草稿和原目标。");return}
    if(seen.has(page.next_cursor))throw new Error("商品分页重复，无法核实原目标。")
    seen.add(page.next_cursor);cursor=page.next_cursor
   }
   setError("商品目录较大，本次未找到原目标；继续保留草稿和原请求。")
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:"商品读取失败，继续保留原请求。")}
  finally{finish()}
 }
 function adoptObserved(){
  if(!observed||!attempt||pending.current)return
  // A persisted newer revision fences the old conditional PUT; retain its UUID.
  setDraft(previous=>previous?{...previous,expected_revision:observed.revision}:previous)
  setAttempt(null);setObserved(null);setConflict(false);setError("")
  setNotice("已采用读取到的商品版本，保留原 UUID 和草稿；原保存结果未确认。")
 }
 async function more(){
  if(!catalog?.next_cursor||locked||!begin())return
  try{const page=await listRedemptionProducts({admin:true,cursor:catalog.next_cursor});if(mounted.current)setCatalog(current=>({...page,products:[...(current?.products??[]),...page.products]}))}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:"加载失败")}
  finally{finish()}
 }
 return <div className="redemption-workspace">
  <header className="redemption-heading"><div><h2>兑换商品</h2><p>配置积分价格与限时会员权益，历史兑换保留原始快照。</p></div><div className="redemption-actions">
   <button className="secondary-button" disabled={locked||loading} onClick={()=>setVersion(v=>v+1)}><RefreshCw size={15} aria-hidden="true"/>刷新商品</button>
   {canWrite&&<button className="primary-button" disabled={locked||loading||!catalog?.enabled||!canReadTypes||!types.some(t=>t.status==="active")} onClick={()=>edit()}><Plus size={15} aria-hidden="true"/>新增商品</button>}
  </div></header>
  {notice&&<p role="status">{notice}</p>}
  {error&&!draft&&<p role="alert" className="form-alert">{error}</p>}
  {!loading&&catalog&&!catalog.enabled&&<><p role="status">请先在插件管理安装并启用积分兑换。</p><p>停用保留历史兑换和已获得的有效会员权益。</p></>}
  {!loading&&canWrite&&canReadTypes&&catalog?.enabled&&!types.some(t=>t.status==="active")&&<p>暂无可用权益类型，请先在会员权益中创建并发布权益。</p>}
  {canWrite&&!canReadTypes&&<p>需要权益类型读取权限才能创建或更换商品权益。</p>}
  {loading?<p role="status">正在加载商品</p>:catalog?.products.length===0?<p>暂无兑换商品</p>:<ul className="redemption-products" aria-label="兑换商品目录">{catalog?.products.map(item=><li key={item.id}>
   <div><h3>{item.name}</h3><p>{item.price} 积分 · {item.duration_days} 天 · 每人限兑 {item.per_user_limit} 次</p><small>{item.enabled?"已上架":"已下架"} · 权益版本 {item.type_version} · 商品版本 {item.revision}</small>
    <details><summary>权益能力与额度快照</summary><ul>{item.permission_keys.map(key=><li key={key}>{permissionLabels[key as keyof typeof permissionLabels]??key}</li>)}</ul>
     {Object.entries(item.quotas).map(([key,value])=><p key={key}>{communityQuotaKeys.find(quota=>quota.key===key)?.label??key}：{formatCommunityQuota(key,value)}</p>)}
     {item.permission_keys.length===0&&Object.keys(item.quotas).length===0&&<p>无普通能力或额外额度</p>}
    </details>{item.unavailable_reason&&<p>{item.unavailable_reason}</p>}
   </div>{canWrite&&<button className="secondary-button" disabled={locked||!catalog.enabled} onClick={()=>edit(item)}><Pencil size={15} aria-hidden="true"/>编辑 {item.name}</button>}
  </li>)}</ul>}
  {catalog?.next_cursor&&<button className="secondary-button" disabled={locked} onClick={()=>void more()}>更多商品</button>}
  {draft&&<AdminActionDialog title={draft.expected_revision?"编辑兑换商品":"新增兑换商品"} busy={locked} onClose={close}>
   <form className="admin-form redemption-form" onSubmit={e=>void save(e)}>
    <label>商品名称<input required maxLength={80} value={draft.name} disabled={locked||!canWrite} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <label>兑换权益<select required value={draft.entitlement_type_id} disabled={locked||!canWrite||!canReadTypes} onChange={e=>{const kind=types.find(t=>t.id===e.target.value);if(kind)setDraft({...draft,entitlement_type_id:kind.id,type_version:kind.currentVersion})}}><option value="">选择权益</option>{draft.entitlement_type_id&&!types.some(t=>t.id===draft.entitlement_type_id)&&<option value={draft.entitlement_type_id}>当前商品权益</option>}{types.filter(t=>t.status==="active"||t.id===draft.entitlement_type_id).map(t=><option key={t.id} value={t.id}>{t.displayName}</option>)}</select></label>
    <p>固定权益版本：{draft.type_version}。更换权益时使用该类型当前发布版本。</p>
    <div className="redemption-fields">
     <label>所需积分<input type="number" required min={1} max={1000000} step={1} disabled={locked||!canWrite} value={draft.price} onChange={e=>setDraft({...draft,price:Number(e.target.value)})}/></label>
     <label>有效天数<input type="number" required min={1} max={3650} step={1} disabled={locked||!canWrite} value={draft.duration_days} onChange={e=>setDraft({...draft,duration_days:Number(e.target.value)})}/></label>
     <label>每人兑换上限<input type="number" required min={1} max={1000} step={1} disabled={locked||!canWrite} value={draft.per_user_limit} onChange={e=>setDraft({...draft,per_user_limit:Number(e.target.value)})}/></label>
    </div>
    <label className="redemption-checkbox"><input type="checkbox" checked={draft.enabled} disabled={locked||!canWrite} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>上架，允许成员兑换</label>
    {attempt&&<p role="status">原商品 UUID：<code>{attempt.id}</code></p>}
    {error&&<p className="form-alert" role="alert">{error}</p>}
    {conflict&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void refreshTarget()}>重新加载商品</button>}
    {attempt&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void refreshTarget()}>核实当前商品</button>}
    {observed&&<button type="button" className="secondary-button" disabled={busy} onClick={adoptObserved}>采用已读取的商品版本</button>}
    <footer className="redemption-actions"><button type="button" className="secondary-button" disabled={locked} onClick={close}>取消</button>
     <button className="primary-button" type="submit" disabled={busy||conflict||!canWrite||!canReadTypes||!catalog?.enabled}>{busy?"正在保存":attempt?"使用原商品请求重试":"保存商品"}</button>
    </footer>
   </form>
  </AdminActionDialog>}
 </div>
}
