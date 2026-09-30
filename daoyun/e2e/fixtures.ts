import type { Page } from "@playwright/test"

export const requestId = "019fc700-0000-7000-8000-000000000001"
export const boardId = "019fc700-0000-7000-8000-000000000002"
export const topicId = "019fc700-0000-7000-8000-000000000003"
export const userId = "019fc700-0000-7000-8000-000000000004"

const qualityCoverSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#dbeafe"/><path d="M32 138 108 62l48 48 34-34 98 98H32Z" fill="#2563eb"/></svg>'

const topic = {
  id: topicId,
  title: "一条关于 Rust 的主题",
  excerpt: "用统一的对象存储和质量门禁让社区发布链路更可靠。",
  image_url: "https://cdn.example.com/quality-cover.webp",
  visible_image_count: 1,
  media_urls: ["https://cdn.example.com/quality-cover.webp"],
  author: {
    id: userId,
    username: "quality_author",
    display_name: "质量作者",
    avatar_url: null,
  },
  board: {
    id: boardId,
    slug: "engineering",
    name: "工程实践",
    tone: "blue",
  },
  published_at: "2026-08-05T00:00:00Z",
  last_activity_at: "2026-08-05T00:00:00Z",
  reply_count: 2,
  like_count: 3,
  viewer_bookmarked: null,
  viewer_liked: null,
  view_count: 10,
  is_featured: false,
  is_pinned: false,
  tags: [{ slug: "rust", name: "Rust" }],
}

export const publicTopicFixture = topic

const discussionTopic = {
  ...topic,
  id: "019fc700-0000-7000-8000-000000000005",
  title: "如何设计一个真正适合讨论的社区首页？",
  excerpt: "讨论内容应该优先呈现观点与上下文，不应为了统一外观而补上一张并不存在的封面图。",
  image_url: null,
  visible_image_count: 0,
  media_urls: [],
  reply_count: 12,
  like_count: 28,
  view_count: 93,
  tags: [{ slug: "design", name: "产品设计" }],
}

const topicReplies = [
  {
    id: "019fc700-0000-7000-8000-000000000031",
    topic_id: topicId,
    floor_number: 1,
    reply_to: null,
    author: {
      id: "019fc700-0000-7000-8000-000000000041",
      username: "frontend_builder",
      display_name: "前端开发者",
      avatar_url: null,
    },
    content: "内容层级很清楚，正文、操作和讨论区的边界也更容易扫读。",
    rich_content: null,
    has_locked_content: false,
    created_at: "2026-08-05T01:10:00Z",
    updated_at: "2026-08-05T01:10:00Z",
    revision_count: 1,
    like_count: 6,
    viewer_liked: null,
  },
  {
    id: "019fc700-0000-7000-8000-000000000032",
    topic_id: topicId,
    floor_number: 2,
    reply_to: {
      id: "019fc700-0000-7000-8000-000000000031",
      floor_number: 1,
      author: {
        id: "019fc700-0000-7000-8000-000000000041",
        username: "frontend_builder",
        display_name: "前端开发者",
        avatar_url: null,
      },
      excerpt: "内容层级很清楚，正文、操作和讨论区的边界也更容易扫读。",
      is_deleted: false,
    },
    author: {
      id: "019fc700-0000-7000-8000-000000000042",
      username: "product_voice",
      display_name: "产品汪",
      avatar_url: null,
    },
    content: "同意，移动端保留紧凑信息密度也很重要。",
    rich_content: null,
    has_locked_content: false,
    created_at: "2026-08-05T02:20:00Z",
    updated_at: "2026-08-05T02:20:00Z",
    revision_count: 1,
    like_count: 3,
    viewer_liked: null,
  },
]

const board = {
  id: boardId,
  parent_id: null,
  slug: "engineering",
  name: "工程实践",
  description: "分享工程经验与可靠性实践",
  icon: "code",
  tone: "blue",
  position: 0,
  depth: 0,
  child_count: 6,
  topic_count: 6,
}

const boardChildren = [
  ["languages", "编程语言", "Rust、TypeScript 与语言生态", "code", "blue", 8_736],
  ["frontend", "前端开发", "Web、跨端与用户体验实践", "aperture", "green", 7_254],
  ["backend", "后端开发", "服务端、API 与架构设计", "layout", "rose", 6_812],
  ["database", "数据库", "数据建模、查询与性能优化", "messages", "blue", 5_931],
  ["rust", "Rust", "Rust 语言与生态讨论", "code", "amber", 3_642],
  ["ai-tools", "AI 工具", "AI 开发工具与应用实践", "aperture", "rose", 2_981],
].map(([slug, name, description, icon, tone, topicCount], index) => ({
  id: `019fc700-0000-7000-8000-00000000001${index}`,
  parent_id: boardId,
  slug,
  name,
  description,
  icon,
  tone,
  position: (index + 1) * 10,
  depth: 1,
  child_count: 0,
  topic_count: topicCount,
}))

const boardTopics = [
  topic,
  discussionTopic,
  {
    ...discussionTopic,
    id: "019fc700-0000-7000-8000-000000000020",
    title: "Rust 1.78 发布了：新特性一览与升级指南",
    reply_count: 28,
    like_count: 36,
    view_count: 986,
    is_featured: true,
  },
  {
    ...discussionTopic,
    id: "019fc700-0000-7000-8000-000000000021",
    title: "分享一个好用的 CSS 库：Pico.css 的使用体验",
    reply_count: 16,
    like_count: 22,
    view_count: 256,
  },
  {
    ...discussionTopic,
    id: "019fc700-0000-7000-8000-000000000022",
    title: "MySQL 索引优化实践：慢查询案例分析",
    reply_count: 24,
    like_count: 31,
    view_count: 876,
  },
  {
    ...discussionTopic,
    id: "019fc700-0000-7000-8000-000000000023",
    title: "cargo workspace 大型项目实践与坑点记录",
    reply_count: 12,
    like_count: 18,
    view_count: 342,
    is_pinned: true,
  },
]

