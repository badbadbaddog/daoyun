import { AlertCircle, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, Download, Globe, Hash, MapPin, ExternalLink, LoaderCircle, MoreHorizontal, RefreshCw, Search, Shield, ShieldAlert, UserRound, Users } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import {
  AdminUsersApiError,
  getAdminUser,
  listAdminUsers,
  type AdminUserDetail,
  type AdminUserStatus,
  type AdminUserSummary,
} from "../api/adminUsers"
import { listAuthorizationRoles, type AdminBoard, type AuthorizationRole } from "../api/admin"
import { encodeCsv } from "../lib/csv"
import { UserActivityPanel } from "./UserActivityPanel"
import { UserAvatar } from "./UserAvatar"
import { UserRoleAction } from "./UserRoleAction"
import { UserStatusAction } from "./UserStatusAction"
import { RelatedAuditLog } from "./RelatedAuditLog"
import { PluginUiSurface } from "./PluginUiSurface"
import { Drawer } from "./ui/Drawer"

interface UserAdminPanelProps {
  requestedQuery?: string
  onQueryChange?: (query: string) => void
  csrfToken?: string
  canModerate?: boolean
  canReadRoles?: boolean
  canAssignRoles?: boolean
  canReadAudit?: boolean
  canReadReports?: boolean
  boards?: AdminBoard[]
}

type LoadState = "loading" | "ready" | "error"
type DetailTab = "overview" | "content" | "reports" | "audit"

const statusLabels: Record<AdminUserStatus, string> = {
  active: "正常",
  restricted: "已限制",
  suspended: "已暂停",
}

