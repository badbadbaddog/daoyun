import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { resolve } from "node:path"

import { assertNoHorizontalOverflow } from "./fixtures"

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"])

function requireLoopbackHttpUrl(value: string, label: string) {
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (url.protocol !== "http:" || !loopbackHosts.has(hostname)) {
    throw new Error(`${label} must use HTTP on a loopback host because this test writes persistent data.`)
  }
  return url.origin
}

const apiBaseUrl = requireLoopbackHttpUrl(
  process.env.DAOYUN_API_URL ?? "http://127.0.0.1:3000",
  "DAOYUN_API_URL",
)
requireLoopbackHttpUrl(
  process.env.DAOYUN_WEB_URL ?? "http://127.0.0.1:4173",
  "DAOYUN_WEB_URL",
)
const memberPassword = "DaoYunLocalOnly!2026"

test.describe("local real business flow", () => {
  test("logs in, publishes a topic and reply, opens profile, and sends a message", async ({ page, request }) => {
    const health = await request.get(`${apiBaseUrl}/api/v1/health/ready`)
    expect(health.ok()).toBe(true)

    const consoleIssues: string[] = []
    const apiResponses: Array<{ method: string; path: string; status: number }> = []
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return
      const location = message.location().url
      const isAnonymousSessionProbe = message.type() === "error"
        && message.text().includes("401 (Unauthorized)")
        && location.length > 0
        && new URL(location).pathname === "/api/v1/auth/session"
      if (isAnonymousSessionProbe) return
      consoleIssues.push(`${message.type()}: ${message.text()}${location ? ` (${location})` : ""}`)
    })
    page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))
    page.on("response", (response) => {
      const url = new URL(response.url())
      if (!url.pathname.startsWith("/api/v1/")) return
      apiResponses.push({ method: response.request().method(), path: url.pathname, status: response.status() })
    })

    await page.goto("/", { waitUntil: "networkidle" })
    await page.getByRole("button", { name: "登录" }).first().click()
    await page.locator("#auth-identifier").fill("demo_member")
    await page.locator("#auth-password").fill(memberPassword)
    const loginResponse = page.waitForResponse((response) => (
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/auth/login"
    ))
    await page.locator('[role="dialog"] button[type="submit"]').click()
    expect((await loginResponse).status()).toBe(200)
    await expect(page.getByRole("dialog")).toHaveCount(0)

    const suffix = crypto.randomUUID().slice(0, 8)
    const topicTitle = `本地自动回归主题 ${suffix}`
    const replyText = `本地自动回归回复 ${suffix}`
    const directMessage = `本地自动回归私信 ${suffix}`

    await page.getByRole("button", { name: /发布新主题/ }).first().click()
    const composer = page.getByRole("dialog", { name: "发布内容" })
    await composer.getByRole("button", { name: "添加标题" }).click()
    await composer.getByRole("textbox", { name: "标题（可选）" }).fill(topicTitle)
    await composer.getByRole("textbox", { name: "正文", exact: true }).fill(`验证真实 API 的主题 ${suffix}`)
    await composer.locator('input[placeholder*="用逗号分隔"]').fill("回归,浏览器")
    const topicCreateResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/topics")
    await composer.locator('button[type="submit"]').click()
    expect((await topicCreateResponse).status()).toBe(201)
    await expect(page.getByRole("heading", { name: topicTitle, level: 1, exact: true })).toBeVisible()
    const mobileCommentEntry = page.getByRole("button", { name: "写评论" })
    if (await mobileCommentEntry.isVisible()) await mobileCommentEntry.click()
    await page.getByRole("textbox", { name: "参与讨论", exact: true }).fill(replyText)
    const replyCreateResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/replies"))
    await page.getByRole("button", { name: "发布回复", exact: true }).click()
    expect((await replyCreateResponse).status()).toBe(201)
    await expect(page.getByText(replyText, { exact: true })).toBeVisible()

    await page.goto("/#user/demo_admin", { waitUntil: "networkidle" })
    await expect(page.getByText("@demo_admin", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "私信", exact: true }).first().click()
    await expect(page.getByPlaceholder("输入消息")).toBeVisible()
    await page.getByPlaceholder("输入消息").fill(directMessage)
    const messageCreateResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/messages"))
    await page.getByRole("button", { name: "发送消息" }).click()
    expect((await messageCreateResponse).status()).toBe(201)
    await expect(
      page.getByRole("region", { name: "当前私信会话" }).getByText(directMessage, { exact: true }),
    ).toBeVisible()

    expect(consoleIssues).toEqual([])
    expect(apiResponses.some(({ method, path, status }) => method === "POST" && path === "/api/v1/auth/login" && status === 200)).toBe(true)
    expect(apiResponses.some(({ status }) => status >= 500)).toBe(false)
  })

  test("manages scoped authorization and operations monitoring", async ({ page, browser }, testInfo) => {
    test.setTimeout(90_000)
    const suffix = crypto.randomUUID().slice(0, 8)
    const roleName = `E2E 板块审核员 ${suffix}`
    const roleKey = `e2e_moderator_${suffix}`
    const consoleIssues: string[] = []
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return
      const location = message.location().url
      const isAnonymousSessionProbe = message.type() === "error"
        && message.text().includes("401 (Unauthorized)")
        && location.length > 0
        && new URL(location).pathname === "/api/v1/auth/session"
      if (!isAnonymousSessionProbe) consoleIssues.push(`${message.type()}: ${message.text()}`)
    })
    page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))

    const adminCsrf = await loginThroughUi(page, "demo_admin")
    await cleanupStaleAuthorizationFixtures(page, adminCsrf)
    let moderatorRoleId: string | null = null
    let moderatorAssignmentId: string | null = null
    let memberContext: import("@playwright/test").BrowserContext | null = null
    try {
    await page.goto("/#admin", { waitUntil: "networkidle" })
    await expect(page.getByRole("heading", { name: "今天需要处理什么" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "举报待办" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "账号限制" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "版块状态" })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    const dashboardAccessibility = await new AxeBuilder({ page }).include(".admin-view").analyze()
    expect(dashboardAccessibility.violations, JSON.stringify(dashboardAccessibility.violations, null, 2)).toEqual([])
    await selectAdminModule(page, "authorization", "角色与权限")
    await expect(page.getByRole("heading", { level: 1, name: "角色与权限", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "新建角色", exact: true }).click()
    await page.getByLabel("角色键").fill(roleKey)
    await page.getByLabel("角色名称").fill(roleName)
    await page.getByLabel("作用域").selectOption("board")
    await page.getByRole("checkbox", { name: /moderation\.topic$/ }).check()
    const roleCreateResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/admin/authorization/roles")
    await page.getByRole("button", { name: "创建角色" }).click()
    const roleCreatePayload = await (await roleCreateResponse).json() as { data: { id: string } }
    moderatorRoleId = roleCreatePayload.data.id
    await expect(page.getByRole("status").filter({ hasText: "角色已创建" })).toBeVisible()

    await page.getByRole("button", { name: "人员授权", exact: true }).click()
    await page.getByRole("button", { name: "新增授权" }).click()
    await page.getByLabel("用户名（精确匹配）").fill("demo_member")
    await page.getByLabel("自定义角色").selectOption({ label: `${roleName}（板块）` })
    await page.getByLabel("作用板块").selectOption({ label: "社区广场" })
    const assignmentCreateResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/admin/authorization/assignments")
    await page.getByRole("button", { name: "分配角色" }).click()
    const assignmentCreatePayload = await (await assignmentCreateResponse).json() as { data: { id: string } }
    moderatorAssignmentId = assignmentCreatePayload.data.id
    await expect(page.getByRole("status").filter({ hasText: "角色已分配" })).toBeVisible()

    memberContext = await browser.newContext()
    const memberPage = await memberContext.newPage()
      const memberCsrf = await loginThroughUi(memberPage, "demo_member")
      const topicTitle = `E2E 授权主题 ${suffix}`
      await memberPage.getByRole("button", { name: /发布新主题/ }).first().click()
      const composer = memberPage.getByRole("dialog", { name: "发布内容" })
      await composer.getByRole("button", { name: "添加标题" }).click()
      await composer.getByRole("textbox", { name: "标题（可选）" }).fill(topicTitle)
      await composer.getByRole("textbox", { name: "正文", exact: true }).fill("验证板块 moderation capability")
      const boardSelect = composer.locator("select").first()
      if (await boardSelect.count()) {
        await boardSelect.selectOption({ label: "社区广场" })
      }
      const topicResponse = memberPage.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/topics")
      await composer.locator('button[type="submit"]').click()
      const topicPayload = await (await topicResponse).json() as { data: { id: string } }
      await expect(memberPage.getByRole("heading", { name: topicTitle, level: 1, exact: true })).toBeVisible()

      const internalNote = `E2E internal note ${suffix}`
      const reportReceipt = await browserJsonRequest(page, "POST", "/api/v1/reports", adminCsrf, {
        target_type: "topic",
        target_id: topicPayload.data.id,
        reason: "other",
        details: `浏览器审计回归 ${suffix}`,
      })
      expect(reportReceipt.status()).toBe(201)
      const reportId = (reportReceipt.body as { data: { id: string } }).data.id

      const permitted = await browserJsonRequest(memberPage, "PATCH", `/api/v1/topics/${topicPayload.data.id}/moderation`, memberCsrf, { status: "hidden", reason: "E2E limited moderator" })
      expect(permitted.status(), JSON.stringify(permitted.body)).toBe(200)

      const unrelated = await browserJsonRequest(memberPage, "GET", "/api/v1/admin/site-branding")
      expect(unrelated.status()).toBe(403)

      const assignmentRow = page.locator(".authorization-assignment-row").filter({ hasText: "demo_member" }).filter({ hasText: roleName })
      await assignmentRow.getByRole("button", { name: "撤销" }).click()
      const revokeDialog = page.getByRole("alertdialog", { name: "撤销角色分配" })
      await expect(revokeDialog).toBeVisible()
      await revokeDialog.getByRole("button", { name: "确认撤销角色" }).click()
      await expect(page.getByRole("status").filter({ hasText: "角色分配已撤销" })).toBeVisible()
      moderatorAssignmentId = null

      const revoked = await browserJsonRequest(memberPage, "PATCH", `/api/v1/topics/${topicPayload.data.id}/moderation`, memberCsrf, { status: "approved", reason: "E2E revoked moderator" })
      expect(revoked.status()).toBe(403)

      const reportDetail = await browserJsonRequest(page, "GET", `/api/v1/admin/reports/${reportId}`)
      expect(reportDetail.status()).toBe(200)
      const reportRevision = (reportDetail.body as { data: { report: { revision: number } } }).data.report.revision
      const reviewed = await browserJsonRequest(page, "PATCH", `/api/v1/admin/reports/${reportId}`, adminCsrf, {
        status: "in_review",
        resolution: "none",
        note: `E2E review ${suffix}`,
        expected_revision: reportRevision,
      })
      expect(reviewed.status()).toBe(200)
      const reviewedRevision = (reviewed.body as { data: { revision: number } }).data.revision
      const moderated = await browserJsonRequest(page, "POST", `/api/v1/admin/reports/${reportId}/moderations`, adminCsrf, {
        disposition: "dismissed",
        content_action: "none",
        user_action: null,
        public_reason: null,
        note: internalNote,
        expected_revision: reviewedRevision,
      })
      const moderationData = (moderated.body as { data: { audit_id: string } }).data
      expect(moderated.status(), JSON.stringify(moderated.body)).toBe(201)

      await page.goto(`/#admin/reports?status=dismissed&report_id=${reportId}`, { waitUntil: "networkidle" })
      await expect(page.getByRole("region", { name: "举报详情" }).getByRole("heading", { name: topicTitle })).toBeVisible()
      const reportAudit = page.getByRole("region", { name: "相关操作记录" })
      await expect(reportAudit.getByText("完成举报处置", { exact: true })).toBeVisible()
      await expect(reportAudit.getByText(moderationData.audit_id, { exact: true })).toBeVisible()
      await expect(reportAudit.getByText(internalNote, { exact: true })).toHaveCount(0)
      await exerciseOperationsReader(page, memberPage, adminCsrf, memberCsrf)
    await exerciseWritableOperations(page, testInfo)
    expect(consoleIssues).toEqual([])
    } finally {
      if (memberContext) await memberContext.close()
      if (moderatorAssignmentId) {
        const response = await browserJsonRequest(page, "DELETE", `/api/v1/admin/authorization/assignments/${moderatorAssignmentId}`, adminCsrf)
        expect(response.status()).toBe(200)
      }
      if (moderatorRoleId) {
        const response = await browserJsonRequest(page, "DELETE", `/api/v1/admin/authorization/roles/${moderatorRoleId}`, adminCsrf)
        expect(response.status()).toBe(200)
      }
    }
  })

  test("keeps membership economy lists accessible without horizontal overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "This test covers every required viewport in one browser session.")
    const consoleIssues: string[] = []
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return
      const location = message.location().url
      const isAnonymousSessionProbe = message.type() === "error"
        && message.text().includes("401 (Unauthorized)")
        && location.length > 0
        && new URL(location).pathname === "/api/v1/auth/session"
      if (!isAnonymousSessionProbe) consoleIssues.push(`${message.type()}: ${message.text()}`)
    })
    page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))

    await loginThroughUi(page, "demo_admin")
    await page.goto("/#admin/membership", { waitUntil: "networkidle" })
    await expect(page.getByRole("heading", { name: "会员经济", level: 1 })).toBeVisible()
    const growthWorkspace = page.locator("#membership-growth-workspace")
    await expect(growthWorkspace.getByText(/草稿|已发布|已停用|已归档/)).toHaveCount(0)
    await growthWorkspace.getByRole("button", { name: "新增等级" }).click()
    const createDialog = page.getByRole("dialog", { name: "新增成长等级" })
    await expect(createDialog).toBeVisible()
    await createDialog.getByRole("button", { name: "取消" }).click()
    await growthWorkspace.getByRole("button", { name: /^编辑 / }).first().click()
    const editDialog = page.getByRole("dialog", { name: "编辑成长等级" })
    await expect(editDialog.getByLabel(/ 状态$/)).toHaveCount(0)
    await editDialog.getByRole("button", { name: "取消" }).click()
    await growthWorkspace.getByRole("button", { name: /^删除 / }).first().click()
    const deleteDialog = page.getByRole("dialog", { name: "删除成长等级" })
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.getByRole("button", { name: "取消" }).click()

    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole("tab", { name: "成长运营" }).click()
      await expect(page.getByRole("list", { name: "成长等级列表" })).toBeVisible()
      await assertNoHorizontalOverflow(page)
      await page.getByRole("button", { name: "新增等级" }).click()
      const responsiveDialog = page.getByRole("dialog", { name: "新增成长等级" })
      await expect(responsiveDialog).toBeVisible()
      await expect(responsiveDialog.getByRole("region", { name: "等级预览" })).toBeVisible()
      await expect(responsiveDialog.getByRole("group", { name: "基本信息" })).toBeVisible()
      await expect(responsiveDialog.getByRole("group", { name: "成长规则" })).toBeVisible()
      await expect(responsiveDialog.getByRole("group", { name: "视觉与说明" })).toBeVisible()
      await assertNoHorizontalOverflow(page)
      if (width === 320 || width === 1440) {
        await testInfo.attach(`membership-growth-dialog-${width}`, { body: await page.screenshot(), contentType: "image/png" })
      }
      await responsiveDialog.getByRole("button", { name: "取消" }).click()

      await page.getByRole("tab", { name: "勋章运营" }).click()
      await expect(page.getByRole("list", { name: "勋章规则列表" })).toBeVisible()
      await assertNoHorizontalOverflow(page)
    }

    const accessibility = await new AxeBuilder({ page }).include(".membership-admin-panel").analyze()
    expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])
    expect(consoleIssues).toEqual([])
  })

  test("installs, invokes, sandboxes, disables, and uninstalls a real Rust plugin", async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12)
    const pluginKey = `e2e_plugin_${suffix}`
    const pluginName = `E2E Rust 插件 ${suffix}`
    const componentPath = resolve("e2e/fixtures/daoyun-plugin-rust-example.wasm")
    const consoleIssues: string[] = []
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return
      const location = message.location().url
      const isAnonymousSessionProbe = message.type() === "error"
        && message.text().includes("401 (Unauthorized)")
        && location.length > 0
        && new URL(location).pathname === "/api/v1/auth/session"
      if (!isAnonymousSessionProbe) consoleIssues.push(`${message.type()}: ${message.text()}`)
    })
    page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))

    const csrfToken = await loginThroughUi(page, "demo_admin")
    let pluginId: string | null = null
    try {
      await page.goto("/#admin", { waitUntil: "networkidle" })
      await selectAdminModule(page, "plugins", "插件管理")
      await expect(page.getByRole("heading", { level: 1, name: "插件管理" })).toBeVisible()
      await page.getByRole("button", { name: "安装插件", exact: true }).click()

      const installForm = page.locator(".plugin-install")
      await installForm.getByLabel("插件键").fill(pluginKey)
      await installForm.getByLabel("名称").fill(pluginName)
      await installForm.getByLabel("说明").fill("由仓库 Rust SDK 构建的本地真实回归组件")
      await installForm.getByRole("button", { name: "下一步：能力审批" }).click()
      await installForm.getByRole("checkbox", { name: "静态管理面板" }).check()
      await installForm.getByRole("button", { name: "下一步：组件文件" }).click()
      await installForm.getByLabel("WebAssembly Component 文件").setInputFiles(componentPath)
      await installForm.getByRole("button", { name: "下一步：确认安装" }).click()

      const installResponse = page.waitForResponse((response) => (
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/v1/admin/plugins"
      ))
      await installForm.getByRole("button", { name: "确认安装" }).click()
      const installedResponse = await installResponse
      const installed = await installedResponse.json() as { data: { id: string } }
      expect(installedResponse.status(), JSON.stringify(installed)).toBe(201)
      pluginId = installed.data.id

      const pluginRow = page.getByRole("article", { name: `插件：${pluginName}`, exact: true })
      await expect(pluginRow).toContainText("已停用")
      const enableResponse = page.waitForResponse((response) => (
        response.request().method() === "PATCH"
        && new URL(response.url()).pathname === `/api/v1/admin/plugins/${pluginId}`
      ))
      await pluginRow.getByRole("switch", { name: `启用插件：${pluginName}` }).click()
      expect((await enableResponse).status()).toBe(200)
      await expect(pluginRow).toContainText("已启用")

      const transformInput = "DaoYun real plugin e2e"
      await pluginRow.getByRole("button", { name: `查看插件：${pluginName}` }).click()
      const detail = page.getByRole("region", { name: `插件：${pluginName}`, exact: true })
      await detail.getByText("高级与开发者工具", { exact: true }).click()
      await detail.getByRole("button", { name: "开发者工具", exact: true }).click()
      const tools = page.getByRole("dialog", { name: `开发者工具：${pluginName}`, exact: true })
      await tools.getByLabel(`调用输入：${pluginName}`).fill(transformInput)
      const transformResponse = page.waitForResponse((response) => (
        response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/v1/admin/plugins/${pluginId}/invoke`
      ))
      await tools.getByRole("button", { name: `转换内容：${pluginName}` }).click()
      expect((await transformResponse).status()).toBe(200)
      await expect(tools.getByLabel(`插件输出：${pluginName}`)).toHaveText(transformInput.toUpperCase())

      const unsafeText = "<script>window.parent.document.body.textContent='unsafe'</script>"
      const uiInput = JSON.stringify({
        schema_version: 1,
        title: "安全插件面板",
        blocks: [
          { kind: "text", text: unsafeText },
          { kind: "metric", label: "隔离级别", value: "sandbox" },
          { kind: "status", tone: "success", text: "验证通过" },
        ],
      })
      await tools.getByLabel(`调用输入：${pluginName}`).fill(uiInput)
      const renderResponse = page.waitForResponse((response) => (
        response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/v1/admin/plugins/${pluginId}/invoke`
      ))
      await tools.getByRole("button", { name: `渲染面板：${pluginName}` }).click()
      expect((await renderResponse).status()).toBe(200)

      const pluginFrame = tools.locator('iframe[title="插件面板：安全插件面板"]')
      await expect(pluginFrame).toBeVisible()
      await expect(pluginFrame).toHaveAttribute("sandbox", "")
      await expect(pluginFrame).toHaveAttribute("referrerpolicy", "no-referrer")
      const sourceDocument = await pluginFrame.getAttribute("srcdoc")
      expect(sourceDocument).toContain("default-src &#39;none&#39;")
      expect(sourceDocument).toContain("安全插件面板")
      expect(sourceDocument).toContain("隔离级别")
      expect(sourceDocument).toContain("sandbox")
      expect(sourceDocument).toContain("&lt;script&gt;")
      expect(sourceDocument).not.toContain("<script>")

      const requiredWidths = testInfo.project.name.includes("mobile")
        ? [320]
        : [1440, 1024, 768, 320]
      for (const width of requiredWidths) {
        await page.setViewportSize({ width, height: 900 })
        await expect(pluginRow).toBeVisible()
        await assertNoHorizontalOverflow(page)
      }

      await page.getByRole("button", { name: `关闭开发者工具：${pluginName}` }).click()
      const disableResponse = page.waitForResponse((response) => (
        response.request().method() === "PATCH"
        && new URL(response.url()).pathname === `/api/v1/admin/plugins/${pluginId}`
      ))
      await pluginRow.getByRole("switch", { name: `停用插件：${pluginName}` }).click()
      expect((await disableResponse).status()).toBe(200)
      await expect(pluginRow).toContainText("已停用")
      const accessibility = await new AxeBuilder({ page }).include(".admin-view").analyze()
      expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])

      const disabledInvocation = await page.request.post(
        `${apiBaseUrl}/api/v1/admin/plugins/${pluginId}/invoke`,
        {
          headers: { Accept: "application/json", "x-csrf-token": csrfToken },
          data: { operation: "content_transform", payload: "must not run" },
        },
      )
      expect(disabledInvocation.status()).toBe(409)
      expect(await disabledInvocation.json()).toMatchObject({ error: { code: "plugin.disabled" } })

      const uninstallResponse = page.waitForResponse((response) => (
        response.request().method() === "DELETE"
        && new URL(response.url()).pathname === `/api/v1/admin/plugins/${pluginId}`
      ))
      await pluginRow.getByRole("button", { name: `更多操作：${pluginName}` }).click()
      await page.getByRole("menuitem", { name: `卸载插件：${pluginName}` }).click()
      const uninstallDialog = page.getByRole("alertdialog", { name: `卸载插件“${pluginName}”` })
      await expect(uninstallDialog).toBeVisible()
      await uninstallDialog.getByRole("button", { name: "确认卸载插件" }).click()
      expect((await uninstallResponse).status()).toBe(200)
      await expect(pluginRow).toHaveCount(0)
      pluginId = null
      expect(consoleIssues).toEqual([])
    } finally {
      if (pluginId) await removePluginIfPresent(page, pluginId, csrfToken)
    }
  })

  test("keeps topic moderation responsive, accessible, and connected to the real API", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "This test covers every required viewport in one browser session.")
    test.setTimeout(60_000)
    const consoleIssues: string[] = []
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return
      const location = message.location().url
      const isAnonymousSessionProbe = message.type() === "error"
        && message.text().includes("401 (Unauthorized)")
        && location.length > 0
        && new URL(location).pathname === "/api/v1/auth/session"
      if (!isAnonymousSessionProbe) consoleIssues.push(`${message.type()}: ${message.text()}`)
    })
    page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))

    await loginThroughUi(page, "demo_admin")
    await page.goto("/#admin/moderation", { waitUntil: "networkidle" })
    await expect(page.getByRole("heading", { name: "主题治理工作台" })).toBeVisible()

    const boardSelect = page.getByRole("combobox", { name: "治理板块" })
    expect(await boardSelect.locator("option").allTextContents()).toEqual(expect.arrayContaining(["社区广场", "产品反馈"]))
    const fixtureTitle = "治理验收：跨板块移动与处理记录"

    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await boardSelect.selectOption({ label: "社区广场" })
      const topicRow = page.locator(".moderation-topic-row").filter({ hasText: fixtureTitle })
      await expect(topicRow).toBeVisible()
      await assertNoHorizontalOverflow(page)

      await topicRow.getByRole("button", { name: `操作：${fixtureTitle}` }).click()
      await topicRow.getByRole("menuitem", { name: "处理记录", exact: true }).click()
      const history = page.getByRole("dialog", { name: "主题处理记录" })
      await expect(history.getByRole("table", { name: "处理记录" })).toBeVisible()
      await expect(history.getByRole("button", { name: "加载更多记录" })).toBeVisible()
      await assertNoHorizontalOverflow(page)
      await page.keyboard.press("Escape")
      await expect(history).toHaveCount(0)
      await expect(topicRow.getByRole("button", { name: `操作：${fixtureTitle}` })).toBeFocused()

      await topicRow.getByRole("button", { name: `操作：${fixtureTitle}` }).click()
      await topicRow.getByRole("menuitem", { name: "移动", exact: true }).click()
      const moveDialog = page.getByRole("dialog", { name: "移动主题" })
      await expect(moveDialog.getByRole("combobox", { name: "目标板块" }).locator("option", { hasText: "产品反馈" })).toHaveCount(1)
      await expect(moveDialog.getByRole("textbox", { name: "处理备注" })).toBeFocused()
      await expect(moveDialog).toContainText("移动后，主题将从当前板块队列中移除。")
      await page.keyboard.press("Escape")
      await expect(moveDialog).toHaveCount(0)

      if (width === 320 || width === 1440) {
        const accessibility = await new AxeBuilder({ page }).include(".moderation-admin-panel").analyze()
        expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])
        await testInfo.attach(`topic-moderation-${width}`, { body: await page.screenshot(), contentType: "image/png" })
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    const themeButton = page.getByRole("button", { name: "切换为深色主题" })
    await themeButton.click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await expect(page.getByRole("button", { name: "切换为浅色主题" })).toBeVisible()
    await page.getByRole("button", { name: "切换为浅色主题" }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light")

    await boardSelect.selectOption({ label: "产品反馈" })
    const table = page.getByRole("table", { name: "主题治理队列" })
    await expect(table.getByRole("row")).toHaveCount(21)
    const loadMoreResponse = page.waitForResponse((response) => (
      response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/v1/admin/moderation/topics"
      && new URL(response.url()).searchParams.has("cursor")
    ))
    await page.getByRole("button", { name: "加载更多" }).click()
    expect((await loadMoreResponse).status()).toBe(200)
    await expect(table.getByRole("row")).toHaveCount(25)

    await boardSelect.selectOption({ label: "社区广场" })
    let fixtureRow = page.locator(".moderation-topic-row").filter({ hasText: fixtureTitle })
    const moveResponse = page.waitForResponse((response) => (
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname.endsWith("/governance")
    ))
    await fixtureRow.getByRole("button", { name: `操作：${fixtureTitle}` }).click()
    await fixtureRow.getByRole("menuitem", { name: "移动", exact: true }).click()
    await page.getByRole("combobox", { name: "目标板块" }).selectOption({ label: "产品反馈" })
    await page.getByRole("textbox", { name: "处理备注" }).fill("E2E 移动到产品反馈")
    await page.getByRole("button", { name: "确认移动主题" }).click()
    expect((await moveResponse).status()).toBe(200)
    await expect(page.getByText("主题已移动到目标板块。")).toBeVisible()

    await boardSelect.selectOption({ label: "产品反馈" })
    fixtureRow = page.locator(".moderation-topic-row").filter({ hasText: fixtureTitle })
    await expect(fixtureRow).toBeVisible()
    const restoreMoveResponse = page.waitForResponse((response) => (
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname.endsWith("/governance")
    ))
    await fixtureRow.getByRole("button", { name: `操作：${fixtureTitle}` }).click()
    await fixtureRow.getByRole("menuitem", { name: "移动", exact: true }).click()
    await expect(page.getByRole("combobox", { name: "目标板块" })).toHaveValue(
      await boardSelect.locator("option", { hasText: "社区广场" }).getAttribute("value") ?? "",
    )
    await page.getByRole("textbox", { name: "处理备注" }).fill("E2E 恢复到社区广场")
    await page.getByRole("button", { name: "确认移动主题" }).click()
    expect((await restoreMoveResponse).status()).toBe(200)

    await boardSelect.selectOption({ label: "社区广场" })
    fixtureRow = page.locator(".moderation-topic-row").filter({ hasText: fixtureTitle })
    await expect(fixtureRow).toBeVisible()
    const pinResponse = page.waitForResponse((response) => (
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname.endsWith("/governance")
    ))
    await fixtureRow.getByRole("button", { name: `操作：${fixtureTitle}` }).click()
    await fixtureRow.getByRole("menuitem", { name: "置顶", exact: true }).click()
    await page.getByRole("button", { name: "确认置顶主题" }).click()
    expect((await pinResponse).status()).toBe(200)
    await expect(fixtureRow.getByText("已置顶", { exact: true })).toBeVisible()

    const unpinResponse = page.waitForResponse((response) => (
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname.endsWith("/governance")
    ))
    await fixtureRow.getByRole("button", { name: `操作：${fixtureTitle}` }).click()
    await fixtureRow.getByRole("menuitem", { name: "取消置顶", exact: true }).click()
    await page.getByRole("button", { name: "确认取消置顶主题" }).click()
    expect((await unpinResponse).status()).toBe(200)
    await fixtureRow.getByRole("button", { name: `操作：${fixtureTitle}` }).click()
    await expect(fixtureRow.getByRole("menuitem", { name: "置顶", exact: true })).toBeVisible()

    await assertNoHorizontalOverflow(page)
    expect(consoleIssues).toEqual([])
  })
})

