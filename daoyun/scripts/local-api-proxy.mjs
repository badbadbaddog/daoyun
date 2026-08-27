const MAX_PROXY_REQUEST_BYTES = 11 * 1024 * 1024
const PROXY_TIMEOUT_MS = 60_000
const skippedRequestHeaders = new Set(["connection", "content-length", "host", "proxy-connection", "transfer-encoding"])
const skippedResponseHeaders = new Set(["connection", "content-length", "keep-alive", "proxy-connection", "transfer-encoding"])

export function createLocalApiProxy({ target, fetchImpl = fetch }) {
  const targetOrigin = new URL(target).origin

  return function localApiProxy(request, response, next) {
    if (!request.url?.startsWith("/api/")) {
      next()
      return
    }

    proxyBufferedRequest(request, response, targetOrigin, fetchImpl)
  }
}

export function proxyBufferedRequest(request, response, target, fetchImpl = fetch) {
  void proxyRequest(request, response, new URL(target).origin, fetchImpl)
}

async function proxyRequest(request, response, targetOrigin, fetchImpl) {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), PROXY_TIMEOUT_MS)

  try {
    const method = request.method ?? "GET"
    const requestBody = method === "GET" || method === "HEAD"
      ? undefined
      : await readRequestBody(request)
    const upstream = await fetchImpl(`${targetOrigin}${request.url}`, {
      method,
      headers: copyRequestHeaders(request.headers),
      body: requestBody,
      redirect: "manual",
      signal: timeoutController.signal,
    })
    const responseBody = new Uint8Array(await upstream.arrayBuffer())

    response.statusCode = upstream.status
    upstream.headers.forEach((value, name) => {
      if (!skippedResponseHeaders.has(name.toLowerCase()) && name.toLowerCase() !== "set-cookie") {
        response.setHeader(name, value)
      }
    })
    const cookies = upstream.headers.getSetCookie?.() ?? []
    if (cookies.length > 0) response.setHeader("set-cookie", cookies)
    response.setHeader("content-length", String(responseBody.byteLength))
    response.end(responseBody)
  } catch {
    const body = Buffer.from(JSON.stringify({
      error: { code: "proxy.unavailable", message: "本地 API 暂时不可用" },
    }))
    response.statusCode = 502
    response.setHeader("content-type", "application/json; charset=utf-8")
    response.setHeader("content-length", String(body.byteLength))
    response.end(body)
  } finally {
    clearTimeout(timeout)
  }
}

function copyRequestHeaders(source) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(source ?? {})) {
    if (value === undefined || skippedRequestHeaders.has(name.toLowerCase())) continue
    headers.set(name, Array.isArray(value) ? value.join(", ") : value)
  }
  return headers
}

async function readRequestBody(request) {
  const chunks = []
  let totalBytes = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_PROXY_REQUEST_BYTES) throw new Error("proxy request body is too large")
    chunks.push(bytes)
  }
  return new Uint8Array(Buffer.concat(chunks))
}
