import { readFile, writeFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
interface Group { id: string; internal_key: string; display_name: string; description: string; is_base: boolean; is_default: boolean; display_order: number; status: string; permission_keys: string[]; quotas: Record<string, number>; revision: number }
interface Fixture { username: string; userId: string; conflictGroup: { id: string; name: string }; comparisonGroups: { id: string; name: string }[] }
const errors = new WeakMap<Page, string[]>()
async function fixture(info: TestInfo): Promise<Fixture> {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) { const url = new URL(process.env[name]!); expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname); if (name === "DATABASE_URL") expect(url.pathname).toContain("v3") }
  return JSON.parse(await readFile(process.env.DAOYUN_GROUP_EDIT_FIXTURES!, "utf8"))[info.project.name] as Fixture
}
async function login(request: APIRequestContext, username = "demo_admin") { const response = await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.meta.request_id).toBe(response.headers()["x-request-id"]); return payload.data.csrf_token as string }
async function groups(request: APIRequestContext): Promise<Group[]> { const response = await request.get("/api/v1/admin/community/groups"); expect(response.status()).toBe(200); return (await response.json()).data as Group[] }
async function openGroups(page: Page) { await page.goto("/#admin/membership"); await page.getByRole("tab", { name: "用户组", exact: true }).click(); await expect(page.getByRole("list", { name: "用户组列表" })).toBeVisible() }
async function capture(page: Page, info: TestInfo, name: string) { const viewport = page.viewportSize(); for (const width of [320,390,768,1024,1440]) { await page.setViewportSize({ width, height: 900 }); await assertNoHorizontalOverflow(page); if (name === "zero-mib-copy-preview") { await expect(page.getByRole("heading", { name: "保存前变更预览" })).toBeInViewport(); const size = await page.getByRole("region", { name: "变更表格", exact: true }).evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth })); expect(size.content).toBeLessThanOrEqual(size.width + 1) } await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") }) } if (viewport) await page.setViewportSize(viewport); expect(errors.get(page)).toEqual([]) }
function updateData(group: Group, displayName: string) { return { expected_revision: group.revision, display_name: displayName, description: group.description, display_order: group.display_order, status: group.status, permission_keys: group.permission_keys, quotas: group.quotas } }
test.beforeEach(({ page }) => { const collected: string[] = []; errors.set(page, collected); page.on("pageerror", error => collected.push(error.message)) })

