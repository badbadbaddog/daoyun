import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AdminApiError,
  createAdminBoard,
  deleteAdminBoard,
  getAdminBoardMergeImpact,
  getAdminBoardDeletionImpact,
  getAdminContentAccessPolicy,
  listAdminBoards,
  mergeAdminBoard,
  putAdminContentAccessPolicy,
  rollbackAdminBoardMerge,
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
    getAdminBoardMergeImpact: vi.fn(),
    getAdminBoardDeletionImpact: vi.fn(),
    getAdminContentAccessPolicy: vi.fn(),
    listAdminBoards: vi.fn(),
    mergeAdminBoard: vi.fn(),
    putAdminContentAccessPolicy: vi.fn(),
    rollbackAdminBoardMerge: vi.fn(),
    updateAdminBoard: vi.fn(),
  }
})

const rootId = "019fc900-0000-7000-8000-000000000101"
const childId = "019fc900-0000-7000-8000-000000000102"
const secondRootId = "019fc900-0000-7000-8000-000000000103"
const policyId = "019fc900-0000-7000-8000-000000000201"
const auditId = "019fc900-0000-7000-8000-000000000301"

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
  vi.mocked(getAdminContentAccessPolicy).mockResolvedValue({
    id: policyId,
    targetType: "board",
    targetId: rootId,
    operator: "any_of",
    subjects: [{ subjectType: "authenticated", communityGroupId: null, subjectKey: null }],
    revision: 7,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T00:00:00Z",
  })
  vi.mocked(putAdminContentAccessPolicy).mockImplementation(async (_targetType, targetId, input) => ({
    id: policyId,
    targetType: "board",
    targetId,
    operator: input.operator,
    subjects: input.subjects,
    revision: (input.expectedRevision ?? 0) + 1,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T01:00:00Z",
  }))
  vi.mocked(getAdminBoardMergeImpact).mockResolvedValue({
    sourceBoardId: rootId,
    targetBoardId: secondRootId,
    sourceRevision: 1,
    targetRevision: 3,
    topicCount: 12,
    replyCount: 34,
    childCount: 0,
    topicLimit: 5000,
    canMerge: true,
    blockedReason: null,
  })
  vi.mocked(mergeAdminBoard).mockResolvedValue({
    auditId,
    sourceBoardId: rootId,
    targetBoardId: secondRootId,
    movedTopicCount: 12,
    sourceRevision: 2,
    targetRevision: 4,
    rollbackDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    rolledBack: false,
    replayed: false,
  })
  vi.mocked(rollbackAdminBoardMerge).mockImplementation(async (_sourceBoardId, input) => ({
    auditId: input.auditId,
    sourceBoardId: rootId,
    targetBoardId: secondRootId,
    movedTopicCount: 12,
    sourceRevision: input.expectedSourceRevision + 1,
    targetRevision: input.expectedTargetRevision + 1,
    rollbackDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    rolledBack: true,
    replayed: false,
  }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("BoardAdminPanel", () => {
  it("lets a board without a dedicated access policy create one explicitly", async () => {
    const user = userEvent.setup()
    vi.mocked(getAdminContentAccessPolicy).mockRejectedValueOnce(new AdminApiError(404, "content.access_policy_not_found", "内容访问策略不存在", {}))
    renderPanel()
    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "访问策略" }))
    expect(await screen.findByLabelText("访问主体 1")).toHaveValue("authenticated")
    await user.click(screen.getByRole("button", { name: "保存访问策略" }))
    await waitFor(() => expect(putAdminContentAccessPolicy).toHaveBeenCalledWith("board", rootId, expect.objectContaining({ expectedRevision: undefined, subjects: [expect.objectContaining({ subjectType: "authenticated" })] }), "csrf"))
  })

  it("switches real settings sections without changing the route or losing the name draft", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "编辑设置" }))
    const hash = location.hash
    await user.clear(screen.getByLabelText("版块名称"))
    await user.type(screen.getByLabelText("版块名称"), "新版社区交流")
    await user.click(screen.getByRole("button", { name: "外观展示" }))
    expect(screen.queryByLabelText("版块名称")).not.toBeInTheDocument()
    expect(screen.getByLabelText("色调")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "访问权限" }))
    expect(await screen.findByLabelText("访问策略匹配方式")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "基本信息" }))
    expect(screen.getByLabelText("版块名称")).toHaveValue("新版社区交流")
    expect(location.hash).toBe(hash)
  })

  it("keeps each tree row compact and exposes secondary actions from one keyboard menu", async () => {
    const user = userEvent.setup()
    renderPanel()

    expect(screen.getByRole("button", { name: "新增子版块：社区交流" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "编辑版块：社区交流" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    expect(screen.getByRole("menuitem", { name: "编辑设置" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "访问策略" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "合并版块" })).toBeInTheDocument()
  })

  it("refreshes the editor revision after a conflict without discarding the local draft", async () => {
    const user = userEvent.setup()
    const refreshedBoards = boards.map((item) => item.id === rootId ? { ...item, name: "服务器名称", revision: 2 } : item)
    vi.mocked(updateAdminBoard).mockRejectedValueOnce(new AdminApiError(409, "admin.board_conflict", "版块已被其他管理员修改，请刷新后重试"))
    vi.mocked(listAdminBoards).mockResolvedValueOnce(refreshedBoards)
    renderPanel()

    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "编辑设置" }))
    expect(screen.getByRole("dialog", { name: "编辑“社区交流”" })).toBeInTheDocument()
    const name = screen.getByLabelText("版块名称")
    await user.clear(name)
    await user.type(name, "本地草稿名称")
    await user.click(screen.getByRole("button", { name: "保存版块" }))

    expect(await screen.findByText("数据已被其他管理员更新")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "刷新最新数据" }))
    await waitFor(() => expect(screen.queryByText("数据已被其他管理员更新")).not.toBeInTheDocument())
    expect(name).toHaveValue("本地草稿名称")

    await user.click(screen.getByRole("button", { name: "保存版块" }))
    expect(updateAdminBoard).toHaveBeenLastCalledWith(rootId, expect.objectContaining({
      name: "本地草稿名称",
      expectedRevision: 2,
    }), "csrf")
  })

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

    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "下移" }))
    expect(updateAdminBoard).toHaveBeenLastCalledWith(rootId, expect.objectContaining({
      parentId: null,
      position: 1,
      expectedRevision: 1,
    }), "csrf")

    await screen.findByText("社区交流下移已保存")
    await user.click(screen.getByRole("button", { name: "更多操作：站务反馈" }))
    await user.click(screen.getByRole("menuitem", { name: "移入上一个同级版块" }))
    expect(updateAdminBoard).toHaveBeenLastCalledWith(secondRootId, expect.objectContaining({
      parentId: rootId,
      position: 1,
      expectedRevision: 3,
    }), "csrf")

    await screen.findByText("站务反馈移入社区交流已保存")
    await user.click(screen.getByRole("button", { name: "更多操作：新人报到" }))
    await user.click(screen.getByRole("menuitem", { name: "设为隐藏" }))
    expect(updateAdminBoard).toHaveBeenLastCalledWith(childId, expect.objectContaining({
      visibility: "hidden",
      expectedRevision: 1,
    }), "csrf")
    expect(await screen.findByText("新人报到设为隐藏已保存")).toBeInTheDocument()
    expect(listAdminBoards).toHaveBeenCalledTimes(3)
  })

  it("locks hierarchy moves while search results hide siblings", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByRole("searchbox", { name: "搜索版块" }), "站务")

    await user.click(screen.getByRole("button", { name: "更多操作：站务反馈" }))
    expect(screen.getByRole("menuitem", { name: "上移（搜索时不可调整）" })).toBeDisabled()
    expect(screen.getByRole("menuitem", { name: "下移（搜索时不可调整）" })).toBeDisabled()
    expect(screen.getByRole("menuitem", { name: "移入上一个同级版块（搜索时不可调整）" })).toBeDisabled()
  })

  it("shows deletion impact and blocks a parent board with children", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "删除版块" }))
    expect(await screen.findByRole("heading", { name: "删除“社区交流”" })).toBeInTheDocument()
    expect(getAdminBoardDeletionImpact).toHaveBeenCalledWith(rootId)
    expect(screen.getByText("1 个子版块")).toBeInTheDocument()
    expect(screen.getAllByText("12 个主题").length).toBeGreaterThan(1)
    expect(screen.getByText("34 条回复")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "确认删除版块" })).toBeDisabled()
  })

  it("keeps deletion modal while impact is loading, then dismisses from the backdrop and restores the source trigger", async () => {
    const user = userEvent.setup()
    let resolveImpact!: (value: { boardId: string; childCount: number; topicCount: number; replyCount: number; canDelete: boolean }) => void
    vi.mocked(getAdminBoardDeletionImpact).mockImplementationOnce(() => new Promise((resolve) => { resolveImpact = resolve }))
    renderPanel()

    const trigger = screen.getByRole("button", { name: "更多操作：社区交流" })
    await user.click(trigger)
    await user.click(screen.getByRole("menuitem", { name: "删除版块" }))

    const dialog = await screen.findByRole("dialog", { name: "删除“社区交流”" })
    const close = screen.getByRole("button", { name: "关闭删除确认" })
    expect(dialog).toHaveAttribute("aria-busy", "true")
    expect(close).toBeDisabled()
    expect(dialog).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog", { name: "删除“社区交流”" })).toBeInTheDocument()
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(screen.getByRole("dialog", { name: "删除“社区交流”" })).toBeInTheDocument()

    await act(async () => {
      resolveImpact({ boardId: rootId, childCount: 1, topicCount: 12, replyCount: 34, canDelete: false })
      await Promise.resolve()
    })
    await waitFor(() => expect(close).toBeEnabled())
    expect(dialog).toHaveAttribute("aria-busy", "false")

    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole("dialog", { name: "删除“社区交流”" })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("loads, edits, and saves the access policy with its expected revision", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "访问策略" }))

    expect(await screen.findByLabelText("访问策略匹配方式")).toHaveValue("any_of")
    expect(getAdminContentAccessPolicy).toHaveBeenCalledWith("board", rootId)
    await user.selectOptions(screen.getByLabelText("访问策略匹配方式"), "all_of")
    await user.click(screen.getByRole("button", { name: "保存访问策略" }))

    expect(putAdminContentAccessPolicy).toHaveBeenCalledWith("board", rootId, {
      operator: "all_of",
      subjects: [{ subjectType: "authenticated", communityGroupId: null, subjectKey: null }],
      expectedRevision: 7,
    }, "csrf")
    expect(await screen.findByText("访问策略已保存")).toBeInTheDocument()
  })

  it("keeps the access policy editor open and displays revision conflicts", async () => {
    const user = userEvent.setup()
    vi.mocked(putAdminContentAccessPolicy).mockRejectedValueOnce(new AdminApiError(409, "admin.content_access_policy_conflict", "访问策略已被其他管理员修改"))
    renderPanel()

    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "访问策略" }))
    await screen.findByLabelText("访问策略匹配方式")
    await user.click(screen.getByRole("button", { name: "保存访问策略" }))

    expect(await screen.findByText("数据已被其他管理员更新")).toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: "编辑“社区交流”" })).toBeInTheDocument()
  })

  it("traps merge focus, closes with Escape, and restores the source action menu trigger", async () => {
    const user = userEvent.setup()
    renderPanel()

    const trigger = screen.getByRole("button", { name: "更多操作：社区交流" })
    await user.click(trigger)
    await user.click(screen.getByRole("menuitem", { name: "合并版块" }))

    const dialog = await screen.findByRole("dialog", { name: "合并“社区交流”" })
    const close = screen.getByRole("button", { name: "关闭合并确认" })
    const target = screen.getByLabelText("目标版块")
    expect(close).toHaveFocus()

    await user.tab({ shift: true })
    expect(target).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog", { name: "合并“社区交流”" })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(dialog).not.toBeInTheDocument()
  })

  it("previews a merge target, executes the merge, and rolls it back within 24 hours", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "合并版块" }))
    await user.selectOptions(screen.getByLabelText("目标版块"), secondRootId)

    expect(await screen.findByText("34 条回复")).toBeInTheDocument()
    expect(getAdminBoardMergeImpact).toHaveBeenCalledWith(rootId, secondRootId)
    await user.click(screen.getByRole("button", { name: "确认合并版块" }))

    expect(mergeAdminBoard).toHaveBeenCalledWith(rootId, {
      targetBoardId: secondRootId,
      expectedSourceRevision: 1,
      expectedTargetRevision: 3,
      idempotencyKey: expect.any(String),
    }, "csrf")
    expect(await screen.findByText(auditId)).toBeInTheDocument()
    expect(screen.getByText(/回滚截止/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "24 小时内回滚合并" }))

    expect(rollbackAdminBoardMerge).toHaveBeenCalledWith(rootId, {
      auditId,
      expectedSourceRevision: 2,
      expectedTargetRevision: 4,
      idempotencyKey: expect.any(String),
    }, "csrf")
    expect(await screen.findByText("合并已回滚")).toBeInTheDocument()
  })

  it("synchronously blocks duplicate merge execution while the first request is pending", async () => {
    const user = userEvent.setup()
    let resolveMerge!: (value: Awaited<ReturnType<typeof mergeAdminBoard>>) => void
    vi.mocked(mergeAdminBoard).mockImplementationOnce(() => new Promise((resolve) => { resolveMerge = resolve }))
    renderPanel()

    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "合并版块" }))
    await user.selectOptions(screen.getByLabelText("目标版块"), secondRootId)
    await screen.findByText("34 条回复")
    const confirm = screen.getByRole("button", { name: "确认合并版块" })

    act(() => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(mergeAdminBoard).toHaveBeenCalledTimes(1)
    expect(confirm).toBeDisabled()
    resolveMerge({
      auditId,
      sourceBoardId: rootId,
      targetBoardId: secondRootId,
      movedTopicCount: 12,
      sourceRevision: 2,
      targetRevision: 4,
      rollbackDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      rolledBack: false,
      replayed: false,
    })
    expect(await screen.findByText(auditId)).toBeInTheDocument()
  })

  it("shows the merge blocked reason and prevents execution", async () => {
    const user = userEvent.setup()
    vi.mocked(getAdminBoardMergeImpact).mockResolvedValueOnce({
      sourceBoardId: rootId,
      targetBoardId: secondRootId,
      sourceRevision: 1,
      targetRevision: 3,
      topicCount: 12,
      replyCount: 34,
      childCount: 1,
      topicLimit: 5000,
      canMerge: false,
      blockedReason: "source_has_children",
    })
    renderPanel()

    await user.click(screen.getByRole("button", { name: "更多操作：社区交流" }))
    await user.click(screen.getByRole("menuitem", { name: "合并版块" }))
    await user.selectOptions(screen.getByLabelText("目标版块"), secondRootId)

    expect(await screen.findByText("源版块仍有子版块，请先迁移子版块。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "确认合并版块" })).toBeDisabled()
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
    status: "open",
    mergedIntoBoardId: null,
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
