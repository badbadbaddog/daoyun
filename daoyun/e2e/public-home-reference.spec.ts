import { expect, test, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { assertNoHorizontalOverflow, mockPublicApi, publicTopicFixture, requestId, userId } from "./fixtures"

const level = { id: "019fc700-0000-7000-8000-000000000051", internal_key: "traveler", level_order: 5, display_name: "达人", required_experience: 3000, color: null, description: "持续参与社区" }
const nextLevel = { ...level, id: "019fc700-0000-7000-8000-000000000052", internal_key: "expert", level_order: 6, display_name: "资深", required_experience: 10000 }
const wrap = (data: unknown) => ({ data, meta: { request_id: requestId, next_cursor: null } })

async function homeFixture(page: Page, signedIn = true) {
  await mockPublicApi(page)
  await page.route("**/home-test-image-*", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#dbeafe"/><path d="M0 600 320 120 600 480 860 60 1200 600Z" fill="#739ecb"/><path d="m700 280 160-220 180 290-180-110Z" fill="#f8fafc"/></svg>' }))
  const topics = [3, 1, 2, 0].map((count, index) => ({
    ...publicTopicFixture,
    id: "019fc700-0000-7000-8000-00000000010" + count,
    title: ["从 0 到 1：我用 DaoYun 搭建了自己的社区", "希望增加深色模式和自定义主题色", "周末随拍，记录生活里的美好", "聊聊你最近发现的好工具"][index],
    excerpt: "分享实践中的经验与想法，和社区伙伴一起探索更多可能。",
    author: { ...publicTopicFixture.author, username: "author_" + count, display_name: ["星辰大海", "清风与鹿", "程序猫", "设计师"][index] },
    image_url: count ? "https://cdn.example.com/home-test-image-" + count + "-0" : null,
    image_urls: Array.from({ length: count }, (_, image) => "https://cdn.example.com/home-test-image-" + count + "-" + image),
    visible_image_count: count,
    media_urls: [],
    is_pinned: index === 0, is_featured: index === 1,
    like_count: 128 - index * 24, reply_count: 32 - index * 4, view_count: 1200 - index * 100,
  }))
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/v1/site-branding") return route.fulfill({ json: wrap({ site_name: "刀云", logo_url: null, favicon_url: null, default_cover_url: null, navigation_links: [], footer_text: null, footer_links: [], primary_color: "#2563eb", accent_color: "#c85516", theme_preset: "default", list_density: "comfortable", home_mode: "hot" }) })
    if (path === "/api/v1/users/me/bookmarks") return route.fulfill({ json: wrap(topics) })
    if (path === "/api/v1/feed") return route.fulfill({ json: wrap(topics) })
    if (path === "/api/v1/auth/session" && signedIn) return route.fulfill({ json: wrap({ user: { id: userId, username: "quality_author", display_name: "本地测试管理员", email: "member@example.com" }, csrf_token: "a".repeat(64) }) })
    if (path === "/api/v1/users/me/membership") return route.fulfill({ json: wrap({ user_id: userId, points_balance: 1280, lifetime_points: 2000, level_key: "traveler", level_number: 5, level_display_name: "达人", revision: 1, updated_at: "2026-10-11T00:00:00Z" }) })
    if (path === "/api/v1/users/me/experience") return route.fulfill({ json: wrap({ experience: 4880, current_level: level, revision: 1, updated_at: "2026-10-11T00:00:00Z" }) })
    if (path === "/api/v1/membership/levels") return route.fulfill({ json: wrap([level, nextLevel]) })
    if (path === "/api/v1/users/quality_author") return route.fulfill({ json: wrap({ id: userId, username: "quality_author", display_name: "本地测试管理员", avatar_url: null, bio: "", location: null, website_url: null, profile_revision: 1, created_at: "2026-01-01T00:00:00Z", topic_count: 12, follower_count: 0, following_count: 0, viewer: { is_self: true, is_following: false, is_blocked_by_viewer: false, can_message: false } }) })
    if (path.endsWith("/membership-summary")) return route.fulfill({ json: wrap({ current_level: level, medals: [], public_groups: [] }) })
    if (path === "/api/v1/notifications/unread-count") return route.fulfill({ json: wrap({ unread_count: 3 }) })
    return route.fallback()
  })
  return topics
}

