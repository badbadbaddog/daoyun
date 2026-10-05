import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { randomUUID, createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(90000)
const exec = promisify(execFile)
const levelsPath = "/api/v1/admin/membership/levels"
interface Level { id: string; internal_key: string; level_order: number; display_name: string; required_experience: number; icon_asset_id: string | null; color: string | null; description: string; status: string; revision: number }
async function payload(response: APIResponse, status = 200) {
  expect(response.status()).toBe(status)
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body
}
async function login(request: APIRequestContext, username = "demo_admin") {
  return (await payload(await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }))).data.csrf_token as string
}
async function update(request: APIRequestContext, csrf: string, level: Level, patch: Partial<Level>) {
  const { level_order, display_name, required_experience, icon_asset_id, color, description, status } = level
  return (await payload(await request.patch(levelsPath + "/" + level.id, { headers: { "x-csrf-token": csrf }, data: { expected_revision: level.revision, level_order, display_name, required_experience, icon_asset_id, color, description, status, ...patch } }))).data as Level
}
async function seed(request: APIRequestContext, csrf: string, status: string) {
  const levels = (await payload(await request.get(levelsPath))).data as Level[]
  const level = (await payload(await request.post(levelsPath, { headers: { "x-csrf-token": csrf }, data: { internal_key: "v3_growth_" + randomUUID().replaceAll("-", ""), level_order: Math.max(...levels.map(l => l.level_order)) + 1, display_name: "隔离成长验证", required_experience: Math.max(...levels.map(l => l.required_experience)) + 1000000, icon_asset_id: null, color: null, description: "DYR-014 隔离夹具" } }), 201)).data as Level
  try {
    // 草稿没有创建端点，只在隔离数据库建立该既有状态的测试夹具。
    if (status === "draft") {
      expect(level.id).toMatch(/^[0-9a-f-]{36}$/)
      await exec(process.env.DAOYUN_PSQL_BIN!, ["--dbname=" + process.env.DATABASE_URL!, "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--command=UPDATE membership_levels SET status='draft', published_at=NULL WHERE id='" + level.id + "'::uuid"], { encoding: "utf8", windowsHide: true })
      return { ...level, status }
    }
    return await update(request, csrf, level, { status })
  } catch (error) { await remove(request, csrf, level.id); throw error }
}
async function remove(request: APIRequestContext, csrf: string, id: string) { await payload(await request.delete(levelsPath + "/" + id, { headers: { "x-csrf-token": csrf } })) }
async function open(page: Page) {
  await page.goto("/#admin/membership")
  await page.reload()
  await page.getByRole("tab", { name: "成长运营", exact: true }).click()
  await expect(page.getByRole("heading", { name: "成长等级（EXP）", exact: true })).toBeVisible()
}
async function ledgerSnapshot() {
  const sql = "SELECT json_build_object('experience',(SELECT COALESCE(json_agg(to_jsonb(a) ORDER BY user_id),'[]'::json) FROM experience_accounts a JOIN users u ON u.id=a.user_id WHERE u.username='demo_admin'),'exp_entries',(SELECT count(*) FROM experience_ledger_entries e JOIN users u ON u.id=e.user_id WHERE u.username='demo_admin'),'point_entries',(SELECT count(*) FROM point_ledger_entries e JOIN users u ON u.id=e.user_id WHERE u.username='demo_admin'))::text"
  const result = await exec(process.env.DAOYUN_PSQL_BIN!, ["--dbname=" + process.env.DATABASE_URL!, "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command=" + sql], { encoding: "utf8", windowsHide: true })
  return createHash("sha256").update(result.stdout.trim()).digest("hex")
}
async function accessibility(page: Page, selector: string) { expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]) }
async function capture(page: Page, info: TestInfo, name: string) {
  const before = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) { await page.setViewportSize({ width, height: 900 }); await assertNoHorizontalOverflow(page); await page.screenshot({ path: info.outputPath(name + "-" + width + ".png"), fullPage: true }) }
  if (before) await page.setViewportSize(before)
}

test.beforeEach(async () => {
  for (const key of ["DAOYUN_WEB_URL", "DATABASE_URL"]) { const url = new URL(process.env[key]!); expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname); if (key === "DATABASE_URL") expect(url.pathname).toContain("v3") }
})

