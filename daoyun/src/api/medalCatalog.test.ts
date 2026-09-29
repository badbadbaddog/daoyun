import { afterEach, expect, it, vi } from "vitest"
import { createMembershipMedalRule, deleteMembershipMedalRule, updateMembershipMedalRule, uploadMembershipMedalAsset } from "./admin"
import { listUserMedals } from "./users"

afterEach(() => vi.unstubAllGlobals())
const dto = { key: "medal_custom", display_name: "社区贡献者", asset_key: "medal_02", asset_url: "/assets/membership/medals/medal2.gif", enabled: false, required_lifetime_points: null, revision: 1, updated_at: "2026-09-05T00:00:00Z" }
const response = (data: unknown) => new Response(JSON.stringify({ data, meta: { request_id: "019fc900-0000-7000-8000-000000000001" } }), { status: 200 })

it("uploads raw image bytes with CSRF and accepts the uploaded asset across catalog and ownership", async () => {
  const asset_key = `upload_${"a".repeat(64)}`
  const asset_url = `/api/v1/membership/medal-assets/${asset_key}`
  const file = new File(["image"], "medal.png", { type: "image/png" })
  const fetch = vi.fn().mockResolvedValueOnce(response({ asset_key, asset_url, sha256: "a".repeat(64), mime_type: "image/png", size_bytes: 5 }))
    .mockResolvedValueOnce(response({ ...dto, asset_key, asset_url }))
    .mockResolvedValueOnce(response([{ key: dto.key, display_name: dto.display_name, asset_url, sha256: "a".repeat(64), granted_at: dto.updated_at }]))
  vi.stubGlobal("fetch", fetch)
  await expect(uploadMembershipMedalAsset(file, "csrf")).resolves.toMatchObject({ assetKey: asset_key, assetUrl: asset_url })
  expect(fetch).toHaveBeenCalledWith("/api/v1/admin/membership/medal-assets", expect.objectContaining({ method: "POST", credentials: "include", body: file, headers: expect.objectContaining({ "Content-Type": "image/png", "x-csrf-token": "csrf" }) }))
  await expect(createMembershipMedalRule({ displayName: dto.display_name, assetKey: asset_key, enabled: false, requiredLifetimePoints: null }, "csrf")).resolves.toMatchObject({ assetKey: asset_key, assetUrl: asset_url })
  await expect(listUserMedals("member")).resolves.toEqual([expect.objectContaining({ assetUrl: asset_url })])
})

it("sends catalog create, update and delete with CSRF and revisions and maps custom metadata", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(dto)).mockResolvedValueOnce(response({ ...dto, revision: 2 })).mockResolvedValueOnce(response(true))
  vi.stubGlobal("fetch", fetch)
  const input = { displayName: "社区贡献者", assetKey: "medal_02", enabled: false, requiredLifetimePoints: null }
  await expect(createMembershipMedalRule(input, "csrf")).resolves.toMatchObject({ key: "medal_custom", displayName: "社区贡献者", assetKey: "medal_02", revision: 1 })
  await expect(updateMembershipMedalRule("medal_custom", { ...input, expectedRevision: 1 }, "csrf")).resolves.toMatchObject({ revision: 2 })
  await expect(deleteMembershipMedalRule("medal_custom", 2, "csrf")).resolves.toBe(true)
  expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "PATCH", "DELETE"])
  for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ credentials: "include", headers: expect.objectContaining({ "x-csrf-token": "csrf" }) })
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ display_name: "社区贡献者", asset_key: "medal_02", expected_revision: 1 })
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ expected_revision: 2 })
})

it("accepts a custom medal in the public ownership endpoint", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{ key: "medal_custom", display_name: "社区贡献者", asset_url: dto.asset_url, sha256: "a".repeat(64), granted_at: dto.updated_at }])))
  await expect(listUserMedals("member")).resolves.toEqual([expect.objectContaining({ key: "medal_custom", displayName: "社区贡献者", assetUrl: dto.asset_url })])
})