test("copies a group without writing before confirmation and enforces zero MiB on actual upload", async ({ page, playwright }, info) => {
  const data = await fixture(info); const csrf = await login(page.request); const source = (await groups(page.request)).find(group => group.is_default)!
  await openGroups(page)
  const writes: string[] = []; page.on("request", request => { if (/\/admin\/community\/groups(?:\/|$)/.test(request.url()) && ["POST", "PATCH"].includes(request.method())) writes.push(request.method()) })
  async function copiedDraft() {
    await page.getByRole("button", { name: "复制" + source.display_name, exact: true }).click()
    const editor = page.getByRole("dialog", { name: "创建用户组" }); await editor.getByRole("textbox", { name: "显示名称" }).fill("V3 零额度 " + data.username)
    await editor.getByRole("button", { name: "使用额度", exact: true }).click()
    for (const label of ["单文件上限（MiB）", "总存储空间（MiB）", "每日下载上限（MiB）"]) await editor.getByRole("spinbutton", { name: label }).fill("0")
    await editor.getByRole("button", { name: "创建用户组", exact: true }).click(); await expect(editor.getByRole("region", { name: "保存前变更预览" })).toContainText("0 MiB（不提供）")
    await expect(editor.getByRole("button", { name: "返回编辑" })).toBeFocused(); await expect(editor.getByRole("heading", { name: "保存前变更预览" })).toBeInViewport(); return editor
  }
  let editor = await copiedDraft(); expect(writes).toEqual([]); await capture(page, info, "zero-mib-copy-preview"); await editor.getByRole("button", { name: "取消", exact: true }).click()
  expect((await groups(page.request)).find(group => group.id === source.id)).toEqual(source)
  editor = await copiedDraft(); expect(writes).toEqual([])
  const [saved] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/admin/community/groups") && response.request().method() === "POST"), editor.getByRole("button", { name: "确认创建", exact: true }).click()])
  expect(saved.status()).toBe(201); const payload = await saved.json(); expect(payload.meta.request_id).toBe(saved.headers()["x-request-id"]); const copied = payload.data as Group
  expect(copied.id).not.toBe(source.id); expect(copied.internal_key).not.toBe(source.internal_key); expect(copied.is_default).toBe(false); expect(copied.permission_keys).toEqual(source.permission_keys); expect(copied.quotas["attachment.file.bytes"]).toBe(0)
  expect((await groups(page.request)).find(group => group.id === source.id)).toEqual(source)
  const membershipsResponse = await page.request.get("/api/v1/admin/community/memberships?user_id=" + data.userId); expect(membershipsResponse.status()).toBe(200)
  for (const membership of (await membershipsResponse.json()).data.filter((entry: { membership_kind: string }) => entry.membership_kind === "base")) { const revoked = await page.request.post("/api/v1/admin/community/memberships/" + membership.id + "/revoke", { headers: { "x-csrf-token": csrf }, data: { expected_revision: membership.revision, reason: "V3 独立零额度验证", idempotency_key: "zero-revoke-" + copied.id } }); expect(revoked.status()).toBe(200) }
  const granted = await page.request.post("/api/v1/admin/community/memberships", { headers: { "x-csrf-token": csrf }, data: { user_id: data.userId, group_id: copied.id, membership_kind: "base", source: "operator", source_reference_id: null, reason: "V3 独立零额度验证", starts_at: new Date().toISOString(), ends_at: null, idempotency_key: "zero-base-" + copied.id } }); expect(granted.status()).toBe(200)
  const subject = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL }); const subjectCsrf = await login(subject, data.username)
  const accessResponse = await subject.get("/api/v1/users/me/groups"); expect(accessResponse.status()).toBe(200); const access = (await accessResponse.json()).data.access
  expect(access.permission_keys).toContain("attachment.upload"); expect(access.quotas["attachment.file.bytes"]).toBe(0)
  const upload = await subject.post("/api/v1/attachments/drafts", { headers: { "content-type": "image/png", "x-file-name": "zero.png", "x-csrf-token": subjectCsrf }, data: await readFile(info.outputPath("zero-mib-copy-preview-320.png")) })
  expect(upload.status()).toBe(429); const denied = await upload.json(); expect(denied.error.code).toBe("community.quota_exceeded"); expect(denied.meta.request_id).toBe(upload.headers()["x-request-id"])
  await subject.dispose(); await writeFile(info.outputPath("zero-mib-evidence.json"), JSON.stringify({ sourceId: source.id, sourceRevision: source.revision, copiedId: copied.id, fileBytes: copied.quotas["attachment.file.bytes"], uploadStatus: upload.status(), code: denied.error.code, preConfirmationWrites: 0 }, null, 2), "utf8")
})

