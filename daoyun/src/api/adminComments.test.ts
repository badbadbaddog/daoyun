import { afterEach, expect, it, vi } from "vitest"
import { listAdminComments, moderateAdminComment } from "./adminComments"

const id = "019fc800-0000-7000-8000-000000000001"
const comment = { id, topic_id: id, topic_title: "原帖", board_id: id, board_name: "交流",
  author: { id, username: "member", display_name: "成员", avatar_url: null },
  content: "评论", content_truncated: false, status: "published", created_at: "2026-09-22T00:00:00Z", updated_at: "2026-09-22T00:00:00Z" }
afterEach(() => vi.restoreAllMocks())
it("sends comment filters and preserves the real next cursor", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [comment], meta: { request_id: id, next_cursor: id } })))
  await expect(listAdminComments({ boardId: id, query: "测试", status: "hidden", cursor: id })).resolves.toEqual({ comments: [comment], nextCursor: id })
  const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost")
  expect(url.searchParams.get("q")).toBe("测试")
  expect(url.searchParams.get("board_id")).toBe(id)
  expect(url.searchParams.get("cursor")).toBe(id)
  expect(url.searchParams.get("status")).toBe("hidden")
})
it("sends the concurrency token, reason and csrf when moderating", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { ...comment, status: "hidden" }, meta: { request_id: id } })))
  await moderateAdminComment(id, { status: "hidden", expected_updated_at: comment.updated_at, reason: "垃圾广告" }, "csrf")
  expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": "csrf" } }))
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ status: "hidden", expected_updated_at: comment.updated_at, reason: "垃圾广告" })
})
it("rejects malformed comment records and preserves server conflicts", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ ...comment, updated_at: "invalid" }], meta: { request_id: id, next_cursor: null } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "comment.conflict", message: "评论已更新" } }), { status: 409 }))
  await expect(listAdminComments({ boardId: id })).rejects.toThrow("评论管理响应格式无效")
  await expect(moderateAdminComment(id, { status: "hidden", expected_updated_at: comment.updated_at, reason: "处理说明" }, "csrf")).rejects.toMatchObject({ status: 409, code: "comment.conflict" })
})

it("supports an explicit page size and rejects invalid limits before fetching", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [], meta: { request_id: id, next_cursor: null } })))
  await listAdminComments({ boardId: id, limit: 50 })
  expect(new URL(String(fetchMock.mock.calls[0][0]), "http://localhost").searchParams.get("limit")).toBe("50")
  await expect(listAdminComments({ boardId: id, limit: 0 })).rejects.toThrow()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
