import { randomUUID, createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(90000)
const pointsPath = "/api/v1/admin/membership/points"
async function payload(response: Pick<APIResponse, "status" | "text" | "json" | "headers">, status = 200) {
  expect(response.status(), await response.text()).toBe(status)
  const body = await response.json(); expect(body.meta.request_id).toBe(response.headers()["x-request-id"]); return body
}
async function login(request: APIRequestContext, username = "demo_admin") {
  return (await payload(await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }))).data.csrf_token as string
}
async function member(request: APIRequestContext, info: TestInfo, kind: "adjustment" | "redemption") {
  const fixtures: string[] = JSON.parse(process.env.DAOYUN_POINTS_FIXTURE_USERS ?? "[]")
  let username = fixtures[(info.project.name.includes("mobile") ? 2 : 0) + (kind === "redemption" ? 1 : 0)]
  if (username) expect(username).toMatch(/^v3_pts_[a-f0-9]{16}$/)
  else { username = "v3_pts_" + randomUUID().replaceAll("-", "").slice(0,16); await payload(await request.post("/api/v1/auth/register", { data: { username, email: username + "@example.test", display_name: "积分验收成员", password: "DaoYunLocalOnly!2026" } }), 201) }
  const csrf = await login(request, username)
  const account = (await payload(await request.get("/api/v1/users/me/membership"))).data
  const ledger = (await payload(await request.get("/api/v1/users/me/points/ledger?limit=50"))).data
  return { id: account.user_id as string, username, csrf, balance: account.points_balance as number, ledgerCount: ledger.length as number }
}
async function capture(page: Page, info: TestInfo, name: string, selector: string) {
  const before = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 }); await assertNoHorizontalOverflow(page)
    if (width === 320 || width === 1440) expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png"), fullPage: true })
  }
  if (before) await page.setViewportSize(before)
}
test.beforeEach(() => { for (const key of ["DAOYUN_WEB_URL","DATABASE_URL"]) { const url = new URL(process.env[key]!); expect(["127.0.0.1","localhost","[::1]"]).toContain(url.hostname); if(key === "DATABASE_URL") expect(url.pathname).toContain("v3") } })

test("replays a committed adjustment after its response is lost and traces the original entry", async ({ page, playwright }, info) => {
  const customer = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL }); const target = await member(customer, info, "adjustment")
  try {
    const csrf = await login(page.request)
    await page.goto("/#admin/membership"); await page.reload(); await page.getByRole("tab", { name: "积分管理", exact: true }).click()
    await page.getByRole("searchbox", { name: "搜索用户", exact: true }).fill(target.username)
    await page.getByRole("button", { name: "选择积分验收成员 @" + target.username, exact: true }).click()
    await expect(page.getByRole("button", { name: "确认积分操作" })).toBeEnabled()
    await page.getByRole("spinbutton", { name: "积分数量", exact: true }).fill("30")
    await page.getByRole("combobox", { name: "运营原因", exact: true }).selectOption("operations.community_reward")
    let first: any; let originalInput: any
    await page.route("**/api/v1/admin/membership/points", async route => {
      originalInput = route.request().postDataJSON(); const response = await route.fetch(); first = await payload(response); await route.abort("failed")
    }, { times: 1 })
    await page.getByRole("button", { name: "确认积分操作" }).click()
    await expect(page.getByRole("alert")).toContainText("结果尚未确认")
    expect(first.data.balance_before).toBe(target.balance); expect(first.data.balance_after).toBe(target.balance + 30)
    await payload(await page.request.post(pointsPath, { headers: { "x-csrf-token": csrf }, data: { user_id: target.id, amount: 5, reason: "operations.community_reward", idempotency_key: "later-" + randomUUID() } }))
    const response = page.waitForResponse(r => new URL(r.url()).pathname === pointsPath && r.request().method() === "POST")
    await page.getByRole("button", { name: "确认积分操作" }).click(); const replayResponse = await response; const replay = await payload(replayResponse)
    expect(replayResponse.request().postDataJSON()).toEqual(originalInput)
    expect(replay.data).toMatchObject({ created: false, balance_before: target.balance, balance_after: target.balance + 30, ledger_entry_id: first.data.ledger_entry_id, account: { points_balance: target.balance + 35 } })
    await expect(page.getByText(target.balance + " → " + (target.balance + 30) + " 积分", { exact: true })).toBeVisible(); await expect(page.getByText("最新余额 " + (target.balance + 35) + " 积分", { exact: true })).toBeVisible()
    await capture(page, info, "adjustment-receipt", "#membership-points-workspace")
    const ledger = (await payload(await customer.get("/api/v1/users/me/points/ledger?limit=50"))).data
    expect(ledger).toHaveLength(target.ledgerCount + 2); const original = ledger.find((entry: any) => entry.id === first.data.ledger_entry_id)
    expect(original).toMatchObject({ amount: 30, balance_after: target.balance + 30, actor_username: "demo_admin", operation_request_id: first.meta.request_id })
    await login(page.request, target.username); await page.goto("/#member/points"); await page.reload()
    await expect(page.getByRole("region", { name: "积分概览", exact: true })).toContainText(first.meta.request_id)
    const lightTheme = page.getByRole("button", { name: "切换浅色模式", exact: true }); if(await lightTheme.isVisible()) await lightTheme.click()
    await capture(page, info, "points-ledger-light", ".points-panel")
    await page.getByRole("button", { name: "切换深色模式", exact: true }).click(); await capture(page, info, "points-ledger-dark", ".points-panel")
    await writeFile(info.outputPath("adjustment-evidence.json"), JSON.stringify({ userId: target.id, firstRequestId: first.meta.request_id, replayRequestId: replay.meta.request_id, ledgerId: original.id, balanceBefore: target.balance, balanceAfter: target.balance + 30, currentBalance: target.balance + 35, ledgerCount: ledger.length }, null, 2), "utf8")
  } finally { await customer.dispose() }
})

