import { writeFile } from "node:fs/promises"
import { expect, test, type APIResponse, type Locator, type Page, type Response } from "@playwright/test"
import type { MemberDraft } from "../src/api/drafts"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10_000 })
test.describe("isolated publisher entries and permissions", () => {
  test.skip(process.env.DAOYUN_PUBLISHER_E2E !== "1", "Requires an isolated local API and database")

  test("shares one publisher across home, board and cloud draft entries", async ({ page, browser }, testInfo) => {
    test.setTimeout(90_000)
    const network: { method: string; path: string; status: number }[] = []
    const issues: string[] = []
    watch(page, network, issues)
    await login(page)
    const boardResponse = await page.request.get("/api/v1/boards?limit=50")
    const boards = await data<{ id: string; slug: string }[]>(boardResponse)
    const general = boards.find(board => board.slug === "general")!
    const feedback = boards.find(board => board.slug === "feedback")!
    const published: { entry: string; id: string; boardId: string; draftId?: string }[] = []
    let composer = await openGlobal(page)
    await expect(composer.getByRole("combobox", { name: "板块" })).toHaveValue(general.id)
    published.push(await publish(page, composer, "首页入口 " + crypto.randomUUID(), "", general.id, "home"))
    await page.goto("/#board/feedback")
    await page.getByRole("button", { name: "发帖", exact: true }).click()
    composer = page.getByRole("dialog", { name: "发布内容" })
    await expect(composer.getByRole("combobox", { name: "板块" })).toHaveValue(feedback.id)
    published.push(await publish(page, composer, "版块入口 " + crypto.randomUUID(), "版块入口标题", feedback.id, "board"))
    await page.goto("/#board/feedback")
    await page.getByRole("button", { name: "发帖", exact: true }).click()
    composer = page.getByRole("dialog", { name: "发布内容" })
    const title = "跨入口草稿 " + crypto.randomUUID()
    const body = "草稿恢复后保持原版块 " + crypto.randomUUID()
    await composer.getByRole("textbox", { name: "标题（可选）" }).fill(title)
    await composer.getByRole("textbox", { name: "正文", exact: true }).fill(body)
    await expect(composer.getByText("已同步到草稿箱", { exact: true })).toBeVisible()
    let saved: MemberDraft | undefined
    await expect.poll(async () => {
      const drafts = await data<{ drafts: MemberDraft[] }>(await page.request.get("/api/v1/users/me/drafts?limit=20"))
      saved = drafts.drafts.find(draft => draft.content.title === title)
      return saved?.content.board_id
    }).toBe(feedback.id)
    await composer.getByRole("button", { name: "关闭发布窗口" }).click()
    await page.getByRole("button", { name: "确认关闭" }).click()
    const cloud = await browser.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
    try {
      const cloudPage = await cloud.newPage()
      watch(cloudPage, network, issues)
      await login(cloudPage)
      const restored = await openGlobal(cloudPage)
      await restored.getByRole("button", { name: "打开草稿箱" }).click()
      await restored.getByRole("button", { name: "继续编辑 " + title, exact: true }).click()
      await expect(restored.getByRole("combobox", { name: "板块" })).toHaveValue(feedback.id)
      await expect(restored.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
      for (const width of [320, 390, 768, 1024, 1440]) {
        await cloudPage.setViewportSize({ width, height: 900 })
        await assertNoHorizontalOverflow(cloudPage)
        await cloudPage.screenshot({ path: testInfo.outputPath("draft-entry-" + width + ".png") })
      }
      const result = await publish(cloudPage, restored, body, title, feedback.id, "draft")
      expect(result.draftId).toBe(saved!.id)
      published.push(result)
      const remaining = await data<{ drafts: MemberDraft[] }>(await cloudPage.request.get("/api/v1/users/me/drafts?limit=20"))
      expect(remaining.drafts.some(draft => draft.id === saved!.id)).toBe(false)
    } finally { await cloud.close() }
    expect(issues).toEqual([])
    const path = testInfo.outputPath("publisher-entries.json")
    await writeFile(path, JSON.stringify({ published, network, issues }, null, 2), "utf8")
    await testInfo.attach("publisher-entries", { path, contentType: "application/json" })
  })

  test("rechecks live board permissions and rejects bypassed attachment publishing", async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const network: { method: string; path: string; status: number }[] = []
    const issues: string[] = []
    watch(page, network, issues)
    await login(page)
    const boards = await data<{ id: string; slug: string }[]>(await page.request.get("/api/v1/boards?limit=50"))
    const general = boards.find(board => board.slug === "general")!
    const feedback = boards.find(board => board.slug === "feedback")!
    const readonly = boards.find(board => board.slug === "permission-readonly")!
    const composer = await openGlobal(page)
    const body = "版块权限变化保留正文 " + crypto.randomUUID()
    await composer.getByRole("textbox", { name: "正文", exact: true }).fill(body)
    await expect(composer.getByLabel("选择帖子图片")).toBeEnabled()
    await composer.getByLabel("选择帖子图片").setInputFiles({ name: "own-permission.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") })
    await expect(composer.getByText("已上传 1 / 9 张", { exact: true })).toBeVisible()
    const image = composer.getByRole("img", { name: "own-permission.png" })
    const attachmentId = (await image.getAttribute("src"))!.split("/")[4]
    await composer.getByRole("combobox", { name: "板块" }).selectOption(feedback.id)
    await expect(composer.getByText(/当前版块不允许上传图片/)).toBeVisible()
    await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeDisabled()
    await expect(composer.getByRole("button", { name: "上传图片", exact: true })).toBeDisabled()
    await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
    await expect(image).toBeVisible()
    const session = await data<{ csrf_token: string }>(await page.request.get("/api/v1/auth/session"))
    const rejected = await page.request.post("/api/v1/topics", { headers: { "x-csrf-token": session.csrf_token }, data: {
      board_id: feedback.id, content: body,
      rich_content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }, { type: "image", attrs: { attachmentId, alt: "附件" } }] },
    } })
    expect(rejected.status()).toBe(422)
    const rejectedPayload = await rejected.json()
    expect(rejectedPayload.error.code).toBe("request.validation_failed")
    expect(rejectedPayload.meta.request_id).toBe(rejected.headers()["x-request-id"])
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await assertNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath("attachment-restricted-" + width + ".png") })
    }
    await composer.getByRole("button", { name: "删除图片 1" }).click()
    await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeEnabled()
    await composer.getByRole("combobox", { name: "板块" }).selectOption(readonly.id)
    await expect(composer.getByText(/当前版块不可发布/)).toBeVisible()
    await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeDisabled()
    const forbidden = await page.request.post("/api/v1/topics", { headers: { "x-csrf-token": session.csrf_token }, data: { board_id: readonly.id, content: body } })
    expect(forbidden.status()).toBe(403)
    const forbiddenPayload = await forbidden.json()
    expect(forbiddenPayload.error.code).toBe("board.posting_restricted")
    await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
    await composer.getByRole("combobox", { name: "板块" }).selectOption(general.id)
    await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeEnabled()
    await composer.getByRole("combobox", { name: "板块" }).selectOption(feedback.id)
    await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeEnabled()
    const published = await publish(page, composer, body, "", feedback.id, "restricted-text-only")
    // The independent API tests also cover foreign, expired, deleted, pending and infected images.
    const path = testInfo.outputPath("publisher-permissions.json")
    await writeFile(path, JSON.stringify({ network, issues, published, attachmentId, rejected: { status: rejected.status(), payload: rejectedPayload }, forbidden: { status: forbidden.status(), payload: forbiddenPayload } }, null, 2), "utf8")
    await testInfo.attach("publisher-permissions", { path, contentType: "application/json" })
    expect(issues).toEqual([])
  })
})

