import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { App } from "./App"
import {
  getCurrentSession,
  getOidcClaim,
  listExternalIdentities,
  listOidcProviders,
  login,
  bindOidcClaim,
  createOidcClaimAccount,
  createRecentAuthentication,
  logout,
} from "./api/auth"
import { getBoard, listBoards } from "./api/boards"
import { getPublicSiteBranding } from "./api/branding"
import { listFeed } from "./api/feed"
import { getAdminAccess } from "./api/admin"
import { listModerationBoards } from "./api/moderation"
import { createReply, createTopic, getTopic, listReplies, listTags, listTopics } from "./api/topics"
import type { ListTopicsOptions } from "./api/topics"
import { getUserProfile, listUserRelations } from "./api/users"
import { listBookmarks, setPostLike, setTopicBookmark } from "./api/relations"
import { createConversation, listConversations, listMessages, markConversationRead } from "./api/messages"
import {
  getInstallationStatus,
  initializeInstallation,
  InstallationApiError,
} from "./api/installation"
import type { Board } from "./types/community"
import { rememberOidcSettingsReturn } from "./utils/oidcSettingsReturn"

vi.mock("./api/boards", () => ({
  listBoards: vi.fn(),
  getBoard: vi.fn(),
  BoardApiError: class BoardApiError extends Error {
    constructor(readonly message: string, readonly status: number, readonly code: string) {
      super(message)
    }
  },
}))

vi.mock("./api/branding", () => ({
  getPublicSiteBranding: vi.fn(),
}))

vi.mock("./api/admin", async () => {
  const actual = await vi.importActual<typeof import("./api/admin")>("./api/admin")
  return { ...actual, getAdminAccess: vi.fn() }
})

vi.mock("./api/moderation", async () => {
  const actual = await vi.importActual<typeof import("./api/moderation")>("./api/moderation")
  return { ...actual, listModerationBoards: vi.fn() }
})

vi.mock("./components/AdminView", () => ({
  AdminView: ({ requestedTab, requestedQuery, onTabChange, onQueryChange }: { requestedTab?: string | null; requestedQuery?: string; onTabChange: (tab: string) => void; onQueryChange: (query: string) => void }) => (
    <section data-testid="site-admin-view" data-requested-tab={requestedTab ?? ""} data-requested-query={requestedQuery ?? ""}>
      <h1>站点管理</h1>
      <button type="button" onClick={() => { onTabChange("reports"); onQueryChange("status=open&report_id=019fc900-0000-7000-8000-000000000802") }}>打开举报待办</button>
    </section>
  ),
}))

vi.mock("./api/feed", () => ({
  listFeed: vi.fn(),
}))

vi.mock("./api/topics", () => ({
  listTopics: vi.fn(),
  listTags: vi.fn(),
  createTopic: vi.fn(),
  getTopic: vi.fn(),
  listReplies: vi.fn(),
  createReply: vi.fn(),
}))

vi.mock("./api/relations", async () => {
  const actual = await vi.importActual<typeof import("./api/relations")>("./api/relations")
  return {
    ...actual,
    listBookmarks: vi.fn(),
    setPostLike: vi.fn(),
    setTopicBookmark: vi.fn(),
  }
})

vi.mock("./api/messages", async () => {
  const actual = await vi.importActual<typeof import("./api/messages")>("./api/messages")
  return {
    ...actual,
    archiveConversation: vi.fn(),
    createConversation: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
    markConversationRead: vi.fn(),
    sendMessage: vi.fn(),
  }
})

vi.mock("./api/users", async () => {
  const actual = await vi.importActual<typeof import("./api/users")>("./api/users")
  return {
    ...actual,
    getUserProfile: vi.fn(),
    listUserRelations: vi.fn(),
    setUserFollowing: vi.fn(),
    updateUserProfile: vi.fn(),
  }
})

vi.mock("./api/installation", async () => {
  const actual = await vi.importActual<typeof import("./api/installation")>("./api/installation")
  return {
    ...actual,
    getInstallationStatus: vi.fn(),
    initializeInstallation: vi.fn(),
  }
})

vi.mock("./api/auth", async () => {
  const actual = await vi.importActual<typeof import("./api/auth")>("./api/auth")
  return {
    ...actual,
    getCurrentSession: vi.fn(),
    getOidcClaim: vi.fn(),
    bindOidcClaim: vi.fn(),
    createOidcClaimAccount: vi.fn(),
    createRecentAuthentication: vi.fn(),
    listExternalIdentities: vi.fn(),
    listOidcProviders: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
  }
})

const boardFixtures: Board[] = [
  {
    id: "019fc630-0000-7000-8000-000000000001",
    parentId: null,
    slug: "engineering",
    name: "工程实践",
    description: "Rust、架构与部署",
    icon: "code",
    tone: "green",
    position: 10,
    depth: 0,
    childCount: 0,
    topicCount: 12,
  },
]

const topicFixtures = [
  {
    id: "019fc800-0000-7000-8000-000000000101",
    title: "用 Rust 构建社区平台，我们为什么选择模块化单体",
    excerpt: "从领域边界、事务一致性到后续拆分路径，整理刀云第一阶段的架构取舍。",
    board: "工程实践",
    boardTone: "green" as const,
    authorId: "019fc700-0000-7000-8000-000000000004",
    authorUsername: "member",
    author: "林屿",
    avatarUrl: "https://example.com/avatar-1.png",
    publishedAt: "12 分钟前",
    replies: 28,
    likes: 96,
    bookmarked: false,
    liked: false,
    views: 1284,
    hot: true,
    followed: false,
    pinned: true,
    tags: [{ slug: "rust", name: "Rust" }],
  },
  {
    id: "019fc800-0000-0000-8000-000000000102",
    title: "富文本编辑器的协作草稿方案已经开放讨论",
    excerpt: "当前先统一文档模型、附件引用和版本记录，再决定实时协作的同步协议。",
    board: "产品设计",
    boardTone: "blue" as const,
    authorId: "019fc700-0000-7000-8000-000000000005",
    authorUsername: "nanxing",
    author: "南星",
    avatarUrl: "https://example.com/avatar-2.png",
    publishedAt: "38 分钟前",
    replies: 17,
    likes: 52,
    bookmarked: false,
    liked: false,
    views: 746,
    followed: false,
    tags: [{ slug: "collaboration", name: "协作" }],
  },
  {
    id: "019fc800-0000-0000-8000-000000000103",
    title: "刀云设计系统：让品牌配置保持克制而有辨识度",
    excerpt: "主题不应该接管产品结构。我们用语义颜色、密度和少量预设覆盖常见品牌需求。",
    board: "产品设计",
    boardTone: "rose" as const,
    authorId: "019fc700-0000-7000-8000-000000000006",
    authorUsername: "zhaoye",
    author: "昭野",
    avatarUrl: "https://example.com/avatar-3.png",
    publishedAt: "1 小时前",
    replies: 41,
    likes: 138,
    bookmarked: false,
    liked: false,
    views: 2350,
    featured: true,
    tags: [{ slug: "design", name: "设计" }],
  },
]

