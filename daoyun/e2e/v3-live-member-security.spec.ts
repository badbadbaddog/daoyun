import { execFileSync } from "node:child_process"
import { createHmac, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", screenshot: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(120000)
const password = "DaoYunLocalOnly!2026"
const artifact = process.env.DAOYUN_MEMBER_ARTIFACT!
const issues = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL"]) expect(new URL(process.env[name]!).hostname).toBe("127.0.0.1")
  const errors: string[] = []
  issues.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
})
async function data(response: APIResponse, expected = 200) {
  expect(response.status(), new URL(response.url()).pathname + " status").toBe(expected)
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body.data
}
async function registryData() {
  return JSON.parse(await readFile(artifact + "/fixture-registry.json", "utf8").catch(() => "{}"))
}
async function createFixture(request: APIRequestContext) {
  const username = "v3_sec_" + randomUUID().replaceAll("-", "").slice(0, 16)
  return data(await request.post("/api/v1/auth/register", { data: { username, email: username + "@example.test", display_name: "安全验证成员", password } }), 201)
}
async function fixtureSession(request: APIRequestContext, info: TestInfo, kind: "profile" | "draft") {
  const registry = await registryData()
  const key = info.project.name.includes("mobile") ? "mobile" : "desktop"
  const account = registry[key] ?? (registry[key] = {})
  const username = kind === "profile" ? account.profileUsername : account.draftUsername
  if (username) return login(request, username)
  const session = await createFixture(request)
  account.profileUsername ??= session.user.username
  account.draftUsername ??= session.user.username
  await mkdir(artifact, { recursive: true })
  await writeFile(artifact + "/fixture-registry.json", JSON.stringify(registry), "utf8")
  return session
}
async function login(request: APIRequestContext, username: string) {
  return data(await request.post("/api/v1/auth/login", { data: { identifier: username, password } }))
}
async function submitLogin(page: Page, username: string, expected = 200) {
  const dialog = page.getByRole("dialog", { name: "登录刀云" })
  await dialog.getByRole("textbox", { name: "用户名或邮箱" }).fill(username)
  await dialog.getByLabel("密码", { exact: true }).fill(password)
  const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/auth/login")
  await dialog.getByRole("button", { name: "登录", exact: true }).click()
  expect((await response).status()).toBe(expected)
  return dialog
}
async function capture(page: Page, info: TestInfo, name: string, selector: string) {
  expect(issues.get(page)).toEqual([])
  const original = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    if (width === 320 || width === 1440) expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([])
    await page.locator(selector).first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
  if (original) await page.setViewportSize(original)
}
function sql(query: string) {
  const url = new URL(process.env.DATABASE_URL!)
  expect(url.hostname).toBe("127.0.0.1")
  expect(url.pathname).toContain("v3")
  return execFileSync(process.env.PSQL_BIN!, ["-X","-q","-v","ON_ERROR_STOP=1","-At","-d",process.env.DATABASE_URL!], { input: query, encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" }, windowsHide: true }).trim()
}
// RFC 6238 https://www.rfc-editor.org/rfc/rfc6238.html; same SHA1/6-digit/30-second parameters as the API.
function totp(base32: string, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const bits = [...base32.replaceAll("=", "")].map(char => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("")
  const bytes = bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)))
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0")
}

