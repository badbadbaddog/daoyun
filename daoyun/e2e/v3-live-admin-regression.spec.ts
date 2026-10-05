import { writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test"

test.use({ trace: "off", video: "off" })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(90000)
interface Group { id: string; internal_key: string; display_name: string; description: string; is_base: boolean; is_default: boolean; display_order: number; status: string; permission_keys: string[]; quotas: Record<string, number>; revision: number }
async function data<T>(response: APIResponse | Response, status = 200): Promise<T> {
  const body = await response.json()
  expect(response.status(), body.error?.code).toBe(status)
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body.data as T
}
async function login(page: Page) {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) {
    const url = new URL(process.env[name]!)
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
    if (name === "DATABASE_URL") expect(url.pathname).toMatch(/^\/daoyun_v3_[a-z0-9_]+$/)
  }
  const session = await data<{ csrf_token: string }>(await page.request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password: "DaoYunLocalOnly!2026" } }))
  return { "x-csrf-token": session.csrf_token }
}
async function groups(page: Page) { return data<Group[]>(await page.request.get("/api/v1/admin/community/groups")) }
async function openGroups(page: Page) {
  await page.goto("/#admin/membership")
  await page.reload()
  await page.getByRole("tab", { name: "用户组", exact: true }).click()
  await expect(page.getByRole("list", { name: "用户组列表" })).toBeVisible()
}

test("saves enabled pre-moderation rule combinations unchanged across separated editor sections", async ({ page }, info) => {
  expect(info.config.workers).toBe(1)
  const headers = await login(page)
  const source = (await groups(page)).find(group => group.is_default)!
  const evidence = []
  for (const permissionKeys of [["content.pre_moderation.required", "topic.create"], ["board.read", "content.pre_moderation.required", "reply.create", "topic.read"]]) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
    const before = await data<Group>(await page.request.post("/api/v1/admin/community/groups", { headers, data: {
      internal_key: "v3_review_" + suffix, display_name: "审核原值 " + suffix, description: "独立验收夹具", is_base: false,
      display_order: Math.max(...(await groups(page)).map(group => group.display_order)) + 10, status: "active", permission_keys: permissionKeys, quotas: { ...source.quotas, "content.external_link.daily": 0 },
    } }), 201)
    await openGroups(page)
    await page.getByRole("button", { name: "编辑" + before.display_name, exact: true }).click()
    const editor = page.getByRole("dialog", { name: "编辑用户组" })
    await editor.getByRole("button", { name: "审核要求", exact: true }).click()
    await expect(editor.getByRole("checkbox", { name: "发布内容需要审核" })).toBeChecked()
    await editor.getByRole("button", { name: "社区权限", exact: true }).click()
    await editor.getByRole("button", { name: "使用额度", exact: true }).click()
    await editor.getByRole("button", { name: "保存用户组", exact: true }).click()
    await expect(editor.getByText("没有配置变化。", { exact: true })).toBeVisible()
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/admin/community/groups/" + before.id && response.request().method() === "PATCH")
    await editor.getByRole("button", { name: "确认保存", exact: true }).click()
    const response = await saved
    const after = await data<Group>(response)
    expect(response.request().postDataJSON().permission_keys).toEqual(before.permission_keys)
    expect(after.permission_keys).toEqual(before.permission_keys)
    expect(after.quotas).toEqual(before.quotas)
    expect(after.revision).toBe(before.revision + 1)
    const stored = (await groups(page)).find(group => group.id === before.id)!
    expect(stored.permission_keys).toEqual(before.permission_keys)
    expect(stored.quotas).toEqual(before.quotas)
    evidence.push({ id: before.id, before: before.permission_keys, after: stored.permission_keys, revision: stored.revision })
  }
  await writeFile(info.outputPath("unchanged-review-rules.json"), JSON.stringify(evidence, null, 2), "utf8")
})

