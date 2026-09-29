import { expect, test } from "@playwright/test"

import { assertNoHorizontalOverflow, boardId, mockPublicApi, requestId, topicId, userId } from "./fixtures"

for (const width of [320, 768, 1024, 1440]) {
  test(`previews content images at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await mockPublicApi(page)
    await page.route(`**/api/v1/topics/${topicId}`, (route) => route.fulfill({
      json: {
        data: {
          id: topicId, title: "图片预览测试", content: "点击图片查看完整内容。", excerpt: "点击图片查看完整内容。",
          author: { id: userId, username: "quality_author", display_name: "质量作者", avatar_url: null },
          board: { id: boardId, slug: "engineering", name: "工程实践", tone: "blue" },
          published_at: "2026-08-05T00:00:00Z", last_activity_at: "2026-08-05T00:00:00Z",
          reply_count: 2, like_count: 0, view_count: 10, viewer_bookmarked: null, viewer_liked: null,
          is_featured: false, is_pinned: false, tags: [], has_locked_content: false, content_revision: 1,
          rich_content: {
            type: "doc",
            content: Array.from({ length: 7 }, (_, index) => ({
              type: "image",
              attrs: { attachmentId: `0198d874-e991-7b62-8b38-3986f55c8d3${index + 1}`, alt: `图片 ${index + 1}` },
            })),
          },
        },
        meta: { request_id: requestId },
      },
    }))
    await page.route("**/api/v1/attachments/**", (route) => route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#dbeafe"/><circle cx="800" cy="500" r="300" fill="#2563eb"/></svg>',
    }))
    await page.route(`**/api/v1/topics/${topicId}/supplements`, (route) => route.fulfill({
      json: { data: [], meta: { request_id: requestId } },
    }))
    await page.goto(`/#topic/${topicId}`)
    await page.getByText("+2", { exact: true }).click({ timeout: 5000 })
    const dialog = page.getByRole("dialog", { name: "图片预览" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("img", { name: "图片 5" })).toBeVisible()
    await expect.poll(() => dialog.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1600)
    const previewImage = dialog.getByRole("img")
    const fitted = (await previewImage.boundingBox())!
    await dialog.getByRole("button", { name: "放大图片" }).click()
    await expect(dialog.getByLabel("缩放比例")).toHaveText("200%")
    expect((await previewImage.boundingBox())!.width).toBeGreaterThan(fitted.width * 1.9)
    await dialog.getByRole("button", { name: "适应窗口" }).click()

    const stage = dialog.getByRole("group", { name: "图片查看区域" })
    const stageBounds = (await stage.boundingBox())!
    const center = { x: stageBounds.x + stageBounds.width / 2, y: stageBounds.y + stageBounds.height / 2 }
    if (width <= 768) {
      expect((await dialog.boundingBox())!.height).toBe(900)
      const touch = await page.context().newCDPSession(page)
      await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 })
      const finger = (id: number, x: number, y: number) => ({ id, x, y, radiusX: 1, radiusY: 1, force: 1 })
      const slide = async (dx: number, dy = 0, canceled = false) => {
        await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(1, center.x, center.y)] })
        await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(1, center.x + dx, center.y + dy)] })
        await touch.send("Input.dispatchTouchEvent", { type: canceled ? "touchCancel" : "touchEnd", touchPoints: [] })
      }
      for (const [dx, expected] of [[-80, 6], [-80, 7], [-80, 7], [80, 6], [80, 5]]) {
        await slide(dx)
        await expect(dialog.getByRole("img", { name: `图片 ${expected}` })).toBeVisible()
        await expect.poll(() => previewImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1600)
        await expect(dialog.getByLabel("缩放比例")).toHaveText("100%")
      }
      await slide(-20)
      await slide(-80, 100)
      await slide(-80, 0, true)
      await expect(dialog.getByRole("img", { name: "图片 5" })).toBeVisible()
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(1, center.x - 30, center.y), finger(2, center.x + 30, center.y)] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(1, center.x - 90, center.y), finger(2, center.x + 90, center.y)] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      await expect.poll(async () => (await previewImage.boundingBox())!.width).toBeGreaterThan(fitted.width * 2.5)
      const enlarged = (await previewImage.boundingBox())!
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(1, center.x, center.y)] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(1, center.x + 50, center.y)] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      await expect.poll(async () => (await previewImage.boundingBox())!.x).toBeGreaterThan(enlarged.x + 30)
      expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1)
      await expect(dialog.getByRole("img", { name: "图片 5" })).toBeVisible()
      await dialog.getByRole("button", { name: "适应窗口" }).click()
      for (let tap = 0; tap < 2; tap += 1) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(1, center.x, center.y)] })
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      }
      await expect(dialog.getByLabel("缩放比例")).toHaveText("300%")
      await touch.detach()
    } else {
      await page.mouse.move(center.x, center.y)
      await page.mouse.wheel(0, -100)
      await expect(dialog.getByLabel("缩放比例")).not.toHaveText("100%")
      await stage.dblclick()
      await expect(dialog.getByLabel("缩放比例")).toHaveText("100%")
      await stage.dblclick()
      await expect(dialog.getByLabel("缩放比例")).toHaveText("300%")
      const enlarged = (await previewImage.boundingBox())!
      await page.mouse.move(center.x, center.y)
      await page.mouse.down()
      await page.mouse.move(center.x + 60, center.y, { steps: 3 })
      await page.mouse.up()
      expect((await previewImage.boundingBox())!.x).toBeGreaterThan(enlarged.x + 30)
    }
    await page.screenshot({ path: testInfo.outputPath("image-zoom.png") })
    await dialog.getByRole("button", { name: "下一张" }).click()
    await expect(dialog.getByLabel("缩放比例")).toHaveText("100%")
    await expect(dialog.getByRole("img", { name: "图片 6" })).toBeVisible()
    await page.keyboard.press("ArrowRight")
    await expect(dialog.getByRole("img", { name: "图片 7" })).toBeVisible()
    await page.keyboard.press("ArrowLeft")
    await expect(dialog.getByRole("img", { name: "图片 6" })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900)
    await page.screenshot({ path: testInfo.outputPath("image-preview.png") })
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole("button", { name: "预览图片：图片 5" })).toBeFocused()
    expect(errors).toEqual([])
  })
}
