import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PointsWorkspace } from "./PointsWorkspace"

afterEach(cleanup)

describe("PointsWorkspace", () => {
  it("clears operation state when the selected user changes and creates idempotency automatically", async () => {
    const onGrant = vi.fn().mockResolvedValue({ balance: 80, auditId: "audit-1" })
    const first = { id: "user-1", username: "first", displayName: "第一位", avatarUrl: null, status: "active" as const }
    const second = { id: "user-2", username: "second", displayName: "第二位", avatarUrl: null, status: "active" as const }
    const { rerender } = render(<PointsWorkspace selectedUser={first} balance={50} onGrant={onGrant} />)
    const user = userEvent.setup()
    await user.type(screen.getByRole("spinbutton", { name: "积分数量" }), "30")
    await user.selectOptions(screen.getByRole("combobox", { name: "运营原因" }), "operations.community_reward")
    rerender(<PointsWorkspace selectedUser={second} balance={10} onGrant={onGrant} />)
    expect(screen.getByRole("spinbutton", { name: "积分数量" })).toHaveValue(null)
    expect(screen.getByRole("combobox", { name: "运营原因" })).toHaveValue("")
  })
})

const member = { id: "user-1", username: "member", displayName: "会员", avatarUrl: null, status: "active" }

it("previews a deduction and prevents overdrawing the loaded balance", async () => {
  const onGrant = vi.fn().mockResolvedValue({ balance: 20 })
  const user = userEvent.setup()
  render(<PointsWorkspace selectedUser={member} balance={50} onGrant={onGrant} />)
  await user.selectOptions(screen.getByRole("combobox", { name: "操作类型" }), "deduct")
  await user.type(screen.getByLabelText("积分数量"), "30")
  await user.selectOptions(screen.getByLabelText("运营原因"), "operations.correction")
  expect(screen.getByRole("region", { name: "积分变更预览" })).toHaveTextContent("预计余额20")
  await user.click(screen.getByRole("button", { name: "确认积分操作" }))
  expect(onGrant).toHaveBeenCalledWith(expect.objectContaining({ amount: -30 }))
  await user.type(screen.getByLabelText("积分数量"), "60")
  await user.selectOptions(screen.getByLabelText("运营原因"), "operations.correction")
  await user.click(screen.getByRole("button", { name: "确认积分操作" }))
  expect(screen.getByRole("alert")).toHaveTextContent("余额不足")
  expect(onGrant).toHaveBeenCalledTimes(1)
})

it("retries the same operation safely and uses a new key after success", async () => {
  const onGrant = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ balance: 80 })
  const user = userEvent.setup()
  render(<PointsWorkspace selectedUser={member} balance={50} onGrant={onGrant} />)
  await user.type(screen.getByLabelText("积分数量"), "30")
  await user.selectOptions(screen.getByLabelText("运营原因"), "operations.community_reward")
  await user.click(screen.getByRole("button", { name: "确认积分操作" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("重试")
  await user.click(screen.getByRole("button", { name: "确认积分操作" }))
  await screen.findByText("积分操作完成")
  expect(onGrant.mock.calls[0][0].idempotencyKey).toBe(onGrant.mock.calls[1][0].idempotencyKey)
  expect(screen.getByLabelText("积分数量")).toHaveValue(null)
  await user.type(screen.getByLabelText("积分数量"), "30")
  await user.selectOptions(screen.getByLabelText("运营原因"), "operations.community_reward")
  await user.click(screen.getByRole("button", { name: "确认积分操作" }))
  expect(onGrant.mock.calls[2][0].idempotencyKey).not.toBe(onGrant.mock.calls[1][0].idempotencyKey)
})

it("blocks duplicate submissions and prevents operations while balance is unknown", async () => {
  let finish!: (value: { balance: number }) => void
  const onGrant = vi.fn(() => new Promise<{ balance: number }>(resolve => { finish = resolve }))
  const user = userEvent.setup()
  const { rerender } = render(<PointsWorkspace selectedUser={member} balance={null} onGrant={onGrant} />)
  expect(screen.getByRole("button", { name: "确认积分操作" })).toBeDisabled()
  rerender(<PointsWorkspace selectedUser={member} balance={50} onGrant={onGrant} />)
  await user.type(screen.getByLabelText("积分数量"), "30")
  await user.selectOptions(screen.getByLabelText("运营原因"), "operations.community_reward")
  const form = screen.getByLabelText("积分数量").closest("form")!
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  expect(onGrant).toHaveBeenCalledTimes(1)
  await act(async () => finish({ balance: 80 }))
  await waitFor(() => expect(screen.getByText("积分操作完成")).toBeInTheDocument())
})
