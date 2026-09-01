import { ArrowUpRight, CheckCircle2, Eye, Flame, FolderOpen, LayoutGrid, LogIn, MessageCircle, MessageSquare, ShieldCheck, ThumbsUp, UserRound } from "lucide-react"

import type { BoardDetail } from "../api/boards"
import type { AuthSession } from "../api/auth"
import type { Board, Topic } from "../types/community"
import { topicDisplayTitle } from "../utils/topicPresentation"
import { UserAvatar } from "./UserAvatar"

interface RightSidebarProps {
  variant?: "default" | "boardDirectory" | "boardDetail" | "topicDetail"
  topics: Topic[]
  boards?: Board[]
  currentBoard?: BoardDetail
  currentTopic?: Topic | null
  session: AuthSession | null
  onCompose: () => void
  onLogin: () => void
  onOpenTopic: (topicId: string) => void
}

export function RightSidebar({ variant = "default", topics, boards = [], currentBoard, currentTopic, session, onCompose, onLogin, onOpenTopic }: RightSidebarProps) {
  const hotTopics = topics.slice(0, 3)
  const activeBoards = [...boards].sort((left, right) => right.topicCount - left.topicCount).slice(0, 4)

  if (variant === "boardDirectory") {
    return (
      <aside className="right-sidebar right-sidebar--boards" aria-label="版块信息">
        <section className="panel board-guide-panel">
          <div className="panel-heading">
            <div><ShieldCheck size={17} aria-hidden="true" /><h2>版块指南</h2></div>
          </div>
          <ul className="board-guide-list">
            <li><CheckCircle2 size={15} aria-hidden="true" /><span>选择合适的版块参与讨论</span></li>
            <li><CheckCircle2 size={15} aria-hidden="true" /><span>尊重他人，保持友善交流</span></li>
            <li><CheckCircle2 size={15} aria-hidden="true" /><span>发布前先阅读版块说明</span></li>
          </ul>
        </section>

        {activeBoards.length > 0 && (
          <section className="panel community-panel board-directory-active-panel">
            <div className="panel-heading">
              <div><LayoutGrid size={17} aria-hidden="true" /><h2>活跃版块</h2></div>
            </div>
            <ul className="community-list">
              {activeBoards.map((board) => (
                <li key={board.id}>
                  <a href={`#board/${board.slug}`}>
                    <span className={`community-list__icon community-list__icon--${board.tone}`} aria-hidden="true">
                      <LayoutGrid size={15} />
                    </span>
                    <span>
                      <strong>{board.name}</strong>
                      <small>{board.topicCount} 个主题</small>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    )
  }

  if (variant === "boardDetail" && !currentBoard) {
    return <aside className="right-sidebar right-sidebar--board-detail" aria-label="当前版块信息" />
  }

  if (variant === "boardDetail" && currentBoard) {
    return (
      <aside className="right-sidebar right-sidebar--board-detail" aria-label="当前版块信息">
        <section className="panel board-detail-info-panel">
          <div className="panel-heading">
            <div><FolderOpen size={17} aria-hidden="true" /><h2>版块信息</h2></div>
          </div>
          <div className="board-detail-info-panel__body">
            <strong>{currentBoard.name}</strong>
            {currentBoard.description && <p>{currentBoard.description}</p>}
            <dl>
              <div><dt>主题</dt><dd>{currentBoard.topicCount} 个主题</dd></div>
              <div><dt>子版块</dt><dd>{currentBoard.children.length} 个</dd></div>
            </dl>
          </div>
        </section>

        {currentBoard.children.length > 0 && (
          <section className="panel community-panel board-detail-children-panel">
            <div className="panel-heading">
              <div><LayoutGrid size={17} aria-hidden="true" /><h2>子版块导航</h2></div>
            </div>
            <ul className="community-list">
              {currentBoard.children.map((board) => (
                <li key={board.id}>
                  <a href={`#board/${board.slug}`}>
                    <span className={`community-list__icon community-list__icon--${board.tone}`} aria-hidden="true"><LayoutGrid size={15} /></span>
                    <span><strong>{board.name}</strong><small>{board.topicCount} 个主题</small></span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel board-detail-topic-panel">
          <div className="panel-heading">
            <div><Flame size={17} aria-hidden="true" /><h2>本版主题</h2></div>
          </div>
          {topics.length > 0 ? (
            <ol className="board-detail-topic-list">
              {topics.slice(0, 5).map((topic) => (
                <li key={topic.id}>
                  <a href={`#topic/${topic.id}`} onClick={(event) => { event.preventDefault(); onOpenTopic(topic.id) }}>
                    {topicDisplayTitle(topic)}
                  </a>
                  <span><MessageCircle size={12} aria-hidden="true" />{topic.replies}<Eye size={12} aria-hidden="true" />{topic.views}</span>
                </li>
              ))}
            </ol>
          ) : <p className="board-detail-topic-list__empty">本版暂时没有公开主题</p>}
        </section>

        <section className="panel board-guide-panel">
          <div className="panel-heading"><div><ShieldCheck size={17} aria-hidden="true" /><h2>参与提示</h2></div></div>
          <ul className="board-guide-list">
            <li><CheckCircle2 size={15} aria-hidden="true" /><span>{currentBoard.viewer.canCreateTopic ? "可以在本版块发布主题" : "当前账号仅可浏览主题"}</span></li>
            <li><CheckCircle2 size={15} aria-hidden="true" /><span>{currentBoard.viewer.canReply ? "可以参与本版块回复" : "本版块当前不开放回复"}</span></li>
            <li><CheckCircle2 size={15} aria-hidden="true" /><span>{currentBoard.viewer.canUploadAttachment ? "发布时支持上传附件" : "发布时暂不支持上传附件"}</span></li>
          </ul>
        </section>
      </aside>
    )
  }

  if (variant === "topicDetail" && !currentTopic) {
    return <aside className="right-sidebar right-sidebar--topic-detail" aria-label="帖子相关信息" />
  }

  if (variant === "topicDetail" && currentTopic) {
    const relatedTopics = topics.filter((topic) => topic.id !== currentTopic.id).slice(0, 5)
    const boardHref = currentTopic.boardSlug ? `#board/${currentTopic.boardSlug}` : "#boards"

    return (
      <aside className="right-sidebar right-sidebar--topic-detail" aria-label="帖子相关信息">
        <section className="panel topic-author-panel">
          <div className="panel-heading">
            <div><UserRound size={17} aria-hidden="true" /><h2>作者信息</h2></div>
          </div>
          <a
            className="topic-author-panel__identity"
            href={`#user/${currentTopic.authorUsername}`}
            aria-label={`查看 ${currentTopic.author} 的主页`}
          >
            <UserAvatar
              username={currentTopic.authorUsername}
              displayName={currentTopic.author}
              avatarUrl={currentTopic.avatarUrl}
            />
            <span>
              <strong>{currentTopic.author}</strong>
              <small>@{currentTopic.authorUsername}</small>
            </span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          <ul className="topic-author-panel__stats">
            <li><MessageCircle size={14} aria-hidden="true" /><span>{currentTopic.replies} 回复</span></li>
            <li><ThumbsUp size={14} aria-hidden="true" /><span>{currentTopic.likes} 点赞</span></li>
            <li><Eye size={14} aria-hidden="true" /><span>{currentTopic.views} 浏览</span></li>
          </ul>
        </section>

        <section className="panel topic-related-board-panel">
          <div className="panel-heading">
            <div><FolderOpen size={17} aria-hidden="true" /><h2>相关版块</h2></div>
          </div>
          <a className="topic-related-board-panel__link" href={boardHref}>
            <span aria-hidden="true"><FolderOpen size={18} /></span>
            <span><strong>{currentTopic.board}</strong><small>查看本版更多主题</small></span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </section>

        <section className="panel topic-sidebar-hot-panel">
          <div className="panel-heading">
            <div><Flame size={17} aria-hidden="true" /><h2>今日热帖</h2></div>
          </div>
          {relatedTopics.length > 0 ? (
            <ol className="topic-sidebar-hot-list">
              {relatedTopics.map((topic, index) => (
                <li key={topic.id}>
                  <span>{index + 1}</span>
                  <div>
                    <a href={`#topic/${topic.id}`} onClick={(event) => { event.preventDefault(); onOpenTopic(topic.id) }}>
                      {topicDisplayTitle(topic)}
                    </a>
                    <small>{topic.replies} 回复 · {topic.views} 浏览</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="topic-sidebar-hot-list__empty">暂无其他公开主题</p>}
        </section>
      </aside>
    )
  }

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
                {topicDisplayTitle(topic)}
              </a>
            </li>
          )) : <li className="hot-list__empty">暂无公开主题</li>}
        </ol>
      </section>

      {activeBoards.length > 0 && (
        <section className="panel community-panel">
          <div className="panel-heading">
            <div><LayoutGrid size={17} /><h2>活跃社区</h2></div>
            <a href="#boards">全部<ArrowUpRight size={13} /></a>
          </div>
          <ul className="community-list">
            {activeBoards.map((board) => (
              <li key={board.id}>
                <a href={`#board/${board.slug}`}>
                  <span className={`community-list__icon community-list__icon--${board.tone}`} aria-hidden="true">
                    <LayoutGrid size={15} />
                  </span>
                  <span>
                    <strong>{board.name}</strong>
                    <small>{board.topicCount} 个主题</small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
