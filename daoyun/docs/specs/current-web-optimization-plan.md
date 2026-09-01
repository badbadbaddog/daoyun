# DaoYun 当前 Web 优化实施记录

> 对应任务源：`daoyun-current-stack-optimization-plan.md`
> 当前技术栈：React 19 + TypeScript + Vite + Rust/Axum + PostgreSQL + Wasmtime
> 原则：不迁移 Nuxt / Next.js，不重写 Rust 后端，不拆微服务；保持 Cookie 会话、CSRF、RBAC、审计、幂等、revision 与插件安全边界。

## 执行顺序

1. DY-BASELINE-001
2. DY-WEB-ROUTING-001
3. DY-BOARD-PUBLIC-001
4. DY-DISCOVERY-001
5. DY-MEMBER-CENTER-001
6. DY-ADMIN-MEMBER-001
7. DY-ADMIN-MEMBER-002
8. DY-ADMIN-BOARD-001
9. DY-ADMIN-BOARD-002
10. DY-PLUGIN-ADMIN-001
11. DY-WEB-POLISH-001

## 当前总任务状态 — 2026-08-28

当前完成 **11 / 11** 个任务，剩余 **0 / 11** 个任务。

| 顺序 | 任务编号 | 阶段 | 状态 | 当前说明 |
|---:|---|---|---|---|
| 1 | `DY-BASELINE-001` | 固定基线 | ✅ 已完成 | 基线结果、工作区事实和环境异常已记录 |
| 2 | `DY-WEB-ROUTING-001` | 路由整理与 `App.tsx` 拆分 | ✅ 已完成 | 统一 `CommunityRoute`，页面状态改为 Hash 路由单一来源 |
| 3 | `DY-BOARD-PUBLIC-001` | 真实版块体系 | ✅ 已完成 | 公开版块详情 API、层级、权限、版块页与分页已落地 |
| 4 | `DY-DISCOVERY-001` | 搜索、Feed 分页和状态保持 | ✅ 已完成 | URL 搜索、主题/版块/用户搜索、cursor Feed 已落地 |
| 5 | `DY-MEMBER-CENTER-001` | 用户侧会员中心 V2 | ✅ 已完成 | Growth / EXP / Points / Group / Entitlement / Medal 分离展示已落地 |
| 6 | `DY-ADMIN-MEMBER-001` | 会员后台操作体验 | ✅ 已完成 | 用户选择器、积分操作流、原因映射、幂等与 revision 提示已落地 |
| 7 | `DY-ADMIN-MEMBER-002` | 用户组与标准权益 | ✅ 已完成 | 用户组完整配置、归档保护与标准权益版本/发放/撤销已落地 |
| 8 | `DY-ADMIN-BOARD-001` | 版块后台交互优化 | ✅ 已完成 | 紧凑树行、键盘菜单、分区设置抽屉、精确反馈与 revision 恢复已落地 |
| 9 | `DY-ADMIN-BOARD-002` | 访问策略与版块合并 | ✅ 已完成 | 访问策略编辑、合并影响预览、原子迁移、审计/Outbox 与 24 小时回滚已接通 |
| 10 | `DY-PLUGIN-ADMIN-001` | 插件管理产品化 | ✅ 已完成 | 四步安装向导、manifest/wasm 预检、风险分级、运行状态与开发者工具分离已落地 |
| 11 | `DY-WEB-POLISH-001` | 全局交互、样式与完整回归 | ✅ 已完成 | 页面级拆包、共享交互收口、前后端门禁与真实桌面/手机业务 E2E 已通过 |

### 已完成项

- [x] `DY-BASELINE-001`
- [x] `DY-WEB-ROUTING-001`
- [x] `DY-BOARD-PUBLIC-001`
- [x] `DY-DISCOVERY-001`
- [x] `DY-MEMBER-CENTER-001`
- [x] `DY-ADMIN-MEMBER-001`

### 未完成项

