import { Award, Coins, History, LoaderCircle, Pencil, Plus, RotateCcw, Sparkles, Trash2, UsersRound } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"

import {
  AdminApiError,
  createAdminGrowthLevel,
  deleteAdminGrowthLevel,
  getAdminGrowthLevels,
  getAdminMembershipAccount,
  getMembershipMedalRules,
  grantMembershipMedal,
  grantMembershipPoints,
  listMembershipMedalOperations,
  revokeMembershipMedal,
  updateAdminGrowthLevel,
} from "../api/admin"
import type {
  AdminGrowthLevel,
  CreateAdminGrowthLevelInput,
  MembershipMedalGrant,
  MembershipMedalOperation,
  MembershipMedalRule,
} from "../api/admin"
import { listUsers } from "../api/users"
import { AdminUserPicker } from "./admin/AdminUserPicker"
import type { AdminUserCandidate } from "./admin/AdminUserPicker"
import { RedemptionWorkspace } from "../features/admin-membership/RedemptionWorkspace"
import { PointsWorkspace } from "../features/admin-membership/PointsWorkspace"
import { EntitlementsWorkspace } from "../features/admin-membership/EntitlementsWorkspace"
import { GrowthLevelFormDialog, type GrowthLevelDraft } from "./GrowthLevelFormDialog"
import { MedalsWorkspace } from "../features/admin-membership/MedalsWorkspace"
import { AdminActionDialog } from "./admin/AdminActionDialog"
import { CommunityGroupAdminPanel } from "./CommunityGroupAdminPanel"

interface MembershipAdminPanelProps {
  csrfToken: string
  canReadLevelRules: boolean
  canWriteLevelRules: boolean
  canReadMedalRules: boolean
  canWriteMedalRules: boolean
  canGrantPoints: boolean
  canGrantMedals: boolean
  canReadGroups: boolean
  canWriteGroups: boolean
  canReadGroupMemberships: boolean
  canWriteGroupMemberships: boolean
  canReadUsers: boolean
  canReadEntitlementTypes: boolean
  canWriteEntitlementTypes: boolean
  canReadEntitlementGrants: boolean
  canReadRedemptions?: boolean
  canWriteRedemptions?: boolean
  canWriteEntitlementGrants: boolean
}

interface MedalDraft {
  userId: string
  medalKey: string
  reason: string
}

