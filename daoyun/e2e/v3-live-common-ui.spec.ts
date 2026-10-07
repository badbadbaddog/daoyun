import { readFile, writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10_000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
const errors = new WeakMap<Page, string[]>()
async function login(page: Page) {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) {
    const url = new URL(process.env[name] ?? "")
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
    if (name === "DATABASE_URL") expect(url.pathname).toContain("v3")
  }
  const issues: string[] = []; errors.set(page, issues); page.on("pageerror", error => issues.push(error.message))
  const response = await page.request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password: "DaoYunLocalOnly!2026" } })
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.meta.request_id).toBe(response.headers()["x-request-id"])
}
async function snapshot(page: Page, info: TestInfo, name: string) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
  expect(errors.get(page)).toEqual([])
}
const modules = [
  ["dashboard", "工作台"], ["users", "用户管理"], ["boards", "版块管理"], ["reports", "举报处理"],
  ["moderation", "主题管理"], ["comments", "评论管理"], ["reviews", "内容审核"], ["risk", "风控告警"],
  ["membership", "会员体系"], ["branding", "品牌配置"], ["email", "邮件服务"], ["authorization", "角色与权限"],
  ["analytics", "数据总览"], ["operations", "运维监控"], ["plugins", "插件管理"],
] as const

test("keeps all fifteen original admin routes in the seven V3 groups", async ({ page }, info) => {
  test.setTimeout(60_000)
  await login(page)
  const routes: string[] = []
  for (const [tab, label] of modules) {
    await page.goto("/#admin/" + tab)
    const nav = page.getByRole("navigation", { name: "站点管理导航", includeHidden: true })
    await expect(nav.getByRole("button", { name: label, exact: true, includeHidden: true })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("combobox", { name: "管理模块", exact: true, includeHidden: true })).toHaveValue(tab)
    await expect(page.getByText("当前账号没有站点管理权限", { exact: true })).toHaveCount(0)
    await assertNoHorizontalOverflow(page)
    routes.push(tab)
  }
  expect(await page.locator(".system-admin-nav__group").evaluateAll(groups => groups.map(group => group.getAttribute("aria-label")))).toEqual(["工作台", "内容治理", "版块管理", "用户与会员", "权限与治理", "扩展与数据", "站点设置"])
  await writeFile(info.outputPath("legacy-route-map.json"), JSON.stringify({ routes, pageErrors: errors.get(page) }, null, 2), "utf8")
  await snapshot(page, info, "shared-admin-shell")
})

test("uses the light semantic palette and reachable 44px common actions at narrow widths", async ({ page }, info) => {
  await login(page); await page.goto("/#admin/dashboard")
  await expect(page.getByRole("heading", { name: "工作台", exact: true })).toBeVisible()
  const palette = await page.evaluate(() => { const style = getComputedStyle(document.documentElement); return Object.fromEntries(["--brand", "--text", "--background", "--radius"].map(token => [token, style.getPropertyValue(token).trim().toLowerCase()])) })
  expect(palette).toEqual({ "--brand": "#2563eb", "--text": "#18243b", "--background": "#f5f7fb", "--radius": "8px" })
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await assertNoHorizontalOverflow(page)
    for (const selector of [".system-admin-back", ".system-admin-theme", width <= 900 ? ".system-admin-mobile-nav select" : ".system-admin-collapse"]) {
      const element = page.locator(selector)
      await expect(element).toBeVisible()
      const box = await element.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  }
  await snapshot(page, info, "light-common-actions")
})

test("traps keyboard focus inside the drawer and restores its source button", async ({ page }, info) => {
  await login(page)
  const fixtures = JSON.parse(await readFile(process.env.DAOYUN_SUMMARY_FIXTURES!, "utf8")) as Record<string, { username: string }>
  const username = fixtures[info.project.name].username
  await page.goto("/#admin/users?q=" + username)
  const trigger = page.getByRole("button", { name: new RegExp("@" + username + "$"), exact: false })
  await expect(trigger).toBeVisible(); await trigger.focus(); await page.keyboard.press("Enter")
  const drawer = page.getByRole("dialog", { name: "用户详情" })
  await expect(drawer).toBeVisible()
  await expect(page.getByRole("button", { name: "关闭抽屉" })).toBeFocused()
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press(index % 2 ? "Shift+Tab" : "Tab")
    expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  await snapshot(page, info, "keyboard-drawer")
  await page.keyboard.press("Escape")
  await expect(drawer).toHaveCount(0); await expect(trigger).toBeFocused()
  expect(errors.get(page)).toEqual([])
})

test("keeps membership headings and public admin forms accessible", async ({ page }, info) => {
  test.setTimeout(60_000)
  await login(page)
  for (const tab of ["membership", "boards", "authorization"]) {
    await page.goto("/#admin/" + tab)
    await expect(page.getByRole("combobox", { name: "管理模块", exact: true, includeHidden: true })).toHaveValue(tab)
    if (tab === "membership") await expect(page.getByRole("button", { name: "新增等级" })).toBeVisible()
    if (tab === "boards") await expect(page.getByRole("button", { name: "新建顶级版块" })).toBeVisible()
    if (tab === "authorization") await expect(page.getByRole("button", { name: "新建角色" })).toBeVisible()
    const result = await new AxeBuilder({ page }).include(".admin-view").analyze()
    await writeFile(info.outputPath(tab + "-accessibility.json"), JSON.stringify(result.violations, null, 2), "utf8")
    expect(result.violations).toEqual([])
  }
  expect(errors.get(page)).toEqual([])
})

test("preserves the user group description editing height", async ({ page }, info) => {
  await login(page); await page.goto("/#admin/membership")
  await page.getByRole("tab", { name: "用户组", exact: true }).click()
  await page.getByRole("button", { name: "创建用户组", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "创建用户组" })
  await expect(dialog).toBeVisible()
  const description = dialog.getByRole("textbox", { name: "用户组说明" })
  expect(await description.evaluate(element => parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThanOrEqual(80)
  await snapshot(page, info, "group-description-height")
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
