import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { expect, test, type Page, type TestInfo, type Response } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"
import { resolveChromiumExecutable } from "./browser-runtime"

test.use({ trace: "off", video: "off", actionTimeout: 10_000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires explicitly selected isolated V3 instance")

const pageErrors = new WeakMap<Page, string[]>()

async function login(page: Page) {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL"]) {
    const url = new URL(process.env[name] ?? "")
    expect(url.protocol).toBe("http:")
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
  }
  const database = new URL(process.env.DATABASE_URL ?? "")
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(database.hostname)
  expect(database.pathname).toContain("v3")
  await page.goto("/")
  await page.getByRole("button", { name: "登录", exact: true }).first().click()
  await page.locator("#auth-identifier").fill("demo_admin")
  await page.locator("#auth-password").fill("DaoYunLocalOnly!2026")
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/auth/login" && r.request().method() === "POST")
  await page.locator('[role="dialog"] button[type="submit"]').click()
  const loggedIn = await envelope(await response)
  const userId = loggedIn.data.user.id as string
  expect(userId).toMatch(/^[0-9a-f-]{36}$/i)
  await promisify(execFile)(process.env.DAOYUN_PSQL ?? "psql", ["--dbname=" + process.env.DATABASE_URL!, "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--command=DELETE FROM community_quota_usage WHERE user_id = '" + userId + "'::uuid"], { windowsHide: true, encoding: "utf8", timeout: 10_000 })
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

async function openComposer(page: Page) {
  await page.getByRole("button", { name: /发布新主题/ }).first().click()
  const composer = page.getByRole("dialog", { name: "发布内容" })
  await expect(composer).toBeVisible()
  return composer
}

async function envelope(response: Response) {
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  expect([200, 201]).toContain(response.status())
  return body
}

async function screenshots(page: Page, info: TestInfo, name: string) {
  expect(pageErrors.get(page)).toEqual([])
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
}

test("confirms an accepted publication after a lost response and a full reload", async ({ page }, info) => {
  await login(page)
  const body = "V3 原幂等请求恢复 " + crypto.randomUUID()
  const requests: { key: string; input: unknown; status: number; topicId: string }[] = []
  await page.route("**/api/v1/topics", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return }
    const accepted = await route.fetch()
    const payload = await accepted.json()
    expect(payload.meta.request_id).toBe(accepted.headers()["x-request-id"])
    requests.push({ key: route.request().headers()["idempotency-key"], input: route.request().postDataJSON(), status: accepted.status(), topicId: payload.data.id })
    if (requests.length === 1) { expect(accepted.status()).toBe(201); await route.abort("failed") }
    else { expect(accepted.status()).toBe(200); await route.fulfill({ response: accepted }) }
  })
  let composer = await openComposer(page)
  await composer.getByRole("textbox", { name: "正文", exact: true }).fill(body)
  await composer.getByRole("button", { name: "发布", exact: true }).click()
  await expect(composer.getByText(/发布结果尚未确认/)).toBeVisible()
  await composer.getByRole("button", { name: "关闭发布窗口" }).click()
  await page.getByRole("button", { name: "确认关闭", exact: true }).click()
  await expect(composer).toHaveCount(0)
  await page.reload()
  composer = await openComposer(page)
  await expect(composer.getByText(/发布结果尚未确认/)).toBeVisible()
  await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
  await screenshots(page, info, "uncertain-restored")
  await composer.getByRole("button", { name: "发布", exact: true }).click()
  await expect(page).toHaveURL(new RegExp("/t/" + requests[0].topicId + "$"))
  expect(requests).toHaveLength(2)
  expect(requests[1].key).toBe(requests[0].key)
  expect(requests[1].input).toEqual(requests[0].input)
  expect(requests[1].topicId).toBe(requests[0].topicId)
  const count = await promisify(execFile)(process.env.DAOYUN_PSQL ?? "psql", ["--dbname=" + process.env.DATABASE_URL!, "--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--command=SELECT COUNT(*) FROM topics WHERE content LIKE '%" + body.split(" ").at(-1) + "'"], { windowsHide: true })
  expect(count.stdout.trim()).toBe("1")
  expect(pageErrors.get(page)).toEqual([])
  await writeFile(info.outputPath("publication-request-evidence.json"), JSON.stringify({ requests, row_count: 1 }, null, 2), "utf8")
})