test("loads the light overview and independently recovers benefits without blocking growth", async ({ page }, info) => {
  const users: string[] = JSON.parse(process.env.DAOYUN_GOVERNANCE_FIXTURE_USERS!)
  const username = users[info.project.name.includes("mobile") ? 4 : 1]
  await login(page.request, username)
  const actual = await data(await page.request.get("/api/v1/users/" + username + "/membership-summary"))
  const requested: string[] = []
  page.on("request", request => { if (request.method() === "GET") requested.push(new URL(request.url()).pathname) })
  await page.goto("/#member")
  const member = page.locator(".member-center")
  await expect(member.getByRole("region", { name: "我的成长概览" })).toBeVisible()
  await expect(member.getByLabel("公开勋章")).toBeVisible()
  expect(await member.locator(".medals-list li").count()).toBe(actual.medals.length)
  for (const path of ["/api/v1/users/me/membership", "/api/v1/users/me/groups", "/api/v1/users/me/entitlements", "/api/v1/users/me/points/ledger"]) expect(requested).not.toContain(path)
  await capture(page, info, "overview", ".member-center")
  let failure: 500 | 403 | null = 500
  let benefitCalls = 0
  await page.route("**/api/v1/users/me/entitlements", async route => {
    benefitCalls++
    const actualResponse = await route.fetch()
    expect(actualResponse.status()).toBe(200)
    if (failure) await route.fulfill({ status: failure, contentType: "application/json", body: JSON.stringify({ error: { code: failure === 403 ? "auth.forbidden" : "database.unavailable", message: "Injected service failure" }, meta: { request_id: actualResponse.headers()["x-request-id"] } }) })
    else await route.fulfill({ response: actualResponse })
  })
  await member.getByRole("button", { name: "权益", exact: true }).click()
  await expect(member.getByRole("alert")).toContainText("会员信息暂时不可用")
  await capture(page, info, "benefits-failed", ".member-center")
  const failedCalls = benefitCalls
  await member.getByRole("button", { name: "成长", exact: true }).click()
  await expect(member.getByRole("region", { name: "成长等级", exact: true })).toBeVisible()
  expect(benefitCalls).toBe(failedCalls)
  await member.getByRole("button", { name: "权益", exact: true }).click()
  await expect(member.getByRole("alert")).toBeVisible()
  failure = 403
  await member.getByRole("button", { name: "重试", exact: true }).click()
  await expect(member.getByRole("alert")).toContainText("当前账号无权查看")
  await expect(member.getByText("当前没有生效中的标准权益")).toHaveCount(0)
  await capture(page, info, "benefits-forbidden", ".member-center")
  failure = null
  await member.getByRole("button", { name: "重试", exact: true }).click()
  await expect(member.getByRole("heading", { name: "标准权益", exact: true })).toBeVisible()
  await expect(member.getByRole("alert")).toHaveCount(0)
  await capture(page, info, "benefits-recovered", ".member-center")
  await writeFile(info.outputPath("member-evidence.json"), JSON.stringify({ username, actualMedals: actual.medals.length, requested, benefitCalls, faults: "Injected after a real authorized 200; no database outage or permission change" }, null, 2), "utf8")
})

