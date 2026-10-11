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
    const rows = page.locator(".topic-list > .topic-row--list")
    await expect(rows).toHaveCount(6)
    await expect(page.locator(".home-showcase, .composer-prompt, .topic-list .topic-cover")).toHaveCount(0)
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
    for (const row of await rows.all()) {
      await expect(row.locator(".topic-list-avatar")).toBeVisible()
      await expect(row.locator(".topic-list-meta")).toBeVisible()
      await expect(row.getByRole("group", { name: "主题统计" })).toBeVisible()
      await expect(row.locator('.topic-list-stats [title*="次浏览"]')).toHaveCount(1)
    }
    const firstRow = rows.first()
    await firstRow.getByRole("button", { name: /^主题操作：/ }).click()
    await expect(firstRow.getByRole("menuitem", { name: "点赞", exact: true })).toBeVisible()
    await expect(firstRow.getByRole("menuitem", { name: "收藏", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    if (width < 1280) {
      const navigationTrigger = page.getByRole("button", { name: "打开导航" })
      await navigationTrigger.click()
      const navigation = page.getByRole("dialog", { name: "浏览社区" })
      await expect(navigation.getByRole("link", { name: "收藏" })).toBeVisible()
      await expect(navigation.getByRole("link", { name: "质量文档" })).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(navigationTrigger).toBeFocused()
    } else {
      await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible()
    }
    await expect(page.locator(".left-sidebar")).toHaveCount(0)
    if (width < 768) await expect(page.locator(".mobile-navigation")).toBeVisible()
    else await expect(page.locator(".mobile-navigation")).toBeHidden()
    if (width < 1024) await expect(page.locator(".right-sidebar")).toBeHidden()
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
  if ((page.viewportSize()?.width ?? 0) < 768) await page.getByRole("button", { name: "打开导航" }).click()
  await page.getByRole("button", { name: "切换深色模式" }).filter({ visible: true }).click()
  if ((page.viewportSize()?.width ?? 0) < 768) await page.keyboard.press("Escape")
  const darkResult = await new AxeBuilder({ page }).analyze()
  expect(darkResult.violations, JSON.stringify(darkResult.violations)).toEqual([])
  const title = page.locator(".topic-list .topic-title").first()
  await title.focus()
  await expect(title).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "一条关于 Rust 的主题", level: 1 })).toBeVisible()
})

for (const count of [1, 2, 3]) {
  test(`preserves ${count} profile previews without empty columns and opens the viewer`, async ({ page }) => {
    await mockPublicApi(page)
    const images = Array.from({ length: count }, (_, index) => `https://cdn.example.com/preview-${index}.svg`)
    await page.route("https://cdn.example.com/preview-*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dbeafe"/></svg>' }))
    await page.route("**/api/v1/topics?author=quality_author*", route => route.fulfill({ json: { data: [{ ...publicTopicFixture, image_urls: images, image_url: images[0], visible_image_count: images.length }], meta: { request_id: requestId, next_cursor: null } } }))
    await page.goto("/#user/quality_author")
    const preview = page.locator(".topic-list .topic-cover")
    await expect(preview.locator("img")).toHaveCount(count)
    const columns = await preview.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length)
    expect(columns).toBe(count)
    for (const image of await preview.locator("img").all()) {
      const bounds = await image.boundingBox()
      expect(bounds!.width).toBeGreaterThan(0)
      expect(bounds!.height).toBeGreaterThan(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    }
    const trigger = preview.getByRole("button", { name: "查看第 1 张图片" })
    await trigger.click()
    await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(trigger).toBeFocused()
    await assertNoHorizontalOverflow(page)
  })
}

test("theme switching keeps navigation and list text readable on every frame",async({page})=>{
  await page.setViewportSize({width:1440,height:900})
  await mockPublicApi(page)
  await page.goto("/#hot")
  await expect(page.locator(".topic-list > .topic-row")).toHaveCount(6)
  await page.evaluate(()=>{document.documentElement.dataset.brandPreset="high_contrast"})
  await page.getByRole("button",{name:"切换深色模式"}).click()
  const ratios=await page.locator(".header-primary-nav > a[aria-current=page]").evaluate(async element=>{
    const canvas=document.createElement("canvas")
    canvas.width=canvas.height=1
    const context=canvas.getContext("2d",{willReadFrequently:true})!
    const luminance=(color:string)=>{
      context.clearRect(0,0,1,1)
      context.fillStyle=color
      context.fillRect(0,0,1,1)
      const channels=[...context.getImageData(0,0,1,1).data].slice(0,3).map(value=>{
        const channel=value/255
        return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4
      })
      return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722
    }
    const row=document.querySelector(".topic-list > .topic-row")!
    const pairs=[
      [element,document.querySelector(".site-header")!],
      [row.querySelector(".topic-title h2")!,row],
      [row.querySelector(".topic-list-meta a")!,row],
    ]
    const ratios:number[]=[]
    const start=performance.now()
    while(performance.now()-start<200){
      for(const [textElement,backgroundElement] of pairs){
        const foreground=luminance(getComputedStyle(textElement).color)
        const background=luminance(getComputedStyle(backgroundElement).backgroundColor)
        ratios.push((Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05))
      }
      await new Promise(requestAnimationFrame)
    }
    return ratios
  })
  expect(ratios.length).toBeGreaterThan(1)
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5)
})
