import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(90000)
async function payload(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status)
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body
}
function sql(query: string) {
  const url = new URL(process.env.DATABASE_URL!)
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
  expect(url.pathname).toContain("v3")
  return execFileSync(process.env.PSQL_BIN!, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-d", process.env.DATABASE_URL!], { input: query, encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" }, windowsHide: true }).trim()
}
async function login(request: APIRequestContext, username = "demo_admin") {
  return (await payload(await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }))).data.csrf_token as string
}
async function member(request: APIRequestContext, info: TestInfo, index: number) {
  const fixtures: string[] = JSON.parse(process.env.DAOYUN_GOVERNANCE_FIXTURE_USERS ?? "[]")
  const known = fixtures[index + (info.project.name.includes("mobile") ? 3 : 0)]
  const username = known ?? "v3_gov_" + randomUUID().replaceAll("-", "").slice(0,16)
  let csrf: string
  if (known) { expect(known).toMatch(/^v3_gov_[a-f0-9]{16}$/); csrf = await login(request,known) }
  else csrf = (await payload(await request.post("/api/v1/auth/register", { data: { username, email: username + "@example.test", display_name: "治理验收成员", password: "DaoYunLocalOnly!2026" } }), 201)).data.csrf_token
  const userId = (await payload(await request.get("/api/v1/users/me/membership"))).data.user_id as string
  expect(userId).toMatch(/^[a-f0-9-]{36}$/)
  return { username, userId, csrf }
}
function role(userId: string, scope: "site" | "board", keys: string[], boardId?: string) {
  const id = randomUUID()
  sql("INSERT INTO roles(id,key,name,scope) VALUES('" + id + "','v3_" + id.replaceAll("-","") + "','V3 governance fixture','" + scope + "');" +
    "INSERT INTO role_permissions(role_id,permission_id) SELECT '" + id + "',id FROM permissions WHERE permission_key IN (" + keys.map(key => "'" + key + "'").join(",") + ");" +
    "INSERT INTO role_assignments(id,user_id,role_id,scope_id,scope_mode,assigned_by) VALUES(gen_random_uuid(),'" + userId + "','" + id + "'," + (boardId ? "'" + boardId + "'" : "NULL") + ",'exact','" + userId + "');")
  return id
}
function board() {
  const id = randomUUID()
  sql("INSERT INTO boards(id,slug,name) VALUES('" + id + "','v3-" + id + "','治理验收版块');")
  return id
}
function reportFixture(boardId: string, authorId: string, reporterId: string, title: string, hidden = false) {
  const topicId = randomUUID(), reportId = randomUUID()
  const status = hidden ? "hidden" : "published"
  sql("INSERT INTO topics(id,board_id,author_id,title,content,status,published_at) VALUES('" + topicId + "','" + boardId + "','" + authorId + "','" + title + "','治理证据 " + title + "','" + status + "',CURRENT_TIMESTAMP);" +
    "INSERT INTO posts(id,topic_id,author_id,kind,content,status) VALUES('" + topicId + "','" + topicId + "','" + authorId + "','topic','治理证据 " + title + "','" + status + "');" +
    "INSERT INTO content_reports(id,reporter_id,target_type,target_id,reason,details) VALUES('" + reportId + "','" + reporterId + "','topic','" + topicId + "','spam','验收举报证据');")
  return { topicId, reportId, title }
}
async function capture(page: Page, info: TestInfo, name: string, selector: string) {
  const before = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    if (width === 320 || width === 1440) expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([])
    const modalBody = page.locator(".admin-action-dialog__body")
    if (await modalBody.count()) await modalBody.evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png"), fullPage: false })
  }
  if (before) await page.setViewportSize(before)
}
async function light(page: Page) {
  const button = page.getByRole("button", { name: "切换为浅色主题", exact: true })
  if (await button.isVisible()) await button.click()
}
function removeAssignments(roles: string[]) {
  if (roles.length) sql("DELETE FROM role_assignments WHERE role_id IN (" + roles.map(id => "'" + id + "'").join(",") + ")")
}
test("triages eight reports, rejects two outside scope, and retries only one after its authority is restored", async ({ page, playwright }, info) => {
  const admin = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  const roles: string[] = [], errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await login(admin); const authorId = (await payload(await admin.get("/api/v1/users/me/membership"))).data.user_id
    const operator = await member(page.request,info,0); const csrf = operator.csrf
    const a = board(), b = board(), label = "批处理验收" + randomUUID().slice(0,8)
    roles.push(role(operator.userId, "site", ["governance.reports.read"]))
    roles.push(role(operator.userId, "board", ["governance.reports.resolve"], a))
    const fixtures = Array.from({ length: 10 }, (_, i) => reportFixture(i < 8 ? a : b, authorId, operator.userId, label + i))
    await page.goto("/#admin/reports"); await page.reload(); await light(page)
    await page.getByRole("searchbox", { name: "搜索举报" }).fill(label); await page.getByRole("button", { name: "搜索", exact: true }).click()
    await expect(page.locator(".report-catalog-row")).toHaveCount(10)
    await page.getByRole("checkbox", { name: "选择当前举报", exact: true }).check()
    await page.getByRole("button", { name: "批量标为处理中", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "批量标为处理中", exact: true })
    await expect(dialog).toContainText("影响 10 条举报")
    await dialog.getByLabel("批处理原因").fill("核实本轮治理证据")
    await dialog.getByRole("button", { name: "确认逐项处理" }).click()
    await expect(dialog.getByRole("status")).toHaveText("成功 8 条，失败 2 条")
    roles.push(role(operator.userId, "board", ["governance.reports.resolve"], b))
    await dialog.getByRole("button", { name: "重试举报 " + fixtures[8].reportId, exact: true }).click()
    await expect(dialog.getByRole("status")).toHaveText("成功 9 条，失败 1 条")
    await expect(dialog.getByRole("button", { name: "重试举报 " + fixtures[0].reportId })).toHaveCount(0)
    const ids = fixtures.map(f => "'" + f.reportId + "'").join(",")
    const facts = JSON.parse(sql("SELECT json_build_object('updated',(SELECT count(*) FROM content_reports WHERE id IN (" + ids + ") AND revision=2),'audits',(SELECT count(*) FROM admin_audit_log WHERE resource_id IN (" + ids + ") AND action='report.review'),'untouched',(SELECT revision FROM content_reports WHERE id='" + fixtures[9].reportId + "'))"))
    expect(facts).toEqual({ updated: 9, audits: 9, untouched: 1 })
    await capture(page, info, "batch-results", ".admin-action-dialog")
    await writeFile(info.outputPath("batch-evidence.json"), JSON.stringify({ operatorId: operator.userId, fixtures, facts, scope: "report triage only", errors },null,2), "utf8")
    expect(errors).toEqual([])
  } finally { removeAssignments(roles); await admin.dispose() }
})
test("keeps the second moderator's published decision when the first submits a stale review", async ({ page, playwright }, info) => {
  const second = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  const roles: string[] = [], errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    const firstCsrf = await login(page.request)
    const authorId = (await payload(await page.request.get("/api/v1/users/me/membership"))).data.user_id
    const operator = await member(second,info,1), secondCsrf = operator.csrf
    const a = board(), topic = randomUUID(), review = randomUUID()
    roles.push(role(operator.userId,"board",["moderation.topic"],a))
    sql("INSERT INTO topics(id,board_id,author_id,title,content,status,published_at) VALUES('" + topic + "','" + a + "','" + authorId + "','编辑审核验收','原有公开内容','published',CURRENT_TIMESTAMP);" +
      "INSERT INTO posts(id,topic_id,author_id,kind,content,status) VALUES('" + topic + "','" + topic + "','" + authorId + "','topic','原有公开内容','published');" +
      "INSERT INTO post_revisions(id,post_id,editor_id,revision_number,content) VALUES(gen_random_uuid(),'" + topic + "','" + authorId + "',1,'原有公开内容');" +
      "INSERT INTO content_edit_reviews(id,board_id,topic_id,post_id,target_type,editor_id,base_revision,proposed_content,content_changed) VALUES('" + review + "','" + a + "','" + topic + "','" + topic + "','topic','" + authorId + "',1,'新版公开内容',true);")
    await page.goto("/#admin/reviews"); await page.reload(); await light(page)
    await page.getByLabel("审核版块").selectOption(a)
    await page.getByRole("button", { name: "通过并发布", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "通过编辑", exact: true })
    await dialog.getByLabel("审核说明").fill("第一位审核者保留的说明")
    const winner = await payload(await second.patch("/api/v1/admin/edit-reviews/" + review, { headers: { "x-csrf-token": secondCsrf }, data: { decision: "approve", base_revision: 1, reason: "第二位审核者已发布" } }))
    expect(winner.data.status).toBe("approved")
    await dialog.getByRole("button", { name: "确认通过", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("其他审核者已处理或公开版本已变化")
    await expect(dialog.getByRole("button", { name: "确认通过" })).toBeDisabled()
    await dialog.getByRole("button", { name: "刷新队列并保留说明" }).click()
    await expect(dialog).toContainText("最新审核结论：已通过 · 版本 2")
    await expect(dialog).toContainText("审核说明：第二位审核者已发布")
    await expect(dialog.getByRole("textbox", { name: "审核说明", exact: true })).toHaveValue("第一位审核者保留的说明")
    const late = await payload(await page.request.patch("/api/v1/admin/edit-reviews/" + review, { headers: { "x-csrf-token": firstCsrf }, data: { decision: "reject", base_revision: 1, reason: "不应覆盖的决定" } }),409)
    const current = (await payload(await page.request.get("/api/v1/admin/edit-reviews/" + review))).data
    expect(current).toMatchObject({ status: "approved", revision: 2, review_reason: "第二位审核者已发布", current_content: "新版公开内容" })
    expect(Number(sql("SELECT count(*) FROM admin_audit_log WHERE resource_type='edit_review' AND resource_id='" + review + "'"))).toBe(1)
    await capture(page,info,"review-conflict",".admin-action-dialog")
    await writeFile(info.outputPath("review-evidence.json"),JSON.stringify({reviewId:review,winnerRequest:winner.meta.request_id,lateRequest:late.meta.request_id,current,errors},null,2),"utf8")
    expect(errors).toEqual([])
  } finally { removeAssignments(roles); await second.dispose() }
})
test("lets a scoped reader inspect hidden evidence without cross-board history or mutation controls", async ({ page, playwright }, info) => {
  const admin = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  const anonymous = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  const roles: string[] = [], errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await login(admin); const authorId = (await payload(await admin.get("/api/v1/users/me/membership"))).data.user_id
    const operator = await member(page.request,info,2)
    const a = board(), b = board(), label = "隐藏证据" + randomUUID().slice(0,8)
    roles.push(role(operator.userId,"board",["governance.reports.read"],a))
    const allowed = reportFixture(a,authorId,operator.userId,label+"A",true), denied = reportFixture(b,authorId,operator.userId,label+"B",true)
    await payload(await anonymous.get("/api/v1/topics/"+allowed.topicId),404)
    const bounded = await payload(await page.request.get("/api/v1/admin/reports/"+allowed.reportId))
    expect(bounded.data.author.report_count).toBe(1); expect(bounded.data.related_reports).toHaveLength(1)
    expect(JSON.stringify(bounded)).not.toContain(denied.reportId)
    await payload(await page.request.get("/api/v1/admin/reports/"+denied.reportId),403)
    await page.goto("/#admin/reports"); await page.reload(); await light(page)
    await expect(page.getByRole("button",{name:"主题管理",exact:true})).toHaveCount(0)
    await expect(page.locator(".report-catalog-row")).toHaveCount(1)
    await page.getByRole("button",{name:"查看举报："+allowed.title,exact:true}).click()
    const detail = page.getByRole("dialog",{name:"举报详情",exact:true})
    await expect(detail).toContainText("治理证据 "+allowed.title)
    await expect(detail).toContainText("当前权限范围内共有 1 条举报记录")
    await expect(detail.getByRole("button",{name:"处理举报",exact:true})).toHaveCount(0)
    await expect(page.getByRole("button",{name:"批量标为处理中",exact:true})).toHaveCount(0)
    await capture(page,info,"scoped-hidden-evidence",".report-catalog-detail")
    await detail.getByRole("button",{name:"返回举报队列",exact:true}).click()
    await page.getByRole("button",{name:"查看举报："+allowed.title,exact:true}).click(); await page.reload()
    await expect(detail).toContainText("治理证据 "+allowed.title)
    await detail.getByRole("button",{name:"返回举报队列",exact:true}).click()
    const dark = page.getByRole("button",{name:"切换为深色主题",exact:true}); if(await dark.isVisible())await dark.click()
    await page.getByRole("button",{name:"查看举报："+allowed.title,exact:true}).click()
    await capture(page,info,"scoped-hidden-evidence-dark",".report-catalog-detail")
    await writeFile(info.outputPath("scope-evidence.json"),JSON.stringify({operatorId:operator.userId,allowed,denied,detail:bounded.data,errors},null,2),"utf8")
    expect(errors).toEqual([])
  } finally { removeAssignments(roles); await admin.dispose(); await anonymous.dispose() }
})

