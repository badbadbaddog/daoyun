import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EntitlementsWorkspace } from "./EntitlementsWorkspace"

const requestId = "019fc900-0000-7000-8000-000000000001"
const typeId = "019fc900-0000-7000-8000-000000000802"
const userId = "019fc900-0000-7000-8000-000000000401"
const entitlementId = "019fc900-0000-7000-8000-000000000801"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EntitlementsWorkspace", () => {
  it("separates entitlement type versions from user grants and governance roles", async () => {
    const user = userEvent.setup()
    render(<EntitlementsWorkspace />)

    expect(screen.getByRole("heading", { name: "标准权益" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "权益类型" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "用户权益" })).toBeInTheDocument()
    expect(screen.queryByText("治理角色")).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "用户权益" }))
    expect(screen.getByRole("searchbox", { name: "搜索权益用户" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发放标准权益" })).toBeInTheDocument()
  })

  it("requires a versioned permission and quota snapshot before publishing", async () => {
    const publish = vi.fn()
    render(<EntitlementsWorkspace onPublishVersion={publish} />)

    await userEvent.click(screen.getByRole("button", { name: "发布新版本" }))
    expect(screen.getByRole("dialog", { name: "发布权益版本" })).toHaveTextContent("权限与额度快照")
    expect(screen.getByRole("button", { name: "确认发布" })).toBeDisabled()
    expect(publish).not.toHaveBeenCalled()
  })

  it("loads entitlement types and stable version snapshots", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([entitlementTypeDto()]))
      .mockResolvedValueOnce(jsonResponse([entitlementVersionDto()]))
    vi.stubGlobal("fetch", fetchMock)

    render(<EntitlementsWorkspace csrfToken="csrf" />)

    await userEvent.click(await screen.findByRole("button", { name: "查看月度会员版本历史" }))
    const history = await screen.findByRole("region", { name: "月度会员版本历史" })
    expect(within(history).getByText("版本 2")).toBeInTheDocument()
    expect(within(history).getByText("attachment.upload")).toBeInTheDocument()
    expect(within(history).getByText("attachment.upload.daily = 20")).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/admin/entitlements/types/vip_monthly/versions")
  })

  it("searches users, grants time-bounded entitlements, and revokes by revision", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([entitlementTypeDto()]))
      .mockResolvedValueOnce(jsonPageResponse([userDto()]))
      .mockResolvedValueOnce(jsonResponse([entitlementDto()]))
      .mockResolvedValueOnce(jsonResponse({ entitlement: entitlementDto({ id: "019fc900-0000-7000-8000-000000000811" }), replayed: false }))
      .mockResolvedValueOnce(jsonResponse({ entitlement: entitlementDto({ revoked_at: "2026-08-28T10:00:00Z", revoked_by: "019fc900-0000-7000-8000-000000000004", revocation_reason: "资格取消", revision: 2 }), replayed: false }))
    vi.stubGlobal("fetch", fetchMock)

    render(<EntitlementsWorkspace csrfToken="csrf" />)
    await user.click(screen.getByRole("tab", { name: "用户权益" }))
    await user.type(screen.getByRole("searchbox", { name: "搜索权益用户" }), "demo_member")
    await user.click(screen.getByRole("button", { name: "搜索用户" }))
    await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))

    expect(await screen.findByText("活动奖励")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "发放标准权益" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "权益类型" }), typeId)
    await user.type(screen.getByRole("textbox", { name: "发放来源" }), "operator")
    await user.type(screen.getByRole("textbox", { name: "发放原因" }), "运营补发")
    await user.type(screen.getByLabelText("开始时间"), "2026-08-28T10:00")
    await user.type(screen.getByLabelText("结束时间"), "2026-09-28T10:00")
    await user.click(screen.getByRole("button", { name: "确认发放" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))).toMatchObject({
      user_id: userId,
      entitlement_type_id: typeId,
      source: "operator",
      reason: "运营补发",
      starts_at: "2026-08-28T02:00:00.000Z",
      ends_at: "2026-09-28T02:00:00.000Z",
    })

    await user.click(screen.getAllByRole("button", { name: "撤销月度会员" })[1])
    await user.type(screen.getByRole("textbox", { name: "撤销原因" }), "资格取消")
    await user.click(screen.getByRole("button", { name: "确认撤销" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(JSON.parse(String((fetchMock.mock.calls[4][1] as RequestInit).body))).toMatchObject({ expected_revision: 1, reason: "资格取消" })
    expect(await screen.findByText(/撤销：资格取消/)).toBeInTheDocument()
  })
})

function entitlementTypeDto() {
  return { id: typeId, internal_key: "vip_monthly", display_name: "月度会员", status: "active", current_version: 2, permission_keys: ["attachment.upload"], quotas: { "attachment.upload.daily": 20 }, revision: 2, created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-27T10:00:00Z" }
}

function entitlementVersionDto() {
  return { id: "019fc900-0000-7000-8000-000000000803", entitlement_type_id: typeId, version: 2, permission_keys: ["attachment.upload"], quotas: { "attachment.upload.daily": 20 }, created_by: "019fc900-0000-7000-8000-000000000004", created_at: "2026-08-27T10:00:00Z" }
}

function entitlementDto(overrides: Record<string, unknown> = {}) {
  return { id: entitlementId, user_id: userId, entitlement_type_id: typeId, entitlement_key: "vip_monthly", type_version: 2, permission_snapshot: ["attachment.upload"], quota_snapshot: { "attachment.upload.daily": 20 }, source: "operator", source_reference_id: "campaign-2026", reason: "活动奖励", starts_at: "2026-08-27T10:00:00Z", ends_at: "2026-09-27T10:00:00Z", revoked_at: null, revoked_by: null, revocation_reason: null, revision: 1, granted_by: "019fc900-0000-7000-8000-000000000004", created_at: "2026-08-27T10:00:00Z", updated_at: "2026-08-27T10:00:00Z", ...overrides }
}

function userDto() {
  return { id: userId, username: "demo_member", display_name: "演示成员", avatar_url: null, status: "active", primary_role: null, topic_count: 2, post_count: 5, report_count: 0, created_at: "2026-08-23T10:00:00Z", last_seen_at: null }
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { request_id: requestId } }), { status: 200, headers: { "content-type": "application/json" } })
}

function jsonPageResponse(data: unknown[]): Response {
  return new Response(JSON.stringify({ data, meta: { request_id: requestId, next_cursor: null } }), { status: 200, headers: { "content-type": "application/json" } })
}
