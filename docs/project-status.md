# 刀云项目完成度

更新时间：2026-08-12

当前分支：`codex/daoyun-home-foundation`

当前基线：`8ce3005 feat: add admin configuration client`（工作区包含本状态文档所列的后续未提交实现）

## 状态口径

- 已完成：代码、契约和对应测试已经落入仓库，当前验证通过。
- 部分完成：已有可运行界面或基础能力，但仍依赖模拟数据，或缺少完整写入、鉴权及端到端闭环。
- 未完成：完整设计方案中已经定义方向，但仓库尚未实现。
- 本项目是全新构造的产品，不包含旧论坛迁移、兼容层或历史数据导入。

## 本地 PostgreSQL 连接信息

以下凭据仅用于当前机器的本地开发环境，已于 2026-08-05 使用 PostgreSQL 16.12 的 `psql`、`pg_dump` 和 `pg_restore` 实际验证；生产、测试或共享环境不得复用这些明文凭据。Windows 客户端位于 `C:\Program Files\PostgreSQL\16\bin`。

| 用途 | 主机 | 端口 | 数据库 | 用户名 | 密码或认证方式 | 验证结果 |
| --- | --- | ---: | --- | --- | --- | --- |
| 本机系统 PostgreSQL 16 | `127.0.0.1` | `5432` | `postgres` | `postgres` | 密码 `postgres` | 登录成功，当前用户和数据库均为 `postgres` |
| DaoYun 隔离开发实例 PostgreSQL 16.12 | `127.0.0.1` | `55433` | `daoyun_dev` | `daoyun` | 本机 `trust`，无密码 | 登录成功，当前用户为 `daoyun` |

DaoYun 当前开发运行使用 `55433` 隔离实例，不使用 `5432` 的系统实例。对应连接串为：

```text
postgresql://daoyun@127.0.0.1:55433/daoyun_dev
```

## 前端主题参考与边界

### 参考来源

- 主要产品与前端参考：`C:\Users\111\Desktop\Rhex-main`。
- 参考 Rhex 的现代社区信息架构、紧凑内容密度、板块与 Feed 组织方式、PC 多列布局、移动端单列导航和高频社区交互。
- 参考 phpwind9 的传统论坛运营经验、板块层级和管理场景，不复制其 PHP 模板、静态资源或历史主题实现。

### 刀云自己的主题方向

- 使用刀云独立品牌、Logo、图标、中文文案、组件结构和视觉样式，不制作“Rust 版 Rhex”或“Rust 版 phpwind9”。
- 官方前端采用内容优先、低装饰、高信息密度的工作型界面。
- 当前视觉基线为中性表面、绿色品牌色，并用蓝色、琥珀色和玫红色表达内容语义。
- 面板圆角不超过 `8px`，避免页面区块全部卡片化，也不使用卡片嵌套卡片。
- PC Web、Mobile Web/PWA 和 Admin Web 共享 API、契约、权限逻辑与设计令牌，但不强制共享页面布局。

### 主题扩展边界

- 不支持上传或安装 Rhex、phpwind 或其他第三方前端主题。
- 不提供主题市场，不允许运行时加载任意同源 React ESM 覆盖官方页面。
- 官方主题能力由固定设计系统、CSS Variables、品牌配置和少量官方预设组成。
- 品牌配置计划支持站点名称、Logo、Favicon、主色、强调色、明暗模式、列表密度、首页模式、默认封面、导航和页脚。
- 官方预设计划包含默认、深色、紧凑和高对比度，并随刀云版本统一测试和发布。
- 需要彻底更换页面、路由或交互的部署方，应通过 Headless API 独立开发前端，而不是注入运行时代码修改刀云官方界面。

### 当前完成度

- 已完成：公开社区首页的独立视觉基线、浅色与深色模式、响应式布局和本地主题偏好保存。
- 已完成：`site_branding` 数据模型、公开品牌读取 API、管理配置表单、CSS Variables 映射、紧凑/深色/高对比度官方预设和公开页面运行时应用。
- 已完成：颜色、间距和响应式规则已抽成跨 Web、Mobile Web/PWA 和 Admin Web 共享的独立 `@daoyun/design-tokens` 工作区包。
- 已完成：Logo/Favicon 安全二进制上传与品牌字段扩展、默认封面、自定义导航和页脚已形成数据库、对象存储、API、Admin Web 与公开 Web/PWA 闭环。
- 未完成：独立原生移动端应用及其原生管理端主题；当前仓库未包含原生客户端工程，需单独立项后复用现有 API 契约与设计令牌。

## 已完成任务

### 1. 工程基础

- React 19、TypeScript、Vite 组成的公开 Web 应用基础。
- Rust 1.94.1 workspace，包含 Axum API、公共 API 契约和 PostgreSQL 基础设施 crate。
- PostgreSQL 16 开发环境接通，API 启动时执行嵌入式 SQLx 迁移。
- 浅色、深色主题和桌面、平板、手机响应式布局。
- Vitest、Cargo Test、Rustfmt、Clippy、TypeScript 类型检查和生产构建命令可用。

### 2. 公开社区首页

- 桌面三栏、平板双栏、手机单栏与底部导航。
- 顶部导航、搜索框、Feed 标签、板块侧栏、主题列表、右侧信息栏和发布主题弹窗。
- 最新、热门、精华和已登录用户关注 Feed 已连接服务端查询；关注入口与哈希路由保持同步。
- 主题关键字搜索已连接服务端字面量查询，不再依赖前端模拟数据。
- 主题弹窗的打开、关闭和基础键盘焦点行为。
- 主题切换结果写入浏览器本地存储。

### 3. API 基础契约

- 所有成功响应使用统一 `data` / `meta` envelope。
- 所有错误响应使用统一 `error` / `meta` envelope。
- 每次请求生成 UUIDv7 `request_id`，响应体与 `x-request-id` 响应头保持一致。
- 未匹配路由和不支持的 HTTP 方法返回结构化错误。
- OpenAPI 3.1 文档通过 `GET /api/v1/openapi.json` 暴露。

### 4. 健康检查

- `GET /api/v1/health/live`：进程存活检查。
- `GET /api/v1/health/ready`：数据库连接、迁移表、脏迁移和迁移版本一致性检查。
- 依赖未就绪时返回 `503 system.not_ready`，不向客户端泄露内部数据库错误。

### 5. PostgreSQL 数据基础

- `system_state` 单例表及初始化一致性约束。
- `boards` 表、板块可见性、排序、软删除和游标查询所需字段。
- 正向、反向迁移文件。
- 数据库连接池、启动迁移和就绪检查。

### 6. 公开板块读取闭环

- `GET /api/v1/boards` 公共板块列表接口。
- 仅返回公开且未删除的板块。
- 稳定排序和 UUID 游标分页。
- 查询参数校验、统一字段错误、数据库异常隔离和 OpenAPI 契约。
- Web 板块侧栏已改为从 API 加载，包含加载中、失败、重试和成功状态。
- Vite 开发代理已接通 `/api` 到本地 Rust API。

### 7. 安装状态读取

- `GET /api/v1/installation` 返回 `system_state.is_initialized`。
- 新数据库默认返回 `false`，已初始化数据库返回 `true`。
- 数据库异常返回 `503 system.database_unavailable`。
- 响应不暴露初始化时间、管理员信息、SQLx 错误或连接信息。
- API、公共 DTO、数据库查询和 OpenAPI 均有测试覆盖。

### 8. 一次性初始化与首个管理员

- `POST /api/v1/installation` 创建首个超级管理员并将实例标记为已初始化。
- 已新增 `users`、`password_credentials`、`roles` 和 `role_assignments` 最小身份数据模型及正反迁移。
- 用户名、邮箱、显示名称、密码和 4 KiB 请求体上限均在 API 边界校验，字段错误使用统一 envelope。
- 密码在 Tokio blocking pool 中使用唯一随机盐和 Argon2id v19 生成 PHC 哈希，明文由 `Zeroizing` 清理且不进入日志或响应。
- PostgreSQL 事务先锁定 `system_state`，再写入用户、凭据、`super_admin` 角色和授权关系，最后更新初始化状态。
- 同进程哈希受单并发限制；跨进程并发由数据库行锁保证只有一个请求返回 `201`，其余返回 `409 installation.already_initialized`。
- 任何事务晚期失败都会回滚身份记录和初始化状态；数据库及哈希内部错误不会暴露给客户端。
- 请求、成功响应、字段错误、冲突、数据库异常、OpenAPI、并发和回滚均有测试覆盖。

### 9. 安装向导与初始化分流

- Web 启动时先读取安装状态，包含检查中、失败重试、未初始化向导和已初始化社区首页四种互斥状态。
- 安装状态确认前不会挂载社区首页，也不会提前请求板块数据。
- 安装表单覆盖用户名、邮箱、显示名称和密码，客户端限制与服务端保持一致并按 Unicode 字符计数。
- TypeScript 客户端对 GET、POST、成功和错误 envelope 做运行时结构校验。
- `422` 字段错误映射到对应输入，`409` 并发冲突刷新状态，`503` 保留表单并允许安全重试。
- `201` 后必须再次读取安装状态，只有服务端确认 `true` 才进入社区首页。
- 已验证 320、768、1024、1440px 布局、键盘焦点顺序、控制台、真实初始化写入和刷新后分流。

### 10. 注册、登录、退出与服务端会话

- 注册、用户名/邮箱登录、当前会话读取和退出 API 已接入统一 envelope 与 OpenAPI。
- 密码使用 Argon2id v19；不存在用户执行哑校验，登录失败不区分不存在、密码错误和停用状态。
- 256 位随机会话和 CSRF 令牌只以 SHA-256 摘要持久化，会话具有 30 天绝对和 7 天空闲期限。
- 会话 Cookie 使用 HttpOnly、SameSite=Strict、Path=/；默认生产配置使用 Secure 与 `__Host-` 前缀，
  本地 HTTP 必须显式设置 `DAOYUN_COOKIE_SECURE=false`。
- Cookie 状态写入要求会话绑定的 CSRF Cookie 与 `x-csrf-token`，退出后服务端会话立即撤销。
- 注册用户、凭据和首个会话处于同一 SQLx 事务，用户名/邮箱冲突返回不指明字段的通用错误。
- 注册密码和初始化管理员密码均允许 6-128 个 Unicode 字符，前后端校验与 OpenAPI schema 保持一致。
- Web 已接入会话恢复、登录、注册、账户菜单和退出，不在 localStorage/sessionStorage 保存认证令牌。
- 真实 HTTP 已验证注册、恢复、错误 CSRF、退出、撤销和邮箱登录。
- 真实浏览器已验证注册、刷新后会话恢复、认证发布和退出，控制台无错误或警告。

### 11. 公开主题读取 API

- 新增 `topics` 表、字段约束、可见性索引以及最新、热门、活跃三种稳定排序索引。
- `GET /api/v1/topics` 支持板块、字面量关键字、精华筛选、三种排序和 UUID 游标分页。
- `GET /api/v1/topics/{topic_id}` 返回公开详情；不存在、隐藏、删除、停用作者和隐藏板块统一为
  `404 topic.not_found`。
- 主题 DTO 只返回公开作者、板块、时间、计数和展示状态，不返回邮箱、内部状态或删除信息。
- 查询参数、路径、错配游标、数据库故障、时间映射、OpenAPI 和真实运行请求均有测试或验证覆盖。

### 12. 主题发布 API

- `POST /api/v1/topics` 使用 Cookie 会话和会话绑定 CSRF 鉴权，限制请求体为 256 KiB。
- 标题、正文、板块和可选 `Idempotency-Key` 在 API 边界校验并返回统一字段错误。
- 新实例初始化事务会创建 `general` / `社区广场` 默认公开板块。
- 主题、幂等记录和 `boards.topic_count` 在同一 SQLx 事务中写入，任何晚期失败全部回滚。
- 相同用户、接口、幂等键和请求返回原主题且不重复计数；不同请求复用同一键返回
  `409 request.idempotency_conflict`。
- 并发重放、隐藏板块、未认证、错误 CSRF、请求体上限、数据库异常、回滚和 OpenAPI 均有测试覆盖。

### 13. 真实首页主题闭环

- Web 主题列表、最新/热门/精华筛选、关键字搜索、右侧热帖和发布流程全部连接真实 API。
- 发布弹窗发送 Cookie、CSRF 和幂等键；未修改草稿的网络重试复用同一幂等键，编辑后才轮换。
- 发布成功立即加入 Feed，并重新读取板块列表同步服务端主题计数。
- 已删除 `src/data/community.ts`，首页不再依赖主题模拟数据。
- 真实浏览器已验证注册、发布、刷新恢复、搜索、Feed 切换、板块计数同步和退出。

