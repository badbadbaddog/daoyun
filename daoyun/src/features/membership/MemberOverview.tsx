import { BenefitsPanel } from "./BenefitsPanel"
import { CommunityGroupsPanel } from "./CommunityGroupsPanel"
import { GrowthProgress } from "./GrowthProgress"
import { MedalsPanel } from "./MedalsPanel"
import type { MemberTab, MembershipCenterData } from "./membershipTypes"
import { PointsPanel } from "./PointsPanel"

interface MemberOverviewProps {
  data: MembershipCenterData
  onTabChange: (tab: MemberTab) => void
}

export function MemberOverview({ data, onTabChange }: MemberOverviewProps) {
  const experience = data.experience
  const remaining = experience.nextLevel
    ? Math.max(0, experience.nextLevel.requiredExperience - experience.experience)
    : 0
  const publicMedals = data.medals.filter((medal) => medal.isPublic)

  return (
    <div className="member-overview">
      <section className="member-identity-summary" aria-label="我的成长概览">
        <div className="member-identity-summary__growth">
          <span className="member-panel__eyebrow">当前社区身份</span>
          <h2>{experience.level.displayName}</h2>
          {experience.level.description && <p className="member-identity-summary__description">{experience.level.description}</p>}
          <div className="member-identity-summary__exp">
            <strong>{experience.experience.toLocaleString()} EXP</strong>
            <span>{experience.nextLevel
              ? `距离${experience.nextLevel.displayName}还需 ${remaining.toLocaleString()} EXP`
              : "已达到当前最高成长等级"}</span>
          </div>
          <GrowthProgress
            experience={experience.experience}
            currentThreshold={experience.level.requiredExperience}
            nextThreshold={experience.nextLevel?.requiredExperience ?? null}
          />
        </div>

        <div className="member-identity-summary__assets" aria-label="我的会员资产">
          <button type="button" aria-label="查看积分详情" onClick={() => onTabChange("points")}>
            <strong>{data.pointsBalance.toLocaleString()} 积分</strong>
            <span>查看积分记录</span>
          </button>
          <button type="button" aria-label="查看权益详情" onClick={() => onTabChange("benefits")}>
            <strong>{data.entitlements.length.toLocaleString()} 项权益</strong>
            <span>查看当前权益</span>
          </button>
          <button type="button" aria-label="查看勋章详情" onClick={() => onTabChange("medals")}>
            <strong>{publicMedals.length.toLocaleString()} 枚公开勋章</strong>
            <span>查看身份勋章</span>
          </button>
        </div>
      </section>

      <div className="member-overview__details">
        <PointsPanel balance={data.pointsBalance} entries={data.pointsLedger.slice(0, 5)} />
        <CommunityGroupsPanel {...data.communityGroups} />
        <BenefitsPanel entitlements={data.entitlements} />
        <MedalsPanel medals={publicMedals} />
      </div>
    </div>
  )
}
