import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { listAdminUsers } from "../api/adminUsers"
import { listAdminReports } from "../api/reports"
import { AdminDashboard } from "./AdminDashboard"

vi.mock("../api/adminUsers", async () => {
  const actual = await vi.importActual<typeof import("../api/adminUsers")>("../api/adminUsers")
  return { ...actual, listAdminUsers: vi.fn() }
})

vi.mock("../api/reports", async () => {
  const actual = await vi.importActual<typeof import("../api/reports")>("../api/reports")
  return { ...actual, listAdminReports: vi.fn() }
})

const userId = "019fc900-0000-7000-8000-000000000801"
const reportId = "019fc900-0000-7000-8000-000000000802"
const adminUser = {
  id: userId, username: "restricted-member", displayName: "受限成员", avatarUrl: null,
  status: "restricted" as const, primaryRole: "成员", topicCount: 2, postCount: 4, reportCount: 1,
  createdAt: "2026-08-10T08:00:00Z", lastSeenAt: "2026-08-13T07:30:00Z",
}
const report = {
  id: reportId, targetType: "topic" as const, targetId: reportId, targetTopicId: reportId,
  targetTitle: "待核查内容", targetAuthor: null,
  reporter: { id: userId, username: "reporter", displayName: "举报者", avatarUrl: null },
  reason: "spam" as const, details: null, status: "open" as const, resolution: "none" as const,
  resolutionNote: null, reviewer: null, createdAt: "2026-08-13T08:00:00Z",
  updatedAt: "2026-08-13T08:00:00Z", resolvedAt: null, revision: 1,
}

beforeEach(() => {
  vi.mocked(listAdminUsers).mockImplementation(async (options) => ({ users: options?.status === "restricted" ? [adminUser] : [], nextCursor: null }))
  vi.mocked(listAdminReports).mockImplementation(async (options) => ({ reports: options?.status === "open" ? [report] : [], nextCursor: null }))
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("AdminDashboard", () => {
  it("loads only capability-allowed summaries and links to prepared task filters", async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<AdminDashboard capabilityKeys={["governance.reports.read"]} boards={[]} onNavigate={onNavigate} />)

    expect(await screen.findByRole("heading", { name: "今天需要处理什么" })).toBeInTheDocument()
    expect(screen.getByText("待核查内容")).toBeInTheDocument()
    expect(listAdminReports).toHaveBeenCalledTimes(2)
    expect(listAdminUsers).not.toHaveBeenCalled()
    expect(screen.queryByRole("heading", { name: "账号限制" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /打开举报：待核查内容/ }))
    expect(onNavigate).toHaveBeenCalledWith("reports", `status=open&report_id=${reportId}`)
  })

  it("shows user and board summaries with explicit empty states", async () => {
    render(<AdminDashboard
      capabilityKeys={["admin.users.read", "admin.configuration.read"]}
      boards={[{ id: reportId, parentId: null, slug: "hidden", name: "内部版块", description: "", icon: "folder", tone: "green", position: 0, visibility: "hidden", topicCount: 0, revision: 1, status: "open", mergedIntoBoardId: null }]}
      onNavigate={vi.fn()}
    />)

    expect(await screen.findByText("受限成员")).toBeInTheDocument()
    expect(screen.getByText("内部版块")).toBeInTheDocument()
    expect(screen.getByText("暂无暂停账号")).toBeInTheDocument()
    expect(listAdminUsers).toHaveBeenCalledTimes(2)
    expect(listAdminReports).not.toHaveBeenCalled()
  })

  it("keeps a failed summary retryable without hiding healthy sections", async () => {
    vi.mocked(listAdminReports).mockRejectedValueOnce(new Error("offline"))
    render(<AdminDashboard capabilityKeys={["governance.reports.read"]} boards={[]} onNavigate={vi.fn()} />)

    expect(await screen.findByRole("alert")).toHaveTextContent("举报待办暂时无法加载")
    expect(screen.getByText("暂无处理中举报")).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: "重试举报待办" }))
    await waitFor(() => expect(listAdminReports).toHaveBeenCalledTimes(4))
  })
})

