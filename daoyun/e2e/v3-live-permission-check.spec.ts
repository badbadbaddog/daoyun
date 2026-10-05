import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"
test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(90000)
interface Fixture { subject: { username: string; userId: string; displayName: string }; board: { id: string; name: string }; topicId: string; upload: { id: string; name: string } }
const exec = promisify(execFile)
const errors = new WeakMap<Page, string[]>()
const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082", "hex")
async function fixture(info: TestInfo): Promise<Fixture> {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) { const url=new URL(process.env[name]!); expect(["127.0.0.1","localhost","[::1]"]).toContain(url.hostname); if(name==="DATABASE_URL")expect(url.pathname).toContain("v3") }
  return JSON.parse(await readFile(process.env.DAOYUN_CHECK_FIXTURES!, "utf8"))[info.project.name]
}
async function payload(response: APIResponse, status=200) { expect(response.status()).toBe(status); const body=await response.json(); expect(body.meta.request_id).toBe(response.headers()["x-request-id"]); return body }
async function login(request: APIRequestContext, username="demo_admin") { return (await payload(await request.post("/api/v1/auth/login",{data:{identifier:username,password:"DaoYunLocalOnly!2026"}}))).data.csrf_token as string }
async function open(page: Page, data: Fixture) {
  await page.goto("/#admin/inspect")
  await expect(page.getByRole("heading", { name: "权限检查", exact: true, level: 1 })).toBeVisible()
  const navigation=page.getByRole("button", { name: "权限检查", exact: true })
  if(await navigation.isVisible())await expect(navigation).toHaveAttribute("aria-current","page")
  else await expect(page.getByRole("combobox", { name: "管理模块", exact: true })).toHaveValue("inspect")
  await page.getByRole("searchbox",{name:"搜索用户",exact:true}).fill(data.subject.username)
  await page.getByRole("button",{name:"选择"+data.subject.displayName+" @"+data.subject.username,exact:true}).click()
  await page.getByRole("combobox",{name:"检查版块",exact:true}).selectOption(data.board.id)
  await page.getByRole("combobox",{name:"检查动作",exact:true}).selectOption("attachment_upload")
  await page.getByRole("textbox",{name:"主题标识",exact:true}).fill(data.topicId)
  await page.getByLabel("检查文件大小",{exact:true}).setInputFiles({name:"check.png",mimeType:"image/png",buffer:png})
}
async function check(page: Page, first=true) {
  const button=page.getByRole("button",{name:first?"开始检查":"重新检查当前条件",exact:true})
  const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/api/v1/admin/permission-check"),button.click()])
  expect(response.request().method()).toBe("GET"); expect(response.request().postData()).toBeNull()
  expect(response.status()).toBe(200); const body=await response.json(); expect(body.meta.request_id).toBe(response.headers()["x-request-id"]); expect(response.headers()["cache-control"]).toBe("no-store")
  await expect(page.getByRole("region",{name:"检查结果",exact:true})).toBeVisible()
  return body
}
async function state(id: string) {
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  const sql="SELECT json_build_object('usage',(SELECT COALESCE(json_agg(to_jsonb(q) ORDER BY quota_key,window_start),'[]'::json) FROM community_quota_usage q WHERE user_id='"+id+"'::uuid),'storage',(SELECT COALESCE(sum(size_bytes),0) FROM topic_attachments WHERE uploader_id='"+id+"'::uuid AND deleted_at IS NULL),'points',(SELECT count(*) FROM point_ledger_entries WHERE user_id='"+id+"'::uuid),'experience',(SELECT count(*) FROM experience_ledger_entries WHERE user_id='"+id+"'::uuid),'audit',(SELECT count(*) FROM admin_audit_log))::text"
  const result=await exec(process.env.DAOYUN_PSQL_BIN!,["--dbname="+process.env.DATABASE_URL!,"--no-psqlrc","--set=ON_ERROR_STOP=1","--tuples-only","--no-align","--command="+sql],{encoding:"utf8",windowsHide:true})
  return createHash("sha256").update(result.stdout.trim()).digest("hex")
}
async function capture(page: Page, info: TestInfo, name: string) {
  const before=page.viewportSize()
  await page.getByRole("heading", { name: "权限检查", exact: true, level: 1 }).scrollIntoViewIfNeeded()
  for(const width of [320,390,768,1024,1440]) { await page.setViewportSize({width,height:900}); await assertNoHorizontalOverflow(page); await page.screenshot({path:info.outputPath(name+"-"+width+".png"),fullPage:true}) }
  if(before)await page.setViewportSize(before)
  expect(errors.get(page)??[]).toEqual([])
}
async function axe(page: Page) { expect((await new AxeBuilder({page}).include(".admin-permission-check").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]) }
test.beforeEach(({page})=>{const issues:string[]=[];errors.set(page,issues);page.on("pageerror",e=>issues.push(e.message))})

