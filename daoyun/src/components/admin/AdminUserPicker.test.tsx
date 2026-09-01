import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AdminReasonField } from "./AdminReasonField"
import { AdminUserPicker } from "./AdminUserPicker"
import { RevisionConflictNotice } from "./RevisionConflictNotice"

afterEach(cleanup)

describe("admin membership shared controls", () => {
  it("selects a user by readable identity without requiring a UUID", async () => {
    const onQueryChange = vi.fn()
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<AdminUserPicker query="" users={[{ id: "019fc800-0000-7000-8000-000000000101", username: "lin", displayName: "林小云", avatarUrl: null, status: "active" }]} selectedUser={null} loading={false} onQueryChange={onQueryChange} onSelect={onSelect} />)

    await user.type(screen.getByRole("searchbox", { name: "搜索用户" }), "林小云")
    expect(onQueryChange).toHaveBeenLastCalledWith("林小云")
    await user.click(screen.getByRole("button", { name: /选择林小云/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ username: "lin" }))
  })

  it("maps an operator-facing reason label to a stable reason code", async () => {
    const onReasonChange = vi.fn()
    const user = userEvent.setup()
    render(<AdminReasonField reason="" details="" onReasonChange={onReasonChange} onDetailsChange={vi.fn()} />)
    await user.selectOptions(screen.getByRole("combobox", { name: "运营原因" }), "operations.community_reward")
    expect(onReasonChange).toHaveBeenCalledWith("operations.community_reward")
    expect(screen.queryByRole("textbox", { name: "运营原因代码" })).not.toBeInTheDocument()
  })

  it("offers a recoverable refresh action after a revision conflict", async () => {
    const onRefresh = vi.fn()
    render(<RevisionConflictNotice onRefresh={onRefresh} />)
    await userEvent.click(screen.getByRole("button", { name: "刷新最新数据" }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })
})
