# 实施计划：站点管理后台改版

## 状态

已完成。统一后台外壳、用户治理、版块树、举报一体化处置、资源相关审计、站长工作台和最终质量门均已闭环。

## 概览

本计划落实 `station-administration-redesign.md`：先统一后台入口和可恢复导航，再依次交付用户管理、版块树、举报一体化处置，最后补齐工作台、审计和真实浏览器回归。每个任务保持在一个聚焦会话内完成，先写失败测试，再实现行为。

## 依赖关系

```text
统一站点管理入口
        │
        ├── 用户读取契约 ── 用户列表/详情 UI ── 用户状态变更 ── 用户角色/审计
        │
        ├── 版块层级契约 ── 版块树 UI ── 安全删除与影响预览
        │
        └── 举报详情契约 ── 一体化处置事务 ── 举报队列/详情 UI
                                                        │
                                            工作台摘要与完整 E2E
```

共享 OpenAPI 契约、迁移和后台路由必须顺序完成；各业务切片在共享契约稳定后可以独立实施，但同一时间不得并行修改 `apps/api/src/admin.rs`、`src/components/AdminView.tsx` 或生成契约。

## 架构决定

- 采用 `/#admin/<module>` hash 子路由，不引入新的前端路由依赖。
- `GET /api/v1/admin/access` 继续作为后台外壳能力清单，服务端是最终授权边界。
- 用户、版块和举报分别使用独立展示组件，`AdminView` 只负责路由、能力过滤和模块装配。
- 公共 DTO 先进入 `crates/api-contract`，随后生成 TypeScript 契约；禁止手工编辑 `src/api/generated.d.ts`。
- 状态变更、审计和通知 outbox 在同一 PostgreSQL 事务内提交。
- 删除旧 `/#management` 产品入口，不增加长期双入口兼容层。

## 第一阶段：统一后台外壳

### 任务 1：统一入口与 hash 子路由

**说明：** 将账户菜单中的两个入口合并为“站点管理”，把治理模块迁入 `/#admin`，并让模块、筛选和选中对象可以通过 hash 子路由恢复。

**验收标准：**

- [x] 只有一个“站点管理”入口，按任一管理读取 capability 显示。
- [x] `/#admin/users`、`/#admin/boards`、`/#admin/reports?status=open` 可直接访问和刷新。
- [x] 只有治理权限的账号进入同一后台外壳，但只能看到举报与风控模块。

**验证：**

- [x] `pnpm test -- src/App.test.tsx src/components/AdminView.test.tsx`
- [x] `pnpm typecheck`

**依赖：** 无。

**可能修改：**

- `src/App.tsx`
- `src/App.test.tsx`
- `src/components/SiteHeader.tsx`
- `src/components/AdminView.tsx`
- `src/components/AdminView.test.tsx`

**规模：** 中。

### 任务 2：完成响应式后台导航与统一反馈组件

**说明：** 把后台外壳收敛为桌面左侧导航、移动端模块选择，并建立 loading、empty、forbidden、error、success 和 confirm 的统一展示模式。

**验收标准：**

- [x] 导航具备明确的 `navigation` 名称、键盘焦点和当前模块状态。
- [x] 320、768、1024、1440px 无页面级横向溢出。
- [x] 图标按钮全部具有可访问名称和 tooltip。

**验证：**

- [x] `pnpm test -- src/components/AdminView.test.tsx`
- [x] `pnpm typecheck`
- [x] `pnpm build`

**依赖：** 任务 1。

**可能修改：**

- `src/components/AdminView.tsx`
- `src/components/AdminView.test.tsx`
- `src/styles.css`
- `e2e/admin-workspace.spec.ts`

**规模：** 中。

### 检查点 A：后台外壳

- [x] 现有品牌、授权、运维、插件、举报和风控能力仍按 capability 加载。
- [x] 前端测试、类型检查和生产构建通过。
- [x] 人工确认桌面与移动导航后再进入用户管理。

## 第二阶段：用户管理

### 任务 3：管理员用户搜索与详情读取契约

**说明：** 交付用户搜索、摘要和管理员详情的服务端纵向切片，不暴露私有身份或凭据字段。

**验收标准：**

- [x] `GET /api/v1/admin/users` 支持搜索、状态、角色、注册时间和游标分页。
- [x] `GET /api/v1/admin/users/{user_id}` 返回角色、统计、当前限制和 revision。
- [x] 用户最近内容与举报记录分别提供独立的游标分页端点。
- [x] OpenAPI、request ID、能力边界和隐私字段均有集成测试。

**验证：**

- [x] `cargo test -p infrastructure --test users`
- [x] `cargo test -p daoyun-api --test users`
- [x] `cargo test -p api-contract --test response_contracts`

**依赖：** 检查点 A。

**可能修改：**

