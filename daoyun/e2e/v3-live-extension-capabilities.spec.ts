import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Response, type Page, type TestInfo } from "@playwright/test"
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
async function payload(response: APIResponse | Response, status = 200) {
  expect(response.status(), new URL(response.url()).pathname).toBe(status)
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body
}
async function login(request: APIRequestContext) {
  return (await payload(await request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password: "DaoYunLocalOnly!2026" } }))).data
}
function sql(query: string) {
  return execFileSync(process.env.PSQL_BIN!, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-d", process.env.DATABASE_URL!], { input: query, encoding: "utf8", windowsHide: true, env: { ...process.env, PGCLIENTENCODING: "UTF8" } }).trim()
}
function fixture(authorId: string) {
  expect(authorId).toMatch(/^[a-f0-9-]{36}$/)
  const key = process.env.DAOYUN_CAPABILITY_PROVIDER_KEY!
  expect(key).toMatch(/^(?:v3_ext_polls_[a-f0-9]{16}|official_polls)$/)
  const boardId = randomUUID(), topicId = randomUUID(), optionId = randomUUID(), otherId = randomUUID()
  sql("INSERT INTO boards(id,slug,name) VALUES('" + boardId + "','v3-" + boardId + "','扩展状态验收版块');" +
    "INSERT INTO topics(id,board_id,author_id,title,excerpt,content,status,published_at) VALUES('" + topicId + "','" + boardId + "','" + authorId + "','DYR023 生命周期投票','扩展状态验收','投票历史与停用验收正文','published',CURRENT_TIMESTAMP);" +
    "INSERT INTO posts(id,topic_id,author_id,kind,content,status) VALUES('" + topicId + "','" + topicId + "','" + authorId + "','topic','投票历史与停用验收正文','published');" +
    "INSERT INTO topic_polls(topic_id,provider_key,question,ends_at) VALUES('" + topicId + "','" + key + "','选择一个验收选项',CURRENT_TIMESTAMP + INTERVAL '2 hours');" +
    "INSERT INTO topic_poll_options(id,topic_id,position,label) VALUES('" + optionId + "','" + topicId + "',0,'选择甲'),('" + otherId + "','" + topicId + "',1,'选择乙');")
  return { boardId, topicId, optionId, providerKey: key }
}
async function capture(page: Page, info: TestInfo, name: string, selector: string) {
  const before = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    if (width === 320 || width === 1440) expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
    await page.locator(selector).first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
  if (before) await page.setViewportSize(before)
  expect(errors.get(page)).toEqual([])
}

test("keeps native polls available and executable after a Wasm-off restart", async ({ page }, info) => {
  test.skip(process.env.DAOYUN_CAPABILITIES_PHASE !== "wasm-off", "Requires the Wasm-off restart phase")
  const session = await login(page.request)
  const snapshot = await payload(await page.request.get("/api/v1/admin/plugins/capabilities"))
  expect(snapshot.data.wasm_runtime_enabled).toBe(false)
  const wasmSupported = process.env.DAOYUN_EXPECT_WASM_SUPPORTED !== "false"
  expect(snapshot.data.wasm_supported).toBe(wasmSupported)
  expect(snapshot.data.modules.some((module: { status: string }) => module.status === "available")).toBe(true)
  expect(snapshot.data.modules.find((module: { capability: string }) => module.capability === "topic.polls")).toMatchObject({ execution: "native", runtime_ready: true, business_enabled: true, status: "available" })
  await page.goto("/#admin/plugins")
  const region = page.getByRole("region", { name: "扩展能力状态" })
  await expect(region.getByText(wasmSupported ? "Wasm 运行时未启用" : "当前构建不支持 Wasm", { exact: true })).toBeVisible()
  await expect(region.getByRole("article", { name: "单选投票" }).getByText("可用", { exact: true })).toBeVisible()
  await capture(page, info, "native-available-wasm-off", ".plugin-capability-status")
  const own = fixture(session.user.id)
  await page.goto("/#topic/" + own.topicId)
  const poll = page.getByRole("region", { name: "主题投票" })
  await poll.getByLabel("选择甲", { exact: true }).check()
  const vote = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/topics/" + own.topicId + "/poll/votes")
  await poll.getByRole("button", { name: "提交投票", exact: true }).click()
  await payload(await vote)
  await expect(poll.getByText("总计 1 票", { exact: true })).toBeVisible()
  await payload(await page.request.post("/api/v1/topics/" + own.topicId + "/poll/votes", { headers: { "x-csrf-token": session.csrf_token }, data: { option_id: own.optionId } }))
  expect(Number(sql("SELECT COUNT(*) FROM topic_poll_votes WHERE topic_id='" + own.topicId + "';"))).toBe(1)
  await capture(page, info, "native-vote-replayed-once", ".topic-poll")
  await writeFile(info.outputPath("wasm-off-evidence.json"), JSON.stringify({ ...own, wasmRuntimeEnabled: false, nativeStatus: "available", voteAndReplayStatus: 200, voteRows: 1 }, null, 2), "utf8")
})

test("rejects stale-page votes after disabling and preserves hidden historical results", async ({ page, playwright }, info) => {
  test.skip(process.env.DAOYUN_CAPABILITIES_PHASE !== "wasm-on", "Requires the Wasm-on lifecycle phase")
  const session = await login(page.request)
  const own = fixture(session.user.id)
  const control = await playwright.request.newContext({ baseURL: process.env.DAOYUN_API_URL })
  const admin = await login(control)
  const providerId = process.env.DAOYUN_CAPABILITY_PROVIDER_ID!
  expect(providerId).toMatch(/^[a-f0-9-]{36}$/)
  await page.goto("/#topic/" + own.topicId)
  const poll = page.getByRole("region", { name: "主题投票" })
  await expect(poll.getByLabel("选择甲", { exact: true })).toBeEnabled()
  try {
    const providers = (await payload(await control.get("/api/v1/admin/plugins"))).data as { id: string; status: string; revision: number }[]
    const provider = providers.find(item => item.id === providerId)!
    expect(provider.status).toBe("enabled")
    await payload(await control.patch("/api/v1/admin/plugins/" + providerId, { headers: { "x-csrf-token": admin.csrf_token }, data: { status: "disabled", expected_revision: provider.revision } }))
    await poll.getByLabel("选择甲", { exact: true }).check()
    const vote = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/topics/" + own.topicId + "/poll/votes")
    await poll.getByRole("button", { name: "提交投票", exact: true }).click()
    const rejected = await payload(await vote, 409)
    expect(rejected.error.code).toBe("poll.disabled")
    await expect(poll.getByRole("alert")).toHaveText("投票插件已停用")
    expect(Number(sql("SELECT COUNT(*) FROM topic_poll_votes WHERE topic_id='" + own.topicId + "';"))).toBe(0)
    await capture(page, info, "stale-vote-rejected", ".topic-poll")
    await poll.getByRole("button", { name: "刷新投票", exact: true }).click()
    await expect(poll.getByText("投票插件已停用，历史记录保留。", { exact: true })).toBeVisible()
    const historical = (await payload(await page.request.get("/api/v1/topics/" + own.topicId + "/poll"))).data
    expect(historical.enabled).toBe(false); expect(historical.total_votes).toBeNull()
    expect(historical.options).toHaveLength(2); expect(historical.options.every((option: { votes: unknown }) => option.votes === null)).toBe(true)
    await capture(page, info, "disabled-history-still-private", ".topic-poll")
    await page.goto("/#admin/plugins")
    const region = page.getByRole("region", { name: "扩展能力状态" })
    await expect(region.getByRole("article", { name: "单选投票" }).getByText("已停用", { exact: true })).toBeVisible()
    await capture(page, info, "native-provider-disabled", ".plugin-capability-status")
    await writeFile(info.outputPath("disable-evidence.json"), JSON.stringify({ ...own, providerId, rejectedStatus: 409, code: rejected.error.code, voteRows: 0, historicalRead: true, hiddenCountsPreserved: true }, null, 2), "utf8")
  } finally {
    const providers = (await payload(await control.get("/api/v1/admin/plugins"))).data as { id: string; status: string; revision: number }[]
    const provider = providers.find(item => item.id === providerId)!
    if (provider.status === "disabled") await payload(await control.patch("/api/v1/admin/plugins/" + providerId, { headers: { "x-csrf-token": admin.csrf_token }, data: { status: "enabled", expected_revision: provider.revision } }))
    await control.dispose()
  }
})

test("retries capability status without reloading the installed provider list", async ({ page }, info) => {
  test.skip(process.env.DAOYUN_CAPABILITIES_PHASE !== "wasm-on", "Requires the Wasm-on lifecycle phase")
  await login(page.request)
  let failed = true, snapshots = 0, lists = 0
  page.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === "/api/v1/admin/plugins") lists++ })
  await page.route("**/api/v1/admin/plugins/capabilities", async route => {
    snapshots++
    if (!failed) return route.continue()
    const id = randomUUID()
    return route.fulfill({ status: 500, contentType: "application/json", headers: { "x-request-id": id }, body: JSON.stringify({ error: { code: "test.capability_unavailable", message: "temporary" }, meta: { request_id: id } }) })
  })
  await page.goto("/#admin/plugins")
  const region = page.getByRole("region", { name: "扩展能力状态" })
  await expect(region.getByRole("button", { name: "重试扩展状态" })).toBeVisible()
  await expect(page.getByRole("button", { name: "查看插件：V3 扩展状态验收投票" })).toBeVisible()
  await capture(page, info, "capability-failure-list-ready", ".plugin-admin")
  const before = lists
  failed = false
  await region.getByRole("button", { name: "重试扩展状态" }).click()
  await expect(region.getByText("Wasm 运行时已启用", { exact: true })).toBeVisible()
  await expect(region.getByRole("article", { name: "单选投票" }).getByText("可用", { exact: true })).toBeVisible()
  expect(lists).toBe(before); expect(snapshots).toBe(2)
  await capture(page, info, "capability-recovered-list-preserved", ".plugin-capability-status")
  await writeFile(info.outputPath("retry-evidence.json"), JSON.stringify({ listRequestsBefore: before, listRequestsAfter: lists, snapshotRequests: snapshots, independentRecovery: true }, null, 2), "utf8")
})
