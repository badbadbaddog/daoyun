import {useCallback,useEffect,useId,useRef,useState} from "react"
import {AdminApiError,listAdminPointsLedger,listAdminExperienceLedger,type AdminPointsLedgerEntry,type AdminExperienceLedgerEntry} from "../../api/admin"

export function OperationalLedger({kind,userId,canRead,refreshKey=0,onReverse}:{kind:"points"|"experience";userId:string;canRead:boolean;refreshKey?:number;onReverse?:(entry:AdminExperienceLedgerEntry)=>void}) {
  const label=kind==="points" ? "积分" : "EXP"
  const titleId=useId()
  const [entries,setEntries]=useState<(AdminPointsLedgerEntry|AdminExperienceLedgerEntry)[]>([])
  const [nextCursor,setNextCursor]=useState<string|null>(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState("")
  const version=useRef(0)
  const load=useCallback(async(cursor?:string,signal?:AbortSignal)=>{
    if(!canRead) return
    const request=++version.current;setLoading(true);setError("")
    try {
      const page=kind==="points" ? await listAdminPointsLedger(userId,{cursor,limit:20,signal}) : await listAdminExperienceLedger(userId,{cursor,limit:20,signal})
      if(signal?.aborted || request!==version.current) return
      setEntries(current=>cursor ? [...new Map([...current,...page.entries].map(entry=>[entry.id,entry])).values()] : page.entries);setNextCursor(page.nextCursor)
    } catch(failure){if(!signal?.aborted && request===version.current){setError(failure instanceof AdminApiError ? failure.message : label+"流水暂不可用");if(failure instanceof AdminApiError && [401,403].includes(failure.status)){setEntries([]);setNextCursor(null)}}}
    finally{if(!signal?.aborted && request===version.current)setLoading(false)}
  },[kind,userId,canRead,label])
  useEffect(()=>{setEntries([]);setNextCursor(null);setError("");const controller=new AbortController();void load(undefined,controller.signal);return()=>{controller.abort();version.current+=1}},[load,refreshKey])
  if(!canRead) return null
  const reversed=new Set(entries.flatMap(entry=>"reversalOf" in entry && entry.reversalOf ? [entry.reversalOf] : []))
  return <section className="membership-ledger" aria-label={label+" 流水"} aria-labelledby={titleId}>
    <header><h3 id={titleId}>{label}流水</h3><button type="button" className="secondary-button" disabled={loading} onClick={()=>void load()}>刷新{label}流水</button></header>
    {loading && <p role="status">正在读取{label}流水</p>}{error && <p className="form-alert" role="alert">{error}</p>}
    {!loading && !error && !entries.length && <p>没有{label}流水记录</p>}
    <ol className="membership-ledger__rows">{entries.map(entry=><li key={entry.id}>
      <div className="membership-ledger__main"><strong>{entry.amount>0 ? "+" : ""}{entry.amount.toLocaleString()} {label}</strong><span>变更后 {entry.balanceAfter.toLocaleString()} {label}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("zh-CN")}</time></div>
      <p>{entry.reason}{"details" in entry && entry.details ? " · "+entry.details : ""}</p>
      <details><summary>查看流水详情</summary><dl><div><dt>流水编号</dt><dd><code>{entry.id}</code></dd></div><div><dt>操作人</dt><dd>{entry.actorDisplayName ?? entry.actorUsername ?? "历史记录未提供"}{entry.actorId && " · "+entry.actorId}</dd></div><div><dt>原始请求号</dt><dd>{entry.operationRequestId ?? "历史记录未提供"}</dd></div>{"reversalOf" in entry && entry.reversalOf && <div><dt>冲正原流水</dt><dd>{entry.reversalOf}</dd></div>}{"auditId" in entry && <div><dt>审计编号</dt><dd>{entry.auditId ?? "历史记录未提供"}</dd></div>}</dl></details>
      {onReverse && "reversalOf" in entry && entry.amount>0 && !entry.reversalOf && !reversed.has(entry.id) && <button className="danger-button" type="button" onClick={()=>onReverse(entry)}>冲正此笔 EXP</button>}
    </li>)}</ol>
    {nextCursor && <button type="button" className="secondary-button" disabled={loading} onClick={()=>void load(nextCursor)}>加载更早{label}流水</button>}
  </section>
}