### 14. 主题详情、帖子版本与回复闭环

- 新增统一 `posts` 和 `post_revisions` 数据模型，现有主题首帖已回填为首个帖子及修订版本。
- 新主题发布事务同步写入首帖和首个修订版本；回复发布事务同步写入回复、首个修订版本，并更新主题回复数与最后活跃时间。
- `GET /api/v1/topics/{topic_id}/replies` 仅返回公开可见回复，按创建时间与 UUID 稳定正序分页。
- `POST /api/v1/topics/{topic_id}/replies` 复用 Cookie 会话、会话绑定 CSRF、幂等键和 128 KiB 请求体限制。
- 相同回复请求的幂等重放不会重复创建帖子、修订版本或增加回复计数；不同内容复用幂等键返回冲突。
- Web 已接入主题详情哈希导航、主题正文、回复列表、加载/失败/空状态、未登录提示、回复表单和加载更多。
- 回复表单对未修改内容的失败重试复用同一幂等键，编辑后轮换；发布成功即时更新详情和首页主题回复数。
- API 契约、OpenAPI、迁移、可见性、游标、事务回滚、并发幂等、HTTP 校验和前端运行时 DTO 均有测试覆盖。
- 真实浏览器已验证未登录详情、注册后回复、刷新持久化、桌面与 390px 移动布局；控制台无错误或警告。

### 15. 主题标签、作者编辑与修订历史

- 新增 `tags`、`topic_tags` 数据模型、唯一性约束、查询索引和正反迁移；新主题事务同步写入标签关系。
- `GET /api/v1/tags` 返回公开标签，`GET /api/v1/topics?tag=...` 支持按标签筛选并保持稳定分页。
- `PATCH /api/v1/topics/{topic_id}` 仅允许作者编辑标题、正文和标签，并使用 `base_revision` 做乐观并发控制。
- 编辑事务同步更新主题、首帖、摘要和标签关系，并追加不可覆盖的 `post_revisions`；陈旧版本返回
  `409 topic.revision_conflict`。
- `GET /api/v1/topics/{topic_id}/revisions` 仅向主题作者返回修订历史，其他用户不能读取。
- Web 发布主题支持中英文标签，列表与详情展示标签，首页支持服务端标签筛选并即时同步新标签。
- Web 主题详情向作者提供编辑表单、冲突刷新、修订历史和移动端安全操作区；非作者不显示编辑入口。
- API 契约、OpenAPI、迁移、权限、事务回滚、并发冲突、运行时 DTO 与前端交互均有测试覆盖。
- 真实浏览器已验证中文标签发布、标签筛选、作者编辑、刷新持久化、两版修订历史、桌面与 390px
  移动布局；控制台无错误或警告。

### 16. 回复编辑、修订历史与软删除

- `PATCH /api/v1/topics/{topic_id}/replies/{reply_id}` 仅允许作者编辑公开回复，并使用
  `base_revision` 做乐观并发控制；陈旧版本返回 `409 reply.revision_conflict`。
- 回复编辑事务锁定主题和回复、更新当前正文并追加不可覆盖的 `post_revisions`，不会提升主题活跃时间。
- `GET /api/v1/topics/{topic_id}/replies/{reply_id}/revisions` 仅向回复作者返回完整修订历史。
- `DELETE /api/v1/topics/{topic_id}/replies/{reply_id}` 使用软删除保留正文与修订版本，并在同一事务中
  重算主题回复数和最后活跃时间；没有公开回复时回退到主题发布时间。
- 非作者、错配主题、隐藏、已删除和不存在回复统一返回 `404 reply.not_found`，不泄露内部可见性状态。
- Web 回复项向作者提供编辑、冲突刷新、修订历史和二次删除确认；非作者不显示操作入口。
- 删除成功后详情与首页主题回复数同步更新，确认区域使用 `alertdialog` 并自动聚焦确认按钮。
- API 契约、OpenAPI、权限、并发冲突、事务回滚、软删除统计、运行时 DTO 与前端交互均有测试覆盖。
- 真实浏览器已验证作者编辑、刷新持久化、两版修订历史、删除及计数同步；1440px 与 390px
  均无水平溢出或文字裁切，控制台无错误或警告。

### 17. 用户公开资料、头像与关注关系

- 新增用户头像、简介、所在地、个人网站、资料修订版本和关注计数字段，以及关注、屏蔽关系表和正反迁移。
- `GET /api/v1/users/{username}` 返回不含邮箱、角色、会话和内部状态的公开资料；有效会话附带查看者关系状态，
  无效认证 Cookie 按匿名读取并下发清理 Cookie。
- `PATCH /api/v1/users/me` 只允许本人通过 Cookie 会话与会话绑定 CSRF 更新公开字段，并使用
  `base_revision` 乐观并发控制；头像仅接受 HTTPS 地址。
- 关注、取消关注、屏蔽和取消屏蔽使用幂等 `PUT` / `DELETE`，固定 UUID 锁序和单事务计数重算保证并发一致；
  屏蔽同时清理双方关注关系。
- 关注者与正在关注列表按关系时间和 UUID 稳定分页，只返回启用用户；用户、屏蔽和不可用状态使用统一错误隔离。
- `GET /api/v1/topics?author=...` 支持公开作者筛选，`scope=following` 只向已登录用户返回所关注作者的公开主题。
- Web 已接入作者个人主页、本人资料编辑、关注/取消关注、关系列表、作者链接和确定性四配色头像回退；
  顶部账户菜单与右侧栏使用真实会话身份，不再显示远程模拟头像或虚构用户统计。
- 真实浏览器已验证访客资料、本人资料保存与刷新、关注/取消关注、侧栏关注路由和真实关注 Feed；
  1440px 与 390px 均无水平溢出或文字裁切，控制台无错误或警告。

### 18. 主题收藏与帖子点赞

- 新增 `topic_bookmarks`、`post_likes` 和帖子点赞计数数据模型、约束、索引及正反迁移；主题首帖点赞
  同步维护 `topics.like_count`。
- 收藏、取消收藏、点赞和取消点赞使用 Cookie 会话、会话绑定 CSRF 与幂等 `PUT` / `DELETE`；
  不可见主题或帖子统一返回资源不存在，不泄露内部状态。
- `GET /api/v1/users/me/bookmarks` 按收藏时间和主题 UUID 稳定倒序分页，隐藏或删除主题不会出现在列表中。
- 点赞事务使用固定父记录锁序并原子维护帖子与主题计数；重复操作、并发操作和晚期失败不会重复计数或留下部分状态。
- Web 已接入收藏列表、主题收藏按钮以及主题首帖和回复点赞按钮，操作后即时同步计数并在刷新后保持。
- 契约、迁移、数据库、HTTP、OpenAPI、TypeScript 运行时 DTO 和组件测试均已覆盖；真实浏览器已验证
  收藏、取消收藏、点赞、取消点赞、刷新持久化和 390px 响应式布局。

### 19. 一对一私信

- 新增 `direct_conversations`、`conversation_members` 和 `direct_messages` 数据模型、唯一约束、稳定分页索引
  及正反迁移；同一对用户只会创建一个会话。
- 会话创建、列表、消息分页、发送、已读和归档 API 已接入统一 envelope、Cookie 会话、会话绑定 CSRF、
  OpenAPI、Unicode 字符边界、幂等重放和每用户进程内限流。
- 参与者可见性、屏蔽隔离、固定用户锁序、未读计数、单用户归档和新消息自动恢复均在 PostgreSQL 事务中维护；
  非参与者与不可用资源统一返回 `404 conversation.not_found`。
- Web 已接入私信入口、会话列表、消息分页、发送重试、已读、归档、空状态和移动端会话导航；从用户资料页
  发起私信会恢复并复用原有归档会话。
- 前后端测试覆盖响应 ID 绑定、分页、竞态切换、幂等、并发屏蔽、已读、归档恢复和异常状态。
- 真实浏览器已验证双用户发送与回复、刷新持久化、未读清零、归档、新消息恢复和资料页会话复用；
  桌面端与 390x844 移动端均无水平溢出、文字裁切或控件重叠，控制台无错误或警告。

### 20. 通知中心及已读状态

- 新增 `notifications` 表、聚合键、已读时间、接收者游标索引和反向迁移。
- 关注、回复、点赞和私信事务在同一 PostgreSQL 事务中可靠写入通知，重复关系和幂等重放不会重复产生事件。
- `GET /api/v1/notifications`、`GET /api/v1/notifications/unread-count`、单条已读和全部已读 API 已接入统一 envelope、Cookie 会话、会话绑定 CSRF、游标分页、错误隔离和 OpenAPI。
- 通知 DTO 仅返回公开行为者、类型、目标资源、创建时间和已读时间；停用行为者不会泄露内部状态。
- 举报创建和处理在原有治理事务内写入 `report` 通知；实例级或板块作用域的审核者收到新举报，活跃举报人收到处理结果，
  重复举报不会重复发送通知。
- Web 已接入通知入口、未读徽标、通知列表、空/失败/加载状态、目标跳转、单条已读和全部已读。
- TypeScript 客户端具备运行时结构校验，契约、API 客户端和主题详情组件测试已覆盖；前端测试 25 个文件、156 项通过，类型检查和生产构建通过。

### 21. 主题删除、内容审核与附件基础模型

- 新增主题 `moderation_status`、审核操作记录和附件元数据表及正反迁移；附件暂存对象存储键、MIME、大小和 SHA-256，不处理二进制上传。
- 作者可通过 Cookie 会话和 CSRF 软删除自己的已发布主题，主题首帖与回复同步隐藏，板块主题计数在同一事务中递减。
- `PATCH /api/v1/topics/{topic_id}/moderation` 支持拥有 `moderation.topic` capability 的审核角色执行通过、隐藏和拒绝，记录审核原因与操作者；无权限统一返回权限错误。
- 删除和审核 API 已接入统一 envelope、OpenAPI、权限错误隔离、路径和请求体校验。
- Web 主题详情向作者提供删除入口、二次确认、自动聚焦和删除后返回 Feed；TypeScript 删除客户端具备运行时响应校验。
- API 客户端测试、Rust 编译、clippy、类型检查已覆盖当前实现；主题列表与迁移回滚集成测试已通过。

### 22. PostgreSQL Full Text Search 搜索 MVP

- 新增 topics.search_vector 生成列和公开主题部分 GIN 索引，覆盖标题、摘要和正文并按字段权重合并。
- 主题列表搜索改用 websearch_to_tsquery('simple', ...) ，保留公开状态、板块、作者、标签、关注 Feed、排序和 UUID 游标过滤。
- 搜索参数继续使用统一 envelope、查询校验和数据库错误隔离；游标有效性检查与结果查询使用同一全文谓词。
- Web 搜索保留加载、失败重试和空结果状态，并提供可访问的清空搜索操作。
- 新增迁移具备正向和反向脚本；主题、API 和数据库迁移回滚集成测试已通过。

### 24. 管理后台 Web 配置界面

- 管理员入口通过账户菜单与 `#admin` 哈希路由接入，管理 API 返回的权限状态映射为允许或未授权界面。
- 品牌配置表单支持站点名称、Logo/Favicon HTTPS 地址、主色、强调色、官方预设、列表密度和首页模式。
- 品牌配置提供颜色与站点名称安全预览，保存使用会话 CSRF，显示成功、字段错误、失败重试和加载状态。
- 板块管理支持活动板块列表、新增、编辑、软删除确认、可见性、色调和排序配置。
- 管理页面在桌面与 390px 移动视口保持无水平溢出；TypeScript 客户端和组件测试覆盖权限、映射、CSRF 与保存流程。

### 23. 管理配置 API 基础切片

- 新增单例 site_branding 配置、admin_audit_log 审计表及正反迁移，默认品牌配置可公开读取。
- 新增 super_admin 管理 API：品牌配置读取/更新，板块读取/创建/更新/软删除。
- 管理写入统一要求 Cookie 会话、匹配 CSRF 和 `admin.configuration.write` capability；非管理员统一返回 admin.forbidden。
- 品牌 URL、颜色、预设、列表密度、首页模式以及板块 slug/名称/图标/排序/可见性均有 API 与数据库双重校验。
- 有主题板块拒绝删除；成功品牌/板块写入在同一事务中记录操作者、动作、资源和结构化摘要。
- OpenAPI、统一 envelope、Rust/API 集成测试和迁移回滚测试已覆盖当前实现。

### 25. 内容举报与治理处理

