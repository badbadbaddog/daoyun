import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getPermissionCheck } from "./boardPermissions"
const boardId = "019fc900-0000-7000-8000-000000000101"
const userId = "019fc900-0000-7000-8000-000000000401"
const topicId = "019fc900-0000-7000-8000-000000000501"
const input = { board_id: boardId, user_id: userId, action: "attachment_upload" as const, topic_id: topicId, file_bytes: 68 }
const quotaKeys = ["topic.create.daily", "reply.create.daily", "message.send.daily", "attachment.upload.daily", "attachment.file.bytes", "attachment.storage.bytes", "attachment.download.bytes.daily", "content.external_link.daily"]
function payload() { return { meta: { request_id: "check-request" }, data: {
  board_id: boardId, topic_id: topicId, attachment_id: null, file_bytes: 68, target_board_id: null, policy_revision: null, topic_revision: null, evaluated_at: "2026-10-03T00:00:00Z",
  scenario: { id: userId, kind: "user", account_status: "active", complete: true, display_name: "指定用户", sources: [],
    actions: [{ action: "attachment_upload", decision: "allowed", reason: "resource.conditions_matched", permission_provided: true, source_ids: [] as string[] }],
    quotas: quotaKeys.map(key => ({ key, limit: 0, used: 0, source_ids: [] as string[] })) }
} } }
const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset() })
afterEach(() => vi.unstubAllGlobals())
function respond(body: unknown, requestId = "check-request") { fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { "x-request-id": requestId } })) }
describe("read-only permission check transport", () => {
  it("normalizes uppercase UUID conditions before comparing canonical server identifiers", async () => {
    const attachmentId = "019fc900-0000-7000-8000-000000000601"
    for (const action of ["attachment_upload", "attachment_download"] as const) {
      const conditions = { board_id: boardId.toUpperCase(), user_id: userId.toUpperCase(),
        topic_id: topicId.toUpperCase(), action,
        ...(action === "attachment_download" ? { attachment_id: attachmentId.toUpperCase() } : { file_bytes: 68 }) }
      const body = payload()
      respond({ ...body, data: { ...body.data,
        attachment_id: action === "attachment_download" ? attachmentId : null,
        file_bytes: action === "attachment_upload" ? 68 : null,
        scenario: { ...body.data.scenario, actions: [{ ...body.data.scenario.actions[0], action }] } } })
      await expect(getPermissionCheck(conditions)).resolves.toMatchObject({ board_id: boardId, topic_id: topicId, scenario: { id: userId } })
      const params = new URL(fetchMock.mock.calls.at(-1)![0], "https://local.test").searchParams
      expect(params.get("board_id")).toBe(boardId)
      expect(params.get("user_id")).toBe(userId)
      expect(params.get("topic_id")).toBe(topicId)
      if (action === "attachment_download") expect(params.get("attachment_id")).toBe(attachmentId)
      expect(conditions.board_id).toBe(boardId.toUpperCase())
    }
  })

  it("sends only the exact read-only resource conditions and preserves cancellation", async () => {
    respond(payload()); const controller = new AbortController()
    expect((await getPermissionCheck(input, controller.signal)).scenario.actions[0].decision).toBe("allowed")
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/permission-check?" + new URLSearchParams({ board_id: boardId, user_id: userId, action: "attachment_upload", topic_id: topicId, file_bytes: "68" }), expect.objectContaining({ credentials: "include", signal: controller.signal }))
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
  })
  it("rejects invalid identifiers, unrelated context and nonpositive or oversized files locally", async () => {
    for (const bad of [{ user_id: "invalid" }, { file_bytes: 0 }, { file_bytes: 52428801 }, { file_bytes: 1.1 }, { action: "browse" as const, file_bytes: 68 }]) {
      await expect(getPermissionCheck({ ...input, ...bad })).rejects.toMatchObject({ status: 422 })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("rejects mismatched users, actions, resource sizes and request IDs", async () => {
    for (const change of [(b: ReturnType<typeof payload>) => { b.data.scenario.id = boardId },
      (b: ReturnType<typeof payload>) => { b.data.scenario.actions[0].action = "browse" },
      (b: ReturnType<typeof payload>) => { b.data.file_bytes = 100 },
      (b: ReturnType<typeof payload>) => { b.data.scenario.actions[0].source_ids = [boardId] },
      (b: ReturnType<typeof payload>) => { b.data.scenario.complete = false }]) {
      const body = payload(); change(body); respond(body)
      await expect(getPermissionCheck(input)).rejects.toMatchObject({ code: "response.invalid" })
    }
    respond(payload(), "other")
    await expect(getPermissionCheck(input)).rejects.toMatchObject({ code: "response.invalid" })
  })
  it("keeps authorization denial visible and returns no invented sources", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "admin.forbidden", message: "无读取权限" } }), { status: 403 }))
    await expect(getPermissionCheck(input)).rejects.toMatchObject({ status: 403, code: "admin.forbidden", message: "无读取权限" })
  })
})
