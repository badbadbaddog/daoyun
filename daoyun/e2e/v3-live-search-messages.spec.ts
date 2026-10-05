import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", screenshot: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(120000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL"]) expect(new URL(process.env[name]!).hostname).toBe("127.0.0.1")
  const found: string[] = []
  errors.set(page, found)
  page.on("pageerror", error => found.push(error.message))
})
async function payload(response: APIResponse, status = 200) {
  expect(response.status(), new URL(response.url()).pathname).toBe(status)
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body
}
async function login(request: APIRequestContext, username: string) {
  return (await payload(await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }))).data
}
async function member(page: Page, info: TestInfo, index = 1) {
  const names: string[] = JSON.parse(process.env.DAOYUN_GOVERNANCE_FIXTURE_USERS!)
  const username = names[index + (info.project.name.includes("mobile") ? 3 : 0)]
  expect(username).toMatch(/^v3_gov_[a-f0-9]{16}$/)
  return login(page.request, username)
}
function sql(query: string) {
  const database = new URL(process.env.DATABASE_URL!)
  expect(database.hostname).toBe("127.0.0.1")
  expect(database.pathname).toContain("v3")
  return execFileSync(process.env.PSQL_BIN!, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-d", process.env.DATABASE_URL!], { input: query, encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" }, windowsHide: true }).trim()
}
function publicFixture(authorId: string) {
  expect(authorId).toMatch(/^[a-f0-9-]{36}$/)
  const boardId = randomUUID(), topicId = randomUUID(), needle = "DYR021" + randomUUID().replaceAll("-", "")
  sql("INSERT INTO boards(id,slug,name) VALUES('" + boardId + "','v3-" + boardId + "','搜索收藏验收版块');" +
    "INSERT INTO topics(id,board_id,author_id,title,excerpt,content,status,published_at) VALUES('" + topicId + "','" + boardId + "','" + authorId + "','" + needle + "','" + needle + " excerpt','" + needle + " private-body','published',CURRENT_TIMESTAMP);" +
    "INSERT INTO posts(id,topic_id,author_id,kind,content,status) VALUES('" + topicId + "','" + topicId + "','" + authorId + "','topic','" + needle + " private-body','published');")
  return { boardId, topicId, needle }
}
async function capture(page: Page, info: TestInfo, name: string, selector: string) {
  expect(errors.get(page)).toEqual([])
  const before = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    if (width === 320 || width === 1440) expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([])
    await page.locator(selector).first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
  if (before) await page.setViewportSize(before)
}

test("shows content before user search completes and retries only failed users with URL filters intact", async ({ page }, info) => {
  const session = await member(page, info)
  const fixture = publicFixture(session.user.id)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let failed = true, userCalls = 0, topicCalls = 0
  page.on("request", request => {
    const url = new URL(request.url())
    if (url.pathname === "/api/v1/topics" && url.searchParams.get("query") === fixture.needle) topicCalls++
  })
  await page.route("**/api/v1/users?**", async route => {
    if (new URL(route.request().url()).searchParams.get("q") !== fixture.needle) return route.continue()
    userCalls++
    if (failed) {
      await gate
      const id = randomUUID()
      return route.fulfill({ status: 500, contentType: "application/json", headers: { "x-request-id": id }, body: JSON.stringify({ error: { code: "test.user_search_unavailable", message: "temporary" }, meta: { request_id: id } }) })
    }
    return route.continue()
  })
  const hash = "#search?q=" + fixture.needle + "&author=" + session.user.username + "&sort=latest"
  await page.goto("/" + hash)
  const results = page.getByRole("tabpanel")
  await expect(results.locator('a[href="#topic/' + fixture.topicId + '"]')).toBeVisible()
  await expect(page.getByText("正在搜索用户")).toBeVisible()
  await capture(page, info, "users-loading-content-ready", ".search-page")
  release()
  await expect(page.getByRole("button", { name: "重试用户搜索" })).toBeVisible()
  await capture(page, info, "users-failed-content-ready", ".search-page")
  const count = topicCalls
  expect(count).toBeGreaterThan(0)
  failed = false
  await page.getByRole("button", { name: "重试用户搜索" }).click()
  await expect(page.getByRole("button", { name: "重试用户搜索" })).toHaveCount(0)
  await expect(page.getByText("正在搜索用户")).toHaveCount(0)
  const afterRetry = topicCalls
  expect(afterRetry).toBe(count)
  expect(userCalls).toBe(2)
  expect(new URL(page.url()).hash).toBe(hash)
  await expect(page.getByLabel("作者用户名")).toHaveValue(session.user.username)
  await page.reload()
  await expect(results.locator('a[href="#topic/' + fixture.topicId + '"]')).toBeVisible()
  await capture(page, info, "search-recovered", ".search-page")
  await writeFile(info.outputPath("search-evidence.json"), JSON.stringify({ ...fixture, topicCallsBeforeRetry: count, topicCallsAfterRetry: afterRetry, userCallsBeforeReload: 2, urlFilters: hash, independent: true }, null, 2), "utf8")
})

