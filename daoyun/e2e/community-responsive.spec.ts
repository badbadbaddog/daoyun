import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { assertNoHorizontalOverflow, mockPublicApi, topicId } from "./fixtures"

const acceptanceWidths = [320, 375, 768, 1024, 1440] as const

test("applies the accessible community blue palette and button interaction states", async ({ page }) => {
  await mockPublicApi(page)
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "社区发现" })).toBeVisible()
  await expect(page.getByRole("link", { name: "质量回归社区首页" })).toBeVisible()
  await page.evaluate(() => {
    for (const property of [
      "--brand",
      "--brand-hover",
      "--brand-active",
      "--brand-strong",
      "--brand-soft",
      "--brand-foreground",
      "--brand-strong-foreground",
    ]) {
      document.documentElement.style.removeProperty(property)
    }
  })

  const palette = await page.evaluate(() => {
    const styles = window.getComputedStyle(document.documentElement)
    const readToken = (name: string) => styles.getPropertyValue(name).trim()
    return {
      background: readToken("--background"),
      surface: readToken("--surface"),
      text: readToken("--text"),
      textSoft: readToken("--text-soft"),
      border: readToken("--border"),
      primary: readToken("--brand"),
      primaryHover: readToken("--brand-hover"),
      primaryActive: readToken("--brand-active"),
      primaryLight: readToken("--brand-soft"),
    }
  })

  expect(palette).toEqual({
    background: "#f7f9fc",
    surface: "#ffffff",
    text: "#111827",
    textSoft: "#626b78",
    border: "#e5e7eb",
    primary: "#2563eb",
    primaryHover: "#1d4ed8",
    primaryActive: "#1e40af",
    primaryLight: "#eaf2ff",
  })

  if ((page.viewportSize()?.width ?? 0) <= 768) return

  const primaryButton = page.locator(".primary-button:visible").first()
  await expect(primaryButton).toHaveCSS("background-color", "rgb(37, 99, 235)")
  await expect(primaryButton).toHaveCSS("color", "rgb(255, 255, 255)")
  await primaryButton.hover()
  await expect(primaryButton).toHaveCSS("background-color", "rgb(29, 78, 216)")
  await expect(primaryButton).toHaveCSS("color", "rgb(255, 255, 255)")

  const bounds = await primaryButton.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.down()
  await expect(primaryButton).toHaveCSS("background-color", "rgb(30, 64, 175)")
  await page.mouse.up()
})

