import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getCurrentMembership,
  getUserProfile,
  listUserRelations,
  setUserFollowing,
  updateUserProfile,
} from "./users"

const requestId = "019fc800-0000-7000-8000-000000000901"
const userId = "019fc800-0000-7000-8000-000000000002"

const profilePayload = {
  id: userId,
  username: "member",
  display_name: "社区成员",
  avatar_url: "https://example.com/avatar.png",
  bio: "保持好奇。",
  location: "杭州",
  website_url: "https://example.com",
  profile_revision: 2,
  created_at: "2026-08-03T10:00:00Z",
  topic_count: 3,
  follower_count: 4,
  following_count: 5,
  viewer: {
    is_self: false,
    is_following: true,
    is_blocked_by_viewer: false,
    can_message: true,
  },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("user API client", () => {
  it("maps a public profile without accepting private identity fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: { ...profilePayload, email: "private@example.com" },
      meta: { request_id: requestId },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(getUserProfile("member")).resolves.toMatchObject({
      id: userId,
      username: "member",
      displayName: "社区成员",
      avatarUrl: "https://example.com/avatar.png",
      profileRevision: 2,
      viewer: { isFollowing: true },
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/member", expect.objectContaining({
      credentials: "include",
      headers: { Accept: "application/json" },
    }))
  })

  it("maps the private membership account and keeps credentials in cookies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        user_id: userId,
        points_balance: 25,
        lifetime_points: 40,
        level_key: "lv_2",
        level_number: 2,
        level_display_name: "Lv2",
        revision: 3,
        updated_at: "2026-08-06T02:00:00Z",
      },
      meta: { request_id: requestId },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(getCurrentMembership()).resolves.toEqual({
      userId,
      pointsBalance: 25,
      lifetimePoints: 40,
      levelKey: "lv_2",
      levelNumber: 2,
      levelDisplayName: "Lv2",
      revision: 3,
      updatedAt: "2026-08-06T02:00:00Z",
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/me/membership", expect.objectContaining({
      credentials: "include",
      headers: { Accept: "application/json" },
    }))
  })

  it("updates only editable profile fields with session-bound CSRF", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: profilePayload,
      meta: { request_id: requestId },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await updateUserProfile({
      baseRevision: 1,
      displayName: "社区成员",
      bio: "保持好奇。",
      location: "杭州",
      websiteUrl: "https://example.com",
      avatarUrl: "https://example.com/avatar.png",
    }, "a".repeat(64))

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/me", expect.objectContaining({
      method: "PATCH",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "a".repeat(64) }),
      body: JSON.stringify({
        base_revision: 1,
        display_name: "社区成员",
        bio: "保持好奇。",
        location: "杭州",
        website_url: "https://example.com",
        avatar_url: "https://example.com/avatar.png",
      }),
    }))
  })

  it("sets follow state and lists relationship pages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          user_id: userId,
          following: true,
          follower_count: 5,
          following_count: 6,
        },
        meta: { request_id: requestId },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: userId,
          username: "member",
          display_name: "社区成员",
          avatar_url: null,
        }],
        meta: { request_id: requestId, next_cursor: null },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(setUserFollowing(userId, true, "b".repeat(64))).resolves.toMatchObject({
      following: true,
      followerCount: 5,
    })
    await expect(listUserRelations("owner", "following")).resolves.toMatchObject({
      users: [expect.objectContaining({ username: "member", avatarUrl: null })],
      nextCursor: null,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/v1/users/${userId}/follow`, expect.objectContaining({
      method: "PUT",
      credentials: "include",
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/users/owner/following?limit=20",
      expect.objectContaining({ credentials: "include" }),
    )
  })

  it("rejects insecure avatar URLs in otherwise successful responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: { ...profilePayload, avatar_url: "http://example.com/avatar.png" },
      meta: { request_id: requestId },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(getUserProfile("member")).rejects.toThrow("用户资料响应格式无效")
  })
})
