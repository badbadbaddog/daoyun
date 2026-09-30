import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { assertNoHorizontalOverflow, mockPublicApi, publicTopicFixture, requestId } from "./fixtures"

// UI 夹具回归；真实 API 验收另行记录。
const pageIssues = new WeakMap<import("@playwright/test").Page, string[]>()
test.beforeEach(async ({ page }) => {
  const issues: string[] = []
  page.on("pageerror", error => issues.push(error.message))
  page.on("console", message => {
    if (["error", "warning"].includes(message.type()) && !message.text().includes("401 (Unauthorized)")) issues.push(message.text())
  })
  page.on("response", response => {
    if (response.status() >= 400 && response.status() !== 401) issues.push(`${response.status()} ${new URL(response.url()).pathname}`)
  })
  page.on("requestfailed", request => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") issues.push(`${request.failure()?.errorText} ${new URL(request.url()).pathname}`)
  })
  await page.addInitScript(() => window.addEventListener("unhandledrejection", event => { throw new Error(String(event.reason)) }))
  pageIssues.set(page, issues)
})
test.afterEach(async ({ page }) => { expect(pageIssues.get(page)).toEqual([]) })

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`home remains a single content column at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockPublicApi(page)
    await page.goto("/#hot")
    const rows = page.locator(".topic-list > .topic-row")
    await expect(rows).toHaveCount(6)
    await expect(page.locator(".home-showcase")).toHaveCount(0)
    await expect(page.locator("h1")).toHaveCount(1)
    const layout = await page.locator(".topic-list").evaluate(element => {
      const items = [...element.querySelectorAll<HTMLElement>(".topic-row")]
      return {
        columns: getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,
        positions: items.map(item => { const rect = item.getBoundingClientRect(); return { x: rect.x, width: rect.width } }),
      }
    })
    expect(layout.columns).toBe(1)
    expect(new Set(layout.positions.map(position => position.x)).size).toBe(1)
    expect(layout.positions[0].width).toBeLessThanOrEqual(800)
    const textRow = page.locator('.topic-list > [data-layout="discussion"]').first()
    await expect(textRow.locator(".topic-cover")).toHaveCount(0)
    expect(await textRow.evaluate(element => getComputedStyle(element, "::before").content)).toBe("none")
    const mediaRow = page.locator('.topic-list > [data-layout="media"]').first()
    const image = await mediaRow.locator(".topic-cover img").first().boundingBox()
    expect(image).not.toBeNull()
    expect(Math.abs(image!.width - image!.height)).toBeLessThanOrEqual(1)
    const readingOrder = await mediaRow.evaluate(element => {
      const metadata = element.querySelector(".topic-meta")!
      const body = element.querySelector(".topic-title")!
      return Boolean(metadata.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(readingOrder).toBe(true)
    await expect(mediaRow.locator('.topic-stats [title*="次浏览"]')).toHaveCount(0)
    const controls = mediaRow.getByRole("group", { name: "主题操作" }).locator("button, a")
    expect(await controls.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")?.split("主题")[0])))
      .toEqual(["点赞", "回复", "收藏"])
    if (width < 768) {
      for (const control of await controls.all()) {
        const rect = await control.boundingBox()
        expect(rect!.height).toBeGreaterThanOrEqual(44)
        expect(rect!.width).toBeGreaterThanOrEqual(44)
      }
      for (const control of await page.locator(".header-mobile-search-toggle, .header-actions > button:visible").all()) {
        const rect = await control.boundingBox()
        expect(rect!.width).toBeGreaterThanOrEqual(44)
        expect(rect!.height).toBeGreaterThanOrEqual(44)
      }
      expect(await page.getByRole("button", { name: "登录", exact: true }).evaluate(element => { const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()); const range = document.createRange(); range.selectNodeContents(text!); return range.getClientRects().length })).toBe(1)
      await expect(page.locator(".mobile-navigation")).toBeVisible()
      const navigationTrigger = page.getByRole("button", { name: "打开导航" })
      await navigationTrigger.click()
      const navigation = page.getByRole("dialog", { name: "浏览社区" })
      await expect(navigation.getByRole("link", { name: "收藏" })).toBeVisible()
      await expect(navigation.getByRole("link", { name: "质量文档" })).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(navigationTrigger).toBeFocused()
    } else {
      await expect(page.locator(".left-sidebar")).toBeVisible()
      const navigationBounds = await page.locator(".left-sidebar > .sidebar-nav").evaluateAll(elements => elements.slice(0, 2).map(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom } }))
      expect(navigationBounds[1].top).toBeGreaterThanOrEqual(navigationBounds[0].bottom)
      if (width >= 1024) {
        for (const label of await page.locator(".left-sidebar > .sidebar-nav:first-child .sidebar-link > span, .tag-filter > span").all()) {
          expect(await label.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); return range.getClientRects().length })).toBe(1)
        }
      }
      await expect(page.locator(".mobile-navigation")).toBeHidden()
    }
    if (width < 1280) await expect(page.locator(".right-sidebar")).toBeHidden()
    else await expect(page.locator(".right-sidebar")).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true })
  })
}

test("home keeps contrast, focus and layout across existing theme presets", async ({ page }) => {
  await mockPublicApi(page)
  await page.goto("/#hot")
  await expect(page.locator(".topic-list > .topic-row")).toHaveCount(6)
  for (const preset of ["default", "compact", "high_contrast"]) {
    await page.evaluate(value => { document.documentElement.dataset.brandPreset = value }, preset)
    const result = await new AxeBuilder({ page }).analyze()
    expect(result.violations, JSON.stringify(result.violations)).toEqual([])
    await assertNoHorizontalOverflow(page)
  }
  await page.getByRole("button", { name: "切换深色模式" }).click()
  const darkResult = await new AxeBuilder({ page }).analyze()
  expect(darkResult.violations, JSON.stringify(darkResult.violations)).toEqual([])
  const title = page.locator(".topic-list .topic-title").first()
  await title.focus()
  await expect(title).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "一条关于 Rust 的主题", level: 1 })).toBeVisible()
})

for (const count of [1, 2, 3]) {
  test(`renders ${count} square previews without empty columns and opens the viewer`, async ({ page }) => {
    await mockPublicApi(page)
    const images = Array.from({ length: count }, (_, index) => `https://cdn.example.com/preview-${index}.svg`)
    await page.route("https://cdn.example.com/preview-*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dbeafe"/></svg>' }))
    await page.route("**/api/v1/feed?**", route => route.fulfill({ json: { data: [{ ...publicTopicFixture, image_urls: images, image_url: images[0], visible_image_count: images.length }], meta: { request_id: requestId, next_cursor: null } } }))
    await page.goto("/#hot")
    const preview = page.locator(".topic-list .topic-cover")
    await expect(preview.locator("img")).toHaveCount(count)
    const columns = await preview.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length)
    expect(columns).toBe(count)
    for (const image of await preview.locator("img").all()) {
      const bounds = await image.boundingBox()
      expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThanOrEqual(1)
      if (count === 1) expect(bounds!.width).toBeLessThanOrEqual(240)
    }
    const trigger = preview.getByRole("button", { name: "查看第 1 张图片" })
    await trigger.click()
    await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(trigger).toBeFocused()
    await assertNoHorizontalOverflow(page)
  })
}
