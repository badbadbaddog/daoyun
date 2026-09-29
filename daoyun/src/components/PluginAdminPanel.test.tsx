import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  PluginApiError,
  deletePlugin,
  executePluginUiAction,
  installPlugin,
  invokePlugin,
  listPluginUiContributions,
  listPlugins,
  updatePluginStatus,
  type Plugin,
} from "../api/plugins"
import { PluginAdminPanel } from "./PluginAdminPanel"

vi.mock("../api/plugins", async () => {
  const actual = await vi.importActual<typeof import("../api/plugins")>("../api/plugins")
  return {
    ...actual,
    deletePlugin: vi.fn(),
    executePluginUiAction: vi.fn(),
    installPlugin: vi.fn(),
    invokePlugin: vi.fn(),
    listPluginUiContributions: vi.fn(),
    listPlugins: vi.fn(),
    updatePluginStatus: vi.fn(),
  }
})

const plugin: Plugin = {
  id: "019fc900-0000-7000-8000-000000000801",
  key: "identity_plugin",
  name: "Identity plugin",
  version: "1.0.0",
  description: "Fixture",
  manifestSchemaVersion: 1,
  businessApiVersion: "0.1.0",
  capabilities: ["ui.panel", "core.query", "points.write"],
  dataScopes: ["site.read", "users.targeted"],
  eventSubscriptions: [],
  componentSha256: "a".repeat(64),
  componentSize: 1024,
  status: "disabled",
  revision: 1,
  installedBy: "019fc900-0000-7000-8000-000000000802",
  createdAt: "2026-08-11T01:00:00Z",
  updatedAt: "2026-08-11T01:00:00Z",
}

const legacyPlugin: Plugin = {
  ...plugin,
  businessApiVersion: null,
  capabilities: ["content.transform", "ui.panel"],
  dataScopes: [],
}


async function openPluginPanel(user: ReturnType<typeof userEvent.setup>, name = "Identity plugin", tab?: "权限" | "详情") {
  await user.click(await screen.findByRole("button", { name: "查看插件：" + name }))
  if (tab) await user.click(screen.getByRole("tab", { name: tab }))
}

async function openDeveloperTools(user: ReturnType<typeof userEvent.setup>, name = "Identity plugin") {
  await openPluginPanel(user, name)
  await user.click(screen.getByText("高级与开发者工具"))
  await user.click(screen.getByRole("button", { name: "开发者工具" }))
}

