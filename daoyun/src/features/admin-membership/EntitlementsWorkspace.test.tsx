import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
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
    const typesTab = screen.getByRole("tab", { name: "权益类型" })
    const usersTab = screen.getByRole("tab", { name: "用户权益" })
    expect(typesTab).toHaveAttribute("tabindex", "0")
    expect(usersTab).toHaveAttribute("tabindex", "-1")
    expect(screen.queryByText("治理角色")).not.toBeInTheDocument()

    typesTab.focus()
    await user.keyboard("{ArrowRight}")
    expect(usersTab).toHaveFocus()
    expect(usersTab).toHaveAttribute("aria-selected", "true")
    const usersPanel = screen.getByRole("tabpanel", { name: "用户权益" })
    expect(usersTab).toHaveAttribute("aria-controls", usersPanel.id)
    expect(usersPanel).toHaveAttribute("aria-labelledby", usersTab.id)
    expect(screen.getByRole("searchbox", { name: "搜索权益用户" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发放标准权益" })).toBeInTheDocument()

    await user.keyboard("{Home}")
    expect(typesTab).toHaveFocus()
    expect(typesTab).toHaveAttribute("aria-selected", "true")
  })

  it("requires a versioned permission and quota snapshot before publishing", async () => {
    const publish = vi.fn()
    render(<EntitlementsWorkspace onPublishVersion={publish} />)

    await userEvent.click(screen.getByRole("button", { name: "创建权益类型" }))
    expect(screen.getByRole("dialog", { name: "发布权益版本" })).toHaveTextContent("权限与额度快照")
    expect(screen.getByRole("button", { name: "确认发布" })).toBeDisabled()
    expect(publish).not.toHaveBeenCalled()
  })

  it("keeps the publisher inside a keyboard modal and restores the publish trigger", async () => {
    const user = userEvent.setup()
    render(<EntitlementsWorkspace onPublishVersion={vi.fn()} />)

    const trigger = screen.getByRole("button", { name: "创建权益类型" })
    await user.click(trigger)
    const dialog = screen.getByRole("dialog", { name: "发布权益版本" })
    const internalKey = screen.getByRole("textbox", { name: "内部键" })
    const cancel = screen.getByRole("button", { name: "取消" })
    await waitFor(() => expect(internalKey).toHaveFocus())
    await user.tab({ shift: true })
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(internalKey).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(dialog).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
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

  it("keeps the latest entitlement version request when an older one finishes later", async () => {
    const user = userEvent.setup()
    const yearlyTypeId = "019fc900-0000-7000-8000-000000000804"
    const yearlyType = entitlementTypeDto({ id: yearlyTypeId, internal_key: "vip_yearly", display_name: "年度会员" })
    let resolveMonthly!: (response: Response) => void
    const monthlyPending = new Promise<Response>((resolve) => { resolveMonthly = resolve })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([entitlementTypeDto(), yearlyType]))
      .mockImplementationOnce(() => monthlyPending)
      .mockResolvedValueOnce(jsonResponse([entitlementVersionDto({ id: "019fc900-0000-7000-8000-000000000805", entitlement_type_id: yearlyTypeId, version: 7 })]))
    vi.stubGlobal("fetch", fetchMock)

    render(<EntitlementsWorkspace csrfToken="csrf" />)
    await user.click(await screen.findByRole("button", { name: "查看月度会员版本历史" }))
    await user.click(screen.getByRole("button", { name: "查看年度会员版本历史" }))
    expect(await screen.findByRole("region", { name: "年度会员版本历史" })).toHaveTextContent("版本 7")

    resolveMonthly(jsonResponse([entitlementVersionDto({ version: 3 })]))
    await waitFor(() => expect(screen.getByRole("region", { name: "年度会员版本历史" })).toHaveTextContent("版本 7"))
    expect(screen.queryByRole("region", { name: "月度会员版本历史" })).not.toBeInTheDocument()
  })

  it("refreshes an entitlement type revision conflict without discarding the publisher draft", async () => {
    const user = userEvent.setup()
    const latest = entitlementTypeDto({ display_name: "服务器会员", revision: 3 })
    const saved = entitlementTypeDto({ display_name: "本地会员", current_version: 3, revision: 4 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([entitlementTypeDto()]))
      .mockResolvedValueOnce(jsonError(409, "entitlement.conflict", "权益类型已被其他管理员更新"))
      .mockResolvedValueOnce(jsonResponse([latest]))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse([entitlementVersionDto({ version: 3 })]))
    vi.stubGlobal("fetch", fetchMock)

    render(<EntitlementsWorkspace csrfToken="csrf" />)
    await user.click(await screen.findByRole("button", { name: "发布下一版本" }))
    const dialog = screen.getByRole("dialog", { name: "发布权益版本" })
    const name = within(dialog).getByRole("textbox", { name: "显示名称" })
    await user.clear(name)
    await user.type(name, "本地会员")
    await user.click(within(dialog).getByRole("button", { name: "确认发布" }))

    expect(await within(dialog).findByText("数据已被其他管理员更新")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "刷新最新数据" }))
    expect(name).toHaveValue("本地会员")

    await user.click(within(dialog).getByRole("button", { name: "确认发布" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))).toMatchObject({
      expected_revision: 3,
      display_name: "本地会员",
    })
  })

  it("keeps the latest selected user when an older entitlement request finishes later", async () => {
    const user = userEvent.setup()
    const secondUserId = "019fc900-0000-7000-8000-000000000402"
    const secondUser = { ...userDto(), id: secondUserId, username: "second_member", display_name: "第二成员" }
    let resolveFirstUser!: (response: Response) => void
    const firstUserPending = new Promise<Response>((resolve) => { resolveFirstUser = resolve })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([entitlementTypeDto()]))
      .mockResolvedValueOnce(jsonPageResponse([userDto(), secondUser]))
      .mockImplementationOnce(() => firstUserPending)
      .mockResolvedValueOnce(jsonResponse([entitlementDto({ id: "019fc900-0000-7000-8000-000000000812", user_id: secondUserId, reason: "第二用户奖励" })]))
    vi.stubGlobal("fetch", fetchMock)

    render(<EntitlementsWorkspace csrfToken="csrf" />)
    await user.click(screen.getByRole("tab", { name: "用户权益" }))
    await user.type(screen.getByRole("searchbox", { name: "搜索权益用户" }), "member")
    await user.click(screen.getByRole("button", { name: "搜索用户" }))
    await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))
    await user.click(screen.getByRole("button", { name: "选择第二成员 @second_member" }))

    expect(await screen.findByRole("region", { name: "第二成员的标准权益" })).toHaveTextContent("第二用户奖励")
    resolveFirstUser(jsonResponse([entitlementDto({ reason: "第一用户迟到奖励" })]))
    await waitFor(() => expect(screen.getByRole("region", { name: "第二成员的标准权益" })).not.toHaveTextContent("第一用户迟到奖励"))
  })

  it("blocks a duplicate entitlement grant while the first request is pending", async () => {
    const user = userEvent.setup()
    let resolveGrant!: (response: Response) => void
    const grantPending = new Promise<Response>((resolve) => { resolveGrant = resolve })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([entitlementTypeDto()]))
      .mockResolvedValueOnce(jsonPageResponse([userDto()]))
      .mockResolvedValueOnce(jsonResponse([entitlementDto()]))
      .mockImplementationOnce(() => grantPending)
    vi.stubGlobal("fetch", fetchMock)

    render(<EntitlementsWorkspace csrfToken="csrf" />)
    await user.click(screen.getByRole("tab", { name: "用户权益" }))
    await user.type(screen.getByRole("searchbox", { name: "搜索权益用户" }), "demo_member")
    await user.click(screen.getByRole("button", { name: "搜索用户" }))
    await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))
    await screen.findByText("活动奖励")
    await user.click(screen.getByRole("button", { name: "发放标准权益" }))
    await user.type(screen.getByRole("textbox", { name: "发放来源" }), "operator")
    await user.type(screen.getByRole("textbox", { name: "发放原因" }), "防重复发放")
    await user.type(screen.getByLabelText("开始时间"), "2026-08-28T10:00")
    const dialog = screen.getByRole("dialog", { name: "发放标准权益" }) as HTMLFormElement

    act(() => {
      dialog.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      dialog.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(screen.getByRole("button", { name: "确认发放" })).toBeDisabled()

    resolveGrant(jsonResponse({ entitlement: entitlementDto({ id: "019fc900-0000-7000-8000-000000000813", reason: "防重复发放" }), replayed: false }))
    expect(await screen.findByRole("status")).toHaveTextContent("标准权益已安全发放")
  })

  it("refreshes a revoke target revision after a conflict and keeps the revoke reason", async () => {
    const user = userEvent.setup()
    const latestEntitlement = entitlementDto({ revision: 2 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([entitlementTypeDto()]))
      .mockResolvedValueOnce(jsonPageResponse([userDto()]))
      .mockResolvedValueOnce(jsonResponse([entitlementDto()]))
      .mockResolvedValueOnce(jsonError(409, "entitlement.conflict", "标准权益已更新"))
      .mockResolvedValueOnce(jsonResponse([latestEntitlement]))
      .mockResolvedValueOnce(jsonResponse({ entitlement: entitlementDto({ revision: 3, revoked_at: "2026-08-28T10:00:00Z", revoked_by: "019fc900-0000-7000-8000-000000000004", revocation_reason: "资格变化" }), replayed: false }))
    vi.stubGlobal("fetch", fetchMock)

    render(<EntitlementsWorkspace csrfToken="csrf" />)
    await user.click(screen.getByRole("tab", { name: "用户权益" }))
    await user.type(screen.getByRole("searchbox", { name: "搜索权益用户" }), "demo_member")
    await user.click(screen.getByRole("button", { name: "搜索用户" }))
    await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))
    await user.click(await screen.findByRole("button", { name: "撤销月度会员" }))
    const reason = screen.getByRole("textbox", { name: "撤销原因" })
    await user.type(reason, "资格变化")
    await user.click(screen.getByRole("button", { name: "确认撤销" }))

    expect(await screen.findByText("数据已被其他管理员更新")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "刷新最新数据" }))
    expect(reason).toHaveValue("资格变化")

    await user.click(screen.getByRole("button", { name: "确认撤销" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
    expect(JSON.parse(String((fetchMock.mock.calls[5][1] as RequestInit).body))).toMatchObject({
      expected_revision: 2,
      reason: "资格变化",
    })
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

function entitlementTypeDto(overrides: Record<string, unknown> = {}) {
  return { id: typeId, internal_key: "vip_monthly", display_name: "月度会员", status: "active", current_version: 2, permission_keys: ["attachment.upload"], quotas: { "attachment.upload.daily": 20 }, revision: 2, created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-27T10:00:00Z", ...overrides }
}

function entitlementVersionDto(overrides: Record<string, unknown> = {}) {
  return { id: "019fc900-0000-7000-8000-000000000803", entitlement_type_id: typeId, version: 2, permission_keys: ["attachment.upload"], quotas: { "attachment.upload.daily": 20 }, created_by: "019fc900-0000-7000-8000-000000000004", created_at: "2026-08-27T10:00:00Z", ...overrides }
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

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message }, meta: { request_id: requestId } }), { status, headers: { "content-type": "application/json" } })
}