test("replays a server-accepted message after a lost response without duplicate rows or unread increments", async ({ page }, info) => {
  const session = await member(page, info)
  const names: string[] = JSON.parse(process.env.DAOYUN_GOVERNANCE_FIXTURE_USERS!)
  const offset = info.project.name.includes("mobile") ? 3 : 0
  const ids = names.slice(offset, offset + 3).map(name => sql("SELECT id FROM users WHERE username='" + name + "';"))
  const conversation = (await payload(await page.request.post("/api/v1/conversations", { headers: { "x-csrf-token": session.csrf_token }, data: { recipient_id: ids[0] } }))).data
  const other = (await payload(await page.request.post("/api/v1/conversations", { headers: { "x-csrf-token": session.csrf_token }, data: { recipient_id: ids[2] } }))).data
  const unreadBefore = Number(sql("SELECT unread_count FROM conversation_members WHERE conversation_id='" + conversation.id + "' AND user_id='" + ids[0] + "';"))
  const content = "DYR021message" + randomUUID().replaceAll("-", "")
  const attempts: { key: string | undefined; body: string | null; status: number; messageId: string; requestId: string }[] = []
  await page.route("**/api/v1/conversations/" + conversation.id + "/messages", async route => {
    if (route.request().method() !== "POST") return route.continue()
    const response = await route.fetch()
    const body = await payload(response, 201)
    attempts.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData(), status: response.status(), messageId: body.data.id, requestId: body.meta.request_id })
    if (attempts.length === 1) return route.abort("timedout")
    return route.fulfill({ response })
  })
  await page.goto("/#messages/" + conversation.id)
  const field = page.getByRole("textbox", { name: "消息正文" })
  await field.fill(content)
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(page.getByRole("button", { name: "重新发送" })).toBeVisible()
  await expect(field).toHaveValue(content)
  await expect(field).toHaveAttribute("readonly")
  await capture(page, info, "message-result-unknown", ".messages-view")
  await page.evaluate(id => { location.hash = "#messages/" + id }, other.id)
  await expect(field).toHaveValue("")
  await page.evaluate(id => { location.hash = "#messages/" + id }, conversation.id)
  await expect(field).toHaveValue(content)
  await expect(field).toHaveAttribute("readonly")
  await page.getByRole("button", { name: "重新发送" }).click()
  await expect(field).toHaveValue("")
  expect(attempts).toHaveLength(2)
  expect(attempts[1].key).toBe(attempts[0].key)
  expect(attempts[1].body).toBe(attempts[0].body)
  expect(attempts[1].messageId).toBe(attempts[0].messageId)
  await expect(page.locator(".message-bubble").filter({ hasText: content })).toHaveCount(1)
  const rows = Number(sql("SELECT count(*) FROM direct_messages WHERE conversation_id='" + conversation.id + "' AND sender_id='" + session.user.id + "' AND content='" + content + "';"))
  const unreadAfter = Number(sql("SELECT unread_count FROM conversation_members WHERE conversation_id='" + conversation.id + "' AND user_id='" + ids[0] + "';"))
  expect(rows).toBe(1)
  expect(unreadAfter).toBe(unreadBefore + 1)
  await capture(page, info, "message-replayed", ".messages-view")
  await writeFile(info.outputPath("message-evidence.json"), JSON.stringify({ senderId: session.user.id, conversationId: conversation.id, attempts, rows, unreadBefore, unreadAfter }, null, 2), "utf8")
})

