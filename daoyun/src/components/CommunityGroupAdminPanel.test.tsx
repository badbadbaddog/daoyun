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
  it("offers reversible status changes without an archive action", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([groupDto({ is_default: false })]))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await screen.findByRole("button", { name: "编辑注册会员" })
    expect(screen.queryByRole("button", { name: "归档注册会员" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "编辑注册会员" }))
    const status = screen.getByRole("combobox", { name: "用户组状态" })
    await user.selectOptions(status, "disabled")
    expect(status).toHaveValue("disabled")
    await user.selectOptions(status, "active")
    expect(status).toHaveValue("active")
    expect(screen.queryByRole("option", { name: "归档" })).not.toBeInTheDocument()
  })

  it("separates editor sections and preserves the draft when switching sections", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([groupDto()])))
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
    await user.clear(screen.getByRole("textbox", { name: "显示名称" }))
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "会员新名称")
    expect(screen.queryByRole("spinbutton", { name: "每日主题数" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "浏览与发言" }))
    await user.click(screen.getByRole("checkbox", { name: "发布主题" }))
    await user.click(screen.getByRole("tab", { name: "浏览与发言" }))
    expect(screen.getByRole("spinbutton", { name: "每日主题数" })).toBeVisible()
    await user.click(screen.getByRole("tab", { name: "基本信息" }))
    expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveValue("会员新名称")
    await user.click(screen.getByRole("tab", { name: "浏览与发言" }))
    expect(screen.getByRole("checkbox", { name: "发布主题" })).toBeChecked()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑注册会员" })).toHaveFocus())
  })

  it("validates quotas even after switching away from their section", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([groupDto()]))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
    await user.click(screen.getByRole("tab", { name: "浏览与发言" }))
    await user.clear(screen.getByRole("spinbutton", { name: "每日主题数" }))
    await user.type(screen.getByRole("spinbutton", { name: "每日主题数" }), "1000001")
    await user.click(screen.getByRole("tab", { name: "基本信息" }))
    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    expect(screen.getByRole("alert")).toHaveTextContent("请检查")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps archived groups read-only and explains that archival is permanent", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([groupDto({ is_default: false, status: "archived" })])))
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
    expect(screen.getByRole("textbox", { name: "显示名称" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "保存用户组" })).toBeDisabled()
    expect(screen.getByText("该用户组已归档，仅可查看，无法恢复或修改。")).toBeVisible()
  })

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

  it("refreshes the default-group revision conflict while keeping the intended selection", async () => {
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
    const latestDefault = groupDto({ revision: 4 })
    const savedReplacement = { ...replacementGroup, is_default: true, revision: 2 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([groupDto(), replacementGroup]))
      .mockResolvedValueOnce(jsonError(409, "community.default_group_revision_conflict", "默认用户组已被其他管理员更新"))
      .mockResolvedValueOnce(jsonResponse([latestDefault, replacementGroup]))
      .mockResolvedValueOnce(jsonResponse(savedReplacement))
      .mockResolvedValueOnce(jsonResponse([
        { ...latestDefault, is_default: false },
        savedReplacement,
      ]))
    vi.stubGlobal("fetch", fetchMock)

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    const setting = await screen.findByRole("region", { name: "新用户默认用户组" })
    const select = within(setting).getByRole("combobox", { name: "默认用户组" })
    await user.selectOptions(select, replacementGroup.id)
    await user.click(within(setting).getByRole("button", { name: "保存默认组" }))

    expect(await within(setting).findByText(/已刷新最新数据/)).toBeInTheDocument()
    expect(select).toHaveValue(replacementGroup.id)
    await user.click(within(setting).getByRole("button", { name: "保存默认组" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))).toEqual({
      group_id: replacementGroup.id,
      expected_default_group_id: groupId,
      expected_default_revision: 4,
    })
    expect(await screen.findByText("新用户默认组已更新")).toBeInTheDocument()
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

    expect((await screen.findAllByText("注册会员")).length).toBeGreaterThan(0)
    expect(screen.getByText("2 项社区权限")).toBeInTheDocument()
    expect(screen.getByText("5 项额度")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "编辑注册会员" }))
    expect(screen.getByRole("dialog", { name: "编辑用户组" })).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "附件与下载" }))

    await user.clear(screen.getByRole("spinbutton", { name: "每日上传数量" }))
    await user.type(screen.getByRole("spinbutton", { name: "每日上传数量" }), "12")
    await user.clear(screen.getByRole("spinbutton", { name: "单文件上限（MiB）" }))
    await user.type(screen.getByRole("spinbutton", { name: "单文件上限（MiB）" }), "8")
    await user.clear(screen.getByRole("spinbutton", { name: "总存储空间（MiB）" }))
    await user.type(screen.getByRole("spinbutton", { name: "总存储空间（MiB）" }), "250")
    await user.clear(screen.getByRole("spinbutton", { name: "每日下载上限（MiB）" }))
    await user.type(screen.getByRole("spinbutton", { name: "每日下载上限（MiB）" }), "300")
    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    await user.click(screen.getByRole("button", { name: "确认保存" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, updateOptions] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/v1/admin/community/groups/${groupId}`)
    expect(JSON.parse(String(updateOptions.body))).toMatchObject({
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
    expect(await screen.findByText("注册会员已保存")).toBeInTheDocument()
  })

  it("refreshes an edited group revision after a conflict without discarding local fields", async () => {
    const user = userEvent.setup()
    const latest = groupDto({ display_name: "服务器会员", revision: 4 })
    const saved = groupDto({ display_name: "本地草稿会员", revision: 5 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([groupDto()]))
      .mockResolvedValueOnce(jsonError(409, "community.group_revision_conflict", "用户组已被其他管理员更新"))
      .mockResolvedValueOnce(jsonResponse([latest]))
      .mockResolvedValueOnce(jsonResponse(saved))
    vi.stubGlobal("fetch", fetchMock)

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
    const name = screen.getByRole("textbox", { name: "显示名称" })
    await user.clear(name)
    await user.type(name, "本地草稿会员")
    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    await user.click(screen.getByRole("button", { name: "确认保存" }))

    expect(await screen.findByText("数据已被其他管理员更新")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "刷新最新数据" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveValue("本地草稿会员")

    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    expect(screen.getByRole("region", { name: "保存前变更预览" })).toHaveTextContent("服务器会员")
    expect(screen.getByRole("region", { name: "保存前变更预览" })).toHaveTextContent("修订 4")
    await user.click(screen.getByRole("button", { name: "确认保存" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))).toMatchObject({
      expected_revision: 4,
      display_name: "本地草稿会员",
    })
  })

  it("shows groups without edit controls for a read-only administrator", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([groupDto()])))

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite={false} />)

    expect((await screen.findAllByText("注册会员")).length).toBeGreaterThan(0)
    expect(screen.getByRole("region", { name: "新用户默认用户组" })).toBeInTheDocument()
    expect(screen.getByText("仅可查看用户组、权限与额度")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "保存默认组" })).toBeNull()
    expect(screen.queryByRole("button", { name: /编辑注册会员/ })).toBeNull()
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

  it("refreshes a membership revision conflict without discarding the removal reason", async () => {
    const user = userEvent.setup()
    const userId = "0198d874-e991-7b62-8b38-3986f55c8d4c"
    const additionalGroup = groupDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4a", internal_key: "event_member", display_name: "活动成员", is_base: false, display_order: 20 })
    const membership = membershipDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4d", user_id: userId, group: groupSummary(additionalGroup), membership_kind: "additional", revision: 1 })
    const latestMembership = { ...membership, revision: 2 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([groupDto(), additionalGroup]))
      .mockResolvedValueOnce(jsonPageResponse([userDto(userId)]))
      .mockResolvedValueOnce(jsonResponse([membership]))
      .mockResolvedValueOnce(jsonError(409, "community.membership_revision_conflict", "成员关系已被其他请求更新"))
      .mockResolvedValueOnce(jsonResponse([latestMembership]))
      .mockResolvedValueOnce(jsonResponse({ membership: { ...latestMembership, revoked_at: "2026-08-26T11:00:00Z", revocation_reason: "活动结束", revision: 3 }, replayed: false }))
    vi.stubGlobal("fetch", fetchMock)

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite canReadMemberships canWriteMemberships canReadUsers />)
    await user.type(await screen.findByRole("searchbox", { name: "搜索需要绑定用户组的用户" }), "demo_member")
    await user.click(screen.getByRole("button", { name: "搜索用户" }))
    await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))
    await user.click(await screen.findByRole("button", { name: "移出活动成员" }))
    const reason = screen.getByRole("textbox", { name: "移出原因" })
    await user.type(reason, "活动结束")
    await user.click(screen.getByRole("button", { name: "确认移出" }))

    expect(await screen.findByText("数据已被其他管理员更新")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "刷新最新数据" }))
    expect(reason).toHaveValue("活动结束")

    await user.click(screen.getByRole("button", { name: "确认移出" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
    expect(JSON.parse(String((fetchMock.mock.calls[5][1] as RequestInit).body))).toMatchObject({
      expected_revision: 2,
      reason: "活动结束",
    })
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

describe("DY-ADMIN-MEMBER-002 group safeguards", () => {
  it("shows membership metadata and keeps the default base group active", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([groupDto({
      member_count: 128,
      expiring_member_count: 7,
      access_policy_reference_count: 3,
    })])))

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)

    const row = await screen.findByRole("listitem")
    expect(within(row).getByText("128 位成员")).toBeInTheDocument()
    expect(within(row).getByText("7 位即将到期")).toBeInTheDocument()
    expect(within(row).getByText("3 个访问策略引用")).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: "归档注册会员" })).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole("button", { name: "编辑注册会员" }))
    expect(screen.getByRole("combobox", { name: "用户组状态" })).toBeDisabled()
  })

  it("creates a sorted additional group with complete permissions and quotas", async () => {
    const user = userEvent.setup()
    const created = groupDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d70", internal_key: "contributors", display_name: "贡献者", description: "社区贡献者", is_base: false, is_default: false, display_order: 20, permission_keys: ["topic.create"], revision: 1 })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([groupDto()])).mockResolvedValueOnce(jsonResponse(created))
    vi.stubGlobal("fetch", fetchMock)

    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "创建用户组" }))
    expect(screen.getByLabelText("内部键")).not.toBeVisible()
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "贡献者")
    await user.type(screen.getByRole("textbox", { name: "用户组说明" }), "社区贡献者")
    await user.click(screen.getByRole("tab", { name: "浏览与发言" }))
    await user.click(screen.getByRole("checkbox", { name: "发布主题" }))
    await user.click(screen.getByRole("button", { name: "创建用户组" }))
    await user.click(screen.getByRole("button", { name: "确认创建" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/admin/community/groups")
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({ internal_key: expect.stringMatching(/^[a-z][a-z0-9_]{2,63}$/), is_base: false, display_order: 20, permission_keys: ["topic.create"], quotas: { "topic.create.daily": 0, "attachment.storage.bytes": 0 } })
    expect(await screen.findByText("贡献者已创建")).toBeInTheDocument()
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

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message }, meta: { request_id: requestId } }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function jsonPageResponse(data: unknown[]): Response {
  return new Response(JSON.stringify({ data, meta: { request_id: requestId, next_cursor: null } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}


describe("V3 group directory and timed grants", () => {
  it("searches same-name groups by stable identity without inventing missing counts", async () => {
    const user = userEvent.setup()
    const second = groupDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4a", internal_key: "second_member", display_name: "注册会员", is_base: false, display_order: 20 })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([groupDto(), second])))
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    const list = await screen.findByRole("list", { name: "用户组列表" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
    expect(within(list).queryAllByText("0 位成员")).toHaveLength(0)
    expect(within(list).getAllByText("成员统计暂不可用")).toHaveLength(2)
    await user.type(screen.getByRole("searchbox", { name: "搜索用户组" }), "second_member")
    const rows = within(list).getAllByRole("listitem")
    expect(rows).toHaveLength(1)
    await user.click(within(rows[0]).getByRole("button", { name: /编辑注册会员/ }))
    await user.click(screen.getByText("高级标识", { selector: "summary" }))
    expect(screen.getByRole("textbox", { name: "内部键" })).toHaveValue("second_member")
    expect(screen.getByRole("textbox", { name: "内部键" })).toHaveAttribute("readonly")
  })

  it("sends the selected expiry and distinguishes groups sharing a display name", async () => {
    const user = userEvent.setup()
    const targetId = "0198d874-e991-7b62-8b38-3986f55c8d4c"
    const candidate = groupDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d4a", internal_key: "event_member", display_name: "注册会员", is_base: false, display_order: 20 })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([groupDto(), candidate]))
      .mockResolvedValueOnce(jsonPageResponse([userDto(targetId)]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ membership: membershipDto({ user_id: targetId, group: groupSummary(candidate), membership_kind: "additional", ends_at: "2099-01-01T00:00:00Z" }), replayed: false }))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite canReadMemberships canWriteMemberships canReadUsers />)
    await user.type(await screen.findByRole("searchbox", { name: "搜索需要绑定用户组的用户" }), "demo_member")
    await user.click(screen.getByRole("button", { name: "搜索用户" }))
    await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))
    const select = await screen.findByRole("combobox", { name: "加入用户组" })
    expect(within(select).getByRole("option").textContent).toContain(candidate.id.slice(-8))
    expect(within(select).queryByRole("option", { name: /管理员|版主/ })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole("combobox", { name: "授予期限" }), "7")
    await user.type(screen.getByRole("textbox", { name: "加入原因" }), "短期活动参与")
    await user.click(screen.getByRole("button", { name: "确认加入用户组" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    const body = JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))
    expect(Date.parse(body.ends_at) - Date.parse(body.starts_at)).toBe(7 * 86400000)
    expect(body).toMatchObject({ group_id: candidate.id, membership_kind: "additional", reason: "短期活动参与" })
  })
})


it("blocks grants when current memberships cannot be confirmed", async () => {
  const user = userEvent.setup()
  const candidate = groupDto({ is_base: false, is_default: false })
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([candidate])).mockResolvedValueOnce(jsonPageResponse([userDto("0198d874-e991-7b62-8b38-3986f55c8d4c")])).mockResolvedValueOnce(jsonError(500, "membership.unavailable", "无法读取当前身份")))
  render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite canReadMemberships canWriteMemberships canReadUsers />)
  await user.type(await screen.findByRole("searchbox", { name: "搜索需要绑定用户组的用户" }), "demo_member")
  await user.click(screen.getByRole("button", { name: "搜索用户" }))
  await user.click(await screen.findByRole("button", { name: "选择演示成员 @demo_member" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("无法读取当前身份")
  expect(screen.queryByRole("button", { name: "确认加入用户组" })).not.toBeInTheDocument()
  expect(screen.queryByText("当前用户没有有效用户组")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "刷新成员关系" })).toBeEnabled()
})


describe("V3 group rules, copies and comparisons", () => {
  it("previews changed fields and the revision before sending a write", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([groupDto()])).mockResolvedValueOnce(jsonResponse(groupDto({ display_name: "预览后的会员", revision: 4 })))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
    await user.clear(screen.getByRole("textbox", { name: "显示名称" }))
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "预览后的会员")
    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const preview = screen.getByRole("region", { name: "保存前变更预览" })
    expect(within(preview).getByText("注册会员")).toBeVisible()
    expect(within(preview).getByText("预览后的会员")).toBeVisible()
    expect(within(preview).getByText(/修订 3/)).toBeVisible()
    await user.click(screen.getByRole("button", { name: "返回编辑" }))
    expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveValue("预览后的会员")
    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    await user.click(screen.getByRole("button", { name: "确认保存" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({ expected_revision: 3, display_name: "预览后的会员" })
  })

  it.each([0, 1.5])("submits %s MiB as exact bytes and keeps zero as no quota", async mib => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([groupDto()])).mockResolvedValueOnce(jsonResponse(groupDto({ revision: 4 })))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
    await user.click(screen.getByRole("tab", { name: "附件与下载" }))
    const file = screen.getByRole("spinbutton", { name: "单文件上限（MiB）" })
    expect(file).toHaveValue(5)
    await user.clear(file); await user.type(file, String(mib))
    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    expect(screen.getByRole("region", { name: "保存前变更预览" })).toHaveTextContent(mib === 0 ? "0 MiB（不提供）" : "1.5 MiB")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "确认保存" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).quotas["attachment.file.bytes"]).toBe(mib * 1048576)
  })

  it.each([1, Number.MAX_SAFE_INTEGER])("preserves an existing %s-byte quota through MiB editing", async bytes => {
    const user = userEvent.setup()
    const original = groupDto({ quotas: { ...groupDto().quotas, "attachment.file.bytes": bytes, "attachment.storage.bytes": Number.MAX_SAFE_INTEGER } })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([original])).mockResolvedValueOnce(jsonResponse({ ...original, revision: 4 }))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
    await user.click(screen.getByRole("tab", { name: "附件与下载" }))
    expect(screen.getByRole("spinbutton", { name: "单文件上限（MiB）" })).toHaveValue(bytes / 1048576)
    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    await user.click(screen.getByRole("button", { name: "确认保存" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const quotas = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).quotas
    expect(quotas["attachment.file.bytes"]).toBe(bytes)
    expect(quotas["attachment.storage.bytes"]).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each(["0.1", "8589934592"])("rejects %s MiB when it cannot become a safe integer number of bytes", async value => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([groupDto()]))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
    await user.click(screen.getByRole("tab", { name: "附件与下载" }))
    const file = screen.getByRole("spinbutton", { name: "单文件上限（MiB）" })
    await user.clear(file); await user.type(file, value)
    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    expect(screen.getByRole("alert")).toHaveTextContent("精确到字节")
    expect(screen.queryByRole("region", { name: "保存前变更预览" })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("separates the review requirement from provided abilities without changing its key", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([groupDto()])).mockResolvedValueOnce(jsonResponse(groupDto({ revision: 4 })))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
    await user.click(screen.getByRole("tab", { name: "浏览与发言" }))
    expect(screen.queryByRole("checkbox", { name: "内容须预审" })).not.toBeInTheDocument()
    expect(within(screen.getByRole("tabpanel",{name:"浏览与发言"})).getByText(/未选择表示本组不提供/)).toBeVisible()
    await user.click(screen.getByRole("tab", { name: "审核要求" }))
    await user.click(screen.getByRole("checkbox", { name: "发布内容需要审核" }))
    await user.click(screen.getByRole("button", { name: "保存用户组" }))
    expect(screen.getByRole("region", { name: "保存前变更预览" })).toHaveTextContent("需要审核")
    await user.click(screen.getByRole("button", { name: "确认保存" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).permission_keys).toEqual(["attachment.download", "attachment.upload", "content.pre_moderation.required"])
  })

  it("copies rules into a new draft and never updates the source group", async () => {
    const user = userEvent.setup()
    const source = groupDto()
    const created = groupDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d70", display_name: "注册会员 副本", internal_key: "group_copy", is_default: false, revision: 1 })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([source])).mockResolvedValueOnce(jsonResponse(created))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
    await user.click(await screen.findByRole("button", { name: "复制注册会员" }))
    const editor = screen.getByRole("dialog", { name: "创建用户组" })
    expect(within(editor).getByRole("textbox", { name: "显示名称" })).toHaveValue("注册会员 副本")
    await user.click(within(editor).getByText("高级标识", { selector: "summary" }))
    expect(within(editor).getByRole("textbox", { name: "内部键" })).not.toHaveValue(source.internal_key)
    await user.click(screen.getByRole("tab", { name: "附件与下载" }))
    expect(screen.getByRole("spinbutton", { name: "单文件上限（MiB）" })).toHaveValue(5)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "创建用户组" }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "确认创建" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/admin/community/groups")
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({ is_base: true, permission_keys: source.permission_keys, quotas: source.quotas })
    expect(screen.getByRole("button", { name: "编辑注册会员" })).toBeVisible()
  })

  it("compares two to four stable group identities and filters identical rules", async () => {
    const user = userEvent.setup()
    const values = [groupDto(), ...[1, 2, 3, 4].map(index => groupDto({ id: "0198d874-e991-7b62-8b38-3986f55c8d7" + index, internal_key: "additional_" + index, display_name: "附加组 " + index, is_base: false, is_default: false, display_order: 10 + index, permission_keys: ["attachment.download"] }))]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(values))
    vi.stubGlobal("fetch", fetchMock)
    render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite={false} />)
    await user.click(await screen.findByRole("button", { name: "比较用户组" }))
    const dialog = screen.getByRole("dialog", { name: "用户组对比" })
    expect(within(dialog).getByRole("table", { name: "用户组规则对比" })).toBeVisible()
    expect(within(dialog).getByText(/具体用户的最终权限/)).toBeVisible()
    await user.click(within(dialog).getByRole("checkbox", { name: "只看差异" }))
    expect(within(dialog).queryByRole("rowheader", { name: "单文件上限（MiB）" })).not.toBeInTheDocument()
    expect(within(dialog).getByRole("rowheader", { name: "上传附件" })).toBeVisible()
    await user.click(within(dialog).getByRole("checkbox", { name: "对比附加组 2 · " + values[2].id.slice(-8) }))
    await user.click(within(dialog).getByRole("checkbox", { name: "对比附加组 3 · " + values[3].id.slice(-8) }))
    expect(within(dialog).getByRole("checkbox", { name: "对比附加组 4 · " + values[4].id.slice(-8) })).toBeDisabled()
    expect(within(dialog).queryByRole("button", { name: /编辑/ })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})


it("loads a group's change records only when the permitted history section is opened", async () => {
  const user = userEvent.setup()
  const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([groupDto()])).mockResolvedValueOnce(jsonPageResponse([]))
  vi.stubGlobal("fetch", fetchMock)
  render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite canReadAudit />)
  await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole("tab", { name: "成员与期限" }))
  expect(await screen.findByText("暂无相关操作记录。")).toBeVisible()
  expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/admin/audit?resource_id=" + groupId + "&limit=10")
})

it("locates and describes a hidden quota error without submitting", async () => {
  const user = userEvent.setup()
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse([groupDto()]))
  vi.stubGlobal("fetch", fetchMock)
  render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
  await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
  await user.click(screen.getByRole("tab", { name: "浏览与发言" }))
  await user.clear(screen.getByRole("spinbutton", { name: "每日主题数" }))
  await user.type(screen.getByRole("spinbutton", { name: "每日主题数" }), "1000001")
  await user.click(screen.getByRole("tab", { name: "基本信息" }))
  await user.click(screen.getByRole("button", { name: "保存用户组" }))
  const field = await screen.findByRole("spinbutton", { name: "每日主题数" })
  expect(field).toHaveAttribute("aria-invalid", "true")
  expect(field).toHaveAccessibleDescription(/不能超过/)
  await waitFor(() => expect(field).toHaveFocus())
  await user.click(screen.getByRole("tab", { name: "基本信息" }))
  expect(screen.getByRole("textbox", { name: "显示名称" })).toBeVisible()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it("returns to and describes an empty name after validation from another section", async () => {
  const user = userEvent.setup()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([groupDto()])))
  render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite />)
  await user.click(await screen.findByRole("button", { name: "编辑注册会员" }))
  await user.clear(screen.getByRole("textbox", { name: "显示名称" }))
  await user.click(screen.getByRole("tab", { name: "浏览与发言" }))
  await user.click(screen.getByRole("button", { name: "保存用户组" }))
  const field = await screen.findByRole("textbox", { name: "显示名称" })
  expect(field).toHaveAttribute("aria-invalid", "true")
  expect(field).toHaveAccessibleDescription("请输入显示名称。")
  await waitFor(() => expect(field).toHaveFocus())
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription(/请检查/)
})

it("exposes seven stable editor tabs with keyboard navigation and ordinary capabilities only",async()=>{
 const user=userEvent.setup();vi.stubGlobal("fetch",vi.fn().mockResolvedValue(jsonResponse([groupDto()])));render(<CommunityGroupAdminPanel csrfToken="csrf-token" canWrite/>);await user.click(await screen.findByRole("button",{name:"编辑注册会员"}));const tabs=screen.getAllByRole("tab");expect(tabs.map(tab=>tab.textContent)).toEqual(["基本信息","浏览与发言","互动与私信","附件与下载","资料与外链","审核要求","成员与期限"])
 expect(screen.getByRole("heading",{name:"编辑用户组",level:2})).toBeInTheDocument()
 for(const tab of tabs)expect(document.getElementById(tab.getAttribute("aria-controls")!)).toHaveAttribute("role","tabpanel")
 tabs[0].focus();await user.keyboard("{ArrowRight}");expect(tabs[1]).toHaveFocus();expect(tabs[1]).toHaveAttribute("aria-selected","true");await user.click(screen.getByRole("checkbox",{name:"发布主题"}));tabs[1].focus();await user.keyboard("{End}");expect(tabs[6]).toHaveFocus();
 expect(screen.queryByRole("checkbox",{name:/治理|角色|审核报告/})).not.toBeInTheDocument();await user.click(tabs[1]);expect(screen.getByRole("heading",{name:"浏览与发言",level:3})).toBeInTheDocument();expect(screen.getByRole("checkbox",{name:"发布主题"})).toBeChecked();expect(screen.getByRole("spinbutton",{name:"每日主题数"})).toBeVisible()
})
