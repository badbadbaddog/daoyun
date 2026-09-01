import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MemberCenterPage } from "./MemberCenterPage"
import type { MembershipCenterData } from "./membershipTypes"

const data: MembershipCenterData = {
  experience: {
    experience: 760,
    level: { id: "level-7", internalKey: "pathfinder", levelOrder: 7, displayName: "开拓者", requiredExperience: 600, iconAssetUrl: null, color: null, description: "持续参与社区" },
    nextLevel: { id: "level-8", internalKey: "navigator", levelOrder: 8, displayName: "领航者", requiredExperience: 900, iconAssetUrl: null, color: null, description: "引导高质量讨论" },
  },
  pointsBalance: 1280,
  pointsLedger: [{ id: "ledger-1", delta: 30, balanceAfter: 1280, reason: "发布优质主题", createdAt: "2026-08-27T10:00:00Z" }],
  communityGroups: {
    base: [{ id: "group-1", internalKey: "member", displayName: "正式会员", isPublic: true, expiresAt: null }],
    additional: [{ id: "group-2", internalKey: "photography", displayName: "摄影社", isPublic: true, expiresAt: "2026-12-31T00:00:00Z" }],
  },
  entitlements: [{ id: "benefit-1", internalKey: "pro_upload", displayName: "专业附件额度", startsAt: "2026-08-01T00:00:00Z", expiresAt: "2026-09-01T00:00:00Z", quotas: { attachment_bytes: 1073741824 } }],
  medals: [{ key: "medal_01", displayName: "创作者", assetUrl: "/assets/membership/medals/medal1.gif", grantedAt: "2026-08-20T00:00:00Z", isPublic: true }],
}

afterEach(cleanup)

describe("MemberCenterPage", () => {
  it("keeps growth, points, groups, entitlements and medals in separate panels", () => {
    render(<MemberCenterPage activeTab="overview" data={data} status="ready" onTabChange={vi.fn()} onRetry={vi.fn()} />)

    expect(screen.getByRole("heading", { name: "会员中心" })).toBeInTheDocument()
    expect(screen.getByText("开拓者")).toBeInTheDocument()
    expect(screen.getByText("距离领航者还需 140 EXP")).toBeInTheDocument()
    expect(within(screen.getByLabelText("积分概览")).getByText("1,280")).toBeInTheDocument()
    expect(within(screen.getByLabelText("社区用户组")).getByText("正式会员")).toBeInTheDocument()
    expect(within(screen.getByLabelText("标准权益")).getByText("专业附件额度")).toBeInTheDocument()
    expect(within(screen.getByLabelText("公开勋章")).getByText("创作者")).toBeInTheDocument()
  })

  it("renders plugin panel failures without replacing core membership data", () => {
    render(<MemberCenterPage activeTab="overview" data={data} status="ready" pluginError="扩展面板暂时不可用" onTabChange={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText("开拓者")).toBeInTheDocument()
    expect(screen.getByText("扩展面板暂时不可用")).toBeInTheDocument()
  })
})