- `crates/api-contract/src/user.rs`
- `crates/infrastructure/src/users.rs`
- `apps/api/src/users.rs`
- `apps/api/tests/users.rs`
- `crates/api-contract/tests/response_contracts.rs`

**规模：** 中。

### 任务 4：用户列表与详情页面

**说明：** 使用生成契约实现用户搜索、筛选、分页和详情标签，先完成只读闭环。

**验收标准：**

- [x] 站长可以按用户名、昵称或用户 ID 搜索，无需精确输入或 UUID。
- [x] 用户详情展示概览、最近内容、举报记录和角色。
- [ ] 管理记录入口等待任务 13 的资源审计过滤契约。
- [x] loading、empty、forbidden、error 和运行时 DTO 异常均有测试。

**验证：**

- [x] `pnpm generate:api`
- [x] `pnpm test -- src/api/adminUsers.test.ts src/components/UserAdminPanel.test.tsx`
- [x] `pnpm typecheck`

**依赖：** 任务 3。

**可能修改：**

- `src/api/generated.d.ts`
- `src/api/adminUsers.ts`
- `src/api/adminUsers.test.ts`
- `src/components/UserAdminPanel.tsx`
- `src/components/UserAdminPanel.test.tsx`

**规模：** 中。

### 任务 5：用户状态迁移与事务写入

**说明：** 增加账号 revision、可到期限制及状态变更事务，确保不能暂停自己或最后一个可用超级管理员。

**验收标准：**

- [x] `active`、`restricted`、`suspended` 及期限校验符合规格，到期状态由后台任务自动恢复。
- [x] 并发 revision 冲突返回稳定错误，不覆盖较新的状态。
- [x] 状态、审计和通知 outbox 原子提交，失败全部回滚。

**验证：**

- [x] `cargo test -p infrastructure --test users`
- [x] `cargo test -p daoyun-api --test users`
- [x] 迁移正向、反向测试通过。

**依赖：** 任务 3。

**可能修改：**

- `migrations/<timestamp>_create_admin_user_status.*.sql`
- `crates/api-contract/src/user.rs`
- `crates/infrastructure/src/users.rs`
- `apps/api/src/users.rs`
- `apps/api/tests/users.rs`

**规模：** 中。

### 任务 6：用户限制、恢复与角色调整交互

**说明：** 在用户详情中加入影响预览、期限、公开原因和确认结果，并复用现有角色分配 API。

**验收标准：**

- [x] 限制、暂停和恢复均展示影响范围、期限、操作者和成功结果。
- [x] 角色分配从当前用户上下文提交，不要求再次输入用户名。
- [x] 只读 capability 不显示写按钮，冲突状态可刷新后重试。

**验证：**

- [x] `pnpm test -- src/components/UserAdminPanel.test.tsx src/api/adminUsers.test.ts`
- [x] `pnpm typecheck`
- [x] `pnpm build`

**依赖：** 任务 4、5。

**可能修改：**

- `src/api/adminUsers.ts`
- `src/api/adminUsers.test.ts`
- `src/components/UserAdminPanel.tsx`
- `src/components/UserAdminPanel.test.tsx`
- `e2e/admin-users.spec.ts`

**规模：** 中。

### 检查点 B：用户管理

- [ ] 真实 Chromium 完成搜索、限制、恢复和角色分配。
- [x] API 响应不包含凭据、会话或私有身份字段。
- [x] Rust、前端、OpenAPI 和生产构建通过。

## 第三阶段：版块树

### 任务 7：版块层级、revision 与稳定排序

**说明：** 为现有板块 CRUD 增加 `parent_id`、revision、三级深度和同级稳定排序，保留软删除与审计。

**验收标准：**

- [x] 创建、移动和排序拒绝自身、后代、无效父级和超过三级的结构。
- [x] 并发修改使用 expected revision，冲突不覆盖新状态。
- [x] 已有平面版块在迁移后成为顶级版块，反向迁移可执行。

**验证：**

- [x] `cargo test -p infrastructure --test database`
- [x] `cargo test -p daoyun-api --test admin`
- [x] `cargo test -p api-contract --test response_contracts`

**依赖：** 检查点 A。

**可能修改：**

- `migrations/<timestamp>_add_board_hierarchy.*.sql`
- `crates/api-contract/src/admin.rs`
- `crates/infrastructure/src/admin.rs`
- `apps/api/src/admin.rs`
- `apps/api/tests/admin.rs`

**规模：** 中。

### 任务 8：版块树与行内操作页面

**说明：** 用平面服务端数据组装可访问树，交付展开、搜索、新增、改名、排序、移动和可见性切换。

**验收标准：**

- [x] 每次只保存一个版块动作，并显示保存中、成功或失败。
- [x] 拖动排序具有键盘可用的移动替代操作。
- [x] 小屏使用层级列表而非横向滚动表格。

