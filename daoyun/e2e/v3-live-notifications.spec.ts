import { execFile, spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { expect, test, type Page, type TestInfo, type APIResponse } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({trace:"off",video:"off",actionTimeout:10_000})
test.skip(process.env.DAOYUN_V3_E2E!=="1","Requires the isolated V3 instance")
const errors=new WeakMap<Page,string[]>()

async function sql(command:string) {
 const result=await promisify(execFile)(process.env.DAOYUN_PSQL??"psql",["--dbname="+process.env.DATABASE_URL!,"--no-psqlrc","--tuples-only","--no-align","--set=ON_ERROR_STOP=1","--command="+command],{windowsHide:true,encoding:"utf8",timeout:10_000})
 return result.stdout.trim()
}
async function body(response:APIResponse) {
 const value=await response.json();expect(value.meta.request_id).toBe(response.headers()["x-request-id"]);expect(response.status(),JSON.stringify(value.error??{})).toBeLessThan(400);return value
}
async function account(page:Page, info:TestInfo) {
 for(const name of ["DAOYUN_WEB_URL","DAOYUN_API_URL","DATABASE_URL"]) {const url=new URL(process.env[name]??"");expect(["127.0.0.1","localhost","[::1]"]).toContain(url.hostname);if(name==="DATABASE_URL")expect(url.pathname).toContain("v3")}
 const issues:string[]=[];errors.set(page,issues);page.on("pageerror",error=>issues.push(error.message))
 const fixturePath=process.env.DAOYUN_NOTIFICATION_FIXTURES
 if(!fixturePath)throw new Error("Requires the explicitly prepared V3 notification fixtures")
 const fixtures=JSON.parse(await readFile(fixturePath,"utf8")) as Record<string,{username:string;id:string}>
 const fixture=fixtures[info.project.name+":"+info.title]
 expect(fixture.username).toMatch(/^v3n[0-9a-f]{12}$/);expect(fixture.id).toMatch(/^[0-9a-f-]{36}$/i)
 const result=await body(await page.request.post("/api/v1/auth/login",{data:{identifier:fixture.username,password:"DaoYunLocalOnly!2026"}}))
 const id=result.data.user.id as string;expect(id).toBe(fixture.id)
 await sql("DELETE FROM notifications WHERE recipient_id='"+id+"'::uuid AND aggregate_key LIKE 'v3:%'")
 return id
}
async function seed(owner:string,unread:number,read=0) {
 await sql("INSERT INTO notifications(id,recipient_id,kind,target_type,target_id,aggregate_key,created_at,read_at) SELECT gen_random_uuid(),'"+owner+"'::uuid,'follow','user','"+owner+"'::uuid,'v3:'||gen_random_uuid()::text,CURRENT_TIMESTAMP + i*INTERVAL '1 second',CASE WHEN i>"+unread+" THEN CURRENT_TIMESTAMP END FROM generate_series(1,"+(unread+read)+") AS i")
}
async function snapshots(page:Page,info:TestInfo,name:string) {
 expect(errors.get(page)).toEqual([])
 for(const width of [320,390,768,1024,1440]) {await page.setViewportSize({width,height:900});await assertNoHorizontalOverflow(page);await page.screenshot({path:info.outputPath(name+"-"+width+".png")})}
}
async function open(page:Page,count:number) {
 await page.goto("/#notifications");await expect(page.getByRole("heading",{name:"通知",exact:true})).toBeVisible();await expect(page.getByText("全站未读 "+count,{exact:true})).toBeVisible()
}

test("uses a global count of 54 after reading one of the first 20 of 55",async({page},info)=>{
 const owner=await account(page,info);await seed(owner,55);await open(page,55)
 await expect(page.locator(".notification-list article")).toHaveCount(20)
 await page.getByRole("button",{name:"标记通知为已读",exact:true}).first().click()
 await expect(page.getByRole("button",{name:"查看通知，54 条未读",exact:true,includeHidden:true})).toHaveAttribute("aria-label","查看通知，54 条未读")
 await expect(page.getByText("全站未读 54",{exact:true})).toBeVisible()
 const count=await body(await page.request.get("/api/v1/notifications/unread-count"));expect(count.data.unread_count).toBe(54)
 await snapshots(page,info,"global-54")
 await writeFile(info.outputPath("count-evidence.json"),JSON.stringify({owner,loaded:20,initial:55,remaining:54,request_id:count.meta.request_id},null,2),"utf8")
})

test("finds unread beyond a fully read first page with filter-bound pagination",async({page},info)=>{
 const owner=await account(page,info);await seed(owner,55,20);await open(page,55)
 await expect(page.locator(".notification-list article")).toHaveCount(20)
 await expect(page.getByRole("button",{name:"标记通知为已读",exact:true})).toHaveCount(0)
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/v1/notifications"&&new URL(r.url()).searchParams.get("unread")==="true")
 await page.getByRole("tab",{name:"未读",exact:true}).click()
 const first=await response;const payload=await first.json();expect(payload.meta.request_id).toBe(first.headers()["x-request-id"]);expect(payload.data).toHaveLength(20);expect(payload.data.every((n:{read_at:string|null})=>n.read_at===null)).toBe(true);expect(payload.meta.next_cursor).toMatch(/^unread:/)
 await expect(page.getByRole("button",{name:"标记通知为已读",exact:true})).toHaveCount(20)
 await page.getByRole("button",{name:"加载更多通知",exact:true}).click()
 await expect(page.locator(".notification-list article")).toHaveCount(40)
 await snapshots(page,info,"unread-server-filter")
 await writeFile(info.outputPath("filter-evidence.json"),JSON.stringify({owner,read_first_page:20,unread:55,loaded_unread:40,next_cursor:payload.meta.next_cursor,request_id:payload.meta.request_id},null,2),"utf8")
})

test("read-all preserves a late committed notification with an older timestamp",async({page},info)=>{
 const owner=await account(page,info);await seed(owner,1);await open(page,1)
 const holder=spawn(process.env.DAOYUN_PSQL??"psql",["--dbname="+process.env.DATABASE_URL!,"--no-psqlrc","--tuples-only","--no-align","--set=ON_ERROR_STOP=1"],{windowsHide:true,stdio:["pipe","pipe","pipe"]})
 let output="";let failure="";holder.stdout.on("data",data=>{output+=data.toString()});holder.stderr.on("data",data=>{failure+=data.toString()})
 holder.stdin.write("BEGIN;\nSELECT id FROM notifications WHERE recipient_id='"+owner+"'::uuid FOR UPDATE;\nSELECT 'v3_locked';\n")
 try {
  await expect.poll(()=>output).toContain("v3_locked")
  const marked=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/v1/notifications/read-all"&&r.request().method()==="PATCH")
  await page.getByRole("button",{name:"全部标记为已读",exact:true}).click()
  await expect.poll(()=>sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'UPDATE notifications%SET read_at = CURRENT_TIMESTAMP%' AND wait_event_type='Lock'")).toBe("1")
  const late=crypto.randomUUID()
  await sql("INSERT INTO notifications(id,recipient_id,kind,target_type,target_id,aggregate_key,created_at) VALUES('"+late+"'::uuid,'"+owner+"'::uuid,'follow','user','"+owner+"'::uuid,'v3:late:"+late+"','2020-01-01'::timestamptz)")
  holder.stdin.end("COMMIT;\n\\q\n")
  const response=await marked;const result=await response.json();expect(result.meta.request_id).toBe(response.headers()["x-request-id"]);expect(result.data.unread_count).toBe(1)
  await expect(page.getByText("全站未读 1",{exact:true})).toBeVisible()
  await expect(page.locator(".notification-list article")).toHaveCount(2)
  await expect(page.getByRole("button",{name:"标记通知为已读",exact:true})).toHaveCount(1)
  await page.getByRole("tab",{name:"未读",exact:true}).click()
  await expect(page.locator(".notification-list article")).toHaveCount(1)
  const unread=await body(await page.request.get("/api/v1/notifications?unread=true"));expect(unread.data.map((n:{id:string})=>n.id)).toEqual([late])
  expect(failure).toBe("")
  await snapshots(page,info,"late-notification-unread")
  await writeFile(info.outputPath("snapshot-evidence.json"),JSON.stringify({owner,late,late_created_at:"2020-01-01",snapshot_observed_while_waiting_for_lock:true,remaining:1,request_id:result.meta.request_id},null,2),"utf8")
 } finally {if(holder.exitCode===null)holder.kill()}
})