type MembershipWorkspace = "growth" | "points" | "medals" | "groups" | "entitlements" | "redemptions"
type WorkspaceCapabilities = Pick<MembershipAdminPanelProps, "canReadRedemptions" | "canReadLevelRules" | "canWriteLevelRules" | "canGrantPoints" | "canReadMedalRules" | "canWriteMedalRules" | "canGrantMedals" | "canReadGroups" | "canWriteGroups" | "canReadEntitlementTypes" | "canWriteEntitlementTypes" | "canReadEntitlementGrants" | "canWriteEntitlementGrants">

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
  canReadGroups,
  canWriteGroups,
  canReadGroupMemberships,
  canWriteGroupMemberships,
  canReadUsers,
  canReadEntitlementTypes,
  canWriteEntitlementTypes,
  canReadEntitlementGrants,
  canWriteEntitlementGrants,
  canReadRedemptions = false,
  canWriteRedemptions = false,
}: MembershipAdminPanelProps) {
  const entitlementCapabilities = { canReadRedemptions, canReadEntitlementTypes, canWriteEntitlementTypes, canReadEntitlementGrants, canWriteEntitlementGrants }
  const [workspace, setWorkspace] = useState<MembershipWorkspace>(() => initialWorkspace({ canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canWriteMedalRules, canGrantMedals, canReadGroups, canWriteGroups, ...entitlementCapabilities }))
  const [growthLevels, setGrowthLevels] = useState<AdminGrowthLevel[]>([])
  const [growthLoading, setGrowthLoading] = useState(canReadLevelRules)
  const [growthError, setGrowthError] = useState("")
  const [growthMessage, setGrowthMessage] = useState("")
  const [growthConflict, setGrowthConflict] = useState(false)
  const [savingGrowthId, setSavingGrowthId] = useState<string | null>(null)
  const [creatingGrowth, setCreatingGrowth] = useState(false)
  const [growthCreateOpen, setGrowthCreateOpen] = useState(false)
  const [editingGrowth, setEditingGrowth] = useState<AdminGrowthLevel | null>(null)
  const [deletingGrowth, setDeletingGrowth] = useState(false)
  const [growthDeleteTarget, setGrowthDeleteTarget] = useState<AdminGrowthLevel | null>(null)
  const growthFormTriggerRef = useRef<HTMLButtonElement | null>(null)
  const growthMutationRef = useRef(false)
  const growthDeleteDialogRef = useRef<HTMLDivElement | null>(null)
  const growthDeleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [growthDraft, setGrowthDraft] = useState<GrowthLevelDraft>(newGrowthLevelDraft)
  const [pointsUserQuery, setPointsUserQuery] = useState("")
  const [pointsUsers, setPointsUsers] = useState<AdminUserCandidate[]>([])
  const [pointsUsersLoading, setPointsUsersLoading] = useState(false)
  const [selectedPointsUser, setSelectedPointsUser] = useState<AdminUserCandidate | null>(null)
  const [selectedPointsBalance, setSelectedPointsBalance] = useState<number | null>(null)
  const [pointsBalanceLoading, setPointsBalanceLoading] = useState(false)
  const [pointsBalanceError, setPointsBalanceError] = useState("")
  const [pointsBusy, setPointsBusy] = useState(false)
  const pointsAccountRequest = useRef(0)
  const pointsUserRef = useRef<string | null>(null)
  const [medalRules, setMedalRules] = useState<MembershipMedalRule[]>([])
  const [medalDraft, setMedalDraft] = useState<MedalDraft>({ userId: "", medalKey: "medal_01", reason: "operator.award" })
  const [medalBusy, setMedalBusy] = useState(false)
  const [medalView, setMedalView] = useState<"catalog" | "operations">("catalog")
  const [grantOpen, setGrantOpen] = useState(false)
  const [medalLoading, setMedalLoading] = useState(canReadMedalRules)
  const [medalLoadError, setMedalLoadError] = useState("")
  const [recipientQuery, setRecipientQuery] = useState("")
  const [recipientUsers, setRecipientUsers] = useState<AdminUserCandidate[]>([])
  const [recipient, setRecipient] = useState<AdminUserCandidate | null>(null)
  const [recipientLoading, setRecipientLoading] = useState(false)
  const medalMutationRef = useRef(false)
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
    if (!workspaceAvailable(workspace, { canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canWriteMedalRules, canGrantMedals, canReadGroups, canWriteGroups, ...entitlementCapabilities })) {
      setWorkspace(initialWorkspace({ canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canWriteMedalRules, canGrantMedals, canReadGroups, canWriteGroups, ...entitlementCapabilities }))
    }
  }, [workspace, canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canWriteMedalRules, canGrantMedals, canReadGroups, canWriteGroups, canReadEntitlementTypes, canWriteEntitlementTypes, canReadEntitlementGrants, canWriteEntitlementGrants, canReadRedemptions])

  useEffect(() => {
    const query = pointsUserQuery.trim()
    if (workspace !== "points" || !canGrantPoints || query.length < 2) {
      setPointsUsers([])
      setPointsUsersLoading(false)
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setPointsUsersLoading(true)
      listUsers(query, { limit: 10, signal: controller.signal }).then((page) => {
        if (!controller.signal.aborted) {
          setPointsUsers(page.users.map((user) => ({ ...user, status: "active" })))
          setPointsUsersLoading(false)
        }
      }).catch(() => {
        if (!controller.signal.aborted) {
          setPointsUsers([])
          setPointsUsersLoading(false)
        }
      })
    }, 250)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [canGrantPoints, pointsUserQuery, workspace])

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

  async function refreshMedals() {
    const rules = await getMembershipMedalRules()
    setMedalRules(rules)
    return rules
  }

  useEffect(() => {
    if (!canReadMedalRules) { setMedalLoading(false); return }
    const controller = new AbortController()
    setMedalLoading(true); setMedalLoadError("")
    getMembershipMedalRules(controller.signal).then(value => {
      if (!controller.signal.aborted) {
        setMedalRules(value)
        setMedalDraft(current => ({ ...current, medalKey: value[0]?.key ?? "" }))
      }
    }).catch(reason => {
      if (!controller.signal.aborted) setMedalLoadError(reason instanceof Error ? reason.message : "勋章目录加载失败。")
    }).finally(() => { if (!controller.signal.aborted) setMedalLoading(false) })
    return () => controller.abort()
  }, [canReadMedalRules])

  useEffect(() => {
    if (!grantOpen || recipientQuery.trim().length < 2) { setRecipientUsers([]); setRecipientLoading(false); return }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setRecipientLoading(true)
      listUsers(recipientQuery.trim(), { limit: 10, signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) setRecipientUsers(result.users.map(user => ({ ...user, status: "active" })))
      }).catch(() => { if (!controller.signal.aborted) setMedalError("用户搜索失败，请重试。") })
        .finally(() => { if (!controller.signal.aborted) setRecipientLoading(false) })
    }, 250)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [grantOpen, recipientQuery])

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
    if (workspace !== "medals" || medalView !== "operations" || !canReadMedalRules) return
    const controller = new AbortController()
    void loadMedalOperations({ signal: controller.signal })
    return () => controller.abort()
  }, [workspace, medalView, canReadMedalRules, loadMedalOperations])

  function changeGrowthLevel(levelId: string, patch: Partial<AdminGrowthLevel>) {
    setEditingGrowth((current) => current?.id === levelId ? { ...current, ...patch } : current)
    setGrowthMessage("")
    setGrowthError("")
  }

  async function saveGrowthLevel(level: AdminGrowthLevel) {
    if (!canWriteLevelRules || growthMutationRef.current) return
    growthMutationRef.current = true
    setSavingGrowthId(level.id)
    setGrowthError("")
    setGrowthMessage("")
    setGrowthConflict(false)
    try {
      const saved = await updateAdminGrowthLevel(level.id, {
        expectedRevision: level.revision,
        levelOrder: level.levelOrder,
        displayName: level.displayName,
        requiredExperience: level.requiredExperience,
        iconAssetId: level.iconAssetId,
        color: level.color,
        description: level.description,
        status: "published",
      }, csrfToken)
      setGrowthLevels((current) => sortGrowthLevels(current.map((item) => item.id === saved.id ? saved : item)))
      completeGrowthLevelForm()
      setGrowthMessage(`${saved.internalKey} 已保存`)
    } catch (reason) {
      setGrowthConflict(reason instanceof AdminApiError && reason.code === "membership.level_revision_conflict")
      setGrowthError(reason instanceof AdminApiError ? reason.message : "成长等级保存失败，请稍后重试。")
    } finally {
      growthMutationRef.current = false
      setSavingGrowthId(null)
    }
  }

  async function createGrowthLevel(event: FormEvent) {
    event.preventDefault()
    if (!canWriteLevelRules || growthMutationRef.current) return
    setGrowthError("")
    setGrowthMessage("")
    const input = toGrowthLevelInput(growthDraft)
    if (!input) {
      setGrowthError("请填写合法的内部键、等级顺序、名称和 EXP 阈值。")
      return
    }
    growthMutationRef.current = true
    setCreatingGrowth(true)
    try {
      const saved = await createAdminGrowthLevel(input, csrfToken)
      setGrowthLevels((current) => sortGrowthLevels([...current, saved]))
      completeGrowthLevelForm()
      setGrowthMessage(`${saved.internalKey} 已创建并生效`)
    } catch (reason) {
      setGrowthError(reason instanceof AdminApiError ? reason.message : "成长等级创建失败，请稍后重试。")
    } finally {
      growthMutationRef.current = false
      setCreatingGrowth(false)
    }
  }

  function openGrowthCreate(trigger: HTMLButtonElement) {
    growthFormTriggerRef.current = trigger
    setGrowthDraft(newGrowthLevelDraft())
    setEditingGrowth(null)
    setGrowthDeleteTarget(null)
    setGrowthCreateOpen(true)
    setGrowthError("")
    setGrowthMessage("")
    setGrowthConflict(false)
  }

  function openGrowthEdit(level: AdminGrowthLevel, trigger: HTMLButtonElement) {
    growthFormTriggerRef.current = trigger
    setEditingGrowth({ ...level })
    setGrowthCreateOpen(false)
    setGrowthDeleteTarget(null)
    setGrowthError("")
    setGrowthMessage("")
    setGrowthConflict(false)
  }

  async function refreshGrowthConflictBaseline() {
    if (!editingGrowth || !canReadLevelRules) return
    try {
      const latestLevels = sortGrowthLevels(await getAdminGrowthLevels())
      setGrowthLevels(latestLevels)
      const latest = latestLevels.find((level) => level.id === editingGrowth.id)
      if (!latest) {
        setGrowthError("该成长等级已不存在，请关闭编辑器后刷新目录。")
        return
      }
      setEditingGrowth((current) => current?.id === latest.id ? { ...current, revision: latest.revision } : current)
      setGrowthConflict(false)
      setGrowthError("")
    } catch (reason) {
      setGrowthError(reason instanceof AdminApiError ? reason.message : "最新成长等级暂时无法加载，请稍后重试。")
    }
  }

  function closeGrowthLevelForm() {
    if (growthMutationRef.current) return
    const trigger = growthFormTriggerRef.current
    setGrowthCreateOpen(false)
    setEditingGrowth(null)
    setGrowthDraft(newGrowthLevelDraft())
    setGrowthError("")
    setGrowthConflict(false)
    window.requestAnimationFrame(() => trigger?.focus())
  }

  function completeGrowthLevelForm() {
    const trigger = growthFormTriggerRef.current
    setGrowthCreateOpen(false)
    setEditingGrowth(null)
    setGrowthDraft(newGrowthLevelDraft())
    window.requestAnimationFrame(() => trigger?.focus())
  }

  function submitGrowthEdit(event: FormEvent) {
    event.preventDefault()
    if (editingGrowth) void saveGrowthLevel(editingGrowth)
  }

  async function confirmDeleteGrowthLevel() {
    if (!canWriteLevelRules || !growthDeleteTarget) return
    const target = growthDeleteTarget
    setDeletingGrowth(true)
    setGrowthError("")
    setGrowthMessage("")
    try {
      await deleteAdminGrowthLevel(target.id, csrfToken)
      setGrowthLevels((current) => current.filter((level) => level.id !== target.id))
      if (editingGrowth?.id === target.id) setEditingGrowth(null)
      setGrowthMessage(`${target.internalKey} 已删除`)
      setGrowthDeleteTarget((current) => current?.id === target.id ? null : current)
    } catch (reason) {
      setGrowthError(reason instanceof AdminApiError ? reason.message : "成长等级删除失败，请稍后重试。")
    } finally {
      setDeletingGrowth(false)
    }
  }

  function cancelGrowthLevelDelete() {
    const trigger = growthDeleteTriggerRef.current
    setGrowthDeleteTarget(null)
    window.requestAnimationFrame(() => trigger?.focus())
  }

  function handleGrowthDeleteDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !deletingGrowth) {
      event.preventDefault()
      cancelGrowthLevelDelete()
      return
    }
    if (event.key !== "Tab") return
    const controls = [...(growthDeleteDialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])]
    if (controls.length === 0) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function selectPointsUser(user: AdminUserCandidate) {
    if (pointsBusy) return
    const requestId = ++pointsAccountRequest.current
    pointsUserRef.current = user.id
    setSelectedPointsUser(user)
    setSelectedPointsBalance(null)
    setPointsBalanceLoading(true)
    setPointsBalanceError("")
    try {
      const account = await getAdminMembershipAccount(user.id)
      if (requestId === pointsAccountRequest.current) setSelectedPointsBalance(account.pointsBalance)
    } catch {
      if (requestId === pointsAccountRequest.current) setPointsBalanceError("积分余额读取失败，请重试后再操作。")
    } finally {
      if (requestId === pointsAccountRequest.current) setPointsBalanceLoading(false)
    }
  }

  async function grantPoints(input: { userId: string; amount: number; reason: string; details: string; idempotencyKey: string }) {
    ++pointsAccountRequest.current
    const result = await grantMembershipPoints({ userId: input.userId, amount: input.amount, reason: input.reason, details: input.details, idempotencyKey: input.idempotencyKey }, csrfToken)
    if (pointsUserRef.current === input.userId) setSelectedPointsBalance(result.account.pointsBalance)
    return { balance: result.account.pointsBalance, auditId: result.auditId ?? undefined, replayed: !result.created }
  }

  async function awardMedal(event: FormEvent) {
    event.preventDefault()
    if (!canGrantMedals || medalMutationRef.current) return
    setMedalError("")
    setMedalResult(null)
    const userId = medalDraft.userId.trim()
    if (!userId) {
      setMedalError("请搜索并选择要发放勋章的成员。")
      return
    }
    if (!reasonPattern.test(medalDraft.reason.trim())) {
      setMedalError("授予理由格式无效。")
      return
    }
    medalMutationRef.current = true
    setMedalBusy(true)
    try {
      const result = await grantMembershipMedal({ userId, medalKey: medalDraft.medalKey, reason: medalDraft.reason.trim() }, csrfToken)
      setMedalResult(result)
      setGrantOpen(false)
      if (canReadMedalRules) await loadMedalOperations()
    } catch (reason) {
      setMedalError(reason instanceof AdminApiError ? reason.message : "勋章授予失败，请稍后重试。")
    } finally {
      medalMutationRef.current = false
      setMedalBusy(false)
    }
  }

  function filterMedalOperations(event: FormEvent) {
    event.preventDefault()
    setAppliedMedalOperationFilters({ userId: medalOperationUserFilter.trim(), medalKey: medalOperationKeyFilter })
  }

  async function confirmMedalRevocation(event: FormEvent) {
    event.preventDefault()
    if (!revocationTarget || !canGrantMedals || medalMutationRef.current) return
    const reason = revocationReason.trim()
    if (reason.length < 1 || Array.from(reason).length > 64 || Array.from(reason).some((character) => /\p{Cc}/u.test(character))) {
      setMedalOperationsError("撤销原因必须是 1 到 64 个有效字符。")
      return
    }
    medalMutationRef.current = true
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
      medalMutationRef.current = false
      setRevocationBusy(false)
    }
  }

  const activeMedalOperationIds = activeMembershipMedalOperationIds(medalOperations)
  const availableWorkspaces = membershipWorkspaces({ canReadLevelRules, canWriteLevelRules, canGrantPoints, canReadMedalRules, canWriteMedalRules, canGrantMedals, canReadGroups, canWriteGroups, ...entitlementCapabilities })
  const growthDialogOpen = growthCreateOpen || editingGrowth !== null || growthDeleteTarget !== null

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
    <>
    <div className="admin-panel membership-admin-panel membership-admin-panel--focused admin-catalog" inert={growthDialogOpen ? true : undefined} aria-hidden={growthDialogOpen ? "true" : undefined}>
      <div className="membership-workspace-tabs" role="tablist" aria-label="会员运营工作区">
        {(canReadLevelRules || canWriteLevelRules) && <button id="membership-growth-tab" type="button" role="tab" data-membership-workspace="growth" tabIndex={workspace === "growth" ? 0 : -1} aria-selected={workspace === "growth"} aria-controls="membership-growth-workspace" onKeyDown={(event) => handleWorkspaceKeyDown(event, "growth")} onClick={() => setWorkspace("growth")}><Sparkles size={15} aria-hidden="true" />成长运营</button>}
        {canGrantPoints && <button id="membership-points-tab" type="button" role="tab" data-membership-workspace="points" tabIndex={workspace === "points" ? 0 : -1} aria-selected={workspace === "points"} aria-controls="membership-points-workspace" onKeyDown={(event) => handleWorkspaceKeyDown(event, "points")} onClick={() => setWorkspace("points")}><Coins size={15} aria-hidden="true" />积分运营</button>}
        {(canReadMedalRules || canWriteMedalRules || canGrantMedals) && <button id="membership-medals-tab" type="button" role="tab" data-membership-workspace="medals" tabIndex={workspace === "medals" ? 0 : -1} aria-selected={workspace === "medals"} aria-controls="membership-medals-workspace" onKeyDown={(event) => handleWorkspaceKeyDown(event, "medals")} onClick={() => setWorkspace("medals")}><Award size={15} aria-hidden="true" />勋章运营</button>}
        {canReadGroups && <button id="membership-groups-tab" type="button" role="tab" data-membership-workspace="groups" tabIndex={workspace === "groups" ? 0 : -1} aria-selected={workspace === "groups"} aria-controls="membership-groups-workspace" onKeyDown={(event) => handleWorkspaceKeyDown(event, "groups")} onClick={() => setWorkspace("groups")}><UsersRound size={15} aria-hidden="true" />用户组</button>}
        {(canReadEntitlementTypes || canWriteEntitlementTypes || canReadEntitlementGrants || canWriteEntitlementGrants) && <button id="membership-entitlements-tab" type="button" role="tab" data-membership-workspace="entitlements" tabIndex={workspace === "entitlements" ? 0 : -1} aria-selected={workspace === "entitlements"} aria-controls="membership-entitlements-workspace" onKeyDown={(event) => handleWorkspaceKeyDown(event, "entitlements")} onClick={() => setWorkspace("entitlements")}>标准权益</button>}
        {canReadRedemptions && <button id="membership-redemptions-tab" type="button" role="tab" data-membership-workspace="redemptions" tabIndex={workspace === "redemptions" ? 0 : -1} aria-selected={workspace === "redemptions"} aria-controls="membership-redemptions-workspace" onKeyDown={event => handleWorkspaceKeyDown(event, "redemptions")} onClick={() => setWorkspace("redemptions")}>积分兑换</button>}
      </div>
      <div className="membership-admin-grid membership-admin-grid--workspace">
        {workspace === "growth" && (canReadLevelRules || canWriteLevelRules) && <section id="membership-growth-workspace" role="tabpanel" className="membership-rule-section" aria-labelledby="membership-growth-tab">
          <div className="admin-form__heading membership-section-heading"><div><h3 id="membership-growth-heading">成长等级（EXP）</h3><span className="admin-badge">共 {growthLevels.length} 个等级</span><p>保存后立即生效；积分变更不会增加 EXP，也不会改变成长等级。</p></div>{canWriteLevelRules && <button className="secondary-button membership-growth-create-trigger" type="button" aria-haspopup="dialog" onClick={(event) => openGrowthCreate(event.currentTarget)}><Plus size={14} aria-hidden="true" />新增等级</button>}</div>
          {!canReadLevelRules ? <div className="admin-empty" role="status"><Sparkles size={20} aria-hidden="true" /><span>当前账号可创建成长等级，但不具备等级目录读取权限。</span></div> : growthLoading ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /><span>正在读取成长等级</span></div> : growthLevels.length === 0 ? <div className="admin-empty" role="status"><Sparkles size={20} aria-hidden="true" /><span>尚未创建成长等级</span></div> : <ul className="membership-growth-list" aria-label="成长等级列表">
            {growthLevels.map((level) => <GrowthLevelRow key={level.id} level={level} canWrite={canWriteLevelRules} pending={deletingGrowth || savingGrowthId === level.id} onEdit={(trigger) => openGrowthEdit(level, trigger)} onDelete={(trigger) => { growthDeleteTriggerRef.current = trigger; setGrowthDeleteTarget(level); setGrowthError(""); setGrowthMessage("") }} />)}
          </ul>}
          {!growthCreateOpen && !editingGrowth && (growthError || growthMessage) && <p className={growthError ? "form-alert" : "admin-success"} role={growthError ? "alert" : "status"}>{growthError || growthMessage}</p>}
        </section>}

        {canGrantPoints && <section hidden={workspace !== "points"} id="membership-points-workspace" role="tabpanel" className="membership-grant-section membership-points-layout" aria-labelledby="membership-points-tab">
          <AdminUserPicker query={pointsUserQuery} users={pointsUsers} selectedUser={selectedPointsUser} loading={pointsUsersLoading} disabled={pointsBusy} onQueryChange={setPointsUserQuery} onSelect={(user) => void selectPointsUser(user)} />
          <PointsWorkspace selectedUser={selectedPointsUser} balance={selectedPointsBalance} balanceLoading={pointsBalanceLoading} balanceError={pointsBalanceError} onRetryBalance={() => { if (selectedPointsUser) void selectPointsUser(selectedPointsUser) }} onBusyChange={setPointsBusy} onGrant={grantPoints} />
        </section>}

        {workspace === "redemptions" && canReadRedemptions && <section id="membership-redemptions-workspace" role="tabpanel" aria-labelledby="membership-redemptions-tab"><RedemptionWorkspace csrfToken={csrfToken} canWrite={canWriteRedemptions} canReadTypes={canReadEntitlementTypes}/></section>}
        {workspace === "groups" && canReadGroups && <section id="membership-groups-workspace" role="tabpanel" className="membership-rule-section" aria-labelledby="membership-groups-tab"><CommunityGroupAdminPanel csrfToken={csrfToken} canWrite={canWriteGroups} canReadMemberships={canReadGroupMemberships} canWriteMemberships={canWriteGroupMemberships} canReadUsers={canReadUsers} /></section>}

