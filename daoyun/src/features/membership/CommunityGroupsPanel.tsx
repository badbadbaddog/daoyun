import type { MemberCommunityGroup } from "./membershipTypes"

export function CommunityGroupsPanel({ base, additional }: { base: MemberCommunityGroup[]; additional: MemberCommunityGroup[] }) {
  return <section className="member-panel" aria-label="社区用户组"><p className="member-panel__eyebrow">Community Group</p><h2>社区用户组</h2><GroupList label="基础组" groups={base} /><GroupList label="附加组" groups={additional} /></section>
}

function GroupList({ label, groups }: { label: string; groups: MemberCommunityGroup[] }) {
  return <div className="member-group-list"><h3>{label}</h3>{groups.length ? <ul>{groups.map((group) => <li key={group.id}><span>{group.displayName}</span>{group.expiresAt && <time dateTime={group.expiresAt}>至 {new Date(group.expiresAt).toLocaleDateString()}</time>}</li>)}</ul> : <p>暂无</p>}</div>
}
