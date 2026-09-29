import {isPollInput,type PollInput} from "./polls"
import {sanitizeRichContent,type RichTextDocument} from "../editor/richContent"
export interface DraftContent {title:string;board_id:string|null;rich_content:RichTextDocument;images:{attachmentId:string;fileName:string}[];poll:PollInput|null}
export interface MemberDraft {id:string;revision:number;content:DraftContent;updated_at:string}
export interface DraftPage {drafts:MemberDraft[];next_cursor:string|null}
export class DraftApiError extends Error {constructor(public status:number,public code:string,message:string){super(message)}}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v)
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
function draft(v:unknown):v is MemberDraft{return object(v)&&uuid(v.id)&&typeof v.revision==="number"&&Number.isSafeInteger(v.revision)&&v.revision>0&&typeof v.updated_at==="string"&&Number.isFinite(Date.parse(v.updated_at))&&object(v.content)&&typeof v.content.title==="string"&&(v.content.board_id===null||uuid(v.content.board_id))&&object(v.content.rich_content)&&v.content.rich_content.type==="doc"&&Array.isArray(v.content.images)&&v.content.images.every(i=>object(i)&&uuid(i.attachmentId)&&typeof i.fileName==="string")&&(v.content.poll===null||isPollInput(v.content.poll))}
async function request<T>(path:string,guard:(v:unknown)=>v is T,init:RequestInit={}):Promise<T>{
 const response=await fetch(path,{credentials:"include",...init});const payload:unknown=await response.json().catch(()=>null)
 if(!response.ok){const error=object(payload)&&object(payload.error)?payload.error:{};throw new DraftApiError(response.status,String(error.code??"response.invalid"),String(error.message??"草稿同步失败"))}
 if(!object(payload)||!object(payload.meta)||!uuid(payload.meta.request_id)||!guard(payload.data))throw new Error("草稿响应格式无效")
 return payload.data
}
export function listDrafts(cursor?:string,signal?:AbortSignal){return request("/api/v1/users/me/drafts?limit=20"+(cursor?"&cursor="+encodeURIComponent(cursor):""),(v):v is DraftPage=>object(v)&&Array.isArray(v.drafts)&&v.drafts.every(draft)&&(v.next_cursor===null||uuid(v.next_cursor)),{signal})}
export async function getDraft(id:string,signal?:AbortSignal){const row=await request("/api/v1/users/me/drafts/"+encodeURIComponent(id),draft,{signal});return {...row,content:{...row.content,rich_content:sanitizeRichContent(row.content.rich_content)}}}
export function saveDraft(id:string,revision:number,content:DraftContent,csrfToken:string){return request("/api/v1/users/me/drafts/"+encodeURIComponent(id),draft,{method:"PUT",headers:{"Content-Type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify({expected_revision:revision,content})})}
export function deleteDraft(id:string,revision:number,csrfToken:string){return request("/api/v1/users/me/drafts/"+encodeURIComponent(id)+"?revision="+revision,(v):v is boolean=>typeof v==="boolean",{method:"DELETE",headers:{"x-csrf-token":csrfToken}})}
