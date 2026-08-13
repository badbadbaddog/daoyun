# Spec: 用户资料、关系互动与私信

## Objective

为刀云普通用户提供真实的公开个人资料、头像、关注、主题收藏、帖子点赞和一对一私信能力，
替换首页和侧栏中的关系占位数据。访客可以读取启用用户的公开资料；已登录用户可以维护自己
的资料、关注其他用户、收藏主题、点赞公开帖子并与未屏蔽自己的启用用户私信。

该能力按三个可独立交付的垂直切片实现：公开资料与关注、收藏与点赞、一对一私信。每个切片
必须保持现有公开主题、认证、统一 envelope、OpenAPI 和响应式 Web 行为可用。

## Assumptions And Decisions

- 活跃用户的资料默认公开；邮箱、角色、会话、登录时间和内部状态永不进入公开资料 DTO。
- 用户名是稳定 URL 标识，注册后不可修改；显示名称、简介、所在地、个人网站和头像可以由本人修改。
- 头像在对象存储切片完成前只接受 `https://` URL 或 `null`，最长 2,048 个字符；服务端不抓取远程
  资源，Web 加载失败时显示用户名首字母回退。头像上传、裁剪和内容检测留给对象存储切片。
- 简介为纯文本，最多 500 个 Unicode 字符；所在地最多 100 个字符；个人网站只允许 `http` 或
  `https` URL，最长 2,048 个字符。React 不解析简介或私信中的 HTML。
- 资料编辑使用 `base_revision` 乐观并发；用户名、邮箱、计数和账号状态不能通过资料 API 修改。
- 关注、收藏、点赞和屏蔽使用 `PUT` / `DELETE` 表达目标状态，重复请求幂等成功。关系边本身使用
  物理删除；它们没有需要恢复的独立内容，管理审计由后续审计切片记录。
- 关注自己、收藏不可见主题、点赞不可见帖子和与自己私信均被拒绝；不可见、停用、删除和被屏蔽
  资源统一隐藏，不通过错误码泄露存在状态。
- 收藏对象仅为主题；点赞对象为统一 `posts` 中的主题首帖或回复。`topics.like_count` 与
  `posts.like_count` 在同一事务中维护，公开计数不能为负。
- 屏蔽是私密的单向关系。新增屏蔽会在同一事务中移除双方关注关系；被屏蔽用户不能重新关注、
  创建会话或发送新消息，但双方仍可读取屏蔽前已有私信，避免历史记录突然丢失。
- 私信 MVP 仅支持两个参与者、纯文本和稳定游标分页；不支持群聊、附件、编辑、撤回、端到端加密、
  输入状态或实时推送。消息发送支持可选 `Idempotency-Key`，重放语义与主题、回复一致。
- 会话和消息不对普通用户做物理删除。用户可单独归档会话并随新消息自动恢复；管理员审核、内容
  删除和审计属于后续审核能力。
- 关系写入依赖会话绑定 CSRF、数据库唯一约束和短事务。私信发送增加进程内用户限流；分布式限流、
  Outbox、通知投递和 WebSocket 属于后续 P1/P2 切片。

## Public API Contract

所有成功响应使用 `data` / `meta` envelope，错误响应使用 `error` / `meta` envelope；
`meta.request_id` 与 `x-request-id` 响应头一致，JSON 字段使用 `snake_case`。

### 公开资料

`GET /api/v1/users/{username}`

- `200 ApiResponse<UserProfile>`：返回公开资料、公开计数和可选的当前查看者关系状态。
- 匿名访问时 `viewer` 为 `null`；有效会话访问时包含 `is_self`、`is_following`、
  `is_blocked_by_viewer` 和 `can_message`。
- 不存在、停用或删除用户统一返回 `404 user.not_found`。

`PATCH /api/v1/users/me`

```json
{
  "base_revision": 1,
  "display_name": "林屿",
  "bio": "保持好奇。",
  "location": "杭州",
  "website_url": "https://example.com",
  "avatar_url": "https://example.com/avatar.png"
}
```

- `200 ApiResponse<UserProfile>`；成功后 `profile_revision` 增加 1。
- 陈旧版本返回 `409 profile.revision_conflict`，且不产生部分更新。
- 无有效会话返回 `401`，CSRF 错误返回 `403`，字段错误返回 `422`。

`GET /api/v1/topics?author={username}` 复用现有公开主题分页与排序，只返回该启用用户的公开主题。

### 关注与屏蔽

`PUT /api/v1/users/{user_id}/follow`

