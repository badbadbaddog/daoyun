import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createReply,
  deleteTopic,
  deleteReply,
  getTopic,
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
    createReply: vi.fn(),
    deleteTopic: vi.fn(),
    deleteReply: vi.fn(),
    getTopic: vi.fn(),
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

beforeEach(() => {
  vi.mocked(getTopic).mockReset().mockResolvedValue(topic)
  vi.mocked(listReplies).mockReset().mockResolvedValue({ replies: [], nextCursor: null })
  vi.mocked(createReply).mockReset()
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
  it("renders a topic and the empty signed-out reply state", async () => {
    const onLogin = vi.fn()
    const user = userEvent.setup()
    render(<TopicDetailView topicId={topic.id} session={null} onBack={vi.fn()} onLogin={onLogin} onReplyPublished={vi.fn()} />)

    expect(await screen.findByRole("heading", { name: topic.title })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: `查看 ${topic.author} 的主页` }))
      .toHaveAttribute("href", `#user/${topic.authorUsername}`)
    expect(screen.getByText("还没有回复")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "登录" }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })

  it("retries a failed topic load", async () => {
    const user = userEvent.setup()
    vi.mocked(getTopic).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(topic)
    render(<TopicDetailView topicId={topic.id} session={null} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    expect(await screen.findByRole("alert")).toHaveTextContent("主题暂时无法加载")
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

    render(<TopicDetailView topicId={topic.id} session={session} onBack={vi.fn()} onLogin={vi.fn()} onReplyPublished={vi.fn()} />)

    expect(await screen.findByText("#8")).toBeInTheDocument()
    expect(screen.getByText("引用 #3")).toBeInTheDocument()
    expect(screen.getByText("被引用的回复摘要")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "回复 8 楼" }))
    expect(screen.getByText("回复 #8 @member")).toBeInTheDocument()
    await user.type(screen.getByRole("textbox", { name: "参与讨论" }), "继续讨论")
    await user.click(screen.getByRole("button", { name: "发布回复" }))

    await waitFor(() => expect(createReply).toHaveBeenCalled())
    expect(vi.mocked(createReply).mock.calls[0][2].replyToId).toBe(reply.id)
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

  it("allows the author to edit content and inspect revisions", async () => {
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
    await user.clear(screen.getByRole("textbox", { name: "标题" }))
    await user.type(screen.getByRole("textbox", { name: "标题" }), "更新后的标题")
    await user.click(screen.getByRole("button", { name: "保存修改" }))

    expect(await screen.findByRole("heading", { name: "更新后的标题" })).toBeInTheDocument()
    expect(updateTopic).toHaveBeenCalledWith(topic.id, expect.objectContaining({ baseRevision: 1, title: "更新后的标题" }), { csrfToken: session.csrfToken })
    await user.click(screen.getByRole("button", { name: "查看修订历史" }))
    expect(await screen.findAllByText("更新后的正文")).toHaveLength(2)
    expect(listRevisions).toHaveBeenCalledWith(topic.id)
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

  it("lets a reply author edit, inspect revisions and confirm deletion", async () => {
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

    await user.click(screen.getByRole("button", { name: "查看回复修订历史" }))
    expect(await screen.findByText("第 2 版")).toBeInTheDocument()
    expect(listReplyRevisions).toHaveBeenCalledWith(topic.id, reply.id)

    await user.click(screen.getByRole("button", { name: "删除回复" }))
    expect(screen.getByRole("alertdialog", { name: "确认删除回复" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "确认删除" }))
    expect(await screen.findByText("还没有回复")).toBeInTheDocument()
    expect(deleteReply).toHaveBeenCalledWith(topic.id, reply.id, {
      csrfToken: session.csrfToken,
    })
    expect(onReplyDeleted).toHaveBeenCalledWith(topic.id)
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
