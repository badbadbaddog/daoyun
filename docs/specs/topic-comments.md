# Spec: 主题详情与评论闭环

## Objective

为公开主题增加可导航的 Web 详情页、公开回复列表和登录用户回复能力。访客可以读取主题正文与
回复；已登录用户可以使用 Cookie 会话、会话绑定 CSRF 和幂等键发布纯文本回复。回复创建与
主题回复数、最后活跃时间更新必须处于同一 PostgreSQL 事务。

## Assumptions and Decisions

- 现有 `TopicDetail.content` 和 `topics.content` 保持兼容，不修改已发布 API 字段。
- 新增 `posts` 表统一承载主题首帖镜像与回复；迁移会为已有主题回填 `kind = 'topic'` 的首帖。
- 新增 `post_revisions` 表保存每个帖子的版本；本切片创建首版，编辑 API 留到后续增量。
- 回复在本切片保持平铺，不实现嵌套引用、点赞、附件、审核操作或实时推送。
- 回复按 `created_at ASC, id ASC` 排序，游标为上一页最后一条回复的 UUID。
- 主题、板块、主题作者、回复作者任一不可公开时，不泄露具体原因。
- Web 使用现有 Hash URL 和 React 状态，不新增路由或状态管理依赖。

## Public API Contract

所有响应继续使用 `data` / `meta` 或 `error` / `meta` envelope，JSON 字段使用 `snake_case`。

### `GET /api/v1/topics/{topic_id}/replies`

- 查询参数：`cursor` 可选 UUID；`limit` 为 1-50，默认 20。
- `200`: `PageResponse<TopicReply>`，回复按最早优先稳定排序。
- `400 request.path_invalid`: `topic_id` 不是 UUID。
- `404 topic.not_found`: 主题不存在或不可公开。
- `422 request.validation_failed`: 分页参数或游标无效、游标不属于当前主题。
- `503 system.database_unavailable`: 数据库暂时不可用。

### `POST /api/v1/topics/{topic_id}/replies`

请求 JSON：`content` 去除首尾空白后为 1-100,000 个 Unicode 字符，仅允许换行、回车和制表符
控制字符；请求体上限 128 KiB。请求必须携带有效会话 Cookie、CSRF Cookie 和相同的
`x-csrf-token`。可选 `Idempotency-Key` 使用与主题发布一致的 1-255 个可打印 ASCII 字符规则。

- `201`: 首次创建的 `ApiResponse<TopicReply>`。
- `200`: 相同请求的幂等重放。
- `401 auth.unauthenticated`: 缺少或失效会话。
- `403 auth.csrf_failed`: CSRF 校验失败。
- `404 topic.not_found`: 主题不存在或不可回复。
- `409 request.idempotency_conflict`: 同一键用于不同请求。
- `422 request.validation_failed`: JSON、正文、路径或幂等键无效。
- `503 system.database_unavailable`: 数据库或持久化读取失败。

`TopicReply` 字段：`id`、`topic_id`、公开 `author`、`content`、`created_at`、`updated_at`、
`revision_count`。不返回作者邮箱、内部状态、删除信息或修订正文历史。

## Data Model

- `posts`: `id`、`topic_id`、`author_id`、`kind`、`content`、`status`、`revision_count`、
  创建/更新时间和软删除时间；每个主题只有一个有效 `kind = 'topic'` 首帖。
- `post_revisions`: `id`、`post_id`、`editor_id`、`revision_number`、`content`、`created_at`；
  每个帖子和版本号唯一。
- 迁移为现有主题回填首帖与第一个版本；新主题发布事务同步创建首帖和首版。
- 回复创建事务写入回复、首版、递增 `topics.reply_count` 并更新 `last_activity_at`。
- 回复幂等记录使用 `POST /api/v1/topics/{topic_id}/replies` 端点作用域和请求 SHA-256 摘要。

## Tech Stack and Commands

- Rust 1.94.1、Axum 0.8.9、SQLx 0.9.0、PostgreSQL 16、Utoipa 5.5.0。
- React 19、TypeScript、Vite、Vitest、Testing Library。

```text
$env:DATABASE_URL = "postgresql://daoyun@127.0.0.1:55433/daoyun_dev"
cargo +1.94.1-x86_64-pc-windows-gnu test --workspace
cargo +1.94.1-x86_64-pc-windows-gnu fmt --all -- --check
cargo +1.94.1-x86_64-pc-windows-gnu clippy --workspace --all-targets -- -D warnings
pnpm test
pnpm typecheck
pnpm build
```

## Project Structure and Code Style

- `migrations/`: `posts`、`post_revisions`、索引、回填和反向迁移。
- `crates/api-contract/src/topic.rs`: 回复请求与公开 DTO。
- `crates/infrastructure/src/topics.rs`: 参数化回复读取、游标校验和事务写入。
- `apps/api/src/topics.rs`: HTTP 边界、鉴权、映射、OpenAPI 和错误隔离。
- `src/api/topics.ts`: 详情、回复读取和回复发布的运行时校验客户端。
- `src/components/TopicDetailView.tsx`: 主题详情、回复状态和发布表单。

```rust
let result = database
    .create_published_reply(input, idempotency)
    .await?;
Ok((StatusCode::CREATED, Json(ApiResponse::new(reply, request_id))))
```

SQL 只使用静态语句和绑定参数；公共 DTO 与持久化记录分离；数据库错误只写入带
`request_id` 的服务端日志。

## Testing Strategy

- 契约：DTO 序列化、请求反序列化、错误码和 OpenAPI schema。
- PostgreSQL：迁移回填、公开可见性、稳定分页、错配游标、事务计数、幂等并发和回滚。
- HTTP：路径/字段/体积边界、认证、CSRF、404 隔离、错误 envelope 和请求 ID。
- 前端：运行时响应校验、详情加载/失败/重试/空状态、回复发布和幂等重试。
- 浏览器：Hash 导航、刷新详情、登录回复、回复数同步、返回首页、控制台和响应式布局。

## Boundaries

- Always: 参数化 SQL、公开可见性、稳定游标、统一 envelope、OpenAPI、会话/CSRF、幂等和测试。
- Ask first: 删除现有 `topics.content`、改为嵌套评论、开放编辑或审核 API、引入路由依赖。
- Never: 返回私有作者字段、拼接用户输入、区分不存在与隐藏资源、用前端模拟回复。

## Success Criteria

- 现有主题在迁移后具有首帖和首版，新主题发布同步创建两者。
- 公开回复列表稳定分页且只返回公开主题和启用作者的有效回复。
- 回复发布原子写入帖子与版本并准确更新主题计数和最后活跃时间。
- 幂等重放不重复回复或计数，不同正文复用同一键返回 `409`。
- Web 可从 Feed 打开可刷新详情、加载真实回复、发布回复并返回首页。
- 全量 Rust/前端测试、格式、Clippy、类型检查、构建和真实浏览器验收通过。
