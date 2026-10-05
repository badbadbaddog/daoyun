import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(120000)

async function data(response: APIResponse, expected = 200) {
  expect(response.status(), await response.text()).toBe(expected)
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  return body.data
}
function sql(query: string) {
  const url = new URL(process.env.DATABASE_URL!)
  expect(url.hostname).toBe("127.0.0.1")
  expect(url.pathname).toContain("v3")
  return execFileSync(process.env.PSQL_BIN!, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-d", process.env.DATABASE_URL!],
    { input: query, encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" }, windowsHide: true }).trim()
}
function users(info: TestInfo): string[] {
  const all: string[] = JSON.parse(process.env.DAOYUN_GOVERNANCE_FIXTURE_USERS!)
  return all.slice(info.project.name.includes("mobile") ? 3 : 0, info.project.name.includes("mobile") ? 6 : 3)
}
async function login(request: APIRequestContext, username: string) {
  const session = await data(await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }))
  return { csrf: session.csrf_token as string, id: session.user.id as string }
}
async function create(request: APIRequestContext, csrf: string, marker: string) {
  return data(await request.post("/api/v1/topics", { headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() }, data: { title: marker, content: marker + " 阅读上下文" } }), 201)
}
function seed(topicId: string, authorId: string, count: number) {
  const ids = Array.from({ length: count }, () => randomUUID())
  sql("INSERT INTO posts(id,topic_id,author_id,kind,content,floor_number,created_at) VALUES " + ids.map((id, i) => "('" + id + "','" + topicId + "','" + authorId + "','reply','阅读楼层 " + (i + 1) + "'," + (i + 1) + ",CURRENT_TIMESTAMP - INTERVAL '" + (count - i) + " seconds')").join(",") + ";UPDATE topics SET reply_count=" + count + " WHERE id='" + topicId + "';")
  return ids
}
async function capture(page: Page, info: TestInfo, name: string, selector: string) {
  const original = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    if (width === 320 || width === 1440) expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
  if (original) await page.setViewportSize(original)
}

test("opens an actual reply notification across pagination and returns to the notification context", async ({ page, playwright }, info) => {
  const account = users(info)
  const author = await login(page.request, account[0])
  const other = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    const replier = await login(other, account[1])
    const topic = await create(page.request, author.csrf, "DYR019跨页通知_" + randomUUID())
    seed(topic.id, author.id, 70)
    const reply = await data(await other.post("/api/v1/topics/" + topic.id + "/replies", { headers: { "x-csrf-token": replier.csrf, "idempotency-key": randomUUID() }, data: { content: "这是真实通知的目标楼层" } }), 201)
    expect(reply.floor_number).toBe(71)
    const notifications = await data(await page.request.get("/api/v1/notifications"))
    const notification = notifications.find((row: any) => row.target_id === reply.id)
    expect(notification).toMatchObject({ target: "post", topic_id: topic.id })
    const replyPages: string[] = []
    page.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === "/api/v1/topics/" + topic.id + "/replies") replyPages.push(request.url()) })
    await page.goto("/#notifications")
    await expect(page.getByRole("heading", { name: "通知", exact: true })).toBeVisible()
    await page.locator(".notification-item__body").first().click()
    await expect(page).toHaveURL(new RegExp("/t/" + topic.id + "\\?reply=" + reply.id))
    const floor = page.getByRole("article", { name: "第 71 楼回复", exact: true })
    await expect(floor).toBeFocused()
    expect(replyPages.length).toBeGreaterThanOrEqual(2)
    expect(replyPages.some(url => new URL(url).searchParams.has("cursor"))).toBe(true)
    await expect(page.getByText("这是真实通知的目标楼层", { exact: true })).toBeVisible()
    await capture(page, info, "notification-floor", ".topic-detail")
    if ((page.viewportSize()?.width ?? 1440) > 768) await page.goBack()
    else await page.getByRole("button", { name: "返回主题列表" }).click()
    await expect(page).toHaveURL(/#notifications$/)
    await expect(page.getByRole("heading", { name: "通知", exact: true })).toBeVisible()
    const read = (await data(await page.request.get("/api/v1/notifications"))).find((row: any) => row.id === notification.id)
    expect(read.read_at).not.toBeNull()
    expect(errors).toEqual([])
    await writeFile(info.outputPath("floor-evidence.json"), JSON.stringify({ topicId: topic.id, replyId: reply.id, notificationId: notification.id, replyPages, readAt: read.read_at, errors }, null, 2), "utf8")
  } finally { await other.dispose() }
})

