import { readFile, writeFile } from "node:fs/promises"
import { expect, test, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10_000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
const errors = new WeakMap<Page, string[]>()

async function envelope(response: APIResponse) {
  const body = await response.json()
  expect(body.meta.request_id).toBe(response.headers()["x-request-id"])
  expect([200, 201]).toContain(response.status())
  return body
}
async function login(page: Page) {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) {
    const url = new URL(process.env[name] ?? "")
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
    if (name === "DATABASE_URL") expect(url.pathname).toContain("v3")
  }
  const issues: string[] = []; errors.set(page, issues); page.on("pageerror", error => issues.push(error.message))
  return (await envelope(await page.request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password: "DaoYunLocalOnly!2026" } }))).data.csrf_token as string
}
async function snapshots(page: Page, info: TestInfo, name: string) {
  expect(errors.get(page)).toEqual([])
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
}

test("opens precise user and board tasks and restores the source list and dashboard position", async ({ page }, info) => {
  await login(page)
  const fixturePath = process.env.DAOYUN_SUMMARY_FIXTURES
  if (!fixturePath) throw new Error("Requires the explicitly prepared summary fixtures")
  const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, { userId: string; boardId: string; username: string; suffix: string }>
  const { userId, boardId, username, suffix } = fixtures[info.project.name]
  expect(username).toMatch(/^v3s[0-9a-f]{12}$/)
  expect(userId).toMatch(/^[0-9a-f-]{36}$/i); expect(boardId).toMatch(/^[0-9a-f-]{36}$/i)
  const user = await envelope(await page.request.get("/api/v1/admin/users/" + userId))
  expect(user.data.status).toBe("restricted")
  const boards = await envelope(await page.request.get("/api/v1/admin/boards"))
  expect(boards.data.find((board: { id: string; visibility: string }) => board.id === boardId)?.visibility).toBe("hidden")
  await page.goto("/#hot")
  await expect(page.getByRole("heading", { name: /^你好，/, includeHidden: true })).toBeAttached()
  await expect(page.getByText("我的发布", { exact: true })).toHaveCount(0)
  await expect(page.getByText("收到回复", { exact: true })).toHaveCount(0)
  await expect(page.getByText("获得喜欢", { exact: true })).toHaveCount(0)
  await page.goto("/#admin/dashboard")
  const task = page.getByRole("button", { name: "查看账号：摘要定位成员" + suffix })
  await expect(task).toBeVisible(); await task.scrollIntoViewIfNeeded()
  const sourceScroll = await page.evaluate(() => Math.round(window.scrollY))
  const detailResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/admin/users/" + userId)
  await task.click(); const response = await detailResponse
  const payload = await response.json(); expect(payload.data.id).toBe(userId); expect(payload.meta.request_id).toBe(response.headers()["x-request-id"])
  await expect(page.getByRole("dialog", { name: "用户详情" })).toBeVisible()
  const route = new URLSearchParams((await page.evaluate(() => window.location.hash)).split("?")[1])
  expect(route.get("user_id")).toBe(userId); expect(route.get("status")).toBe("restricted"); expect(route.get("return_to")).toBe("dashboard"); expect(route.get("return_scroll")).toBe(String(sourceScroll))
  await snapshots(page, info, "exact-user")
  await page.getByRole("button", { name: "返回列表", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "已限制", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page).not.toHaveURL(/user_id=/)
  await page.setViewportSize({ width: info.project.name.includes("mobile") ? 390 : 1440, height: 900 })
  await page.getByRole("link", { name: "返回工作台" }).click()
  await expect(task).toBeVisible()
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(sourceScroll)
  await page.getByRole("button", { name: "打开版块：摘要隐藏版块" + suffix }).click()
  await expect(page).toHaveURL(new RegExp("board_id=" + boardId))
  await expect(page.getByRole("dialog", { name: "编辑“摘要隐藏版块" + suffix + "”" })).toBeVisible()
  await snapshots(page, info, "exact-board")
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await expect(page).not.toHaveURL(/board_id=/)
  const query = "q=" + username + "&status=restricted&user_id=" + userId
  await page.goto("/#admin/users?" + query)
  await expect(page.getByRole("dialog", { name: "用户详情" })).toBeVisible()
  await page.reload(); await expect(page.getByRole("dialog", { name: "用户详情" })).toBeVisible()
  await page.getByRole("button", { name: "返回列表", exact: true }).click()
  await expect(page.getByRole("searchbox", { name: "搜索用户" })).toHaveValue(username)
  await expect(page).toHaveURL(new RegExp("q=" + username + "&status=restricted$"))
  expect(errors.get(page)).toEqual([])
  await writeFile(info.outputPath("summary-evidence.json"), JSON.stringify({ userId, boardId, sourceScroll, exact_object_after_reload: true, filters_preserved: true }, null, 2), "utf8")
})

test("shows unavailable summaries when a source request fails", async ({ page }, info) => {
  await login(page)
  await page.route("**/api/v1/admin/users?**", route => new URL(route.request().url()).searchParams.get("status") === "restricted" ? route.abort("failed") : route.continue())
  await page.route("**/api/v1/admin/reports?**", route => new URL(route.request().url()).searchParams.get("status") === "open" ? route.abort("failed") : route.continue())
  await page.goto("/#admin/dashboard")
  await expect(page.getByRole("button", { name: "查看受限账号：暂不可用" })).toBeVisible()
  await expect(page.getByRole("button", { name: "查看待处理举报：暂不可用" })).toBeVisible()
  await expect(page.getByRole("button", { name: "查看受限账号：0", exact: true })).toHaveCount(0)
  await expect(page.getByText("按状态汇总，每类最多展示 5 条；5+ 表示还有更多。", { exact: true })).toBeVisible()
  await snapshots(page, info, "unavailable-summary")
})