- 新增 `content_reports` 表、唯一举报约束、状态/动作约束、稳定分页索引及正反迁移。
- 登录用户可举报公开主题或回复；同一用户对同一目标重复提交幂等返回，不可见、删除或停用作者目标统一返回
  `404 report.target_not_found`。
- `GET /api/v1/admin/reports` 支持 `governance.reports.read` 按状态和 UUID 游标分页读取；`PATCH /api/v1/admin/reports/{report_id}`
  在单事务内标记处理中、驳回、隐藏主题、隐藏回复或暂停作者并撤销其会话。
- 治理事务先锁定举报，再更新目标内容/作者，最后写入 `admin_audit_log`；失败时举报、内容状态、会话和审计记录全部回滚。
- Web 主题详情和回复项均提供举报表单；管理后台提供举报列表、处理动作、确认和错误状态。
- 公共 DTO、OpenAPI、数据库/API 集成测试、TypeScript 客户端和组件测试已加入；前端全量测试 25 个文件、156 项，
  类型检查、生产构建和 Rustfmt 通过。

### 26. RBAC/ABAC 能力校验、治理通知与审计查询

- 新增 `permissions`、`role_permissions` 和角色 `scope_id`，实例/站点角色提供全局能力，板块角色按板块 UUID 精确匹配；
  活跃用户状态是所有 capability 检查的前置条件，迁移可回滚并为既有 `super_admin` 补齐系统能力。
- 安装事务为首个管理员授予全部系统 capability；管理配置、举报读取/处理和主题审核已从角色名判断切换为服务端 capability 校验。
- 新增 `GET /api/v1/admin/audit`，支持操作者、动作、资源类型和 UUID 游标过滤分页，返回结构化摘要并要求 `audit.read`。
- 新增 `report` 通知类型和正反迁移；新举报按实例/板块能力通知审核者，处理完成通知活跃举报人，通知写入与治理状态同事务回滚。
- 增加授权作用域、管理审计分页、举报通知幂等和停用用户拒绝等 Rust/API/TypeScript 测试；前端全量测试 25 个文件、156 项，
  类型检查、生产构建和 Rustfmt 通过。

### 27. 会员、等级与勋章资源目录基础

- 将资源复制到 `public/assets/membership`，固定纳入 20 个等级 GIF 与 17 个勋章 GIF，不依赖外部桌面路径。
- 新增 `GET /api/v1/membership/catalog`，只返回 `member`、已开放的 `lv_1` 至 `lv_20`、`medal_01` 至 `medal_17` 稳定键、DaoYun 展示名称、资源 URL 与 SHA-256；首期仅开放 `lv_1` 至 `lv_6`。
- 新增资源清单与 `verify:membership` 校验脚本，校验版本、数量、连续键、重复/未知文件、GIF 文件名和 SHA-256；缺失或篡改资源会失败。
- GitHub Actions 前端质量门禁已执行 `pnpm verify:membership`，资源缺失或篡改会阻断构建交付。
- 新增 API 合同、OpenAPI schema、Rust 集成测试和资源清单单元测试；会员组/等级/勋章仍与权限和积分账本解耦。

### 28. 积分账户与追加式账本基础

- 新增 `membership_accounts` 与 `point_ledger_entries` 正反迁移；账户余额、累计获得积分、等级键和修订号具备数据库约束。
- 注册用户和首个管理员在原有身份事务内初始化 `lv_1`、零余额会员账户；迁移会为既有用户补齐账户，并将旧等级键一次性转换为 `lv_*`。
- 追加账本按用户行锁串行化，支持正负积分、余额非负约束、理由/幂等键校验和同请求重放；不同内容复用幂等键会返回冲突，任何失败回滚账户与流水。
- 新增 `GET /api/v1/users/me/membership`，仅通过服务端会话读取本人积分余额、累计积分、等级和修订号，不公开余额给访客。
- 基础设施、API 合同、OpenAPI 和集成测试已加入；等级授予规则、管理员积分授予、自动升级和管理审计见下一节。

### 29. 会员等级规则与管理员积分授予

- 新增 `membership_level_rules`，为 `lv_1` 至 `lv_20` 提供可配置的启用状态、序号、展示名称和累计积分阈值；首期开放 `lv_1` 至 `lv_6`，已开放等级不能关闭，后续只能按序追加。
- 新增 `GET/PATCH /api/v1/admin/membership/level-rules` 与 `POST /api/v1/admin/membership/points`；所有写入均要求管理员 capability、Cookie 会话和 CSRF。
- 管理员积分授予在同一事务内追加账本、更新账户、按累计积分自动升级并写入 `admin_audit_log`；相同幂等键不会重复记账。
- TypeScript 客户端、OpenAPI 声明和“会员经济”后台页已支持等级规则维护和按用户 UUID 授予积分。
- Rust/API 集成测试与前端客户端、组件测试已覆盖规则、能力/CSRF、幂等授予、`lv_2` 自动升级、展示名称和按序追加。

### 30. 勋章持有、发放与运营规则

- 新增 `membership_medal_rules` 和 `membership_medals` 数据模型，固定校验 `medal_01` 至 `medal_17`，持有记录按用户和勋章幂等。
- 新增管理员勋章规则读取/更新和手动发放 API；发放要求 capability、Cookie 会话、CSRF，重复发放不会重复持有，并写入管理审计。
- 积分账本事务会按启用的累计积分阈值自动授予勋章，自动授予同样写入审计；积分扣减不会撤销既有勋章。
- 新增公开用户勋章读取 API；用户资料展示勋章资源和 DaoYun 稳定名称，运行时不暴露外部来源路径或资源内旧称谓。
- 管理后台“会员经济”页支持 17 枚勋章规则配置和手动发放；API 契约、OpenAPI、迁移回滚、基础设施和前端回归已覆盖。

## 部分完成任务

### 1. 帖子内容模型

- 已完成主题首帖、公开回复、主题与回复的作者编辑、修订历史、标签、可见性过滤、回复软删除和发布事务。
- 主题删除和审核操作已完成最小闭环；附件元数据、二进制上传、本地对象存储和可配置 S3 兼容存储已接入。

## 剩余任务

P0 可用产品闭环、管理配置和 P1 用户资料、关系互动、私信、通知中心、RBAC/ABAC、内容治理、S3 对象存储及质量回归切片已完成，后续进入 P2 平台扩展。

### 当前执行计划：本地服务人工测试与问题修复（本轮已完成）

Docker Compose 部署演练当前延期，不作为本轮阻塞项。本地服务使用 Web `http://127.0.0.1:5173/` 和 API
`http://127.0.0.1:3000/`，按以下顺序人工验收：

1. 普通用户注册、登录、发主题、回复、收藏、点赞等互动。
2. 个人资料、私信、通知和安全设置。
3. 管理员品牌、板块、举报、权限和会员后台。
4. 运营监控与插件平台。
5. 桌面端与移动端布局。

本轮结果：

- [x] 使用隔离 PostgreSQL `127.0.0.1:55433` 启动 API，并确认 ready 健康检查通过；Vite Web 与 `/api` 代理正常。
- [x] 完成普通用户注册、登录、主题发布、回复、收藏、点赞和刷新持久化人工回归。
- [x] 完成资料编辑并恢复原值、私信发送、通知空态和设备会话、修改密码、登录方式、Passkey、MFA 面板加载回归。
- [x] 完成管理员品牌保存并恢复、临时板块创建并删除，以及举报、风控、会员、授权、运维和插件页面回归。
- [x] RBAC/ABAC、运维规则和真实 Rust Wasm 插件生命周期在桌面与移动项目中通过；1440px 与 390px 页面均无全局水平溢出。
- [x] 修复公开质量 E2E 的远程封面 mock 未拦截问题，避免离线环境访问 `cdn.example.com` 产生 DNS 控制台错误。

发现问题时统一记录：出现问题的页面、执行的操作、预期结果、实际结果或错误提示。

### P1：社区核心能力

- 已完成：举报高级策略、风险告警、批量处理、附件扫描与生命周期清理。
- 已完成：本地与标准 S3 API 对象存储 provider，生产配置通过环境变量注入。

### P2：平台扩展能力

- 已完成：OAuth/OIDC、Passkey、多因素认证和设备会话管理。
- 已完成：勋章持有、发放和运营规则（会员组、`lv_1`-`lv_20` 等级、积分账本、授予规则、API 和管理配置），见
  [会员组、等级与勋章资源规格](specs/membership-levels-medals.md)。
- 已完成：Redis 品牌缓存、Outbox 事件和 Worker 最小闭环。
- 已完成：Wasmtime 插件宿主、WIT Rust SDK、固定 guest 权限清单、四项管理 capability、资源配额、持久化生命周期和管理 API。
- 已完成：声明式插件 UI Schema 与空权限 `sandbox` iframe 扩展点；真实 SDK 组件已纳入桌面/移动浏览器回归。
- 已完成：当前运营监控闭环，包括低基数 Prometheus 指标、W3C 请求链路上下文、持久化告警规则/事件、后台评估 worker 和 capability 驱动的运维后台。
- 已完成：跨进程 OTLP/HTTP protobuf trace exporter；默认关闭，显式 endpoint 启用，继承 W3C 父上下文并在优雅关闭时 flush。
- 已完成：安全、管理及全域业务写操作的事务内结构化审计，覆盖主题/回复、资料、关系互动、私信、通知、附件上传和举报创建，并使用固定隐私摘要白名单。
- 待完成：Docker Compose 实际镜像构建、容器启动和发布回滚演练；配置、备份恢复和 GitHub Actions CI 质量门禁已建立。
- 已完成：当前真实业务 Playwright 回归覆盖登录、主题、回复、用户资料、私信、板块作用域授权、撤销授权、运维只读/写入权限、插件完整生命周期与 UI 沙箱、管理后台、无障碍、性能预算和安全响应头；需真实 IdP 或硬件凭据的 OIDC/Passkey/MFA 场景留作后续环境扩展。

## 当前验证基线

此前已完成切片及本轮本地启动闭环的验证基线：

```text
cargo +1.94.1-x86_64-pc-windows-gnu test --workspace --all-features                 通过（隔离 PostgreSQL 端口 55435）
cargo +1.94.1-x86_64-pc-windows-gnu fmt --all -- --check                              通过
cargo +1.94.1-x86_64-pc-windows-gnu clippy --workspace --all-targets --all-features -- -D warnings 通过
pnpm test                                                38 个文件、236 项通过
pnpm typecheck                                          通过
pnpm build                                              通过
pnpm generate:api --check                               通过
pnpm test:e2e:typecheck                                 通过
pnpm test:e2e                                           默认桌面/移动共 6 项通过
DAOYUN_LOCAL_E2E=1 pnpm test:e2e                       默认与真实业务桌面/移动共 12 项通过
pnpm verify:membership                                  等级 20、勋章 17 通过
pnpm audit --registry=https://registry.npmjs.org --audit-level high                     无已知漏洞
cargo audit                                             443 个 Cargo 依赖、0 个已知漏洞
cargo +1.94.1-x86_64-pc-windows-gnu build --manifest-path sdk/plugin-rust-example/Cargo.toml --target wasm32-wasip2 --release --locked --offline 通过
```

本地运行验证：

