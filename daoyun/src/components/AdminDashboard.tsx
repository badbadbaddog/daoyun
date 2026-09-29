import { AlertCircle, Check, ChevronRight, EyeOff, Flag, Inbox, LoaderCircle, RefreshCw, UserRound, type LucideIcon } from "lucide-react"
import { useEffect, useState } from "react"

import type { AdminBoard } from "../api/admin"
import { listAdminUsers, type AdminUserStatus, type AdminUserSummary } from "../api/adminUsers"
import { listAdminReports, type ContentReport, type ReportStatus } from "../api/reports"
import { AdminDashboardTrend } from "./AdminDashboardTrend"
import type { AdminTab } from "./AdminView"

interface AdminDashboardProps {
  capabilityKeys: string[]
  boards: AdminBoard[]
  shortcuts?: { tab: AdminTab; label: string; icon: LucideIcon }[]
  onNavigate: (tab: AdminTab, query: string) => void
}

interface SummaryState<T> {
  items: T[]
  hasMore: boolean
  loading: boolean
  error: string
}

const emptySummary = <T,>(): SummaryState<T> => ({ items: [], hasMore: false, loading: true, error: "" })

export function AdminDashboard({ capabilityKeys, boards, shortcuts = [], onNavigate }: AdminDashboardProps) {
  const capabilities = new Set(capabilityKeys)
  const canReadReports = capabilities.has("governance.reports.read")
  const canReadUsers = capabilities.has("admin.users.read")
  const canReadBoards = capabilities.has("admin.configuration.read")
  const [openReports, setOpenReports] = useState<SummaryState<ContentReport>>(emptySummary)
  const [reviewReports, setReviewReports] = useState<SummaryState<ContentReport>>(emptySummary)
  const [restrictedUsers, setRestrictedUsers] = useState<SummaryState<AdminUserSummary>>(emptySummary)
  const [suspendedUsers, setSuspendedUsers] = useState<SummaryState<AdminUserSummary>>(emptySummary)
  const [reportReload, setReportReload] = useState(0)
  const [userReload, setUserReload] = useState(0)

  useEffect(() => {
    if (!canReadReports) return
    const controller = new AbortController()
    loadReports("open", setOpenReports, controller.signal)
    loadReports("in_review", setReviewReports, controller.signal)
    return () => controller.abort()
  }, [canReadReports, reportReload])

  useEffect(() => {
    if (!canReadUsers) return
    const controller = new AbortController()
    loadUsers("restricted", setRestrictedUsers, controller.signal)
    loadUsers("suspended", setSuspendedUsers, controller.signal)
    return () => controller.abort()
  }, [canReadUsers, userReload])

  const hiddenBoardCount = boards.filter((board) => board.visibility === "hidden").length
  const hiddenBoards = boards.filter((board) => board.visibility === "hidden").slice(0, 5)

  return <div className="admin-dashboard">
    <h2 className="sr-only">今天需要处理什么</h2>
    {(canReadReports || canReadUsers || canReadBoards) && <section className="admin-dashboard__metrics" aria-label="待办概览">
      {canReadReports && <>
        <SummaryMetric label="待处理举报" icon={Flag} value={summaryCount(openReports)} hint="进入举报队列" onClick={() => onNavigate("reports", "status=open")} />
        <SummaryMetric label="处理中举报" icon={Inbox} value={summaryCount(reviewReports)} hint="继续核查内容" onClick={() => onNavigate("reports", "status=in_review")} />
      </>}
      {canReadUsers && <SummaryMetric label="受限账号" icon={UserRound} value={summaryCount(restrictedUsers)} hint="查看账号限制" onClick={() => onNavigate("users", "status=restricted")} />}
      {canReadBoards && <SummaryMetric label="隐藏版块" icon={EyeOff} value={String(hiddenBoardCount)} hint="检查版块可见性" onClick={() => onNavigate("boards", "")} />}
    </section>}
    <div className="admin-dashboard__workspace">
      {(canReadReports || capabilities.has("community.analytics.read")) && <div className="admin-dashboard__primary">
      {canReadReports ? <DashboardSection
        title="举报待办"
        onViewAll={() => onNavigate("reports", "")}
        icon={<Flag size={18} aria-hidden="true" />}
        states={[{ label: "待处理", status: "open", state: openReports }, { label: "处理中", status: "in_review", state: reviewReports }]}
        emptyText={(label) => `暂无${label}举报`}
        itemLabel={(item) => item.targetTitle ?? "目标内容已不可见"}
        itemMeta={(item) => `${reasonLabel(item.reason)} · ${formatDateTime(item.createdAt)}`}
        onOpen={(item, status) => onNavigate("reports", `status=${status}&report_id=${item.id}`)}
        openLabel={(item) => `打开举报：${item.targetTitle ?? item.id}`}
        retryLabel="重试举报待办"
        onRetry={() => setReportReload((value) => value + 1)}
      /> : null}
      {capabilities.has("community.analytics.read") && <AdminDashboardTrend />}
      </div>}
      {(shortcuts.length > 0 || canReadUsers || canReadBoards) && <div className="admin-dashboard__secondary">
      {shortcuts.length > 0 && <section className="admin-dashboard__shortcuts" aria-label="快捷操作">
        <header><h3>快捷操作</h3><span>常用管理入口</span></header>
        <div>{shortcuts.map(({ tab, label, icon: Icon }) => <button key={tab} type="button" aria-label={`前往${label}`} onClick={() => onNavigate(tab, "")}><Icon size={20} aria-hidden="true" /><span>{label}</span><ChevronRight size={14} aria-hidden="true" /></button>)}</div>
      </section>}
      {canReadUsers ? <DashboardSection
        title="账号限制"
        onViewAll={() => onNavigate("users", "")}
        icon={<UserRound size={18} aria-hidden="true" />}
        states={[{ label: "受限", status: "restricted", state: restrictedUsers }, { label: "暂停", status: "suspended", state: suspendedUsers }]}
        emptyText={(label) => `暂无${label}账号`}
        itemLabel={(item) => item.displayName}
        itemMeta={(item) => `@${item.username} · ${item.lastSeenAt ? formatDateTime(item.lastSeenAt) : "暂无活动时间"}`}
        onOpen={(_, status) => onNavigate("users", `status=${status}`)}
        openLabel={(item) => `查看账号：${item.displayName}`}
        retryLabel="重试账号限制"
        onRetry={() => setUserReload((value) => value + 1)}
      /> : null}
      {canReadBoards ? <section className="admin-dashboard__section">
        <header><div><EyeOff size={18} aria-hidden="true" /><h3>版块状态</h3></div><strong>{hiddenBoardCount} 个隐藏</strong></header>
        {hiddenBoards.length === 0 ? <p role="status">当前没有隐藏版块。</p> : <ul>{hiddenBoards.map((board) => <li key={board.id}><button className="admin-dashboard__task" type="button" aria-label={`打开版块：${board.name}`} title={board.name} onClick={() => onNavigate("boards", "")}><span className="admin-dashboard__task-copy"><strong>{board.name}</strong><span>隐藏版块 · {board.topicCount} 个主题</span></span><ChevronRight size={15} aria-hidden="true" /></button></li>)}</ul>}
      </section> : null}
      </div>}
      {!canReadReports && !canReadUsers && !canReadBoards ? <div className="admin-dashboard__empty" role="status"><AlertCircle size={20} aria-hidden="true" /><span>当前权限没有可汇总的治理待办，请从导航进入获授权模块。</span></div> : null}
    </div>
  </div>
}

