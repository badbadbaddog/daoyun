import { MessageSquare, RefreshCw } from "lucide-react"

import type { AuthSession } from "../api/auth"
import type { HomeProfileData } from "../features/feed/useHomeProfile"
import type { MembershipExperience } from "../features/membership/membershipTypes"
import { usePublicMembershipSummary } from "../features/membership/usePublicMembershipSummary"
import { UserAvatar } from "./UserAvatar"

interface HomeProfilePanelProps {
  session: AuthSession
  profile?: HomeProfileData | null
  experience?: MembershipExperience | null
  loading?: boolean
  errors?: string[]
  onRetry?: () => void
  onCompose: () => void
}

export function HomeProfilePanel({ session, profile, experience, loading = false, errors = [], onRetry, onCompose }: HomeProfilePanelProps) {
  const { summary, status, retry } = usePublicMembershipSummary(session.user.username)
  const growth = experience ?? profile?.experience
  const level = growth?.level ?? summary?.currentLevel
  const next = growth?.nextLevel
  const progressValue = growth && next ? Math.max(0, growth.experience - growth.level.requiredExperience) : 1
  const progressMax = growth && next ? Math.max(1, next.requiredExperience - growth.level.requiredExperience) : 1
  const stats = [
    { label: "积分", value: profile?.pointsBalance, href: "#member/points" },
    { label: "勋章", value: summary?.medals.length, href: "#member/medals" },
    { label: "我的帖子", value: profile?.topicCount, href: "#user/" + session.user.username },
  ]

  return (
    <section className="panel home-profile-panel" aria-label="我的社区账户" aria-busy={loading}>
      <div className="home-profile-panel__head">
        <a className="home-profile-panel__avatar" href={"#user/" + session.user.username} aria-label="查看我的个人主页">
          <UserAvatar username={session.user.username} displayName={session.user.displayName} avatarUrl={profile?.avatarUrl ?? null} />
        </a>
        <div className="home-profile-panel__info">
          <div className="home-profile-panel__name"><h2>{session.user.displayName}</h2>
            {summary?.publicGroups.slice(0, 1).map(group => <span className="public-member-group" key={group.id}>{group.displayName}</span>)}
          </div>
          {level ? <div className="home-profile-panel__level">
            <span className="home-profile-panel__level-badge" aria-label={"成长等级：" + level.displayName} title={level.description || level.displayName}>Lv.{level.levelOrder}</span>
            {growth && <>
              <progress aria-label="成长等级进度" value={progressValue} max={progressMax} />
              <span className="home-profile-panel__level-value">{growth.experience.toLocaleString("zh-CN")}{next ? " / " + next.requiredExperience.toLocaleString("zh-CN") : ""}<span aria-hidden="true"> EXP</span></span>
            </>}
          </div> : <p>{loading ? "正在加载成长信息" : "分享生活，发现更多可能"}</p>}
        </div>
      </div>
      <dl className="home-profile-panel__stats" aria-label="我的社区统计">
        {stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd><a href={stat.href} aria-label={(stat.value == null ? "—" : stat.value.toLocaleString("zh-CN")) + " " + stat.label} title={stat.value == null ? loading || status === "loading" ? "正在加载" : "暂时不可用" : stat.label}>{stat.value == null ? "—" : stat.value.toLocaleString("zh-CN")}</a></dd></div>)}
      </dl>
      {(errors.length > 0 || status === "error") && <div className="home-profile-panel__error" role="status"><span>部分统计暂时不可用</span><button type="button" onClick={() => { onRetry?.(); retry() }} aria-label="重试个人统计" title={errors.join("；") || "重试公开勋章"}><RefreshCw size={12} aria-hidden="true" />重试</button></div>}
      <button className="primary-button" type="button" onClick={onCompose} aria-label="发布主题"><MessageSquare size={16} aria-hidden="true" />发布主题</button>
    </section>
  )
}
