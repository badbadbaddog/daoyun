import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getAdminReport, listAdminReports, moderateAdminReport, updateAdminReport } from "../api/reports"
import { listAdminAudit } from "../api/admin"
import { ReportAdminPanel } from "./ReportAdminPanel"

vi.mock("../api/reports", async () => {
  const actual = await vi.importActual<typeof import("../api/reports")>("../api/reports")
  return { ...actual, getAdminReport: vi.fn(), listAdminReports: vi.fn(), moderateAdminReport: vi.fn(), updateAdminReport: vi.fn() }
})

vi.mock("../api/admin", async () => {
  const actual = await vi.importActual<typeof import("../api/admin")>("../api/admin")
  return { ...actual, listAdminAudit: vi.fn() }
})

const report = {
  id: "019fc900-0000-7000-8000-000000000201",
  targetType: "topic" as const,
  targetId: "019fc900-0000-7000-8000-000000000202",
  targetTopicId: "019fc900-0000-7000-8000-000000000202",
  targetTitle: "待审核主题",
  targetAuthor: { id: "019fc900-0000-7000-8000-000000000203", username: "author", displayName: "内容作者", avatarUrl: null },
  reporter: { id: "019fc900-0000-7000-8000-000000000204", username: "reporter", displayName: "举报者", avatarUrl: null },
  reason: "spam" as const,
  details: "反复发布广告",
  status: "open" as const,
  resolution: "none" as const,
  resolutionNote: null,
  reviewer: null,
  createdAt: "2026-08-05T10:00:00Z",
  updatedAt: "2026-08-05T10:00:00Z",
  resolvedAt: null,
  revision: 1,
}
const detail = {
  report,
  context: { topicId: report.targetId, title: report.targetTitle, items: [{ id: report.targetId, author: report.targetAuthor, content: "这是广告内容", status: "published", isTarget: true, createdAt: report.createdAt }] },
  author: { user: report.targetAuthor, status: "active" as const, reportCount: 3, revision: 1 },
  relatedReports: [{ id: report.id, reason: report.reason, status: report.status, resolution: report.resolution, createdAt: report.createdAt, resolvedAt: null }],
  handlingHistory: [],
}
const secondReport = { ...report, id: "019fc900-0000-7000-8000-000000000206", targetId: "019fc900-0000-7000-8000-000000000207", targetTopicId: "019fc900-0000-7000-8000-000000000207", targetTitle: "第二条待审核主题" }
const secondDetail = { ...detail, report: secondReport, context: { topicId: secondReport.targetId, title: secondReport.targetTitle, items: [{ ...detail.context.items[0], id: secondReport.targetId, content: "第二条内容" }] } }

