import { afterEach, describe, expect, it, vi } from "vitest"

import {
  governTopic,
  listModerationBoards,
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
          title: "需要治理的主题",
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
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