test("keeps unsaved profile fields after a revoked session and original-account reauthentication", async ({ page, playwright }, info) => {
  const session = await fixtureSession(page.request, info, "profile")
  const username = session.user.username
  await page.goto("/#user/" + username)
  await page.getByRole("button", { name: "编辑资料", exact: true }).click()
  const form = page.getByRole("form", { name: "编辑公开资料" })
  const marker = "保留资料_" + randomUUID().slice(0, 8)
  const fields = [["显示名称", marker], ["简介", marker + "简介"], ["所在地", "本地测试"], ["个人网站", "https://example.test/profile"], ["头像 HTTPS 地址", ""]]
  for (const [label, value] of fields) await form.getByRole("textbox", { name: label }).fill(value)
  const initial = await data(await page.request.get("/api/v1/users/" + username))
  const sessions = await data(await page.request.get("/api/v1/auth/sessions"))
  const old = sessions.find((row: any) => row.is_current)
  const other = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  try {
    const remote = await login(other, username)
    expect((await data(await other.delete("/api/v1/auth/sessions/" + old.id, { headers: { "x-csrf-token": remote.csrf_token } }))).revoked).toBe(true)
    const denied = page.waitForResponse(r => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/users/me")
    await form.getByRole("button", { name: "保存资料" }).click()
    const response = await denied
    expect(response.status()).toBe(401)
    expect((await response.json()).error.code).toBe("auth.unauthenticated")
    await expect(form.getByRole("button", { name: "重新登录后保存" })).toBeVisible()
    for (const [label, value] of fields) await expect(form.getByRole("textbox", { name: label })).toHaveValue(value)
    await expect(form.getByRole("button", { name: "保存资料" })).toBeDisabled()
    await capture(page, info, "profile-expired", ".profile-edit-form")
    await form.getByRole("button", { name: "重新登录后保存" }).click()
    await expect(page.getByRole("dialog", { name: "登录刀云" })).toBeVisible()
    await page.getByRole("button", { name: "关闭身份窗口" }).click()
    await expect(form.getByRole("textbox", { name: "简介" })).toHaveValue(marker + "简介")
    await form.getByRole("button", { name: "重新登录后保存" }).click()
    await submitLogin(page, username)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(form.getByRole("button", { name: "保存资料" })).toBeEnabled()
    for (const [label, value] of fields) await expect(form.getByRole("textbox", { name: label })).toHaveValue(value)
    const saved = page.waitForResponse(r => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/users/me")
    await form.getByRole("button", { name: "保存资料" }).click()
    const accepted = await saved
    expect(accepted.status()).toBe(200)
    expect(accepted.request().postDataJSON().base_revision).toBe(initial.profile_revision)
    const profile = await data(await page.request.get("/api/v1/users/" + username))
    expect(profile).toMatchObject({ display_name: marker, bio: marker + "简介", location: "本地测试", website_url: "https://example.test/profile" })
    await expect(page.getByRole("heading", { name: marker, exact: true })).toBeVisible()
    await expect(form).toHaveCount(0)
    await page.getByRole("button", { name: "多因素认证", exact: true }).click()
    await expect(page.getByText("尚未启用", { exact: true })).toBeVisible()
    await capture(page, info, "security-unconfigured-account", "#profile-mfa-panel")
    await page.getByRole("button", { name: "关闭多因素认证设置", exact: true }).click()
    let failSecurity = true
    await page.route("**/api/v1/auth/mfa", async route => {
      const real = await route.fetch()
      expect(real.status()).toBe(200)
      if (failSecurity) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "database.unavailable", message: "Injected status failure" }, meta: { request_id: real.headers()["x-request-id"] } }) })
      else await route.fulfill({ response: real })
    })
    await page.getByRole("button", { name: "多因素认证", exact: true }).click()
    const security = page.locator("#profile-mfa-panel")
    await expect(security.getByRole("alert")).toContainText("无法读取多因素认证状态")
    await expect(security.getByRole("button", { name: "开始设置 TOTP" })).toHaveCount(0)
    await capture(page, info, "security-status-failed", "#profile-mfa-panel")
    failSecurity = false
    await security.getByRole("button", { name: "重试安全状态", exact: true }).click()
    await expect(security.getByText("尚未启用", { exact: true })).toBeVisible()
    await capture(page, info, "security-status-recovered", "#profile-mfa-panel")
    await page.getByRole("button", { name: "关闭多因素认证设置", exact: true }).click()
    await page.getByRole("button", { name: "管理设备会话", exact: true }).click()
    await expect(page.getByRole("heading", { name: "设备会话", exact: true })).toBeVisible()
    await capture(page, info, "profile-recovered", ".profile-view")
    await writeFile(info.outputPath("profile-evidence.json"), JSON.stringify({ username, userId: session.user.id, revokedSessionId: old.id, originalRevision: initial.profile_revision, savedRevision: profile.profile_revision, preservedFields: fields.map(([label]) => label), recovery: "cancel then original-account login" }, null, 2), "utf8")
  } finally { await other.dispose() }
})