test("locates a missing group name with keyboard focus and associated text without sending a write", async ({ page }, info) => {
  await login(page)
  const before = await groups(page)
  const writes: string[] = []
  page.on("request", request => { if (/\/api\/v1\/admin\/community\/groups(?:\/|$)/.test(new URL(request.url()).pathname) && ["POST", "PATCH"].includes(request.method())) writes.push(request.method()) })
  await openGroups(page)
  const trigger = page.getByRole("button", { name: "创建用户组", exact: true })
  await trigger.click()
  const editor = page.getByRole("dialog", { name: "创建用户组" })
  await editor.getByRole("textbox", { name: "显示名称", exact: true }).fill("")
  await editor.getByRole("button", { name: "审核要求", exact: true }).click()
  await editor.getByRole("button", { name: "创建用户组", exact: true }).focus()
  await page.keyboard.press("Enter")
  const field = editor.getByRole("textbox", { name: "显示名称", exact: true })
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute("aria-invalid", "true")
  await expect(field).toHaveAccessibleDescription("请输入显示名称。")
  await expect(editor.getByText("请输入显示名称。", { exact: true })).toBeVisible()
  const axe = await new AxeBuilder({ page }).include(".community-group-editor").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
  expect(axe.violations).toEqual([])
  await page.screenshot({ path: info.outputPath("missing-name-keyboard.png") })
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  expect(writes).toEqual([])
  expect(await groups(page)).toEqual(before)
})

