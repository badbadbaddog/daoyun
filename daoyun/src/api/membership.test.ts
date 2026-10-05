import { afterEach, describe, expect, it, vi } from "vitest"

import { getCurrentExperience, listGrowthLevels, listMyEntitlements, listMyPointsLedger, loadMembershipCenterData } from "./membership"

const requestId = "019fc800-0000-7000-8000-000000000001"
const levelId = "019fc800-0000-7000-8000-000000000021"

afterEach(() => vi.unstubAllGlobals())

describe("membership api", () => {
  it("accepts dynamic growth levels beyond the historical twenty levels", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: levelId, internal_key: "legend", level_order: 21, display_name: "传奇", required_experience: 20000, icon_asset_id: null, color: null, description: "长期贡献" }], meta: { request_id: requestId } }), { status: 200, headers: { "content-type": "application/json" } })))
    await expect(listGrowthLevels()).resolves.toEqual([expect.objectContaining({ internalKey: "legend", levelOrder: 21 })])
  })

  it("keeps EXP, points ledger and standard entitlements as separate responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { user_id: requestId, experience: 760, current_level: { id: levelId, internal_key: "pathfinder", level_order: 7, display_name: "开拓者", required_experience: 600, icon_asset_id: null, color: null, description: "持续参与" }, revision: 1, updated_at: "2026-08-27T10:00:00Z" }, meta: { request_id: requestId } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: requestId, amount: 30, reason: "content.topic.quality", balance_after: 1280, created_at: "2026-08-27T10:00:00Z" }], meta: { request_id: requestId, next_cursor: null } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: requestId, internal_key: "pro_upload", type_version: 2, quotas: { attachment_bytes: 1024 }, starts_at: "2026-08-01T00:00:00Z", ends_at: null }], meta: { request_id: requestId } }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    expect((await getCurrentExperience()).experience).toBe(760)
    expect((await listMyPointsLedger()).entries[0].delta).toBe(30)
    expect((await listMyEntitlements())[0].internalKey).toBe("pro_upload")
  })
})

it("loads growth without requesting points, groups, entitlements or medals", async () => {
  const level = { id: levelId, internal_key: "member", level_order: 1, display_name: "成员", required_experience: 0, icon_asset_id: null, color: null, description: "参与社区" }
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/v1/users/me/experience") return new Response(JSON.stringify({ data: { experience: 12, current_level: level, revision: 1, updated_at: "2026-10-03T00:00:00Z" }, meta: { request_id: requestId } }))
    if (url === "/api/v1/membership/levels") return new Response(JSON.stringify({ data: [level], meta: { request_id: requestId } }))
    throw new Error("An unrelated membership request must not run: " + url)
  })
  vi.stubGlobal("fetch", fetchMock)
  const controller = new AbortController()
  await expect(loadMembershipCenterData("member", controller.signal, "growth")).resolves.toEqual({ experience: { experience: 12, level: expect.objectContaining({ displayName: "成员" }), nextLevel: null } })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls.every((call: unknown[]) => (call[1] as RequestInit).signal === controller.signal)).toBe(true)
})

it("keeps healthy overview growth when public medals fail without loading private details", async () => {
  const level = { id: levelId, internal_key: "member", level_order: 1, display_name: "成员", required_experience: 0, icon_asset_id: null, color: null, description: "参与社区" }
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/v1/users/me/experience") return new Response(JSON.stringify({ data: { experience: 12, current_level: level, revision: 1, updated_at: "2026-10-03T00:00:00Z" }, meta: { request_id: requestId } }))
    if (url === "/api/v1/membership/levels") return new Response(JSON.stringify({ data: [level], meta: { request_id: requestId } }))
    if (url === "/api/v1/users/member/membership-summary") return new Response("{}", { status: 500 })
    throw new Error("Unexpected detail request: " + url)
  })
  vi.stubGlobal("fetch", fetchMock)
  const data = await loadMembershipCenterData("member")
  expect(data.experience?.experience).toBe(12)
  expect(data.communityGroups).toBeUndefined()
  expect(data.pointsBalance).toBeUndefined()
  expect(data.errors).toEqual(["公开勋章暂时不可用"])
  expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(["/api/v1/membership/levels", "/api/v1/users/me/experience", "/api/v1/users/member/membership-summary"].sort())
})

it("maps original operation metadata independently of the ledger query request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: requestId, amount: 30, reason: "operations.adjustment", balance_after: 80, created_at: "2026-10-03T00:00:00Z", actor_id: levelId, actor_username: "owner", actor_display_name: "站长", operation_request_id: levelId }], meta: { request_id: requestId } }))))
  expect((await listMyPointsLedger()).entries[0]).toMatchObject({ actorUsername: "owner", actorDisplayName: "站长", operationRequestId: levelId })
})

it.each([["operations.community_reward","社区贡献奖励"],["operations.event_reward","活动奖励"],["operations.correction","账务纠正"],["operations.compensation","服务补偿"]])("shows the human source for %s", async (reason, label) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: requestId, amount: 30, reason, balance_after: 80, created_at:"2026-10-03T00:00:00Z" }], meta: {request_id:requestId} }))))
  expect((await listMyPointsLedger()).entries[0].reason).toBe(label)
})

it("loads only growth and visible medals for the overview", async () => {
  const level = { id: levelId, internal_key: "member", level_order: 1, display_name: "成员", required_experience: 0, icon_asset_id: null, color: null, description: "参与社区" }
  const medal = { key: "visible", display_name: "可见勋章", asset_url: "/visible.png", granted_at: "2026-10-03T00:00:00Z" }
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/v1/users/me/experience") return new Response(JSON.stringify({ data: { experience: 12, current_level: level, revision: 1, updated_at: "2026-10-03T00:00:00Z" } }))
    if (url === "/api/v1/membership/levels") return new Response(JSON.stringify({ data: [level] }))
    if (url === "/api/v1/users/member/membership-summary") return new Response(JSON.stringify({ data: { current_level: level, medals: [medal], public_groups: [] } }))
    throw new Error("Private overview request: " + url)
  })
  vi.stubGlobal("fetch", fetchMock)
  const data = await loadMembershipCenterData("member")
  expect(data.medals).toEqual([expect.objectContaining({ displayName: "可见勋章", isPublic: true })])
  expect(data.pointsBalance).toBeUndefined()
  expect(data.communityGroups).toBeUndefined()
  expect(data.errors).toEqual([])
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it.each([[401, "auth.unauthenticated"], [403, "auth.forbidden"], [503, "database.unavailable"]])("retains the actual membership failure status %s", async (status, code) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code, message: "内部服务详情" } }), { status })))
  await expect(listMyEntitlements()).rejects.toMatchObject({ status, code })
})
