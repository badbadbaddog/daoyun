import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BrandingApiError, getPublicSiteBranding } from "./branding"

const fetchMock = vi.fn()
const requestId = "019fc630-0000-7000-8000-000000000002"

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe("getPublicSiteBranding", () => {
  it("validates and maps the public branding response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          site_name: "天际社区",
          logo_url: "https://cdn.example.com/logo.svg",
          favicon_url: "https://cdn.example.com/favicon.ico",
          default_cover_url: "https://cdn.example.com/cover.webp",
          navigation_links: [{ label: "文档", url: "/docs" }],
          footer_text: "自托管社区",
          footer_links: [{ label: "隐私", url: "#privacy" }],
          primary_color: "#123456",
          accent_color: "#c2410c",
          theme_preset: "compact",
          list_density: "compact",
          home_mode: "hot",
        },
        meta: { request_id: requestId },
      }),
    })

    await expect(getPublicSiteBranding()).resolves.toEqual({
      siteName: "天际社区",
      logoUrl: "https://cdn.example.com/logo.svg",
      faviconUrl: "https://cdn.example.com/favicon.ico",
      defaultCoverUrl: "https://cdn.example.com/cover.webp",
      navigationLinks: [{ label: "文档", url: "/docs" }],
      footerText: "自托管社区",
      footerLinks: [{ label: "隐私", url: "#privacy" }],
      primaryColor: "#123456",
      accentColor: "#c2410c",
      themePreset: "compact",
      listDensity: "compact",
      homeMode: "hot",
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/site-branding", {
      headers: { Accept: "application/json" },
      signal: undefined,
    })
  })

  it("rejects malformed or unsafe branding data", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          site_name: "天际社区",
          logo_url: "javascript:alert(1)",
          favicon_url: null,
          default_cover_url: null,
          navigation_links: [{ label: "危险", url: "javascript:alert(1)" }],
          footer_text: null,
          footer_links: [],
          primary_color: "#123456",
          accent_color: "#c2410c",
          theme_preset: "default",
          list_density: "comfortable",
          home_mode: "latest",
        },
        meta: { request_id: requestId },
      }),
    })

    await expect(getPublicSiteBranding()).rejects.toMatchObject({
      status: 200,
      code: "response.invalid",
    })
  })

  it("preserves structured API errors", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: "system.database_unavailable", message: "品牌配置暂时不可用" },
        meta: { request_id: requestId },
      }),
    })

    const error = await getPublicSiteBranding().catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(BrandingApiError)
    expect(error).toMatchObject({
      status: 503,
      code: "system.database_unavailable",
      message: "品牌配置暂时不可用",
    })
  })
})
