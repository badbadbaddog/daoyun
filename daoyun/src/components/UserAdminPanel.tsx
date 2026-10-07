import { AlertCircle, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, Download, Globe, MapPin, ExternalLink, LoaderCircle, MoreHorizontal, RefreshCw, Search, Shield, ShieldAlert, UserRound, Users } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import {
  AdminUsersApiError,
  getAdminUser,
  getAdminUserMembershipSummary,
  type AdminUserMembershipSummary,
  type AdminUserMembershipSection,
  listAdminUsers,
  type AdminUserDetail,
  type AdminUserStatus,
  type AdminUserSummary,
} from "../api/adminUsers"
import { getAdminGrowthLevels, listAdminCommunityGroups, listStandardEntitlementTypes, listAuthorizationRoles, type AdminCommunityGroup, type AdminGrowthLevel, type StandardEntitlementType, type AdminBoard, type AuthorizationRole } from "../api/admin"
import { encodeCsv } from "../lib/csv"
import { GrowthProgress } from "../features/membership/GrowthProgress"
import { PermissionCheckPanel, permissionCheckCapabilities } from "./PermissionCheckPanel"
import { UserActivityPanel } from "./UserActivityPanel"
import { UserAvatar } from "./UserAvatar"
import { UserMembershipIdentity, UserMembershipPanel } from "./UserMembershipPanel"
import { UserMembershipActions } from "./UserMembershipActions"
import { UserRoleAction } from "./UserRoleAction"
import { UserStatusAction } from "./UserStatusAction"
import { RelatedAuditLog } from "./RelatedAuditLog"
import { PluginUiSurface } from "./PluginUiSurface"
import { Drawer } from "./ui/Drawer"
import { adminObjectId, adminObjectQuery, restoreAdminScroll } from "./admin/adminQuery"

interface UserAdminPanelProps {
  requestedQuery?: string
  onQueryChange?: (query: string) => void
  csrfToken?: string
  canModerate?: boolean
  canReadRoles?: boolean
  canAssignRoles?: boolean
  canReadAudit?: boolean
  canReadReports?: boolean
  canReadGroups?: boolean
  canReadGroupMemberships?: boolean
  canWriteGroupMemberships?: boolean
  capabilityKeys?: string[]
  boards?: AdminBoard[]
}

type MembershipFacets = { baseGroupId: string; additionalGroupId: string; growthLevelId: string; entitlementTypeId: string; activeFrom: string; activeThrough: string }
const emptyFacets: MembershipFacets = { baseGroupId: "", additionalGroupId: "", growthLevelId: "", entitlementTypeId: "", activeFrom: "", activeThrough: "" }

type LoadState = "loading" | "ready" | "error"
type DetailTab = "overview" | "membership" | "permissions" | "content" | "security" | "audit"

const statusLabels: Record<AdminUserStatus, string> = {
  active: "正常",
  restricted: "已限制",
  suspended: "已暂停",
}

