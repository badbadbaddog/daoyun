import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CommunityGroupAdminPanel } from "./CommunityGroupAdminPanel"

const groupId = "0198d874-e991-7b62-8b38-3986f55c8d3d"
const requestId = "0198d874-e991-7b62-8b38-3986f55c8d3e"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("CommunityGroupAdminPanel", () => {
  it("shows and changes the default group for future registrations", async () => {
    const user = userEvent.setup()
    const replacementGroup = groupDto({
      id: "0198d874-e991-7b62-8b38-3986f55c8d4a",
      internal_key: "new_member",
      display_name: "新会员",
      description: "新注册用户的基础组",
      display_order: 20,
      is_default: false,
      revision: 1,
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([groupDto(), replacementGroup]))
      .mockResolvedValueOnce(jsonResponse({ ...replacementGroup, is_default: true, revision: 2 }))
      .mockResolvedValueOnce(jsonResponse([
        groupDto({ is_default: false, revision: 4 }),
        { ...replacementGroup, is_default: true, revision: 2 },
      ]))
    vi.stubGlobal("fetch", fetchMock)

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)

    const setting = await screen.findByRole("region", { name: "新用户默认用户组" })
    expect(within(setting).getByText("仅影响之后注册的新用户，不会迁移现有用户。")).toBeInTheDocument()
    expect(within(setting).getByRole("combobox", { name: "默认用户组" })).toHaveValue(groupId)

    await user.selectOptions(within(setting).getByRole("combobox", { name: "默认用户组" }), replacementGroup.id)
    await user.click(within(setting).getByRole("button", { name: "保存默认组" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/admin/community/default-group")
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({
      group_id: replacementGroup.id,
      expected_default_group_id: groupId,
      expected_default_revision: 3,
    })
    expect(await screen.findByText("新用户默认组已更新")).toBeInTheDocument()
    expect(screen.getByText("注册默认")).toBeInTheDocument()
  })

  it("lists user groups and saves attachment quotas from a dialog", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([groupDto()]))
      .mockResolvedValueOnce(jsonResponse({
        ...groupDto(),
        quotas: {
          ...groupDto().quotas,
          "attachment.upload.daily": 12,
          "attachment.file.bytes": 8 * 1024 * 1024,
          "attachment.storage.bytes": 250 * 1024 * 1024,
          "attachment.download.bytes.daily": 300 * 1024 * 1024,
        },
        revision: 4,
      }))
    vi.stubGlobal("fetch", fetchMock)

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)

    expect(await screen.findByText("注册会员")).toBeInTheDocument()
    expect(screen.getByText("每日 5 张")).toBeInTheDocument()
    expect(screen.getByText("单张 5 MB")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "配置注册会员的附件额度" }))
    expect(screen.getByRole("dialog", { name: "配置附件额度" })).toBeInTheDocument()

    await user.clear(screen.getByRole("spinbutton", { name: "每日上传数量" }))
    await user.type(screen.getByRole("spinbutton", { name: "每日上传数量" }), "12")
    await user.clear(screen.getByRole("spinbutton", { name: "单文件大小" }))
    await user.type(screen.getByRole("spinbutton", { name: "单文件大小" }), "8")
    await user.clear(screen.getByRole("spinbutton", { name: "总存储空间" }))
    await user.type(screen.getByRole("spinbutton", { name: "总存储空间" }), "250")
    await user.clear(screen.getByRole("spinbutton", { name: "每日下载流量" }))
    await user.type(screen.getByRole("spinbutton", { name: "每日下载流量" }), "300")
    await user.click(screen.getByRole("button", { name: "保存额度" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, updateOptions] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/v1/admin/community/groups/${groupId}`)
    expect(JSON.parse(String(updateOptions.body))).toEqual({
      expected_revision: 3,
      display_name: "注册会员",
      description: "默认基础用户组",
      display_order: 10,
      status: "active",
      permission_keys: ["attachment.download", "attachment.upload"],
      quotas: {
        "attachment.upload.daily": 12,
        "attachment.file.bytes": 8 * 1024 * 1024,
        "attachment.storage.bytes": 250 * 1024 * 1024,
        "attachment.download.bytes.daily": 300 * 1024 * 1024,
        "topic.create.daily": 10,
      },
    })
    expect(await screen.findByText("附件额度已保存")).toBeInTheDocument()
  })

  it("shows groups without edit controls for a read-only administrator", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([groupDto()])))

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite={false} />)

    expect(await screen.findByText("注册会员")).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "新用户默认用户组" })).toBeInTheDocument()
    expect(screen.getByText("仅可查看用户组与附件额度")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "保存默认组" })).toBeNull()
    expect(screen.queryByRole("button", { name: /配置注册会员/ })).toBeNull()
  })

  it("searches a user and manages additional group memberships", async () => {
    const user = userEvent.setup()
    const additionalGroup = groupDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4a", internal_key: "event_member", display_name: "活动成员", is_base: false, display_order: 20 })
    const candidateGroup = groupDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4b", internal_key: "contributor", display_name: "贡献者", is_base: false, display_order: 30 })
    const userId = "0198d874-e991-7b62-8b38-3986f55c8d4c"
    const additionalMembership = membershipDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4d", user_id: userId, group: groupSummary(additionalGroup), membership_kind: "additional" })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([groupDto(), additionalGroup, candidateGroup]))
      .mockResolvedValueOnce(jsonPageResponse([userDto(userId)]))
      .mockResolvedValueOnce(jsonResponse([
        membershipDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4e", user_id: userId, group: groupSummary(groupDto()), membership_kind: "base" }),
        additionalMembership,
      ]))
      .mockResolvedValueOnce(jsonResponse({ membership: membershipDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4f", user_id: userId, group: groupSummary(candidateGroup), membership_kind: "additional" }), replayed: false }))
      .mockResolvedValueOnce(jsonResponse({ membership: { ...additionalMembership, revoked_at: "2026-08-26T11:00:00Z", revocation_reason: "活动已结束", revision: 2 }, replayed: false }))
    vi.stubGlobal("fetch", fetchMock)

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite canReadMemberships canWriteMemberships canReadUsers />)

    expect(await screen.findByRole("heading", { name: "附加组成员管理" })).toBeInTheDocument()
    await user.type(screen.getByRole("searchbox", { name: "搜索需要绑定用户组的用户" }), "demo_member")
    await user.click(screen.getByRole("button", { name: "搜索用户" }))
    await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))

    const manager = screen.getByRole("region", { name: "附加组成员管理" })
    expect(await within(manager).findByText("注册会员")).toBeInTheDocument()
    expect(within(manager).getByText("基础组 · 自动归属")).toBeInTheDocument()
    expect(within(manager).getByRole("button", { name: "移出活动成员" })).toBeInTheDocument()

    await user.selectOptions(within(manager).getByRole("combobox", { name: "加入用户组" }), candidateGroup.id)
    await user.type(within(manager).getByRole("textbox", { name: "加入原因" }), "参与社区共建")
    await user.click(within(manager).getByRole("button", { name: "确认加入用户组" }))
    expect(await within(manager).findByText("已将演示成员加入贡献者")).toBeInTheDocument()

    await user.click(within(manager).getByRole("button", { name: "移出活动成员" }))
    await user.type(within(manager).getByRole("textbox", { name: "移出原因" }), "活动已结束")
    await user.click(within(manager).getByRole("button", { name: "确认移出" }))
    expect(await within(manager).findByText("已将演示成员移出活动成员")).toBeInTheDocument()

    expect(fetchMock.mock.calls[2][0]).toBe(`/api/v1/admin/community/memberships?user_id=${userId}`)
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/admin/community/memberships")
    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))).toMatchObject({ user_id: userId, group_id: candidateGroup.id, membership_kind: "additional", reason: "参与社区共建" })
    expect(fetchMock.mock.calls[4][0]).toBe(`/api/v1/admin/community/memberships/${additionalMembership.id}/revoke`)
  })

  it("shows memberships without mutation controls when membership write access is missing", async () => {
    const user = userEvent.setup()
    const userId = "0198d874-e991-7b62-8b38-3986f55c8d4c"
    const additionalGroup = groupDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4a", internal_key: "event_member", display_name: "活动成员", is_base: false, display_order: 20 })
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse([groupDto(), additionalGroup]))
      .mockResolvedValueOnce(jsonPageResponse([userDto(userId)]))
      .mockResolvedValueOnce(jsonResponse([membershipDto({ user_id: userId, group: groupSummary(additionalGroup), membership_kind: "additional" })])))

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite={false} canReadMemberships canWriteMemberships={false} canReadUsers />)
    await user.type(await screen.findByRole("searchbox", { name: "搜索需要绑定用户组的用户" }), "demo_member")
    await user.click(screen.getByRole("button", { name: "搜索用户" }))
    await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))

    const manager = screen.getByRole("region", { name: "附加组成员管理" })
    expect(await within(manager).findByText("当前账号仅可查看成员关系")).toBeInTheDocument()
    expect(within(manager).queryByRole("button", { name: "移出活动成员" })).toBeNull()
    expect(within(manager).queryByRole("button", { name: "确认加入用户组" })).toBeNull()
  })
})

function groupDto(overrides: Record<string, unknown> = {}) {
  return {
    id: groupId,
    internal_key: "registered_member",
    display_name: "注册会员",
    description: "默认基础用户组",
    display_order: 10,
    is_base: true,
    is_default: overrides.is_default ?? overrides.is_base !== false,
    status: "active",
    permission_keys: ["attachment.download", "attachment.upload"],
    quotas: {
      "attachment.upload.daily": 5,
      "attachment.file.bytes": 5 * 1024 * 1024,
      "attachment.storage.bytes": 100 * 1024 * 1024,
      "attachment.download.bytes.daily": 100 * 1024 * 1024,
      "topic.create.daily": 10,
    },
    revision: 3,
    created_at: "2026-08-23T10:00:00Z",
    updated_at: "2026-08-23T10:00:00Z",
    ...overrides,
  }
}

function groupSummary(group: ReturnType<typeof groupDto>) {
  return { id: group.id, internal_key: group.internal_key, display_name: group.display_name }
}

function membershipDto(overrides: Record<string, unknown>) {
  return {
    id: "0198d874-e991-7b62-8b38-3986f55c8d50",
    user_id: "0198d874-e991-7b62-8b38-3986f55c8d4c",
    group: groupSummary(groupDto()),
    membership_kind: "base",
    source: "registration",
    source_reference_id: null,
    reason: "账号注册",
    starts_at: "2026-08-23T10:00:00Z",
    ends_at: null,
    revoked_at: null,
    revocation_reason: null,
    revision: 1,
    ...overrides,
  }
}

function userDto(id: string) {
  return { id, username: "demo_member", display_name: "演示成员", avatar_url: null, status: "active", primary_role: null, topic_count: 2, post_count: 5, report_count: 0, created_at: "2026-08-23T10:00:00Z", last_seen_at: null }
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { request_id: requestId } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function jsonPageResponse(data: unknown[]): Response {
  return new Response(JSON.stringify({ data, meta: { request_id: requestId, next_cursor: null } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