async function toggleTheme(page: Page, width: number) {
  if (width < 768) await page.getByRole("button", { name: "打开导航" }).click()
  await page.getByRole("button", { name: "切换深色模式" }).filter({ visible: true }).click()
  if (width < 768) await page.keyboard.press("Escape")
}

for (const width of [320, 390, 768, 1024, 1279, 1280, 1312, 1440, 1920, 2560]) {
  for (const theme of ["light", "dark"]) {
    test("compact public list at " + width + "px / " + theme, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1024 })
      const errors: string[] = []
      page.on("pageerror", error => errors.push(error.message))
      await homeFixture(page, false)
      await page.goto("/#hot")
      await expect(page.locator(".topic-row--list")).toHaveCount(4)
      if (theme === "dark") await toggleTheme(page, width)
      await expect(page.locator(".composer-prompt, .feed-section .topic-cover")).toHaveCount(0)
      await expect(page.getByRole("tab")).toHaveCount(5)
      for (const row of await page.locator(".topic-row--list").all()) {
        await expect(row.locator(".topic-list-meta")).toBeVisible()
        await expect(row.getByRole("group", { name: "主题统计" })).toBeVisible()
        await expect(row.locator(".topic-list-avatar")).toBeVisible()
      }
      const shell = await page.locator(".page-shell").boundingBox(), header = await page.locator(".site-header__inner").boundingBox()
      expect(shell!.width).toBeLessThanOrEqual(1200)
      if (width >= 1280) expect(shell!.width).toBe(1200)
      expect(header!.x).toBeCloseTo(shell!.x, 1)
      expect(header!.width).toBeCloseTo(shell!.width, 1)
      expect(shell!.x).toBeCloseTo((width - shell!.width) / 2, 1)
      expect((await page.locator(".site-footer").boundingBox())!.width).toBeLessThanOrEqual(1200)
      const tabs = await page.locator(".feed-tabs").boundingBox(), first = await page.locator(".topic-row--list").first().boundingBox()
      expect(first!.y - tabs!.y - tabs!.height).toBeLessThan(3)
      if (width >= 1024) {
        await expect(page.getByRole("heading", { name: "热门版块" })).toBeVisible()
        await expect(page.getByRole("button", { name: "立即注册" })).toBeVisible()
        const columns = await page.locator(".page-shell").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(/\s+/).length)
        expect(columns).toBe(2)
        await expect(page.getByRole("heading", { name: "活跃用户" })).toBeVisible()
        const sidebar = await page.locator(".right-sidebar--home").evaluate(el => ({ visible: el.clientHeight, content: el.scrollHeight }))
        expect(sidebar.content).toBeLessThanOrEqual(sidebar.visible)
      }
      if (width >= 1280) await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible()
      else {
        await page.getByRole("button", { name: "打开导航" }).click()
        await expect(page.getByRole("dialog", { name: "浏览社区" }).getByRole("link", { name: "社区", exact: true })).toBeVisible()
        await page.keyboard.press("Escape")
      }
      await assertNoHorizontalOverflow(page)
      if (width === 390 || width === 1440) {
        const accessibility = await new AxeBuilder({ page }).analyze()
        expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])
      }
      await page.screenshot({ path: testInfo.outputPath("home-" + width + "-" + theme + ".png"), fullPage: true })
      const compose = width < 768 ? page.getByRole("button", { name: "从移动导航发布新主题" }) : page.getByRole("button", { name: "从顶部发布新主题" })
      await compose.click()
      await expect(page.getByRole("dialog", { name: "发布内容" })).toBeVisible()
      await page.getByRole("button", { name: "关闭发布窗口" }).click()
      expect(errors).toEqual([])
    })
  }
}

