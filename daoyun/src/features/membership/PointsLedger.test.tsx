import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { PointsLedger } from "./PointsLedger"

afterEach(cleanup)

it("shows exact ledger balances, operator, original request and full time", () => {
  render(<PointsLedger entries={[{ id: "ledger-1", delta: -30, balanceAfter: 20, reason: "运营调整", createdAt: "2026-10-03T04:05:06Z", actorUsername: "owner", actorDisplayName: "站长", operationRequestId: "request-original" }]} />)
  expect(screen.getByText("-30 积分")).toBeInTheDocument()
  expect(screen.getByText("50 → 20 积分")).toBeInTheDocument()
  expect(screen.getByText("站长 @owner")).toBeInTheDocument()
  expect(screen.getByText("request-original")).toBeInTheDocument()
  expect(screen.getByText("ledger-1")).toBeInTheDocument()
  expect(screen.getByText((_, element) => element?.tagName === "TIME")?.textContent).toMatch(/\d+:\d+/)
})

it("marks historical metadata as missing without inventing an operator or request", () => {
  render(<PointsLedger entries={[{ id: "legacy", delta: 10, balanceAfter: 10, reason: "历史奖励", createdAt: "2026-10-02T00:00:00Z" }]} />)
  expect(screen.getAllByText("未记录")).toHaveLength(2)
  expect(screen.getByText("0 → 10 积分")).toBeInTheDocument()
})

it("shows the empty ledger state", () => {
  render(<PointsLedger entries={[]} />)
  expect(screen.getByText("暂无积分流水")).toBeInTheDocument()
})