- 隔离 PostgreSQL `16.12` 测试实例可连接并成功应用全部迁移。
- 已使用 `C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe` 启动本机隔离实例 `127.0.0.1:55433`，实际查询返回 `daoyun|daoyun_dev|202608050005`。
- PowerShell 备份脚本在未依赖 `PATH` 的情况下自动回退到 `C:\Program Files\PostgreSQL\16\bin`，并已针对隔离库生成 custom-format 备份。
- 已通过 PostgreSQL 16.12 客户端按 SQLx 事务流程将隔离 PostgreSQL 迁移推进到 `202608050005`，包含授权、举报通知和附件生命周期约束。
- 已使用 `backups/postgres/daoyun-20260805T032304Z.dump` 完成 custom-format 备份恢复验证；SHA-256 为 `886f2edbeda44e7d587a50d16f5671ec5b7c9a5c5234827e10d7fd9944b1908f`，临时恢复库已核对后删除。
- 已在恢复库和隔离开发库实际执行 004/005，`_sqlx_migrations` 最高版本为 `202608050005`，迁移校验和、`governance_policies`、`risk_alerts`、`topic_attachments.scan_status` 及 5 个治理/清理权限均核对通过。
- `GET http://127.0.0.1:3000/api/v1/installation` 返回 `200`。
- Vite `/api` 代理访问相同接口返回 `200`。
- `/api/v1/health/live` 与 `/api/v1/health/ready` 均返回 `200`，响应体 `meta.request_id` 与 `x-request-id` 一致。
- `/api/v1/site-branding` 与 `/api/v1/boards` 经 Vite 代理均返回 `200`；`pnpm seed:local` 复用 `demo_admin` 和 `demo_member` 两个 loopback 测试账号。
- `x-request-id` 与响应体 `meta.request_id` 一致。
- 隔离 PostgreSQL 16 实例中，初始化前 GET 返回 `false`，POST 返回 `201`，初始化后 GET 返回 `true`。
- 运行时创建的管理员凭据为可验证的带盐 Argon2id v19 PHC 哈希，响应不包含密码或哈希。
- Web 在初始化前显示安装向导，真实提交后按 `GET false -> POST 201 -> GET true` 切换到社区首页，刷新后保持已初始化分流。
- 浏览器在 320、768、1024 和 1440px 下无水平溢出，安装表单具备正确标题、标签、错误关联和焦点顺序，控制台无错误或警告。
- 真实浏览器已完成注册、刷新恢复、发布两个主题、服务端搜索、热门/精华 Feed、板块计数同步和退出闭环。
- 发布请求返回 `201`，刷新后主题仍来自 PostgreSQL，板块计数从 `0` 递增到 `2`，浏览器控制台无错误或警告。
- 回复请求返回 `201`，刷新主题详情后回复仍来自 PostgreSQL，主题回复计数与公开回复行数一致。
- 主题详情在 1440px 与 390px 视口均无水平溢出，标题、正文、回复时间线和回复表单未发生遮挡。
- 回复编辑后刷新仍保持最新正文，修订历史返回两版；软删除后详情与首页计数同步为 `0`。
- 数据库确认已删除回复正文和两版修订仍保留，主题最后活跃时间在无公开回复时回退到发布时间。
- 公开资料响应不包含邮箱；无效会话 Cookie 按匿名返回并清理，资料编辑使用 CSRF 与修订版本冲突保护。
- 真实浏览器已完成访客资料、本人资料编辑、关注/取消关注和关注 Feed；关注路由仅显示已关注作者主题。
- 用户资料和 Feed 在 1440px 与 390px 视口均无水平溢出或文字裁切，控制台无错误或警告。
- 收藏与点赞的幂等操作、即时计数和刷新持久化已通过真实浏览器验证。
- 私信已完成双用户发送与回复、未读清零、归档、新消息自动恢复、资料页恢复旧会话和刷新持久化验证。
- 私信桌面布局无水平溢出；390x844 移动端首屏显示会话列表，进入详情后返回不会自动重开，
  页面 `scrollWidth` 与 `clientWidth` 均为 `390`，控制台无错误或警告。
- 管理后台以会话与管理 API 响应驱动权限状态；品牌配置和板块管理在 390px 视口无水平溢出，
  颜色预览、表单保存和未授权状态已通过浏览器渲染验证。
- 本轮真实 Chromium 已使用 `demo_admin` 保存品牌配置（`PATCH /api/v1/admin/site-branding` 返回 `200`），
  使用 `demo_member` 完成主题、回复、资料编辑和私信发送并刷新持久化；安全设置完成近期认证、密码临时变更及恢复、
  MFA 状态读取（`GET /api/v1/auth/mfa` 返回 `200`）。匿名首页仅有预期的 `GET /api/v1/auth/session` `401` 探测日志。
- 公开品牌配置已通过真实浏览器渲染验证：1280px 与 390x844 视口均正确应用站点标题“天际社区”、
  `--brand: #123456`、`--accent: #d97706`、`compact` 预设和紧凑列表密度；两个视口均无水平溢出，
  控制台无错误或警告。本次前端 smoke 使用仅监听本机的临时品牌 mock，Rust API 因本机缺少链接器未能启动。
- 本轮会员等级规则、管理员积分授予和 UI 修正已通过 Rustfmt、Clippy、前端全量测试（26 个文件、165 项）、类型检查、生产构建和生产依赖审计；Rust workspace 测试在本机 GNU 环境中因磁盘空间、链接文件占用和长时间链接未完成，未将超时误记为通过。
- 本轮会员迁移已使用 PostgreSQL 16.12 执行并完成回滚校验；会员 API 集成测试已纳入仓库，当前本机完整 Rust 测试仍需更宽裕的磁盘和链接时间。
- 会员经济后台已使用真实管理员会话在 320、390、768、1024 和 1440px 视口验证；规则行、按钮和两列/单列布局无水平溢出，控制台无错误或警告。
- 本轮勋章迁移已在 PostgreSQL 16.12 隔离实例事务中执行并回滚验证；17 条规则种子、唯一持有约束和 3 个 capability 授权均通过 SQL 校验。
- 本轮勋章后端集成测试已纳入仓库；完整 Rust 测试仍受本机缺少 `link.exe`/`gcc.exe` 链接器阻断，前端全量测试 26 个文件、165 项通过。
- API 响应统一附带 `nosniff`、`DENY`、`no-referrer`、CSP 和 Permissions-Policy；生产环境设置 `DAOYUN_HSTS=true` 后额外启用一年期 HSTS。
- Playwright 生产预览质量回归：桌面与 390px 移动视口各通过公开 Feed、axe 无障碍、溢出、控制台和性能预算用例；API 安全头用例在未启动 API 时按配置跳过。
- 本机真实浏览器验证使用 `C:\Users\111\AppData\Local\ms-playwright\chromium-1187\chrome-win\chrome.exe`；CI 使用 `playwright install --with-deps chromium`。
- 认证增强的设备会话切片已通过系统 PostgreSQL 16 临时测试库完成 Rust workspace 全量测试；新增 API 集成测试覆盖会话列表、当前会话保护、CSRF、跨账户隐私边界和撤销后认证失效。前端 27 个文件、176 项测试、类型检查和生产构建均通过。
- 登录后显式绑定 OIDC 外部身份及指定身份替换已完成：绑定只追加新身份，替换在同一事务中删除旧身份并写入新身份；两者均要求 Cookie 会话、CSRF 和 `security.settings` 近期认证。回调重新校验用户/会话绑定，成功后消费近期认证、撤销其他会话、轮换 CSRF 并写最小审计。本人资料页的“登录方式”区域已提供身份列表、provider 列表、近期认证后的绑定/替换/解绑、加载失败重试和 OIDC 回调后的自动返回；页面不显示 issuer、subject、邮箱或上游令牌。
- 2026-08-12 本地人工回归：普通用户、资料/私信/通知/安全设置、管理员、运维/插件和桌面/移动布局均通过；浏览器控制台未发现产品错误。
- 公开质量 E2E 首轮稳定复现远程 mock 封面 DNS 错误；`e2e/fixtures.ts` 改为本地响应该固定 HTTPS 图片后，桌面/移动公开质量及安全 6 项通过。
- 首轮整套回归除公开质量的 2 项 DNS 错误外其余 10 项通过，其中真实业务桌面/移动 6 项通过；修复后立即整套重跑时，业务用例因生产级 10 次/15 分钟/IP 登录限流返回预期 `429`，未将限流状态误记为产品回归。
- 本轮前端全量 Vitest 38 个文件、236 项通过，E2E TypeScript 类型检查和生产构建通过。

## 下一实现切片

生产对象存储、基础质量工程、API 类型迁移、会员资源目录、积分账本、等级授予规则、勋章能力、设备会话管理、近期认证、修改密码、OIDC 外部身份绑定/替换及未绑定身份归属、Passkey 注册/登录/凭据管理切片已完成；OIDC provider 配置、公开元数据、授权事务、discovery/JWKS 缓存、token/ID Token 验证和 HTTP start/callback 已完成。

1. 当前优先：继续按页面、操作、预期、实际四项格式执行本地服务人工测试与问题修复。
2. 延期：Docker Compose 镜像构建、容器启动、健康检查和发布回滚演练。
3. 在专用环境接入真实 IdP 或硬件凭据，扩展 OIDC/Passkey/MFA 浏览器回归。

### 43. OIDC provider 配置与公开元数据

- 新增 `DAOYUN_OIDC_PROVIDERS` JSON 配置解析，限制 provider 数量、key 格式、字段长度和 UTF-8 控制字符。
- issuer 必须是无凭据、无查询和无片段的 HTTPS URL；回调必须使用精确路径，仅 loopback 回调允许 HTTP。
- 新增 `GET /api/v1/auth/providers`，只返回公开的 provider key 和显示名，未配置时返回空数组。
- OpenAPI、生成的 TypeScript 声明、4 项 Rust API 集成测试和公共 DTO 序列化契约已覆盖；本切片不实现 discovery、PKCE 或授权码交换。
- Rustfmt、OIDC 库与测试目标 Clippy、前端 27 个文件 179 项测试、类型检查和生产构建通过；全 API 测试目标 Clippy 受本机并发内存映射失败阻断。

### 44. OIDC 授权事务内核

- 新增受限的进程内授权事务存储，最多保留 1024 个事务，事务 5 分钟过期并在创建时清理过期项。
- 每次事务生成独立高熵 `state`、`nonce`、浏览器绑定值和 43 字符 code verifier，固定使用 RFC 7636 S256 challenge。
- 消费同时校验 provider 与浏览器绑定值，错误绑定不会销毁有效事务；正确消费原子移除事务，重放和过期统一失败。
- RFC 7636 S256 向量、随机性、绑定、容量、过期和重放均有 Rust 单元测试；HTTP start/callback 尚未接入，避免在 discovery 完成前伪造授权端点。

### 45. OIDC 运行时依赖初评

- `openidconnect 4.0.1` 最小候选树仍引入 `reqwest 0.12.28` 与命中 `RUSTSEC-2023-0071` 的 `rsa 0.9.10`，当前拒绝引入该候选。
- discovery 网络层直接使用 `reqwest 0.13.4`，固定关闭默认 feature 并只启用 `rustls`；不启用系统代理、默认 TLS、压缩、Cookie、HTTP/2 或 JSON feature。
- GitHub Git 协议受阻时改用官方 ZIP 的 RustSec advisory-db 快照；`cargo-audit 0.22.2` 对当前 Cargo.lock 报告 0 个漏洞，独立 `openidconnect` 候选树报告 1 个未修复漏洞。
- HTTP start/callback 和授权码交换仍不得启用，下一候选必须重新通过同一审计门槛。

### 46. OIDC discovery metadata 校验与缓存内核

- discovery metadata 仅接受配置 issuer 的逐字匹配，并要求 authorization、token、JWKS 端点使用 HTTPS、无凭据且无 fragment。
- 只接受声明 `code`、`S256` 和 `RS256` 的 provider；响应体限制为 64 KiB，解析失败和不安全 metadata 不区分对外错误细节。
- 新增进程内固定 TTL（1 小时）、固定容量（16 provider）缓存；过期值在读取和写入时清理，容量满时不替换现有有效值。
- discovery metadata 切片本身尚未实现 JWKS 刷新；后续 JWKS 缓存切片已完成，HTTP start/callback 和授权码交换仍保持关闭。
- Rust 单元测试覆盖逐字 issuer、端点协议、能力声明、超大响应、TTL 过期和容量边界。

### 47. OIDC 受限 discovery 网络客户端

- 新增 HTTPS-only discovery 客户端，固定 3 秒连接和 8 秒总请求超时，禁止自动重定向，显式发送 `Accept: application/json` 并要求响应 `Content-Type: application/json`。
- 响应在 Content-Length 预检和逐块读取两处限制 64 KiB，拒绝 3xx、非成功状态、错误媒体类型、读取错误和不安全 metadata。
- discovery 缓存按 provider 使用异步互斥合并并发首次请求，获得锁后再次检查缓存，避免同一 provider 的启动刷新风暴。
- 本切片不注册 HTTP 授权路由、不交换授权码、不请求 JWKS，也不向公开 provider API 暴露协议端点。
- Rust 单元测试覆盖有效抓取、HTTPS-only、重定向拒绝、媒体类型、超大响应、总请求超时和并发请求合并。

### 48. OIDC JWKS 校验与缓存内核

