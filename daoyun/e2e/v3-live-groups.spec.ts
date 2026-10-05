import { readFile, writeFile } from "node:fs/promises"
import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10_000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
interface GroupFixture { username: string; operatorUsername: string; userId: string; privilegedRoleId: string; groups: { id: string; key: string; name: string }[] }
const pageErrors = new WeakMap<Page, string[]>()
async function fixture(info: TestInfo) {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) { const url = new URL(process.env[name]!); expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname); if (name === "DATABASE_URL") expect(url.pathname).toContain("v3") }
  return (JSON.parse(await readFile(process.env.DAOYUN_GROUP_FIXTURES!, "utf8")) as Record<string, GroupFixture>)[info.project.name]
}
async function login(request: APIRequestContext, username = "demo_admin") {
  const response = await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.meta.request_id).toBe(response.headers()["x-request-id"]); return payload.data.csrf_token as string
}
async function capture(page: Page, info: TestInfo, name: string) {
  const originalViewport = page.viewportSize()
  for (const width of [320, 390, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 900 }); await assertNoHorizontalOverflow(page); await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") }) }
  if (originalViewport) await page.setViewportSize(originalViewport)
  expect(pageErrors.get(page) ?? []).toEqual([])
}
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on("pageerror", error => errors.push(error.message)) })

test("finds same-name groups by stable identity and creates a group without typing an internal key", async ({ page }, info) => {
  const data = await fixture(info); await login(page.request); await page.goto("/#admin/membership")
  await page.getByRole("tab", { name: "用户组", exact: true }).click()
  await page.getByRole("searchbox", { name: "搜索用户组" }).fill(data.groups[0].name)
  const list = page.getByRole("list", { name: "用户组列表" }); await expect(list.getByRole("listitem")).toHaveCount(2)
  await capture(page, info, "same-name-groups")
  await list.getByRole("button", { name: "编辑" + data.groups[1].name + " · " + data.groups[1].id.slice(-8), exact: true }).click()
  const editor = page.getByRole("dialog", { name: "编辑用户组" }); await expect(editor.getByLabel("内部键")).toBeHidden()
  await editor.locator("summary", { hasText: "高级标识" }).click(); await expect(editor.getByLabel("内部键")).toHaveValue(data.groups[1].key)
  await expect(editor.getByLabel("内部键")).toHaveAttribute("readonly", ""); await editor.getByRole("button", { name: "取消", exact: true }).click()
  await page.getByRole("button", { name: "创建用户组", exact: true }).click()
  const create = page.getByRole("dialog", { name: "创建用户组" }); await expect(create.getByRole("textbox", { name: "显示名称" })).toBeFocused()
  await create.getByRole("textbox", { name: "显示名称" }).fill("V3 自动创建 " + data.username)
  await create.getByRole("button", { name: "创建用户组", exact: true }).click()
  const [saved] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/admin/community/groups") && response.request().method() === "POST"), create.getByRole("button", { name: "确认创建", exact: true }).click()])
  expect(saved.status()).toBe(201); const payload = await saved.json(); expect(payload.meta.request_id).toBe(saved.headers()["x-request-id"]); expect(payload.data.internal_key).toMatch(/^[a-z][a-z0-9_]{2,63}$/)
  await expect(create).toHaveCount(0); await writeFile(info.outputPath("created-group.json"), JSON.stringify({ id: payload.data.id, key: payload.data.internal_key }, null, 2), "utf8")
})

