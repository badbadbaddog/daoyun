import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  PluginApiError,
  deletePlugin,
  executePluginUiAction,
  executePluginUiSurfaceAction,
  installPlugin,
  invokePlugin,
  listPluginUiContributions,
  listPluginUiSurfaceContributions,
  listPlugins,
  updatePluginStatus,
} from "./plugins"

const requestId = "019fc900-0000-7000-8000-000000000001"
const pluginId = "019fc900-0000-7000-8000-000000000801"
const actorId = "019fc900-0000-7000-8000-000000000802"
const plugin = {
  id: pluginId,
  key: "identity_plugin",
  name: "Identity plugin",
  version: "1.0.0",
  description: "Fixture",
  manifest_schema_version: 1,
  business_api_version: "0.1.0",
  capabilities: ["ui.panel", "core.query", "points.write"],
  data_scopes: ["site.read", "users.targeted"],
  event_subscriptions: [],
  component_sha256: "a".repeat(64),
  component_size: 1024,
  status: "disabled",
  revision: 1,
  installed_by: actorId,
  created_at: "2026-08-11T01:00:00Z",
  updated_at: "2026-08-11T01:00:00Z",
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("plugin API", () => {
  it("maps private-safe plugin metadata and lifecycle writes", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [plugin], meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: plugin, meta: { request_id: requestId } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { ...plugin, status: "enabled", revision: 2 }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: true, meta: { request_id: requestId } }))

    await expect(listPlugins()).resolves.toEqual([
      expect.objectContaining({ id: pluginId, componentSha256: "a".repeat(64), componentSize: 1024 }),
    ])
    await expect(installPlugin({
      manifest: {
        schemaVersion: 1,
        key: "identity_plugin",
        name: "Identity plugin",
        version: "1.0.0",
        description: "Fixture",
        capabilities: ["ui.panel", "core.query", "points.write"],
        businessApiVersion: "0.1.0",
        dataScopes: ["site.read", "users.targeted"],
        eventSubscriptions: [],
      },
      componentBase64: "AGFzbQ==",
    }, "csrf")).resolves.toMatchObject({ key: "identity_plugin" })
    await expect(updatePluginStatus(pluginId, "enabled", 1, "csrf")).resolves.toMatchObject({ status: "enabled", revision: 2 })
    await expect(deletePlugin(pluginId, "csrf")).resolves.toBe(true)

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/admin/plugins", expect.objectContaining({ credentials: "include" }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/admin/plugins", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({
        manifest: {
          schema_version: 1,
          key: "identity_plugin",
          name: "Identity plugin",
          version: "1.0.0",
          description: "Fixture",
          capabilities: ["ui.panel", "core.query", "points.write"],
          business_api_version: "0.1.0",
          data_scopes: ["site.read", "users.targeted"],
          event_subscriptions: [],
        },
        component_base64: "AGFzbQ==",
      }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/v1/admin/plugins/${pluginId}`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "enabled", expected_revision: 1 }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, `/api/v1/admin/plugins/${pluginId}`, expect.objectContaining({ method: "DELETE" }))
  })

  it("validates transform and static UI schema invocation responses", async () => {
    const schema = {
      schema_version: 1,
      title: "Plugin panel",
      blocks: [
        { kind: "text", text: "Safe text" },
        { kind: "status", tone: "success", text: "Enabled" },
      ],
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { operation: "content_transform", payload: "HELLO" }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: { operation: "ui_render", payload: JSON.stringify(schema), ui_schema: schema }, meta: { request_id: requestId } }))

    await expect(invokePlugin(pluginId, "content_transform", "hello", "csrf")).resolves.toEqual({ operation: "content_transform", payload: "HELLO", uiSchema: null })
    await expect(invokePlugin(pluginId, "ui_render", JSON.stringify(schema), "csrf")).resolves.toMatchObject({ uiSchema: { title: "Plugin panel" } })
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/v1/admin/plugins/${pluginId}/invoke`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ operation: "content_transform", payload: "hello" }),
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
    }))
  })

  it("loads only bounded UI contribution schemas", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{
        slot: "admin_plugin",
        schema: {
          schema_version: 1,
          title: "Business status",
          blocks: [
            { kind: "status", tone: "success", text: "Ready" },
            { kind: "action", label: "发送测试通知", action_key: "notification.send_test" },
          ],
        },
      }],
      meta: { request_id: requestId },
    }))

    await expect(listPluginUiContributions(pluginId)).resolves.toEqual([{
      slot: "admin_plugin",
      schema: {
        schemaVersion: 1,
        title: "Business status",
        blocks: [
          { kind: "status", tone: "success", text: "Ready" },
          { kind: "action", label: "发送测试通知", action_key: "notification.send_test" },
        ],
      },
    }])
  })

  it("executes a fixed admin plugin action with CSRF and idempotency", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: { executed_commands: 1 },
      meta: { request_id: requestId },
    }))

    await expect(executePluginUiAction(
      pluginId,
      "notification.send_test",
      "019fc900-0000-7000-8000-000000000803",
      "csrf",
    )).resolves.toEqual({ executedCommands: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/plugins/${pluginId}/ui-actions`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
        body: JSON.stringify({
          slot: "admin_plugin",
          action_key: "notification.send_test",
          idempotency_key: "019fc900-0000-7000-8000-000000000803",
          subject_id: null,
        }),
      }),
    )
  })

  it("loads and executes subject-bound business surface contributions", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          plugin_id: pluginId,
          plugin_key: "identity_plugin",
          slot: "user_profile",
          schema: {
            schema_version: 1,
            title: "Profile extension",
            blocks: [{ kind: "action", label: "Refresh", action_key: "profile.refresh" }],
          },
        }],
        meta: { request_id: requestId },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { executed_commands: 1 },
        meta: { request_id: requestId },
      }))

    await expect(listPluginUiSurfaceContributions("user_profile", actorId)).resolves.toEqual([
      expect.objectContaining({ pluginId, pluginKey: "identity_plugin", slot: "user_profile" }),
    ])
    await expect(executePluginUiSurfaceAction(
      pluginId,
      "user_profile",
      actorId,
      "profile.refresh",
      "surface-action",
      "csrf",
    )).resolves.toEqual({ executedCommands: 1 })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/plugin-ui/user_profile/${actorId}/${pluginId}/actions`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          slot: "user_profile",
          action_key: "profile.refresh",
          idempotency_key: "surface-action",
          subject_id: actorId,
        }),
      }),
    )
  })

  it("rejects malformed metadata and arbitrary UI blocks", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ ...plugin, component_bytes: "secret" }], meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ ...plugin, capabilities: ["content.transform", "core.query"] }],
        meta: { request_id: requestId },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          operation: "ui_render",
          payload: "{}",
          ui_schema: { schema_version: 1, title: "Unsafe", blocks: [{ kind: "html", html: "<script>alert(1)</script>" }] },
        },
        meta: { request_id: requestId },
      }))

    await expect(listPlugins()).rejects.toMatchObject({ code: "response.invalid" })
    await expect(listPlugins()).rejects.toMatchObject({ code: "response.invalid" })
    await expect(invokePlugin(pluginId, "ui_render", "{}", "csrf")).rejects.toMatchObject({ code: "response.invalid" })
  })

  it("preserves stable backend errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: { code: "plugin.disabled", message: "插件当前未启用" },
      meta: { request_id: requestId },
    }, 409))

    await expect(invokePlugin(pluginId, "content_transform", "hello", "csrf")).rejects.toEqual(
      expect.objectContaining<Partial<PluginApiError>>({ status: 409, code: "plugin.disabled", requestId }),
    )
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
}