test("keeps redemption receipts and valid benefits readable after the actual provider is disabled", async ({ page, playwright }, info) => {
  const customer = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL }); const target = await member(customer, info, "redemption")
  const csrf = await login(page.request); let plugin: any; let created = false; let initialStatus: string | undefined
  try {
    plugin = (await payload(await page.request.get("/api/v1/admin/plugins"))).data.find((item: any) => item.key === "official_points_redemption")
    if (!plugin) {
      const manifest = JSON.parse(await readFile("plugins/official-points-redemption/plugin.json","utf8")); const bytes = await readFile("plugins/official-points-redemption/target/wasm32-wasip2/release/daoyun_official_points_redemption.wasm")
      plugin = (await payload(await page.request.post("/api/v1/admin/plugins", { headers: { "x-csrf-token": csrf }, data: { manifest, component_base64: bytes.toString("base64") } }), 201)).data; created = true
      await writeFile(info.outputPath("component-evidence.json"),JSON.stringify({ sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length },null,2),"utf8")
    } else initialStatus = plugin.status
    async function status(value: string) { plugin = (await payload(await page.request.patch("/api/v1/admin/plugins/" + plugin.id, { headers: { "x-csrf-token": csrf }, data: { status: value, expected_revision: plugin.revision } }))).data }
    if (plugin.status !== "enabled") await status("enabled")
    const key = "v3_points_" + randomUUID().replaceAll("-","").slice(0,16)
    const kind = (await payload(await page.request.put("/api/v1/admin/entitlements/types/" + key, { headers: { "x-csrf-token": csrf }, data: { display_name: "七日积分权益", permission_keys: ["topic.poll.create"], quotas: {}, expected_revision: null } }))).data
    const productId = randomUUID(); const product = (await payload(await page.request.put("/api/v1/admin/redemption-products/" + productId, { headers: { "x-csrf-token": csrf }, data: { name: "七日积分权益", entitlement_type_id: kind.id, type_version: 1, price: 60, duration_days: 7, per_user_limit: 1, enabled: true, expected_revision: null } }))).data
    const redeemInput = { product_id: productId, expected_revision: product.revision, idempotency_key: randomUUID() }
    expect(target.balance).toBeLessThan(60)
    const historyBefore = (await payload(await customer.get("/api/v1/users/me/redemptions"))).data.records
    const entitlementsBefore = (await payload(await customer.get("/api/v1/users/me/entitlements"))).data
    const ledgerBefore = (await payload(await customer.get("/api/v1/users/me/points/ledger?limit=50"))).data
    const poor = await customer.post("/api/v1/users/me/redemptions", { headers: { "x-csrf-token": target.csrf }, data: redeemInput }); expect((await payload(poor,409)).error.code).toBe("redemption.insufficient_balance")
    expect((await payload(await customer.get("/api/v1/users/me/redemptions"))).data.records).toEqual(historyBefore); expect((await payload(await customer.get("/api/v1/users/me/entitlements"))).data).toEqual(entitlementsBefore)
    expect((await payload(await customer.get("/api/v1/users/me/points/ledger?limit=50"))).data).toEqual(ledgerBefore); expect((await payload(await customer.get("/api/v1/users/me/membership"))).data.points_balance).toBe(target.balance)
    await payload(await page.request.post(pointsPath, { headers: { "x-csrf-token": csrf }, data: { user_id: target.id, amount: 100, reason: "operations.community_reward", idempotency_key: "credit-" + randomUUID() } }))
    const receipt = await payload(await customer.post("/api/v1/users/me/redemptions", { headers: { "x-csrf-token": target.csrf }, data: redeemInput }))
    await status("disabled")
    const replay = await payload(await customer.post("/api/v1/users/me/redemptions", { headers: { "x-csrf-token": target.csrf }, data: redeemInput })); expect(replay.data).toEqual(receipt.data)
    const entitlements = (await payload(await customer.get("/api/v1/users/me/entitlements"))).data; expect(entitlements.some((entry: any) => entry.id === receipt.data.entitlement_id)).toBe(true)
    const account = (await payload(await customer.get("/api/v1/users/me/membership"))).data; expect(account.points_balance).toBe(target.balance + 40)
    await login(page.request, target.username); await page.goto("/#member/points"); await page.reload()
    const panel = page.getByRole("region", { name: "积分兑换", exact: true }); await expect(panel).toContainText("已获得的有效权益继续生效"); await expect(panel).toContainText(receipt.data.id); await expect(panel).toContainText("余额 " + (target.balance + 100) + " → " + (target.balance + 40) + " 积分")
    await capture(page, info, "disabled-redemption-history", ".redemption-panel")
    await page.getByRole("button", { name: "权益", exact: true }).click(); await expect(page.getByRole("region", { name: "标准权益", exact: true })).toContainText(key.split("_").map(part => part[0].toUpperCase() + part.slice(1)).join(" "))
    await writeFile(info.outputPath("redemption-evidence.json"), JSON.stringify({ receiptId: receipt.data.id, entitlementId: receipt.data.entitlement_id, balanceBefore: target.balance, balance: target.balance + 40, providerDisabled: true, validEntitlements: entitlements.length },null,2),"utf8")
  } finally {
    const cleanupCsrf = await login(page.request); if(plugin) {
      if(created) await payload(await page.request.delete("/api/v1/admin/plugins/" + plugin.id, { headers: { "x-csrf-token": cleanupCsrf } }))
      else if(plugin.status !== initialStatus) { const fresh = (await payload(await page.request.get("/api/v1/admin/plugins"))).data.find((p: any) => p.id === plugin.id); await payload(await page.request.patch("/api/v1/admin/plugins/" + plugin.id,{headers:{"x-csrf-token":cleanupCsrf},data:{status:initialStatus,expected_revision:fresh.revision}})) }
    }; await customer.dispose()
  }
})

test("denies point adjustments and redemption configuration to ordinary members",async({page})=>{
  const csrf = await login(page.request,"demo_member")
  await payload(await page.request.post(pointsPath,{headers:{"x-csrf-token":csrf},data:{user_id:randomUUID(),amount:25,reason:"operations.community_reward",idempotency_key:randomUUID()}}),403)
  await payload(await page.request.get("/api/v1/admin/redemption-products"),403)
  await page.goto("/#admin/membership"); await expect(page.getByRole("button",{name:"确认积分操作"})).not.toBeVisible()
})