- JWKS 响应复用 discovery 的 HTTPS-only、3 秒连接/8 秒总超时、禁止重定向、`application/json` 和 64 KiB 双重读取边界，不复制网络读取逻辑。
- 单个集合最多接受 64 个 key；`kid` 最多 128 字符且集合内唯一，只保留参数完整、用途/算法一致的 RSA、EC、OKP 公钥，拒绝 `oct` 和 `d`、`p`、`q`、`dp`、`dq`、`qi`、`oth`、`k` 等私钥/对称材料。
- RSA modulus 按 RSASSA 要求至少 2048 bit；EC/OKP 坐标按曲线要求固定长度，Base64urlUInt 拒绝 padding、非规范尾位和前导零。
- 缓存固定 15 分钟 TTL、16 provider 容量和 30 秒强制刷新冷却；同 provider 并发首次读取/刷新合并为一次请求，失败从 30 秒指数退避至最多 5 分钟。
- 刷新失败时仍可返回未过期旧 key；一旦 TTL 到期立即停止返回，并在退避窗口内拒绝重复上游请求。HTTP start/callback、授权码交换和 ID Token 验证仍未启用。
- Rust 单元测试覆盖有效 JWKS、私钥/对称材料拒绝、重复/过长 `kid`、参数与算法约束、大小/key 数上限、缓存命中、并发合并、刷新冷却、密钥轮换、指数退避和过期拒绝。

### 27. 附件对象存储与图片处理

- 新增 `POST /api/v1/topics/{topic_id}/attachments` 原始二进制上传，使用 Cookie 会话、CSRF 和 `attachment.create` capability。
- 服务端限制 50 MiB、文件名安全字符和允许 MIME，并对 PNG/JPEG/GIF/WebP/PDF/纯文本执行文件签名校验，拒绝 MIME 伪装。
- 普通注册用户在注册事务中自动获得 `member` 角色及 `attachment.create` capability，只有主题作者可以上传自己的附件。
- 本地对象存储默认写入 `target/daoyun-attachments`，可通过 `DAOYUN_ATTACHMENT_ROOT` 切换；对象键只由 UUID 和固定扩展名组成。
- 图片上传使用 `image` 解码并生成最大 640px 的 WebP 缩略图；原图、缩略图读取 API 只暴露公开主题的 ready 附件。
- 附件元数据写入和对象文件写入具备失败清理，列表、下载、缩略图下载统一使用 request ID envelope/错误隔离。
- 新增 API 集成测试覆盖无效签名、元数据、公开列表、原图下载和缩略图下载；对象存储切片测试、Clippy、前端 156 项测试、类型检查和生产构建已通过，注册角色改动后的完整 Rust 回归待恢复本机链接器后执行。

### 28. 举报批量处理

- 新增 `POST /api/v1/admin/reports/batch`，一次最多处理 50 条举报，拒绝空列表和重复 ID。
- 批量动作按举报 UUID 稳定排序并在同一 PostgreSQL 事务中锁定举报、更新目标、写入审计和发送处理通知；任一举报不存在或目标处理失败时全部回滚。
- 批量接口复用 `governance.reports.resolve` capability、CSRF、状态/动作组合校验和统一错误 envelope。
- TypeScript 客户端和管理后台支持选择多条待处理举报并批量驳回，组件、客户端运行时结构校验和 OpenAPI 覆盖已加入。

### 29. 举报风控策略与风险告警

- 新增单例 `governance_policies`，支持启用开关、风险分数阈值、举报者时间窗口和频次阈值；管理员写入要求 `governance.policy.write`，所有变更写入 `admin_audit_log`。
- 举报创建事务按原因、举报者窗口内频次和目标近期举报数计算 1 到 100 分；超过阈值或触发频次阈值时生成唯一未处理 `risk_alerts`，不会影响举报幂等和原有通知事务。
- 新增 `GET/PATCH /api/v1/admin/governance/policy`、`GET /api/v1/admin/risk-alerts`、`PATCH /api/v1/admin/risk-alerts/{alert_id}`，支持状态筛选、UUID 游标、确认/驳回和稳定错误隔离。
- 新增 `GET /api/v1/admin/audit/alerts` 固定查询风险告警审计记录；风险策略和告警能力使用独立 capability，并在安装迁移中授予既有 `super_admin`。
- 管理后台增加风控告警页，提供策略表单、告警严重度/分数、确认和驳回操作；TypeScript 运行时结构校验、Rust/API 集成测试、OpenAPI、前端测试、类型检查和生产构建已加入。

### 30. 附件安全扫描与生命周期清理

- `topic_attachments` 新增 `scan_status`、`scanned_at`、`expires_at` 和 `deleted_at` 字段，生命周期迁移新增 `attachment.cleanup` capability，并为既有 `super_admin` 补齐授权。
- 上传在写入对象和数据库前执行确定性 EICAR 测试样本扫描；命中样本返回 `attachment.invalid`，不会留下对象或元数据。
- 新增 `POST /api/v1/admin/attachments/cleanup`，要求会话、CSRF 和 `attachment.cleanup`，按批次删除过期、拒绝、感染/扫描错误记录及其对象，并清理超过 24 小时宽限期的本地孤儿文件。
- 孤儿扫描使用不跟随符号链接的元数据读取并跳过链接目录，避免清理范围越出对象根目录；Unix 回归测试覆盖该边界。
- 附件 DTO 暴露 `scan_status`，清理响应返回删除记录数、删除对象数和失败对象数；迁移回滚、OpenAPI、附件集成测试、Rustfmt、类型检查和前端回归已覆盖。
- 本切片初始保持本地 provider 可用且不伪造外部上传成功；后续第 37 节已补充可配置的标准 S3 API provider。

### 31. API 安全响应头

- API、错误、健康检查和 OpenAPI 响应统一添加 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、严格 CSP 和 Permissions-Policy。
- HSTS 默认关闭以保持本地 HTTP 开发可用；部署到 HTTPS 生产环境时设置 `DAOYUN_HSTS=true`，响应添加 `Strict-Transport-Security: max-age=31536000; includeSubDomains`。
- 健康检查集成测试覆盖五个基础安全头；Rust 完整测试仍需恢复本机 GNU 链接器后执行。

### 32. GitHub Actions CI 质量门禁

- 新增 `.github/workflows/daoyun-ci.yml`，仅在 `daoyun/**` 或工作流自身变更时触发，并取消同一分支上的过期运行。
- 前端 job 固定 pnpm 9.12.3 和 Node.js 22，执行冻结安装、TypeScript 类型检查、Vitest、生产构建和生产依赖审计。
- Rust job 固定 Rust 1.94.1，使用 PostgreSQL 16 服务容器执行 Rustfmt、Clippy 和 workspace 测试；CI 数据库凭据仅为临时值。
- 工作流权限限制为 `contents: read`，Cargo 与 pnpm 均启用依赖缓存。

### 33. Docker Compose 本地运行环境

- 新增多阶段 `Dockerfile`，在 Rust 1.94 Bookworm builder 中编译 API，并以非 root `daoyun` 用户运行精简 Debian 镜像。
- 新增 `docker-compose.yml`，使用 PostgreSQL 16 健康检查后启动 API；API 监听 `0.0.0.0:3000`，本地数据库映射 `55433`。
- PostgreSQL 与附件对象分别使用命名卷持久化；运行时仅通过环境变量注入数据库、绑定地址和附件根目录。
- Compose 默认凭据仅用于本地开发，生产环境仍需替换为秘密管理系统，并配置 `DAOYUN_HSTS=true`。
- 当前机器未安装 Docker CLI，因此 Compose 只完成静态配置校验，尚未进行实际镜像构建与启动验证。

### 34. PostgreSQL 备份与恢复脚本

- 新增 PowerShell 与 POSIX shell 版本的 PostgreSQL custom-format 备份脚本，默认输出 `backups/postgres/daoyun-<UTC>.dump`。
- 每个备份同时生成 SHA-256 校验文件；恢复脚本在存在校验文件时拒绝校验不匹配的备份。
- 恢复必须显式传入 `-AllowDataLoss` 或 `ALLOW_DATA_LOSS=1`，并使用 `--clean --if-exists --single-transaction`，降低误操作风险。
- 脚本不保存或写出数据库凭据，生产运行应由秘密管理系统或 `.pgpass` 注入 `DATABASE_URL`/连接认证信息。
- PostgreSQL 16.12 客户端位于 `C:\Program Files\PostgreSQL\16\bin`，已完成真实备份、校验和、临时库恢复和迁移验证；当前仅因未安装 Docker CLI，尚未进行 Compose 镜像构建与容器启动验证。

### 35. 公开品牌配置前端运行时映射

- 新增公开 `GET /api/v1/site-branding` TypeScript 客户端，校验统一 envelope、UUID、颜色、枚举值和 HTTPS Logo/Favicon 地址。
- Web 启动时读取公开品牌配置并映射站点标题、favicon、Logo、`--brand`/`--brand-strong`/`--brand-soft`/`--accent` CSS Variables、
  `data-brand-preset` 与 `data-list-density`；深色预设和首页模式分别参与主题与 Feed 初始状态选择。
- 品牌配置运行时和危险 URL 拒绝均有客户端测试；前端全量测试 25 个文件、156 项，类型检查和生产构建通过。

### 36. OpenAPI TypeScript 生成基线

- 固定 `openapi-typescript@7.13.0`，新增 `scripts/generate-api-client.mjs`，默认读取运行中 API 的
  `GET /api/v1/openapi.json` 并以 UTF-8 写入 `src/api/generated.d.ts`。
- 生成器支持 HTTP(S) 地址和本地 JSON/YAML 文档，校验 `--input`/`--output` 参数，拒绝未知参数和非 `.d.ts` 输出路径。
- 新增 `--check` 一致性校验模式；CI 在 PostgreSQL 服务和 API 进程启动后生成临时声明并检查关键 OpenAPI 路径，避免生成器只在本地 fixture 上通过。
- 生成器参数、路径处理和最小 OpenAPI 3.1 文档生成均有 6 项 Vitest 覆盖；API 可启动后已完成全部业务客户端的生成类型迁移，并通过运行中 OpenAPI 文档一致性校验。

### 37. 生产 S3 兼容对象存储

- 选定标准 S3 API 作为生产对象存储接口，使用 `object_store` Amazon S3 后端，兼容 AWS S3、MinIO、Cloudflare R2 等 S3 兼容 provider。
- `DAOYUN_ATTACHMENT_PROVIDER=local|s3` 控制 provider，默认保持本地 `DAOYUN_ATTACHMENT_ROOT`；S3 使用 bucket、endpoint、region、前缀、路径风格和会话凭据环境变量。
- S3 endpoint 默认只允许 HTTPS，HTTP 仅在显式设置 `DAOYUN_S3_ALLOW_HTTP=true` 时允许；凭据不写入代码或日志，支持标准 AWS 环境/IAM 凭据链。
- 上传、缩略图写入、下载、失败回滚和过期对象删除统一经过 provider；本地 provider 保留 24 小时孤儿文件清理，S3 provider 由数据库生命周期和 bucket 生命周期规则共同负责。
- 本地开发默认不编译 S3 客户端依赖，附件文件由受路径校验保护的 Tokio 文件 provider 读写；Docker 生产镜像显式使用 `--features infrastructure/s3`，避免开发环境误将 S3 凭据或网络依赖作为必需条件。
- provider 配置校验、HTTP 安全边界和前缀路径遍历防护已加入基础测试；本机 Rust 完整编译仍受链接器缺失阻断。

### 38. 浏览器质量工程

- 新增 Playwright Chromium 桌面与 390px 移动视口项目，生产预览下验证公开 Feed、无水平溢出、控制台无意外错误和 axe WCAG AA 无障碍规则。
- 新增导航/首屏性能预算（DOMContentLoaded、load、FCP、CLS）和 API 安全响应头回归；无运行 API 时安全测试显式跳过，CI Rust job 启动 API 后执行。
- GitHub Actions 前端 job 安装 Chromium 并执行浏览器质量用例；Rust job 在 API 启动期间执行安全头回归。
- 浅色主题 `--text-faint` 调整为满足 WCAG AA 的对比度；本机已用现有 Chromium 1187 完成桌面和 390px 视口真实浏览器验证。

### 39. 设备会话管理

- 新增 `sessions.device_label` 与活跃会话排序索引；设备名称仅由服务端把 User-Agent 归类为移动、Windows、Mac、Linux 或未知设备，不保存原始 User-Agent 或 IP。
- 新增 `GET /api/v1/auth/sessions` 与 `DELETE /api/v1/auth/sessions/{session_id}`；读取需要 Cookie 会话，撤销额外需要 CSRF，跨账户、已撤销和不存在的会话统一返回未找到，当前会话返回冲突。
- 认证查询显式区分会话 ID 与用户 ID，设备列表可稳定标记当前会话；撤销其他设备后其下次认证请求清理 Cookie 并返回未认证。
- OpenAPI、生成的 TypeScript 声明、浏览器客户端和本人资料页“管理设备会话”入口已同步；界面覆盖加载、失败重试、当前会话禁用、撤销确认与确认焦点。

