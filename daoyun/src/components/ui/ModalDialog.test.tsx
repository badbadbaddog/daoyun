import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ModalDialog } from "./ModalDialog"

afterEach(cleanup)

describe("ModalDialog", () => {
  it("focuses the requested field, traps Tab, closes with Escape, and restores focus", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<Harness open onClose={onClose} />)
    const trigger = screen.getByRole("button", { name: "打开" })
    trigger.focus()
    rerender(<Harness open={false} onClose={onClose} />)
    rerender(<Harness open onClose={onClose} returnFocus={trigger} />)

    const field = await screen.findByLabelText("名称")
    const cancel = screen.getByRole("button", { name: "取消" })
    await waitFor(() => expect(field).toHaveFocus())
    await user.tab({ shift: true })
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(field).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<Harness open={false} onClose={onClose} returnFocus={trigger} />)
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("locks Escape and backdrop dismissal while busy", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness open busy onClose={onClose} />)

    const dialog = await screen.findByRole("dialog", { name: "测试弹窗" })
    await user.keyboard("{Escape}")
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog).toHaveAttribute("aria-busy", "true")
  })

  it("dismisses from a direct backdrop click when idle", () => {
    const onClose = vi.fn()
    render(<Harness open onClose={onClose} />)
    const dialog = screen.getByRole("dialog", { name: "测试弹窗" })
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

function Harness({ open, busy = false, onClose, returnFocus = null }: { open: boolean; busy?: boolean; onClose: () => void; returnFocus?: HTMLElement | null }) {
  return <>
    <button type="button">打开</button>
    {open && <ModalDialog titleId="modal-test-title" busy={busy} returnFocus={returnFocus} onClose={onClose} initialFocusSelector="input">
      <h2 id="modal-test-title">测试弹窗</h2>
      <label>名称<input aria-label="名称" /></label>
      <button type="button">取消</button>
    </ModalDialog>}
  </>
}