function summaryCount(state: SummaryState<unknown>) {
  return state.loading ? "加载中" : state.error ? "暂不可用" : `${state.items.length}${state.hasMore ? "+" : ""}`
}

function SummaryMetric({ label, icon: Icon, value, hint, onClick }: { label: string; icon: LucideIcon; value: string; hint: string; onClick: () => void }) {
  return <button className="admin-dashboard__metric" type="button" aria-label={`查看${label}：${value}`} onClick={onClick}>
    <span className="admin-dashboard__metric-icon"><Icon size={22} aria-hidden="true" /></span>
    <span className="admin-dashboard__metric-copy"><span>{label}</span><strong>{value}</strong><small>{value.endsWith("+") ? "超过当前摘要范围" : hint}</small></span>
    <ChevronRight size={16} aria-hidden="true" />
  </button>
}

interface DashboardSectionProps<T, S extends string> {
  title: string
  icon: React.ReactNode
  states: Array<{ label: string; status: S; state: SummaryState<T> }>
  emptyText: (label: string) => string
  itemLabel: (item: T) => string
  itemMeta: (item: T) => string
  onOpen: (item: T, status: S) => void
  openLabel: (item: T) => string
  retryLabel: string
  onRetry: () => void
  onViewAll: () => void
}

function DashboardSection<T, S extends string>({ title, icon, states, emptyText, itemLabel, itemMeta, onOpen, openLabel, retryLabel, onRetry, onViewAll }: DashboardSectionProps<T, S>) {
  const failed = states.some(({ state }) => state.error)
  return <section className="admin-dashboard__section">
    <header><div>{icon}<h3>{title}</h3></div><button className="admin-dashboard__all" type="button" aria-label={`查看全部${title}`} onClick={onViewAll}>查看全部<ChevronRight size={14} aria-hidden="true" /></button></header>
    <p className="admin-dashboard__section-summary">{states.map(({ label, state }) => `${label} ${summaryCount(state)}`).join(" · ")}</p>
    {failed ? <div className="admin-dashboard__error" role="alert"><AlertCircle size={16} aria-hidden="true" />{title}暂时无法加载<button className="secondary-button" type="button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />{retryLabel}</button></div> : null}
    {states.map(({ label, status, state }) => <div className="admin-dashboard__group" key={status}>
      <h4>{label}</h4>
      {state.error ? <p role="status">暂不可用，请重试</p> : state.loading ? <p role="status"><LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />正在加载</p> : state.items.length === 0 ? <p className="admin-dashboard__clear" role="status"><Check size={14} aria-hidden="true" />{emptyText(label)}</p> : <ul>{state.items.map((item, index) => <li key={`${status}-${index}`}><button className="admin-dashboard__task" type="button" aria-label={openLabel(item)} title={itemLabel(item)} onClick={() => onOpen(item, status)}><span className="admin-dashboard__task-icon" aria-hidden="true">{icon}</span><span className="admin-dashboard__task-copy"><strong>{itemLabel(item)}</strong><span>{itemMeta(item)}</span></span><ChevronRight size={16} aria-hidden="true" /></button></li>)}</ul>}
    </div>)}
  </section>
}

async function loadReports(status: ReportStatus, setState: React.Dispatch<React.SetStateAction<SummaryState<ContentReport>>>, signal: AbortSignal) {
  setState(emptySummary())
  try {
    const page = await listAdminReports({ status, limit: 5, signal })
    if (!signal.aborted) setState({ items: page.reports.slice(0, 5), hasMore: page.nextCursor !== null, loading: false, error: "" })
  } catch {
    if (!signal.aborted) setState({ items: [], hasMore: false, loading: false, error: "failed" })
  }
}

async function loadUsers(status: AdminUserStatus, setState: React.Dispatch<React.SetStateAction<SummaryState<AdminUserSummary>>>, signal: AbortSignal) {
  setState(emptySummary())
  try {
    const page = await listAdminUsers({ status, limit: 5, signal })
    if (!signal.aborted) setState({ items: page.users.slice(0, 5), hasMore: page.nextCursor !== null, loading: false, error: "" })
  } catch {
    if (!signal.aborted) setState({ items: [], hasMore: false, loading: false, error: "failed" })
  }
}

function reasonLabel(reason: ContentReport["reason"]) {
  return ({ spam: "垃圾广告", harassment: "骚扰攻击", illegal: "违法内容", copyright: "版权问题", other: "其他" } as const)[reason]
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}
