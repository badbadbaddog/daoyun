import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { assertNoHorizontalOverflow, mockPublicApi, publicTopicFixture, requestId, topicId } from "./fixtures"

const urls = Array.from({ length: 9 }, (_, index) => `/api/v1/attachments/019fc700-0000-7000-8000-00000000030${index}/thumbnail`)
const summary = { ...publicTopicFixture, image_url: urls[0], image_urls: urls.slice(0, 3), visible_image_count: 9 }
const detail = { ...summary, media_urls: urls, content: "九图正文", rich_content: null, content_revision: 1, has_locked_content: false }

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`authorized nine-image viewer at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await mockPublicApi(page)
    await page.route("**/api/v1/feed?**", route => route.fulfill({ json: { data: [summary], meta: { request_id: requestId, next_cursor: null } } }))
    await page.route(`**/api/v1/topics/${topicId}`, route => route.fulfill({ json: { data: detail, meta: { request_id: requestId } } }))
    await page.route("**/api/v1/attachments/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#dbeafe"/></svg>' }))
    await page.goto("/")
    const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: summary.title }) })
    await expect(row.locator(".topic-cover img")).toHaveCount(3)
    await expect(row.getByText("+6", { exact: true })).toBeVisible()
    const trigger = row.getByRole("button", { name: "查看第 3 张图片" })
    await trigger.click()
    const dialog = page.getByRole("dialog", { name: "图片预览" })
    await expect(dialog.getByText("3 / 9", { exact: true })).toBeVisible()
    await expect(dialog.getByRole("img")).toHaveAttribute("src", urls[2])
    await page.keyboard.press("ArrowRight")
    await expect(dialog.getByText("4 / 9", { exact: true })).toBeVisible()
    for (let next = 5; next <= 9; next++) await page.keyboard.press("ArrowRight")
    await expect(dialog.getByText("9 / 9", { exact: true })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "下一张" })).toBeDisabled()
    await expect(page).not.toHaveURL(/#topic/)
    expect((await new AxeBuilder({ page }).include(".image-preview-dialog").analyze()).violations).toEqual([])
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("nine-image-viewer.png") })
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath("three-image-preview.png") })
    expect(errors).toEqual([])
  })
}

test("gallery loading failure can retry and close without opening the post", async ({ page }) => {
  await mockPublicApi(page)
  await page.route("**/api/v1/feed?**", route => route.fulfill({ json: { data: [summary], meta: { request_id: requestId, next_cursor: null } } }))
  let attempts = 0
  await page.route(`**/api/v1/topics/${topicId}`, route => {
    attempts++
    return attempts === 1 ? route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "暂不可用" }, meta: { request_id: requestId } } }) : route.fulfill({ json: { data: detail, meta: { request_id: requestId } } })
  })
  await page.goto("/")
  const trigger = page.getByRole("button", { name: "查看第 1 张图片" })
  await trigger.click()
  const dialog = page.getByRole("dialog", { name: "图片预览" })
  await expect(dialog.getByRole("alert")).toHaveText("图片列表加载失败，请重试。")
  await expect(dialog.getByRole("img")).toHaveCount(0)
  await dialog.getByRole("button", { name: "重试加载图片" }).click()
  await expect(dialog.getByText("1 / 9", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "关闭图片预览" }).click()
  await expect(trigger).toBeFocused()
  await expect(page).not.toHaveURL(/#topic/)
  expect(attempts).toBe(2)
})

for (const width of [390, 1440]) {
  test(`nine body images remain one ordered gallery at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPublicApi(page)
    const rich_content = { type: "doc", content: urls.map((url, index) => ({ type: "image", attrs: { attachmentId: url.split("/")[4], alt: `正文图片 ${index + 1}` } })) }
    await page.route(`**/api/v1/topics/${topicId}`, route => route.fulfill({ json: { data: { ...detail, rich_content }, meta: { request_id: requestId } } }))
    await page.route("**/api/v1/attachments/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#dbeafe"/></svg>' }))
    await page.goto(`/#topic/${topicId}`)
    const body = page.locator(".topic-detail .rich-text-content").first()
    await expect(body.locator(".rich-text-image-strip")).toHaveCount(1)
    await expect(body.getByRole("img")).toHaveCount(5)
    await expect(body.getByText("+4", { exact: true })).toBeVisible()
    const trigger = body.getByRole("button", { name: "预览图片：正文图片 5", exact: true })
    await trigger.click()
    const dialog = page.getByRole("dialog", { name: "图片预览" })
    await expect(dialog.getByText("5 / 9", { exact: true })).toBeVisible()
    for (let next = 6; next <= 9; next++) await page.keyboard.press("ArrowRight")
    await expect(dialog.getByRole("img", { name: "正文图片 9" })).toHaveAttribute("src", urls[8])
    await expect(body.getByRole("img")).toHaveCount(5)
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("nine-body-images.png") })
    await page.keyboard.press("Escape")
    await expect(trigger).toBeFocused()
  })
}

test("filtered private, deleted and unscanned images are never requested", async ({ page }) => {
  await mockPublicApi(page)
  const publicUrls = urls.slice(3)
  const filtered = { ...summary, image_url: publicUrls[0], image_urls: publicUrls.slice(0, 3), visible_image_count: 6 }
  const requested: string[] = []
  page.on("request", request => { if (request.url().includes("/attachments/")) requested.push(new URL(request.url()).pathname) })
  await page.route("**/api/v1/feed?**", route => route.fulfill({ json: { data: [filtered], meta: { request_id: requestId, next_cursor: null } } }))
  await page.route(`**/api/v1/topics/${topicId}`, route => route.fulfill({ json: { data: { ...detail, ...filtered, media_urls: publicUrls }, meta: { request_id: requestId } } }))
  await page.route("**/api/v1/attachments/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#dbeafe"/></svg>' }))
  await page.goto("/")
  await expect(page.getByText("+3", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "查看第 3 张图片" }).click()
  const dialog = page.getByRole("dialog", { name: "图片预览" })
  await expect(dialog.getByText("3 / 6", { exact: true })).toBeVisible()
  for (let next = 4; next <= 6; next++) await page.keyboard.press("ArrowRight")
  await expect(dialog.getByRole("img")).toHaveAttribute("src", publicUrls[5])
  expect(requested.length).toBeGreaterThan(0)
  expect(requested.every(url => publicUrls.includes(url))).toBe(true)
  expect(requested.some(url => urls.slice(0, 3).includes(url))).toBe(false)
})
