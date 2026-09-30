# DaoYun UI V2：公共壳与首页首批实现

日期：2026-09-30。执行状态：IN_PROGRESS。完整 24 项计划及 G0–G5 总验收尚未完成。

## 工作边界与执行授权

项目路径为 C:/Users/111/Documents/Playground/daoyun，Git 根为其父目录 C:/Users/111/Documents/Playground，分支为 codex/daoyun-home-foundation。改造基线为已推送的备份提交 e3a4db170f2a30d3e49161d58e59b260d8cce7d9。

原方案要求 FastSpider_FS，A1 节点离线；用户已明确回复“使用当前本地工具继续（推荐）”。本批使用当前任务的本地工具。Windows exec_command 的 CET 错误通过 Node REPL 的文件/子进程接口绕过，没有修改系统安全配置。

daoyun-ui-v2-plan 是本次接收的原始方案快照。9 个文档/注册表的 SHA256SUMS 已逐项验证，其 PLANNED 状态和执行器限制描述保留为原始交付记录。方案目录补充 .gitattributes 固定文档为 LF，以便 Windows 干净检出后仍能验证原校验和。当前执行进度以本目录 execution-state.json 为准；它记录用户批准的执行器例外，不把原始计划或参考图当成已经实现的结果。

本批完成公共壳、首页单列和共享 Feed 卡片的可审查增量。DYV2-001–007 各有部分实现/证据，均保持 IN_PROGRESS；没有提前宣布任务或 Gate 全部完成。

源码提交：f9e1e16348bed285304f46917c856870915e96c1。最终结果：797 项前端测试、40 项浏览器测试、450 项 Rust 测试通过；Rust 另 2 项依赖官方成长 WASM 构建的测试保持 ignored。类型检查、E2E 类型检查、生产构建、Rust 格式和 lint 退出码均为 0。

## 已实现行为

- 公共顶栏保留品牌、搜索、发布、通知、账号与主题切换；主导航集中到左栏的首页/社区/收藏，关注保留在首页 Tab，发现/排行榜保留次级入口。
- 小屏使用原有五项底栏，并补充可键盘关闭的导航弹窗，使收藏和品牌配置导航仍可达。768–1023px 的窄侧栏保留有名称和提示的导航图标。
- 首页移除宣传展示块和旧网格规则；Feed 连续单列，主列不超过 800px，公共壳上限 1328px，左右栏为 176px/280px，间距 24px。
- 共享 Feed 的 DOM 顺序为作者及公开身份、版块/时间、可选标题/摘要、真实图片、点赞/回复/收藏。纯文字不补图片；无标题正文可以进入详情；纯图片不制造标题。
- 只显示服务端提供的前三张公开预览。单图最大 240px，双图和三图按实际数量排列为方形预览。图片按钮打开现有查看器，Esc 关闭后返回触发按钮；查看器作为 article 的兄弟节点，避免 portal 事件触发整卡导航。
- Feed 隐藏缺乏完整计量证据的浏览数，只展示一个公开身份标签，缺少公开组时回退成长等级。详情/公开资料的其他身份展示未改成 Feed 规则。
- 样式使用既有语义颜色、密度 token 和 Lucide；品牌主色仍来自配置，brand-strong 随正文颜色适应浅色/深色。
- 版块列表的两个同名“主题”区域造成 axe 失败，已移除外层多余 landmark。其余版块/详情/个人页 V2 重构属于后续任务。

## 源码和路由映射

