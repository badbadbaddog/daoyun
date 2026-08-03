import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { App } from "./App"

afterEach(cleanup)

describe("DaoYun community home", () => {
  it("renders the community identity and primary feed", () => {
    render(<App />)

    expect(screen.getByRole("link", { name: "刀云首页" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "社区动态" })).toBeInTheDocument()
    expect(within(screen.getByRole("main")).getByText("用 Rust 构建社区平台，我们为什么选择模块化单体"))
      .toBeInTheDocument()
  })

  it("filters topics from the header search", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByRole("searchbox", { name: "搜索社区内容" }), "编辑器")

    const main = within(screen.getByRole("main"))
    expect(main.getByText("富文本编辑器的协作草稿方案已经开放讨论"))
      .toBeInTheDocument()
    expect(main.queryByText("用 Rust 构建社区平台，我们为什么选择模块化单体"))
      .not.toBeInTheDocument()
  })

  it("switches to the featured topic feed", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole("tab", { name: "精华" }))

    const main = within(screen.getByRole("main"))
    expect(main.getByText("刀云设计系统：让品牌配置保持克制而有辨识度"))
      .toBeInTheDocument()
    expect(main.queryByText("新成员报到：正在搭建我的独立摄影社区"))
      .not.toBeInTheDocument()
  })

  it("opens and closes the topic composer", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole("button", { name: "发布主题" }))
    expect(screen.getByRole("dialog", { name: "发布新主题" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "关闭发布窗口" }))
    expect(screen.queryByRole("dialog", { name: "发布新主题" })).not.toBeInTheDocument()
  })
})