async function exerciseOperationsReader(
  adminPage: import("@playwright/test").Page,
  memberPage: import("@playwright/test").Page,
  adminCsrf: string,
  memberCsrf: string,
): Promise<void> {
  const suffix = crypto.randomUUID().slice(0, 8)
  const roleKey = `e2e_operations_reader_${suffix}`
  let roleId: string | null = null
  let assignmentId: string | null = null

  try {
    const roleResponse = await browserJsonRequest(adminPage, "POST", "/api/v1/admin/authorization/roles", adminCsrf, {
      key: roleKey,
      name: `E2E 运维只读 ${suffix}`,
      scope: "instance",
      permission_keys: ["operations.read"],
    })
    expect(roleResponse.status()).toBe(201)
    roleId = (roleResponse.body as { data: { id: string } }).data.id

    const assignmentResponse = await browserJsonRequest(adminPage, "POST", "/api/v1/admin/authorization/assignments", adminCsrf, {
      username: "demo_member",
      role_id: roleId,
      scope_id: null,
    })
    expect(assignmentResponse.status()).toBe(201)
    assignmentId = (assignmentResponse.body as { data: { id: string } }).data.id

    const consoleIssues: string[] = []
    memberPage.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") consoleIssues.push(`${message.type()}: ${message.text()}`)
    })
    memberPage.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))
    await memberPage.goto("/#admin/operations", { waitUntil: "networkidle" })
    await expect(memberPage.getByRole("heading", { name: "运营概览" })).toBeVisible()
    const operationsNavigation = memberPage.getByRole("button", { name: "运维监控", exact: true })
    if (await operationsNavigation.isVisible()) {
      await expect(memberPage.getByRole("button", { name: "品牌配置", exact: true })).toHaveCount(0)
    } else {
      const moduleSelect = memberPage.getByRole("combobox", { name: "管理模块" })
      await expect(moduleSelect).toHaveValue("operations")
      await expect(moduleSelect.locator('option[value="branding"]')).toHaveCount(0)
    }
    await expect(memberPage.getByText("只读权限")).toBeVisible()
    await expect(memberPage.getByRole("button", { name: /^保存 .*规则$/ })).toHaveCount(0)
    await assertNoHorizontalOverflow(memberPage)
    const accessibility = await new AxeBuilder({ page: memberPage }).include(".admin-view").analyze()
    expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])
    expect(consoleIssues).toEqual([])

    const rulesResponse = await browserJsonRequest(memberPage, "GET", "/api/v1/admin/operations/alert-rules")
    expect(rulesResponse.status()).toBe(200)
    const rule = (rulesResponse.body as {
      data: Array<{ id: string; name: string; threshold: number; window_seconds: number; enabled: boolean; revision: number }>
    }).data[0]
    const forbiddenUpdate = await browserJsonRequest(memberPage, "PATCH", `/api/v1/admin/operations/alert-rules/${rule.id}`, memberCsrf, {
      name: rule.name,
      threshold: rule.threshold,
      window_seconds: rule.window_seconds,
      enabled: rule.enabled,
      expected_revision: rule.revision,
    })
    expect(forbiddenUpdate.status()).toBe(403)
  } finally {
    if (assignmentId) {
      const response = await browserJsonRequest(adminPage, "DELETE", `/api/v1/admin/authorization/assignments/${assignmentId}`, adminCsrf)
      expect(response.status()).toBe(200)
    }
    if (roleId) {
      const response = await browserJsonRequest(adminPage, "DELETE", `/api/v1/admin/authorization/roles/${roleId}`, adminCsrf)
      expect(response.status()).toBe(200)
    }
  }
}