`DELETE /api/v1/users/{user_id}/follow`

- `200 ApiResponse<FollowState>`，包含 `following`、目标用户 `follower_count` 和当前用户
  `following_count`。
- 创建或删除关系、双方缓存计数处于同一事务；重复 PUT/DELETE 返回当前目标状态且不重复计数。
- 自关注返回 `422 relationship.self_follow_not_allowed`；目标不可用或屏蔽关系存在时返回
  `404 user.not_found`。

`GET /api/v1/users/{username}/followers`

`GET /api/v1/users/{username}/following`

- 返回 `PageResponse<UserSummary>`，按关系创建时间和用户 UUID 稳定倒序分页，默认 20、最大 50。
- 只返回启用用户，不返回屏蔽状态或私密字段。

`PUT /api/v1/users/{user_id}/block`

`DELETE /api/v1/users/{user_id}/block`

- `200 ApiResponse<BlockState>`；自屏蔽返回 `422 relationship.self_block_not_allowed`。
- 屏蔽创建和双方关注关系清理处于同一事务；屏蔽列表只向当前用户开放。

`GET /api/v1/topics?scope=following` 返回当前用户所关注作者的公开主题；未登录返回
`401 auth.unauthenticated`。其他筛选、排序、游标和可见性规则与现有主题列表一致。

### 主题收藏

`PUT /api/v1/topics/{topic_id}/bookmark`

`DELETE /api/v1/topics/{topic_id}/bookmark`

- `200 ApiResponse<BookmarkState>`，其中 `bookmarked` 表示目标状态。
- 不可见主题统一返回 `404 topic.not_found`；重复请求不创建重复关系。

`GET /api/v1/users/me/bookmarks`

- 返回 `PageResponse<TopicSummary>`，按收藏时间和主题 UUID 稳定倒序分页。
- 已隐藏或删除的主题不会返回，但关系记录保留，便于内容恢复后重新出现。

### 帖子点赞

`PUT /api/v1/posts/{post_id}/like`

`DELETE /api/v1/posts/{post_id}/like`

- `200 ApiResponse<PostLikeState>`，包含 `post_id`、`liked` 和最新 `like_count`。
- 主题首帖同步维护 `topics.like_count`；回复维护 `posts.like_count` 并进入 `TopicReply` DTO。
- 不可见帖子、主题、板块或作者统一返回 `404 post.not_found`；重复请求不重复计数。

### 一对一私信

`POST /api/v1/conversations`

```json
{ "recipient_id": "019fc800-0000-7000-8000-000000000002" }
```

- `200 ApiResponse<ConversationSummary>`：同一对用户已有会话时返回原会话，否则事务创建会话和
  两条成员状态。
- 对方不可用、与自己会话或任一方向存在屏蔽时统一返回 `404 conversation.not_found`。

`GET /api/v1/conversations`

- 返回当前用户未归档会话，按 `last_message_at DESC, id DESC` 稳定分页。
- 摘要包含对方公开身份、最后一条消息摘要、未读数和更新时间，不返回其他会话或成员数据。

`GET /api/v1/conversations/{conversation_id}/messages`

- 仅参与者可读；按 `created_at DESC, id DESC` 返回最近消息并使用 UUID 游标加载更早消息。
- 非参与者、不可见会话和无效成员状态统一返回 `404 conversation.not_found`。

`POST /api/v1/conversations/{conversation_id}/messages`

```json
{ "content": "你好，想继续聊聊这个主题。" }
```

- `201 ApiResponse<DirectMessage>`；正文去除首尾空白后为 1-10,000 个 Unicode 字符。
- 可选 `Idempotency-Key` 最长 128 个 ASCII 字符；相同用户、端点、键和正文返回原消息，
  不同正文复用返回 `409 request.idempotency_conflict`。
- 发送事务写入消息、更新会话活跃时间、恢复双方归档状态并更新接收方未读计数。
- 发送者每分钟最多 30 条；超限返回 `429 message.rate_limited` 和 `Retry-After`。

`PATCH /api/v1/conversations/{conversation_id}/read`

- 请求包含 `last_read_message_id`；只能推进到该会话中当前用户可见的消息，不能回退。
- 成功返回 `200 ApiResponse<ConversationReadState>` 并把未读数归零或更新为剩余数量。

`DELETE /api/v1/conversations/{conversation_id}`

- 仅将当前用户的成员状态标记为归档，返回 `200 ApiResponse<bool>`；不删除对方数据或历史消息。

## Public DTOs

