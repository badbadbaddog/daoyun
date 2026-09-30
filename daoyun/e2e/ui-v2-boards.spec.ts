import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { assertNoHorizontalOverflow, boardId, mockPublicApi, publicTopicFixture, requestId, topicId } from "./fixtures"

// 隔离 UI 夹具；真实 API 与权限核验分别记录。
const parent = { id: boardId, parent_id: null, slug: "engineering", name: "工程实践", description: "本版工程讨论", icon: "code", tone: "blue", position: 0, depth: 0, child_count: 3, topic_count: 3 }
const boards = [
  parent,
  { ...parent, id: "019fc700-0000-7000-8000-000000000010", parent_id: boardId, slug: "frontend", name: "前端开发", depth: 1, child_count: 1, topic_count: 1 },
  { ...parent, id: "019fc700-0000-7000-8000-000000000011", parent_id: "019fc700-0000-7000-8000-000000000010", slug: "css", name: "CSS", depth: 2, child_count: 0, topic_count: 1 },
  { ...parent, id: "019fc700-0000-7000-8000-000000000012", parent_id: boardId, slug: "languages", name: "编程语言与社区工具的长期实践", depth: 1, child_count: 0, topic_count: 0 },
  { ...parent, id: "019fc700-0000-7000-8000-000000000013", parent_id: boardId, slug: "readonly", name: "只读资料", depth: 1, child_count: 0, topic_count: 0 },
  { ...parent, id: "019fc700-0000-7000-8000-000000000014", slug: "design", name: "产品设计", position: 10, child_count: 1, topic_count: 0 },
  { ...parent, id: "019fc700-0000-7000-8000-000000000015", parent_id: "019fc700-0000-7000-8000-000000000014", slug: "design-css", name: "CSS", depth: 1, child_count: 0, topic_count: 0 },
]
const imageOnlyId = "019fc700-0000-7000-8000-000000000099"
const parentPosts = [
  publicTopicFixture,
  { ...publicTopicFixture, id: "019fc700-0000-7000-8000-000000000098", title: "版块公告", image_url: null, visible_image_count: 0, media_urls: [], is_pinned: true },
  { ...publicTopicFixture, id: imageOnlyId, title: "", excerpt: "", image_urls: [publicTopicFixture.image_url], is_featured: true },
]

async function mockBoards(page: import("@playwright/test").Page) {
  await mockPublicApi(page)
  await page.route("**/api/v1/boards**", async route => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/v1/boards") {
      await route.fulfill({ json: { data: boards, meta: { request_id: requestId, next_cursor: null } } })
      return
    }
    const board = boards.find(item => path === "/api/v1/boards/" + item.slug)
    if (!board) {
      await route.fulfill({ status: 403, json: { error: { code: "board.forbidden", message: "无权访问" }, meta: { request_id: requestId } } })
      return
    }
    const ancestors = []
    let current: typeof boards[number] | undefined = board
    while (current) {
      ancestors.unshift({ id: current.id, slug: current.slug, name: current.name })
      current = boards.find(item => item.id === current!.parent_id)
    }
    await route.fulfill({ json: { data: { ...board, children: boards.filter(item => item.parent_id === board.id), breadcrumb: ancestors, viewer: { can_read: true, can_create_topic: board.slug !== "readonly", can_reply: board.slug !== "readonly", can_upload_attachment: false } }, meta: { request_id: requestId } } })
  })
  await page.route("**/api/v1/topics?**", async route => {
    const params = new URL(route.request().url()).searchParams
    const board = params.get("board")
    if (!board) { await route.fallback(); return }
    const data = (board === "engineering" ? parentPosts : [{ ...publicTopicFixture, title: "仅子版块的帖子", board: { ...publicTopicFixture.board, slug: board } }])
      .filter(item => !params.get("query") || item.title?.includes(params.get("query")!))
      .filter(item => params.get("featured") !== "true" || item.is_featured)
    await route.fulfill({ json: { data, meta: { request_id: requestId, next_cursor: null } } })
  })
  await page.route("**/api/v1/topics/" + imageOnlyId + "**", async route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith("/poll") ? null : path.endsWith("/replies") || path.endsWith("/supplements") ? [] : { ...parentPosts[2], content: "图片讨论", rich_content: null, has_locked_content: false, content_revision: 1 }
    await route.fulfill({ json: { data, meta: { request_id: requestId, next_cursor: null } } })
  })
}