async function exerciseWritableOperations(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
): Promise<void> {
  const summaryResponse = page.waitForResponse((response) => (
    response.request().method() === "GET"
    && new URL(response.url()).pathname === "/api/v1/admin/operations/summary"
  ))
  await selectAdminModule(page, "operations", "运维监控")
  expect((await summaryResponse).status()).toBe(200)
  await expect(page.getByRole("heading", { name: "运营概览" })).toBeVisible()
  await expect(page.getByText("数据库正常")).toBeVisible()

  const signal = testInfo.project.name.includes("mobile") ? "HTTP P95 毫秒" : "HTTP 5xx 数"
  await page.getByRole("button", { name: "告警规则", exact: true }).click()
  const ruleForm = page.locator(".operations-rule").filter({ hasText: signal })
  await ruleForm.getByRole("button", { name: /^编辑 .*规则$/ }).click()
  const threshold = ruleForm.getByLabel(/阈值$/)
  const originalThreshold = Number(await threshold.inputValue())
  expect(Number.isSafeInteger(originalThreshold)).toBe(true)
  const save = ruleForm.getByRole("button", { name: /^保存 .*规则$/ })

  await threshold.fill(String(originalThreshold + 1))
  const updateResponse = page.waitForResponse((response) => (
    response.request().method() === "PATCH"
    && /^\/api\/v1\/admin\/operations\/alert-rules\/[0-9a-f-]+$/.test(new URL(response.url()).pathname)
  ))
  await save.click()
  expect((await updateResponse).status()).toBe(200)
  await expect(page.getByRole("status").filter({ hasText: "规则已保存" })).toBeVisible()

  await ruleForm.getByRole("button", { name: /^编辑 .*规则$/ }).click()
  await threshold.fill(String(originalThreshold))
  const restoreResponse = page.waitForResponse((response) => (
    response.request().method() === "PATCH"
    && /^\/api\/v1\/admin\/operations\/alert-rules\/[0-9a-f-]+$/.test(new URL(response.url()).pathname)
  ))
  await save.click()
  expect((await restoreResponse).status()).toBe(200)

  const requiredWidths = testInfo.project.name.includes("mobile")
    ? [320]
    : [1440, 1024, 768, 320]
  for (const width of requiredWidths) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole("heading", { name: "运营概览" })).toBeVisible()
    await assertNoHorizontalOverflow(page)
  }
  const accessibility = await new AxeBuilder({ page }).include(".admin-view").analyze()
  expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([])
}