test("retries only the failed image and keeps the selected order in the real post", async ({ page }, info) => {
  await login(page)
  const body = "V3 图片部分失败排序 " + crypto.randomUUID()
  const uploads: number[] = []
  await page.route("**/api/v1/attachments/drafts", async route => {
    uploads.push(uploads.length + 1)
    if (uploads.length === 2) await route.abort("failed")
    else await route.continue()
  })
  const composer = await openComposer(page)
  await composer.getByRole("textbox", { name: "正文", exact: true }).fill(body)
  await expect(composer.getByLabel("选择帖子图片")).toBeEnabled()
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  await composer.getByLabel("选择帖子图片").setInputFiles(["first.png", "retry.png", "third.png"].map(name => ({ name, mimeType: "image/png", buffer: png })))
  await expect(composer.getByText("已上传 2 / 9 张", { exact: true })).toBeVisible()
  await composer.getByRole("button", { name: "前移图片 3", exact: true }).click()
  await composer.getByRole("button", { name: "重试图片 3", exact: true }).click()
  await expect(composer.getByText("已上传 3 / 9 张", { exact: true })).toBeVisible()
  expect(uploads).toHaveLength(4)
  const imageNames = await composer.locator(".composer-image-item img").evaluateAll(images => images.map(image => image.getAttribute("alt")))
  expect(imageNames).toEqual(["first.png", "third.png", "retry.png"])
  const imageIds = await composer.locator(".composer-image-item img").evaluateAll(images => images.map(image => new URL((image as HTMLImageElement).src).pathname.split("/")[4]))
  await screenshots(page, info, "retry-ordered")
  const published = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/topics")
  await composer.getByRole("button", { name: "发布", exact: true }).click()
  const response = await published
  const payload = await envelope(response)
  expect(response.status()).toBe(201)
  const input = response.request().postDataJSON()
  expect(input.rich_content.content.filter((node: { type: string }) => node.type === "image").map((node: { attrs: { attachmentId: string } }) => node.attrs.attachmentId)).toEqual(imageIds)
  expect(payload.data.media_urls).toHaveLength(3)
  expect(pageErrors.get(page)).toEqual([])
  await writeFile(info.outputPath("image-retry-evidence.json"), JSON.stringify({ uploads: uploads.length, imageNames, imageIds, topicId: payload.data.id }, null, 2), "utf8")
})

test.describe("browser storage disabled", () => {
  test("retains live text when both local storage and cloud saving fail", async ({ playwright }, info) => {
    const browser = await playwright.chromium.launch({ executablePath: resolveChromiumExecutable(), args: ["--no-sandbox", "--disable-local-storage"] })
    const context = await browser.newContext({ baseURL: process.env.DAOYUN_WEB_URL, viewport: info.project.use.viewport })
    const page = await context.newPage()
    try {
    await login(page)
    await page.route("**/api/v1/users/me/drafts/*", route => route.abort("failed"))
    const composer = await openComposer(page)
    const body = "V3 双重保存失败 " + crypto.randomUUID()
    await composer.getByRole("textbox", { name: "正文", exact: true }).fill(body)
    await expect(composer.getByText("本机保存失败，正文仍在当前窗口", { exact: true })).toBeVisible()
    await composer.getByRole("button", { name: "关闭发布窗口" }).click()
    const confirmation = page.getByRole("alertdialog", { name: "关闭发布窗口？" })
    await expect(confirmation.getByRole("button", { name: "取消", exact: true })).toBeFocused()
    await expect(confirmation).not.toContainText("当前内容已保存为本地草稿")
    await confirmation.getByRole("button", { name: "确认关闭", exact: true }).click()
    await expect(confirmation.getByRole("alert")).toContainText("本机和云端均未保存")
    await expect(composer.getByRole("textbox", { name: "正文", exact: true })).toHaveText(body)
    await screenshots(page, info, "both-save-failed")
    await confirmation.getByRole("button", { name: "取消", exact: true }).click()
    await composer.getByRole("button", { name: "复制正文", exact: true }).click()
    await expect(composer.getByText(/正文已复制|请选择并手动复制下方正文/)).toBeVisible()
    expect(pageErrors.get(page)).toEqual([])
    await writeFile(info.outputPath("storage-failure-evidence.json"), JSON.stringify({ local_storage_disabled: true, cloud_failure: true, editor_retained: true, body }, null, 2), "utf8")
    } finally { await browser.close() }
  })
})
