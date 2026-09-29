import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createReply,
  createTopicSupplement,
  deleteTopic,
  deleteReply,
  getTopic,
  listTopicSupplements,
  listReplies,
  listReplyRevisions,
  listRevisions,
  TopicApiError,
  updateReply,
  updateTopic,
} from "../api/topics"
import { createReport } from "../api/reports"
import { setPostLike, setTopicBookmark } from "../api/relations"
import { TopicDetailView } from "./TopicDetailView"

vi.mock("../api/topics", async () => {
  const actual = await vi.importActual<typeof import("../api/topics")>("../api/topics")
  return {
    ...actual,
    createTopicSupplement: vi.fn(),
    createReply: vi.fn(),
    deleteTopic: vi.fn(),
    deleteReply: vi.fn(),
    getTopic: vi.fn(),
    listTopicSupplements: vi.fn(),
    listReplies: vi.fn(),
    listReplyRevisions: vi.fn(),
    listRevisions: vi.fn(),
    updateTopic: vi.fn(),
    updateReply: vi.fn(),
  }
})

vi.mock("../api/reports", async () => {
  const actual = await vi.importActual<typeof import("../api/reports")>("../api/reports")
  return { ...actual, createReport: vi.fn() }
})

vi.mock("../api/relations", () => ({
  setPostLike: vi.fn(),
  setTopicBookmark: vi.fn(),
}))

const topic = {
  id: "019fc800-0000-7000-8000-000000000101",
  title: "主题详情测试",
  excerpt: "摘要",
  content: "第一段\n\n第二段",
  board: "社区广场",
  boardSlug: "general",
  boardTone: "green" as const,
  author: "社区成员",
  avatarUrl: "https://example.com/avatar.png",
  publishedAt: "刚刚",
  replies: 0,
  likes: 0,
  bookmarked: false,
  liked: false,
  views: 0,
  tags: [{ slug: "rust", name: "Rust" }],
  authorId: "019fc700-0000-7000-8000-000000000004",
  authorUsername: "member",
  contentRevision: 1,
  hasLockedContent: false,
}

