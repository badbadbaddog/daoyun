
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import { assertNoHorizontalOverflow, mockPublicApi, requestId, userId } from "./fixtures"

const definitions = [
  ["official_topic_supplements", "帖子补充", "topic.supplements", "作者在正文下方追加独立补充，保存后直接发布。"],
  ["official_topic_edit_review", "编辑审核", "topic.edit_review", "按版块控制主题和回复的编辑审核。"],
  ["official_points_redemption", "积分兑换", "membership.redemption", "配置兑换商品，让成员使用积分兑换限时权益。"],
  ["official_community_analytics", "运营报表", "community.analytics", "查看社区增长、参与和积分收支。"],
  ["official_polls", "单选投票", "topic.polls", "在发布器创建单选投票，成员一人一票。"],
]
const envelope = (data: unknown) => ({ data, meta: { request_id: requestId } })

for (const width of [320, 768, 1024, 1440]) {
  test("plugin workspace supports settings and lifecycle at " + width, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await mockPublicApi(page)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text() + " " + message.location().url) })
    let plugins = definitions.map(([key, name, capability, description], index) => ({
      id: "019fc900-0000-7000-8000-00000000080" + (index + 1),
      key, name, description, version: "1.0.0", manifest_schema_version: 1,
      business_api_version: "0.1.0", capabilities: [capability, "ui.panel"],
      data_scopes: [], event_subscriptions: [], component_sha256: "a".repeat(64),
      component_size: 1024, status: index === 1 ? "disabled" : "enabled",
      revision: 1, installed_by: userId, created_at: "2026-08-11T01:00:00Z", updated_at: "2026-08-11T01:00:00Z",
    }))
    let settings = { enabled: true, max_per_topic: 1 }
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname
      const method = route.request().method()
      let data: unknown
      if (path === "/api/v1/auth/session") {
        data = { user: { id: userId, username: "admin", email: "admin@example.test", display_name: "管理员" }, csrf_token: "a".repeat(64) }
      } else if (path === "/api/v1/admin/access") {
        data = { capability_keys: ["plugins.read", "plugins.install", "plugins.lifecycle", "plugins.invoke", "admin.configuration.read", "admin.configuration.write", "admin.users.read", "governance.reports.read", "boards.write", "membership.rules.read", "community.analytics.read", "authorization.roles.read", "operations.read"] }
      } else if (path === "/api/v1/admin/site-branding") {
        data = { site_name: "刀云", logo_url: null, favicon_url: null, default_cover_url: null, navigation_links: [], footer_text: null, footer_links: [], primary_color: "#2463eb", accent_color: "#d97706", theme_preset: "default", list_density: "compact", home_mode: "latest" }
      } else if (path === "/api/v1/admin/boards" || path === "/api/v1/admin/moderation/boards") {
        data = []
      } else if (path === "/api/v1/admin/smtp-settings") {
        data = { host: "smtp.example.test", port: 587, username: null, password_configured: false, tls_mode: "starttls", from_email: "admin@example.test", from_name: "刀云", enabled: false, registration_email_verification_enabled: false }
      } else if (path === "/api/v1/notifications/unread-count") {
        data = { unread_count: 0 }
      } else if (path === "/api/v1/admin/plugins") {
        if (method === "POST") {
          expect(route.request().headers()["x-csrf-token"]).toBe("a".repeat(64))
          const manifest = route.request().postDataJSON().manifest
          expect(manifest.key).toBe("official_polls")
          const plugin = { ...plugins[0], id: "019fc900-0000-7000-8000-000000000805", ...manifest, manifest_schema_version: 1, status: "disabled" }
          delete plugin.schema_version
          plugins.push(plugin)
          await route.fulfill({ status: 201, json: envelope(plugin) })
          return
        }
        data = plugins
      } else if (path === "/api/v1/admin/topic-supplements/settings") {
        if (method === "PUT") {
          expect(route.request().headers()["x-csrf-token"]).toBe("a".repeat(64))
          settings = route.request().postDataJSON()
        }
        data = settings
      } else if (path.endsWith("/ui-contributions")) {
        data = []
      } else if (path.startsWith("/api/v1/admin/plugins/")) {
        const plugin = plugins.find((item) => path.endsWith("/" + item.id))
        if (!plugin) { await route.fallback(); return }
        if (method === "PATCH") {
          expect(route.request().headers()["x-csrf-token"]).toBe("a".repeat(64))
          expect(route.request().postDataJSON().expected_revision).toBe(plugin.revision)
          plugin.status = route.request().postDataJSON().status
          plugin.revision++
          data = plugin
        } else if (method === "DELETE") {
          plugins = plugins.filter((item) => item.id !== plugin.id)
          data = true
        }
      } else { await route.fallback(); return }
      await route.fulfill({ json: envelope(data) })
    })
    await page.goto("/#admin/plugins")
    await expect(page.getByRole("article", { name: "插件：帖子补充", exact: true })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    const trigger = page.getByRole("button", { name: "查看插件：帖子补充", exact: true })
    await trigger.click()
    const detail = page.getByRole("region", { name: "插件：帖子补充", exact: true })
    const limit = detail.getByRole("spinbutton", { name: "每帖最多补充次数" })
    await expect(limit).toHaveValue("1")
    await limit.fill("3")
    await detail.getByRole("tab", { name: "权限", exact: true }).click()
    await expect(detail.getByText("中风险")).toBeVisible()
    await page.keyboard.press("ArrowLeft")
    await expect(limit).toHaveValue("3")
    await detail.getByRole("button", { name: "保存全站设置" }).click()
    await expect(detail.getByText("全站补充设置已保存")).toBeVisible()
    expect(settings.max_per_topic).toBe(3)
    const accessibility = await new AxeBuilder({ page }).include(".plugin-admin").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
    expect(accessibility.violations).toEqual([])
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("plugins-settings-" + width + ".png"), fullPage: true })
    await trigger.click()
    await expect(detail).toBeFocused()
    await detail.getByRole("button", { name: "关闭插件面板" }).click()
    await expect(trigger).toBeFocused()
    await page.getByLabel("插件状态", { exact: true }).selectOption("disabled")
    await expect(page.locator(".plugin-entry")).toHaveCount(1)
    await page.getByRole("switch", { name: "启用插件：编辑审核" }).click()
    await expect(page.getByText("没有符合条件的插件")).toBeVisible()
    await page.getByRole("button", { name: "清除筛选" }).click()
    await page.getByRole("searchbox", { name: "搜索插件" }).fill("official_polls")
    await expect(page.locator(".plugin-entry")).toHaveCount(1)
    await page.getByRole("switch", { name: "停用插件：单选投票" }).click()
    await page.getByRole("button", { name: "更多操作：单选投票" }).click()
    await page.getByRole("menuitem", { name: "卸载插件：单选投票" }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "更多操作：单选投票" })).toBeFocused()
    await page.getByRole("button", { name: "更多操作：单选投票" }).click()
    await page.getByRole("menuitem", { name: "卸载插件：单选投票" }).click()
    await page.getByRole("button", { name: "确认卸载插件" }).click()
    await expect(page.getByText("插件已卸载", { exact: true })).toBeVisible()
    await page.getByRole("tab", { name: "官方插件", exact: true }).click()
    await expect(page.getByRole("article", { name: "官方插件：帖子补充" }).getByText("已安装", { exact: true })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath("plugins-official-" + width + ".png"), fullPage: true })
    await page.getByRole("button", { name: "安装单选投票" }).click()
    const install = page.getByRole("dialog", { name: "安装插件", exact: true })
    await expect(install.getByLabel("插件键", { exact: true })).toHaveValue("official_polls")
    await install.getByRole("button", { name: "下一步：能力审批" }).click()
    await install.getByRole("button", { name: "下一步：组件文件" }).click()
    await install.getByRole("button", { name: "下一步：确认安装" }).click()
    await install.getByRole("button", { name: "确认安装", exact: true }).click()
    await expect(install).toHaveCount(0)
    await expect(page.getByRole("tab", { name: /^已安装/ })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("switch", { name: "启用插件：单选投票" })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })
}
