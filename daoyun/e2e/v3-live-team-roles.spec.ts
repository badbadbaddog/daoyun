import { readFile, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from "@playwright/test"
import { assertNoHorizontalOverflow } from "./fixtures"

test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.setTimeout(90000)
interface Fixture {
  board: { id: string; name: string }
  child: { id: string; name: string }
  role: { id: string; key: string; name: string; scope: string; permission_keys: string[] }
  subject: { username: string; userId: string; displayName: string }
}
interface Role { id: string; key: string; name: string; revision: number; permission_keys: string[] }
interface Assignment { id: string; scope_id: string | null; scope_mode: string; role: { id: string; key: string; is_system: boolean } }
const errors = new WeakMap<Page, string[]>()
async function fixture(info: TestInfo): Promise<Fixture> {
  for (const name of ["DAOYUN_WEB_URL", "DAOYUN_API_URL", "DATABASE_URL"]) {
    const url = new URL(process.env[name]!)
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname)
    if (name === "DATABASE_URL") expect(url.pathname).toContain("v3")
  }
  return JSON.parse(await readFile(process.env.DAOYUN_TEAM_FIXTURES!, "utf8"))[info.project.name] as Fixture
}
async function payload(response: APIResponse, status = 200) {
  expect(response.status()).toBe(status)
  const result = await response.json()
  expect(result.meta.request_id).toBe(response.headers()["x-request-id"])
  return result
}
async function login(request: APIRequestContext, username = "demo_admin") {
  return (await payload(await request.post("/api/v1/auth/login", { data: { identifier: username, password: "DaoYunLocalOnly!2026" } }))).data.csrf_token as string
}
async function assignments(request: APIRequestContext, username: string): Promise<Assignment[]> {
  return (await payload(await request.get("/api/v1/admin/authorization/assignments", { params: { username, limit: "50" } }))).data
}
async function roles(request: APIRequestContext): Promise<Role[]> { return (await payload(await request.get("/api/v1/admin/authorization/roles"))).data }
async function capture(page: Page, info: TestInfo, name: string) {
  const previous = page.viewportSize()
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath(name + "-" + width + ".png") })
  }
  if (previous) await page.setViewportSize(previous)
  expect(errors.get(page)).toEqual([])
}
async function axe(page: Page, selector: string) {
  expect((await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
}
test.beforeEach(({ page }) => { const issues: string[] = []; errors.set(page, issues); page.on("pageerror", error => issues.push(error.message)) })

test("expands a complete board template and confirms risky role creation before writing", async ({ page }, info) => {
  const data = await fixture(info); const csrf = await login(page.request); let createdId: string | undefined
  try {
    await page.goto("/#admin/authorization")
    await page.getByRole("button", { name: "新建角色", exact: true }).click()
    await page.getByLabel("职务模板", { exact: true }).selectOption("board_moderator")
    await expect(page.getByLabel("作用域", { exact: true })).toHaveValue("board")
    const name = "V3 模板核验 " + data.subject.username
    await page.getByLabel("角色名称", { exact: true }).fill(name)
    await axe(page, ".authorization-editor"); await capture(page, info, "complete-board-template")
    await page.getByRole("button", { name: "创建角色", exact: true }).click()
    let confirm = page.getByRole("alertdialog", { name: "确认高危角色变更" })
    await expect(confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused()
    for (const key of data.role.permission_keys) await expect(confirm.getByText(new RegExp(key.replaceAll(".", "\\.") + "$"))).toBeVisible()
    const before = await roles(page.request)
    await axe(page, ".confirm-dialog"); await capture(page, info, "dangerous-role-diff")
    await confirm.getByRole("button", { name: "取消", exact: true }).click()
    expect(await roles(page.request)).toEqual(before)
    await expect(page.getByRole("button", { name: "创建角色", exact: true })).toBeFocused()
    await page.getByRole("button", { name: "创建角色", exact: true }).click()
    confirm = page.getByRole("alertdialog", { name: "确认高危角色变更" })
    const [saved] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/admin/authorization/roles") && response.request().method() === "POST"), confirm.getByRole("button", { name: "确认保存角色", exact: true }).click()])
    expect(saved.status()).toBe(201)
    const body = await saved.json(); createdId = body.data.id
    expect(body.meta.request_id).toBe(saved.headers()["x-request-id"])
    expect(body.data.permission_keys.slice().sort()).toEqual(data.role.permission_keys.slice().sort())
    expect(body.data.scope).toBe("board")
    await expect(page.getByRole("button", { name: "新建角色", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "切换为深色主题", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await axe(page, ".authorization-admin-panel"); await capture(page, info, "team-catalog-dark")
    await page.getByRole("button", { name: "切换为浅色主题", exact: true }).click()
    await writeFile(info.outputPath("template-evidence.json"), JSON.stringify({ roleId: createdId, scope: body.data.scope, permissionKeys: body.data.permission_keys, cancelledWrites: 0, requestId: body.meta.request_id }, null, 2), "utf8")
  } finally { if (createdId) await payload(await page.request.delete("/api/v1/admin/authorization/roles/" + createdId, { headers: { "x-csrf-token": csrf } })) }
})

test("follows the local team link, previews subtree scope and revokes only its own appointment", async ({ page }, info) => {
  const data = await fixture(info); const csrf = await login(page.request); let createdId: string | undefined
  const before = await assignments(page.request, data.subject.username)
  try {
    await page.goto("/#admin/boards?board_id=" + data.board.id)
    const editor = page.getByRole("dialog", { name: "编辑“" + data.board.name + "”" })
    await editor.getByRole("button", { name: "治理人员", exact: true }).click()
    const [list] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/admin/authorization/assignments" && new URL(response.url()).searchParams.get("scope_id") === data.board.id), editor.getByRole("link", { name: "查看管理团队", exact: true }).click()])
    expect(list.status()).toBe(200)
    await expect(page.getByRole("combobox", { name: "按任命版块筛选", exact: true })).toHaveValue(data.board.id)
    await page.getByRole("button", { name: "新增授权", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "分配角色" })
    await dialog.getByRole("searchbox", { name: "搜索用户", exact: true }).fill(data.subject.username)
    await dialog.getByRole("button", { name: "选择" + data.subject.displayName + " @" + data.subject.username, exact: true }).click()
    await dialog.getByRole("combobox", { name: "自定义角色", exact: true }).selectOption(data.role.id)
    await expect(dialog.getByRole("combobox", { name: "作用板块", exact: true })).toHaveValue(data.board.id)
    await dialog.getByRole("combobox", { name: "包含子版块", exact: true }).selectOption("subtree")
    await expect(dialog.getByLabel("任命到期时间", { exact: true })).toBeDisabled()
    await expect(dialog.getByLabel("任命原因", { exact: true })).toBeDisabled()
    await axe(page, ".admin-action-dialog"); await capture(page, info, "person-and-subtree")
    await dialog.getByRole("button", { name: "预览任命", exact: true }).click()
    let confirm = page.getByRole("alertdialog", { name: "确认任命管理人员" })
    await expect(confirm.getByText("管理范围：" + data.board.name + " · 当前及全部后代。", { exact: true })).toBeVisible()
    await expect(confirm.getByText("期限：长期（当前契约不支持到期任命）", { exact: true })).toBeVisible()
    await axe(page, ".confirm-dialog"); await capture(page, info, "subtree-appointment-preview")
    for (let index = 0; index < 12; index++) { await page.keyboard.press("Tab"); await expect(confirm.locator(":focus")).toHaveCount(1) }
    await page.keyboard.press("Escape")
    expect(await assignments(page.request, data.subject.username)).toEqual(before)
    await expect(dialog.getByRole("button", { name: "预览任命", exact: true })).toBeFocused()
    await dialog.getByRole("button", { name: "预览任命", exact: true }).click()
    confirm = page.getByRole("alertdialog", { name: "确认任命管理人员" })
    const [saved] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/admin/authorization/assignments") && response.request().method() === "POST"), confirm.getByRole("button", { name: "确认任命", exact: true }).click()])
    expect(saved.status()).toBe(201); const body = await saved.json(); createdId = body.data.id
    expect(body.meta.request_id).toBe(saved.headers()["x-request-id"])
    expect(saved.request().postDataJSON()).toEqual({ username: data.subject.username, role_id: data.role.id, scope_id: data.board.id, scope_mode: "subtree" })
    await expect(dialog).toHaveCount(0)
    const row = page.locator(".authorization-assignment-row").filter({ hasText: "@" + data.subject.username })
    await expect(row.getByText(/当前及全部后代/)).toBeVisible()
    await capture(page, info, "stored-subtree-appointment")
    await row.getByRole("button", { name: "撤销", exact: true }).click()
    confirm = page.getByRole("alertdialog", { name: "撤销角色分配" })
    await confirm.getByRole("button", { name: "取消", exact: true }).click()
    expect((await assignments(page.request, data.subject.username)).some(item => item.id === createdId)).toBe(true)
    await row.getByRole("button", { name: "撤销", exact: true }).click()
    await page.getByRole("alertdialog", { name: "撤销角色分配" }).getByRole("button", { name: "确认撤销角色", exact: true }).click()
    await expect(row).toHaveCount(0); createdId = undefined
    expect(await assignments(page.request, data.subject.username)).toEqual(before)
    await writeFile(info.outputPath("appointment-evidence.json"), JSON.stringify({ assignmentId: body.data.id, scopeId: body.data.scope_id, scopeMode: body.data.scope_mode, cancelledWrites: 0, otherScopesPreserved: true, requestId: body.meta.request_id }, null, 2), "utf8")
  } finally { if (createdId) await payload(await page.request.delete("/api/v1/admin/authorization/assignments/" + createdId, { headers: { "x-csrf-token": csrf } })) }
})

test("preserves the local role draft across a real revision conflict", async ({ page }, info) => {
  const data = await fixture(info); const csrf = await login(page.request)
  const original = (await roles(page.request)).find(role => role.id === data.role.id)!
  try {
    await page.goto("/#admin/authorization")
    await page.getByRole("button", { name: "编辑角色：" + original.name, exact: true }).click()
    const localName = original.name + " 本地草稿"
    await page.getByLabel("角色名称", { exact: true }).fill(localName)
    await payload(await page.request.patch("/api/v1/admin/authorization/roles/" + original.id, { headers: { "x-csrf-token": csrf }, data: { name: original.name + " 并发修改", permission_keys: original.permission_keys, expected_revision: original.revision } }))
    const [conflict] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/roles/" + original.id) && response.request().method() === "PATCH"), page.getByRole("button", { name: "保存角色", exact: true }).click()])
    expect(conflict.status()).toBe(409)
    await expect(page.getByText(/本地草稿已保留/)).toBeVisible()
    await expect(page.getByLabel("角色名称", { exact: true })).toHaveValue(localName)
    await capture(page, info, "role-revision-conflict")
    const [saved] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/roles/" + original.id) && response.request().method() === "PATCH"), page.getByRole("button", { name: "保存角色", exact: true }).click()])
    expect(saved.status()).toBe(200); const body = await saved.json(); expect(body.meta.request_id).toBe(saved.headers()["x-request-id"]); expect(body.data.name).toBe(localName)
    await writeFile(info.outputPath("revision-conflict-evidence.json"), JSON.stringify({ roleId: original.id, conflictStatus: 409, savedRevision: body.data.revision, localDraftPreserved: true, requestId: body.meta.request_id }, null, 2), "utf8")
  } finally {
    const latest = (await roles(page.request)).find(role => role.id === original.id)!
    await payload(await page.request.patch("/api/v1/admin/authorization/roles/" + original.id, { headers: { "x-csrf-token": csrf }, data: { name: original.name, permission_keys: original.permission_keys, expected_revision: latest.revision } }))
  }
})

test("keeps the team readable for a read-only role while the server rejects writes", async ({ page, playwright }, info) => {
  const data = await fixture(info); const owner = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL }); const ownerCsrf = await login(owner)
  let roleId: string | undefined; let assignmentId: string | undefined
  try {
    const role = (await payload(await owner.post("/api/v1/admin/authorization/roles", { headers: { "x-csrf-token": ownerCsrf }, data: { key: "v3_team_read_" + randomUUID().replaceAll("-", ""), name: "V3 团队只读", scope: "instance", permission_keys: ["authorization.roles.read", "authorization.assignments.read"] } }), 201)).data
    roleId = role.id
    const assigned = (await payload(await owner.post("/api/v1/admin/authorization/assignments", { headers: { "x-csrf-token": ownerCsrf }, data: { username: data.subject.username, role_id: role.id, scope_id: null, scope_mode: "exact" } }), 201)).data
    assignmentId = assigned.id
    const memberCsrf = await login(page.request, data.subject.username)
    await page.goto("/#admin/authorization")
    await expect(page.getByRole("button", { name: "新建角色", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "人员授权", exact: true }).click()
    await expect(page.getByRole("button", { name: "新增授权", exact: true })).toBeDisabled()
    await expect(page.locator(".authorization-assignment-row").filter({ hasText: "@" + data.subject.username }).filter({ hasText: role.name })).toBeVisible()
    await axe(page, ".authorization-admin-panel"); await capture(page, info, "read-only-management-team")
    await payload(await page.request.patch("/api/v1/admin/authorization/roles/" + data.role.id, { headers: { "x-csrf-token": memberCsrf }, data: { name: "不得写入", permission_keys: data.role.permission_keys, expected_revision: 1 } }), 403)
    await payload(await page.request.post("/api/v1/admin/authorization/assignments", { headers: { "x-csrf-token": memberCsrf }, data: { username: data.subject.username, role_id: data.role.id, scope_id: data.board.id, scope_mode: "exact" } }), 403)
  } finally {
    if (assignmentId) await payload(await owner.delete("/api/v1/admin/authorization/assignments/" + assignmentId, { headers: { "x-csrf-token": ownerCsrf } }))
    if (roleId) await payload(await owner.delete("/api/v1/admin/authorization/roles/" + roleId, { headers: { "x-csrf-token": ownerCsrf } }))
    await owner.dispose()
  }
})

test("audits protected administrator refusal and blocks delegated self-elevation", async ({ page, playwright }, info) => {
  const data = await fixture(info); const csrf = await login(page.request)
  const ownerAssignments = await assignments(page.request, "demo_admin")
  const protectedAssignment = ownerAssignments.find(item => item.role.key === "super_admin")!
  expect(protectedAssignment).toBeDefined()
  const refused = await payload(await page.request.delete("/api/v1/admin/authorization/assignments/" + protectedAssignment.id, { headers: { "x-csrf-token": csrf } }), 409)
  expect(refused.error.code).toBe("authorization.role_system_managed")
  const audit = await payload(await page.request.get("/api/v1/admin/audit", { params: { action: "authorization.assignment.delete.denied", resource_id: protectedAssignment.id, limit: "50" } }))
  expect(audit.data[0].summary).toMatchObject({ reason: "authorization.role_system_managed", role_key: "super_admin", target_username: "demo_admin" })
  expect((await assignments(page.request, "demo_admin")).some(item => item.id === protectedAssignment.id)).toBe(true)
  const member = await playwright.request.newContext({ baseURL: process.env.DAOYUN_WEB_URL }); let roleId: string | undefined; let assignmentId: string | undefined
  try {
    const role = (await payload(await page.request.post("/api/v1/admin/authorization/roles", { headers: { "x-csrf-token": csrf }, data: { key: "v3_team_delegate_" + randomUUID().replaceAll("-", ""), name: "V3 有限任命者", scope: "instance", permission_keys: ["authorization.roles.read", "authorization.assignments.read", "authorization.assignments.write"] } }), 201)).data
    roleId = role.id
    const assigned = (await payload(await page.request.post("/api/v1/admin/authorization/assignments", { headers: { "x-csrf-token": csrf }, data: { username: data.subject.username, role_id: role.id, scope_id: null, scope_mode: "exact" } }), 201)).data
    assignmentId = assigned.id
    const memberCsrf = await login(member, data.subject.username)
    const before = await assignments(page.request, data.subject.username)
    const denied = await payload(await member.post("/api/v1/admin/authorization/assignments", { headers: { "x-csrf-token": memberCsrf }, data: { username: data.subject.username, role_id: data.role.id, scope_id: data.board.id, scope_mode: "subtree" } }), 422)
    expect(denied.error.code).toBe("authorization.permission_invalid")
    expect(await assignments(page.request, data.subject.username)).toEqual(before)
    await writeFile(info.outputPath("protected-and-ceiling-evidence.json"), JSON.stringify({ protectedAssignmentId: protectedAssignment.id, refusalStatus: 409, refusalRequestId: refused.meta.request_id, audited: true, selfElevationStatus: 422, selfElevationCode: denied.error.code, selfElevationRequestId: denied.meta.request_id }, null, 2), "utf8")
  } finally {
    if (assignmentId) await payload(await page.request.delete("/api/v1/admin/authorization/assignments/" + assignmentId, { headers: { "x-csrf-token": csrf } }))
    if (roleId) await payload(await page.request.delete("/api/v1/admin/authorization/roles/" + roleId, { headers: { "x-csrf-token": csrf } }))
    await member.dispose()
  }
})

test("recovers role reads and person searches from isolated request failures", async ({ page }, info) => {
  const data = await fixture(info); await login(page.request)
  await page.route("**/api/v1/admin/authorization/roles", route => route.abort("failed"))
  await page.goto("/#admin/authorization")
  await expect(page.getByRole("alert")).toContainText("角色与权限暂时无法加载")
  await capture(page, info, "role-read-failure")
  await page.unroute("**/api/v1/admin/authorization/roles")
  await page.getByRole("button", { name: "刷新角色与权限", exact: true }).click()
  await expect(page.getByRole("button", { name: "编辑角色：" + data.role.name, exact: true })).toBeVisible()
  await page.getByRole("button", { name: "人员授权", exact: true }).click()
  await page.getByRole("button", { name: "新增授权", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "分配角色" })
  const matcher = (url: URL) => url.pathname === "/api/v1/admin/users"
  await page.route(matcher, route => route.abort("failed"))
  await dialog.getByRole("searchbox", { name: "搜索用户", exact: true }).fill(data.subject.username)
  await expect(dialog.getByRole("alert")).toContainText("人员搜索失败")
  await capture(page, info, "person-search-failure")
  await page.unroute(matcher)
  await dialog.getByRole("button", { name: "重试人员搜索", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "选择" + data.subject.displayName + " @" + data.subject.username, exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("button", { name: "新增授权", exact: true })).toBeFocused()
})
