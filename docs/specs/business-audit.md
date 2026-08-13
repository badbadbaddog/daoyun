# 全域业务操作审计规格

## 目标

在现有认证安全审计和管理审计之上，为普通用户触发的持久化业务写操作补充结构化审计，使具备 `audit.read` capability 的运营人员能够从既有管理审计接口追踪“谁在何时改变了哪个资源”，同时不复制业务正文、个人资料或凭据材料。

## 技术栈与结构

- Rust 1.94.1、SQLx、PostgreSQL 16。
- 继续使用 `admin_audit_log` 作为受 `audit.read` 保护的统一运营审计日志；表名作为既有持久化实现保留，不代表只允许管理员成为 actor。
- 业务状态变更与审计插入必须使用同一个 SQLx transaction。
- 审计查询继续由 `GET /api/v1/admin/audit` 提供，不新增公开用户可读端点。

## 事件目录

### 内容域

| 事件 | 资源类型 | 摘要白名单 |
| --- | --- | --- |
| `topic.create` | `topic` | `board_id` |
| `topic.update` | `topic` | `revision` |
| `topic.delete` | `topic` | 空对象 |
| `reply.create` | `reply` | `topic_id` |
| `reply.update` | `reply` | `topic_id`、`revision` |
| `reply.delete` | `reply` | `topic_id` |

主题审核已有 `topic_moderation_actions` 专用不可变记录；治理、授权、会员、运维、插件和认证高风险事件继续使用各自已完成的事务审计路径。

### 后续域

- 用户资料：`user.profile.update`，资源类型为 `user`，摘要只包含 `revision`。
- 用户关系：`user.follow`、`user.unfollow`、`user.block`、`user.unblock`，资源类型为 `user`，资源 ID 为目标用户，摘要为空对象。
- 内容关系：`topic.bookmark`、`topic.unbookmark` 使用 `topic` 资源；`post.like`、`post.unlike` 使用 `post` 资源且摘要只包含 `topic_id`。只记录实际边变化。
- 私信：`conversation.create`、`message.send`、`conversation.read`、`conversation.archive`；消息事件摘要只允许 `conversation_id`，已读事件只允许 `message_id`。摘要不得包含消息正文或参与者用户名，幂等发送与不前进的已读游标不重复记录。
- 通知：`notification.read` 使用单条 notification 资源；`notification.read_all` 不指定资源 ID，摘要只包含实际变更的 `count`。重复已读不产生审计。
- 附件：`attachment.create` 使用 attachment 资源，摘要只允许 `topic_id` 和服务端校验后的 `mime_type`；不得包含文件名、对象键、哈希、大小或媒体内容。审计失败必须同时回滚数据库并删除已经写入的原对象和缩略图。
- 举报创建：`report.create` 使用 `content_report` 资源，摘要只允许 `target_type` 与 `target_id`；幂等重放不重复记录，不保存举报原因或详情。

## 行为与边界

- 只记录成功且实际改变持久状态的操作。
- 相同幂等键的成功重放返回原资源，不新增第二条审计。
- 业务写入失败或审计插入失败时整个事务回滚，不产生孤立业务状态或孤立审计。
- `actor_id` 由已认证会话对应的服务端用户 ID 提供；客户端不能指定审计 actor、action 或摘要。
- action、resource type 和摘要键使用服务端固定常量，不拼接用户输入。
- 审计摘要不得包含标题、正文、回复、标签名、资料字段、消息、举报理由、文件名、对象键、邮箱、IP、User-Agent、Cookie、session ID、CSRF、密码、Passkey、MFA secret 或上游 token。
- 资源 UUID、关联资源 UUID、修订号和服务端规范化枚举可以进入摘要。

## 测试策略

- PostgreSQL 集成测试验证每个成功内容写操作恰好产生一条对应事件。
- 使用敏感哨兵文本执行写操作，并验证审计 action、resource type、resource ID 和 JSON 摘要均不包含哨兵文本。
- 幂等主题/回复创建重放后验证审计计数仍为一。
- 既有事务失败测试继续证明业务状态回滚；审计插入位于 commit 之前，随同一事务回滚。

## 命令

```text
cargo +1.94.1-x86_64-pc-windows-gnu test -p infrastructure --test topics -- --test-threads=1
cargo +1.94.1-x86_64-pc-windows-gnu fmt --all -- --check
cargo +1.94.1-x86_64-pc-windows-gnu clippy --workspace --all-targets -j 1 -- -D warnings
cargo +1.94.1-x86_64-pc-windows-gnu test --workspace -j 1 -- --test-threads=1
```

## 当前切片成功条件

- 主题和回复的创建、编辑、删除均在原业务事务内写入固定事件。
- 幂等重放不重复审计。
- 审计摘要只包含本规格白名单字段。
- 内容域定向 PostgreSQL 测试、Rustfmt、Clippy 和 workspace 测试通过。
