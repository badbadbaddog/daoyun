import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createTopic } from "../api/topics"
import type { AuthSession } from "../api/auth"
import type { Board, Topic } from "../types/community"
import { TopicComposer } from "./TopicComposer"

vi.mock("../api/topics", async () => {
  const actual = await vi.importActual<typeof import("../api/topics")>("../api/topics")
  return { ...actual, createTopic: vi.fn() }
})

const session: AuthSession = {
  user: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

const boards: Board[] = [{
  id: "019fc630-0000-7000-8000-000000000001",
  slug: "general",
  name: "社区广场",
  description: "分享想法",
  icon: "messages",
  tone: "green",
  topicCount: 0,
}]

const topic: Topic = {
  id: "019fc800-0000-7000-8000-000000000101",
  title: "发布主题",
  excerpt: "这是正文",
  board: "社区广场",
  boardTone: "green",
  authorId: session.user.id,
  authorUsername: session.user.username,
  author: "社区成员",
  avatarUrl: "https://example.com/avatar.png",
  publishedAt: "刚刚",
  replies: 0,
  likes: 0,
  bookmarked: false,
  liked: false,
  views: 0,
  tags: [],
}

beforeEach(() => {
  vi.mocked(createTopic).mockReset()
})

afterEach(() => cleanup())

describe("TopicComposer", () => {
  it("publishes a topic with the selected board and auth protection", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onPublished = vi.fn()
    vi.mocked(createTopic).mockResolvedValue(topic)
    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={onClose}
        onPublished={onPublished}
      />,
    )

    await user.type(screen.getByRole("textbox", { name: "标题" }), "发布主题")
    await user.type(screen.getByRole("textbox", { name: "正文" }), "这是正文")
    await user.click(screen.getByRole("button", { name: "发布" }))

    expect(createTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "发布主题",
        content: "这是正文",
        boardId: boards[0].id,
        richContent: expect.objectContaining({ type: "doc" }),
      }),
      expect.objectContaining({ csrfToken: session.csrfToken, idempotencyKey: expect.any(String) }),
    )
    expect(onPublished).toHaveBeenCalledWith(topic)
    expect(onClose).toHaveBeenCalled()
  })

  it("keeps a signed-out composer open and explains the auth requirement", async () => {
    const user = userEvent.setup()
    render(<TopicComposer open boards={boards} session={null} onClose={vi.fn()} onPublished={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "标题" }), "主题")
    await user.type(screen.getByRole("textbox", { name: "正文" }), "正文")
    await user.click(screen.getByRole("button", { name: "发布" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("请先登录后发布主题")
    expect(createTopic).not.toHaveBeenCalled()
  })

  it("reuses the idempotency key when an unchanged draft is retried", async () => {
    const user = userEvent.setup()
    vi.mocked(createTopic)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(topic)
    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )

    await user.type(screen.getByRole("textbox", { name: "标题" }), "发布主题")
    await user.type(screen.getByRole("textbox", { name: "正文" }), "这是正文")
    await user.click(screen.getByRole("button", { name: "发布" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("主题服务暂时不可用")

    await user.click(screen.getByRole("button", { name: "发布" }))

    expect(createTopic).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createTopic).mock.calls[1][1].idempotencyKey)
      .toBe(vi.mocked(createTopic).mock.calls[0][1].idempotencyKey)
  })

  it("traps focus, locks background scrolling and restores the opener", async () => {
    const user = userEvent.setup()
    const opener = document.createElement("button")
    opener.textContent = "打开发布窗口"
    document.body.append(opener)
    opener.focus()
    const view = render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )

    expect(screen.getByRole("textbox", { name: "标题" })).toHaveFocus()
    expect(document.body.style.overflow).toBe("hidden")

    screen.getByRole("button", { name: "发布" }).focus()
    await user.tab()
    expect(screen.getByRole("button", { name: "关闭发布窗口" })).toHaveFocus()

    await user.tab({ shift: true })
    expect(screen.getByRole("button", { name: "发布" })).toHaveFocus()

    view.rerender(
      <TopicComposer
        open={false}
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )
    expect(document.body.style.overflow).toBe("")
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
