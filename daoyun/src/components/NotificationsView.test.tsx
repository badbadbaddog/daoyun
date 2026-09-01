import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { listNotifications, markAllNotificationsRead, markNotificationRead } from "../api/notifications"
import { NotificationsView } from "./NotificationsView"

vi.mock("../api/notifications", async () => {
  const actual = await vi.importActual<typeof import("../api/notifications")>("../api/notifications")
  return {
    ...actual,
    listNotifications: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    markNotificationRead: vi.fn(),
  }
})

const session = {
  user: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

const unreadNotification = {
  id: "019fc700-0000-7000-8000-000000000101",
  kind: "reply" as const,
  actor: {
    id: "019fc700-0000-7000-8000-000000000005",
    username: "reply_author",
    displayName: "回复作者",
    avatarUrl: null,
  },
  target: "topic" as const,
  targetId: "019fc700-0000-7000-8000-000000000201",
  readAt: null,
  createdAt: "2026-08-30T08:00:00Z",
}

const readNotification = {
  ...unreadNotification,
  id: "019fc700-0000-7000-8000-000000000102",
  kind: "like" as const,
  readAt: "2026-08-30T08:30:00Z",
}

beforeEach(() => {
  vi.mocked(listNotifications).mockResolvedValue({
    notifications: [unreadNotification, readNotification],
    nextCursor: null,
  })
  vi.mocked(markNotificationRead).mockReset()
  vi.mocked(markAllNotificationsRead).mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("NotificationsView", () => {
  it("switches between all and unread notifications without another request", async () => {
    const user = userEvent.setup()
    render(
      <NotificationsView
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTarget={vi.fn()}
      />,
    )

    expect(await screen.findByText("回复作者 回复了你的主题")).toBeInTheDocument()
    expect(screen.getByText("回复作者 赞了你的内容")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "未读" }))

    expect(screen.getByText("回复作者 回复了你的主题")).toBeInTheDocument()
    expect(screen.queryByText("回复作者 赞了你的内容")).not.toBeInTheDocument()
    expect(listNotifications).toHaveBeenCalledTimes(1)
  })
})
