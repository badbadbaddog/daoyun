import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(90000)
async function payload(response: Pick<APIResponse,"status"|"text"|"json"|"headers">,status=200){
  expect(response.status(),await response.text()).toBe(status)
  const body=await response.json();expect(body.meta.request_id).toBe(response.headers()["x-request-id"]);return body
}
async function login(request: APIRequestContext,username="demo_admin"){
  return (await payload(await request.post("/api/v1/auth/login",{data:{identifier:username,password:"DaoYunLocalOnly!2026"}}))).data.csrf_token as string
}
function fixture(info:TestInfo){const users:string[]=JSON.parse(process.env.DAOYUN_POINTS_FIXTURE_USERS!);const name=users[info.project.name.includes("mobile")?2:0];expect(name).toMatch(/^v3_pts_[a-f0-9]{16}$/);return name}
async function capture(page:Page,info:TestInfo,name:string,selector:string){
  const before=page.viewportSize()
  for(const width of [320,390,768,1024,1440]){
    await page.setViewportSize({width,height:900});await assertNoHorizontalOverflow(page)
    if(width===320||width===1440)expect((await new AxeBuilder({page}).include(selector).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([])
    await page.screenshot({path:info.outputPath(name+"-"+width+".png"),fullPage:true})
  }
  if(before)await page.setViewportSize(before)
}
test.beforeEach(()=>{for(const key of ["DAOYUN_WEB_URL","DATABASE_URL"]){const url=new URL(process.env[key]!);expect(["127.0.0.1","localhost","[::1]"]).toContain(url.hostname);if(key==="DATABASE_URL")expect(url.pathname).toContain("v3")}})

test("retains a grant's original snapshot and private source after a lost response and a new type version",async({page,playwright},info)=>{
  const own=await playwright.request.newContext({baseURL:process.env.DAOYUN_WEB_URL});const username=fixture(info)
  try{
    await login(own,username);const account=(await payload(await own.get("/api/v1/users/me/membership"))).data
    const before=(await payload(await own.get("/api/v1/users/me/entitlements"))).data
    const csrf=await login(page.request);const key="v3_benefit_"+randomUUID().replaceAll("-","").slice(0,16);const title="权益验收 "+key.slice(-6)
    const type=(await payload(await page.request.put("/api/v1/admin/entitlements/types/"+key,{headers:{"x-csrf-token":csrf},data:{display_name:title,permission_keys:["attachment.upload"],quotas:{"attachment.upload.daily":20},expected_revision:null}}))).data
    await page.goto("/#admin/membership");await page.reload();await page.getByRole("tab",{name:"会员权益",exact:true}).click()
    await page.getByRole("tab",{name:"用户权益",exact:true}).click();await page.getByRole("searchbox",{name:"搜索权益用户"}).fill(username);await page.getByRole("button",{name:"搜索用户",exact:true}).click()
    await page.getByRole("button",{name:"选择积分验收成员 @"+username,exact:true}).click();await page.getByRole("button",{name:"发放标准权益"}).click()
    const dialog=page.getByRole("dialog",{name:"发放标准权益",exact:true})
    await dialog.getByRole("combobox",{name:"权益类型"}).selectOption({label:title+" · v1"})
    await dialog.getByLabel("发放来源",{exact:true}).fill("operator");await dialog.getByLabel("来源编号（可选）").fill("private-order-"+key)
    await dialog.getByLabel("发放原因",{exact:true}).fill("private-reason-"+key);await dialog.getByLabel("开始时间",{exact:true}).fill("2026-10-01T08:00");await dialog.getByLabel("结束时间",{exact:true}).fill("2027-10-01T08:00")
    let first:any;let input:any
    await page.route("**/api/v1/admin/entitlements",async route=>{input=route.request().postDataJSON();first=await payload(await route.fetch());await route.abort("failed")},{times:1})
    await dialog.getByRole("button",{name:"确认发放"}).click();await expect(dialog.getByRole("alert")).toContainText("结果尚未确认");await expect(dialog.getByLabel("发放原因",{exact:true})).toBeDisabled()
    await dialog.getByRole("button",{name:"取消",exact:true}).click();await page.getByRole("button",{name:"发放标准权益"}).click()
    const replayResponse=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/v1/admin/entitlements"&&r.request().method()==="POST")
    await dialog.getByRole("button",{name:"确认发放"}).click();const response=await replayResponse;const replay=await payload(response)
    expect(response.request().postDataJSON()).toEqual(input);expect(replay.data.replayed).toBe(true);expect(replay.data.entitlement.id).toBe(first.data.entitlement.id)
    const v2=(await payload(await page.request.put("/api/v1/admin/entitlements/types/"+key,{headers:{"x-csrf-token":csrf},data:{display_name:title,permission_keys:["attachment.upload"],quotas:{"attachment.upload.daily":30},expected_revision:type.revision}}))).data
    expect(v2.current_version).toBe(2)
    const grants=(await payload(await page.request.get("/api/v1/admin/entitlements?user_id="+account.user_id))).data.filter((g:any)=>g.entitlement_type_id===type.id)
    expect(grants).toHaveLength(1);expect(grants[0]).toMatchObject({type_version:1,permission_snapshot:["attachment.upload"],quota_snapshot:{"attachment.upload.daily":20},reason:"private-reason-"+key})
    const after=(await payload(await own.get("/api/v1/users/me/entitlements"))).data;expect(after).toHaveLength(before.length+1)
    for(const path of ["/api/v1/users/"+username,"/api/v1/users/"+username+"/membership-summary"]){
      const anonymous=await playwright.request.newContext({baseURL:process.env.DAOYUN_WEB_URL})
      try{const body=await payload(await anonymous.get(path));const text=JSON.stringify(body.data);for(const privateValue of [key,"private-reason-"+key,"private-order-"+key,"points_balance","points_ledger","permission_snapshot","entitlements"])expect(text).not.toContain(privateValue)}finally{await anonymous.dispose()}
    }
    await page.getByRole("button",{name:"刷新用户权益"}).click();await expect(page.getByRole("region",{name:"积分验收成员的标准权益"})).toContainText("版本 1 · 来源 operator")
    await capture(page,info,"grant-snapshot","#entitlement-panel-users")
    const light=page.getByRole("button",{name:"切换为浅色主题",exact:true});if(await light.isVisible())await light.click()
    await page.goto("/#admin/users?user_id="+account.user_id);await page.reload();await page.getByRole("tab",{name:"有效权限",exact:true}).click()
    const check=page.getByRole("region",{name:"只读权限检查",exact:true});await expect(check.getByText("指定用户：积分验收成员 @"+username)).toBeVisible();await expect(check.getByRole("searchbox")).toHaveCount(0)
    const boards=(await payload(await page.request.get("/api/v1/admin/boards"))).data;const board=boards.find((b:any)=>b.visibility==="public"&&b.status==="open")
    expect(board).toBeTruthy();await check.getByLabel("版块标识",{exact:true}).fill(board.id);await check.getByLabel("检查动作",{exact:true}).selectOption("attachment_upload")
    const checked=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/v1/admin/permission-check")
    await check.getByRole("button",{name:"开始检查"}).click();const result=await payload(await checked)
    expect(result.data.scenario.sources.find((s:any)=>s.id===first.data.entitlement.id)).toMatchObject({kind:"entitlement",type_version:1,quotas:{"attachment.upload.daily":20}})
    await expect(check.getByText("权益："+title,{exact:true})).toBeVisible()
    await capture(page,info,"user-effective-source",".user-admin-detail")
    await page.getByRole("button",{name:"关闭抽屉",exact:true}).click()
    const dark=page.getByRole("button",{name:"切换为深色主题",exact:true});if(await dark.isVisible())await dark.click()
    await page.goto("/#admin/users?user_id="+account.user_id);await page.getByRole("tab",{name:"有效权限",exact:true}).click()
    await check.getByLabel("版块标识",{exact:true}).fill(board.id);await check.getByLabel("检查动作",{exact:true}).selectOption("attachment_upload");await check.getByRole("button",{name:"开始检查"}).click();await expect(check.getByText("权益："+title,{exact:true})).toBeVisible()
    await capture(page,info,"user-effective-source-dark",".user-admin-detail")
    await page.goto("/#user/"+username);await page.reload()
    await expect(page.getByText("private-reason-"+key,{exact:true})).toHaveCount(0);await expect(page.getByText(title,{exact:true})).toHaveCount(0)
    await writeFile(info.outputPath("snapshot-evidence.json"),JSON.stringify({userId:account.user_id,grantId:first.data.entitlement.id,firstRequest:first.meta.request_id,replayRequest:replay.meta.request_id,currentTypeVersion:2,grantVersion:1,privateApiFieldsAbsent:true,source:result.data.scenario.sources.find((s:any)=>s.id===first.data.entitlement.id)},null,2),"utf8")
  }finally{await own.dispose()}
})

test("keeps public medals separate from assets and records only one revocation after the response is lost",async({page},info)=>{
  const username=fixture(info);const csrf=await login(page.request)
  const user=(await payload(await page.request.get("/api/v1/admin/users?q="+username))).data.find((u:any)=>u.username===username);expect(user).toBeTruthy()
  const name="勋章验收 "+randomUUID().slice(0,8)
  const rule=(await payload(await page.request.post("/api/v1/admin/membership/medal-rules",{headers:{"x-csrf-token":csrf},data:{display_name:name,asset_key:"medal_03",enabled:false,required_lifetime_points:null}}))).data
  await payload(await page.request.post("/api/v1/admin/membership/medals",{headers:{"x-csrf-token":csrf},data:{user_id:user.id,medal_key:rule.key,reason:"operator.award"}}))
  const held=(await payload(await page.request.get("/api/v1/users/"+username+"/membership-summary"))).data;expect(held.medals.some((m:any)=>m.key===rule.key)).toBe(true)
  await page.goto("/#admin/membership");await page.reload();await page.getByRole("tab",{name:"勋章管理",exact:true}).click()
  await expect(page.getByText("公开展示：已授予成员的勋章会显示在公开主页与成员身份中。")).toBeVisible()
  await page.getByRole("searchbox",{name:"搜索勋章"}).fill(name);await page.getByRole("button",{name:"编辑 "+name,exact:true}).click()
  await expect(page.getByRole("img",{name:"当前勋章图标预览"})).toBeVisible()
  await page.getByRole("button",{name:"取消",exact:true}).click();await page.getByRole("button",{name:"操作记录",exact:true}).click()
  await page.getByLabel("用户 UUID",{exact:true}).fill(user.id);await page.getByRole("combobox",{name:"勋章",exact:true}).selectOption(rule.key);await page.getByRole("button",{name:"筛选记录"}).click()
  await page.getByRole("button",{name:"撤销 "+name,exact:true}).click();const dialog=page.getByRole("dialog",{name:"撤销勋章",exact:true});await dialog.getByLabel("撤销原因",{exact:true}).fill("operator.revoke")
  let first:any
  await page.route("**/api/v1/admin/membership/medal-revocations",async route=>{first=await payload(await route.fetch());await route.abort("failed")},{times:1})
  await dialog.getByRole("button",{name:"确认撤销"}).click();await expect(dialog.getByRole("alert")).toBeVisible();expect(first.data.revoked).toBe(true)
  const replayed=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/v1/admin/membership/medal-revocations")
  await dialog.getByRole("button",{name:"确认撤销"}).click();const replay=await payload(await replayed);expect(replay.data.revoked).toBe(false)
  const operations=(await payload(await page.request.get("/api/v1/admin/membership/medal-operations?user_id="+user.id+"&medal_key="+rule.key))).data
  expect(operations).toHaveLength(2);expect(operations.filter((o:any)=>o.operation==="revoke")).toHaveLength(1)
  const summary=(await payload(await page.request.get("/api/v1/users/"+username+"/membership-summary"))).data;expect(summary.medals.some((m:any)=>m.key===rule.key)).toBe(false)
  await capture(page,info,"medal-history",".membership-medal-operations")
  await writeFile(info.outputPath("medal-evidence.json"),JSON.stringify({userId:user.id,medalKey:rule.key,operations,firstRequestId:first.meta.request_id,replayRequestId:replay.meta.request_id},null,2),"utf8")
})

test("denies private entitlement reads and writes to ordinary members",async({page})=>{
  const csrf=await login(page.request,"demo_member")
  await payload(await page.request.get("/api/v1/admin/entitlements?user_id="+randomUUID()),403)
  await payload(await page.request.post("/api/v1/admin/entitlements",{headers:{"x-csrf-token":csrf},data:{user_id:randomUUID(),entitlement_type_id:randomUUID(),source:"operator",source_reference_id:null,reason:"test",starts_at:"2026-10-01T00:00:00Z",ends_at:null,idempotency_key:randomUUID()}}),403)
  await page.goto("/#admin/users");await expect(page.getByRole("tab",{name:"有效权限"})).toHaveCount(0)
})