test("links a risk alert to its exact report and reads only its audit on demand", async ({ page }, info) => {
  const roles: string[] = [], errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    const operator = await member(page.request,info,0)
    roles.push(role(operator.userId,"site",["governance.policy.read","governance.alerts.read","governance.alerts.resolve","governance.reports.read","audit.read"]))
    const a = board(), fixture = reportFixture(a,operator.userId,operator.userId,"风险联动"+randomUUID().slice(0,8),true), alert = randomUUID()
    sql("INSERT INTO risk_alerts(id,kind,severity,score,target_type,target_id,reporter_id,report_id,details) VALUES('" + alert + "','high_risk_report','high',80,'topic','" + fixture.topicId + "','" + operator.userId + "','" + fixture.reportId + "','{}');")
    await payload(await page.request.patch("/api/v1/admin/risk-alerts/"+alert,{headers:{"x-csrf-token":operator.csrf},data:{status:"acknowledged"}}))
    let auditRequests = 0
    page.on("request", request => { const url = new URL(request.url()); if(url.pathname==="/api/v1/admin/audit" && url.searchParams.get("resource_id")===alert)auditRequests++ })
    await page.goto("/#admin/risk"); await page.reload(); await light(page)
    const row = page.locator(".admin-report-row").filter({hasText:alert})
    await expect(row).toHaveCount(1)
    expect(auditRequests).toBe(0)
    await row.getByRole("link",{name:"查看关联举报",exact:true}).click()
    await expect(page.getByRole("dialog",{name:"举报详情",exact:true})).toContainText(fixture.title)
    expect(page.url()).toContain("report_id="+fixture.reportId)
    await page.goBack()
    await expect(row).toHaveCount(1)
    await row.getByRole("button",{name:"查看告警审计",exact:true}).click()
    const detail = page.getByRole("dialog",{name:"告警操作记录",exact:true})
    await expect(detail).toContainText(alert)
    expect(auditRequests).toBe(1)
    await capture(page,info,"risk-object-audit",".related-audit-log")
    await writeFile(info.outputPath("risk-evidence.json"),JSON.stringify({alertId:alert,reportId:fixture.reportId,auditRequests,errors},null,2),"utf8")
    expect(errors).toEqual([])
  } finally { removeAssignments(roles) }
})
