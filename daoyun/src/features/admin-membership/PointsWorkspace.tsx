import { useEffect, useRef, useState, type FormEvent } from "react"

import { OperationalLedger } from "./OperationalLedger"
import { AdminApiError } from "../../api/admin"

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

interface PointsGrantResult {
  balance: number
  auditId?: string
  replayed?: boolean
  ledgerEntryId?: string | null
  balanceBefore?: number | null
  balanceAfter?: number | null
  requestId?: string
}

interface PointsWorkspaceProps {
  canReadLedger?: boolean
  canWrite?: boolean
  selectedUser: AdminUserCandidate | null
  balance: number | null
  balanceLoading?: boolean
  balanceError?: string
  onRetryBalance?: () => void
  onBusyChange?: (busy: boolean) => void
  onGrant: (input: PointsGrantDraft) => Promise<PointsGrantResult>
}

export function PointsWorkspace({ selectedUser, balance, balanceLoading = false, balanceError = "", canReadLedger = false, canWrite = true, onRetryBalance, onBusyChange, onGrant }: PointsWorkspaceProps) {
  const [amount, setAmount] = useState("")
  const [direction, setDirection] = useState("add")
  const [reason, setReason] = useState("")
  const [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [ledgerRefresh,setLedgerRefresh] = useState(0)
  const [result, setResult] = useState<PointsGrantResult | null>(null)
  useEffect(() => { onBusyChange?.(busy || unconfirmed) }, [busy, unconfirmed, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])
  const pending = useRef(false)
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null)
  const selection = useRef(0)
  useEffect(() => {
    setAmount(""); setReason(""); setDetails(""); setDirection("add"); setError(""); setResult(null); setUnconfirmed(false)
    attempt.current = null
    selection.current += 1
  }, [selectedUser?.id])

  const quantity = Number(amount)
  const delta = direction === "deduct" ? -quantity : quantity
  const validQuantity = Number.isSafeInteger(quantity) && quantity > 0
  const projected = balance !== null && validQuantity ? balance + delta : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canWrite || !selectedUser || pending.current || balance === null || balanceLoading || balanceError) return
    if (!validQuantity || !reason) { setError("请选择运营原因并填写正整数积分。"); return }
    if (!unconfirmed && (projected === null || !Number.isSafeInteger(projected))) { setError("积分数量超出可用范围。"); return }
    if (!unconfirmed && projected !== null && projected < 0) { setError("余额不足，扣减数量不能超过当前余额。"); return }
    const input = { userId: selectedUser.id, amount: delta, reason, details: details.trim() }
    const fingerprint = JSON.stringify(input)
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: newIdempotencyKey() }
    const requestSelection = selection.current
    pending.current = true
    setBusy(true); setError(""); setResult(null)
    try {
      const saved = await onGrant({ ...input, idempotencyKey: attempt.current.key })
      if (requestSelection !== selection.current) return
      setLedgerRefresh(current=>current+1);setResult(saved); setUnconfirmed(false); setAmount(""); setReason(""); setDetails(""); attempt.current = null
    } catch (failure) {
      if (requestSelection === selection.current) {
        const unknown = unconfirmed || !(failure instanceof AdminApiError && failure.status >= 400 && failure.status < 500)
        setUnconfirmed(unknown)
        setError(unknown ? "积分操作结果尚未确认，当前表单与编号已保留，请保持输入不变后重试确认。" : "积分操作未被接受，当前表单已保留，请核对后重试。")
      }
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <section className="points-workspace" aria-labelledby="points-workspace-title">
    <header><h2 id="points-workspace-title">积分操作</h2><p>调整用户积分余额，不影响 EXP 或成长等级。</p></header>
    {selectedUser ? <>
      <AdminUserSummaryCard user={selectedUser} balance={balance} balanceLoading={balanceLoading} />
      {balanceError && <div className="membership-feedback"><p className="form-alert" role="alert">{balanceError}</p><button type="button" className="secondary-button" onClick={onRetryBalance} disabled={balanceLoading || busy}>重新读取余额</button></div>}
      <form className="admin-form points-form" onSubmit={event => void submit(event)}>
        <div className="membership-fields">
          <label>操作类型<select aria-label="操作类型" value={direction} disabled={!canWrite || busy || unconfirmed} onChange={event => { setDirection(event.target.value); setError("") }}><option value="add">增加积分</option><option value="deduct">扣减积分</option></select></label>
          <label>积分数量<input type="number" aria-label="积分数量" min={1} max={Number.MAX_SAFE_INTEGER} step={1} value={amount} disabled={!canWrite || busy || unconfirmed} onChange={event => { setAmount(event.target.value); setError("") }} /><small>填写正整数，增减方向由操作类型决定。</small></label>
        </div>
        <AdminReasonField reason={reason} details={details} disabled={!canWrite || busy || unconfirmed} onReasonChange={setReason} onDetailsChange={setDetails} />
        <section className="points-preview" aria-label="积分变更预览" aria-live="polite">
          <strong>{selectedUser.displayName} @{selectedUser.username}</strong>
          <dl><div><dt>当前余额</dt><dd>{balance === null ? "—" : balance.toLocaleString() + " 积分"}</dd></div><div><dt>本次变更</dt><dd>{validQuantity ? (delta > 0 ? "+" : "") + delta.toLocaleString() + " 积分" : "—"}</dd></div><div><dt>预计余额</dt><dd>{projected === null || !Number.isSafeInteger(projected) ? "—" : projected.toLocaleString() + " 积分"}</dd></div></dl>
          <small>实际余额以提交结果为准。</small>
        </section>
        {error && <p className="form-alert" role="alert">{error}</p>}
        {unconfirmed && attempt.current && <p className="points-attempt">重试编号 <code>{attempt.current.key}</code></p>}
        <div className="admin-form__actions"><button className={direction === "deduct" ? "danger-button" : "primary-button"} type="submit" disabled={!canWrite || busy || balance === null || balanceLoading || Boolean(balanceError)}>{busy ? "正在提交" : "确认积分操作"}</button></div>
      </form>
      {result && <>
        <MutationResult title="积分操作完成" message={"最新余额 " + result.balance.toLocaleString() + " 积分"} auditId={result.auditId} replayed={result.replayed} />
        <dl className="points-receipt" aria-label="积分操作回执">
          {result.balanceBefore != null && result.balanceAfter != null && <div><dt>该笔变更前后</dt><dd>{result.balanceBefore.toLocaleString()} → {result.balanceAfter.toLocaleString()} 积分</dd></div>}
          {result.ledgerEntryId && <div><dt>流水编号</dt><dd><code>{result.ledgerEntryId}</code></dd></div>}
          {result.requestId && <div><dt>本次请求号</dt><dd><code>{result.requestId}</code></dd></div>}
        </dl>
      </>}
      <OperationalLedger key={selectedUser.id} kind="points" userId={selectedUser.id} canRead={canReadLedger} refreshKey={ledgerRefresh}/>
    </> : <div className="admin-empty"><p>请先搜索并选择用户，再填写积分变更。</p></div>}
  </section>
}

function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === "function" ? `admin-points:${crypto.randomUUID()}` : `admin-points:${Date.now()}:${Math.random().toString(16).slice(2)}`
}