export function UserAdminPanel({ requestedQuery = "", onQueryChange, csrfToken = "", canModerate = false, canAssignRoles = false, canReadRoles = false, canReadAudit = false, canReadReports = false, canReadGroups = false, canReadGroupMemberships = false, canWriteGroupMemberships = false, boards = [], capabilityKeys = [] }: UserAdminPanelProps) {
  const initialFilters = filtersFromQuery(requestedQuery)
  const [queryDraft, setQueryDraft] = useState(initialFilters.query)
  const [query, setQuery] = useState(initialFilters.query)
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | "all">(initialFilters.status)
  const [roleId, setRoleId] = useState(initialFilters.roleId)
  const [from, setFrom] = useState(initialFilters.from)
  const [through, setThrough] = useState(initialFilters.through)
  const [fromDraft, setFromDraft] = useState(initialFilters.from)
  const [throughDraft, setThroughDraft] = useState(initialFilters.through)
  const [facets, setFacets] = useState(initialFilters.facets)
  const [activeFromDraft, setActiveFromDraft] = useState(initialFilters.facets.activeFrom)
  const [activeThroughDraft, setActiveThroughDraft] = useState(initialFilters.facets.activeThrough)
  const [groups, setGroups] = useState<AdminCommunityGroup[]>([])
  const [growthLevels, setGrowthLevels] = useState<AdminGrowthLevel[]>([])
  const [entitlementTypes, setEntitlementTypes] = useState<StandardEntitlementType[]>([])
  const [catalogError, setCatalogError] = useState("")
  const [catalogReload, setCatalogReload] = useState(0)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const canFilterGroups = canReadGroups && canReadGroupMemberships
  const canFilterGrowth = capabilityKeys.includes("membership.rules.read")
  const canFilterEntitlements = capabilityKeys.includes("entitlements.types.read") && capabilityKeys.includes("entitlements.grants.read")
  const [roles, setRoles] = useState<AuthorizationRole[]>([])
  const [rolesError, setRolesError] = useState("")
  const [limit, setLimit] = useState(20)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState("")
  const searchInput = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const morePending = useRef(false)
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [listState, setListState] = useState<LoadState>("loading")
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState("")
  const [reload, setReload] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [detailState, setDetailState] = useState<LoadState>("ready")
  const [detailError, setDetailError] = useState("")
  const [detailTab, setDetailTab] = useState<DetailTab>("overview")
  const [detailBusy, setDetailBusy] = useState(false)
  const detailRequest = useRef<AbortController | null>(null)
  const listRequestVersion = useRef(0)
  const detailScroll = useRef<HTMLElement>(null)
  const selectedIndex = users.findIndex((user) => user.id === selectedId)
  const navigationDisabled = detailBusy || detailState === "loading" || listState !== "ready"

  useEffect(() => {
    detailScroll.current?.scrollTo?.({ top: 0 })
  }, [selectedId, detailTab])

  useEffect(() => {
    const filters = filtersFromQuery(requestedQuery)
    setQueryDraft(filters.query)
    setQuery(filters.query)
    setStatusFilter(filters.status)
    setRoleId(filters.roleId)
    setFrom(filters.from); setFromDraft(filters.from)
    setThrough(filters.through); setThroughDraft(filters.through)
    setFacets(current => sameFacets(current, filters.facets) ? current : filters.facets); setActiveFromDraft(filters.facets.activeFrom); setActiveThroughDraft(filters.facets.activeThrough)
  }, [requestedQuery])

  const requestedUserId = adminObjectId(requestedQuery, "user_id")
  useEffect(() => {
    if (detailBusy && requestedUserId !== selectedId) {
      onQueryChange?.(adminObjectQuery(requestedQuery, "user_id", selectedId))
      return
    }
    if (requestedUserId) {
      if (requestedUserId !== selectedId) void openUser(requestedUserId, false)
    } else if (selectedId) closeUser(false)
    // Only a URL object change opens or closes the drawer; list refreshes preserve it.
  }, [requestedUserId])

  useEffect(() => {
    if (!canReadRoles && !canAssignRoles) return
    const controller = new AbortController()
    setRolesError("")
    listAuthorizationRoles(controller.signal).then((items) => { if (!controller.signal.aborted) setRoles(items) })
      .catch(() => { if (!controller.signal.aborted) setRolesError("角色筛选暂时无法加载，请刷新重试") })
    return () => controller.abort()
  }, [canReadRoles, canAssignRoles, reload])

  useEffect(() => {
    const controller = new AbortController()
    setCatalogError(""); setGroups([]); setGrowthLevels([]); setEntitlementTypes([])
    setCatalogLoading(canFilterGroups || canFilterGrowth || canFilterEntitlements)
    const jobs: Promise<void>[] = []
    const errors: string[] = []
    if (canFilterGroups) jobs.push(listAdminCommunityGroups(controller.signal).then(items => { if (!controller.signal.aborted) setGroups(items) }).catch(() => { errors.push("用户组筛选暂时无法加载") }))
    if (canFilterGrowth) jobs.push(getAdminGrowthLevels(controller.signal).then(items => { if (!controller.signal.aborted) setGrowthLevels(items) }).catch(() => { errors.push("成长等级筛选暂时无法加载") }))
    if (canFilterEntitlements) jobs.push(listStandardEntitlementTypes(controller.signal).then(items => { if (!controller.signal.aborted) setEntitlementTypes(items) }).catch(() => { errors.push("会员权益筛选暂时无法加载") }))
    void Promise.all(jobs).then(() => { if (!controller.signal.aborted) { setCatalogError(errors.join("；")); setCatalogLoading(false) } })
    return () => controller.abort()
  }, [canFilterGroups, canFilterGrowth, canFilterEntitlements, catalogReload, reload])

  useEffect(() => {
    const controller = new AbortController()
    const requestVersion = ++listRequestVersion.current
    setListState("loading")
    setUsers([])
    setCheckedIds(new Set())
    setNotice("")
    morePending.current = false
    setLoadingMore(false)
    setListError("")
    setNextCursor(null)
    listAdminUsers({ query: query || undefined, status: statusFilter === "all" ? undefined : statusFilter, roleId: roleId || undefined, registeredAfter: dateBoundary(from), registeredBefore: dateBoundary(through, true), ...facetOptions(facets), limit, signal: controller.signal })
      .then((page) => {
        if (!controller.signal.aborted && requestVersion === listRequestVersion.current) {
          setUsers(page.users)
          setNextCursor(page.nextCursor)
          setListState("ready")
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && requestVersion === listRequestVersion.current) {
          setListState("error")
          setListError(reason instanceof AdminUsersApiError ? reason.message : "用户列表暂时无法加载")
        }
      })
    return () => {
      controller.abort()
      if (requestVersion === listRequestVersion.current) listRequestVersion.current += 1
    }
  }, [query, reload, statusFilter, roleId, from, through, limit, facets])

  useEffect(() => () => detailRequest.current?.abort(), [])

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    if ((fromDraft && throughDraft && fromDraft > throughDraft) || (activeFromDraft && activeThroughDraft && activeFromDraft > activeThroughDraft)) return
    const nextQuery = queryDraft.trim()
    setFrom(fromDraft); setThrough(throughDraft)
    setQuery(nextQuery)
    const nextFacets = { ...facets, activeFrom: activeFromDraft, activeThrough: activeThroughDraft }
    setFacets(nextFacets)
    publishFilters(nextQuery, statusFilter, roleId, fromDraft, throughDraft, onQueryChange, requestedQuery, nextFacets)
  }

  function changeStatus(nextStatus: AdminUserStatus | "all") {
    setStatusFilter(nextStatus)
    publishFilters(query, nextStatus, roleId, from, through, onQueryChange, requestedQuery, facets)
  }

  function changeFacet(key: keyof MembershipFacets, value: string) {
    const next = { ...facets, [key]: value }
    setFacets(next)
    publishFilters(query, statusFilter, roleId, from, through, onQueryChange, requestedQuery, next)
  }

  async function loadMoreUsers() {
    if (!nextCursor || morePending.current || listState !== "ready") return
    morePending.current = true
    const requestVersion = listRequestVersion.current
    setLoadingMore(true)
    setListError("")
    try {
      const page = await listAdminUsers({ query: query || undefined, status: statusFilter === "all" ? undefined : statusFilter, roleId: roleId || undefined, registeredAfter: dateBoundary(from), registeredBefore: dateBoundary(through, true), ...facetOptions(facets), cursor: nextCursor, limit })
      if (requestVersion !== listRequestVersion.current) return
      setUsers((current) => [...current, ...page.users.filter((item) => !current.some((loaded) => loaded.id === item.id))])
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (requestVersion === listRequestVersion.current) setListError(reason instanceof AdminUsersApiError ? reason.message : "更多用户暂时无法加载")
    } finally {
      if (requestVersion === listRequestVersion.current) { morePending.current = false; setLoadingMore(false) }
    }
  }

  async function openUser(userId: string, publish = true) {
    if (detailBusy) return
    if (publish) onQueryChange?.(adminObjectQuery(requestedQuery, "user_id", userId))
    if (!selectedId) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setSelectedId(userId)
    setDetail(null)
    setDetailTab("overview")
    setDetailState("loading")
    setDetailError("")
    try {
      const loadedDetail = await getAdminUser(userId, controller.signal)
      if (controller.signal.aborted) return
      setDetail(loadedDetail)
      setDetailState("ready")
    } catch (reason) {
      if (controller.signal.aborted) return
      setDetailState("error")
      setDetailError(reason instanceof AdminUsersApiError ? reason.message : "用户详情暂时无法加载")
    }
  }

  function updateSelectedUser(userId: string, statusUpdate: { status: AdminUserStatus; reason: string | null; expiresAt: string | null; revision: number }) {
    setDetail((current) => current?.id === userId ? {
      ...current,
      status: statusUpdate.status,
      restrictionReason: statusUpdate.reason,
      restrictionExpiresAt: statusUpdate.expiresAt,
      revision: statusUpdate.revision,
    } : current)
    setUsers((current) => current.map((user) => user.id === userId ? { ...user, status: statusUpdate.status } : user).filter((user) => statusFilter === "all" || user.status === statusFilter))
  }

  function closeUser(publish = true) {
    if (detailBusy) return
    if (publish) onQueryChange?.(adminObjectQuery(requestedQuery, "user_id", null))
    restoreAdminScroll(requestedQuery)
    detailRequest.current?.abort()
    setSelectedId(null)
    setDetail(null)
    queueMicrotask(() => (opener.current?.isConnected ? opener.current : searchInput.current)?.focus())
  }

  function updateSelectedRoles(userId: string, roles: AdminUserDetail["roles"]) {
    setReload(value => value + 1)
    setDetail(current => current?.id === userId ? { ...current, roles, primaryRole: roles.some(role => role.name === current.primaryRole) ? current.primaryRole : roles[0]?.name ?? null } : current)
  }

  function resetFilters() {
    setQueryDraft(""); setQuery(""); setStatusFilter("all"); setRoleId("")
    setFrom(""); setThrough(""); setFromDraft(""); setThroughDraft("")
    setFacets(emptyFacets); setActiveFromDraft(""); setActiveThroughDraft("")
    setCheckedIds(new Set()); setNotice(""); publishFilters("", "all", "", "", "", onQueryChange, requestedQuery, emptyFacets)
  }

  const statusCounts = {
    all: users.length,
    active: users.filter((user) => user.status === "active").length,
    restricted: users.filter((user) => user.status === "restricted").length,
    suspended: users.filter((user) => user.status === "suspended").length,
  }
  const selectedUsers = users.filter((user) => checkedIds.has(user.id))
  function exportUsers() {
    const rows = selectedUsers.length ? selectedUsers : users
    if (!rows.length) return
    const csv = encodeCsv([["用户 ID", "昵称", "用户名", "基础身份 / 附加身份", "成长等级", "EXP", "积分", "会员权益", "状态", "注册时间", "最后活跃", "管理角色", "主题数", "回复数", "相关举报数"], ...rows.map((user) => [user.id, user.displayName, user.username, membershipCell(user, "groups", user.membership?.groups?.map(group => group.displayName).join("、") || "无有效身份") as string, membershipCell(user, "experience", user.membership?.level?.displayName ?? "未初始化") as string, membershipCell(user, "experience", user.membership?.experience?.toString() ?? "未初始化") as string, membershipCell(user, "points", user.membership?.pointsBalance?.toString() ?? "未初始化") as string, membershipCell(user, "entitlements", user.membership?.entitlements?.map(item => item.displayName).join("、") || "无有效权益") as string, statusLabels[user.status], user.createdAt, user.lastSeenAt ?? "", user.primaryRole ?? "未分配", user.topicCount, user.postCount, user.reportCount])])
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
    const link = document.createElement("a"); link.href = url; link.download = "用户记录-" + new Date().toISOString().slice(0, 10) + ".csv"; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice("已导出 " + rows.length + " 位用户。")
  }

  return (
    <section className="user-catalog" aria-label="用户管理工作区">
      <header className="user-catalog-heading"><div><h1>用户管理</h1><p>管理社区用户，支持查看资料、设置角色及账号管理。</p></div><div className="user-catalog-heading-actions"><button className="user-catalog-export" type="button" disabled={listState !== "ready" || !users.length} onClick={exportUsers}><Download size={14} aria-hidden="true" />{selectedUsers.length ? "导出选中 " + selectedUsers.length + " 位" : "导出用户"}</button><button className="icon-button" type="button" aria-label="刷新用户列表" title="刷新用户列表" disabled={listState === "loading"} onClick={() => setReload((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" /></button></div></header>
      <div className="user-catalog-stats" aria-label="已加载用户统计">
        {[{ label: "已加载用户", count: statusCounts.all, icon: Users, tone: "blue" }, { label: "正常用户", count: statusCounts.active, icon: CheckCircle2, tone: "green" }, { label: "受限用户", count: statusCounts.restricted, icon: UserRound, tone: "amber" }, { label: "已暂停账号", count: statusCounts.suspended, icon: ShieldAlert, tone: "rose" }].map(({ label, count, icon: Icon, tone }) => <div className="user-catalog-stat" key={label}><span className={"user-stat-icon user-stat-icon--" + tone}><Icon size={25} aria-hidden="true" /></span><div><span>{label}</span><strong>{listState === "loading" ? "—" : count.toLocaleString()}</strong><small>{tone === "blue" ? "当前筛选结果" : listState === "loading" ? "正在统计…" : "占已加载 " + (users.length ? count / users.length * 100 : 0).toFixed(1) + "%"}</small></div></div>)}
      </div>
        <form className="user-catalog-filters" role="search" onSubmit={submitSearch}>
          <label className="user-catalog-search"><Search size={16} aria-hidden="true" /><input ref={searchInput} type="search" aria-label="搜索用户" placeholder="昵称、用户名或用户 ID…" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} /></label>
          {(canReadRoles || canAssignRoles) && <select aria-label="用户角色" value={roleId} onChange={(event) => { setRoleId(event.target.value); publishFilters(query, statusFilter, event.target.value, from, through, onQueryChange, requestedQuery, facets) }}><option value="">全部角色</option>{roleId && !roles.some((role) => role.id === roleId) && <option value={roleId}>指定角色</option>}{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>}
          <select aria-label="用户状态" value={statusFilter} onChange={(event) => changeStatus(event.target.value as AdminUserStatus | "all")}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <div className="user-catalog-date-range" role="group" aria-label="注册时间"><span>注册</span><CalendarDays size={15} aria-hidden="true" /><label className="user-catalog-date"><span className="sr-only">注册起</span><input type="date" aria-label="注册开始日期" max={throughDraft || undefined} value={fromDraft} onChange={(event) => setFromDraft(event.target.value)} /></label>
          <span aria-hidden="true">→</span><label className="user-catalog-date"><span className="sr-only">至</span><input type="date" aria-label="注册结束日期" min={fromDraft || undefined} value={throughDraft} onChange={(event) => setThroughDraft(event.target.value)} /></label></div>
          {canFilterGroups && <><MembershipFilter label="基础用户组" value={facets.baseGroupId} items={groups.filter(group => group.isBase).map(group => ({ id: group.id, name: group.displayName }))} onChange={value => changeFacet('baseGroupId', value)} loading={catalogLoading} /><MembershipFilter label="附加用户组" value={facets.additionalGroupId} items={groups.filter(group => !group.isBase).map(group => ({ id: group.id, name: group.displayName }))} onChange={value => changeFacet('additionalGroupId', value)} loading={catalogLoading} /></>}
          {canFilterGrowth && <MembershipFilter label="成长等级" value={facets.growthLevelId} items={growthLevels.map(level => ({ id: level.id, name: level.displayName }))} onChange={value => changeFacet('growthLevelId', value)} loading={catalogLoading} />}
          {canFilterEntitlements && <MembershipFilter label="会员权益" value={facets.entitlementTypeId} items={entitlementTypes.map(type => ({ id: type.id, name: type.displayName }))} onChange={value => changeFacet('entitlementTypeId', value)} loading={catalogLoading} />}
          <div className="user-catalog-date-range" role="group" aria-label="最后活跃时间"><span>活跃</span><Clock3 size={15} aria-hidden="true" /><input type="date" aria-label="活跃开始日期" max={activeThroughDraft || undefined} value={activeFromDraft} onChange={event => setActiveFromDraft(event.target.value)} /><span aria-hidden="true">→</span><input type="date" aria-label="活跃结束日期" min={activeFromDraft || undefined} value={activeThroughDraft} onChange={event => setActiveThroughDraft(event.target.value)} /></div>
          <button className="primary-button" type="submit"><Search size={14} aria-hidden="true" />搜索</button><button className="secondary-button" type="button" onClick={resetFilters}>重置</button>
        </form>
        {fromDraft && throughDraft && fromDraft > throughDraft ? <p className="form-alert" role="alert">结束日期不能早于开始日期</p> : null}
        {activeFromDraft && activeThroughDraft && activeFromDraft > activeThroughDraft ? <p className="form-alert" role="alert">活跃结束日期不能早于开始日期</p> : null}
        {catalogError && <div className="form-alert" role="alert">{catalogError}<button className="secondary-button" type="button" onClick={() => setCatalogReload(value => value + 1)}>重试会员筛选目录</button></div>}
        {rolesError && <p className="form-alert" role="alert">{rolesError}</p>}
      <section className="user-catalog-panel" aria-label="用户目录">
        <div className="user-catalog-tabs" role="group" aria-label="按用户状态筛选">{(["all", "active", "restricted", "suspended"] as const).map((status) => <button type="button" key={status} aria-label={status === "all" ? "全部" : statusLabels[status]} aria-pressed={statusFilter === status} onClick={() => changeStatus(status)}><span>{status === "all" ? "全部" : statusLabels[status]}<small className={"user-catalog-tab-count user-catalog-tab-count--" + status}>{listState === "loading" ? "—" : statusCounts[status].toLocaleString()}</small></span></button>)}</div>
        {selectedUsers.length > 0 && <div className="user-catalog-selection"><span>已选择 {selectedUsers.length} 位用户</span><button type="button" onClick={() => setCheckedIds(new Set())}>取消选择</button></div>}
        {notice && <p className="user-catalog-notice" role="status">{notice}</p>}
        {listState === "loading" ? <PanelState kind="loading" text="正在读取用户列表" /> : null}
        {listState === "error" ? <PanelState kind="error" text={listError} onRetry={() => setReload((value) => value + 1)} /> : null}
        {listState === "ready" && !users.length ? <PanelState kind="empty" text="没有找到符合条件的用户" /> : null}
        {listState === "ready" && users.length > 0 && <div className="user-catalog-table" role="table" aria-label="用户列表">
          <div role="rowgroup"><div className="user-catalog-columns" role="row"><span role="columnheader"><input type="checkbox" aria-label="选择当前用户" checked={selectedUsers.length === users.length} ref={(input) => { if (input) input.indeterminate = selectedUsers.length > 0 && selectedUsers.length < users.length }} onChange={(event) => setCheckedIds(event.target.checked ? new Set(users.map((user) => user.id)) : new Set())} /></span>{["用户", "基础身份 / 附加身份", "成长等级 / EXP", "积分", "会员权益", "账号状态", "注册时间", "最后活跃", "操作"].map((label) => <span role="columnheader" key={label}>{label}</span>)}</div></div>
          <div role="rowgroup">{users.map((user) => <div className="user-catalog-row" role="row" key={user.id} data-active={selectedId === user.id || undefined} data-checked={checkedIds.has(user.id) || undefined}>
            <div role="cell" className="user-catalog-check"><input type="checkbox" aria-label={"选择用户：" + user.username} checked={checkedIds.has(user.id)} onChange={(event) => setCheckedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(user.id); else next.delete(user.id); return next })} /></div>
            <div role="cell" className="user-catalog-identity"><UserAvatar username={user.username} displayName={user.displayName} avatarUrl={user.avatarUrl} size="small" /><div><strong>{user.displayName}</strong><span>@{user.username}</span></div></div>
            <div role="cell" className="user-catalog-groups" data-label="身份">{membershipCell(user, 'groups', user.membership?.groups?.length ? <>{user.membership.groups.filter(group => group.membershipKind === 'base').map(group => <strong key={group.id}>{group.displayName}</strong>)}{!user.membership.groups.some(group => group.membershipKind === 'base') && <span>无有效基础组</span>}<small>{user.membership.groups.filter(group => group.membershipKind === 'additional').map(group => group.displayName).join('、') || '无附加身份'}</small></> : '无有效身份')}</div>
            <div role="cell" className="user-catalog-growth" data-label="成长">{membershipCell(user, 'experience', <UserGrowth membership={user.membership} levels={canFilterGrowth ? growthLevels : []} />)}</div>
            <div role="cell" className="user-catalog-points" data-label="积分">{membershipCell(user, 'points', user.membership?.pointsBalance?.toLocaleString() ?? '未初始化')}</div>
            <div role="cell" className="user-catalog-entitlements" data-label="会员权益">{membershipCell(user, 'entitlements', user.membership?.entitlements?.map(item => item.displayName).join('、') || '无有效权益')}</div>
            <div role="cell" className="user-catalog-status" data-label="账号状态"><span className={"user-status user-status--" + user.status}>{statusLabels[user.status]}</span></div>
            <div role="cell" className="user-catalog-registered" data-label="注册"><time dateTime={user.createdAt}>{formatDate(user.createdAt)}</time></div><div role="cell" className="user-catalog-seen" data-label="活跃">{user.lastSeenAt ? <time dateTime={user.lastSeenAt}>{formatDate(user.lastSeenAt, true)}</time> : "暂无活动"}</div>
            <div role="cell" className="user-catalog-actions"><button className="icon-button" type="button" aria-label={user.displayName + " @" + user.username} aria-expanded={selectedId === user.id} title="查看用户详情" onClick={() => void openUser(user.id)}><MoreHorizontal size={17} aria-hidden="true" /></button></div>
          </div>)}</div>
        </div>}
        {listState === "ready" && listError ? <p className="form-alert" role="alert">{listError}</p> : null}
        <footer className="user-catalog-footer"><button className="secondary-button user-catalog-mobile-select" type="button" disabled={listState !== "ready" || !users.length} onClick={() => setCheckedIds(selectedUsers.length === users.length ? new Set() : new Set(users.map(user => user.id)))}>{users.length > 0 && selectedUsers.length === users.length ? "取消全选" : "全选已加载用户"}</button><div><span>已加载 {users.length} 位用户{nextCursor ? "，还有更多结果" : ""}</span><small>统计和导出仅包含当前筛选下已加载的用户</small></div><label><span className="sr-only">每次加载用户数</span><select aria-label="每次加载用户数" value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={20}>20 位 / 次</option><option value={50}>50 位 / 次</option></select></label>{listState === "ready" && nextCursor ? <button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void loadMoreUsers()}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : null}加载更多用户</button> : null}</footer>
      </section>
        {selectedId ? <Drawer title="用户详情" headingLevel={2} busy={detailBusy} onClose={() => closeUser()}>
        <section ref={detailScroll} className="user-admin-detail" aria-label="用户详情">
          {selectedId && detailState === "loading" ? <PanelState kind="loading" text="正在读取用户详情" /> : null}
          {selectedId && detailState === "error" ? <PanelState kind="error" text={detailError} onRetry={() => void openUser(selectedId)} /> : null}
          {detail ? <UserDetail
            key={detail.id}
            detail={detail}
            tab={detailTab}
            onTabChange={(tab) => { if (!detailBusy) setDetailTab(tab) }}
            canReadGroups={canReadGroups && canReadGroupMemberships}
            canWriteGroupMemberships={canWriteGroupMemberships}
            membershipBusy={detailBusy}
            onMembershipBusyChange={setDetailBusy}
            canModerate={canModerate}
            canAssignRoles={canAssignRoles}
            canReadAudit={canReadAudit}
            canReadReports={canReadReports}
            csrfToken={csrfToken}
            boards={boards}
            capabilityKeys={capabilityKeys}
            onMembershipChanged={() => setReload(value => value + 1)}
            onStatusUpdated={(update) => updateSelectedUser(detail.id, update)}
            onRolesUpdated={(roles) => updateSelectedRoles(detail.id, roles)}
            onRefreshed={(fresh) => { setDetail((current) => current?.id === fresh.id && fresh.id === detail.id && fresh.revision >= current.revision ? fresh : current); setReload((value) => value + 1) }}
          /> : null}
        </section>
        <footer className="user-detail-navigation">
          <p aria-live="polite">{listState === "loading" ? "正在更新用户列表…" : listState === "error" ? "列表暂时不可用，请返回重试" : selectedIndex < 0 ? "该用户已不在当前筛选结果中" : `已加载用户 ${selectedIndex + 1} / ${users.length}`}</p>
          <div>
            <button className="secondary-button" type="button" aria-label="上一位用户" disabled={navigationDisabled || selectedIndex <= 0} onClick={() => void openUser(users[selectedIndex - 1].id)}><ChevronLeft size={15} aria-hidden="true" />上一位</button>
            <button className="user-detail-return" type="button" disabled={detailBusy} onClick={() => closeUser()}>返回列表</button>
            <button className="secondary-button" type="button" aria-label="下一位用户" disabled={navigationDisabled || selectedIndex < 0 || selectedIndex >= users.length - 1} onClick={() => void openUser(users[selectedIndex + 1].id)}>下一位<ChevronRight size={15} aria-hidden="true" /></button>
          </div>
        </footer>
        </Drawer> : null}
    </section>
  )
}

