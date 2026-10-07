import { afterEach, describe, expect, it, vi } from "vitest"

import { AdminUsersApiError, getAdminUser, getAdminUserMembershipSummary, listAdminUserContent, listAdminUsers, updateAdminUserStatus } from "./adminUsers"

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

const membershipAccount = { ...summary, bio: '', location: null, website_url: null, follower_count: 0, following_count: 0, roles: [], restriction_reason: null, restriction_expires_at: null, revision: 1 }
const growthLevel = { id: userId, internal_key: 'beginner', level_order: 2, display_name: '成长二级', required_experience: 100, icon_asset_id: null, color: null, description: '' }
const membershipSummary = {
  account: membershipAccount, groups: [],
  experience: { user_id: userId, experience: 120, current_level: growthLevel, revision: 3, updated_at: summary.created_at },
  next_level: { ...growthLevel, level_order: 3, required_experience: 300 },
  points: { user_id: userId, points_balance: 77, lifetime_points: 900, revision: 4, updated_at: summary.created_at },
  medals: [], entitlements: [], readable_sections: ['groups', 'experience', 'points', 'medals', 'entitlements'],
}

describe('admin user membership summary', () => {
  it('loads one fixed user with independent EXP and points using the authenticated read endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: membershipSummary, meta: { request_id: requestId } })))
    const controller = new AbortController()
    await expect(getAdminUserMembershipSummary(userId, controller.signal)).resolves.toEqual(expect.objectContaining({
      account: expect.objectContaining({ id: userId }),
      experience: expect.objectContaining({ experience: 120, currentLevel: expect.objectContaining({ displayName: '成长二级' }) }),
      nextLevel: expect.objectContaining({ requiredExperience: 300 }),
      points: expect.objectContaining({ pointsBalance: 77, revision: 4 }),
    }))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/users/' + userId + '/membership-summary', expect.objectContaining({ credentials: 'include', signal: controller.signal }))
  })

  it('preserves redacted sections as null instead of inventing empty balances or identities', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { ...membershipSummary, groups: null, experience: null, next_level: null, points: null, medals: null, entitlements: null, readable_sections: [] }, meta: { request_id: requestId } })))
    await expect(getAdminUserMembershipSummary(userId)).resolves.toEqual(expect.objectContaining({ groups: null, experience: null, points: null, medals: null, entitlements: null, readableSections: [] }))
  })

  it.each([
    { ...membershipSummary, account: { ...membershipAccount, id: requestId } },
    { ...membershipSummary, experience: { ...membershipSummary.experience, user_id: requestId } },
    { ...membershipSummary, points: { ...membershipSummary.points, points_balance: -1 } },
    { ...membershipSummary, readable_sections: [] },
  ])('rejects a mismatched user, malformed balance or inconsistent redaction', async (data) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data, meta: { request_id: requestId } })))
    await expect(getAdminUserMembershipSummary(userId)).rejects.toEqual(expect.objectContaining({ code: 'response.invalid' }))
  })


  it('keeps group provenance, entitlement snapshots and medal assets in the same user context', async () => {
    const group = { id: requestId, user_id: userId, group: { id: requestId, internal_key: 'photographer', display_name: '摄影达人' }, membership_kind: 'additional', source: 'admin', source_reference_id: null, reason: '运营授予', starts_at: summary.created_at, ends_at: null, revoked_at: null, revocation_reason: null, revision: 5 }
    const entitlement = { id: requestId, user_id: userId, entitlement_type_id: requestId, entitlement_key: 'premium_member', type_version: 2, permission_snapshot: ['topic.create'], quota_snapshot: { 'topic.create.daily': 50 }, source: 'admin', source_reference_id: null, reason: '活动奖励', starts_at: summary.created_at, ends_at: null, revoked_at: null, revoked_by: null, revocation_reason: null, revision: 4, granted_by: requestId, created_at: summary.created_at, updated_at: summary.created_at }
    const medal = { key: 'photographer', display_name: '摄影之星', asset_url: '/assets/membership/medals/medal1.gif', sha256: 'a'.repeat(64), granted_at: summary.created_at }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { ...membershipSummary, groups: [group], entitlements: [entitlement], medals: [medal] }, meta: { request_id: requestId } })))
    await expect(getAdminUserMembershipSummary(userId)).resolves.toEqual(expect.objectContaining({
      groups: [expect.objectContaining({ userId, membershipKind: 'additional', reason: '运营授予', revision: 5 })],
      entitlements: [expect.objectContaining({ userId, typeVersion: 2, quotaSnapshot: { 'topic.create.daily': 50 }, reason: '活动奖励' })],
      medals: [expect.objectContaining({ displayName: '摄影之星', assetUrl: medal.asset_url })],
    }))
  })

  it('propagates capability denial without a fallback request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'admin.forbidden', message: '没有读取权限' }, meta: { request_id: requestId } }), { status: 403 }))
    await expect(getAdminUserMembershipSummary(userId)).rejects.toEqual(expect.objectContaining({ status: 403, code: 'admin.forbidden' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('admin user list membership read model', () => {
  const membership = { groups: [{ id: requestId, display_name: '注册会员', membership_kind: 'base' }, { id: userId, display_name: '摄影达人', membership_kind: 'additional' }], experience: 120, level: { id: requestId, display_name: '成长二级', level_order: 2 }, points_balance: 77, entitlements: [{ type_id: requestId, internal_key: 'premium', display_name: '高级会员' }], medal_count: 3, readable_sections: ['groups', 'experience', 'points', 'medals', 'entitlements'] }
  it('maps independent list identities, EXP, points and active entitlements without extra requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ ...summary, membership }], meta: { request_id: requestId, next_cursor: null } })))
    await expect(listAdminUsers()).resolves.toEqual(expect.objectContaining({ users: [expect.objectContaining({ membership: expect.objectContaining({ experience: 120, pointsBalance: 77, level: expect.objectContaining({ displayName: '成长二级' }), groups: [expect.objectContaining({ membershipKind: 'base' }), expect.objectContaining({ membershipKind: 'additional' })], entitlements: [expect.objectContaining({ displayName: '高级会员' })], medalCount: 3 }) })] }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('sends every membership and activity facet to server pagination', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [], meta: { request_id: requestId, next_cursor: null } })))
    await listAdminUsers({ baseGroupId: userId, additionalGroupId: requestId, growthLevelId: userId, entitlementTypeId: requestId, lastActiveAfter: summary.created_at, lastActiveBefore: summary.last_seen_at, cursor: userId })
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://daoyun.test')
    expect(Object.fromEntries(url.searchParams)).toEqual({ base_group_id: userId, additional_group_id: requestId, growth_level_id: userId, entitlement_type_id: requestId, last_active_after: summary.created_at, last_active_before: summary.last_seen_at, cursor: userId })
  })
  it('preserves field redaction and rejects inconsistent membership projections', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ ...summary, membership: { groups: null, experience: null, level: null, points_balance: null, entitlements: null, medal_count: null, readable_sections: [] } }], meta: { request_id: requestId } }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ ...summary, membership: { ...membership, readable_sections: [] } }], meta: { request_id: requestId } })))
    expect((await listAdminUsers()).users[0].membership?.pointsBalance).toBeNull()
    await expect(listAdminUsers()).rejects.toEqual(expect.objectContaining({ code: 'response.invalid' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
