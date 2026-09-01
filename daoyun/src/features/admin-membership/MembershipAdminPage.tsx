import type { ReactNode } from "react"

export function MembershipAdminPage({ children }: { children: ReactNode }) {
  return <div className="admin-membership-page"><header className="admin-panel__heading"><div><p>成长、积分、用户组与标准权益</p><h2>会员运营</h2></div></header><p className="admin-panel__description">EXP、积分、社区用户组、标准权益与治理角色保持独立；会员能力不授予后台治理权限。</p>{children}</div>
}
