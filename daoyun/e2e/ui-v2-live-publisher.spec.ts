import { expect, test, type Locator, type Page, type Response } from "@playwright/test"
import type { MemberDraft } from "../src/api/drafts"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off" })

test.describe("isolated real publisher", () => {
  test.skip(process.env.DAOYUN_PUBLISHER_E2E !== "1", "Requires an explicitly selected isolated local instance")

  test("persists nine uploaded images through sorting, cloud restore and untitled publishing", async ({ page, browser }, testInfo) => {
    test.setTimeout(90_000)
    for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL"]) {
      const url = new URL(process.env[name] ?? "")
      expect(url.protocol).toBe("http:")
      expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
    }
    const body = "真实九图顺序验收 " + crypto.randomUUID()
    const issues: string[] = []
    const network: { method: string; path: string; status: number }[] = []
    page.on("pageerror", error => issues.push(error.message))
    page.on("console", message => {
      if (!["error", "warning"].includes(message.type())) return
      // An anonymous session probe is expected before the UI login.
      if (message.text().includes("401 (Unauthorized)") && message.location().url.includes("/auth/session")) return
      issues.push(message.text())
    })
    page.on("response", response => {
      const path = new URL(response.url()).pathname
      if (path.startsWith("/api/v1/")) network.push({ method: response.request().method(), path, status: response.status() })
    })
    await login(page)
    let composer = await openComposer(page)
    await composer.getByRole("textbox", { name: "正文", exact: true }).fill(body)
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    const names = Array.from({ length: 9 }, (_, index) => "real-image-" + (index + 1) + ".png")
    await composer.getByLabel("选择帖子图片").setInputFiles(names.map(name => ({ name, mimeType: "image/png", buffer: png })))
    await expect(composer.getByText("已上传 9 / 9 张", { exact: true })).toBeVisible({ timeout: 30_000 })
    expect(network.filter(row => row.method === "POST" && row.path === "/api/v1/attachments/drafts").map(row => row.status)).toEqual(Array(9).fill(201))
    await composer.getByRole("button", { name: "前移图片 9", exact: true }).click()
    await expect(composer.getByRole("button", { name: "前移图片 8", exact: true })).toBeFocused()
    const expectedNames = [...names.slice(0, 7), names[8], names[7]]
    await expect.poll(() => imageNames(composer)).toEqual(expectedNames)
    await expect(composer.getByText("已同步到草稿箱", { exact: true })).toBeVisible()
    let saved: MemberDraft | undefined
    await expect.poll(async () => {
      const draftList = await page.request.get("/api/v1/users/me/drafts?limit=20")
      const drafts = (await businessData<{ drafts: MemberDraft[] }>(draftList)).drafts
      saved = drafts.find(row => row.content.images.map(image => image.fileName).join() === expectedNames.join()
        && JSON.stringify(row.content.rich_content).includes(body))
      return saved?.content.images.map(image => image.fileName)
    }).toEqual(expectedNames)
    expect(saved!.content.title).toBe("")
    const expectedIds = saved!.content.images.map(image => image.attachmentId)
    expect(new Set(expectedIds).size).toBe(9)
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await assertNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath("real-sorted-" + width + ".png") })
    }
    await composer.getByRole("button", { name: "关闭发布窗口" }).click()
    await page.getByRole("button", { name: "确认关闭" }).click()
    await expect(composer).toHaveCount(0)
    await page.reload()
    composer = await openComposer(page)
    await expect.poll(() => imageNames(composer)).toEqual(expectedNames)
    await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
    // A separate browser context has no local draft and explicitly restores the server version.
    const cloudContext = await browser.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
    const cloudPage = await cloudContext.newPage()
    await login(cloudPage)
    const cloudComposer = await openComposer(cloudPage)
    await expect(cloudComposer.getByRole("textbox", { name: "正文", exact: true })).toBeEmpty()
    await cloudComposer.getByRole("button", { name: "打开草稿箱" }).click()
    const cloudRow = cloudComposer.locator(".composer-drafts__row").filter({ hasText: body })
    await cloudRow.getByRole("button", { name: "继续编辑 未命名草稿", exact: true }).click()
    await expect.poll(() => imageNames(cloudComposer)).toEqual(expectedNames)
    await expect(cloudComposer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
    const loadedDraft = await cloudPage.request.get("/api/v1/users/me/drafts/" + saved!.id)
    expect((await businessData<MemberDraft>(loadedDraft)).content.images.map(image => image.attachmentId)).toEqual(expectedIds)
    await cloudPage.screenshot({ path: testInfo.outputPath("real-cloud-restored.png") })
    await cloudContext.close()
    const publishedResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/topics")
    await composer.getByRole("button", { name: "发布", exact: true }).click()
    const response = await publishedResponse
    expect(response.status()).toBe(201)
    const input = response.request().postDataJSON()
    expect(input.title).toBeUndefined()
    expect(input.content).toContain(body)
    expect(input.draft.id).toBe(saved!.id)
    expect(input.rich_content.content.filter((node: { type: string }) => node.type === "image").map((node: { attrs: { attachmentId: string } }) => node.attrs.attachmentId)).toEqual(expectedIds)
    const published = await businessData<{ id: string; title: string; media_urls: string[]; rich_content: { content: { type: string; attrs?: { attachmentId?: string } }[] } }>(response)
    expect(published.title).toBe("")
    await expect(page).toHaveURL(new RegExp("/t/" + published.id + "$"))
    await expect(composer).toHaveCount(0)
    const detailResponse = await page.request.get("/api/v1/topics/" + published.id)
    const detail = await businessData<typeof published>(detailResponse)
    expect(detail.rich_content.content.filter(node => node.type === "image").map(node => node.attrs?.attachmentId)).toEqual(expectedIds)
    expect(detail.media_urls).toHaveLength(9)
    expect(detail.media_urls.map(url => url.split("/")[4])).toEqual(expectedIds)
    const anonymous = await browser.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
    try {
      const publicDetail = await anonymous.request.get("/api/v1/topics/" + published.id)
      expect((await businessData<typeof published>(publicDetail)).media_urls).toEqual(detail.media_urls)
    } finally { await anonymous.close() }
    const topicBody = page.locator(".topic-detail .rich-text-content").first()
    await expect(topicBody).toContainText(body)
    await expect(topicBody.getByRole("img")).toHaveCount(5)
    await topicBody.getByRole("button", { name: "预览图片：" + expectedNames[0], exact: true }).click()
    const viewer = page.getByRole("dialog", { name: "图片预览" })
    for (let index = 0; index < 9; index++) {
      await expect(viewer.getByText((index + 1) + " / 9", { exact: true })).toBeVisible()
      await expect(viewer.getByRole("img")).toHaveAttribute("src", detail.media_urls[index])
      if (index < 8) await page.keyboard.press("ArrowRight")
    }
    await page.keyboard.press("Escape")
    await page.screenshot({ path: testInfo.outputPath("real-published.png") })
    expect(issues).toEqual([])
    await testInfo.attach("real-publisher-network", { body: JSON.stringify({ network, draftId: saved!.id, topicId: published.id, orderedAttachmentIds: expectedIds }), contentType: "application/json" })
  })
})

async function login(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "登录", exact: true }).first().click()
  await page.locator("#auth-identifier").fill("demo_member")
  await page.locator("#auth-password").fill("DaoYunLocalOnly!2026")
  const response = page.waitForResponse(row => row.request().method() === "POST" && new URL(row.url()).pathname === "/api/v1/auth/login")
  await page.locator('[role="dialog"] button[type="submit"]').click()
  expect((await response).status()).toBe(200)
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

async function openComposer(page: Page) {
  await page.getByRole("button", { name: /发布新主题/ }).first().click()
  return page.getByRole("dialog", { name: "发布内容" })
}

async function imageNames(composer: Locator) {
  return composer.locator(".composer-image-item img").evaluateAll(images => images.map(image => image.getAttribute("alt")))
}

async function businessData<T>(response: Response | import("@playwright/test").APIResponse): Promise<T> {
  expect(response.ok()).toBe(true)
  const payload = await response.json()
  expect(payload.meta.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  expect(payload.meta.request_id).toBe(response.headers()["x-request-id"])
  return payload.data as T
}
