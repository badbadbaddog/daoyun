import { describe, expect, it } from "vitest"

import { validateGifBytes, validateManifest, verifyMembershipAssets } from "./verify-membership-assets.mjs"

describe("membership asset manifest", () => {
  it("verifies the imported level and medal resources", async () => {
    await expect(verifyMembershipAssets()).resolves.toEqual({ levels: 20, medals: 17 })
  })

  it("rejects duplicate, missing, and out-of-range keys", () => {
    const manifest = {
      version: 1,
      member_group: { key: "member", asset_level_key: "lv_1" },
      levels: [{ key: "lv_1", file: "level.gif", sha256: "a".repeat(64) }],
      medals: [],
    }
    expect(() => validateManifest(manifest, ["level.gif"], [])).toThrow("数量")

    const levels = Array.from({ length: 20 }, (_, index) => ({
      key: index === 19 ? "lv_1" : `lv_${index + 1}`,
      file: `20080719_${String(index).padStart(2, "0")}.gif`,
      sha256: "a".repeat(64),
    }))
    expect(() => validateManifest(
      { ...manifest, levels, medals: Array.from({ length: 17 }, (_, index) => ({
        key: `medal_${String(index + 1).padStart(2, "0")}`,
        file: `medal${index + 1}.gif`,
        sha256: "b".repeat(64),
      })) },
      levels.map((entry) => entry.file),
      Array.from({ length: 17 }, (_, index) => `medal${index + 1}.gif`),
    )).toThrow("连续")
  })

  it("rejects files whose contents are not GIF data", () => {
    expect(() => validateGifBytes(new Uint8Array([0, 1, 2, 3, 4, 5]), "level.gif")).toThrow("GIF")
  })
})
