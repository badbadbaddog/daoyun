import { Award, Coins, LoaderCircle, Plus, Save, Sparkles, Trophy } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"

import {
  AdminApiError,
  createAdminGrowthLevel,
  getAdminGrowthLevels,
  getMembershipMedalRules,
  grantMembershipMedal,
  grantMembershipPoints,
  updateAdminGrowthLevel,
  updateMembershipMedalRule,
} from "../api/admin"
import type {
  AdminGrowthLevel,
  CreateAdminGrowthLevelInput,
  MembershipMedalGrant,
  MembershipMedalRule,
  MembershipPointsGrant,
} from "../api/admin"

interface MembershipAdminPanelProps {
  csrfToken: string
  canReadLevelRules: boolean
  canWriteLevelRules: boolean
  canReadMedalRules: boolean
  canWriteMedalRules: boolean
  canGrantPoints: boolean
  canGrantMedals: boolean
}

interface GrantDraft {
  userId: string
  amount: string
  reason: string
  idempotencyKey: string
}

interface MedalDraft {
  userId: string
  medalKey: string
  reason: string
}

interface GrowthLevelDraft {
  internalKey: string
  levelOrder: string
  displayName: string
  requiredExperience: string
  color: string
  description: string
}

const reasonPattern = /^[a-z][a-z0-9._-]{1,63}$/
const growthLevelKeyPattern = /^[a-z][a-z0-9_]{2,63}$/

