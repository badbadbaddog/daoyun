# Spec: 回复编辑、修订历史与删除

## Objective

为普通用户补齐自己已发布回复的编辑、乐观并发冲突、修订历史读取和软删除闭环。
回复内容继续使用纯文本模型；任何写操作都必须通过 Cookie 会话和会话绑定 CSRF。
删除必须在同一事务中修正主题公开回复数与最后活跃时间，且不能泄露不可见回复或其他
作者回复的存在状态。

## Assumptions

- 本切片只处理普通作者对自己回复的操作；管理员审核、强制删除和操作审计属于后续审核切片。
- 主题删除、附件和回复恢复不在本切片内。
- 现有 `posts.deleted_at`、`posts.revision_count` 和 `post_revisions` 已满足数据模型要求，
  不新增迁移。
- 用户要求继续完成状态文档中的剩余工作，视为按当前优先级继续该已确定切片；若边界变化，
  先更新本规格再修改实现。

## API Contract

### 编辑回复

`PATCH /api/v1/topics/{topic_id}/replies/{reply_id}`

```json
{
  "base_revision": 1,
  "content": "更新后的回复"
}
```

- 成功返回 `200 ApiResponse<TopicReply>`。
- `base_revision` 必须等于当前 `posts.revision_count`；陈旧版本返回
  `409 reply.revision_conflict` 且不写入任何数据。
- 内容为去除首尾空白后的 1-100,000 个 Unicode 字符，只允许换行、回车和制表符控制字符。
- 成功编辑更新当前内容、修订计数和 `updated_at`，并追加不可覆盖的 `post_revisions`；
  编辑不提升主题活跃时间。

### 回复修订历史

`GET /api/v1/topics/{topic_id}/replies/{reply_id}/revisions`

- 成功返回 `200 ApiResponse<Vec<ReplyRevision>>`，按版本号正序稳定排列。
- `ReplyRevision` 只包含修订 ID、回复 ID、版本号、编辑者公开身份、纯文本正文和创建时间。
- 仅当前回复作者可读。

### 删除回复

`DELETE /api/v1/topics/{topic_id}/replies/{reply_id}`

- 成功返回 `200 ApiResponse<bool>`，其中 `data` 为 `true`。
- 软删除设置 `posts.deleted_at` 和 `updated_at`，保留当前内容与全部修订记录。
- 同一事务串行锁定主题和回复，随后按当前公开可见回复重算 `topics.reply_count`。
- `topics.last_activity_at` 重算为最新公开回复的 `created_at`；没有公开回复时回退到
  `topics.published_at`。删除不会让活跃时间早于发布时间。
- 重复删除、其他作者、错配主题、隐藏回复、不可见主题和不存在资源统一返回
  `404 reply.not_found`。

## Error And Security Boundaries

- 无有效会话返回 `401 auth.unauthenticated`；缺失或错误 CSRF 返回 `403 auth.csrf_failed`。
- 非作者和不可见资源统一返回 `404 reply.not_found`，不使用可区分存在状态的 `403`。
- 路径 UUID 无效返回 `400 request.path_invalid`；请求体或字段无效返回
  `422 request.validation_failed`；数据库错误返回通用 `503 system.database_unavailable`。
- 所有 SQL 使用参数绑定；日志只记录 `request_id` 和内部错误，不记录回复正文、会话或 CSRF。
- React 以文本节点渲染正文和修订内容，不引入 HTML 解析或执行。

## Commands

```text
Rust tests: cargo +1.94.1-x86_64-pc-windows-gnu test --workspace
Rust format: cargo +1.94.1-x86_64-pc-windows-gnu fmt --all -- --check
Rust lint: cargo +1.94.1-x86_64-pc-windows-gnu clippy --workspace --all-targets -- -D warnings
Web tests: pnpm test
Type check: pnpm typecheck
Production build: pnpm build
Dependency audit: pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org
Web dev: pnpm dev
API dev: cargo +1.94.1-x86_64-pc-windows-gnu run -p daoyun-api
```

## Project Structure And Style

- 公共请求、响应 DTO 与错误码：`crates/api-contract/src/`。
- SQLx 事务与持久化记录：`crates/infrastructure/src/topics.rs`，数据库集成测试位于同 crate 的
  `tests/topics.rs`。
