import { readFile, stat } from "node:fs/promises"
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path"

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

export async function serveStaticWeb(request, response, distributionDirectory) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.statusCode = 405
    response.setHeader("allow", "GET, HEAD")
    response.end()
    return
  }

  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)
    const requestedPath = resolve(distributionDirectory, `.${pathname}`)
    const relativePath = relative(distributionDirectory, requestedPath)
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("invalid static path")

    const filePath = await resolveWebFile(requestedPath, distributionDirectory)
    const body = await readFile(filePath)
    response.statusCode = 200
    response.setHeader("content-type", contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream")
    response.setHeader("content-length", String(body.byteLength))
    response.setHeader("cache-control", filePath.startsWith(`${join(distributionDirectory, "assets")}${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache")
    response.end(request.method === "HEAD" ? undefined : body)
  } catch {
    const body = Buffer.from("页面资源不存在")
    response.statusCode = 404
    response.setHeader("content-type", "text/plain; charset=utf-8")
    response.setHeader("content-length", String(body.byteLength))
    response.end(request.method === "HEAD" ? undefined : body)
  }
}

async function resolveWebFile(requestedPath, distributionDirectory) {
  try {
    if ((await stat(requestedPath)).isFile()) return requestedPath
  } catch {
    // Client-side routes fall through to the SPA entry point.
  }
  if (extname(requestedPath)) throw new Error("static asset does not exist")
  return join(distributionDirectory, "index.html")
}
