import { Award, Coins, LoaderCircle, Save, Sparkles, Trophy } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"

import {
  AdminApiError,
  getMembershipLevelRules,
  getMembershipMedalRules,
  grantMembershipMedal,
  grantMembershipPoints,
  updateMembershipMedalRule,
  updateMembershipLevelRule,
} from "../api/admin"
import type { MembershipLevelRule, MembershipMedalGrant, MembershipMedalRule, MembershipPointsGrant } from "../api/admin"

interface MembershipAdminPanelProps {
  csrfToken: string
  canReadLevelRules: boolean
  canReadMedalRules: boolean
  canGrantPoints: boolean
  canGrantMedals: boolean
}

interface GrantDraft {
  userId: string
  amount: string
  reason: string
  idempotencyKey: string
}

interface MedalDraft { userId: string; medalKey: string; reason: string }

const reasonPattern = /^[a-z][a-z0-9._-]{1,63}$/

export function MembershipAdminPanel({ csrfToken, canReadLevelRules, canReadMedalRules, canGrantPoints, canGrantMedals }: MembershipAdminPanelProps) {
  const [rules, setRules] = useState<MembershipLevelRule[]>([])
  const [loading, setLoading] = useState(canReadLevelRules)
  const [error, setError] = useState("")
  const [savingRule, setSavingRule] = useState<string | null>(null)
  const [ruleMessage, setRuleMessage] = useState("")
  const [grantDraft, setGrantDraft] = useState<GrantDraft>(() => newGrantDraft())
  const [grantBusy, setGrantBusy] = useState(false)
  const [grantError, setGrantError] = useState("")
  const [grantResult, setGrantResult] = useState<MembershipPointsGrant | null>(null)
  const [medalRules, setMedalRules] = useState<MembershipMedalRule[]>([])
  const [medalDraft, setMedalDraft] = useState<MedalDraft>({ userId: "", medalKey: "medal_01", reason: "operator.award" })
  const [medalBusy, setMedalBusy] = useState(false)
  const [medalError, setMedalError] = useState("")
  const [medalResult, setMedalResult] = useState<MembershipMedalGrant | null>(null)

  useEffect(() => {
    if (!canReadLevelRules) {
      setRules([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError("")
    getMembershipLevelRules(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setRules(value)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof AdminApiError ? reason.message : "会员等级规则暂时无法加载，请稍后重试。")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [canReadLevelRules])

  useEffect(() => {
    if (!canReadMedalRules) {
      setMedalRules([])
      return
    }
    const controller = new AbortController()
    getMembershipMedalRules(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setMedalRules(value) })
      .catch(() => { if (!controller.signal.aborted) setMedalRules([]) })
    return () => controller.abort()
  }, [canReadMedalRules])

  function changeRule(levelKey: string, patch: Partial<MembershipLevelRule>) {
    setRules((current) => current.map((rule) => rule.levelKey === levelKey ? { ...rule, ...patch } : rule))
    setRuleMessage("")
  }

  async function saveRule(rule: MembershipLevelRule) {
    setSavingRule(rule.levelKey)
    setError("")
    setRuleMessage("")
    try {
      const saved = await updateMembershipLevelRule(rule.levelKey, {
        requiredLifetimePoints: rule.requiredLifetimePoints,
        enabled: rule.enabled,
        displayName: rule.levelDisplayName,
      }, csrfToken)
      setRules((current) => current.map((item) => item.levelKey === saved.levelKey ? saved : item))
      setRuleMessage(`${saved.levelKey} 规则已保存`)
    } catch (reason) {
      setError(reason instanceof AdminApiError ? reason.message : "会员等级规则保存失败，请稍后重试。")
    } finally {
      setSavingRule(null)
    }
  }

  async function grantPoints(event: FormEvent) {
    event.preventDefault()
    setGrantError("")
    setGrantResult(null)
    const amount = Number(grantDraft.amount)
    const reason = grantDraft.reason.trim()
    const userId = grantDraft.userId.trim()
    if (!userId) {
      setGrantError("请输入目标用户 UUID。")
      return
    }
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
      setGrantError("授予积分必须是 1 到 1000000 的整数。")
      return
    }
    if (!reasonPattern.test(reason)) {
      setGrantError("授予理由需使用 2–64 位小写字母、数字、点、下划线或连字符。")
      return
    }
    setGrantBusy(true)
    try {
      const result = await grantMembershipPoints({ userId, amount, reason, idempotencyKey: grantDraft.idempotencyKey }, csrfToken)
      setGrantResult(result)
      if (result.created) setGrantDraft((current) => ({ ...current, amount: "", reason: "", idempotencyKey: newIdempotencyKey() }))
    } catch (caught) {
      setGrantError(caught instanceof AdminApiError ? caught.message : "积分授予失败，请稍后重试。")
    } finally {
      setGrantBusy(false)
    }
  }

  async function saveMedalRule(rule: MembershipMedalRule) {
    setMedalError("")
    try {
      const saved = await updateMembershipMedalRule(rule.key, { enabled: rule.enabled, requiredLifetimePoints: rule.requiredLifetimePoints }, csrfToken)
      setMedalRules((current) => current.map((item) => item.key === saved.key ? saved : item))
    } catch (reason) { setMedalError(reason instanceof AdminApiError ? reason.message : "勋章规则保存失败，请稍后重试。") }
  }

  async function awardMedal(event: FormEvent) {
    event.preventDefault()
    setMedalError(""); setMedalResult(null)
    const userId = medalDraft.userId.trim()
    if (!userId) { setMedalError("请输入勋章目标用户 UUID。"); return }
    if (!reasonPattern.test(medalDraft.reason.trim())) { setMedalError("授予理由格式无效。"); return }
    setMedalBusy(true)
    try {
      const result = await grantMembershipMedal({ userId, medalKey: medalDraft.medalKey, reason: medalDraft.reason.trim() }, csrfToken)
      setMedalResult(result)
    } catch (reason) { setMedalError(reason instanceof AdminApiError ? reason.message : "勋章授予失败，请稍后重试。") }
    finally { setMedalBusy(false) }
  }

  if (loading) return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" /><span>正在读取会员等级规则</span></div>
  if (error && rules.length === 0 && !canGrantPoints && !canReadMedalRules) return <div className="admin-state" role="alert"><Trophy size={22} aria-hidden="true" /><h2>会员经济暂时不可用</h2><p>{error}</p></div>

  return (
    <div className="admin-panel membership-admin-panel">
      <div className="admin-panel__heading">
        <div><p>积分与成长</p><h2>会员经济</h2></div>
        <span className="admin-badge">{rules.filter((rule) => rule.enabled).length} 个启用等级</span>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="membership-admin-grid">
        {canReadLevelRules && <section className="membership-rule-section" aria-labelledby="membership-rules-heading">
          <div className="admin-form__heading"><h3 id="membership-rules-heading">等级规则</h3><Sparkles size={18} aria-hidden="true" /></div>
          <div className="membership-rule-list">
            {rules.map((rule) => {
              const pending = savingRule === rule.levelKey
              return (
                <article className="membership-rule-row" key={rule.levelKey}>
                  <div className="membership-rule-row__identity"><span className="membership-level-mark">{rule.levelKey}</span><strong>{rule.levelDisplayName}</strong></div>
                  <label htmlFor={`membership-name-${rule.levelKey}`}><span>{rule.levelKey} 展示名称</span><input id={`membership-name-${rule.levelKey}`} value={rule.levelDisplayName} maxLength={80} disabled={pending} onChange={(event) => changeRule(rule.levelKey, { levelDisplayName: event.target.value })} /></label>
                  <label htmlFor={`membership-threshold-${rule.levelKey}`}><span>{rule.levelKey} 累计积分阈值</span><input id={`membership-threshold-${rule.levelKey}`} type="number" min={0} step={1} value={rule.requiredLifetimePoints} disabled={pending || rule.levelNumber === 1} onChange={(event) => changeRule(rule.levelKey, { requiredLifetimePoints: Number(event.target.value) })} /></label>
                  <label className="admin-checkbox" htmlFor={`membership-enabled-${rule.levelKey}`}><input id={`membership-enabled-${rule.levelKey}`} type="checkbox" checked={rule.enabled} disabled={true} onChange={() => undefined} /><span>已开放 {rule.levelKey}</span></label>
                  <button className="secondary-button membership-rule-save" type="button" disabled={pending} onClick={() => void saveRule(rule)}>{pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}保存 {rule.levelKey} 规则</button>
                </article>
              )
            })}
          </div>
          {ruleMessage && <p className="admin-success" role="status">{ruleMessage}</p>}
        </section>}

        {canGrantPoints && <section className="membership-grant-section" aria-labelledby="membership-grant-heading">
          <div className="admin-form__heading"><h3 id="membership-grant-heading">授予积分</h3><Coins size={18} aria-hidden="true" /></div>
          <form className="admin-form" onSubmit={(event) => void grantPoints(event)}>
            <label htmlFor="membership-user-id"><span>目标用户 UUID</span><input id="membership-user-id" value={grantDraft.userId} onChange={(event) => setGrantDraft({ ...grantDraft, userId: event.target.value })} required /></label>
            <label htmlFor="membership-amount"><span>积分数量</span><input id="membership-amount" type="number" min={1} max={1_000_000} step={1} value={grantDraft.amount} onChange={(event) => setGrantDraft({ ...grantDraft, amount: event.target.value })} required /></label>
            <label htmlFor="membership-reason"><span>授予理由</span><input id="membership-reason" value={grantDraft.reason} onChange={(event) => setGrantDraft({ ...grantDraft, reason: event.target.value })} placeholder="campaign.reward" pattern="[a-z][a-z0-9._-]{1,63}" required /></label>
            {grantError && <p className="form-alert" role="alert">{grantError}</p>}
            <button className="primary-button" type="submit" disabled={grantBusy}>{grantBusy ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Coins size={15} aria-hidden="true" />}授予积分</button>
          </form>
          {grantResult && <GrantResult result={grantResult} />}
        </section>}
        {canReadMedalRules && <section className="membership-grant-section" aria-labelledby="membership-medal-heading">
          <div className="admin-form__heading"><h3 id="membership-medal-heading">勋章运营</h3><Award size={18} aria-hidden="true" /></div>
          <div className="membership-rule-list">
            {medalRules.map((rule) => <article className="membership-rule-row" key={rule.key}>
              <div className="membership-rule-row__identity"><span className="membership-level-mark">{rule.key.slice(-2)}</span><strong>{rule.displayName}</strong></div>
              <label><span>累计积分阈值</span><input type="number" min={0} value={rule.requiredLifetimePoints ?? ""} onChange={(event) => setMedalRules((current) => current.map((item) => item.key === rule.key ? { ...item, requiredLifetimePoints: event.target.value === "" ? null : Number(event.target.value) } : item))} /></label>
              <label className="admin-checkbox"><input type="checkbox" checked={rule.enabled} onChange={(event) => setMedalRules((current) => current.map((item) => item.key === rule.key ? { ...item, enabled: event.target.checked } : item))} /><span>启用自动授予</span></label>
              <button className="secondary-button membership-rule-save" type="button" onClick={() => void saveMedalRule(rule)}><Save size={14} aria-hidden="true" />保存 {rule.key}</button>
            </article>)}
          </div>
          {canGrantMedals && <form className="admin-form" onSubmit={(event) => void awardMedal(event)}>
            <label><span>勋章目标用户 UUID</span><input value={medalDraft.userId} onChange={(event) => setMedalDraft({ ...medalDraft, userId: event.target.value })} required /></label>
            <label><span>勋章</span><select value={medalDraft.medalKey} onChange={(event) => setMedalDraft({ ...medalDraft, medalKey: event.target.value })}>{medalRules.map((rule) => <option value={rule.key} key={rule.key}>{rule.displayName}</option>)}</select></label>
            <label><span>勋章授予理由</span><input value={medalDraft.reason} onChange={(event) => setMedalDraft({ ...medalDraft, reason: event.target.value })} pattern="[a-z][a-z0-9._-]{1,63}" required /></label>
            {medalError && <p className="form-alert" role="alert">{medalError}</p>}
            <button className="primary-button" type="submit" disabled={medalBusy}><Award size={15} aria-hidden="true" />{medalBusy ? "正在发放" : "手动发放勋章"}</button>
          </form>}
          {medalResult && <div className="membership-grant-result" role="status"><Award size={18} aria-hidden="true" /><div><strong>{medalResult.created ? `${medalResult.medal.displayName} 已发放` : "幂等重放：勋章已持有"}</strong><span>资源键 {medalResult.medal.key}</span></div></div>}
        </section>}
      </div>
    </div>
  )
}

function GrantResult({ result }: { result: MembershipPointsGrant }) {
  return (
    <div className="membership-grant-result" role="status">
      <Trophy size={18} aria-hidden="true" />
      <div><strong>{result.created ? `已升级至 ${result.account.levelDisplayName}` : "幂等重放：未重复记账"}</strong><span>累计积分 {result.account.lifetimePoints.toLocaleString("zh-CN")} · 余额 {result.account.pointsBalance.toLocaleString("zh-CN")}</span></div>
    </div>
  )
}

function newGrantDraft(): GrantDraft {
  return { userId: "", amount: "", reason: "", idempotencyKey: newIdempotencyKey() }
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `membership-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
