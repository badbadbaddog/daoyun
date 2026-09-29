import {useEffect,useImperativeHandle,useRef,useState,type Ref} from "react"
import {DraftApiError,deleteDraft,getDraft,listDrafts,saveDraft,type DraftContent,type MemberDraft} from "../api/drafts"
import {plainTextDocument,toPlainText} from "../editor/richContent"
import {ConfirmDialog} from "./ui/ConfirmDialog"
export interface DraftHandle {flush:()=>Promise<{id:string;revision:number}|null>;complete:()=>void}
interface Props {ownerId:string;csrfToken:string;storageKey:string;ready:boolean;content:DraftContent;busy?:boolean;onRestore:(content:DraftContent)=>void;ref?:Ref<DraftHandle>}
interface Reference {id:string;revision:number}
function readReference(key:string):Reference|null{try{const value=JSON.parse(localStorage.getItem(key)??"null");return value&&typeof value.id==="string"&&Number.isSafeInteger(value.revision)&&value.revision>=0?value:null}catch{return null}}
function persist(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Existing composer also keeps the live text in memory. */}}
function hasContent(content:DraftContent){return Boolean(content.title.trim()||toPlainText(content.rich_content).trim()||content.images.length||content.poll)}
export function DraftShelf({ownerId,csrfToken,storageKey,ready,content,busy=false,onRestore,ref}:Props){
 const metaKey=storageKey+":server:"+ownerId
 const reference=useRef<Reference>(readReference(metaKey)??{id:crypto.randomUUID(),revision:0})
 const latest=useRef(content);latest.current=content
 const saved=useRef<string|null>(null)
 const serial=useRef<Promise<unknown>>(Promise.resolve())
 const mounted=useRef(true)
 const blocked=useRef(false)
 const completed=useRef(false)
 const [status,setStatus]=useState("内容会自动同步到草稿箱")
 const [error,setError]=useState("")
 const [conflict,setConflict]=useState(false)
 const [saving,setSaving]=useState(false)
 const [opened,setOpened]=useState(false)
 const [rows,setRows]=useState<MemberDraft[]>([])
 const [cursor,setCursor]=useState<string|null>(null)
 const [loading,setLoading]=useState(false)
 const [deleting,setDeleting]=useState<MemberDraft|null>(null)
 const [recovery,setRecovery]=useState<DraftContent|null>(()=>{try{return JSON.parse(localStorage.getItem(metaKey+":recovery")??"null")}catch{return null}})
 const listRequest=useRef<AbortController|null>(null)
 const snapshot=JSON.stringify(content)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;listRequest.current?.abort()}},[])
 async function flush():Promise<Reference|null>{
  const payload=latest.current
  const task=serial.current.catch(()=>undefined).then(async()=>{
   if(completed.current)return null
   if(blocked.current)throw new Error("草稿存在版本冲突，请先查看服务器版或另存本地副本")
   if(!hasContent(payload)&&reference.current.revision===0)return null
   if(saved.current===JSON.stringify(payload))return {...reference.current}
   persist(metaKey,reference.current)
   if(mounted.current){setSaving(true);setError("");setStatus("正在同步草稿…")}
   try{
    const row=await saveDraft(reference.current.id,reference.current.revision,payload,csrfToken)
    reference.current={id:row.id,revision:row.revision};saved.current=JSON.stringify(payload);persist(metaKey,reference.current)
    if(mounted.current)setStatus("已同步到草稿箱")
    return {...reference.current}
   }catch(e){
    if(e instanceof DraftApiError&&(e.code==="draft.conflict"||e.code==="draft.not_found")){blocked.current=true;if(mounted.current)setConflict(true)}
    if(mounted.current){setError(e instanceof Error?e.message:"草稿同步失败");setStatus("尚未同步；本地恢复副本仍保留")}
    throw e
   }finally{if(mounted.current)setSaving(false)}
  })
  serial.current=task;return task
 }
 function complete(){completed.current=true;try{localStorage.removeItem(metaKey)}catch{/* Storage may be disabled. */}}
 useImperativeHandle(ref,()=>({flush,complete}))
 useEffect(()=>{
  if(!ready||busy||blocked.current||completed.current)return
  const timer=window.setTimeout(()=>{void flush().catch(()=>undefined)},800)
  return()=>window.clearTimeout(timer)
  // The serialized content, rather than object identity, drives the debounce.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[snapshot,ready,busy])
 useEffect(()=>{
  const beforeUnload=(event:BeforeUnloadEvent)=>{if(hasContent(latest.current)&&saved.current!==JSON.stringify(latest.current)){event.preventDefault();event.returnValue=""}}
  window.addEventListener("beforeunload",beforeUnload);return()=>window.removeEventListener("beforeunload",beforeUnload)
 },[])
 async function loadList(next?:string){
  const controller=new AbortController();listRequest.current?.abort();listRequest.current=controller;setLoading(true);setError("")
  try{const page=await listDrafts(next,controller.signal);if(!controller.signal.aborted){setRows(previous=>next?[...previous,...page.drafts]:page.drafts);setCursor(page.next_cursor)}}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"草稿箱读取失败")}finally{if(!controller.signal.aborted)setLoading(false)}
 }
 function apply(row:MemberDraft){reference.current={id:row.id,revision:row.revision};persist(metaKey,reference.current);saved.current=JSON.stringify(row.content);blocked.current=false;setConflict(false);setError("");setStatus("已同步到草稿箱");onRestore(row.content)}
 async function select(row:MemberDraft){
  setLoading(true)
  try{const before=JSON.stringify(latest.current);await flush();const fresh=await getDraft(row.id);if(mounted.current){if(JSON.stringify(latest.current)!==before)throw new Error("读取期间正文已变化，请保存后重新切换草稿");apply(fresh);setOpened(false)}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"草稿读取失败")}finally{if(mounted.current)setLoading(false)}
 }
 async function newDraft(){try{const before=JSON.stringify(latest.current);await flush();if(JSON.stringify(latest.current)!==before)throw new Error("同步期间正文已变化，请稍后重试");reference.current={id:crypto.randomUUID(),revision:0};persist(metaKey,reference.current);saved.current=null;onRestore({title:"",board_id:content.board_id,rich_content:plainTextDocument(""),images:[],poll:null});setOpened(false);setStatus("新草稿尚未填写")}catch(e){setError(e instanceof Error?e.message:"当前草稿尚未同步，不能切换")}}
 async function saveCopy(){await serial.current.catch(()=>undefined);reference.current={id:crypto.randomUUID(),revision:0};saved.current=null;blocked.current=false;setConflict(false);await flush().catch(()=>undefined)}
 async function readServer(){
  const local=latest.current;persist(metaKey+":recovery",local);setRecovery(local);setLoading(true)
  try{const row=await getDraft(reference.current.id);if(mounted.current){persist(metaKey+":recovery",latest.current);setRecovery(latest.current);apply(row)}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"服务器草稿读取失败")}finally{if(mounted.current)setLoading(false)}
 }
 async function remove(){if(!deleting)return;setLoading(true);try{await deleteDraft(deleting.id,deleting.revision,csrfToken);if(deleting.id===reference.current.id){reference.current={id:crypto.randomUUID(),revision:0};saved.current=null;persist(metaKey,reference.current);onRestore({title:"",board_id:content.board_id,rich_content:plainTextDocument(""),images:[],poll:null})}setDeleting(null);await loadList()}catch(e){setError(e instanceof Error?e.message:"删除失败，请刷新列表后重试")}finally{setLoading(false)}}
 return <section className="composer-drafts" aria-label="草稿同步">
  <div className="composer-drafts__toolbar"><span role="status">{status}</span><button type="button" disabled={busy||loading||saving} onClick={()=>{setOpened(!opened);if(!opened)void loadList()}}>打开草稿箱</button><button type="button" disabled={busy||loading||saving||conflict} onClick={()=>void newDraft()}>新建草稿</button></div>
  {error&&<p role="alert">{error}</p>}
  {error&&!conflict&&<button type="button" disabled={busy||saving} onClick={()=>void flush().catch(()=>undefined)}>重试同步</button>}
  {conflict&&<div className="composer-drafts__toolbar"><button type="button" disabled={busy||loading||saving} onClick={()=>void readServer()}>保留本地副本并读取服务器版</button><button type="button" disabled={busy||loading||saving} onClick={()=>void saveCopy()}>另存本地副本</button></div>}
  {recovery&&<button type="button" disabled={busy||saving} onClick={()=>{reference.current={id:crypto.randomUUID(),revision:0};saved.current=null;blocked.current=false;setConflict(false);persist(metaKey,reference.current);onRestore(recovery);setRecovery(null);try{localStorage.removeItem(metaKey+":recovery")}catch{/* Keep live content. */}}}>恢复保留的本地副本（另存）</button>}
  {opened&&<div className="composer-drafts__list"><p>最多保存 50 篇。关闭窗口会保留草稿。</p>{loading&&<p role="status">正在读取草稿…</p>}{!loading&&rows.length===0&&<p>草稿箱暂无内容</p>}{rows.map(row=><div className="composer-drafts__row" key={row.id}><div><strong>{row.content.title||toPlainText(row.content.rich_content).slice(0,60)||"未命名草稿"}</strong><small>{new Date(row.updated_at).toLocaleString()} · 版本 {row.revision}</small></div><button type="button" disabled={busy||loading||saving||conflict} aria-label={"继续编辑 "+(row.content.title||"未命名草稿")} onClick={()=>void select(row)}>继续编辑</button><button type="button" disabled={busy||loading||saving} aria-label={"删除草稿 "+(row.content.title||"未命名草稿")} onClick={()=>setDeleting(row)}>删除</button></div>)}{cursor&&<button type="button" disabled={loading} onClick={()=>void loadList(cursor)}>加载更多草稿</button>}<button type="button" disabled={loading} onClick={()=>void loadList()}>刷新草稿箱</button></div>}
  {deleting&&<ConfirmDialog title="删除这篇草稿？" confirmLabel="删除草稿" busy={loading} onCancel={()=>setDeleting(null)} onConfirm={()=>void remove()}><p>服务器草稿及其图片引用将被移除，此操作不可撤销。</p></ConfirmDialog>}
 </section>
}
