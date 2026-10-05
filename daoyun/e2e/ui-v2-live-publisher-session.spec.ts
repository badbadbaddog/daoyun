import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { expect, test, type APIResponse, type Locator, type Page, type Response } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10_000 })
test.describe("isolated publisher session recovery", () => {
  test.skip(process.env.DAOYUN_PUBLISHER_E2E !== "1", "Requires an isolated local API and database")
  for (const mode of ["revoked", "expired", "changed-account"] as const) {
    test("recovers the editor after " + mode, async ({ page, browser }, testInfo) => {
      test.setTimeout(120_000)
      const network: { method: string; path: string; status: number; requestId?: string }[] = []
      const issues: string[] = []
      watch(page, network, issues)
      const original = await login(page, "demo_member")
      await fixtureSql("DELETE FROM community_quota_usage WHERE user_id = '" + original.user.id + "'::uuid;")
      const boards = await data<{ id: string; slug: string }[]>(await page.request.get("/api/v1/boards?limit=50"))
      const general = boards.find(board => board.slug === "general")!
      const feedback = boards.find(board => board.slug === "feedback")!
      let composer = await openComposer(page)
      const title = "会话恢复 " + mode + " " + crypto.randomUUID()
      const body = "登录恢复时保留正文与图片 " + crypto.randomUUID()
      await composer.getByRole("combobox", { name: "板块" }).selectOption(feedback.id)
      await composer.getByRole("textbox", { name: "标题（可选）" }).fill(title)
      await composer.getByRole("textbox", { name: "正文", exact: true }).fill(body)
      await expect(composer.getByLabel("选择帖子图片")).toBeEnabled()
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
      await composer.getByLabel("选择帖子图片").setInputFiles([1, 2].map(index => ({ name: "recovery-" + index + ".png", mimeType: "image/png", buffer: png })))
      await expect(composer.getByText("已上传 2 / 9 张", { exact: true })).toBeVisible()
      await composer.getByRole("button", { name: "后移图片 1" }).click()
      const order = await imageOrder(composer)
      let draftId = ""
      await expect.poll(async () => {
        const rows = await data<{ drafts: { id: string; content: { title: string; board_id: string; images: { attachmentId: string }[] } }[] }>(await page.request.get("/api/v1/users/me/drafts?limit=20"))
        const row = rows.drafts.find(row => row.content.title === title)
        draftId = row?.id ?? ""
        return row && row.content.board_id === feedback.id && JSON.stringify(row.content.images.map(image => image.attachmentId)) === JSON.stringify(order)
      }).toBe(true)
      await expect(composer.getByText("已同步到草稿箱", { exact: true })).toBeVisible()
      const sessions = await data<{ id: string; is_current: boolean }[]>(await page.request.get("/api/v1/auth/sessions"))
      const originalSessionId = sessions.find(session => session.is_current)!.id
      const remote = await browser.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
      let restrictionRevision: number | undefined
      let adminToken: string | undefined
      try {
        const remotePage = await remote.newPage()
        watch(remotePage, network, issues)
        const controller = await login(remotePage, "demo_member")
        if (mode === "expired") {
          await fixtureSql("UPDATE sessions SET last_seen_at = created_at, idle_expires_at = created_at WHERE id = '" + originalSessionId + "'::uuid;")
        } else {
          const revoked = await remote.request.delete("/api/v1/auth/sessions/" + originalSessionId, { headers: { "x-csrf-token": controller.csrf_token } })
          expect((await data<{ revoked: boolean }>(revoked)).revoked).toBe(true)
        }
        const failed = page.waitForResponse(response => response.status() === 401 && /\/api\/v1\/(topics|users\/me\/drafts)/.test(new URL(response.url()).pathname))
        await composer.getByRole("button", { name: "发布", exact: true }).click()
        const failure = await failed
        const failurePayload = await failure.json()
        expect(failurePayload.error.code).toBe("auth.unauthenticated")
        expect(failurePayload.meta.request_id).toBe(failure.headers()["x-request-id"])
        await expect(composer.getByRole("button", { name: "重新登录" })).toBeVisible()
        await expect(composer.getByRole("button", { name: "重新登录" })).toBeFocused()
        await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeDisabled()
        await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
        expect(await imageOrder(composer)).toEqual(order)
        expect(await page.evaluate(() => localStorage.getItem("daoyun:composer-draft:v2:guest:global"))).toBeNull()
        for (const width of [320, 390, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await assertNoHorizontalOverflow(page)
          await page.screenshot({ path: testInfo.outputPath("session-expired-" + width + ".png") })
        }
        await composer.getByRole("button", { name: "重新登录" }).click()
        await expect(page.getByRole("dialog", { name: "登录刀云" })).toBeVisible()
        await expect(page.getByRole("dialog")).toHaveCount(1)
        await page.keyboard.press("Tab")
        expect(await page.getByRole("dialog", { name: "登录刀云" }).evaluate(element => element.contains(document.activeElement))).toBe(true)
        await page.getByRole("button", { name: "关闭身份窗口" }).click()
        await expect(composer.getByRole("button", { name: "重新登录" })).toBeFocused()
        await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
        await composer.getByRole("button", { name: "重新登录" }).click()
        if (mode === "revoked") {
          const admin = await data<Session>(await remote.request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password: "DaoYunLocalOnly!2026" } }))
          adminToken = admin.csrf_token
          const restriction = await data<{ revision: number }>(await remote.request.put(restrictionPath(feedback.id, original.user.id), { headers: { "x-csrf-token": adminToken }, data: { actions: ["topic_create"], starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: null, reason: "P-10 local recovery permission test", expected_revision: null } }))
          restrictionRevision = restriction.revision
        }
        const resumed = await submitLogin(page, mode === "changed-account" ? "demo_admin" : "demo_member")
        composer = page.getByRole("dialog", { name: "发布内容" })
        await expect(composer).toBeVisible()
        if (mode === "changed-account") {
          expect(resumed.user.id).not.toBe(original.user.id)
          await expect(composer.getByRole("textbox", { name: "正文", exact: true })).not.toHaveText(body)
          await expect(composer.getByRole("textbox", { name: "标题（可选）" })).not.toHaveValue(title)
          expect(await imageOrder(composer)).toEqual([])
          const otherBody = "另一个账号独立草稿 " + crypto.randomUUID()
          await composer.getByRole("textbox", { name: "正文", exact: true }).fill(otherBody)
          await expect(composer.getByText("已同步到草稿箱", { exact: true })).toBeVisible()
          const own = await data<{ drafts: { content: { title: string } }[] }>(await page.request.get("/api/v1/users/me/drafts?limit=20"))
          expect(own.drafts.some(row => row.content.title === title)).toBe(false)
          expect((await page.request.get("/api/v1/users/me/drafts/" + draftId)).status()).toBe(404)
          await composer.getByRole("button", { name: "关闭发布窗口" }).click()
          await page.getByRole("button", { name: "确认关闭" }).click()
          await page.getByRole("button", { name: "打开个人菜单" }).first().click()
          const loggedOut = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/auth/logout")
          await page.getByRole("menuitem", { name: "退出登录" }).click()
          expect((await loggedOut).status()).toBe(200)
          await page.getByRole("button", { name: "登录", exact: true }).first().click()
          await submitLogin(page, "demo_member")
          composer = await openComposer(page)
        } else expect(resumed.user.id).toBe(original.user.id)
        await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
        await expect(composer.getByRole("textbox", { name: "标题（可选）" })).toHaveValue(title)
        await expect(composer.getByRole("combobox", { name: "板块" })).toHaveValue(feedback.id)
        expect(await imageOrder(composer)).toEqual(order)
        if (mode === "revoked") {
          await expect(composer.getByText(/当前版块不可发布/)).toBeVisible()
          await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeDisabled()
          await fixtureSql("DELETE FROM board_user_restrictions WHERE board_id = '" + feedback.id + "'::uuid AND user_id = '" + original.user.id + "'::uuid;")
          restrictionRevision = undefined
          await composer.getByRole("combobox", { name: "板块" }).selectOption(general.id)
          await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeEnabled()
          await composer.getByRole("combobox", { name: "板块" }).selectOption(feedback.id)
        }
        await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeEnabled()
        if (mode === "expired") {
          await fixtureSql("INSERT INTO community_quota_usage(user_id, quota_key, window_start, used, revision) VALUES ('" + original.user.id + "'::uuid, 'topic.create.daily', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 100000, 1) ON CONFLICT (user_id, quota_key, window_start) DO UPDATE SET used = 100000;")
          const quotaFailure = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/topics" && response.status() === 429)
          await composer.getByRole("button", { name: "发布", exact: true }).click()
          const quotaResponse = await quotaFailure
          const quotaPayload = await quotaResponse.json()
          expect(quotaPayload.error.code).toBe("community.quota_exceeded")
          expect(quotaPayload.meta.request_id).toBe(quotaResponse.headers()["x-request-id"])
          await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
          expect(await imageOrder(composer)).toEqual(order)
          await fixtureSql("DELETE FROM community_quota_usage WHERE user_id = '" + original.user.id + "'::uuid AND quota_key = 'topic.create.daily';")
        }
        const published = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/topics" && response.status() === 201)
        await composer.getByRole("button", { name: "发布", exact: true }).click()
        const response = await published
        const topic = await data<{ id: string; author: { id: string }; board: { id: string } }>(response)
        const input = response.request().postDataJSON()
        expect(input.content).toBe(body)
        expect(input.board_id).toBe(feedback.id)
        expect(input.draft.id).toBe(draftId)
        expect(input.rich_content.content.filter((node: { type: string }) => node.type === "image").map((node: { attrs: { attachmentId: string } }) => node.attrs.attachmentId)).toEqual(order)
        expect(topic.author.id).toBe(original.user.id)
        expect(topic.board.id).toBe(feedback.id)
        await expect(page).toHaveURL(new RegExp("/t/" + topic.id + "$"))
        await expect(composer).toHaveCount(0)
        expect(network.filter(row => row.method === "POST" && row.path === "/api/v1/topics" && row.status === 201)).toHaveLength(1)
        expect(issues).toEqual([])
        const path = testInfo.outputPath("session-recovery-network.json")
        await writeFile(path, JSON.stringify({ mode, originalSessionId, ownerId: original.user.id, draftId, topicId: topic.id, imageOrder: order, contextPreserved: true, permissionRechecked: true, accountIsolated: mode === "changed-account", network, issues }, null, 2), "utf8")
        await testInfo.attach("session-recovery", { path, contentType: "application/json" })
      } finally {
        if (mode === "expired") await fixtureSql("DELETE FROM community_quota_usage WHERE user_id = '" + original.user.id + "'::uuid AND quota_key = 'topic.create.daily';")
        if (restrictionRevision !== undefined) await fixtureSql("DELETE FROM board_user_restrictions WHERE board_id = '" + feedback.id + "'::uuid AND user_id = '" + original.user.id + "'::uuid;")
        await remote.close()
      }
    })
  }
})
interface Session { user: { id: string }; csrf_token: string }
async function login(page: Page, identifier: string) {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL"]) expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(process.env[name] ?? "").hostname)
  await page.goto("/")
  await page.getByRole("button", { name: "登录", exact: true }).first().click()
  return submitLogin(page, identifier)
}
async function submitLogin(page: Page, identifier: string) {
  await page.locator("#auth-identifier").fill(identifier)
  await page.locator("#auth-password").fill("DaoYunLocalOnly!2026")
  const pending = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/auth/login")
  await page.getByRole("dialog", { name: "登录刀云" }).locator('button[type="submit"]').click()
  const session = await data<Session>(await pending)
  await expect(page.getByRole("dialog", { name: "登录刀云" })).toHaveCount(0)
  return session
}
async function openComposer(page: Page) {
  await page.getByRole("button", { name: /发布新主题/ }).first().click()
  return page.getByRole("dialog", { name: "发布内容" })
}
async function imageOrder(composer: Locator) {
  return composer.locator(".composer-image-grid img").evaluateAll(images => images.map(image => image.getAttribute("src")!.split("/")[4]))
}
function restrictionPath(boardId: string, ownerId: string) { return "/api/v1/management/boards/" + boardId + "/users/" + ownerId + "/posting-restriction" }
async function data<T>(response: Response | APIResponse): Promise<T> {
  expect(response.ok()).toBe(true)
  const payload = await response.json()
  expect(payload.meta.request_id).toBe(response.headers()["x-request-id"])
  return payload.data as T
}
function watch(page: Page, network: { method: string; path: string; status: number; requestId?: string }[], issues: string[]) {
  page.on("pageerror", error => issues.push(error.message))
  page.on("response", response => { const path = new URL(response.url()).pathname; if (path.startsWith("/api/v1/")) network.push({ method: response.request().method(), path, status: response.status(), requestId: response.headers()["x-request-id"] }) })
}
async function fixtureSql(sql: string) {
  const url = new URL(process.env.DATABASE_URL ?? "")
  expect(url.hostname).toBe("127.0.0.1")
  expect(url.pathname).toBe("/daoyun_ui_v2_session_recovery")
  await promisify(execFile)(process.env.DAOYUN_PSQL_PATH ?? "C:/Program Files/PostgreSQL/16/bin/psql.exe", ["--dbname=" + url.href, "--set=ON_ERROR_STOP=1", "--quiet", "--command=" + sql], { windowsHide: true, encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" } })
}
