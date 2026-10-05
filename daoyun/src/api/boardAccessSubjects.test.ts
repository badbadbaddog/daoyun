import { afterEach, expect, it, vi } from "vitest"
import { getAdminContentAccessPolicy, putAdminContentAccessPolicy } from "./admin"
const id = "019fc900-0000-7000-8000-000000000101"
const policy = { id, target_type: "board", target_id: id, operator: "any_of", subjects: [{ subject_type: "governance", community_group_id: null, subject_key: "moderation.topic" }], revision: 1, created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:00:00Z" }
const response = (data: unknown) => new Response(JSON.stringify({ data, meta: { request_id: id } }), { status: 200, headers: { "content-type": "application/json" } })
afterEach(() => vi.restoreAllMocks())
it("reads and saves a governance subject with its dotted permission key", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response(policy)).mockResolvedValueOnce(response(policy))
  const subjects = [{ subjectType: "governance" as const, communityGroupId: null, subjectKey: "moderation.topic" }]
  await expect(getAdminContentAccessPolicy("board", id)).resolves.toMatchObject({ subjects })
  await expect(putAdminContentAccessPolicy("board", id, { operator: "any_of", subjects, expectedRevision: 1 }, "csrf")).resolves.toMatchObject({ subjects })
  expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/admin/content-access-policies/board/" + id, expect.objectContaining({ body: JSON.stringify({ operator: "any_of", subjects: policy.subjects, expected_revision: 1 }) }))
})
it.each([null, "bad key", "admin.configuration.write"])("rejects invalid governance subject key %s", async key => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ ...policy, subjects: [{ ...policy.subjects[0], subject_key: key }] }))
  await expect(getAdminContentAccessPolicy("board", id)).rejects.toMatchObject({ code: "response.invalid" })
})
