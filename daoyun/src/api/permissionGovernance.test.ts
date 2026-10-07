import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { getPermissionCheck } from "./boardPermissions"
const board = "019fc900-0000-7000-8000-000000000101"
const user = "019fc900-0000-7000-8000-000000000401"
const topic = "019fc900-0000-7000-8000-000000000501"
const target = "019fc900-0000-7000-8000-000000000102"
const role = "019fc900-0000-7000-8000-000000000601"
const assignment = "019fc900-0000-7000-8000-000000000701"
const quotaKeys = ["topic.create.daily","reply.create.daily","message.send.daily","attachment.upload.daily","attachment.file.bytes","attachment.storage.bytes","attachment.download.bytes.daily","content.external_link.daily"]
const input = { board_id: board, user_id: user, topic_id: topic, target_board_id: target, action: "topic_move" as const }
function body() { return { meta: { request_id: "governance-check" }, data: {
  board_id: board, topic_id: topic as string | null, target_board_id: target as string | null, attachment_id: null, file_bytes: null,
  policy_revision: null, topic_revision: 3, evaluated_at: "2026-10-07T00:00:00Z",
  scenario: { id: user, kind: "user", complete: true, account_status: "restricted", display_name: "版主",
    actions: [{ action: "topic_move", decision: "allowed", reason: "governance.conditions_matched", permission_provided: true, source_ids: [assignment] }],
    sources: [{ id: assignment, kind: "role", key: "board_moderator", display_name: "版主", permission_keys: ["moderation.topic.move"], quotas: {}, type_version: null as number | null, membership_kind: null, starts_at: "2026-10-01T00:00:00Z", ends_at: null,
      role: { id: role, revision: 2, scope: "board", scope_id: board, scope_mode: "subtree", scope_matches: true, target_scope_matches: true, is_system: false, assigned_by: user } }],
    quotas: quotaKeys.map(key => ({ key, limit: 0, used: null, source_ids: [] as string[] })) }
} } }
const fetchMock = vi.fn()
beforeEach(() => vi.stubGlobal("fetch", fetchMock))
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })
function respond(payload: unknown) { fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { headers: { "x-request-id": "governance-check" } })) }
it("accepts exact governance provenance and sends a read-only move destination", async () => {
  respond(body())
  await expect(getPermissionCheck(input)).resolves.toMatchObject({ target_board_id: target, scenario: { account_status: "restricted" } })
  expect(new URL(fetchMock.mock.calls[0][0], "https://local.test").searchParams.get("target_board_id")).toBe(target)
  expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
})
it("rejects unrelated or malformed move context locally", async () => {
  for (const invalid of [{ ...input, target_board_id: "wrong" }, { ...input, action: "topic_pin" as const }]) {
    await expect(getPermissionCheck(invalid)).rejects.toMatchObject({ status: 422 })
  }
  expect(fetchMock).not.toHaveBeenCalled()
})
it("rejects contradictory role metadata, wrong destination and role-derived ordinary quotas", async () => {
  for (const mutate of [(b: ReturnType<typeof body>) => { b.data.target_board_id = board },
    (b: ReturnType<typeof body>) => { b.data.scenario.sources[0].role.revision = 0 },
    (b: ReturnType<typeof body>) => { b.data.scenario.sources[0].type_version = 1 },
    (b: ReturnType<typeof body>) => { b.data.scenario.quotas[0].source_ids = [assignment] }]) {
    const payload = body(); mutate(payload); respond(payload)
    await expect(getPermissionCheck(input)).rejects.toMatchObject({ code: "response.invalid" })
  }
})
it("does not accept role provenance as an ordinary action grant", async () => {
  const payload = body(); payload.data.target_board_id = null
  payload.data.topic_id = null
  payload.data.scenario.actions[0].action = "topic_create"
  respond(payload)
  await expect(getPermissionCheck({ board_id: board, user_id: user, action: "topic_create" })).rejects.toMatchObject({ code: "response.invalid" })
})
