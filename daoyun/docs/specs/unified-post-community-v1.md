# DaoYun 统一 Post 社区产品化实施计划

> 目标：在保留现有 React 19 + TypeScript + Vite、Rust/Axum、PostgreSQL、Cookie 会话、CSRF、RBAC、审计、幂等、revision、附件扫描/权限与 Wasmtime 插件边界的前提下，把当前 Topic 内核兼容演进为统一 Post 产品语义。
>
> 产品公式：小红书式发现 + 葫芦侠式社区 + 闲鱼式真实感 + 论坛式讨论。

## 当前基线 — 2026-08-29

已确认：

- 旧 `current-web-optimization-plan.md` 的 11 / 11 项已全部完成，本计划独立承接后续产品化工作。
- 富文本编辑器已经使用结构化 JSON，支持段落、标题、图片、引用、代码、链接、列表以及 `replyGate`；正文图片通过附件 ID 引用。
- 已完成“正文第一张公开图片自动成为列表卡片封面”：隐藏回复区图片会跳过，并重新校验附件归属、MIME、扫描状态和访问权限。
- 首页已经能按是否有 `image_url` 在媒体卡片与文字讨论卡片之间切换，320 / 768 / 1024 / 1440 已做过一轮真实浏览器验证。
- 当前发布器仍存在核心差距：标题强制 1–160 字、默认聚焦标题、没有统一草稿恢复；发布成功当前只刷新列表，不自动进入详情。
- 后端/数据库成熟内核仍使用 `topics` 领域命名，已经承载版块权限、用户限制、配额、幂等、审计、附件归属、治理、回复和 revision。首版不做破坏式全量重命名。

## 兼容演进原则

1. 产品层与新公共契约统一使用 Post 语义；旧 `topics` 内核作为兼容实现细节逐步收敛。
2. 不为了命名一致性复制第二套持久化模型，不新建平行的 Post/Topic 两套业务数据。
3. 先通过兼容 DTO、路由别名和前端领域 facade 推进，再在具备迁移收益时决定是否重命名数据库表。
4. 新能力必须复用既有权限、CSRF、幂等、revision、审计和附件安全校验，不允许从新 `/posts` 路径绕过旧边界。
5. 内容形态由数据派生，不新增 `post_type` 让用户预选类型。

## 目标模型

```ts
Post {
  id: PostId
  authorId: UserId
  communityId: CommunityId
  title: string | null
  blocks: ContentBlock[]
  tags: Tag[]
  capabilities: {
    allowReplies: boolean
    allowAnswerAcceptance: boolean
  }
  metrics: {
    reactions: number
    comments: number
    bookmarks: number
    views: number
  }
  createdAt: ISODateTime
  updatedAt: ISODateTime
}
```

首期 `blocks` 由现有富文本结构安全映射，优先覆盖 paragraph / heading / image / link / quote / code；video / poll 在对应编辑器能力落地时加入。`replyGate` 继续作为现有兼容能力存在，但不会参与公开封面或公开摘要派生。

### 派生展示

- `mediaCard`：存在公开图片或视频。
- `articleCard`：存在标题且正文达到长内容阈值。
- `linkCard`：存在链接预览且正文较短。
- `discussionCard`：文字为主且没有主要媒体。
- `questionState`：`allowAnswerAcceptance = true`，它是能力，不是内容类型。

## 阶段状态

| 顺序 | 任务编号 | 范围 | 状态 |
|---:|---|---|---|
| 1 | `DY-POST-FOUNDATION-001` | 统一 Post 公共契约与 Topic 兼容层 | 🚧 进行中（65%） |
| 2 | `DY-EDITOR-UNIFIED-001` | 正文优先、可选标题、媒体、链接、草稿、问答能力 | 🚧 进行中（80%） |
| 3 | `DY-FEED-ADAPTIVE-001` | 推荐/关注/最新与自适应媒体/讨论卡片 | 🚧 进行中（85%） |
| 4 | `DY-POST-DISCUSSION-001` | 详情、评论、引用、互动、两级讨论 | 🚧 进行中（80%） |
| 5 | `DY-COMMUNITY-PROFILE-001` | 社区列表/详情、个人主页、关注关系 | 🚧 进行中（65%） |
| 6 | `DY-NOTIFY-SEARCH-GOV-001` | 聚合通知、搜索、举报、审核、屏蔽 | 🚧 进行中（75%） |
| 7 | `DY-RESPONSIVE-ACCEPTANCE-001` | 320/375/768/1024/1440、可访问性、性能 | ✅ 已完成 |

