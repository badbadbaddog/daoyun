import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createReply,
  createTopic,
  deleteTopic,
  deleteReply,
  getTopic,
  listRevisions,
  listReplies,
  listReplyRevisions,
  listTags,
  listTopics,
  parseTopicPage,
  TopicApiError,
  updateTopic,
  updateReply,
} from "./topics"

afterEach(() => {
  vi.restoreAllMocks()
})

const topicPayload = {
  id: "019fc800-0000-7000-8000-000000000101",
  title: "发布主题",
  excerpt: "这是主题正文",
  author: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    display_name: "社区成员",
    avatar_url: "https://example.com/member.png",
  },
  board: {
    id: "019fc630-0000-7000-8000-000000000001",
    slug: "general",
    name: "社区广场",
    tone: "green",
  },
  published_at: "2026-08-03T10:00:00Z",
  last_activity_at: "2026-08-03T10:00:00Z",
  reply_count: 0,
  like_count: 0,
  viewer_bookmarked: true,
  viewer_liked: false,
  view_count: 0,
  is_featured: false,
  is_pinned: false,
  tags: [{ slug: "rust", name: "Rust" }],
}

const replyPayload = {
  id: "019fc800-0000-7000-8000-000000000201",
  topic_id: topicPayload.id,
  author: topicPayload.author,
  content: "回复正文",
  created_at: "2026-08-03T10:10:00Z",
  updated_at: "2026-08-03T10:10:00Z",
  revision_count: 1,
  like_count: 3,
  viewer_liked: true,
}

