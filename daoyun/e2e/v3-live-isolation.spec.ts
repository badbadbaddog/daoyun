import { writeFile } from "node:fs/promises"
import { expect, test, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10_000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
const issues = new WeakMap<Page, string[]>()
const requests = new WeakMap<Page, string[]>()
async function envelope(response: Pick<APIResponse, "json" | "headers" | "status">) {
  const payload = await response.json()
  expect(payload.meta.request_id).toBe(response.headers()["x-request-id"])
  expect([200, 201]).toContain(response.status())
  return payload
}
async function login(page: Page) {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) {
    const url = new URL(process.env[name] ?? "")
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
    if (name === "DATABASE_URL") expect(url.pathname).toContain("v3")
  }
  const errors: string[] = []; issues.set(page, errors); page.on("pageerror", error => errors.push(error.message))
  const paths: string[] = []; requests.set(page, paths)
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/")) paths.push(url.pathname + url.search) })
  return (await envelope(await page.request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password: "DaoYunLocalOnly!2026" } }))).data.csrf_token as string
}
async function snapshots(page: Page, info: TestInfo, name: string) {
  expect(issues.get(page)).toEqual([])
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
  await writeFile(info.outputPath(name + "-requests.json"), JSON.stringify({ paths: requests.get(page), pageErrors: issues.get(page) }, null, 2), "utf8")
}

test("completes report processing while SMTP is unavailable and keeps email failure local", async ({ page, browser }, info) => {
  const csrf = await login(page)
  const title = "V3 分区加载举报 " + crypto.randomUUID().slice(0, 8)
  const topic = await envelope(await page.request.post("/api/v1/topics", { headers: { "x-csrf-token": csrf, "idempotency-key": crypto.randomUUID() }, data: { title, content: "仅用于隔离实例验证分区加载" } }))
  const context = await browser.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  let reportId: string
  try {
    const session = await envelope(await context.request.post("/api/v1/auth/login", { data: { identifier: "demo_member", password: "DaoYunLocalOnly!2026" } }))
    const receipt = await envelope(await context.request.post("/api/v1/reports", { headers: { "x-csrf-token": session.data.csrf_token }, data: { target_type: "topic", target_id: topic.data.id, reason: "other", details: "V3 邮件故障隔离" } }))
    reportId = receipt.data.id
  } finally { await context.close() }
  await page.route("**/api/v1/admin/smtp-settings", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "test.smtp.offline", message: "SMTP unavailable" }, meta: { request_id: "isolated-test" } }) }))
  await page.goto("/#admin/reports?status=open&report_id=" + reportId)
  const detail = page.getByRole("dialog", { name: "举报详情" })
  await expect(detail.getByRole("heading", { name: title })).toBeVisible()
  expect(requests.get(page)?.some(path => /smtp-settings|site-branding|admin\/boards/.test(path) && path.startsWith("/api/v1/admin/"))).toBe(false)
  await detail.getByRole("button", { name: "处理举报", exact: true }).click()
  await detail.getByLabel("举报结论").selectOption("dismissed")
  await detail.getByLabel("内部处理备注").fill("分区加载验证：保留内容并驳回测试举报")
  await detail.getByRole("button", { name: "确认并完成处置" }).click()
  const confirmation = page.getByRole("alertdialog", { name: "确认举报处置" })
  await expect(confirmation).toBeVisible()
  const decision = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/admin/reports/" + reportId + "/moderations" && response.request().method() === "POST")
  await confirmation.getByRole("button", { name: "确认执行处置" }).click()
  await envelope(await decision)
  const report = await envelope(await page.request.get("/api/v1/admin/reports/" + reportId))
  expect(report.data.report.status).toBe("dismissed")
  await page.goto("/#admin/email")
  await expect(page.getByText("邮件配置暂时无法加载。", { exact: true })).toBeVisible()
  await snapshots(page, info, "local-email-failure")
  await page.goto("/#admin/reports")
  await expect(page.getByRole("region", { name: "举报队列" })).toBeVisible()
  await expect(page.getByText("邮件配置暂时无法加载。", { exact: true })).toHaveCount(0)
  expect(issues.get(page)).toEqual([])
})

test("loads growth without ledger or entitlement details and recovers from a failed benefits tab", async ({ page }, info) => {
  await login(page)
  await page.goto("/#member/growth")
  await expect(page.getByRole("region", { name: "成长等级", exact: true })).toBeVisible()
  expect(requests.get(page)?.filter(path => /users\/me\/(points|groups|entitlements|membership)|\/medals/.test(path))).toEqual([])
  expect(requests.get(page)?.filter(path => path === "/api/v1/users/me/experience")).toHaveLength(1)
  expect(requests.get(page)?.filter(path => path === "/api/v1/membership/levels")).toHaveLength(1)
  await page.route("**/api/v1/users/me/entitlements", route => route.abort("failed"))
  await page.getByRole("button", { name: "权益", exact: true }).click()
  await expect(page.getByRole("heading", { name: "会员信息暂时不可用" })).toBeVisible()
  await page.getByRole("button", { name: "成长", exact: true }).click()
  await expect(page.getByRole("region", { name: "成长等级", exact: true })).toBeVisible()
  await snapshots(page, info, "growth-independent")
})

test("keeps a partial member overview usable without inventing balance or loading detail lists", async ({ page }, info) => {
  await login(page)
  await page.route("**/api/v1/users/me/membership", route => route.abort("failed"))
  await page.goto("/#member")
  await expect(page.getByRole("region", { name: "我的成长概览" })).toBeVisible()
  await expect(page.getByRole("button", { name: "查看积分详情" })).toContainText("积分余额暂不可用")
  await expect(page.getByRole("button", { name: "重试概览摘要" })).toBeVisible()
  expect(requests.get(page)?.filter(path => /points\/ledger|entitlements|\/medals/.test(path))).toEqual([])
  await snapshots(page, info, "partial-overview")
})

test("opens a board without global feed and keeps user-search failure separate from topic results", async ({ page }, info) => {
  await login(page)
  await page.goto("/#board/general")
  await expect(page.getByRole("heading", { name: "社区广场", level: 1 })).toBeVisible()
  await expect.poll(() => requests.get(page)?.filter(path => path.startsWith("/api/v1/topics?") && new URLSearchParams(path.split("?")[1]).get("board") === "general").length).toBeGreaterThan(0)
  expect(requests.get(page)?.filter(path => path.startsWith("/api/v1/feed/"))).toEqual([])
  await snapshots(page, info, "board-no-global-feed")
  await page.route("**/api/v1/users?**", route => route.abort("failed"))
  await page.goto("/#search?q=Rust")
  await expect(page.getByRole("heading", { name: "搜索：Rust", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "重试用户搜索" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "今日热帖", includeHidden: true })).toHaveCount(0)
  expect(requests.get(page)?.filter(path => path.startsWith("/api/v1/feed/"))).toEqual([])
  await snapshots(page, info, "search-independent")
})