- `UserSummary`：`id`、`username`、`display_name`、`avatar_url`。
- `UserProfile`：`UserSummary`、`bio`、`location`、`website_url`、`profile_revision`、
  `created_at`、`topic_count`、`follower_count`、`following_count`、可选 `viewer`。
- `FollowState`：`user_id`、`following`、`follower_count`、`following_count`。
- `BlockState`：`user_id`、`blocked`。
- `BookmarkState`：`topic_id`、`bookmarked`。
- `PostLikeState`：`post_id`、`liked`、`like_count`。
- `ConversationSummary`：`id`、`other_user`、`last_message`、`unread_count`、`updated_at`。
- `DirectMessage`：`id`、`conversation_id`、`sender`、`content`、`created_at`。

计数全部为非负整数，时间全部为 UTC RFC 3339 字符串。公开主题和回复中的作者摘要扩展
`avatar_url`，Web 对 `null` 或图片失败使用确定性回退，不再生成远程模拟头像。

## Data Model

### 资料与关系迁移

- `users` 新增 `avatar_url`、`bio`、`location`、`website_url`、`profile_revision`、
  `follower_count`、`following_count`；数据库约束负责长度、协议、非负计数和正版本号。
- `user_follows(follower_id, followed_id, created_at)`：复合主键、自关注检查、两个方向查询索引。
- `user_blocks(blocker_id, blocked_id, created_at)`：复合主键、自屏蔽检查、目标查询索引。

### 收藏与点赞迁移

- `topic_bookmarks(user_id, topic_id, created_at)`：复合主键和按用户收藏时间倒序索引。
- `post_likes(user_id, post_id, created_at)`：复合主键和按帖子、用户查询索引。
- `posts.like_count bigint NOT NULL DEFAULT 0`，带非负约束；现有主题首帖从
  `topics.like_count` 回填。

### 私信迁移

- `direct_conversations(id, user_low_id, user_high_id, last_message_at, created_at, updated_at)`：
  参与者 UUID 按字节序规范化，唯一约束保证同一对用户只有一个会话。
- `conversation_members(conversation_id, user_id, last_read_message_id, unread_count, archived_at,
  updated_at)`：复合主键，每个会话事务创建恰好两条成员记录。
- `direct_messages(id, conversation_id, sender_id, content, created_at, deleted_at)`：纯文本约束、
  会话时间倒序索引；普通用户不能设置 `deleted_at`。

所有迁移都有对应 down 文件。计数更新锁定顺序固定为用户或主题父记录，再锁定关系或帖子记录，
避免关注、点赞和删除操作之间形成相反锁序。

## Security And Privacy Boundaries

- 所有关系、资料编辑和私信写入必须通过 Cookie 会话及会话绑定 CSRF；只读公开资料允许匿名。
- 可选查看者状态只接受有效会话；无效 Cookie 按匿名处理并清理，不向公开响应暴露认证内部错误。
- 路径错误返回 `400 request.path_invalid`，字段错误返回 `422 request.validation_failed`，陈旧资料
  返回 `409 profile.revision_conflict`，数据库错误统一返回 `503 system.database_unavailable`。
- 不存在、停用、删除、非参与者和屏蔽导致的不可用资源使用统一 404；不能通过关注、私信或错误
  文案探测账号、会话、屏蔽方向或帖子内部状态。
- 所有 SQL 使用参数绑定；服务端日志只记录 `request_id`、资源 UUID 和内部错误，不记录简介、
  私信正文、邮箱、Cookie、CSRF 或幂等键原文。
- 外部头像和网站 URL 只做语法验证并作为字符串返回；服务端不发起请求，避免 SSRF。
- 私信不是端到端加密；部署管理员可以通过后续审核能力访问。UI 不使用“加密聊天”等误导性文案。

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

## Project Structure And Code Style

- 迁移：`migrations/202608030009_*` 起按资料关注、收藏点赞、私信三个切片递增。
- 公共 DTO、请求和错误码：`crates/api-contract/src/users.rs`、`relations.rs`、`messages.rs`。
- PostgreSQL 查询与事务：`crates/infrastructure/src/users.rs`、`relations.rs`、`messages.rs`。
- Axum 路由、验证、鉴权和 OpenAPI：`apps/api/src/users.rs`、`relations.rs`、`messages.rs`。
- TypeScript 运行时校验客户端：`src/api/users.ts`、`relations.ts`、`messages.ts`。
- React 视图：`UserProfileView`、`BookmarksView`、`MessagesView` 及相邻测试；共享头像组件负责
  图片失败回退，样式仅使用 `src/styles.css` 中的语义令牌。
