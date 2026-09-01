export function formatBoardCount(value: number): string {
  if (value < 10_000) return String(value)
  if (value < 100_000_000) return `${formatUnit(value / 10_000)}万`
  return `${formatUnit(value / 100_000_000)}亿`
}

export function formatBoardMeasure(value: number, label: string): string {
  const separator = value < 10_000 ? " " : ""
  return `${formatBoardCount(value)}${separator}个${label}`
}

function formatUnit(value: number): string {
  return String(Math.round(value * 10) / 10)
}