{workspace === "entitlements" && <section id="membership-entitlements-workspace" role="tabpanel" aria-labelledby="membership-entitlements-tab"><EntitlementsWorkspace csrfToken={csrfToken} canReadTypes={canReadEntitlementTypes} canWriteTypes={canWriteEntitlementTypes} canReadGrants={canReadEntitlementGrants} canWriteGrants={canWriteEntitlementGrants} canReadUsers={canReadUsers} /></section>}

        {workspace === "medals" && (canReadMedalRules || canWriteMedalRules || canGrantMedals) && <section id="membership-medals-workspace" role="tabpanel" className="membership-grant-section" aria-labelledby="membership-medals-tab">
          <h3 className="sr-only">勋章</h3><div className="membership-medal-toolbar">
            <div className="membership-medal-switch" role="group" aria-label="勋章视图"><button type="button" aria-pressed={medalView === "catalog"} onClick={() => setMedalView("catalog")}>勋章目录</button>{canReadMedalRules && <button type="button" aria-pressed={medalView === "operations"} onClick={() => setMedalView("operations")}>操作记录</button>}</div>
            {canGrantMedals && canReadMedalRules && <button className="secondary-button" type="button" disabled={!medalRules.length} onClick={() => { setMedalError(""); setRecipient(null); setRecipientQuery(""); setRecipientUsers([]); setGrantOpen(true); setMedalDraft(current => ({ userId: "", reason: "operator.award", medalKey: medalRules.some(rule => rule.key === current.medalKey) ? current.medalKey : medalRules[0]?.key ?? "" })) }}><Award size={15} aria-hidden="true" />发放勋章</button>}
          </div>
          {medalView === "catalog" && (medalLoading ? <p className="admin-state" role="status">正在读取勋章目录</p> : medalLoadError ? <div className="admin-state"><p role="alert">{medalLoadError}</p><button className="secondary-button" onClick={() => { setMedalLoading(true); void refreshMedals().then(() => setMedalLoadError("")).catch(reason => setMedalLoadError(reason instanceof Error ? reason.message : "加载失败")).finally(() => setMedalLoading(false)) }}>重新加载</button></div> : <MedalsWorkspace rules={medalRules} canWrite={canWriteMedalRules} csrfToken={csrfToken} onChange={setMedalRules} onRefresh={refreshMedals} />)}
          {grantOpen && canGrantMedals && (canReadMedalRules ? <AdminActionDialog title="发放勋章" busy={medalBusy} onClose={() => setGrantOpen(false)}><form className="admin-form" onSubmit={(event) => void awardMedal(event)}>
            <AdminUserPicker query={recipientQuery} users={recipientUsers} selectedUser={recipient} loading={recipientLoading} onQueryChange={setRecipientQuery} onSelect={user => { setRecipient(user); setMedalDraft(current => ({ ...current, userId: user.id })) }} />
            <label htmlFor="membership-medal-key"><span>勋章</span><select id="membership-medal-key" value={medalDraft.medalKey} onChange={(event) => setMedalDraft({ ...medalDraft, medalKey: event.target.value })} disabled={medalRules.length === 0}>{medalRules.map((rule) => <option value={rule.key} key={rule.key}>{rule.displayName}</option>)}</select></label>
            <label htmlFor="membership-medal-reason"><span>勋章授予理由</span><input id="membership-medal-reason" value={medalDraft.reason} onChange={(event) => setMedalDraft({ ...medalDraft, reason: event.target.value })} pattern="[a-z][a-z0-9._-]{1,63}" required /></label>
            {medalError && <p className="form-alert" role="alert">{medalError}</p>}
            <button className="primary-button" type="submit" disabled={medalBusy || medalRules.length === 0}><Award size={15} aria-hidden="true" />{medalBusy ? "正在发放" : "手动发放勋章"}</button>
          </form></AdminActionDialog> : <p className="admin-empty" role="status">当前账号无法读取勋章目录，不能安全地手动发放勋章。</p>)}
          {medalResult && <div className="membership-grant-result" role="status"><Award size={18} aria-hidden="true" /><div><strong>{medalResult.created ? `${medalResult.medal.displayName} 已发放` : "幂等重放：勋章已持有"}</strong><span>资源键 {medalResult.medal.key}</span></div></div>}
          {medalView === "operations" && canReadMedalRules && <div className="membership-medal-operations">
            <div className="admin-form__heading membership-section-heading"><div><h4>操作记录</h4><p>发放、自动授予和撤销均保留审计记录。</p></div><History size={17} aria-hidden="true" /></div>
            <form className="membership-operation-filters" onSubmit={filterMedalOperations}>
              <label htmlFor="medal-operation-user"><span>用户 UUID</span><input id="medal-operation-user" value={medalOperationUserFilter} onChange={(event) => setMedalOperationUserFilter(event.target.value)} placeholder="全部用户" /></label>
              <label htmlFor="medal-operation-key"><span>勋章</span><select id="medal-operation-key" value={medalOperationKeyFilter} onChange={(event) => setMedalOperationKeyFilter(event.target.value)}><option value="">全部勋章</option>{medalRules.map((rule) => <option value={rule.key} key={rule.key}>{rule.displayName}</option>)}</select></label>
              <button className="secondary-button" type="submit">筛选记录</button>
            </form>
            {medalOperationsLoading && medalOperations.length === 0 ? <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={18} aria-hidden="true" /><span>正在读取操作记录</span></div> : medalOperations.length === 0 ? <div className="admin-empty" role="status"><History size={18} aria-hidden="true" /><span>当前条件下没有勋章操作记录</span></div> : <div className="membership-operation-list">
              {medalOperations.map((operation) => <article className="membership-operation-row" key={operation.id}>
                <Award size={24} aria-hidden="true" />
                <div className="membership-operation-row__main"><strong>{operation.userDisplayName}</strong><span>@{operation.username} · {operation.medalDisplayName}</span><small>{operation.reason} · {formatOperationTime(operation.createdAt)}</small></div>
                <div className="membership-operation-row__meta"><span className={`membership-status membership-operation-kind--${operation.operation}`}>{medalOperationLabel(operation.operation)}</span><small>操作人 {operation.actorDisplayName}</small></div>
                {canGrantMedals && activeMedalOperationIds.has(operation.id) && <button className="secondary-button" type="button" aria-label={`撤销 ${operation.medalDisplayName}`} onClick={() => { setRevocationTarget(operation); setRevocationReason(""); setRevocationMessage(""); setMedalOperationsError("") }}><RotateCcw size={14} aria-hidden="true" />撤销</button>}
              </article>)}
            </div>}
            {medalOperationsNextCursor && <button className="secondary-button membership-operation-more" type="button" disabled={medalOperationsLoading} onClick={() => void loadMedalOperations({ cursor: medalOperationsNextCursor, append: true })}>{medalOperationsLoading ? "正在加载" : "加载更早记录"}</button>}
            {revocationTarget && <AdminActionDialog title="撤销勋章" busy={revocationBusy} onClose={() => setRevocationTarget(null)}><form className="membership-revocation-form" onSubmit={(event) => void confirmMedalRevocation(event)}>
              <div><strong>撤销 {revocationTarget.userDisplayName} 的 {revocationTarget.medalDisplayName}</strong><p>只移除当前持有状态，历史记录不会删除。</p></div>
              <label htmlFor="membership-revocation-reason"><span>撤销原因</span><input id="membership-revocation-reason" value={revocationReason} maxLength={64} onChange={(event) => setRevocationReason(event.target.value)} required /></label>
              <div className="membership-revocation-actions"><button className="secondary-button" type="button" disabled={revocationBusy} onClick={() => setRevocationTarget(null)}>取消</button><button className="danger-button" type="submit" disabled={revocationBusy}>{revocationBusy ? "正在撤销" : "确认撤销"}</button></div>
              {medalOperationsError && <p className="form-alert" role="alert">{medalOperationsError}</p>}
            </form></AdminActionDialog>}
            {!revocationTarget && (medalOperationsError || revocationMessage) && <p className={medalOperationsError ? "form-alert" : "admin-success"} role={medalOperationsError ? "alert" : "status"}>{medalOperationsError || revocationMessage}</p>}
          </div>}
        </section>}
      </div>
    </div>
    {growthCreateOpen && <GrowthLevelFormDialog mode="create" value={growthDraft} pending={creatingGrowth} error={growthError} onChange={(patch) => { setGrowthDraft((current) => ({ ...current, ...patch })); setGrowthError("") }} onSubmit={(event) => void createGrowthLevel(event)} onClose={closeGrowthLevelForm} />}
    {editingGrowth && <GrowthLevelFormDialog mode="edit" value={editingGrowth} pending={savingGrowthId === editingGrowth.id} error={growthError} conflict={growthConflict} onRefresh={() => void refreshGrowthConflictBaseline()} onChange={(patch) => changeGrowthLevel(editingGrowth.id, patch)} onSubmit={submitGrowthEdit} onClose={closeGrowthLevelForm} />}
    {growthDeleteTarget && <div className="dialog-backdrop membership-growth-dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !deletingGrowth) cancelGrowthLevelDelete() }}><div ref={growthDeleteDialogRef} className="membership-growth-delete" role="dialog" aria-modal="true" aria-labelledby="membership-growth-delete-heading" aria-describedby="membership-growth-delete-description" onKeyDown={handleGrowthDeleteDialogKeyDown}>
      <div><strong id="membership-growth-delete-heading">删除成长等级</strong><p id="membership-growth-delete-description">确定删除“{growthDeleteTarget.displayName}（{growthDeleteTarget.internalKey}）”吗？正在被会员使用或会破坏等级起点时无法删除。</p></div>
      <div className="membership-growth-form-actions"><button className="secondary-button" type="button" disabled={deletingGrowth} autoFocus onClick={cancelGrowthLevelDelete}>取消</button><button className="danger-button" type="button" disabled={deletingGrowth} onClick={() => void confirmDeleteGrowthLevel()}>{deletingGrowth ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}确认删除</button></div>
    </div></div>}
    </>
  )
}

