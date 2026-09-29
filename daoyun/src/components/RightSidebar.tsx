import { ArrowUpRight, CheckCircle2, Eye, Flame, FolderOpen, LayoutGrid, LogIn, MessageCircle, MessageSquare, ShieldCheck, ThumbsUp, UserRound } from "lucide-react"

import type { BoardDetail } from "../api/boards"
import type { AuthSession } from "../api/auth"
import type { MembershipExperience } from "../features/membership/membershipTypes"
import type { Board, Topic } from "../types/community"
import { topicDisplayTitle } from "../utils/topicPresentation"
import { PublicMemberIdentity } from "./PublicMemberIdentity"
import { UserAvatar } from "./UserAvatar"

interface RightSidebarProps {
  variant?: "default" | "home" | "boardDirectory" | "boardDetail" | "topicDetail"
  topics: Topic[]
  boards?: Board[]
  currentBoard?: BoardDetail
  currentTopic?: Topic | null
  session: AuthSession | null
  membershipExperience?: MembershipExperience | null
  onCompose: () => void
  onLogin: () => void
  onOpenTopic: (topicId: string) => void
}

export function RightSidebar({ variant = "default", topics, boards = [], currentBoard, currentTopic, session, membershipExperience, onCompose, onLogin, onOpenTopic }: RightSidebarProps) {
  const hotTopics = [...topics]
    .sort((left, right) => (right.replies * 12 + right.likes * 8) - (left.replies * 12 + left.likes * 8))
    .slice(0, 4)
  const activeBoards = [...boards].sort((left, right) => right.topicCount - left.topicCount).slice(0, 4)
  const activeMembers = [...new Map(topics.map((topic) => [topic.authorUsername, {
    username: topic.authorUsername,
    displayName: topic.author,
    avatarUrl: topic.avatarUrl,
  }])).values()].slice(0, 5)
  const ownTopics = session ? topics.filter((topic) => topic.authorUsername === session.user.username) : []
  const ownReplies = ownTopics.reduce((total, topic) => total + topic.replies, 0)
  const ownLikes = ownTopics.reduce((total, topic) => total + topic.likes, 0)

  if (variant === "home") {
    const levelProgressValue = membershipExperience?.nextLevel
      ? Math.max(0, membershipExperience.experience - membershipExperience.level.requiredExperience)
      : 1
    const levelProgressMax = membershipExperience?.nextLevel
      ? Math.max(1, membershipExperience.nextLevel.requiredExperience - membershipExperience.level.requiredExperience)
      : 1

    return (
      <aside className="right-sidebar right-sidebar--home" aria-label="首页社区信息">
        <section className="panel home-profile-panel">
          {session ? (
            <>
              <a className="home-profile-panel__identity" href={`#user/${session.user.username}`}>
                <UserAvatar username={session.user.username} displayName={session.user.displayName} avatarUrl={null} />
                <span>
                  <h2>你好，{session.user.displayName}</h2>
                  <small>分享生活，发现更多可能</small>
                </span>
              </a>
              {membershipExperience ? (
                <div className="home-profile-panel__level">
                  <span
                    className="home-profile-panel__level-badge"
                    aria-label={`成长等级：${membershipExperience.level.displayName}`}
                    title={membershipExperience.level.description || membershipExperience.level.displayName}
                  >
                    Lv.{membershipExperience.level.levelOrder}
                  </span>
                  <progress aria-label="成长等级进度" value={levelProgressValue} max={levelProgressMax} />
                  <span className="home-profile-panel__level-value">
                    {membershipExperience.nextLevel
                      ? `${membershipExperience.experience.toLocaleString("zh-CN")} / ${membershipExperience.nextLevel.requiredExperience.toLocaleString("zh-CN")}`
                      : `${membershipExperience.experience.toLocaleString("zh-CN")} EXP`}
                  </span>
                </div>
              ) : (
                <div className="home-profile-panel__level home-profile-panel__level--summary">
                  <PublicMemberIdentity username={session.user.username} maxMedals={0} />
                </div>
              )}
              <dl className="home-profile-panel__stats">
                <div><dt>我的发布</dt><dd>{ownTopics.length}</dd></div>
                <div><dt>收到回复</dt><dd>{ownReplies}</dd></div>
                <div><dt>获得喜欢</dt><dd>{ownLikes}</dd></div>
              </dl>
              <button className="primary-button" type="button" onClick={onCompose} aria-label="发布主题">
                <MessageSquare size={15} aria-hidden="true" />
                发布主题
              </button>
            </>
          ) : (
            <div className="home-profile-panel__guest">
              <span aria-hidden="true"><UserRound size={22} /></span>
              <div><h2>欢迎来到刀云社区</h2><p>登录后参与讨论与收藏</p></div>
              <button className="primary-button" type="button" onClick={onLogin}><LogIn size={15} />登录</button>
            </div>
          )}
        </section>

        <section className="panel home-hot-panel">
          <div className="panel-heading">
            <div><Flame size={16} aria-hidden="true" /><h2>今日热议</h2></div>
          </div>
          {hotTopics.length > 0 ? (
            <ol className="home-hot-list">
              {hotTopics.map((topic, index) => (
                <li key={topic.id}>
                  <span>{index + 1}</span>
                  <div>
                    <a href={`#topic/${topic.id}`} onClick={(event) => { event.preventDefault(); onOpenTopic(topic.id) }}>
                      {topicDisplayTitle(topic)}
                    </a>
                    <small>{topic.replies} 回复</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="home-sidebar-empty">暂无公开热议主题</p>}
        </section>

        {activeMembers.length > 0 && (
          <section className="panel home-member-panel">
            <div className="panel-heading">
              <div><UserRound size={16} aria-hidden="true" /><h2>活跃成员</h2></div>
            </div>
            <p>来自近期公开内容</p>
            <div className="home-member-list" aria-label="近期活跃成员">
              {activeMembers.map((member) => (
                <a href={`#user/${member.username}`} key={member.username} aria-label={`活跃成员：${member.displayName}`} title={member.displayName}>
                  <UserAvatar username={member.username} displayName={member.displayName} avatarUrl={member.avatarUrl} size="small" />
                </a>
              ))}
            </div>
          </section>
        )}
      </aside>
    )
  }

  if (variant === "boardDirectory") {
    const totalTopics = boards.reduce((total, board) => total + board.topicCount, 0)
    const rootBoards = boards.filter((board) => board.parentId === null).length

    return (
      <aside className="right-sidebar right-sidebar--boards" aria-label="版块信息">
        {activeBoards.length > 0 && (
          <section className="panel board-directory-popular-panel">
            <div className="panel-heading">
              <div><LayoutGrid size={17} aria-hidden="true" /><h2>热门版块</h2></div>
              <a href="#boards">查看全部<ArrowUpRight size={13} aria-hidden="true" /></a>
            </div>
            <ol className="board-directory-popular-list">
              {activeBoards.map((board, index) => (
                <li key={board.id}>
                  <a href={`#board/${board.slug}`}>
                    <span className={`community-list__icon community-list__icon--${board.tone}`} aria-hidden="true">
                      <LayoutGrid size={15} />
                    </span>
                    <span>
                      <strong>{board.name}</strong>
                      <small>{board.topicCount.toLocaleString("zh-CN")} 个主题</small>
                    </span>
                    <b aria-hidden="true">{index + 1}</b>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="panel board-directory-topic-panel">
          <div className="panel-heading">
            <div><Flame size={17} aria-hidden="true" /><h2>推荐话题</h2></div>
          </div>
          {hotTopics.length > 0 ? (
            <ol className="board-directory-topic-list">
              {hotTopics.map((topic, index) => (
                <li key={topic.id}>
                  <span aria-hidden="true">{index + 1}</span>
                  <button type="button" aria-label={`打开话题：${topicDisplayTitle(topic)}`} onClick={() => onOpenTopic(topic.id)}>
                    <strong>{topicDisplayTitle(topic)}</strong>
                    <small>{topic.replies.toLocaleString("zh-CN")} 回复 · {topic.views.toLocaleString("zh-CN")} 浏览</small>
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="board-detail-topic-list__empty">暂无公开推荐话题</p>}
        </section>

        <section className="panel board-directory-data-panel">
          <div className="panel-heading">
            <div><MessageSquare size={17} aria-hidden="true" /><h2>社区数据</h2></div>
          </div>
          <dl className="board-directory-data-list">
            <div><dt>公开主题</dt><dd>{totalTopics.toLocaleString("zh-CN")}</dd></div>
            <div><dt>全部版块</dt><dd>{boards.length.toLocaleString("zh-CN")}</dd></div>
            <div><dt>一级版块</dt><dd>{rootBoards.toLocaleString("zh-CN")}</dd></div>
          </dl>
        </section>
      </aside>
    )
  }

  if (variant === "boardDetail" && !currentBoard) {
    return <aside className="right-sidebar right-sidebar--board-detail" aria-label="当前版块信息" />
  }

  if (variant === "boardDetail" && currentBoard) {
    return (
      <aside className="right-sidebar right-sidebar--board-detail" aria-label="当前版块信息">
        <section className="panel board-detail-hero-panel" aria-labelledby="board-detail-hero-title">
          <div className="board-detail-hero-panel__content">
            <span aria-hidden="true"><LayoutGrid size={20} /></span>
            <div>
              <h2 id="board-detail-hero-title">{currentBoard.name}</h2>
              {currentBoard.description && <p>{currentBoard.description}</p>}
              <small>{currentBoard.topicCount.toLocaleString("zh-CN")} 个公开主题</small>
            </div>
          </div>
        </section>

        <section className="panel board-detail-rules-panel">
          <div className="panel-heading">
            <div><ShieldCheck size={17} aria-hidden="true" /><h2>版块规则 · 发帖须知</h2></div>
          </div>
          <ul className="board-guide-list">
            <li><CheckCircle2 size={15} aria-hidden="true" /><span>{currentBoard.viewer.canCreateTopic ? "可以在本版块发布主题" : "当前账号仅可浏览主题"}</span></li>
            <li><CheckCircle2 size={15} aria-hidden="true" /><span>{currentBoard.viewer.canReply ? "可以参与本版块回复" : "本版块当前不开放回复"}</span></li>
            <li><CheckCircle2 size={15} aria-hidden="true" /><span>{currentBoard.viewer.canUploadAttachment ? "发布时支持上传附件" : "发布时暂不支持上传附件"}</span></li>
          </ul>
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
            <div><Flame size={17} aria-hidden="true" /><h2>本版热议</h2></div>
          </div>
          {hotTopics.length > 0 ? (
            <ol className="board-detail-topic-list">
              {hotTopics.slice(0, 5).map((topic) => (
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
