import { expect, test } from "@playwright/test"

import { assertNoHorizontalOverflow } from "./fixtures"

// 仅进行匿名只读检查，不拦截 API，不创建或清理数据库内容。
test.skip(process.env.DAOYUN_LOCAL_E2E !== "1", "需要已运行的本地 PostgreSQL/API/gateway")

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`real API home renders authorized feed at ${width}px`, async ({ page }, testInfo) => {
    const issues: string[] = []
    page.on("pageerror", error => issues.push(error.message))
    page.on("console", message => {
      if (["error", "warning"].includes(message.type()) && !message.text().includes("401 (Unauthorized)")) issues.push(message.text())
    })
    page.on("requestfailed", request => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED") issues.push(`${request.failure()?.errorText} ${new URL(request.url()).pathname}`)
    })
    await page.addInitScript(() => window.addEventListener("unhandledrejection", event => { throw new Error(String(event.reason)) }))
    page.on("response", response => {
      if (response.status() >= 400 && response.status() !== 401) issues.push(`${response.status()} ${new URL(response.url()).pathname}`)
    })
    await page.setViewportSize({ width, height: 900 })
    const health = await page.request.get("/api/v1/health/ready")
    expect(health.status()).toBe(200)
    const healthPayload = await health.json()
    expect(health.headers()["x-request-id"]).toBe(healthPayload.meta.request_id)
    const feedPromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/feed" && response.status() === 200)
    await page.goto("/#hot")
    const feedResponse = await feedPromise
    const payload = await feedResponse.json()
    expect(payload.data.length).toBeGreaterThan(0)
    expect(feedResponse.headers()["x-request-id"]).toBe(payload.meta.request_id)
    const rows = page.locator(".topic-list > .topic-row")
    await expect(rows).toHaveCount(payload.data.length)
    await expect(rows.first().locator(`a[href="#topic/${payload.data[0].id}"]`).first()).toBeVisible()
    const columns = await page.locator(".topic-list").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length)
    expect(columns).toBe(1)
    await expect(page.locator(".topic-list .topic-stats [title*=次浏览]")).toHaveCount(0)
    await assertNoHorizontalOverflow(page)
    expect(issues).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`live-home-${width}.png`), fullPage: true })
    await testInfo.attach("real-api-evidence", { body: JSON.stringify({ width, feedMode: new URL(feedResponse.url()).searchParams.get("mode"), topicCount: payload.data.length, requestId: payload.meta.request_id }), contentType: "application/json" })
  })
}