test("retains TOTP challenge verification and the single-use recovery-code path", async ({ page, playwright }, info) => {
  expect(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59000)).toBe("287082")
  const registry = await registryData()
  const key = info.project.name.includes("mobile") ? "mobile" : "desktop"
  const account = registry[key] ?? (registry[key] = {})
  if (!account.mfaFile) {
    const initial = await createFixture(page.request)
    const headers = { "x-csrf-token": initial.csrf_token }
    await data(await page.request.post("/api/v1/auth/recent-auth", { headers, data: { password, operation: "security.settings" } }))
    const setup = await data(await page.request.post("/api/v1/auth/mfa/totp/setup", { headers }))
    await mkdir(artifact + "/private", { recursive: true })
    account.mfaFile = artifact + "/private/mfa-" + initial.user.id + ".json"
    const fresh = { username: initial.user.username, userId: initial.user.id, secretBase32: setup.secret_base32, recoveryCodes: [] as string[], usedRecoveryIndices: [] as number[] }
    await writeFile(account.mfaFile, JSON.stringify(fresh), "utf8")
    const enabled = await data(await page.request.post("/api/v1/auth/mfa/totp/enable", { headers, data: { code: totp(setup.secret_base32, Date.now() - 30000) } }))
    fresh.recoveryCodes = enabled.recovery_codes
    await writeFile(account.mfaFile, JSON.stringify(fresh), "utf8")
    await writeFile(artifact + "/fixture-registry.json", JSON.stringify(registry), "utf8")
    await data(await page.request.post("/api/v1/auth/logout", { headers: { "x-csrf-token": enabled.csrf_token } }))
  }
  const fixturePath = account.mfaFile
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"))
  const username = fixture.username
  const used: number[] = fixture.usedRecoveryIndices ?? [0]
  const initialIndex = fixture.recoveryCodes.findIndex((_: string, i: number) => !used.includes(i))
  expect(initialIndex).toBeGreaterThanOrEqual(0)
  const pending = await data(await page.request.post("/api/v1/auth/login", { data: { identifier: username, password } }), 202)
  const session = await data(await page.request.post("/api/v1/auth/mfa/verify", { data: { challenge_id: pending.challenge_id, code: fixture.recoveryCodes[initialIndex] } }))
  used.push(initialIndex)
  fixture.usedRecoveryIndices = used
  await writeFile(fixturePath, JSON.stringify(fixture), "utf8")
  const setup = { secret_base32: fixture.secretBase32 }
  const enabled = { recovery_codes: fixture.recoveryCodes, csrf_token: session.csrf_token }
  const before = await data(await page.request.get("/api/v1/auth/mfa"))
  const lastUsed = Number(sql("SELECT last_used_step FROM mfa_totp WHERE user_id='" + session.user.id + "';"))
  await expect.poll(() => Math.floor(Date.now() / 30000) > lastUsed, { timeout: 35000 }).toBe(true)
  await data(await page.request.post("/api/v1/auth/logout", { headers: { "x-csrf-token": session.csrf_token } }))
  await page.goto("/#user/" + username)
  await page.getByRole("button", { name: "登录", exact: true }).first().click()
  const dialog = await submitLogin(page, username, 202)
  await expect(dialog.getByRole("heading", { name: "请输入验证码" })).toBeVisible()
  await expect(dialog.getByText(/也可以输入恢复码/)).toBeVisible()
  await dialog.getByRole("textbox", { name: "验证码或恢复码" }).fill("INVALID")
  const invalid = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/auth/mfa/verify")
  await dialog.getByRole("button", { name: "完成登录", exact: true }).click()
  expect((await invalid).ok()).toBe(false)
  await expect(dialog.getByRole("alert")).toBeVisible()
  await dialog.getByRole("textbox", { name: "验证码或恢复码" }).fill("")
  await capture(page, info, "mfa-challenge", ".auth-panel")
  await dialog.getByRole("textbox", { name: "验证码或恢复码" }).fill(totp(setup.secret_base32))
  const verified = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/auth/mfa/verify")
  await dialog.getByRole("button", { name: "完成登录", exact: true }).click()
  expect((await verified).status()).toBe(200)
  await expect(dialog).toHaveCount(0)
  const status = await data(await page.request.get("/api/v1/auth/mfa"))
  expect(status).toMatchObject({ enabled: true, recovery_codes_remaining: before.recovery_codes_remaining })
  const current = await data(await page.request.get("/api/v1/auth/session"))
  await data(await page.request.post("/api/v1/auth/logout", { headers: { "x-csrf-token": current.csrf_token } }))
  await page.reload()
  await page.getByRole("button", { name: "登录", exact: true }).first().click()
  const recovery = await submitLogin(page, username, 202)
  const recoveryIndex = enabled.recovery_codes.findIndex((_: string, i: number) => !used.includes(i))
  expect(recoveryIndex).toBeGreaterThanOrEqual(0)
  await recovery.getByRole("textbox", { name: "验证码或恢复码" }).fill(enabled.recovery_codes[recoveryIndex])
  const recovered = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/auth/mfa/verify")
  await recovery.getByRole("button", { name: "完成登录", exact: true }).click()
  expect((await recovered).status()).toBe(200)
  await expect(recovery).toHaveCount(0)
  const after = await data(await page.request.get("/api/v1/auth/mfa"))
  expect(after).toMatchObject({ enabled: true, recovery_codes_remaining: before.recovery_codes_remaining - 1 })
  used.push(recoveryIndex)
  await writeFile(fixturePath, JSON.stringify(fixture), "utf8")
  const probe = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  try {
    const challenge = await data(await probe.post("/api/v1/auth/login", { data: { identifier: username, password } }), 202)
    const replayed = await probe.post("/api/v1/auth/mfa/verify", { data: { challenge_id: challenge.challenge_id, code: enabled.recovery_codes[recoveryIndex] } })
    expect(replayed.status()).toBe(403)
    expect((await replayed.json()).error.code).toBe("auth.mfa_invalid")
    const anonymous = await probe.get("/api/v1/auth/session")
    expect(anonymous.status()).toBe(401)
    const rejected = await anonymous.json()
    expect(rejected.error.code).toBe("auth.unauthenticated")
    expect(rejected.meta.request_id).toBe(anonymous.headers()["x-request-id"])
  } finally { await probe.dispose() }
  await page.getByRole("button", { name: "多因素认证", exact: true }).click()
  await expect(page.getByText("已启用 · 剩余 " + after.recovery_codes_remaining + " 个恢复码", { exact: true })).toBeVisible()
  await capture(page, info, "mfa-recovered", "#profile-mfa-panel")
  await writeFile(info.outputPath("mfa-evidence.json"), JSON.stringify({ username, userId: session.user.id, actualTotpVerified: true, remainingBefore: before.recovery_codes_remaining, remainingAfter: after.recovery_codes_remaining, boundCredentialsRetained: true, privateFixture: "private/mfa-" + session.user.id + ".json", totpParameters: "API SHA1/6 digits/30 seconds; reused task-owned binding, no credential deletion" }, null, 2), "utf8")
})