async function selectAdminModule(
  page: import("@playwright/test").Page,
  value: string,
  label: string,
): Promise<void> {
  const desktopNavigation = page
    .getByRole("navigation", { name: "站点管理导航" })
    .getByRole("button", { name: label, exact: true })
  if (await desktopNavigation.isVisible()) {
    await desktopNavigation.click()
    return
  }
  await page.getByRole("combobox", { name: "管理模块" }).selectOption(value)
}

async function loginThroughUi(page: import("@playwright/test").Page, username: string): Promise<string> {
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "登录" }).first().click()
  await page.locator("#auth-identifier").fill(username)
  await page.locator("#auth-password").fill("DaoYunLocalOnly!2026")
  const loginResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/auth/login")
  await page.locator('[role="dialog"] button[type="submit"]').click()
  const response = await loginResponse
  expect(response.status()).toBe(200)
  const payload = await response.json() as { data: { csrf_token: string } }
  await expect(page.getByRole("dialog")).toHaveCount(0)
  return payload.data.csrf_token
}

async function browserJsonRequest(
  page: import("@playwright/test").Page,
  method: string,
  path: string,
  csrfToken?: string,
  data?: unknown,
): Promise<{ status: () => number; body: unknown }> {
  const result = await page.evaluate(async ({ method, path, csrfToken, data }) => {
    const response = await fetch(path, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    let body: unknown
    try { body = await response.json() } catch { body = undefined }
    return { status: response.status, body }
  }, { method, path, csrfToken, data })
  return { status: () => result.status, body: result.body }
}

async function cleanupStaleAuthorizationFixtures(
  page: import("@playwright/test").Page,
  csrfToken: string,
): Promise<void> {
  const rolesResponse = await browserJsonRequest(page, "GET", "/api/v1/admin/authorization/roles")
  expect(rolesResponse.status()).toBe(200)
  const roles = (rolesResponse.body as {
    data: Array<{ id: string; key: string }>
  }).data.filter((role) => role.key.startsWith("e2e_moderator_") || role.key.startsWith("e2e_operations_reader_"))

  for (const role of roles) {
    let cursor: string | null = null
    do {
      const query = new URLSearchParams({ role_id: role.id, limit: "50" })
      if (cursor) query.set("cursor", cursor)
      const assignmentsResponse = await browserJsonRequest(page, "GET", `/api/v1/admin/authorization/assignments?${query}`)
      expect(assignmentsResponse.status()).toBe(200)
      const payload = assignmentsResponse.body as {
        data: Array<{ id: string }>
        meta: { next_cursor?: string | null }
      }
      for (const assignment of payload.data) {
        const deleteResponse = await browserJsonRequest(page, "DELETE", `/api/v1/admin/authorization/assignments/${assignment.id}`, csrfToken)
        expect(deleteResponse.status()).toBe(200)
      }
      cursor = payload.meta.next_cursor ?? null
    } while (cursor)

    const deleteRoleResponse = await browserJsonRequest(page, "DELETE", `/api/v1/admin/authorization/roles/${role.id}`, csrfToken)
    expect(deleteRoleResponse.status()).toBe(200)
  }
}

async function removePluginIfPresent(
  page: import("@playwright/test").Page,
  pluginId: string,
  csrfToken: string,
): Promise<void> {
  const response = await browserJsonRequest(page, "GET", "/api/v1/admin/plugins")
  if (response.status() !== 200) return
  const plugins = (response.body as {
    data: Array<{ id: string; status: "disabled" | "enabled"; revision: number }>
  }).data
  const plugin = plugins.find((item) => item.id === pluginId)
  if (!plugin) return
  if (plugin.status === "enabled") {
    await browserJsonRequest(page, "PATCH", `/api/v1/admin/plugins/${pluginId}`, csrfToken, {
      status: "disabled",
      expected_revision: plugin.revision,
    })
  }
  await browserJsonRequest(page, "DELETE", `/api/v1/admin/plugins/${pluginId}`, csrfToken)
}
