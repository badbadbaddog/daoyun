import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { expect, test, type APIRequestContext, type APIResponse, type Response, type TestInfo } from "@playwright/test"

// https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/
// Virtual authenticator exercises Chromium's actual WebAuthn ceremony; physical devices are separate acceptance.
test.use({ trace: "off", video: "off", screenshot: "off" })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(90000)
const password = "DaoYunLocalOnly!2026"
async function data(response: APIResponse | Response, status = 200) {
  expect(response.status(), new URL(response.url()).pathname).toBe(status)
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body.data
}
async function account(request: APIRequestContext, info: TestInfo, index = 0, origin = process.env.DAOYUN_WEB_URL!) {
  expect(new URL(origin).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
  const names: string[] = JSON.parse(process.env.DAOYUN_GOVERNANCE_FIXTURE_USERS!)
  const username = names[index + (info.project.name.includes("mobile") ? 3 : 0)]
  expect(username).toMatch(/^v3_gov_[a-f0-9]{16}$/)
  return data(await request.post(origin + "/api/v1/auth/login", { data: { identifier: username, password } }))
}

test("registers signs in deletes and recovers from a revoked passkey through real WebAuthn", async ({ page }, info) => {
  const origin = "http://localhost:" + new URL(process.env.DAOYUN_WEB_URL!).port
  const session = await account(page.request, info, 0, origin)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } })
  try {
    await page.goto(origin + "/#user/" + session.user.username)
    await page.getByRole("button", { name: "通行密钥", exact: true }).click()
    const panel = page.locator(".passkeys-panel")
    await panel.getByLabel("当前密码", { exact: true }).fill(password)
    const originalCredentials = await data(await page.request.get(origin + "/api/v1/auth/passkeys"))
    const registered = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/auth/passkeys/registration/verify", { timeout: 15000 })
    await panel.getByRole("button", { name: "添加通行密钥", exact: true }).click()
    const newCredential = (await data(await registered, 201)).credential
    await expect(panel.getByRole("status")).toHaveText("通行密钥已添加。")
    const credentials = await data(await page.request.get(origin + "/api/v1/auth/passkeys"))
    expect(credentials).toHaveLength(originalCredentials.length + 1)
    expect(credentials.some((row: { id: string }) => row.id === newCredential.id)).toBe(true)
    const current = await data(await page.request.get(origin + "/api/v1/auth/session"))
    await data(await page.request.post(origin + "/api/v1/auth/logout", { headers: { "x-csrf-token": current.csrf_token } }))
    await page.reload()
    await page.getByRole("button", { name: "登录", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "登录刀云" })
    const asserted = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/auth/passkeys/assertion/verify")
    await dialog.getByRole("button", { name: "使用通行密钥登录" }).click()
    expect((await data(await asserted)).user.id).toBe(session.user.id)
    await expect(dialog).toHaveCount(0)
    await page.getByRole("button", { name: "通行密钥", exact: true }).click()
    await panel.getByLabel("当前密码", { exact: true }).fill(password)
    await panel.getByRole("button", { name: "删除", exact: true }).first().click()
    await expect(panel.getByRole("status")).toHaveText("通行密钥已删除。")
    expect((await data(await page.request.get(origin + "/api/v1/auth/passkeys"))).map((row: { id: string }) => row.id)).toEqual(originalCredentials.map((row: { id: string }) => row.id))
    const signedIn = await data(await page.request.get(origin + "/api/v1/auth/session"))
    await data(await page.request.post(origin + "/api/v1/auth/logout", { headers: { "x-csrf-token": signedIn.csrf_token } }))
    await page.reload()
    await page.getByRole("button", { name: "登录", exact: true }).first().click()
    const rejected = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/auth/passkeys/assertion/verify")
    await dialog.getByRole("button", { name: "使用通行密钥登录" }).click()
    expect((await rejected).ok()).toBe(false)
    await expect(dialog.getByRole("alert")).toBeVisible()
    expect((await page.request.get(origin + "/api/v1/auth/session")).status()).toBe(401)
    await dialog.getByRole("textbox", { name: "用户名或邮箱" }).fill(session.user.username)
    await dialog.getByLabel("密码", { exact: true }).fill(password)
    await dialog.getByRole("button", { name: "登录", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect((await data(await page.request.get(origin + "/api/v1/auth/session"))).user.id).toBe(session.user.id)
  } finally { await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined); await cdp.detach().catch(() => undefined) }
})

