import { Award, Coins, History, LoaderCircle, Plus, RotateCcw, Save, Sparkles, Trophy } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"

import {
  AdminApiError,
  createAdminGrowthLevel,
  getAdminGrowthLevels,
  getMembershipMedalRules,
  grantMembershipMedal,
  grantMembershipPoints,
  listMembershipMedalOperations,
  revokeMembershipMedal,
  updateAdminGrowthLevel,
  updateMembershipMedalRule,
} from "../api/admin"
import type {
  AdminGrowthLevel,
  CreateAdminGrowthLevelInput,
  MembershipMedalGrant,
  MembershipMedalOperation,
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

type GrowthLevelFilter = "published" | "draft" | "inactive" | "all"
type MembershipWorkspace = "growth" | "points" | "medals"
type WorkspaceCapabilities = Pick<MembershipAdminPanelProps, "canReadLevelRules" | "canWriteLevelRules" | "canGrantPoints" | "canReadMedalRules" | "canGrantMedals">

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
  const [workspace, setWorkspace] = useState<MembershipWorkspace>(() => initialWorkspace({ canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canGrantMedals }))
  const [growthLevels, setGrowthLevels] = useState<AdminGrowthLevel[]>([])
  const [growthLoading, setGrowthLoading] = useState(canReadLevelRules)
  const [growthError, setGrowthError] = useState("")
  const [growthMessage, setGrowthMessage] = useState("")
  const [growthFilter, setGrowthFilter] = useState<GrowthLevelFilter>("published")
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
  const [medalOperations, setMedalOperations] = useState<MembershipMedalOperation[]>([])
  const [medalOperationsLoading, setMedalOperationsLoading] = useState(false)
  const [medalOperationsError, setMedalOperationsError] = useState("")
  const [medalOperationsNextCursor, setMedalOperationsNextCursor] = useState<string | null>(null)
  const [medalOperationUserFilter, setMedalOperationUserFilter] = useState("")
  const [medalOperationKeyFilter, setMedalOperationKeyFilter] = useState("")
  const [appliedMedalOperationFilters, setAppliedMedalOperationFilters] = useState({ userId: "", medalKey: "" })
  const [revocationTarget, setRevocationTarget] = useState<MembershipMedalOperation | null>(null)
  const [revocationReason, setRevocationReason] = useState("")
  const [revocationBusy, setRevocationBusy] = useState(false)
  const [revocationMessage, setRevocationMessage] = useState("")
  const medalOperationsRequestId = useRef(0)

  useEffect(() => {
    if (!workspaceAvailable(workspace, { canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canGrantMedals })) {
      setWorkspace(initialWorkspace({ canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canGrantMedals }))
    }
  }, [workspace, canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canGrantMedals])

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

  const loadMedalOperations = useCallback(async ({ cursor, append = false, signal }: { cursor?: string; append?: boolean; signal?: AbortSignal } = {}) => {
    if (!canReadMedalRules) return
    const requestId = medalOperationsRequestId.current + 1
    medalOperationsRequestId.current = requestId
    setMedalOperationsLoading(true)
    setMedalOperationsError("")
    try {
      const result = await listMembershipMedalOperations({
        userId: appliedMedalOperationFilters.userId || undefined,
        medalKey: appliedMedalOperationFilters.medalKey || undefined,
        cursor,
        limit: 25,
        signal,
      })
      if (signal?.aborted || requestId !== medalOperationsRequestId.current) return
      setMedalOperations((current) => append ? [...current, ...result.operations] : result.operations)
      setMedalOperationsNextCursor(result.nextCursor)
    } catch (reason) {
      if (!signal?.aborted && requestId === medalOperationsRequestId.current) setMedalOperationsError(reason instanceof AdminApiError ? reason.message : "勋章操作记录暂时无法加载，请稍后重试。")
    } finally {
      if (!signal?.aborted && requestId === medalOperationsRequestId.current) setMedalOperationsLoading(false)
    }
  }, [appliedMedalOperationFilters, canReadMedalRules])

  useEffect(() => {
    if (workspace !== "medals" || !canReadMedalRules) return
    const controller = new AbortController()
    void loadMedalOperations({ signal: controller.signal })
    return () => controller.abort()
  }, [workspace, canReadMedalRules, loadMedalOperations])

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
      setGrowthFilter("draft")
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
      if (canReadMedalRules) await loadMedalOperations()
    } catch (reason) {
      setMedalError(reason instanceof AdminApiError ? reason.message : "勋章授予失败，请稍后重试。")
    } finally {
      setMedalBusy(false)
    }
  }

  function filterMedalOperations(event: FormEvent) {
    event.preventDefault()
    setAppliedMedalOperationFilters({ userId: medalOperationUserFilter.trim(), medalKey: medalOperationKeyFilter })
  }

  async function confirmMedalRevocation(event: FormEvent) {
    event.preventDefault()
    if (!revocationTarget || !canGrantMedals) return
    const reason = revocationReason.trim()
    if (reason.length < 1 || Array.from(reason).length > 64 || Array.from(reason).some((character) => /\p{Cc}/u.test(character))) {
      setMedalOperationsError("撤销原因必须是 1 到 64 个有效字符。")
      return
    }
    setRevocationBusy(true)
    setMedalOperationsError("")
    setRevocationMessage("")
    try {
      const result = await revokeMembershipMedal({ userId: revocationTarget.userId, medalKey: revocationTarget.medalKey, reason }, csrfToken)
      setRevocationMessage(result.revoked ? "勋章已撤销" : "勋章已不在该用户的持有列表中")
      setRevocationTarget(null)
      setRevocationReason("")
      if (canReadMedalRules) await loadMedalOperations()
    } catch (reason) {
      setMedalOperationsError(reason instanceof AdminApiError ? reason.message : "勋章撤销失败，请稍后重试。")
    } finally {
      setRevocationBusy(false)
    }
  }

  const publishedGrowthLevelCount = growthLevels.filter((level) => level.status === "published").length
  const visibleGrowthLevels = growthLevels.filter((level) => matchesGrowthFilter(level, growthFilter))
  const activeMedalOperationIds = activeMembershipMedalOperationIds(medalOperations)
  const availableWorkspaces = membershipWorkspaces({ canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canGrantMedals })

  function handleWorkspaceKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentWorkspace: MembershipWorkspace) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const currentIndex = availableWorkspaces.indexOf(currentWorkspace)
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? availableWorkspaces.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + availableWorkspaces.length) % availableWorkspaces.length
    const nextWorkspace = availableWorkspaces[nextIndex]
    setWorkspace(nextWorkspace)
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-membership-workspace="${nextWorkspace}"]`)?.focus()
  }

  return (
    <div className="admin-panel membership-admin-panel">
      <div className="admin-panel__heading">
        <div><p>成长、消费与荣誉</p><h2>会员经济</h2></div>
        <span className="admin-badge">已发布 {publishedGrowthLevelCount} / 共 {growthLevels.length}</span>
      </div>
      <p className="admin-panel__description">成长等级由 EXP 决定；积分是可消费账本；勋章和标准权益均不授予后台治理权限。</p>
      <div className="membership-workspace-tabs" role="tablist" aria-label="会员运营工作区">
        {(canReadLevelRules || canWriteLevelRules) && <button id="membership-growth-tab" type="button" role="tab" data-membership-workspace="growth" tabIndex={workspace === "growth" ? 0 : -1} aria-selected={workspace === "growth"} aria-controls="membership-growth-workspace" onKeyDown={(event) => handleWorkspaceKeyDown(event, "growth")} onClick={() => setWorkspace("growth")}><Sparkles size={15} aria-hidden="true" />成长运营</button>}
        {canGrantPoints && <button id="membership-points-tab" type="button" role="tab" data-membership-workspace="points" tabIndex={workspace === "points" ? 0 : -1} aria-selected={workspace === "points"} aria-controls="membership-points-workspace" onKeyDown={(event) => handleWorkspaceKeyDown(event, "points")} onClick={() => setWorkspace("points")}><Coins size={15} aria-hidden="true" />积分运营</button>}
        {(canReadMedalRules || canGrantMedals) && <button id="membership-medals-tab" type="button" role="tab" data-membership-workspace="medals" tabIndex={workspace === "medals" ? 0 : -1} aria-selected={workspace === "medals"} aria-controls="membership-medals-workspace" onKeyDown={(event) => handleWorkspaceKeyDown(event, "medals")} onClick={() => setWorkspace("medals")}><Award size={15} aria-hidden="true" />勋章运营</button>}
      </div>
      <div className="membership-admin-grid membership-admin-grid--workspace">
        {workspace === "growth" && (canReadLevelRules || canWriteLevelRules) && <section id="membership-growth-workspace" role="tabpanel" className="membership-rule-section" aria-labelledby="membership-growth-tab">
          <div className="admin-form__heading membership-section-heading"><div><h3 id="membership-growth-heading">成长等级（EXP）</h3><p>积分变更不会增加 EXP，也不会改变成长等级。</p></div><Sparkles size={18} aria-hidden="true" /></div>
          {!canReadLevelRules ? <div className="admin-empty" role="status"><Sparkles size={20} aria-hidden="true" /><span>当前账号可创建成长等级，但不具备等级目录读取权限。</span></div> : growthLoading ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /><span>正在读取成长等级</span></div> : growthLevels.length === 0 ? <div className="admin-empty" role="status"><Sparkles size={20} aria-hidden="true" /><span>尚未创建成长等级</span></div> : <>
            <label className="membership-list-filter" htmlFor="growth-level-filter"><span>筛选成长等级</span><select id="growth-level-filter" value={growthFilter} onChange={(event) => setGrowthFilter(event.target.value as GrowthLevelFilter)}><option value="published">已发布（前台生效）</option><option value="draft">草稿</option><option value="inactive">已停用与已归档</option><option value="all">全部</option></select></label>
            {visibleGrowthLevels.length === 0 ? <div className="admin-empty" role="status"><Sparkles size={20} aria-hidden="true" /><span>当前筛选条件下没有成长等级</span></div> : <div className="membership-growth-grid">
              {visibleGrowthLevels.map((level) => <GrowthLevelCard key={level.id} level={level} canWrite={canWriteLevelRules} pending={savingGrowthId === level.id} onChange={changeGrowthLevel} onSave={saveGrowthLevel} />)}
            </div>}
          </>}
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

        {workspace === "points" && canGrantPoints && <section id="membership-points-workspace" role="tabpanel" className="membership-grant-section" aria-labelledby="membership-points-tab">
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

        {workspace === "medals" && (canReadMedalRules || canGrantMedals) && <section id="membership-medals-workspace" role="tabpanel" className="membership-grant-section" aria-labelledby="membership-medals-tab">
          <div className="admin-form__heading membership-section-heading"><div><h3 id="membership-medal-heading">勋章</h3><p>勋章是独立的荣誉标识，可按累计积分阈值自动授予或手动发放。</p></div><Award size={18} aria-hidden="true" /></div>
          {canReadMedalRules && <><p className="membership-catalog-note">固定勋章目录：可调整自动授予条件，已发放的勋章保留历史记录。</p><div className="membership-medal-grid">
            {medalRules.map((rule) => {
              const pending = savingMedalKey === rule.key
              return <article className="membership-medal-card" key={rule.key}>
                <header><img src={medalAssetPath(rule.key)} alt={rule.displayName} width="36" height="36" /><div><strong>{rule.displayName}</strong><small>{rule.key}</small></div><span className={rule.enabled ? "membership-status membership-status--published" : "membership-status membership-status--draft"}>{rule.enabled ? "自动授予中" : "未启用"}</span></header>
                <label htmlFor={`medal-threshold-${rule.key}`}><span>累计积分阈值</span><input id={`medal-threshold-${rule.key}`} type="number" min={0} value={rule.requiredLifetimePoints ?? ""} disabled={!canWriteMedalRules || pending} onChange={(event) => setMedalRules((current) => current.map((item) => item.key === rule.key ? { ...item, requiredLifetimePoints: event.target.value === "" ? null : Number(event.target.value) } : item))} /></label>
                <label className="admin-checkbox" htmlFor={`medal-enabled-${rule.key}`}><input id={`medal-enabled-${rule.key}`} type="checkbox" checked={rule.enabled} disabled={!canWriteMedalRules || pending} onChange={(event) => setMedalRules((current) => current.map((item) => item.key === rule.key ? { ...item, enabled: event.target.checked } : item))} /><span>启用自动授予</span></label>
                {canWriteMedalRules ? <button className="secondary-button membership-rule-save" type="button" disabled={pending} onClick={() => void saveMedalRule(rule)}>{pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}保存 {rule.key}</button> : <small>仅具有勋章规则读取权限</small>}
              </article>
            })}
          </div></>}
          {canGrantMedals && (canReadMedalRules ? <form className="admin-form" onSubmit={(event) => void awardMedal(event)}>
            <label htmlFor="membership-medal-user-id"><span>勋章目标用户 UUID</span><input id="membership-medal-user-id" value={medalDraft.userId} onChange={(event) => setMedalDraft({ ...medalDraft, userId: event.target.value })} required /></label>
            <label htmlFor="membership-medal-key"><span>勋章</span><select id="membership-medal-key" value={medalDraft.medalKey} onChange={(event) => setMedalDraft({ ...medalDraft, medalKey: event.target.value })} disabled={medalRules.length === 0}>{medalRules.map((rule) => <option value={rule.key} key={rule.key}>{rule.displayName}</option>)}</select></label>
            <label htmlFor="membership-medal-reason"><span>勋章授予理由</span><input id="membership-medal-reason" value={medalDraft.reason} onChange={(event) => setMedalDraft({ ...medalDraft, reason: event.target.value })} pattern="[a-z][a-z0-9._-]{1,63}" required /></label>
            {medalError && <p className="form-alert" role="alert">{medalError}</p>}
            <button className="primary-button" type="submit" disabled={medalBusy || medalRules.length === 0}><Award size={15} aria-hidden="true" />{medalBusy ? "正在发放" : "手动发放勋章"}</button>
          </form> : <p className="admin-empty" role="status">当前账号无法读取勋章目录，不能安全地手动发放勋章。</p>)}
          {medalResult && <div className="membership-grant-result" role="status"><Award size={18} aria-hidden="true" /><div><strong>{medalResult.created ? `${medalResult.medal.displayName} 已发放` : "幂等重放：勋章已持有"}</strong><span>资源键 {medalResult.medal.key}</span></div></div>}
          {canReadMedalRules && <div className="membership-medal-operations">
            <div className="admin-form__heading membership-section-heading"><div><h4>操作记录</h4><p>发放、自动授予和撤销均保留审计记录。</p></div><History size={17} aria-hidden="true" /></div>
            <form className="membership-operation-filters" onSubmit={filterMedalOperations}>
              <label htmlFor="medal-operation-user"><span>用户 UUID</span><input id="medal-operation-user" value={medalOperationUserFilter} onChange={(event) => setMedalOperationUserFilter(event.target.value)} placeholder="全部用户" /></label>
              <label htmlFor="medal-operation-key"><span>勋章</span><select id="medal-operation-key" value={medalOperationKeyFilter} onChange={(event) => setMedalOperationKeyFilter(event.target.value)}><option value="">全部勋章</option>{medalRules.map((rule) => <option value={rule.key} key={rule.key}>{rule.displayName}</option>)}</select></label>
              <button className="secondary-button" type="submit">筛选记录</button>
            </form>
            {medalOperationsLoading && medalOperations.length === 0 ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={18} aria-hidden="true" /><span>正在读取操作记录</span></div> : medalOperations.length === 0 ? <div className="admin-empty" role="status"><History size={18} aria-hidden="true" /><span>当前条件下没有勋章操作记录</span></div> : <div className="membership-operation-list">
              {medalOperations.map((operation) => <article className="membership-operation-row" key={operation.id}>
                <img src={medalAssetPath(operation.medalKey)} alt="" width="32" height="32" />
                <div className="membership-operation-row__main"><strong>{operation.userDisplayName}</strong><span>@{operation.username} · {operation.medalDisplayName}</span><small>{operation.reason} · {formatOperationTime(operation.createdAt)}</small></div>
                <div className="membership-operation-row__meta"><span className={`membership-status membership-operation-kind--${operation.operation}`}>{medalOperationLabel(operation.operation)}</span><small>操作人 {operation.actorDisplayName}</small></div>
                {canGrantMedals && activeMedalOperationIds.has(operation.id) && <button className="secondary-button" type="button" aria-label={`撤销 ${operation.medalDisplayName}`} onClick={() => { setRevocationTarget(operation); setRevocationReason(""); setRevocationMessage("") }}><RotateCcw size={14} aria-hidden="true" />撤销</button>}
              </article>)}
            </div>}
            {medalOperationsNextCursor && <button className="secondary-button membership-operation-more" type="button" disabled={medalOperationsLoading} onClick={() => void loadMedalOperations({ cursor: medalOperationsNextCursor, append: true })}>{medalOperationsLoading ? "正在加载" : "加载更早记录"}</button>}
            {revocationTarget && <form className="membership-revocation-form" onSubmit={(event) => void confirmMedalRevocation(event)}>
              <div><strong>撤销 {revocationTarget.userDisplayName} 的 {revocationTarget.medalDisplayName}</strong><p>只移除当前持有状态，历史记录不会删除。</p></div>
              <label htmlFor="membership-revocation-reason"><span>撤销原因</span><input id="membership-revocation-reason" value={revocationReason} maxLength={64} onChange={(event) => setRevocationReason(event.target.value)} required /></label>
              <div className="membership-revocation-actions"><button className="secondary-button" type="button" disabled={revocationBusy} onClick={() => setRevocationTarget(null)}>取消</button><button className="danger-button" type="submit" disabled={revocationBusy}>{revocationBusy ? "正在撤销" : "确认撤销"}</button></div>
            </form>}
            {(medalOperationsError || revocationMessage) && <p className={medalOperationsError ? "form-alert" : "admin-success"} role={medalOperationsError ? "alert" : "status"}>{medalOperationsError || revocationMessage}</p>}
          </div>}
        </section>}
      </div>
    </div>
  )
}

function GrowthLevelCard({
  level,
  canWrite,
  pending,
  onChange,
  onSave,
}: {
  level: AdminGrowthLevel
  canWrite: boolean
  pending: boolean
  onChange: (levelId: string, patch: Partial<AdminGrowthLevel>) => void
  onSave: (level: AdminGrowthLevel) => Promise<void>
}) {
  return (
    <article className="membership-growth-card">
      <header>
        <span className="membership-level-mark">Lv {level.levelOrder}</span>
        <div><strong>{level.displayName}</strong><small>{level.internalKey}</small></div>
        <span className={`membership-status membership-status--${level.status}`}>{growthStatusLabel(level.status)}</span>
      </header>
      <dl>
        <div><dt>EXP 阈值</dt><dd>{level.requiredExperience.toLocaleString("zh-CN")}</dd></div>
        <div><dt>主题颜色</dt><dd>{level.color ?? "未设置"}</dd></div>
      </dl>
      <p>{level.description || "未填写等级说明"}</p>
      {canWrite ? <details className="membership-growth-editor">
        <summary>编辑 {level.internalKey}</summary>
        <div className="membership-growth-editor__fields">
          <label htmlFor={`growth-name-${level.id}`}><span>{level.internalKey} 展示名称</span><input id={`growth-name-${level.id}`} value={level.displayName} maxLength={80} disabled={pending} onChange={(event) => onChange(level.id, { displayName: event.target.value })} /></label>
          <label htmlFor={`growth-order-${level.id}`}><span>{level.internalKey} 等级顺序</span><input id={`growth-order-${level.id}`} type="number" min={1} step={1} value={level.levelOrder} disabled={pending} onChange={(event) => onChange(level.id, { levelOrder: Number(event.target.value) })} /></label>
          <label htmlFor={`growth-experience-${level.id}`}><span>{level.internalKey} EXP 阈值</span><input id={`growth-experience-${level.id}`} type="number" min={0} step={1} value={level.requiredExperience} disabled={pending} onChange={(event) => onChange(level.id, { requiredExperience: Number(event.target.value) })} /></label>
          <label htmlFor={`growth-status-${level.id}`}><span>{level.internalKey} 状态</span><select id={`growth-status-${level.id}`} value={level.status} disabled={pending} onChange={(event) => onChange(level.id, { status: event.target.value as AdminGrowthLevel["status"] })}><option value="draft">草稿</option><option value="published">已发布</option><option value="disabled">已停用</option><option value="archived">已归档</option></select></label>
          <label htmlFor={`growth-color-${level.id}`}><span>{level.internalKey} 颜色</span><input id={`growth-color-${level.id}`} value={level.color ?? ""} placeholder="#1f8f5f" maxLength={7} disabled={pending} onChange={(event) => onChange(level.id, { color: event.target.value || null })} /></label>
          <label className="membership-growth-editor__wide" htmlFor={`growth-description-${level.id}`}><span>{level.internalKey} 描述</span><input id={`growth-description-${level.id}`} value={level.description} maxLength={500} disabled={pending} onChange={(event) => onChange(level.id, { description: event.target.value })} /></label>
        </div>
        <button className="secondary-button membership-rule-save" type="button" disabled={pending} onClick={() => void onSave(level)}>{pending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}保存 {level.internalKey}</button>
      </details> : <small>仅具有成长等级读取权限</small>}
    </article>
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

function matchesGrowthFilter(level: AdminGrowthLevel, filter: GrowthLevelFilter): boolean {
  return filter === "all" || level.status === filter || (filter === "inactive" && (level.status === "disabled" || level.status === "archived"))
}

function medalAssetPath(key: string): string {
  return `/assets/membership/medals/medal${Number(key.slice(-2))}.gif`
}

function initialWorkspace(capabilities: WorkspaceCapabilities): MembershipWorkspace {
  if (workspaceAvailable("growth", capabilities)) return "growth"
  if (workspaceAvailable("points", capabilities)) return "points"
  return "medals"
}

function workspaceAvailable(workspace: MembershipWorkspace, capabilities: WorkspaceCapabilities): boolean {
  if (workspace === "growth") return capabilities.canReadLevelRules || capabilities.canWriteLevelRules
  if (workspace === "points") return capabilities.canGrantPoints
  return capabilities.canReadMedalRules || capabilities.canGrantMedals
}

function membershipWorkspaces(capabilities: WorkspaceCapabilities): MembershipWorkspace[] {
  return (["growth", "points", "medals"] as const).filter((workspace) => workspaceAvailable(workspace, capabilities))
}

function activeMembershipMedalOperationIds(operations: MembershipMedalOperation[]): Set<string> {
  const resolved = new Set<string>()
  const active = new Set<string>()
  for (const operation of operations) {
    const ownershipKey = `${operation.userId}:${operation.medalKey}`
    if (resolved.has(ownershipKey)) continue
    resolved.add(ownershipKey)
    if (operation.operation !== "revoke") active.add(operation.id)
  }
  return active
}

function medalOperationLabel(operation: MembershipMedalOperation["operation"]): string {
  return operation === "grant" ? "手工发放" : operation === "automatic_grant" ? "自动授予" : "已撤销"
}

function formatOperationTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
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