- [x] `DY-ADMIN-MEMBER-002`
- [x] `DY-ADMIN-BOARD-001`
- [x] `DY-ADMIN-BOARD-002`
- [x] `DY-PLUGIN-ADMIN-001`
- [x] `DY-WEB-POLISH-001`

### 当前已知环境 / 基线异常

这些不是当前业务阶段的“未完成任务”，但最终交付前仍需保留跟踪：

- `pnpm generate:api --check`：基线环境中拉取 OpenAPI schema 时出现 `fetch failed`；当前未手工修改 `src/api/generated.d.ts`。
- `cargo test --workspace`：Windows MSVC 链接阶段出现 `LNK1102: out of memory`；属于本机链接资源问题，不是测试断言失败。
- 部分 Rust 数据库 integration：本机未设置 `DATABASE_URL`，且本地测试 PostgreSQL 未监听时会被环境阻断。
- Vite 主 JS chunk >500 kB 的基线问题已在 `DY-WEB-POLISH-001` 处理中解决：从 1,190.19 kB 降至 370.39 kB，当前构建已无 >500 kB chunk 告警。

### 下一执行项

当前规划内 11 个任务已全部完成；后续工作应作为新的独立任务定义范围与验收标准。

## DY-BASELINE-001 — 2026-08-27

### Git / 工作区事实

- DaoYun 项目目录：`C:\Users\111\Documents\Playground\daoyun`。
- Git 根目录实际位于 `C:\Users\111\Documents\Playground`。
- 开始实施前，父仓库已经存在 DaoYun 相关删除项和大量未跟踪文件。
- 本次实施不执行 `reset`、`checkout`、`clean`，不覆盖或清理既有工作区状态。

### 基线门禁

| 命令 | 结果 | 备注 |
|---|---|---|
| `pnpm test` | PASS | 56 个测试文件，404 个测试通过 |
| `pnpm typecheck` | PASS | TypeScript build mode 无错误 |
| `pnpm build` | PASS | Vite 构建成功；主 JS chunk 约 1.11 MB，存在既有 >500 kB 告警 |
| `pnpm generate:api --check` | BASELINE FAIL | OpenAPI 类型生成脚本拉取 schema 时 `fetch failed` |
| `cargo fmt --all -- --check` | PASS | 无格式差异 |
| `cargo test --workspace` | BASELINE FAIL | Windows MSVC `link.exe` 链接阶段 LNK1102: out of memory；不是测试断言失败 |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS | clippy 完成且退出码 0 |

### 当前页面基线描述

- 首页桌面：`SiteHeader + LeftSidebar + Feed + RightSidebar + SiteFooter` 的社区壳层；Hash 控制 Feed/主题/用户等入口。
- 首页手机：复用社区数据与主内容，额外提供 `MobileNavigation`；响应式样式保持现状。
- 用户资料：`#user/{username}` 进入 `UserProfileView`，支持主题跳转、收藏与私信入口。
- 会员后台：统一站点管理入口内已有会员相关管理能力；本阶段不修改业务模型或 API。
- 版块后台：统一站点管理入口内已有版块治理/配置能力；本阶段不修改版块 API。
- 插件后台：统一站点管理入口内已有插件管理能力；Wasmtime/WIT/capability 安全边界保持不变。

## DY-WEB-ROUTING-001

### 范围

- 统一 `CommunityRoute`。
- Hash 路由成为页面状态唯一来源。
- 兼容 `#top`、`#discover`、`#board-{slug}` 与现有 topic/user/messages/notifications/bookmarks/admin 地址。
- 拆分 `App.tsx`、`AppRoot`、`CommunityApp`、`CommunityShell`、`AdminApp`。
- 不实现真实版块详情页、搜索结果页、会员中心。
- 不修改 API、数据库、OpenAPI 与视觉风格。

### 验收门禁

完成本阶段后必须重新执行：

```powershell
pnpm test
pnpm typecheck
pnpm build
```

并记录路由兼容、测试结果与下一阶段遗留事项。

### 实施结果 — 2026-08-27

已完成：