- Axum 路由、校验、错误映射和 OpenAPI：`apps/api/src/topics.rs`，HTTP 测试位于
  `apps/api/tests/topics.rs`。
- TypeScript 客户端和运行时校验：`src/api/topics.ts` 及其相邻测试。
- React 交互：`src/components/TopicDetailView.tsx` 及其相邻测试；颜色和响应式样式只使用
  `src/styles.css` 中的语义令牌。
- Rust 使用 `cargo fmt` 格式，React 使用命名导出和 Lucide 图标；正文不渲染 HTML。

## Testing Strategy

- 先为公共 DTO、持久化权限/事务、HTTP 契约、客户端运行时校验和组件交互分别增加失败测试。
- 数据库测试覆盖成功编辑、陈旧版本、非作者、错配主题、重复删除、版本保留、计数与活跃时间回退。
- HTTP 测试覆盖认证、CSRF、路径、正文校验、错误码、响应 envelope 和 OpenAPI 路径。
- 前端测试覆盖作者操作可见性、非作者隐藏、编辑冲突刷新、历史加载、删除确认和失败恢复。
- 浏览器在 1440px 与 390px 验证真实编辑、刷新持久化、历史、删除、计数同步、无溢出和零控制台错误。

## Implementation Tasks

### Task 1: 公共契约

- [x] 新增 `UpdateReplyRequest`、`ReplyRevision` 和回复错误码并导出。
- [x] 契约序列化测试覆盖字段名称和统一 envelope。
- [x] Verify: `cargo +1.94.1-x86_64-pc-windows-gnu test -p api-contract`。

### Task 2: 持久化事务

- [x] 新增回复编辑、作者修订历史和软删除数据库方法。
- [x] 所有失败路径不产生部分写入，删除后计数和活跃时间准确。
- [x] Verify: `cargo +1.94.1-x86_64-pc-windows-gnu test -p infrastructure --test topics`。

### Task 3: HTTP 与 OpenAPI

- [x] 注册 PATCH、GET revisions 和 DELETE 路由，复用现有认证与 CSRF 边界。
- [x] 覆盖校验、权限、冲突、错误隔离、响应头和 OpenAPI。
- [x] Verify: `cargo +1.94.1-x86_64-pc-windows-gnu test -p daoyun-api --test topics`。

### Task 4: TypeScript 客户端

- [x] 新增编辑、历史和删除请求，以及对应响应的运行时结构校验。
- [x] Verify: `pnpm test -- src/api/topics.test.ts`。

### Task 5: 回复行交互

- [x] 作者可编辑、查看历史和二次确认删除；非作者不显示操作。
- [x] 冲突提供刷新入口，删除成功同步本地回复列表和主题计数。
- [x] Verify: `pnpm test -- src/components/TopicDetailView.test.tsx`。

### Checkpoint: 完整门禁与浏览器验收

- [x] Rust 测试、格式与 Clippy 全部通过。
- [x] Web 测试、类型检查、构建与生产依赖审计全部通过。
- [x] 1440px 与 390px 真实浏览器流程通过，控制台无错误或警告。
- [x] `docs/project-status.md` 更新完成并指向下一项 P1 切片。

## Boundaries

- Always: 参数化 SQL、统一 envelope、`request_id` 响应头、会话绑定 CSRF、先测试后实现。
- Ask first: 新增依赖、改变管理员权限边界、改变软删除为物理删除、引入新的数据表。
- Never: 泄露不可见资源状态、覆盖旧修订、渲染用户 HTML、记录正文或认证秘密。

## Success Criteria

- 回复作者可以编辑、查看版本和删除自己的回复，刷新后结果保持一致。
- 并发编辑只有匹配当前版本的请求成功；冲突不会丢失内容或新增修订。
- 删除后公开列表、`reply_count` 和 `last_activity_at` 一致，重复删除不重复修改计数。
- 契约、数据库、HTTP、客户端、组件、OpenAPI、全仓门禁和真实浏览器验收全部通过。

## Open Questions

- 无。本切片未决的管理员、审核、恢复和附件语义明确留到对应 P1 任务。
