import { writeFile } from "node:fs/promises"
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test"
import type { MemberDraft } from "../src/api/drafts"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10_000 })

test.describe("isolated real draft conflicts", () => {
  test.skip(process.env.DAOYUN_PUBLISHER_E2E !== "1", "Requires an explicitly selected isolated local instance")

  for (const choice of ["copy", "read-and-recover"] as const) {
    test("preserves both real draft versions via " + choice, async ({ page, browser }, testInfo) => {
      test.setTimeout(90_000)
      for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL"]) {
        const url = new URL(process.env[name] ?? "")
        expect(url.protocol).toBe("http:")
        expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
      }
      const suffix = crypto.randomUUID().slice(0, 8)
      const initial = "初始草稿 " + suffix
      const serverText = "另一设备保存的正文 " + suffix
      const localText = "本机尚未同步的正文 " + suffix
      const serverTitle = "服务器版本 " + suffix
      const localTitle = "本机版本 " + suffix
      const issues: string[] = []
      const network: { client: string; method: string; path: string; status: number }[] = []
      function observe(client: Page, label: string) {
        client.on("pageerror", error => issues.push(error.message))
        client.on("console", message => {
          if (!["error", "warning"].includes(message.type())) return
          const url = message.location().url
          if (message.text().includes("401 (Unauthorized)") && url.includes("/auth/session")) return
          if (message.text().includes("409 (Conflict)") && url.includes("/users/me/drafts/")) return
          issues.push(message.text())
        })
        client.on("response", response => {
          const path = new URL(response.url()).pathname
          if (path.startsWith("/api/v1/")) network.push({ client: label, method: response.request().method(), path, status: response.status() })
        })
      }
      observe(page, "server")
      await login(page)
      const first = await openComposer(page)
      await first.getByRole("textbox", { name: "标题（可选）" }).fill(initial)
      await first.getByRole("textbox", { name: "正文", exact: true }).fill(initial)
      const fileName = "conflict-" + suffix + ".png"
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
      await first.getByLabel("选择帖子图片").setInputFiles({ name: fileName, mimeType: "image/png", buffer: png })
      await expect(first.getByText("已上传 1 / 9 张", { exact: true })).toBeVisible()
      let original: MemberDraft | undefined
      await expect.poll(async () => {
        const payload = await data<{ drafts: MemberDraft[] }>(await page.request.get("/api/v1/users/me/drafts?limit=20"))
        original = payload.drafts.find(row => row.content.title === initial && row.content.images.length === 1)
        return original?.content.images[0].fileName
      }).toBe(fileName)
      const draftPath = "/api/v1/users/me/drafts/" + original!.id
      const attachmentIds = original!.content.images.map(image => image.attachmentId)
      const secondContext = await browser.newContext({ baseURL: process.env.DAOYUN_WEB_URL, viewport: page.viewportSize() })
      try {
        const secondPage = await secondContext.newPage()
        observe(secondPage, "local")
        await login(secondPage)
        let second = await openComposer(secondPage)
        await expect(second.getByRole("textbox", { name: "正文", exact: true })).toBeEmpty()
        await second.getByRole("button", { name: "打开草稿箱" }).click()
        await second.getByRole("button", { name: "继续编辑 " + initial, exact: true }).click()
        await expect(second.getByRole("textbox", { name: "正文", exact: true })).toHaveText(initial)
        const loaded = await data<MemberDraft>(await secondPage.request.get(draftPath))
        expect(loaded.revision).toBe(original!.revision)
        const serverSave = page.waitForResponse(response => isSave(response, draftPath) && response.status() === 200
          && JSON.stringify(response.request().postDataJSON().content).includes(serverText))
        await first.getByRole("textbox", { name: "标题（可选）" }).fill(serverTitle)
        await first.getByRole("textbox", { name: "正文", exact: true }).fill(serverText)
        const serverVersion = await data<MemberDraft>(await serverSave)
        expect(serverVersion.revision).toBeGreaterThan(loaded.revision)
        const conflict = secondPage.waitForResponse(response => isSave(response, draftPath) && response.status() === 409)
        await second.getByRole("textbox", { name: "标题（可选）" }).fill(localTitle)
        await second.getByRole("textbox", { name: "正文", exact: true }).fill(localText)
        const rejected = await conflict
        expect(rejected.request().postDataJSON().expected_revision).toBe(loaded.revision)
        expect((await envelope(rejected)).error.code).toBe("draft.conflict")
        await expect(second.getByRole("alert")).toContainText("另一设备已更新草稿")
        await expect(second.getByText("云端尚未同步；正文仍在编辑器中", { exact: true })).toBeVisible()
        await expect(second.getByRole("textbox", { name: "正文", exact: true })).toHaveText(localText)
        await expect(second.getByRole("button", { name: "新建草稿", exact: true })).toBeDisabled()
        for (const width of [320, 390, 768, 1024, 1440]) {
          await secondPage.setViewportSize({ width, height: 900 })
          await assertNoHorizontalOverflow(secondPage)
          await secondPage.screenshot({ path: testInfo.outputPath("conflict-" + width + ".png") })
        }
        expect((await data<MemberDraft>(await page.request.get(draftPath))).content).toEqual(serverVersion.content)
        // A blocked flush must never create a topic or overwrite the other device's version.
        await second.getByRole("button", { name: "发布", exact: true }).click()
        await expect(second.getByText("主题服务暂时不可用，请稍后重试；未发布的正文仍保留", { exact: true })).toBeVisible()
        expect(network.filter(row => row.client === "local" && row.method === "POST" && row.path === "/api/v1/topics")).toEqual([])
        expect(network.filter(row => row.client === "local" && row.method === "PUT" && row.path === draftPath)).toHaveLength(1)
        if (choice === "read-and-recover") {
          await second.getByRole("button", { name: "保留本地副本并读取服务器版", exact: true }).click()
          await expect(second.getByRole("textbox", { name: "正文", exact: true })).toHaveText(serverText)
          await expect(second.getByRole("textbox", { name: "标题（可选）" })).toHaveValue(serverTitle)
          await expect(second.getByText("已同步到草稿箱", { exact: true })).toBeVisible()
          // Recovery survives a full reload, then explicitly creates a separate local version.
          await secondPage.reload()
          second = await openComposer(secondPage)
          await expect(second.getByRole("textbox", { name: "正文", exact: true })).toHaveText(serverText)
        }
        const copySave = secondPage.waitForResponse(response => response.request().method() === "PUT"
          && new URL(response.url()).pathname.startsWith("/api/v1/users/me/drafts/")
          && new URL(response.url()).pathname !== draftPath && response.status() === 200
          && JSON.stringify(response.request().postDataJSON().content).includes(localText))
        const button = choice === "copy" ? "另存本地副本" : "恢复保留的本地副本（另存）"
        await second.getByRole("button", { name: button, exact: true }).click()
        const copied = await data<MemberDraft>(await copySave)
        expect(copied.id).not.toBe(original!.id)
        expect(copied.revision).toBe(1)
        expect(copied.content.title).toBe(localTitle)
        expect(JSON.stringify(copied.content.rich_content)).toContain(localText)
        expect(copied.content.images.map(image => image.attachmentId)).toEqual(attachmentIds)
        expect((await data<MemberDraft>(await page.request.get(draftPath))).content).toEqual(serverVersion.content)
        await expect(second.getByRole("textbox", { name: "正文", exact: true })).toHaveText(localText)
        await second.getByRole("button", { name: "关闭发布窗口" }).click()
        await secondPage.getByRole("button", { name: "确认关闭" }).click()
        await secondPage.reload()
        second = await openComposer(secondPage)
        await expect(second.getByRole("textbox", { name: "正文", exact: true })).toHaveText(localText)
        await expect(second.locator(".composer-image-item img")).toHaveAttribute("alt", fileName)
        await second.getByRole("button", { name: "打开草稿箱" }).click()
        await expect(second.getByRole("button", { name: "继续编辑 " + serverTitle, exact: true })).toBeVisible()
        await expect(second.getByRole("button", { name: "继续编辑 " + localTitle, exact: true })).toBeVisible()
        await secondPage.screenshot({ path: testInfo.outputPath("both-versions-preserved.png") })
        expect(issues).toEqual([])
        const evidencePath = testInfo.outputPath("real-draft-conflict-network.json")
        await writeFile(evidencePath, JSON.stringify({ choice, network, originalDraftId: original!.id,
          loadedRevision: loaded.revision, serverRevision: serverVersion.revision, copiedDraftId: copied.id, attachmentIds }, null, 2) + "\n", "utf8")
        await testInfo.attach("real-draft-conflict-network", { path: evidencePath, contentType: "application/json" })
      } finally { await secondContext.close() }
    })
  }
})

async function login(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "登录", exact: true }).first().click()
  await page.locator("#auth-identifier").fill("demo_member")
  await page.locator("#auth-password").fill("DaoYunLocalOnly!2026")
  const response = page.waitForResponse(row => row.request().method() === "POST" && new URL(row.url()).pathname === "/api/v1/auth/login")
  await page.locator('[role="dialog"] button[type="submit"]').click()
  expect((await response).status()).toBe(200)
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

async function openComposer(page: Page) {
  await page.getByRole("button", { name: /发布新主题/ }).first().click()
  return page.getByRole("dialog", { name: "发布内容" })
}

function isSave(response: Response, path: string) {
  return response.request().method() === "PUT" && new URL(response.url()).pathname === path
}

async function envelope(response: Response | APIResponse) {
  const payload = await response.json()
  expect(payload.meta.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  expect(payload.meta.request_id).toBe(response.headers()["x-request-id"])
  return payload
}

async function data<T>(response: Response | APIResponse): Promise<T> {
  expect(response.ok()).toBe(true)
  return (await envelope(response)).data as T
}