function GrowthLevelRow({
  level,
  canWrite,
  pending,
  onEdit,
  onDelete,
}: {
  level: AdminGrowthLevel
  canWrite: boolean
  pending: boolean
  onEdit: (trigger: HTMLButtonElement) => void
  onDelete: (trigger: HTMLButtonElement) => void
}) {
  return (
    <li className="membership-growth-row">
      <div className="membership-growth-row__overview">
        <header>
          <span className="membership-level-mark">Lv {level.levelOrder}</span>
          <div><strong>{level.displayName}</strong><small>{level.internalKey}</small></div>
        </header>
        <dl>
          <div><dt>EXP 阈值</dt><dd>{level.requiredExperience.toLocaleString("zh-CN")}</dd></div>
          <div><dt>主题颜色</dt><dd>{level.color ?? "未设置"}</dd></div>
        </dl>
        <p>{level.description || "未填写等级说明"}</p>
        {canWrite && <div className="membership-growth-row__actions"><button className="secondary-button" type="button" aria-haspopup="dialog" disabled={pending} onClick={(event) => onEdit(event.currentTarget)}><Pencil size={13} aria-hidden="true" />编辑 {level.internalKey}</button><button className="danger-button" type="button" aria-haspopup="dialog" disabled={pending} onClick={(event) => onDelete(event.currentTarget)}><Trash2 size={13} aria-hidden="true" />删除 {level.internalKey}</button></div>}
      </div>
      {!canWrite && <small className="membership-growth-readonly">仅具有成长等级读取权限</small>}
    </li>
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

function initialWorkspace(capabilities: WorkspaceCapabilities): MembershipWorkspace {
  if (workspaceAvailable("growth", capabilities)) return "growth"
  if (workspaceAvailable("points", capabilities)) return "points"
  if (workspaceAvailable("medals", capabilities)) return "medals"
  if (workspaceAvailable("groups", capabilities)) return "groups"
  if (workspaceAvailable("redemptions", capabilities)) return "redemptions"
  return "entitlements"
}

function workspaceAvailable(workspace: MembershipWorkspace, capabilities: WorkspaceCapabilities): boolean {
  if (workspace === "redemptions") return Boolean(capabilities.canReadRedemptions)
  if (workspace === "growth") return capabilities.canReadLevelRules || capabilities.canWriteLevelRules
  if (workspace === "points") return capabilities.canGrantPoints
  if (workspace === "medals") return capabilities.canReadMedalRules || capabilities.canWriteMedalRules || capabilities.canGrantMedals
  if (workspace === "entitlements") return capabilities.canReadEntitlementTypes || capabilities.canWriteEntitlementTypes || capabilities.canReadEntitlementGrants || capabilities.canWriteEntitlementGrants
  return capabilities.canReadGroups
}

function membershipWorkspaces(capabilities: WorkspaceCapabilities): MembershipWorkspace[] {
  return (["growth", "points", "medals", "groups", "entitlements", "redemptions"] as const).filter((workspace) => workspaceAvailable(workspace, capabilities))
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
