import { useEffect, useRef, useState, type FormEvent } from "react"

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
  balanceLoading?: boolean
  balanceError?: string
  onRetryBalance?: () => void
  onBusyChange?: (busy: boolean) => void
  onGrant: (input: PointsGrantDraft) => Promise<{ balance: number; auditId?: string; replayed?: boolean }>
}

export function PointsWorkspace({ selectedUser, balance, balanceLoading = false, balanceError = "", onRetryBalance, onBusyChange, onGrant }: PointsWorkspaceProps) {
  const [amount, setAmount] = useState("")
  const [direction, setDirection] = useState("add")
  const [reason, setReason] = useState("")
  const [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<{ balance: number; auditId?: string; replayed?: boolean } | null>(null)
  const pending = useRef(false)
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null)
  const selection = useRef(0)
  useEffect(() => {
    setAmount(""); setReason(""); setDetails(""); setDirection("add"); setError(""); setResult(null)
    attempt.current = null
    selection.current += 1
  }, [selectedUser?.id])

  const quantity = Number(amount)
  const delta = direction === "deduct" ? -quantity : quantity
  const validQuantity = Number.isSafeInteger(quantity) && quantity > 0
  const projected = balance !== null && validQuantity ? balance + delta : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selectedUser || pending.current || balance === null || balanceLoading || balanceError) return
    if (!validQuantity || !reason) { setError("请选择运营原因并填写正整数积分。"); return }
    if (projected === null || !Number.isSafeInteger(projected)) { setError("积分数量超出可用范围。"); return }
    if (projected < 0) { setError("余额不足，扣减数量不能超过当前余额。"); return }
    const input = { userId: selectedUser.id, amount: delta, reason, details: details.trim() }
    const fingerprint = JSON.stringify(input)
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: newIdempotencyKey() }
    const requestSelection = selection.current
    pending.current = true
    setBusy(true); onBusyChange?.(true); setError(""); setResult(null)
    try {
      const saved = await onGrant({ ...input, idempotencyKey: attempt.current.key })
      if (requestSelection !== selection.current) return
      setResult(saved); setAmount(""); setReason(""); setDetails(""); attempt.current = null
    } catch {
      if (requestSelection === selection.current) setError("积分操作失败，当前表单已保留，可安全重试。")
    } finally {
      pending.current = false
      setBusy(false); onBusyChange?.(false)
    }
  }

  return <section className="points-workspace" aria-labelledby="points-workspace-title">
    <header><h2 id="points-workspace-title">积分操作</h2><p>调整用户积分余额，不影响 EXP 或成长等级。</p></header>
    {selectedUser ? <>
      <AdminUserSummaryCard user={selectedUser} balance={balance} balanceLoading={balanceLoading} />
      {balanceError && <div className="membership-feedback"><p className="form-alert" role="alert">{balanceError}</p><button type="button" className="secondary-button" onClick={onRetryBalance} disabled={balanceLoading || busy}>重新读取余额</button></div>}
      <form className="admin-form points-form" onSubmit={event => void submit(event)}>
        <div className="membership-fields">
          <label>操作类型<select aria-label="操作类型" value={direction} disabled={busy} onChange={event => { setDirection(event.target.value); setError("") }}><option value="add">增加积分</option><option value="deduct">扣减积分</option></select></label>
          <label>积分数量<input type="number" aria-label="积分数量" min={1} max={Number.MAX_SAFE_INTEGER} step={1} value={amount} disabled={busy} onChange={event => { setAmount(event.target.value); setError("") }} /><small>填写正整数，增减方向由操作类型决定。</small></label>
        </div>
        <AdminReasonField reason={reason} details={details} disabled={busy} onReasonChange={setReason} onDetailsChange={setDetails} />
        <section className="points-preview" aria-label="积分变更预览" aria-live="polite">
          <strong>{selectedUser.displayName} @{selectedUser.username}</strong>
          <dl><div><dt>当前余额</dt><dd>{balance === null ? "—" : balance.toLocaleString()}</dd></div><div><dt>本次变更</dt><dd>{validQuantity ? (delta > 0 ? "+" : "") + delta.toLocaleString() : "—"}</dd></div><div><dt>预计余额</dt><dd>{projected === null || !Number.isSafeInteger(projected) ? "—" : projected.toLocaleString()}</dd></div></dl>
          <small>实际余额以提交结果为准。</small>
        </section>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="admin-form__actions"><button className={direction === "deduct" ? "danger-button" : "primary-button"} type="submit" disabled={busy || balance === null || balanceLoading || Boolean(balanceError)}>{busy ? "正在提交" : "确认积分操作"}</button></div>
      </form>
      {result && <MutationResult title="积分操作完成" message={`最新余额 ${result.balance.toLocaleString()}`} auditId={result.auditId} replayed={result.replayed} />}
    </> : <div className="admin-empty"><p>请先搜索并选择用户，再填写积分变更。</p></div>}
  </section>
}

function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === "function" ? `admin-points:${crypto.randomUUID()}` : `admin-points:${Date.now()}:${Math.random().toString(16).slice(2)}`
}
