import { AlertCircle, FileText, LoaderCircle, RefreshCw, Search, Shield, UserRound } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import {
  AdminUsersApiError,
  getAdminUser,
  listAdminUserContent,
  listAdminUsers,
  type AdminUserContentItem,
  type AdminUserDetail,
  type AdminUserStatus,
  type AdminUserSummary,
} from "../api/adminUsers"
import { listAdminUserReports, type ContentReport, ReportApiError } from "../api/reports"
import type { AdminBoard } from "../api/admin"
import { UserAvatar } from "./UserAvatar"
import { UserRoleAction } from "./UserRoleAction"
import { UserStatusAction } from "./UserStatusAction"
import { RelatedAuditLog } from "./RelatedAuditLog"
import { PluginUiSurface } from "./PluginUiSurface"

interface UserAdminPanelProps {
  requestedQuery?: string
  onQueryChange?: (query: string) => void
  csrfToken?: string
  canModerate?: boolean
  canAssignRoles?: boolean
  canReadAudit?: boolean
  boards?: AdminBoard[]
}

type LoadState = "loading" | "ready" | "error"
type DetailTab = "overview" | "content" | "reports" | "audit"

const statusLabels: Record<AdminUserStatus, string> = {
  active: "正常",
  restricted: "已限制",
  suspended: "已暂停",
}