### 40. 安全审计基础

- 新增独立 `security_audit_log` 表及用户、会话、事件时间索引；用户或会话删除后审计记录保留但关联置空。
- 登录成功、登录失败、当前会话退出和设备会话撤销写入服务端控制的最小事件；不保存密码、令牌、原始 User-Agent、IP 或登录标识。
- 审计写入失败只记录服务端 request ID 并保持认证请求可用，避免审计存储故障扩大为登录或退出故障。
- 基础设施与认证 API 集成测试覆盖事件关联、泛化元数据、错误登录和会话撤销；Rustfmt、Clippy 和认证测试通过。

### 41. 近期认证事务基础

- 新增 `recent_authentications` 表，按用户、当前会话、allowlist 操作和认证方法绑定 10 分钟有效状态；删除用户或会话会级联清理。
- 新增 `POST /api/v1/auth/recent-auth`，要求有效 Cookie 会话、会话绑定 CSRF 和当前账户密码；错误密码使用统一凭据错误并受独立限流。
- 同一会话和操作使用 PostgreSQL 原子 upsert 保持一个活动状态；基础设施提供原子消费接口，过期或已消费状态不能重放。
- 用户与会话通过复合外键保持归属一致；会话撤销、会话过期或账户停用后，已有近期认证不能被消费。
- OpenAPI、生成的 TypeScript 声明和浏览器客户端已同步；客户端固定 `security.settings` 操作，不暴露 bearer token 或任意操作名入口。
- API、契约、并发替换、一次性消费、CSRF、错误密码、限流和最小化审计元数据均有测试覆盖。
- PostgreSQL 16 临时库已完成近期认证迁移的正向、反向和再次正向校验；复合外键与回滚约束清理均通过。

### 42. 修改密码近期认证消费者

- 新增 `POST /api/v1/auth/password`，请求只包含 6-128 个 Unicode 字符的新密码；端点要求有效 Cookie 会话、会话绑定 CSRF 和一次性 `security.settings` 近期认证。
- 近期认证消费、新 Argon2id v19 哈希写入、其他活跃会话撤销、当前会话 CSRF 哈希轮换和最小化 `auth.password.changed` 审计在同一 PostgreSQL 事务中完成；晚期约束失败测试证明全部状态回滚。
- 缺失、过期、已消费的近期认证统一返回 `auth.recent_auth_required`；成功响应只返回新的 CSRF token 并更新 CSRF Cookie，不返回密码、哈希或会话 token。
- 本人资料页新增“修改密码”入口，依次提交当前密码近期认证和新密码，校验确认密码并把轮换后的 CSRF token 回写 App 会话状态。
- Rust workspace 全量测试、Rustfmt、前端 27 个文件 179 项测试和 TypeScript 类型检查通过；真实 Chromium 验证近期认证与密码变更均返回 200，桌面三列和 390px 移动单列布局无失败请求或控制台错误。

### 43. OIDC token exchange 与 ID Token 验证内核

- 依赖评审拒绝 `openidconnect 4.0.1` 和 `oauth2 5.0.0`：前者引入命中无修复 RustSec 的 `rsa 0.9.10`，后者固定 `reqwest 0.12`；固定 `jsonwebtoken 11.0.0` 的 `aws_lc_rs` 后端，不引入 reqwest/rsa。
- 授权码 token POST 复用现有受限 `reqwest 0.13.4`，仅发送固定 grant、code、redirect URI、client credentials 和 PKCE verifier；响应要求 JSON、Bearer、ID Token，并限制 64 KiB，短期令牌使用 zeroizing 容器。
- ID Token 验证固定 RS256，按 `kid` 选择已缓存 RSA 公钥，校验签名、issuer、audience、`azp`、exp、iat 和事务 nonce；nonce 使用恒定时间比较，错误不会回显 provider 响应原文。
- 新增 token response、表单字段、响应边界和验证失败路径测试；OIDC 单元测试 17 项通过，Rustfmt、API clippy（`-D warnings`）通过，候选最小树编译与 162 包 RustSec 快照审计通过。
- 本切片完成时 HTTP start/callback 尚未启用；后续第 44 节已接入外部身份表、回调和 DaoYun 会话创建。

### 44. OIDC HTTP 回调与已绑定身份会话

- 新增 `external_identities` 独立表，以 `(provider_key, subject)` 唯一约束保存用户、精确 issuer、可选邮箱快照和认证时间；查询同时要求 issuer 匹配和活动本地用户，邮箱不会参与账户查找或自动合并。
- `GET /api/v1/auth/oidc/{provider}/start` 只使用 allowlist 配置和已校验 discovery endpoint，按客户端 IP 限流，生成固定 `code`/`openid`/S256/state/nonce/redirect 参数，设置 5 分钟 HttpOnly、SameSite=Lax 浏览器绑定 Cookie 并返回 302。
- callback 先单次消费 provider/state/Cookie 绑定事务，再执行受限 token exchange、JWKS/RS256 校验和已绑定身份查找；provider 原始错误、access token 和 refresh token 均不进入响应、数据库或日志。
- 已绑定活动用户成功后创建 DaoYun session/CSRF Cookie，写入仅含 provider key 的 `auth.oidc.succeeded` 安全审计并 302 返回根路径；有效事务后的 provider、验证和未绑定身份失败写入仅含 provider/stage 的 `auth.oidc.failed`，未绑定身份返回 `auth.oidc_identity_required`。显式绑定仍未开放，解绑已由独立高风险事务切片提供。
- OIDC 单元测试增至 20 项，覆盖固定 start 参数、单 audience `azp`、浏览器 Cookie 绑定、provider 错误泛化和事务单次消费；独立 HTTP 测试覆盖未知 provider、无效 callback 和敏感错误不回显，PostgreSQL 测试覆盖唯一约束、issuer 精确匹配、邮箱不自动合并及快照更新。

### 45. 外部身份解绑

- 新增 `POST /api/v1/auth/identities/{identity_id}/unlink`，要求有效 Cookie 会话、会话绑定 CSRF 和一次性 `security.settings` 近期认证。
- 身份不存在、已解绑或不属于当前用户统一返回 `auth.identity_not_found`；当前实现支持的密码凭据和其他外部身份共同构成可用登录方式，删除最后一种方式返回 `auth.last_login_method`。
- 用户行锁、近期认证消费、身份删除、最后登录方式判断、其他会话撤销、当前 CSRF 哈希轮换和 `auth.identity.unlinked` 审计写入在同一 PostgreSQL 事务中完成；失败会回滚身份、近期认证和会话安全状态。
- 成功只返回 `unlinked` 和新的 CSRF token，并设置新的 CSRF Cookie；审计元数据只包含 provider key，不保存身份 subject、邮箱、令牌、IP 或 User-Agent。
- OpenAPI、生成的 TypeScript 声明、客户端运行时 DTO、Rust 基础设施/API 集成测试和公共响应契约已同步；前端客户端定向测试与类型检查通过。

### 46. 登录后显式绑定与外部身份替换

- 新增 `GET /api/v1/auth/identities`，仅返回 provider key、显示名、绑定时间和最近认证时间，不暴露 issuer、subject、邮箱或任何上游 token。
- 新增 `POST /api/v1/auth/oidc/{provider}/bindings` 和 `POST /api/v1/auth/oidc/{provider}/bindings/{identity_id}/replacement`；两者要求当前 Cookie 会话、会话绑定 CSRF 和一次性 `security.settings` 近期认证。
- 绑定只追加新外部身份；替换必须显式指定 `identity_id`，在同一 SQLx 事务中校验旧身份归属、删除旧身份并写入新身份，冲突时完整回滚。
- OIDC 授权事务保存用户、会话和替换目标绑定；callback 重新校验用户/会话归属，成功后消费近期认证、撤销其他会话、轮换当前 CSRF 并写入 `auth.identity.bound` 或 `auth.identity.replaced` 最小审计。
- 绑定 callback 不创建新的登录会话；不允许邮箱自动合并、身份转移或保存/返回上游 token。OpenAPI、生成的 TypeScript 声明、客户端运行时校验及基础设施/API/契约测试已同步。
- 本人资料页新增“登录方式”区域：仅展示 provider 名称、绑定时间和最近验证时间；每次绑定、替换、解绑都先以当前密码建立一次性 `security.settings` 近期认证。绑定与替换跳转前只在 `sessionStorage` 保存十分钟、单次消费的用户名返回标记，callback 恢复会话后自动回到该区域；不保存 token、subject 或邮箱。

### 47. 未绑定 OIDC 身份的显式账户归属

- 未绑定身份的 callback 不再返回冲突；服务端创建 5 分钟、容量受限、单次消费的 OIDC claim，通过 HttpOnly、SameSite=Lax Cookie 绑定浏览器后 302 到 `/#oidc-claim`。claim 的 subject、issuer、完整邮箱和上游 token 始终只留在服务端内存。
- 新增 claim 查询、创建账户与登录后绑定端点。查询只返回 provider 名称、可选 profile 名称、用户名建议和脱敏邮箱提示；失效或缺失的 claim 清除 Cookie 并返回统一 `auth.oidc_claim_required`。
- 新账户路径在同一 SQLx 事务中创建用户、密码凭据、成员关系、外部身份、会话与最小 `auth.oidc.claim.account_created` 审计事件；不按 provider 邮箱自动合并本地账户。
- 已有账户路径必须先以密码登录，再使用当前 Cookie 会话、CSRF 和一次性 `security.settings` 近期认证执行绑定；成功路径轮换 CSRF、撤销其他会话并单次消费 claim。
- 前端新增独立 `#oidc-claim` 视图，覆盖 claim 加载/失效、新账户、已有账户登录和近期认证绑定流程；浏览器 API 仅使用 Cookie，未将身份材料写入 localStorage 或 sessionStorage。
- claim 写入前丢弃超长、空白或包含控制字符的上游 profile 字段；页面在当前会话异步加载完成后直接进入近期认证，避免误显示新账户/重新登录选择。
- Rustfmt、API 及测试目标编译、TypeScript 类型检查和 307 个 Rust 依赖的 RustSec 审计已通过（0 个漏洞）；Vitest、Vite 构建和真实浏览器验收待恢复本机 Node 文件读取与进程创建权限、PostgreSQL 连接后执行。

### 48. 下一步：Passkey 注册、登录与凭据管理

- 当前 OIDC claim 切片已恢复并通过全量前端测试（30 个文件、195 项）、类型检查、生产构建及 Chromium 桌面/390px 浏览器质量验收；公开 Feed 质量用例 4 项通过，未启动 API 时的 2 项安全头用例按配置跳过。
- Passkey 依赖评审已完成：采用 `passkey-auth 0.1.3`（MIT OR Apache-2.0、MSRV 1.85），其隔离 lockfile 的 101 个依赖通过 RustSec 审计且未引入 OpenSSL/RSA；拒绝 `webauthn-rs 0.5.5` 的强制 OpenSSL 链。详见 ADR-002。
- 后续实现 WebAuthn discoverable credential 的注册 options/verify、登录 assertion options/verify、凭据列表与删除；挑战必须服务端短时、单次消费并绑定用户、会话和操作。
- 注册、删除和首选凭据变更继续要求 Cookie 会话与近期认证；断言成功后才创建 DaoYun 会话，不向浏览器持久化挑战、公钥材料或 bearer token。

### 49. Passkey 注册、登录与凭据管理

- 已接入 `passkey-auth 0.1.3`，新增 Passkey 凭据与短时挑战迁移；挑战使用 PostgreSQL 原子单次消费，注册挑战绑定用户/会话，断言挑战保持匿名并在验证后按用户句柄绑定凭据。
- 新增注册 options/verify、断言 options/verify、凭据列表和删除 API；RP ID、origin、strict base64、用户验证和用户句柄策略由服务端配置与校验，断言计数器使用条件原子更新并覆盖完整 `u32` 范围。
- 注册与删除复用 `security.settings` 近期认证并轮换当前 CSRF；断言成功才创建 DaoYun Cookie 会话并写入最小 `auth.login.succeeded` 审计，不返回公钥材料或 bearer token。
- 前端 API 客户端、OpenAPI TypeScript 声明、用户资料页 Passkeys 管理面板和登录弹窗已同步；客户端回归测试覆盖 base64url 编码、CSRF 边界、凭据管理和浏览器凭据登录，Vitest 全量 31 个文件、201 项通过，TypeScript 类型检查、生产构建和 Rustfmt 通过。
- Rust 集成测试新增挑战单次消费、凭据唯一性和最大计数器边界；已使用 MSYS2 GNU toolchain 与隔离 PostgreSQL 完成 workspace 测试和 Clippy 验收，Passkey 集成测试全部通过；Playwright 公开质量用例 4 项通过，未启动 API 的安全头用例 2 项按配置跳过。

