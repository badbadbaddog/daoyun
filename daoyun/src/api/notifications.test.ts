import { afterEach, describe, expect, it, vi } from "vitest"

import { getUnreadNotificationCount, listNotifications, markAllNotificationsRead, markNotificationRead } from "./notifications"

const requestId = "019fc900-0000-7000-8000-000000000001"
const notificationId = "019fc900-0000-7000-8000-000000000201"
const actorId = "019fc900-0000-7000-8000-000000000002"
const topicId = "019fc900-0000-7000-8000-000000000101"

afterEach(() => vi.restoreAllMocks())

describe("notification API", () => {
  it("maps notification pages and unread count", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: notificationId, kind: "reply", actor: { id: actorId, username: "member", display_name: "成员", avatar_url: null }, target: "topic", target_id: topicId, read_at: null, created_at: "2026-08-04T10:00:00Z" }], meta: { request_id: requestId, next_cursor: notificationId } }))
      .mockResolvedValueOnce(jsonResponse({ data: { unread_count: 1 }, meta: { request_id: requestId } }))

    await expect(listNotifications({ limit: 10 })).resolves.toEqual({ notifications: [expect.objectContaining({ kind: "reply", targetId: topicId, actor: expect.objectContaining({ displayName: "成员" }) })], nextCursor: notificationId })
    await expect(getUnreadNotificationCount()).resolves.toBe(1)
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/notifications?limit=10", expect.objectContaining({ credentials: "include" }))
  })

  it("sends CSRF headers for single and bulk read operations", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { id: notificationId, kind: "reply", actor: null, target: "topic", target_id: topicId, read_at: "2026-08-04T10:01:00Z", created_at: "2026-08-04T10:00:00Z" }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: { unread_count: 0 }, meta: { request_id: requestId } }))

    await expect(markNotificationRead(notificationId, "csrf")).resolves.toMatchObject({ readAt: "2026-08-04T10:01:00Z" })
    await expect(markAllNotificationsRead("csrf")).resolves.toBe(0)
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/v1/notifications/${notificationId}/read`, expect.objectContaining({ method: "PATCH", headers: expect.objectContaining({ "x-csrf-token": "csrf" }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/notifications/read-all", expect.objectContaining({ method: "PATCH", headers: expect.objectContaining({ "x-csrf-token": "csrf" }) }))
  })

  it("accepts governance notifications in the shared notification feed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: notificationId, kind: "report", actor: null, target: "topic", target_id: topicId, read_at: null, created_at: "2026-08-04T10:00:00Z" }], meta: { request_id: requestId, next_cursor: null } }))

    await expect(listNotifications()).resolves.toEqual({ notifications: [expect.objectContaining({ kind: "report" })], nextCursor: null })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/notifications?limit=20", expect.objectContaining({ credentials: "include" }))
  })
})

function jsonResponse(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) }
