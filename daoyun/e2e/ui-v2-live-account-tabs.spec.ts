import { writeFile } from "node:fs/promises"
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test"
import type { MemberDraft } from "../src/api/drafts"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10_000 })

test("isolates two accounts across tabs sharing one browser session", async ({ page }, testInfo) => {
  test.skip(process.env.DAOYUN_PUBLISHER_E2E !== "1", "Requires an explicitly selected isolated local instance")
  test.setTimeout(90_000)
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL"]) {
    const url = new URL(process.env[name] ?? "")
    expect(url.protocol).toBe("http:")
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
  }
  const fixtures = JSON.parse(process.env.DAOYUN_ACCOUNT_TAB_USERS ?? "{}")
  const users = fixtures[testInfo.project.name] ?? { member: "demo_member", other: "demo_admin" }
  const suffix = crypto.randomUUID().slice(0, 8)
  const titleA = "成员草稿 " + suffix
  const titleB = "管理员草稿 " + suffix
  const bodyA = "账号 A 的私有正文 " + suffix
  const bodyB = "账号 B 的私有正文 " + suffix
  const imageA = "member-" + suffix + ".png"
  const imageB = "admin-" + suffix + ".png"
  const issues: string[] = []
  const ownershipChecks: { viewer: string; draftId: string; status: number; code: string; requestId: string }[] = []
  const network: { tab: string; method: string; path: string; status: number }[] = []
  const second = await page.context().newPage()
  function observe(client: Page, label: string) {
    client.on("pageerror", error => issues.push(error.message))
    client.on("console", message => {
      if (!["error", "warning"].includes(message.type())) return
      if (message.text().includes("401 (Unauthorized)") && message.location().url.includes("/auth/session")) return
      issues.push(message.text())
    })
    client.on("response", response => {
      const path = new URL(response.url()).pathname
      if (path.startsWith("/api/v1/")) network.push({ tab: label, method: response.request().method(), path, status: response.status() })
    })
  }
  observe(page, "first")
  observe(second, "second")
  try {
    const accountA = await login(page, users.member)
    const editor = await openComposer(page)
    await editor.getByRole("textbox", { name: "标题（可选）" }).fill(titleA)
    await editor.getByRole("textbox", { name: "正文", exact: true }).fill(bodyA)
    await upload(page, imageA)
    const draftA = await savedDraft(page, titleA, bodyA, imageA)
    await second.goto("/")
    await expect(second.getByRole("button", { name: "打开个人菜单" })).toBeVisible()
    await logout(second)
    // The old editor must become a guest editor before another account signs in.
    await expect(editor.getByRole("textbox", { name: "正文", exact: true })).toBeEmpty()
    await expect(editor.getByText("已上传 0 / 9 张", { exact: true })).toBeVisible()
    await expect(editor.getByRole("region", { name: "草稿同步" })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("logout-clears-member.png") })
    const switched = sessionResponse(page)
    const accountB = await login(second, users.other)
    expect((await data<{ user: { id: string } }>(await switched)).user.id).toBe(accountB)
    expect(accountA).not.toBe(accountB)
    await expect(editor.getByRole("region", { name: "草稿同步" })).toBeVisible()
    await expect(editor.getByRole("textbox", { name: "标题（可选）" })).toHaveValue("")
    await expect(editor.getByRole("textbox", { name: "正文", exact: true })).toBeEmpty()
    await expect(editor.locator(".composer-image-item img")).toHaveCount(0)
    ownershipChecks.push(await denied(page, draftA.id, accountB))
    await editor.getByRole("textbox", { name: "标题（可选）" }).fill(titleB)
    await editor.getByRole("textbox", { name: "正文", exact: true }).fill(bodyB)
    await upload(page, imageB)
    const draftB = await savedDraft(page, titleB, bodyB, imageB)
    expect(draftB.content.board_id).toBe(draftA.content.board_id)
    expect(draftB.id).not.toBe(draftA.id)
    expect(draftB.content.images[0].attachmentId).not.toBe(draftA.content.images[0].attachmentId)
    await page.screenshot({ path: testInfo.outputPath("admin-draft-isolated.png") })
    await logout(second)
    await expect(editor.getByRole("textbox", { name: "正文", exact: true })).toBeEmpty()
    const returned = sessionResponse(page)
    await login(second, users.member)
    expect((await data<{ user: { id: string } }>(await returned)).user.id).toBe(accountA)
    await expect(editor.getByRole("textbox", { name: "标题（可选）" })).toHaveValue(titleA)
    await expect(editor.getByRole("textbox", { name: "正文", exact: true })).toHaveText(bodyA)
    await expect(editor.locator(".composer-image-item img")).toHaveAttribute("alt", imageA)
    await expect(editor.getByText(bodyB, { exact: true })).toHaveCount(0)
    ownershipChecks.push(await denied(page, draftB.id, accountA))
    expect((await data<MemberDraft>(await page.request.get(draftPath(draftA.id)))).content).toEqual(draftA.content)
    const revised = bodyA + " 由第一个标签页继续编辑"
    await editor.getByRole("textbox", { name: "正文", exact: true }).fill(revised)
    await editor.getByRole("button", { name: "关闭发布窗口" }).click()
    await page.getByRole("button", { name: "确认关闭" }).click()
    await expect(editor).toHaveCount(0)
    const otherEditor = await openComposer(second)
    await expect(otherEditor.getByRole("textbox", { name: "正文", exact: true })).toHaveText(revised)
    await expect(otherEditor.locator(".composer-image-item img")).toHaveAttribute("alt", imageA)
    const finalA = await savedDraft(second, titleA, revised, imageA)
    expect(finalA.id).toBe(draftA.id)
    expect(finalA.revision).toBeGreaterThan(draftA.revision)
    await logout(page)
    await expect(otherEditor.getByRole("textbox", { name: "正文", exact: true })).toBeEmpty()
    const restoreB = sessionResponse(second)
    await login(page, users.other)
    expect((await data<{ user: { id: string } }>(await restoreB)).user.id).toBe(accountB)
    await expect(otherEditor.getByRole("textbox", { name: "正文", exact: true })).toHaveText(bodyB)
    await expect(otherEditor.locator(".composer-image-item img")).toHaveAttribute("alt", imageB)
    expect((await data<MemberDraft>(await second.request.get(draftPath(draftB.id)))).content).toEqual(draftB.content)
    ownershipChecks.push(await denied(second, draftA.id, accountB))
    for (const width of [320, 390, 768, 1024, 1440]) {
      await second.setViewportSize({ width, height: 900 })
      await assertNoHorizontalOverflow(second)
      await second.screenshot({ path: testInfo.outputPath("restored-admin-" + width + ".png") })
    }
    await logout(page)
    await expect(otherEditor.getByRole("textbox", { name: "正文", exact: true })).toBeEmpty()
    await expect(otherEditor.locator(".composer-image-item img")).toHaveCount(0)
    const signedOut = await second.request.get("/api/v1/users/me/drafts?limit=20")
    expect(signedOut.status()).toBe(401)
    const signedOutEnvelope = await envelope(signedOut)
    expect(network.filter(row => row.method === "POST" && row.path === "/api/v1/topics")).toEqual([])
    expect(issues).toEqual([])
    const evidencePath = testInfo.outputPath("real-account-tabs-network.json")
    await writeFile(evidencePath, JSON.stringify({ sharedBrowserContext: true, network, ownershipChecks, accountA, accountB,
      signedOutDraftList: { status: signedOut.status(), requestId: signedOutEnvelope.meta.request_id },
      draftA: { id: draftA.id, initialRevision: draftA.revision, finalRevision: finalA.revision, attachmentId: draftA.content.images[0].attachmentId },
      draftB: { id: draftB.id, revision: draftB.revision, attachmentId: draftB.content.images[0].attachmentId }, issues }, null, 2) + "\n", "utf8")
    await testInfo.attach("real-account-tabs-network", { path: evidencePath, contentType: "application/json" })
  } finally { await second.close() }
})