test("checks upload ten times without quota, ledger, storage or audit writes",async({page,browser},info)=>{
  const data=await fixture(info);await login(page.request);await open(page,data);const before=await state(data.subject.userId)
  for(let i=0;i<10;i++){const body=await check(page,i===0);expect(body.data.scenario.actions).toHaveLength(1);expect(body.data.scenario.actions[0]).toMatchObject({action:"attachment_upload",decision:"allowed"});expect(body.data.file_bytes).toBe(png.length)}
  expect(await state(data.subject.userId)).toBe(before)
  await expect(page.getByText("用户组："+data.upload.name,{exact:true})).toBeVisible();await axe(page);await capture(page,info,"current-upload-snapshot")
  await page.getByRole("button",{name:"切换为深色主题",exact:true}).click();await axe(page);await capture(page,info,"snapshot-dark")
  // 以 720 CSS px × 2 像素密度复现 1440px 屏幕的 200% 有效缩放和换行。
  const context=await browser.newContext({baseURL:process.env.DAOYUN_WEB_URL,viewport:{width:720,height:450},deviceScaleFactor:2})
  try{await login(context.request);const zoom=await context.newPage();await open(zoom,data);await check(zoom);await assertNoHorizontalOverflow(zoom);await axe(zoom);await zoom.screenshot({path:info.outputPath("effective-200-percent.png"),fullPage:true})}finally{await context.close()}
  await writeFile(info.outputPath("read-only-evidence.json"),JSON.stringify({checks:10,userId:data.subject.userId,beforeSha256:before,afterSha256:await state(data.subject.userId),fileBytes:png.length,zoom:{cssWidth:720,deviceScaleFactor:2,physicalWidth:1440}},null,2),"utf8")
})

test("rechecks after source revocation and refuses a real upload despite an earlier allowed result",async({page,playwright},info)=>{
  const data=await fixture(info);const csrf=await login(page.request);await open(page,data);expect((await check(page)).data.scenario.actions[0].decision).toBe("allowed")
  const memberships=(await payload(await page.request.get("/api/v1/admin/community/memberships",{params:{user_id:data.subject.userId}}))).data
  const membership=memberships.find((m:{group:{id:string};revoked_at:string|null})=>m.group.id===data.upload.id&&!m.revoked_at);expect(membership).toBeTruthy()
  const member=await playwright.request.newContext({baseURL:process.env.DAOYUN_WEB_URL});const token=await login(member,data.subject.username)
  try{
    await payload(await page.request.post("/api/v1/admin/community/memberships/"+membership.id+"/revoke",{headers:{"x-csrf-token":csrf},data:{expected_revision:membership.revision,reason:"V3诊断之后撤销唯一上传来源",idempotency_key:"v3-check-revoke-"+randomUUID()}}))
    const before=await state(data.subject.userId)
    const actual=await member.post("/api/v1/topics/"+data.topicId+"/attachments",{headers:{"x-csrf-token":token,"content-type":"image/png","x-file-name":"check.png"},data:png})
    await payload(actual,403);expect(await state(data.subject.userId)).toBe(before)
    const body=await check(page,false);expect(body.data.scenario.actions[0]).toMatchObject({decision:"denied",reason:"community.permission_not_provided"})
    await capture(page,info,"revoked-source-denial")
  }finally{
    await member.dispose()
    await payload(await page.request.post("/api/v1/admin/community/memberships",{headers:{"x-csrf-token":csrf},data:{user_id:data.subject.userId,group_id:data.upload.id,membership_kind:"additional",source:"operator",source_reference_id:null,reason:"恢复隔离检查来源",starts_at:new Date(Date.now()-1000).toISOString(),ends_at:null,idempotency_key:"v3-check-restore-"+randomUUID()}}))
  }
})

