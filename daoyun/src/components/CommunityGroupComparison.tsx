import { X } from "lucide-react"
import { useState } from "react"
import type { AdminCommunityGroup } from "../api/admin"
import { communityPermissionKeys, communityGroupQuotaKeys as communityQuotaKeys, formatCommunityQuota, permissionLabels } from "./communityGroupRules"
import { ModalDialog } from "./ui/ModalDialog"

interface CommunityGroupComparisonProps {
  groups: AdminCommunityGroup[]
  canWrite: boolean
  onClose: () => void
  onEdit: (group: AdminCommunityGroup, trigger: HTMLButtonElement) => void
}

export function CommunityGroupComparison({ groups, canWrite, onClose, onEdit }: CommunityGroupComparisonProps) {
  const [selectedIds, setSelectedIds] = useState(() => groups.slice(0, 2).map(group => group.id))
  const [differencesOnly, setDifferencesOnly] = useState(false)
  const selected = groups.filter(group => selectedIds.includes(group.id))
  const rows = [
    ...communityPermissionKeys.map(key => ({ key, label: permissionLabels[key], values: selected.map(group => key === "content.pre_moderation.required" ? group.permissionKeys.includes(key) ? "需要审核" : "本组无审核要求" : group.permissionKeys.includes(key) ? "本组提供" : "本组不提供") })),
    ...communityQuotaKeys.map(({ key, label }) => ({ key, label, values: selected.map(group => formatCommunityQuota(key, group.quotas[key] ?? 0)) })),
    { key: "identity", label: "身份类型", values: selected.map(group => group.isBase ? "基础组" : "附加组") },
    { key: "status", label: "状态", values: selected.map(group => group.status === "active" ? "启用" : group.status === "disabled" ? "停用" : "已归档") },
    { key: "joining", label: "加入方式", values: selected.map(group => group.isDefault ? "注册默认" : group.isBase ? "基础身份配置" : "管理员授予") },
  ].filter(row => !differencesOnly || new Set(row.values).size > 1)
  return <ModalDialog className="community-group-comparison" titleId="community-group-comparison-title" onClose={onClose}>
    <header><div><h3 id="community-group-comparison-title">用户组对比</h3><p>比较 2 至 4 个组的配置；具体用户的最终权限还取决于其他身份、权益和限制。</p></div><button type="button" className="icon-button" aria-label="关闭用户组对比" title="关闭用户组对比" onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <fieldset className="community-group-comparison__selection"><legend>选择要比较的组（最多 4 个）</legend>{groups.map(group => <label key={group.id}><input type="checkbox" aria-label={"对比" + group.displayName + " · " + group.id.slice(-8)} checked={selectedIds.includes(group.id)} disabled={!selectedIds.includes(group.id) && selectedIds.length >= 4} onChange={event => setSelectedIds(current => event.target.checked ? [...current, group.id] : current.filter(id => id !== group.id))} /><span>{group.displayName}<small>{group.isBase ? "基础组" : "附加组"} · {group.id.slice(-8)}</small></span></label>)}</fieldset>
    <label className="community-group-comparison__difference"><input type="checkbox" checked={differencesOnly} onChange={event => setDifferencesOnly(event.target.checked)} />只看差异</label>
    {selected.length < 2 ? <p role="status">请至少选择 2 个用户组。</p> : <><p className="community-group-comparison__scroll-hint">表格可横向滚动查看所有组，首列保留规则名称。</p><div className="community-group-table-scroll" tabIndex={0} role="region" aria-label="规则对比表格"><table aria-label="用户组规则对比"><thead><tr><th scope="col">能力或规则</th>{selected.map(group => <th scope="col" key={group.id}>{group.displayName}<small>{group.isBase ? "基础组" : "附加组"} · {group.id.slice(-8)} · 修订 {group.revision}</small>{canWrite && <button className="secondary-button" type="button" aria-label={"编辑" + group.displayName + " · " + group.id.slice(-8)} onClick={event => onEdit(group, event.currentTarget)}>编辑</button>}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td key={selected[index].id}>{value}</td>)}</tr>)}</tbody></table></div>{rows.length === 0 && <p role="status">所选用户组没有配置差异。</p>}</>}
    <p className="community-group-editor__hint">0 为本组不提供额度。这里只比较组规则；可在用户详情核对该用户的有效身份。</p><footer><button className="secondary-button" type="button" onClick={onClose}>返回用户组</button></footer>
  </ModalDialog>
}
