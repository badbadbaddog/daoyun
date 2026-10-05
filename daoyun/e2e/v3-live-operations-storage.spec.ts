import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIResponse, type Response, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", screenshot: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated DYR-026 restored instance")
test.setTimeout(120000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  for (const key of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) {
    const url = new URL(process.env[key]!)
    expect(url.hostname).toBe("127.0.0.1")
    if (key === "DATABASE_URL") expect(url.pathname).toBe("/daoyun_v3_dyr026_restore_20261004")
  }
  const found: string[] = []
  errors.set(page, found)
  page.on("pageerror", error => found.push(error.message))
  page.on("requestfailed", request => found.push(new URL(request.url()).pathname))
  page.on("console", message => { if (message.type() === "error") found.push(message.text()) })
})
async function data(response: APIResponse | Response, status = 200) {
  expect(response.status(), new URL(response.url()).pathname).toBe(status)
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body.data
}
async function login(page: Page) {
  return data(await page.request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password: "DaoYunLocalOnly!2026" } }))
}
function sql(query: string) {
  return execFileSync(process.env.PSQL_BIN!, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-d", process.env.DATABASE_URL!], { input: query, encoding: "utf8", windowsHide: true, env: { ...process.env, PGCLIENTENCODING: "UTF8" } }).trim()
}
async function capture(page: Page, info: TestInfo, name: string) {
  const before = page.viewportSize()
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    if (width === 320 || width === 1440) expect((await new AxeBuilder({ page }).include(".system-admin-main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
  if (before) await page.setViewportSize(before)
  expect(errors.get(page)).toEqual([])
}

test("keeps basic health and business tasks when advanced alerts are off", async ({ page }, info) => {
  await login(page)
  const summary = await data(await page.request.get("/api/v1/admin/operations/summary"))
  expect(summary.alert_evaluation_enabled).toBe(false)
  expect(summary.database.ready).toBe(true)
  expect(summary.outbox.dead).toBe(0)
  await data(await page.request.get("/api/v1/health/ready"))
  expect(sql("SELECT status FROM users WHERE username='restricted_member'")).toBe("active")
  await page.goto("/#admin/operations")
  await expect(page.getByText("高级告警未启用 · 基础任务与历史记录保留", { exact: true })).toBeVisible()
  await expect(page.getByText("数据库正常", { exact: true })).toBeVisible()
  await capture(page, info, "alerts-off-basic-ready")
  await writeFile(info.outputPath("operations-evidence.json"), JSON.stringify({ alertsEnabled: false, databaseReady: true, expiredAccountRestored: true, outboxDead: 0 }, null, 2), "utf8")
})

test("separates branding mail storage and operations with keyboard navigation", async ({ page }, info) => {
  await login(page)
  await page.goto("/#admin/storage")
  const storage = page.getByRole("region", { name: "存储配置" })
  await expect(storage.getByText("本地目录", { exact: true })).toBeVisible()
  await expect(storage.getByText("S3 对象存储", { exact: true })).toBeVisible()
  const config = await data(await page.request.get("/api/v1/admin/attachments/storage"))
  expect(config).toEqual({ write_provider: "local", legacy_provider: "s3", local_configured: true, s3_configured: true, s3_supported: true })
  expect(await storage.locator("input").count()).toBe(0)
  await capture(page, info, "storage-current-and-history")
  const tabs = [{ tab: "branding", label: "品牌配置" }, { tab: "email", label: "邮件服务" }, { tab: "operations", label: "运维监控" }, { tab: "storage", label: "附件存储" }]
  for (const item of tabs) {
    const mobile = page.getByRole("combobox", { name: "管理模块", exact: true })
    if (await mobile.isVisible()) {
      await mobile.selectOption(item.tab)
    } else {
      const button = page.getByRole("navigation", { name: "站点管理导航" }).getByRole("group", { name: "站点设置" }).getByRole("button", { name: item.label, exact: true })
      await button.focus()
      await button.press("Enter")
    }
    await expect(page.getByRole("heading", { level: 1, name: item.label, exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp("#admin/" + item.tab + "$"))
    const heading = { branding: "站点品牌", email: "SMTP 邮件服务", operations: "运营概览", storage: "附件存储" }[item.tab]
    await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible()
  }
  await expect(storage.getByRole("button", { name: "刷新配置" })).toBeVisible()
  const refresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/admin/attachments/storage")
  await storage.getByRole("button", { name: "刷新配置" }).click()
  await data(await refresh)
  await expect(storage.getByText("本地目录", { exact: true })).toBeVisible()
  expect(errors.get(page)).toEqual([])
})

test("retains historical alerts and rules and allows acknowledgement while evaluation is off", async ({ page }, info) => {
  await login(page)
  const key = info.project.name === "chromium-mobile" ? "outbox_dead" : "api_p95"
  const existing = sql("SELECT alert.id FROM operations_alerts AS alert JOIN operations_alert_rules AS rule ON rule.id=alert.rule_id WHERE rule.key='" + key + "' AND alert.status='open'")
  const id = existing || randomUUID()
  if (!existing) sql("INSERT INTO operations_alerts(id,rule_id,status,observed_value,threshold) SELECT '" + id + "',id,'open',threshold + 1,threshold FROM operations_alert_rules WHERE key='" + key + "';")
  const initial = await data(await page.request.get("/api/v1/admin/operations/alerts?status=open"))
  const historical = initial.find((alert: { id: string }) => alert.id === id)
  expect(historical).toBeTruthy()
  await page.goto("/#admin/operations")
  const tabs = page.getByRole("navigation", { name: "运维分类" })
  await tabs.getByRole("button", { name: "待确认告警", exact: true }).focus()
  await tabs.getByRole("button", { name: "待确认告警", exact: true }).press("Enter")
  await expect(page.getByText("自动评估已关闭，历史告警仍可查看和确认。", { exact: true })).toBeVisible()
  await capture(page, info, "historical-alerts-off")
  const acknowledgement = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/v1/admin/operations/alerts/" + id)
  await page.getByRole("button", { name: "确认 " + historical.rule.name + "告警", exact: true }).click()
  await data(await acknowledgement)
  expect(sql("SELECT status FROM operations_alerts WHERE id='" + id + "'")).toBe("acknowledged")
  await tabs.getByRole("button", { name: "告警规则", exact: true }).click()
  await expect(page.getByRole("heading", { level: 2, name: "告警规则", exact: true })).toBeVisible()
  expect(await page.locator(".operations-rule").count()).toBe(4)
  const rules = await data(await page.request.get("/api/v1/admin/operations/alert-rules"))
  expect(rules).toHaveLength(4)
  await capture(page, info, "rules-retained-alerts-off")
  await writeFile(info.outputPath("history-evidence.json"), JSON.stringify({ historicalAlert: id, acknowledged: true, rules: 4, alertsEnabled: false }, null, 2), "utf8")
})
