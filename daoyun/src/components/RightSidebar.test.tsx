import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AuthSession } from "../api/auth"
import type { BoardDetail } from "../api/boards"
import type { Board, Topic } from "../types/community"
import { RightSidebar } from "./RightSidebar"

const session: AuthSession = {
  user: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

const board: Board = {
  id: "019fc800-0000-7000-8000-000000000201",
  parentId: null,
  slug: "design",
  name: "设计交流",
  description: "分享设计过程",
  icon: "layout",
  tone: "rose",
  position: 1,
  depth: 0,
  childCount: 0,
  topicCount: 86,
}

const boardDetail: BoardDetail = {
  ...board,
  children: [{ ...board, id: "019fc800-0000-7000-8000-000000000202", slug: "typography", name: "字体排印", parentId: board.id, topicCount: 11 }],
  breadcrumb: [{ id: board.id, slug: board.slug, name: board.name }],
  viewer: { canRead: true, canCreateTopic: true, canReply: true, canUploadAttachment: false },
}

const topic: Topic = {
  id: "019fc800-0000-7000-8000-000000000203",
  title: "让版面层级更清楚",
  excerpt: "使用真实的本版主题数据。",
  board: board.name,
  boardSlug: board.slug,
  boardTone: board.tone,
  authorId: session.user.id,
  authorUsername: session.user.username,
  author: session.user.displayName,
  avatarUrl: null,
  publishedAt: "刚刚",
  replies: 6,
  likes: 12,
  bookmarked: false,
  liked: false,
  views: 128,
  tags: [],
}

afterEach(cleanup)

describe("RightSidebar", () => {
  it("surfaces real active communities", () => {
    render(
      <RightSidebar
        topics={[]}
        boards={[board]}
        session={null}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(screen.getByRole("heading", { name: "活跃社区" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /设计交流/ })).toHaveAttribute("href", "#board/design")
    expect(screen.getByText("86 个主题")).toBeInTheDocument()
  })

  it("uses a board-directory sidebar without simulated creation or follow actions", () => {
    render(
      <RightSidebar
        variant="boardDirectory"
        topics={[]}
        boards={[board]}
        session={null}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(screen.getByRole("heading", { name: "版块指南" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "活跃版块" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /设计交流/ })).toHaveAttribute("href", "#board/design")
    expect(screen.queryByRole("button", { name: /创建|关注/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "今日热帖" })).not.toBeInTheDocument()
  })

  it("uses current-board data for the board detail sidebar", () => {
    render(
      <RightSidebar
        variant="boardDetail"
        topics={[topic]}
        boards={[board]}
        currentBoard={boardDetail}
        session={session}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(screen.getByRole("complementary", { name: "当前版块信息" })).toHaveTextContent("设计交流")
    expect(screen.getByText("86 个主题")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /字体排印/ })).toHaveAttribute("href", "#board/typography")
    expect(screen.getByRole("heading", { name: "本版主题" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "让版面层级更清楚" })).toHaveAttribute("href", `#topic/${topic.id}`)
    expect(screen.queryByRole("heading", { name: "今日热帖" })).not.toBeInTheDocument()
    for (const unavailableLabel of ["版主", "创建时间", "今日主题"]) {
      expect(screen.queryByText(unavailableLabel, { exact: true })).not.toBeInTheDocument()
    }
  })

  it("uses the current topic author and real counters in the topic detail sidebar", () => {
    render(
      <RightSidebar
        variant="topicDetail"
        topics={[topic, { ...topic, id: "019fc800-0000-7000-8000-000000000204", title: "另一条真实主题" }]}
        boards={[board]}
        currentTopic={topic}
        session={null}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    const sidebar = screen.getByRole("complementary", { name: "帖子相关信息" })
    expect(within(sidebar).getByRole("heading", { name: "作者信息" })).toBeInTheDocument()
    expect(within(sidebar).getByRole("link", { name: `查看 ${topic.author} 的主页` }))
      .toHaveAttribute("href", `#user/${topic.authorUsername}`)
    expect(sidebar).toHaveTextContent(`@${topic.authorUsername}`)
    expect(sidebar).toHaveTextContent(`${topic.replies} 回复`)
    expect(sidebar).toHaveTextContent(`${topic.likes} 点赞`)
    expect(sidebar).toHaveTextContent(`${topic.views} 浏览`)
    expect(within(sidebar).getByRole("link", { name: /设计交流/ })).toHaveAttribute("href", "#board/design")
    expect(within(sidebar).getByRole("link", { name: "另一条真实主题" })).toBeInTheDocument()
    expect(within(sidebar).queryByText("粉丝", { exact: true })).not.toBeInTheDocument()
  })

  it("shows the authenticated user's real identity and profile link", () => {
    render(
      <RightSidebar
        topics={[]}
        session={session}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(screen.getByRole("link", { name: "查看我的个人主页" }))
      .toHaveAttribute("href", "#user/member")
    expect(screen.getByText("社区成员")).toBeInTheDocument()
    expect(screen.queryByText("12,680")).not.toBeInTheDocument()
  })

  it("offers login instead of simulated profile data to signed-out visitors", async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    render(
      <RightSidebar
        topics={[]}
        session={null}
        onCompose={vi.fn()}
        onLogin={onLogin}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "登录" }))
    expect(onLogin).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("林屿")).not.toBeInTheDocument()
  })
})
