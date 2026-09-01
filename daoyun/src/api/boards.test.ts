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
          parent_id: null,
          slug: "engineering",
          name: "工程实践",
          description: "Rust、架构与部署",
          icon: "code",
          tone: "green",
          position: 10,
          depth: 0,
          child_count: 0,
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
      parentId: null,
      slug: "engineering",
      name: "工程实践",
      description: "Rust、架构与部署",
      icon: "code",
      tone: "green",
      position: 10,
      depth: 0,
      childCount: 0,
      topicCount: 12,
    }])
  })

  it("loads every board page before returning the directory hierarchy", async () => {
    const nextCursor = "019fc630-0000-7000-8000-000000000003"
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            id: "019fc630-0000-7000-8000-000000000001",
            parent_id: null,
            slug: "parent",
            name: "父社区",
            description: "父社区介绍",
            icon: "layout",
            tone: "blue",
            position: 0,
            depth: 0,
            child_count: 1,
            topic_count: 8,
          }],
          meta: {
            request_id: "019fc630-0000-7000-8000-000000000002",
            next_cursor: nextCursor,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            id: "019fc630-0000-7000-8000-000000000004",
            parent_id: "019fc630-0000-7000-8000-000000000001",
            slug: "child",
            name: "子社区",
            description: "子社区介绍",
            icon: "messages",
            tone: "green",
            position: 0,
            depth: 1,
            child_count: 0,
            topic_count: 2,
          }],
          meta: {
            request_id: "019fc630-0000-7000-8000-000000000005",
            next_cursor: null,
          },
        }),
      })

    await expect(listBoards()).resolves.toHaveLength(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/boards?limit=50", expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/boards?limit=50&cursor=${nextCursor}`,
      expect.any(Object),
    )
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
