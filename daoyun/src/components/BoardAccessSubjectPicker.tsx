import { useEffect, useState } from "react"
import { listAdminCommunityGroups, listAuthorizationPermissions, listStandardEntitlementTypes } from "../api/admin"

type PickerKind = "community_group" | "entitlement" | "governance"
interface Choice { value: string; label: string }
const labels = { community_group: "社区用户组", entitlement: "标准权益", governance: "治理权限" }
const requirements = { community_group: "community.groups.read", entitlement: "entitlements.types.read", governance: "authorization.roles.read" }

export function BoardAccessSubjectPicker({ kind, index, value, capabilityKeys, disabled, onChange }: { kind: PickerKind; index: number; value: string; capabilityKeys: string[]; disabled: boolean; onChange: (value: string) => void }) {
  const label = labels[kind]
  const allowed = capabilityKeys.includes(requirements[kind])
  const [choices, setChoices] = useState<Choice[]>([])
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setChoices([]); setQuery(""); setStatus("loading")
    if (!allowed) return () => controller.abort()
    async function load() {
      try {
        const options: Choice[] = kind === "community_group"
          ? (await listAdminCommunityGroups(controller.signal)).filter(item => item.status === "active").map(item => ({ value: item.id, label: item.displayName + " · " + item.id.slice(-8) }))
          : kind === "entitlement"
            ? (await listStandardEntitlementTypes(controller.signal)).filter(item => item.status === "active").map(item => ({ value: item.internalKey, label: item.displayName + " · " + item.internalKey }))
            : (await listAuthorizationPermissions(controller.signal)).filter(item => item.key.startsWith("governance.") || item.key.startsWith("moderation.") || item.key === "audit.related.read").map(item => ({ value: item.key, label: item.name + " · " + item.key }))
        if (!controller.signal.aborted) { setChoices(options); setStatus("ready") }
      } catch { if (!controller.signal.aborted) setStatus("error") }
    }
    void load()
    return () => controller.abort()
  }, [kind, allowed, retry])
  const normalized = query.trim().toLocaleLowerCase()
  const visible = choices.filter(item => item.value === value || item.label.toLocaleLowerCase().includes(normalized))
  return <div className="admin-board-subject-picker">
    {allowed && <label><span>搜索{label}</span><input type="search" aria-label={"搜索" + label + " " + index} value={query} disabled={disabled || status !== "ready"} onChange={event => setQuery(event.target.value)} placeholder={"按名称搜索" + label} /></label>}
    <label><span>{label}</span><select aria-label={label + " " + index} value={value} onChange={event => onChange(event.target.value)} disabled={disabled || !allowed || status !== "ready"} required>
      <option value="">请选择{label}</option>
      {value && !choices.some(item => item.value === value) && <option value={value} disabled>当前选择 · {value}（目录不可用或已停用）</option>}
      {visible.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    {!allowed ? <p>没有读取{label}的权限。</p> : status === "loading" ? <p role="status">正在加载{label}…</p> : status === "error" ? <><p className="form-alert" role="alert">{label}暂时无法加载。</p><button className="secondary-button" type="button" disabled={disabled} onClick={() => setRetry(count => count + 1)}>重试{label}</button></> : choices.length === 0 ? <p>没有可选择的{label}。</p> : null}
  </div>
}