it("publishes Chinese permission selections and numeric quotas without manual API keys", async () => {
  const publish = vi.fn()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])))
  const user = userEvent.setup()
  render(<EntitlementsWorkspace onPublishVersion={publish} />)
  await user.click(screen.getByRole("button", { name: "创建权益类型" }))
  await user.type(screen.getByLabelText("内部键"), "vip_monthly")
  await user.type(screen.getByLabelText("显示名称"), "月度会员")
  await user.click(screen.getByRole("checkbox", { name: "上传附件" }))
  await user.type(screen.getByRole("spinbutton", { name: "每日上传数量" }), "20")
  await user.click(screen.getByRole("button", { name: "确认发布" }))
  expect(publish).toHaveBeenCalledWith({ internalKey: "vip_monthly", displayName: "月度会员", permissionKeys: ["attachment.upload"], quotas: { "attachment.upload.daily": 20 } })
})

it("shows missing grant fields instead of silently ignoring submission", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse([entitlementTypeDto()]))
    .mockResolvedValueOnce(jsonPageResponse([userDto()]))
    .mockResolvedValueOnce(jsonResponse([]))
  vi.stubGlobal("fetch", fetchMock)
  const user = userEvent.setup()
  render(<EntitlementsWorkspace csrfToken="csrf" />)
  await user.click(screen.getByRole("tab", { name: "用户权益" }))
  await user.type(screen.getByLabelText("搜索权益用户"), "member")
  await user.click(screen.getByRole("button", { name: "搜索用户" }))
  await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))
  await user.click(screen.getByRole("button", { name: "发放标准权益" }))
  const dialog = screen.getByRole("dialog", { name: "发放标准权益" })
  act(() => dialog.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(within(dialog).getByRole("alert")).toHaveTextContent("请填写发放来源、发放原因和开始时间")
  expect(screen.getByLabelText("发放原因")).toBeRequired()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it("distinguishes a failed type load from an empty catalog and allows retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(jsonResponse([entitlementTypeDto()])))
  render(<EntitlementsWorkspace />)
  await userEvent.click(await screen.findByRole("button", { name: "重新加载权益类型" }))
  expect(await screen.findByRole("button", { name: "查看月度会员版本历史" })).toBeInTheDocument()
  expect(screen.queryByText("尚未配置标准权益类型。")).not.toBeInTheDocument()
})
