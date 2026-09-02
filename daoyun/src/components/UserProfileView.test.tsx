import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthSession } from "../api/auth"
import {
  changePassword,
  createRecentAuthentication,
  listDeviceSessions,
  listExternalIdentities,
  listOidcProviders,
  revokeDeviceSession,
} from "../api/auth"
import { createConversation } from "../api/messages"
import { setTopicBookmark } from "../api/relations"
import { listTopics } from "../api/topics"
import {
  getUserProfile,
  listUserRelations,
  setUserFollowing,
  updateUserProfile,
} from "../api/users"
import type { UserProfile } from "../api/users"
import { usePublicMembershipSummary } from "../features/membership/usePublicMembershipSummary"
import { UserProfileView } from "./UserProfileView"

vi.mock("../api/topics", () => ({ listTopics: vi.fn() }))
vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth")
  return {
    ...actual,
    changePassword: vi.fn(),
    createRecentAuthentication: vi.fn(),
    listDeviceSessions: vi.fn(),
    listExternalIdentities: vi.fn(),
    listOidcProviders: vi.fn(),
    revokeDeviceSession: vi.fn(),
  }
})
vi.mock("../api/messages", async () => {
  const actual = await vi.importActual<typeof import("../api/messages")>("../api/messages")
  return { ...actual, createConversation: vi.fn() }
})
vi.mock("../api/relations", async () => {
  const actual = await vi.importActual<typeof import("../api/relations")>("../api/relations")
  return { ...actual, setTopicBookmark: vi.fn() }
})
vi.mock("../api/users", async () => {
  const actual = await vi.importActual<typeof import("../api/users")>("../api/users")
  return {
    ...actual,
    getUserProfile: vi.fn(),
    listUserRelations: vi.fn(),
    setUserFollowing: vi.fn(),
    updateUserProfile: vi.fn(),
  }
})
vi.mock("../features/membership/usePublicMembershipSummary", () => ({
  usePublicMembershipSummary: vi.fn(),
}))

const profile: UserProfile = {
  id: "019fc800-0000-7000-8000-000000000002",
  username: "member",
  displayName: "社区成员",
  avatarUrl: null,
  bio: "保持好奇。",
  location: "杭州",
  websiteUrl: "https://example.com",
  profileRevision: 2,
  createdAt: "2026-08-03T10:00:00Z",
  topicCount: 1,
  followerCount: 4,
  followingCount: 5,
  viewer: {
    isSelf: false,
    isFollowing: false,
    isBlockedByViewer: false,
    canMessage: true,
  },
}

const session: AuthSession = {
  user: {
    id: "019fc800-0000-7000-8000-000000000001",
    username: "owner",
    email: "owner@example.com",
    displayName: "管理员",
  },
  csrfToken: "a".repeat(64),
}

const membershipSummary = {
  currentLevel: {
    id: "019fc800-0000-7000-8000-000000000501",
    internalKey: "explorer",
    levelOrder: 5,
    displayName: "探索者",
    requiredExperience: 600,
    iconAssetUrl: null,
    color: null,
    description: "持续参与社区讨论与分享。",
  },
  publicGroups: [{
    id: "019fc800-0000-7000-8000-000000000502",
    internalKey: "creator",
    displayName: "创作者",
    isPublic: true,
    expiresAt: null,
  }],
  medals: [{
    key: "first_share",
    displayName: "首发贡献",
    assetUrl: "/assets/medals/first-share.png",
    grantedAt: "2026-08-04T10:00:00Z",
    isPublic: true,
  }],
}

const topic = {
  id: "019fc800-0000-7000-8000-000000000101",
  title: "公开主题",
  excerpt: "主题摘要",
  board: "社区广场",
  boardTone: "green" as const,
  authorId: profile.id,
  authorUsername: profile.username,
  author: profile.displayName,
  avatarUrl: null,
  publishedAt: "刚刚",
  replies: 0,
  likes: 0,
  bookmarked: false,
  liked: false,
  views: 1,
  tags: [],
}

const secondTopic = {
  ...topic,
  id: "019fc800-0000-7000-8000-000000000102",
  title: "第二个公开主题",
}

