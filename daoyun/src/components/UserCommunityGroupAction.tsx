import { useEffect, useState } from "react"
import { LoaderCircle } from "lucide-react"

import { AdminApiError, listAdminCommunityGroups, type AdminCommunityGroup } from "../api/admin"
import type { AdminUserSummary } from "../api/adminUsers"
import { CommunityGroupMembershipManager } from "./CommunityGroupMembershipManager"

export function UserCommunityGroupAction({ user, csrfToken, canWrite, onBusyChange }: { user: AdminUserSummary; csrfToken: string; canWrite: boolean; onBusyChange: (busy: boolean) => void }) {
  const [groups, setGroups] = useState<AdminCommunityGroup[]>([])
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState("loading"); setError("")
    listAdminCommunityGroups(controller.signal).then(result => {
      if (!controller.signal.aborted) { setGroups(result); setState("ready") }
    }).catch(reason => {
      if (!controller.signal.aborted) { setError(reason instanceof AdminApiError ? reason.message : "用户组目录暂时无法加载"); setState("error") }
    })
    return () => controller.abort()
  }, [reload, user.id])

  if (state === "loading") return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={18} aria-hidden="true" />正在读取用户组目录</div>
  if (state === "error") return <div className="admin-state" role="alert">{error}<button className="secondary-button" onClick={() => setReload(value => value + 1)} type="button">重试用户组目录</button></div>
  return <CommunityGroupMembershipManager key={user.id} groups={groups} user={user} csrfToken={csrfToken} canWrite={canWrite} onBusyChange={onBusyChange} />
}
