import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  PluginApiError,
  deletePlugin,
  installPlugin,
  invokePlugin,
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
    installPlugin: vi.fn(),
    invokePlugin: vi.fn(),
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
  capabilities: ["content.transform", "ui.panel"],
  componentSha256: "a".repeat(64),
  componentSize: 1024,
  status: "disabled",
  revision: 1,
  installedBy: "019fc900-0000-7000-8000-000000000802",
  createdAt: "2026-08-11T01:00:00Z",
  updatedAt: "2026-08-11T01:00:00Z",
}

beforeEach(() => {
  vi.mocked(listPlugins).mockResolvedValue([plugin])
  vi.mocked(updatePluginStatus).mockResolvedValue({ ...plugin, status: "enabled", revision: 2 })
  vi.mocked(deletePlugin).mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("PluginAdminPanel", () => {
  it("loads metadata and applies lifecycle changes with revision and CSRF", async () => {
    const user = userEvent.setup()
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle canInvoke />)

    expect(await screen.findByRole("heading", { name: "插件平台" })).toBeInTheDocument()
    expect(screen.getByText("identity_plugin · 1.0.0")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "启用插件：Identity plugin" }))

    expect(updatePluginStatus).toHaveBeenCalledWith(plugin.id, "enabled", 1, "csrf")
    expect(await screen.findByText("插件已启用")).toBeInTheDocument()
  })

  it("hides install, lifecycle and invoke controls without their capabilities", async () => {
    render(<PluginAdminPanel csrfToken="csrf" canInstall={false} canLifecycle={false} canInvoke={false} />)

    await screen.findByText("identity_plugin · 1.0.0")
    expect(screen.queryByRole("heading", { name: "安装插件" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "启用插件：Identity plugin" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("调用输入：Identity plugin")).not.toBeInTheDocument()
  })

  it("rejects an oversized component before reading or uploading it", async () => {
    const user = userEvent.setup()
    render(<PluginAdminPanel csrfToken="csrf" canInstall canLifecycle canInvoke />)
    await screen.findByText("identity_plugin · 1.0.0")
    const file = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "too-large.wasm", { type: "application/wasm" })

    await user.upload(screen.getByLabelText("WebAssembly Component 文件"), file)
    await user.click(screen.getByRole("button", { name: "安装插件" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("组件文件不能超过 8 MiB")
    expect(installPlugin).not.toHaveBeenCalled()
  })

  it("renders validated schema in an empty sandbox with escaped static srcdoc", async () => {
    const user = userEvent.setup()
    const enabled = { ...plugin, status: "enabled" as const, revision: 2 }
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

    await user.click(await screen.findByRole("button", { name: "启用插件：Identity plugin" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("插件状态已变化，列表已刷新")
    await waitFor(() => expect(listPlugins).toHaveBeenCalledTimes(2))
  })
})