interface UserDetailProps {
  detail: AdminUserDetail
  tab: DetailTab
  onTabChange: (tab: DetailTab) => void
  canModerate: boolean
  canAssignRoles: boolean
  canReadAudit: boolean
  canReadReports: boolean
  canReadGroups: boolean
  canWriteGroupMemberships: boolean
  membershipBusy: boolean
  onMembershipBusyChange: (busy: boolean) => void
  csrfToken: string
  boards: AdminBoard[]
  capabilityKeys: string[]
  onStatusUpdated: (update: { status: AdminUserStatus; reason: string | null; expiresAt: string | null; revision: number }) => void
  onRolesUpdated: (roles: AdminUserDetail["roles"]) => void
  onRefreshed: (detail: AdminUserDetail) => void
  onMembershipChanged: () => void
}

function UserDetail({ detail, tab, onTabChange, canModerate, canAssignRoles, canReadAudit, canReadReports, canReadGroups, canWriteGroupMemberships, membershipBusy, onMembershipBusyChange, csrfToken, boards, capabilityKeys, onStatusUpdated, onRolesUpdated, onRefreshed, onMembershipChanged }: UserDetailProps) {
  const accountRefresh = useRef(onRefreshed)
  accountRefresh.current = onRefreshed
  const [membership, setMembership] = useState<{ key: string; value: AdminUserMembershipSummary } | null>(null)
  const [membershipError, setMembershipError] = useState("")
  const [membershipLoading, setMembershipLoading] = useState(true)
  const [membershipReload, setMembershipReload] = useState(0)
  const [membershipVisited, setMembershipVisited] = useState(false)
  const [reportView, setReportView] = useState(false)
  const snapshotKey = JSON.stringify([detail.id, canReadGroups, [...capabilityKeys].sort()])
  const summary = membership?.key === snapshotKey ? membership.value : null
  const readableSections: AdminUserMembershipSection[] = [
    ...(canReadGroups ? ["groups" as const] : []),
    ...(capabilityKeys.includes("membership.rules.read") ? ["experience" as const] : []),
    ...(capabilityKeys.includes("membership.points.grant") ? ["points" as const] : []),
    ...(capabilityKeys.includes("membership.medals.read") ? ["medals" as const] : []),
    ...(capabilityKeys.includes("entitlements.grants.read") ? ["entitlements" as const] : []),
  ]
  useEffect(() => {
    const controller = new AbortController()
    setMembership(null); setMembershipLoading(true); setMembershipError("")
    getAdminUserMembershipSummary(detail.id, controller.signal).then(value => {
      if (!controller.signal.aborted) {
        setMembership({key: snapshotKey, value}); setMembershipLoading(false)
        if (value.account.revision > detail.revision) accountRefresh.current(value.account)
      }
    }).catch(reason => {
      if (!controller.signal.aborted) { setMembershipError(reason instanceof AdminUsersApiError ? reason.message : "会员档案暂时无法加载"); setMembershipLoading(false) }
    })
    return () => controller.abort()
  }, [detail.id, snapshotKey, membershipReload])
  useEffect(() => { if (tab === "membership") setMembershipVisited(true) }, [tab])
  function membershipChanged() { setMembershipReload(value => value + 1); onMembershipChanged() }
  const canCheckPermissions = permissionCheckCapabilities.every(key => capabilityKeys.includes(key))
  useEffect(() => { if (tab === "permissions" && !canCheckPermissions) onTabChange("overview") }, [tab, canCheckPermissions, onTabChange])
  const tabSetId = useId()
  const [copyMessage, setCopyMessage] = useState("")
  const websiteHref = safeWebsiteHref(detail.websiteUrl)
  async function copyUserId() {
    try { await navigator.clipboard.writeText(detail.id); setCopyMessage("用户 ID 已复制") }
    catch { setCopyMessage("复制失败，请手动选择用户 ID") }
  }
  function showAllActivity() {
    onTabChange("content")
    queueMicrotask(() => document.getElementById(`${tabSetId}-content-tab`)?.focus())
  }
  const tabAttributes = (name: DetailTab) => ({
    id: `${tabSetId}-${name}-tab`,
    "aria-controls": `${tabSetId}-${name}-panel`,
    "aria-selected": tab === name,
    tabIndex: tab === name ? 0 : -1,
  })
  const panelAttributes = (name: DetailTab) => ({
    id: `${tabSetId}-${name}-panel`,
    "aria-labelledby": `${tabSetId}-${name}-tab`,
    role: "tabpanel" as const,
    hidden: tab !== name,
    tabIndex: 0,
  })
  const visibleTabs: DetailTab[] = ["overview", "membership", ...(canCheckPermissions ? ["permissions" as const] : []), "content", "security", ...(canReadAudit ? ["audit" as const] : [])]
  const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, name: DetailTab) => {
    const index = visibleTabs.indexOf(name)
    let nextIndex: number | null = null
    if (event.key === "ArrowRight") nextIndex = index + 1
    else if (event.key === "ArrowLeft") nextIndex = index - 1
    else if (event.key === "Home") nextIndex = 0
    else if (event.key === "End") nextIndex = visibleTabs.length - 1
    if (nextIndex === null || membershipBusy) return
    event.preventDefault()
    const next = visibleTabs[(nextIndex + visibleTabs.length) % visibleTabs.length]
    onTabChange(next)
    document.getElementById(`${tabSetId}-${next}-tab`)?.focus()
  }
  return <div className="user-admin-detail__content">
    <header className="user-detail-profile">
      <div className="user-detail-identity"><UserAvatar username={detail.username} displayName={detail.displayName} avatarUrl={detail.avatarUrl} size="large" /><div><h2>{detail.displayName}</h2><span>@{detail.username}</span></div><span className={"user-status user-status--" + detail.status}>{statusLabels[detail.status]}</span></div>
      <p className="user-detail-bio">{detail.bio || "这位用户还没有填写个人简介。"}</p>
      <div className="user-detail-profile-links"><a className="user-catalog-profile-link" aria-disabled={membershipBusy || undefined} tabIndex={membershipBusy ? -1 : undefined} onClick={event => { if (membershipBusy) event.preventDefault() }} href={"#user/" + encodeURIComponent(detail.username)}>查看用户主页<ExternalLink size={13} aria-hidden="true" /></a><span>已关注 {detail.followingCount.toLocaleString()} 人</span></div>
      <div className="user-detail-id"><span>UID：<span>{detail.id}</span></span><button className="icon-button" type="button" aria-label="复制用户 ID" title="复制用户 ID" onClick={() => void copyUserId()}><Copy size={14} aria-hidden="true" /></button></div>
      {copyMessage && <p role="status">{copyMessage}</p>}
      <UserMembershipIdentity summary={summary} readableSections={readableSections} loading={membershipLoading} />
      {membershipError && <p className="form-alert" role="alert">{membershipError}<button className="secondary-button" type="button" disabled={membershipBusy} onClick={() => setMembershipReload(value => value + 1)}>重试会员档案</button></p>}
    </header>
    <div className="user-admin-tabs" role="tablist" aria-label="用户详情分类">
      {visibleTabs.map(name => <button type="button" role="tab" key={name} disabled={membershipBusy} {...tabAttributes(name)} onClick={() => onTabChange(name)} onKeyDown={event => handleTabKey(event, name)}>{{ overview: "概览", membership: "会员身份", permissions: "有效权限", content: "内容", security: "账号安全", audit: "管理记录" }[name]}</button>)}
    </div>
    {<div className="user-admin-overview" {...panelAttributes("overview")}>
      <dl className="user-catalog-facts user-detail-facts">
        <div><dt><CalendarDays size={14} aria-hidden="true" />注册时间</dt><dd>{formatDate(detail.createdAt, true)}</dd></div>
        <div><dt><Clock3 size={14} aria-hidden="true" />最后活跃</dt><dd>{detail.lastSeenAt ? formatDate(detail.lastSeenAt, true) : "暂无活动"}</dd></div>
        <div><dt><MapPin size={14} aria-hidden="true" />所在地区</dt><dd>{detail.location || "未填写"}</dd></div>
        <div><dt><Globe size={14} aria-hidden="true" />个人网站</dt><dd>{websiteHref ? <a href={websiteHref} target="_blank" rel="noopener noreferrer">{detail.websiteUrl}</a> : detail.websiteUrl || "未填写"}</dd></div>
      </dl>
      <dl className="user-catalog-detail-stats">
        <div><dt>主题</dt><dd>{detail.topicCount.toLocaleString()}</dd></div><div><dt>回复</dt><dd>{detail.postCount.toLocaleString()}</dd></div><div><dt>相关举报</dt><dd>{detail.reportCount.toLocaleString()}</dd></div><div><dt>粉丝</dt><dd>{detail.followerCount.toLocaleString()}</dd></div>
      </dl>
      <section className="user-detail-recent"><div className="user-detail-section-heading"><h3>最近动态</h3><button className="link-button" type="button" onClick={showAllActivity}>查看全部动态 <ExternalLink size={12} aria-hidden="true" /></button></div><UserActivityPanel userId={detail.id} kind="content" preview /></section>
    </div>}
    {canCheckPermissions ? <div {...panelAttributes("permissions")}>{tab === "permissions" && <PermissionCheckPanel key={detail.id} boards={boards} capabilityKeys={capabilityKeys} fixedUser={detail} />}</div> : null}
    <div {...panelAttributes("security")} className="user-admin-overview">      <section className="user-detail-roles"><h3><Shield size={15} aria-hidden="true" />权限角色</h3>{canAssignRoles ? <UserRoleAction detail={detail} csrfToken={csrfToken} boards={boards} onRolesUpdated={onRolesUpdated} /> : detail.roles.length ? <ul>{detail.roles.map((role) => <li key={role.id}><span className="user-role-check" aria-hidden="true"><Check size={11} /></span><span>{role.name}</span><small className="sr-only">{role.scope === "board" ? "板块范围" : role.scope === "site" ? "站点范围" : "实例范围"}</small></li>)}</ul> : <p>普通成员</p>}</section>
      {detail.status !== "active" ? <section className="user-admin-restriction"><h3><AlertCircle size={15} aria-hidden="true" />当前限制</h3><p>{detail.restrictionReason ?? "未记录原因"}</p><small>{detail.restrictionExpiresAt ? `到期：${formatDate(detail.restrictionExpiresAt, true)}` : "永久有效，直到管理员恢复"}</small></section> : null}
      {canModerate ? <UserStatusAction detail={detail} csrfToken={csrfToken} onUpdated={onStatusUpdated} onRefreshed={onRefreshed} /> : null}