test("publishes an empty-title body with nine ordered images through the existing composer", async ({ page, playwright }, info) => {
  const publisher = await login(page.request, users(info)[2])
  const admin = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  const operator = await login(admin, "demo_admin")
  const groupId = sql("SELECT id FROM community_groups WHERE internal_key='established_member';")
  const grant = await data(await admin.post("/api/v1/admin/community/memberships", { headers: { "x-csrf-token": operator.csrf }, data: { user_id: publisher.id, group_id: groupId, membership_kind: "additional", source: "operator", source_reference_id: null, reason: "DYR019 九图真实成员测试", starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), idempotency_key: randomUUID() } }))
  try {
  await page.goto("/")
  await page.getByRole("button", { name: /发布新主题/ }).first().click()
  const composer = page.getByRole("dialog", { name: "发布内容" })
  const marker = "DYR019无标题正文_" + randomUUID()
  await composer.getByRole("textbox", { name: "正文", exact: true }).fill(marker)
  await expect(composer.getByRole("textbox", { name: "标题（可选）" })).toHaveValue("")
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  const names = Array.from({ length: 9 }, (_, i) => "ordered019-" + (i + 1) + ".png")
  await composer.getByLabel("选择帖子图片").setInputFiles(names.map(name => ({ name, mimeType: "image/png", buffer: png })))
  await expect(composer.locator(".composer-image-item img")).toHaveCount(9, { timeout: 30000 })
  await composer.getByRole("button", { name: "前移图片 9", exact: true }).click()
  await expect.poll(() => composer.locator(".composer-image-item img").evaluateAll(images => images.map(image => image.getAttribute("alt")))).toEqual([...names.slice(0, 7), names[8], names[7]])
  await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeEnabled()
  const ordered = await composer.locator(".composer-image-item img").evaluateAll(images => images.map(image => image.getAttribute("src")!.split("/")[4]))
  const publishedResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/topics")
  await composer.getByRole("button", { name: "发布", exact: true }).click()
  const response = await publishedResponse
  expect(response.status()).toBe(201)
  const envelope = await response.json()
  expect(envelope.meta.request_id).toBe(response.headers()["x-request-id"])
  const detail = await data(await page.request.get("/api/v1/topics/" + envelope.data.id))
  expect(detail.title).toBe("")
  expect(detail.content).toContain(marker)
  expect(detail.media_urls).toHaveLength(9)
  expect(detail.media_urls.map((url: string) => url.split("/")[4])).toEqual(ordered)
  await expect(page).toHaveURL(new RegExp("/t/" + detail.id))
  await expect(page.getByRole("dialog", { name: "发布内容" })).toHaveCount(0)
  await capture(page, info, "untitled-published", ".topic-detail")
  await writeFile(info.outputPath("untitled-evidence.json"), JSON.stringify({ topicId: detail.id, title: detail.title, ordered, media: detail.media_urls, fixtureMembershipId: grant.membership.id, groupId }, null, 2), "utf8")
  } finally {
    try {
      const revoked = await data(await admin.post("/api/v1/admin/community/memberships/" + grant.membership.id + "/revoke", { headers: { "x-csrf-token": operator.csrf }, data: { expected_revision: grant.membership.revision, reason: "DYR019 验证结束撤销临时成员关系", idempotency_key: randomUUID() } }))
      await writeFile(info.outputPath("fixture-membership-revoked.json"), JSON.stringify({ id: revoked.membership.id, revision: revoked.membership.revision, revokedAt: revoked.membership.revoked_at }, null, 2), "utf8")
    } finally { await admin.dispose() }
  }
})

