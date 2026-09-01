import { BenefitsPanel } from "./BenefitsPanel"
import { CommunityGroupsPanel } from "./CommunityGroupsPanel"
import { GrowthPanel } from "./GrowthPanel"
import { MedalsPanel } from "./MedalsPanel"
import type { MembershipCenterData } from "./membershipTypes"
import { PointsPanel } from "./PointsPanel"

export function MemberOverview({ data }: { data: MembershipCenterData }) {
  return <div className="member-overview"><GrowthPanel experience={data.experience} /><PointsPanel balance={data.pointsBalance} entries={data.pointsLedger.slice(0, 5)} /><CommunityGroupsPanel {...data.communityGroups} /><BenefitsPanel entitlements={data.entitlements} /><MedalsPanel medals={data.medals.filter((medal) => medal.isPublic)} /></div>
}
