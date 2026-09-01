export type MemberTab = "overview" | "growth" | "points" | "benefits" | "medals"

export interface MembershipGrowthLevel {
  id: string
  internalKey: string
  levelOrder: number
  displayName: string
  requiredExperience: number
  iconAssetUrl: string | null
  color: string | null
  description: string
}

export interface MembershipExperience {
  experience: number
  level: MembershipGrowthLevel
  nextLevel: MembershipGrowthLevel | null
}

export interface PointsLedgerItem {
  id: string
  delta: number
  balanceAfter: number
  reason: string
  createdAt: string
}

export interface MemberCommunityGroup {
  id: string
  internalKey: string
  displayName: string
  isPublic: boolean
  expiresAt: string | null
}

export interface MemberEntitlement {
  id: string
  internalKey: string
  displayName: string
  startsAt: string
  expiresAt: string | null
  quotas: Record<string, number>
}

export interface MemberMedal {
  key: string
  displayName: string
  assetUrl: string
  grantedAt: string
  isPublic: boolean
}

export interface MembershipCenterData {
  experience: MembershipExperience
  pointsBalance: number
  pointsLedger: PointsLedgerItem[]
  communityGroups: { base: MemberCommunityGroup[]; additional: MemberCommunityGroup[] }
  entitlements: MemberEntitlement[]
  medals: MemberMedal[]
}
