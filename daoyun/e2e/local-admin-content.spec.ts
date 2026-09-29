import { expect, test, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

test.skip(process.env.DAOYUN_LOCAL_E2E !== "1", "Requires the seeded loopback development database")

test("comments hide and restore through the real API, with responsive review navigation", async ({ page, playwright }, testInfo) => {
  test.setTimeout(120_000)
  const origin = new URL(process.env.DAOYUN_WEB_URL ?? "http://127.0.0.1:4173")
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(origin.hostname)
  expect(origin.protocol).toBe("http:")
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await page.getByRole("button", { name: "登录", exact: true }).first().click()
  await page.locator("#auth-identifier").fill("demo_admin")
  await page.locator("#auth-password").fill("DaoYunLocalOnly!2026")
  const login = page.waitForResponse((response) => response.url().endsWith("/auth/login") && response.request().method() === "POST")
  await page.locator('[role="dialog"] button[type="submit"]').click()
  const csrf = (await (await login).json()).data.csrf_token as string
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const suffix = crypto.randomUUID().slice(0, 8)
  const text = "评论治理回归 " + suffix
  // 普通成员发布测试内容，管理员只执行治理，避免消耗管理员的发帖配额。
  const member = await playwright.request.newContext({ baseURL: origin.origin })
  let topic: { status: number; body: { data: { id: string; board: { id: string } } } }
  let memberCsrf: string
  try {
    const login = await member.post("/api/v1/auth/login", { data: { identifier: "demo_member", password: "DaoYunLocalOnly!2026" } })
    expect(login.status()).toBe(200)
    memberCsrf = (await login.json()).data.csrf_token
    const created = await member.post("/api/v1/topics", { headers: { "x-csrf-token": memberCsrf, "idempotency-key": crypto.randomUUID() }, data: { title: text, content: "本地评论管理回归主题" } })
    const body = await created.json()
    expect(created.status(), JSON.stringify(body.error ?? {})).toBe(201)
    topic = { status: created.status(), body }
  } catch (error) {
    await member.dispose()
    throw error
  }
  let commentId: string | undefined
  try {
    const reply = await member.post("/api/v1/topics/" + topic.body.data.id + "/replies", { headers: { "x-csrf-token": memberCsrf, "idempotency-key": crypto.randomUUID() }, data: { content: text } })
    const replyBody = await reply.json()
    expect(reply.status(), JSON.stringify(replyBody.error ?? {})).toBe(201)
    commentId = replyBody.data.id
    const boardId = topic.body.data.board.id
    const initial = await request(page, "GET", "/api/v1/admin/comments/" + commentId)
    const noCsrf = await request(page, "PATCH", "/api/v1/admin/comments/" + commentId, undefined, { status: "hidden", expected_updated_at: initial.body.data.updated_at, reason: "CSRF 回归" })
    expect(noCsrf.status).toBe(403)

    for (const width of testInfo.project.name.includes("mobile") ? [320, 768] : [1024, 1440]) {
      await page.setViewportSize({ width, height: 960 })
      await page.goto("/#admin/comments")
      await page.getByLabel("评论版块").selectOption(boardId)
      await page.getByRole("combobox", { name: "评论状态", exact: true }).selectOption("published")
      await page.getByLabel("搜索评论").fill(text)
      await page.getByRole("button", { name: "搜索", exact: true }).click()
      const row = page.locator(".content-admin-item").filter({ hasText: text })
      await expect(row).toHaveCount(1)
      await fitsViewport(page)
      await row.getByRole("button", { name: /^查看评论/ }).click()
      const detail = page.getByRole("dialog", { name: "评论详情" })
      await expect(detail.getByText(text, { exact: true })).toBeVisible()
      await detail.getByRole("button", { name: "隐藏评论", exact: true }).click()
      await detail.getByLabel("处理说明").fill("本地回归：隐藏评论")
      await detail.getByRole("button", { name: "确认隐藏" }).click()
      await expect(detail.getByText("评论已隐藏", { exact: true })).toBeVisible()
      await expect(row).toHaveCount(0)
      const stale = await request(page, "PATCH", "/api/v1/admin/comments/" + commentId, csrf, { status: "published", expected_updated_at: initial.body.data.updated_at, reason: "旧版本恢复回归" })
      expect(stale.status).toBe(409)
      await detail.getByRole("button", { name: "恢复评论", exact: true }).click()
      await detail.getByLabel("处理说明").fill("本地回归：恢复评论")
      await detail.getByRole("button", { name: "确认恢复" }).click()
      await expect(detail.getByText("评论已恢复", { exact: true })).toBeVisible()
      await expect(row).toHaveCount(1)
      await expect(row.getByText("已公开", { exact: true })).toBeVisible()
      await fitsViewport(page)
      await page.keyboard.press("Escape")
      await expect(detail).toHaveCount(0)
      await expect(row.getByRole("button", { name: /^查看评论/ })).toBeFocused()
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
      await page.goto("/#admin/reviews")
      await expect(page.getByRole("region", { name: "内容审核工作区" })).toBeVisible()
      await page.getByLabel("审核版块").selectOption(boardId)
      await page.getByLabel("审核类型").selectOption("reply")
      await expect(page.getByText("正在读取审核队列")).toHaveCount(0)
      await expect(page.getByRole("alert")).toHaveCount(0)
      await fitsViewport(page)
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
    }
    expect(errors).toEqual([])
  } finally {
    // 由原作者清理测试主题；管理员治理权限不等于作者删除权限。
    try {
      const cleanup = await member.delete("/api/v1/topics/" + topic.body.data.id, { headers: { "x-csrf-token": memberCsrf } })
      expect([200, 404], "测试主题清理失败").toContain(cleanup.status())
    } finally {
      await member.dispose()
    }
  }
  expect((await request(page, "GET", "/api/v1/topics/" + topic.body.data.id)).status).toBe(404)
  expect((await request(page, "GET", "/api/v1/admin/comments/" + commentId)).status).toBe(404)
})

async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
}

async function request(page: Page, method: string, path: string, csrf?: string, data?: unknown) {
  return page.evaluate(async ({ method, path, csrf, data }) => {
    const response = await fetch(path, { method, credentials: "include", headers: {
      "Content-Type": "application/json", "idempotency-key": crypto.randomUUID(), ...(csrf ? { "x-csrf-token": csrf } : {}),
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    return { status: response.status, body: await response.json() }
  }, { method, path, csrf, data })
}