test("grants and revokes a timed community identity from the selected user without granting management roles", async ({ page, playwright }, info) => {
  const data = await fixture(info); const csrf = await login(page.request, data.operatorUsername); await page.goto("/#admin/users?q=" + data.username)
  await page.getByRole("button", { name: new RegExp("@" + data.username + "$") }).click()
  const drawer = page.getByRole("dialog", { name: "用户详情" }); await drawer.getByRole("tab", { name: "用户组", exact: true }).click()
  await expect(drawer.getByRole("searchbox", { name: "搜索需要绑定用户组的用户" })).toHaveCount(0)
  const groups = drawer.getByRole("combobox", { name: "加入用户组" }); await expect(groups).toBeEnabled()
  expect(await groups.locator("option").allTextContents()).toEqual(expect.not.arrayContaining(["管理员", "版主"]))
  await groups.selectOption(data.groups[0].id); await drawer.getByRole("combobox", { name: "授予期限" }).selectOption("7")
  await drawer.getByRole("textbox", { name: "加入原因" }).fill("V3 限时参与验证")
  const [granted] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/admin/community/memberships") && response.request().method() === "POST"), drawer.getByRole("button", { name: "确认加入用户组" }).click()])
  expect(granted.status()).toBe(200); const grant = await granted.json(); expect(grant.meta.request_id).toBe(granted.headers()["x-request-id"]); const membership = grant.data.membership
  expect(membership.user_id).toBe(data.userId); expect(membership.group.id).toBe(data.groups[0].id); expect(Date.parse(membership.ends_at) - Date.parse(membership.starts_at)).toBe(7 * 86400000)
  await expect(drawer.getByText("原因：V3 限时参与验证", { exact: true })).toBeVisible(); await capture(page, info, "timed-user-identity")
  const forbidden = await page.request.post("/api/v1/admin/authorization/assignments", { headers: { "x-csrf-token": csrf }, data: { username: data.username, role_id: data.privilegedRoleId, scope_id: null, scope_mode: "exact" } })
  expect(forbidden.status()).toBe(403); const denied = await forbidden.json(); expect(denied.meta.request_id).toBe(forbidden.headers()["x-request-id"])
  await drawer.getByRole("button", { name: "移出" + data.groups[0].name, exact: true }).click(); await drawer.getByRole("textbox", { name: "移出原因" }).fill("V3 验证结束")
  const [revoked] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/" + membership.id + "/revoke")), drawer.getByRole("button", { name: "确认移出" }).click()])
  expect(revoked.status()).toBe(200); const revoke = await revoked.json(); expect(revoke.data.membership.revision).toBe(2); expect(revoke.data.membership.revoked_at).toBeTruthy()
  const admin = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL }); await login(admin)
  const audit = await admin.get("/api/v1/admin/audit?user_id=" + data.userId); expect(audit.status()).toBe(200); const entries = (await audit.json()).data
  expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ action: "community.membership.grant", resource_id: membership.id, summary: expect.objectContaining({ reason: "V3 限时参与验证" }) }), expect.objectContaining({ action: "community.membership.revoke", resource_id: membership.id })]))
  await admin.dispose(); await writeFile(info.outputPath("timed-grant-evidence.json"), JSON.stringify({ membershipId: membership.id, startsAt: membership.starts_at, endsAt: membership.ends_at, revokedRevision: revoke.data.membership.revision, rejectedRoleStatus: forbidden.status() }, null, 2), "utf8")
})

test("expires a group permission using the server clock", async ({ page, playwright }, info) => {
  const data = await fixture(info); const csrf = await login(page.request)
  const subject = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL }); await login(subject, data.username)
  const permissions = async () => { const response = await subject.get("/api/v1/users/me/groups"); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.meta.request_id).toBe(response.headers()["x-request-id"]); return payload.data.access.permission_keys as string[] }
  expect(await permissions()).not.toContain("topic.lottery.join")
  const now = Date.now(); const response = await page.request.post("/api/v1/admin/community/memberships", { headers: { "x-csrf-token": csrf }, data: { user_id: data.userId, group_id: data.groups[0].id, membership_kind: "additional", source: "operator", source_reference_id: null, reason: "V3 服务端到期验证", starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + 3000).toISOString(), idempotency_key: "v3-expiry-" + now } })
  expect(response.status()).toBe(200); const granted = await response.json(); expect(granted.meta.request_id).toBe(response.headers()["x-request-id"])
  expect(await permissions()).toContain("topic.lottery.join")
  await expect.poll(permissions, { timeout: 8000, intervals: [250, 500] }).not.toContain("topic.lottery.join")
  await subject.dispose(); await writeFile(info.outputPath("server-expiry.json"), JSON.stringify({ membershipId: granted.data.membership.id, endsAt: granted.data.membership.ends_at, serverExpiresPermission: true }, null, 2), "utf8")
})
