import userEvent from "@testing-library/user-event"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { governTopic, listModerationTopics, moderateTopic } from "../api/moderation"
import { ModerationAdminPanel } from "./ModerationAdminPanel"

vi.mock("../api/moderation", async () => {
  const actual = await vi.importActual<typeof import("../api/moderation")>("../api/moderation")
  return { ...actual, governTopic: vi.fn(), listModerationTopics: vi.fn(), moderateTopic: vi.fn() }
})

const board = {
  id: "019fc900-0000-7000-8000-000000000101",
  slug: "general",
  name: "社区广场",
  tone: "green" as const,
  capabilityKeys: ["moderation.topic", "moderation.topic.pin"],
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

describe("ModerationAdminPanel", () => {
  it("shows only scoped actions and removes a published topic after hiding it", async () => {
    const user = userEvent.setup()
    vi.mocked(listModerationTopics).mockResolvedValue({ topics: [topic], nextCursor: null })
    vi.mocked(moderateTopic).mockResolvedValue({ topicId: topic.id, status: "hidden" })

    render(<ModerationAdminPanel boards={[board]} csrfToken="csrf-token" />)

    expect(await screen.findByRole("heading", { name: "主题治理工作台" })).toBeInTheDocument()
    expect(screen.getByText(topic.title)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "隐藏" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "置顶" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "精选" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "锁定" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "隐藏" }))
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
    await user.click(await screen.findByRole("button", { name: "置顶" }))
    await user.click(screen.getByRole("button", { name: "确认置顶主题" }))

    expect(governTopic).toHaveBeenCalledWith(topic.id, { action: "pin", expectedRevision: 4, reason: undefined, targetBoardId: undefined }, "csrf-token")
    expect(await screen.findByText("已置顶")).toBeInTheDocument()
  })
})
