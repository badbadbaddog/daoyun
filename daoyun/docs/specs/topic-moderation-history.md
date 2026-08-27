# Spec: Topic Moderation History

## Objective

在内容治理主题列表中提供“处理记录”入口，把主题审核动作与主题治理动作按时间倒序统一展示。记录包含操作、操作者、处理备注、处理时间和记录 ID，便于管理员追溯主题为何被隐藏、拒绝、置顶、加精、锁定或移动。

## API Contract

- `GET /api/v1/admin/moderation/topics/{topic_id}/history`
- 仅允许具备全局 `audit.read` 能力的已登录管理员读取；板块级 `moderation.topic` 不隐式授予内部备注读取权限。
- 查询参数沿用 `cursor` 和 `limit`，默认 20 条、最大 50 条。
- 响应沿用 `PageResponse` 与统一 `request_id` envelope。
- 每条记录包含 `id`、`source`、`action`、`actor`、`reason` 和 `created_at`。
- `source` 仅为 `moderation` 或 `governance`；`action` 仅为已支持的主题审核、置顶、加精、锁定和移动动作。
- 未找到主题返回 `404 topic.not_found`；无权限返回现有鉴权错误；非法游标返回现有分页错误。

## Data and Security

- 不新增迁移：审核记录读取 `topic_moderation_actions`，治理记录读取 `admin_audit_log` 中目标主题对应的 `topic.governance` 事件。
- 使用参数化 SQL 合并两类不可变记录，并按 `(created_at, id)` 稳定倒序分页。
- 只读取 `summary.reason`、动作、操作者和时间，不返回治理前后快照、用户内容或其他审计摘要字段。
- DTO 位于 `crates/api-contract`，不暴露持久化模型。

## UI Behavior

- 主题治理列表每行在用户具备 `audit.read` 时显示“处理记录”按钮。
- 点击后在当前主题行下展开记录列表；再次点击收起，同一时间只展开一个主题。
- 首次展开时按需加载，展示加载、空、失败和分页状态。
- 按钮使用原生 `button`，声明 `aria-expanded` 和 `aria-controls`；记录区使用可读的语义列表。
- 沿用现有紧凑内容治理样式和语义颜色 token，适配 320、768、1024、1440 像素宽度。

## Testing Strategy

- API 契约测试：响应字段、枚举和 OpenAPI 路径/schema。
- Infrastructure 测试：两类记录合并、排序、主题过滤和游标分页。
- API 集成测试：`audit.read` 授权、主题不存在、成功读取和非法游标。
- Frontend 测试：请求解析、权限可见性、展开/收起、加载、空、失败和下一页。
- 完成后运行 Rust workspace 测试、格式与 lint，以及前端测试、类型检查和生产构建；服务可用时在真实浏览器检查交互、网络、控制台和响应式布局。

## Boundaries

- Always: 服务端强制 `audit.read`；输出统一 envelope；只返回当前主题的允许字段；查询有最大页长。
- Never: 向普通用户或仅有板块治理权限的账号返回内部处理备注；在前端拼接或推断审计摘要；修改既有日志记录。

## Success Criteria

- [ ] 管理员可以从主题治理列表直接查看该主题的完整处理轨迹。
- [ ] 审核动作和治理动作按时间稳定倒序合并，备注、操作者、时间与记录 ID 正确。
- [ ] 无 `audit.read` 时前端不显示入口，直接调用接口也被服务端拒绝。
- [ ] 空、失败、加载和多页记录都有明确反馈，键盘和屏幕阅读器可理解展开状态。
- [ ] OpenAPI、自动化测试、类型检查和生产构建通过。