### 50. PostgreSQL Outbox 持久化基础

- 新增 `outbox_events` 正反迁移，包含事件类型、聚合资源、JSONB payload、幂等键、状态、尝试次数、可用时间、租约、泛化错误摘要和完成时间；数据库约束拒绝非法状态组合、空 payload、越界重试次数和不安全标识符。
- 新增事务可组合的事件 enqueue；相同事件类型和幂等键并发写入只保留一条，相同键复用不同聚合、payload 或重试策略时返回幂等冲突，调用方事务回滚会同步撤销事件。
- 新增基于 `FOR UPDATE SKIP LOCKED` 的批量 claim，支持多 Worker 租约隔离、过期租约重新领取、最大尝试次数 dead 转换以及 5 秒起、1 小时封顶的指数退避。
- 完成与失败操作必须匹配事件 ID、有效租约 token 和未过期租约；失败摘要只保留首行、移除控制字符并限制 500 字符，不记录完整外部错误或 payload。
- PostgreSQL 集成测试覆盖正反迁移、数据库约束、并发幂等、事务回滚、批量领取隔离、租约所有权、重试、dead 状态与过期租约重领；Outbox 定向测试 5 项、完整 Rust workspace、Rustfmt 和 Clippy 均通过。

### 51. Outbox Worker 与 Redis 品牌缓存

- 新增按已注册事件类型领取的 Outbox Worker，未知事件保持 pending；单事件 handler 失败不会中断同批后续事件，Worker 支持关闭信号并与 API 服务优雅退出。
- 站点品牌更新、管理员审计和 `cache.site_branding_invalidated` 事件在同一 PostgreSQL 事务提交；失效 handler 幂等删除固定版本缓存键，失败进入既有指数退避和 dead 状态边界。
- 固定 `redis-rs 1.5.0`，启用 Tokio、Rustls WebPKI roots 和惰性自动重连 `ConnectionManager`；Redis 默认关闭，远程明文 URL 默认拒绝，连接与响应超时均有边界，日志不输出 URL、凭据或缓存 payload。
- 公开品牌接口采用 cache-aside，缓存未命中时读取 PostgreSQL 并写入带 TTL 的缓存；Redis 查询、写入、反序列化或失效失败时，公开读取保持 fail-open，PostgreSQL/Outbox 仍是事实来源。
- 数据库测试覆盖事件事务写入、按类型过滤、失败隔离和优雅停止；受控 Redis 协议测试覆盖 GET、SET EX、DEL 与真实失效 handler，不可达 Redis 的 API 集成测试证明仍返回正常品牌响应。

### 52. TOTP MFA、恢复码与 pending challenge

- 新增 `mfa_totp`、`mfa_recovery_codes` 和 `mfa_challenges` 正反迁移；TOTP secret 只保存 AES-256-GCM 密文，恢复码只保存 Argon2id PHC 哈希，挑战只保存浏览器 token SHA-256 哈希并限制 5 次失败。
- 新增 MFA 状态、TOTP setup/enable/disable、恢复码重生成和 pending challenge verify API；高风险变更在同一事务消费近期认证与当前 MFA、撤销其他会话、轮换 CSRF 并写最小审计。
- 密码登录和 Passkey 断言在 MFA 开启时只返回 202 challenge，不创建完整会话；验证成功后才创建 DaoYun Cookie 会话。挑战 Cookie 为 HttpOnly、短时、单次且绑定浏览器。
- 前端登录弹窗支持 MFA 验证，个人资料页新增 TOTP/恢复码安全设置；恢复码只在启用或重生成响应中展示，不写入 localStorage/sessionStorage。
- MFA 定向 PostgreSQL/API 测试、API Clippy、前端定向 Vitest 和 TypeScript 类型检查已通过；本轮完整 Rust、前端与浏览器质量门禁也已通过。

### 53. 本地真实业务 Playwright 回归

- 新增环境门控的 `e2e/local-business-flow.spec.ts`；只有显式设置 `DAOYUN_LOCAL_E2E=1` 时才进入 Playwright 集合，默认 CI 和公开 mock 质量用例不依赖本地测试账号。测试同时强制 Web 与 API 使用 loopback HTTP 地址，避免固定本地凭据和持久测试数据误发往共享环境。
- 测试先检查真实 API 就绪状态，再使用固定 loopback 账号完成登录、主题发布、回复发布、管理员资料入口和私信发送，并断言关键写请求状态、无 5xx 和无意外控制台错误。
- 桌面 1440px 与移动 390px 两个项目均已通过；测试数据使用随机后缀，避免并发执行时标题或消息互相冲突。
- 首次执行先稳定复现浏览器自动请求 `/favicon.ico` 的 404 控制台错误；新增默认 `public/favicon.svg` 和 HTML favicon 声明后回归通过，品牌配置的运行时 favicon 仍可覆盖默认资源。
- 前端 32 个文件 203 项测试、TypeScript、生产构建、Playwright 类型检查、默认 Playwright 6 项和本地真实业务 2 项均通过。

### 54. 细粒度 RBAC/ABAC 管理闭环

- 新增可回滚授权管理迁移，为角色增加正整数 revision，并引入角色/分配读写四项 capability；既有 `super_admin` 可逆回填，系统角色保持只读。
- 管理员可以从固定 capability 目录创建、修改和删除自定义角色，以精确用户名在 instance/site 或指定 board 作用域分配和撤销角色；角色键与作用域不可变，更新采用乐观并发，已分配角色不可删除。
- 所有授权写入会在同一 PostgreSQL 事务内重新验证操作者的全局 grant ceiling，并原子写入最小管理审计；仅持有授权管理写权限不能授予操作者自身没有的 capability，并发撤权不会留下陈旧授权窗口。
- 服务端继续把资源所有权、可见性和生命周期状态作为业务事务内的 ABAC 条件；真实浏览器已证明 `demo_member` 获得指定板块 `moderation.topic` 后只能管理该板块，不能管理无关板块，撤销分配后立即返回 `403`。
- 新增 `GET /api/v1/admin/access`，只返回当前会话用户有效的全局 capability；管理后台按 capability 展示和加载标签，不再要求品牌、板块和举报权限同时存在。运维只读用户可直接进入唯一可用标签，未授权 API 仍由服务端拒绝。
- 公共 DTO、OpenAPI、请求 ID、稳定错误、隐私字段、迁移正反向、基础设施并发/作用域、API、TypeScript 运行时校验、React 组件和桌面/移动 Chromium 回归均已覆盖；详细边界见 [RBAC/ABAC 授权规格](specs/authorization.md)。

### 55. 运营监控、链路与告警闭环

- 新增默认关闭且 bearer token 保护的 `GET /metrics`，输出低基数 Prometheus 指标：HTTP 方法/模板路由/状态类、延迟直方图、并发请求、uptime、数据库连接池、Outbox、风险告警和运营告警；关闭或 token 错误统一返回 `404`，token 使用恒定时间比较。
- 新增严格 W3C `traceparent` 中间件：只接受 version 00、小写十六进制、非全零标识与受支持 flags；合法 trace ID 延续并生成新 span ID，非法上下文被替换。响应头和结构化完成日志可用 trace ID、request ID、模板路由、状态和耗时关联，且不记录 query、Cookie、令牌、CSRF、正文或身份字段。
- 新增可回滚运营告警迁移和四类固定规则：HTTP 5xx 数、HTTP P95、Outbox dead 数和未处理风险告警数。后台 worker 每 30 秒评估，持久化 open/resolved 状态，对同一规则去重活动事件，并在优雅关闭时及时退出。
- 新增运维汇总、规则列表/更新、告警分页/确认 API；读取要求 `operations.read`，写入要求独立 `operations.alerts.write`、有效会话和 CSRF。规则 revision 冲突、事件状态冲突、游标/分页和数据库不可用均返回稳定边界，规则更新与告警确认原子审计。
- 管理后台“运维监控”展示真实 API、数据库、Outbox、风险和告警状态；只读角色看到明确只读状态且无写入控件，写入角色可修改并恢复规则。320/768/1024/1440px 无水平溢出，axe 无违规，控制台无意外错误。
- 迁移、基础设施、worker、API/OpenAPI、metrics/token、trace 传播、TypeScript DTO、React 和真实 Chromium 均已覆盖；详细契约见 [运营监控与可观测性规格](specs/operations-observability.md)。

### 56. 真实业务、安全、性能与无障碍回归扩展

- 本地真实业务套件在每个桌面/移动项目中复用一次管理员和成员登录，覆盖主题发布、回复、资料入口、私信、板块作用域 RBAC 创建/分配/越权拒绝/撤销、运维只读拒写、运维写入和规则恢复，以及真实 Rust 插件安装、启用、调用、UI 沙箱、停用和卸载。
- 测试通过同源浏览器 `fetch` 验证真实 Cookie、CSRF 与 `403` 边界；所有临时角色和分配在 `finally` 清理。`DAOYUN_LOCAL_E2E=1` 固定单 worker，保持生产 10 次/15 分钟/IP 登录限流不变。
- Playwright 桌面与移动均执行公开 Feed axe/溢出/控制台、首屏性能预算、真实业务、RBAC/运维后台 axe 与多视口、真实插件生命周期与 UI 沙箱、API 安全响应头，共 12 项通过；运维与插件布局额外覆盖 320、768、1024 和 1440px。
- 当前全量门禁为 Vitest 37 个文件 231 项、Rust workspace 全部测试、Playwright 12 项；Rustfmt、Clippy `-D warnings`、TypeScript、生产构建、E2E 类型检查、OpenAPI 漂移、会员资源、完整 npm 依赖审计和 443 个 Cargo 依赖 RustSec 审计全部通过。
- 需要真实外部 IdP 或硬件凭据的 OIDC/Passkey/MFA 浏览器场景不伪造为已完成，保留为后续专用环境扩展；当前已有对应 Rust/API/组件级安全回归。

### 57. Wasmtime/WIT 插件平台闭环

- 新增独立 `plugin-host` crate，固定 Wasmtime `47.0.3` 并关闭默认 feature；宿主不链接 WASI，不向 guest 暴露网络、文件系统、环境变量、时钟或随机数，仅实现版本化 WIT world 中的声明式调用。
- 新增 Rust SDK、示例插件和 `wasm32-wasip2` 可复现构建路径；插件声明四类固定 capability，未知字段、未知 capability、超限组件和不兼容 world 在安装前被拒绝。
- 新增可回滚插件迁移、安装/启用/停用/卸载/调用 API、乐观 revision、事务内 capability 复核和最小审计；组件字节、调用载荷和敏感 guest 输出不进入响应或日志。
- 每次调用强制 fuel、内存、表、实例、输入和输出配额；停用插件稳定返回 `409 plugin.disabled`，调用失败使用稳定错误边界且不泄露 Wasmtime 内部细节。
- 管理后台支持插件包安装、生命周期操作、内容转换和声明式 UI 预览。插件 HTML 只进入空权限 `sandbox`、`no-referrer`、`default-src 'none'` 的 `srcdoc` iframe，并在宿主侧转义不受信任文本。
- 真实 Chromium 桌面/移动回归使用仓库内 Rust SDK Wasm 组件完成安装、启用、大小写转换、恶意脚本文本转义、320/768/1024/1440px 无溢出、停用拒绝、卸载和 `finally` 清理；详细边界见 [插件平台规格](specs/plugin-platform.md)。

### 58. 跨进程 OTLP trace 导出

