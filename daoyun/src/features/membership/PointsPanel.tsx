import type { PointsLedgerItem } from "./membershipTypes"
import { PointsLedger } from "./PointsLedger"

export function PointsPanel({ balance, entries }: { balance: number; entries: PointsLedgerItem[] }) {
  return <section className="member-panel points-panel" aria-label="积分概览"><p className="member-panel__eyebrow">可用积分</p><h2>积分</h2><strong className="member-balance">{balance.toLocaleString()}</strong><PointsLedger entries={entries} /></section>
}