test("guest registration and login use the requested auth mode without private reads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  const privateReads: string[] = []
  page.on("request", request => { if (/\/users\/me\/(membership|experience)/.test(new URL(request.url()).pathname)) privateReads.push(request.url()) })
  await homeFixture(page, false)
  await page.goto("/#hot")
  await page.getByRole("button", { name: "立即注册" }).click()
  await expect(page.getByRole("dialog", { name: "注册刀云" })).toBeVisible()
  await page.getByRole("button", { name: "关闭身份窗口" }).click()
  await page.locator(".home-welcome-actions").getByRole("button", { name: "登录", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "登录刀云" })).toBeVisible()
  expect(privateReads).toEqual([])
})

test("public navigation persists across boards, topics, profiles and search", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await homeFixture(page, false)
  await page.goto("/#hot")
  for (const url of ["/#boards", "/#board/engineering", "/#topic/019fc700-0000-7000-8000-000000000003", "/#user/quality_author", "/#search?q=Rust"]) {
    await page.goto(url)
    const nav = page.getByRole("navigation", { name: "主导航" })
    await expect(nav.getByRole("link", { name: "社区", exact: true })).toBeVisible()
    const shell = await page.locator(".page-shell").boundingBox()
    expect(shell!.width).toBe(1200)
    expect(shell!.x).toBe(120)
    await expect(nav.getByRole("link", { name: "交易", exact: true })).toHaveAttribute("href", "#boards?q=%E4%BA%A4%E6%98%93")
    await assertNoHorizontalOverflow(page)
  }
})

test("signed-in personal totals remain real and can recover on retry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await homeFixture(page)
  let failed = true
  await page.route("**/api/v1/users/me/membership", route => failed ? route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "暂时不可用" }, meta: { request_id: requestId } } }) : route.fallback())
  await page.goto("/#hot")
  await expect(page.getByRole("link", { name: "— 积分" })).toBeVisible()
  await expect(page.getByRole("link", { name: "12 我的帖子" })).toBeVisible()
  failed = false
  await page.getByRole("button", { name: "重试个人统计" }).click()
  await expect(page.getByRole("link", { name: "1,280 积分" })).toBeVisible()
  await expect(page.getByRole("progressbar", { name: "成长等级进度" })).toHaveAttribute("value", "1880")
})

test("media previews remain available on the shared saved-post cards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await homeFixture(page)
  await page.goto("/#bookmarks")
  await expect(page.locator(".topic-row--feed")).toHaveCount(4)
  for (const count of [0, 1, 2, 3]) {
    const card = page.locator('[data-media-count="' + count + '"]')
    await expect(card.locator(".topic-image-trigger")).toHaveCount(count)
  }
  const image = page.locator('[data-media-count="3"]').getByRole("button", { name: "查看第 2 张图片" })
  await image.click()
  await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(image).toBeFocused()
})

for (const width of [320, 768, 1024, 1280, 1440]) {
  test("keeps long titles and multiple tags contained at " + width + "px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1024 })
    await homeFixture(page, false)
    const topics = Array.from({ length: 5 }, (_, index) => ({
      ...publicTopicFixture,
      id: "019fc700-0000-7000-8000-00000000020" + index,
      title: "如何让一个内容丰富的社区首页在不同尺寸下始终保持清晰、紧凑和易于阅读：".repeat(3),
      author: { ...publicTopicFixture.author, username: "stress_author_" + index, display_name: "一位分享社区建设经验的长期活跃作者" },
      is_pinned: index === 0, is_featured: index === 0,
      tags: Array.from({ length: 5 }, (_, tag) => ({ slug: "stress-" + tag, name: tag === 0 ? "一枚名称很长但仍然应该可以阅读和访问的社区主题标签" : ["技术交流", "设计经验", "内容运营", "开放讨论"][tag - 1] })),
    }))
    await page.route("**/api/v1/feed?**", route => route.fulfill({ json: wrap(topics) }))
    await page.goto("/#hot")
    const rows = page.locator(".topic-row--list")
    await expect(rows).toHaveCount(5)
    for (const row of await rows.all()) {
      const bounds = (await row.boundingBox())!
      const title = (await row.locator(".topic-title").boundingBox())!
      expect(title.width).toBeGreaterThan(120)
      for (const element of await row.locator(".topic-list-tag, .topic-list-title, .topic-list-meta, .topic-list-stats").all()) {
        const box = (await element.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1)
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
      }
    }
    if (width >= 1024) {
      const members = page.locator(".home-active-members")
      await expect(members.locator("a")).toHaveCount(5)
      const area = await members.evaluate(element => { const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) } })
      for (const member of await members.locator("a").all()) {
        const box = (await member.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(area.left - 1)
        expect(box.x + box.width).toBeLessThanOrEqual(area.right + 1)
      }
    }
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("long-content-" + width + ".png"), fullPage: true })
  })
}

