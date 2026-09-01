import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { assertNoHorizontalOverflow, mockPublicApi } from "./fixtures"

test.describe("public community quality", () => {
  test("renders a usable public feed without console noise or overflow", async ({ page }) => {
    const consoleIssues: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        if (message.type() === "error" && message.text().includes("401 (Unauthorized)")) return
        consoleIssues.push(`${message.type()}: ${message.text()}`)
      }
    })
    page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))

    await mockPublicApi(page)
    await page.goto("/")
    await expect(page.getByText("一条关于 Rust 的主题").first()).toBeVisible()
    await expect(page.locator(".sidebar-nav--custom a", { hasText: "质量文档" })).toHaveAttribute("href", "#quality-docs")
    await expect(page.getByText("质量回归页脚")).toBeVisible()
    await expect(page.getByRole("link", { name: "隐私说明" })).toHaveAttribute("href", "#privacy")
    await expect(page.locator(".topic-cover img").first()).toHaveAttribute("src", "https://cdn.example.com/quality-cover.webp")
    await assertNoHorizontalOverflow(page)

    const accessibility = await new AxeBuilder({ page }).analyze()
    expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])
    expect(consoleIssues).toEqual([])
  })

  test("keeps navigation and first paint within the local quality budget", async ({ page }) => {
    await mockPublicApi(page)
    await page.goto("/", { waitUntil: "load" })
    await expect(page.getByText("一条关于 Rust 的主题").first()).toBeVisible()

    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
      const firstPaint = performance.getEntriesByName("first-contentful-paint")[0]
      const layoutShifts = performance
        .getEntriesByType("layout-shift")
        .filter((entry) => !(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput)
      return {
        domContentLoaded: navigation?.domContentLoadedEventEnd ?? 0,
        load: navigation?.loadEventEnd ?? 0,
        firstContentfulPaint: firstPaint?.startTime ?? null,
        cumulativeLayoutShift: layoutShifts.reduce(
          (total, entry) => total + ((entry as PerformanceEntry & { value?: number }).value ?? 0),
          0,
        ),
      }
    })

    expect(metrics.domContentLoaded).toBeLessThan(4_000)
    expect(metrics.load).toBeLessThan(5_000)
    if (metrics.firstContentfulPaint !== null) {
      expect(metrics.firstContentfulPaint).toBeGreaterThan(0)
      expect(metrics.firstContentfulPaint).toBeLessThan(4_000)
    }
    expect(metrics.cumulativeLayoutShift).toBeLessThan(0.1)
  })
})