test("redacts all sources from ordinary users and validates bounded server conditions",async({page,playwright},info)=>{
  const data=await fixture(info);await login(page.request)
  const member=await playwright.request.newContext({baseURL:process.env.DAOYUN_WEB_URL});await login(member,data.subject.username)
  try{
    for(const id of [data.subject.userId,randomUUID()]){
      const denied=await payload(await member.get("/api/v1/admin/permission-check",{params:{user_id:id,board_id:data.board.id,action:"browse"}}),403)
      expect(denied.data).toBeUndefined();expect(JSON.stringify(denied)).not.toMatch(/source_ids|permission_keys|governance/)
    }
    for(const extra of [{at:"2099-01-01"},{file_bytes:"0"},{file_bytes:"52428801"}] as Array<Record<string,string>>)await payload(await page.request.get("/api/v1/admin/permission-check",{params:{user_id:data.subject.userId,board_id:data.board.id,action:"attachment_upload",topic_id:data.topicId,...extra}}),422)
    await open(page,data);await page.getByRole("combobox",{name:"检查动作",exact:true}).selectOption("reply_create")
    const body=await check(page);expect(body.data.scenario.actions[0].decision).toBe("missing_context")
    await capture(page,info,"missing-resource-context")
  }finally{await member.dispose()}
})

test("retains conditions after a check failure and retries without another user search",async({page},info)=>{
  const data=await fixture(info);await login(page.request);await open(page,data);let searches=0
  page.on("request",request=>{if(new URL(request.url()).pathname==="/api/v1/admin/users")searches++})
  await page.route("**/api/v1/admin/permission-check?**",route=>route.fulfill({status:503,contentType:"application/json",headers:{"x-request-id":"v3-check-fault"},body:JSON.stringify({error:{code:"database.unavailable",message:"权限检查暂时不可用"},meta:{request_id:"v3-check-fault"}})}))
  await page.getByRole("button",{name:"开始检查",exact:true}).click();await expect(page.getByRole("alert")).toContainText("权限检查暂时不可用");await capture(page,info,"local-retry")
  await page.unroute("**/api/v1/admin/permission-check?**")
  await page.getByRole("button",{name:"重试权限检查",exact:true}).click();await expect(page.getByRole("heading",{name:"当前权限条件满足",exact:true})).toBeVisible()
  await expect(page.getByRole("textbox",{name:"主题标识",exact:true})).toHaveValue(data.topicId);expect(searches).toBe(0)
  const submit=page.getByRole("button",{name:"开始检查",exact:true});await submit.focus();await expect(submit).toBeFocused()
  expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);await page.keyboard.press("Tab")
  await axe(page);await capture(page,info,"retry-preserved-conditions")
})

test("opens the specific user's current check from a matrix source without automatic diagnosis",async({page},info)=>{
  const data=await fixture(info);await login(page.request);await page.goto("/#admin/boards?board_id="+data.board.id)
  const editor=page.getByRole("dialog",{name:"编辑“"+data.board.name+"”"})
  await editor.getByRole("button",{name:"有效权限",exact:true}).click()
  await editor.getByRole("searchbox",{name:"搜索用户",exact:true}).fill(data.subject.username)
  await editor.getByRole("button",{name:"选择"+data.subject.displayName+" @"+data.subject.username,exact:true}).click()
  await editor.getByRole("button",{name:new RegExp(data.subject.userId.slice(-8)+" 主题附件上传 来源$")}).click()
  const source=page.getByRole("dialog",{name:/主题附件上传来源$/})
  const link=source.getByRole("link",{name:"检查具体用户与资源",exact:true})
  await expect(link).toHaveAttribute("href","#admin/inspect?"+new URLSearchParams({board_id:data.board.id,action:"attachment_upload",user_id:data.subject.userId}))
  let checks=0;page.on("request",request=>{if(new URL(request.url()).pathname==="/api/v1/admin/permission-check")checks++})
  await link.click();await expect(page).toHaveURL(/#admin\/inspect\?/)
  await expect(page.getByRole("combobox",{name:"检查版块",exact:true})).toHaveValue(data.board.id)
  await expect(page.getByRole("combobox",{name:"检查动作",exact:true})).toHaveValue("attachment_upload")
  await expect(page.getByText("指定用户："+data.subject.displayName+" @"+data.subject.username,{exact:false})).toBeVisible()
  expect(checks).toBe(0)
  await page.getByRole("textbox",{name:"主题标识",exact:true}).fill(data.topicId.toUpperCase())
  await page.getByLabel("检查文件大小",{exact:true}).setInputFiles({name:"check.png",mimeType:"image/png",buffer:png})
  expect((await check(page)).data.scenario.actions[0].decision).toBe("allowed")
  await capture(page,info,"matrix-source-to-user-check")
})
