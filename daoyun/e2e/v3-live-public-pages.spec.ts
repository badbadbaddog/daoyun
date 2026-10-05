import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo, type Response } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(120000)
async function payload(response: APIResponse | Response, status = 200) {
  expect(response.status(), await response.text()).toBe(status)
  const body = await response.json()
  expect(body.meta.request_id).toBe((await response.headers())["x-request-id"])
  return body
}
function sql(query: string) {
  const url = new URL(process.env.DATABASE_URL!)
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
  expect(url.pathname).toContain("v3")
  return execFileSync(process.env.PSQL_BIN!, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-d", process.env.DATABASE_URL!],
    { input: query, encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" }, windowsHide: true }).trim()
}
async function login(request: APIRequestContext, username = "demo_admin") {
  const body = await payload(await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }))
  return { csrf: body.data.csrf_token as string, userId: body.data.user.id as string }
}
async function capture(page: Page, info: TestInfo, name: string, selector: string) {
  const before = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    if (width === 320 || width === 1440) expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png"), fullPage: true })
  }
  if (before) await page.setViewportSize(before)
}
function topicId(row: { id: string }) { return row.id }
function publicRow(page: Page, id: string) { return page.locator(".topic-list > .topic-row").filter({ has: page.locator('a[href="#topic/' + id + '"]') }) }