beforeEach(() => {
  vi.mocked(usePublicMembershipSummary).mockReset().mockReturnValue(membershipSummary)
  vi.mocked(getUserProfile).mockReset().mockResolvedValue(profile)
  vi.mocked(listTopics).mockReset().mockResolvedValue({ topics: [topic], nextCursor: null })
  vi.mocked(listUserRelations).mockReset().mockResolvedValue({ users: [], nextCursor: null })
  vi.mocked(setUserFollowing).mockReset().mockResolvedValue({
    userId: profile.id,
    following: true,
    followerCount: 5,
    followingCount: 1,
  })
  vi.mocked(updateUserProfile).mockReset().mockResolvedValue(profile)
  vi.mocked(setTopicBookmark).mockReset().mockImplementation((topicId, bookmarked) => Promise.resolve({
    topicId,
    bookmarked,
  }))
  vi.mocked(createConversation).mockReset().mockResolvedValue({
    id: "019fc900-0000-7000-8000-000000000101",
    otherUser: {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    },
    lastMessage: null,
    unreadCount: 0,
    updatedAt: "2026-08-04T10:00:00Z",
  })
  vi.mocked(listDeviceSessions).mockReset().mockResolvedValue([])
  vi.mocked(listExternalIdentities).mockReset().mockResolvedValue([])
  vi.mocked(listOidcProviders).mockReset().mockResolvedValue([])
  vi.mocked(revokeDeviceSession).mockReset().mockResolvedValue(true)
  vi.mocked(createRecentAuthentication).mockReset().mockResolvedValue({
    authenticated: true,
    expiresAt: "2026-08-08T12:10:00Z",
  })
  vi.mocked(changePassword).mockReset().mockResolvedValue("b".repeat(64))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("UserProfileView", () => {
  it("creates a message conversation from a messageable profile", async () => {
    const user = userEvent.setup()
    const onOpenConversation = vi.fn()
    render(
      <UserProfileView
        username="member"
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
        onOpenConversation={onOpenConversation}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "私信" }))
    expect(createConversation).toHaveBeenCalledWith(profile.id, session.csrfToken)
    expect(onOpenConversation).toHaveBeenCalledWith(expect.objectContaining({
      id: "019fc900-0000-7000-8000-000000000101",
      otherUser: expect.objectContaining({ username: profile.username }),
    }))
  })

  it("keeps simultaneous profile bookmark requests isolated per topic", async () => {
    vi.mocked(listTopics).mockResolvedValue({ topics: [topic, secondTopic], nextCursor: null })
    let resolveFirst!: (value: { topicId: string; bookmarked: boolean }) => void
    let resolveSecond!: (value: { topicId: string; bookmarked: boolean }) => void
    vi.mocked(setTopicBookmark)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
    const user = userEvent.setup()
    render(
      <UserProfileView
        username="member"
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    const first = await screen.findByRole("button", { name: `收藏主题：${topic.title}` })
    const second = await screen.findByRole("button", { name: `收藏主题：${secondTopic.title}` })
    await user.click(first)
    await user.click(second)

    expect(first).toBeDisabled()
    expect(second).toBeDisabled()

    resolveFirst({ topicId: topic.id, bookmarked: true })
    await waitFor(() => expect(screen.getByRole("button", { name: `取消收藏主题：${topic.title}` })).not.toBeDisabled())
    expect(second).toBeDisabled()

    resolveSecond({ topicId: secondTopic.id, bookmarked: true })
    await waitFor(() => expect(screen.getByRole("button", { name: `取消收藏主题：${secondTopic.title}` })).not.toBeDisabled())
  })

  it("opens login instead of creating a conversation for a visitor", async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    render(
      <UserProfileView
        username="member"
        session={null}
        onBack={vi.fn()}
        onLogin={onLogin}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "私信" }))
    expect(onLogin).toHaveBeenCalledTimes(1)
    expect(createConversation).not.toHaveBeenCalled()
  })

  it("bookmarks a profile topic and updates its visible state", async () => {
    const user = userEvent.setup()
    render(
      <UserProfileView
        username="member"
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: `收藏主题：${topic.title}` }))
    expect(setTopicBookmark).toHaveBeenCalledWith(topic.id, true, session.csrfToken)
    expect(await screen.findByRole("button", { name: `取消收藏主题：${topic.title}` }))
      .toHaveAttribute("aria-pressed", "true")
  })

  it("loads the public profile and its authored topics", async () => {
    render(
      <UserProfileView
        username="member"
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(await screen.findByRole("heading", { name: "社区成员" })).toBeInTheDocument()
    expect(screen.getByText("保持好奇。")).toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "公开主题" })).toBeInTheDocument()
    expect(listTopics).toHaveBeenCalledWith(expect.objectContaining({
      author: "member",
      signal: expect.any(AbortSignal),
    }))
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "仅自己可见的账号管理" })).not.toBeInTheDocument()
  })

  it("presents public growth, groups, and medals as one community identity asset", async () => {
    render(
      <UserProfileView
        username="member"
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    const identity = await screen.findByRole("region", { name: "社区身份" })
    expect(within(identity).getByRole("heading", { name: "探索者" })).toBeInTheDocument()
    expect(identity).toHaveTextContent("持续参与社区讨论与分享。")
    expect(identity).toHaveTextContent("创作者")
    expect(identity).toHaveTextContent("首发贡献")
    expect(identity).not.toHaveTextContent("explorer")
    expect(identity).not.toHaveTextContent("creator")
  })

  it("keeps account security controls in a self-only profile region", async () => {
    const ownProfile: UserProfile = {
      ...profile,
      viewer: { ...profile.viewer!, isSelf: true },
    }
    vi.mocked(getUserProfile).mockResolvedValue(ownProfile)
    render(
      <UserProfileView
        username="member"
        session={{ ...session, user: { ...session.user, id: profile.id, username: "member" } }}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    const accountTools = await screen.findByRole("region", { name: "仅自己可见的账号管理" })
    expect(within(accountTools).getByRole("heading", { name: "账号与安全" })).toBeInTheDocument()
    for (const name of ["管理设备会话", "修改密码", "登录方式", "通行密钥", "多因素认证"]) {
      expect(within(accountTools).getByRole("button", { name })).toBeInTheDocument()
    }
  })

  it("follows the profile and updates the visible follower count", async () => {
    const user = userEvent.setup()
    render(
      <UserProfileView
        username="member"
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "关注" }))
    expect(setUserFollowing).toHaveBeenCalledWith(
      profile.id,
      true,
      session.csrfToken,
    )
    expect(screen.getByRole("button", { name: "已关注" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "5 位关注者" })).toBeInTheDocument()
  })

  it("edits the current user's public fields with the loaded revision", async () => {
    const user = userEvent.setup()
    const ownProfile: UserProfile = {
      ...profile,
      viewer: { ...profile.viewer!, isSelf: true },
    }
    vi.mocked(getUserProfile).mockResolvedValue(ownProfile)
    vi.mocked(updateUserProfile).mockResolvedValue({
      ...ownProfile,
      displayName: "新名称",
      profileRevision: 3,
    })
    render(
      <UserProfileView
        username="member"
        session={{ ...session, user: { ...session.user, id: profile.id, username: "member" } }}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "编辑资料" }))
    const nameInput = screen.getByRole("textbox", { name: "显示名称" })
    await user.clear(nameInput)
    await user.type(nameInput, "新名称")
    await user.click(screen.getByRole("button", { name: "保存资料" }))

    expect(updateUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ baseRevision: 2, displayName: "新名称" }),
      session.csrfToken,
    )
    expect(await screen.findByRole("heading", { name: "新名称" })).toBeInTheDocument()
  })

  it("verifies the current password before changing it and updates the session CSRF token", async () => {
    const user = userEvent.setup()
    const ownProfile: UserProfile = {
      ...profile,
      viewer: { ...profile.viewer!, isSelf: true },
    }
    vi.mocked(getUserProfile).mockResolvedValue(ownProfile)
    const onSessionChange = vi.fn()
    render(
      <UserProfileView
        username="member"
        session={{ ...session, user: { ...session.user, id: profile.id, username: "member" } }}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
        onSessionChange={onSessionChange}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "修改密码" }))
    await user.type(screen.getByLabelText("当前密码"), "correct horse battery staple")
    await user.type(screen.getByLabelText("新密码"), "new secure password")
    await user.type(screen.getByLabelText("确认新密码"), "new secure password")
    await user.click(screen.getByRole("button", { name: "更新密码" }))

    expect(createRecentAuthentication).toHaveBeenCalledWith(
      "correct horse battery staple",
      session.csrfToken,
    )
    expect(changePassword).toHaveBeenCalledWith("new secure password", session.csrfToken)
    expect(onSessionChange).toHaveBeenCalledWith(expect.objectContaining({
      csrfToken: "b".repeat(64),
    }))
    expect(await screen.findByRole("status")).toHaveTextContent("密码已更新")
  })

  it("opens external identity settings for the current user after an OIDC return", async () => {
    const ownProfile: UserProfile = {
      ...profile,
      viewer: { ...profile.viewer!, isSelf: true },
    }
    vi.mocked(getUserProfile).mockResolvedValue(ownProfile)
    vi.mocked(listOidcProviders).mockResolvedValue([{
      providerKey: "google",
      displayName: "Google",
    }])
    render(
      <UserProfileView
        username="member"
        session={{ ...session, user: { ...session.user, id: profile.id, username: "member" } }}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
        openExternalIdentities
      />,
    )

    expect(await screen.findByRole("heading", { name: "登录方式" })).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "绑定 Google 身份" })).toBeInTheDocument()
  })

  it("lists and revokes another device session from the current user's profile", async () => {
    const user = userEvent.setup()
    const ownProfile: UserProfile = {
      ...profile,
      viewer: { ...profile.viewer!, isSelf: true },
    }
    const otherSessionId = "019fc800-0000-7000-8000-000000000099"
    vi.mocked(getUserProfile).mockResolvedValue(ownProfile)
    vi.mocked(listDeviceSessions).mockResolvedValue([
      {
        id: "019fc800-0000-7000-8000-000000000098",
        deviceLabel: "当前设备",
        createdAt: "2026-08-07T10:00:00Z",
        lastSeenAt: "2026-08-07T10:10:00Z",
        isCurrent: true,
      },
      {
        id: otherSessionId,
        deviceLabel: "Windows 设备",
        createdAt: "2026-08-06T10:00:00Z",
        lastSeenAt: "2026-08-06T10:10:00Z",
        isCurrent: false,
      },
    ])
    render(
      <UserProfileView
        username="member"
        session={{ ...session, user: { ...session.user, id: profile.id, username: "member" } }}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "管理设备会话" }))
    expect(await screen.findByText("当前设备")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "当前会话" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "撤销会话：Windows 设备" }))
    expect(screen.getByRole("alertdialog", { name: "确认撤销设备会话" })).toBeInTheDocument()
    const confirm = screen.getByRole("button", { name: "确认撤销" })
    expect(confirm).toHaveFocus()
    await user.click(confirm)

    expect(revokeDeviceSession).toHaveBeenCalledWith(otherSessionId, session.csrfToken)
    expect(await screen.findByText("设备会话已撤销")).toBeInTheDocument()
  })

  it("loads public follower rows from the selected relationship tab", async () => {
    const user = userEvent.setup()
    vi.mocked(listUserRelations).mockResolvedValue({
      users: [{
        id: session.user.id,
        username: session.user.username,
        displayName: session.user.displayName,
        avatarUrl: null,
      }],
      nextCursor: null,
    })
    render(
      <UserProfileView
        username="member"
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("tab", { name: "关注者" }))
    expect(await screen.findByText("管理员")).toBeInTheDocument()
    expect(listUserRelations).toHaveBeenCalledWith(
      "member",
      "followers",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("reloads viewer-specific relationship state after authentication changes", async () => {
    const user = userEvent.setup()
    vi.mocked(getUserProfile)
      .mockResolvedValueOnce({ ...profile, viewer: null })
      .mockResolvedValueOnce({
        ...profile,
        viewer: { ...profile.viewer!, isFollowing: true },
      })
    const view = render(
      <UserProfileView
        username="member"
        session={null}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "关注" }))
    view.rerender(
      <UserProfileView
        username="member"
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    expect(await screen.findByRole("button", { name: "已关注" })).toBeInTheDocument()
    expect(getUserProfile).toHaveBeenCalledTimes(2)
  })

  it("retries a failed relationship list request", async () => {
    const user = userEvent.setup()
    vi.mocked(listUserRelations)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({
        users: [{
          id: session.user.id,
          username: session.user.username,
          displayName: session.user.displayName,
          avatarUrl: null,
        }],
        nextCursor: null,
      })
    render(
      <UserProfileView
        username="member"
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("tab", { name: "关注者" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("关系列表暂时无法加载")
    await user.click(screen.getByRole("button", { name: "重试加载关系" }))

    expect(await screen.findByText("管理员")).toBeInTheDocument()
    expect(listUserRelations).toHaveBeenCalledTimes(2)
  })
})
