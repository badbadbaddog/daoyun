import type { PublicMembershipSummary } from "../api/membership"
import { usePublicMembershipSummary } from "../features/membership/usePublicMembershipSummary"

interface MemberIdentityBadgesProps {
  summary: PublicMembershipSummary | null
  variant?: "compact" | "detail" | "feed" | "profile"
  maxMedals?: number
}

interface PublicMemberIdentityProps extends Omit<MemberIdentityBadgesProps, "summary"> {
  username: string
}

export function PublicMemberIdentity({ username, variant = "compact", maxMedals = 2 }: PublicMemberIdentityProps) {
  const summary = usePublicMembershipSummary(username)
  return <MemberIdentityBadges summary={summary} variant={variant} maxMedals={maxMedals} />
}

export function MemberIdentityBadges({ summary, variant = "compact", maxMedals = 2 }: MemberIdentityBadgesProps) {
  if (!summary) return null

  const level = summary.currentLevel
  const groups = summary.publicGroups.slice(0, variant === "profile" ? 2 : 1)
  const medals = variant !== "feed" && maxMedals > 0 ? summary.medals.slice(0, maxMedals) : []

  return (
    <span className={`public-member-identity public-member-identity--${variant}`} aria-label={variant === "feed" && groups.length ? `公开身份 ${groups[0].displayName}` : `成长等级 ${level.displayName}`}>
      {(variant !== "feed" || groups.length === 0) && <span className="public-member-level" title={level.description || `成长等级 ${level.displayName}`}>
        {level.displayName}
      </span>}
      {groups.map((group) => (
        <span className="public-member-group" key={group.id}>{group.displayName}</span>
      ))}
      {medals.length > 0 && (
        <span className="public-member-medals" aria-label="公开勋章">
          {medals.map((medal) => (
            <img
              key={medal.key}
              src={medal.assetUrl}
              alt={medal.displayName}
              title={medal.displayName}
              loading="lazy"
            />
          ))}
        </span>
      )}
    </span>
  )
}