export function UserAdminPanel({ requestedQuery = "", onQueryChange, csrfToken = "", canModerate = false, canAssignRoles = false, canReadRoles = false, canReadAudit = false, canReadReports = false, boards = [] }: UserAdminPanelProps) {
  const initialFilters = filtersFromQuery(requestedQuery)
  const [queryDraft, setQueryDraft] = useState(initialFilters.query)
  const [query, setQuery] = useState(initialFilters.query)
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | "all">(initialFilters.status)
  const [roleId, setRoleId] = useState(initialFilters.roleId)
  const [from, setFrom] = useState(initialFilters.from)
  const [through, setThrough] = useState(initialFilters.through)
  const [fromDraft, setFromDraft] = useState(initialFilters.from)
  const [throughDraft, setThroughDraft] = useState(initialFilters.through)
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
  const detailRequest = useRef<AbortController | null>(null)
  const listRequestVersion = useRef(0)
  const detailScroll = useRef<HTMLElement>(null)
  const selectedIndex = users.findIndex((user) => user.id === selectedId)
  const navigationDisabled = detailState === "loading" || listState !== "ready"

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
  }, [requestedQuery])

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
    const requestVersion = ++listRequestVersion.current
    setListState("loading")
    setUsers([])
    setCheckedIds(new Set())
    setNotice("")
    morePending.current = false
    setLoadingMore(false)
    setListError("")
    setNextCursor(null)
    listAdminUsers({ query: query || undefined, status: statusFilter === "all" ? undefined : statusFilter, roleId: roleId || undefined, registeredAfter: dateBoundary(from), registeredBefore: dateBoundary(through, true), limit, signal: controller.signal })
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
  }, [query, reload, statusFilter, roleId, from, through, limit])

  useEffect(() => () => detailRequest.current?.abort(), [])

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    if (fromDraft && throughDraft && fromDraft > throughDraft) return
    const nextQuery = queryDraft.trim()
    setFrom(fromDraft); setThrough(throughDraft)
    setQuery(nextQuery)
    publishFilters(nextQuery, statusFilter, roleId, fromDraft, throughDraft, onQueryChange)
  }

  function changeStatus(nextStatus: AdminUserStatus | "all") {
    setStatusFilter(nextStatus)
    publishFilters(query, nextStatus, roleId, from, through, onQueryChange)
  }

  async function loadMoreUsers() {
    if (!nextCursor || morePending.current || listState !== "ready") return
    morePending.current = true
    const requestVersion = listRequestVersion.current
    setLoadingMore(true)
    setListError("")
    try {
      const page = await listAdminUsers({ query: query || undefined, status: statusFilter === "all" ? undefined : statusFilter, roleId: roleId || undefined, registeredAfter: dateBoundary(from), registeredBefore: dateBoundary(through, true), cursor: nextCursor, limit })
      if (requestVersion !== listRequestVersion.current) return
      setUsers((current) => [...current, ...page.users.filter((item) => !current.some((loaded) => loaded.id === item.id))])
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (requestVersion === listRequestVersion.current) setListError(reason instanceof AdminUsersApiError ? reason.message : "更多用户暂时无法加载")
    } finally {
      if (requestVersion === listRequestVersion.current) { morePending.current = false; setLoadingMore(false) }
    }
  }

  async function openUser(userId: string) {
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

  function updateSelectedUser(statusUpdate: { status: AdminUserStatus; reason: string | null; expiresAt: string | null; revision: number }) {
    setDetail((current) => current ? {
      ...current,
      status: statusUpdate.status,
      restrictionReason: statusUpdate.reason,
      restrictionExpiresAt: statusUpdate.expiresAt,
      revision: statusUpdate.revision,
    } : current)
    setUsers((current) => current.map((user) => user.id === selectedId ? { ...user, status: statusUpdate.status } : user).filter((user) => statusFilter === "all" || user.status === statusFilter))
  }

  function closeUser() {
    detailRequest.current?.abort()
    setSelectedId(null)
    setDetail(null)
    queueMicrotask(() => (opener.current?.isConnected ? opener.current : searchInput.current)?.focus())
  }

  function updateSelectedRoles(roles: AdminUserDetail["roles"]) {
    setReload(value => value + 1)
    setDetail(current => current ? { ...current, roles, primaryRole: roles.some(role => role.name === current.primaryRole) ? current.primaryRole : roles[0]?.name ?? null } : current)
  }

  function resetFilters() {
    setQueryDraft(""); setQuery(""); setStatusFilter("all"); setRoleId("")
    setFrom(""); setThrough(""); setFromDraft(""); setThroughDraft("")
    setCheckedIds(new Set()); setNotice(""); publishFilters("", "all", "", "", "", onQueryChange)
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
    const csv = encodeCsv([["用户 ID", "昵称", "用户名", "主要角色", "状态", "主题数", "回复数", "相关举报数", "注册时间", "最后活跃"], ...rows.map((user) => [user.id, user.displayName, user.username, user.primaryRole ?? "普通成员", statusLabels[user.status], user.topicCount, user.postCount, user.reportCount, user.createdAt, user.lastSeenAt ?? ""])])
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
          {(canReadRoles || canAssignRoles) && <select aria-label="用户角色" value={roleId} onChange={(event) => { setRoleId(event.target.value); publishFilters(query, statusFilter, event.target.value, from, through, onQueryChange) }}><option value="">全部角色</option>{roleId && !roles.some((role) => role.id === roleId) && <option value={roleId}>指定角色</option>}{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>}
          <select aria-label="用户状态" value={statusFilter} onChange={(event) => changeStatus(event.target.value as AdminUserStatus | "all")}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <div className="user-catalog-date-range" role="group" aria-label="注册时间"><CalendarDays size={15} aria-hidden="true" /><label className="user-catalog-date"><span className="sr-only">注册起</span><input type="date" aria-label="注册开始日期" max={throughDraft || undefined} value={fromDraft} onChange={(event) => setFromDraft(event.target.value)} /></label>
          <span aria-hidden="true">→</span><label className="user-catalog-date"><span className="sr-only">至</span><input type="date" aria-label="注册结束日期" min={fromDraft || undefined} value={throughDraft} onChange={(event) => setThroughDraft(event.target.value)} /></label></div>
          <button className="primary-button" type="submit"><Search size={14} aria-hidden="true" />搜索</button><button className="secondary-button" type="button" onClick={resetFilters}>重置</button>
        </form>
        {fromDraft && throughDraft && fromDraft > throughDraft ? <p className="form-alert" role="alert">结束日期不能早于开始日期</p> : null}
        {rolesError && <p className="form-alert" role="alert">{rolesError}</p>}
      <section className="user-catalog-panel" aria-label="用户目录">
        <div className="user-catalog-tabs" role="group" aria-label="按用户状态筛选">{(["all", "active", "restricted", "suspended"] as const).map((status) => <button type="button" key={status} aria-label={status === "all" ? "全部" : statusLabels[status]} aria-pressed={statusFilter === status} onClick={() => changeStatus(status)}><span>{status === "all" ? "全部" : statusLabels[status]}<small className={"user-catalog-tab-count user-catalog-tab-count--" + status}>{listState === "loading" ? "—" : statusCounts[status].toLocaleString()}</small></span></button>)}</div>
        {selectedUsers.length > 0 && <div className="user-catalog-selection"><span>已选择 {selectedUsers.length} 位用户</span><button type="button" onClick={() => setCheckedIds(new Set())}>取消选择</button></div>}
        {notice && <p className="user-catalog-notice" role="status">{notice}</p>}
        {listState === "loading" ? <PanelState kind="loading" text="正在读取用户列表" /> : null}
        {listState === "error" ? <PanelState kind="error" text={listError} onRetry={() => setReload((value) => value + 1)} /> : null}
        {listState === "ready" && !users.length ? <PanelState kind="empty" text="没有找到符合条件的用户" /> : null}
        {listState === "ready" && users.length > 0 && <div className="user-catalog-table" role="table" aria-label="用户列表">
          <div role="rowgroup"><div className="user-catalog-columns" role="row"><span role="columnheader"><input type="checkbox" aria-label="选择当前用户" checked={selectedUsers.length === users.length} ref={(input) => { if (input) input.indeterminate = selectedUsers.length > 0 && selectedUsers.length < users.length }} onChange={(event) => setCheckedIds(event.target.checked ? new Set(users.map((user) => user.id)) : new Set())} /></span>{["用户信息", "主要角色", "状态", "主题", "回复", "相关举报", "注册时间", "最后活跃", "操作"].map((label) => <span role="columnheader" key={label}>{label}</span>)}</div></div>
          <div role="rowgroup">{users.map((user) => <div className="user-catalog-row" role="row" key={user.id} data-active={selectedId === user.id || undefined} data-checked={checkedIds.has(user.id) || undefined}>
            <div role="cell" className="user-catalog-check"><input type="checkbox" aria-label={"选择用户：" + user.username} checked={checkedIds.has(user.id)} onChange={(event) => setCheckedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(user.id); else next.delete(user.id); return next })} /></div>
            <div role="cell" className="user-catalog-identity"><UserAvatar username={user.username} displayName={user.displayName} avatarUrl={user.avatarUrl} size="small" /><div><strong>{user.displayName}</strong><span>@{user.username}</span></div></div>
            <div role="cell" className="user-catalog-role"><span>{user.primaryRole ?? "普通成员"}</span></div>
            <div role="cell" className="user-catalog-status"><span className={"user-status user-status--" + user.status}>{statusLabels[user.status]}</span></div>
            <div role="cell" className="user-catalog-count" data-label="主题">{user.topicCount.toLocaleString()}</div><div role="cell" className="user-catalog-count" data-label="回复">{user.postCount.toLocaleString()}</div><div role="cell" className="user-catalog-count" data-label="相关举报">{user.reportCount.toLocaleString()}</div>
            <div role="cell" className="user-catalog-registered" data-label="注册"><time dateTime={user.createdAt}>{formatDate(user.createdAt)}</time></div><div role="cell" className="user-catalog-seen" data-label="活跃">{user.lastSeenAt ? <time dateTime={user.lastSeenAt}>{formatDate(user.lastSeenAt, true)}</time> : "暂无活动"}</div>
            <div role="cell" className="user-catalog-actions"><button className="icon-button" type="button" aria-label={user.displayName + " @" + user.username} aria-expanded={selectedId === user.id} title="查看用户详情" onClick={() => void openUser(user.id)}><MoreHorizontal size={17} aria-hidden="true" /></button></div>
          </div>)}</div>
        </div>}
        {listState === "ready" && listError ? <p className="form-alert" role="alert">{listError}</p> : null}
        <footer className="user-catalog-footer"><div><span>已加载 {users.length} 位用户{nextCursor ? "，还有更多结果" : ""}</span><small>统计和导出仅包含当前筛选下已加载的用户</small></div><label><span className="sr-only">每次加载用户数</span><select aria-label="每次加载用户数" value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={20}>20 位 / 次</option><option value={50}>50 位 / 次</option></select></label>{listState === "ready" && nextCursor ? <button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void loadMoreUsers()}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : null}加载更多用户</button> : null}</footer>
      </section>
        {selectedId ? <Drawer title="用户详情" onClose={closeUser}>
        <section ref={detailScroll} className="user-admin-detail" aria-label="用户详情">
          {selectedId && detailState === "loading" ? <PanelState kind="loading" text="正在读取用户详情" /> : null}
          {selectedId && detailState === "error" ? <PanelState kind="error" text={detailError} onRetry={() => void openUser(selectedId)} /> : null}
          {detail ? <UserDetail
            key={detail.id}
            detail={detail}
            tab={detailTab}
            onTabChange={setDetailTab}
            canModerate={canModerate}
            canAssignRoles={canAssignRoles}
            canReadAudit={canReadAudit}
            canReadReports={canReadReports}
            csrfToken={csrfToken}
            boards={boards}
            onStatusUpdated={updateSelectedUser}
            onRolesUpdated={updateSelectedRoles}
            onRefreshed={(fresh) => { setDetail(fresh); setReload((value) => value + 1) }}
          /> : null}
        </section>
        <footer className="user-detail-navigation">
          <p aria-live="polite">{listState === "loading" ? "正在更新用户列表…" : listState === "error" ? "列表暂时不可用，请返回重试" : selectedIndex < 0 ? "该用户已不在当前筛选结果中" : `已加载用户 ${selectedIndex + 1} / ${users.length}`}</p>
          <div>
            <button className="secondary-button" type="button" aria-label="上一位用户" disabled={navigationDisabled || selectedIndex <= 0} onClick={() => void openUser(users[selectedIndex - 1].id)}><ChevronLeft size={15} aria-hidden="true" />上一位</button>
            <button className="user-detail-return" type="button" onClick={closeUser}>返回列表</button>
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
  csrfToken: string
  boards: AdminBoard[]
  onStatusUpdated: (update: { status: AdminUserStatus; reason: string | null; expiresAt: string | null; revision: number }) => void
  onRolesUpdated: (roles: AdminUserDetail["roles"]) => void
  onRefreshed: (detail: AdminUserDetail) => void
}