test("preserves an uncertain floor reply and retries once with the visible viewport reduced", async ({ page, playwright }, info) => {
  const account = users(info)
  const owner = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  try {
    const author = await login(owner, account[0])
    const topic = await create(owner, author.csrf, "DYR019回复恢复_" + randomUUID())
    const floors = seed(topic.id, author.id, 1)
    await login(page.request, account[1])
    await page.goto("/#topic/" + topic.id)
    await page.getByRole("button", { name: "回复 1 楼", exact: true }).click()
    const editor = page.getByRole("textbox", { name: "参与讨论", exact: true })
    const marker = "DYR019原回复_" + randomUUID()
    await editor.fill(marker)
    await page.setViewportSize({ width: 390, height: 900 })
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 360 })
      window.visualViewport!.dispatchEvent(new Event("resize"))
    })
    const form = page.getByRole("form", { name: "评论编辑器" })
    const publish = form.getByRole("button", { name: "发布回复", exact: true })
    await expect(publish).toBeInViewport()
    const visible = await publish.boundingBox()
    expect(visible!.y + visible!.height).toBeLessThanOrEqual(360)
    await page.screenshot({ path: info.outputPath("emulated-keyboard-390.png") })
    const requests: { body: any; key: string }[] = []
    let accepted: any
    await page.route("**/api/v1/topics/" + topic.id + "/replies", async route => {
      if (route.request().method() !== "POST") return route.continue()
      requests.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] })
      if (requests.length === 1) { const response = await route.fetch(); accepted = await data(response, 201); await route.abort("failed") }
      else await route.continue()
    })
    await publish.click()
    await expect(form.getByRole("alert")).toContainText("回复服务暂时不可用")
    await expect(editor).toHaveAttribute("contenteditable", "false")
    await expect(form.getByRole("button", { name: "取消回复指定楼层" })).toBeDisabled()
    await form.getByRole("button", { name: "收起评论输入框" }).click()
    await page.getByRole("button", { name: "写评论" }).click()
    await expect(form.getByText(/回复 #1/)).toBeVisible()
    await expect(editor).toContainText(marker)
    await publish.click()
    await expect(page.getByRole("article", { name: "第 2 楼回复", exact: true })).toBeFocused()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[0].body.reply_to_id).toBe(floors[0])
    const detail = await data(await page.request.get("/api/v1/topics/" + topic.id))
    expect(detail.reply_count).toBe(2)
    expect(sql("SELECT COUNT(*) FROM posts WHERE topic_id='" + topic.id + "' AND kind='reply' AND content='" + marker + "';")).toBe("1")
    expect(sql("SELECT COUNT(*) FROM admin_audit_log WHERE action='reply.create' AND resource_id='" + accepted.id + "';")).toBe("1")
    await page.unroute("**/api/v1/topics/" + topic.id + "/replies")
    await page.evaluate(() => { Reflect.deleteProperty(window.visualViewport!, "height"); window.visualViewport!.dispatchEvent(new Event("resize")) })
    await capture(page, info, "reply-confirmed", ".topic-detail")
    await page.getByRole("link", { name: /引用第 1 楼/ }).click()
    await expect(page.getByRole("article", { name: "第 1 楼回复", exact: true })).toBeFocused()
    await capture(page, info, "quote-floor", ".topic-detail")
    await writeFile(info.outputPath("retry-evidence.json"), JSON.stringify({ topicId: topic.id, postId: accepted.id, requests, actualPostCount: 1, actualAuditCount: 1, keyboard: "EMULATED_VISUAL_VIEWPORT_360", realDevice: "NOT_RUN" }, null, 2), "utf8")
  } finally { await owner.dispose() }
})