async function login(page: Page) {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL"]) expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(process.env[name] ?? "").hostname)
  await page.goto("/")
  await page.getByRole("button", { name: "登录", exact: true }).first().click()
  await page.locator("#auth-identifier").fill("demo_member")
  await page.locator("#auth-password").fill("DaoYunLocalOnly!2026")
  const response = page.waitForResponse(row => row.request().method() === "POST" && new URL(row.url()).pathname === "/api/v1/auth/login")
  await page.locator('[role="dialog"] button[type="submit"]').click()
  expect((await response).status()).toBe(200)
  await expect(page.getByRole("dialog")).toHaveCount(0)
}
async function openGlobal(page: Page) {
  await page.getByRole("button", { name: /发布新主题/ }).first().click()
  return page.getByRole("dialog", { name: "发布内容" })
}
async function publish(page: Page, composer: Locator, body: string, title: string, boardId: string, entry: string) {
  await composer.getByRole("textbox", { name: "标题（可选）" }).fill(title)
  await composer.getByRole("textbox", { name: "正文", exact: true }).fill(body)
  await expect(composer.getByRole("button", { name: /预览|交易/ })).toHaveCount(0)
  await expect(composer.getByRole("button", { name: "发布", exact: true })).toBeEnabled()
  const pending = page.waitForResponse(row => row.request().method() === "POST" && new URL(row.url()).pathname === "/api/v1/topics")
  await composer.getByRole("button", { name: "发布", exact: true }).click()
  const response = await pending
  expect(response.status()).toBe(201)
  const input = response.request().postDataJSON()
  expect(input.board_id).toBe(boardId)
  expect(input.rich_content.type).toBe("doc")
  expect(input.content).toBe(body)
  if (!title) expect(input.title).toBeUndefined()
  const topic = await data<{ id: string; board: { id: string } }>(response)
  expect(topic.board.id).toBe(boardId)
  await expect(page).toHaveURL(new RegExp("/t/" + topic.id + "$"))
  await expect(composer).toHaveCount(0)
  return { entry, id: topic.id, boardId, draftId: input.draft?.id as string | undefined }
}
async function data<T>(response: Response | APIResponse): Promise<T> {
  expect(response.ok()).toBe(true)
  const payload = await response.json()
  expect(payload.meta.request_id).toBe(response.headers()["x-request-id"])
  return payload.data as T
}
function watch(page: Page, network: { method: string; path: string; status: number }[], issues: string[]) {
  page.on("pageerror", error => issues.push(error.message))
  page.on("response", response => { const path = new URL(response.url()).pathname; if (path.startsWith("/api/v1/")) network.push({ method: response.request().method(), path, status: response.status() }) })
}
