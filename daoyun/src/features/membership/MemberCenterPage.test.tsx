import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
  it("shows growth and visible medals with entries for lazy private details", () => {
    render(<MemberCenterPage activeTab="overview" data={data} status="ready" onTabChange={vi.fn()} onRetry={vi.fn()} />)

    expect(screen.getByRole("heading", { name: "会员中心" })).toBeInTheDocument()
    expect(screen.getByText("开拓者")).toBeInTheDocument()
    expect(screen.getByText("距离领航者还需 140 EXP")).toBeInTheDocument()
    expect(screen.queryByLabelText("社区用户组")).not.toBeInTheDocument()
    expect(screen.getByText("创作者")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "查看权益详情" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "查看勋章详情" })).toBeInTheDocument()
    const summary = screen.getByRole("region", { name: "我的成长概览" })
    expect(within(summary).getByRole("heading", { name: "开拓者" })).toBeInTheDocument()
    expect(summary).toHaveTextContent("760 EXP")
    expect(summary).not.toHaveTextContent("1,280")
    expect(summary).toHaveTextContent("标准权益")
    expect(summary).toHaveTextContent("公开勋章")
    expect(summary).not.toHaveTextContent("pathfinder")
    expect(summary).not.toHaveTextContent("pro_upload")
  })

  it("navigates from the overview assets into the corresponding member section", async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(<MemberCenterPage activeTab="overview" data={data} status="ready" onTabChange={onTabChange} onRetry={vi.fn()} />)

    const summary = screen.getByRole("region", { name: "我的成长概览" })
    await user.click(within(summary).getByRole("button", { name: "查看积分详情" }))
    await user.click(within(summary).getByRole("button", { name: "查看权益详情" }))
    await user.click(within(summary).getByRole("button", { name: "查看勋章详情" }))

    expect(onTabChange.mock.calls).toEqual([["points"], ["benefits"], ["medals"]])
  })

  it("renders plugin panel failures without replacing core membership data", () => {
    render(<MemberCenterPage activeTab="overview" data={data} status="ready" pluginError="扩展面板暂时不可用" onTabChange={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText("开拓者")).toBeInTheDocument()
    expect(screen.getByText("扩展面板暂时不可用")).toBeInTheDocument()
  })
})

it("keeps private details and ledger out of the overview summary", () => {
  render(<MemberCenterPage activeTab="overview" data={data} status="ready" onTabChange={vi.fn()} onRetry={vi.fn()} />)
  expect(screen.getByText("开拓者")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "查看积分详情" })).toBeInTheDocument()
  expect(screen.queryByLabelText("积分概览")).not.toBeInTheDocument()
  expect(screen.queryByLabelText("标准权益")).not.toBeInTheDocument()
  expect(screen.getByLabelText("公开勋章")).toHaveTextContent("创作者")
})

it("keeps partial overview growth visible and makes failed medals retryable", async () => {
  const retry = vi.fn()
  render(<MemberCenterPage activeTab="overview" data={{ experience: data.experience, errors: ["公开勋章暂时不可用"] }} status="ready" onTabChange={vi.fn()} onRetry={retry} />)
  expect(screen.getByText("开拓者")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "查看积分详情" })).toHaveTextContent("积分记录")
  expect(screen.getByRole("button", { name: "查看积分详情" })).not.toHaveTextContent("0 积分")
  await userEvent.setup().click(screen.getByRole("button", { name: "重试概览摘要" }))
  expect(retry).toHaveBeenCalledOnce()
})

it("distinguishes a permission failure from an empty successful benefits list", () => {
  const props = { activeTab: "benefits" as const, onTabChange: vi.fn(), onRetry: vi.fn() }
  const view = render(<MemberCenterPage {...props} data={null} status="error" error="当前账号无权查看这项会员信息。" />)
  expect(screen.getByRole("alert")).toHaveTextContent("当前账号无权查看")
  expect(screen.queryByText("当前没有生效中的标准权益")).not.toBeInTheDocument()
  view.rerender(<MemberCenterPage {...props} data={{ entitlements: [] }} status="ready" />)
  expect(screen.getByText("当前没有生效中的标准权益")).toBeInTheDocument()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
