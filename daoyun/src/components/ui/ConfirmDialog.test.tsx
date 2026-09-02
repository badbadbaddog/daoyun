import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConfirmDialog } from "./ConfirmDialog"

afterEach(cleanup)

describe("ConfirmDialog", () => {
  it("focuses the safe cancel action, closes with Escape, and restores the source focus", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const source = document.createElement("button")
    source.textContent = "来源操作"
    document.body.append(source)
    source.focus()

    const { unmount } = render(
      <ConfirmDialog title="删除角色" confirmLabel="确认删除" onConfirm={vi.fn()} onCancel={onCancel} returnFocus={source}>
        <p>删除后无法继续分配该角色。</p>
      </ConfirmDialog>,
    )

    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toHaveFocus())
    await user.keyboard("{Escape}")
    expect(onCancel).toHaveBeenCalledTimes(1)
    unmount()
    await waitFor(() => expect(source).toHaveFocus())
    source.remove()
  })

  it("traps focus between the cancel and confirm actions", async () => {
    const user = userEvent.setup()
    render(
      <ConfirmDialog title="卸载插件" confirmLabel="确认卸载" onConfirm={vi.fn()} onCancel={vi.fn()}>
        <p>卸载不会保留当前运行状态。</p>
      </ConfirmDialog>,
    )

    const cancel = screen.getByRole("button", { name: "取消" })
    const confirm = screen.getByRole("button", { name: "确认卸载" })
    await waitFor(() => expect(cancel).toHaveFocus())
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
  })

  it("locks dismissal and actions while busy", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog title="确认处置" confirmLabel="确认执行" busy onConfirm={onConfirm} onCancel={onCancel}>
        <p>正在写入审计记录。</p>
      </ConfirmDialog>,
    )

    const dialog = screen.getByRole("alertdialog", { name: "确认处置" })
    expect(dialog).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "确认执行" })).toBeDisabled()
    await user.keyboard("{Escape}")
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
