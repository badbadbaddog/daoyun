import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getBoardPermissionMatrix } from "./boardPermissions"
const boardId = "019fc900-0000-7000-8000-000000000101"
const groupId = "019fc900-0000-7000-8000-000000000201"
const quotaKeys = ["topic.create.daily", "reply.create.daily", "message.send.daily", "attachment.upload.daily", "attachment.file.bytes", "attachment.storage.bytes", "attachment.download.bytes.daily", "content.external_link.daily"]
function payload() {
  return { meta: { request_id: "matrix-request" }, data: { board_id: boardId, visibility: "public", policy_revision: null, evaluated_at: "2026-10-03T00:00:00Z",
    scenarios: [{ id: groupId, kind: "group", account_status: null, complete: false, display_name: "注册成员", sources: [{ id: groupId, kind: "group", display_name: "注册成员", key: "registered", permission_keys: [], quotas: {}, type_version: null, membership_kind: "base", role: null, starts_at: null, ends_at: null }],
      actions: ["browse", "topic_create", "reply_create", "attachment_upload", "attachment_download", "moderation_browse", "topic_pin", "topic_feature", "topic_lock", "topic_move"].map(action => ({ action, decision: "not_provided", reason: "scenario.other_sources_unknown", permission_provided: false, source_ids: [] as string[] })),
      quotas: quotaKeys.map(key => ({ key, limit: 0, used: null, source_ids: [] as string[] })) }] } }
}
const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset() })
afterEach(() => vi.unstubAllGlobals())
function respond(body: unknown, requestId = "matrix-request") { fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": requestId } })) }
describe("permission matrix transport", () => {
  it("reads exact IDs without writes and keeps zero distinct from unlimited", async () => {
    respond(payload()); const controller = new AbortController()
    const matrix = await getBoardPermissionMatrix(boardId, [groupId], undefined, controller.signal)
    expect(matrix.scenarios[0].quotas[0].limit).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/boards/" + boardId + "/permission-matrix?group_ids=" + groupId, expect.objectContaining({ credentials: "include", signal: controller.signal }))
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
  })
  it("rejects unknown decisions instead of inventing an effective result", async () => {
    const body = payload(); body.data.scenarios[0].actions[0].decision = "unlimited"; respond(body)
    await expect(getBoardPermissionMatrix(boardId, [groupId])).rejects.toMatchObject({ code: "response.invalid" })
  })
  it("rejects missing action rows and imprecise quotas", async () => {
    const body = payload(); body.data.scenarios[0].quotas[0].limit = Number.MAX_SAFE_INTEGER + 1; respond(body)
    await expect(getBoardPermissionMatrix(boardId, [groupId])).rejects.toMatchObject({ code: "response.invalid" })
    const missing = payload(); missing.data.scenarios[0].actions.pop(); respond(missing)
    await expect(getBoardPermissionMatrix(boardId, [groupId])).rejects.toMatchObject({ code: "response.invalid" })
  })
  it("rejects a result for a different board or dangling source IDs", async () => {
    const body = payload(); body.data.board_id = groupId; respond(body)
    await expect(getBoardPermissionMatrix(boardId, [groupId])).rejects.toMatchObject({ code: "response.invalid" })
    const dangling = payload(); dangling.data.scenarios[0].actions[0].source_ids.push(boardId); respond(dangling)
    await expect(getBoardPermissionMatrix(boardId, [groupId])).rejects.toMatchObject({ code: "response.invalid" })
  })
  it("requires matching envelope and header request IDs", async () => {
    respond(payload(), "other-request")
    await expect(getBoardPermissionMatrix(boardId, [groupId])).rejects.toMatchObject({ code: "response.invalid" })
  })
  it("rejects invalid or duplicate scenarios before sending a request", async () => {
    await expect(getBoardPermissionMatrix(boardId, [groupId, groupId])).rejects.toMatchObject({ status: 422 })
    await expect(getBoardPermissionMatrix(boardId, [])).rejects.toMatchObject({ status: 422 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("keeps a real authorization error visible", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "admin.forbidden", message: "无读取权限" } }), { status: 403 }))
    await expect(getBoardPermissionMatrix(boardId, [groupId])).rejects.toMatchObject({ status: 403, code: "admin.forbidden", message: "无读取权限" })
  })
})
