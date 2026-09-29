import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"

import { Drawer } from "./Drawer"

afterEach(() => cleanup())

function DrawerHarness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开设置</button>
      {open && (
        <Drawer title="版块设置" description="编辑版块" busy={busy} onClose={() => setOpen(false)}>
          <label>
            <span>版块名称</span>
            <input aria-label="版块名称" />
          </label>
          <button type="button">保存设置</button>
        </Drawer>
      )}
    </>
  )
}

describe("Drawer", () => {
  it("moves focus into the drawer and restores the opener after Escape", async () => {
    const user = userEvent.setup()
    render(<DrawerHarness />)

    const opener = screen.getByRole("button", { name: "打开设置" })
    await user.click(opener)

    expect(screen.getByRole("dialog", { name: "版块设置" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭抽屉" })).toHaveFocus())

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it("traps Tab navigation inside the drawer", async () => {
    const user = userEvent.setup()
    render(<DrawerHarness />)

    await user.click(screen.getByRole("button", { name: "打开设置" }))
    const close = screen.getByRole("button", { name: "关闭抽屉" })
    const save = screen.getByRole("button", { name: "保存设置" })

    save.focus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.keyboard("{Shift>}{Tab}{/Shift}")
    expect(save).toHaveFocus()
  })

  it("dismisses from the backdrop and restores the opener", async () => {
    const user = userEvent.setup()
    const view = render(<DrawerHarness />)

    const opener = screen.getByRole("button", { name: "打开设置" })
    await user.click(opener)
    const backdrop = view.container.querySelector(".drawer-backdrop")
    expect(backdrop).not.toBeNull()

    fireEvent.pointerDown(backdrop as Element)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it("does not dismiss a busy drawer with Escape or backdrop interaction", async () => {
    const user = userEvent.setup()
    const view = render(<DrawerHarness busy />)

    await user.click(screen.getByRole("button", { name: "打开设置" }))
    const dialog = screen.getByRole("dialog", { name: "版块设置" })
    const close = screen.getByRole("button", { name: "关闭抽屉" })
    expect(close).toBeDisabled()

    screen.getByLabelText("版块名称").focus()
    await user.keyboard("{Escape}")
    expect(dialog).toBeInTheDocument()

    const backdrop = view.container.querySelector(".drawer-backdrop")
    fireEvent.pointerDown(backdrop as Element)
    expect(screen.getByRole("dialog", { name: "版块设置" })).toBeInTheDocument()
  })
})

it("keeps keyboard focus inside when a completed action removes its focused button", async () => {
  const user = userEvent.setup()
  const close = vi.fn()
  const view = render(<Drawer title="测试详情" onClose={close}><button>提交处理</button></Drawer>)
  await user.click(screen.getByRole("button", { name: "提交处理" }))
  view.rerender(<Drawer title="测试详情" onClose={close}><p>处理完成</p></Drawer>)
  expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement)
  await user.keyboard("{Escape}")
  expect(close).toHaveBeenCalledOnce()
})
