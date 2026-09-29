import { expect, test } from "@playwright/test"

import { boardId, mockPublicApi, requestId, userId } from "./fixtures"

const topicId = "019fc700-0000-7000-8000-000000000005"
const title = "如何设计一个真正适合讨论的社区首页？"

for (const width of [320, 1440]) {
  for (const listing of ["/", "/#board/engineering"]) {
    test(`opens a text post from its row at ${width}px on ${listing}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await mockPublicApi(page)
      await page.route(`**/api/v1/topics/${topicId}`, (route) => route.fulfill({
        json: {
          data: {
            id: topicId, title, excerpt: "讨论内容应该优先呈现观点与上下文。", content: "无图帖正文",
            author: { id: userId, username: "quality_author", display_name: "质量作者", avatar_url: null },
            board: { id: boardId, slug: "engineering", name: "工程实践", tone: "blue" },
            published_at: "2026-08-05T00:00:00Z", last_activity_at: "2026-08-05T00:00:00Z",
            reply_count: 0, like_count: 0, view_count: 10, viewer_bookmarked: null, viewer_liked: null,
            is_featured: false, is_pinned: false, tags: [], has_locked_content: false, content_revision: 1,
          },
          meta: { request_id: requestId },
        },
      }))
      await page.route(`**/api/v1/topics/${topicId}/replies*`, (route) => route.fulfill({
        json: { data: [], meta: { request_id: requestId, next_cursor: null } },
      }))
      await page.route(`**/api/v1/topics/${topicId}/supplements`, (route) => route.fulfill({
        json: { data: [], meta: { request_id: requestId } },
      }))

      const row = page.locator(".topic-row").filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      await page.goto(listing)
      await expect(row).toHaveAttribute("data-layout", "discussion")
      await expect(row).toHaveCSS("cursor", "pointer")
      await row.click({ position: { x: 4, y: 4 } })
      await expect(page).toHaveURL(new RegExp("#topic/" + topicId))
      await expect(page.getByText("无图帖正文", { exact: true })).toBeVisible()

      await page.goto(listing)
      if (listing === "/") {
        await row.locator(".topic-excerpt").click()
        await expect(page).toHaveURL(new RegExp("#topic/" + topicId))
        await expect(page.getByText("无图帖正文", { exact: true })).toBeVisible()
        await page.goto(listing)
      }
      await row.getByRole("link", { name: "质量作者", exact: true }).click()
      await expect(page).toHaveURL(/#user\/quality_author$/)
    })
  }
}