const brandingFixture = {
  siteName: "刀云",
  logoUrl: null,
  faviconUrl: null,
  defaultCoverUrl: null,
  navigationLinks: [],
  footerText: null,
  footerLinks: [],
  primaryColor: "#2f7bff",
  accentColor: "#c85516",
  themePreset: "default" as const,
  listDensity: "comfortable" as const,
  homeMode: "latest" as const,
}

beforeEach(() => {
  vi.mocked(listBoards).mockReset()
  vi.mocked(listBoards).mockReturnValue(new Promise(() => {}))
  vi.mocked(getBoard).mockReset()
  vi.mocked(getPublicSiteBranding).mockReset().mockResolvedValue(brandingFixture)
  vi.mocked(getAdminAccess).mockReset().mockResolvedValue({ capabilityKeys: [] })
  vi.mocked(listModerationBoards).mockReset().mockResolvedValue([])
  vi.mocked(listTopics).mockReset()
  vi.mocked(listTopics).mockImplementation((options: ListTopicsOptions = {}) => {
    const normalizedQuery = options.query?.trim().toLocaleLowerCase("zh-CN") ?? ""
    const filtered = topicFixtures.filter((topic) => {
      const text = `${topic.title} ${topic.excerpt} ${topic.board} ${topic.author}`.toLocaleLowerCase("zh-CN")
      return (!normalizedQuery || text.includes(normalizedQuery))
        && (!options.tag || topic.tags.some((tag) => tag.slug === options.tag))
        && (!options.featured || topic.featured === true)
    })
    return Promise.resolve({ topics: filtered, nextCursor: null })
  })
  vi.mocked(listFeed).mockReset().mockImplementation((mode, options = {}) => listTopics({
    cursor: options.cursor,
    limit: options.limit,
    signal: options.signal,
    sort: mode === "recommended" ? "popular" : "latest",
    scope: mode === "following" ? "following" : undefined,
  }))
  vi.mocked(createTopic).mockReset()
  vi.mocked(listTags).mockReset().mockResolvedValue([])
  vi.mocked(getTopic).mockReset().mockResolvedValue({
    ...topicFixtures[0],
    content: "完整主题正文",
    authorId: "019fc700-0000-7000-8000-000000000004",
    authorUsername: "member",
    contentRevision: 1,
    hasLockedContent: false,
  })
  vi.mocked(listReplies).mockReset().mockResolvedValue({ replies: [], nextCursor: null })
  vi.mocked(createReply).mockReset()
  vi.mocked(getInstallationStatus).mockReset()
  vi.mocked(getInstallationStatus).mockResolvedValue({ isInitialized: true })
  vi.mocked(initializeInstallation).mockReset()
  vi.mocked(getCurrentSession).mockReset()
  vi.mocked(getCurrentSession).mockResolvedValue(null)
  vi.mocked(getOidcClaim).mockReset()
  vi.mocked(bindOidcClaim).mockReset()
  vi.mocked(createOidcClaimAccount).mockReset()
  vi.mocked(createRecentAuthentication).mockReset()
  vi.mocked(listExternalIdentities).mockReset().mockResolvedValue([])
  vi.mocked(listOidcProviders).mockReset().mockResolvedValue([])
  vi.mocked(login).mockReset()
  vi.mocked(logout).mockReset()
  vi.mocked(getUserProfile).mockReset().mockResolvedValue({
    id: topicFixtures[0].authorId,
    username: topicFixtures[0].authorUsername,
    displayName: topicFixtures[0].author,
    avatarUrl: topicFixtures[0].avatarUrl,
    bio: "公开简介",
    location: null,
    websiteUrl: null,
    profileRevision: 1,
    createdAt: "2026-08-03T10:00:00Z",
    topicCount: 1,
    followerCount: 0,
    followingCount: 0,
    viewer: null,
  })
  vi.mocked(listUserRelations).mockReset().mockResolvedValue({ users: [], nextCursor: null })
  vi.mocked(listBookmarks).mockReset().mockResolvedValue({
    topics: [{ ...topicFixtures[0], bookmarked: true }],
    nextCursor: null,
  })
  vi.mocked(setTopicBookmark).mockReset().mockImplementation((topicId, bookmarked) => Promise.resolve({
    topicId,
    bookmarked,
  }))
  vi.mocked(setPostLike).mockReset().mockImplementation((postId, liked) => Promise.resolve({
    postId,
    liked,
    likeCount: liked ? 97 : 96,
  }))
  vi.mocked(listConversations).mockReset().mockResolvedValue({ conversations: [], nextCursor: null })
  vi.mocked(listMessages).mockReset().mockResolvedValue({ messages: [], nextCursor: null })
  vi.mocked(markConversationRead).mockReset()
  vi.mocked(createConversation).mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.brandPreset
  delete document.documentElement.dataset.listDensity
  document.documentElement.removeAttribute("style")
  document.title = "刀云社区"
  document.querySelector('link[data-daoyun-favicon="true"]')?.remove()
  window.location.hash = ""
})