const profile = {
  id: userId,
  username: "quality_author",
  display_name: "质量作者",
  avatar_url: null,
  bio: "分享可靠、克制、可持续演进的社区产品实践。",
  location: "上海",
  website_url: null,
  profile_revision: 1,
  created_at: "2026-01-12T00:00:00Z",
  topic_count: 2,
  follower_count: 128,
  following_count: 36,
  viewer: null,
}

function envelope<T>(data: T) {
  return { data, meta: { request_id: requestId } }
}

function errorEnvelope(code: string, message: string) {
  return { error: { code, message }, meta: { request_id: requestId } }
}

export async function mockPublicApi(page: Page) {
  // Exercise HTTPS branding URLs without making E2E depend on external DNS.
  await page.route("https://cdn.example.com/quality-cover.webp", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: qualityCoverSvg,
    })
  })

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path === "/api/v1/installation" && route.request().method() === "GET") {
      await route.fulfill({ json: envelope({ is_initialized: true }) })
      return
    }
    if (path === "/api/v1/site-branding") {
      await route.fulfill({
        json: envelope({
          site_name: "质量回归社区",
          logo_url: null,
          favicon_url: null,
          default_cover_url: "https://cdn.example.com/quality-cover.webp",
          navigation_links: [{ label: "质量文档", url: "#quality-docs" }],
          footer_text: "质量回归页脚",
          footer_links: [{ label: "隐私说明", url: "#privacy" }],
          primary_color: "#123456",
          accent_color: "#d97706",
          theme_preset: "compact",
          list_density: "compact",
          home_mode: "latest",
        }),
      })
      return
    }
    if (path === "/api/v1/auth/session") {
      await route.fulfill({ status: 401, json: errorEnvelope("auth.unauthorized", "未登录") })
      return
    }
    if (path === "/api/v1/boards") {
      await route.fulfill({
        json: envelope({
          data: [board, ...boardChildren],
          meta: { request_id: requestId, next_cursor: null },
        }).data,
      })
      return
    }
    if (path === "/api/v1/boards/engineering") {
      await route.fulfill({
        json: envelope({
          ...board,
          children: boardChildren,
          breadcrumb: [{ id: boardId, slug: "engineering", name: "工程实践" }],
          viewer: {
            can_read: true,
            can_create_topic: true,
            can_reply: true,
            can_upload_attachment: true,
          },
        }),
      })
      return
    }
    if (path === `/api/v1/topics/${topicId}/poll`) {
      await route.fulfill({ json: envelope(null) })
      return
    }
    if (path === `/api/v1/topics/${topicId}/supplements`) {
      await route.fulfill({ json: { data: [], meta: { request_id: requestId, next_cursor: null } } })
      return
    }
    if (path.startsWith("/api/v1/plugin-ui/")) {
      await route.fulfill({ json: envelope([]) })
      return
    }
    if (path === `/api/v1/topics/${topicId}/replies`) {
      await route.fulfill({ json: { data: topicReplies, meta: { request_id: requestId, next_cursor: null } } })
      return
    }
    if (path === `/api/v1/topics/${topicId}` && route.request().method() === "GET") {
      await route.fulfill({
        json: envelope({
          ...topic,
          content: "可靠的内容详情需要清晰呈现主题背景、核心结论和后续讨论。统一内容模型让图文、长文、链接与讨论共享同一条可持续演进的发布链路。",
          rich_content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "可靠的内容详情需要清晰呈现主题背景、核心结论和后续讨论。" }] },
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "为什么要统一内容模型" }] },
              { type: "paragraph", content: [{ type: "text", text: "统一内容模型让图文、长文、链接与讨论共享同一条可持续演进的发布链路。" }] },
              { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "内容优先，交互克制，真实数据完整可见。" }] }] },
            ],
          },
          has_locked_content: false,
          content_revision: 1,
        }),
      })
      return
    }
    if ((path === "/api/v1/topics" || path === "/api/v1/feed") && route.request().method() === "GET") {
      await route.fulfill({
        json: {
          data: boardTopics,
          meta: { request_id: requestId, next_cursor: null },
        },
      })
      return
    }
    if (path.startsWith("/api/v1/users/") && path.endsWith("/membership-summary")) {
      await route.fulfill({
        json: envelope({
          current_level: {
            id: "019fc700-0000-7000-8000-000000000051",
            internal_key: "member",
            level_order: 1,
            display_name: "Lv1",
            required_experience: 0,
            color: null,
            description: "",
          },
          medals: [],
          public_groups: [],
        }),
      })
      return
    }
    if (path === "/api/v1/users/quality_author") {
      await route.fulfill({ json: envelope(profile) })
      return
    }
    if (path === "/api/v1/users/quality_author/medals") {
      await route.fulfill({ json: envelope([]) })
      return
    }
    if (path === `/api/v1/plugin-ui/user_profile/${userId}`) {
      await route.fulfill({ json: envelope([]) })
      return
    }
    if (path === "/api/v1/tags") {
      await route.fulfill({ json: envelope([{ slug: "rust", name: "Rust" }]) })
      return
    }

    await route.fulfill({
      status: 404,
      json: errorEnvelope("not_found", "测试路由未配置"),
    })
  })
}

export async function assertNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  if (dimensions.scrollWidth > dimensions.clientWidth) {
    throw new Error(`horizontal overflow: ${JSON.stringify(dimensions)}`)
  }
}
