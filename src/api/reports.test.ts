import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createReport,
  getAdminReport,
  listAdminReports,
  listAdminUserReports,
  moderateAdminReport,
  ReportApiError,
  updateAdminReport,
  updateAdminReportsBatch,
} from "./reports"

const requestId = "019fc800-0000-7000-8000-000000000001"
const targetId = "019fc800-0000-7000-8000-000000000002"
const reportId = "019fc800-0000-7000-8000-000000000003"
const user = { id: targetId, username: "member", display_name: "成员", avatar_url: null }
const report = {
  id: reportId,
  target_type: "topic",
  target_id: targetId,
  target_topic_id: targetId,
  target_title: "待审核主题",
  target_author: user,
  reporter: { ...user, username: "reporter", display_name: "举报者" },
  reason: "spam",
  details: "广告",
  status: "open",
  resolution: "none",
  resolution_note: null,
  reviewer: null,
  created_at: "2026-08-05T10:00:00Z",
  updated_at: "2026-08-05T10:00:00Z",
  resolved_at: null,
  revision: 1,
}

afterEach(() => vi.restoreAllMocks())

describe("reports api", () => {
  it("creates a report with the session csrf token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: reportId, created: true }, meta: { request_id: requestId } }), { status: 201 }))

    await expect(createReport("topic", targetId, "spam", "广告", "csrf-token")).resolves.toEqual({ id: reportId, created: true })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/reports", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ target_type: "topic", target_id: targetId, reason: "spam", details: "广告" }),
    }))
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual(expect.objectContaining({ "x-csrf-token": "csrf-token" }))
  })

  it("maps an admin page and preserves the next cursor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [report], meta: { request_id: requestId, next_cursor: reportId } })))

    await expect(listAdminReports({ status: "open", limit: 1 })).resolves.toEqual({
      reports: [expect.objectContaining({ targetType: "topic", reporter: expect.objectContaining({ displayName: "举报者" }) })],
      nextCursor: reportId,
    })
  })

  it("loads reports related to one managed user", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [report], meta: { request_id: requestId, next_cursor: null } })))

    await expect(listAdminUserReports(targetId)).resolves.toEqual({ reports: [expect.objectContaining({ id: reportId })], nextCursor: null })
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/admin/users/${targetId}/reports?limit=20`)
  })

  it("loads a report detail with bounded content and handling context", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        report,
        context: { topic_id: targetId, title: "待审核主题", items: [{ id: targetId, author: user, content: "上下文", status: "published", is_target: true, created_at: report.created_at }] },
        author: { user, status: "active", report_count: 2, revision: 3 },
        related_reports: [{ id: reportId, reason: "spam", status: "open", resolution: "none", created_at: report.created_at, resolved_at: null }],
        handling_history: [{ id: requestId, action: "report.create", actor: user, created_at: report.created_at }],
      },
      meta: { request_id: requestId },
    })))

    await expect(getAdminReport(reportId)).resolves.toEqual(expect.objectContaining({
      report: expect.objectContaining({ revision: 1 }),
      context: expect.objectContaining({ items: [expect.objectContaining({ isTarget: true })] }),
      author: expect.objectContaining({ reportCount: 2 }),
      handlingHistory: [expect.objectContaining({ action: "report.create" })],
    }))
  })

  it("submits one atomic moderation decision with the visible revision", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        report: { ...report, status: "resolved", resolution: "hide_topic", revision: 2, resolved_at: "2026-08-05T10:05:00Z" },
        content: { action: "hide", target_id: targetId, changed: true },
        user: { user_id: targetId, status: "restricted", reason: "广告账号", expires_at: null, revision: 4 },
        audit_id: requestId,
        notification_queued: true,
      },
      meta: { request_id: requestId },
    }), { status: 201 }))

    await expect(moderateAdminReport(reportId, {
      disposition: "resolved",
      contentAction: "hide",
      userAction: { kind: "restricted", reason: "广告账号", expiresAt: null },
      publicReason: "内容违反社区规则",
      note: "已核对上下文并处置",
      expectedRevision: 1,
    }, "csrf-token")).resolves.toEqual(expect.objectContaining({
      content: { action: "hide", targetId, changed: true },
      user: expect.objectContaining({ status: "restricted" }),
      notificationQueued: true,
    }))
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/admin/reports/${reportId}/moderations`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        disposition: "resolved",
        content_action: "hide",
        user_action: { kind: "restricted", reason: "广告账号", expires_at: null },
        public_reason: "内容违反社区规则",
        note: "已核对上下文并处置",
        expected_revision: 1,
      }),
    }))
  })

  it("maps structured validation errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "request.validation_failed", message: "invalid", fields: { note: ["备注无效"] } }, meta: { request_id: requestId } }), { status: 422 }))

    await expect(updateAdminReport(reportId, { status: "in_review", resolution: "none", expectedRevision: 1 }, "csrf-token"))
      .rejects.toEqual(expect.objectContaining<Partial<ReportApiError>>({ status: 422, code: "request.validation_failed", fields: { note: ["备注无效"] } }))
  })

  it("submits an atomic admin batch action", async () => {
    const secondReportId = "019fc800-0000-7000-8000-000000000004"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { updated: 2, report_ids: [reportId, secondReportId] }, meta: { request_id: requestId } })))

    await expect(updateAdminReportsBatch([reportId, secondReportId], { status: "resolved", resolution: "hide_topic", note: "批量处理" }, "csrf-token"))
      .resolves.toEqual({ updated: 2, reportIds: [reportId, secondReportId] })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/reports/batch", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ report_ids: [reportId, secondReportId], status: "resolved", resolution: "hide_topic", note: "批量处理" }),
    }))
  })
})