describe("DaoYun community home", () => {
  it("renders an admin module hash as a standalone site administration page", async () => {
    window.location.hash = "#admin/reports?status=open"
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "019fc700-0000-7000-8000-000000000004", username: "admin", email: "admin@example.com", displayName: "管理员" },
      csrfToken: "a".repeat(64),
    })

    render(<App />)

    expect(await screen.findByTestId("site-admin-view")).toHaveAttribute("data-requested-tab", "reports")
    expect(screen.getByTestId("site-admin-view")).toHaveAttribute("data-requested-query", "status=open")
    expect(screen.queryByRole("navigation", { name: "常用社区" })).not.toBeInTheDocument()
    expect(listBoards).not.toHaveBeenCalled()
    expect(listTopics).not.toHaveBeenCalled()
  })

  it("keeps a dashboard task query on the destination admin module", async () => {
    window.location.hash = "#admin/dashboard"
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "019fc700-0000-7000-8000-000000000004", username: "admin", email: "admin@example.com", displayName: "管理员" },
      csrfToken: "a".repeat(64),
    })
    render(<App />)

    await userEvent.setup().click(await screen.findByRole("button", { name: "打开举报待办" }))
    await waitFor(() => expect(window.location.hash).toBe("#admin/reports?status=open&report_id=019fc900-0000-7000-8000-000000000802"))
  })

  it("does not keep the retired management workspace as a separate route", async () => {
    window.location.hash = "#management"

    render(<App />)

    expect(screen.queryByTestId("site-admin-view")).not.toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "社区动态" })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "常用社区" })).toBeInTheDocument()
  })

  it("renders the OIDC claim completion flow at its dedicated hash route", async () => {
    vi.mocked(getOidcClaim).mockResolvedValue({
      providerKey: "google",
      providerDisplayName: "Google",
      profileName: "社区成员",
      preferredUsername: "member",
      emailHint: "m***@example.com",
    })
    window.location.hash = "#oidc-claim"

    render(<App />)

    expect(await screen.findByRole("heading", { name: "确认 Google 身份" })).toBeInTheDocument()
    expect(getOidcClaim).toHaveBeenCalledTimes(1)
  })

  it("restores the current user's external identity settings after an OIDC callback", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: topicFixtures[0].authorId,
        username: topicFixtures[0].authorUsername,
        email: "member@example.com",
        displayName: topicFixtures[0].author,
      },
      csrfToken: "b".repeat(64),
    })
    vi.mocked(getUserProfile).mockResolvedValue({
      id: topicFixtures[0].authorId,
      username: topicFixtures[0].authorUsername,
      displayName: topicFixtures[0].author,
      avatarUrl: topicFixtures[0].avatarUrl,
      bio: "公开简介",
      location: null,
      websiteUrl: null,
      profileRevision: 1,
      createdAt: "2026-08-03T10:00:00Z",
      topicCount: 1,
      followerCount: 0,
      followingCount: 0,
      viewer: {
        isSelf: true,
        isFollowing: false,
        isBlockedByViewer: false,
        canMessage: false,
      },
    })
    rememberOidcSettingsReturn("member")

    render(<App />)

    expect(await screen.findByRole("heading", { name: "登录方式" })).toBeInTheDocument()
    expect(window.location.hash).toBe("#user/member")
    expect(sessionStorage.getItem("daoyun-oidc-settings-return")).toBeNull()
  })

  it("applies public branding to the document and wordmark", async () => {
    vi.mocked(getPublicSiteBranding).mockResolvedValue({
      ...brandingFixture,
      siteName: "天际社区",
      logoUrl: "https://cdn.example.com/logo.svg",
      faviconUrl: "https://cdn.example.com/favicon.ico",
      defaultCoverUrl: "https://cdn.example.com/default-cover.webp",
      navigationLinks: [{ label: "文档中心", url: "/docs" }],
      footerText: "天际自托管社区",
      footerLinks: [{ label: "隐私", url: "#privacy" }],
      primaryColor: "#123456",
      accentColor: "#c2410c",
      themePreset: "compact",
      listDensity: "compact",
      homeMode: "hot",
    })

    render(<App />)

    expect(await screen.findByRole("link", { name: "天际社区首页" })).toBeInTheDocument()
    expect(document.querySelector(".wordmark__text")).toHaveTextContent("天际社区")
    expect(document.querySelector(".brand-mark img")).toHaveAttribute("src", "https://cdn.example.com/logo.svg")
    expect(screen.getByRole("link", { name: "文档中心" })).toHaveAttribute("href", "/docs")
    expect(screen.getByText("天际自托管社区")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "隐私" })).toHaveAttribute("href", "#privacy")
    expect(document.querySelector(".topic-row")).toHaveAttribute("data-layout", "discussion")
    expect(document.querySelector('.topic-cover img[src="https://cdn.example.com/default-cover.webp"]')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-brand-preset", "compact")
      expect(document.documentElement).toHaveAttribute("data-list-density", "compact")
      expect(document.documentElement.style.getPropertyValue("--brand")).toBe("#123456")
      expect(document.documentElement.style.getPropertyValue("--brand-hover")).toBe("color-mix(in srgb, #123456 88%, #000)")
      expect(document.documentElement.style.getPropertyValue("--brand-active")).toBe("color-mix(in srgb, #123456 78%, #000)")
      expect(document.documentElement.style.getPropertyValue("--brand-foreground")).toBe("#ffffff")
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#c2410c")
    })
    expect(document.title).toBe("天际社区")
    expect(document.querySelector('link[data-daoyun-favicon="true"]')).toHaveAttribute("href", "https://cdn.example.com/favicon.ico")
  })

  it("keeps the clear community blue companion tokens theme-aware", async () => {
    vi.mocked(getPublicSiteBranding).mockResolvedValue({
      ...brandingFixture,
      primaryColor: "#2F7BFF",
    })

    render(<App />)

    await screen.findByRole("heading", { name: "社区动态" })
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--brand")).toBe("#2F7BFF"))
    expect(document.documentElement.style.getPropertyValue("--brand-hover")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--brand-active")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--brand-strong")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--brand-soft")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--brand-foreground")).toBe("")
  })

  it("bookmarks a feed topic for the authenticated user", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: topicFixtures[0].authorId,
        username: topicFixtures[0].authorUsername,
        email: "member@example.com",
        displayName: topicFixtures[0].author,
      },
      csrfToken: "a".repeat(64),
    })
    const user = userEvent.setup()
    render(<App />)

    const bookmark = await screen.findByRole("button", { name: `收藏主题：${topicFixtures[0].title}` })
    await user.click(bookmark)

    expect(setTopicBookmark).toHaveBeenCalledWith(topicFixtures[0].id, true, "a".repeat(64))
    expect(await screen.findByRole("button", { name: `取消收藏主题：${topicFixtures[0].title}` }))
      .toHaveAttribute("aria-pressed", "true")
  })

  it("opens the authenticated bookmarks route from the sidebar", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: topicFixtures[0].authorId,
        username: topicFixtures[0].authorUsername,
        email: "member@example.com",
        displayName: topicFixtures[0].author,
      },
      csrfToken: "a".repeat(64),
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole("link", { name: "收藏" }))
    expect(await screen.findByRole("heading", { name: "我的收藏" })).toBeInTheDocument()
    expect(listBookmarks).toHaveBeenCalled()
    expect(window.location.hash).toBe("#bookmarks")
  })

  it("opens the authenticated messages route from the site header", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: topicFixtures[0].authorId,
        username: topicFixtures[0].authorUsername,
        email: "member@example.com",
        displayName: topicFixtures[0].author,
      },
      csrfToken: "a".repeat(64),
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole("link", { name: "查看私信" }))
    expect(await screen.findByRole("heading", { name: "私信" })).toBeInTheDocument()
    expect(listConversations).toHaveBeenCalled()
    expect(window.location.hash).toBe("#messages")
  })

  it("renders the community identity and primary feed", async () => {
    render(<App />)

    expect(await screen.findByRole("link", { name: "刀云首页" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "社区动态" })).toBeInTheDocument()
    expect(await within(screen.getByRole("main")).findByText("用 Rust 构建社区平台，我们为什么选择模块化单体"))
      .toBeInTheDocument()
  })

  it("opens a shareable search route from the header", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByRole("searchbox", { name: "搜索社区内容" }), "编辑器{Enter}")

    const main = within(screen.getByRole("main"))
    expect(await main.findByRole("heading", { name: "搜索：编辑器" })).toBeInTheDocument()
    expect(await main.findByText("富文本编辑器的协作草稿方案已经开放讨论"))
      .toBeInTheDocument()
    expect(main.queryByText("用 Rust 构建社区平台，我们为什么选择模块化单体"))
      .not.toBeInTheDocument()
    expect(window.location.hash).toBe("#search?q=%E7%BC%96%E8%BE%91%E5%99%A8")
  })

  it("likes a feed topic without opening the detail view", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: topicFixtures[0].authorId,
        username: topicFixtures[0].authorUsername,
        email: "member@example.com",
        displayName: topicFixtures[0].author,
      },
      csrfToken: "a".repeat(64),
    })
    const user = userEvent.setup()
    render(<App />)

    const like = await screen.findByRole("button", { name: `点赞主题：${topicFixtures[0].title}` })
    await user.click(like)

    expect(setPostLike).toHaveBeenCalledWith(topicFixtures[0].id, true, "a".repeat(64))
    expect(await screen.findByRole("button", { name: `取消点赞主题：${topicFixtures[0].title}` }))
      .toHaveAttribute("aria-pressed", "true")
  })

  it("clears the active header search and restores the feed", async () => {
    const user = userEvent.setup()
    render(<App />)

    const search = await screen.findByRole("searchbox", { name: "搜索社区内容" })
    await user.type(search, "编辑器")
    await user.click(await screen.findByRole("button", { name: "清空搜索" }))

    expect(search).toHaveValue("")
    expect(await within(screen.getByRole("main")).findByText("用 Rust 构建社区平台，我们为什么选择模块化单体"))
      .toBeInTheDocument()
  })

  it("opens a real topic detail and returns to the feed", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole("heading", { name: topicFixtures[0].title }))

    expect(await screen.findByText("完整主题正文")).toBeInTheDocument()
    expect(window.location.hash).toBe(`#topic/${topicFixtures[0].id}`)
    expect(getTopic).toHaveBeenCalledWith(topicFixtures[0].id, expect.any(AbortSignal))
    await user.click(screen.getByRole("button", { name: "返回主题列表" }))
    expect(await screen.findByRole("heading", { name: "社区动态" })).toBeInTheDocument()
  })

  it("uses latest posts as the default topic ordering", async () => {
    render(<App />)

    expect(await screen.findByRole("tab", { name: "最新" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["推荐", "关注", "最新"])
    expect(listFeed).toHaveBeenLastCalledWith("latest", expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it("keeps the legacy active-feed route available without adding a fourth home tab", async () => {
    window.location.hash = "#active"
    render(<App />)

    await waitFor(() => expect(listTopics).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "active" })))
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["推荐", "关注", "最新"])
  })

  it("requests topics ordered by popularity", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole("tab", { name: "推荐" }))

    expect(listFeed).toHaveBeenLastCalledWith("recommended", expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it("does not expose the legacy featured feed as a fourth home tab", async () => {
    render(<App />)

    await screen.findByRole("heading", { name: "社区动态" })
    expect(screen.queryByRole("tab", { name: "精华" })).not.toBeInTheDocument()
  })

  it("filters topics by a server-provided tag", async () => {
    const user = userEvent.setup()
    vi.mocked(listTags).mockResolvedValue([{ slug: "rust", name: "Rust" }])
    render(<App />)

    const tagFilter = await screen.findByRole("combobox", { name: "按标签筛选" })
    await screen.findByRole("option", { name: "Rust" })
    await user.selectOptions(tagFilter, "rust")

    expect(listTopics).toHaveBeenLastCalledWith(expect.objectContaining({ tag: "rust" }))
  })

  it("loads the authenticated following feed from the server", async () => {
    const user = userEvent.setup()
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: "019fc700-0000-7000-8000-000000000001",
        username: "owner",
        email: "owner@example.com",
        displayName: "管理员",
      },
      csrfToken: "a".repeat(64),
    })
    render(<App />)

    await user.click(await screen.findByRole("tab", { name: "关注" }))

    expect(listFeed).toHaveBeenLastCalledWith("following", expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    expect(await within(screen.getByRole("main")).findByText(topicFixtures[0].title)).toBeInTheDocument()
  })

  it("loads the authenticated following feed from the sidebar route", async () => {
    const user = userEvent.setup()
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: "019fc700-0000-7000-8000-000000000001",
        username: "owner",
        email: "owner@example.com",
        displayName: "管理员",
      },
      csrfToken: "a".repeat(64),
    })
    render(<App />)

    const communityNavigation = await screen.findByRole("complementary", { name: "社区导航" })
    await user.click(within(communityNavigation).getByRole("link", { name: "关注" }))

    expect(listFeed).toHaveBeenLastCalledWith("following", expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
  })

  it("refreshes the following feed when returning from a user profile", async () => {
    const user = userEvent.setup()
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: "019fc700-0000-7000-8000-000000000001",
        username: "owner",
        email: "owner@example.com",
        displayName: "管理员",
      },
      csrfToken: "a".repeat(64),
    })
    render(<App />)

    await user.click(await screen.findByRole("tab", { name: "关注" }))
    await user.click(await screen.findByRole("link", { name: `查看 ${topicFixtures[0].author} 的主页` }))
    expect(await screen.findByRole("heading", { name: topicFixtures[0].author })).toBeInTheDocument()

    const communityNavigation = screen.getByRole("complementary", { name: "社区导航" })
    await user.click(within(communityNavigation).getByRole("link", { name: "关注" }))

    await vi.waitFor(() => {
      const followingRequests = vi.mocked(listTopics).mock.calls.filter(([options]) => (
        options?.scope === "following"
      ))
      expect(followingRequests).toHaveLength(2)
    })
  })

  it("prompts a signed-out visitor to log in before loading the following feed", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole("tab", { name: "关注" }))

    expect(await screen.findByRole("heading", { name: "登录后查看关注动态" })).toBeInTheDocument()
    expect(listTopics).not.toHaveBeenCalledWith(expect.objectContaining({ scope: "following" }))
    await user.click(screen.getByRole("button", { name: "登录查看关注动态" }))
    expect(await screen.findByRole("dialog", { name: "登录刀云" })).toBeInTheDocument()
  })

  it("opens a topic author's public profile", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole("link", { name: `查看 ${topicFixtures[0].author} 的主页` }))

    expect(await screen.findByRole("heading", { name: topicFixtures[0].author })).toBeInTheDocument()
    expect(window.location.hash).toBe(`#user/${topicFixtures[0].authorUsername}`)
    expect(getUserProfile).toHaveBeenCalledWith(
      topicFixtures[0].authorUsername,
      expect.any(AbortSignal),
    )
  })

  it("opens a restored conversation from a profile when it is absent from the first list page", async () => {
    const user = userEvent.setup()
    const restoredConversation = {
      id: "019fc900-0000-7000-8000-000000000101",
      otherUser: {
        id: topicFixtures[0].authorId,
        username: topicFixtures[0].authorUsername,
        displayName: topicFixtures[0].author,
        avatarUrl: topicFixtures[0].avatarUrl,
      },
      lastMessage: null,
      unreadCount: 0,
      updatedAt: "2026-08-04T10:00:00Z",
    }
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: "019fc700-0000-7000-8000-000000000001",
        username: "owner",
        email: "owner@example.com",
        displayName: "管理员",
      },
      csrfToken: "a".repeat(64),
    })
    vi.mocked(getUserProfile).mockResolvedValue({
      id: topicFixtures[0].authorId,
      username: topicFixtures[0].authorUsername,
      displayName: topicFixtures[0].author,
      avatarUrl: topicFixtures[0].avatarUrl,
      bio: "公开简介",
      location: null,
      websiteUrl: null,
      profileRevision: 1,
      createdAt: "2026-08-03T10:00:00Z",
      topicCount: 1,
      followerCount: 0,
      followingCount: 0,
      viewer: {
        isSelf: false,
        isFollowing: false,
        isBlockedByViewer: false,
        canMessage: true,
      },
    })
    vi.mocked(createConversation).mockResolvedValue(restoredConversation)
    window.location.hash = `#user/${topicFixtures[0].authorUsername}`
    render(<App />)

    await user.click(await screen.findByRole("button", { name: "私信" }))

    expect(createConversation).toHaveBeenCalledWith(
      topicFixtures[0].authorId,
      "a".repeat(64),
    )
    const conversationList = await screen.findByRole("complementary", { name: "私信会话列表" })
    expect(within(conversationList).getByRole("button", { name: new RegExp(topicFixtures[0].author) }))
      .toBeInTheDocument()
    expect(listMessages).toHaveBeenCalledWith(restoredConversation.id, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    expect(window.location.hash).toBe(`#messages/${restoredConversation.id}`)
  })

  it("opens and closes the topic composer", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole("button", { name: "分享此刻的想法" }))
    expect(await screen.findByRole("dialog", { name: "发布内容" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "关闭发布窗口" }))
    expect(screen.queryByRole("dialog", { name: "发布内容" })).not.toBeInTheDocument()
  })

  it("opens the newly published topic returned by the API", async () => {
    const user = userEvent.setup()
    vi.mocked(listBoards)
      .mockResolvedValueOnce(boardFixtures)
      .mockResolvedValueOnce(boardFixtures.map((board) => ({
        ...board,
        topicCount: board.topicCount + 1,
      })))
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: "019fc700-0000-7000-8000-000000000004",
        username: "member",
        email: "member@example.com",
        displayName: "社区成员",
      },
      csrfToken: "a".repeat(64),
    })
    vi.mocked(createTopic).mockResolvedValue({
      ...topicFixtures[0],
      id: "019fc800-0000-7000-8000-000000000109",
      title: "真实发布主题",
      excerpt: "真实正文",
    })

    render(<App />)
    await user.click(await screen.findByRole("button", { name: "分享此刻的想法" }))
    await user.click(screen.getByRole("button", { name: "添加标题" }))
    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "真实发布主题")
    await user.type(screen.getByRole("textbox", { name: "正文" }), "真实正文")
    const composer = within(screen.getByRole("dialog", { name: "发布内容" }))
    await user.click(composer.getByRole("button", { name: "发布" }))

    const publishedTopicId = "019fc800-0000-7000-8000-000000000109"
    await waitFor(() => expect(window.location.hash).toBe(`#topic/${publishedTopicId}`))
    expect(getTopic).toHaveBeenCalledWith(publishedTopicId, expect.any(AbortSignal))
    expect(screen.queryByRole("dialog", { name: "发布内容" })).not.toBeInTheDocument()
    expect(await within(screen.getByRole("navigation", { name: "常用社区" })).findByText("13"))
      .toBeInTheDocument()
    expect(listBoards).toHaveBeenCalledTimes(2)
  })

  it("restores the saved dark theme", async () => {
    localStorage.setItem("daoyun-theme", "dark")

    render(<App />)

    await screen.findByRole("button", { name: "切换浅色模式" })
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(screen.getByRole("button", { name: "切换浅色模式" })).toBeInTheDocument()
  })

  it("persists the selected theme", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole("button", { name: "切换深色模式" }))

    expect(localStorage.getItem("daoyun-theme")).toBe("dark")
  })

  it("focuses search with the platform search shortcut", async () => {
    render(<App />)

    const search = await screen.findByRole("searchbox", { name: "搜索社区内容" })
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })

    expect(search).toHaveFocus()
  })

  it("renders boards loaded from the public API", async () => {
    vi.mocked(listBoards).mockResolvedValue(boardFixtures)

    render(<App />)

    const boardNavigation = await screen.findByRole("navigation", { name: "常用社区" })
    expect(await within(boardNavigation).findByText("工程实践")).toBeInTheDocument()
    expect(within(boardNavigation).getByText("12")).toBeInTheDocument()
  })

  it("shows board loading and empty states", async () => {
    const pendingRequest = new Promise<Board[]>(() => {})
    vi.mocked(listBoards).mockReturnValueOnce(pendingRequest).mockResolvedValueOnce([])

    const { rerender } = render(<App />)

    expect(await screen.findByText("正在加载社区")).toBeInTheDocument()

    rerender(<App key="empty-boards" />)

    expect(await screen.findByText("暂无常用社区")).toHaveAttribute("role", "status")
  })

  it("retries the board request after a loading failure", async () => {
    const user = userEvent.setup()
    vi.mocked(listBoards)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(boardFixtures)

    render(<App />)

    expect(await screen.findByRole("alert")).toHaveTextContent("社区加载失败")
    await user.click(screen.getByRole("button", { name: "重试加载社区" }))

    const boardNavigation = screen.getByRole("navigation", { name: "常用社区" })
    expect(await within(boardNavigation).findByText("工程实践")).toBeInTheDocument()
    expect(listBoards).toHaveBeenCalledTimes(2)
  })

  it("opens login for a signed-out visitor and updates the account after login", async () => {
    const user = userEvent.setup()
    const session = {
      user: {
        id: "019fc700-0000-7000-8000-000000000004",
        username: "member",
        email: "member@example.com",
        displayName: "社区成员",
      },
      csrfToken: "a".repeat(64),
    }
    vi.mocked(login).mockResolvedValue(session)

    render(<App />)
    await user.click(await screen.findByRole("button", { name: "登录" }))
    expect(screen.getByRole("dialog", { name: "登录刀云" })).toBeInTheDocument()

    await user.type(screen.getByRole("textbox", { name: "用户名或邮箱" }), "member")
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple")
    await user.click(within(screen.getByRole("dialog", { name: "登录刀云" })).getByRole("button", { name: "登录" }))

    expect(await screen.findByRole("button", { name: "打开个人菜单" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "登录刀云" })).not.toBeInTheDocument()
  })

  it("revokes the current session from the account menu", async () => {
    const user = userEvent.setup()
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: "019fc700-0000-0000-8000-000000000004",
        username: "member",
        email: "member@example.com",
        displayName: "社区成员",
      },
      csrfToken: "b".repeat(64),
    })
    vi.mocked(logout).mockResolvedValue(true)

    render(<App />)
    await user.click(await screen.findByRole("button", { name: "打开个人菜单" }))
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }))

    expect(logout).toHaveBeenCalledWith("b".repeat(64))
    expect(await within(screen.getByRole("banner")).findByRole("button", { name: "登录" })).toBeInTheDocument()
  })

  it("opens the signed-in user's profile from the account menu", async () => {
    const user = userEvent.setup()
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: {
        id: topicFixtures[0].authorId,
        username: topicFixtures[0].authorUsername,
        email: "member@example.com",
        displayName: topicFixtures[0].author,
      },
      csrfToken: "c".repeat(64),
    })

    render(<App />)
    await user.click(await screen.findByRole("button", { name: "打开个人菜单" }))
    await user.click(screen.getByRole("menuitem", { name: "个人主页" }))

    expect(await screen.findByRole("heading", { name: topicFixtures[0].author })).toBeInTheDocument()
    expect(window.location.hash).toBe(`#user/${topicFixtures[0].authorUsername}`)
  })

  it("shows a governance operator the single site administration entry", async () => {
    const user = userEvent.setup()
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: topicFixtures[0].authorId, username: "moderator", email: "moderator@example.com", displayName: "社区版主" },
      csrfToken: "d".repeat(64),
    })
    vi.mocked(getAdminAccess).mockResolvedValue({ capabilityKeys: ["governance.reports.read"] })

    render(<App />)
    await user.click(await screen.findByRole("button", { name: "打开个人菜单" }))

    expect(screen.getByRole("menuitem", { name: "站点管理" })).toHaveAttribute("href", "#admin")
    expect(screen.queryByRole("menuitem", { name: "管理工作台" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "系统后台" })).not.toBeInTheDocument()
  })

  it("clears the previous board topics while a newly selected board is loading", async () => {
    window.location.hash = "#board/engineering"
    const engineeringBoard = {
      ...boardFixtures[0],
      children: [],
      breadcrumb: [{ id: boardFixtures[0].id, slug: boardFixtures[0].slug, name: boardFixtures[0].name }],
      viewer: { canRead: true, canCreateTopic: false, canReply: false, canUploadAttachment: false },
    }
    const designBoard = {
      ...engineeringBoard,
      id: "019fc630-0000-7000-8000-000000000002",
      slug: "design",
      name: "产品设计",
      breadcrumb: [{ id: "019fc630-0000-7000-8000-000000000002", slug: "design", name: "产品设计" }],
    }
    const pendingDesignBoard = new Promise<typeof designBoard>(() => {})
    vi.mocked(getBoard).mockImplementation((slug) => slug === "engineering" ? Promise.resolve(engineeringBoard) : pendingDesignBoard)

    render(<App />)

    expect(await screen.findByRole("heading", { name: topicFixtures[0].title })).toBeInTheDocument()
    window.location.hash = "#board/design"
    window.dispatchEvent(new HashChangeEvent("hashchange"))
    await waitFor(() => expect(getBoard).toHaveBeenCalledWith("design", expect.any(AbortSignal)))
    await waitFor(() => expect(screen.queryByText(topicFixtures[0].title)).not.toBeInTheDocument())
  })

  it("shows the site administration entry to a board-scoped moderator", async () => {
    const user = userEvent.setup()
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: topicFixtures[0].authorId, username: "moderator", email: "moderator@example.com", displayName: "社区版主" },
      csrfToken: "d".repeat(64),
    })
    vi.mocked(listModerationBoards).mockResolvedValue([{
      id: "019fc900-0000-0000-8000-000000000101",
      slug: "general",
      name: "社区广场",
      tone: "green",
      capabilityKeys: ["moderation.topic"],
    }])

    render(<App />)
    await user.click(await screen.findByRole("button", { name: "打开个人菜单" }))

    expect(screen.getByRole("menuitem", { name: "站点管理" })).toHaveAttribute("href", "#admin")
  })

  it("keeps one administration entry when the account has multiple capability groups", async () => {
    const user = userEvent.setup()
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: topicFixtures[0].authorId, username: "admin", email: "admin@example.com", displayName: "管理员" },
      csrfToken: "e".repeat(64),
    })
    vi.mocked(getAdminAccess).mockResolvedValue({ capabilityKeys: ["admin.configuration.read", "governance.reports.read"] })

    render(<App />)
    await user.click(await screen.findByRole("button", { name: "打开个人菜单" }))

    expect(screen.getAllByRole("menuitem", { name: "站点管理" })).toHaveLength(1)
    expect(screen.getByRole("menuitem", { name: "站点管理" })).toHaveAttribute("href", "#admin")
  })

  it("restores a topic detail directly from its hash route", async () => {
    window.location.hash = `#topic/${topicFixtures[0].id}`

    render(<App />)

    expect(await screen.findByText("完整主题正文")).toBeInTheDocument()
    expect(getTopic).toHaveBeenCalledWith(topicFixtures[0].id, expect.any(AbortSignal))
  })
})