- `src/App.tsx` 只保留安装状态检查与 `AppRoot` 分流，当前 91 行。
- 新增 `src/app/AppRoot.tsx`、`CommunityApp.tsx`、`CommunityShell.tsx`、`AdminApp.tsx`。
- 新增 `src/router/communityRoute.ts`、`hashRouter.ts`、`useHashRoute.ts`。
- 页面选择由 `CommunityRoute` 唯一驱动，不再维护 `selectedTopicId`、`selectedUsername`、`bookmarksOpen`、`messagesOpen`、`notificationsOpen`、`oidcClaimOpen` 等重复页面 state。
- 旧地址 `#top`、`#discover`、`#board-{slug}` 可解析并规范化；topic/user/messages/notifications/bookmarks/admin/OIDC 地址保持可用。
- 增加路由解析、非法 UUID/username/slug、旧地址兼容、hashchange 与直接 Hash 进入主题详情测试。

路由结构：

```text
#feed / #active / #hot / #featured / #following
#boards
#board/{slug}
#search?q=&type=
#topic/{uuid}
#user/{username}
#bookmarks
#messages[/uuid]
#notifications
#admin[/tab][?query]
#oidc-claim
```

最终门禁：

| 命令 | 结果 |
|---|---|
| `pnpm test` | PASS — 58 个测试文件、440 个测试通过 |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS — 1713 modules transformed；主 JS 约 1.114 MB，保留既有 chunk 大小告警 |

本阶段修改文件：

```text
docs/specs/current-web-optimization-plan.md
src/App.tsx
src/App.test.tsx
src/app/AppRoot.tsx
src/app/AdminApp.tsx
src/app/CommunityApp.tsx
src/app/CommunityShell.tsx
src/router/communityRoute.ts
src/router/communityRoute.test.ts
src/router/hashRouter.ts
src/router/useHashRoute.ts
src/router/useHashRoute.test.tsx
```

下一阶段明确保留的问题：

- `#boards` / `#board/{slug}` 已进入统一路由模型，但真实版块目录和详情页刻意留给 `DY-BOARD-PUBLIC-001`。
- `#search` 已进入统一路由模型，但真实搜索结果页刻意留给 `DY-DISCOVERY-001`。
- 主 bundle >500 kB 的既有告警留给最终按页面懒加载阶段处理。
- `pnpm generate:api --check` 的基线 `fetch failed` 与 `cargo test --workspace` 的 Windows LNK1102 内存失败仍是环境/基线问题，本阶段未修改相关链路。

## DY-BOARD-PUBLIC-001 — 2026-08-27

已完成：

- `BoardSummary` 增加 `parent_id / position / depth / child_count`，公开列表按服务端访问策略过滤并返回层级摘要。
- 新增 `GET /api/v1/boards/{slug}`、`BoardDetail`、面包屑、可见子版块和 `viewer.can_read / can_create_topic / can_reply / can_upload_attachment`；不存在返回 404，无权访问返回 403。
- viewer 写权限由社区权限、账号状态和版块用户限制在服务端合并判定；创建主题、回复及已有主题附件上传同时独立校验内容访问策略。
- 新增 `src/features/boards/BoardDirectoryPage.tsx`、`BoardPage.tsx`、`BoardHeader.tsx`、`BoardBreadcrumb.tsx`、`BoardChildren.tsx`、`BoardTopicFeed.tsx`、`BoardNavigationTree.tsx`、`boardTree.ts`。
- `#boards` 与 `#board/{slug}` 接入真实页面；旧 `#board-{slug}` 继续由路由层规范化；侧栏链接统一为 canonical hash。
- 版块页支持面包屑、介绍、子版块、最新/活跃/热门/精华、标签展示、版内搜索、当前版块发主题、主题空/首屏失败/续页失败状态和 cursor 加载更多；无创建权限时顶部、移动端和页面内执行按钮均隐藏。
- TopicComposer 新增当前版块默认值，服务端仍独立执行 CSRF、社区权限、访问策略、版块限制和幂等校验。

阶段门禁：