const session = {
  user: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

const reply = {
  id: "019fc800-0000-7000-8000-000000000201",
  topicId: topic.id,
  floorNumber: 1,
  replyTo: null,
  author: {
    id: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    avatarUrl: "https://example.com/avatar.png",
  },
  content: "回复正文",
  hasLockedContent: false,
  createdAt: "刚刚",
  updatedAt: "刚刚",
  revisionCount: 1,
  likeCount: 2,
  liked: false,
}

const supplement = {
  id: "019fc800-0000-7000-8000-000000000401",
  topicId: topic.id,
  content: "补充内容示例",
  status: "approved" as const,
  createdAt: "刚刚",
  updatedAt: "刚刚",
  author: {
    id: session.user.id,
    username: session.user.username,
    displayName: topic.author,
    avatarUrl: "https://example.com/avatar.png",
  },
}

const supplementPolicy = { enabled: true, maxPerTopic: 1, usedCount: 0, canSubmit: true }

beforeEach(() => {
  vi.mocked(getTopic).mockReset().mockResolvedValue(topic)
  vi.mocked(listReplies).mockReset().mockResolvedValue({ replies: [], nextCursor: null })
  vi.mocked(listTopicSupplements).mockReset().mockResolvedValue({ supplements: [], policy: supplementPolicy })
  vi.mocked(createReply).mockReset()
  vi.mocked(createTopicSupplement).mockReset()
  vi.mocked(deleteTopic).mockReset()
  vi.mocked(deleteReply).mockReset()
  vi.mocked(updateTopic).mockReset()
  vi.mocked(listRevisions).mockReset()
  vi.mocked(listReplyRevisions).mockReset()
  vi.mocked(updateReply).mockReset()
  vi.mocked(setTopicBookmark).mockReset()
  vi.mocked(setPostLike).mockReset()
  vi.mocked(createReport).mockReset().mockResolvedValue({ id: "019fc800-0000-7000-8000-000000000401", created: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("TopicDetailView", () => {
  it("allows leaving while the topic request is still loading", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    vi.mocked(getTopic).mockReturnValue(new Promise(() => {}))
    render(<TopicDetailView topicId={topic.id} session={null} onBack={onBack} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    expect(screen.getByRole("status")).toHaveTextContent("正在加载主题")
    await user.click(screen.getByRole("button", { name: "返回主题列表" }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it("renders topic supplements and remaining quota", async () => {
    vi.mocked(listTopicSupplements).mockResolvedValueOnce({ supplements: [supplement], policy: { ...supplementPolicy, usedCount: 1, canSubmit: false } })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: "补充" })).toBeInTheDocument()
    expect(screen.getByText("补充内容示例")).toBeInTheDocument()
    expect(screen.getByText("剩余 0/1 次")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "提交补充" })).toBeDisabled()
  })

  it("submits a topic supplement and appends it in chronological order", async () => {
    const user = userEvent.setup()
    const created = {
      ...supplement,
      id: "019fc800-0000-7000-8000-000000000402",
      content: "新提交补充",
      status: "approved" as const,
      updatedAt: "刚刚",
    }
    vi.mocked(createTopicSupplement).mockResolvedValue(created)
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.type(await screen.findByRole("textbox", { name: "补充正文（每帖上限：1）" }), "新提交补充")
    await user.click(screen.getByRole("button", { name: "提交补充" }))

    await waitFor(() => expect(createTopicSupplement).toHaveBeenCalledWith(topic.id, "新提交补充", expect.objectContaining({
      csrfToken: session.csrfToken,
      idempotencyKey: expect.any(String),
    })))
    expect(await screen.findByText("补充已发布")).toBeInTheDocument()
    expect(screen.getByText("新提交补充")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "补充正文（每帖上限：1）" })).toHaveValue("")
  })

  it("prevents supplement submission when quota is exhausted", async () => {
    const user = userEvent.setup()
    vi.mocked(listTopicSupplements).mockResolvedValueOnce({ supplements: [supplement], policy: { ...supplementPolicy, usedCount: 1, canSubmit: false } })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await screen.findByRole("heading", { name: "补充" })
    expect(screen.getByText("剩余 0/1 次")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "提交补充" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "提交补充" }))
    expect(createTopicSupplement).not.toHaveBeenCalled()
  })

  it("keeps the supplement idempotency key for an unchanged network retry", async () => {
    const user = userEvent.setup()
    vi.mocked(createTopicSupplement).mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce(supplement)
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)
    await user.type(await screen.findByRole("textbox", { name: "补充正文（每帖上限：1）" }), supplement.content)
    await user.click(screen.getByRole("button", { name: "提交补充" }))
    expect(await screen.findByText("补充提交失败，请稍后重试")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "提交补充" }))
    expect(await screen.findByText("补充已发布")).toBeInTheDocument()
    expect(vi.mocked(createTopicSupplement).mock.calls[1][2].idempotencyKey)
      .toBe(vi.mocked(createTopicSupplement).mock.calls[0][2].idempotencyKey)
  })

  it("hides the supplement form from non-authors", async () => {
    const otherSession = { ...session, user: { ...session.user, id: "019fc700-0000-7000-8000-000000000005" } }
    render(<TopicDetailView topicId={topic.id} session={otherSession} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)
    await screen.findByRole("heading", { name: "补充" })
    expect(screen.queryByRole("button", { name: "提交补充" })).not.toBeInTheDocument()
  })

  it("keeps published supplements visible while additions are disabled", async () => {
    vi.mocked(listTopicSupplements).mockResolvedValueOnce({ supplements: [supplement], policy: { ...supplementPolicy, enabled: false, canSubmit: false, usedCount: 1 } })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)
    expect(await screen.findByText(supplement.content)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "提交补充" })).not.toBeInTheDocument()
  })

  it("hides the supplement feature when additions are disabled and no history exists", async () => {
    vi.mocked(listTopicSupplements).mockResolvedValueOnce({ supplements: [], policy: { ...supplementPolicy, enabled: false, canSubmit: false } })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: topic.title })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "补充" })).not.toBeInTheDocument()
    expect(screen.queryByText("还没有补充内容")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "提交补充" })).not.toBeInTheDocument()
  })

  it("uses the server quota including hidden supplements", async () => {
    vi.mocked(listTopicSupplements).mockResolvedValueOnce({ supplements: [{ ...supplement, status: "hidden" }], policy: { ...supplementPolicy, maxPerTopic: 3, usedCount: 1 } })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)
    expect(await screen.findByText("剩余 2/3 次")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "提交补充" })).toBeEnabled()
  })

  it("publishes the loaded topic for the detail sidebar", async () => {
    const onTopicLoaded = vi.fn()
    render(
      <TopicDetailView
        topicId={topic.id}
        session={null}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onReplyPublished={vi.fn()}
        onTopicLoaded={onTopicLoaded}
      />,
    )

    expect(await screen.findByRole("heading", { name: topic.title })).toBeInTheDocument()
    expect(onTopicLoaded).toHaveBeenLastCalledWith(topic)
  })

  it("renders a topic and the empty signed-out reply state", async () => {
    const onLogin = vi.fn()
    const user = userEvent.setup()
    render(<TopicDetailView topicId={topic.id} session={null} onBack={vi.fn()} onLogin={onLogin} onReplyPublished={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: topic.title })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: `查看 ${topic.author} 的主页` }))
      .toHaveAttribute("href", `#user/${topic.authorUsername}`)
    expect(screen.getByLabelText("主题作者与发布信息")).toHaveTextContent(`${topic.author}`)
    expect(screen.getByLabelText("主题作者与发布信息")).toHaveTextContent(`${topic.board}`)
    expect(screen.getByLabelText("主题作者与发布信息")).toHaveTextContent(`${topic.publishedAt}`)
    expect(within(screen.getByLabelText("主题作者与发布信息")).getByRole("link", { name: topic.board }))
      .toHaveAttribute("href", "#board/general")
    expect(screen.getByLabelText("主题作者与发布信息")).toHaveTextContent("0 浏览")
    expect(screen.getByRole("article", { name: topic.title }))
      .toHaveAttribute("aria-labelledby", "topic-detail-title")
    expect(within(screen.getByRole("navigation", { name: "主题位置" })).getByRole("link", { name: "社区" }))
      .toHaveAttribute("href", "#boards")
    expect(within(screen.getByRole("navigation", { name: "主题位置" })).getByRole("link", { name: topic.board }))
      .toHaveAttribute("href", "#board/general")
    const tags = screen.getByRole("list", { name: "主题标签" })
    expect(within(tags).getByRole("listitem")).toHaveTextContent("#Rust")
    expect(screen.getByText("还没有回复")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "登录" }))
    expect(onLogin).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "写评论" }))
    expect(onLogin).toHaveBeenCalledTimes(2)
  })

  it("offers source recovery and retry after a failed topic load", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    vi.mocked(getTopic).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(topic)
    render(<TopicDetailView topicId={topic.id} session={null} onBack={onBack} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    expect(await screen.findByRole("alert")).toHaveTextContent("主题暂时无法加载")
    await user.click(screen.getByRole("button", { name: "返回主题列表" }))
    expect(onBack).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "重试加载主题" }))
    expect(await screen.findByRole("heading", { name: topic.title })).toBeInTheDocument()
    expect(getTopic).toHaveBeenCalledTimes(2)
  })

  it("publishes a reply and keeps the idempotency key for an unchanged retry", async () => {
    const user = userEvent.setup()
    const onReplyPublished = vi.fn()
    vi.mocked(createReply)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(reply)
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={onReplyPublished} />)

    await user.type(await screen.findByRole("textbox", { name: "参与讨论" }), "回复正文")
    await user.click(screen.getByRole("button", { name: "发布回复" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("回复服务暂时不可用")
    await user.click(screen.getByRole("button", { name: "发布回复" }))

    await waitFor(() => expect(screen.getAllByText("回复正文")).toHaveLength(1))
    expect(screen.getByRole("status")).toHaveTextContent("回复已发布至 #1 楼")
    await waitFor(() => expect(screen.getByRole("article", { name: "第 1 楼回复" })).toHaveFocus())
    const firstOptions = vi.mocked(createReply).mock.calls[0][2]
    const secondOptions = vi.mocked(createReply).mock.calls[1][2]
    expect(secondOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(onReplyPublished).toHaveBeenCalledWith(topic.id)
  })

  it("uses server floor numbers and replies to a quoted floor", async () => {
    const user = userEvent.setup()
    const quotedReply = {
      ...reply,
      floorNumber: 8,
      replyTo: {
        id: "019fc800-0000-7000-8000-000000000200",
        floorNumber: 3,
        author: {
          id: "019fc700-0000-7000-8000-000000000005",
          username: "quoted_user",
          displayName: "被引用用户",
          avatarUrl: null,
        },
        excerpt: "被引用的回复摘要",
        isDeleted: false,
      },
    }
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 1 })
    vi.mocked(listReplies).mockResolvedValue({ replies: [quotedReply], nextCursor: null })
    vi.mocked(createReply).mockResolvedValue({ ...reply, floorNumber: 9, replyTo: null })

    render(<TopicDetailView topicId={topic.id} focusReplyId={quotedReply.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    const eighthFloor = await screen.findByRole("article", { name: "第 8 楼回复" })
    await waitFor(() => expect(eighthFloor).toHaveFocus())
    expect(within(eighthFloor).getByRole("link", { name: "定位到第 8 楼" }))
      .toHaveAttribute("href", `#topic/${topic.id}?reply=${quotedReply.id}`)
    expect(within(eighthFloor).getByRole("link", { name: "引用第 3 楼：被引用用户" }))
      .toHaveAttribute("href", `#topic/${topic.id}?reply=${quotedReply.replyTo.id}`)
    expect(screen.getByText("引用 #3")).toBeInTheDocument()
    expect(screen.getByText("被引用的回复摘要")).toBeInTheDocument()
    expect(screen.getByText("回复正文").closest("li")).toHaveAttribute("data-reply-level", "1")
    await user.click(screen.getByRole("button", { name: "回复 8 楼" }))
    expect(screen.getByText("回复 #8 @member")).toBeInTheDocument()
    await user.type(screen.getByRole("textbox", { name: "参与讨论" }), "继续讨论")
    await user.click(screen.getByRole("button", { name: "发布回复" }))

    await waitFor(() => expect(createReply).toHaveBeenCalled())
    expect(vi.mocked(createReply).mock.calls[0][2].replyToId).toBe(reply.id)
  })

  it("loads additional reply pages until a deep-linked floor is available", async () => {
    const laterReply = {
      ...reply,
      id: "019fc800-0000-7000-8000-000000000299",
      floorNumber: 30,
      content: "分页后的目标楼层",
    }
    const cursor = "019fc800-0000-7000-8000-000000000250"
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 30 })
    vi.mocked(listReplies)
      .mockResolvedValueOnce({ replies: [reply], nextCursor: cursor })
      .mockResolvedValueOnce({ replies: [laterReply], nextCursor: null })

    render(<TopicDetailView topicId={topic.id} focusReplyId={laterReply.id} session={null} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    const targetFloor = await screen.findByRole("article", { name: "第 30 楼回复" })
    await waitFor(() => expect(targetFloor).toHaveFocus())
    expect(listReplies).toHaveBeenCalledTimes(2)
    expect(listReplies).toHaveBeenLastCalledWith(topic.id, { cursor })
  })

  it("focuses the existing reply editor from the mobile comment entry", async () => {
    const user = userEvent.setup()
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    const editor = await screen.findByRole("textbox", { name: "参与讨论" })
    const trigger = screen.getByRole("button", { name: "写评论" })
    await user.click(screen.getByRole("button", { name: "写回复" }))

    expect(editor).toHaveFocus()

    await user.click(screen.getByRole("button", { name: "回复主题" }))

    expect(editor).toHaveFocus()

    await user.click(trigger)

    expect(editor).toHaveFocus()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("form", { name: "评论编辑器" })).toHaveAttribute("id", "topic-reply-composer")

    await user.click(screen.getByRole("button", { name: "收起评论输入框" }))

    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute("aria-expanded", "false")
  })

  it("starts a top-level reply when reopening the generic composer after a floor reply", async () => {
    const user = userEvent.setup()
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 1 })
    vi.mocked(listReplies).mockResolvedValue({ replies: [reply], nextCursor: null })
    vi.mocked(createReply).mockResolvedValue({ ...reply, floorNumber: 2, replyTo: null })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "回复 1 楼" }))
    expect(screen.getByText("回复 #1 @member")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "收起评论输入框" }))
    await user.click(screen.getByRole("button", { name: "回复主题" }))
    expect(screen.queryByText("回复 #1 @member")).not.toBeInTheDocument()

    await user.type(screen.getByRole("textbox", { name: "参与讨论" }), "新的顶层回复")
    await user.click(screen.getByRole("button", { name: "发布回复" }))
    await waitFor(() => expect(createReply).toHaveBeenCalled())
    expect(vi.mocked(createReply).mock.calls[0][2].replyToId).toBeUndefined()
  })

  it("bookmarks and likes the topic and likes a reply with immediate counts", async () => {
    const user = userEvent.setup()
    const onTopicUpdated = vi.fn()
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 1 })
    vi.mocked(listReplies).mockResolvedValue({ replies: [reply], nextCursor: null })
    vi.mocked(setTopicBookmark).mockResolvedValue({ topicId: topic.id, bookmarked: true })
    vi.mocked(setPostLike)
      .mockResolvedValueOnce({ postId: topic.id, liked: true, likeCount: 1 })
      .mockResolvedValueOnce({ postId: reply.id, liked: true, likeCount: 3 })
    render(
      <TopicDetailView
        topicId={topic.id}
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onReplyPublished={vi.fn()}
        onTopicUpdated={onTopicUpdated}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "收藏主题" }))
    expect(screen.getByRole("button", { name: "取消收藏主题" }))
      .toHaveAttribute("aria-pressed", "true")
    expect(setTopicBookmark).toHaveBeenCalledWith(topic.id, true, session.csrfToken)

    await user.click(screen.getByRole("button", { name: "点赞主题" }))
    expect(screen.getByRole("button", { name: "取消点赞主题" }))
      .toHaveTextContent("1")
    expect(setPostLike).toHaveBeenNthCalledWith(1, topic.id, true, session.csrfToken)

    await user.click(screen.getByRole("button", { name: "点赞回复" }))
    expect(screen.getByRole("button", { name: "取消点赞回复" }))
      .toHaveTextContent("3")
    expect(setPostLike).toHaveBeenNthCalledWith(2, reply.id, true, session.csrfToken)
    expect(onTopicUpdated).toHaveBeenCalled()
  })

  it("keeps bookmarking available while a topic like is pending", async () => {
    const user = userEvent.setup()
    let finishLike: ((value: { postId: string; liked: boolean; likeCount: number }) => void) | undefined
    vi.mocked(setPostLike).mockImplementation(() => new Promise((resolve) => { finishLike = resolve }))
    vi.mocked(setTopicBookmark).mockResolvedValue({ topicId: topic.id, bookmarked: true })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "点赞主题" }))

    const bookmarkButton = screen.getByRole("button", { name: "收藏主题" })
    expect(bookmarkButton).toBeEnabled()
    await user.click(bookmarkButton)
    expect(setTopicBookmark).toHaveBeenCalledWith(topic.id, true, session.csrfToken)

    finishLike?.({ postId: topic.id, liked: true, likeCount: 1 })
    expect(await screen.findByRole("button", { name: "取消点赞主题" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "取消收藏主题" })).toBeInTheDocument()
  })

  it("shows load-more failures inside the reply section for signed-out visitors", async () => {
    const user = userEvent.setup()
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 2 })
    vi.mocked(listReplies)
      .mockResolvedValueOnce({ replies: [reply], nextCursor: "cursor-2" })
      .mockRejectedValueOnce(new Error("network unavailable"))
    render(<TopicDetailView topicId={topic.id} session={null} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "加载更多回复" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("更多回复暂时无法加载，请重试")
    expect(screen.getByRole("button", { name: "加载更多回复" })).toBeEnabled()
  })

  it("ignores a late load-more response after navigating to another topic", async () => {
    const user = userEvent.setup()
    const nextTopic = { ...topic, id: "019fc800-0000-7000-8000-000000000102", title: "新的主题" }
    const nextReply = { ...reply, id: "019fc800-0000-7000-8000-000000000202", topicId: nextTopic.id, content: "新主题回复" }
    const staleReply = { ...reply, id: "019fc800-0000-7000-8000-000000000203", content: "旧主题迟到回复" }
    let finishOldPage: ((page: { replies: (typeof reply)[]; nextCursor: null }) => void) | undefined
    vi.mocked(getTopic)
      .mockResolvedValueOnce({ ...topic, replies: 2 })
      .mockResolvedValueOnce({ ...nextTopic, replies: 1 })
    vi.mocked(listReplies)
      .mockResolvedValueOnce({ replies: [reply], nextCursor: "cursor-2" })
      .mockImplementationOnce(() => new Promise((resolve) => { finishOldPage = resolve }))
      .mockResolvedValueOnce({ replies: [nextReply], nextCursor: null })
    const view = render(<TopicDetailView topicId={topic.id} session={null} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "加载更多回复" }))
    view.rerender(<TopicDetailView topicId={nextTopic.id} session={null} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: nextTopic.title })).toBeInTheDocument()
    await act(async () => {
      finishOldPage?.({ replies: [staleReply], nextCursor: null })
      await Promise.resolve()
    })
    expect(screen.queryByText("旧主题迟到回复")).not.toBeInTheDocument()
    expect(screen.getByText("新主题回复")).toBeInTheDocument()
  })

  it("copies a canonical topic link from the share action", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    render(<TopicDetailView topicId={topic.id} session={null} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "分享主题" }))

    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`#topic/${topic.id}$`)))
    expect(screen.getByText("链接已复制")).toHaveAttribute("role", "status")
  })

  it("submits a topic report with the session csrf token", async () => {
    const user = userEvent.setup()
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "举报主题" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "举报原因" }), "harassment")
    await user.type(screen.getByRole("textbox", { name: "补充说明" }), "请核查这段内容")
    await user.click(screen.getByRole("button", { name: "提交举报" }))

    expect(createReport).toHaveBeenCalledWith("topic", topic.id, "harassment", "请核查这段内容", session.csrfToken)
    expect(await screen.findByText("举报已提交，管理员会尽快处理")).toBeInTheDocument()
  })

  it("submits a reply report with the session csrf token", async () => {
    const user = userEvent.setup()
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 1 })
    vi.mocked(listReplies).mockResolvedValue({ replies: [reply], nextCursor: null })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "举报回复" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "举报原因" }), "copyright")
    await user.type(screen.getByRole("textbox", { name: "补充说明" }), "请核查回复内容")
    await user.click(screen.getByRole("button", { name: "提交举报" }))

    expect(createReport).toHaveBeenCalledWith("post", reply.id, "copyright", "请核查回复内容", session.csrfToken)
    expect(await screen.findByText("举报已提交，管理员会尽快处理")).toBeInTheDocument()
  })

  it("allows the author to edit content without showing revision history", async () => {
    const user = userEvent.setup()
    const updatedTopic = { ...topic, title: "更新后的标题", content: "更新后的正文", contentRevision: 2, tags: [{ slug: "sqlx", name: "SQLx" }] }
    vi.mocked(updateTopic).mockResolvedValue(updatedTopic)
    vi.mocked(listRevisions).mockResolvedValue([{
      id: "019fc800-0000-7000-8000-000000000301",
      topicId: topic.id,
      revisionNumber: 2,
      editor: {
        id: session.user.id,
        username: session.user.username,
        displayName: session.user.displayName,
        avatarUrl: "https://example.com/avatar.png",
      },
      content: "更新后的正文",
      createdAt: "刚刚",
    }])
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "编辑" }))
    await user.clear(screen.getByRole("textbox", { name: "标题（可选）" }))
    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "更新后的标题")
    await user.click(screen.getByRole("button", { name: "保存修改" }))

    expect(await screen.findByRole("heading", { name: "更新后的标题" })).toBeInTheDocument()
    expect(updateTopic).toHaveBeenCalledWith(topic.id, expect.objectContaining({ baseRevision: 1, title: "更新后的标题" }), { csrfToken: session.csrfToken })
    expect(screen.queryByRole("button", { name: "查看修订历史" })).not.toBeInTheDocument()
    expect(await screen.findAllByText("更新后的正文")).toHaveLength(1)
    expect(listRevisions).not.toHaveBeenCalled()
  })

  it("keeps the published topic visible when an edit enters review", async () => {
    const user = userEvent.setup()
    vi.mocked(updateTopic).mockResolvedValue({
      ...topic,
      editDisposition: "pending_review",
      editReviewId: "019fc800-0000-7000-8000-000000000399",
    })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "编辑" }))
    await user.clear(screen.getByRole("textbox", { name: "标题（可选）" }))
    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "待审标题")
    await user.click(screen.getByRole("button", { name: "保存修改" }))

    expect(await screen.findByText(/编辑已提交审核/)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: topic.title })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "待审标题" })).not.toBeInTheDocument()
  })

  it("shows a conflict and lets the author refresh the latest revision", async () => {
    const user = userEvent.setup()
    vi.mocked(updateTopic).mockRejectedValue(new TopicApiError(409, "topic.revision_conflict", "版本冲突"))
    vi.mocked(getTopic).mockResolvedValueOnce(topic).mockResolvedValueOnce({ ...topic, contentRevision: 2, content: "服务器最新正文" })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "编辑" }))
    await user.click(screen.getByRole("button", { name: "保存修改" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("主题已被其他操作更新")
    await user.click(screen.getByRole("button", { name: "刷新最新内容" }))
    expect(await screen.findByText("服务器最新正文")).toBeInTheDocument()
    expect(getTopic).toHaveBeenCalledTimes(2)
  })

  it("lets a reply author edit and confirm deletion without showing revision history", async () => {
    const user = userEvent.setup()
    const onReplyDeleted = vi.fn()
    const updatedReply = { ...reply, content: "更新后的回复", revisionCount: 2 }
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 1 })
    vi.mocked(listReplies).mockResolvedValue({ replies: [reply], nextCursor: null })
    vi.mocked(updateReply).mockResolvedValue(updatedReply)
    vi.mocked(listReplyRevisions).mockResolvedValue([{
      id: "019fc800-0000-7000-8000-000000000301",
      replyId: reply.id,
      revisionNumber: 2,
      editor: reply.author,
      content: "更新后的回复",
      createdAt: "刚刚",
    }])
    vi.mocked(deleteReply).mockResolvedValue(true)
    render(
      <TopicDetailView
        topicId={topic.id}
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onReplyPublished={vi.fn()}
        onReplyDeleted={onReplyDeleted}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "编辑回复" }))
    await user.clear(screen.getByRole("textbox", { name: "编辑回复内容" }))
    await user.type(screen.getByRole("textbox", { name: "编辑回复内容" }), "更新后的回复")
    await user.click(screen.getByRole("button", { name: "保存回复" }))
    expect(await screen.findByText("更新后的回复")).toBeInTheDocument()
    expect(updateReply).toHaveBeenCalledWith(topic.id, reply.id, expect.objectContaining({
      baseRevision: 1,
      content: "更新后的回复",
      richContent: expect.objectContaining({ type: "doc" }),
    }), { csrfToken: session.csrfToken })

    expect(screen.queryByRole("button", { name: "查看回复修订历史" })).not.toBeInTheDocument()
    expect(listReplyRevisions).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "删除回复" }))
    expect(screen.getByRole("alertdialog", { name: "确认删除回复" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "确认删除" }))
    expect(await screen.findByText("还没有回复")).toBeInTheDocument()
    expect(deleteReply).toHaveBeenCalledWith(topic.id, reply.id, {
      csrfToken: session.csrfToken,
    })
    expect(onReplyDeleted).toHaveBeenCalledWith(topic.id)
  })

  it("keeps the published reply visible when an edit enters review", async () => {
    const user = userEvent.setup()
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 1 })
    vi.mocked(listReplies).mockResolvedValue({ replies: [reply], nextCursor: null })
    vi.mocked(updateReply).mockResolvedValue({
      ...reply,
      editDisposition: "pending_review",
      editReviewId: "019fc800-0000-7000-8000-000000000399",
    })
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "编辑回复" }))
    await user.click(screen.getByRole("button", { name: "保存回复" }))

    expect(await screen.findByText(/回复编辑已提交审核/)).toBeInTheDocument()
    expect(screen.getByText(reply.content)).toBeInTheDocument()
  })

  it("lets the topic author confirm a soft deletion and returns to the feed", async () => {
    const user = userEvent.setup()
    const onTopicDeleted = vi.fn()
    vi.mocked(deleteTopic).mockResolvedValue(true)
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} onTopicDeleted={onTopicDeleted} />)

    await user.click(await screen.findByRole("button", { name: "删除主题" }))
    expect(screen.getByRole("alertdialog", { name: "确认删除主题" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "确认删除" }))
    expect(deleteTopic).toHaveBeenCalledWith(topic.id, { csrfToken: session.csrfToken })
    expect(onTopicDeleted).toHaveBeenCalledWith(topic.id)
  })

  it("shows a reply conflict and refreshes the latest reply list", async () => {
    const user = userEvent.setup()
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 1 })
    vi.mocked(listReplies)
      .mockResolvedValueOnce({ replies: [reply], nextCursor: null })
      .mockResolvedValueOnce({
        replies: [{ ...reply, content: "服务器最新回复", revisionCount: 2 }],
        nextCursor: null,
      })
    vi.mocked(updateReply).mockRejectedValue(
      new TopicApiError(409, "reply.revision_conflict", "版本冲突"),
    )
    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: "编辑回复" }))
    await user.click(screen.getByRole("button", { name: "保存回复" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("回复已被其他操作更新")
    await user.click(screen.getByRole("button", { name: "刷新回复列表" }))
    expect(await screen.findByText("服务器最新回复")).toBeInTheDocument()
    expect(listReplies).toHaveBeenCalledTimes(2)
  })

  it("does not expose reply author actions to another user", async () => {
    vi.mocked(getTopic).mockResolvedValue({ ...topic, replies: 1 })
    vi.mocked(listReplies).mockResolvedValue({ replies: [reply], nextCursor: null })
    const otherSession = {
      ...session,
      user: { ...session.user, id: "019fc700-0000-7000-8000-000000000099" },
    }
    render(<TopicDetailView topicId={topic.id} session={otherSession} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    const replyContent = await screen.findByText("回复正文")
    expect(replyContent).toBeInTheDocument()
    expect(within(replyContent.closest("article")!).getByRole("link", { name: `查看 ${reply.author.displayName} 的主页` }))
      .toHaveAttribute("href", `#user/${reply.author.username}`)
    expect(screen.queryByRole("button", { name: "编辑回复" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "删除回复" })).not.toBeInTheDocument()
  })
})

vi.mock("./TopicPollPanel",()=>({TopicPollPanel:()=>null}))