describe("DaoYun installation gate", () => {
  it("shows only a loading state while installation status is unknown", () => {
    vi.mocked(getInstallationStatus).mockReturnValue(new Promise(() => {}))

    render(<App />)

    expect(screen.getByRole("status")).toHaveTextContent("正在检查安装状态")
    expect(screen.queryByRole("heading", { name: "社区动态" })).not.toBeInTheDocument()
    expect(listBoards).not.toHaveBeenCalled()
  })

  it("retries after installation status cannot be loaded", async () => {
    const user = userEvent.setup()
    vi.mocked(getInstallationStatus)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ isInitialized: true })

    render(<App />)

    expect(await screen.findByRole("alert")).toHaveTextContent("无法确认安装状态")
    expect(listBoards).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "重试检查" }))

    expect(await screen.findByRole("heading", { name: "社区动态" })).toBeInTheDocument()
    expect(getInstallationStatus).toHaveBeenCalledTimes(2)
  })

  it("renders the installation form for a fresh instance without loading boards", async () => {
    vi.mocked(getInstallationStatus).mockResolvedValue({ isInitialized: false })

    render(<App />)

    expect(await screen.findByRole("heading", { name: "初始化刀云" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "管理员用户名" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "管理员邮箱" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "显示名称" })).toBeInTheDocument()
    expect(screen.getByLabelText("管理员密码")).toHaveAttribute("type", "password")
    expect(listBoards).not.toHaveBeenCalled()
  })

  it("validates all administrator fields before submitting", async () => {
    const user = userEvent.setup()
    vi.mocked(getInstallationStatus).mockResolvedValue({ isInitialized: false })

    render(<App />)

    await user.type(await screen.findByRole("textbox", { name: "管理员用户名" }), "Owner")
    await user.type(screen.getByRole("textbox", { name: "管理员邮箱" }), "invalid")
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "   ")
    await user.type(screen.getByLabelText("管理员密码"), "short")
    await user.click(screen.getByRole("button", { name: "完成初始化" }))

    expect(screen.getByText("用户名需以小写字母开头，只能包含小写字母、数字或下划线，共 3-32 位")).toBeInTheDocument()
    expect(screen.getByText("请输入有效的邮箱地址")).toBeInTheDocument()
    expect(screen.getByText("请输入显示名称")).toBeInTheDocument()
    expect(screen.getByText("密码长度需为 6-128 个字符")).toBeInTheDocument()
    expect(initializeInstallation).not.toHaveBeenCalled()
  })

  it("accepts a six-character administrator password", async () => {
    const user = userEvent.setup()
    vi.mocked(getInstallationStatus).mockResolvedValue({ isInitialized: false })
    vi.mocked(initializeInstallation).mockReturnValue(new Promise(() => {}))

    render(<App />)

    await user.type(await screen.findByRole("textbox", { name: "管理员用户名" }), "owner")
    await user.type(screen.getByRole("textbox", { name: "管理员邮箱" }), "owner@example.com")
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "站点管理员")
    await user.type(screen.getByLabelText("管理员密码"), "123456")
    await user.click(screen.getByRole("button", { name: "完成初始化" }))

    expect(initializeInstallation).toHaveBeenCalledWith({
      username: "owner",
      email: "owner@example.com",
      displayName: "站点管理员",
      password: "123456",
    })
  })

  it("maps server field errors to the matching inputs", async () => {
    const user = userEvent.setup()
    vi.mocked(getInstallationStatus).mockResolvedValue({ isInitialized: false })
    vi.mocked(initializeInstallation).mockRejectedValue(new InstallationApiError(
      422,
      "request.validation_failed",
      "请求字段校验失败",
      {
        username: ["该用户名已不可用"],
        body: ["请检查提交内容"],
      },
    ))

    render(<App />)
    await fillValidInstallationForm(user)
    await user.click(screen.getByRole("button", { name: "完成初始化" }))

    expect(await screen.findByText("该用户名已不可用")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("请检查提交内容")
    expect(screen.getByRole("textbox", { name: "管理员用户名" })).toHaveValue("owner")
  })

  it("keeps form values and allows retry after a service failure", async () => {
    const user = userEvent.setup()
    vi.mocked(getInstallationStatus).mockResolvedValue({ isInitialized: false })
    vi.mocked(initializeInstallation)
      .mockRejectedValueOnce(new InstallationApiError(
        503,
        "system.database_unavailable",
        "数据库暂时不可用",
      ))
      .mockReturnValueOnce(new Promise(() => {}))

    render(<App />)
    await fillValidInstallationForm(user)
    await user.click(screen.getByRole("button", { name: "完成初始化" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("安装服务暂时不可用，请稍后重试")
    expect(screen.getByRole("textbox", { name: "管理员邮箱" })).toHaveValue("owner@example.com")
    await user.click(screen.getByRole("button", { name: "重试初始化" }))
    expect(initializeInstallation).toHaveBeenCalledTimes(2)
  })

  it("refreshes status after another installer wins the race", async () => {
    const user = userEvent.setup()
    vi.mocked(getInstallationStatus)
      .mockResolvedValueOnce({ isInitialized: false })
      .mockResolvedValueOnce({ isInitialized: true })
    vi.mocked(initializeInstallation).mockRejectedValue(new InstallationApiError(
      409,
      "installation.already_initialized",
      "实例已经初始化",
    ))

    render(<App />)
    await fillValidInstallationForm(user)
    await user.click(screen.getByRole("button", { name: "完成初始化" }))

    expect(await screen.findByRole("heading", { name: "社区动态" })).toBeInTheDocument()
    expect(getInstallationStatus).toHaveBeenCalledTimes(2)
  })

  it("confirms status after successful initialization before entering the community", async () => {
    const user = userEvent.setup()
    vi.mocked(getInstallationStatus)
      .mockResolvedValueOnce({ isInitialized: false })
      .mockResolvedValueOnce({ isInitialized: true })
    vi.mocked(initializeInstallation).mockResolvedValue({
      isInitialized: true,
      administrator: {
        id: "019fc630-0000-7000-8000-000000000001",
        username: "owner",
        email: "owner@example.com",
        displayName: "站点管理员",
      },
    })

    render(<App />)
    await fillValidInstallationForm(user)
    await user.click(screen.getByRole("button", { name: "完成初始化" }))

    expect(await screen.findByRole("heading", { name: "社区动态" })).toBeInTheDocument()
    expect(initializeInstallation).toHaveBeenCalledWith({
      username: "owner",
      email: "owner@example.com",
      displayName: "站点管理员",
      password: "correct horse battery staple",
    })
    expect(getInstallationStatus).toHaveBeenCalledTimes(2)
  })

  it("prevents duplicate submissions while initialization is pending", async () => {
    const user = userEvent.setup()
    vi.mocked(getInstallationStatus).mockResolvedValue({ isInitialized: false })
    vi.mocked(initializeInstallation).mockReturnValue(new Promise(() => {}))

    render(<App />)
    await fillValidInstallationForm(user)
    const submit = screen.getByRole("button", { name: "完成初始化" })
    await user.click(submit)

    expect(screen.getByRole("button", { name: "正在初始化" })).toBeDisabled()
    await user.click(submit)
    expect(initializeInstallation).toHaveBeenCalledTimes(1)
  })

  it("counts display names and passwords by Unicode characters", async () => {
    const user = userEvent.setup()
    const displayName = "云".repeat(79) + "😀"
    const password = "🔐".repeat(12)
    vi.mocked(getInstallationStatus).mockResolvedValue({ isInitialized: false })
    vi.mocked(initializeInstallation).mockReturnValue(new Promise(() => {}))

    render(<App />)
    await user.type(await screen.findByRole("textbox", { name: "管理员用户名" }), "owner")
    await user.type(screen.getByRole("textbox", { name: "管理员邮箱" }), "owner@example.com")
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), displayName)
    await user.type(screen.getByLabelText("管理员密码"), password)
    await user.click(screen.getByRole("button", { name: "完成初始化" }))

    expect(initializeInstallation).toHaveBeenCalledWith({
      username: "owner",
      email: "owner@example.com",
      displayName,
      password,
    })
  })

  it("moves keyboard focus through the form in logical order", async () => {
    const user = userEvent.setup()
    vi.mocked(getInstallationStatus).mockResolvedValue({ isInitialized: false })

    render(<App />)
    await screen.findByRole("heading", { name: "初始化刀云" })

    await user.tab()
    expect(screen.getByRole("textbox", { name: "管理员用户名" })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("textbox", { name: "管理员邮箱" })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText("管理员密码")).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "完成初始化" })).toHaveFocus()
  })
})

async function fillValidInstallationForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole("textbox", { name: "管理员用户名" }), "owner")
  await user.type(screen.getByRole("textbox", { name: "管理员邮箱" }), "owner@example.com")
  await user.type(screen.getByRole("textbox", { name: "显示名称" }), "站点管理员")
  await user.type(screen.getByLabelText("管理员密码"), "correct horse battery staple")
}