- Rust 公共 DTO 不暴露数据库记录；SQL 使用绑定参数和固定排序；React 使用命名导出、Lucide 图标
  和语义化控件，不解析用户 HTML。

## Testing Strategy

- 先写失败测试，再实现每个行为；契约、迁移、基础设施、HTTP、TypeScript 客户端和组件均独立覆盖。
- PostgreSQL 测试覆盖唯一约束、自关系、并发幂等、计数回滚、屏蔽清理、可见性、稳定游标、消息未读
  和晚期失败回滚。
- HTTP 测试覆盖匿名/认证/CSRF、字段边界、404 隔离、冲突、限流、幂等、统一 envelope、请求 ID
  和 OpenAPI paths/schemas。
- 前端测试覆盖资料编辑冲突、头像失败回退、关注与 Feed、收藏与点赞即时计数、私信列表/发送/已读、
  加载/空/失败/重试状态和非参与者不展示操作。
- 真实浏览器分别在 1440px 与 390px 验证三个垂直切片，检查网络状态、刷新持久化、键盘焦点、
  水平溢出、文字裁切和控制台错误或警告。

## Implementation Tasks

### Phase 1: 公开资料与关注

- [x] Task 1: 新增资料字段、关注与屏蔽迁移及正反迁移测试。
- [x] Task 2: 新增用户资料、资料编辑、关注状态和列表的公共 DTO 与 PostgreSQL 方法。
- [x] Task 3: 实现资料、关注、屏蔽 HTTP 路由、校验、鉴权、错误隔离和 OpenAPI。
- [x] Task 4: Web 接入公开个人主页、本人编辑、头像回退和关注按钮。
- [x] Task 5: 主题列表支持作者筛选和已登录用户关注 Feed。

### Checkpoint: 资料与关注

- [x] Rust 与 Web 定向测试通过，公开资料不含邮箱，关注计数并发一致。
- [x] 浏览器验证访客资料、作者编辑、关注/取消关注和关注 Feed。

### Phase 2: 收藏与点赞

- [x] Task 6: 新增收藏、点赞与帖子点赞计数迁移、契约、事务和 HTTP 路由。
- [x] Task 7: Web 收藏按钮、收藏列表、主题与回复点赞按钮接入真实 API。
- [x] Task 8: 覆盖重复操作、不可见内容、计数回滚、刷新持久化和响应式浏览器验收。

### Phase 3: 一对一私信

- [x] Task 9: 新增会话、成员状态、消息迁移以及参与者可见性和未读事务。
- [x] Task 10: 实现会话列表、创建、消息分页、发送、已读、归档、限流和 OpenAPI。
- [x] Task 11: Web 私信列表与会话视图，覆盖发送、重试、已读、空状态和移动端导航。

### Checkpoint: 完整能力

- [x] 全仓 Rust 测试、格式、Clippy、Web 测试、类型检查、构建和生产依赖审计全部通过。
- [x] 三个真实浏览器流程通过，控制台无错误或警告。
- [x] `docs/project-status.md` 更新完成并指向通知中心切片。

## Boundaries

- Always: 参数化 SQL、统一 envelope、`request_id` 响应头、会话绑定 CSRF、稳定游标、事务计数、
  先测试后实现、纯文本渲染和 OpenAPI。
- Ask first: 改变用户名可变性、上传或代理头像、公开邮箱、群聊、端到端加密、消息物理删除、增加依赖。
- Never: 用错误区分屏蔽方向、把认证令牌放入 Web 存储、返回私信给非参与者、服务端抓取用户 URL、
  拼接用户输入到 SQL、模拟关系或统计数据。

## Success Criteria

- 访客可读取启用用户资料且永远看不到邮箱；本人可并发安全地更新允许字段并在刷新后保持。
- 关注、屏蔽、收藏和点赞重复操作幂等，数据库计数与公开列表一致，失败事务不留下部分关系。
- 关注 Feed、个人主题、收藏列表、主题/回复点赞全部来自真实 PostgreSQL 数据。
- 私信只向两个参与者开放，屏蔽阻止新互动，发送重放不重复，未读和归档状态按用户隔离。
- 三个切片的契约、迁移、数据库、HTTP、客户端、组件、OpenAPI、质量门禁和真实浏览器验收通过。

## Open Questions

- 无。头像上传、通知推送、消息审核/删除、群聊和实时通信均明确留到后续对应任务；若这些边界变化，
  必须先更新本规格再修改实现。