test("dismisses public more with outside clicks, Tab, Escape and navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await homeFixture(page, false)
  await page.goto("/#hot")
  const nav = page.getByRole("navigation", { name: "主导航" })
  const more = nav.getByRole("button", { name: "更多", exact: true })
  const details = page.locator(".header-more")
  await more.click()
  await expect(details).toHaveAttribute("open", "")
  await page.getByRole("searchbox", { name: "搜索社区内容" }).click()
  await expect(details).not.toHaveAttribute("open")
  await more.click()
  await details.getByRole("link", { name: "私信", exact: true }).focus()
  await page.keyboard.press("Tab")
  await expect(details).not.toHaveAttribute("open")
  await expect(page.getByRole("searchbox", { name: "搜索社区内容" })).toBeFocused()
  await more.click()
  await details.getByRole("link", { name: "私信", exact: true }).focus()
  await page.keyboard.press("Escape")
  await expect(details).not.toHaveAttribute("open")
  await expect(more).toBeFocused()
  await more.click()
  await nav.getByRole("link", { name: "社区", exact: true }).click()
  await expect(nav.getByRole("link", { name: "社区", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(details).not.toHaveAttribute("open")
  await page.goto("/#board/engineering")
  await expect(nav.getByRole("link", { name: "社区", exact: true })).toHaveAttribute("aria-current", "page")
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.getByRole("button", { name: "打开导航" }).click()
  const drawer = page.getByRole("dialog", { name: "浏览社区" })
  await expect(drawer.getByRole("link", { name: "社区", exact: true })).toHaveAttribute("aria-current", "page")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "打开导航" })).toBeFocused()
})

for (const width of [320, 768, 1024, 1440]) {
  test("keeps row action menus fully visible at " + width + "px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1024 })
    await homeFixture(page, false)
    await page.goto("/#hot")
    const rows = page.locator(".topic-row--list")
    for (const [position, row] of [["first", rows.first()], ["last", rows.last()]] as const) {
      const trigger = row.getByRole("button", { name: /^主题操作：/ })
      await trigger.click()
      if (width >= 768) {
        const triggerBox = (await trigger.boundingBox())!
        const viewsRight = await row.locator(".topic-list-stats > span").evaluate(element => {
          const range = document.createRange()
          range.selectNodeContents(element.lastChild!)
          return range.getBoundingClientRect().right
        })
        expect(triggerBox.x).toBeGreaterThanOrEqual(viewsRight)
      }
      const bookmark = page.getByRole("menuitem", { name: "收藏", exact: true })
      const likeBox = (await page.getByRole("menuitem", { name: "点赞", exact: true }).boundingBox())!, bookmarkBox = (await bookmark.boundingBox())!
      expect(bookmarkBox.y).toBeGreaterThanOrEqual(likeBox.y + likeBox.height)
      await expect(bookmark).toBeInViewport({ ratio: 1 })
      expect(await bookmark.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(position + "-row-menu-" + width + ".png"), fullPage: true })
      await page.keyboard.press("Escape")
      await expect(trigger).toBeFocused()
      await trigger.press("ArrowDown")
      await expect(page.getByRole("menuitem", { name: "点赞", exact: true })).toBeFocused()
      await page.keyboard.press("End")
      await expect(bookmark).toBeFocused()
      await page.keyboard.press("Escape")
      await expect(trigger).toBeFocused()
    }
    await assertNoHorizontalOverflow(page)
  })
}

