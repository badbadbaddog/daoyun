import { useState } from "react"
import { LoaderCircle, Save, X } from "lucide-react"

import { UserApiError } from "../api/users"
import type { UpdateUserProfileInput, UserProfile } from "../api/users"

interface ProfileEditFormProps {
  profile: UserProfile
  onSave: (input: UpdateUserProfileInput) => Promise<void>
  onCancel: () => void
}

export function ProfileEditForm({ profile, onSave, onCancel }: ProfileEditFormProps) {
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [bio, setBio] = useState(profile.bio)
  const [location, setLocation] = useState(profile.location ?? "")
  const [websiteUrl, setWebsiteUrl] = useState(profile.websiteUrl ?? "")
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [fields, setFields] = useState<Record<string, string[]>>({})

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setMessage("")
    setFields({})
    try {
      await onSave({
        baseRevision: profile.profileRevision,
        displayName,
        bio,
        location: location.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
      })
    } catch (error) {
      if (error instanceof UserApiError) {
        setFields(error.fields)
        setMessage(error.code === "profile.revision_conflict"
          ? "资料已在其他位置更新，请关闭编辑后重试。"
          : error.message)
      } else {
        setMessage("资料暂时无法保存，请稍后重试。")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="profile-edit-form" onSubmit={handleSubmit} aria-label="编辑公开资料">
      <div className="profile-edit-form__heading">
        <div>
          <h2>编辑公开资料</h2>
          <p>@{profile.username} 不可修改</p>
        </div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭资料编辑" title="关闭">
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <label>
        <span>显示名称</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={80}
          aria-invalid={Boolean(fields.display_name)}
        />
        <FieldError messages={fields.display_name} />
      </label>
      <label>
        <span>简介</span>
        <textarea
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={500}
          rows={4}
          aria-invalid={Boolean(fields.bio)}
        />
        <FieldError messages={fields.bio} />
      </label>
      <div className="profile-edit-form__grid">
        <label>
          <span>所在地</span>
          <input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={100} />
          <FieldError messages={fields.location} />
        </label>
        <label>
          <span>个人网站</span>
          <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} type="url" />
          <FieldError messages={fields.website_url} />
        </label>
      </div>
      <label>
        <span>头像 HTTPS 地址</span>
        <input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} type="url" />
        <FieldError messages={fields.avatar_url} />
      </label>

      {message && <p className="form-alert" role="alert">{message}</p>}
      <div className="profile-edit-form__actions">
        <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
          保存资料
        </button>
      </div>
    </form>
  )
}

function FieldError({ messages }: { messages?: string[] }) {
  return messages?.length ? <small className="field-error">{messages[0]}</small> : null
}