test("keeps the local draft across a real two-admin revision conflict and previews the refreshed version", async ({ page }, info) => {
  const data = await fixture(info); const csrf = await login(page.request); const source = (await groups(page.request)).find(group => group.id === data.conflictGroup.id)!
  await openGroups(page); await page.getByRole("button", { name: "编辑" + source.display_name + " · " + source.id.slice(-8), exact: true }).click()
  const editor = page.getByRole("dialog", { name: "编辑用户组" }); const localName = source.display_name + " 本地"; const remoteName = source.display_name + " 远端"
  await editor.getByRole("textbox", { name: "显示名称" }).fill(localName)
  const remote = await page.request.patch("/api/v1/admin/community/groups/" + source.id, { headers: { "x-csrf-token": csrf }, data: updateData(source, remoteName) }); expect(remote.status()).toBe(200); const remoteGroup = (await remote.json()).data as Group
  await editor.getByRole("button", { name: "保存用户组", exact: true }).click()
  const [conflict] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/groups/" + source.id) && response.request().method() === "PATCH"), editor.getByRole("button", { name: "确认保存", exact: true }).click()])
  expect(conflict.status()).toBe(409); const rejected = await conflict.json(); expect(rejected.meta.request_id).toBe(conflict.headers()["x-request-id"])
  await expect(editor.getByRole("textbox", { name: "显示名称" })).toHaveValue(localName); await expect(editor.getByText("数据已被其他管理员更新")).toBeVisible(); await capture(page, info, "revision-conflict")
  const [refreshed] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/admin/community/groups") && response.request().method() === "GET"), editor.getByRole("button", { name: "刷新最新数据" }).click()]); expect(refreshed.status()).toBe(200)
  await expect(editor.getByText("数据已被其他管理员更新")).toHaveCount(0); await expect(editor.getByRole("textbox", { name: "显示名称" })).toHaveValue(localName)
  await editor.getByRole("button", { name: "保存用户组", exact: true }).click(); const preview = editor.getByRole("region", { name: "保存前变更预览" })
  await expect(preview).toContainText(remoteName); await expect(preview).toContainText(localName); await expect(preview).toContainText("修订 " + remoteGroup.revision); await capture(page, info, "refreshed-change-preview")
  const [saved] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/groups/" + source.id) && response.request().method() === "PATCH"), editor.getByRole("button", { name: "确认保存", exact: true }).click()]); expect(saved.status()).toBe(200); const finalGroup = (await saved.json()).data as Group
  expect(saved.request().postDataJSON().expected_revision).toBe(remoteGroup.revision); expect(finalGroup.display_name).toBe(localName)
  const restored = await page.request.patch("/api/v1/admin/community/groups/" + source.id, { headers: { "x-csrf-token": csrf }, data: updateData(finalGroup, source.display_name) }); expect(restored.status()).toBe(200)
  await writeFile(info.outputPath("conflict-evidence.json"), JSON.stringify({ id: source.id, staleRevision: source.revision, rejectedStatus: conflict.status(), remoteRevision: remoteGroup.revision, savedRevision: finalGroup.revision, restoredRevision: (await restored.json()).data.revision, localInputPreserved: true }, null, 2), "utf8")
})

test("compares stable group identities, shows only differences, and opens the selected editor", async ({ page }, info) => {
  const data = await fixture(info); await login(page.request); await openGroups(page)
  const trigger = page.getByRole("button", { name: "比较用户组", exact: true }); await trigger.click(); const dialog = page.getByRole("dialog", { name: "用户组对比" })
  for (const checkbox of await dialog.locator('input[type="checkbox"][aria-label^="对比"]').all()) if (await checkbox.isChecked()) await checkbox.uncheck()
  await expect(dialog.getByText("请至少选择 2 个用户组。")).toBeVisible()
  for (const group of data.comparisonGroups) await dialog.getByRole("checkbox", { name: "对比" + group.name + " · " + group.id.slice(-8), exact: true }).check()
  await dialog.getByRole("checkbox", { name: "只看差异", exact: true }).check(); await expect(dialog.getByRole("rowheader", { name: "单文件上限（MiB）" })).toHaveCount(0); await expect(dialog.getByRole("rowheader", { name: "参与抽奖" })).toBeVisible()
  const extraGroups = (await groups(page.request)).filter(group => !data.comparisonGroups.some(selected => selected.id === group.id)).slice(0, 2)
  for (const group of extraGroups) await dialog.getByRole("checkbox", { name: "对比" + group.display_name + " · " + group.id.slice(-8), exact: true }).check()
  expect(await dialog.locator('input[type="checkbox"][aria-label^="对比"]:checked').count()).toBe(4); await expect(dialog.locator('input[type="checkbox"][aria-label^="对比"]:not(:checked)').first()).toBeDisabled()
  const axe = await new AxeBuilder({ page }).include(".community-group-comparison").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(); expect(axe.violations).toEqual([])
  await capture(page, info, "four-group-differences")
  const target = data.comparisonGroups[1]; await dialog.getByRole("button", { name: "编辑" + target.name + " · " + target.id.slice(-8), exact: true }).click()
  const editor = page.getByRole("dialog", { name: "编辑用户组" }); await expect(editor.getByRole("textbox", { name: "显示名称" })).toHaveValue(target.name)
  await editor.getByRole("button", { name: "审核要求", exact: true }).click(); await expect(editor.getByRole("checkbox", { name: "发布内容需要审核" })).toBeVisible(); await capture(page, info, "separate-review-requirement")
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await writeFile(info.outputPath("comparison-evidence.json"), JSON.stringify({ selectedIds: [...data.comparisonGroups, ...extraGroups].map(group => group.id), maximum: 4, axeViolations: axe.violations.length, pageErrors: errors.get(page) }, null, 2), "utf8")
})
