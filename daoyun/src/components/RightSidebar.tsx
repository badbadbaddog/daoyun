import { ArrowUpRight, Flame, LogIn, MessageSquare, UserRound } from "lucide-react"

import type { AuthSession } from "../api/auth"
import type { Topic } from "../types/community"
import { UserAvatar } from "./UserAvatar"

interface RightSidebarProps {
  topics: Topic[]
  session: AuthSession | null
  onCompose: () => void
  onLogin: () => void
  onOpenTopic: (topicId: string) => void
}

export function RightSidebar({ topics, session, onCompose, onLogin, onOpenTopic }: RightSidebarProps) {
  const hotTopics = topics.slice(0, 3)

  return (
    <aside className="right-sidebar" aria-label="社区信息">
      <section className="profile-panel panel">
        {session ? (
          <>
            <a className="profile-panel__head" href={`#user/${session.user.username}`} aria-label="查看我的个人主页">
              <UserAvatar
                username={session.user.username}
                displayName={session.user.displayName}
                avatarUrl={null}
              />
              <div>
                <strong>{session.user.displayName}</strong>
                <span>@{session.user.username}</span>
              </div>
              <span className="online-label"><span />当前账户</span>
            </a>
            <div className="profile-panel__actions">
              <a className="secondary-button" href={`#user/${session.user.username}`}>个人主页</a>
              <button className="primary-button" type="button" onClick={onCompose} aria-label="从个人面板发布新主题">
                <MessageSquare size={16} aria-hidden="true" />
                发布主题
              </button>
            </div>
          </>
        ) : (
          <div className="profile-panel__guest">
            <span className="profile-panel__guest-icon" aria-hidden="true"><UserRound size={20} /></span>
            <div>
              <strong>访客</strong>
              <span>尚未登录</span>
            </div>
            <button className="secondary-button" type="button" onClick={onLogin}>
              <LogIn size={15} aria-hidden="true" />
              登录
            </button>
          </div>
        )}
      </section>

      <section className="panel hot-panel">
        <div className="panel-heading">
          <div><Flame size={17} /><h2>今日热帖</h2></div>
          <a href="#hot">更多<ArrowUpRight size={13} /></a>
        </div>
        <ol className="hot-list">
          {hotTopics.length > 0 ? hotTopics.map((topic, index) => (
            <li key={topic.id}>
              <span>{index + 1}</span>
              <a
                href={`#topic/${topic.id}`}
                onClick={(event) => {
                  event.preventDefault()
                  onOpenTopic(topic.id)
                }}
              >
                {topic.title}
              </a>
            </li>
          )) : <li className="hot-list__empty">暂无公开主题</li>}
        </ol>
      </section>
    </aside>
  )
}