**验证：**

- [x] `pnpm test -- src/api/admin.test.ts src/components/BoardAdminPanel.test.tsx`
- [x] `pnpm typecheck`
- [x] `pnpm build`

**依赖：** 任务 7。

**可能修改：**

- `src/api/admin.ts`
- `src/api/admin.test.ts`
- `src/components/BoardAdminPanel.tsx`
- `src/components/BoardAdminPanel.test.tsx`
- `src/styles.css`

**规模：** 中。

### 任务 9：版块删除影响预览

**说明：** 在软删除前展示子版块、主题和回复影响，并对不可删除状态给出明确下一步。

**验收标准：**

- [x] 有子版块或主题时服务端返回稳定冲突和计数摘要。
- [x] 确认界面明确显示对象、影响范围和不可逆后果。
- [x] 首版不自动迁移、合并或级联删除内容。

**验证：**

- [x] `cargo test -p daoyun-api --test admin`
- [x] `pnpm test -- src/components/BoardAdminPanel.test.tsx`

**依赖：** 任务 7、8。

**可能修改：**

- `crates/api-contract/src/admin.rs`
- `crates/infrastructure/src/admin.rs`
- `apps/api/src/admin.rs`
- `apps/api/tests/admin.rs`
- `src/components/BoardAdminPanel.tsx`

**规模：** 中。

### 检查点 C：版块管理

- [x] 真实 Chromium 完成新增子版块、改名、移动、排序和安全删除拒绝。
- [x] 320、768、1024、1440px 无页面级横向溢出。
- [x] 迁移、Rust、前端和生产构建通过。

## 第四阶段：举报处理

### 任务 10：举报详情、revision 与上下文读取

**说明：** 增加举报详情端点，返回目标内容上下文、作者状态、历史举报和处理记录。

**验收标准：**

- [x] 详情只对 `governance.reports.read` 开放，并避免泄露越权目标。
- [x] 报告响应包含 revision，列表和详情状态一致。
- [x] 内容上下文长度有明确上限，运行时响应和 OpenAPI 契约一致。

**验证：**

- [x] `cargo test -p daoyun-api --test governance`
- [x] `cargo test -p infrastructure --test users`
- [x] `cargo test -p api-contract --test response_contracts`

**依赖：** 检查点 A、任务 5。

**可能修改：**

- `crates/api-contract/src/reports.rs`
- `crates/infrastructure/src/governance.rs`
- `apps/api/src/governance.rs`
- `apps/api/tests/governance.rs`
- `crates/api-contract/tests/response_contracts.rs`

**规模：** 中。

### 任务 11：一体化举报处置事务

**说明：** 创建 moderation 子资源，在一个事务中组合内容动作、用户动作、举报结论、审计和通知。

**验收标准：**

- [x] 驳回不能携带内容或用户副作用。
- [x] 隐藏内容与限制用户可以组合提交，任一失败全部回滚。
- [x] stale revision、目标状态变化和越权使用稳定错误。

**验证：**