test("preserves an existing custom brand and dark preference through admin public navigation and reload", async ({ page }, info) => {
  expect(info.config.workers).toBe(1)
  const headers = await login(page)
  const original = await data<Record<string, unknown>>(await page.request.get("/api/v1/admin/site-branding"))
  const siteName = "V3 品牌 " + randomUUID().slice(0, 8)
  const custom = { ...original, site_name: siteName, navigation_links: [{ label: "验收导航", url: "https://example.test/acceptance" }], theme_preset: "default" }
  try {
    await data(await page.request.patch("/api/v1/admin/site-branding", { headers, data: custom }))
    await page.goto("/#admin/branding")
    await expect(page.getByLabel("站点名称", { exact: true })).toHaveValue(siteName)
    if (await page.getByRole("button", { name: "切换为深色主题", exact: true }).isVisible()) await page.getByRole("button", { name: "切换为深色主题", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await expect.poll(() => page.evaluate(() => localStorage.getItem("daoyun-theme"))).toBe("dark")
    await page.goto("/#admin/membership")
    await expect(page.getByRole("tab", { name: "用户组", exact: true })).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await page.getByRole("button", { name: "返回社区", exact: true }).click()
    await expect(page.locator(".wordmark__text")).toHaveText(siteName)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await page.reload()
    await expect(page.locator(".wordmark__text")).toHaveText(siteName)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.getByRole("navigation", { name: "站点导航", exact: true }).getByRole("link", { name: "验收导航", exact: true })).toHaveAttribute("href", "https://example.test/acceptance")
    expect(await data(await page.request.get("/api/v1/admin/site-branding"))).toEqual(custom)
    await page.goto("/#admin/branding")
    await page.reload()
    await expect(page.getByLabel("站点名称", { exact: true })).toHaveValue(siteName)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await page.screenshot({ path: info.outputPath("custom-brand-dark.png") })
    await writeFile(info.outputPath("brand-preference.json"), JSON.stringify({ siteName, theme: "dark", adminAndPublic: true, reloaded: true, configurationUnchanged: true }, null, 2), "utf8")
  } finally {
    await data(await page.request.patch("/api/v1/admin/site-branding", { headers, data: original }))
    expect(await data(await page.request.get("/api/v1/admin/site-branding"))).toEqual(original)
  }
})


test("retains old search queries and reply floor links through reload back forward and sharing", async ({ page }, info) => {
  const headers = await login(page)
  const marker = "V3旧链接" + randomUUID().replaceAll("-", "").slice(0, 12)
  const topic = await data<{ id: string }>(await page.request.post("/api/v1/topics", { headers: { ...headers, "idempotency-key": randomUUID() }, data: { title: marker, content: marker + " 阅读上下文" } }), 201)
  const reply = await data<{ id: string; floor_number: number }>(await page.request.post("/api/v1/topics/" + topic.id + "/replies", { headers: { ...headers, "idempotency-key": randomUUID() }, data: { content: marker + " 目标楼层" } }), 201)
  const searchHash = "#search?q=" + encodeURIComponent(marker) + "&type=topics&author=demo_admin&sort=latest"
  const topicHash = "#topic/" + topic.id
  const floorHash = topicHash + "?reply=" + reply.id
  const floor = page.getByRole("article", { name: "第 " + reply.floor_number + " 楼回复", exact: true })
  await page.goto("/" + searchHash)
  await expect(page.locator('a[href="' + topicHash + '"]').first()).toBeVisible()
  await page.locator('a[href="' + topicHash + '"]').first().click()
  await expect(page).toHaveURL(new RegExp("/t/" + topic.id + "$"))
  await page.evaluate(hash => { location.hash = hash }, floorHash)
  await expect(floor).toBeFocused()
  await page.reload()
  await expect(floor).toBeFocused()
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/t/" + topic.id + "?reply=" + reply.id)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp("/t/" + topic.id + "$"))
  await page.goBack()
  expect(new URL(page.url()).hash).toBe(searchHash)
  await expect(page.getByLabel("作者用户名")).toHaveValue("demo_admin")
  await expect(page.locator('a[href="' + topicHash + '"]').first()).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL(new RegExp("/t/" + topic.id + "$"))
  await page.goForward()
  await expect(floor).toBeFocused()
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/t/" + topic.id + "?reply=" + reply.id)
  const shared = await page.context().newPage()
  try {
    await shared.goto(page.url())
    await expect(shared.getByRole("article", { name: "第 " + reply.floor_number + " 楼回复", exact: true })).toBeFocused()
    await shared.goto("/" + topicHash + "?reply=" + randomUUID())
    await expect(shared.getByRole("status").filter({ hasText: "目标楼层不存在或当前无法查看" })).toBeVisible()
    await shared.goto("/#topic/" + randomUUID())
    await expect(shared.getByRole("heading", { name: "主题暂时无法加载", exact: true })).toBeVisible()
    await writeFile(info.outputPath("legacy-floor-links.json"), JSON.stringify({ topicHash, floorHash, searchHash, reload: true, back: true, forward: true, shared: true, missingReplyStatus: true, missingTopicStatus: true }, null, 2), "utf8")
  } finally { await shared.close() }
})

test("keeps old admin query links across reload back forward and a shared tab", async ({ page }, info) => {
  await login(page)
  const hash = "#admin/users?q=demo_admin&status=active"
  await page.goto("/" + hash)
  await expect(page.getByRole("searchbox", { name: "搜索用户", exact: true })).toHaveValue("demo_admin")
  await expect(page.getByLabel("用户状态", { exact: true })).toHaveValue("active")
  await page.reload()
  await expect(page.getByRole("searchbox", { name: "搜索用户", exact: true })).toHaveValue("demo_admin")
  expect(new URL(page.url()).hash).toBe(hash)
  await page.goto("/#admin/membership")
  await expect(page.getByRole("tab", { name: "用户组", exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole("searchbox", { name: "搜索用户", exact: true })).toHaveValue("demo_admin")
  expect(new URL(page.url()).hash).toBe(hash)
  await page.goForward()
  await expect(page.getByRole("tab", { name: "用户组", exact: true })).toBeVisible()
  const shared = await page.context().newPage()
  try {
    await shared.goto(process.env.DAOYUN_WEB_URL! + "/" + hash)
    await expect(shared.getByRole("searchbox", { name: "搜索用户", exact: true })).toHaveValue("demo_admin")
    await expect(shared.getByLabel("用户状态", { exact: true })).toHaveValue("active")
    await writeFile(info.outputPath("legacy-admin-query.json"), JSON.stringify({ hash, reload: true, back: true, forward: true, shared: true }, null, 2), "utf8")
  } finally { await shared.close() }
})
