import { useEffect, useState } from "react"

import { getMembershipExperience } from "../../api/membership"
import { getCurrentMembership, getUserProfile } from "../../api/users"
import type { MembershipExperience } from "../membership/membershipTypes"

export interface HomeProfileData {
  experience: MembershipExperience | null
  pointsBalance: number | null
  topicCount: number | null
  avatarUrl: string | null
}

export function useHomeProfile(username: string | null, viewerKey: string, enabled: boolean) {
  const key = enabled && username ? username + ":" + viewerKey : ""
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ key: string; data: HomeProfileData | null; loading: boolean; errors: string[] }>({ key: "", data: null, loading: false, errors: [] })

  useEffect(() => {
    if (!key || !username) {
      setState({ key: "", data: null, loading: false, errors: [] })
      return
    }
    const controller = new AbortController()
    setState({ key, data: null, loading: true, errors: [] })
    Promise.allSettled([
      getMembershipExperience(controller.signal),
      getCurrentMembership(controller.signal),
      getUserProfile(username, controller.signal),
    ]).then(([growth, points, profile]) => {
      if (controller.signal.aborted) return
      const errors: string[] = []
      if (growth.status === "rejected") errors.push("成长信息暂时不可用")
      if (points.status === "rejected") errors.push("积分暂时不可用")
      if (profile.status === "rejected") errors.push("个人资料暂时不可用")
      setState({ key, loading: false, errors, data: {
        experience: growth.status === "fulfilled" ? growth.value : null,
        pointsBalance: points.status === "fulfilled" ? points.value.pointsBalance : null,
        topicCount: profile.status === "fulfilled" ? profile.value.topicCount : null,
        avatarUrl: profile.status === "fulfilled" ? profile.value.avatarUrl : null,
      } })
    })
    return () => controller.abort()
  }, [key, username, version])

  // 身份变化的首帧也不显示前一个账户的私有统计。
  const current = key && state.key === key ? state : { data: null, loading: Boolean(key), errors: [] }
  return { ...current, retry: () => setVersion(value => value + 1) }
}