export function UserAdminPanel({ requestedQuery = "", onQueryChange, csrfToken = "", canModerate = false, canAssignRoles = false, canReadAudit = false, boards = [] }: UserAdminPanelProps) {
  const initialFilters = filtersFromQuery(requestedQuery)
  const [queryDraft, setQueryDraft] = useState(initialFilters.query)
  const [query, setQuery] = useState(initialFilters.query)
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | "all">(initialFilters.status)
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [listState, setListState] = useState<LoadState>("loading")
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState("")
  const [reload, setReload] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [content, setContent] = useState<AdminUserContentItem[]>([])
  const [reports, setReports] = useState<ContentReport[]>([])
  const [detailState, setDetailState] = useState<LoadState>("ready")
  const [detailError, setDetailError] = useState("")
  const [detailTab, setDetailTab] = useState<DetailTab>("overview")
  const detailRequest = useRef<AbortController | null>(null)
  const listRequestVersion = useRef(0)

  useEffect(() => {
    const filters = filtersFromQuery(requestedQuery)
    setQueryDraft(filters.query)
    setQuery(filters.query)
    setStatusFilter(filters.status)
  }, [requestedQuery])

  useEffect(() => {
    const controller = new AbortController()
    const requestVersion = ++listRequestVersion.current
    setListState("loading")
    setLoadingMore(false)
    setListError("")
    setNextCursor(null)
    listAdminUsers({ query: query || undefined, status: statusFilter === "all" ? undefined : statusFilter, limit: 20, signal: controller.signal })
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
  }, [query, reload, statusFilter])

  useEffect(() => () => detailRequest.current?.abort(), [])

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    const nextQuery = queryDraft.trim()
    setQuery(nextQuery)
    publishFilters(nextQuery, statusFilter, onQueryChange)
  }

  function changeStatus(nextStatus: AdminUserStatus | "all") {
    setStatusFilter(nextStatus)
    publishFilters(query, nextStatus, onQueryChange)
  }

  async function loadMoreUsers() {
    if (!nextCursor || loadingMore) return
    const requestVersion = listRequestVersion.current
    setLoadingMore(true)
    setListError("")
    try {
      const page = await listAdminUsers({ query: query || undefined, status: statusFilter === "all" ? undefined : statusFilter, cursor: nextCursor, limit: 20 })
      if (requestVersion !== listRequestVersion.current) return
      setUsers((current) => [...current, ...page.users])
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (requestVersion === listRequestVersion.current) setListError(reason instanceof AdminUsersApiError ? reason.message : "更多用户暂时无法加载")
    } finally {
      if (requestVersion === listRequestVersion.current) setLoadingMore(false)
    }
  }

  async function openUser(userId: string) {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setSelectedId(userId)
    setDetail(null)
    setContent([])
    setReports([])
    setDetailTab("overview")
    setDetailState("loading")
    setDetailError("")
    try {
      const [loadedDetail, loadedContent, loadedReports] = await Promise.all([
        getAdminUser(userId, controller.signal),
        listAdminUserContent(userId, undefined, controller.signal),
        listAdminUserReports(userId, undefined, controller.signal),
      ])
      if (controller.signal.aborted) return
      setDetail(loadedDetail)
      setContent(loadedContent.items)
      setReports(loadedReports.reports)
      setDetailState("ready")
    } catch (reason) {
      if (controller.signal.aborted) return
      setDetailState("error")
      setDetailError(reason instanceof AdminUsersApiError || reason instanceof ReportApiError ? reason.message : "用户详情暂时无法加载")
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
    setUsers((current) => current.map((user) => user.id === selectedId ? { ...user, status: statusUpdate.status } : user))
  }

  function addSelectedRole(role: AdminUserDetail["roles"][number]) {
    setDetail((current) => current && !current.roles.some((item) => item.id === role.id) ? { ...current, roles: [...current.roles, role], primaryRole: current.primaryRole ?? role.name } : current)
  }

  function removeSelectedRole(roleId: string) {
    setDetail((current) => current ? { ...current, roles: current.roles.filter((role) => role.id !== roleId) } : current)
  }

  return (
    <div className="admin-panel user-admin-panel">
      <div className="admin-panel__heading">
        <div><p>成员治理</p><h2>用户管理</h2></div>
        <span className="admin-badge">{users.length}{nextCursor ? "+" : ""} 位用户</span>
      </div>
      <form className="user-admin-filters" role="search" onSubmit={submitSearch}>
        <label>
          <span className="sr-only">搜索用户</span>
          <Search size={15} aria-hidden="true" />
          <input type="search" aria-label="搜索用户" placeholder="用户名、昵称或用户 ID" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} />
        </label>
        <select aria-label="用户状态" value={statusFilter} onChange={(event) => changeStatus(event.target.value as AdminUserStatus | "all")}>
          <option value="all">全部状态</option>
          <option value="active">正常</option>
          <option value="restricted">已限制</option>
          <option value="suspended">已暂停</option>
        </select>
        <button className="primary-button" type="submit"><Search size={14} aria-hidden="true" />搜索</button>
      </form>

      <div className="user-admin-workspace">
        <section className="user-admin-list" aria-label="用户列表">
          {listState === "loading" ? <PanelState kind="loading" text="正在读取用户列表" /> : null}
          {listState === "error" ? <PanelState kind="error" text={listError} onRetry={() => setReload((value) => value + 1)} /> : null}
          {listState === "ready" && users.length === 0 ? <PanelState kind="empty" text="没有找到符合条件的用户" /> : null}
          {listState === "ready" ? users.map((user) => (
            <button key={user.id} className="user-admin-row" type="button" aria-pressed={selectedId === user.id} aria-label={`${user.displayName} @${user.username}`} onClick={() => void openUser(user.id)}>
              <UserAvatar username={user.username} displayName={user.displayName} avatarUrl={user.avatarUrl} size="small" />
              <span><strong>{user.displayName}</strong><small>@{user.username} · {user.primaryRole ?? "普通成员"}</small></span>
              <em data-status={user.status}>{statusLabels[user.status]}</em>
            </button>
          )) : null}
          {listState === "ready" && listError ? <p className="form-alert" role="alert">{listError}</p> : null}
          {listState === "ready" && nextCursor ? <button className="secondary-button report-load-more" type="button" disabled={loadingMore} onClick={() => void loadMoreUsers()}>{loadingMore ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}加载更多用户</button> : null}
        </section>

        <section className="user-admin-detail" aria-label="用户详情">
          {!selectedId ? <PanelState kind="empty" text="选择一位用户查看完整管理信息" /> : null}
          {selectedId && detailState === "loading" ? <PanelState kind="loading" text="正在读取用户详情" /> : null}
          {selectedId && detailState === "error" ? <PanelState kind="error" text={detailError} onRetry={() => void openUser(selectedId)} /> : null}
          {detail ? <UserDetail
            detail={detail}
            content={content}
            reports={reports}
            tab={detailTab}
            onTabChange={setDetailTab}
            canModerate={canModerate}
            canAssignRoles={canAssignRoles}
            canReadAudit={canReadAudit}
            csrfToken={csrfToken}
            boards={boards}
            onStatusUpdated={updateSelectedUser}
            onRoleAssigned={addSelectedRole}
            onRoleRemoved={removeSelectedRole}
            onReload={() => void openUser(detail.id)}
          /> : null}
        </section>
      </div>
    </div>
  )
}

interface UserDetailProps {
  detail: AdminUserDetail
  content: AdminUserContentItem[]
  reports: ContentReport[]
  tab: DetailTab
  onTabChange: (tab: DetailTab) => void
  canModerate: boolean
  canAssignRoles: boolean
  canReadAudit: boolean
  csrfToken: string
  boards: AdminBoard[]
  onStatusUpdated: (update: { status: AdminUserStatus; reason: string | null; expiresAt: string | null; revision: number }) => void
  onRoleAssigned: (role: AdminUserDetail["roles"][number]) => void
  onRoleRemoved: (roleId: string) => void
  onReload: () => void
}

