import { afterEach, describe, expect, it, vi } from "vitest"

import { getCurrentExperience, listGrowthLevels, listMyEntitlements, listMyPointsLedger } from "./membership"

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
