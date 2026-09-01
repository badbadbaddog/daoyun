import type { PointsLedgerItem } from "./membershipTypes"

export function PointsLedger({ entries }: { entries: PointsLedgerItem[] }) {
  return entries.length > 0 ? (
    <ul className="points-ledger">
      {entries.map((entry) => <li key={entry.id}><span>{entry.reason}</span><strong>{entry.delta > 0 ? "+" : ""}{entry.delta}</strong><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString()}</time></li>)}
    </ul>
  ) : <p className="member-panel__empty">暂无积分流水</p>
}
