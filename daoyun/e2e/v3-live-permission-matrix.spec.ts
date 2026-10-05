import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Locator, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(90000)
interface Board { id: string; name: string; slug: string }
interface Fixture { board: Board; child: Board; group: { id: string; name: string }; subject: { username: string; userId: string }; matrixGroup: { id: string; name: string }; entitlement: { id: string; key: string; name: string; version: number } }
interface Policy { operator: string; subjects: Array<{ subject_type: string; community_group_id: string | null; subject_key: string | null }>; revision: number }
const exec = promisify(execFile)
const errors = new WeakMap<Page, string[]>()
async function fixture(info: TestInfo): Promise<Fixture> {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) { const url = new URL(process.env[name]!); expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname); if (name === "DATABASE_URL") expect(url.pathname).toContain("v3") }
  return JSON.parse(await readFile(process.env.DAOYUN_MATRIX_FIXTURES!, "utf8"))[info.project.name] as Fixture
}
async function payload(response: APIResponse, status = 200) { expect(response.status()).toBe(status); const result = await response.json(); expect(result.meta.request_id).toBe(response.headers()["x-request-id"]); return result }
async function login(request: APIRequestContext, username = "demo_admin") { return (await payload(await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }))).data.csrf_token as string }
async function currentPolicy(request: APIRequestContext, id: string): Promise<Policy> { return (await payload(await request.get("/api/v1/admin/content-access-policies/board/" + id))).data }
async function setPolicy(request: APIRequestContext, id: string, csrf: string, rules: Pick<Policy, "operator" | "subjects">) { const before = await currentPolicy(request, id); return (await payload(await request.put("/api/v1/admin/content-access-policies/board/" + id, { headers: { "x-csrf-token": csrf }, data: { operator: rules.operator, subjects: rules.subjects, expected_revision: before.revision } }))).data as Policy }
const publicRules = { operator: "any_of", subjects: [{ subject_type: "public", community_group_id: null, subject_key: null }] }
async function open(page: Page, data: Fixture, child = false) { const board = child ? data.child : data.board; await page.goto("/#admin/boards?board_id=" + board.id); const editor = page.getByRole("dialog", { name: "编辑“" + board.name + "”" }); await expect(editor).toBeVisible(); await editor.getByRole("button", { name: "有效权限", exact: true }).click(); await expect(editor.getByRole("heading", { name: "版块有效权限", exact: true })).toBeVisible(); return editor }
const escapeRegex = (text: string) => text.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")
async function chooseGroup(editor: Locator, group: { id: string; name: string }) { await editor.getByRole("checkbox", { name: new RegExp(escapeRegex(group.name) + ".*" + group.id.slice(-8)) }).check() }
async function chooseUser(editor: Locator, data: Fixture) { await editor.getByRole("searchbox", { name: "搜索用户", exact: true }).fill(data.subject.username); await editor.getByRole("button", { name: new RegExp("@" + data.subject.username + "$") }).click(); await expect(editor.getByRole("columnheader", { name: /指定用户/ })).toBeVisible() }
async function capture(page: Page, info: TestInfo, name: string, heading?: Locator) { const before = page.viewportSize(); for (const width of [320,390,768,1024,1440]) { await page.setViewportSize({ width, height: 900 }); await assertNoHorizontalOverflow(page); if (heading) await expect(heading).toBeInViewport({ ratio: 1 }); await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") }) } if (before) await page.setViewportSize(before); expect(errors.get(page)).toEqual([]) }
async function axe(page: Page, selector: string) { expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]) }
async function quotaState(id: string) {
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  const result = await exec(process.env.DAOYUN_PSQL_BIN!, ["--dbname=" + process.env.DATABASE_URL!, "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command=SELECT COALESCE(json_agg(to_jsonb(usage) ORDER BY quota_key, window_start), '[]'::json)::text FROM community_quota_usage usage WHERE user_id = '" + id + "'::uuid"], { encoding: "utf8", windowsHide: true })
  return createHash("sha256").update(result.stdout.trim()).digest("hex")
}
test.beforeEach(({ page }) => { const issues: string[] = []; errors.set(page, issues); page.on("pageerror", error => issues.push(error.message)) })

