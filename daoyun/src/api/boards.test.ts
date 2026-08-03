import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { listBoards } from "./boards"

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe("listBoards", () => {
  it("validates and maps the public board response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: "019fc630-0000-7000-8000-000000000001",
          slug: "engineering",
          name: "工程实践",
          description: "Rust、架构与部署",
          icon: "code",
          tone: "green",
          topic_count: 12,
        }],
        meta: {
          request_id: "019fc630-0000-7000-8000-000000000002",
          next_cursor: null,
        },
      }),
    })

    await expect(listBoards()).resolves.toEqual([{
      id: "019fc630-0000-7000-8000-000000000001",
      slug: "engineering",
      name: "工程实践",
      description: "Rust、架构与部署",
      icon: "code",
      tone: "green",
      topicCount: 12,
    }])
  })

  it("rejects a malformed board response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ slug: "missing-fields" }], meta: {} }),
    })

    await expect(listBoards()).rejects.toThrow("板块响应格式无效")
  })

  it("rejects a non-successful board response", async () => {
    fetchMock.mockResolvedValue({ ok: false })

    await expect(listBoards()).rejects.toThrow("板块请求失败")
  })
})
