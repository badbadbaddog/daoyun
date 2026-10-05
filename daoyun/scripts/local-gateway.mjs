import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { proxyBufferedRequest } from "./local-api-proxy.mjs"
import { serveStaticWeb } from "./local-static.mjs"
import { servePublicPage } from "./public-pages.mjs"

const GATEWAY_HOST = process.env.DAOYUN_WEB_HOST ?? "127.0.0.1"
const GATEWAY_PORT = Number(process.env.DAOYUN_WEB_PORT ?? 5173)
const API_TARGET = new URL(process.env.DAOYUN_API_ORIGIN ?? "http://127.0.0.1:3000").origin
const siteOrigin = new URL(process.env.DAOYUN_PUBLIC_SITE_URL ?? `http://${GATEWAY_HOST}:${GATEWAY_PORT}`).origin
const distributionDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "dist")

const server = createServer((request, response) => {
  if (request.url?.startsWith("/api/")) {
    proxyBufferedRequest(request, response, API_TARGET)
    return
  }
  const pathname = new URL(request.url ?? "/", siteOrigin).pathname
  if (pathname === "/" || pathname === "/index.html" || pathname.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(pathname) && !["/sitemap.xml", "/robots.txt"].includes(pathname)) {
    void serveStaticWeb(request, response, distributionDirectory)
    return
  }
  void servePublicPage(request, response, { dist: distributionDirectory, apiOrigin: API_TARGET, siteOrigin })
})

server.on("upgrade", (_request, socket) => socket.destroy())
server.listen(GATEWAY_PORT, GATEWAY_HOST, () => {
  console.log(`[DaoYun] Local gateway ready at http://${GATEWAY_HOST}:${GATEWAY_PORT}/`)
})

const stop = () => server.close(() => process.exit(0))
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
