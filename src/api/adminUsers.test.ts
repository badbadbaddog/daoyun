import { afterEach, describe, expect, it, vi } from "vitest"

import { AdminUsersApiError, getAdminUser, listAdminUserContent, listAdminUsers, updateAdminUserStatus } from "./adminUsers"

const requestId = "019fc800-0000-7000-8000-000000000001"
const userId = "019fc800-0000-7000-8000-000000000002"
const summary = {
  id: userId,
  username: "member",
  display_name: "社区成员",
  avatar_url: null,
  status: "restricted",
  primary_role: "版主",
  topic_count: 3,
  post_count: 8,
  report_count: 2,
  created_at: "2026-08-03T10:00:00Z",
  last_seen_at: "2026-08-12T08:00:00Z",
}

afterEach(() => vi.restoreAllMocks())

describe("admin users api", () => {
  it("searches users with status, role and cursor filters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [summary], meta: { request_id: requestId, next_cursor: userId } })))

    await expect(listAdminUsers({ query: "社区", status: "restricted", roleId: userId, cursor: userId, limit: 10 })).resolves.toEqual({
      users: [expect.objectContaining({ displayName: "社区成员", primaryRole: "版主", topicCount: 3 })],
      nextCursor: userId,
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/admin/users?q=${encodeURIComponent("社区")}&status=restricted&role_id=${userId}&cursor=${userId}&limit=10`)
  })

  it("maps detail roles and restriction context", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        ...summary,
        bio: "简介",
        location: "杭州",
        website_url: null,
        follower_count: 12,
        following_count: 4,
        roles: [{ id: userId, key: "moderator", name: "版主", scope: "site", is_system: false, revision: 1 }],
        restriction_reason: "等待人工复核",
        restriction_expires_at: null,
        revision: 2,
      },
      meta: { request_id: requestId },
    })))

    await expect(getAdminUser(userId)).resolves.toEqual(expect.objectContaining({
      restrictionReason: "等待人工复核",
      roles: [expect.objectContaining({ name: "版主", isSystem: false })],
      revision: 2,
    }))
  })

  it("maps user content pages and rejects malformed runtime data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: userId, kind: "topic", topic_id: userId, title: "主题", excerpt: "摘要", status: "published", created_at: "2026-08-03T10:00:00Z" }], meta: { request_id: requestId, next_cursor: null } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ ...summary, topic_count: -1 }], meta: { request_id: requestId, next_cursor: null } })))

    await expect(listAdminUserContent(userId)).resolves.toEqual({
      items: [expect.objectContaining({ kind: "topic", topicId: userId, title: "主题" })],
      nextCursor: null,
    })
    await expect(listAdminUsers()).rejects.toEqual(expect.objectContaining<Partial<AdminUsersApiError>>({ code: "response.invalid" }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("updates a user status with csrf, revision and a validated success result", async () => {
    const auditId = "019fc800-0000-7000-8000-000000000099"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        user_id: userId,
        status: "suspended",
        reason: "严重违规",
        expires_at: null,
        revision: 3,
        audit_id: auditId,
        actor: { id: requestId, username: "owner", display_name: "站长", avatar_url: null },
        changed_at: "2026-08-12T08:00:00Z",
      },
      meta: { request_id: requestId },
    })))

    await expect(updateAdminUserStatus(userId, {
      status: "suspended", reason: "严重违规", expiresAt: null, expectedRevision: 2,
    }, "csrf-token")).resolves.toEqual(expect.objectContaining({
      userId, status: "suspended", revision: 3, auditId, actor: expect.objectContaining({ username: "owner" }),
    }))
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/admin/users/${userId}/status`, expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ "x-csrf-token": "csrf-token" }),
      body: JSON.stringify({ status: "suspended", reason: "严重违规", expires_at: null, expected_revision: 2 }),
    }))
  })
})
