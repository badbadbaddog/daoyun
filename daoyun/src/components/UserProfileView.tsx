import { useEffect, useState } from "react"
import {
  ArrowLeft,
  CalendarDays,
  FileSearch,
  Fingerprint,
  Link as LinkIcon,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Pencil,
  KeyRound,
  RefreshCw,
  UserCheck,
  UserPlus,
} from "lucide-react"

import type { AuthSession } from "../api/auth"
import { createConversation } from "../api/messages"
import type { ConversationSummary } from "../api/messages"
import { setTopicBookmark } from "../api/relations"
import { listTopics } from "../api/topics"
import type { TopicPage } from "../api/topics"
import {
  getUserProfile,
  listUserRelations,
  setUserFollowing,
  updateUserProfile,
} from "../api/users"
import { listUserMedals } from "../api/users"
import type { MembershipMedal, UserProfile, UserRelation, UserRelationPage } from "../api/users"
import { ProfileEditForm } from "./ProfileEditForm"
import { DeviceSessionsPanel } from "./DeviceSessionsPanel"
import { ExternalIdentitiesPanel } from "./ExternalIdentitiesPanel"
import { PasskeysPanel } from "./PasskeysPanel"
import { PasswordChangePanel } from "./PasswordChangePanel"
import { PluginUiSurface } from "./PluginUiSurface"
import { MfaPanel } from "./MfaPanel"
import { TopicRow } from "./TopicRow"
import { UserAvatar } from "./UserAvatar"

type ProfileTab = "topics" | UserRelation
type LoadStatus = "loading" | "ready" | "error"

interface UserProfileViewProps {
  username: string
  session: AuthSession | null
  onBack: () => void
  onLogin: () => void
  onOpenTopic: (topicId: string) => void
  onOpenConversation?: (conversation: ConversationSummary) => void
  onBookmarkChanged?: (topicId: string, bookmarked: boolean) => void
  onSessionChange?: (session: AuthSession) => void
  openExternalIdentities?: boolean
}