for (const width of acceptanceWidths) {
  test(`keeps the main public journey usable at ${width}px`, async ({ page }, testInfo) => {
    const consoleIssues: string[] = []
    const networkIssues: string[] = []
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return
      if (message.type() === "error" && message.text().includes("401 (Unauthorized)")) return
      consoleIssues.push(`${message.type()}: ${message.text()}`)
    })
    page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))
    page.on("response", (response) => {
      if (response.status() < 400 || response.status() === 401) return
      networkIssues.push(`${response.status()} ${new URL(response.url()).pathname}`)
    })

    await page.setViewportSize({ width, height: 900 })
    await mockPublicApi(page)

    await page.goto("/")
    await expect(page.getByText("一条关于 Rust 的主题").first()).toBeVisible()
    await expect(page.locator('[data-layout="media"]').first()).toBeVisible()
    await expect(page.locator('[data-layout="discussion"]').first()).toBeVisible()
    await assertNoHorizontalOverflow(page)

    const defaultDesktopLayout = width > 1060 ? await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".page-shell")
      const header = document.querySelector<HTMLElement>(".site-header__inner")
      if (!shell || !header) throw new Error("公共页面外壳不存在")
      return {
        shellWidth: shell.getBoundingClientRect().width,
        shellColumns: window.getComputedStyle(shell).gridTemplateColumns,
        headerWidth: header.getBoundingClientRect().width,
        headerColumns: window.getComputedStyle(header).gridTemplateColumns,
      }
    }) : null

    if (width <= 768) {
      await expect(page.locator(".tag-filter")).toHaveCSS("display", "none")
      await expect(page.locator(".mobile-compose")).toHaveCSS("display", "none")
      await expect(page.locator(".composer-prompt")).toHaveCSS("display", "none")
      const feedHeadingStyles = await page.locator(".feed-heading-copy").evaluate((element) => {
        const styles = window.getComputedStyle(element)
        return {
          height: styles.height,
          overflow: styles.overflow,
          position: styles.position,
          width: styles.width,
        }
      })
      expect(feedHeadingStyles).toEqual({
        height: "1px",
        overflow: "hidden",
        position: "absolute",
        width: "1px",
      })
    }

    if (width <= 900) {
      await expect(page.locator(".mobile-navigation")).toBeVisible()
      await expect(page.locator(".left-sidebar")).toBeHidden()
    } else {
      await expect(page.locator(".mobile-navigation")).toBeHidden()
      await expect(page.locator(".left-sidebar")).toBeVisible()
    }
    if (width <= 1060) {
      await expect(page.locator(".right-sidebar")).toBeHidden()
    } else {
      await expect(page.locator(".right-sidebar")).toBeVisible()
    }

    const composeButton = width <= 768
      ? page.getByRole("button", { name: "从移动导航发布新主题" })
      : page.getByRole("button", { name: "分享此刻的想法" })
    await composeButton.click()
    await expect(page.getByRole("dialog", { name: "发布内容" })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    const composerBounds = await page.getByRole("dialog", { name: "发布内容" }).boundingBox()
    expect(composerBounds).not.toBeNull()
    expect(composerBounds!.x).toBeGreaterThanOrEqual(0)
    expect(composerBounds!.x + composerBounds!.width).toBeLessThanOrEqual(width)
    await page.getByRole("button", { name: "关闭发布窗口" }).click()

    await page.goto("/#boards")
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await expect(page.getByRole("heading", { name: "社区版块", level: 1 })).toBeVisible()
    await expect(page.getByRole("link", { name: "全部版块" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("list", { name: "全部版块列表" })).toBeVisible()
    await expect(page.getByText("7 个公开版块")).toBeVisible()
    await expect(page.locator(".board-directory-link").first()).toBeVisible()
    const communitySearch = page.getByRole("searchbox", { name: "搜索社区", exact: true })
    await expect(communitySearch).toBeVisible()
    await communitySearch.fill("工程")
    await expect(page.getByText("1 个匹配版块")).toBeVisible()
    await expect(page.locator(".board-directory-page").getByRole("link", { name: /工程实践/ })).toBeVisible()
    await page.getByRole("button", { name: "清除社区搜索" }).click()
    if (width <= 768) {
      await expect(page.locator(".board-directory-page")).toHaveCSS("border-left-width", "0px")
      await expect(page.locator(".board-directory-page")).toHaveCSS("border-right-width", "0px")
    }
    await assertNoHorizontalOverflow(page)

    if (width === 375 || width === 1440) {
      const accessibility = await new AxeBuilder({ page }).analyze()
      expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`boards-${width}.png`), fullPage: true })
    }

    await page.goto("/#board/engineering")
    await expect(page.getByRole("heading", { name: "工程实践", level: 1 })).toBeVisible()
    await expect(page.getByLabel("工程实践社区概览")).toBeVisible()
    await expect(page.getByRole("region", { name: "版块数据" })).toBeVisible()
    await expect(page.getByRole("button", { name: "发主题" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "子版块", level: 2, exact: true })).toBeVisible()
    const boardChildren = page.getByRole("list", { name: "子版块列表" })
    await expect(boardChildren.getByRole("listitem")).toHaveCount(6)
    await expect(boardChildren.getByRole("link", { name: /编程语言/ })).toHaveAttribute("href", "#board/languages")
    await expect(boardChildren.getByRole("link", { name: /AI 工具/ })).toHaveAttribute("href", "#board/ai-tools")
    if (width <= 768) {
      await expect(page.locator(".board-breadcrumb")).toHaveCSS("position", "absolute")
      await expect(boardChildren).toHaveCSS("overflow-x", "auto")
      expect(await boardChildren.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    } else {
      await expect(page.getByRole("navigation", { name: "社区路径" })).toBeVisible()
    }
    await expect(page.getByRole("group", { name: "主题排序" })).toBeVisible()
    await expect(page.getByRole("button", { name: "最新" })).toHaveAttribute("aria-pressed", "true")
    const boardTopicList = page.locator(".board-topic-list")
    await expect(boardTopicList).toBeVisible()
    const boardTopicColumns = await boardTopicList.evaluate((element) =>
      window.getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/),
    )
    expect(boardTopicColumns).toHaveLength(1)
    if (width <= 560) {
      await expect(boardTopicList).toHaveCSS("gap", "0px")
      await expect(boardTopicList).toHaveCSS("padding", "0px")
    }
    const boardMediaRow = boardTopicList.locator(".topic-row--media").first()
    await expect(boardMediaRow).toBeVisible()
    await expect(boardMediaRow).toHaveCSS(
      "grid-template-areas",
      /marker content bookmark/,
    )
    await expect(boardMediaRow.locator(".topic-cover")).toHaveCSS("display", "none")
    await expect(boardMediaRow.locator(".topic-avatar")).toHaveCount(0)
    await expect(boardMediaRow.locator(".board-topic-marker"))
      .toHaveCSS("display", "flex")
    await expect(page.locator(".board-topic-columns"))
      .toHaveCSS("display", width <= 768 ? "none" : "grid")
    if (width <= 768) {
      await expect(page.locator(".site-header")).toHaveCSS("display", "none")
      await expect(page.getByRole("navigation", { name: "版块快捷操作" })).toBeVisible()
      await expect(page.locator(".board-page")).toHaveCSS("border-left-width", "0px")
      await expect(page.locator(".board-header")).toHaveCSS("border-radius", "0px")
      await expect(page.locator(".board-breadcrumb")).toHaveCSS("overflow-x", "hidden")
      await expect(boardMediaRow).toHaveCSS("min-height", "72px")
    } else {
      await expect(page.getByRole("navigation", { name: "版块快捷操作" })).toBeHidden()
      const childGridGap = await boardChildren.evaluate((element) => {
        const lastItem = element.lastElementChild
        if (!(lastItem instanceof HTMLElement)) throw new Error("子版块列表为空")
        return element.getBoundingClientRect().right - lastItem.getBoundingClientRect().right
      })
      expect(childGridGap).toBeLessThanOrEqual(1)
      await expect(boardMediaRow).toHaveCSS("min-height", "58px")
      const boardInsets = await page.evaluate(() => {
        const pageElement = document.querySelector<HTMLElement>(".board-page")
        const headerElement = document.querySelector<HTMLElement>(".board-header")
        if (!pageElement || !headerElement) throw new Error("版块详情内容不存在")
        const pageRect = pageElement.getBoundingClientRect()
        const headerRect = headerElement.getBoundingClientRect()
        return {
          left: headerRect.left - pageRect.left,
          right: pageRect.right - headerRect.right,
        }
      })
      expect(boardInsets.left).toBeGreaterThanOrEqual(16)
      expect(boardInsets.right).toBeGreaterThanOrEqual(16)
    }
    if (width > 1060) {
      const boardDesktopLayout = await page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>(".page-shell")
        const header = document.querySelector<HTMLElement>(".site-header__inner")
        if (!shell || !header) throw new Error("版块详情外壳不存在")
        return {
          shellWidth: shell.getBoundingClientRect().width,
          shellColumns: window.getComputedStyle(shell).gridTemplateColumns,
          headerWidth: header.getBoundingClientRect().width,
          headerColumns: window.getComputedStyle(header).gridTemplateColumns,
        }
      })
      expect(boardDesktopLayout).toEqual(defaultDesktopLayout)
    }
    await expect(page.locator(".right-sidebar--board-detail"))
      .toHaveCSS("display", width > 1060 ? "flex" : "none")
    await assertNoHorizontalOverflow(page)

    if (width === 375 || width === 1440) {
      const accessibility = await new AxeBuilder({ page }).analyze()
      expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`board-${width}.png`), fullPage: true })
    }

    await page.goto(`/#topic/${topicId}`)
    await expect(page.getByRole("heading", { name: "一条关于 Rust 的主题", level: 1 })).toBeVisible()
    await expect(page.getByLabel("主题作者与发布信息")).toContainText("质量作者")
    await expect(page.getByLabel("主题作者与发布信息")).toContainText("工程实践")
    await expect(page.locator(".topic-detail__content")).toContainText("可靠的内容详情")
    await expect(page.locator(".topic-interactions")).toBeVisible()
    await expect(page.locator(".reply-list .reply-item")).toHaveCount(2)
    await expect(page.locator('.reply-list > li[data-reply-level="1"]')).toHaveCount(1)
    await expect(page.getByText("引用 #1")).toBeVisible()
    await expect(page.locator(".right-sidebar--topic-detail"))
      .toHaveCSS("display", width > 1060 ? "flex" : "none")
    if (width > 1060) {
      await expect(page.getByRole("complementary", { name: "帖子相关信息" })).toContainText("质量作者")
      await expect(page.getByRole("heading", { name: "相关版块" })).toBeVisible()
    }
    const mobileCommentEntry = page.getByRole("button", { name: "写评论" })
    if (width <= 768) {
      await expect(mobileCommentEntry).toBeVisible()
      await expect(page.locator(".topic-mobile-comment-entry")).toHaveCSS("position", "fixed")
      await expect(page.locator(".topic-mobile-comment-entry")).toHaveCSS("bottom", "64px")
    } else {
      await expect(mobileCommentEntry).toBeHidden()
    }
    await assertNoHorizontalOverflow(page)

    if (width === 375 || width === 1440) {
      const accessibility = await new AxeBuilder({ page }).analyze()
      expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`topic-${width}.png`), fullPage: true })
    }

    await page.goto("/#user/quality_author")
    await expect(page.getByRole("heading", { name: "质量作者", level: 1 })).toBeVisible()
    await assertNoHorizontalOverflow(page)

    if (width === 375 || width === 1440) {
      await page.screenshot({ path: testInfo.outputPath(`profile-${width}.png`), fullPage: true })
    }

    expect(networkIssues).toEqual([])
    expect(consoleIssues).toEqual([])
  })
}
