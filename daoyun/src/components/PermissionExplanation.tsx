import type { AdminBoard } from "../api/admin"
import type { PermissionMatrixAction, PermissionMatrixScenario } from "../api/boardPermissions"
import { communityQuotaKeys, formatCommunityQuota } from "./communityGroupRules"

export const permissionActions: Array<{ key: PermissionMatrixAction; label: string }> = [
  { key: "browse", label: "浏览版块／主题" }, { key: "topic_create", label: "发帖" }, { key: "reply_create", label: "回复主题" },
  { key: "attachment_upload", label: "主题附件上传" }, { key: "attachment_download", label: "原文件下载" },
  { key: "moderation_browse", label: "治理查看已发布主题" }, { key: "topic_pin", label: "主题置顶／取消置顶" },
  { key: "topic_feature", label: "主题精华／取消精华" }, { key: "topic_lock", label: "主题锁定／解锁" }, { key: "topic_move", label: "移动主题" },
]
export const permissionReasons: Record<string, string> = {
  "scenario.specific_user_required": "仍需具体用户、其他来源及资源上下文。",
  "scenario.other_sources_unknown": "本组未提供；其他组或权益可能提供。",
  "group.inactive": "该组已停用。",
  "board.hidden": "本版块隐藏，公共目录及普通直达访问被拒绝。",
  "content.access_policy_unmatched": "不满足资源当前访问策略。",
  "board.access_policy_matched": "当前版块访问条件满足。",
  "board.basic_conditions_matched": "当前版块发帖条件满足，提交时还会验证内容。",
  "community.permission_not_provided": "当前有效用户组和权益未提供此动作。",
  "community.quota_exhausted": "本次操作超过当前可用额度。",
  "account.inactive": "账号当前不能执行此动作，来源提供能力也不能放行。",
  "account.restricted": "账号限制覆盖了此写入动作。",
  "board.action_restricted": "该用户在本版块被限制执行此动作。",
  "resource.context_required": "还需具体主题、状态、归属、目标版块或文件信息；这不是最终允许。",
  "resource.context_required_upload_quota_exempt": "最高管理身份免上传额度；仍需主题归属、文件和访问条件。",
  "resource.unavailable": "资源当前不可用或不满足此动作的状态条件。",
  "resource.conditions_matched": "当前来源、额度与所选资源的权限条件满足。",
  "attachment.owner_required": "主题附件上传只允许主题作者操作。",
  "topic.locked": "主题已锁定，不能新增回复。",
  "governance.role_required": "用户组和权益不提供治理能力，需检查具体用户的角色任命。",
  "governance.permission_not_provided": "没有覆盖当前版块且提供此治理动作的角色任命。",
  "governance.target_permission_not_provided": "角色任命未提供目标版块的移动权限，源版块权限不能替代它。",
  "governance.same_board": "源版块和目标版块相同，不适用移动。",
  "governance.conditions_matched": "当前治理能力、任命范围与资源条件满足；实际操作仍重新检查修订与权限。",
}
export const unknownPermissionReason = "服务端返回了尚未识别的原因，请展开技术详情核对。"
export function isGovernanceAction(action: PermissionMatrixAction) { return action === "moderation_browse" || ["topic_pin", "topic_feature", "topic_lock", "topic_move"].includes(action) }

