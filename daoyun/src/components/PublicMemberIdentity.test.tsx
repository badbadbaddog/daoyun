import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { PublicMembershipSummary } from "../api/membership"
import { MemberIdentityBadges } from "./PublicMemberIdentity"

const summary: PublicMembershipSummary = {
  currentLevel: {
    id: "level-12",
    internalKey: "lv_12",
    levelOrder: 12,
    displayName: "开拓者",
    requiredExperience: 2400,
    iconAssetUrl: null,
    color: null,
    description: "持续参与社区讨论",
  },
  publicGroups: [{
    id: "group-1",
    internalKey: "product_pioneer",
    displayName: "产品体验官",
    isPublic: true,
    expiresAt: null,
  }],
  medals: [{
    key: "early-adopter",
    displayName: "首批用户",
    assetUrl: "/assets/medals/early-adopter.svg",
    grantedAt: "2026-08-03T00:00:00Z",
    isPublic: true,
  }],
}

describe("MemberIdentityBadges", () => {
  it("renders the public growth level, public group and medal without exposing private membership data", () => {
    render(<MemberIdentityBadges summary={summary} variant="detail" maxMedals={2} />)

    expect(screen.getByText("开拓者")).toBeInTheDocument()
    expect(screen.getByText("产品体验官")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "首批用户" })).toHaveAttribute("src", "/assets/medals/early-adopter.svg")
    expect(screen.queryByText(/积分|权益|额度/)).not.toBeInTheDocument()
  })
})
