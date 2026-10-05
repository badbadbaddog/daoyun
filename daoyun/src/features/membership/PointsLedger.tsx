import type { PointsLedgerItem } from "./membershipTypes"

export function PointsLedger({ entries }: { entries: PointsLedgerItem[] }) {
  if (entries.length === 0) return <p className="member-panel__empty">暂无积分流水</p>
  return <ul className="points-ledger">
    {entries.map(entry => <li key={entry.id}>
      <span>{entry.reason}</span><strong>{entry.delta > 0 ? "+" : ""}{entry.delta.toLocaleString()} 积分</strong>
      <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
      <dl>
        <div><dt>变更前后</dt><dd>{(entry.balanceAfter - entry.delta).toLocaleString()} → {entry.balanceAfter.toLocaleString()} 积分</dd></div>
        <div><dt>操作人</dt><dd>{entry.actorUsername ? (entry.actorDisplayName ?? entry.actorUsername) + " @" + entry.actorUsername : "未记录"}</dd></div>
        <div><dt>流水编号</dt><dd><code>{entry.id}</code></dd></div>
        <div><dt>原请求号</dt><dd>{entry.operationRequestId ? <code>{entry.operationRequestId}</code> : "未记录"}</dd></div>
      </dl>
    </li>)}
  </ul>
}