function UserDetail({ detail, tab, onTabChange, canModerate, canAssignRoles, canReadAudit, canReadReports, csrfToken, boards, onStatusUpdated, onRolesUpdated, onRefreshed }: UserDetailProps) {
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
  })
  const visibleTabs: DetailTab[] = canReadAudit ? ["overview", "content", "reports", "audit"] : ["overview", "content", "reports"]
  const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, name: DetailTab) => {
    const index = visibleTabs.indexOf(name)
    let nextIndex: number | null = null
    if (event.key === "ArrowRight") nextIndex = index + 1
    else if (event.key === "ArrowLeft") nextIndex = index - 1
    else if (event.key === "Home") nextIndex = 0
    else if (event.key === "End") nextIndex = visibleTabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = visibleTabs[(nextIndex + visibleTabs.length) % visibleTabs.length]
    onTabChange(next)
    document.getElementById(`${tabSetId}-${next}-tab`)?.focus()
  }
  return <div className="user-admin-detail__content">
    <header className="user-detail-profile">
      <div className="user-detail-identity"><UserAvatar username={detail.username} displayName={detail.displayName} avatarUrl={detail.avatarUrl} size="large" /><div><h3>{detail.displayName}</h3><span>@{detail.username}</span></div><span className={"user-status user-status--" + detail.status}>{statusLabels[detail.status]}</span></div>
      <p className="user-detail-bio">{detail.bio || "这位用户还没有填写个人简介。"}</p>
      <div className="user-detail-profile-links"><a className="user-catalog-profile-link" href={"#user/" + encodeURIComponent(detail.username)}>查看用户主页<ExternalLink size={13} aria-hidden="true" /></a><span>已关注 {detail.followingCount.toLocaleString()} 人</span></div>
    </header>
    <div className="user-admin-tabs" role="tablist" aria-label="用户详情分类">
      <button type="button" role="tab" {...tabAttributes("overview")} onClick={() => onTabChange("overview")} onKeyDown={(event) => handleTabKey(event, "overview")}>概览</button>
      <button type="button" role="tab" {...tabAttributes("content")} onClick={() => onTabChange("content")} onKeyDown={(event) => handleTabKey(event, "content")}>最近内容</button>
      <button type="button" role="tab" {...tabAttributes("reports")} onClick={() => onTabChange("reports")} onKeyDown={(event) => handleTabKey(event, "reports")}>相关举报</button>
      {canReadAudit ? <button type="button" role="tab" {...tabAttributes("audit")} onClick={() => onTabChange("audit")} onKeyDown={(event) => handleTabKey(event, "audit")}>管理记录</button> : null}
    </div>
    {tab === "overview" ? <div className="user-admin-overview" {...panelAttributes("overview")}>
      <dl className="user-catalog-facts user-detail-facts">
        <div><dt><Hash size={14} aria-hidden="true" />用户 ID</dt><dd className="user-detail-id"><span>{detail.id}</span><button className="icon-button" type="button" aria-label="复制用户 ID" title="复制用户 ID" onClick={() => void copyUserId()}><Copy size={14} aria-hidden="true" /></button></dd></div>
        <div><dt><CalendarDays size={14} aria-hidden="true" />注册时间</dt><dd>{formatDate(detail.createdAt, true)}</dd></div>
        <div><dt><Clock3 size={14} aria-hidden="true" />最后活跃</dt><dd>{detail.lastSeenAt ? formatDate(detail.lastSeenAt, true) : "暂无活动"}</dd></div>
        <div><dt><MapPin size={14} aria-hidden="true" />所在地区</dt><dd>{detail.location || "未填写"}</dd></div>
        <div><dt><Globe size={14} aria-hidden="true" />个人网站</dt><dd>{websiteHref ? <a href={websiteHref} target="_blank" rel="noopener noreferrer">{detail.websiteUrl}</a> : detail.websiteUrl || "未填写"}</dd></div>
      </dl>
      {copyMessage && <p className="user-detail-copy-feedback" role="status">{copyMessage}</p>}
      <dl className="user-catalog-detail-stats">
        <div><dt>主题</dt><dd>{detail.topicCount.toLocaleString()}</dd></div><div><dt>回复</dt><dd>{detail.postCount.toLocaleString()}</dd></div><div><dt>相关举报</dt><dd>{detail.reportCount.toLocaleString()}</dd></div><div><dt>粉丝</dt><dd>{detail.followerCount.toLocaleString()}</dd></div>
      </dl>
      <section className="user-detail-roles"><h4><Shield size={15} aria-hidden="true" />权限角色</h4>{canAssignRoles ? <UserRoleAction detail={detail} csrfToken={csrfToken} boards={boards} onRolesUpdated={onRolesUpdated} /> : detail.roles.length ? <ul>{detail.roles.map((role) => <li key={role.id}><span className="user-role-check" aria-hidden="true"><Check size={11} /></span><span>{role.name}</span><small className="sr-only">{role.scope === "board" ? "板块范围" : role.scope === "site" ? "站点范围" : "实例范围"}</small></li>)}</ul> : <p>普通成员</p>}</section>
      {detail.status !== "active" ? <section className="user-admin-restriction"><h4><AlertCircle size={15} aria-hidden="true" />当前限制</h4><p>{detail.restrictionReason ?? "未记录原因"}</p><small>{detail.restrictionExpiresAt ? `到期：${formatDate(detail.restrictionExpiresAt, true)}` : "永久有效，直到管理员恢复"}</small></section> : null}
      {canModerate ? <UserStatusAction detail={detail} csrfToken={csrfToken} onUpdated={onStatusUpdated} onRefreshed={onRefreshed} /> : null}
      <section className="user-detail-recent"><div className="user-detail-section-heading"><h4>最近动态</h4><button className="link-button" type="button" onClick={showAllActivity}>查看全部动态 <ExternalLink size={12} aria-hidden="true" /></button></div><UserActivityPanel userId={detail.id} kind="content" preview /></section>
    </div> : null}
    {tab === "content" || tab === "reports" ? <div {...panelAttributes(tab)}><UserActivityPanel key={detail.id + tab} userId={detail.id} kind={tab} canReadReports={canReadReports} /></div> : null}
    {tab === "audit" && canReadAudit ? <div {...panelAttributes("audit")}><RelatedAuditLog filter={{ userId: detail.id }} title="管理记录" /></div> : null}
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

function filtersFromQuery(query: string): { query: string; status: AdminUserStatus | "all"; roleId: string; from: string; through: string } {
  const params = new URLSearchParams(query)
  const status = params.get("status")
  return {
    query: params.get("q") ?? "",
    roleId: params.get("role") ?? "",
    from: validDate(params.get("from")),
    through: validDate(params.get("through")),
    status: status === "active" || status === "restricted" || status === "suspended" ? status : "all",
  }
}

function publishFilters(query: string, status: AdminUserStatus | "all", roleId: string, from: string, through: string, onQueryChange?: (query: string) => void) {
  const params = new URLSearchParams()
  if (query) params.set("q", query)
  if (status !== "all") params.set("status", status)
  if (roleId) params.set("role", roleId)
  if (from) params.set("from", from)
  if (through) params.set("through", through)
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