</div>
    <div {...panelAttributes("membership")}>{membershipVisited && <UserMembershipPanel summary={summary} readableSections={readableSections} loading={membershipLoading}>
      <UserMembershipActions user={detail} summary={summary} readableSections={readableSections} loading={membershipLoading} capabilityKeys={capabilityKeys} csrfToken={csrfToken} canWriteGroups={canWriteGroupMemberships} onBusyChange={onMembershipBusyChange} onChanged={membershipChanged} onRetry={() => setMembershipReload(value => value + 1)} />
    </UserMembershipPanel>}</div>
    <div {...panelAttributes("content")}>{tab === "content" && <><h3 className="user-detail-content-heading">用户内容</h3><div role="group" aria-label="用户内容分类"><button type="button" className="secondary-button" aria-pressed={!reportView} onClick={() => setReportView(false)}>最近内容</button><button type="button" className="secondary-button" aria-pressed={reportView} onClick={() => setReportView(true)}>相关举报</button></div><UserActivityPanel key={detail.id + reportView} userId={detail.id} kind={reportView ? "reports" : "content"} canReadReports={canReadReports} /></>}</div>
    {canReadAudit && <div {...panelAttributes("audit")}>{tab === "audit" && <RelatedAuditLog filter={{ userId: detail.id }} title="管理记录" headingLevel={3} />}</div>}
    <PluginUiSurface slot="admin_user" subjectId={detail.id} csrfToken={canModerate ? csrfToken : undefined} />
  </div>
}