test("reads group scenes and actual entitlement upload sources without consuming quotas", async ({ page }, info) => {
  const data = await fixture(info); const csrf = await login(page.request); const original = await currentPolicy(page.request, data.board.id)
  try {
  await setPolicy(page.request, data.board.id, csrf, publicRules)
  const before = await quotaState(data.subject.userId); const editor = await open(page, data); await chooseGroup(editor, data.matrixGroup)
  const response = await payload(await page.request.get("/api/v1/admin/boards/" + data.board.id + "/permission-matrix", { params: { group_ids: data.matrixGroup.id, user_id: data.subject.userId } }))
  expect(response.data.scenarios[0]).toMatchObject({ kind: "group", complete: false })
  expect(response.data.scenarios[0].actions.find((a: { action: string }) => a.action === "attachment_upload")).toMatchObject({ decision: "not_provided", permission_provided: false })
  const upload = response.data.scenarios[1].actions.find((a: { action: string }) => a.action === "attachment_upload")
  expect(upload).toMatchObject({ decision: "missing_context", permission_provided: true, source_ids: [data.entitlement.id] })
  expect(response.data.scenarios[1].sources.find((s: { id: string }) => s.id === data.entitlement.id)).toMatchObject({ kind: "entitlement", key: data.entitlement.key, type_version: data.entitlement.version })
  const catalog = (await payload(await page.request.get("/api/v1/admin/community/groups"))).data as Array<{ id: string; display_name: string; status: string }>
  for (const group of catalog.filter(g => g.id !== data.matrixGroup.id && g.status === "active").slice(0,3)) await chooseGroup(editor, { id: group.id, name: group.display_name })
  await chooseUser(editor, data); await expect(editor.getByRole("columnheader")).toHaveCount(6)
  await axe(page, ".admin-permission-matrix"); await capture(page, info, "read-only-effective-matrix")
  const source = editor.getByRole("button", { name: new RegExp(data.subject.userId.slice(-8) + " 主题附件上传 来源$") }); await source.click()
  const dialog = page.getByRole("dialog", { name: /主题附件上传来源$/ }); await expect(dialog.getByText("权益：" + data.entitlement.name, { exact: true })).toBeVisible(); await expect(dialog.getByText(/快照版本 1/)).toBeVisible(); await axe(page, ".admin-permission-source")
  await capture(page, info, "entitlement-upload-source", dialog.getByRole("heading"))
  await dialog.getByRole("button", { name: "关闭来源", exact: true }).click(); await expect(source).toBeFocused()
  await editor.getByRole("button", { name: "刷新权限快照", exact: true }).click(); await expect(editor.getByRole("table")).toBeVisible()
  const after = await quotaState(data.subject.userId); expect(after).toBe(before)
  await writeFile(info.outputPath("read-only-source-evidence.json"), JSON.stringify({ boardId: data.board.id, userId: data.subject.userId, upload, entitlementId: data.entitlement.id, quotaBeforeSha256: before, quotaAfterSha256: after, scenarios: 5, pageErrors: errors.get(page) }, null, 2), "utf8")
  } finally { await setPolicy(page.request, data.board.id, csrf, original) }
})

