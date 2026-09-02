import userEvent from "@testing-library/user-event"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { governTopic, listModerationTopics, listTopicModerationHistory, moderateTopic, ModerationApiError } from "../api/moderation"
import { ModerationAdminPanel } from "./ModerationAdminPanel"

vi.mock("../api/moderation", async () => {
  const actual = await vi.importActual<typeof import("../api/moderation")>("../api/moderation")
  return { ...actual, governTopic: vi.fn(), listModerationTopics: vi.fn(), listTopicModerationHistory: vi.fn(), moderateTopic: vi.fn() }
})

const board = {
  id: "019fc900-0000-7000-8000-000000000101",
  slug: "general",
  name: "社区广场",
  tone: "green" as const,
  capabilityKeys: ["moderation.topic", "moderation.topic.pin"],
}
const targetBoard = {
  id: "019fc900-0000-7000-8000-000000000102",
  slug: "feedback",
  name: "产品反馈",
  tone: "blue" as const,
  capabilityKeys: ["moderation.topic", "moderation.topic.pin", "moderation.topic.feature", "moderation.topic.lock", "moderation.topic.move"],
}
const fullCapabilityBoard = {
  ...board,
  capabilityKeys: ["moderation.topic", "moderation.topic.pin", "moderation.topic.feature", "moderation.topic.lock", "moderation.topic.move"],
}
const topic = {
  id: "019fc900-0000-7000-8000-000000000201",
  title: "需要治理的主题",
  excerpt: "主题摘要",
  author: { id: "019fc900-0000-7000-8000-000000000301", username: "member", displayName: "成员", avatarUrl: null },
  board: { id: board.id, slug: board.slug, name: board.name, tone: board.tone },
  publishedAt: "2026-08-21T08:00:00Z",
  lastActivityAt: "2026-08-21T09:00:00Z",
  replyCount: 2,
  likeCount: 3,
  viewCount: 8,
  moderationStatus: "approved" as const,
  governanceRevision: 4,
  featured: false,
  pinned: false,
  locked: false,
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

async function openTopicActions(user: ReturnType<typeof userEvent.setup>, title = topic.title) {
  await user.click(await screen.findByRole("button", { name: `操作：${title}` }))
  return screen.getByRole("menu", { name: `主题操作：${title}` })
}

describe("ModerationAdminPanel", () => {
  it("announces the initial loading state", () => {
    vi.mocked(listModerationTopics).mockImplementation(() => new Promise(() => undefined))

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)

    expect(screen.getByRole("status")).toHaveTextContent("正在读取主题治理队列")
  })

  it("explains when the selected board has no governance permission", async () => {
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [], nextCursor: null })

    render(<ModerationAdminPanel boards={[{ ...board, capabilityKeys: [] }]} csrfToken="csrf-token" />)

    expect(await screen.findByText("当前账号没有主题治理权限")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "隐藏" })).not.toBeInTheDocument()
  })

  it("appends another page and keeps pagination retryable after a failure", async () => {
    const user = userEvent.setup()
    const secondTopic = { ...topic, id: "019fc900-0000-7000-8000-000000000202", title: "下一页主题" }
    vi.mocked(listModerationTopics)
      .mockResolvedValueOnce({ topics: [topic], nextCursor: "cursor-2" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ topics: [secondTopic], nextCursor: null })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)
    const loadMore = await screen.findByRole("button", { name: "加载更多" })
    await user.click(loadMore)

    expect(await screen.findByRole("alert")).toHaveTextContent("更多主题暂时无法加载")
    expect(loadMore).toBeEnabled()
    await user.click(loadMore)

    expect(await screen.findByText(secondTopic.title)).toBeInTheDocument()
    expect(listModerationTopics).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor-2", limit: 20 }))
  })

  it("renders the moderation queue as a structured topic list", async () => {
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)

    const table = await screen.findByRole("table", { name: "主题治理队列" })
    const rows = within(table).getAllByRole("row")
    expect(rows).toHaveLength(2)
    expect(within(rows[1]).getAllByRole("cell")).toHaveLength(10)
    const columnHeaders = screen.getByRole("row", { name: "主题治理字段" })
    expect(within(columnHeaders).getByText("所属板块")).toBeInTheDocument()
    expect(within(columnHeaders).getByText("发布时间")).toBeInTheDocument()
    expect(within(columnHeaders).getByText("主题标题 / 内容摘要")).toBeInTheDocument()
    expect(within(columnHeaders).getByText("作者（昵称 / 用户名）")).toBeInTheDocument()
    expect(within(columnHeaders).getByText("回复数")).toBeInTheDocument()
    expect(within(columnHeaders).getByText("点赞数")).toBeInTheDocument()
    expect(within(columnHeaders).getByText("浏览数")).toBeInTheDocument()
    expect(within(columnHeaders).getByText("审核状态")).toBeInTheDocument()
    expect(within(columnHeaders).getByText("治理状态")).toBeInTheDocument()
    expect(within(columnHeaders).getByText("操作")).toBeInTheDocument()
  })

  it("keeps body-only topics readable and actionable when the title is empty", async () => {
    const user = userEvent.setup()
    const bodyOnlyTopic = { ...topic, title: "", excerpt: "只有正文也应该能在治理列表中正常处理" }
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [bodyOnlyTopic], nextCursor: null })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)

    expect(await screen.findByRole("heading", { name: bodyOnlyTopic.excerpt })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: `操作：${bodyOnlyTopic.excerpt}` }))
    expect(screen.getByRole("menu", { name: `主题操作：${bodyOnlyTopic.excerpt}` })).toBeInTheDocument()
  })

  it("keeps the title, board switcher, search and scope note in one workbench toolbar", async () => {
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)

    const workbench = screen.getByRole("group", { name: "主题治理工具栏" })
    expect(within(workbench).getByRole("heading", { name: "主题治理工作台" })).toBeInTheDocument()
    expect(within(workbench).getByRole("combobox", { name: "治理板块" })).toBeInTheDocument()
    expect(within(workbench).getByRole("textbox", { name: "搜索主题" })).toBeInTheDocument()
    expect(within(workbench).getByText(/仅显示当前账号有权治理/)).toBeInTheDocument()
  })

  it("uses the reference workspace with a side filter rail and one row action menu", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })

    render(<ModerationAdminPanel boards={[fullCapabilityBoard, targetBoard]} csrfToken="csrf-token" canReadAudit />)

    const sideRail = await screen.findByRole("complementary", { name: "主题治理筛选与反馈" })
    expect(within(sideRail).getByRole("group", { name: "审核状态筛选" })).toBeInTheDocument()
    expect(within(sideRail).getByRole("group", { name: "治理状态筛选" })).toBeInTheDocument()
    expect(within(sideRail).getByRole("region", { name: "近期反馈" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "隐藏" })).not.toBeInTheDocument()

    const menu = await openTopicActions(user)

    expect(within(menu).getByRole("button", { name: "隐藏" })).toBeEnabled()
    expect(within(menu).getByRole("button", { name: "移动" })).toBeEnabled()
    expect(within(menu).getByRole("button", { name: "处理记录" })).toBeEnabled()
  })

  it("shows only scoped actions and removes a published topic after hiding it", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(moderateTopic).mockResolvedValue({ topicId: topic.id, status: "hidden" })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)

    expect(await screen.findByRole("heading", { name: "主题治理工作台" })).toBeInTheDocument()
    expect(screen.getByText(topic.title)).toBeInTheDocument()
    const menu = await openTopicActions(user)
    expect(within(menu).getByRole("button", { name: "隐藏" })).toBeInTheDocument()
    expect(within(menu).getByRole("button", { name: "置顶" })).toBeInTheDocument()
    expect(within(menu).queryByRole("button", { name: "精选" })).not.toBeInTheDocument()
    expect(within(menu).queryByRole("button", { name: "锁定" })).not.toBeInTheDocument()

    await user.click(within(menu).getByRole("button", { name: "隐藏" }))
    await user.type(screen.getByRole("textbox", { name: "处理备注" }), "违反板块规则")
    await user.click(screen.getByRole("button", { name: "确认隐藏主题" }))

    expect(moderateTopic).toHaveBeenCalledWith(topic.id, { status: "hidden", reason: "违反板块规则" }, "csrf-token")
    expect(await screen.findByText("主题已隐藏。")).toBeInTheDocument()
    expect(screen.queryByText(topic.title)).not.toBeInTheDocument()
  })

  it("updates governance state with the topic revision", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(governTopic).mockResolvedValue({ topicId: topic.id, boardId: board.id, isPinned: true, isFeatured: false, isLocked: false, governanceRevision: 5 })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)
    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "置顶" }))
    await user.click(screen.getByRole("button", { name: "确认置顶主题" }))

    expect(governTopic).toHaveBeenCalledWith(topic.id, { action: "pin", expectedRevision: 4, reason: undefined, targetBoardId: undefined }, "csrf-token")
    expect(within(screen.getByRole("table", { name: "主题治理队列" })).getByText("已置顶")).toBeInTheDocument()
  })

  it("renders the complete capability matrix without disabled placeholder actions", async () => {
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })

    render(<ModerationAdminPanel boards={[fullCapabilityBoard, targetBoard]} csrfToken="csrf-token" canReadAudit />)
    await screen.findByText(topic.title)

    const menu = await openTopicActions(userEvent.setup())
    for (const action of ["隐藏", "驳回", "置顶", "精选", "锁定", "移动", "处理记录"]) {
      expect(within(menu).getByRole("button", { name: action })).toBeEnabled()
    }
  })

  it("moves a topic to another governed board and removes it from the current queue", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(governTopic).mockResolvedValue({ topicId: topic.id, boardId: targetBoard.id, isPinned: false, isFeatured: false, isLocked: false, governanceRevision: 5 })

    render(<ModerationAdminPanel boards={[fullCapabilityBoard, targetBoard]} csrfToken="csrf-token" />)
    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "移动" }))

    expect(screen.getByRole("combobox", { name: "目标板块" })).toHaveValue(targetBoard.id)
    await user.type(screen.getByRole("textbox", { name: "处理备注" }), "移动到反馈板块")
    await user.click(screen.getByRole("button", { name: "确认移动主题" }))

    expect(governTopic).toHaveBeenCalledWith(topic.id, {
      action: "move",
      expectedRevision: topic.governanceRevision,
      reason: "移动到反馈板块",
      targetBoardId: targetBoard.id,
    }, "csrf-token")
    expect(await screen.findByText("主题已移动到目标板块。")).toBeInTheDocument()
    expect(screen.queryByText(topic.title)).not.toBeInTheDocument()
  })

  it("keeps a failed moderation action in the dialog with retry feedback", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(moderateTopic).mockRejectedValue(new Error("offline"))

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)
    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "隐藏" }))
    await user.type(screen.getByRole("textbox", { name: "处理备注" }), "内容异常")
    await user.click(screen.getByRole("button", { name: "确认隐藏主题" }))

    const dialog = screen.getByRole("dialog", { name: "隐藏主题" })
    expect(within(dialog).getByRole("alert")).toHaveTextContent("主题操作失败，请刷新后重试")
    expect(within(dialog).getByRole("textbox", { name: "处理备注" })).toHaveValue("内容异常")
  })

  it("submits a governance intent only once while the request is pending", async () => {
    const user = userEvent.setup()
    let finishRequest!: () => void
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(governTopic).mockImplementation(() => new Promise((resolve) => {
      finishRequest = () => resolve({ topicId: topic.id, boardId: board.id, isPinned: true, isFeatured: false, isLocked: false, governanceRevision: 5 })
    }))

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)
    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "置顶" }))
    const dialog = screen.getByRole("dialog", { name: "置顶主题" })

    fireEvent.submit(dialog)
    fireEvent.submit(dialog)

    expect(governTopic).toHaveBeenCalledTimes(1)
    finishRequest()
    expect(await screen.findByText("主题已置顶。")).toBeInTheDocument()
  })

  it("locks every dialog control while an action is submitting", async () => {
    const user = userEvent.setup()
    let finishRequest!: () => void
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(moderateTopic).mockImplementation(() => new Promise((resolve) => {
      finishRequest = () => resolve({ topicId: topic.id, status: "hidden" })
    }))

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)
    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "隐藏" }))
    await user.type(screen.getByRole("textbox", { name: "处理备注" }), "内容异常")
    await user.click(screen.getByRole("button", { name: "确认隐藏主题" }))

    const dialog = screen.getByRole("dialog", { name: "隐藏主题" })
    expect(dialog).toHaveAttribute("aria-busy", "true")
    expect(within(dialog).getByRole("textbox", { name: "处理备注" })).toBeDisabled()
    expect(within(dialog).getByRole("button", { name: "关闭隐藏主题" })).toBeDisabled()
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled()
    expect(within(dialog).getByRole("button", { name: "确认隐藏主题" })).toBeDisabled()

    finishRequest()
    expect(await screen.findByText("主题已隐藏。")).toBeInTheDocument()
  })

  it("opens moderation actions in a focused dialog and closes with Escape", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)

    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "隐藏" }))

    const dialog = screen.getByRole("dialog", { name: "隐藏主题" })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText("当前主题")).toBeInTheDocument()
    expect(within(dialog).getByText(topic.title)).toBeInTheDocument()
    expect(within(dialog).getByText("隐藏后，主题会从当前已发布队列中移除。")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "处理备注" })).toHaveFocus()

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog", { name: "隐藏主题" })).not.toBeInTheDocument()
  })

  it("validates required notes inside the dialog and exposes the character count", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)
    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "隐藏" }))
    await user.type(screen.getByRole("textbox", { name: "处理备注" }), "a")
    await user.click(screen.getByRole("button", { name: "确认隐藏主题" }))

    const dialog = screen.getByRole("dialog", { name: "隐藏主题" })
    expect(within(dialog).getByRole("alert")).toHaveTextContent("至少 2 个字符")
    expect(within(dialog).getByText("1 / 1000")).toBeInTheDocument()
    expect(moderateTopic).not.toHaveBeenCalled()
  })

  it("distinguishes search results from an empty board", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [], nextCursor: null })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)
    await screen.findByText("当前板块暂无已发布主题")
    await user.type(screen.getByRole("textbox", { name: "搜索主题" }), "不存在的主题")
    await user.click(screen.getByRole("button", { name: "搜索" }))

    expect(await screen.findByText("未找到匹配“不存在的主题”的已发布主题")).toBeInTheDocument()
  })

  it("renders a retryable initial loading failure without an empty-state collision", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ topics: [topic], nextCursor: null })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)

    expect(await screen.findByRole("alert")).toHaveTextContent("主题治理队列暂时无法加载")
    expect(screen.queryByText("当前板块暂无已发布主题")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "重试加载" }))

    expect(await screen.findByText(topic.title)).toBeInTheDocument()
    expect(listModerationTopics).toHaveBeenCalledTimes(2)
  })

  it("shows the exact conflict feedback in the open dialog", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(governTopic).mockRejectedValue(new ModerationApiError(409, "revision.conflict", "conflict"))

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)
    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "置顶" }))
    await user.click(screen.getByRole("button", { name: "确认置顶主题" }))

    expect(within(screen.getByRole("dialog", { name: "置顶主题" })).getByRole("alert")).toHaveTextContent(/^主题已被其他操作更新，请刷新列表后重试$/)
  })

  it("shows and expands processing history only with audit read access", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(listTopicModerationHistory).mockResolvedValue({
      entries: [{
        id: "019fc900-0000-7000-8000-000000000401",
        source: "governance",
        action: "pin",
        actor: { id: topic.author.id, username: "owner", displayName: "站长", avatarUrl: null },
        reason: "重要公告",
        createdAt: "2026-08-25T08:00:00Z",
      }],
      nextCursor: null,
    })

    const { rerender } = render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)
    expect(await screen.findByText(topic.title)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "处理记录" })).not.toBeInTheDocument()

    rerender(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" canReadAudit />)
    await openTopicActions(user)
    const historyButton = screen.getByRole("button", { name: "处理记录" })
    expect(historyButton).toHaveAttribute("aria-expanded", "false")
    await user.click(historyButton)

    expect(await screen.findByText("重要公告")).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "主题处理记录" })).getByText("置顶")).toBeInTheDocument()
    const expandedMenu = await openTopicActions(user)
    expect(within(expandedMenu).getByRole("button", { name: "处理记录" })).toHaveAttribute("aria-expanded", "true")
    expect(listTopicModerationHistory).toHaveBeenCalledWith(expect.objectContaining({ topicId: topic.id, limit: 20 }))
  })

  it("loads a topic history only on its first expansion", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(listTopicModerationHistory).mockResolvedValue({ entries: [], nextCursor: null })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" canReadAudit />)
    await openTopicActions(user)
    const historyButton = screen.getByRole("button", { name: "处理记录" })
    await user.click(historyButton)
    await screen.findByText("暂无处理记录")
    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "处理记录" }))
    await openTopicActions(user)
    await user.click(screen.getByRole("button", { name: "处理记录" }))

    expect(await screen.findByText("暂无处理记录")).toBeInTheDocument()
    expect(listTopicModerationHistory).toHaveBeenCalledTimes(1)
  })
})
