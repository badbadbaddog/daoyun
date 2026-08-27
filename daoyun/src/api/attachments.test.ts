import { afterEach, describe, expect, it, vi } from "vitest"

import { AttachmentApiError, uploadDraftImage } from "./attachments"

const draftPayload = {
  data: {
    id: "0198d874-e991-7b62-8b38-3986f55c8d3d",
    original_name: "配图.png",
    mime_type: "image/png",
    size_bytes: 3,
    expires_at: "2026-08-24T10:00:00Z",
  },
  meta: { request_id: "0198d874-e991-7b62-8b38-3986f55c8d3e" },
}

function installRequestMock(status: number, payload: unknown, autoRespond = true) {
  const requests: Array<{
    body?: Document | XMLHttpRequestBodyInit | null
    headers: Headers
    method?: string
    upload: { onprogress: ((event: ProgressEvent) => void) | null }
    url?: string
    withCredentials: boolean
  }> = []
  class MockRequest {
    readonly headers = new Headers()
    readonly upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
    body?: Document | XMLHttpRequestBodyInit | null
    method?: string
    url?: string
    withCredentials = false
    readonly status = status
    readonly responseText = JSON.stringify(payload)
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null

    constructor() {
      requests.push(this)
    }

    open(method: string, url: string) {
      this.method = method
      this.url = url
    }

    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value)
    }

    send(body?: Document | XMLHttpRequestBodyInit | null) {
      this.body = body
      if (autoRespond) queueMicrotask(() => this.onload?.())
    }

    abort() {
      this.onabort?.()
    }
  }
  vi.stubGlobal("XMLHttpRequest", MockRequest)
  return requests
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("uploadDraftImage", () => {
  it("uses the request completion event instead of waiting on a stalled Fetch promise", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })
    ))
    class CompletedRequest {
      readonly upload = new EventTarget()
      status = 201
      responseText = JSON.stringify(draftPayload)
      withCredentials = false
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      open = vi.fn()
      setRequestHeader = vi.fn()
      send = vi.fn(() => queueMicrotask(() => this.onload?.()))
      abort = vi.fn(() => this.onabort?.())
    }
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("XMLHttpRequest", CompletedRequest)
    const controller = new AbortController()
    const upload = uploadDraftImage(
      new File(["jpg"], "配图.jpg", { type: "image/jpeg" }),
      "csrf-token",
      undefined,
      controller.signal,
    )
    const observed = upload.then(
      (attachment) => ({ state: "resolved" as const, attachment }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    )

    const result = await Promise.race([
      observed,
      new Promise<{ state: "pending" }>((resolve) => setTimeout(() => resolve({ state: "pending" }), 50)),
    ])
    controller.abort()
    await observed

    expect(result).toMatchObject({ state: "resolved", attachment: { id: draftPayload.data.id } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uploads a stable byte snapshot with security headers", async () => {
    const requests = installRequestMock(201, draftPayload)
    const progress = vi.fn()
    const file = new File(["png"], "配图.png", { type: "image/png" })

    await expect(uploadDraftImage(file, "csrf-token", progress)).resolves.toMatchObject({
      id: draftPayload.data.id,
      originalName: "配图.png",
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "POST", url: "/api/v1/attachments/drafts", withCredentials: true })
    expect(requests[0].headers.get("Content-Type")).toBe("image/png")
    expect(requests[0].headers.get("x-file-name")).toBe(encodeURIComponent("配图.png"))
    expect(requests[0].headers.get("x-csrf-token")).toBe("csrf-token")
    expect(requests[0].body).toBeInstanceOf(ArrayBuffer)
    expect(Array.from(new Uint8Array(requests[0].body as ArrayBuffer))).toEqual([112, 110, 103])
    expect(progress).toHaveBeenCalledWith(100)
  })

  it("rejects unsupported or oversized images before sending", async () => {
    const requests = installRequestMock(201, draftPayload)

    await expect(uploadDraftImage(
      new File(["text"], "note.txt", { type: "text/plain" }),
      "csrf",
    )).rejects.toBeInstanceOf(AttachmentApiError)
    await expect(uploadDraftImage(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
      "csrf",
    )).rejects.toMatchObject({ code: "attachment.too_large" })
    expect(requests).toHaveLength(0)
  })

  it("surfaces a quota error returned by the draft endpoint", async () => {
    installRequestMock(429, {
      error: { code: "community.quota_exceeded", message: "今日图片上传次数已用完" },
      meta: { request_id: "0198d874-e991-7b62-8b38-3986f55c8d3e" },
    })

    await expect(uploadDraftImage(
      new File(["jpg"], "配图.jpg", { type: "image/jpeg" }),
      "csrf-token",
    )).rejects.toMatchObject({
      status: 429,
      code: "community.quota_exceeded",
      message: "今日图片上传次数已用完",
    })
  })

  it("aborts an unfinished request when the editor closes", async () => {
    const requests = installRequestMock(201, draftPayload, false)
    const controller = new AbortController()
    const pending = uploadDraftImage(
      new File(["png"], "配图.png", { type: "image/png" }),
      "csrf-token",
      undefined,
      controller.signal,
    )
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: "request.aborted" })
  })
})
