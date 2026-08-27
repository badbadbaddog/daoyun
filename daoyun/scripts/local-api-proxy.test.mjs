import { Readable } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import { createLocalApiProxy } from "./local-api-proxy.mjs"

function createResponseRecorder() {
  const headers = new Map()
  return {
    headers,
    statusCode: 0,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value)
    },
    end: vi.fn(),
  }
}

describe("createLocalApiProxy", () => {
  it("buffers the upstream response and explicitly ends the browser response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "draft-1" } }), {
      status: 201,
      headers: { "content-type": "application/json", "x-request-id": "request-1" },
    }))
    const middleware = createLocalApiProxy({ target: "http://127.0.0.1:3000", fetchImpl })
    const request = Readable.from([Buffer.from("image-bytes")])
    Object.assign(request, {
      method: "POST",
      url: "/api/v1/attachments/drafts",
      headers: { "content-type": "image/jpeg", host: "127.0.0.1:5173" },
    })
    const response = createResponseRecorder()

    await middleware(request, response, vi.fn())
    await vi.waitFor(() => expect(response.end).toHaveBeenCalledOnce())

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/v1/attachments/drafts",
      expect.objectContaining({ method: "POST", body: expect.any(Uint8Array) }),
    )
    expect(response.statusCode).toBe(201)
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(JSON.stringify({ data: { id: "draft-1" } }))))
    expect(response.headers.get("x-request-id")).toBe("request-1")
    expect(response.end).toHaveBeenCalledWith(expect.any(Uint8Array))
  })

  it("leaves non-API requests to Vite", async () => {
    const next = vi.fn()
    const middleware = createLocalApiProxy({ target: "http://127.0.0.1:3000", fetchImpl: vi.fn() })
    await middleware({ method: "GET", url: "/src/main.tsx", headers: {} }, createResponseRecorder(), next)
    expect(next).toHaveBeenCalledOnce()
  })
})