test("preserves an expired-session draft and restores original-account input and image order", async ({ page }, info) => {
  const session = await fixtureSession(page.request, info, "draft")
  await page.goto("/")
  await page.getByRole("button", { name: /发布新主题/ }).first().click()
  const composer = page.getByRole("dialog", { name: "发布内容" })
  const title = "DYR020草稿_" + randomUUID()
  const content = "失效后的原正文_" + randomUUID()
  await composer.getByRole("textbox", { name: "标题（可选）" }).fill(title)
  await composer.getByRole("textbox", { name: "正文", exact: true }).fill(content)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  await composer.getByLabel("选择帖子图片").setInputFiles([1,2].map(i => ({ name: "retained-" + i + ".png", mimeType: "image/png", buffer: png })))
  await expect(composer.locator(".composer-image-item img")).toHaveCount(2)
  await composer.getByRole("button", { name: "后移图片 1", exact: true }).click()
  const order = await composer.locator(".composer-image-item img").evaluateAll(images => images.map(image => image.getAttribute("src")))
  await expect(composer.getByText("已同步到草稿箱", { exact: true })).toBeVisible()
  const sessions = await data(await page.request.get("/api/v1/auth/sessions"))
  const old = sessions.find((row: any) => row.is_current)
  sql("UPDATE sessions SET last_seen_at=created_at,idle_expires_at=created_at WHERE id='" + old.id + "' AND user_id='" + session.user.id + "';")
  await composer.getByRole("button", { name: "发布", exact: true }).click()
  await expect(composer.getByRole("button", { name: "重新登录", exact: true })).toBeVisible()
  await expect(composer.getByRole("textbox", { name: "标题（可选）" })).toHaveValue(title)
  await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toContainText(content)
  expect(await composer.locator(".composer-image-item img").evaluateAll(images => images.map(image => image.getAttribute("src")))).toEqual(order)
  await capture(page, info, "draft-expired", ".composer-dialog")
  await composer.getByRole("button", { name: "重新登录", exact: true }).click()
  await submitLogin(page, session.user.username)
  await expect(page.getByRole("dialog", { name: "登录刀云" })).toHaveCount(0)
  await expect(composer.getByRole("textbox", { name: "标题（可选）" })).toHaveValue(title)
  await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toContainText(content)
  expect(await composer.locator(".composer-image-item img").evaluateAll(images => images.map(image => image.getAttribute("src")))).toEqual(order)
  await capture(page, info, "draft-recovered", ".composer-dialog")
  const drafts = await data(await page.request.get("/api/v1/users/me/drafts?limit=20"))
  const draft = drafts.drafts.find((row: any) => row.content.title === title)
  expect(draft).toBeTruthy()
  await writeFile(info.outputPath("draft-evidence.json"), JSON.stringify({ username: session.user.username, userId: session.user.id, draftId: draft.id, imageOrder: order, expiredSessionId: old.id, quotaReset: false, published: false }, null, 2), "utf8")
})
