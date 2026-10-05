import { readFile } from "node:fs/promises"
import { join } from "node:path"

const kinds = { t: "topics", b: "boards", u: "users" }
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]))

export async function servePublicPage(request, response, { dist, apiOrigin, siteOrigin, fetchImpl = fetch }) {
  response.setHeader("cache-control", "private, no-store")
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.statusCode = 405; response.setHeader("allow", "GET, HEAD"); response.end(); return
  }
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname
  const match = pathname.match(/^\/(t|b|u)\/([^/]+)$/)
  let status = 404, data, invalidIdentifier = false
  try {
    if (pathname === "/sitemap.xml") {
      const urls = new Set(); const signal = AbortSignal.timeout(10000); let cursor
      do {
        const url = new URL("/api/v1/topics?limit=50&sort=latest", apiOrigin)
        if (cursor) url.searchParams.set("cursor", cursor)
        const upstream = await fetchImpl(url.href, { headers: { accept: "application/json" }, redirect: "manual", signal })
        if (!upstream.ok) throw new Error("sitemap unavailable")
        const page = await upstream.json()
        for (const topic of page.data) urls.add(new URL("/t/" + encodeURIComponent(topic.id), siteOrigin).href)
        if (urls.size > 50000 || (cursor && cursor === page.meta.next_cursor)) throw new Error("sitemap limit exceeded")
        cursor = page.meta.next_cursor
      } while (cursor)
      const xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + [...urls].map(url => "<url><loc>" + escapeHtml(url) + "</loc></url>").join("") + "</urlset>"
      response.statusCode = 200; response.setHeader("content-type", "application/xml; charset=utf-8")
      response.setHeader("content-length", String(Buffer.byteLength(xml))); response.end(request.method === "HEAD" ? undefined : xml); return
    }
    if (pathname === "/robots.txt") {
      const body = "User-agent: *\nAllow: /t/\nAllow: /b/\nAllow: /u/\nDisallow: /api/\nSitemap: " + new URL("/sitemap.xml", siteOrigin).href + "\n"
      response.statusCode = 200; response.setHeader("content-type", "text/plain; charset=utf-8")
      response.setHeader("content-length", String(Buffer.byteLength(body))); response.end(request.method === "HEAD" ? undefined : body); return
    }
    if (match) {
      const upstream = await fetchImpl(new URL("/api/v1/" + kinds[match[1]] + "/" + match[2], apiOrigin).href, {
        headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10000),
      })
      invalidIdentifier = [400,422].includes(upstream.status)
      status = upstream.status === 200 ? 200 : [403,404].includes(upstream.status) ? upstream.status : [400,422].includes(upstream.status) ? 404 : 503
      if (status === 200) data = (await upstream.json()).data
    }
    let html = await readFile(join(dist, "index.html"), "utf8")
    const title = status === 200 ? data.title || data.name || data.display_name || data.username || "DaoYun" : status === 503 ? "页面暂时不可用" : "页面不可访问"
    const description = status === 200 ? (data.excerpt || data.description || data.bio || "").slice(0,200) : "请检查链接或登录后重试。"
    html = html.replace(/<title>[\s\S]*?<\/title>/i, () => "<title>" + escapeHtml(title) + " · DaoYun</title>")
      .replace(/<meta\s+name="description"[^>]*>/i, () => '<meta name="description" content="' + escapeHtml(description) + '">')
    const metadata = status === 200
      ? '<link rel="canonical" href="' + escapeHtml(new URL(pathname, siteOrigin).href) + '"><meta property="og:title" content="' + escapeHtml(title) + '"><meta property="og:description" content="' + escapeHtml(description) + '">'
      : '<meta name="robots" content="noindex, nofollow">'
    html = html.replace("</head>", () => metadata + "</head>").replace("</body>", () => "<noscript><main><h1>" + escapeHtml(title) + "</h1><p>" + escapeHtml(description) + "</p></main></noscript></body>")
    if (!match || invalidIdentifier) html = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>页面不存在</title><meta name="robots" content="noindex, nofollow"></head><body><main><h1>页面不存在</h1><a href="/">返回社区</a></main></body></html>'
    if (status !== 200) response.setHeader("x-robots-tag", "noindex, nofollow")
    response.statusCode = status
    response.setHeader("content-type", "text/html; charset=utf-8")
    response.setHeader("content-length", String(Buffer.byteLength(html)))
    response.end(request.method === "HEAD" ? undefined : html)
  } catch {
    response.statusCode = 503; response.setHeader("x-robots-tag", "noindex, nofollow"); response.end(request.method === "HEAD" ? undefined : "页面暂时不可用")
  }
}
