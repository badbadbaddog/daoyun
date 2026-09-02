import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
  parentId: null,
  slug: "general",
  name: "社区广场",
  description: "分享想法",
  icon: "messages",
  tone: "green",
  position: 10,
  depth: 0,
  childCount: 0,
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
  window.localStorage.clear()
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

    await user.click(screen.getByRole("button", { name: "添加标题" }))
    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "发布主题")
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

  it("publishes body-only content without sending a title", async () => {
    const user = userEvent.setup()
    vi.mocked(createTopic).mockResolvedValue(topic)
    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )

    await user.type(screen.getByRole("textbox", { name: "正文" }), "只有正文也能发布")
    await user.click(screen.getByRole("button", { name: "发布" }))

    const input = vi.mocked(createTopic).mock.calls[0][0]
    expect(input).toMatchObject({
      content: "只有正文也能发布",
      boardId: boards[0].id,
      richContent: expect.objectContaining({ type: "doc" }),
    })
    expect(input).not.toHaveProperty("title")
  })

  it("restores a locally saved draft when the composer is reopened", async () => {
    const user = userEvent.setup()
    const first = render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )

    await user.type(screen.getByRole("textbox", { name: "正文" }), "需要继续编辑的草稿")
    await waitFor(() => expect(window.localStorage.length).toBe(1))
    first.unmount()

    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("需要继续编辑的草稿"))
  })

  it("keeps a signed-out composer open and explains the auth requirement", async () => {
    const user = userEvent.setup()
    render(<TopicComposer open boards={boards} session={null} onClose={vi.fn()} onPublished={vi.fn()} />)

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

    await user.click(screen.getByRole("button", { name: "添加标题" }))
    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "发布主题")
    await user.type(screen.getByRole("textbox", { name: "正文" }), "这是正文")
    await user.click(screen.getByRole("button", { name: "发布" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("主题服务暂时不可用")

    await user.click(screen.getByRole("button", { name: "发布" }))

    expect(createTopic).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createTopic).mock.calls[1][1].idempotencyKey)
      .toBe(vi.mocked(createTopic).mock.calls[0][1].idempotencyKey)
  })

  it("uses an in-app confirmation before discarding unsaved edits", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={onClose}
        onPublished={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "添加标题" }))
    const title = screen.getByRole("textbox", { name: "标题（可选）" })
    fireEvent.change(title, { target: { value: "尚未保存的新修改" } })
    const close = screen.getByRole("button", { name: "关闭发布窗口" })
    close.focus()
    fireEvent.click(close)

    const dialog = screen.getByRole("alertdialog", { name: "关闭发布窗口？" })
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus())
    expect(screen.getByRole("dialog", { name: "发布内容" })).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("alertdialog", { name: "关闭发布窗口？" })).not.toBeInTheDocument()
    await waitFor(() => expect(close).toHaveFocus())
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.change(title, { target: { value: "第二次未保存修改" } })
    fireEvent.click(close)
    const reopened = screen.getByRole("alertdialog", { name: "关闭发布窗口？" })
    await user.click(within(reopened).getByRole("button", { name: "确认关闭" }))
    expect(onClose).toHaveBeenCalledTimes(1)
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

    await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" })).toHaveFocus())
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
