import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { servePublicPage } from "./public-pages.mjs"
const directories = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const topicId = "019a2060-9400-7000-8000-000000000001"
async function setup(fetchImpl) {
  const dist = await mkdtemp(join(tmpdir(), "daoyun-public-")); directories.push(dist)
  await writeFile(join(dist, "index.html"), '<html><head><title>DaoYun</title><meta name="description" content="default"></head><body><div id="root"></div></body></html>', "utf8")
  const headers = new Map(); let body
  const response = { statusCode: 0, setHeader: (key, value) => headers.set(key.toLowerCase(), value), end: value => { body = value?.toString() ?? "" } }
  return { response, headers, body: () => body, options: { dist, apiOrigin: "http://127.0.0.1:3000", siteOrigin: "https://community.example", fetchImpl } }
}
describe("public web pages", () => {
  it("renders only anonymous API content with escaped metadata and a floor-free canonical", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { title: 'Title <script>alert(1)</script>', excerpt: 'Public & "summary"' } })))
    const s = await setup(fetchImpl)
    await servePublicPage({ method: "GET", url: "/t/" + topicId + "?reply=019a2060-9400-7000-8000-000000000002", headers: { cookie: "private-session", authorization: "private-bearer" } }, s.response, s.options)
    expect(s.response.statusCode).toBe(200)
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:3000/api/v1/topics/" + topicId, expect.objectContaining({ headers: { accept: "application/json" } }))
    expect(s.body()).toContain('rel="canonical" href="https://community.example/t/' + topicId + '"')
    expect(s.body()).toContain("&lt;script&gt;")
    expect(s.body()).toContain("Public &amp; &quot;summary&quot;")
    expect(s.body()).not.toContain("<script>alert(1)</script>")
    expect(s.headers.get("cache-control")).toBe("private, no-store")
  })
  it.each([403,404,503])("preserves HTTP %s and omits denied upstream details and canonical", async status => {
    const s = await setup(vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "SECRET_TITLE_AND_BODY" } }), { status })))
    await servePublicPage({ method: "GET", url: "/t/" + topicId }, s.response, s.options)
    expect(s.response.statusCode).toBe(status)
    expect(s.body()).not.toContain("SECRET_TITLE_AND_BODY")
    expect(s.body()).not.toContain('rel="canonical"')
    expect(s.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  })
  it("does not turn an unknown path into HTTP 200", async () => {
    const fetchImpl = vi.fn(); const s = await setup(fetchImpl)
    await servePublicPage({ method: "GET", url: "/private/admin" }, s.response, s.options)
    expect(s.response.statusCode).toBe(404); expect(fetchImpl).not.toHaveBeenCalled(); expect(s.body()).not.toContain('id="root"')
  })
  it("serves HEAD without a body and rejects mutation methods", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { name: "Board", description: "Public board" } })))
    const s = await setup(fetchImpl)
    await servePublicPage({ method: "HEAD", url: "/b/general" }, s.response, s.options)
    expect(s.response.statusCode).toBe(200); expect(s.body()).toBe("")
    expect(Number(s.headers.get("content-length"))).toBeGreaterThan(0)
    await servePublicPage({ method: "POST", url: "/b/general" }, s.response, s.options)
    expect(s.response.statusCode).toBe(405); expect(s.headers.get("allow")).toBe("GET, HEAD")
  })
})

it("includes only anonymous feed URLs in a paginated sitemap", async () => {
  const second = "019a2060-9400-7000-8000-000000000003"
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: topicId }], meta: { next_cursor: "opaque&cursor" } }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: second }], meta: { next_cursor: null } })))
  const s = await setup(fetchImpl)
  await servePublicPage({ method: "GET", url: "/sitemap.xml", headers: { cookie: "private" } }, s.response, s.options)
  expect(s.response.statusCode).toBe(200)
  expect(s.body()).toContain("https://community.example/t/" + topicId)
  expect(s.body()).toContain("https://community.example/t/" + second)
  expect(s.body()).not.toContain("/admin")
  expect(fetchImpl.mock.calls[1][0]).toContain("cursor=opaque%26cursor")
  expect(fetchImpl.mock.calls.every(call => Object.keys(call[1].headers).join() === "accept")).toBe(true)
  expect(s.headers.get("cache-control")).toBe("private, no-store")
})
it("fails closed rather than serving a partial sitemap after an API failure", async () => {
  const s = await setup(vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })))
  await servePublicPage({ method: "GET", url: "/sitemap.xml" }, s.response, s.options)
  expect(s.response.statusCode).toBe(503)
  expect(s.body()).not.toContain("<urlset")
})

it("preserves dollar replacement sequences in escaped public metadata", async () => {
  const title = "Cost $& $" + String.fromCharCode(96) + " $'"
  const s = await setup(vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { title, excerpt: title } }))))
  await servePublicPage({ method: "GET", url: "/t/" + topicId }, s.response, s.options)
  const document = new DOMParser().parseFromString(s.body(), "text/html")
  expect(document.title).toBe(title + " · DaoYun")
  expect(document.querySelector('meta[name="description"]').getAttribute("content")).toBe(title)
})
it("returns 404 for an invalid resource identifier rejected by the API", async () => {
  const s = await setup(vi.fn().mockResolvedValue(new Response("bad identifier", { status: 400 })))
  await servePublicPage({ method: "GET", url: "/t/not-an-id" }, s.response, s.options)
  expect(s.response.statusCode).toBe(404)
})