| 命令 | 结果 |
|---|---|
| `pnpm test` | PASS — 60 个测试文件、444 个测试通过 |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS — 1721 modules transformed；主 JS 约 1.126 MB，保留既有 chunk 大小告警 |
| `cargo check --workspace --all-targets` | PASS |
| `cargo test -p daoyun-api --test boards openapi_documents_the_public_board_list -- --exact` | PASS |
| `cargo test -p daoyun-api --test boards` | ENVIRONMENT BLOCKED — 本机未设置 `DATABASE_URL`，且 127.0.0.1:55433 无 PostgreSQL 监听；非断言失败 |
| `pnpm generate:api --check` | BASELINE FAIL — `fetch failed`；未手改 `src/api/generated.d.ts` |

下一阶段：

- 进入 `DY-DISCOVERY-001`，将 Header Enter、`#search`、公开主题/版块/用户结果和所有 Feed cursor 状态统一到 URL 驱动模型。

## DY-DISCOVERY-001 — 2026-08-27

已完成：

- Header 搜索改为按 Enter 进入 `#search?q=&type=all|topics|boards|users`，搜索词和类型由 hash URL 驱动，可刷新、分享并在前进/后退时恢复。
- 新增 `SearchPage / SearchTabs / TopicSearchResults / BoardSearchResults / UserSearchResults / useSearchParams`，复用主题查询与公开版块数据，并新增公开 `GET /api/v1/users?q=&cursor=&limit=` 用户搜索。
- 新增统一 `useTopicFeed` cursor 状态：`topics / nextCursor / loadingInitial / loadingMore / errorInitial / errorMore`；条件变化重置游标，AbortController 取消旧首屏请求，按主题 ID 去重，续页失败保留已有内容。
- 首页与搜索主题结果支持增量加载；版块页继续使用阶段 2 已落地的独立 cursor 状态。搜索类型切换写入 URL，用户搜索与主题搜索失败相互隔离，避免“全部”结果被单一来源故障清空。
- 新增搜索页、Header Enter、cursor 去重和续页失败行为测试；原 Header 即时过滤回归更新为 URL 搜索行为。

验证：

- `pnpm test`：通过，63 files / 447 tests。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，1728 modules；仍有既有主 chunk 1,133.44 kB（gzip 320.01 kB）告警，留待 `DY-WEB-POLISH-001` 懒加载拆分。
- `cargo fmt --all -- --check`：通过。
- `cargo test -p daoyun-api --test users openapi_documents_user_profile_and_relationship_routes -- --exact`：通过，公开用户搜索 OpenAPI 路径已覆盖。
- Rust 数据库 integration：环境未设置 `DATABASE_URL`，`sqlx::test` 在连接测试库前失败；记录 blocker 后继续后续阶段，未掩盖或跳过测试代码。

下一阶段：

- 进入 `DY-MEMBER-CENTER-001`，保持 Growth Level、EXP、Points、Community Group、Standard Entitlement、Governance Role 的领域分离，先补会员中心行为红灯测试。

## DY-MEMBER-CENTER-001 — 2026-08-27

已完成：

- 新增 `#member`、`#member/growth`、`#member/points`、`#member/benefits`、`#member/medals`，支持解析、格式化和前进/后退；个人菜单与移动端“我的”进入会员中心。
- 新增 `MemberCenterPage / MemberOverview / GrowthPanel / GrowthProgress / PointsPanel / PointsLedger / BenefitsPanel / CommunityGroupsPanel / MedalsPanel / membershipTypes`，会员首页分面展示 Growth Level、EXP、下一等级距离、Points、基础/附加 Community Group、Standard Entitlement、有效期/额度、近期积分和公开勋章。
- 新增 membership API client：`getCurrentExperience / getCurrentCommunityGroups / listGrowthLevels / listMyPointsLedger / listMyEntitlements / listUserMembershipSummary`；保留旧 `/users/me/membership` 兼容调用，移除前端 lv1-lv20/等级编号 20 上限，动态等级按服务端目录计算。
- 新增私有积分流水与当前用户标准权益接口，以及公开会员摘要接口。公开摘要只返回成长等级、勋章与明确公开组；当前数据模型尚无用户组公开字段，因此服务端默认返回空的 `public_groups`，不推断或泄露内部组、积分、权益、额度与来源。
- 插件扩展面板错误使用独立提示，不替换或清空会员中心核心数据。

