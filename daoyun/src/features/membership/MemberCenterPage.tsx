import { FileSearch, LoaderCircle, RefreshCw } from "lucide-react"

import { BenefitsPanel } from "./BenefitsPanel"
import { GrowthPanel } from "./GrowthPanel"
import { MedalsPanel } from "./MedalsPanel"
import { MemberOverview } from "./MemberOverview"
import type { MemberTab, MembershipCenterData } from "./membershipTypes"
import { PointsPanel } from "./PointsPanel"

interface MemberCenterPageProps {
  activeTab: MemberTab
  data: MembershipCenterData | null
  status: "loading" | "ready" | "error"
  pluginError?: string | null
  onTabChange: (tab: MemberTab) => void
  onRetry: () => void
}

const tabs: Array<[MemberTab, string]> = [["overview", "首页"], ["growth", "成长"], ["points", "积分"], ["benefits", "权益"], ["medals", "勋章"]]

export function MemberCenterPage({ activeTab, data, status, pluginError, onTabChange, onRetry }: MemberCenterPageProps) {
  return <section className="member-center" aria-labelledby="member-center-title"><header className="member-center__header"><p>我的社区身份</p><h1 id="member-center-title">会员中心</h1></header><nav className="member-tabs" aria-label="会员中心栏目">{tabs.map(([tab, label]) => <button key={tab} type="button" aria-current={activeTab === tab ? "page" : undefined} onClick={() => onTabChange(tab)}>{label}</button>)}</nav>{status === "loading" ? <div className="topic-loading" role="status"><LoaderCircle className="topic-loading__spinner" size={22} />正在加载会员信息</div> : status === "error" || !data ? <div className="empty-state" role="alert"><FileSearch size={28} /><h2>会员信息暂时不可用</h2><button className="secondary-button" type="button" onClick={onRetry}><RefreshCw size={15} />重试</button></div> : <>{activeTab === "overview" && <MemberOverview data={data} />}{activeTab === "growth" && <GrowthPanel experience={data.experience} />}{activeTab === "points" && <PointsPanel balance={data.pointsBalance} entries={data.pointsLedger} />}{activeTab === "benefits" && <BenefitsPanel entitlements={data.entitlements} />}{activeTab === "medals" && <MedalsPanel medals={data.medals} />}{pluginError && <p className="interaction-alert" role="alert">{pluginError}</p>}</>}</section>
}
