import {useEffect,useRef,useState} from "react"
import {getTopicPoll,voteTopicPoll,updateTopicPoll,type TopicPoll,type PollInput} from "../api/polls"
import {PollEditor} from "./PollEditor"
export function TopicPollPanel({topicId,userId,csrfToken,onLogin}:{topicId:string;userId?:string;csrfToken?:string;onLogin:()=>void}){
 const [poll,setPoll]=useState<TopicPoll|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState("")
 const [selection,setSelection]=useState("")
 const [busy,setBusy]=useState(false)
 const [version,setVersion]=useState(0)
 const [edit,setEdit]=useState<PollInput|null>(null)
 const scope=topicId+":"+(userId??"");const scopeRef=useRef(scope);scopeRef.current=scope
 const pending=useRef(false)
 useEffect(()=>{const controller=new AbortController();setPoll(null);setSelection("");setEdit(null);setError("");setLoading(true);pending.current=false;setBusy(false);getTopicPoll(topicId,controller.signal).then(row=>{if(!controller.signal.aborted)setPoll(row)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"投票读取失败")}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[topicId,userId,version])
 useEffect(()=>{if(!poll||poll.closed)return;const timer=window.setTimeout(()=>setVersion(v=>v+1),Math.max(1000,Math.min(2147483647,Date.parse(poll.ends_at)-Date.now()+100)));return()=>window.clearTimeout(timer)},[poll])
 async function submit(){if(!csrfToken||!selection||pending.current)return;pending.current=true;setBusy(true);setError("");try{const result=await voteTopicPoll(topicId,selection,csrfToken);if(scopeRef.current===scope)setPoll(result)}catch(e){if(scopeRef.current===scope)setError(e instanceof Error?e.message:"投票失败，请重试")}finally{if(scopeRef.current===scope){pending.current=false;setBusy(false)}}}
 async function save(){if(!poll||!edit||!csrfToken||pending.current)return;pending.current=true;setBusy(true);setError("");try{const result=await updateTopicPoll(topicId,poll.revision,edit,csrfToken);if(scopeRef.current===scope){setPoll(result);setEdit(null)}}catch(e){if(scopeRef.current===scope)setError(e instanceof Error?e.message:"投票修改失败")}finally{if(scopeRef.current===scope){pending.current=false;setBusy(false)}}}
 if(loading)return null
 if(!poll)return error?<div className="topic-poll"><p>{error}</p><button type="button" onClick={()=>setVersion(v=>v+1)}>重试读取投票</button></div>:null
 return <section className="topic-poll" aria-label="主题投票"><h3>{poll.question}</h3><p>{poll.closed?"投票已截止":"截止于 "+new Date(poll.ends_at).toLocaleString()}</p>{!poll.enabled&&<p>投票插件已停用，历史记录保留。</p>}
  {poll.total_votes!==null?<><ul className="topic-poll__results">{poll.options.map(option=>{const percentage=poll.total_votes?Math.round((option.votes??0)*100/poll.total_votes):0;return <li key={option.id}><div><span>{option.label}{poll.selected_option===option.id?"（你的选择）":""}</span><span>{option.votes??0} 票 · {percentage}%</span></div><meter min={0} max={100} value={percentage} aria-label={option.label+" 得票比例"}/></li>})}</ul><p>总计 {poll.total_votes} 票</p>{poll.total_votes===0&&<p>暂无投票</p>}</>:<><fieldset disabled={busy||!poll.can_vote}><legend className="visually-hidden">选择一个投票选项</legend>{poll.options.map(option=><label className="topic-poll__choice" key={option.id}><input type="radio" name={"poll-"+topicId} value={option.id} checked={selection===option.id} onChange={()=>setSelection(option.id)}/>{option.label}</label>)}</fieldset><p>投票后或截止后可查看结果。</p>{!userId?<button type="button" onClick={onLogin}>登录后参与投票</button>:poll.can_vote?<button className="primary-button" type="button" disabled={busy||!selection} onClick={()=>void submit()}>{busy?"正在提交投票…":"提交投票"}</button>:<p>当前无法参与投票，请检查账号权限或主题互动状态。</p>}</>}
  {error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={()=>setVersion(v=>v+1)}>刷新投票</button>
  {poll.can_edit&&!edit&&<button type="button" disabled={busy} onClick={()=>setEdit({question:poll.question,options:poll.options.map(o=>o.label),ends_at:poll.ends_at})}>修改投票</button>}
  {edit&&<form onSubmit={e=>{e.preventDefault();void save()}}><PollEditor value={edit} onChange={setEdit} disabled={busy}/><button type="submit" disabled={busy}>保存投票修改</button><button type="button" disabled={busy} onClick={()=>setEdit(null)}>取消修改投票</button></form>}
 </section>
}
