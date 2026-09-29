import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  acknowledgeOperationsAlert,
  AdminApiError,
  getOperationsSummary,
  listOperationsAlertRules,
  listOperationsAlerts,
  updateOperationsAlertRule,
} from "../api/admin"
import type { OperationsAlert, OperationsAlertRule, OperationsSummary } from "../api/admin"
import { OperationsAdminPanel } from "./OperationsAdminPanel"

vi.mock("../api/admin", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/admin")>(),
  acknowledgeOperationsAlert: vi.fn(),
  getOperationsSummary: vi.fn(),
  listOperationsAlertRules: vi.fn(),
  listOperationsAlerts: vi.fn(),
  updateOperationsAlertRule: vi.fn(),
}))

const summary: OperationsSummary = {
  observedAt: "2026-08-11T10:00:00Z",
  uptimeSeconds: 3723,
  http: { totalRequests: 1250, inFlightRequests: 2, errors5m: 3, p95Ms5m: 84 },
  database: { ready: true, connections: 5, idleConnections: 3 },
  outbox: { pending: 4, processing: 1, dead: 0 },
  riskAlertsOpen: 2,
  alerts: { open: 1, acknowledged: 3 },
}
const rule: OperationsAlertRule = {
  id: "019fc900-0000-7000-8000-000000000701",
  key: "api_5xx",
  name: "API 5xx 错误",
  kind: "http_5xx_count",
  threshold: 10,
  windowSeconds: 300,
  enabled: true,
  revision: 1,
  createdAt: "2026-08-11T09:00:00Z",
  updatedAt: "2026-08-11T09:00:00Z",
}
const alert: OperationsAlert = {
  id: "019fc900-0000-7000-8000-000000000702",
  rule: { id: rule.id, key: rule.key, name: rule.name, kind: rule.kind },
  status: "open",
  observedValue: 12,
  threshold: 10,
  firstTriggeredAt: "2026-08-11T10:00:00Z",
  lastTriggeredAt: "2026-08-11T10:01:00Z",
  acknowledgedBy: null,
  acknowledgedAt: null,
  resolvedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOperationsSummary).mockResolvedValue(summary)
  vi.mocked(listOperationsAlertRules).mockResolvedValue([rule])
  vi.mocked(listOperationsAlerts).mockResolvedValue({ alerts: [alert], nextCursor: null })
})

afterEach(() => cleanup())

describe("OperationsAdminPanel", () => {
  it("separates overview, alerts and on-demand rule editing", async () => {
    const user = userEvent.setup()
    render(<OperationsAdminPanel csrfToken="csrf-token" />)
    await screen.findByText("数据库正常")
    expect(screen.queryByLabelText("API 5xx 错误阈值")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "告警规则" }))
    await user.click(screen.getByRole("button", { name: "编辑 API 5xx 错误规则" }))
    expect(screen.getByRole("dialog", { name: "编辑告警规则" })).toContainElement(screen.getByLabelText("API 5xx 错误阈值"))
  })
  it("renders real operational state and saves a validated rule draft", async () => {
    const user = userEvent.setup()
    vi.mocked(updateOperationsAlertRule).mockResolvedValue({ ...rule, threshold: 15, revision: 2 })
    render(<OperationsAdminPanel csrfToken="csrf-token" />)

    expect(screen.getByRole("status")).toHaveTextContent("正在读取运营状态")
    expect(await screen.findByRole("heading", { name: "运营概览" })).toBeInTheDocument()
    expect(screen.getByText("1,250")).toBeInTheDocument()
    expect(screen.getByText("数据库正常")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "告警规则" }))
    await user.click(screen.getByRole("button", { name: "编辑 API 5xx 错误规则" }))

    const threshold = screen.getByLabelText("API 5xx 错误阈值")
    await user.clear(threshold)
    await user.type(threshold, "15")
    await user.click(screen.getByRole("button", { name: "保存 API 5xx 错误规则" }))

    await waitFor(() => expect(updateOperationsAlertRule).toHaveBeenCalledWith(rule.id, {
      name: rule.name,
      threshold: 15,
      windowSeconds: 300,
      enabled: true,
      expectedRevision: 1,
    }, "csrf-token"))
    expect(await screen.findByText("API 5xx 错误规则已保存")).toBeInTheDocument()
  })

  it("acknowledges open alerts and exposes an empty state", async () => {
    const user = userEvent.setup()
    vi.mocked(acknowledgeOperationsAlert).mockResolvedValue({
      ...alert,
      status: "acknowledged",
      acknowledgedBy: { id: "019fc900-0000-7000-8000-000000000703", username: "owner", displayName: "Owner", avatarUrl: null },
      acknowledgedAt: "2026-08-11T10:05:00Z",
    })
    render(<OperationsAdminPanel csrfToken="csrf-token" />)

    await user.click(await screen.findByRole("button", { name: "待确认告警" }))
    await user.click(await screen.findByRole("button", { name: "确认 API 5xx 错误告警" }))
    await waitFor(() => expect(acknowledgeOperationsAlert).toHaveBeenCalledWith(alert.id, "csrf-token"))
    expect(await screen.findByText("当前没有待确认的运营告警")).toBeInTheDocument()
  })

  it("renders an operations.read-only role without mutation controls", async () => {
    const user = userEvent.setup()
    render(<OperationsAdminPanel csrfToken="csrf-token" canWrite={false} />)

    expect(await screen.findByText("只读权限")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "告警规则" }))
    expect(screen.queryByRole("button", { name: "编辑 API 5xx 错误规则" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("API 5xx 错误阈值")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "保存 API 5xx 错误规则" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "确认 API 5xx 错误告警" })).not.toBeInTheDocument()
    expect(updateOperationsAlertRule).not.toHaveBeenCalled()
    expect(acknowledgeOperationsAlert).not.toHaveBeenCalled()
  })

  it("shows capability denial without rendering stale health", async () => {
    vi.mocked(getOperationsSummary).mockRejectedValueOnce(new AdminApiError(403, "admin.forbidden", "forbidden"))
    render(<OperationsAdminPanel csrfToken="csrf-token" />)

    expect(await screen.findByRole("alert")).toHaveTextContent("当前账号没有查看运营监控的权限")
    expect(screen.queryByText("数据库正常")).not.toBeInTheDocument()
  })

  it("refreshes rule state after an optimistic conflict", async () => {
    const user = userEvent.setup()
    vi.mocked(updateOperationsAlertRule).mockRejectedValueOnce(new AdminApiError(409, "operations.rule_conflict", "conflict"))
    vi.mocked(listOperationsAlertRules).mockResolvedValueOnce([rule]).mockResolvedValueOnce([{ ...rule, threshold: 20, revision: 2 }])
    render(<OperationsAdminPanel csrfToken="csrf-token" />)

    await user.click(await screen.findByRole("button", { name: "告警规则" }))
    await user.click(screen.getByRole("button", { name: "编辑 API 5xx 错误规则" }))
    await user.click(await screen.findByRole("button", { name: "保存 API 5xx 错误规则" }))
    expect(await screen.findByText("规则已被其他管理员修改，已刷新最新数据。")).toBeInTheDocument()
    await waitFor(() => expect(listOperationsAlertRules).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText("API 5xx 错误阈值")).toHaveValue(20)
  })
})
