import { randomUUID, createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { expect, test, type APIResponse, type Page, type Locator } from "@playwright/test"
test.skip(process.env.DAOYUN_V3_E2E !== "1", "Requires the isolated V3 instance")
test.use({ trace: "off", video: "off", actionTimeout: 10000 })
test.setTimeout(120000)
const password = "DaoYunLocalOnly!2026"
async function data(response: APIResponse, status = 200) {
  expect(response.status(), new URL(response.url()).pathname).toBe(status)
  const body = await response.json(); expect(body.meta.request_id).toBe(response.headers()["x-request-id"]); return body.data
}
async function login(page: Page) {
  return data(await page.request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password } }))
}
async function publisher(page: Page) {
  const username = "v3_finish_" + randomUUID().replaceAll("-", "").slice(0,16)
  return data(await page.request.post("/api/v1/auth/register", { data: { username, email: username + "@example.test", display_name: "V3 收尾作者", password } }),201)
}
async function keyboard(page: Page, open: boolean) {
  await page.evaluate(open => {
    if (open) Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 360 })
    else Reflect.deleteProperty(window.visualViewport!, "height")
    window.visualViewport!.dispatchEvent(new Event("resize"))
  }, open)
}
async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded()
  for(let step=0;step<8;step++){
    const current=await control.boundingBox(); if(current && current.y>=0 && current.y+current.height<=361) break
    await control.page().mouse.move(200,300)
    await control.page().mouse.wheel(0,current && current.y<0 ? current.y-20 : Math.max(80,(current?.y??0)+(current?.height??0)-320))
    await control.page().waitForTimeout(100)
  }
  const box = await control.boundingBox()
  expect(box).not.toBeNull(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(361)
}
test("keeps appointment and role-save controls and errors reachable above a modeled keyboard", async ({ page }, info) => {
  expect(new URL(process.env.DAOYUN_WEB_URL!).hostname).toBe("127.0.0.1")
  const session = await login(page), nonce = randomUUID().replaceAll("-", "")
  const headers = { "x-csrf-token": session.csrf_token }
  const role = await data(await page.request.post("/api/v1/admin/authorization/roles", { headers, data: { key: "v3_finish_" + nonce, name: "键盘收尾 " + nonce, scope: "board", permission_keys: ["moderation.topic"] } }),201)
  let assignmentId: string | undefined
  try {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto("/#admin/authorization?view=assignments")
    await page.getByRole("button", { name: "新增授权", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "分配角色" })
    const names: string[] = JSON.parse(process.env.DAOYUN_GOVERNANCE_FIXTURE_USERS!)
    await dialog.getByRole("searchbox", { name: "搜索用户", exact: true }).fill(names[info.project.name.includes("mobile") ? 3 : 0])
    await dialog.locator(".admin-user-picker li button").first().click()
    await dialog.getByRole("combobox", { name: "自定义角色", exact: true }).selectOption(role.id)
    const board = await dialog.getByRole("combobox", { name: "作用板块", exact: true }).locator("option").nth(1).getAttribute("value")
    await dialog.getByRole("combobox", { name: "作用板块", exact: true }).selectOption(board!)
    await keyboard(page,true)
    const preview = dialog.getByRole("button", { name: "预览任命", exact: true }); await reachable(preview); await preview.click()
    const confirm = page.getByRole("alertdialog", { name: "确认任命管理人员" })
    const commit = confirm.getByRole("button", { name: "确认任命", exact: true }); await reachable(commit)
    const saved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/admin/authorization/assignments")
    await commit.click(); const response = await saved; expect(response.status()).toBe(201); assignmentId = (await response.json()).data.id
    await keyboard(page,false)
    await page.goto("/#admin/authorization")
    await page.getByRole("button", { name: /^角色目录/ }).click()
    await page.getByRole("button", { name: "编辑角色：" + role.name, exact: true }).click()
    await page.getByLabel("角色名称", { exact: true }).fill(role.name + " 本地输入")
    await data(await page.request.patch("/api/v1/admin/authorization/roles/" + role.id, { headers, data: { name: role.name + " 并发", permission_keys: role.permission_keys, expected_revision: role.revision } }))
    await keyboard(page,true)
    const save = page.getByRole("button", { name: "保存角色", exact: true }); await reachable(save); await save.click()
    const conflict = page.getByText(/本地草稿已保留/); await expect(conflict).toBeVisible(); await reachable(conflict)
    await expect(page.getByLabel("角色名称", { exact: true })).toHaveValue(role.name + " 本地输入")
    await reachable(save); await save.click(); await expect(page.getByText("角色已保存", { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath("keyboard-role-saved.png") })
    await writeFile(info.outputPath("keyboard-model.json"), JSON.stringify({ width:390, layoutHeight:900, visibleHeight:360, method:"EMULATED_VISUAL_VIEWPORT", physicalDevice:"NOT_RUN", appointmentSaved:true, roleConflictInputPreserved:true, roleSaved:true },null,2),"utf8")
  } finally {
    await keyboard(page,false)
    if (assignmentId) await data(await page.request.delete("/api/v1/admin/authorization/assignments/" + assignmentId,{headers}))
    await data(await page.request.delete("/api/v1/admin/authorization/roles/" + role.id,{headers}))
  }
})

test("opens public URLs and converts a hash floor link without losing browser history", async ({ page }, info) => {
  const session = await publisher(page), marker = "DYR027_" + randomUUID()
  const headers = { "x-csrf-token": session.csrf_token, "idempotency-key": randomUUID() }
  const topic = await data(await page.request.post("/api/v1/topics", { headers, data: { title: marker, content: marker + " public content" } }),201)
  const reply = await data(await page.request.post("/api/v1/topics/" + topic.id + "/replies",{headers:{...headers,"idempotency-key":randomUUID()},data:{content:marker + " floor"}}),201)
  await page.goto("/#topic/" + topic.id + "?reply=" + reply.id)
  await expect(page).toHaveURL(new RegExp("/t/" + topic.id + "\\?reply=" + reply.id + "$"))
  await expect(page.getByRole("article",{name:"第 1 楼回复",exact:true})).toBeFocused()
  expect((await page.reload())!.status()).toBe(200)
  await expect(page.getByRole("article",{name:"第 1 楼回复",exact:true})).toBeFocused()
  await page.goto("/b/" + topic.board.slug)
  await expect(page.getByRole("heading",{name:topic.board.name,exact:true}).first()).toBeVisible()
  await page.goto("/u/demo_admin")
  const profile = await data(await page.request.get("/api/v1/users/demo_admin"))
  await expect(page.getByRole("heading",{name:profile.display_name,exact:true}).first()).toBeVisible()
  await page.goBack(); await expect(page).toHaveURL(new RegExp("/b/" + topic.board.slug + "$"))
  await page.goBack(); await expect(page.getByRole("article",{name:"第 1 楼回复",exact:true})).toBeFocused()
  await page.goForward(); await expect(page).toHaveURL(new RegExp("/b/" + topic.board.slug + "$"))
  expect((await page.request.get("/t/" + randomUUID())).status()).toBe(404)
  expect((await page.request.get("/b/missing-" + randomUUID())).status()).toBe(404)
  expect((await page.request.get("/u/missing_" + randomUUID().replaceAll("-","").slice(0,12))).status()).toBe(404)
  expect((await page.request.get("/unknown-public-path")).status()).toBe(404)
  await writeFile(info.outputPath("public-routes.json"),JSON.stringify({topicId:topic.id,replyId:reply.id,directRefresh:200,missingStatuses:[404,404,404,404],hashConverted:true,floorPreserved:true,historyPreserved:true},null,2),"utf8")
})

test("revalidates anonymous HTML API originals thumbnails and sitemap through the real proxy and browser cache", async ({ page, browser },info) => {
  let session = await publisher(page)
  const marker = "DYR027PRIVATE_" + randomUUID()
  let headers = { "x-csrf-token": session.csrf_token }
  const topic = await data(await page.request.post("/api/v1/topics",{headers:{...headers,"idempotency-key":randomUUID()},data:{title:marker,content:marker + " secret body"}}),201)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")
  const attachment = await data(await page.request.post("/api/v1/topics/" + topic.id + "/attachments",{headers:{...headers,"content-type":"image/png","x-file-name":"privacy.png"},data:png}),201)
  session = await login(page); headers = { "x-csrf-token": session.csrf_token }
  const context = await browser.newContext({baseURL:process.env.DAOYUN_WEB_URL}), guest = await context.newPage()
  const path = "/api/v1/admin/content-access-policies/topic/" + topic.id
  let revision: number | undefined
  const cached: string[] = [], seen: {url:string,status:number,disk:boolean,worker:boolean}[] = []
  const cdp = await context.newCDPSession(guest); await cdp.send("Network.enable")
  cdp.on("Network.requestServedFromCache",event=>cached.push(event.requestId))
  cdp.on("Network.responseReceived",event=>{if(event.response.url.includes(topic.id)||event.response.url.includes(attachment.id))seen.push({url:event.response.url,status:event.response.status,disk:event.response.fromDiskCache??false,worker:event.response.fromServiceWorker??false})})
  const resources = ["/t/"+topic.id,"/api/v1/topics/"+topic.id,"/api/v1/attachments/"+attachment.id,"/api/v1/attachments/"+attachment.id+"/thumbnail"]
  async function probe(expected:number) {
    const rows = await guest.evaluate(async paths=>Promise.all(paths.map(async path=>{
      const response = await fetch(path), bytes = new Uint8Array(await response.arrayBuffer())
      const compareBytes = response.ok && response.headers.get("content-type")?.includes("application/json") ? new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)).data)) : bytes
      const digest = await crypto.subtle.digest("SHA-256",compareBytes)
      return {path,status:response.status,cache:response.headers.get("cache-control"),hash:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join(""),text:new TextDecoder().decode(bytes)}
    })),resources)
    for(const row of rows){expect(row.status,row.path).toBe(expected === 200 && row.path === resources[2] ? 403 : expected);expect(row.cache).toBe("private, no-store");if(row.status!==200)expect(row.text).not.toContain(marker)}
    return rows.map(({text,...row})=>row)
  }
  try {
    await guest.goto("/")
    const publicRows=await probe(200);expect(publicRows[3].hash).toBe(createHash("sha256").update(await (await page.request.get(resources[3])).body()).digest("hex"))
    await probe(200)
    const authenticated = await browser.newContext({ baseURL: process.env.DAOYUN_WEB_URL })
    const memberPage = await authenticated.newPage()
    try {
      await authenticated.request.post("/api/v1/auth/login", { data: { identifier: "demo_admin", password } })
      await memberPage.goto("/")
      for(let round=0;round<2;round++){
        const result=await memberPage.evaluate(async path=>{const response=await fetch(path);return {status:response.status,cache:response.headers.get("cache-control"),bytes:[...new Uint8Array(await response.arrayBuffer())]}},resources[2])
        expect(result.status).toBe(200);expect(result.cache).toBe("private, no-store");expect(createHash("sha256").update(Buffer.from(result.bytes)).digest("hex")).toBe(createHash("sha256").update(png).digest("hex"))
      }
      await authenticated.clearCookies()
      const denied=await memberPage.evaluate(async path=>{const response=await fetch(path);return {status:response.status,cache:response.headers.get("cache-control"),text:await response.text()}},resources[2])
      expect(denied.status).toBe(403);expect(denied.cache).toBe("private, no-store");expect(denied.text).not.toContain(marker)
    } finally { await authenticated.close() }
    expect(await (await context.request.get("/sitemap.xml")).text()).toContain("/t/"+topic.id)
    const policy=await data(await page.request.put(path,{headers,data:{operator:"any_of",subjects:[{subject_type:"authenticated",community_group_id:null,subject_key:null}],expected_revision:null}}));revision=policy.revision
    const deniedRows=await probe(404);await probe(404)
    const sitemap=await context.request.get("/sitemap.xml");expect(sitemap.status()).toBe(200);expect(await sitemap.text()).not.toContain(topic.id)
    const privateHtml=await page.request.get("/t/"+topic.id);expect(privateHtml.status()).toBe(404);expect(await privateHtml.text()).not.toContain(marker);expect(privateHtml.headers()["x-robots-tag"]).toBe("noindex, nofollow")
    expect((await guest.goto("/t/"+topic.id))!.status()).toBe(404)
    await expect(guest.getByText(marker,{exact:true})).toHaveCount(0)
    const restored=await data(await page.request.put(path,{headers,data:{operator:"any_of",subjects:[{subject_type:"public",community_group_id:null,subject_key:null}],expected_revision:revision}}));revision=restored.revision
    const restoredRows=await probe(200);expect(restoredRows.filter(row=>row.status===200).map(row=>row.hash)).toEqual(publicRows.filter(row=>row.status===200).map(row=>row.hash))
    expect(seen.some(row=>row.disk||row.worker)).toBe(false)
    // Hashed static assets may legitimately be cached; sensitive resource events are checked above.
    await writeFile(info.outputPath("proxy-cache-transition.json"),JSON.stringify({topicId:topic.id,attachmentId:attachment.id,publicRows,deniedRows,restoredRows,seen,sensitiveCached:false,upstream:"REAL_AXUM_HTTP",proxy:"NODE_LOCAL_GATEWAY",browserCache:"DEFAULT_CHROMIUM_CACHE",deployedCdn:"NOT_CONFIGURED",anonymousMetadataEvenForAuthenticatedRequest:true,originalGuestPolicy:"403_FROM_START",authenticatedOriginalWarmedThenSignedOut:"200_TO_403_NO_CACHE_REUSE"},null,2),"utf8")
  } finally {
    if(revision)await data(await page.request.put(path,{headers,data:{operator:"any_of",subjects:[{subject_type:"public",community_group_id:null,subject_key:null}],expected_revision:revision}}))
    await cdp.detach();await context.close()
  }
})