beforeEach(() => {
  vi.mocked(listAdminReports).mockResolvedValue({ reports: [report], nextCursor: null })
  vi.mocked(getAdminReport).mockResolvedValue(detail)
  vi.mocked(updateAdminReport).mockResolvedValue({ ...report, status: "in_review", revision: 2 })
  vi.mocked(moderateAdminReport).mockResolvedValue({
    report: { ...report, status: "resolved", resolution: "hide_topic", revision: 2 },
    content: { action: "hide", targetId: report.targetId, changed: true },
    user: { userId: report.targetAuthor.id, status: "restricted", reason: "广告账号", expiresAt: null, revision: 2 },
    auditId: "019fc900-0000-7000-8000-000000000205",
    notificationQueued: true,
  })
  vi.mocked(listAdminAudit).mockResolvedValue({ entries: [{
    id: "019fc900-0000-7000-8000-000000000205",
    actor: { id: report.reporter.id, username: "owner", displayName: "站长", avatarUrl: null },
    action: "report.moderate",
    resourceType: "content_report",
    resourceId: report.id,
    summary: { note: "内部处置备注" },
    createdAt: "2026-08-05T11:00:00Z",
  }], nextCursor: null })
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("ReportAdminPanel", () => {
  it("loads the selected server filter and shows report context in a detail workspace", async () => {
    const user = userEvent.setup()
    render(<ReportAdminPanel requestedStatus="open" onStatusChange={vi.fn()} csrfToken="csrf" canResolve />)

    expect(await screen.findByRole("heading", { name: "待审核主题" })).toBeInTheDocument()
    expect(listAdminReports).toHaveBeenCalledWith(expect.objectContaining({ status: "open", limit: 20 }))
    await user.click(screen.getByRole("button", { name: /查看举报：待审核主题/ }))
    expect(await screen.findByText("这是广告内容")).toBeInTheDocument()
    expect(screen.getByText("该作者共有 3 条举报记录")).toBeInTheDocument()
  })

  it("restores a report detail URL even when the report is not on the first list page", async () => {
    vi.mocked(listAdminReports).mockResolvedValueOnce({ reports: [report], nextCursor: secondReport.id })
    vi.mocked(getAdminReport).mockImplementation(async (reportId) => reportId === secondReport.id ? secondDetail : detail)
    render(<ReportAdminPanel requestedStatus="all" requestedReportId={secondReport.id} onStatusChange={vi.fn()} csrfToken="csrf" canResolve={false} />)

    expect(await screen.findByText("第二条内容")).toBeInTheDocument()
    expect(getAdminReport).toHaveBeenCalledWith(secondReport.id)
  })

  it("does not append a stale page after the status filter changes", async () => {
    const stalePage = deferred<{ reports: (typeof secondReport)[]; nextCursor: null }>()
    vi.mocked(listAdminReports).mockImplementation((options) => {
      if (options?.cursor) return stalePage.promise
      if (options?.status === "resolved") return Promise.resolve({ reports: [{ ...secondReport, status: "resolved" as const }], nextCursor: null })
      return Promise.resolve({ reports: [report], nextCursor: report.id })
    })
    const user = userEvent.setup()
    const { rerender } = render(<ReportAdminPanel requestedStatus="open" onStatusChange={vi.fn()} csrfToken="csrf" canResolve={false} />)
    await user.click(await screen.findByRole("button", { name: "加载更多" }))

    rerender(<ReportAdminPanel requestedStatus="resolved" onStatusChange={vi.fn()} csrfToken="csrf" canResolve={false} />)
    expect(await screen.findByRole("heading", { name: "第二条待审核主题" })).toBeInTheDocument()
    await act(async () => {
      stalePage.resolve({ reports: [{ ...secondReport, id: "019fc900-0000-7000-8000-000000000299", targetTitle: "过期筛选举报" }], nextCursor: null })
      await stalePage.promise
    })

    expect(screen.queryByRole("heading", { name: "过期筛选举报" })).not.toBeInTheDocument()
  })

  it("confirms and submits content plus user actions as one moderation decision", async () => {
    const user = userEvent.setup()
    render(<ReportAdminPanel requestedStatus="all" onStatusChange={vi.fn()} csrfToken="csrf-token" canResolve />)
    await user.click(await screen.findByRole("button", { name: /查看举报：待审核主题/ }))

    await user.click(await screen.findByRole("checkbox", { name: "隐藏被举报内容" }))
    await user.selectOptions(screen.getByLabelText("作者处置"), "restricted")
    await user.type(screen.getByLabelText("作者处置原因"), "广告账号")
    await user.type(screen.getByLabelText("对举报人的说明"), "内容违反社区规则")
    await user.type(screen.getByLabelText("内部处理备注"), "已核对上下文并处置")
    const submit = screen.getByRole("button", { name: "确认并完成处置" })
    await user.click(submit)

    const dialog = screen.getByRole("alertdialog", { name: "确认举报处置" })
    expect(within(dialog).getByText(/隐藏内容、限制作者账号、解决举报/)).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus()
    expect(moderateAdminReport).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole("button", { name: "确认执行处置" }))

    expect(moderateAdminReport).toHaveBeenCalledWith(report.id, {
      disposition: "resolved",
      contentAction: "hide",
      userAction: { kind: "restricted", reason: "广告账号", expiresAt: null },
      publicReason: "内容违反社区规则",
      note: "已核对上下文并处置",
      expectedRevision: 1,
    }, "csrf-token")
    expect(await screen.findByText("处置已完成：内容已隐藏，作者账号已限制，举报人通知已入队。" )).toBeInTheDocument()
  })

  it("keeps moderation controls hidden for a read-only reviewer", async () => {
    const user = userEvent.setup()
    render(<ReportAdminPanel requestedStatus="all" onStatusChange={vi.fn()} csrfToken="csrf" canResolve={false} />)
    await user.click(await screen.findByRole("button", { name: /查看举报：待审核主题/ }))

    expect(await screen.findByText("这是广告内容")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "确认并完成处置" })).not.toBeInTheDocument()
    expect(screen.getByText("当前权限仅允许查看举报详情。" )).toBeInTheDocument()
  })

  it("loads report-related audit records only with audit.read and hides internal summaries", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ReportAdminPanel requestedStatus="all" onStatusChange={vi.fn()} csrfToken="csrf" canResolve={false} canReadAudit={false} />)
    await user.click(await screen.findByRole("button", { name: /查看举报：待审核主题/ }))
    expect(screen.queryByRole("heading", { name: "相关操作记录" })).not.toBeInTheDocument()
    expect(listAdminAudit).not.toHaveBeenCalled()

    rerender(<ReportAdminPanel requestedStatus="all" onStatusChange={vi.fn()} csrfToken="csrf" canResolve={false} canReadAudit />)
    expect(await screen.findByRole("heading", { name: "相关操作记录" })).toBeInTheDocument()
    expect(listAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ reportId: report.id, limit: 10 }))
    expect(screen.getByText("019fc900-0000-7000-8000-000000000205")).toBeInTheDocument()
    expect(screen.queryByText("内部处置备注")).not.toBeInTheDocument()
  })

  it("removes a triaged report when it no longer matches the active server filter", async () => {
    const user = userEvent.setup()
    render(<ReportAdminPanel requestedStatus="open" onStatusChange={vi.fn()} csrfToken="csrf" canResolve />)
    await user.click(await screen.findByRole("button", { name: /查看举报：待审核主题/ }))
    await user.click(await screen.findByRole("button", { name: "标记处理中" }))

    expect(await screen.findByText("当前筛选下暂无举报")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /查看举报：待审核主题/ })).not.toBeInTheDocument()
  })

  it("resets the moderation draft when the reviewer switches reports", async () => {
    const user = userEvent.setup()
    vi.mocked(listAdminReports).mockResolvedValueOnce({ reports: [report, secondReport], nextCursor: null })
    vi.mocked(getAdminReport).mockImplementation(async (reportId) => reportId === report.id ? detail : secondDetail)
    render(<ReportAdminPanel requestedStatus="all" onStatusChange={vi.fn()} csrfToken="csrf" canResolve />)
    await user.click(await screen.findByRole("button", { name: /查看举报：待审核主题/ }))
    await user.click(await screen.findByRole("checkbox", { name: "隐藏被举报内容" }))
    await user.selectOptions(screen.getByLabelText("作者处置"), "restricted")
    await user.type(screen.getByLabelText("作者处置原因"), "上一条原因")
    await user.type(screen.getByLabelText("内部处理备注"), "上一条备注")

    await user.click(screen.getByRole("button", { name: /查看举报：第二条待审核主题/ }))
    expect(await screen.findByText("第二条内容")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "隐藏被举报内容" })).not.toBeChecked()
    expect(screen.getByLabelText("作者处置")).toHaveValue("none")
    expect(screen.getByLabelText("内部处理备注")).toHaveValue("")
  })

  it("ignores a stale detail response after a newer report is selected", async () => {
    const user = userEvent.setup()
    const firstRequest = deferred<typeof detail>()
    const secondRequest = deferred<typeof secondDetail>()
    vi.mocked(listAdminReports).mockResolvedValueOnce({ reports: [report, secondReport], nextCursor: null })
    vi.mocked(getAdminReport).mockImplementation((reportId) => reportId === report.id ? firstRequest.promise : secondRequest.promise)
    render(<ReportAdminPanel requestedStatus="all" onStatusChange={vi.fn()} csrfToken="csrf" canResolve />)
    await user.click(await screen.findByRole("button", { name: /查看举报：待审核主题/ }))
    await user.click(screen.getByRole("button", { name: /查看举报：第二条待审核主题/ }))
    secondRequest.resolve(secondDetail)
    expect(await screen.findByText("第二条内容")).toBeInTheDocument()
    await act(async () => {
      firstRequest.resolve(detail)
      await firstRequest.promise
    })

    const detailRegion = screen.getByRole("region", { name: "举报详情" })
    expect(within(detailRegion).queryByText("这是广告内容")).not.toBeInTheDocument()
    expect(within(detailRegion).getByRole("heading", { name: "第二条待审核主题" })).toBeInTheDocument()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}
