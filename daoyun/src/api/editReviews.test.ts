import { afterEach, describe, expect, it, vi } from "vitest"

import { updateEditReviewPolicies } from "./editReviews"

afterEach(() => vi.restoreAllMocks())

describe("edit review API", () => {
  it("updates multiple board policies in one request", async () => {
    const policies = [
      { board_id: "019fc630-0000-7000-8000-000000000001", board_name: "A", topic_edits_require_review: true, reply_edits_require_review: false },
      { board_id: "019fc630-0000-7000-8000-000000000002", board_name: "B", topic_edits_require_review: true, reply_edits_require_review: false },
    ]
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: policies,
      meta: { request_id: "019fc800-0000-7000-8000-000000000103" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(updateEditReviewPolicies(policies, "csrf")).resolves.toEqual(policies)
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/edit-review/policies", expect.objectContaining({
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({ policies: policies.map(({ board_name: _, ...policy }) => policy) }),
    }))
  })
})
