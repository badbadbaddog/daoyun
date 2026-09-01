interface GrowthProgressProps {
  experience: number
  currentThreshold: number
  nextThreshold: number | null
}

export function GrowthProgress({ experience, currentThreshold, nextThreshold }: GrowthProgressProps) {
  const span = nextThreshold === null ? 1 : Math.max(1, nextThreshold - currentThreshold)
  const progress = nextThreshold === null ? 100 : Math.min(100, Math.max(0, ((experience - currentThreshold) / span) * 100))
  return <progress className="growth-progress" max={100} value={progress} aria-label="成长等级进度">{Math.round(progress)}%</progress>
}