test("retains blocked old-conversation input and sends it once after unblocking", async ({ page, playwright }, info) => {
  const sender = await account(page.request, info, 1)
  const other = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  try {
    const recipient = await account(other, info, 2)
    const conversation = await data(await page.request.post("/api/v1/conversations", { headers: { "x-csrf-token": sender.csrf_token }, data: { recipient_id: recipient.user.id } }))
    const path = "/api/v1/conversations/" + conversation.id + "/messages"
    await data(await page.request.post(path, { headers: { "x-csrf-token": sender.csrf_token }, data: { content: "Before block" } }), 201)
    await page.goto("/#messages/" + conversation.id)
    const field = page.getByRole("textbox", { name: "消息正文" })
    const content = "Blocked input " + randomUUID()
    await field.fill(content)
    const blockPath = "/api/v1/users/" + sender.user.id + "/block"
    await data(await other.put(blockPath, { headers: { "x-csrf-token": recipient.csrf_token } }))
    const denied = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === path)
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    expect((await denied).status()).toBe(404)
    await expect(field).toHaveValue(content)
    await expect(page.locator(".messages-view").getByRole("alert")).toBeVisible()
    await data(await other.delete(blockPath, { headers: { "x-csrf-token": recipient.csrf_token } }))
    const accepted = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === path)
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await data(await accepted, 201)
    await expect(field).toHaveValue("")
    const messages = await data(await page.request.get(path))
    expect(messages.filter((row: { content: string }) => row.content === content)).toHaveLength(1)
  } finally { await other.dispose() }
})

test("keeps the latest global notification count after another tab reads all and an older response arrives", async ({ page }, info) => {
  const db = new URL(process.env.DATABASE_URL!)
  expect(db.hostname).toBe("127.0.0.1")
  expect(db.pathname).toMatch(/^\/daoyun_v3_[a-z0-9_]+$/)
  const fixtures = JSON.parse(await readFile(process.env.DAOYUN_NOTIFICATION_FIXTURES!, "utf8"))
  const fixture = fixtures[info.project.name + ":uses a global count of 54 after reading one of the first 20 of 55"]
  expect(fixture.username).toMatch(/^v3n[0-9a-f]{12}$/)
  const session = await data(await page.request.post("/api/v1/auth/login", { data: { identifier: fixture.username, password } }))
  expect(session.user.id).toBe(fixture.id)
  expect(fixture.id).toMatch(/^[0-9a-f-]{36}$/i)
  execFileSync(process.env.PSQL_BIN!, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", process.env.DATABASE_URL!], {
    input: "DELETE FROM notifications WHERE recipient_id='" + fixture.id + "' AND aggregate_key LIKE 'v3:%';INSERT INTO notifications(id,recipient_id,kind,target_type,target_id,aggregate_key) SELECT gen_random_uuid(),'" + fixture.id + "','follow','user','" + fixture.id + "','v3:tab-race:'||gen_random_uuid()::text FROM generate_series(1,2);",
    encoding: "utf8", windowsHide: true,
  })
  const other = await page.context().newPage()
  let armed = false
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let captured!: () => void
  const held = new Promise<void>(resolve => { captured = resolve })
  let delivered!: () => void
  const delivery = new Promise<void>(resolve => { delivered = resolve })
  let oldCount: number | undefined
  await page.route("**/api/v1/notifications/unread-count", async route => {
    if (!armed) { await route.continue(); return }
    armed = false
    const response = await route.fetch()
    oldCount = (await response.json()).data.unread_count
    captured()
    await gate
    try { await route.fulfill({ response }) } catch { /* Focus refresh may already have aborted this response. */ }
    finally { delivered() }
  })
  try {
    await page.goto("/#notifications")
    await expect(page.getByText("全站未读 2", { exact: true })).toBeVisible()
    await other.goto("/#notifications")
    await expect(other.getByText("全站未读 2", { exact: true })).toBeVisible()
    await page.bringToFront()
    await expect(page.getByText("全站未读 2", { exact: true })).toBeVisible()
    armed = true
    await page.getByRole("button", { name: "标记通知为已读", exact: true }).first().click()
    await held
    expect(oldCount).toBe(1)
    await other.bringToFront()
    await other.getByRole("button", { name: "全部标记为已读", exact: true }).click()
    await expect(other.getByText("全站未读 0", { exact: true })).toBeVisible()
    await page.bringToFront()
    // Headless Chromium does not consistently emit native window focus when selecting a tab.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(page.getByText("全站未读 0", { exact: true })).toBeVisible()
    release()
    await delivery
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.getByText("全站未读 0", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "查看通知", exact: true, includeHidden: true })).toHaveAttribute("aria-label", "查看通知")
    const count = await data(await page.request.get("/api/v1/notifications/unread-count"))
    expect(count.unread_count).toBe(0)
  } finally { release(); await page.unroute("**/api/v1/notifications/unread-count"); await other.close() }
})
