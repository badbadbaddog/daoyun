import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { App } from "./App"
import { listBoards } from "./api/boards"
import type { Board } from "./types/community"

vi.mock("./api/boards", () => ({
  listBoards: vi.fn(),
}))

const boardFixtures: Board[] = [
  {
    id: "019fc630-0000-7000-8000-000000000001",
    slug: "engineering",
    name: "工程实践",
    description: "Rust、架构与部署",
    icon: "code",
    tone: "green",
    topicCount: 12,
  },
]

beforeEach(() => {
  vi.mocked(listBoards).mockReset()
  vi.mocked(listBoards).mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

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

  it("restores the saved dark theme", () => {
    localStorage.setItem("daoyun-theme", "dark")

    render(<App />)

    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(screen.getByRole("button", { name: "切换浅色模式" })).toBeInTheDocument()
  })

  it("persists the selected theme", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole("button", { name: "切换深色模式" }))

    expect(localStorage.getItem("daoyun-theme")).toBe("dark")
  })

  it("focuses search with the platform search shortcut", () => {
    render(<App />)

    fireEvent.keyDown(window, { key: "k", ctrlKey: true })

    expect(screen.getByRole("searchbox", { name: "搜索社区内容" })).toHaveFocus()
  })

  it("renders boards loaded from the public API", async () => {
    vi.mocked(listBoards).mockResolvedValue(boardFixtures)

    render(<App />)

    const boardNavigation = screen.getByRole("navigation", { name: "社区板块" })
    expect(await within(boardNavigation).findByText("工程实践")).toBeInTheDocument()
    expect(within(boardNavigation).getByText("12")).toBeInTheDocument()
  })

  it("shows board loading and empty states", async () => {
    const pendingRequest = new Promise<Board[]>(() => {})
    vi.mocked(listBoards).mockReturnValueOnce(pendingRequest).mockResolvedValueOnce([])

    const { rerender } = render(<App />)

    expect(screen.getByRole("status")).toHaveTextContent("正在加载板块")

    rerender(<App key="empty-boards" />)

    expect(await screen.findByText("暂无公开板块")).toHaveAttribute("role", "status")
  })

  it("retries the board request after a loading failure", async () => {
    const user = userEvent.setup()
    vi.mocked(listBoards)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(boardFixtures)

    render(<App />)

    expect(await screen.findByRole("alert")).toHaveTextContent("板块加载失败")
    await user.click(screen.getByRole("button", { name: "重试加载板块" }))

    const boardNavigation = screen.getByRole("navigation", { name: "社区板块" })
    expect(await within(boardNavigation).findByText("工程实践")).toBeInTheDocument()
    expect(listBoards).toHaveBeenCalledTimes(2)
  })
})
