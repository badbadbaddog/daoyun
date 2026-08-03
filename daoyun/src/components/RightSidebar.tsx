import { ArrowUpRight, BarChart3, Flame, MessageSquare, Radio, Users } from "lucide-react"

import { topics } from "../data/community"

interface RightSidebarProps {
  onCompose: () => void
}

export function RightSidebar({ onCompose }: RightSidebarProps) {
  const hotTopics = topics.filter((topic) => topic.hot).slice(0, 3)

  return (
    <aside className="right-sidebar" aria-label="社区信息">
      <section className="profile-panel panel">
        <div className="profile-panel__head">
          <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=128&q=80" alt="林屿" />
          <div>
            <strong>林屿</strong>
            <span>@linyu</span>
          </div>
          <span className="online-label"><span />在线</span>
        </div>
        <div className="profile-metrics">
          <span><strong>24</strong>主题</span>
          <span><strong>386</strong>获赞</span>
          <span><strong>118</strong>关注</span>
        </div>
        <button className="primary-button profile-compose" type="button" onClick={onCompose} aria-label="从个人面板发布新主题">
          <MessageSquare size={16} />
          发布主题
        </button>
      </section>

      <section className="panel hot-panel">
        <div className="panel-heading">
          <div><Flame size={17} /><h2>今日热帖</h2></div>
          <a href="#hot">更多<ArrowUpRight size={13} /></a>
        </div>
        <ol className="hot-list">
          {hotTopics.map((topic, index) => (
            <li key={topic.id}>
              <span>{index + 1}</span>
              <a href={`#${topic.id}`}>{topic.title}</a>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel stats-panel">
        <div className="panel-heading">
          <div><BarChart3 size={17} /><h2>社区概况</h2></div>
        </div>
        <div className="stats-grid">
          <span><Users size={15} /><strong>12,680</strong><small>成员</small></span>
          <span><MessageSquare size={15} /><strong>48,291</strong><small>主题</small></span>
          <span><Radio size={15} /><strong>286</strong><small>在线</small></span>
        </div>
      </section>

      <p className="right-footer">© 2026 刀云 · 社区准则 · 隐私</p>
    </aside>
  )
}
