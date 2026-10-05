import { afterEach, describe, expect, it, vi } from "vitest"
import { createAuthorizationAssignment, listAuthorizationAssignments } from "./admin"
const id = "019fc900-0000-7000-8000-000000000101"
const user = { id, username: "tester", display_name: "指定会员", avatar_url: null }
const assignment = { id, user, role: { id, key: "moderator", name: "版主", scope: "board", is_system: false, revision: 1 }, scope_id: id, scope_mode: "subtree", assigned_by: user, created_at: "2026-10-03T00:00:00Z" }
function respond(data: unknown) { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data, meta: { request_id: id, next_cursor: null } }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": id } }))) }
afterEach(() => vi.unstubAllGlobals())
describe("authorization assignment scope", () => {
  it("preserves the server subtree mode in paginated team data", async () => {
    respond([assignment])
    expect((await listAuthorizationAssignments({ scopeId: id })).assignments[0]).toMatchObject({ scopeId: id, scopeMode: "subtree" })
  })
  it("sends the chosen mode and preserves it in the saved assignment", async () => {
    respond(assignment)
    expect(await createAuthorizationAssignment({ username: "tester", roleId: id, scopeId: id, scopeMode: "subtree" }, "csrf")).toMatchObject({ scopeMode: "subtree" })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).scope_mode).toBe("subtree")
  })
  it.each([undefined, "unknown"])("rejects an untrusted unsupported mode %s instead of inventing exact scope", async mode => {
    respond([{ ...assignment, scope_mode: mode }])
    await expect(listAuthorizationAssignments()).rejects.toMatchObject({ code: "response.invalid" })
  })
})
