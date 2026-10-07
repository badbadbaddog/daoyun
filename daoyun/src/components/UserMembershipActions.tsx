import { useCallback, useEffect, useState } from "react"
import { grantMembershipPoints } from "../api/admin"
import type { AdminUserDetail, AdminUserMembershipSection, AdminUserMembershipSummary } from "../api/adminUsers"
import { EntitlementsWorkspace } from "../features/admin-membership/EntitlementsWorkspace"
import { UserExperienceAction } from "../features/admin-membership/ExperienceWorkspace"
import { UserMedalAction } from "./UserMedalAction"
import { PointsWorkspace } from "../features/admin-membership/PointsWorkspace"
import { UserCommunityGroupAction } from "./UserCommunityGroupAction"

export function UserMembershipActions({ user, summary, readableSections, loading, csrfToken, capabilityKeys, canWriteGroups, onChanged, onRetry, onBusyChange }: { user: AdminUserDetail; summary: AdminUserMembershipSummary | null; readableSections: AdminUserMembershipSection[]; loading: boolean; csrfToken: string; capabilityKeys: string[]; canWriteGroups: boolean; onChanged: () => void; onRetry: () => void; onBusyChange: (busy: boolean) => void }) {
  const [serverSections, setServerSections] = useState<AdminUserMembershipSection[]>(summary?.readableSections ?? [])
  const [groupBusy, setGroupBusy] = useState(false)
  const [pointsBusy, setPointsBusy] = useState(false)
  const [entitlementBusy, setEntitlementBusy] = useState(false)
  const [experienceBusy,setExperienceBusy] = useState(false)
  const experienceBusyChange=useCallback((busy:boolean)=>setExperienceBusy(busy),[])
  const [medalBusy, setMedalBusy] = useState(false)
  const entitlementBusyChange = useCallback((busy: boolean) => setEntitlementBusy(busy), [])
  const medalBusyChange = useCallback((busy: boolean) => setMedalBusy(busy), [])
  const groupBusyChange = useCallback((busy: boolean) => setGroupBusy(busy), [])
  const pointsBusyChange = useCallback((busy: boolean) => setPointsBusy(busy), [])
  useEffect(() => { if (summary) setServerSections(summary.readableSections) }, [summary])
  useEffect(() => { onBusyChange(groupBusy || pointsBusy || entitlementBusy || medalBusy || experienceBusy) }, [groupBusy, pointsBusy, entitlementBusy, medalBusy, experienceBusy, onBusyChange])
  useEffect(() => () => onBusyChange(false), [onBusyChange])
  const canRead = (section: AdminUserMembershipSection) => readableSections.includes(section) && (summary?.readableSections ?? serverSections).includes(section)
  return <div className="user-membership-actions">
    <div hidden={!canRead("experience")}><UserExperienceAction userId={user.id} csrfToken={csrfToken} canRead={canRead("experience")} canWrite={canRead("experience") && capabilityKeys.includes("membership.rules.write") && !groupBusy && !pointsBusy && !entitlementBusy && !medalBusy} onChanged={onChanged} onBusyChange={experienceBusyChange}/></div>
    <div hidden={!canRead("groups")}><UserCommunityGroupAction user={user} csrfToken={csrfToken} canRead={canRead("groups")} canWrite={canWriteGroups && !pointsBusy && !entitlementBusy && !medalBusy && !experienceBusy} onBusyChange={groupBusyChange} onChanged={onChanged} /></div>
    <div hidden={!canRead("points")}><PointsWorkspace canReadLedger={canRead("points")} selectedUser={user} balance={canRead("points") ? summary?.points?.pointsBalance ?? null : null} balanceLoading={loading} canWrite={canRead("points") && !groupBusy && !entitlementBusy && !medalBusy && !experienceBusy} onRetryBalance={onRetry} balanceError={!loading && !summary ? "余额暂不可用，请重新读取会员档案。" : ""} onBusyChange={pointsBusyChange} onGrant={async input => {
      if (!canRead("points") || groupBusy || entitlementBusy || medalBusy || experienceBusy || input.userId !== user.id) throw new Error("当前用户的积分操作不可用")
      const result = await grantMembershipPoints(input, csrfToken)
      onChanged()
      return { balance: result.account.pointsBalance, auditId: result.auditId ?? undefined, replayed: !result.created, ledgerEntryId: result.ledgerEntryId, balanceBefore: result.balanceBefore, balanceAfter: result.balanceAfter, requestId: result.requestId }
    }} /></div>
    <div hidden={!canRead("entitlements")}><EntitlementsWorkspace fixedUser={user} csrfToken={csrfToken} canReadTypes={canRead("entitlements") && capabilityKeys.includes("entitlements.types.read")} canWriteTypes={false} canReadGrants={canRead("entitlements")} canWriteGrants={canRead("entitlements") && capabilityKeys.includes("entitlements.grants.write") && !groupBusy && !pointsBusy && !medalBusy && !experienceBusy} canReadUsers={false} onChanged={onChanged} onBusyChange={entitlementBusyChange} /></div>
    <div hidden={!canRead("medals")}><UserMedalAction userId={user.id} medals={summary?.medals ?? []} csrfToken={csrfToken} canRead={canRead("medals")} canWrite={canRead("medals") && capabilityKeys.includes("membership.medals.grant") && !groupBusy && !pointsBusy && !entitlementBusy && !experienceBusy} onChanged={onChanged} onBusyChange={medalBusyChange} /></div>
  </div>
}