验证：

- `pnpm test -- src/features/membership/MemberCenterPage.test.tsx src/api/membership.test.ts src/router/communityRoute.test.ts`：通过，3 files / 39 tests。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，1738 modules；主 chunk 1,144.97 kB（gzip 323.03 kB）既有告警继续留待 `DY-WEB-POLISH-001`。
- `cargo test -p daoyun-api --test membership openapi_documents_membership_catalog -- --exact`：通过，新会员接口与 DTO 已进入 OpenAPI。
- `cargo fmt --all -- --check`：首次指出新增代码格式差异，已执行 `cargo fmt --all` 修正；未掩盖。
- 数据库 integration 仍受环境未设置 `DATABASE_URL` 阻断，沿用阶段 3 blocker 记录并继续。

下一阶段：

- 进入 `DY-ADMIN-MEMBER-001`，先为用户名用户选择器、积分原因映射、切换用户状态清理、幂等键和 revision 冲突恢复补红灯测试。

## DY-ADMIN-MEMBER-001 — 2026-08-27

已完成：

- 新增 `AdminUserPicker / AdminUserSummaryCard / AdminReasonField / MutationResult / RevisionConflictNotice`，以及 `MembershipAdminPage / GrowthWorkspace / PointsWorkspace / MedalsWorkspace / GroupsWorkspace / EntitlementsWorkspace` 模块边界；会员管理页已接入统一入口。
- 积分工作流改为“搜索公开用户 → 选择用户 → 服务端读取积分账户 → 数量 → 运营原因映射 → 补充说明 → 确认 → 账本与审计结果”，不再要求运营人员输入 UUID 或 reason code。
- 切换用户会清空数量、原因、说明、错误和上次结果；用户查询使用 250ms 防抖与 `AbortController`，旧响应不会覆盖新选择。
- 幂等键由客户端为每个被选用户自动生成，后端继续执行 capability、Cookie 会话、CSRF 与幂等校验；积分结果新增审计编号，补充说明只进入审计摘要，不改变积分 reason code 或账本领域。
- 新增 `GET /api/v1/admin/membership/users/{user_id}`，由 `membership.points.grant` 能力保护，返回动态等级会员账户；不引入 lv1-lv20 上限。
- revision 冲突提示组件明确阻止旧写并提供刷新最新数据入口，供成长等级、用户组和权益工作区复用。

验证：

- `vitest run src/api/admin.test.ts src/components/AdminView.test.tsx src/components/admin/AdminUserPicker.test.tsx src/features/admin-membership/PointsWorkspace.test.tsx`：通过，4 files / 64 tests。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，1744 modules；主 chunk 1,147.68 kB（gzip 323.76 kB）既有告警继续留待 `DY-WEB-POLISH-001`。
- `cargo check -p infrastructure -p api-contract -p daoyun-api`：通过。
- `cargo test -p daoyun-api --test membership openapi_documents_membership_catalog`：通过，管理会员账户路由与新增积分审计字段已进入 OpenAPI。
- `cargo fmt --all -- --check`：通过。
- 数据库 integration 仍受环境未设置 `DATABASE_URL` 阻断；积分账本、审计与幂等 integration 测试保留，未跳过或掩盖。

下一阶段：

- 进入 `DY-ADMIN-MEMBER-002`，先为用户组归档影响/默认基础组保护、标准权益版本快照、用户权益发放撤销与 revision 冲突补红灯测试。

## DY-ADMIN-MEMBER-002 — 2026-08-27（已完成）

已落地：