## 第一实施切片

### DY-POST-FOUNDATION-001

目标：不改数据库表名，先让新发布语义允许“无标题 Post”，为统一编辑器和后续 `/posts` 兼容契约铺路。

- `CreateTopicRequest.title` 兼容改为可选；缺省或空白标题在成熟 Topic 内核中暂存为空字符串。
- 正文仍必须存在，富文本仍由服务端 `validate_and_project` 做安全投影。
- 旧 `/api/v1/topics` 保持可用，后续增加 `/api/v1/posts` 路由别名时复用同一 handler / transaction，不复制业务逻辑。
- 前端领域模型逐步允许标题为空，卡片和无障碍文案使用正文摘要作为回退标题。

### DY-EDITOR-UNIFIED-001（首批）

- 打开编辑器默认聚焦正文。
- 标题改成可选，并降低视觉优先级。
- 正文、标题、版块、标签任一变化写入本地草稿；再次打开自动恢复。
- 仅存在未保存草稿时关闭确认。
- 发布成功清除草稿并直接进入详情页。
- 继续复用现有附件上传、扫描、归属校验与 CSRF/幂等。

## 2026-08-29 第一实施切片完成记录

已完成：

- 创建契约允许省略标题；旧有标题客户端继续兼容，缺省标题仍进入同一个 Topic 事务和权限/配额/幂等/审计/附件校验链路。
- 编辑已有内容时允许清空标题，保持“标题可选”语义前后一致。
- 发布器改为正文优先：打开后自动聚焦正文，标题改成按需“添加标题”。
- 增加用户/入口隔离的本地草稿自动保存与恢复；富文本恢复前重新走前端 sanitize。
- 关闭时仅对尚未落盘的有效编辑内容确认；发布成功清除草稿。
- 发布成功后直接导航至新内容详情页，并用 App 回归锁定该行为。
- 首页、版块列表、搜索、右侧热门与详情页均支持无标题内容：使用正文摘要作展示标题回退，避免空标题或重复摘要。
- 继续复用既有“正文第一张公开图片自动封面”派生逻辑；隐藏回复区及附件安全校验未被改动。

当前仍未完成：

- `/api/v1/posts` 路由别名与统一 Post facade；当前对外主要仍是 `/api/v1/topics`。
- 服务端草稿同步；本轮只有本地草稿。
- URL 自动链接预览、视频、投票、“允许采纳回答”能力开关。
- 推荐流算法/多样性约束的完整 Post 语义，以及媒体/长文/链接卡片的全部派生规则。
- 后续社区、用户关系、通知聚合、搜索与治理的产品规格收敛。

### 本轮门禁证据

