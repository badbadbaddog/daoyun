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
import type { UserProfile, UserRelation, UserRelationPage } from "../api/users"
import { usePublicMembershipSummary } from "../features/membership/usePublicMembershipSummary"
import { MemberIdentityBadges } from "./PublicMemberIdentity"
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
type OwnerSecurityPanel = "devices" | "password" | "identities" | "passkeys" | "mfa" | null

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
  const membershipSummary = usePublicMembershipSummary(username)
  const [topics, setTopics] = useState<TopicPage>({ topics: [], nextCursor: null })
  const [status, setStatus] = useState<LoadStatus>("loading")
  const [requestVersion, setRequestVersion] = useState(0)
  const [activeTab, setActiveTab] = useState<ProfileTab>("topics")
  const [relations, setRelations] = useState<UserRelationPage>({ users: [], nextCursor: null })
  const [relationStatus, setRelationStatus] = useState<LoadStatus>("ready")
  const [relationRequestVersion, setRelationRequestVersion] = useState(0)
  const [editing, setEditing] = useState(false)
  const [ownerSecurityPanel, setOwnerSecurityPanel] = useState<OwnerSecurityPanel>(openExternalIdentities ? "identities" : null)
  const [followPending, setFollowPending] = useState(false)
  const [followError, setFollowError] = useState("")
  const [messagePending, setMessagePending] = useState(false)
  const [messageError, setMessageError] = useState("")
  const [bookmarkPendingIds, setBookmarkPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [bookmarkError, setBookmarkError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    setEditing(false)
    setOwnerSecurityPanel(openExternalIdentities ? "identities" : null)
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

  function handleProfileTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const tabs: ProfileTab[] = ["topics", "followers", "following"]
    let nextIndex: number | null = null
    if (event.key === "ArrowRight") nextIndex = index + 1
    else if (event.key === "ArrowLeft") nextIndex = index - 1
    else if (event.key === "Home") nextIndex = 0
    else if (event.key === "End") nextIndex = tabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = tabs[(nextIndex + tabs.length) % tabs.length]
    setActiveTab(next)
    document.getElementById(`profile-tab-${next}`)?.focus()
  }

  function toggleOwnerSecurityPanel(panel: Exclude<OwnerSecurityPanel, null>) {
    setOwnerSecurityPanel((current) => current === panel ? null : panel)
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
    if (bookmarkPendingIds.has(topicId)) return
    const topic = topics.topics.find((item) => item.id === topicId)
    if (!topic) return
    const bookmarked = topic.bookmarked !== true
    setBookmarkPendingIds((current) => new Set(current).add(topicId))
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
      setBookmarkPendingIds((current) => {
        const next = new Set(current)
        next.delete(topicId)
        return next
      })
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
          <MemberIdentityBadges summary={membershipSummary} variant="profile" maxMedals={0} />
        </div>
        <div className="profile-header__actions">
          {profile.viewer?.isSelf ? (
            <button className="secondary-button" type="button" onClick={() => setEditing((value) => !value)}>
              <Pencil size={15} aria-hidden="true" />
              编辑资料
            </button>
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
        {followError && <p className="form-alert" role="alert">{followError}</p>}
        {messageError && <p className="form-alert" role="alert">{messageError}</p>}
      </header>

      {membershipSummary && (
        <section className="profile-identity-showcase" aria-label="社区身份">
          <div className="profile-identity-showcase__level">
            {membershipSummary.currentLevel.iconAssetUrl && (
              <img
                className="profile-identity-showcase__level-icon"
                src={membershipSummary.currentLevel.iconAssetUrl}
                alt=""
                loading="lazy"
              />
            )}
            <div>
              <span className="profile-identity-showcase__eyebrow">成长等级</span>
              <h2>{membershipSummary.currentLevel.displayName}</h2>
              {membershipSummary.currentLevel.description && <p>{membershipSummary.currentLevel.description}</p>}
            </div>
          </div>

          {membershipSummary.publicGroups.length > 0 && (
            <div className="profile-identity-showcase__groups">
              <strong>公开身份</strong>
              <div>
                {membershipSummary.publicGroups.map((group) => (
                  <span key={group.id}>{group.displayName}</span>
                ))}
              </div>
            </div>
          )}

          <div className="profile-identity-showcase__medals">
            <strong>公开勋章</strong>
            {membershipSummary.medals.length > 0 ? (
              <ul>
                {membershipSummary.medals.map((medal) => (
                  <li key={medal.key}>
                    <img src={medal.assetUrl} alt="" loading="lazy" />
                    <span>{medal.displayName}</span>
                  </li>
                ))}
              </ul>
            ) : <p>还没有公开勋章</p>}
          </div>
        </section>
      )}

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

      {profile.viewer?.isSelf && session && (
        <section className="profile-owner-tools" aria-label="仅自己可见的账号管理">
          <div className="profile-owner-tools__heading">
            <div>
              <span>仅自己可见</span>
              <h2>账号与安全</h2>
            </div>
            <p>管理登录凭据、设备与额外验证方式，不会展示在公开主页。</p>
          </div>
          <div className="profile-owner-tools__actions">
            <button className="secondary-button" type="button" aria-expanded={ownerSecurityPanel === "devices"} aria-controls="profile-device-sessions-panel" onClick={() => toggleOwnerSecurityPanel("devices")}>
              管理设备会话
            </button>
            <button className="secondary-button" type="button" aria-expanded={ownerSecurityPanel === "password"} aria-controls="profile-password-panel" onClick={() => toggleOwnerSecurityPanel("password")}>
              <KeyRound size={15} aria-hidden="true" />
              修改密码
            </button>
            <button className="secondary-button" type="button" aria-expanded={ownerSecurityPanel === "identities"} aria-controls="profile-identities-panel" onClick={() => toggleOwnerSecurityPanel("identities")}>
              <Fingerprint size={15} aria-hidden="true" />
              登录方式
            </button>
            <button className="secondary-button" type="button" aria-expanded={ownerSecurityPanel === "passkeys"} aria-controls="profile-passkeys-panel" onClick={() => toggleOwnerSecurityPanel("passkeys")}>
              <Fingerprint size={15} aria-hidden="true" />
              通行密钥
            </button>
            <button className="secondary-button" type="button" aria-expanded={ownerSecurityPanel === "mfa"} aria-controls="profile-mfa-panel" onClick={() => toggleOwnerSecurityPanel("mfa")}>
              多因素认证
            </button>
          </div>
        </section>
      )}

      {editing && <ProfileEditForm profile={profile} onSave={handleSave} onCancel={() => setEditing(false)} />}
      {ownerSecurityPanel === "devices" && session && <div id="profile-device-sessions-panel"><DeviceSessionsPanel session={session} onClose={() => setOwnerSecurityPanel(null)} /></div>}
      {ownerSecurityPanel === "password" && session && (
        <div id="profile-password-panel"><PasswordChangePanel
          session={session}
          onClose={() => setOwnerSecurityPanel(null)}
          onSessionChange={onSessionChange ?? (() => undefined)}
        /></div>
      )}
      {ownerSecurityPanel === "identities" && session && (
        <div id="profile-identities-panel"><ExternalIdentitiesPanel
          session={session}
          onClose={() => setOwnerSecurityPanel(null)}
          onSessionChange={onSessionChange ?? (() => undefined)}
        /></div>
      )}
      {ownerSecurityPanel === "passkeys" && session && (
        <div id="profile-passkeys-panel"><PasskeysPanel
          session={session}
          onClose={() => setOwnerSecurityPanel(null)}
          onSessionChange={onSessionChange ?? (() => undefined)}
        /></div>
      )}
      {ownerSecurityPanel === "mfa" && session && (
        <div id="profile-mfa-panel"><MfaPanel
          session={session}
          onClose={() => setOwnerSecurityPanel(null)}
          onSessionChange={onSessionChange ?? (() => undefined)}
        /></div>
      )}

      <div className="profile-tabs" role="tablist" aria-label="用户内容">
        <ProfileTabButton activeTab={activeTab} tab="topics" label="主题" index={0} onSelect={setActiveTab} onKeyDown={handleProfileTabKey} />
        <ProfileTabButton activeTab={activeTab} tab="followers" label="关注者" index={1} onSelect={setActiveTab} onKeyDown={handleProfileTabKey} />
        <ProfileTabButton activeTab={activeTab} tab="following" label="正在关注" index={2} onSelect={setActiveTab} onKeyDown={handleProfileTabKey} />
      </div>

      <div id="profile-content" className="profile-content" role="tabpanel" aria-labelledby={`profile-tab-${activeTab}`}>
        {bookmarkError && <p className="interaction-alert" role="alert">{bookmarkError}</p>}
        {activeTab === "topics" ? (
          topics.topics.length ? (
            <div className="topic-list">{topics.topics.map((topic) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                onOpen={onOpenTopic}
                onToggleBookmark={handleTopicBookmark}
                bookmarkPending={bookmarkPendingIds.has(topic.id)}
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

function ProfileTabButton({ activeTab, tab, label, index, onSelect, onKeyDown }: {
  activeTab: ProfileTab
  tab: ProfileTab
  label: string
  index: number
  onSelect: (tab: ProfileTab) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => void
}) {
  return <button id={`profile-tab-${tab}`} type="button" role="tab" aria-controls="profile-content" aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} onClick={() => onSelect(tab)} onKeyDown={(event) => onKeyDown(event, index)}>{label}</button>
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
