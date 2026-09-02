import { afterEach, describe, expect, it, vi } from "vitest"

import {
  governTopic,
  listModerationBoards,
  listTopicModerationHistory,
  listModerationTopics,
  moderateTopic,
} from "./moderation"

const requestId = "019fc900-0000-7000-8000-000000000001"
const boardId = "019fc900-0000-7000-8000-000000000101"
const topicId = "019fc900-0000-7000-8000-000000000201"
const userId = "019fc900-0000-7000-8000-000000000301"

afterEach(() => vi.restoreAllMocks())

describe("moderation API", () => {
  it("maps the scoped board capabilities and topic page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: boardId,
          slug: "general",
          name: "社区广场",
          tone: "green",
          capability_keys: ["moderation.topic", "moderation.topic.pin"],
        }],
        meta: { request_id: requestId },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: topicId,
          title: "",
          excerpt: "主题摘要",
          author: { id: userId, username: "member", display_name: "成员", avatar_url: null },
          board: { id: boardId, slug: "general", name: "社区广场", tone: "green" },
          published_at: "2026-08-21T08:00:00Z",
          last_activity_at: "2026-08-21T09:00:00Z",
          reply_count: 2,
          like_count: 3,
          view_count: 8,
          moderation_status: "approved",
          governance_revision: 4,
          is_featured: false,
          is_pinned: false,
          is_locked: false,
        }],
        meta: { request_id: requestId, next_cursor: null },
      }))

    await expect(listModerationBoards()).resolves.toEqual([expect.objectContaining({
      id: boardId,
      name: "社区广场",
      capabilityKeys: ["moderation.topic", "moderation.topic.pin"],
    })])
    await expect(listModerationTopics({ boardId, limit: 20 })).resolves.toMatchObject({
      topics: [expect.objectContaining({
        id: topicId,
        board: expect.objectContaining({ name: "社区广场" }),
        moderationStatus: "approved",
        governanceRevision: 4,
        locked: false,
      })],
      nextCursor: null,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/admin/moderation/topics?board_id=${boardId}&limit=20`,
      expect.objectContaining({ credentials: "include" }),
    )
  })

  it("sends CSRF and revision data for topic moderation mutations", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { topic_id: topicId, status: "hidden" }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { topic_id: topicId, board_id: boardId, is_pinned: true, is_featured: false, is_locked: false, governance_revision: 5 },
        meta: { request_id: requestId },
      }))

    await expect(moderateTopic(topicId, { status: "hidden", reason: "违反板块规则" }, "csrf"))
      .resolves.toEqual({ topicId, status: "hidden" })
    await expect(governTopic(topicId, { action: "pin", expectedRevision: 4, reason: "板块公告" }, "csrf"))
      .resolves.toEqual({ topicId, boardId, isPinned: true, isFeatured: false, isLocked: false, governanceRevision: 5 })
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/v1/topics/${topicId}/moderation`, expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/topics/${topicId}/governance`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ action: "pin", expected_revision: 4, reason: "板块公告" }),
    }))
  })

  it("maps a paginated topic moderation history", async () => {
    const historyId = "019fc900-0000-7000-8000-000000000401"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      data: [{
        id: historyId,
        source: "governance",
        action: "pin",
        actor: { id: userId, username: "owner", display_name: "站长", avatar_url: null },
        reason: "重要公告",
        created_at: "2026-08-25T08:00:00Z",
      }],
      meta: { request_id: requestId, next_cursor: historyId },
    }))

    await expect(listTopicModerationHistory({ topicId, limit: 10 })).resolves.toEqual({
      entries: [{
        id: historyId,
        source: "governance",
        action: "pin",
        actor: { id: userId, username: "owner", displayName: "站长", avatarUrl: null },
        reason: "重要公告",
        createdAt: "2026-08-25T08:00:00Z",
      }],
      nextCursor: historyId,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/moderation/topics/${topicId}/history?limit=10`,
      expect.objectContaining({ credentials: "include" }),
    )
  })

  it("rejects successful responses without a valid request id or page cursor", async () => {
    const mismatchedRequestId = "019fc900-0000-7000-8000-000000000002"
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { request_id: requestId } }, 200, mismatchedRequestId))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: {} }))
      .mockResolvedValueOnce(jsonResponse({
        data: [],
        meta: { request_id: requestId, next_cursor: 42 },
      }))

    await expect(listModerationBoards()).rejects.toMatchObject({
      code: "response.invalid",
      message: "内容治理板块响应格式无效",
    })
    await expect(listModerationBoards()).rejects.toMatchObject({
      code: "response.invalid",
      message: "内容治理板块响应格式无效",
    })
    await expect(listModerationTopics()).rejects.toMatchObject({
      code: "response.invalid",
      message: "内容治理主题响应格式无效",
    })
  })
})

function jsonResponse(body: unknown, status = 200, headerRequestId?: string): Response {
  const requestIdFromBody = typeof body === "object" && body !== null && "meta" in body
    && typeof body.meta === "object" && body.meta !== null && "request_id" in body.meta
    && typeof body.meta.request_id === "string"
    ? body.meta.request_id
    : undefined
  const responseRequestId = headerRequestId ?? requestIdFromBody
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(responseRequestId ? { "x-request-id": responseRequestId } : {}),
    },
  })
}