- `pnpm test`：73 个测试文件、498 / 498 通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，TypeScript project build 与 Vite production build 均成功。
- `cargo fmt --all -- --check`：通过。
- `cargo test -p api-contract --test response_contracts create_topic_request_deserializes_with_optional_title_and_board -- --exact`：1 / 1 通过。
- `cargo test -p daoyun-api --test topics openapi_documents_public_topic_list_and_detail -- --exact`：1 / 1 通过；OpenAPI 明确要求 `content`，不再要求 `title`。
- `pnpm generate:api --check`：环境阻塞。生成脚本需要从运行中的本地 API 拉取 `/api/v1/openapi.json`，但本机 API 启动时 PostgreSQL 连接池超时（`Sqlx(PoolTimedOut)`），因此没有手工修改 `generated.d.ts` 冒充生成通过；前端暂用兼容 DTO 覆盖可选 title，待数据库恢复后必须重新执行在线生成检查。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`：执行中，结果见本文后续更新。

## 2026-08-30 前台响应式产品化完成记录

已完成：

- 桌面 1440px 三栏、1024px 左侧导航、768px 以下移动导航与 320/375px 双列媒体流已形成同一套响应式布局；右栏按可用空间自动隐藏。
- 首页只保留“推荐 / 关注 / 最新”三个产品 Tab；旧活跃/精华 hash 路由仍可解析，但不再污染首页主导航。
- `TopicRow` 仅依据 Post 自身 `image_url` 派生媒体卡或讨论卡；站点默认封面不再把纯文字讨论伪装成媒体内容。社区详情 Feed 复用同一内容卡，不建立平行展示模型。
- Feed 返回时按分类恢复滚动位置；后台刷新保留当前内容与位置，新内容使用真实 ID 差集显示“有 N 条新内容”，由用户主动展开。
- 社区目录改为产品语义“社区 / 全部社区”；社区详情继续复用现有 Board DTO、权限能力和 Topic Feed。
- 统一发布器、内容详情、评论、个人主页沿用现有真实 API；详情补齐分享反馈，通知补齐“全部 / 未读”，搜索补齐“全部 / 内容 / 社区 / 用户 / 标签”。
- 通知与搜索 Tab 补齐 `tabpanel` 关联、键盘方向键/Home/End 操作；详情分享、Feed 互动和新内容刷新均有成功或失败反馈。
- Playwright 集中 Mock 只存在于 `e2e/fixtures.ts`，组件与运行时代码未硬编码演示数据。

仍未完成：

- URL 自动链接预览、视频、投票以及“允许采纳回答”能力仍缺少对应公共契约与编辑器能力。
- 社区加入/退出、社区通知、公告、规则和管理成员仍缺少公开 Community API；当前继续使用只读 Board 能力，不伪造运行时状态。
- 独立 `ArticlePostCard` / `LinkPostCard` 的完整派生规则尚未落地；当前已完成媒体与讨论两种可靠派生。
- 通知服务端聚合、个人主页回复/收藏完整分页与真实推荐算法仍需后续 API 支持。
- 品牌“默认主题封面”需要重新定义不干扰内容形态的使用场景；当前不会用于无媒体 Post 的列表卡片。

本轮门禁证据：

- `pnpm test`：75 个测试文件、507 / 507 通过。
- `pnpm typecheck`、`pnpm test:e2e:typecheck`、`pnpm build`：通过；项目未配置独立 frontend lint 脚本。
- `pnpm test:e2e`：14 项通过、2 项真实 API 安全头检查按本地无 API 配置跳过；320/375/768/1024/1440 均走通首页、发布器、社区目录、社区详情、内容详情与个人主页，无横向溢出。
- `cargo clippy --workspace --all-targets -- -D warnings`：通过。
- `cargo fmt --all -- --check`：被本轮开始前已存在的 `apps/api/tests/topics.rs` 与 `crates/api-contract/src/lib.rs` 格式差异阻塞；本轮未修改后端文件，未替用户格式化无关改动。
- `CARGO_BUILD_JOBS=1 cargo test --workspace`：契约 41 / 41、`daoyun-api` lib 48 / 51 通过；3 个 worker 数据库测试因未设置 `DATABASE_URL` 失败，其余 workspace 测试因此未继续执行。

## 后续 API 目标

```text
GET    /api/v1/feed?mode=recommended|following|latest
POST   /api/v1/posts
GET    /api/v1/posts/{post_id}
PATCH  /api/v1/posts/{post_id}
DELETE /api/v1/posts/{post_id}
POST   /api/v1/posts/{post_id}/comments
PUT    /api/v1/posts/{post_id}/reaction
PUT    /api/v1/posts/{post_id}/bookmark
GET    /api/v1/communities
GET    /api/v1/communities/{community_id}/posts
PUT    /api/v1/communities/{community_id}/membership
GET    /api/v1/notifications
GET    /api/v1/search
```

旧 topic/reply 路径在迁移期继续存在；新路由只允许作为同一领域服务的兼容入口，不允许出现两套权限或两份数据。

## MVP 验收

- [ ] 用户无需选择内容类型即可发布纯文字、图文、长文或链接。
- [ ] 标题可选，正文必填；无标题内容在列表/详情可正常阅读和操作。
- [ ] 同一 Post 在推荐、社区、详情页可使用不同派生展示，但共享同一数据模型。
- [x] 推荐、关注、最新三个内容流行为可测试。
- [ ] 加入社区、评论、引用、点赞、收藏和关注可用。
- [x] 移动端发布与回复支持单手操作。
- [x] 返回列表恢复阅读位置。
- [x] 异步互动包含 loading / success / failure / rollback。
- [ ] `pnpm test`、`pnpm typecheck`、`pnpm build`、Rust fmt/clippy 与可执行的后端门禁通过。
- [x] 320 / 375 / 768 / 1024 / 1440 浏览器验收通过，Mock 公共 API 场景控制台无错误。

## 明确不做（MVP）

直播、即时聊天室、复杂私信、付费内容、商城、多层级积分经济、高度个性化机器学习推荐。