describe("topics API client", () => {
  it("maps a server page and sends filters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [topicPayload],
      meta: {
        request_id: "019fc800-0000-7000-8000-000000000102",
        next_cursor: "019fc800-0000-7000-8000-000000000101",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(listTopics({
      query: "Rust",
      author: "member",
      scope: "following",
      sort: "popular",
      featured: true,
      cursor: "019fc800-0000-7000-8000-000000000099",
    })).resolves.toMatchObject({
      topics: [expect.objectContaining({
        title: "发布主题",
        board: "社区广场",
        authorId: topicPayload.author.id,
        authorUsername: "member",
        avatarUrl: "https://example.com/member.png",
      })],
      nextCursor: "019fc800-0000-7000-8000-000000000101",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/topics?query=Rust&author=member&scope=following&featured=true&sort=popular&cursor=019fc800-0000-7000-8000-000000000099&limit=20",
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "application/json" },
      }),
    )
  })

  it("posts a topic with credentials, csrf and idempotency headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: { ...topicPayload, content: "这是主题正文", content_revision: 1 },
      meta: { request_id: "019fc800-0000-7000-8000-000000000102" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }))

    await expect(createTopic({ title: "发布主题", content: "这是主题正文" }, {
      csrfToken: "a".repeat(64),
      idempotencyKey: "topic-create-001",
    })).resolves.toMatchObject({ title: "发布主题" })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/topics", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({
        "x-csrf-token": "a".repeat(64),
        "idempotency-key": "topic-create-001",
      }),
      body: JSON.stringify({ title: "发布主题", content: "这是主题正文" }),
    }))
  })

  it("maps structured topic errors and rejects malformed success envelopes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "request.idempotency_conflict",
        message: "幂等键已经用于其他内容",
      },
      meta: { request_id: "019fc800-0000-7000-8000-000000000102" },
    }), { status: 409, headers: { "Content-Type": "application/json" } }))

    await expect(createTopic({ title: "主题", content: "正文" }, {
      csrfToken: "b".repeat(64),
      idempotencyKey: "topic-create-001",
    })).rejects.toBeInstanceOf(TopicApiError)
  })

  it("loads a topic detail and its chronological replies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { ...topicPayload, content: "完整主题正文", content_revision: 1 },
        meta: { request_id: "019fc800-0000-7000-8000-000000000102" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [replyPayload],
        meta: {
          request_id: "019fc800-0000-7000-8000-000000000103",
          next_cursor: replyPayload.id,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(getTopic(topicPayload.id)).resolves.toMatchObject({
      id: topicPayload.id,
      content: "完整主题正文",
      bookmarked: true,
      liked: false,
    })
    await expect(listReplies(topicPayload.id)).resolves.toMatchObject({
      replies: [expect.objectContaining({
        content: "回复正文",
        revisionCount: 1,
        likeCount: 3,
        liked: true,
      })],
      nextCursor: replyPayload.id,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/v1/topics/${topicPayload.id}`,
      expect.objectContaining({ credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/topics/${topicPayload.id}/replies?limit=20`,
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    )
  })

  it("shares strict topic-page parsing with relationship clients", () => {
    expect(parseTopicPage({
      data: [topicPayload],
      meta: {
        request_id: "019fc800-0000-7000-8000-000000000102",
        next_cursor: null,
      },
    })).toEqual({
      topics: [expect.objectContaining({ bookmarked: true, liked: false })],
      nextCursor: null,
    })
    expect(parseTopicPage({
      data: [{ ...topicPayload, viewer_liked: "yes" }],
      meta: {
        request_id: "019fc800-0000-7000-8000-000000000102",
        next_cursor: null,
      },
    })).toBeNull()
  })

  it("posts a reply with credentials, csrf and idempotency headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: replyPayload,
      meta: { request_id: "019fc800-0000-7000-8000-000000000102" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }))

    await expect(createReply(topicPayload.id, "回复正文", {
      csrfToken: "c".repeat(64),
      idempotencyKey: "reply-create-001",
    })).resolves.toMatchObject({ content: "回复正文" })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/topics/${topicPayload.id}/replies`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "x-csrf-token": "c".repeat(64),
          "idempotency-key": "reply-create-001",
        }),
        body: JSON.stringify({ content: "回复正文" }),
      }),
    )
  })

  it("rejects malformed reply envelopes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ ...replyPayload, revision_count: -1 }],
      meta: {
        request_id: "019fc800-0000-7000-8000-000000000102",
        next_cursor: null,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(listReplies(topicPayload.id)).rejects.toThrow("回复列表响应格式无效")
  })

  it("updates, lists revisions and deletes an authored reply", async () => {
    const revisionPayload = {
      id: "019fc800-0000-7000-8000-000000000301",
      reply_id: replyPayload.id,
      revision_number: 2,
      editor: topicPayload.author,
      content: "更新后的回复",
      created_at: "2026-08-03T10:20:00Z",
    }
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { ...replyPayload, content: "更新后的回复", revision_count: 2 },
        meta: { request_id: "019fc800-0000-7000-8000-000000000102" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [revisionPayload],
        meta: { request_id: "019fc800-0000-7000-8000-000000000103" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: true,
        meta: { request_id: "019fc800-0000-7000-8000-000000000104" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(updateReply(topicPayload.id, replyPayload.id, {
      baseRevision: 1,
      content: "更新后的回复",
    }, { csrfToken: "e".repeat(64) })).resolves.toMatchObject({
      content: "更新后的回复",
      revisionCount: 2,
    })
    await expect(listReplyRevisions(topicPayload.id, replyPayload.id)).resolves.toMatchObject([
      expect.objectContaining({
        replyId: replyPayload.id,
        revisionNumber: 2,
        content: "更新后的回复",
      }),
    ])
    await expect(deleteReply(topicPayload.id, replyPayload.id, {
      csrfToken: "e".repeat(64),
    })).resolves.toBe(true)

    const replyPath = `/api/v1/topics/${topicPayload.id}/replies/${replyPayload.id}`
    expect(fetchMock).toHaveBeenNthCalledWith(1, replyPath, expect.objectContaining({
      method: "PATCH",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "e".repeat(64) }),
      body: JSON.stringify({ base_revision: 1, content: "更新后的回复" }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${replyPath}/revisions`, expect.objectContaining({
      credentials: "include",
      headers: { Accept: "application/json" },
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, replyPath, expect.objectContaining({
      method: "DELETE",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "e".repeat(64) }),
    }))
  })

  it("rejects malformed reply delete envelopes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: "true",
      meta: { request_id: "019fc800-0000-7000-8000-000000000102" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(deleteReply(topicPayload.id, replyPayload.id, {
      csrfToken: "f".repeat(64),
    })).rejects.toThrow("回复删除响应格式无效")
  })

  it("deletes a topic with the session-bound CSRF token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: true,
      meta: { request_id: "019fc800-0000-7000-8000-000000000105" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    await expect(deleteTopic(topicPayload.id, { csrfToken: "g".repeat(64) })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/topics/${topicPayload.id}`,
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        headers: expect.objectContaining({ "x-csrf-token": "g".repeat(64) }),
      }),
    )
  })

  it("loads tags, updates a topic and loads author revisions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ slug: "rust", name: "Rust" }],
        meta: { request_id: "019fc800-0000-7000-8000-000000000102" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { ...topicPayload, title: "已编辑", content: "更新正文", content_revision: 2 },
        meta: { request_id: "019fc800-0000-7000-8000-000000000103" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: "019fc800-0000-7000-8000-000000000301",
          topic_id: topicPayload.id,
          revision_number: 2,
          editor: topicPayload.author,
          content: "更新正文",
          created_at: "2026-08-03T10:20:00Z",
        }],
        meta: { request_id: "019fc800-0000-7000-8000-000000000104" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(listTags()).resolves.toEqual([{ slug: "rust", name: "Rust" }])
    await expect(updateTopic(topicPayload.id, {
      baseRevision: 1,
      title: "已编辑",
      content: "更新正文",
      tags: [{ slug: "sqlx", name: "SQLx" }],
    }, { csrfToken: "d".repeat(64) })).resolves.toMatchObject({
      title: "已编辑",
      contentRevision: 2,
    })
    await expect(listRevisions(topicPayload.id)).resolves.toMatchObject([
      expect.objectContaining({ revisionNumber: 2, content: "更新正文" }),
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/topics/${topicPayload.id}`,
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({
          base_revision: 1,
          title: "已编辑",
          content: "更新正文",
          tags: [{ slug: "sqlx", name: "SQLx" }],
        }),
      }),
    )
  })
})