test("previews only supported rules and cancellation writes nothing", async ({ page, playwright }, info) => {
  const data = await fixture(info); const csrf = await login(page.request); const original = await currentPolicy(page.request, data.board.id); await setPolicy(page.request, data.board.id, csrf, publicRules)
  const anonymous = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
  try {
    const writes: unknown[] = []; page.on("request", request => { if (request.method() === "PUT" && request.url().endsWith("/content-access-policies/board/" + data.board.id)) writes.push(request.postDataJSON()) })
    const editor = await open(page, data); await chooseGroup(editor, data.matrixGroup)
    const select = editor.getByLabel("访问策略预设", { exact: true }); await expect(select.locator("option[value=deny_priority]")).toHaveAttribute("disabled", ""); await expect(select.locator("option[value=inherit_parent]")).toHaveAttribute("disabled", "")
    const beforeCancel = await currentPolicy(page.request, data.board.id)
    await select.selectOption("selected_groups"); await editor.getByRole("button", { name: "预览访问预设", exact: true }).click()
    let dialog = page.getByRole("alertdialog", { name: "确认应用访问预设" }); await expect(dialog.getByText("所有访客", { exact: true })).toBeVisible(); await expect(dialog.getByText(new RegExp(escapeRegex(data.matrixGroup.name)))).toBeVisible()
    await axe(page, ".confirm-dialog"); await capture(page, info, "preset-full-difference", dialog.getByRole("heading"))
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); expect(writes).toHaveLength(0); expect(await currentPolicy(page.request, data.board.id)).toEqual(beforeCancel); await payload(await anonymous.get("/api/v1/boards/" + data.board.slug), 200)
    await editor.getByRole("button", { name: "预览访问预设", exact: true }).click(); dialog = page.getByRole("alertdialog", { name: "确认应用访问预设" })
    const [saved] = await Promise.all([page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/content-access-policies/board/" + data.board.id)), dialog.getByRole("button", { name: "确认保存预设", exact: true }).click()])
    expect(saved.status()).toBe(200); expect(saved.request().postDataJSON()).toMatchObject({ operator: "any_of", subjects: [{ subject_type: "community_group", community_group_id: data.matrixGroup.id, subject_key: null }] })
    await expect(editor.getByText("访问预设已保存，已重新读取权限结果。", { exact: true })).toBeVisible(); await payload(await anonymous.get("/api/v1/boards/" + data.board.slug),403); await payload(await anonymous.get("/api/v1/boards/" + data.child.slug))
    await writeFile(info.outputPath("preset-evidence.json"), JSON.stringify({ supportedPreset: "selected_groups", selectedGroupId: data.matrixGroup.id, cancelledWrites: 0, savedWrites: writes.length, anonymousParentRead: 403, independentChildRead: 200, unsupportedDisabled: true }, null, 2), "utf8")
  } finally { await setPolicy(page.request, data.board.id, csrf, original); await anonymous.dispose() }
})

test("keeps preset choices through a real revision conflict and compares the new baseline", async ({ page, playwright }, info) => {
  const data = await fixture(info); const csrf = await login(page.request); const original = await currentPolicy(page.request, data.board.id); await setPolicy(page.request, data.board.id, csrf, publicRules)
  const other = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL }); const otherCsrf = await login(other)
  try {
    const editor = await open(page, data); await chooseGroup(editor, data.matrixGroup); await editor.getByLabel("访问策略预设", { exact: true }).selectOption("selected_groups"); await editor.getByRole("button", { name: "预览访问预设", exact: true }).click()
    const dialog = page.getByRole("alertdialog", { name: "确认应用访问预设" }); await expect(dialog).toBeVisible()
    const changed = await setPolicy(other, data.board.id, otherCsrf, { operator: "any_of", subjects: [{ subject_type: "authenticated", community_group_id: null, subject_key: null }] })
    const [conflict] = await Promise.all([page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/content-access-policies/board/" + data.board.id)), dialog.getByRole("button", { name: "确认保存预设", exact: true }).click()])
    expect(conflict.status()).toBe(409); await expect(dialog.getByRole("button", { name: "确认保存预设", exact: true })).toBeDisabled(); await expect(editor.getByLabel("访问策略预设", { exact: true })).toHaveValue("selected_groups")
    await capture(page, info, "preset-revision-conflict")
    await dialog.getByRole("button", { name: "刷新当前策略重新比较", exact: true }).click(); await expect(dialog.getByText("保存前 · 修订 " + changed.revision, { exact: true })).toBeVisible(); await expect(dialog.getByText("已登录用户", { exact: true })).toBeVisible()
    await capture(page, info, "preset-refreshed-baseline", dialog.getByRole("heading"))
    const [saved] = await Promise.all([page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/content-access-policies/board/" + data.board.id)), dialog.getByRole("button", { name: "确认保存预设", exact: true }).click()])
    expect(saved.status()).toBe(200); expect(saved.request().postDataJSON()).toMatchObject({ expected_revision: changed.revision, subjects: [{ subject_type: "community_group", community_group_id: data.matrixGroup.id, subject_key: null }] })
    await writeFile(info.outputPath("revision-evidence.json"), JSON.stringify({ conflictStatus: 409, refreshedRevision: changed.revision, selectedGroupId: data.matrixGroup.id, requestId: saved.headers()["x-request-id"] }, null, 2), "utf8")
  } finally { await setPolicy(page.request, data.board.id, csrf, original); await other.dispose() }
})

test("matches actual restricted-parent and independent-child reads without inheriting new policy", async ({ page, playwright }, info) => {
  const data = await fixture(info); const csrf = await login(page.request); const original = await currentPolicy(page.request, data.board.id)
  const member = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL }); await login(member, data.subject.username)
  try {
    await setPolicy(page.request, data.board.id, csrf, { operator: "any_of", subjects: [{ subject_type: "community_group", community_group_id: data.group.id, subject_key: null }] })
    const decisions: Array<{ id: string; status: number; decision: string }> = []
    for (const [board, child, status, decision] of [[data.board, false, 403, "denied"], [data.child, true, 200, "allowed"]] as const) {
      await payload(await member.get("/api/v1/boards/" + board.slug), status)
      const editor = await open(page, data, child); await chooseUser(editor, data)
      const actual = (await payload(await page.request.get("/api/v1/admin/boards/" + board.id + "/permission-matrix", { params: { user_id: data.subject.userId } }))).data.scenarios[0].actions[0]
      expect(actual).toMatchObject({ action: "browse", decision }); decisions.push({ id: board.id, status, decision })
      await capture(page, info, child ? "independent-child-matrix" : "restricted-parent-matrix")
    }
    await writeFile(info.outputPath("hierarchy-evidence.json"), JSON.stringify({ decisions, treePolicyInherited: false }, null, 2), "utf8")
  } finally { await setPolicy(page.request, data.board.id, csrf, original); await member.dispose() }
})
