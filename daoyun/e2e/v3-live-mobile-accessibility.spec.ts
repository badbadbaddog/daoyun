import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Locator, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", screenshot: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(120000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  for (const key of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) {
    const url = new URL(process.env[key]!)
    expect(url.hostname).toBe("127.0.0.1")
    if (key === "DATABASE_URL") expect(url.pathname).toContain("v3")
  }
  const found: string[] = []; errors.set(page, found)
  page.on("pageerror", error => found.push(error.message))
})
async function payload(response: APIResponse, status = 200) {
  expect(response.status(), new URL(response.url()).pathname).toBe(status)
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body
}
async function login(request: APIRequestContext) {
  return (await payload(await request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password: "DaoYunLocalOnly!2026" } }))).data.csrf_token as string
}
function quotaSha() {
  const value = execFileSync(process.env.PSQL_BIN!, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-d", process.env.DATABASE_URL!], {
    input: "SELECT COALESCE(json_agg(to_jsonb(q) ORDER BY user_id,quota_key,window_start),'[]'::json)::text FROM community_quota_usage q;",
    encoding: "utf8", windowsHide: true, env: { ...process.env, PGCLIENTENCODING: "UTF8" },
  }).trim()
  return createHash("sha256").update(value).digest("hex")
}
async function axe(page: Page, selector: string) {
  expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
}
async function capture(page: Page, info: TestInfo, name: string, selector: string) {
  const before = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    if (width === 320 || width === 1440) await axe(page, selector)
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
  if (before) await page.setViewportSize(before)
  expect(errors.get(page)).toEqual([])
}
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible()
  for (let step = 0; step < 120; step++) {
    if (await target.evaluate(element => element === document.activeElement)) return
    await page.keyboard.press("Tab")
  }
  throw new Error("Keyboard could not reach " + await target.textContent())
}
async function selectWithKeys(page: Page, select: Locator, value: string) {
  await expect(select).toBeFocused()
  const index = await select.evaluate((element, chosen) => [...(element as HTMLSelectElement).options].findIndex(option => option.value === chosen), value)
  expect(index).toBeGreaterThanOrEqual(0)
  await page.keyboard.press("Home")
  for (let step = 0; step < index; step++) await page.keyboard.press("ArrowDown")
  await expect(select).toHaveValue(value)
}

test("uses a single mobile permission scenario and reads sources without consuming quota", async ({ page }, info) => {
  await login(page.request)
  const boards = (await payload(await page.request.get("/api/v1/admin/boards"))).data as { id: string; name: string; visibility: string; status: string }[]
  const board = boards.find(board => board.visibility === "public" && board.status === "open")!
  const catalog = (await payload(await page.request.get("/api/v1/admin/community/groups"))).data as { id: string; display_name: string; status: string }[]
  const groups = catalog.filter(group => group.status === "active").slice(0,2)
  expect(groups).toHaveLength(2)
  const before = quotaSha(); let requests = 0
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/v1/admin/boards/" + board.id + "/permission-matrix") requests++ })
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto("/#admin/boards?board_id=" + board.id)
  const editor = page.getByRole("dialog", { name: "编辑“" + board.name + "”" })
  await editor.getByRole("button", { name: "有效权限", exact: true }).click()
  for (const group of groups) await editor.locator(".admin-permission-matrix__groups label").filter({ hasText: group.id.slice(-8) }).getByRole("checkbox").check()
  const selector = editor.getByRole("combobox", { name: "查看权限场景" })
  await expect(selector).toHaveCount(1)
  await expect(editor.locator("td[data-scenario-selected=true]")).toHaveCount(5)
  const count = requests
  await selector.selectOption("group:" + groups[1].id)
  const source = editor.getByRole("button", { name: groups[1].display_name + " " + groups[1].id.slice(-8) + " 主题附件上传 来源", exact: true })
  await expect(source).toBeVisible()
  await expect(editor.getByRole("button", { name: groups[0].display_name + " " + groups[0].id.slice(-8) + " 主题附件上传 来源", exact: true })).toBeHidden()
  expect(requests).toBe(count)
  const dimensions = await editor.getByRole("region", { name: "有效权限结果" }).evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }))
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1)
  await source.scrollIntoViewIfNeeded()
  await capture(page, info, "single-scenario", ".admin-permission-matrix")
  await source.click()
  const detail = page.getByRole("dialog", { name: groups[1].display_name + " · 主题附件上传来源" })
  await expect(detail.getByRole("heading")).toBeFocused()
  await capture(page, info, "scenario-source", ".admin-permission-source")
  await page.keyboard.press("Escape"); await expect(source).toBeFocused()
  const after = quotaSha(); expect(after).toBe(before)
  await writeFile(info.outputPath("matrix-evidence.json"), JSON.stringify({ boardId: board.id, groupIds: groups.map(group => group.id), requestsBeforeChoice: count, requestsAfterChoice: requests, dimensions, quotaBeforeSha256: before, quotaAfterSha256: after, singleScenarioAt390: true }, null, 2), "utf8")
})

