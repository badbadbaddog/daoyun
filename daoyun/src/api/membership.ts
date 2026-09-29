import type {
  MemberCommunityGroup,
  MemberEntitlement,
  MemberMedal,
  MembershipCenterData,
  MembershipGrowthLevel,
  PointsLedgerItem,
} from "../features/membership/membershipTypes"
import { getCurrentMembership, listUserMedals } from "./users"

export interface CurrentExperience {
  experience: number
  currentLevel: MembershipGrowthLevel
  revision: number
  updatedAt: string
}

export interface PointsLedgerPage {
  entries: PointsLedgerItem[]
  nextCursor: string | null
}

export interface CurrentCommunityGroups {
  base: MemberCommunityGroup[]
  additional: MemberCommunityGroup[]
}

export interface PublicMembershipSummary {
  currentLevel: MembershipGrowthLevel
  medals: MemberMedal[]
  publicGroups: MemberCommunityGroup[]
}

export async function getCurrentExperience(signal?: AbortSignal): Promise<CurrentExperience> {
  const payload = await getEnvelope("/api/v1/users/me/experience", signal)
  const data = record(payload.data, "成长账户响应格式无效")
  return {
    experience: integer(data.experience, "成长账户响应格式无效"),
    currentLevel: mapGrowthLevel(record(data.current_level, "成长等级响应格式无效")),
    revision: integer(data.revision, "成长账户响应格式无效"),
    updatedAt: text(data.updated_at, "成长账户响应格式无效"),
  }
}

export async function getCurrentCommunityGroups(signal?: AbortSignal): Promise<CurrentCommunityGroups> {
  const payload = await getEnvelope("/api/v1/users/me/groups", signal)
  const data = record(payload.data, "用户组响应格式无效")
  const memberships = array(data.memberships, "用户组响应格式无效")
  const result: CurrentCommunityGroups = { base: [], additional: [] }
  memberships.forEach((value) => {
    const membership = record(value, "用户组响应格式无效")
    const group = record(membership.group, "用户组响应格式无效")
    const item: MemberCommunityGroup = {
      id: text(group.id, "用户组响应格式无效"),
      internalKey: text(group.internal_key, "用户组响应格式无效"),
      displayName: text(group.display_name, "用户组响应格式无效"),
      isPublic: false,
      expiresAt: nullableText(membership.ends_at, "用户组响应格式无效"),
    }
    if (membership.membership_kind === "base") result.base.push(item)
    else result.additional.push(item)
  })
  return result
}

export async function listGrowthLevels(signal?: AbortSignal): Promise<MembershipGrowthLevel[]> {
  const payload = await getEnvelope("/api/v1/membership/levels", signal)
  return array(payload.data, "成长等级响应格式无效").map((value) => mapGrowthLevel(record(value, "成长等级响应格式无效")))
}

export async function listMyPointsLedger(options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<PointsLedgerPage> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 20) })
  if (options.cursor) params.set("cursor", options.cursor)
  const payload = await getEnvelope(`/api/v1/users/me/points/ledger?${params.toString()}`, options.signal)
  const entries = array(payload.data, "积分流水响应格式无效").map((value) => {
    const item = record(value, "积分流水响应格式无效")
    return {
      id: text(item.id, "积分流水响应格式无效"),
      delta: integer(item.amount, "积分流水响应格式无效"),
      balanceAfter: integer(item.balance_after, "积分流水响应格式无效"),
      reason: pointsReason(text(item.reason, "积分流水响应格式无效")),
      createdAt: text(item.created_at, "积分流水响应格式无效"),
    }
  })
  const meta = record(payload.meta, "积分流水响应格式无效")
  return { entries, nextCursor: nullableText(meta.next_cursor, "积分流水响应格式无效") }
}

export async function listMyEntitlements(signal?: AbortSignal): Promise<MemberEntitlement[]> {
  const payload = await getEnvelope("/api/v1/users/me/entitlements", signal)
  return array(payload.data, "标准权益响应格式无效").map((value) => {
    const item = record(value, "标准权益响应格式无效")
    return {
      id: text(item.id, "标准权益响应格式无效"),
      internalKey: text(item.internal_key, "标准权益响应格式无效"),
      displayName: displayInternalKey(text(item.internal_key, "标准权益响应格式无效")),
      startsAt: text(item.starts_at, "标准权益响应格式无效"),
      expiresAt: nullableText(item.ends_at, "标准权益响应格式无效"),
      quotas: numberRecord(item.quotas, "标准权益响应格式无效"),
    }
  })
}

