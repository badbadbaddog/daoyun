# Spec: 楼层式回复与回复可见内容

## Objective

为主题讨论增加稳定的楼层语义、指定楼层回复、`@用户名` 高亮、引用摘要，以及服务端强制执行的“回复后可见”内容门控。

## Product Decisions

- 回复保持单层时间线，不生成无限嵌套树。
- 楼层号由服务端分配并永久稳定；删除楼层不会导致后续楼层重新编号。
- 用户可回复指定楼层；新回复保存目标回复 ID，列表返回目标楼层、作者、摘要和删除状态。
- 被引用回复删除后，引用仍显示“该楼层已删除”，不泄露已删除正文。
- 正文中的合法 `@username` 以高亮链接展示；用户名语法沿用现有账户规则，不增加自动通知或联想搜索。
- 富文本编辑器提供“回复可见”按钮，将所选内容标记为门控内容。
- 门控内容对主题作者、内容作者、实例级超级管理员，以及已经在该主题发布过有效回复的登录用户可见。
- 游客和尚未回复的普通登录用户只能收到脱敏后的占位节点与脱敏纯文本，接口不得返回隐藏原文。
- 作者自己的回复不会被计作解锁条件；被软删除的回复不计入解锁。

## API Contract

- `CreateReplyRequest` 新增可选 `reply_to_id: UUID`。
- `TopicReply` 新增 `floor_number: integer` 与可选 `reply_to`。
- `reply_to` 包含 `id`、`floor_number`、`author`、`excerpt`、`is_deleted`。
- `Topic` 与 `TopicReply` 新增 `has_locked_content: boolean`，用于无泄漏地展示门控提示。
- 跨主题、非回复、未发布或不存在的 `reply_to_id` 返回 `422`。
- 所有新增字段进入 OpenAPI，响应继续保持 `request_id` 信封和响应头一致。

## Persistence

- `posts.floor_number BIGINT NULL`，仅 reply 使用；同一主题的有效楼层号唯一。
- `posts.reply_to_id UUID NULL REFERENCES posts(id) ON DELETE SET NULL`。
- 迁移为已有回复按 `(created_at, id)` 回填稳定楼层号。
- 创建回复时锁定主题行，在事务内分配 `MAX(floor_number) + 1`，避免并发重复。
- 门控内容保存在现有 `rich_content` JSONB 中，使用 `replyGate` mark；不新增隐藏正文副本。

## Frontend UX

- 每条回复显示服务端楼层号和“回复”按钮。
- 点击“回复”后，编辑器上方显示目标楼层、作者和摘要；可取消，发布后自动清空。
- 回复正文上方展示紧凑引用行，不使用额外卡片。
- `@username` 使用语义化高亮链接，继续由 React 转义并限制用户名字符。
- 门控内容解锁后显示正文；锁定时显示“回复主题后可见”，登录用户可直接聚焦回复框，游客提示登录。
- 键盘、焦点、320/768/1024/1440 px 宽度均可用。

## Testing Strategy

- Rust API 集成测试：稳定楼层、指定楼层、跨主题注入、删除目标引用、门控可见性矩阵、OpenAPI。
- Rust 纯逻辑测试：`replyGate` 脱敏不泄露原文、嵌套节点和非法结构安全降级。
- Vitest：API 映射、回复目标交互、引用展示、`@` 安全高亮、门控锁定/解锁渲染。
- 完成后运行 `pnpm test`、`pnpm typecheck`、`pnpm build`、`cargo test --workspace`、`cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings`。

## Boundaries

- Always: 服务端校验引用归属；服务端脱敏门控内容；SQL 参数化；React 不使用 `dangerouslySetInnerHTML`。
- In scope: 主题和回复富文本中的回复可见区块。
- Out of scope: 树状评论、私信通知、`@` 联想搜索、付费可见、用户组可见、单独评论审核工作流。
- Never: 仅靠 CSS/前端状态隐藏原文；在引用中返回被删除正文；重新编号已有楼层。

## Success Criteria

- 分页、删除和刷新后楼层号不变。
- 指定楼层回复只能引用同主题有效回复。
- 引用目标删除后关系安全降级且不泄露正文。
- 未解锁用户通过任何主题/回复业务响应都拿不到门控原文。
- 已回复用户、作者和超级管理员能读取门控原文。
- 新交互和接口均有先失败后通过的行为测试。
