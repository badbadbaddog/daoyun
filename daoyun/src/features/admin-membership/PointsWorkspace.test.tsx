import { cleanup, render, screen } from "@testing-library/react"
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