for (const width of [320, 768, 1024, 1440]) {
  test("recovers from loading and empty filters at " + width + "px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1024 })
    const topics = await homeFixture(page, false)
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let empty = true
    await page.route("**/api/v1/feed?**", async route => { await pending; await route.fulfill({ json: wrap(empty ? [] : topics) }) })
    await page.route("**/api/v1/topics?**", route => route.fulfill({ json: wrap([]) }))
    try {
      await page.goto("/#hot")
      await expect(page.locator(".topic-list-skeleton")).toHaveCount(4)
      await expect(page.locator(".topic-list")).toHaveAttribute("aria-busy", "true")
      await assertNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath("loading-" + width + ".png"), fullPage: true })
    } finally { release() }
    await expect(page.getByRole("button", { name: "发布第一篇主题" })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("empty-" + width + ".png"), fullPage: true })
    await page.getByRole("button", { name: "发布第一篇主题" }).click()
    await expect(page.getByRole("dialog", { name: "发布内容" })).toBeVisible()
    await page.getByRole("button", { name: "关闭发布窗口" }).click()
    if (width < 768) await page.setViewportSize({ width: 768, height: 1024 })
    const filter = page.getByRole("combobox", { name: "按标签筛选" })
    const filterBox = (await filter.boundingBox())!, lastTab = (await page.getByRole("tab", { name: "关注", exact: true }).boundingBox())!
    expect(filterBox.x).toBeGreaterThan(lastTab.x + lastTab.width)
    await filter.selectOption("rust")
    await expect(page.getByRole("button", { name: "查看全部主题" })).toBeVisible()
    empty = false
    await page.getByRole("button", { name: "查看全部主题" }).click()
    await expect(page.locator(".topic-row--list")).toHaveCount(4)
    await expect(page.getByRole("combobox", { name: "按标签筛选" })).toHaveValue("")
    await page.setViewportSize({ width, height: 1024 })
    await assertNoHorizontalOverflow(page)
    const axe = await new AxeBuilder({ page }).analyze()
    expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([])
  })

  test("retries initial and paginated failures without losing rows at " + width + "px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1024 })
    const topics = await homeFixture(page, false)
    let failInitial = true, failMore = true
    let releaseMore!: () => void
    const pendingMore = new Promise<void>(resolve => { releaseMore = resolve })
    const failure = { error: { code: "unavailable", message: "暂时不可用", fields: {} }, meta: { request_id: requestId } }
    await page.route("**/api/v1/feed?**", async route => {
      if (new URL(route.request().url()).searchParams.has("cursor")) {
        if (failMore) return route.fulfill({ status: 503, json: failure })
        await pendingMore
        return route.fulfill({ json: wrap(topics.slice(0, 2)) })
      }
      return failInitial ? route.fulfill({ status: 503, json: failure }) : route.fulfill({ json: { data: [topics[0]], meta: { request_id: requestId, next_cursor: topics[0].id } } })
    })
    await page.goto("/#hot")
    await expect(page.getByRole("heading", { name: "主题暂时无法加载" })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("error-" + width + ".png"), fullPage: true })
    failInitial = false
    await page.getByRole("button", { name: "重试加载主题" }).click()
    await expect(page.locator(".topic-row--list")).toHaveCount(1)
    await page.getByRole("button", { name: "加载更多", exact: true }).click()
    await expect(page.getByRole("alert")).toContainText("已保留当前内容")
    await expect(page.locator(".topic-row--list")).toHaveCount(1)
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("pagination-retry-" + width + ".png"), fullPage: true })
    failMore = false
    try {
      await page.getByRole("button", { name: "重试加载更多" }).click()
      await expect(page.getByRole("button", { name: "正在加载", exact: true })).toBeDisabled()
      await expect(page.locator(".topic-list")).toHaveAttribute("aria-busy", "true")
    } finally { releaseMore() }
    await expect(page.locator(".topic-row--list")).toHaveCount(2)
    await expect(page.locator(".topic-list")).toHaveAttribute("aria-busy", "false")
    await expect(page.getByRole("button", { name: "加载更多", exact: true })).toHaveCount(0)
    await expect(page.getByRole("alert")).toHaveCount(0)
    await assertNoHorizontalOverflow(page)
  })
}
