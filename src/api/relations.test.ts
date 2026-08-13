import { afterEach, describe, expect, it, vi } from "vitest"

import { listBookmarks, setPostLike, setTopicBookmark } from "./relations"

const requestId = "019fc800-0000-7000-8000-000000000001"
const topicId = "019fc800-0000-7000-8000-000000000101"
const postId = "019fc800-0000-7000-8000-000000000201"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("relationship API", () => {
  it("sets bookmark and like target state with credentials and CSRF", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { topic_id: topicId, bookmarked: true },
        meta: { request_id: requestId },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { post_id: postId, liked: false, like_count: 7 },
        meta: { request_id: requestId },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(setTopicBookmark(topicId, true, "a".repeat(64))).resolves.toEqual({
      topicId,
      bookmarked: true,
    })
    await expect(setPostLike(postId, false, "b".repeat(64))).resolves.toEqual({
      postId,
      liked: false,
      likeCount: 7,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/v1/topics/${topicId}/bookmark`,
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: expect.objectContaining({ "x-csrf-token": "a".repeat(64) }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/posts/${postId}/like`,
      expect.objectContaining({ method: "DELETE" }),
    )
  })

  it("lists current-user bookmarks through the shared topic parser", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [],
      meta: { request_id: requestId, next_cursor: null },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(listBookmarks({ limit: 10 })).resolves.toEqual({
      topics: [],
      nextCursor: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/users/me/bookmarks?limit=10",
      expect.objectContaining({ credentials: "include" }),
    )
  })

  it("rejects malformed state envelopes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: { post_id: postId, liked: true, like_count: -1 },
      meta: { request_id: requestId },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(setPostLike(postId, true, "c".repeat(64)))
      .rejects.toThrow("点赞响应格式无效")
  })
})
