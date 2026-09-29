import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RightSidebar } from "./RightSidebar"

afterEach(cleanup)

describe("RightSidebar home", () => {
  it("keeps the signed-in member summary and compose action visible", () => {
    render(
      <RightSidebar
        variant="home"
        topics={[]}
        boards={[{
          id: "019fc700-0000-7000-8000-000000000010",
          parentId: null,
          slug: "general",
          name: "社区广场",
          description: "分享社区动态",
          icon: "messages",
          tone: "blue",
          position: 1,
          depth: 0,
          childCount: 0,
          topicCount: 19,
        }]}
        session={{
          user: {
            id: "019fc700-0000-7000-8000-000000000004",
            username: "member",
            email: "member@example.com",
            displayName: "北岛",
          },
          csrfToken: "a".repeat(64),
        }}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(screen.getByRole("heading", { name: "你好，北岛" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发布主题" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "活跃版块" })).not.toBeInTheDocument()
  })

  it("shows the signed-in member growth level and progress to the next level", () => {
    render(
      <RightSidebar
        variant="home"
        topics={[]}
        boards={[]}
        session={{
          user: {
            id: "019fc700-0000-7000-8000-000000000004",
            username: "member",
            email: "member@example.com",
            displayName: "北岛",
          },
          csrfToken: "a".repeat(64),
        }}
        membershipExperience={{
          experience: 220,
          level: {
            id: "019fc800-0000-7000-8000-000000000021",
            internalKey: "traveler",
            levelOrder: 3,
            displayName: "行者",
            requiredExperience: 140,
            iconAssetUrl: null,
            color: null,
            description: "持续参与社区讨论",
          },
          nextLevel: {
            id: "019fc800-0000-7000-8000-000000000022",
            internalKey: "pathfinder",
            levelOrder: 4,
            displayName: "开拓者",
            requiredExperience: 340,
            iconAssetUrl: null,
            color: null,
            description: "发现更多社区内容",
          },
        }}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(screen.getByText("Lv.3")).toHaveAccessibleName("成长等级：行者")
    expect(screen.getByText("220 / 340")).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "成长等级进度" })).toHaveAttribute("value", "80")
    expect(screen.getByRole("progressbar", { name: "成长等级进度" })).toHaveAttribute("max", "200")
  })
})

describe("RightSidebar board directory", () => {
  it("shows useful board discovery panels without duplicating the main directory", () => {
    render(
      <RightSidebar
        variant="boardDirectory"
        topics={[{
          id: "019fc700-0000-7000-8000-000000000020",
          title: "欢迎来到社区",
          excerpt: "从这里开始参与讨论",
          board: "社区广场",
          boardSlug: "general",
          boardTone: "blue",
          authorId: "019fc700-0000-7000-8000-000000000021",
          authorUsername: "member",
          author: "北岛",
          avatarUrl: null,
          publishedAt: "刚刚",
          replies: 8,
          likes: 12,
          bookmarked: false,
          liked: false,
          views: 64,
          imageUrl: undefined,
          tags: [],
        }]}
        boards={[{
          id: "019fc700-0000-7000-8000-000000000010",
          parentId: null,
          slug: "general",
          name: "社区广场",
          description: "分享社区动态",
          icon: "messages",
          tone: "blue",
          position: 1,
          depth: 0,
          childCount: 0,
          topicCount: 19,
        }]}
        session={null}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(screen.getByRole("heading", { name: "热门版块" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "推荐话题" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "社区数据" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /社区广场/ })).toHaveAttribute("href", "#board/general")
    expect(screen.getByRole("button", { name: "打开话题：欢迎来到社区" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "版块指南" })).not.toBeInTheDocument()
  })
})

describe("RightSidebar board detail", () => {
  it("uses real board capabilities and topics for the detail sidebar", () => {
    render(
      <RightSidebar
        variant="boardDetail"
        topics={[{
          id: "019fc700-0000-7000-8000-000000000030",
          title: "欢迎来到技术社区",
          excerpt: "一起分享实践经验",
          board: "技术分享",
          boardSlug: "technology",
          boardTone: "blue",
          authorId: "019fc700-0000-7000-8000-000000000031",
          authorUsername: "engineer",
          author: "程序员小北",
          avatarUrl: null,
          publishedAt: "刚刚",
          replies: 18,
          likes: 42,
          bookmarked: false,
          liked: false,
          views: 320,
          tags: [],
        }]}
        boards={[]}
        currentBoard={{
          id: "019fc700-0000-7000-8000-000000000032",
          parentId: null,
          slug: "technology",
          name: "技术分享",
          description: "编程开发、技术教程、经验分享",
          icon: "code",
          tone: "blue",
          position: 1,
          depth: 0,
          childCount: 0,
          topicCount: 128,
          children: [],
          breadcrumb: [{ id: "019fc700-0000-7000-8000-000000000032", slug: "technology", name: "技术分享" }],
          viewer: { canRead: true, canCreateTopic: true, canReply: true, canUploadAttachment: false },
        }}
        session={null}
        onCompose={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(screen.getByRole("heading", { name: "技术分享" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "版块规则 · 发帖须知" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "本版热议" })).toBeInTheDocument()
    expect(screen.getByText("发布时暂不支持上传附件")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "欢迎来到技术社区" })).toHaveAttribute(
      "href",
      "#topic/019fc700-0000-7000-8000-000000000030",
    )
    expect(screen.queryByRole("heading", { name: "版块信息" })).not.toBeInTheDocument()
  })
})