export function UserProfileView({
  username,
  session,
  onBack,
  onLogin,
  onOpenTopic,
  onOpenConversation,
  onBookmarkChanged,
  onSessionChange,
  openExternalIdentities = false,
}: UserProfileViewProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [medals, setMedals] = useState<MembershipMedal[]>([])
  const [topics, setTopics] = useState<TopicPage>({ topics: [], nextCursor: null })
  const [status, setStatus] = useState<LoadStatus>("loading")
  const [requestVersion, setRequestVersion] = useState(0)
  const [activeTab, setActiveTab] = useState<ProfileTab>("topics")
  const [relations, setRelations] = useState<UserRelationPage>({ users: [], nextCursor: null })
  const [relationStatus, setRelationStatus] = useState<LoadStatus>("ready")
  const [relationRequestVersion, setRelationRequestVersion] = useState(0)
  const [editing, setEditing] = useState(false)
  const [showDeviceSessions, setShowDeviceSessions] = useState(false)
  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [showExternalIdentities, setShowExternalIdentities] = useState(openExternalIdentities)
  const [showPasskeys, setShowPasskeys] = useState(false)
  const [showMfa, setShowMfa] = useState(false)
  const [followPending, setFollowPending] = useState(false)
  const [followError, setFollowError] = useState("")
  const [messagePending, setMessagePending] = useState(false)
  const [messageError, setMessageError] = useState("")
  const [bookmarkPendingId, setBookmarkPendingId] = useState<string | null>(null)
  const [bookmarkError, setBookmarkError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    setEditing(false)
    setShowDeviceSessions(false)
    setShowPasswordChange(false)
    setShowExternalIdentities(openExternalIdentities)
    setShowPasskeys(false)
    setShowMfa(false)
    setActiveTab("topics")
    Promise.all([
      getUserProfile(username, controller.signal),
      listTopics({ author: username, signal: controller.signal }),
    ]).then(([loadedProfile, loadedTopics]) => {
      if (!controller.signal.aborted) {
        setProfile(loadedProfile)
        setTopics(loadedTopics)
        setStatus("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) setStatus("error")
    })
    return () => controller.abort()
  }, [username, requestVersion, session?.user.id, openExternalIdentities])

  useEffect(() => {
    const controller = new AbortController()
    setMedals([])
    listUserMedals(username, controller.signal)
      .then((loaded) => { if (!controller.signal.aborted) setMedals(loaded) })
      .catch(() => { if (!controller.signal.aborted) setMedals([]) })
    return () => controller.abort()
  }, [username, requestVersion])

  useEffect(() => {
    if (activeTab === "topics") return
    const controller = new AbortController()
    setRelationStatus("loading")
    setRelations({ users: [], nextCursor: null })
    listUserRelations(username, activeTab, { signal: controller.signal }).then((page) => {
      if (!controller.signal.aborted) {
        setRelations(page)
        setRelationStatus("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) setRelationStatus("error")
    })
    return () => controller.abort()
  }, [activeTab, relationRequestVersion, username])

  if (status === "loading") {
    return <ProfileState kind="loading" onBack={onBack} />
  }
  if (status === "error" || !profile) {
    return <ProfileState kind="error" onBack={onBack} onRetry={() => setRequestVersion((value) => value + 1)} />
  }

  async function handleFollow() {
    if (!profile) return
    if (!session) {
      onLogin()
      return
    }
    const nextFollowing = !profile.viewer?.isFollowing
    setFollowPending(true)
    setFollowError("")
    try {
      const state = await setUserFollowing(profile.id, nextFollowing, session.csrfToken)
      setProfile((current) => current && ({
        ...current,
        followerCount: state.followerCount,
        viewer: current.viewer && { ...current.viewer, isFollowing: state.following },
      }))
    } catch {
      setFollowError("关注状态暂时无法更新。")
    } finally {
      setFollowPending(false)
    }
  }

  async function handleSave(input: Parameters<typeof updateUserProfile>[0]) {
    if (!session) return
    const updated = await updateUserProfile(input, session.csrfToken)
    setProfile(updated)
    setEditing(false)
  }

  async function handleMessage() {
    if (!profile) return
    if (!session) {
      onLogin()
      return
    }
    if (!profile.viewer?.canMessage) return
    setMessagePending(true)
    setMessageError("")
    try {
      const conversation = await createConversation(profile.id, session.csrfToken)
      onOpenConversation?.(conversation)
    } catch {
      setMessageError("私信会话暂时无法创建。")
    } finally {
      setMessagePending(false)
    }
  }

  async function handleTopicBookmark(topicId: string) {
    if (!session) {
      onLogin()
      return
    }
    const topic = topics.topics.find((item) => item.id === topicId)
    if (!topic) return
    const bookmarked = topic.bookmarked !== true
    setBookmarkPendingId(topicId)
    setBookmarkError("")
    try {
      const state = await setTopicBookmark(topicId, bookmarked, session.csrfToken)
      setTopics((current) => ({
        ...current,
        topics: current.topics.map((item) => item.id === state.topicId
          ? { ...item, bookmarked: state.bookmarked }
          : item),
      }))
      onBookmarkChanged?.(state.topicId, state.bookmarked)
    } catch {
      setBookmarkError("收藏状态暂时无法更新。")
    } finally {
      setBookmarkPendingId(null)
    }
  }

  return (
    <section className="profile-view" aria-labelledby="profile-heading">
      <button className="detail-back" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        返回社区
      </button>

      <header className="profile-header">
        <UserAvatar username={profile.username} displayName={profile.displayName} avatarUrl={profile.avatarUrl} size="large" />
        <div className="profile-header__identity">
          <h1 id="profile-heading">{profile.displayName}</h1>
          <p>@{profile.username}</p>
        </div>
        <div className="profile-header__actions">
          {profile.viewer?.isSelf ? (
            <>
              <button className="secondary-button" type="button" onClick={() => setEditing((value) => !value)}>
                <Pencil size={15} aria-hidden="true" />
                编辑资料
              </button>
              <button className="secondary-button" type="button" onClick={() => setShowDeviceSessions((value) => !value)}>
                管理设备会话
              </button>
              <button className="secondary-button" type="button" onClick={() => setShowPasswordChange((value) => !value)}>
                <KeyRound size={15} aria-hidden="true" />
                修改密码
              </button>
              <button className="secondary-button" type="button" onClick={() => setShowExternalIdentities((value) => !value)}>
                <Fingerprint size={15} aria-hidden="true" />
                登录方式
              </button>
              <button className="secondary-button" type="button" onClick={() => setShowPasskeys((value) => !value)}>
                <Fingerprint size={15} aria-hidden="true" />
                通行密钥
              </button>
              <button className="secondary-button" type="button" onClick={() => setShowMfa((value) => !value)}>
                多因素认证
              </button>
            </>
          ) : (
            <>
              <button className={profile.viewer?.isFollowing ? "secondary-button" : "primary-button"} type="button" onClick={handleFollow} disabled={followPending}>
                {profile.viewer?.isFollowing ? <UserCheck size={15} aria-hidden="true" /> : <UserPlus size={15} aria-hidden="true" />}
                {profile.viewer?.isFollowing ? "已关注" : "关注"}
              </button>
              {(!session || profile.viewer?.canMessage) && (
                <button className="secondary-button" type="button" onClick={handleMessage} disabled={messagePending}>
                  {messagePending
                    ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />
                    : <MessageCircle size={15} aria-hidden="true" />}
                  私信
                </button>
              )}
            </>
          )}
        </div>
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        <div className="profile-meta">
          {profile.location && <span><MapPin size={14} aria-hidden="true" />{profile.location}</span>}
          {profile.websiteUrl && <a href={profile.websiteUrl} target="_blank" rel="noreferrer"><LinkIcon size={14} aria-hidden="true" />个人网站</a>}
          <span><CalendarDays size={14} aria-hidden="true" />{formatJoinDate(profile.createdAt)}加入</span>
        </div>
        <div className="profile-stats">
          <button type="button" onClick={() => setActiveTab("topics")}><strong>{profile.topicCount}</strong> 个主题</button>
          <button type="button" onClick={() => setActiveTab("followers")}><strong>{profile.followerCount}</strong> 位关注者</button>
          <button type="button" onClick={() => setActiveTab("following")}><strong>{profile.followingCount}</strong> 个正在关注</button>
        </div>
        {medals.length > 0 && (
          <div className="profile-medals" aria-label="用户勋章">
            <strong>勋章</strong>
            <div className="profile-medals__list">
              {medals.map((medal) => (
                <img key={medal.key} src={medal.assetUrl} alt={medal.displayName} title={medal.displayName} loading="lazy" />
              ))}
            </div>
          </div>
        )}
        {followError && <p className="form-alert" role="alert">{followError}</p>}
        {messageError && <p className="form-alert" role="alert">{messageError}</p>}
      </header>

      <PluginUiSurface
        slot="user_profile"
        subjectId={profile.id}
        csrfToken={session?.csrfToken}
      />
      {profile.viewer?.isSelf && session ? <PluginUiSurface
        slot="membership_panel"
        subjectId={profile.id}
        csrfToken={session.csrfToken}
      /> : null}

      {editing && <ProfileEditForm profile={profile} onSave={handleSave} onCancel={() => setEditing(false)} />}
      {showDeviceSessions && session && <DeviceSessionsPanel session={session} onClose={() => setShowDeviceSessions(false)} />}
      {showPasswordChange && session && (
        <PasswordChangePanel
          session={session}
          onClose={() => setShowPasswordChange(false)}
          onSessionChange={onSessionChange ?? (() => undefined)}
        />
      )}
      {showExternalIdentities && session && (
        <ExternalIdentitiesPanel
          session={session}
          onClose={() => setShowExternalIdentities(false)}
          onSessionChange={onSessionChange ?? (() => undefined)}
        />
      )}
      {showPasskeys && session && (
        <PasskeysPanel
          session={session}
          onClose={() => setShowPasskeys(false)}
          onSessionChange={onSessionChange ?? (() => undefined)}
        />
      )}
      {showMfa && session && (
        <MfaPanel
          session={session}
          onClose={() => setShowMfa(false)}
          onSessionChange={onSessionChange ?? (() => undefined)}
        />
      )}

      <div className="profile-tabs" role="tablist" aria-label="用户内容">
        <ProfileTabButton activeTab={activeTab} tab="topics" label="主题" onSelect={setActiveTab} />
        <ProfileTabButton activeTab={activeTab} tab="followers" label="关注者" onSelect={setActiveTab} />
        <ProfileTabButton activeTab={activeTab} tab="following" label="正在关注" onSelect={setActiveTab} />
      </div>

      <div className="profile-content" role="tabpanel">
        {bookmarkError && <p className="interaction-alert" role="alert">{bookmarkError}</p>}
        {activeTab === "topics" ? (
          topics.topics.length ? (
            <div className="topic-list">{topics.topics.map((topic) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                onOpen={onOpenTopic}
                onToggleBookmark={handleTopicBookmark}
                bookmarkPending={bookmarkPendingId === topic.id}
              />
            ))}</div>
          ) : <EmptyProfilePanel message="还没有公开主题" />
        ) : relationStatus === "loading" ? (
          <div className="topic-loading" role="status"><LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" />正在加载关系</div>
        ) : relationStatus === "error" ? (
          <div className="empty-state" role="alert">
            <FileSearch size={24} aria-hidden="true" />
            <p>关系列表暂时无法加载</p>
            <button className="secondary-button empty-state__action" type="button" onClick={() => setRelationRequestVersion((value) => value + 1)}>
              <RefreshCw size={15} aria-hidden="true" />
              重试加载关系
            </button>
          </div>
        ) : relations.users.length ? (
          <ul className="relation-list">
            {relations.users.map((user) => (
              <li key={user.id}>
                <a href={`#user/${user.username}`}>
                  <UserAvatar username={user.username} displayName={user.displayName} avatarUrl={user.avatarUrl} />
                  <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
                </a>
              </li>
            ))}
          </ul>
        ) : <EmptyProfilePanel message={activeTab === "followers" ? "还没有关注者" : "还没有关注其他用户"} />}
      </div>
    </section>
  )
}

function ProfileTabButton({ activeTab, tab, label, onSelect }: {
  activeTab: ProfileTab
  tab: ProfileTab
  label: string
  onSelect: (tab: ProfileTab) => void
}) {
  return <button type="button" role="tab" aria-selected={activeTab === tab} onClick={() => onSelect(tab)}>{label}</button>
}

function ProfileState({ kind, onBack, onRetry }: { kind: LoadStatus; onBack: () => void; onRetry?: () => void }) {
  return (
    <section className="profile-view">
      <button className="detail-back" type="button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />返回社区</button>
      {kind === "loading" ? (
        <div className="topic-loading" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" />正在加载用户资料</div>
      ) : (
        <div className="empty-state" role="alert"><FileSearch size={28} aria-hidden="true" /><h1>用户资料无法加载</h1><button className="secondary-button" type="button" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />重试</button></div>
      )}
    </section>
  )
}

function EmptyProfilePanel({ message }: { message: string }) {
  return <div className="empty-state" role="status"><FileSearch size={24} aria-hidden="true" /><p>{message}</p></div>
}

function formatJoinDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月`
}
