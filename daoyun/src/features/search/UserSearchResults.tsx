import type { UserSummary } from "../../api/users"
import { UserAvatar } from "../../components/UserAvatar"

export function UserSearchResults({ users }: { users: UserSummary[] }) {
  return (
    <section className="search-result-section" aria-labelledby="user-search-title">
      <h2 id="user-search-title">用户</h2>
      {users.length === 0 ? <p className="search-result-empty">没有匹配的用户</p> : (
        <ul>{users.map((user) => <li key={user.id}><a href={`#user/${user.username}`}><UserAvatar username={user.username} displayName={user.displayName} avatarUrl={user.avatarUrl} size="small" /><span><strong>{user.displayName}</strong><small>@{user.username}</small></span></a></li>)}</ul>
      )}
    </section>
  )
}