export function MembershipAdminPanel({
  csrfToken,
  canReadLevelRules,
  canWriteLevelRules,
  canReadMedalRules,
  canWriteMedalRules,
  canGrantPoints,
  canGrantMedals,
}: MembershipAdminPanelProps) {
  const [growthLevels, setGrowthLevels] = useState<AdminGrowthLevel[]>([])
  const [growthLoading, setGrowthLoading] = useState(canReadLevelRules)
  const [growthError, setGrowthError] = useState("")
  const [growthMessage, setGrowthMessage] = useState("")
  const [savingGrowthId, setSavingGrowthId] = useState<string | null>(null)
  const [creatingGrowth, setCreatingGrowth] = useState(false)
  const [growthDraft, setGrowthDraft] = useState<GrowthLevelDraft>(newGrowthLevelDraft)
  const [grantDraft, setGrantDraft] = useState<GrantDraft>(newGrantDraft)
  const [grantBusy, setGrantBusy] = useState(false)
  const [grantError, setGrantError] = useState("")
  const [grantResult, setGrantResult] = useState<MembershipPointsGrant | null>(null)
  const [medalRules, setMedalRules] = useState<MembershipMedalRule[]>([])
  const [medalDraft, setMedalDraft] = useState<MedalDraft>({ userId: "", medalKey: "medal_01", reason: "operator.award" })
  const [medalBusy, setMedalBusy] = useState(false)
  const [savingMedalKey, setSavingMedalKey] = useState<string | null>(null)
  const [medalError, setMedalError] = useState("")
  const [medalResult, setMedalResult] = useState<MembershipMedalGrant | null>(null)

  useEffect(() => {
    if (!canReadLevelRules) {
      setGrowthLevels([])
      setGrowthLoading(false)
      return
    }
    const controller = new AbortController()
    setGrowthLoading(true)
    setGrowthError("")
    getAdminGrowthLevels(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setGrowthLevels(sortGrowthLevels(value))
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setGrowthError(reason instanceof AdminApiError ? reason.message : "成长等级暂时无法加载，请稍后重试。")
      })
      .finally(() => {
        if (!controller.signal.aborted) setGrowthLoading(false)
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
      .then((value) => {
        if (!controller.signal.aborted) {
          setMedalRules(value)
          setMedalDraft((current) => ({ ...current, medalKey: value.some((rule) => rule.key === current.medalKey) ? current.medalKey : (value[0]?.key ?? "medal_01") }))
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setMedalRules([])
      })
    return () => controller.abort()
  }, [canReadMedalRules])

  function changeGrowthLevel(levelId: string, patch: Partial<AdminGrowthLevel>) {
    setGrowthLevels((current) => current.map((level) => level.id === levelId ? { ...level, ...patch } : level))
    setGrowthMessage("")
    setGrowthError("")
  }

  async function saveGrowthLevel(level: AdminGrowthLevel) {
    if (!canWriteLevelRules) return
    setSavingGrowthId(level.id)
    setGrowthError("")
    setGrowthMessage("")
    try {
      const saved = await updateAdminGrowthLevel(level.id, {
        expectedRevision: level.revision,
        levelOrder: level.levelOrder,
        displayName: level.displayName,
        requiredExperience: level.requiredExperience,
        iconAssetId: level.iconAssetId,
        color: level.color,
        description: level.description,
        status: level.status,
      }, csrfToken)
      setGrowthLevels((current) => sortGrowthLevels(current.map((item) => item.id === saved.id ? saved : item)))
      setGrowthMessage(`${saved.internalKey} 已保存`)
    } catch (reason) {
      setGrowthError(reason instanceof AdminApiError ? reason.message : "成长等级保存失败，请稍后重试。")
    } finally {
      setSavingGrowthId(null)
    }
  }

  async function createGrowthLevel(event: FormEvent) {
    event.preventDefault()
    if (!canWriteLevelRules) return
    setGrowthError("")
    setGrowthMessage("")
    const input = toGrowthLevelInput(growthDraft)
    if (!input) {
      setGrowthError("请填写合法的内部键、等级顺序、名称和 EXP 阈值。")
      return
    }
    setCreatingGrowth(true)
    try {
      const saved = await createAdminGrowthLevel(input, csrfToken)
      setGrowthLevels((current) => sortGrowthLevels([...current, saved]))
      setGrowthDraft(newGrowthLevelDraft())
      setGrowthMessage(`${saved.internalKey} 草稿已创建`)
    } catch (reason) {
      setGrowthError(reason instanceof AdminApiError ? reason.message : "成长等级创建失败，请稍后重试。")
    } finally {
      setCreatingGrowth(false)
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
    if (!canWriteMedalRules) return
    setSavingMedalKey(rule.key)
    setMedalError("")
    try {
      const saved = await updateMembershipMedalRule(rule.key, { enabled: rule.enabled, requiredLifetimePoints: rule.requiredLifetimePoints }, csrfToken)
      setMedalRules((current) => current.map((item) => item.key === saved.key ? saved : item))
    } catch (reason) {
      setMedalError(reason instanceof AdminApiError ? reason.message : "勋章规则保存失败，请稍后重试。")
    } finally {
      setSavingMedalKey(null)
    }
  }

  async function awardMedal(event: FormEvent) {
    event.preventDefault()
    setMedalError("")
    setMedalResult(null)
    const userId = medalDraft.userId.trim()
    if (!userId) {
      setMedalError("请输入勋章目标用户 UUID。")
      return
    }
    if (!reasonPattern.test(medalDraft.reason.trim())) {
      setMedalError("授予理由格式无效。")
      return
    }
    setMedalBusy(true)
    try {
      const result = await grantMembershipMedal({ userId, medalKey: medalDraft.medalKey, reason: medalDraft.reason.trim() }, csrfToken)
      setMedalResult(result)
    } catch (reason) {
      setMedalError(reason instanceof AdminApiError ? reason.message : "勋章授予失败，请稍后重试。")
    } finally {
      setMedalBusy(false)
    }
  }

  const publishedGrowthLevelCount = growthLevels.filter((level) => level.status === "published").length

  return (
    <div className="admin-panel membership-admin-panel">
      <div className="admin-panel__heading">
        <div><p>成长、消费与荣誉</p><h2>会员经济</h2></div>
        <span className="admin-badge">{publishedGrowthLevelCount} 个已发布成长等级</span>
      </div>
      <p className="admin-panel__description">成长等级由 EXP 决定；积分是可消费账本；勋章和标准权益均不授予后台治理权限。</p>
      <div className="membership-admin-grid">
        {(canReadLevelRules || canWriteLevelRules) && <section className="membership-rule-section" aria-labelledby="membership-growth-heading">
          <div className="admin-form__heading"><div><h3 id="membership-growth-heading">成长等级（EXP）</h3><p>积分变更不会增加 EXP，也不会改变成长等级。</p></div><Sparkles size={18} aria-hidden="true" /></div>
          {!canReadLevelRules ? <div className="admin-empty" role="status"><Sparkles size={20} aria-hidden="true" /><span>当前账号可创建成长等级，但不具备等级目录读取权限。</span></div> : growthLoading ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /><span>正在读取成长等级</span></div> : growthLevels.length === 0 ? <div className="admin-empty" role="status"><Sparkles size={20} aria-hidden="true" /><span>尚未创建成长等级</span></div> : <div className="membership-rule-list">
            {growthLevels.map((level) => {
              const pending = savingGrowthId === level.id
              return <article className="membership-rule-row" key={level.id}>
                <div className="membership-rule-row__identity"><span className="membership-level-mark">{level.levelOrder}</span><strong>{level.internalKey}</strong><small>{growthStatusLabel(level.status)}</small></div>
                <label htmlFor={`growth-name-${level.id}`}><span>{level.internalKey} 展示名称</span><input id={`growth-name-${level.id}`} value={level.displayName} maxLength={80} disabled={!canWriteLevelRules || pending} onChange={(event) => changeGrowthLevel(level.id, { displayName: event.target.value })} /></label>
                <label htmlFor={`growth-order-${level.id}`}><span>{level.internalKey} 等级顺序</span><input id={`growth-order-${level.id}`} type="number" min={1} step={1} value={level.levelOrder} disabled={!canWriteLevelRules || pending} onChange={(event) => changeGrowthLevel(level.id, { levelOrder: Number(event.target.value) })} /></label>
                <label htmlFor={`growth-experience-${level.id}`}><span>{level.internalKey} EXP 阈值</span><input id={`growth-experience-${level.id}`} type="number" min={0} step={1} value={level.requiredExperience} disabled={!canWriteLevelRules || pending} onChange={(event) => changeGrowthLevel(level.id, { requiredExperience: Number(event.target.value) })} /></label>
                <label htmlFor={`growth-status-${level.id}`}><span>{level.internalKey} 状态</span><select id={`growth-status-${level.id}`} value={level.status} disabled={!canWriteLevelRules || pending} onChange={(event) => changeGrowthLevel(level.id, { status: event.target.value as AdminGrowthLevel["status"] })}><option value="draft">草稿</option><option value="published">已发布</option><option value="disabled">已停用</option><option value="archived">已归档</option></select></label>
                <label htmlFor={`growth-color-${level.id}`}><span>{level.internalKey} 颜色</span><input id={`growth-color-${level.id}`} value={level.color ?? ""} placeholder="#1f8f5f" maxLength={7} disabled={!canWriteLevelRules || pending} onChange={(event) => changeGrowthLevel(level.id, { color: event.target.value || null })} /></label>
                <label htmlFor={`growth-description-${level.id}`}><span>{level.internalKey} 描述</span><input id={`growth-description-${level.id}`} value={level.description} maxLength={500} disabled={!canWriteLevelRules || pending} onChange={(event) => changeGrowthLevel(level.id, { description: event.target.value })} /></label>
                {canWriteLevelRules ? <button className="secondary-button membership-rule-save" type="button" disabled={pending} onClick={() => void saveGrowthLevel(level)}>{pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}保存 {level.internalKey}</button> : <small>仅具有成长等级读取权限</small>}
              </article>
            })}
          </div>}
          {canWriteLevelRules && <form className="admin-form" onSubmit={(event) => void createGrowthLevel(event)}>
            <div className="admin-form__heading"><h4>新建草稿等级</h4><Plus size={16} aria-hidden="true" /></div>
            <div className="admin-form__grid">
              <label htmlFor="new-growth-key"><span>内部键</span><input id="new-growth-key" value={growthDraft.internalKey} maxLength={64} placeholder="traveler" onChange={(event) => setGrowthDraft({ ...growthDraft, internalKey: event.target.value })} required /></label>
              <label htmlFor="new-growth-order"><span>等级顺序</span><input id="new-growth-order" type="number" min={1} step={1} value={growthDraft.levelOrder} onChange={(event) => setGrowthDraft({ ...growthDraft, levelOrder: event.target.value })} required /></label>
              <label htmlFor="new-growth-name"><span>展示名称</span><input id="new-growth-name" value={growthDraft.displayName} maxLength={80} onChange={(event) => setGrowthDraft({ ...growthDraft, displayName: event.target.value })} required /></label>
              <label htmlFor="new-growth-experience"><span>EXP 阈值</span><input id="new-growth-experience" type="number" min={0} step={1} value={growthDraft.requiredExperience} onChange={(event) => setGrowthDraft({ ...growthDraft, requiredExperience: event.target.value })} required /></label>
            </div>
            <div className="admin-form__grid">
              <label htmlFor="new-growth-color"><span>颜色（可选）</span><input id="new-growth-color" value={growthDraft.color} placeholder="#1f8f5f" maxLength={7} onChange={(event) => setGrowthDraft({ ...growthDraft, color: event.target.value })} /></label>
              <label htmlFor="new-growth-description"><span>描述</span><input id="new-growth-description" value={growthDraft.description} maxLength={500} onChange={(event) => setGrowthDraft({ ...growthDraft, description: event.target.value })} /></label>
            </div>
            <button className="secondary-button" type="submit" disabled={creatingGrowth}>{creatingGrowth ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}新建草稿等级</button>
          </form>}
          {(growthError || growthMessage) && <p className={growthError ? "form-alert" : "admin-success"} role={growthError ? "alert" : "status"}>{growthError || growthMessage}</p>}
        </section>}

        {canGrantPoints && <section className="membership-grant-section" aria-labelledby="membership-points-heading">
          <div className="admin-form__heading"><div><h3 id="membership-points-heading">积分账本</h3><p>积分用于消费和运营奖励，不会改变 EXP 或成长等级。</p></div><Coins size={18} aria-hidden="true" /></div>
          <form className="admin-form" onSubmit={(event) => void grantPoints(event)}>
            <label htmlFor="membership-user-id"><span>目标用户 UUID</span><input id="membership-user-id" value={grantDraft.userId} onChange={(event) => setGrantDraft({ ...grantDraft, userId: event.target.value })} required /></label>
            <label htmlFor="membership-amount"><span>积分数量</span><input id="membership-amount" type="number" min={1} max={1_000_000} step={1} value={grantDraft.amount} onChange={(event) => setGrantDraft({ ...grantDraft, amount: event.target.value })} required /></label>
            <label htmlFor="membership-reason"><span>授予理由</span><input id="membership-reason" value={grantDraft.reason} onChange={(event) => setGrantDraft({ ...grantDraft, reason: event.target.value })} placeholder="campaign.reward" pattern="[a-z][a-z0-9._-]{1,63}" required /></label>
            {grantError && <p className="form-alert" role="alert">{grantError}</p>}
            <button className="primary-button" type="submit" disabled={grantBusy}>{grantBusy ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Coins size={15} aria-hidden="true" />}授予积分</button>
          </form>
          {grantResult && <GrantResult result={grantResult} />}
        </section>}

        {(canReadMedalRules || canGrantMedals) && <section className="membership-grant-section" aria-labelledby="membership-medal-heading">
          <div className="admin-form__heading"><div><h3 id="membership-medal-heading">勋章</h3><p>勋章是独立的荣誉标识，可按累计积分阈值自动授予或手动发放。</p></div><Award size={18} aria-hidden="true" /></div>
          {canReadMedalRules && <div className="membership-rule-list">
            {medalRules.map((rule) => {
              const pending = savingMedalKey === rule.key
              return <article className="membership-rule-row" key={rule.key}>
                <div className="membership-rule-row__identity"><span className="membership-level-mark">{rule.key.slice(-2)}</span><strong>{rule.displayName}</strong></div>
                <label htmlFor={`medal-threshold-${rule.key}`}><span>累计积分阈值</span><input id={`medal-threshold-${rule.key}`} type="number" min={0} value={rule.requiredLifetimePoints ?? ""} disabled={!canWriteMedalRules || pending} onChange={(event) => setMedalRules((current) => current.map((item) => item.key === rule.key ? { ...item, requiredLifetimePoints: event.target.value === "" ? null : Number(event.target.value) } : item))} /></label>
                <label className="admin-checkbox" htmlFor={`medal-enabled-${rule.key}`}><input id={`medal-enabled-${rule.key}`} type="checkbox" checked={rule.enabled} disabled={!canWriteMedalRules || pending} onChange={(event) => setMedalRules((current) => current.map((item) => item.key === rule.key ? { ...item, enabled: event.target.checked } : item))} /><span>启用自动授予</span></label>
                {canWriteMedalRules ? <button className="secondary-button membership-rule-save" type="button" disabled={pending} onClick={() => void saveMedalRule(rule)}>{pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}保存 {rule.key}</button> : <small>仅具有勋章规则读取权限</small>}
              </article>
            })}
          </div>}
          {canGrantMedals && (canReadMedalRules ? <form className="admin-form" onSubmit={(event) => void awardMedal(event)}>
            <label htmlFor="membership-medal-user-id"><span>勋章目标用户 UUID</span><input id="membership-medal-user-id" value={medalDraft.userId} onChange={(event) => setMedalDraft({ ...medalDraft, userId: event.target.value })} required /></label>
            <label htmlFor="membership-medal-key"><span>勋章</span><select id="membership-medal-key" value={medalDraft.medalKey} onChange={(event) => setMedalDraft({ ...medalDraft, medalKey: event.target.value })} disabled={medalRules.length === 0}>{medalRules.map((rule) => <option value={rule.key} key={rule.key}>{rule.displayName}</option>)}</select></label>
            <label htmlFor="membership-medal-reason"><span>勋章授予理由</span><input id="membership-medal-reason" value={medalDraft.reason} onChange={(event) => setMedalDraft({ ...medalDraft, reason: event.target.value })} pattern="[a-z][a-z0-9._-]{1,63}" required /></label>
            {medalError && <p className="form-alert" role="alert">{medalError}</p>}
            <button className="primary-button" type="submit" disabled={medalBusy || medalRules.length === 0}><Award size={15} aria-hidden="true" />{medalBusy ? "正在发放" : "手动发放勋章"}</button>
          </form> : <p className="admin-empty" role="status">当前账号无法读取勋章目录，不能安全地手动发放勋章。</p>)}
          {medalResult && <div className="membership-grant-result" role="status"><Award size={18} aria-hidden="true" /><div><strong>{medalResult.created ? `${medalResult.medal.displayName} 已发放` : "幂等重放：勋章已持有"}</strong><span>资源键 {medalResult.medal.key}</span></div></div>}
        </section>}

        <section className="membership-grant-section" aria-labelledby="membership-entitlements-heading">
          <div className="admin-form__heading"><div><h3 id="membership-entitlements-heading">标准权益</h3><p>VIP、套餐和兑换码属于独立的权益模型，通常由支付或业务插件发放。</p></div><Trophy size={18} aria-hidden="true" /></div>
          <p>权益可以带来内容访问、配额或展示特权，但不会转换为角色与权限中的后台访问能力。本页尚未接入安全的权益目录和发放记录查询，因此不显示会误导运营人员的操作按钮。</p>
        </section>
      </div>
    </div>
  )
}

function GrantResult({ result }: { result: MembershipPointsGrant }) {
  return (
    <div className="membership-grant-result" role="status">
      <Trophy size={18} aria-hidden="true" />
      <div><strong>{result.created ? "积分已记入账本" : "幂等重放：未重复记账"}</strong><span>累计积分 {result.account.lifetimePoints.toLocaleString("zh-CN")} · 余额 {result.account.pointsBalance.toLocaleString("zh-CN")}</span></div>
    </div>
  )
}

function toGrowthLevelInput(draft: GrowthLevelDraft): CreateAdminGrowthLevelInput | null {
  const internalKey = draft.internalKey.trim()
  const displayName = draft.displayName.trim()
  const levelOrder = Number(draft.levelOrder)
  const requiredExperience = Number(draft.requiredExperience)
  const color = draft.color.trim()
  if (!growthLevelKeyPattern.test(internalKey) || !displayName || !Number.isSafeInteger(levelOrder) || levelOrder < 1 || !Number.isSafeInteger(requiredExperience) || requiredExperience < 0 || (color && !/^#[0-9a-f]{6}$/i.test(color))) return null
  return { internalKey, levelOrder, displayName, requiredExperience, iconAssetId: null, color: color || null, description: draft.description }
}

function sortGrowthLevels(levels: AdminGrowthLevel[]): AdminGrowthLevel[] {
  return [...levels].sort((left, right) => left.levelOrder - right.levelOrder || left.internalKey.localeCompare(right.internalKey))
}

function growthStatusLabel(status: AdminGrowthLevel["status"]): string {
  return status === "published" ? "已发布" : status === "disabled" ? "已停用" : status === "archived" ? "已归档" : "草稿"
}

function newGrowthLevelDraft(): GrowthLevelDraft {
  return { internalKey: "", levelOrder: "", displayName: "", requiredExperience: "", color: "", description: "" }
}

function newGrantDraft(): GrantDraft {
  return { userId: "", amount: "", reason: "", idempotencyKey: newIdempotencyKey() }
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `membership-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