| 范围 | 当前入口或所有者 | 路由/接口 |
|---|---|---|
| 应用入口 | src/app/AppRoot.tsx；src/router/communityRoute.ts | Hash Router 将 admin 分给 AdminApp，其余进入 CommunityApp |
| 公共壳 | src/app/CommunityShell.tsx；src/components/SiteHeader.tsx、LeftSidebar.tsx、MobileNavigation.tsx | #hot、#boards、#bookmarks、#notifications、#messages |
| 首页状态 | src/app/CommunityApp.tsx；src/components/FeedTabs.tsx、TopicFeed.tsx | #hot 推荐、#following 关注、#feed 最新 |
| 帖子展示 | src/components/TopicRow.tsx；src/utils/topicPresentation.ts | #topic/{id}；#topic/{id}?reply={reply_id} |
| 版块 | src/features/boards；src/api/boards.ts | #boards、#board/{slug}；原 #board-{slug} 规范化规则保留 |
| 用户与本人能力 | src/components/UserProfileView.tsx；src/api/users.ts、membership.ts | #user/{username}、#member、#member/points 等 |
| 搜索/收藏 | src/features/search；src/components/BookmarksView.tsx | #search?q=...&type=...；#bookmarks |
| 后台 | src/app/AdminApp.tsx；src/router/communityRoute.ts | #admin/{tab}?{query} |
| 样式所有权 | src/main.tsx 顺序：styles.css → styles.community.css → styles.admin.css → styles.home.css → styles.boards.css | 本批公共壳和 Feed 收口到 styles.home.css；版块专属覆盖仍由 styles.boards.css 管理 |

源码映射指向当前仓库文件；具体路径存在性与被测文件 SHA256 由 verification.json 核对。旧历史交接 docs/handoff-phase10-2026-09-03.md 保留。

## 字段与能力边界

| 能力 | 证据/当前处理 | 尚未完成的部分 |
|---|---|---|
| 可选标题 | crates/api-contract/src/topic.rs 的 CreateTopicRequest/UpdateTopicRequest 为 Option<String>；src/api/topics.ts:357 仅发送非空创建标题 | 本批不改变持久化模型 |
| 授权图片 | apps/api/src/topics.rs:1803–1811 的 topic_summary 取前三张；crates/infrastructure/src/topics.rs:2607–2624 同时检查 topic/attachment 权限、ready/clean/未删除 | TopicSummary 没有可见图片总数；不能据前三张长度推断“+N”或构造其余六张 |
| 回复可见内容 | apps/api/src/topics.rs:1762–1773、1905–1929、1934–1958 脱敏正文/引用；crates/infrastructure/src/topics.rs:2643–2653 图片遍历跳过 replyGate | 真实受限角色媒体验收仍需专门场景；本批没有扩展附件权限 |
| 推荐/关注/最新 | src/api/feed.ts:15 的 listFeed 请求 /api/v1/feed?mode=...；apps/api/src/feed.rs:55–57 映射 Recommended→Popular，Following→Following/Latest，Latest→Latest | 沿用原排序和认证语义，不修改推荐权重 |
| 浏览数 | DTO/数据库已有字段，但本批源码核查没有证实完整访问计量链路 | Feed 移除显示；版块/详情/侧栏旧显示需要 DYV2-009/011 后续清理和契约核对 |
| 版块层级 | crates/api-contract/src/board.rs 有 parent_id、depth、child_count、children、breadcrumb 和 viewer 权限 | 未发现真实版块关注契约，不新增“加入圈子”或成员数 |
| 公开身份 | apps/api/src/users.rs:529–583 的公开摘要只含等级/勋章/显式公开组；当前实现 public_groups 为空 | 不把私有社区组显示成公开身份 |
| 本人账户 | apps/api/src/users.rs:243–268 的 /api/v1/users/me/membership 与公开用户资料分离 | 积分、EXP、权益和兑换属于本人会员中心后续任务 |
| 插件 | plugins/official-growth-rewards、official-topic-supplements、official-topic-edit-review、official-points-redemption、official-community-analytics、official-polls 源码存在 | 源码存在不等于当前数据库已安装、启用且调用者有权限；六插件逐项真实运行状态未全部验收 |
| 本地插件宿主 | scripts/start-local-api.mjs:46–53 默认 DAOYUN_PLUGINS_ENABLED=true；apps/api/src/plugins.rs 仍经 capability read/write 与 CSRF 检查 | 本批没有改变插件宿主、RBAC、CSRF、审计或 revision 约束 |