test("completes and cancels appointments with keyboard and restores both trigger levels", async ({ page, playwright }, info) => {
  const nonce = randomUUID().replaceAll("-", "").slice(0,16), username = "v3_key_" + nonce
  const registering = await playwright.request.newContext({ baseURL: process.env.DAOYUN_API_URL })
  await payload(await registering.post("/api/v1/auth/register", { data: { username, email: username + "@example.test", display_name: "键盘验收成员", password: "DaoYunLocalOnly!2026" } }), 201)
  await registering.dispose()
  const csrf = await login(page.request)
  const boards = (await payload(await page.request.get("/api/v1/admin/boards"))).data as { id: string; name: string; visibility: string; status: string }[]
  const board = boards.find(board => board.visibility === "public" && board.status === "open")!
  const role = (await payload(await page.request.post("/api/v1/admin/authorization/roles", { headers: { "x-csrf-token": csrf }, data: { key: "v3_keyboard_" + nonce, name: "键盘任命 " + nonce, scope: "board", permission_keys: ["moderation.topic"] } }), 201)).data
  let assignmentId: string | undefined; const writes: { status: number; requestId: string }[] = []
  page.on("response", response => { if (response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/admin/authorization/assignments") writes.push({ status: response.status(), requestId: response.headers()["x-request-id"] }) })
  try {
    await page.goto("/#admin/authorization?view=assignments")
    const trigger = page.getByRole("button", { name: "新增授权", exact: true })
    async function preview() {
      await tabTo(page, trigger); await page.keyboard.press("Enter")
      const dialog = page.getByRole("dialog", { name: "分配角色" })
      await expect(dialog.getByRole("button", { name: "关闭分配角色" })).toBeFocused()
      await page.keyboard.press("Tab"); await expect(dialog.getByRole("searchbox", { name: "搜索用户", exact: true })).toBeFocused()
      await page.keyboard.type(username)
      const person = dialog.getByRole("button", { name: "选择键盘验收成员 @" + username, exact: true })
      await expect(person).toBeVisible(); await page.keyboard.press("Tab"); await expect(person).toBeFocused(); await page.keyboard.press("Enter")
      await page.keyboard.press("Tab"); await selectWithKeys(page, dialog.getByRole("combobox", { name: "自定义角色", exact: true }), role.id)
      await page.keyboard.press("Tab"); await selectWithKeys(page, dialog.getByRole("combobox", { name: "作用板块", exact: true }), board.id)
      await page.keyboard.press("Tab"); await selectWithKeys(page, dialog.getByRole("combobox", { name: "包含子版块", exact: true }), "subtree")
      await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "预览任命", exact: true })).toBeFocused(); await page.keyboard.press("Enter")
      const confirm = page.getByRole("alertdialog", { name: "确认任命管理人员" })
      await expect(confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused()
      return { dialog, confirm }
    }
    let flow = await preview()
    await page.keyboard.press("Tab"); await expect(flow.confirm.getByRole("button", { name: "确认任命", exact: true })).toBeFocused()
    await page.keyboard.press("Tab"); await expect(flow.confirm.getByRole("list", { name: "任命能力清单" })).toBeFocused()
    await page.keyboard.press("Tab"); await expect(flow.confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused()
    await capture(page, info, "keyboard-preview", ".confirm-dialog")
    await page.keyboard.press("Escape"); await expect(flow.dialog.getByRole("button", { name: "预览任命", exact: true })).toBeFocused()
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); expect(writes).toEqual([])
    flow = await preview(); await page.keyboard.press("Tab"); await page.keyboard.press("Enter")
    await expect(page.getByText("角色已分配", { exact: true })).toBeVisible(); await expect(trigger).toBeFocused()
    const assigned = (await payload(await page.request.get("/api/v1/admin/authorization/assignments?username=" + username))).data as { id: string; role: { id: string }; scope_id: string; scope_mode: string }[]
    const exact = assigned.find(item => item.role.id === role.id)!
    expect(exact).toMatchObject({ scope_id: board.id, scope_mode: "subtree" }); assignmentId = exact.id
    expect(writes).toHaveLength(1); expect(writes[0].status).toBe(201)
    await capture(page, info, "keyboard-appointed", ".authorization-admin-panel")
    await page.keyboard.press("Enter"); await expect(page.getByRole("dialog", { name: "分配角色" })).toBeVisible()
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused()
    await writeFile(info.outputPath("keyboard-evidence.json"), JSON.stringify({ username, roleId: role.id, boardId: board.id, assignmentId, scopeMode: "subtree", cancelledWrites: 0, writes, keyboardOnlyInteractions: true, outerAndInnerFocusRestored: true }, null, 2), "utf8")
  } finally {
    const assigned = (await payload(await page.request.get("/api/v1/admin/authorization/assignments?username=" + username))).data as { id: string; role: { id: string } }[]
    for (const item of assigned.filter(item => item.role.id === role.id)) await payload(await page.request.delete("/api/v1/admin/authorization/assignments/" + item.id, { headers: { "x-csrf-token": csrf } }))
  }
})

test("associates hidden field errors at zoom-equivalent 200 percent and cancels without a write", async ({ page }, info) => {
  await login(page.request)
  const groups = (await payload(await page.request.get("/api/v1/admin/community/groups"))).data as { id: string; display_name: string; is_default: boolean }[]
  const group = groups.find(group => group.is_default)!
  const name = groups.filter(item => item.display_name === group.display_name).length > 1 ? group.display_name + " · " + group.id.slice(-8) : group.display_name
  const original = groups.find(item => item.id === group.id)
  const writes: string[] = []
  page.on("request", request => { if (/\/api\/v1\/admin\/community\/groups(?:\/|$)/.test(new URL(request.url()).pathname) && ["POST", "PATCH"].includes(request.method())) writes.push(request.method()) })
  await page.goto("/#admin/membership"); await page.getByRole("tab", { name: "用户组", exact: true }).click()
  const trigger = page.getByRole("button", { name: "编辑" + name, exact: true }); await trigger.click()
  const editor = page.getByRole("dialog", { name: "编辑用户组" })
  await editor.getByRole("button", { name: "使用额度", exact: true }).click()
  await editor.getByRole("spinbutton", { name: "每日主题数" }).fill("1000001")
  await editor.getByRole("button", { name: "基本信息", exact: true }).click()
  await editor.getByRole("button", { name: "保存用户组", exact: true }).click()
  const field = editor.getByRole("spinbutton", { name: "每日主题数" })
  await expect(field).toBeFocused(); await expect(field).toHaveAttribute("aria-invalid", "true")
  await expect(field).toHaveAccessibleDescription(/不能超过/)
  await capture(page, info, "field-error-located", ".community-group-editor")
  const before = page.viewportSize()!
  await page.setViewportSize({ width: 720, height: 450 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 720, height: 450, deviceScaleFactor: 2, mobile: false })
  await field.scrollIntoViewIfNeeded(); await expect(field).toBeInViewport({ ratio: 1 }); await expect(field).toHaveAccessibleDescription(/不能超过/)
  await assertNoHorizontalOverflow(page); await axe(page, ".community-group-editor")
  const zoom = await page.evaluate(() => ({ layoutWidth: innerWidth, layoutHeight: innerHeight, pixelRatio: devicePixelRatio }))
  expect(zoom).toEqual({ layoutWidth: 720, layoutHeight: 450, pixelRatio: 2 })
  await page.screenshot({ path: info.outputPath("zoom-equivalent-200.png") })
  await cdp.send("Emulation.clearDeviceMetricsOverride"); await cdp.detach(); await page.setViewportSize(before)
  await page.emulateMedia({ reducedMotion: "reduce" })
  expect(await field.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.00002)
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); expect(writes).toEqual([])
  const after = (await payload(await page.request.get("/api/v1/admin/community/groups"))).data.find((item: { id: string }) => item.id === group.id)
  expect(after).toEqual(original)
  await writeFile(info.outputPath("error-zoom-evidence.json"), JSON.stringify({ groupId: group.id, originalPreserved: true, writes, field: "topic.create.daily", errorAssociated: true, focusLocated: true, zoom, zoomMethod: "720x450 CSS layout at pixel scale 2, equivalent to 200% on 1440x900", actualBrowserChromeZoom: "NOT_RUN", physicalKeyboard: "NOT_RUN", reducedMotion: true }, null, 2), "utf8")
})
