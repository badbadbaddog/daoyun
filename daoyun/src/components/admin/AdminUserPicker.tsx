import { LoaderCircle, Search } from "lucide-react"
import { useEffect, useState } from "react"

export interface AdminUserCandidate {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
  status: string
}

interface AdminUserPickerProps {
  query: string
  users: AdminUserCandidate[]
  selectedUser: AdminUserCandidate | null
  loading: boolean
  disabled?: boolean
  onQueryChange: (query: string) => void
  onSelect: (user: AdminUserCandidate) => void
}

export function AdminUserPicker({ query, users, selectedUser, loading, disabled = false, onQueryChange, onSelect }: AdminUserPickerProps) {
  const [draft, setDraft] = useState(query)
  useEffect(() => setDraft(query), [query])
  return <section className="admin-user-picker" aria-label="选择操作用户"><label><span>搜索用户</span><span className="admin-user-picker__input"><Search size={15} aria-hidden="true" /><input type="search" disabled={disabled} aria-label="搜索用户" placeholder="用户名、显示名称或邮箱" value={draft} onChange={(event) => { setDraft(event.target.value); onQueryChange(event.target.value) }} /></span></label>{loading ? <p role="status"><LoaderCircle className="topic-loading__spinner" size={16} />正在搜索</p> : users.length > 0 ? <ul>{users.map((user) => <li key={user.id}><button type="button" disabled={disabled} aria-pressed={selectedUser?.id === user.id} aria-label={`选择${user.displayName} @${user.username}`} onClick={() => onSelect(user)}><strong>{user.displayName}</strong><span>@{user.username}</span><small>{user.status === "active" ? "正常" : user.status}</small></button></li>)}</ul> : draft.trim().length >= 2 ? <p>没有匹配用户</p> : <p>输入至少 2 个字符，按用户名或显示名称搜索。</p>}</section>
}