- [x] `cargo test -p daoyun-api --test governance`
- [x] `cargo test -p infrastructure --test users`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`

**依赖：** 任务 5、10。

**可能修改：**

- `crates/api-contract/src/reports.rs`
- `crates/infrastructure/src/governance.rs`
- `apps/api/src/governance.rs`
- `apps/api/tests/governance.rs`
- `migrations/<timestamp>_add_report_revision.*.sql`

**规模：** 中。

### 任务 12：举报队列、详情与处置页面

**说明：** 实现可恢复筛选、游标分页、上下文详情和组合处置确认，替换当前单列表操作。

**验收标准：**

- [x] 待处理、处理中、已解决、已驳回状态可筛选、刷新和分页。
- [x] 桌面使用队列加详情双栏，移动端使用列表到详情单栏。
- [x] 成功结果逐项展示内容、用户、举报、通知和审计状态。

**验证：**

- [x] `pnpm generate:api`
- [x] `pnpm test -- src/api/reports.test.ts src/components/ReportAdminPanel.test.tsx`
- [x] `pnpm typecheck`
- [x] `pnpm build`

**依赖：** 任务 10、11。

**可能修改：**

- `src/api/reports.ts`
- `src/api/reports.test.ts`
- `src/components/ReportAdminPanel.tsx`
- `src/components/ReportAdminPanel.test.tsx`
- `src/api/generated.d.ts`

**规模：** 中。

### 检查点 D：举报治理

- [x] 真实 Chromium 完成“打开举报 → 查看上下文 → 隐藏内容并限制作者 → 查看结果”。
- [x] 事务失败测试证明内容、用户、举报、审计和通知全部回滚。
- [x] Rust、前端、OpenAPI、类型检查和生产构建通过。

## 第五阶段：工作台、审计与收尾

### 任务 13：资源相关审计与用户/举报管理记录

**说明：** 扩展审计查询过滤，并在用户详情和举报详情中显示相关操作记录。

**验收标准：**

- [x] 审计可按 resource ID、user ID 和 report ID 过滤并游标分页。
- [x] 记录展示操作者、动作、对象、时间和审计 ID，不泄露内部摘要。
- [x] 未拥有 `audit.read` 的账号看不到记录入口。

**验证：**

- [x] `cargo test -p daoyun-api --test admin`
- [x] `pnpm test -- src/components/UserAdminPanel.test.tsx src/components/ReportAdminPanel.test.tsx src/components/RelatedAuditLog.test.tsx`

**依赖：** 任务 6、12。

**可能修改：**

- `crates/api-contract/src/admin.rs`
- `crates/infrastructure/src/admin.rs`
- `apps/api/src/admin.rs`
- `apps/api/tests/admin.rs`
- `src/api/admin.ts`

**规模：** 中。

### 任务 14：站长工作台摘要

**说明：** 使用已有分页端点的摘要字段展示待处理举报、受限用户和隐藏版块，并链接到预设筛选页面。

**验收标准：**

- [x] 工作台只请求当前账号有读取权限的数据。
- [x] 每类最多展示五条，完整数据通过业务页面查看。
- [x] 空状态直接说明当前没有待办，不使用无意义图表。

**验证：**

- [x] `pnpm test -- src/components/AdminDashboard.test.tsx`
- [x] `pnpm typecheck`
- [x] `pnpm build`

**依赖：** 任务 6、9、12。

**可能修改：**

- `src/components/AdminDashboard.tsx`
- `src/components/AdminDashboard.test.tsx`
- `src/components/AdminView.tsx`
- `src/styles.css`

**规模：** 中。

### 任务 15：完整浏览器回归、文档与质量审查

**说明：** 固化站长三条核心流程，完成全量质量门和多轴代码审查。

**验收标准：**

- [x] 桌面和移动项目覆盖用户、版块、举报三条核心流程。
- [x] 可访问性扫描无严重或关键问题，主要流程可用键盘完成。
- [x] 规格、ADR、项目状态和实际契约一致。

**验证：**

- [x] `cargo test --workspace`
- [x] `cargo fmt --all -- --check`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`
- [x] `pnpm generate:api -- --check`
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `$env:DAOYUN_LOCAL_E2E = "1"; pnpm test:e2e`

**依赖：** 检查点 B、C、D，任务 13、14。

**可能修改：**

- `e2e/admin-workspace.spec.ts`
- `e2e/admin-users.spec.ts`
- `e2e/admin-boards.spec.ts`
- `e2e/admin-reports.spec.ts`
- `docs/project-status.md`

**规模：** 中。

### 检查点 E：完成

- [x] 规格全部成功标准有对应自动化或人工验证证据。
- [x] 全量 Rust、前端、OpenAPI、构建和浏览器质量门通过。
- [x] 按 `code-review-and-quality` 完成合并前审查，并修复用户列表续页、举报深链、筛选竞态、关联审计竞态和审计告警响应头缺口。

## 风险与缓解

| 风险 | 影响 | 缓解方式 |
| --- | --- | --- |
| 当前工作区已有大量未提交改动 | 高 | 每个任务只触碰列出的文件；开始前检查 diff；不重置或覆盖用户改动 |
| `AdminView.tsx` 与 `apps/api/src/admin.rs` 继续膨胀 | 高 | 在首次相关任务中拆出领域组件和路由模块，不把新逻辑继续堆入单文件 |
| 用户限制影响现有发布、私信和上传路径 | 高 | 先建立统一状态检查并为每条受影响业务路径添加拒绝测试 |
| 版块层级迁移影响现有平面列表顺序 | 中 | 现有记录全部设为顶级；用 position + id 稳定排序；正反迁移测试 |
| 举报组合处置产生部分成功 | 高 | 单数据库事务、行锁、expected revision、审计和 outbox 原子写入 |
| 生成 OpenAPI 类型与运行时映射漂移 | 中 | 每个契约任务后立即生成并执行 `pnpm generate:api -- --check` |
| 双栏界面在移动端退化不清楚 | 中 | 组件测试验证单栏状态，真实 Chromium 覆盖 390px，并检查 320px 无溢出 |

## 不在本计划中

- 永久删除用户。
- 版块合并或自动迁移主题。
- 批量隐藏内容或批量暂停用户。
- 会员、运维和插件模块重做。
- phpwind 数据迁移、兼容层、视觉资源或源码复用。

## 开放问题

无。实施中若发现需要改变用户状态语义、版块最大深度、举报事务边界或公共 API，必须先回到规格阶段更新并重新确认。