const issuesByPage = new WeakMap<import("@playwright/test").Page, string[]>()
test.beforeEach(async ({ page }) => {
  const issues: string[] = []
  issuesByPage.set(page, issues)
  page.on("pageerror", error => issues.push(error.message))
  page.on("console", message => { if (["error", "warning"].includes(message.type()) && !message.text().includes("401 (Unauthorized)")) issues.push(message.text()) })
  page.on("response", response => { if (response.status() >= 400 && response.status() !== 401) issues.push(response.status() + " " + new URL(response.url()).pathname) })
  page.on("requestfailed", request => { if (request.failure()?.errorText !== "net::ERR_ABORTED") issues.push(request.failure()?.errorText + " " + new URL(request.url()).pathname) })
  await page.addInitScript(() => window.addEventListener("unhandledrejection", event => { throw new Error(String(event.reason)) }))
  await mockBoards(page)
})
test.afterEach(async ({ page }) => expect(issuesByPage.get(page)).toEqual([]))

for (const width of [320, 390, 768, 1024, 1440]) {
  test("board hierarchy, scope and navigation at " + width + "px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/#boards")
    const search = page.getByRole("searchbox", { name: "搜索版块", exact: true })
    await search.fill("CSS")
    await expect(page.getByText("工程实践 / 前端开发 / CSS", { exact: true })).toBeVisible()
    await expect(page.getByText("产品设计 / CSS", { exact: true })).toBeVisible()
    await page.locator('.board-directory-page a[href="#board/design-css"]').click()
    await expect(page.getByRole("heading", { name: "CSS", level: 1 })).toBeVisible()
    await page.goBack()
    await expect(search).toHaveValue("CSS")
    await page.getByRole("button", { name: "清除版块搜索" }).click()
    await page.getByRole("button", { name: "收起工程实践", exact: true }).click()
    await page.locator('.board-directory-page a[href="#board/engineering"]').click()
    await expect(page.getByRole("heading", { name: "工程实践", level: 1 })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole("button", { name: "展开工程实践", exact: true })).toHaveAttribute("aria-expanded", "false")
    await page.reload()
    await expect(page.getByRole("button", { name: "展开工程实践", exact: true })).toHaveAttribute("aria-expanded", "false")
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("directory-" + width + ".png"), fullPage: true })

    await page.goto("/#board/engineering")
    await expect(page.getByRole("heading", { name: "工程实践", level: 1 })).toBeVisible()
    const children = page.getByRole("region", { name: "子版块导航" })
    const pinned = page.getByRole("region", { name: "置顶", exact: true })
    const sorts = page.getByRole("group", { name: "主题排序" })
    await expect(pinned).toBeVisible()
    expect(await children.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector(".board-pinned-topics")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
    expect(await pinned.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector(".board-feed-tabs")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
    await expect(children.getByRole("link", { name: "前端开发", exact: true })).toHaveAttribute("href", "#board/frontend")
    await expect(children.locator("ul")).toHaveCSS("flex-wrap", "wrap")
    await expect(page.getByText("仅显示本版帖子", { exact: true })).toBeVisible()
    await expect(page.locator(".board-topic-list")).not.toContainText("仅子版块的帖子")
    await expect(pinned).toContainText("版块公告")
    await expect(pinned.getByText("查看图片帖")).toHaveCount(0)
    await expect(page.locator(".board-topic-feed .lucide-eye, .right-sidebar--board-detail .lucide-eye")).toHaveCount(0)
    await expect(page.locator(".board-topic-feed")).not.toContainText(/加入圈子|成员数|关注版块/)
    if (width < 768) {
      for (const control of await page.locator(".board-mobile-toolbar__action, .board-feed-tabs button, .board-children a, .board-header .primary-button, .board-topic-feed .topic-stats > button, .board-topic-feed .topic-stats > a").all()) {
        const box = await control.boundingBox()
        expect(box!.width).toBeGreaterThanOrEqual(44)
        expect(box!.height).toBeGreaterThanOrEqual(44)
      }
    }
    const boardSearch = page.getByRole("searchbox", { name: "搜索本版", exact: true })
    await expect(boardSearch).toHaveCSS("opacity", "1")
    expect((await boardSearch.boundingBox())!.width).toBeGreaterThan(100)
    for (const cover of await page.locator(".board-topic-feed .topic-cover").all()) {
      const box = await cover.boundingBox()
      expect(box!.width).toBe(56)
      expect(box!.height).toBe(56)
    }
    for (const time of await page.locator(".board-topic-feed .topic-meta time").all()) await expect(time).toBeVisible()
    const publishBox = (await page.getByRole("button", { name: "发帖", exact: true }).boundingBox())!
    expect(publishBox.x + publishBox.width).toBeLessThanOrEqual(width)
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("board-" + width + ".png"), fullPage: true })
    const imagePost = page.getByRole("link", { name: "查看图片帖", exact: true })
    await imagePost.focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(new RegExp("#topic/" + imageOnlyId + "$"))
    await page.goBack()
    await expect(page.getByRole("heading", { name: "工程实践", level: 1 })).toBeVisible()
    await page.getByRole("button", { name: "发帖", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "发布内容" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "板块" })).toHaveValue(boardId)
    await page.getByRole("button", { name: "关闭发布窗口" }).click()

    for (const [label, sort, apiSort] of [["活跃", "active", "active"], ["热门", "hot", "popular"], ["精华", "featured", "latest"], ["最新", "latest", "latest"]]) {
      const responsePromise = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/v1/topics" && url.searchParams.get("board") === "engineering" && url.searchParams.get("sort") === apiSort && (url.searchParams.get("featured") === "true") === (sort === "featured") })
      await sorts.getByRole("button", { name: label, exact: true }).click()
      await responsePromise
      await expect(sorts.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true")
      await page.reload()
      await expect(sorts.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true")
    }
    const queryResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get("query") === "Rust" && new URL(response.url()).searchParams.get("board") === "engineering")
    await page.getByRole("searchbox", { name: "搜索本版", exact: true }).fill("Rust")
    await queryResponse
    await page.reload()
    await expect(page.getByRole("searchbox", { name: "搜索本版", exact: true })).toHaveValue("Rust")
    await page.locator('.board-topic-list a[href="#topic/' + topicId + '"]').first().click()
    await expect(page.getByRole("heading", { name: publicTopicFixture.title, level: 1 })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole("searchbox", { name: "搜索本版", exact: true })).toHaveValue("Rust")
    await page.goto("/#board/readonly")
    await expect(page.getByRole("heading", { name: "只读资料", level: 1 })).toBeVisible()
    await expect(page.getByRole("button", { name: "发帖", exact: true })).toHaveCount(0)
    await expect(page.getByText("当前账号仅可浏览", { exact: true })).toBeVisible()
  })
}

for (const preset of ["default", "compact", "high_contrast", "dark"]) {
  test("board and directory accessibility under " + preset, async ({ page }) => {
    await page.setViewportSize({ width: preset === "compact" ? 390 : 1440, height: 900 })
    for (const hash of ["boards", "board/engineering"]) {
      await page.goto("/#" + hash)
      await expect(page.locator(".board-directory-link, .board-topic-list .topic-row").first()).toBeVisible()
      await page.evaluate(preset => { document.documentElement.dataset.brandPreset = preset === "dark" ? "default" : preset; document.documentElement.dataset.theme = preset === "dark" ? "dark" : "light" }, preset)
      const scan = await new AxeBuilder({ page }).analyze()
      expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([])
      await assertNoHorizontalOverflow(page)
    }
  })
}
