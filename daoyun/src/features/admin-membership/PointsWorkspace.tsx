import { useEffect, useMemo, useState, type FormEvent } from "react"

import type { AdminUserCandidate } from "../../components/admin/AdminUserPicker"
import { AdminUserSummaryCard } from "../../components/admin/AdminUserSummaryCard"
import { AdminReasonField } from "../../components/admin/AdminReasonField"
import { MutationResult } from "../../components/admin/MutationResult"

export interface PointsGrantDraft {
  userId: string
  amount: number
  reason: string
  details: string
  idempotencyKey: string
}

interface PointsWorkspaceProps {
  selectedUser: AdminUserCandidate | null
  balance: number | null
  onGrant: (input: PointsGrantDraft) => Promise<{ balance: number; auditId?: string; replayed?: boolean }>
}

export function PointsWorkspace({ selectedUser, balance, onGrant }: PointsWorkspaceProps) {
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<{ balance: number; auditId?: string; replayed?: boolean } | null>(null)
  const idempotencyKey = useMemo(newIdempotencyKey, [selectedUser?.id])
  useEffect(() => { setAmount(""); setReason(""); setDetails(""); setError(""); setResult(null) }, [selectedUser?.id])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selectedUser) return
    const parsedAmount = Number(amount)
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount === 0 || !reason) {
      setError("请选择运营原因并填写非零整数积分。")
      return
    }
    setBusy(true)
    setError("")
    try {
      setResult(await onGrant({ userId: selectedUser.id, amount: parsedAmount, reason, details: details.trim(), idempotencyKey }))
    } catch {
      setError("积分操作失败，当前表单已保留，可安全重试。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="membership-rule-section" aria-labelledby="points-workspace-title">
      <h2 id="points-workspace-title">积分账本</h2>
      {selectedUser ? (
        <>
          <AdminUserSummaryCard user={selectedUser} balance={balance} />
          <form onSubmit={(event) => void submit(event)}>
            <label>
              积分数量
              <input type="number" aria-label="积分数量" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} />
            </label>
            <AdminReasonField reason={reason} details={details} disabled={busy} onReasonChange={setReason} onDetailsChange={setDetails} />
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "正在提交" : "确认积分操作"}</button>
          </form>
          {error && <p className="interaction-alert" role="alert">{error}</p>}
          {result && <MutationResult title="积分操作完成" message={`最新余额 ${result.balance.toLocaleString()}`} auditId={result.auditId} replayed={result.replayed} />}
        </>
      ) : <p>请先搜索并选择用户。</p>}
    </section>
  )
}

function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === "function" ? `admin-points:${crypto.randomUUID()}` : `admin-points:${Date.now()}:${Math.random().toString(16).slice(2)}`
}