- 固定 OpenTelemetry Rust API/OTLP `0.32.0` 与 SDK `0.32.1`，使用最小 OTLP/HTTP protobuf trace feature；未配置 `DAOYUN_OTLP_TRACES_ENDPOINT` 时不创建 exporter 或发起网络请求。
- endpoint 在启动边界校验为无凭据、query 和 fragment 的绝对 HTTP(S) URL；loopback HTTP 可用于本地 collector，远程明文 HTTP 默认拒绝，受信任内网必须显式设置 `DAOYUN_OTLP_ALLOW_HTTP=true`。
- 每个 HTTP 请求创建 `SERVER` span，合法 `traceparent` 的 trace ID、父 span ID 和 sampled flag 进入 OpenTelemetry 父上下文；响应 `traceparent` 使用实际导出的服务端 span ID。
- span 仅包含固定服务名 `daoyun-api`、模板路由、规范化方法、状态码/状态类和 request ID；原始 URL、query、Cookie、Authorization、CSRF、正文和用户身份不进入 trace。
- exporter 使用有界批处理与 5 秒导出超时，失败不改变业务响应；API 优雅关闭时在 blocking worker 中执行 5 秒有界 shutdown/flush，避免 Tokio 线程阻塞。
- 定向集成测试启动本地 OTLP HTTP collector，实际接收 protobuf 并核对上游 trace ID、父 span ID、响应服务端 span ID、模板路由与服务名；完整 observability 测试 7 项通过。
- 本轮 Rust workspace 全量测试、Rustfmt、workspace/all-targets Clippy `-D warnings` 和 RustSec 审计均通过；443 个锁定 Cargo 依赖无已知漏洞。因 C 盘不足，完整测试与 Clippy 使用 E 盘临时 target 并关闭调试符号，不改变测试行为。
- 依赖、传输、安全默认值与替代方案见 [ADR-005](decisions/adr-005-otlp-http-trace-export.md)。
- Docker CLI 当前仍不可用，因此本轮未执行 Compose 镜像构建、容器启动、健康检查或回滚演练，保持为明确后续项。

### 59. 全域业务操作审计扩展

- 新增 [全域业务操作审计规格](specs/business-audit.md)，复用受 `audit.read` capability 保护的既有运营审计日志；普通用户可以成为 actor，但不能指定 action、资源或摘要。
- 主题与回复创建、编辑、删除现在与业务状态在同一 PostgreSQL 事务写入固定审计；主题/回复幂等创建重放不重复记录，审计 INSERT 失败会回滚主题、板块计数和幂等记录。
- 用户资料 revision 更新、关注/取消关注、拉黑/取消拉黑、收藏/取消收藏、点赞/取消点赞只在实际状态变化时记录；重复边操作保持成功语义且不制造审计噪声。
- 私信会话创建、消息发送、已读游标前进和归档已纳入事务审计；并发会话创建与幂等消息重放只记录实际写入，不前进的已读游标和重复归档不重复记录。
- 单条通知已读和全部通知已读改为事务内审计；批量摘要只记录实际变更数量，重复已读不新增事件。
- 摘要采用固定白名单，只允许资源 UUID、关联资源 UUID、revision 和批量计数；主题/回复正文、标题、标签、资料字段、用户名、消息正文、通知内容、会话与凭据材料不进入审计。
- 新增内容审计、通知审计测试，并扩展资料、关系和私信既有测试；Rustfmt、Infrastructure 全目标 Clippy `-D warnings` 与完整 Infrastructure 测试集均通过。
- 附件上传新增 `attachment.create`，只记录附件/主题 UUID 和校验后的 MIME；审计失败会回滚数据库并删除已写入的原对象与缩略图。举报创建新增 `report.create`，只记录目标类型/UUID，幂等重放不重复记录且不保存原因或详情。
- 完整 Rust workspace 测试、Rustfmt、workspace/all-targets Clippy `-D warnings`、443 个 Cargo 依赖 RustSec 审计、前端 37 个文件 231 项测试、TypeScript、生产构建、OpenAPI 漂移、E2E 类型检查、会员资源和 npm 依赖审计全部通过。

### 60. 共享设计令牌包

- 新增独立 pnpm workspace 包 `@daoyun/design-tokens`，通过稳定的 `./tokens.css` 子路径导出浅色、深色、紧凑、高对比度和窄视口令牌，不引入运行时依赖。
- Web、Mobile Web/PWA 与同仓 Admin Web 的共同入口先加载共享令牌，再加载产品组件样式；`src/styles.css` 不再声明 CSS Custom Properties，避免多份令牌源漂移。
- 保留现有变量名称、值、选择器优先级和 900px 响应式覆盖；服务端品牌配置仍可通过根元素内联变量覆盖默认主色与强调色。
- 新增 3 项包契约测试，先证明缺少工作区、包和入口导入时失败，再由实现转绿；前端全量基线更新为 38 个文件 234 项通过。
- pnpm 离线安装、TypeScript、生产构建及桌面/移动 Chromium 回归通过；真实浏览器确认无控制台噪声、axe 违规、横向溢出和首屏性能回归。详细边界见 [共享设计令牌包规格](specs/design-tokens.md)。

### 61. 品牌资产与公开布局闭环

- 新增 `default_cover_url`、自定义导航、页脚文字和页脚链接字段及 `site_branding_assets` 元数据表；正反迁移和旧客户端缺省字段保留语义均有测试覆盖。
- Logo 支持 PNG/WebP（最大 2 MiB），Favicon 支持 PNG（最大 512 KiB）；服务端同时校验 MIME、图片解码与尺寸，主动拒绝 SVG/HTML、空文件、伪造内容和超限字节。
- 上传对象键由资产种类、SHA-256、UUIDv7 代际标识和固定扩展名组成，不使用客户端文件名；代际隔离避免同内容并发替换时误删当前对象，回归测试验证替换与删除都会清理对应旧对象。
- 新增同源公开读取和受 `admin.configuration.write`、会话、CSRF 保护的上传/幂等删除 API；数据库元数据、品牌 URL、隐私白名单审计与缓存失效 Outbox 在同一事务提交，存储写入失败具备补偿清理。
- Admin Web 支持文件上传/删除、外部 HTTPS 地址、默认封面、最多 8 个导航/页脚链接和页脚文字；公开 Web/PWA 在桌面与移动布局消费自定义导航、默认封面和统一页脚。
- OpenAPI 与生成的 TypeScript 类型无漂移；Vitest 38 个文件 236 项、TypeScript、生产构建、Rust workspace 全特性测试、Rustfmt、全目标/全特性 Clippy、桌面/移动 Chromium、npm 与 443 个 Cargo 依赖安全审计均通过。详细边界见 [品牌资产与公开布局扩展规格](specs/branding-assets-and-layout.md) 和 [ADR-006](decisions/adr-006-brand-assets-in-object-storage.md)。

### 62. 独立系统后台与社区管理工作台

- 原混合管理页面按职责拆为两个入口：`/#admin` 是独立系统后台，不加载社区顶栏、侧栏、页脚和 Feed 数据；`/#management` 保留社区布局，作为版主与治理运营人员的管理工作台。
- 系统后台采用独立深色顶栏、固定左导航和主工作区，保留品牌、板块、会员、角色权限、运维与插件；管理工作台只保留举报处理与风控告警。两个入口继续使用服务端 capability、会话和 CSRF，客户端入口隐藏不作为授权边界。
- 系统后台与管理工作台分别按功能组加载数据：系统入口不请求举报数据，治理入口不请求品牌与板块管理数据；账户菜单按 capability 分别显示“管理工作台”和“系统后台”。
- React 路由/组件回归覆盖独立刷新、社区壳隔离、功能集合、请求隔离和版主/系统管理员入口差异；前端全量为 38 个文件 242 项通过，TypeScript、Playwright 类型检查和生产构建通过。
- 真实浏览器已在 320、768、1024、1440px 验证：320/768 使用横向模块导航，1024/1440 使用 244px 左导航，四个尺寸均无页面级横向溢出；管理工作台保留社区框架且只有举报/风控两个标签，控制台无错误或警告。详细边界见 [系统后台与管理工作台拆分规格](specs/system-admin-and-management-workspace.md)。

### 63. 站点后台用户治理闭环

- 新增管理员用户搜索、详情、内容和举报上下文 API，并以独立 `admin.users.read` 能力保护；响应仅包含公开资料、角色、治理状态、统计和 revision，不暴露邮箱、凭据、会话或外部身份。
- 新增 `admin.users.moderate`、账号 revision、限制原因和到期时间；限制、暂停与恢复在事务内重新授权、锁定目标、保护操作者自己和最后一名活跃超级管理员，并原子写入审计与 `user.status_changed` Outbox。
- `restricted` 用户仍可登录、阅读并保留原有 capability，但主题、回复、私信和附件上传在业务事务内拒绝；`suspended` 用户的会话和所有 capability 立即失效。
- 新增每 30 秒运行的到期恢复任务，使用有界批次和 `FOR UPDATE SKIP LOCKED` 恢复临时限制，递增 revision 并原子写入审计与 Outbox；正反迁移、重复扫描和优雅关闭均有 PostgreSQL 测试。
- 用户详情支持权限控制的状态操作区、影响预览、期限、原因、确认、操作者、操作时间和审计编号；角色调整复用当前用户上下文，不再重复输入用户名，只读管理员看不到写入口。
- 真实浏览器已验证桌面、平板和 320px 手机布局无页面级横向溢出、控制台无错误；前端 40 个文件 258 项、Rust workspace、Rustfmt、Clippy `-D warnings`、OpenAPI 漂移、TypeScript 和生产构建全部通过。

### 64. 站点后台版块树管理闭环

- 现有平面版块可逆迁移为顶级版块，管理契约新增 `parent_id` 与正整数 revision；服务端限制三级深度，并拒绝自身、后代、无效父级和循环层级。
- 新建、移动、排序、可见性和编辑采用单动作保存与 expected revision；同级规范化排序会同步更新受影响版块的 revision，前端在每次写入后重新读取完整树，避免旧顺序覆盖新状态。
- 系统后台以可访问树展示展开、收起、搜索、新增、改名、上下排序、移入、移出和可见性操作；搜索筛选时锁定层级移动，避免按不完整同级集合执行误操作。
- 删除前返回子版块、主题和回复计数；有子版块或主题时以稳定冲突阻断，首版不自动迁移、合并或级联删除内容，所有成功写入继续记录最小审计。
- 真实浏览器完成新增子版块、改名、排序、移入移出和安全删除拒绝，并验证 320、768、1024、1440px 无页面级横向溢出、控制台无错误；前端 41 个文件 266 项、相关 Rust 契约/迁移/API、Rustfmt、Clippy、OpenAPI 漂移、TypeScript 和生产构建全部通过。

### 65. 站点后台举报治理闭环

- 举报列表和详情新增 revision、内容上下文、作者状态、关联举报和处理历史；上下文使用固定数量与长度上限，读取能力、运行时响应和 OpenAPI 契约保持一致。
- 新增一体化举报处置：举报结论、内容隐藏、作者限制或暂停、审计和通知在同一事务中提交；驳回禁止携带副作用，过期 revision、目标状态变化和越权均返回稳定错误。
- 管理工作台支持服务端状态筛选、游标分页、桌面队列加详情双栏和移动端单栏；组合处置在确认前展示影响，完成后逐项展示内容、账号与通知结果。
- 详情切换会隔离每条举报的处置草稿，并忽略较慢的旧详情响应，避免把上一条举报的选择或数据带入当前处置。
- 真实 Chromium 已完成“打开举报 → 查看上下文 → 隐藏内容并限制作者 → 查看结果”，随后恢复本地测试账号；验证同时发现并修复用户详情相关举报查询漏取 revision 的跨模块回归。
- 举报相关 Rust、OpenAPI、前端测试、Rustfmt、Clippy、TypeScript 和生产构建全部通过，浏览器控制台无业务错误或警告。

### 66. 站点后台工作台、资源审计与最终收尾

- 管理审计查询新增 `resource_id`、`user_id` 和 `report_id` 参数化过滤，并将完整过滤条件绑定到游标验证；举报关联同时覆盖举报资源本身及白名单摘要中的关联举报，必要 JSONB 表达式索引提供可回滚迁移。
- `GET /api/v1/admin/audit` 与审计告警接口在查询校验前执行 `audit.read` 服务端授权；OpenAPI 覆盖过滤参数以及业务响应的 `x-request-id`。用户详情和举报详情只向拥有该能力的账号展示相关操作记录。
- 相关记录仅展示操作者、动作、对象、时间和审计 ID，前端不渲染内部审计摘要；游标续页在资源切换后会丢弃旧响应，避免跨用户或跨举报混入记录。
- 新增站长工作台，根据当前账号读取能力分别加载待处理举报、受限/暂停用户和隐藏版块；每类最多五条，提供业务筛选入口、明确空态、分区错误态与重试，完全无后台业务能力的账号不会获得客户端入口。
- 收尾审查修复用户列表漏用游标、举报详情深链只查首屏，以及举报/审计续页切换筛选时的竞态；后台外壳语义与顶栏文字对比度也经真实浏览器检查修正。
- 最终门禁通过：Vitest 44 个文件 286 项、Rust workspace 全部测试、Rustfmt、Clippy `-D warnings`、OpenAPI 生成漂移、TypeScript、生产构建、E2E 类型检查，以及桌面/移动真实 Chromium 12 项；320、768、1024、1440px 无页面级横向溢出，axe 无严重或关键问题。
