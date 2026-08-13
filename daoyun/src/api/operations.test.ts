import { afterEach, describe, expect, it, vi } from "vitest"

import {
  acknowledgeOperationsAlert,
  AdminApiError,
  getOperationsSummary,
  listOperationsAlertRules,
  listOperationsAlerts,
  updateOperationsAlertRule,
} from "./admin"

const requestId = "019fc900-0000-7000-8000-000000000001"
const ruleId = "019fc900-0000-7000-8000-000000000701"
const alertId = "019fc900-0000-7000-8000-000000000702"

afterEach(() => vi.restoreAllMocks())

describe("operations API", () => {
  it("maps summary, rules and alert pages and sends protected mutations", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: summaryDto(), meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: [ruleDto()], meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: [alertDto()], meta: { request_id: requestId, next_cursor: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...ruleDto(), revision: 2 }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...alertDto(), status: "acknowledged", acknowledged_by: userDto(), acknowledged_at: "2026-08-11T10:05:00Z" }, meta: { request_id: requestId } }))

    await expect(getOperationsSummary()).resolves.toMatchObject({
      http: { errors5m: 2, p95Ms5m: 42 },
      database: { ready: true, connections: 3 },
      outbox: { dead: 1 },
      alerts: { open: 1 },
    })
    await expect(listOperationsAlertRules()).resolves.toEqual([
      expect.objectContaining({ id: ruleId, kind: "http_5xx_count", windowSeconds: 300 }),
    ])
    await expect(listOperationsAlerts({ status: "open", limit: 10 })).resolves.toMatchObject({
      alerts: [expect.objectContaining({ id: alertId, rule: expect.objectContaining({ key: "api_5xx" }) })],
      nextCursor: null,
    })
    await expect(updateOperationsAlertRule(ruleId, {
      name: "API 5xx 错误",
      threshold: 10,
      windowSeconds: 300,
      enabled: true,
      expectedRevision: 1,
    }, "csrf")).resolves.toMatchObject({ revision: 2 })
    await expect(acknowledgeOperationsAlert(alertId, "csrf")).resolves.toMatchObject({
      status: "acknowledged",
      acknowledgedBy: expect.objectContaining({ username: "owner" }),
    })

    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/admin/operations/alerts?status=open&limit=10", expect.objectContaining({ credentials: "include" }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, `/api/v1/admin/operations/alert-rules/${ruleId}`, expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({ name: "API 5xx 错误", threshold: 10, window_seconds: 300, enabled: true, expected_revision: 1 }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, `/api/v1/admin/operations/alerts/${alertId}`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "acknowledged" }),
    }))
  })

  it("rejects malformed monitoring payloads instead of rendering false health", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { ...summaryDto(), database: { ready: true, connections: -1, idle_connections: 1 } }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ ...ruleDto(), kind: "raw_sql" }], meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ ...alertDto(), status: "acknowledged", acknowledged_by: null, acknowledged_at: null }], meta: { request_id: requestId, next_cursor: null } }))

    await expect(getOperationsSummary()).rejects.toMatchObject({ code: "response.invalid" })
    await expect(listOperationsAlertRules()).rejects.toMatchObject({ code: "response.invalid" })
    await expect(listOperationsAlerts()).rejects.toMatchObject({ code: "response.invalid" })
  })

  it("preserves optimistic conflict details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      error: { code: "operations.rule_conflict", message: "运营告警规则版本已变化" },
      meta: { request_id: requestId },
    }, 409))
    await expect(updateOperationsAlertRule(ruleId, {
      name: "API 5xx 错误",
      threshold: 10,
      windowSeconds: 300,
      enabled: true,
      expectedRevision: 1,
    }, "csrf")).rejects.toEqual(expect.objectContaining<Partial<AdminApiError>>({
      status: 409,
      code: "operations.rule_conflict",
    }))
  })
})

function summaryDto() {
  return {
    observed_at: "2026-08-11T10:00:00Z",
    uptime_seconds: 120,
    http: { total_requests: 25, in_flight_requests: 1, errors_5m: 2, p95_ms_5m: 42 },
    database: { ready: true, connections: 3, idle_connections: 2 },
    outbox: { pending: 4, processing: 1, dead: 1 },
    risk_alerts_open: 2,
    alerts: { open: 1, acknowledged: 3 },
  }
}

function ruleDto() {
  return {
    id: ruleId,
    key: "api_5xx",
    name: "API 5xx 错误",
    kind: "http_5xx_count",
    threshold: 10,
    window_seconds: 300,
    enabled: true,
    revision: 1,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  }
}

function alertDto() {
  return {
    id: alertId,
    rule: { id: ruleId, key: "api_5xx", name: "API 5xx 错误", kind: "http_5xx_count" },
    status: "open",
    observed_value: 12,
    threshold: 10,
    first_triggered_at: "2026-08-11T10:00:00Z",
    last_triggered_at: "2026-08-11T10:01:00Z",
    acknowledged_by: null,
    acknowledged_at: null,
    resolved_at: null,
  }
}

function userDto() {
  return { id: "019fc900-0000-7000-8000-000000000703", username: "owner", display_name: "Owner", avatar_url: null }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