beforeEach(() => {
  vi.mocked(listPlugins).mockResolvedValue([plugin])
  vi.mocked(installPlugin).mockResolvedValue(plugin)
  vi.mocked(updatePluginStatus).mockResolvedValue({ ...plugin, status: "enabled", revision: 2 })
  vi.mocked(deletePlugin).mockResolvedValue(true)
  vi.mocked(executePluginUiAction).mockResolvedValue({ executedCommands: 1 })
  vi.mocked(listPluginUiContributions).mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("PluginAdminPanel", () => {
  it("closes developer access when invoke permission is removed", async () => {
    const user = userEvent.setup()
    vi.mocked(listPlugins).mockResolvedValueOnce([{ ...legacyPlugin, status: "enabled" }])
    const view = render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke />)
    await openDeveloperTools(user)
    view.rerender(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke={false} />)
    expect(screen.queryByRole("dialog", { name: "开发者工具：Identity plugin" })).not.toBeInTheDocument()
  })

  it("separates the official catalog and filters installed plugins", async () => {
    const user = userEvent.setup()
    vi.mocked(listPlugins).mockResolvedValueOnce([plugin, { ...legacyPlugin, id: "second", name: "Second plugin", key: "second_plugin", status: "enabled" }])
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle canInvoke={false} />)
    await screen.findByText("Identity plugin")
    expect(screen.queryByRole("article", { name: "官方插件：帖子补充" })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("插件状态"), "enabled")
    expect(screen.queryByText("Identity plugin")).not.toBeInTheDocument()
    await user.type(screen.getByRole("searchbox", { name: "搜索插件" }), "missing")
    expect(screen.getByText("没有符合条件的插件")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "清除筛选" }))
    expect(screen.getByText("Identity plugin")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "官方插件" }))
    expect(screen.getByRole("article", { name: "官方插件：帖子补充" })).toBeInTheDocument()
    expect(screen.queryByText("Identity plugin")).not.toBeInTheDocument()
  })

  it("opens one plugin panel with permission and detail sections and restores focus", async () => {
    const user = userEvent.setup()
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke />)
    const trigger = await screen.findByRole("button", { name: "查看插件：Identity plugin" })
    expect(screen.queryByText("高风险")).not.toBeInTheDocument()
    await user.click(trigger)
    const detail = screen.getByRole("region", { name: "插件：Identity plugin" })
    await user.click(within(detail).getByRole("tab", { name: "权限" }))
    expect(within(detail).getByText("高风险")).toBeInTheDocument()
    await user.click(within(detail).getByRole("tab", { name: "详情" }))
    expect(within(detail).getByText("业务 ABI 0.1.0")).toBeInTheDocument()
    await user.click(trigger)
    expect(detail).toHaveFocus()
    await user.click(within(detail).getByRole("button", { name: "关闭插件面板" }))
    expect(screen.queryByRole("region", { name: "插件：Identity plugin" })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("classifies atomic redemption as high risk", async () => {
    vi.mocked(listPlugins).mockResolvedValueOnce([{ ...plugin, capabilities: ["membership.redemption", "ui.panel"], dataScopes: [] }])
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke={false} />)
    await openPluginPanel(userEvent.setup(), "Identity plugin", "权限")
    expect(await screen.findByText("高风险")).toBeInTheDocument()
  })

  it("keeps supplement configuration separate from content review", async () => {
    vi.mocked(listPlugins).mockResolvedValueOnce([{ ...plugin, capabilities: ["topic.supplements", "ui.panel"] }])
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle canInvoke={false} canConfigure />)

    expect(await screen.findByRole("button", { name: "查看插件：Identity plugin" })).toHaveTextContent("设置")
    expect(screen.queryByRole("button", { name: "审核补充" })).not.toBeInTheDocument()
  })

  it("does not show another plugin's invocation error in a newly opened tool dialog", async () => {
    const user = userEvent.setup()
    vi.mocked(listPlugins).mockResolvedValueOnce([
      { ...legacyPlugin, status: "enabled" },
      { ...legacyPlugin, id: "019fc900-0000-7000-8000-000000000803", name: "Second plugin", status: "enabled" },
    ])
    vi.mocked(invokePlugin).mockRejectedValueOnce(new PluginApiError(500, "plugin.failure", "第一个插件调用失败"))
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle canInvoke />)
    await openDeveloperTools(user)
    await user.click(screen.getByRole("button", { name: "转换内容：Identity plugin" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("第一个插件调用失败")
    await user.keyboard("{Escape}")
    await openDeveloperTools(user, "Second plugin")
    expect(within(screen.getByRole("dialog", { name: "开发者工具：Second plugin" })).queryByRole("alert")).not.toBeInTheDocument()
  })

  it("opens installation on demand and preserves the draft after closing", async () => {
    const user = userEvent.setup()
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle={false} canInvoke={false} />)
    await screen.findByText("identity_plugin · 1.0.0")
    expect(screen.queryByLabelText("插件键")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "安装插件" }))
    const dialog = screen.getByRole("dialog", { name: "安装插件" })
    await user.type(within(dialog).getByLabelText("名称"), "新插件")
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "安装插件" }))
    expect(screen.getByLabelText("名称")).toHaveValue("新插件")
  })
  it("loads metadata and applies lifecycle changes with revision and CSRF", async () => {
    const user = userEvent.setup()
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle canInvoke />)

    expect(await screen.findByRole("heading", { name: "插件管理" })).toBeInTheDocument()
    expect(screen.getByText("identity_plugin · 1.0.0")).toBeInTheDocument()
    await openPluginPanel(user, "Identity plugin", "详情")
    expect(screen.getByText("业务 ABI 0.1.0")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "权限" }))
    expect(screen.getByText("站点只读、定向用户操作")).toBeInTheDocument()
    await user.click(screen.getByRole("switch", { name: "启用插件：Identity plugin" }))

    expect(updatePluginStatus).toHaveBeenCalledWith(plugin.id, "enabled", 1, "csrf")
    expect(await screen.findByText("插件已启用")).toBeInTheDocument()
  })

  it("hides install, lifecycle and invoke controls without their capabilities", async () => {
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke={false} />)

    await screen.findByText("identity_plugin · 1.0.0")
    expect(screen.queryByRole("heading", { name: "安装插件" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "启用插件：Identity plugin" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("调用输入：Identity plugin")).not.toBeInTheDocument()
  })

  it("requires an accessible confirmation before uninstalling a disabled plugin", async () => {
    const user = userEvent.setup()
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle canInvoke={false} />)
    await screen.findByText("identity_plugin · 1.0.0")

    const trigger = screen.getByRole("button", { name: "更多操作：Identity plugin" })
    await user.click(trigger)
    await user.click(screen.getByRole("menuitem", { name: "卸载插件：Identity plugin" }))
    const dialog = screen.getByRole("alertdialog", { name: "卸载插件“Identity plugin”" })
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus()
    expect(deletePlugin).not.toHaveBeenCalled()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("alertdialog", { name: "卸载插件“Identity plugin”" })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    await user.click(screen.getByRole("menuitem", { name: "卸载插件：Identity plugin" }))
    await user.click(screen.getByRole("button", { name: "确认卸载插件" }))
    await waitFor(() => expect(deletePlugin).toHaveBeenCalledWith(plugin.id, "csrf"))
    expect(await screen.findByText("插件已卸载")).toBeInTheDocument()
  })

  it("rejects an oversized component before reading or uploading it", async () => {
    const user = userEvent.setup()
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle canInvoke />)
    await screen.findByText("identity_plugin · 1.0.0")
    await user.click(screen.getByRole("button", { name: "安装插件" }))
    await user.type(screen.getByLabelText("插件键"), "large_plugin")
    await user.type(screen.getByLabelText("名称"), "Large plugin")
    await user.click(screen.getByRole("button", { name: "下一步：能力审批" }))
    await user.click(screen.getByRole("button", { name: "下一步：组件文件" }))
    const file = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "too-large.wasm", { type: "application/wasm" })

    await user.upload(screen.getByLabelText("WebAssembly Component 文件"), file)

    expect(await screen.findByRole("alert")).toHaveTextContent("组件文件不能超过 8 MiB")
    expect(installPlugin).not.toHaveBeenCalled()
  })

  it("renders validated schema in an empty sandbox with escaped static srcdoc", async () => {
    const user = userEvent.setup()
    const enabled = { ...legacyPlugin, status: "enabled" as const, revision: 2 }
    vi.mocked(listPlugins).mockResolvedValueOnce([enabled])
    vi.mocked(invokePlugin).mockResolvedValueOnce({
      operation: "ui_render",
      payload: "ignored",
      uiSchema: {
        schemaVersion: 1,
        title: "Safe panel",
        blocks: [{ kind: "text", text: "<img src=x onerror=alert(1)>" }],
      },
    })
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle canInvoke />)

    await openDeveloperTools(user)
    await user.click(await screen.findByRole("button", { name: "渲染面板：Identity plugin" }))
    const frame = await screen.findByTitle("插件面板：Safe panel")
    expect(frame).toHaveAttribute("sandbox", "")
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer")
    const srcdoc = frame.getAttribute("srcdoc") ?? ""
    expect(srcdoc).toContain("default-src &#39;none&#39;")
    expect(srcdoc).toContain("&lt;img src=x onerror=alert(1)&gt;")
    expect(srcdoc).not.toContain("<img src=x")
    expect(srcdoc).not.toContain("<script")
  })

  it("reloads authoritative state after a revision conflict", async () => {
    const user = userEvent.setup()
    vi.mocked(updatePluginStatus).mockRejectedValueOnce(new PluginApiError(409, "plugin.conflict", "冲突"))
    vi.mocked(listPlugins).mockResolvedValueOnce([plugin]).mockResolvedValueOnce([{ ...plugin, revision: 2 }])
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle canInvoke={false} />)

    await user.click(await screen.findByRole("switch", { name: "启用插件：Identity plugin" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("插件状态已变化，列表已刷新")
    await waitFor(() => expect(listPlugins).toHaveBeenCalledTimes(2))
  })

  it("renders only the approved admin plugin contribution in a sandbox", async () => {
    vi.mocked(listPlugins).mockResolvedValueOnce([{
      ...plugin,
      status: "enabled",
      capabilities: ["ui.panel", "events.subscribe"],
      eventSubscriptions: ["topic.published"],
    }])
    vi.mocked(listPluginUiContributions).mockResolvedValueOnce([
      {
        slot: "admin_plugin",
        schema: {
          schemaVersion: 1,
          title: "业务扩展状态",
          blocks: [{ kind: "status", tone: "success", text: "运行正常" }],
        },
      },
      {
        slot: "user_profile",
        schema: {
          schemaVersion: 1,
          title: "用户资料扩展",
          blocks: [{ kind: "text", text: "不属于当前插槽" }],
        },
      },
    ])

    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke={false} />)

    await openPluginPanel(userEvent.setup())
    expect(await screen.findByTitle("插件面板：业务扩展状态")).toHaveAttribute("sandbox", "")
    expect(screen.queryByTitle("插件面板：用户资料扩展")).not.toBeInTheDocument()
  })

  it("runs approved fixed actions in the host with CSRF and keeps them out of sandbox HTML", async () => {
    const user = userEvent.setup()
    vi.mocked(listPlugins).mockResolvedValueOnce([{ ...plugin, status: "enabled" }])
    vi.mocked(listPluginUiContributions).mockResolvedValueOnce([{
      slot: "admin_plugin",
      schema: {
        schemaVersion: 1,
        title: "业务扩展状态",
        blocks: [
          { kind: "text", text: "运行正常" },
          { kind: "action", label: "发送测试通知", action_key: "notification.send_test" },
        ],
      },
    }])

    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke />)

    await openPluginPanel(user)
    const frame = await screen.findByTitle("插件面板：业务扩展状态")
    expect(frame.getAttribute("srcdoc")).not.toContain("notification.send_test")
    await user.click(screen.getByRole("button", { name: "发送测试通知" }))
    expect(executePluginUiAction).toHaveBeenCalledWith(
      plugin.id,
      "notification.send_test",
      expect.any(String),
      "csrf",
    )
    expect(await screen.findByText("插件动作已执行（1 条命令）")).toBeInTheDocument()
  })

  it("shows productized runtime and risk information while separating developer tools", async () => {
    const user = userEvent.setup()
    vi.mocked(listPlugins).mockResolvedValueOnce([{ ...plugin, status: "enabled" }])
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke />)

    await screen.findByText("identity_plugin · 1.0.0")
    await openPluginPanel(user, "Identity plugin", "权限")
    expect(screen.getByText("高风险")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "详情" }))
    expect(screen.getByText("运行状态").nextElementSibling).toHaveTextContent("正在运行")
    expect(screen.getByText("WIT / ABI").nextElementSibling).toHaveTextContent("0.1.0")
    expect(screen.getByText("组件").nextElementSibling).toHaveTextContent("1.0 KiB")
    expect(screen.getByText("组件").nextElementSibling).toHaveTextContent("aaaaaaaaaaaa")
    expect(screen.getByText("Revision").nextElementSibling).toHaveTextContent("1")
    expect(screen.queryByLabelText("调用输入：Identity plugin")).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "设置" }))
    await user.click(screen.getByText("高级与开发者工具"))
    await user.click(screen.getByRole("button", { name: "开发者工具" }))
    const developerTools = screen.getByRole("dialog", { name: "开发者工具：Identity plugin" })
    expect(within(developerTools).getByLabelText("调用输入：Identity plugin")).toBeInTheDocument()
  })

  it("classifies read-only, event, user-write and notification capabilities as low through critical risk", async () => {
    const riskPlugins: Plugin[] = [
      { ...plugin, id: "low", key: "low", name: "Low plugin", capabilities: ["ui.panel", "core.query"], dataScopes: ["site.read"] },
      { ...plugin, id: "medium", key: "medium", name: "Medium plugin", capabilities: ["events.subscribe"], dataScopes: [], eventSubscriptions: ["topic.published"] },
      { ...plugin, id: "high", key: "high", name: "High plugin", capabilities: ["points.write"], dataScopes: ["users.targeted"] },
      { ...plugin, id: "critical", key: "critical", name: "Critical plugin", capabilities: ["notifications.write"], dataScopes: ["users.targeted"] },
    ]
    vi.mocked(listPlugins).mockResolvedValueOnce(riskPlugins)
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke={false} />)

    for (const [name, risk] of [["Low plugin", "低风险"], ["Medium plugin", "中风险"], ["High plugin", "高风险"], ["Critical plugin", "严重风险"]] as const) {
      await openPluginPanel(userEvent.setup(), name, "权限")
      expect(within(screen.getByRole("region", { name: "插件：" + name })).getByText(risk)).toBeInTheDocument()
    }
  })

  it("uses a four-step install wizard and previews the manifest risk before installation", async () => {
    const user = userEvent.setup()
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle={false} canInvoke={false} />)
    await screen.findByText("identity_plugin · 1.0.0")

    await user.click(screen.getByRole("button", { name: "安装插件" }))
    await user.type(screen.getByLabelText("插件键"), "demo_plugin")
    await user.type(screen.getByLabelText("名称"), "Demo plugin")
    await user.click(screen.getByRole("button", { name: "下一步：能力审批" }))
    expect(screen.getByText("步骤 2 / 4 · 能力审批")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "下一步：组件文件" }))
    expect(screen.getByText("步骤 3 / 4 · 组件文件")).toBeInTheDocument()
    const file = new File([new Uint8Array([0, 97, 115, 109, 13, 0, 1, 0])], "demo.wasm", { type: "application/wasm" })
    await user.upload(screen.getByLabelText("WebAssembly Component 文件"), file)
    expect(screen.getByText("文件预检通过")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "下一步：确认安装" }))
    expect(screen.getByText("步骤 4 / 4 · 确认安装")).toBeInTheDocument()
    expect(screen.getByText("demo_plugin · 1.0.0")).toBeInTheDocument()
    expect(screen.getByText("低风险")).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Manifest 摘要" })).toHaveTextContent("内容转换")
    expect(screen.getByRole("region", { name: "组件文件摘要" })).toHaveTextContent("demo.wasm")
  })

  it.each([
    [new File([new Uint8Array([0, 97, 115, 109])], "plugin.txt", { type: "text/plain" }), "请选择 .wasm WebAssembly Component 文件"],
    [new File([new Uint8Array([0, 97, 115, 109])], "plugin.wasm", { type: "text/plain" }), "请选择 .wasm WebAssembly Component 文件"],
    [new File([], "empty.wasm", { type: "application/wasm" }), "组件文件不能为空"],
  ])("preflights component extension, MIME and empty files locally", async (file, message) => {
    const user = userEvent.setup({ applyAccept: false })
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle={false} canInvoke={false} />)
    await screen.findByText("identity_plugin · 1.0.0")
    await user.click(screen.getByRole("button", { name: "安装插件" }))
    await user.type(screen.getByLabelText("插件键"), "demo_plugin")
    await user.type(screen.getByLabelText("名称"), "Demo plugin")
    await user.click(screen.getByRole("button", { name: "下一步：能力审批" }))
    await user.click(screen.getByRole("button", { name: "下一步：组件文件" }))
    await user.upload(screen.getByLabelText("WebAssembly Component 文件"), file)

    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(installPlugin).not.toHaveBeenCalled()
  })

  it("rejects an invalid wasm binary before upload", async () => {
    const user = userEvent.setup()
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle={false} canInvoke={false} />)
    await screen.findByText("identity_plugin · 1.0.0")
    await user.click(screen.getByRole("button", { name: "安装插件" }))
    await user.type(screen.getByLabelText("插件键"), "demo_plugin")
    await user.type(screen.getByLabelText("名称"), "Demo plugin")
    await user.click(screen.getByRole("button", { name: "下一步：能力审批" }))
    await user.click(screen.getByRole("button", { name: "下一步：组件文件" }))
    await user.upload(screen.getByLabelText("WebAssembly Component 文件"), new File([new Uint8Array([1, 2, 3, 4])], "demo.wasm", { type: "application/wasm" }))
    await user.click(screen.getByRole("button", { name: "下一步：确认安装" }))
    await user.click(screen.getByRole("button", { name: "确认安装" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("组件文件不是有效的 WebAssembly 二进制")
    expect(installPlugin).not.toHaveBeenCalled()
  })

  it("shows the server WIT validation error explicitly", async () => {
    const user = userEvent.setup()
    vi.mocked(installPlugin).mockRejectedValueOnce(new PluginApiError(
      400,
      "plugin.component_invalid",
      "WIT 校验失败：组件未导出 daoyun:plugin/run@0.1.0",
    ))
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle={false} canInvoke={false} />)
    await screen.findByText("identity_plugin · 1.0.0")
    await user.click(screen.getByRole("button", { name: "安装插件" }))
    await user.type(screen.getByLabelText("插件键"), "demo_plugin")
    await user.type(screen.getByLabelText("名称"), "Demo plugin")
    await user.click(screen.getByRole("button", { name: "下一步：能力审批" }))
    await user.click(screen.getByRole("button", { name: "下一步：组件文件" }))
    await user.upload(
      screen.getByLabelText("WebAssembly Component 文件"),
      new File([new Uint8Array([0, 97, 115, 109, 1])], "demo.wasm", { type: "application/wasm" }),
    )
    await user.click(screen.getByRole("button", { name: "下一步：确认安装" }))
    await user.click(screen.getByRole("button", { name: "确认安装" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("WIT 校验失败：组件未导出 daoyun:plugin/run@0.1.0")
  })

  it("labels contribution loading failures as runtime status", async () => {
    vi.mocked(listPlugins).mockResolvedValueOnce([{ ...plugin, status: "enabled" }])
    vi.mocked(listPluginUiContributions).mockRejectedValueOnce(new PluginApiError(503, "plugin.runtime_unavailable", "组件实例化失败"))
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke={false} />)

    await openPluginPanel(userEvent.setup())
    expect(await screen.findByText("贡献加载故障")).toBeInTheDocument()
    expect(screen.getByText("组件实例化失败")).toBeInTheDocument()
  })
})
