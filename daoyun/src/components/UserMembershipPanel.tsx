import type { ReactNode } from "react"
import type { AdminUserMembershipSection, AdminUserMembershipSummary } from "../api/adminUsers"
import { GrowthProgress } from "../features/membership/GrowthProgress"

type MembershipProps = { summary: AdminUserMembershipSummary | null; readableSections: AdminUserMembershipSection[]; loading: boolean }

function membershipValue({ summary, readableSections, loading }: MembershipProps, section: AdminUserMembershipSection, value: ReactNode) {
  if (!readableSections.includes(section)) return "无权查看"
  if (loading) return "正在读取…"
  if (!summary) return "暂不可用"
  if (!summary.readableSections.includes(section)) return "无权查看"
  return value
}

export function UserMembershipIdentity(props: MembershipProps) {
  const { summary } = props
  const growth = summary?.experience
  const now = Date.now()
  const activeEntitlements = summary?.entitlements?.filter(item => !item.revokedAt && Date.parse(item.startsAt) <= now && (!item.endsAt || Date.parse(item.endsAt) > now))
  return <section className="user-membership-identity" aria-label="会员身份摘要">
    <dl>
      <div><dt>基础身份 / 附加身份</dt><dd>{membershipValue(props, "groups", summary?.groups?.length ? summary.groups.map(group => <span key={group.id}>{group.group.displayName} · {group.membershipKind === "base" ? "基础组" : "附加组"}</span>) : "无有效身份")}</dd></div>
      <div><dt>成长等级 / EXP</dt><dd>{membershipValue(props, "experience", growth ? <><strong>Lv.{growth.currentLevel.levelOrder} · {growth.currentLevel.displayName}</strong><span>EXP {growth.experience.toLocaleString()}</span><GrowthProgress experience={growth.experience} currentThreshold={growth.currentLevel.requiredExperience} nextThreshold={summary?.nextLevel?.requiredExperience ?? null} /><small>{summary?.nextLevel ? "距" + summary.nextLevel.displayName + "还需 " + (summary.nextLevel.requiredExperience - growth.experience).toLocaleString() + " EXP" : "已达到当前最高成长阶段"}</small></> : "未初始化")}</dd></div>
      <div><dt>积分</dt><dd>{membershipValue(props, "points", summary?.points ? summary.points.pointsBalance.toLocaleString() : "未初始化")}</dd></div>
      <div><dt>当前会员权益</dt><dd>{membershipValue(props, "entitlements", activeEntitlements?.length ? activeEntitlements.map(item => <span key={item.id}>{item.entitlementKey} · v{item.typeVersion}</span>) : "无有效权益")}</dd></div>
      <div><dt>勋章数量</dt><dd>{membershipValue(props, "medals", summary?.medals?.length.toLocaleString() ?? "0")}</dd></div>
    </dl>
  </section>
}

export function UserMembershipPanel({ summary, readableSections, loading, children }: MembershipProps & { children?: ReactNode }) {
  const props = { summary, readableSections, loading }
  return <div className="user-membership-panel">
    <section><h3>用户组身份</h3>{membershipValue(props, "groups", summary?.groups?.length ? <ul className="user-membership-records">{summary.groups.map(item => <li key={item.id}><strong>{item.group.displayName} · {item.membershipKind === "base" ? "基础组" : "附加组"}</strong><span>来源：{item.source}</span><span>原因：{item.reason}</span><span>{date(item.startsAt)} — {item.endsAt ? date(item.endsAt) : "长期有效"}</span></li>)}</ul> : "无有效身份")}</section>
    <section><h3>成长档案</h3>{membershipValue(props, "experience", summary?.experience ? <p>当前 EXP {summary.experience.experience.toLocaleString()}；当前等级 {summary.experience.currentLevel.displayName}。{summary.nextLevel ? "下一等级 " + summary.nextLevel.displayName + "，门槛 " + summary.nextLevel.requiredExperience.toLocaleString() + " EXP。" : "当前已无下一等级。"}成长不授予治理权限，积分调整不改变 EXP。</p> : "未初始化")}</section>
    <section><h3>积分账户</h3>{membershipValue(props, "points", summary?.points ? <p>可用积分 {summary.points.pointsBalance.toLocaleString()}；累计获得 {summary.points.lifetimePoints.toLocaleString()}。</p> : "未初始化")}</section>
    <section><h3>持有勋章</h3>{membershipValue(props, "medals", summary?.medals?.length ? <ul className="user-membership-records">{summary.medals.map(item => <li key={item.key}><strong>{item.displayName}</strong><span>授予时间：{date(item.grantedAt)}</span></li>)}</ul> : "未持有勋章")}</section>
    <section><h3>会员权益记录</h3>{membershipValue(props, "entitlements", summary?.entitlements?.length ? <ul className="user-membership-records">{summary.entitlements.map(item => <li key={item.id}><strong>{item.entitlementKey} · v{item.typeVersion}</strong><span>{item.revokedAt ? "已撤销" : item.endsAt && Date.parse(item.endsAt) <= Date.now() ? "已到期" : Date.parse(item.startsAt) > Date.now() ? "待生效" : "有效期内"}</span><span>来源：{item.source}；原因：{item.reason}</span><span>{date(item.startsAt)} — {item.endsAt ? date(item.endsAt) : "长期有效"}</span><details><summary>权限与额度快照</summary><p>{item.permissionSnapshot.join("、") || "无普通能力"}</p>{Object.entries(item.quotaSnapshot).map(([key,value]) => <p key={key}>{key}：{value.toLocaleString()}</p>)}</details>{item.revokedAt && <span>撤销：{item.revocationReason} · {date(item.revokedAt)}</span>}</li>)}</ul> : "无权益操作记录")}</section>
    {children}
  </div>
}

function date(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }) }
