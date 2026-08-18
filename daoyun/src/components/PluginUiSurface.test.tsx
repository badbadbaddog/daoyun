import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  executePluginUiSurfaceAction,
  listPluginUiSurfaceContributions,
} from "../api/plugins"
import { PluginUiSurface } from "./PluginUiSurface"

vi.mock("../api/plugins", async () => {
  const actual = await vi.importActual<typeof import("../api/plugins")>("../api/plugins")
  return {
    ...actual,
    executePluginUiSurfaceAction: vi.fn(),
    listPluginUiSurfaceContributions: vi.fn(),
  }
})

const subjectId = "019fc900-0000-7000-8000-000000000802"
const pluginId = "019fc900-0000-7000-8000-000000000801"

beforeEach(() => {
  vi.mocked(listPluginUiSurfaceContributions).mockResolvedValue([{
    pluginId,
    pluginKey: "profile_extension",
    slot: "user_profile",
    schema: {
      schemaVersion: 1,
      title: "资料扩展",
      blocks: [
        { kind: "text", text: "扩展内容" },
        { kind: "action", label: "刷新资料", action_key: "profile.refresh" },
      ],
    },
  }])
  vi.mocked(executePluginUiSurfaceAction).mockResolvedValue({ executedCommands: 1 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("PluginUiSurface", () => {
  it("renders static blocks in a sandbox and executes host-controlled actions", async () => {
    const user = userEvent.setup()
    render(<PluginUiSurface slot="user_profile" subjectId={subjectId} csrfToken="csrf" />)

    const frame = await screen.findByTitle("插件面板：资料扩展")
    expect(frame.getAttribute("srcdoc")).toContain("扩展内容")
    expect(frame.getAttribute("srcdoc")).not.toContain("profile.refresh")
    await user.click(screen.getByRole("button", { name: "刷新资料" }))
    expect(executePluginUiSurfaceAction).toHaveBeenCalledWith(
      pluginId,
      "user_profile",
      subjectId,
      "profile.refresh",
      expect.any(String),
      "csrf",
    )
    expect(await screen.findByText("扩展动作已完成")).toBeInTheDocument()
  })

  it("does not expose mutation controls to anonymous viewers", async () => {
    render(<PluginUiSurface slot="user_profile" subjectId={subjectId} />)

    expect(await screen.findByTitle("插件面板：资料扩展")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "刷新资料" })).not.toBeInTheDocument()
  })
})