function PanelState({ kind, text, onRetry }: { kind: "loading" | "empty" | "error"; text: string; onRetry?: () => void }) {
  return <div className={`user-admin-state user-admin-state--${kind}`} role={kind === "error" ? "alert" : "status"}>
    {kind === "loading" ? <LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /> : kind === "error" ? <AlertCircle size={20} aria-hidden="true" /> : <UserRound size={20} aria-hidden="true" />}
    <span>{text}</span>
    {onRetry ? <button className="secondary-button" type="button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />重试</button> : null}
  </div>
}

function filtersFromQuery(query: string): { query: string; status: AdminUserStatus | "all"; roleId: string; from: string; through: string; facets: MembershipFacets } {
  const params = new URLSearchParams(query)
  const status = params.get("status")
  return {
    query: params.get("q") ?? "",
    roleId: params.get("role") ?? "",
    facets: { baseGroupId: params.get("base_group") ?? "", additionalGroupId: params.get("additional_group") ?? "", growthLevelId: params.get("growth_level") ?? "", entitlementTypeId: params.get("entitlement_type") ?? "", activeFrom: validDate(params.get("active_from")), activeThrough: validDate(params.get("active_through")) },
    from: validDate(params.get("from")),
    through: validDate(params.get("through")),
    status: status === "active" || status === "restricted" || status === "suspended" ? status : "all",
  }
}

function publishFilters(query: string, status: AdminUserStatus | "all", roleId: string, from: string, through: string, onQueryChange?: (query: string) => void, currentQuery = "", facets: MembershipFacets = emptyFacets) {
  const params = new URLSearchParams(adminObjectQuery(currentQuery, "user_id", null))
  for (const key of ["q", "status", "role", "from", "through", "base_group", "additional_group", "growth_level", "entitlement_type", "active_from", "active_through"]) params.delete(key)
  if (query) params.set("q", query)
  if (status !== "all") params.set("status", status)
  if (roleId) params.set("role", roleId)
  if (from) params.set("from", from)
  if (through) params.set("through", through)
  for (const [key, value] of [["base_group", facets.baseGroupId], ["additional_group", facets.additionalGroupId], ["growth_level", facets.growthLevelId], ["entitlement_type", facets.entitlementTypeId], ["active_from", facets.activeFrom], ["active_through", facets.activeThrough]]) if (value) params.set(key!, value)
  onQueryChange?.(params.toString())
}

function safeWebsiteHref(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch { return null }
}

function formatDate(value: string, withTime = false): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "未知" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit" } as const : {}) }).format(date)
}

function validDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value + "T00:00:00").getTime()) ? value : ""
}

function dateBoundary(value: string, end = false): string | undefined {
  if (!value) return undefined
  const date = new Date(value + "T00:00:00")
  if (end) date.setDate(date.getDate() + 1)
  return date.toISOString()
}

function facetOptions(facets: MembershipFacets) {
  return { baseGroupId: facets.baseGroupId || undefined, additionalGroupId: facets.additionalGroupId || undefined, growthLevelId: facets.growthLevelId || undefined, entitlementTypeId: facets.entitlementTypeId || undefined, lastActiveAfter: dateBoundary(facets.activeFrom), lastActiveBefore: dateBoundary(facets.activeThrough, true) }
}
function MembershipFilter({ label, value, items, onChange, loading }: { label: string; value: string; items: { id: string; name: string }[]; onChange: (value: string) => void; loading: boolean }) {
  return <select aria-label={label} value={value} aria-busy={loading} onChange={event => onChange(event.target.value)}><option value="">全部{label}</option>{value && !items.some(item => item.id === value) && <option value={value}>指定{label}</option>}{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
}
function UserGrowth({ membership, levels }: { membership: AdminUserSummary["membership"]; levels: AdminGrowthLevel[] }) {
  const level = membership?.level
  const experience = membership?.experience
  if (!level || experience == null) return '未初始化'
  const current = levels.find(item => item.id === level.id)
  const next = levels.filter(item => item.status === 'published' && item.levelOrder > level.levelOrder && item.requiredExperience > experience).sort((left, right) => left.levelOrder - right.levelOrder)[0]
  const progressLabel = next ? '距' + next.displayName + '还需 ' + (next.requiredExperience - experience).toLocaleString() + ' EXP' : '已达到当前最高成长阶段'
  return <>
    <strong>Lv.{level.levelOrder} · {level.displayName}</strong>
    <small>EXP {experience.toLocaleString()}</small>
    {current ? <div className="user-catalog-growth-progress" title={progressLabel}>
      <GrowthProgress experience={experience} currentThreshold={current.requiredExperience} nextThreshold={next?.requiredExperience ?? null} />
      <span className="sr-only">{progressLabel}</span>
    </div> : <small>进度暂不可用</small>}
  </>
}

function membershipCell(user: AdminUserSummary, section: 'groups' | 'experience' | 'points' | 'entitlements', content: React.ReactNode): React.ReactNode {
  if (!user.membership) return '未提供会员档案'
  return user.membership.readableSections.includes(section) ? content : '无权查看'
}

function sameFacets(left: MembershipFacets, right: MembershipFacets): boolean {
  return (Object.keys(emptyFacets) as (keyof MembershipFacets)[]).every(key => left[key] === right[key])
}