it("links summary metrics to filters and labels truncated and failed counts honestly", async () => {
  vi.mocked(listAdminReports).mockImplementation(async (options) => {
    if (options?.status === "in_review") throw new Error("offline")
    return { reports: [report], nextCursor: "next" }
  })
  const onNavigate = vi.fn()
  render(<AdminDashboard capabilityKeys={["governance.reports.read"]} boards={[]} onNavigate={onNavigate} />)
  const summary = await screen.findByRole("region", { name: "待办概览" })
  await waitFor(() => expect(summary).toHaveTextContent("1+"))
  expect(summary).toHaveTextContent("暂不可用")
  await userEvent.setup().click(screen.getByRole("button", { name: /查看待处理举报/ }))
  expect(onNavigate).toHaveBeenCalledWith("reports", "status=open")
})

it("opens a task from its title and offers the complete report queue", async () => {
  const user = userEvent.setup()
  const onNavigate = vi.fn()
  render(<AdminDashboard capabilityKeys={["governance.reports.read"]} boards={[]} onNavigate={onNavigate} />)
  await user.click(await screen.findByText("待核查内容"))
  expect(onNavigate).toHaveBeenLastCalledWith("reports", `status=open&report_id=${reportId}`)
  await user.click(screen.getByRole("button", { name: "查看全部举报待办" }))
  expect(onNavigate).toHaveBeenLastCalledWith("reports", "")
})

it("links user and board tasks to their stable resource IDs", async () => {
  const onNavigate = vi.fn()
  render(<AdminDashboard capabilityKeys={["admin.users.read", "admin.configuration.read"]} boards={[{ id: reportId, parentId: null, slug: "hidden", name: "内部版块", description: "", icon: "folder", tone: "green", position: 0, visibility: "hidden", topicCount: 0, revision: 1, status: "open", mergedIntoBoardId: null }]} onNavigate={onNavigate} />)
  await userEvent.setup().click(await screen.findByRole("button", { name: "查看账号：受限成员" }))
  expect(onNavigate).toHaveBeenLastCalledWith("users", "status=restricted&user_id=" + userId)
  await userEvent.setup().click(screen.getByRole("button", { name: "打开版块：内部版块" }))
  expect(onNavigate).toHaveBeenLastCalledWith("boards", "board_id=" + reportId)
})

it("states the five-item status scope of truncated summaries", async () => {
  vi.mocked(listAdminReports).mockResolvedValue({ reports: Array.from({ length: 5 }, (_, index) => ({ ...report, id: reportId.slice(0, -1) + index })), nextCursor: reportId })
  render(<AdminDashboard capabilityKeys={["governance.reports.read"]} boards={[]} onNavigate={vi.fn()} />)
  await screen.findByRole("button", { name: "查看待处理举报：5+" })
  expect(screen.getByText("按状态汇总，每类最多展示 5 条；5+ 表示还有更多。" )).toBeInTheDocument()
})

it("waits for the board summary before restoring dashboard position", async () => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
  const props = { requestedQuery: "scroll=420", capabilityKeys: ["admin.configuration.read"], boards: [], onNavigate: vi.fn() }
  const view = render(<AdminDashboard {...props} boardsStatus="loading" />)
  await new Promise(resolve => setTimeout(resolve, 40))
  expect(scroll).not.toHaveBeenCalled()
  view.rerender(<AdminDashboard {...props} boardsStatus="ready" />)
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 420, behavior: "instant" }))
  scroll.mockRestore()
})

it("shows an unavailable board summary without claiming zero or hiding user tasks", async () => {
  const retry = vi.fn()
  render(<AdminDashboard capabilityKeys={["admin.configuration.read", "admin.users.read"]} boards={[]} boardsStatus="error" onRetryBoards={retry} onNavigate={vi.fn()} />)
  await screen.findByRole("button", { name: "查看账号：受限成员" })
  expect(screen.getByRole("button", { name: "查看隐藏版块：暂不可用" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "查看隐藏版块：0" })).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole("button", { name: "重试版块摘要" }))
  expect(retry).toHaveBeenCalledOnce()
})