test("rechecks changed board access in bookmarks search and old links while retaining the saved edge", async ({ page, playwright }, info) => {
  const session = await member(page, info)
  const fixture = publicFixture(session.user.id)
  await payload(await page.request.put("/api/v1/topics/" + fixture.topicId + "/bookmark", { headers: { "x-csrf-token": session.csrf_token } }))
  await page.goto("/#bookmarks")
  await expect(page.getByRole("link", { name: fixture.needle, exact: true })).toBeVisible()
  await capture(page, info, "bookmark-public", ".bookmarks-view")
  const groupId = sql("SELECT id FROM community_groups WHERE internal_key='established_member';")
  expect(Number(sql("SELECT count(*) FROM community_group_memberships WHERE user_id='" + session.user.id + "' AND group_id='" + groupId + "' AND revoked_at IS NULL AND starts_at<=CURRENT_TIMESTAMP AND (ends_at IS NULL OR ends_at>CURRENT_TIMESTAMP);"))).toBe(0)
  const admin = await playwright.request.newContext({ baseURL: process.env.DAOYUN_API_URL })
  const anonymous = await playwright.request.newContext({ baseURL: process.env.DAOYUN_API_URL })
  try {
    const administrator = await login(admin, "demo_admin")
    const policy = (await payload(await admin.put("/api/v1/admin/content-access-policies/board/" + fixture.boardId, { headers: { "x-csrf-token": administrator.csrf_token }, data: { operator: "any_of", subjects: [{ subject_type: "community_group", community_group_id: groupId, subject_key: null }], expected_revision: null } }))).data
    await page.reload()
    await expect(page.getByRole("link", { name: fixture.needle, exact: true })).toHaveCount(0)
    const bookmarks = await payload(await page.request.get("/api/v1/users/me/bookmarks?limit=50"))
    expect(bookmarks.data.some((topic: { id: string }) => topic.id === fixture.topicId)).toBe(false)
    const results: { viewer: string; detail: number; searchCount: number }[] = []
    for (const [viewer, request] of [["member", page.request], ["visitor", anonymous]] as const) {
      await payload(await request.get("/api/v1/topics/" + fixture.topicId), 404)
      const search = await payload(await request.get("/api/v1/topics?query=" + fixture.needle))
      expect(search.data).toEqual([])
      results.push({ viewer, detail: 404, searchCount: search.data.length })
    }
    await payload(await page.request.get("/api/v1/users/me/bookmarks?cursor=" + fixture.topicId), 422)
    for (const method of ["put", "delete"] as const) await payload(await page.request[method]("/api/v1/topics/" + fixture.topicId + "/bookmark", { headers: { "x-csrf-token": session.csrf_token } }), 404)
    const edges = Number(sql("SELECT count(*) FROM topic_bookmarks WHERE user_id='" + session.user.id + "' AND topic_id='" + fixture.topicId + "';"))
    expect(edges).toBe(1)
    await capture(page, info, "bookmark-restricted", ".bookmarks-view")
    const reopened = (await payload(await admin.put("/api/v1/admin/content-access-policies/board/" + fixture.boardId, { headers: { "x-csrf-token": administrator.csrf_token }, data: { operator: "any_of", subjects: [{ subject_type: "public", community_group_id: null, subject_key: null }], expected_revision: policy.revision } }))).data
    await page.reload()
    await expect(page.getByRole("link", { name: fixture.needle, exact: true })).toBeVisible()
    await writeFile(info.outputPath("privacy-evidence.json"), JSON.stringify({ ...fixture, userId: session.user.id, restrictedRevision: policy.revision, reopenedRevision: reopened.revision, results, edges, bookmarkCount: bookmarks.data.length, policyWritesViaApi: true }, null, 2), "utf8")
  } finally {
    await admin.dispose()
    await anonymous.dispose()
  }
})