- 用户组列表补充有效成员数、30 天内到期成员数与访问策略引用数；数据由服务端聚合返回。默认基础组的归档操作在 UI 中禁用并显示保护原因，后端原有默认组/系统管理组 transition 校验继续独立生效。
- 标准权益后台入口接入会员运营工作区，并保持与社区用户组、VIP/标准权益和治理角色分离；页面明确权益不会授予治理角色。
- 复用既有标准权益写模型：类型发布会创建不可变权限/额度版本快照，用户发放固定 `type_version / permission_snapshot / quota_snapshot`，发放和撤销继续使用 capability、CSRF、审计、幂等与 revision。
- 新增 `GET /api/v1/admin/entitlements/types`、`GET /api/v1/admin/entitlements/types/{internal_key}/versions`、`GET /api/v1/admin/entitlements?user_id=`，用于类型列表、版本历史与用户完整操作记录（含已撤销项）；均使用独立权益读取 capability。

当前验证：

- 阶段 5B RED：用户组归档影响/默认组保护与标准权益版本/用户工作区共 3 项按预期失败，随后实现转绿。
- 局部前端回归：4 files / 68 tests 通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，1745 modules；主 chunk 1,152.75 kB（gzip 324.96 kB）告警保留至 `DY-WEB-POLISH-001`。
- `cargo check -p infrastructure -p api-contract -p daoyun-api`、`cargo fmt --all -- --check`：通过。
- `cargo test -p daoyun-api --test membership openapi_documents_membership_catalog`：通过，新读取路由与版本 DTO 已进入 OpenAPI。

最终实施结果：

- 标准权益 admin API client 已接入真实类型目录、不可变版本历史、按用户完整操作记录、类型发布、带起止时间/来源/来源编号的幂等发放和带 revision 的幂等撤销；用户搜索、有效/待生效/到期/撤销状态及权限/额度快照均在工作区展示。
- 权益类型发布在前后端同时限制为社区权限白名单，不能授予治理、后台或角色权限；用户组、标准权益和治理角色保持独立。
- 用户组支持创建、基础/附加类型、完整编辑、显示顺序、状态、13 项社区权限、8 项额度和成员管理；非默认组归档前显示有效成员、30 日到期成员与访问策略引用影响，默认基础组不可归档。
- 用户组与标准权益冲突均保留当前表单并提供刷新最新数据入口；写路径继续复用 Cookie 会话、CSRF、RBAC、审计、幂等与 revision 安全边界，未修改 `src/api/generated.d.ts`。

最终阶段验证：

- 定向前端回归：4 files / 74 tests 通过。
- `pnpm typecheck`（等价本地 `tsc -b --pretty false`）：通过。
- `cargo check -p infrastructure -p api-contract -p daoyun-api`：通过。
- 数据库 integration 仍受本机未设置 `DATABASE_URL` 阻断；既有标准权益 integration 已覆盖版本快照、幂等发放/撤销和到期语义，未跳过或掩盖环境限制。

下一阶段：

- 进入 `DY-ADMIN-BOARD-001`，收敛版块树行操作、设置抽屉、键盘交互、精确保存反馈与 stale revision 处理。

## DY-ADMIN-BOARD-001 — 2026-08-28（已完成）

实施结果：

- 版块树每行收敛为展开、名称/标识/摘要、可见状态、主题数、新增子版块和单一“更多操作”；编辑设置、公开/隐藏、层级/顺序、访问策略、治理人员、合并与删除均进入键盘可操作菜单。
- 设置抽屉按基本信息、内容规则、访问权限、治理人员和危险操作分区；抽屉具备焦点循环与 Escape 关闭，菜单支持方向键、Home/End 与 Escape。
- 搜索结果保留稳定树序，并禁用可能因过滤结果产生歧义的排序/层级写操作；任一版块写入期间锁定重复操作，成功与失败反馈精确到版块和动作。
- stale revision 会阻止写入、保留当前编辑内容并提供刷新最新数据入口；继续复用服务端 revision、Cookie 会话、CSRF、RBAC 与审计边界。

验证结果：

- `BoardAdminPanel.test.tsx`：1 file / 8 tests 通过，覆盖紧凑操作菜单、键盘语义、搜索排序保护与 revision 冲突刷新。
- `pnpm typecheck`（等价本地 `tsc -b --pretty false`）：通过。

下一阶段：

