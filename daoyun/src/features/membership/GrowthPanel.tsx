import type { MembershipExperience } from "./membershipTypes"
import { GrowthProgress } from "./GrowthProgress"

export function GrowthPanel({ experience }: { experience: MembershipExperience }) {
  const remaining = experience.nextLevel ? Math.max(0, experience.nextLevel.requiredExperience - experience.experience) : 0
  return (
    <section className="member-panel growth-panel" aria-label="成长等级">
      <p className="member-panel__eyebrow">Growth Level · EXP</p>
      <h2>{experience.level.displayName}</h2>
      <strong>{experience.experience.toLocaleString()} EXP</strong>
      <GrowthProgress experience={experience.experience} currentThreshold={experience.level.requiredExperience} nextThreshold={experience.nextLevel?.requiredExperience ?? null} />
      <p>{experience.nextLevel ? `距离${experience.nextLevel.displayName}还需 ${remaining.toLocaleString()} EXP` : "已达到当前最高成长等级"}</p>
    </section>
  )
}
