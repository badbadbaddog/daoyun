import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createAdminBoard,
  deleteAdminBoard,
  getAdminBoardDeletionImpact,
  listAdminBoards,
  updateAdminBoard,
  type AdminBoard,
} from "../api/admin"
import { BoardAdminPanel } from "./BoardAdminPanel"

vi.mock("../api/admin", async () => {
  const actual = await vi.importActual<typeof import("../api/admin")>("../api/admin")
  return {
    ...actual,
    createAdminBoard: vi.fn(),
    deleteAdminBoard: vi.fn(),
    getAdminBoardDeletionImpact: vi.fn(),
    listAdminBoards: vi.fn(),
    updateAdminBoard: vi.fn(),
  }
})

const rootId = "019fc900-0000-7000-8000-000000000101"
const childId = "019fc900-0000-7000-8000-000000000102"
const secondRootId = "019fc900-0000-7000-8000-000000000103"

const boards: AdminBoard[] = [
  board({ id: rootId, name: "社区交流", slug: "community", position: 0, topicCount: 12 }),
  board({ id: childId, parentId: rootId, name: "新人报到", slug: "introductions", position: 0 }),
  board({ id: secondRootId, name: "站务反馈", slug: "feedback", position: 1, revision: 3 }),
]

beforeEach(() => {
  vi.mocked(createAdminBoard).mockImplementation(async (input) => board({
    id: "019fc900-0000-7000-8000-000000000104",
    ...input,
  }))
  vi.mocked(updateAdminBoard).mockImplementation(async (id, input) => board({
    ...boards.find((item) => item.id === id),
    ...input,
    id,
    revision: input.expectedRevision + 1,
  }))
  vi.mocked(deleteAdminBoard).mockResolvedValue(true)
  vi.mocked(listAdminBoards).mockResolvedValue(boards)
  vi.mocked(getAdminBoardDeletionImpact).mockResolvedValue({
    boardId: rootId,
    childCount: 1,
    topicCount: 12,
    replyCount: 34,
    canDelete: false,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("BoardAdminPanel", () => {
  it("renders an accessible tree and keeps ancestors visible while searching", async () => {
    const user = userEvent.setup()
    renderPanel()

    expect(screen.getByRole("tree", { name: "版块层级" })).toBeInTheDocument()
    expect(screen.getByText("新人报到")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "收起版块：社区交流" }))
    expect(screen.queryByText("新人报到")).not.toBeInTheDocument()

    await user.type(screen.getByRole("searchbox", { name: "搜索版块" }), "新人")
    expect(screen.getByText("社区交流")).toBeInTheDocument()
    expect(screen.getByText("新人报到")).toBeInTheDocument()
  })

  it("creates a child board from the selected parent context", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole("button", { name: "新增子版块：社区交流" }))
    expect(screen.getByRole("heading", { name: "在“社区交流”下新增子版块" })).toBeInTheDocument()
    await user.type(screen.getByLabelText("版块名称"), "开发讨论")
    await user.type(screen.getByLabelText("版块 Slug"), "development")
    await user.click(screen.getByRole("button", { name: "创建子版块" }))

    expect(createAdminBoard).toHaveBeenCalledWith(expect.objectContaining({
      parentId: rootId,
      name: "开发讨论",
      slug: "development",
      position: 1,
    }), "csrf")
    expect(await screen.findByText("版块已创建")).toBeInTheDocument()
  })

  it("moves and changes visibility with one revision-protected action at a time", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole("button", { name: "下移版块：社区交流" }))
    expect(updateAdminBoard).toHaveBeenLastCalledWith(rootId, expect.objectContaining({
      parentId: null,
      position: 1,
      expectedRevision: 1,
    }), "csrf")

    await user.click(screen.getByRole("button", { name: "移入版块：站务反馈" }))
    expect(updateAdminBoard).toHaveBeenLastCalledWith(secondRootId, expect.objectContaining({
      parentId: rootId,
      position: 1,
      expectedRevision: 3,
    }), "csrf")

    await user.click(screen.getByRole("button", { name: "设为隐藏：新人报到" }))
    expect(updateAdminBoard).toHaveBeenLastCalledWith(childId, expect.objectContaining({
      visibility: "hidden",
      expectedRevision: 1,
    }), "csrf")
    expect(await screen.findByText("已保存")).toBeInTheDocument()
    expect(listAdminBoards).toHaveBeenCalledTimes(3)
  })

  it("locks hierarchy moves while search results hide siblings", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByRole("searchbox", { name: "搜索版块" }), "站务")

    expect(screen.getByRole("button", { name: "上移版块：站务反馈" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "下移版块：站务反馈" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "移入版块：站务反馈" })).toBeDisabled()
  })

  it("shows deletion impact and blocks a parent board with children", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole("button", { name: "删除版块：社区交流" }))
    expect(await screen.findByRole("heading", { name: "删除“社区交流”" })).toBeInTheDocument()
    expect(getAdminBoardDeletionImpact).toHaveBeenCalledWith(rootId)
    expect(screen.getByText("1 个子版块")).toBeInTheDocument()
    expect(screen.getByText("12 个主题")).toBeInTheDocument()
    expect(screen.getByText("34 条回复")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "确认删除版块" })).toBeDisabled()
  })

  it("does not render mutation controls for a read-only administrator", () => {
    render(<BoardAdminPanel boards={boards} csrfToken="csrf" canWrite={false} onChange={vi.fn()} />)

    expect(screen.getByRole("tree", { name: "版块层级" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新建顶级版块" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "编辑版块：社区交流" })).not.toBeInTheDocument()
  })
})

function renderPanel() {
  return render(<BoardAdminPanel boards={boards} csrfToken="csrf" canWrite onChange={vi.fn()} />)
}

function board(overrides: Partial<AdminBoard> & Pick<AdminBoard, "id" | "name" | "slug">): AdminBoard {
  const { id, name, slug, ...rest } = overrides
  return {
    id,
    parentId: null,
    slug,
    name,
    description: "",
    icon: "messages",
    tone: "green",
    position: 0,
    visibility: "public",
    topicCount: 0,
    revision: 1,
    ...rest,
  }
}
