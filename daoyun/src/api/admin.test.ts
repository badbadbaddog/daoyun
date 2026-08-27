import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AdminApiError,
  createAuthorizationAssignment,
  createAuthorizationRole,
  createAdminBoard,
  createAdminGrowthLevel,
  deleteBrandAsset,
  deleteAdminGrowthLevel,
  deleteAuthorizationAssignment,
  deleteAuthorizationRole,
  getAdminAccess,
  getAdminBoardDeletionImpact,
  getAdminGrowthLevels,
  getMembershipLevelRules,
  getGovernancePolicy,
  getAdminSiteBranding,
  getSmtpSettings,
  grantMembershipPoints,
  listMembershipMedalOperations,
  listAuthorizationAssignments,
  listAuthorizationPermissions,
  listAuthorizationRoles,
  listRiskAlerts,
  listAdminBoards,
  listAdminAudit,
  updateMembershipLevelRule,
  updateAdminBoard,
  updateAdminGrowthLevel,
  updateGovernancePolicy,
  updateAuthorizationRole,
  updateRiskAlert,
  updateSiteBranding,
  updateSmtpSettings,
  testSmtpSettings,
  uploadBrandAsset,
  revokeMembershipMedal,
} from "./admin"

const requestId = "019fc900-0000-7000-8000-000000000001"
const boardId = "019fc900-0000-7000-8000-000000000101"
const memberId = "019fc900-0000-7000-8000-000000000401"
const roleId = "019fc900-0000-7000-8000-000000000501"
const assignmentId = "019fc900-0000-7000-8000-000000000601"

afterEach(() => vi.restoreAllMocks())

