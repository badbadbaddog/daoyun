import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { getCommunityAnalytics, type CommunityAnalytics } from "../api/analytics"
import { AdminDashboardTrend } from "./AdminDashboardTrend"

vi.mock("../api/analytics", () => ({ getCommunityAnalytics: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const counts = { new_users: 3, active_users: 4, topics: 5, replies: 8, points_issued: 0, points_spent: 0 }
const report: CommunityAnalytics = {
  ...counts, from: "2026-09-16", through: "2026-09-22", started_at: "2026-09-16T00:00:00Z",
  activity_complete: true, content_complete: false, retention_eligible: 0, retention_returned: 0, boards: [],
  days: [
    { ...counts, day: "2026-09-16", activity_complete: true, content_complete: true },
    { ...counts, day: "2026-09-17", activity_complete: false, content_complete: false },
    { ...counts, day: "2026-09-18", activity_complete: true, content_complete: true },
  ],
}
it("switches trend metrics and leaves incomplete collection gaps unconnected", async () => {
  vi.mocked(getCommunityAnalytics).mockResolvedValue(report)
  render(<AdminDashboardTrend />)
  const chart = await screen.findByRole("img", { name: "近7天主题发布趋势" })
  expect(chart.querySelectorAll("circle")).toHaveLength(2)
  expect(chart.querySelectorAll("[data-trend-area]")).toHaveLength(0)
  expect(chart.querySelectorAll("line[data-trend-segment]")).toHaveLength(0)
  expect(screen.getByText("发布采集不完整，缺失日期留空，不计为零。")).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole("button", { name: "新增用户" }))
  expect(screen.getByRole("img", { name: "近7天新增用户趋势" }).querySelectorAll("circle")).toHaveLength(3)
  expect(screen.getByRole("img", { name: "近7天新增用户趋势" }).querySelectorAll("[data-trend-area]")).toHaveLength(2)
  await userEvent.setup().click(screen.getByText("查看每日数据"))
  expect(screen.getByRole("table")).toHaveTextContent("2026-09-17")
  expect(getCommunityAnalytics).toHaveBeenCalledTimes(1)
})
it("shows a retryable error and a truthful empty state", async () => {
  vi.mocked(getCommunityAnalytics).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ...report, days: [] })
  render(<AdminDashboardTrend />)
  expect(await screen.findByRole("alert")).toHaveTextContent("趋势数据暂时无法加载")
  await userEvent.setup().click(screen.getByRole("button", { name: "重试趋势数据" }))
  expect(await screen.findByText("当前范围暂无可展示的每日数据")).toBeInTheDocument()
})
