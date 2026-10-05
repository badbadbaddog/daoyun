import type { AuthorizationRoleScope } from "../../api/admin"

export interface AuthorizationRoleTemplate {
  key: string
  name: string
  scope: AuthorizationRoleScope
  description: string
  permissionKeys: readonly string[]
}

export const authorizationRoleTemplates: readonly AuthorizationRoleTemplate[] = [
  { key: "board_moderator", name: "版主", scope: "board", description: "维护任命版块的内容、排序与用户限制；不授予其他版块和站点管理。", permissionKeys: ["moderation.topic", "moderation.topic.pin", "moderation.topic.feature", "moderation.topic.lock", "moderation.topic.move", "moderation.user.restrict_in_scope"] },
  { key: "board_reviewer", name: "版块内容审核员", scope: "board", description: "处理任命范围的内容；不授予站点配置、人员授权或积分管理。", permissionKeys: ["moderation.topic"] },
  { key: "report_reviewer", name: "举报处理员", scope: "instance", description: "读取与处理站点举报；隐藏内容或限制用户仍需对应的独立能力。", permissionKeys: ["governance.reports.read", "governance.reports.resolve"] },
  { key: "operations_observer", name: "只读运维", scope: "instance", description: "查看运维与审计；不授予配置和业务写入。", permissionKeys: ["operations.read", "audit.read"] },
]

export function isHighRiskAuthorizationPermission(key: string) {
  return key.endsWith(".write") || /^plugins\.(install|lifecycle|invoke)$/.test(key)
    || /^(moderation\.|admin\.users\.moderate$|governance\.(reports|alerts)\.resolve$)/.test(key)
    || /\.(grant|grants\.write)$/.test(key)
}