export function PermissionExplanation({ scenario, action, boards = [], policyRevision, topicRevision, targetBoardId, headingLevel = 3 }: {
  scenario: PermissionMatrixScenario; action: PermissionMatrixAction; boards?: Pick<AdminBoard, "id" | "name">[];
  policyRevision?: number | null; topicRevision?: number | null; targetBoardId?: string | null; headingLevel?: 3 | 4
}) {
  const result = scenario.actions.find(value => value.action === action)
  if (!result) return <p role="alert">缺少此动作的服务端检查结果。</p>
  const Heading = headingLevel === 4 ? "h4" : "h3"
  const governance = isGovernanceAction(action)
  const sourceLayers = [
    { key: "base", label: "基础用户组", sources: scenario.sources.filter(s => s.kind === "group" && s.membership_kind === "base") },
    { key: "additional", label: "附加用户组", sources: scenario.sources.filter(s => s.kind === "group" && s.membership_kind === "additional") },
    { key: "entitlement", label: "标准权益", sources: scenario.sources.filter(s => s.kind === "entitlement") },
    { key: "role", label: "治理任命", sources: scenario.sources.filter(s => s.kind === "role") },
  ]
  const boardName = (id: string) => boards.find(board => board.id === id)?.name ?? "版块尾号 " + id.slice(-8)
  return <div className="admin-permission-explanation">
    <section><Heading>账号状态</Heading><p>{scenario.kind === "group" ? "未指定具体用户，不能检查账号状态或其他来源。" : scenario.account_status == null ? "未取得账号状态，不能解释账号限制。" : scenario.account_status === "suspended" ? "账号已停用，最终拒绝优先。" : scenario.account_status === "restricted" ? "账号受限，配置的普通写入限制仍优先；治理能力按角色任命检查。" : "账号正常；仍需满足各项来源与资源条件。"}</p></section>
    {sourceLayers.map(layer => <section key={layer.key}><Heading>{layer.label}</Heading>
      {layer.sources.length === 0 ? <p>{scenario.kind === "group" && layer.key !== "base" && layer.key !== "additional" ? "单个用户组场景不包含此类用户来源。" : "本次快照没有此类来源。"}</p> : <ul>{layer.sources.map(source => <li key={source.id}>
        <strong>{source.kind === "group" ? "用户组：" : source.kind === "entitlement" ? "权益：" : "角色："}{source.display_name}</strong>
        <p>{result.source_ids.includes(source.id) ? "提供此动作" : source.kind === "role" && !governance ? "治理任命不提供普通社区能力" : "未提供此动作"}{source.type_version != null ? " · 快照版本 " + source.type_version : ""}</p>
        {source.role ? <><p>{source.role.scope === "instance" ? "实例范围" : source.role.scope === "site" ? "站点范围" : boardName(source.role.scope_id!) + " · " + (source.role.scope_mode === "subtree" ? "当前及全部后代" : "仅本版块")} · {source.role.scope_matches ? "覆盖当前版块" : "不覆盖当前版块"}</p>
          {source.role.target_scope_matches != null && <p>{source.role.target_scope_matches ? "覆盖目标版块" : "不覆盖目标版块"}</p>}
          <p>长期任命{source.role.is_system ? " · 系统任命受保护" : ""}{source.starts_at ? " · 任命时间 " + new Date(source.starts_at).toLocaleString("zh-CN") : ""}</p></> : source.starts_at && <p>生效：{new Date(source.starts_at).toLocaleString("zh-CN")} · 到期：{source.ends_at ? new Date(source.ends_at).toLocaleString("zh-CN") : "无到期时间"}</p>}
      </li>)}</ul>}
    </section>)}
    <section><Heading>资源条件</Heading><p>{permissionReasons[result.reason] ?? unknownPermissionReason}</p>
      {targetBoardId && <p>移动目标：{boardName(targetBoardId)}；移动需同时满足源版块与目标版块的范围和状态条件。</p>}
      <p>{governance ? "治理动作不使用社区额度。治理查看只检查现有已发布主题读取规则，不承诺读取待审、隐藏状态或已删除主题。" : "普通动作由用户组和权益提供；访问策略是资源条件，不自动授予治理动作。"}</p>
    </section>
    {!governance && <section><Heading>当前额度</Heading><dl>{scenario.quotas.map(quota => <div key={quota.key}>
      <dt>{communityQuotaKeys.find(item => item.key === quota.key)?.label ?? quota.key}</dt><dd>上限 {formatCommunityQuota(quota.key, quota.limit)} · 已用 {quota.used == null ? "缺少具体用户或不适用" : formatCommunityQuota(quota.key, quota.used)} · 取有效普通来源最大值，0 为无额度</dd>
    </div>)}</dl></section>}
    <details><summary>技术详情</summary><dl>
      <div><dt>动作 / 结论 / 原因码</dt><dd>{result.action} / {result.decision} / {result.reason}</dd></div>
      <div><dt>来源提供 / 来源 ID</dt><dd>{String(result.permission_provided)} / {result.source_ids.join(", ") || "无"}</dd></div>
      <div><dt>场景 / 完整性 / 账号状态</dt><dd>{scenario.kind} / {String(scenario.complete)} / {scenario.account_status ?? "未指定用户"}</dd></div>
      <div><dt>版块策略修订 / 主题治理修订</dt><dd>{policyRevision ?? "未配置"} / {topicRevision ?? "未检查具体治理主题"}</dd></div>
    </dl><ul>{scenario.sources.map(source => <li key={source.id}>
      <strong>{source.display_name}</strong><p>{source.kind} / {source.key} / {source.id}</p>
      <p>权限键：{source.permission_keys.join(", ") || "无"}</p>
      <p>身份 / 权益快照版本：{source.membership_kind ?? "不适用"} / {source.type_version ?? "不适用"}</p>
      {source.role && <p>role {source.role.id} / revision {source.role.revision} / scope {source.role.scope} / scope_id {source.role.scope_id ?? "null"} / scope_mode {source.role.scope_mode} / scope_matches {String(source.role.scope_matches)} / target_scope_matches {String(source.role.target_scope_matches)} / assigned_by {source.role.assigned_by}</p>}
    </li>)}</ul><dl>{scenario.quotas.map(quota => <div key={quota.key}><dt>{quota.key}</dt><dd>limit {quota.limit} / used {quota.used ?? "null"} / source_ids {quota.source_ids.join(", ") || "无"}</dd></div>)}</dl></details>
  </div>
}