## 验证和证据

最终命令、退出码、运行时间、测试源码指纹、测试数与日志 SHA256 见 verification.json。日志存于 artifacts/ui-v2/2026-09-30，浏览器截图与附件存于 test-results。构建产物、运行日志和这些本地产物不混入源码提交。

运行环境为 Node v24.18.0、pnpm 9.12.3、Rust 1.94.1 GNU、PostgreSQL 16。本地入口 http://127.0.0.1:5173/#hot，API http://127.0.0.1:3000，PostgreSQL 127.0.0.1:55433。本次复用现有开发库，没有清空数据或执行 seed:local。Rust 的 SQLx 测试使用自动隔离的测试数据库。

测试分开记录：
- ui-v2-home.spec.ts 和 community-responsive.spec.ts 使用显式 API/CDN 夹具，覆盖布局、主题对比、键盘、小屏导航、媒体查看器和公共旅程。夹具补充了真实契约允许的空投票 null、空 supplements 和空 plugin UI。
- ui-v2-live-home.spec.ts 无 API 拦截，匿名只读请求真实 ready/feed，验证响应 envelope/header 的 request_id 一致、真实列表数量/首条 ID、五宽度单列、无横向溢出。当前实际返回 20 条主题。
- 首页面监听 pageerror、console error/warning、HTTP 错误、请求失败与未处理 Promise；HTTP 401 和导航取消的 ERR_ABORTED 豁免；401 用于匿名会话预期状态，此豁免也不构成其他接口权限验证。
- axe 对首页预设/深色以及公共旅程 390/1440px 页面执行；没有宣称所有页面、所有断点和所有角色均通过无障碍验收。

本批先捕获新的行为失败，再实现。组件新增断言覆盖无标题、读取顺序、动作顺序、图片弹窗/回焦、公开身份及小屏菜单。截图额外发现桌面导航横向挤压和 320px 登录文字换行，各自补充真实布局失败断言后修复。

一次高并发全量前端运行有“完整主题正文”异步查询超时。先前全量运行通过；当前不通过放宽断言掩盖超时，按现有 CI 的单 worker 配置复验，最终结果单独保存。默认 MSVC 缺 link.exe；第一次 GNU Rust 测试缺 DATABASE_URL，补齐现有本地测试配置后复验。这些失败也作为环境/执行记录保留。

本批构建记录：index JS 408.64→420.62kB，gzip 110.89→114.21kB；CSS 467.21→468.41kB，gzip 67.31→67.50kB。左值为本批较早的一次本地构建日志，不是重新检出备份 commit 的独立基准，因此不能据此宣布 Q-08 或全计划性能 Gate 通过。

## 尚未完成与下一批入口

1. DYV2-001/002：补齐改前关键页面、六插件实际安装/启用/权限状态、全部角色/受限内容场景；G0 还没有完整签收。
2. DYV2-006：为“4–9 图 +N”设计经过授权过滤的可见图片总数契约及测试，再实现数量和完整媒体浏览；不得推断隐藏媒体数量。
3. DYV2-007：补齐首页三流真实切换、分页失败/竞态/空关注/右栏故障专门 E2E，保留现有排序权重。
4. DYV2-008/009 及后续：继续版块目录/详情、发布器、帖子详情、评论、公开资料、本人会员中心、后台与最终回退演练。混合的 768px 内页断点、旧浏览数显示和异常内容退化尚未完成统一核对。
5. Q-08 线上 p75 没有有效样本；IdP、SMTP、私有媒体、完整插件业务组件和生产部署等未配置或未实际运行的项目不得填 PASS。

回退本批 UI 时使用源代码提交的反向提交并重新构建；不要回滚帖子、会员积分或现有开发库数据。本批没有生产部署。
