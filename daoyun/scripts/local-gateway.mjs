import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { proxyBufferedRequest } from "./local-api-proxy.mjs"
import { serveStaticWeb } from "./local-static.mjs"

const GATEWAY_HOST = "127.0.0.1"
const GATEWAY_PORT = 5173
const API_TARGET = "http://127.0.0.1:3000"
const distributionDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "dist")

const server = createServer((request, response) => {
  if (request.url?.startsWith("/api/")) {
    proxyBufferedRequest(request, response, API_TARGET)
    return
  }
  void serveStaticWeb(request, response, distributionDirectory)
})

server.on("upgrade", (_request, socket) => socket.destroy())
server.listen(GATEWAY_PORT, GATEWAY_HOST, () => {
  console.log(`[DaoYun] Local gateway ready at http://${GATEWAY_HOST}:${GATEWAY_PORT}/`)
})

const stop = () => server.close(() => process.exit(0))
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
