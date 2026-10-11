import type { MouseEvent } from "react"
import { CalendarDays, ChevronRight, LayoutGrid, PenSquare, RefreshCw, ShieldCheck, ShoppingBag } from "lucide-react"
import type { AuthSession } from "../api/auth"
import type { Board, Topic } from "../types/community"
import type { HomeProfileData } from "../features/feed/useHomeProfile"
import type { MembershipExperience } from "../features/membership/membershipTypes"
import { topicDisplayTitle } from "../utils/topicPresentation"
import { HomeProfilePanel } from "./HomeProfilePanel"
import { UserAvatar } from "./UserAvatar"

interface HomeCommunitySidebarProps {
  topics: Topic[]
  boards: Board[]
  session: AuthSession | null
  siteName: string
  homeProfile?: HomeProfileData | null
  membershipExperience?: MembershipExperience | null
  profileLoading?: boolean
  profileErrors?: string[]
  boardLoadStatus?: "loading" | "ready" | "error"
  onRetryBoards?: () => void
  onRetryProfile?: () => void
  onCompose: () => void
  onLogin: () => void
  onRegister?: () => void
  onOpenTopic: (id: string) => void
}

export function HomeCommunitySidebar({ topics, boards, session, siteName, homeProfile, membershipExperience, profileLoading, profileErrors, boardLoadStatus = "ready", onRetryBoards, onRetryProfile, onCompose, onLogin, onRegister, onOpenTopic }: HomeCommunitySidebarProps) {
  const popularBoards = [...boards].sort((a, b) => b.topicCount - a.topicCount).slice(0, 8)
  const members = [...new Map(topics.map(topic => [topic.authorUsername, topic])).values()].slice(0, 5)
  const marketBoards = boards.filter(board => /交易|二手|买卖|市场/.test(board.name))
  const marketHref = marketBoards.length ? "#board/" + marketBoards[0].slug : "#boards?q=" + encodeURIComponent("交易")
  const serviceBoard = boards.find(board => /中介/.test(board.name))
  const serviceHref = serviceBoard ? "#board/" + serviceBoard.slug : "#boards?q=" + encodeURIComponent("中介")
  // shortcut: 市场仅展示当前公开内容中的交易板块主题，独立交易业务上线后接专用列表。
  const marketTopics = topics.filter(topic => marketBoards.some(board => board.slug === topic.boardSlug)).slice(0, 5)
  function openTopic(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpenTopic(id)
  }
  return (
    <aside className="right-sidebar right-sidebar--home" aria-label="首页社区信息">
      {session ? <HomeProfilePanel session={session} profile={homeProfile} experience={membershipExperience} loading={profileLoading} errors={profileErrors} onRetry={onRetryProfile} onCompose={onCompose} /> : (
        <section className="panel home-welcome-panel">
          <div className="home-welcome-copy"><h2>你好，<br />欢迎来到 {siteName === "刀云" ? "DaoYun" : siteName} <span aria-hidden="true">👋</span></h2><p>分享生活，交流经验，结识更多有趣的朋友。</p>
            <div className="home-welcome-actions"><button className="primary-button" type="button" onClick={onRegister ?? onLogin}>立即注册</button><button className="secondary-button" type="button" onClick={onLogin}>登录</button></div>
          </div>
          <dl className="home-community-stats" aria-label="社区统计">
            <div><dt>主题数</dt><dd title="已加载公开板块的主题数">{boardLoadStatus === "ready" ? compactCount(boards.reduce((sum, board) => sum + board.topicCount, 0)) : "—"}</dd></div>
            <div><dt>用户数</dt><dd title="暂时不可用">—</dd></div>
            <div><dt>在线人数</dt><dd title="暂时不可用">—</dd></div>
          </dl>
        </section>
      )}
      <section className="panel home-shortcuts" aria-label="社区快捷入口">
        <button type="button" onClick={onCompose}><span className="home-shortcut-icon home-shortcut-icon--blue"><PenSquare size={22} aria-hidden="true" /></span><span><strong>发布帖子</strong><small>分享你的想法</small></span></button>
        <a href="#boards"><span className="home-shortcut-icon home-shortcut-icon--orange"><LayoutGrid size={22} aria-hidden="true" /></span><span><strong>浏览社区</strong><small>发现优质内容</small></span></a>
        <a href={marketHref}><span className="home-shortcut-icon home-shortcut-icon--orange"><CalendarDays size={22} aria-hidden="true" /></span><span><strong>交易市场</strong><small>买卖更放心</small></span></a>
        <a href={serviceHref}><span className="home-shortcut-icon home-shortcut-icon--purple"><ShieldCheck size={22} aria-hidden="true" /></span><span><strong>中介服务</strong><small>安全担保交易</small></span></a>
      </section>
      <section className="panel home-popular-panel" aria-label="热门版块">
        <div className="panel-heading"><h2>热门版块</h2><a href="#boards">全部<ChevronRight size={14} aria-hidden="true" /></a></div>
        {boardLoadStatus === "loading" ? <p className="home-sidebar-empty" role="status">正在加载版块</p> : boardLoadStatus === "error" ? <div className="home-sidebar-empty" role="alert">版块暂时无法加载{onRetryBoards && <button className="secondary-button" type="button" onClick={onRetryBoards} aria-label="重试加载版块"><RefreshCw size={14} aria-hidden="true" />重试</button>}</div> : popularBoards.length ? (
          <ol className="home-popular-list">{popularBoards.map((board, index) => <li key={board.id}><a href={"#board/" + board.slug}><span className={"home-rank home-rank--" + (index + 1)}>{index + 1}</span><strong>{board.name}</strong><small title={board.topicCount + " 个主题"}>{compactCount(board.topicCount)}</small></a></li>)}</ol>
        ) : <p className="home-sidebar-empty" role="status">暂无公开版块</p>}
      </section>
      <section className="panel home-market-panel">
        <div className="panel-heading"><h2>交易市场</h2><a href={marketHref} aria-label="进入市场">进入市场<ChevronRight size={14} aria-hidden="true" /></a></div>
        {marketTopics.length ? <ul className="home-market-list">{marketTopics.map(topic => <li key={topic.id}><ShoppingBag size={14} aria-hidden="true" /><a href={"#topic/" + topic.id} onClick={event => openTopic(event, topic.id)}>{topicDisplayTitle(topic)}</a><small>{topic.replies} 回复</small></li>)}</ul> : <div className="home-market-empty"><ShoppingBag size={24} aria-hidden="true" /><p>暂无交易主题</p><a href={marketHref}>去交易社区逛逛<ChevronRight size={13} aria-hidden="true" /></a></div>}
      </section>
      <section className="panel home-active-panel">
        <div className="panel-heading"><h2>活跃用户</h2><a href="#active">更多<ChevronRight size={14} aria-hidden="true" /></a></div>
        {members.length ? <div className="home-active-members" aria-label="近期发帖成员">{members.map(member => <a href={"#user/" + member.authorUsername} key={member.authorUsername} aria-label={"查看作者：" + member.author} title={member.author}><UserAvatar username={member.authorUsername} displayName={member.author} avatarUrl={member.avatarUrl} size="medium" /></a>)}</div> : <p className="home-sidebar-empty">期待你的第一篇分享</p>}
      </section>
    </aside>
  )
}

function compactCount(count: number): string {
  return count >= 1000 ? (count / 1000).toFixed(1).replace(/\.0$/, "") + "k" : count.toLocaleString("zh-CN")
}