test("preserves draft, disabled and archived rules and previews without account writes", async ({ page }, info) => {
  const csrf = await login(page.request)
  for (const status of ["draft", "disabled", "archived"]) {
    const level = await seed(page.request, csrf, status)
    try {
      await open(page)
      let writes = 0
      page.on("request", r => { if (new URL(r.url()).pathname === levelsPath + "/" + level.id && r.method() === "PATCH") writes++ })
      await page.getByRole("button", { name: (status === "archived" ? "查看 " : "编辑 ") + level.internal_key, exact: true }).click()
      if (status === "archived") {
        await expect(page.getByRole("button", { name: "删除 " + level.internal_key, exact: true })).not.toBeVisible()
        const archived = page.getByRole("dialog", { name: "查看成长等级", exact: true })
        await expect(archived.getByRole("textbox", { name: "展示名称", exact: true })).toBeDisabled()
        await expect(archived.getByRole("button", { name: "保存更改", exact: true })).not.toBeVisible()
        await archived.getByRole("button", { name: "取消", exact: true }).click(); expect(writes).toBe(0); continue
      }
      const dialog = page.getByRole("dialog", { name: "编辑成长等级", exact: true })
      await expect(dialog.getByRole("combobox", { name: "等级状态", exact: true })).toHaveValue(status)
      const before = await ledgerSnapshot()
      await dialog.getByRole("textbox", { name: "展示名称", exact: true }).fill("本地展示预览")
      await dialog.getByRole("spinbutton", { name: "EXP 阈值", exact: true }).fill(String(level.required_experience + 100))
      await expect(dialog.getByRole("region", { name: "等级预览", exact: true })).toContainText("本地展示预览")
      expect(writes).toBe(0)
      expect(await ledgerSnapshot()).toBe(before)
      if (status === "draft") { await accessibility(page, ".membership-growth-dialog"); await capture(page, info, "local-preview") }
      const response = page.waitForResponse(r => new URL(r.url()).pathname === levelsPath + "/" + level.id && r.request().method() === "PATCH")
      await dialog.getByRole("button", { name: "保存更改", exact: true }).click()
      const saved = await response; expect(saved.status()).toBe(200)
      const body = await saved.json(); expect(body.meta.request_id).toBe(saved.headers()["x-request-id"]); expect(body.data.status).toBe(status)
      await expect(dialog).not.toBeVisible(); expect(writes).toBe(1)
      const publicLevels = (await payload(await page.request.get("/api/v1/membership/levels"))).data as Level[]
      expect(publicLevels.some(l => l.id === level.id)).toBe(false)
      await writeFile(info.outputPath(status + "-evidence.json"), JSON.stringify({ status, requestId: body.meta.request_id, previewLedgerSha256: before, writes }, null, 2), "utf8")
    } finally { await remove(page.request, csrf, level.id) }
  }
})

test("retains local edits through a real revision conflict and explicit refresh", async ({ page }, info) => {
  const csrf = await login(page.request); const level = await seed(page.request, csrf, "draft")
  try {
    await open(page); await page.getByRole("button", { name: "编辑 " + level.internal_key, exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "编辑成长等级", exact: true })
    await dialog.getByRole("textbox", { name: "展示名称", exact: true }).fill("保留我的编辑")
    await dialog.getByRole("combobox", { name: "等级状态", exact: true }).selectOption("published")
    const remote = await update(page.request, csrf, level, { description: "另一位管理员修改" })
    await dialog.getByRole("button", { name: "保存更改", exact: true }).click()
    await expect(dialog.getByText("数据已被其他管理员更新", { exact: false })).toBeVisible()
    await dialog.getByRole("button", { name: "刷新最新数据", exact: true }).click()
    await expect(dialog.getByText("数据已被其他管理员更新", { exact: false })).not.toBeVisible()
    await expect(dialog.getByRole("textbox", { name: "展示名称", exact: true })).toHaveValue("保留我的编辑")
    await expect(dialog.getByRole("combobox", { name: "等级状态", exact: true })).toHaveValue("published")
    await dialog.getByRole("button", { name: "保存更改", exact: true }).click(); await expect(dialog).not.toBeVisible()
    const actual = ((await payload(await page.request.get(levelsPath))).data as Level[]).find(l => l.id === level.id)!
    expect(actual).toMatchObject({ display_name: "保留我的编辑", status: "published", revision: remote.revision + 1 })
    await writeFile(info.outputPath("revision-evidence.json"), JSON.stringify({ staleRevision: level.revision, remoteRevision: remote.revision, savedRevision: actual.revision, status: actual.status }, null, 2), "utf8")
  } finally { await remove(page.request, csrf, level.id) }
})

test("retries the actual installation status independently and renders UTC rules accessibly", async ({ page }, info) => {
  await login(page.request); const catalog = (await payload(await page.request.get("/api/v1/admin/plugins"))).data as { key: string; status: string }[]
  const growth = catalog.find(p => p.key === "official_growth_rewards")
  const issues: string[] = []; page.on("pageerror", e => issues.push(e.message))
  await page.route("**/api/v1/admin/plugins", route => route.fulfill({ status: 503, contentType: "application/json", headers: { "x-request-id": "v3-growth-fault" }, body: JSON.stringify({ error: { code: "database.unavailable", message: "插件安装状态暂时不可用" }, meta: { request_id: "v3-growth-fault" } }) }))
  await open(page); const rules = page.getByRole("region", { name: "成长奖励规则", exact: true })
  await expect(rules.getByRole("alert")).toContainText("插件安装状态暂时不可用")
  await expect(page.getByRole("list", { name: "成长等级列表", exact: true })).toBeVisible()
  await page.unroute("**/api/v1/admin/plugins")
  const retry = rules.getByRole("button", { name: "重新读取奖励安装状态", exact: true }); await retry.focus(); await expect(retry).toBeFocused(); expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44); await retry.click()
  await expect(rules).toContainText(growth ? growth.status === "enabled" ? "已启用" : "已停用" : "未安装")
  await expect(rules).toContainText("UTC"); await expect(rules).toContainText("最多 13 EXP"); await expect(rules).toContainText("未开放内置执行器切换")
  await accessibility(page, "#membership-growth-workspace"); await capture(page, info, "growth-rules-light")
  await page.getByRole("button", { name: "切换为深色主题", exact: true }).click()
  await accessibility(page, "#membership-growth-workspace"); await capture(page, info, "growth-rules-dark"); expect(issues).toEqual([])
})

test("denies growth and installation administration to ordinary members", async ({ page }) => {
  await login(page.request, "demo_member")
  for (const path of [levelsPath, "/api/v1/admin/plugins"]) { const body = await payload(await page.request.get(path), 403); expect(body.data).toBeUndefined() }
  await page.goto("/#admin/membership")
  await expect(page.getByRole("region", { name: "成长奖励规则", exact: true })).not.toBeVisible()
  await expect(page.getByRole("button", { name: "新增等级", exact: true })).not.toBeVisible()
})