- 进入 `DY-ADMIN-BOARD-002`，实现访问策略规则预览以及带影响预览、原子迁移、审计、Outbox、精确集合和 24 小时回滚的版块合并。

## DY-ADMIN-BOARD-002 — 2026-08-28（已完成）

实施结果：

- 版块访问策略后台已接通既有 `get/put content-access-policy` API，可读取并编辑 `any_of / all_of` 规则以及 public、authenticated、community_group、entitlement、governance 主体；保存携带 `expectedRevision`，409 冲突保留编辑器并提供刷新恢复。
- 版块合并后台已接通既有影响预览、执行与回滚 API：选择目标后显示主题、回复、子版块与阻断原因；仅 `canMerge=true` 时允许执行，并使用源/目标 revision 与幂等键。
- 合并成功后展示审计编号、迁移主题数与回滚截止时间；24 小时窗口内可按原审计记录精确回滚。后端既有实现继续保证原子迁移、精确 moved set、源版块 merged 状态、审计与 Outbox 事件，不改变 Cookie session、CSRF、RBAC 与 revision 安全边界。
- 同步补齐受 `AdminBoard.status / mergedIntoBoardId` 扩展影响的前端测试夹具，没有手工修改 `src/api/generated.d.ts`。

验证结果：

- `pnpm exec vitest run src/components/BoardAdminPanel.test.tsx`：PASS — 1 file / 12 tests，覆盖访问策略 revision、冲突、合并影响、阻断、审计编号与 24 小时回滚。
- `pnpm typecheck`：PASS。
- 数据库 integration 仍受本机 `DATABASE_URL` 基线条件限制；合并服务端实现与 migration 已存在，环境限制继续保留到最终门禁记录。

下一阶段：

- 进入 `DY-PLUGIN-ADMIN-001`，完成插件安装向导、manifest/wasm 校验、风险分级、运行状态与开发者工具分离，同时保持 Wasmtime/WIT/capability 安全边界。

## DY-PLUGIN-ADMIN-001 — 2026-08-28（已完成）

实施结果：

- 插件安装从单页工程表单改为四步向导：基本信息 → 能力/数据范围/事件审批 → WebAssembly Component 文件 → Manifest 与组件确认；安装后仍默认停用，启用前服务端继续重新执行 WIT/ABI 与 capability 校验。
- 前端新增 `.wasm` 扩展名/MIME、空文件、8 MiB 上限与 WebAssembly 魔数预检；文件读取改为 `FileReader`，避免依赖部分 WebView/测试环境缺失的 `Blob.arrayBuffer()`。服务端校验错误仍按原 API 错误消息直接展示，没有弱化后端校验。
- 能力按低/中/高/严重四档展示风险：只读能力为低风险，事件订阅为中风险，用户数据写入/存储/任务/定向用户为高风险，通知写入为严重风险；安装确认与已安装插件列表均显示风险。
- 已安装插件补充启用/停用运行状态、revision、WIT/ABI、数据范围、事件订阅、组件大小与 SHA-256 摘要，并明确标记贡献加载故障；普通管理流程聚焦生命周期和状态。
- 原始 JSON 输入、legacy `content_transform / ui_render` 手工调用器与输出被移入明确的“开发者工具”折叠区域，仅 `canInvoke` 且插件已启用时可见；既有空 sandbox iframe/CSP、CSRF、revision、Wasmtime/WIT 与 capability 边界保持不变。

验证结果：

- `pnpm exec vitest run src/components/PluginAdminPanel.test.tsx`：PASS — 1 file / 16 tests，覆盖扩展名/MIME、空文件、8 MiB 限制、无效 Wasm 魔数、服务端 WIT 错误、四步安装、风险分级、运行状态/贡献故障、开发者工具隔离、sandbox、revision 冲突与受权 host action。
- `pnpm typecheck`：PASS。
- 未修改 `src/api/generated.d.ts`，未新增绕过服务端 manifest/WIT 校验的接口。

下一阶段：

- 进入 `DY-WEB-POLISH-001`，完成页面级懒加载/拆包、共享交互收口和最终前后端门禁回归。