async function login(page: Page, username: string) {
  await page.goto("/")
  await page.getByRole("button", { name: "登录", exact: true }).first().click()
  await page.locator("#auth-identifier").fill(username)
  await page.locator("#auth-password").fill("DaoYunLocalOnly!2026")
  const response = page.waitForResponse(row => row.request().method() === "POST" && new URL(row.url()).pathname === "/api/v1/auth/login")
  await page.locator('[role="dialog"] button[type="submit"]').click()
  const result = await data<{ user: { id: string } }>(await response)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  return result.user.id
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "打开个人菜单" }).click()
  const response = page.waitForResponse(row => row.request().method() === "POST" && new URL(row.url()).pathname === "/api/v1/auth/logout")
  await page.getByRole("menuitem", { name: "退出登录" }).click()
  expect((await data<{ logged_out: boolean }>(await response)).logged_out).toBe(true)
  await expect(page.getByRole("banner").getByRole("button", { name: "登录", exact: true })).toBeVisible()
}

async function openComposer(page: Page) {
  await page.getByRole("button", { name: /发布新主题/ }).first().click()
  return page.getByRole("dialog", { name: "发布内容" })
}

async function upload(page: Page, name: string) {
  const editor = page.getByRole("dialog", { name: "发布内容" })
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  await expect(editor.getByLabel("选择帖子图片")).toBeEnabled()
  await editor.getByLabel("选择帖子图片").setInputFiles({ name, mimeType: "image/png", buffer: png })
  await expect(editor.getByText("已上传 1 / 9 张", { exact: true })).toBeVisible()
}

async function savedDraft(page: Page, title: string, body: string, fileName: string) {
  let draft: MemberDraft | undefined
  await expect.poll(async () => {
    const payload = await data<{ drafts: MemberDraft[] }>(await page.request.get("/api/v1/users/me/drafts?limit=20"))
    draft = payload.drafts.find(row => row.content.title === title && JSON.stringify(row.content.rich_content).includes(body))
    return draft?.content.images[0]?.fileName
  }).toBe(fileName)
  return draft!
}

function draftPath(id: string) { return "/api/v1/users/me/drafts/" + id }
function sessionResponse(page: Page) {
  return page.waitForResponse(row => row.request().method() === "GET" && new URL(row.url()).pathname === "/api/v1/auth/session" && row.status() === 200)
}
async function denied(page: Page, id: string, viewer: string) {
  const response = await page.request.get(draftPath(id))
  expect(response.status()).toBe(404)
  const payload = await envelope(response)
  expect(payload.error.code).toBe("draft.not_found")
  return { viewer, draftId: id, status: response.status(), code: payload.error.code as string, requestId: payload.meta.request_id as string }
}
async function envelope(response: Response | APIResponse) {
  const payload = await response.json()
  expect(payload.meta.request_id).toMatch(/^[0-9a-f-]{36}$/i)
  expect(payload.meta.request_id).toBe(response.headers()["x-request-id"])
  return payload
}
async function data<T>(response: Response | APIResponse): Promise<T> {
  expect(response.ok()).toBe(true)
  return (await envelope(response)).data as T
}
