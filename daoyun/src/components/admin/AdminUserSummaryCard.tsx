import type { AdminUserCandidate } from "./AdminUserPicker"

export function AdminUserSummaryCard({ user, balance }: { user: AdminUserCandidate; balance?: number | null }) {
  return <section className="admin-user-summary" aria-label="已选用户"><div><strong>{user.displayName}</strong><span>@{user.username}</span></div><span className="admin-badge">{user.status}</span>{balance !== undefined && <p>当前积分 <strong>{balance === null ? "加载失败" : balance.toLocaleString()}</strong></p>}</section>
}