function UserDetail({ detail, content, reports, tab, onTabChange, canModerate, canAssignRoles, canReadAudit, csrfToken, boards, onStatusUpdated, onRoleAssigned, onRoleRemoved, onReload }: UserDetailProps) {
  const tabSetId = useId()
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
  return <div className="user-admin-detail__content">
    <header>
      <UserAvatar username={detail.username} displayName={detail.displayName} avatarUrl={detail.avatarUrl} size="large" />
      <div><p>{statusLabels[detail.status]}</p><h3>{detail.displayName}</h3><span>@{detail.username} · 注册于 {formatDate(detail.createdAt)}</span></div>
    </header>
    <PluginUiSurface
      slot="admin_user"
      subjectId={detail.id}
      csrfToken={canModerate ? csrfToken : undefined}
    />
    <div className="user-admin-tabs" role="tablist" aria-label="用户详情分类">
      <button type="button" role="tab" {...tabAttributes("overview")} onClick={() => onTabChange("overview")}>概览</button>
      <button type="button" role="tab" {...tabAttributes("content")} onClick={() => onTabChange("content")}>最近内容</button>
      <button type="button" role="tab" {...tabAttributes("reports")} onClick={() => onTabChange("reports")}>相关举报</button>
      {canReadAudit ? <button type="button" role="tab" {...tabAttributes("audit")} onClick={() => onTabChange("audit")}>管理记录</button> : null}
    </div>
    {tab === "overview" ? <div className="user-admin-overview" {...panelAttributes("overview")}>
      <dl>
        <div><dt>主题</dt><dd>{detail.topicCount}</dd></div><div><dt>回复</dt><dd>{detail.postCount}</dd></div><div><dt>举报</dt><dd>{detail.reportCount}</dd></div><div><dt>最后活跃</dt><dd>{detail.lastSeenAt ? formatDate(detail.lastSeenAt) : "暂无"}</dd></div>
      </dl>
      <section><h4><UserRound size={15} aria-hidden="true" />公开资料</h4><p>{detail.bio || "未填写个人简介"}</p>{detail.location ? <small>{detail.location}</small> : null}</section>
      <section><h4><Shield size={15} aria-hidden="true" />角色</h4>{detail.roles.length ? <ul>{detail.roles.map((role) => <li key={role.id}>{role.name}<small>{role.scope === "board" ? "板块范围" : role.scope === "site" ? "站点范围" : "实例范围"}</small></li>)}</ul> : <p>普通成员</p>}{canAssignRoles ? <UserRoleAction detail={detail} csrfToken={csrfToken} boards={boards} onRoleAssigned={onRoleAssigned} onRoleRemoved={onRoleRemoved} /> : null}</section>
      {detail.status !== "active" ? <section className="user-admin-restriction"><h4><AlertCircle size={15} aria-hidden="true" />当前限制</h4><p>{detail.restrictionReason ?? "未记录原因"}</p><small>{detail.restrictionExpiresAt ? `到期：${formatDate(detail.restrictionExpiresAt)}` : "永久有效，直到管理员恢复"}</small></section> : null}
      {canModerate ? <UserStatusAction detail={detail} csrfToken={csrfToken} onUpdated={onStatusUpdated} onReload={onReload} /> : null}
    </div> : null}
    {tab === "content" ? <div className="user-admin-items" {...panelAttributes("content")}>{content.length ? content.map((item) => <article key={item.id}><span><FileText size={14} aria-hidden="true" />{item.kind === "topic" ? "主题" : "回复"}</span><h4>{item.title ?? "无标题内容"}</h4><p>{item.excerpt || "暂无摘要"}</p><time>{formatDate(item.createdAt)}</time></article>) : <PanelState kind="empty" text="暂无最近内容" />}</div> : null}
    {tab === "reports" ? <div className="user-admin-items" {...panelAttributes("reports")}>{reports.length ? reports.map((report) => <article key={report.id}><span><AlertCircle size={14} aria-hidden="true" />{report.status === "open" ? "待处理" : report.status === "in_review" ? "处理中" : report.status === "resolved" ? "已解决" : "已驳回"}</span><h4>{report.targetTitle ?? "目标内容已不可见"}</h4><p>{report.details ?? report.reason}</p><time>{formatDate(report.createdAt)}</time></article>) : <PanelState kind="empty" text="暂无相关举报" />}</div> : null}
    {tab === "audit" && canReadAudit ? <div {...panelAttributes("audit")}><RelatedAuditLog filter={{ userId: detail.id }} title="管理记录" /></div> : null}
  </div>
}

function PanelState({ kind, text, onRetry }: { kind: "loading" | "empty" | "error"; text: string; onRetry?: () => void }) {
  return <div className={`user-admin-state user-admin-state--${kind}`} role={kind === "error" ? "alert" : "status"}>
    {kind === "loading" ? <LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /> : kind === "error" ? <AlertCircle size={20} aria-hidden="true" /> : <UserRound size={20} aria-hidden="true" />}
    <span>{text}</span>
    {onRetry ? <button className="secondary-button" type="button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />重试</button> : null}
  </div>
}

function filtersFromQuery(query: string): { query: string; status: AdminUserStatus | "all" } {
  const params = new URLSearchParams(query)
  const status = params.get("status")
  return {
    query: params.get("q") ?? "",
    status: status === "active" || status === "restricted" || status === "suspended" ? status : "all",
  }
}

function publishFilters(query: string, status: AdminUserStatus | "all", onQueryChange?: (query: string) => void) {
  const params = new URLSearchParams()
  if (query) params.set("q", query)
  if (status !== "all") params.set("status", status)
  onQueryChange?.(params.toString())
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "未知" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date)
}
