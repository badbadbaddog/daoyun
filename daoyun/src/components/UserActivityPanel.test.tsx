import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { listAdminUserContent } from "../api/adminUsers"
import { listAdminUserReports, type ContentReport } from "../api/reports"
import { UserActivityPanel } from "./UserActivityPanel"

vi.mock("../api/adminUsers", async () => ({ ...await vi.importActual("../api/adminUsers"), listAdminUserContent: vi.fn() }))
vi.mock("../api/reports", async () => ({ ...await vi.importActual("../api/reports"), listAdminUserReports: vi.fn() }))

const member = { id: "member", username: "member", displayName: "当前用户", avatarUrl: null }
const other = { id: "other", username: "reporter", displayName: "举报人", avatarUrl: null }
const report: ContentReport = {
  id: "report-one", targetType: "topic", targetId: "topic-one", targetTopicId: "topic-one", targetTitle: "相关主题",
  targetAuthor: member, reporter: other, reason: "spam", details: "举报说明", status: "open",
  resolution: "none", resolutionNote: null, reviewer: null, createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z", resolvedAt: null, revision: 1,
}
beforeEach(() => { vi.mocked(listAdminUserReports).mockResolvedValue({ reports: [report], nextCursor: null }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

it("shows content visibility including unknown states and preserves reply links", async () => {
  vi.mocked(listAdminUserContent).mockResolvedValue({ items: ["published", "hidden", "draft", "constructor"].map((status, index) => ({
    id: "reply-" + index, kind: "reply", topicId: "topic-one", title: "内容 " + index, excerpt: "摘要", status, createdAt: report.createdAt,
  })), nextCursor: null })
  render(<UserActivityPanel userId={member.id} kind="content" />)
  expect(await screen.findByText("已公开")).toBeInTheDocument()
  expect(screen.getByText("已隐藏")).toBeInTheDocument()
  expect(screen.getByText("草稿")).toBeInTheDocument()
  expect(screen.getByText("未知状态")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "内容 1" })).toHaveAttribute("href", "#topic/topic-one?reply=reply-1")
})

it("distinguishes reports filed by the user from reports on their content", async () => {
  vi.mocked(listAdminUserReports).mockResolvedValue({ reports: [
    report,
    { ...report, id: "filed", targetAuthor: other, reporter: member, targetType: "post" },
    { ...report, id: "both", reporter: member },
  ], nextCursor: null })
  render(<UserActivityPanel userId={member.id} kind="reports" canReadReports />)
  const articles = await screen.findAllByRole("article")
  expect(within(articles[0]).getByText("其内容被举报")).toBeInTheDocument()
  expect(within(articles[0]).queryByText("用户发起")).not.toBeInTheDocument()
  expect(within(articles[1]).getByText("用户发起")).toBeInTheDocument()
  expect(within(articles[1]).getByText("评论")).toBeInTheDocument()
  expect(within(articles[2]).getByText("用户发起")).toBeInTheDocument()
  expect(within(articles[2]).getByText("其内容被举报")).toBeInTheDocument()
  expect(within(articles[0]).getByRole("link", { name: "查看举报详情" })).toHaveAttribute("href", "#admin/reports?report_id=report-one")
})

it("keeps unavailable targets readable and hides report navigation without permission", async () => {
  vi.mocked(listAdminUserReports).mockResolvedValue({ reports: [{ ...report, targetTopicId: null, targetTitle: null, targetAuthor: null, reporter: member }], nextCursor: null })
  render(<UserActivityPanel userId={member.id} kind="reports" />)
  expect(await screen.findByText("目标内容已不可见")).toBeInTheDocument()
  expect(screen.getByText("用户发起")).toBeInTheDocument()
  expect(screen.queryByRole("link")).not.toBeInTheDocument()
})