export async function listUserMembershipSummary(username: string, signal?: AbortSignal): Promise<PublicMembershipSummary> {
  const payload = await getEnvelope(`/api/v1/users/${encodeURIComponent(username)}/membership-summary`, signal)
  const data = record(payload.data, "公开会员摘要响应格式无效")
  return {
    currentLevel: mapGrowthLevel(record(data.current_level, "公开会员摘要响应格式无效")),
    medals: array(data.medals, "公开会员摘要响应格式无效").map(mapMedal),
    publicGroups: array(data.public_groups, "公开会员摘要响应格式无效").map((value) => {
      const group = record(value, "公开会员摘要响应格式无效")
      return { id: text(group.id, "公开会员摘要响应格式无效"), internalKey: text(group.internal_key, "公开会员摘要响应格式无效"), displayName: text(group.display_name, "公开会员摘要响应格式无效"), isPublic: true, expiresAt: null }
    }),
  }
}

export async function loadMembershipCenterData(username: string, signal?: AbortSignal): Promise<MembershipCenterData> {
  const [experience, levels, account, ledger, communityGroups, entitlements, medals] = await Promise.all([
    getCurrentExperience(signal),
    listGrowthLevels(signal),
    getCurrentMembership(signal),
    listMyPointsLedger({ signal }),
    getCurrentCommunityGroups(signal),
    listMyEntitlements(signal),
    listUserMedals(username, signal),
  ])
  const nextLevel = [...levels]
    .filter((level) => level.requiredExperience > experience.experience)
    .sort((left, right) => left.requiredExperience - right.requiredExperience)[0] ?? null
  return {
    experience: { experience: experience.experience, level: experience.currentLevel, nextLevel },
    pointsBalance: account.pointsBalance,
    pointsLedger: ledger.entries,
    communityGroups,
    entitlements,
    medals: medals.map((medal) => ({ ...medal, isPublic: true })),
  }
}

function mapGrowthLevel(value: Record<string, unknown>): MembershipGrowthLevel {
  return {
    id: text(value.id, "成长等级响应格式无效"),
    internalKey: text(value.internal_key, "成长等级响应格式无效"),
    levelOrder: integer(value.level_order, "成长等级响应格式无效"),
    displayName: text(value.display_name, "成长等级响应格式无效"),
    requiredExperience: integer(value.required_experience, "成长等级响应格式无效"),
    iconAssetUrl: null,
    color: nullableText(value.color, "成长等级响应格式无效"),
    description: text(value.description, "成长等级响应格式无效", true),
  }
}

function mapMedal(value: unknown): MemberMedal {
  const medal = record(value, "勋章响应格式无效")
  return { key: text(medal.key, "勋章响应格式无效"), displayName: text(medal.display_name, "勋章响应格式无效"), assetUrl: text(medal.asset_url, "勋章响应格式无效"), grantedAt: text(medal.granted_at, "勋章响应格式无效"), isPublic: true }
}

async function getEnvelope(url: string, signal?: AbortSignal): Promise<{ data: unknown; meta: unknown }> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, credentials: "include", signal })
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error("会员服务请求失败")
  const envelope = record(payload, "会员服务响应格式无效")
  return { data: envelope.data, meta: envelope.meta }
}

function pointsReason(reason: string): string {
  const labels: Record<string, string> = { "content.topic.quality": "发布优质主题", "content.reply.quality": "发布优质回复", "operations.adjustment": "运营调整", "points.redemption": "积分兑换" }
  return labels[reason] ?? reason
}

function displayInternalKey(value: string): string {
  return value.split("_").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ")
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function array(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(message)
  return value
}

function text(value: unknown, message: string, empty = false): string {
  if (typeof value !== "string" || (!empty && !value)) throw new Error(message)
  return value
}

function nullableText(value: unknown, message: string): string | null {
  if (value === null || value === undefined) return null
  return text(value, message)
}

function integer(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(message)
  return value
}

function numberRecord(value: unknown, message: string): Record<string, number> {
  const source = record(value, message)
  if (Object.values(source).some((item) => typeof item !== "number" || !Number.isSafeInteger(item))) throw new Error(message)
  return source as Record<string, number>
}
