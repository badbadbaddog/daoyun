import { expect, test } from "@playwright/test"

import { assertNoHorizontalOverflow } from "./fixtures"

// 匿名只读真实 API；不拦截请求，不写入/清理现有数据库。
test.skip(process.env.DAOYUN_LOCAL_E2E !== "1", "需要本地 PostgreSQL/API/gateway")

for (const width of [320, 390, 768, 1024, 1440]) {
  test("real API board directory and current-board scope at " + width + "px", async ({ page }, testInfo) => {
    const issues: string[] = []
    page.on("pageerror", error => issues.push(error.message))
    page.on("console", message => { if (["error", "warning"].includes(message.type()) && !message.text().includes("401 (Unauthorized)")) issues.push(message.text()) })
    page.on("response", response => { if (response.status() >= 400 && response.status() !== 401) issues.push(response.status() + " " + new URL(response.url()).pathname) })
    page.on("requestfailed", request => { if (request.failure()?.errorText !== "net::ERR_ABORTED") issues.push(request.failure()?.errorText + " " + new URL(request.url()).pathname) })
    await page.addInitScript(() => window.addEventListener("unhandledrejection", event => { throw new Error(String(event.reason)) }))
    await page.setViewportSize({ width, height: 900 })
    const boards: { id: string; slug: string; name: string; child_count: number; topic_count: number }[] = []
    let cursor: string | null = null
    do {
      const response = await page.request.get("/api/v1/boards?limit=50" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""))
      expect(response.status()).toBe(200)
      const payload = await response.json()
      expect(response.headers()["x-request-id"]).toBe(payload.meta.request_id)
      boards.push(...payload.data)
      cursor = payload.meta.next_cursor
    } while (cursor)
    expect(boards.length).toBeGreaterThan(0)
    const selected = boards.find(board => board.child_count > 0 && board.topic_count > 0) ?? boards.find(board => board.topic_count > 0)!
    expect(selected).toBeDefined()
    await page.goto("/#boards")
    await expect(page.getByRole("heading", { name: "版块", level: 1 })).toBeVisible()
    await expect(page.getByText(boards.length + " 个可见版块", { exact: true })).toBeVisible()
    await expect(page.locator('.board-directory-page a[href="#board/' + selected.slug + '"]')).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("live-directory-" + width + ".png"), fullPage: true })

    const detailPromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/boards/" + selected.slug && response.status() === 200)
    const topicsPromise = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/v1/topics" && url.searchParams.get("board") === selected.slug && response.status() === 200 })
    await page.locator('.board-directory-page a[href="#board/' + selected.slug + '"]').click()
    const detailResponse = await detailPromise
    const detail = await detailResponse.json()
    expect(detailResponse.headers()["x-request-id"]).toBe(detail.meta.request_id)
    const topicsResponse = await topicsPromise
    const topics = await topicsResponse.json()
    expect(topicsResponse.headers()["x-request-id"]).toBe(topics.meta.request_id)
    expect(topics.data.every((topic: { board: { slug: string } }) => topic.board.slug === selected.slug)).toBe(true)
    await expect(page.getByRole("heading", { name: selected.name, level: 1 })).toBeVisible()
    await expect(page.locator(".board-topic-feed .topic-row")).toHaveCount(topics.data.length)
    await expect(page.getByText("仅显示本版帖子", { exact: true })).toBeVisible()
    await expect(page.locator(".board-topic-feed .lucide-eye")).toHaveCount(0)
    if (!detail.data.viewer.can_create_topic) await expect(page.getByRole("button", { name: "发帖", exact: true })).toHaveCount(0)
    if (detail.data.children.length) {
      const children = page.getByRole("region", { name: "子版块导航" })
      await expect(children.getByRole("link")).toHaveCount(detail.data.children.length)
      for (const child of detail.data.children) await expect(children.locator('a[href="#board/' + child.slug + '"]')).toBeVisible()
    }
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("live-board-" + width + ".png"), fullPage: true })
    if (detail.data.children.length) {
      const child = detail.data.children[0]
      await page.getByRole("region", { name: "子版块导航" }).locator('a[href="#board/' + child.slug + '"]').click()
      await expect(page.getByRole("heading", { name: child.name, level: 1 })).toBeVisible()
      await expect(page.getByRole("navigation", { name: "社区路径" }).getByRole("link", { name: selected.name, exact: true })).toHaveAttribute("href", "#board/" + selected.slug)
      await assertNoHorizontalOverflow(page)
    }
    expect(issues).toEqual([])
    await testInfo.attach("real-board-api-evidence", { body: JSON.stringify({ width, boardCount: boards.length, boardId: selected.id, currentBoardOnly: true, loadedTopics: topics.data.length, children: detail.data.children.map((child: { id: string }) => child.id), viewer: detail.data.viewer, requestIds: [detail.meta.request_id, topics.meta.request_id] }), contentType: "application/json" })
  })
}