test("previews the first three authorized images of nine and keeps one-column square cards", async ({ page, playwright }, info) => {
  const admin = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const uploaded: string[][] = [], topics: any[] = []
  try {
    await login(admin)
    expect(process.env.DAOYUN_PUBLIC_MEDIA_FIXTURE, "Requires the task-owned media fixture").toBeTruthy()
    const fixture = JSON.parse(process.env.DAOYUN_PUBLIC_MEDIA_FIXTURE!)
    topics.push(...fixture.topics)
    uploaded.push(...fixture.uploaded)
    expect(uploaded.map(ids => ids.length)).toEqual([0,1,2,9])
    const nine = uploaded[3]
    sql("UPDATE topics SET pinned_at=CURRENT_TIMESTAMP, hot_score=1000000 WHERE id IN (" + topics.map(row => "'" + row.id + "'").join(",") + ");")
    const response = await page.request.get("/api/v1/feed?mode=recommended&limit=50")
    const feed = await payload(response)
    const summary = feed.data.find((row: any) => row.id === topics[3].id)
    const allowed = nine.slice(3).map(id => "/api/v1/attachments/" + id + "/thumbnail")
    expect(summary.image_urls).toEqual(allowed.slice(0,3))
    expect(summary.visible_image_count).toBe(6)
    const detail = (await payload(await page.request.get("/api/v1/topics/" + topics[3].id))).data
    expect(detail.media_urls).toEqual(allowed)
    for (const id of nine.slice(0,3)) {
      expect(JSON.stringify(detail.rich_content)).not.toContain(id)
      const denied = await page.request.get("/api/v1/attachments/" + id + "/thumbnail")
      expect(denied.status()).toBe(404)
    }
    const ownerDetail = (await payload(await admin.get("/api/v1/topics/" + topics[3].id))).data
    expect(ownerDetail.visible_image_count).toBe(9)
    await page.goto("/#hot")
    for (const row of topics) await expect(publicRow(page, row.id)).toBeVisible()
    expect(await publicRow(page, topics[0].id).locator(".topic-cover").count()).toBe(0)
    const row = publicRow(page, topics[3].id)
    await expect(row.locator(".topic-cover img")).toHaveCount(3)
    expect(await row.locator(".topic-cover img").evaluateAll(images => images.map(image => image.getAttribute("src")))).toEqual(allowed.slice(0,3))
    await expect(row.getByText("+3", { exact: true })).toBeVisible()
    for (const width of [320,390,768,1024,1440]) {
      await page.setViewportSize({ width, height: 900 })
      const list = page.locator(".topic-list").first()
      expect(await list.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length)).toBe(1)
      for (let index = 1; index < 4; index++) {
        const card = publicRow(page, topics[index].id)
        const boxes = await card.locator(".topic-cover img").evaluateAll(images => images.map(image => { const box = image.getBoundingClientRect(); return { width: box.width, height: box.height } }))
        expect(boxes.length).toBe(index === 3 ? 3 : index)
        for (const box of boxes) expect(Math.abs(box.width - box.height)).toBeLessThan(2)
        expect(await card.locator(".topic-stats > *").evaluateAll(items => items.map(item => item.getAttribute("title")))).toEqual(["点赞","0 条回复","收藏"])
      }
      await assertNoHorizontalOverflow(page)
      if (width === 320 || width === 1440) expect((await new AxeBuilder({ page }).include(".topic-list").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([])
      await page.screenshot({ path: info.outputPath("public-cards-" + width + ".png"), fullPage: true })
    }
    await row.getByRole("button", { name: "查看第 3 张图片", exact: true }).click()
    const viewer = page.getByRole("dialog", { name: "图片预览" })
    await expect(viewer.getByText("3 / 6", { exact: true })).toBeVisible()
    await page.keyboard.press("ArrowRight")
    await expect(viewer.getByText("4 / 6", { exact: true })).toBeVisible()
    await expect(viewer.getByRole("img")).toHaveAttribute("src", allowed[3])
    await page.keyboard.press("Escape")
    expect(errors).toEqual([])
    await writeFile(info.outputPath("media-evidence.json"), JSON.stringify({ topicIds: topics.map(topicId), nineOrdered: nine, anonymousAllowed: allowed, preview: summary.image_urls, ownerCount: ownerDetail.visible_image_count, anonymousCount: summary.visible_image_count, pageErrors: errors }, null, 2), "utf8")
  } finally { await admin.dispose() }
})

test("excludes real private facts from a public profile and recovers identity without reloading topics", async ({ page, playwright }, info) => {
  const own = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  const admin = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  const fixtures: string[] = JSON.parse(process.env.DAOYUN_POINTS_FIXTURE_USERS!)
  const username = fixtures[info.project.name.includes("mobile") ? 2 : 0]
  expect(username).toMatch(/^v3_pts_[a-f0-9]{16}$/)
  const marker = "private018_" + randomUUID().replaceAll("-","")
  const requests: string[] = [], errors: string[] = []
  page.on("request", request => requests.push(new URL(request.url()).pathname))
  page.on("pageerror", error => errors.push(error.message))
  try {
    const me = await login(own, username), operator = await login(admin)
    const draftId = randomUUID()
    await payload(await own.put("/api/v1/users/me/drafts/" + draftId, { headers: { "x-csrf-token": me.csrf }, data: { expected_revision: 0, content: { title: marker + "_draft", board_id: null, rich_content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: marker + "_draft" }] }] }, images: [], poll: null } } }))
    const adjustment = (await payload(await admin.post("/api/v1/admin/membership/points", { headers: { "x-csrf-token": operator.csrf }, data: { user_id: me.userId, amount: 1, reason: "operations.community_reward", idempotency_key: marker + "_ledger" } }))).data
    const partner = sql("SELECT id FROM users WHERE username='" + JSON.parse(process.env.DAOYUN_GOVERNANCE_FIXTURE_USERS!)[5] + "'")
    const conversationId = sql("INSERT INTO direct_conversations(id,user_low_id,user_high_id) VALUES(gen_random_uuid(),LEAST('" + me.userId + "'::uuid,'" + partner + "'::uuid),GREATEST('" + me.userId + "'::uuid,'" + partner + "'::uuid)) ON CONFLICT(user_low_id,user_high_id) DO UPDATE SET updated_at=direct_conversations.updated_at RETURNING id")
    sql("INSERT INTO conversation_members(conversation_id,user_id) VALUES('" + conversationId + "','" + me.userId + "'),('" + conversationId + "','" + partner + "') ON CONFLICT DO NOTHING;INSERT INTO direct_messages(id,conversation_id,sender_id,content) VALUES(gen_random_uuid(),'" + conversationId + "','" + me.userId + "','" + marker + "_message');" +
      "INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,idle_expires_at,absolute_expires_at,device_label) VALUES(gen_random_uuid(),'" + me.userId + "',decode(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),'hex'),decode(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),'hex'),CURRENT_TIMESTAMP+INTERVAL '1 hour',CURRENT_TIMESTAMP+INTERVAL '1 day','" + marker + "_device');")
    const privateFacts = {
      drafts: (await payload(await own.get("/api/v1/users/me/drafts/" + draftId))).data,
      ledger: (await payload(await own.get("/api/v1/users/me/points/ledger?limit=50"))).data,
      messages: (await payload(await own.get("/api/v1/conversations/" + conversationId + "/messages"))).data,
      devices: (await payload(await own.get("/api/v1/auth/sessions"))).data,
    }
    for (const suffix of ["draft","message","device"]) expect(JSON.stringify(privateFacts)).toContain(marker + "_" + suffix)
    expect(privateFacts.ledger.some((entry: any) => entry.id === adjustment.ledger_entry_id)).toBe(true)
    const publicBodies: any[] = []
    for (const path of ["/api/v1/users/" + username, "/api/v1/users/" + username + "/membership-summary", "/api/v1/topics?author=" + username]) {
      const body = await payload(await page.request.get(path))
      publicBodies.push(body.data)
      const text = JSON.stringify(body.data)
      expect(text).not.toContain(marker)
      expect(text).not.toContain(adjustment.ledger_entry_id)
      for (const field of ['"drafts":','"ledger":','"point_ledger_entries":','"sessions":','"devices":','"device_label":','"csrf_token":','"token_hash":','"email":','"private_entitlements":','"direct_messages":']) expect(text).not.toContain(field)
    }
    let profileLoads = 0, topicLoads = 0
    page.on("response", response => {
      const url = new URL(response.url())
      if (url.pathname === "/api/v1/users/" + username && response.status() === 200) profileLoads++
      if (url.pathname === "/api/v1/topics" && url.searchParams.get("author") === username && response.status() === 200) topicLoads++
    })
    await page.route("**/api/v1/users/" + username + "/membership-summary", async route => { expect((await route.fetch()).status()).toBe(200); await route.abort("failed") }, { times: 1 })
    await page.goto("/#user/" + username)
    await expect(page.getByRole("button", { name: "重试加载公开身份" })).toBeVisible()
    await expect(page.getByRole("region", { name: "仅自己可见的账号管理" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "编辑资料" })).toHaveCount(0)
    await capture(page, info, "public-identity-error", ".profile-view")
    await page.getByRole("button", { name: "重试加载公开身份" }).click()
    await expect(page.getByRole("region", { name: "社区身份", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "重试加载公开身份" })).toHaveCount(0)
    expect(profileLoads).toBe(1)
    expect(topicLoads).toBe(1)
    expect(requests.filter(path => /\/users\/me\/(drafts|points|entitlements)|\/auth\/sessions|\/conversations/.test(path))).toEqual([])
    expect(await page.locator(".profile-view").innerText()).not.toContain(marker)
    await capture(page, info, "public-profile-ready", ".profile-view")
    expect(errors).toEqual([])
    await writeFile(info.outputPath("privacy-evidence.json"), JSON.stringify({ username, privateFactsVerified: ["draft","ledger","message","device"], draftId, ledgerId: adjustment.ledger_entry_id, conversationId, publicBodies, profileLoads, topicLoads, browserRequests: requests, pageErrors: errors }, null, 2), "utf8")
  } finally { await own.dispose(); await admin.dispose() }
})

