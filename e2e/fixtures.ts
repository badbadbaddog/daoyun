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
          data: [
            {
              id: boardId,
              slug: "engineering",
              name: "工程实践",
              description: "分享工程经验与可靠性实践",
              icon: "code",
              tone: "blue",
              topic_count: 1,
            },
          ],
          meta: { request_id: requestId, next_cursor: null },
        }).data,
      })
      return
    }
    if (path === "/api/v1/topics" && route.request().method() === "GET") {
      await route.fulfill({
        json: {
          data: [topic],
          meta: { request_id: requestId, next_cursor: null },
        },
      })
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
