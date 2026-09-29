import type { AdminUserCandidate } from "./AdminUserPicker"

export function AdminUserSummaryCard({ user, balance, balanceLoading = false }: { user: AdminUserCandidate; balance?: number | null; balanceLoading?: boolean }) {
  return <section className="admin-user-summary" aria-label="已选用户"><div><strong>{user.displayName}</strong><span>@{user.username}</span></div><span className="admin-badge">{user.status === "active" ? "正常" : user.status}</span>{balance !== undefined && <p>当前积分 <strong>{balance === null ? (balanceLoading ? "正在读取…" : "暂不可用") : balance.toLocaleString()}</strong></p>}</section>
}
