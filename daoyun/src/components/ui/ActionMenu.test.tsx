import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionMenu } from "./ActionMenu"

afterEach(() => cleanup())

describe("ActionMenu", () => {
  it("opens from the trigger and focuses the first enabled menu item", async () => {
    const user = userEvent.setup()
    render(
      <ActionMenu
        label="更多操作：测试版块"
        items={[
          { label: "不可用", disabled: true, onSelect: vi.fn() },
          { label: "编辑设置", onSelect: vi.fn() },
          { label: "删除版块", danger: true, onSelect: vi.fn() },
        ]}
      />,
    )

    const trigger = screen.getByRole("button", { name: "更多操作：测试版块" })
    await user.click(trigger)

    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("menu", { name: "更多操作：测试版块" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "编辑设置" })).toHaveFocus())
  })

  it("supports trigger arrows, roving keys, and restores trigger focus on Escape", async () => {
    const user = userEvent.setup()
    render(
      <ActionMenu
        label="更多操作：测试版块"
        items={[
          { label: "编辑设置", onSelect: vi.fn() },
          { label: "设为隐藏", onSelect: vi.fn() },
          { label: "删除版块", onSelect: vi.fn() },
        ]}
      />,
    )

    const trigger = screen.getByRole("button", { name: "更多操作：测试版块" })
    trigger.focus()
    await user.keyboard("{ArrowDown}")
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "编辑设置" })).toHaveFocus())

    await user.keyboard("{End}")
    expect(screen.getByRole("menuitem", { name: "删除版块" })).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("menuitem", { name: "编辑设置" })).toHaveFocus()
    await user.keyboard("{ArrowUp}")
    expect(screen.getByRole("menuitem", { name: "删除版块" })).toHaveFocus()
    await user.keyboard("{Home}")
    expect(screen.getByRole("menuitem", { name: "编辑设置" })).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.keyboard("{ArrowUp}")
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "删除版块" })).toHaveFocus())
  })

  it("closes after selection and restores focus when the trigger still exists", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ActionMenu label="更多操作：测试版块" items={[{ label: "编辑设置", onSelect }]} />)

    const trigger = screen.getByRole("button", { name: "更多操作：测试版块" })
    await user.click(trigger)
    await user.click(await screen.findByRole("menuitem", { name: "编辑设置" }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("dismisses on an outside pointer without stealing pointer focus", async () => {
    const user = userEvent.setup()
    render(
      <div>
        <ActionMenu label="更多操作：测试版块" items={[{ label: "编辑设置", onSelect: vi.fn() }]} />
        <button type="button">页面其他操作</button>
      </div>,
    )

    const trigger = screen.getByRole("button", { name: "更多操作：测试版块" })
    await user.click(trigger)
    expect(screen.getByRole("menu")).toBeInTheDocument()

    const outside = screen.getByRole("button", { name: "页面其他操作" })
    outside.focus()
    fireEvent.pointerDown(outside)

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(outside).toHaveFocus()
  })
})