## DY-WEB-POLISH-001 — 2026-08-28（已完成）

当前已落地：

- 后台 `AdminApp` 已按路由延迟加载，社区侧主题详情、用户资料、收藏、通知、私信、搜索、会员中心、版块目录/详情、OIDC Claim 等非首页页面均按需加载。
- 登录弹层与发帖弹层改为懒加载，富文本编辑器/Tiptap 从首屏主包拆出独立 chunk；不通过调高 Vite `chunkSizeWarningLimit` 掩盖问题。
- 生产构建主 JS chunk 从 1,190.19 kB（gzip 333.74 kB）降到 370.39 kB（gzip 101.58 kB），约下降 68.9%；`RichTextEditor` 独立约 429.70 kB，`AdminApp` 独立约 226.23 kB，构建已不再出现 >500 kB chunk 告警。
- 懒加载引入后，原同步弹窗测试已改为等待异步 chunk 渲染；版块更新 API 测试同步当前 `status: "open"` 请求契约。

实施中回归记录：

- 第一轮 `pnpm test`：68 files / 479 tests 中 476 通过、3 失败；失败均为测试契约/懒加载时序问题，不是业务行为失败。
- 两个懒加载弹窗断言已修正；修第三个 API 断言时 Windows PowerShell 5 默认编码误写 `src/api/admin.test.ts`，该文件已从 Git 对象原样恢复，没有执行 `reset` / `checkout` / `clean`，其他工作区文件未受影响。
- 最终全量前端测试仍需在恢复后的 `admin.test.ts` 重新补齐 `status: "open"` 断言后再跑一次；随后继续执行 `pnpm typecheck`、`pnpm build`、E2E 类型检查、Rust fmt/clippy/workspace test 与 API generation 门禁。
- 已知环境限制继续保留：数据库 integration 可能受 `DATABASE_URL` / 本机 PostgreSQL 限制，`cargo test --workspace` 可能遇到 Windows MSVC `LNK1102`，`pnpm generate:api --check` 基线可能出现 schema fetch failure；最终交付时区分代码失败与环境 blocker，不掩盖。

最终实施结果：

- 恢复后的 `src/api/admin.test.ts` 已同步版块 `status: "open"`、积分 `details: null` 与 `auditId: null` 契约；定向 4 files / 114 tests 与全量前端 68 files / 482 tests 均通过。
- 真实业务 E2E 已同步富文本发帖/回复、响应式后台模块导航和插件四步安装向导；桌面与手机完整套件 14 passed / 2 skipped，跳过项由桌面单浏览器会话覆盖 320/768/1024/1440 宽度后在 mobile project 中按设计跳过。
- OpenAPI 类型通过运行中 API 文档重新生成，没有手工修改 `src/api/generated.d.ts`；`pnpm generate:api --check` 通过。
- 积分记账内部调用改为显式 `None / Admin / Trusted` actor 类型，保持管理员鉴权、插件可信调用与审计语义不变，并消除 Clippy 过多参数告警。
- 旧持久化本地开发库仍存在 migration `202608230001` checksum VersionMismatch，本次没有修改迁移历史或清理该数据库；最终数据库门禁使用全新隔离 PostgreSQL 数据目录从零执行迁移并通过。

最终门禁：

| 命令 | 结果 |
|---|---|
| `pnpm test` | PASS — 68 files / 482 tests |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS — 1749 modules；主 chunk 370.39 kB，无 >500 kB 告警 |
| `pnpm test:e2e:typecheck` | PASS |
| `DAOYUN_LOCAL_E2E=1 pnpm test:e2e` | PASS — 14 passed / 2 intentionally skipped |
| `pnpm generate:api --check` | PASS |
| `cargo fmt --all -- --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `DATABASE_URL=... cargo test --workspace` | PASS — 包含数据库 integration；2 个需预构建官方 Wasm component 的测试按代码标记 ignored |

完成判定：

- 当前总状态为 **11 / 11**；`DY-WEB-POLISH-001` 已完成。
