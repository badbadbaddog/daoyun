import { afterEach, describe, expect, it, vi } from "vitest"

import {
  archiveConversation,
  createConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from "./messages"

const requestId = "019fc900-0000-7000-8000-000000000001"
const conversationId = "019fc900-0000-7000-8000-000000000101"
const otherConversationId = "019fc900-0000-7000-8000-000000000102"
const firstUserId = "019fc900-0000-7000-8000-000000000002"
const secondUserId = "019fc900-0000-7000-8000-000000000003"
const messageId = "019fc900-0000-7000-8000-000000000201"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("message API", () => {
  it("maps conversation and message pages with stable cursors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: conversationId,
          other_user: userDto(secondUserId, "second"),
          last_message: {
            id: messageId,
            sender_id: secondUserId,
            content: "你好",
            created_at: "2026-08-04T10:00:00Z",
          },
          unread_count: 2,
          updated_at: "2026-08-04T10:00:00Z",
        }],
        meta: { request_id: requestId, next_cursor: conversationId },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: messageId,
          conversation_id: conversationId,
          sender: userDto(secondUserId, "second"),
          content: "你好",
          created_at: "2026-08-04T10:00:00Z",
        }],
        meta: { request_id: requestId, next_cursor: messageId },
      }))

    await expect(listConversations({ limit: 10 })).resolves.toEqual({
      conversations: [expect.objectContaining({
        id: conversationId,
        unreadCount: 2,
        otherUser: expect.objectContaining({ displayName: "second" }),
      })],
      nextCursor: conversationId,
    })
    await expect(listMessages(conversationId, { cursor: messageId })).resolves.toEqual({
      messages: [expect.objectContaining({ id: messageId, content: "你好" })],
      nextCursor: messageId,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/conversations?limit=10",
      expect.objectContaining({ credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/conversations/${conversationId}/messages?cursor=${messageId}&limit=20`,
      expect.objectContaining({ credentials: "include" }),
    )
  })

  it("creates, sends, marks read and archives with CSRF", async () => {
    const summary = {
      id: conversationId,
      other_user: userDto(secondUserId, "second"),
      last_message: null,
      unread_count: 0,
      updated_at: "2026-08-04T10:00:00Z",
    }
    const message = {
      id: messageId,
      conversation_id: conversationId,
      sender: userDto(firstUserId, "first"),
      content: "你好",
      created_at: "2026-08-04T10:00:00Z",
    }
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: summary, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: message, meta: { request_id: requestId } }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: { conversation_id: conversationId, last_read_message_id: messageId, unread_count: 0 },
        meta: { request_id: requestId },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: true, meta: { request_id: requestId } }))

    await expect(createConversation(secondUserId, "csrf")).resolves.toEqual(
      expect.objectContaining({ id: conversationId }),
    )
    await expect(sendMessage(conversationId, "你好", "csrf", "retry-key")).resolves.toEqual(
      expect.objectContaining({ id: messageId }),
    )
    await expect(markConversationRead(conversationId, messageId, "csrf")).resolves.toEqual({
      conversationId,
      lastReadMessageId: messageId,
      unreadCount: 0,
    })
    await expect(archiveConversation(conversationId, "csrf")).resolves.toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/conversations/${conversationId}/messages`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "x-csrf-token": "csrf",
          "Idempotency-Key": "retry-key",
        }),
      }),
    )
  })

  it("rejects malformed private message envelopes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      data: [{
        id: conversationId,
        other_user: userDto(secondUserId, "second"),
        last_message: null,
        unread_count: -1,
        updated_at: "invalid",
      }],
      meta: { request_id: requestId, next_cursor: null },
    }))

    await expect(listConversations()).rejects.toThrow("会话列表响应格式无效")
  })

  it("rejects a created conversation for a different recipient", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      data: {
        id: conversationId,
        other_user: userDto(firstUserId, "first"),
        last_message: null,
        unread_count: 0,
        updated_at: "2026-08-04T10:00:00Z",
      },
      meta: { request_id: requestId },
    }))

    await expect(createConversation(secondUserId, "csrf"))
      .rejects.toThrow("会话响应格式无效")
  })

  it("rejects an archive response that does not confirm the mutation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      data: false,
      meta: { request_id: requestId },
    }))

    await expect(archiveConversation(conversationId, "csrf"))
      .rejects.toThrow("归档响应格式无效")
  })

  it("rejects message responses bound to a different conversation", async () => {
    const message = {
      id: messageId,
      conversation_id: otherConversationId,
      sender: userDto(secondUserId, "second"),
      content: "你好",
      created_at: "2026-08-04T10:00:00Z",
    }
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        data: [message],
        meta: { request_id: requestId, next_cursor: null },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: message, meta: { request_id: requestId } }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          conversation_id: otherConversationId,
          last_read_message_id: messageId,
          unread_count: 0,
        },
        meta: { request_id: requestId },
      }))

    await expect(listMessages(conversationId)).rejects.toThrow("消息列表响应格式无效")
    await expect(sendMessage(conversationId, "你好", "csrf")).rejects.toThrow("消息响应格式无效")
    await expect(markConversationRead(conversationId, messageId, "csrf"))
      .rejects.toThrow("已读状态响应格式无效")
  })
})

function userDto(id: string, username: string) {
  return { id, username, display_name: username, avatar_url: null }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
