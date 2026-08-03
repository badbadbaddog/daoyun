import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AdminApiError,
  createAdminBoard,
  getAdminSiteBranding,
  listAdminBoards,
  updateSiteBranding,
} from "./admin"

const requestId = "019fc900-0000-7000-8000-000000000001"
const boardId = "019fc900-0000-7000-8000-000000000101"

afterEach(() => vi.restoreAllMocks())

describe("admin API", () => {
  it("maps branding and board responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: brandingDto(), meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: [boardDto()], meta: { request_id: requestId } }))

    await expect(getAdminSiteBranding()).resolves.toMatchObject({ siteName: "刀云" })
    await expect(listAdminBoards()).resolves.toEqual([expect.objectContaining({ id: boardId, topicCount: 3, visibility: "public" })])
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/admin/site-branding", expect.objectContaining({ credentials: "include" }))
  })

  it("sends CSRF headers and maps successful writes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: brandingDto(), meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: boardDto(), meta: { request_id: requestId } }, 201))

    await updateSiteBranding({
      siteName: "刀云",
      logoUrl: null,
      faviconUrl: null,
      primaryColor: "#1f8f5f",
      accentColor: "#d97706",
      themePreset: "default",
      listDensity: "comfortable",
      homeMode: "latest",
    }, "csrf")
    await createAdminBoard({
      slug: "general",
      name: "社区广场",
      description: "公开讨论",
      icon: "messages",
      tone: "green",
      position: 0,
      visibility: "public",
    }, "csrf")
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/admin/site-branding", expect.objectContaining({ method: "PATCH", headers: expect.objectContaining({ "x-csrf-token": "csrf" }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/admin/boards", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "x-csrf-token": "csrf" }) }))
  })

  it("exposes structured forbidden errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ error: { code: "admin.forbidden", message: "需要超级管理员权限" }, meta: { request_id: requestId } }, 403))
    await expect(getAdminSiteBranding()).rejects.toMatchObject<Partial<AdminApiError>>({ status: 403, code: "admin.forbidden" })
  })
})

function brandingDto() {
  return {
    site_name: "刀云",
    logo_url: null,
    favicon_url: null,
    primary_color: "#1f8f5f",
    accent_color: "#d97706",
    theme_preset: "default",
    list_density: "comfortable",
    home_mode: "latest",
  }
}

function boardDto() {
  return {
    id: boardId,
    slug: "general",
    name: "社区广场",
    description: "公开讨论",
    icon: "messages",
    tone: "green",
    position: 0,
    visibility: "public",
    topic_count: 3,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
