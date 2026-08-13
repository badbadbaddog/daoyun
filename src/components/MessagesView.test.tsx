import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthSession } from "../api/auth"
import {
  archiveConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from "../api/messages"
import type { ConversationSummary, DirectMessage } from "../api/messages"
import { MessagesView } from "./MessagesView"

vi.mock("../api/messages", async () => {
  const actual = await vi.importActual<typeof import("../api/messages")>("../api/messages")
  return {
    ...actual,
    archiveConversation: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
    markConversationRead: vi.fn(),
    sendMessage: vi.fn(),
  }
})

const session: AuthSession = {
  user: {
    id: "019fc900-0000-7000-8000-000000000001",
    username: "first",
    email: "first@example.com",
    displayName: "第一位用户",
  },
  csrfToken: "a".repeat(64),
}
const conversation: ConversationSummary = {
  id: "019fc900-0000-7000-8000-000000000101",
  otherUser: {
    id: "019fc900-0000-7000-8000-000000000002",
    username: "second",
    displayName: "第二位用户",
    avatarUrl: null,
  },
  lastMessage: {
    id: "019fc900-0000-7000-8000-000000000201",
    senderId: "019fc900-0000-7000-8000-000000000002",
    content: "最近一条消息",
    createdAt: "2026-08-04T10:00:00Z",
  },
  unreadCount: 1,
  updatedAt: "2026-08-04T10:00:00Z",
}
const incomingMessage: DirectMessage = {
  id: conversation.lastMessage!.id,
  conversationId: conversation.id,
  sender: conversation.otherUser,
  content: conversation.lastMessage!.content,
  createdAt: conversation.lastMessage!.createdAt,
}
const secondConversation: ConversationSummary = {
  id: "019fc900-0000-7000-8000-000000000102",
  otherUser: {
    id: "019fc900-0000-7000-8000-000000000003",
    username: "third",
    displayName: "第三位用户",
    avatarUrl: null,
  },
  lastMessage: {
    id: "019fc900-0000-7000-8000-000000000204",
    senderId: "019fc900-0000-7000-8000-000000000003",
    content: "第二个会话消息",
    createdAt: "2026-08-04T10:02:00Z",
  },
  unreadCount: 0,
  updatedAt: "2026-08-04T10:02:00Z",
}
const secondConversationMessage: DirectMessage = {
  id: secondConversation.lastMessage!.id,
  conversationId: secondConversation.id,
  sender: secondConversation.otherUser,
  content: secondConversation.lastMessage!.content,
  createdAt: secondConversation.lastMessage!.createdAt,
}
const thirdConversation: ConversationSummary = {
  id: "019fc900-0000-7000-8000-000000000103",
  otherUser: {
    id: "019fc900-0000-7000-8000-000000000004",
    username: "fourth",
    displayName: "第四位用户",
    avatarUrl: null,
  },
  lastMessage: {
    id: "019fc900-0000-7000-8000-000000000207",
    senderId: "019fc900-0000-7000-8000-000000000004",
    content: "第三个会话消息",
    createdAt: "2026-08-04T10:03:00Z",
  },
  unreadCount: 0,
  updatedAt: "2026-08-04T10:03:00Z",
}
const thirdConversationMessage: DirectMessage = {
  id: thirdConversation.lastMessage!.id,
  conversationId: thirdConversation.id,
  sender: thirdConversation.otherUser,
  content: thirdConversation.lastMessage!.content,
  createdAt: thirdConversation.lastMessage!.createdAt,
}

beforeEach(() => {
  vi.mocked(listConversations).mockReset().mockResolvedValue({
    conversations: [conversation],
    nextCursor: null,
  })
  vi.mocked(listMessages).mockReset().mockResolvedValue({
    messages: [incomingMessage],
    nextCursor: null,
  })
  vi.mocked(markConversationRead).mockReset().mockResolvedValue({
    conversationId: conversation.id,
    lastReadMessageId: incomingMessage.id,
    unreadCount: 0,
  })
  vi.mocked(sendMessage).mockReset().mockResolvedValue({
    id: "019fc900-0000-7000-8000-000000000202",
    conversationId: conversation.id,
    sender: {
      id: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      avatarUrl: null,
    },
    content: "发出的消息",
    createdAt: "2026-08-04T10:01:00Z",
  })
  vi.mocked(archiveConversation).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("MessagesView", () => {
  it("prompts visitors to log in without requesting private conversations", async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    render(
      <MessagesView
        session={null}
        conversationId={null}
        onSelectConversation={vi.fn()}
        onBack={vi.fn()}
        onLogin={onLogin}
      />,
    )

    await user.click(screen.getByRole("button", { name: "登录查看私信" }))
    expect(onLogin).toHaveBeenCalledTimes(1)
    expect(listConversations).not.toHaveBeenCalled()
  })

  it("loads a conversation, marks incoming messages read and sends a message", async () => {
    const user = userEvent.setup()
    render(
      <MessagesView
        session={session}
        conversationId={conversation.id}
        onSelectConversation={vi.fn()}
        onBack={vi.fn()}
        onLogin={vi.fn()}
      />,
    )

    expect(await screen.findAllByText("最近一条消息")).toHaveLength(2)
    await waitFor(() => {
      expect(markConversationRead).toHaveBeenCalledWith(
        conversation.id,
        incomingMessage.id,
        session.csrfToken,
      )
    })
    await user.type(screen.getByRole("textbox", { name: "消息正文" }), "发出的消息")
    await user.click(screen.getByRole("button", { name: "发送消息" }))
    expect(sendMessage).toHaveBeenCalledWith(
      conversation.id,
      "发出的消息",
      session.csrfToken,
      expect.any(String),
    )
    expect(await screen.findAllByText("发出的消息")).toHaveLength(2)
  })

  it("seeds a newly opened conversation when it is absent from the first list page", async () => {
    vi.mocked(listConversations).mockResolvedValue({ conversations: [], nextCursor: null })
    render(
      <MessagesView
        session={session}
        conversationId={conversation.id}
        initialConversation={conversation}
        onSelectConversation={vi.fn()}
        onBack={vi.fn()}
        onLogin={vi.fn()}
      />,
    )

    const conversationList = await screen.findByRole("complementary", { name: "私信会话列表" })
    expect(within(conversationList).getByRole("button", { name: /第二位用户/ })).toBeInTheDocument()
    expect(listMessages).toHaveBeenCalledWith(conversation.id, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
  })

  it("reuses the idempotency key when retrying the same failed message", async () => {
    const user = userEvent.setup()
    vi.mocked(sendMessage)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({
        ...incomingMessage,
        id: "019fc900-0000-7000-8000-000000000203",
        sender: {
          id: session.user.id,
          username: session.user.username,
          displayName: session.user.displayName,
          avatarUrl: null,
        },
        content: "重试消息",
      })
    render(
      <MessagesView
        session={session}
        conversationId={conversation.id}
        onSelectConversation={vi.fn()}
        onBack={vi.fn()}
        onLogin={vi.fn()}
      />,
    )

    await screen.findAllByText("最近一条消息")
    await user.type(screen.getByRole("textbox", { name: "消息正文" }), "重试消息")
    await user.click(screen.getByRole("button", { name: "发送消息" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("消息暂时无法发送")
    await user.click(screen.getByRole("button", { name: "重新发送" }))
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendMessage).mock.calls[1][3]).toBe(
      vi.mocked(sendMessage).mock.calls[0][3],
    )
  })

  it("counts the message length by Unicode characters", async () => {
    const user = userEvent.setup()
    render(
      <MessagesView
        session={session}
        conversationId={conversation.id}
        onSelectConversation={vi.fn()}
        onBack={vi.fn()}
        onLogin={vi.fn()}
      />,
    )

    await screen.findAllByText("最近一条消息")
    const textarea = screen.getByRole("textbox", { name: "消息正文" })
    const validContent = "😀".repeat(10_000)
    fireEvent.change(textarea, { target: { value: validContent } })
    await user.click(screen.getByRole("button", { name: "发送消息" }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      conversation.id,
      validContent,
      session.csrfToken,
      expect.any(String),
    ))

    fireEvent.change(textarea, { target: { value: `${validContent}😀` } })
    await user.click(screen.getByRole("button", { name: "发送消息" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("消息正文不能超过 10000 个字符")
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("retries conversation loading and archives the selected conversation", async () => {
    const user = userEvent.setup()
    vi.mocked(listConversations)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ conversations: [conversation], nextCursor: null })
    const onSelectConversation = vi.fn()
    render(
      <MessagesView
        session={session}
        conversationId={conversation.id}
        onSelectConversation={onSelectConversation}
        onBack={vi.fn()}
        onLogin={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "重试加载会话" }))
    await screen.findAllByText("第二位用户")
    await user.click(screen.getByRole("button", { name: "归档与第二位用户的会话" }))
    expect(archiveConversation).toHaveBeenCalledWith(conversation.id, session.csrfToken)
    expect(onSelectConversation).toHaveBeenCalledWith(null)
    expect(await screen.findByText("还没有私信会话")).toBeInTheDocument()
  })

  it("does not replace a conversation selected while an archive request is pending", async () => {
    const user = userEvent.setup()
    const pendingArchive = deferred<boolean>()
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [conversation, secondConversation, thirdConversation],
      nextCursor: null,
    })
    vi.mocked(listMessages).mockImplementation((conversationId) => Promise.resolve({
      messages: conversationId === thirdConversation.id
        ? [thirdConversationMessage]
        : conversationId === secondConversation.id
          ? [secondConversationMessage]
          : [incomingMessage],
      nextCursor: null,
    }))
    vi.mocked(archiveConversation).mockReturnValue(pendingArchive.promise)
    render(
      <MessagesView
        session={session}
        conversationId={conversation.id}
        onSelectConversation={vi.fn()}
        onBack={vi.fn()}
        onLogin={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "归档与第二位用户的会话" }))
    await user.click(screen.getByRole("button", { name: /第四位用户/ }))
    expect(await within(screen.getByRole("region", { name: "当前私信会话" }))
      .findByText("第三个会话消息")).toBeInTheDocument()
    await act(async () => {
      pendingArchive.resolve(true)
      await pendingArchive.promise
    })

    expect(within(screen.getByRole("region", { name: "当前私信会话" }))
      .getByText("第三个会话消息")).toBeInTheDocument()
  })

  it("keeps the conversation list unselected after the parent route returns to it", async () => {
    const user = userEvent.setup()
    const props = {
      session,
      initialConversation: null,
      onSelectConversation: vi.fn(),
      onBack: vi.fn(),
      onLogin: vi.fn(),
    }
    const view = render(<MessagesView {...props} conversationId={conversation.id} />)

    await screen.findAllByText("最近一条消息")
    await user.click(screen.getByRole("button", { name: "返回会话列表" }))
    view.rerender(<MessagesView {...props} conversationId={null} />)

    expect(await screen.findByText("请选择一个会话")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /第二位用户/ })).not.toHaveAttribute(
      "aria-current",
    )
  })

  it("does not append an older-page response after switching conversations", async () => {
    const user = userEvent.setup()
    const olderPage = deferred<Awaited<ReturnType<typeof listMessages>>>()
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [conversation, secondConversation],
      nextCursor: null,
    })
    vi.mocked(listMessages).mockImplementation((conversationId, options = {}) => {
      if (conversationId === conversation.id && options.cursor) return olderPage.promise
      if (conversationId === secondConversation.id) {
        return Promise.resolve({ messages: [secondConversationMessage], nextCursor: null })
      }
      return Promise.resolve({ messages: [incomingMessage], nextCursor: incomingMessage.id })
    })
    render(
      <MessagesView
        session={session}
        conversationId={conversation.id}
        onSelectConversation={vi.fn()}
        onBack={vi.fn()}
        onLogin={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "加载更早消息" }))
    await user.click(screen.getByRole("button", { name: /第三位用户/ }))
    expect(await within(screen.getByRole("region", { name: "当前私信会话" }))
      .findByText("第二个会话消息")).toBeInTheDocument()
    await act(async () => {
      olderPage.resolve({
        messages: [{ ...incomingMessage, id: "019fc900-0000-7000-8000-000000000205", content: "迟到的旧会话消息" }],
        nextCursor: null,
      })
      await olderPage.promise
    })

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "当前私信会话" }))
        .queryByText("迟到的旧会话消息")).not.toBeInTheDocument()
    })
  })

  it("does not show an older-page failure after switching conversations", async () => {
    const user = userEvent.setup()
    const olderPage = deferred<Awaited<ReturnType<typeof listMessages>>>()
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [conversation, secondConversation],
      nextCursor: null,
    })
    vi.mocked(listMessages).mockImplementation((conversationId, options = {}) => {
      if (conversationId === conversation.id && options.cursor) return olderPage.promise
      if (conversationId === secondConversation.id) {
        return Promise.resolve({ messages: [secondConversationMessage], nextCursor: null })
      }
      return Promise.resolve({ messages: [incomingMessage], nextCursor: incomingMessage.id })
    })
    render(
      <MessagesView
        session={session}
        conversationId={conversation.id}
        onSelectConversation={vi.fn()}
        onBack={vi.fn()}
        onLogin={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "加载更早消息" }))
    await user.click(screen.getByRole("button", { name: /第三位用户/ }))
    expect(await within(screen.getByRole("region", { name: "当前私信会话" }))
      .findByText("第二个会话消息")).toBeInTheDocument()
    await act(async () => {
      olderPage.reject(new Error("unavailable"))
      await olderPage.promise.catch(() => undefined)
    })

    expect(screen.queryByText("更早的消息暂时无法加载。")).not.toBeInTheDocument()
  })

  it("does not render a completed send in a conversation selected while it was pending", async () => {
    const user = userEvent.setup()
    const pendingSend = deferred<DirectMessage>()
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [conversation, secondConversation],
      nextCursor: null,
    })
    vi.mocked(listMessages).mockImplementation((conversationId) => Promise.resolve({
      messages: conversationId === secondConversation.id ? [secondConversationMessage] : [incomingMessage],
      nextCursor: null,
    }))
    vi.mocked(sendMessage).mockReturnValue(pendingSend.promise)
    render(
      <MessagesView
        session={session}
        conversationId={conversation.id}
        onSelectConversation={vi.fn()}
        onBack={vi.fn()}
        onLogin={vi.fn()}
      />,
    )

    await screen.findAllByText("最近一条消息")
    await user.type(screen.getByRole("textbox", { name: "消息正文" }), "正在发送的旧会话消息")
    await user.click(screen.getByRole("button", { name: "发送消息" }))
    await user.click(screen.getByRole("button", { name: /第三位用户/ }))
    expect(await within(screen.getByRole("region", { name: "当前私信会话" }))
      .findByText("第二个会话消息")).toBeInTheDocument()
    await act(async () => {
      pendingSend.resolve({
        ...incomingMessage,
        id: "019fc900-0000-7000-8000-000000000206",
        sender: {
          id: session.user.id,
          username: session.user.username,
          displayName: session.user.displayName,
          avatarUrl: null,
        },
        content: "正在发送的旧会话消息",
      })
      await pendingSend.promise
    })

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "当前私信会话" }))
        .queryByText("正在发送的旧会话消息")).not.toBeInTheDocument()
    })
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, reject, resolve }
}