describe("admin API", () => {
  it("maps the current global capability catalog and rejects malformed keys", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { capability_keys: ["operations.read", "authorization.roles.read"] }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: { capability_keys: ["operations.read", "operations.read"] }, meta: { request_id: requestId } }))

    await expect(getAdminAccess()).resolves.toEqual({ capabilityKeys: ["operations.read", "authorization.roles.read"] })
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/admin/access", expect.objectContaining({ credentials: "include" }))
    await expect(getAdminAccess()).rejects.toMatchObject({ code: "response.invalid" })
  })

  it("maps branding and board responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: brandingDto(), meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: [boardDto()], meta: { request_id: requestId } }))

    await expect(getAdminSiteBranding()).resolves.toMatchObject({ siteName: "刀云" })
    await expect(listAdminBoards()).resolves.toEqual([expect.objectContaining({
      id: boardId,
      parentId: null,
      topicCount: 3,
      visibility: "public",
      revision: 1,
    })])
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
      defaultCoverUrl: null,
      navigationLinks: [{ label: "文档", url: "/docs" }],
      footerText: "自托管社区",
      footerLinks: [{ label: "隐私", url: "#privacy" }],
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
      parentId: null,
    }, "csrf")
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/admin/site-branding", expect.objectContaining({ method: "PATCH", headers: expect.objectContaining({ "x-csrf-token": "csrf" }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/admin/boards", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "x-csrf-token": "csrf" }) }))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ parent_id: null })
  })

  it("sends board hierarchy and revision fields when moving a board", async () => {
    const parentId = "019fc900-0000-7000-8000-000000000102"
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { ...boardDto(), parent_id: parentId, revision: 2 }, meta: { request_id: requestId } }))

    await updateAdminBoard(boardId, {
      parentId,
      slug: "general",
      name: "社区广场",
      description: "公开讨论",
      icon: "messages",
      tone: "green",
      position: 0,
      visibility: "public",
      expectedRevision: 1,
    }, "csrf")

    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/admin/boards/${boardId}`, expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({
        parent_id: parentId,
        slug: "general",
        name: "社区广场",
        description: "公开讨论",
        icon: "messages",
        tone: "green",
        position: 0,
        visibility: "public",
        expected_revision: 1,
      }),
    }))
  })

  it("maps board deletion impact before a destructive action", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      data: { board_id: boardId, child_count: 1, topic_count: 3, reply_count: 8, can_delete: false },
      meta: { request_id: requestId },
    }))

    await expect(getAdminBoardDeletionImpact(boardId)).resolves.toEqual({
      boardId,
      childCount: 1,
      topicCount: 3,
      replyCount: 8,
      canDelete: false,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/boards/${boardId}/deletion-impact`,
      expect.objectContaining({ credentials: "include" }),
    )
  })

  it("uploads and deletes a same-origin brand asset with CSRF protection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { ...brandingDto(), logo_url: "/api/v1/site-branding/assets/logo" }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: brandingDto(), meta: { request_id: requestId } }))
    const file = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" })

    await expect(uploadBrandAsset("logo", file, "csrf")).resolves.toMatchObject({
      logoUrl: "/api/v1/site-branding/assets/logo",
    })
    await expect(deleteBrandAsset("logo", "csrf")).resolves.toMatchObject({ logoUrl: null })
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/admin/site-branding/assets/logo", expect.objectContaining({
      method: "PUT",
      body: file,
      credentials: "include",
      headers: expect.objectContaining({ "Content-Type": "image/png", "x-csrf-token": "csrf" }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/admin/site-branding/assets/logo", expect.objectContaining({
      method: "DELETE",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
    }))
  })

  it("exposes structured forbidden errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ error: { code: "admin.forbidden", message: "需要超级管理员权限" }, meta: { request_id: requestId } }, 403))
    await expect(getAdminSiteBranding()).rejects.toMatchObject({ status: 403, code: "admin.forbidden" })
  })

  it("rejects malformed error field payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ error: { code: "validation.failed", message: "invalid", fields: { site_name: "not-an-array" } }, meta: { request_id: requestId } }, 422))
    await expect(getAdminSiteBranding()).rejects.toMatchObject({ status: 422, code: "response.invalid" })
  })

  it("maps governance policy and risk alert pages", async () => {
    const alertId = "019fc900-0000-7000-8000-000000000301"
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { enabled: true, alert_score_threshold: 70, reporter_window_minutes: 60, reporter_alert_limit: 5 }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: [riskAlertDto(alertId)], meta: { request_id: requestId, next_cursor: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: { enabled: false, alert_score_threshold: 80, reporter_window_minutes: 30, reporter_alert_limit: 3 }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...riskAlertDto(alertId), status: "acknowledged", acknowledged_at: "2026-08-05T10:01:00Z", acknowledged_by: userDto() }, meta: { request_id: requestId } }))

    await expect(getGovernancePolicy()).resolves.toMatchObject({ alertScoreThreshold: 70 })
    await expect(listRiskAlerts({ status: "open" })).resolves.toMatchObject({ alerts: [expect.objectContaining({ id: alertId, score: 85 })], nextCursor: null })
    await expect(updateGovernancePolicy({ enabled: false, alertScoreThreshold: 80, reporterWindowMinutes: 30, reporterAlertLimit: 3 }, "csrf")).resolves.toMatchObject({ enabled: false })
    await expect(updateRiskAlert(alertId, "acknowledged", "csrf")).resolves.toMatchObject({ status: "acknowledged" })
  })

  it("queries related audit records with resource, user, report, and cursor filters", async () => {
    const auditId = "019fc900-0000-7000-8000-000000000701"
    const reportId = "019fc900-0000-7000-8000-000000000702"
    const cursor = "019fc900-0000-7000-8000-000000000703"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      data: [{
        id: auditId,
        actor: userDto(),
        action: "report.moderate",
        resource_type: "content_report",
        resource_id: reportId,
        summary: { note: "internal-only" },
        created_at: "2026-08-13T08:00:00Z",
      }],
      meta: { request_id: requestId, next_cursor: cursor },
    }))

    await expect(listAdminAudit({
      resourceId: reportId,
      userId: memberId,
      reportId,
      cursor,
      limit: 10,
    })).resolves.toEqual({
      entries: [expect.objectContaining({ id: auditId, resourceId: reportId })],
      nextCursor: cursor,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/audit?resource_id=${reportId}&user_id=${memberId}&report_id=${reportId}&cursor=${cursor}&limit=10`,
      expect.objectContaining({ credentials: "include" }),
    )
  })

  it("maps membership rules and sends the configured threshold on update", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [membershipRuleDto("lv_1", 0, true), membershipRuleDto("lv_2", 25, true)], meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: membershipRuleDto("lv_2", 30, true, "新会员"), meta: { request_id: requestId } }))

    await expect(getMembershipLevelRules()).resolves.toEqual([
      { levelKey: "lv_1", levelNumber: 1, levelDisplayName: "Lv1", requiredLifetimePoints: 0, enabled: true, updatedAt: "2026-08-07T01:00:00Z" },
      { levelKey: "lv_2", levelNumber: 2, levelDisplayName: "Lv2", requiredLifetimePoints: 25, enabled: true, updatedAt: "2026-08-07T01:00:00Z" },
    ])
    await expect(updateMembershipLevelRule("lv_2", { requiredLifetimePoints: 30, enabled: true, displayName: "新会员" }, "csrf"))
      .resolves.toMatchObject({ levelKey: "lv_2", requiredLifetimePoints: 30, levelDisplayName: "新会员" })
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/admin/membership/level-rules/lv_2", expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({ required_lifetime_points: 30, enabled: true, display_name: "新会员" }),
    }))
  })

  it("maps dynamic EXP levels and sends their versioned write contracts", async () => {
    const growthLevelId = "019fc900-0000-7000-8000-000000000801"
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [growthLevelDto(growthLevelId)], meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: growthLevelDto(growthLevelId), meta: { request_id: requestId } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { ...growthLevelDto(growthLevelId), display_name: "行者", revision: 2, status: "published" }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: true, meta: { request_id: requestId } }))

    await expect(getAdminGrowthLevels()).resolves.toEqual([
      expect.objectContaining({ id: growthLevelId, internalKey: "traveler", levelOrder: 2, requiredExperience: 100, status: "draft" }),
    ])
    await createAdminGrowthLevel({
      internalKey: "traveler",
      levelOrder: 2,
      displayName: "旅者",
      requiredExperience: 100,
      iconAssetId: null,
      color: "#1f8f5f",
      description: "完成首次成长阶段",
    }, "csrf")
    await updateAdminGrowthLevel(growthLevelId, {
      expectedRevision: 1,
      levelOrder: 2,
      displayName: "行者",
      requiredExperience: 100,
      iconAssetId: null,
      color: "#1f8f5f",
      description: "完成首次成长阶段",
      status: "published",
    }, "csrf")
    await expect(deleteAdminGrowthLevel(growthLevelId, "csrf")).resolves.toBe(true)

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/admin/membership/levels", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({ internal_key: "traveler", level_order: 2, display_name: "旅者", required_experience: 100, icon_asset_id: null, color: "#1f8f5f", description: "完成首次成长阶段" }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/v1/admin/membership/levels/${growthLevelId}`, expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({ expected_revision: 1, level_order: 2, display_name: "行者", required_experience: 100, icon_asset_id: null, color: "#1f8f5f", description: "完成首次成长阶段", status: "published" }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, `/api/v1/admin/membership/levels/${growthLevelId}`, expect.objectContaining({
      method: "DELETE",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
    }))
  })

  it("maps, updates, and tests SMTP settings without reading a password", async () => {
    const smtp = {
      host: "smtp.example.com",
      port: 587,
      username: "mailer",
      password_configured: true,
      tls_mode: "starttls",
      from_email: "noreply@example.com",
      from_name: "DaoYun",
      enabled: true,
      registration_email_verification_enabled: true,
    }
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: smtp, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: smtp, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: true, meta: { request_id: requestId } }))

    await expect(getSmtpSettings()).resolves.toMatchObject({
      host: "smtp.example.com",
      passwordConfigured: true,
      tlsMode: "starttls",
    })
    await updateSmtpSettings({
      host: "smtp.example.com",
      port: 587,
      username: "mailer",
      password: "super-secret",
      clearPassword: false,
      tlsMode: "starttls",
      fromEmail: "noreply@example.com",
      fromName: "DaoYun",
      enabled: true,
      registrationEmailVerificationEnabled: true,
    }, "csrf")
    await expect(testSmtpSettings("owner@example.com", "csrf")).resolves.toBe(true)

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      host: "smtp.example.com",
      port: 587,
      username: "mailer",
      password: "super-secret",
      clear_password: false,
      tls_mode: "starttls",
      from_email: "noreply@example.com",
      from_name: "DaoYun",
      enabled: true,
      registration_email_verification_enabled: true,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/admin/smtp-settings/test", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({ recipient_email: "owner@example.com" }),
    }))
  })

  it("accepts valid dynamic-level text measured by Unicode characters", async () => {
    const growthLevelId = "019fc900-0000-7000-8000-000000000803"
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      data: [{ ...growthLevelDto(growthLevelId), display_name: "😀".repeat(80), description: "😀".repeat(500) }],
      meta: { request_id: requestId },
    }))

    await expect(getAdminGrowthLevels()).resolves.toEqual([
      expect.objectContaining({ id: growthLevelId, displayName: "😀".repeat(80), description: "😀".repeat(500) }),
    ])
  })

  it("sends a points grant with idempotency and maps the resulting account", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      data: {
        created: true,
        account: {
          user_id: memberId,
          points_balance: 25,
          lifetime_points: 25,
          level_key: "lv_2",
          level_number: 2,
          level_display_name: "Lv2",
          revision: 2,
          updated_at: "2026-08-07T01:00:00Z",
        },
      },
      meta: { request_id: requestId },
    }))

    await expect(grantMembershipPoints({ userId: memberId, amount: 25, reason: "运营奖励", idempotencyKey: "grant-1" }, "csrf"))
      .resolves.toEqual({
        created: true,
        account: { userId: memberId, pointsBalance: 25, lifetimePoints: 25, levelKey: "lv_2", levelNumber: 2, levelDisplayName: "Lv2", revision: 2, updatedAt: "2026-08-07T01:00:00Z" },
      })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/membership/points", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({ user_id: memberId, amount: 25, reason: "运营奖励", idempotency_key: "grant-1" }),
    }))
  })

  it("maps medal operation pages and sends an auditable revocation", async () => {
    const operationId = "019fc900-0000-7000-8000-000000000901"
    const cursor = "019fc900-0000-7000-8000-000000000902"
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: operationId,
          operation: "grant",
          user_id: memberId,
          username: "demo_member",
          user_display_name: "演示成员",
          medal_key: "medal_01",
          medal_display_name: "勋章 01",
          reason: "operator.award",
          actor_id: userDto().id,
          actor_username: "admin",
          actor_display_name: "管理员",
          created_at: "2026-08-22T01:00:00Z",
        }],
        meta: { request_id: requestId, next_cursor: cursor },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { user_id: memberId, medal_key: "medal_01", revoked: true },
        meta: { request_id: requestId },
      }))

    await expect(listMembershipMedalOperations({ userId: memberId, medalKey: "medal_01", limit: 25 })).resolves.toEqual({
      operations: [expect.objectContaining({ id: operationId, operation: "grant", userId: memberId, medalDisplayName: "勋章 01" })],
      nextCursor: cursor,
    })
    await expect(revokeMembershipMedal({ userId: memberId, medalKey: "medal_01", reason: "运营调整" }, "csrf")).resolves.toEqual({
      userId: memberId,
      medalKey: "medal_01",
      revoked: true,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/v1/admin/membership/medal-operations?user_id=${memberId}&medal_key=medal_01&limit=25`,
      expect.objectContaining({ credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/admin/membership/medal-revocations", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({ user_id: memberId, medal_key: "medal_01", reason: "运营调整" }),
    }))
  })

  it("maps the authorization permission, role, and assignment catalogs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [authorizationPermissionDto()], meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: [authorizationRoleDto()], meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: [authorizationAssignmentDto()], meta: { request_id: requestId, next_cursor: "next-page" } }))

    await expect(listAuthorizationPermissions()).resolves.toEqual([
      { key: "content.moderate", name: "内容管理", description: "管理主题与回复" },
    ])
    await expect(listAuthorizationRoles()).resolves.toEqual([
      expect.objectContaining({ id: roleId, key: "board_moderator", permissionKeys: ["content.moderate"], assignmentCount: 1, revision: 2 }),
    ])
    await expect(listAuthorizationAssignments({ username: "demo_member", roleId, scopeId: boardId, limit: 25 })).resolves.toEqual({
      assignments: [expect.objectContaining({ id: assignmentId, scopeId: boardId, user: expect.objectContaining({ username: "demo_member" }), role: expect.objectContaining({ id: roleId, isSystem: false }) })],
      nextCursor: "next-page",
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/v1/admin/authorization/assignments?username=demo_member&role_id=${roleId}&scope_id=${boardId}&limit=25`,
      expect.objectContaining({ credentials: "include" }),
    )
  })

  it("sends authorization role and assignment mutations with CSRF protection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: authorizationRoleDto(), meta: { request_id: requestId } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { ...authorizationRoleDto(), name: "新版主", revision: 3 }, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: true, meta: { request_id: requestId } }))
      .mockResolvedValueOnce(jsonResponse({ data: authorizationAssignmentDto(), meta: { request_id: requestId } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: true, meta: { request_id: requestId } }))

    await createAuthorizationRole({ key: "board_moderator", name: "版主", scope: "board", permissionKeys: ["content.moderate"] }, "csrf")
    await updateAuthorizationRole(roleId, { name: "新版主", permissionKeys: ["content.moderate"], expectedRevision: 2 }, "csrf")
    await deleteAuthorizationRole(roleId, "csrf")
    await createAuthorizationAssignment({ username: "demo_member", roleId, scopeId: boardId }, "csrf")
    await deleteAuthorizationAssignment(assignmentId, "csrf")

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/admin/authorization/roles", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-csrf-token": "csrf" }),
      body: JSON.stringify({ key: "board_moderator", name: "版主", scope: "board", permission_keys: ["content.moderate"] }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/admin/authorization/roles/${roleId}`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "新版主", permission_keys: ["content.moderate"], expected_revision: 2 }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/v1/admin/authorization/assignments", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ username: "demo_member", role_id: roleId, scope_id: boardId }),
    }))
  })

  it("rejects malformed authorization payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      data: [{ ...authorizationRoleDto(), revision: 0 }],
      meta: { request_id: requestId },
    }))

    await expect(listAuthorizationRoles()).rejects.toMatchObject({ code: "response.invalid" })
  })
})

function brandingDto() {
  return {
    site_name: "刀云",
    logo_url: null,
    favicon_url: null,
    default_cover_url: null,
    navigation_links: [{ label: "文档", url: "/docs" }],
    footer_text: "自托管社区",
    footer_links: [{ label: "隐私", url: "#privacy" }],
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
    parent_id: null,
    slug: "general",
    name: "社区广场",
    description: "公开讨论",
    icon: "messages",
    tone: "green",
    position: 0,
    visibility: "public",
    topic_count: 3,
    revision: 1,
  }
}

function userDto() {
  return { id: "019fc900-0000-7000-8000-000000000004", username: "admin", display_name: "管理员", avatar_url: null }
}

function riskAlertDto(id: string) {
  return { id, kind: "high_risk_report", severity: "high", score: 85, target_type: "topic", target_id: "019fc900-0000-7000-8000-000000000202", reporter_id: userDto().id, report_id: "019fc900-0000-7000-8000-000000000201", status: "open", details: { reason: "illegal" }, acknowledged_by: null, created_at: "2026-08-05T10:00:00Z", acknowledged_at: null }
}

function membershipRuleDto(levelKey: string, requiredLifetimePoints: number, enabled: boolean, displayName = `Lv${levelKey.slice(3)}`) {
  return { level_key: levelKey, level_number: Number(levelKey.slice(3)), level_display_name: displayName, required_lifetime_points: requiredLifetimePoints, enabled, updated_at: "2026-08-07T01:00:00Z" }
}

function growthLevelDto(id: string) {
  return {
    id,
    internal_key: "traveler",
    level_order: 2,
    display_name: "旅者",
    required_experience: 100,
    icon_asset_id: null,
    color: "#1f8f5f",
    description: "完成首次成长阶段",
    status: "draft",
    revision: 1,
    published_at: null,
    created_at: "2026-08-20T01:00:00Z",
    updated_at: "2026-08-20T01:00:00Z",
  }
}

function authorizationPermissionDto() {
  return { key: "content.moderate", name: "内容管理", description: "管理主题与回复" }
}

function authorizationRoleDto() {
  return {
    id: roleId,
    key: "board_moderator",
    name: "版主",
    scope: "board",
    is_system: false,
    permission_keys: ["content.moderate"],
    assignment_count: 1,
    revision: 2,
    created_at: "2026-08-10T01:00:00Z",
    updated_at: "2026-08-10T01:00:00Z",
  }
}

function authorizationAssignmentDto() {
  return {
    id: assignmentId,
    user: { id: memberId, username: "demo_member", display_name: "演示成员", avatar_url: null },
    role: { id: roleId, key: "board_moderator", name: "版主", scope: "board", is_system: false, revision: 2 },
    scope_id: boardId,
    assigned_by: userDto(),
    created_at: "2026-08-10T02:00:00Z",
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