test("uses route state for the three home feeds and preserves board hierarchy without membership actions", async ({ page }, info) => {
  const fixtures: string[] = JSON.parse(process.env.DAOYUN_POINTS_FIXTURE_USERS!)
  await login(page.request, fixtures[info.project.name.includes("mobile") ? 2 : 0])
  await page.goto("/#hot")
  for (const entry of [{ label: "关注", hash: "following", mode: "following" }, { label: "最新", hash: "feed", mode: "latest" }, { label: "推荐", hash: "hot", mode: "recommended" }]) {
    const response = page.waitForResponse(r => { const url = new URL(r.url()); return url.pathname === "/api/v1/feed" && url.searchParams.get("mode") === entry.mode && r.status() === 200 })
    await page.getByRole("tab", { name: entry.label, exact: true }).click()
    await payload(await response)
    await expect(page).toHaveURL(new RegExp("#" + entry.hash + "$"))
    await expect(page.getByRole("tab", { name: entry.label, exact: true })).toHaveAttribute("aria-selected","true")
    await page.reload()
    await expect(page.getByRole("tab", { name: entry.label, exact: true })).toHaveAttribute("aria-selected","true")
  }
  const parentId = randomUUID(), childId = randomUUID(), slug = "v3-hierarchy-" + parentId.slice(0,8), childSlug = slug + "-child", name = "层级验收 " + parentId.slice(0,8)
  sql("INSERT INTO boards(id,slug,name) VALUES('" + parentId + "','" + slug + "','" + name + "');INSERT INTO boards(id,slug,name,parent_id) VALUES('" + childId + "','" + childSlug + "','" + name + " 子版','" + parentId + "');")
  await page.goto("/#boards?q=" + encodeURIComponent(name))
  await page.reload()
  await expect(page.locator('.board-directory-page a[href="#board/' + slug + '"]')).toBeVisible()
  await expect(page.getByText(/加入圈子|版块成员数/)).toHaveCount(0)
  await capture(page, info, "public-board-directory", ".board-directory-page")
  await page.locator('.board-directory-page a[href="#board/' + slug + '"]').click()
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible()
  const children = page.getByRole("region", { name: "子版块导航", exact: true })
  await expect(children.locator('a[href="#board/' + childSlug + '"]')).toBeVisible()
  await capture(page, info, "public-board-parent", ".board-page")
  await children.locator('a[href="#board/' + childSlug + '"]').click()
  await expect(page.getByRole("navigation", { name: "社区路径" }).getByRole("link", { name, exact: true })).toHaveAttribute("href","#board/" + slug)
  await expect(page.getByText(/加入圈子|版块成员数/)).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  await writeFile(info.outputPath("hierarchy-evidence.json"), JSON.stringify({ parentId, childId, homeModes: ["recommended","following","latest"], routeState: "single-source" }, null, 2), "utf8")
})
