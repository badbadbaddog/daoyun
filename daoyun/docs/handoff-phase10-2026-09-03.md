# DaoYun Phase 10 交接 — 2026-09-03

状态：**DONE / LOCAL CLOSURE COMMIT**

## 1. 基线与范围

- 项目：`C:\Users\111\Documents\Playground\daoyun`
- Git 根：`C:\Users\111\Documents\Playground`
- 分支：`codex/daoyun-home-foundation`
- Phase 9 基线提交：`d15a957fa46484fe8ad0182fecf9efb001c1b7e9`
- Phase 9 基线：81 files / 607 tests PASS
- Phase 10 目标：最终仓库级门禁、generated/OpenAPI zero-diff、Rust/DB、真实 E2E、交付文档与 Git 状态收口。
- 本阶段不重新扩展 Phase 4-9 已通过的 Web 功能；只修最终门禁能够真实复现的问题。
- 全程只使用 FastSpider_FS；没有创建或使用 Codex 会话。
- 默认不 push；本交接收口时仍未 push。

## 2. 最终门禁暴露并修复的真实问题

### 2.1 WCAG AA 浅色主题对比度

Playwright + axe 在最终真实页面上发现三类低于 AA 4.5:1 的文本组合：

- 版块目录弱文本：`#6b7280` / `#f4f6f7`，约 4.45:1。
- 主按钮白字：`#ffffff` / 历史内置品牌蓝 `#2F7BFF`，约 3.89:1。
- 后台当前模块文本：历史蓝色组合约 4.25:1。

修复采用设计 token / 品牌默认值的源头收口，而不是在单页堆局部覆盖：

- 浅色主品牌蓝调整为 `#2563EB`。
- 浅色弱文本调整为 `#626B78`。
- 后台 active 文本使用满足当前浅色背景 AA 的共享 token。
- `src/app/CommunityApp.tsx` 将历史内置默认值 `#2F7BFF` 视为 legacy built-in default；尚未迁移的实例不会继续把低对比度旧蓝写回 CSS Variables。
- 新增可逆迁移：
  - `migrations/202609030001_set_accessible_community_blue_brand.up.sql`
  - `migrations/202609030001_set_accessible_community_blue_brand.down.sql`
- Up migration 将 `site_branding.primary_color` 默认值改为 `#2563EB`，并只迁移当前仍等于历史内置默认 `#2F7BFF` 的 singleton；自定义品牌色不被覆盖。
- 真实本地 API 已确认当前公开品牌返回 `#2563EB`。

### 2.2 E2E 契约跟随当前产品 IA

最终 E2E 首轮还暴露多处旧断言，它们与当前已经验收通过的产品行为不一致。本阶段只更新测试契约，不把产品退回旧界面：

- 公开响应式测试改为当前扁平社区布局与当前 token 契约。
- mock fixture 补齐用户 `membership-summary` 请求。
- 发布器改为当前 body-first 流程：`添加标题` → `标题（可选）`。
- 主题发布成功后当前产品直接进入主题详情；E2E 不再等待旧的“返回列表”。
- 治理 ActionMenu 按当前 `role=menuitem` 查询，不再按旧 button 语义。
- 390px 主题详情按当前交互先点击固定“写评论”入口，再填写 `参与讨论` 编辑器；桌面保持直接可见编辑器。

### 2.3 本地真实 E2E 的可重复性

两次失败都来自持久本地测试环境污染，而不是产品权限/配额实现错误：

1. 旧失败 E2E 留下的 `e2e_moderator_*` 授权导致撤销本轮角色后成员仍通过另一条合法角色获得 `moderation.topic`。服务端授权 SQL 每次请求实时查 PostgreSQL，不存在 session 权限缓存。测试现在只清理明确的 E2E 角色前缀并再次证明撤销后立即 `403`。
2. 多轮真实 E2E 累积消耗 `demo_member` 的 `topic.create.daily`，后续发布返回 `429`。既有 loopback-only `seed:local` 现在只重置固定本地测试账号 `demo_admin` / `demo_member` 的 `community_quota_usage`；不 TRUNCATE、不改其他用户、不新增生产测试后门。

对应 `scripts/local-development.test.mjs` 新增专用契约回归；最终全量 Vitest 因此从 Phase 9 的 607 增至 608。

## 3. Playwright / 浏览器最终证据

### 3.1 plugin-enabled 真实业务矩阵

仅在验收 runtime 显式设置 `DAOYUN_PLUGINS_ENABLED=true`；生产默认没有改变。

最终 `pnpm test:e2e`：

- **26 passed / 2 intentional skipped / 0 failed**
- desktop：14 / 14 PASS
- mobile：公开质量、真实发布/回复/私信、RBAC/运维、真实插件和安全头均 PASS
- 2 个 mobile skip 是测试自身限定 desktop 的会员经济和主题治理场景，不是失败

覆盖内容包括：

- 公开 Feed console / overflow / axe
- 首屏质量预算
- 320 / 375 / 768 / 1024 / 1440 响应式
- 登录 → 发布主题 → 主题详情 → 回复 → 用户资料 → 私信
- board-scoped RBAC 创建、分配、越权拒绝、撤销后即时 403
- 运维只读拒写、写权限、规则恢复
- 会员经济 axe / overflow
- 真实 Rust WASM 插件安装、启用、调用、sandbox UI、停用、disabled invoke 409、站内确认卸载
- 主题治理处理记录、移动/恢复、置顶/取消置顶
- API baseline security headers

真实插件 lifecycle 单独 desktop + mobile：**2 / 2 PASS**。

### 3.2 生产默认 runtime 最终 sanity

最终重新以默认命令启动：

`pnpm local --no-browser`

运行日志明确：

- `plugins_enabled=false`
- API：`127.0.0.1:3000`
- Web/Gateway：`http://127.0.0.1:5173/`
- PostgreSQL：`127.0.0.1:55433`

Fresh Chromium 1440×1000 最终检查：

- 匿名公开首页正常加载。
- 旧普通用户 session 直接访问 `#admin/plugins` 会安全返回前台；无后台数据泄漏。
- 正常退出旧 session 后，本地固定管理员可登录并进入 `#admin/plugins`。
- 插件管理页正常显示 0 个插件、sandbox/资源边界说明和“默认停用”安装向导；本次默认-runtime sanity 不执行安装写入。
- 当前 browser event cursor 在插件后台打开后没有新增 console / page / network error。
- 累计旧事件只有匿名 `/api/v1/auth/session` 的预期 401，以及页面导航时取消的 GET；不属于 Phase 10 业务错误。

## 4. Rust / PostgreSQL 最终门禁

### 4.1 GNU workspace test

Windows MSVC 历史 `LNK1102: out of memory` 不再作为当前交付阻塞。本轮按 README 的低内存 GNU 配置执行：

- PATH 前置 `C:\msys64\mingw64\bin`
- `CARGO_BUILD_JOBS=1`
- `rustup run 1.94.1-x86_64-pc-windows-gnu cargo test --workspace -j 1 -- --test-threads=1`

第一次冷缓存完整编译/链接在 **20m38s** 完成，已经穿过 Wasmtime / Cranelift / SQLx / daoyun-api；随后 FastSpider 单 job 1800 秒上限在测试后段使外层 job expired，这不是 Rust test assertion failure。

使用完整缓存立即重跑同一命令：

- compile：1.44s
- 最终 **exit 0**
- 所有实际执行测试 0 failed
- 仅 2 个测试按源码定义 expected ignored，因为它们要求预构建官方 growth plugin 的 `wasm32-wasip2` 产物：
  - `official_growth_component_runs_from_outbox_through_worker_to_ledger`
  - `official_growth_component_instantiates_with_only_bounded_wasi_cli_imports`

### 4.2 Clippy / Rustfmt

- GNU `cargo clippy --workspace --all-targets -j 1 -- -D warnings`：**exit 0**，无 warning。
- `cargo fmt --all -- --check`：**PASS**。

## 5. Web / generated 最终门禁

- `pnpm test`：**81 files / 608 tests PASS**。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS，Vite 6.4.3，**1762 modules transformed**。
- bundle：
  - CSS `259.35 kB / 39.00 kB gzip`
  - `UserProfileView` `38.95 kB / 10.08 kB gzip`
  - `AdminApp` `235.65 kB / 61.10 kB gzip`
  - main `394.43 kB / 107.40 kB gzip`
  - `RichTextEditor` `429.75 kB / 136.83 kB gzip`
- `pnpm verify:membership`：PASS，**等级 20 / 勋章 17**。
- `pnpm test:e2e:typecheck`：PASS。
- `pnpm generate:api --check`：在最终默认 runtime 在线时 **PASS / zero-diff**。

OpenAPI check 曾在验收服务 job 生命周期结束、API 不在线时返回 `fetch failed`；恢复服务后立即通过。该现象已经确认是服务生命周期环境事件，不是 `src/api/generated.d.ts` 漂移。

## 6. Phase 10 代码边界

最终业务/测试改动集中在：

1. `e2e/community-responsive.spec.ts`
2. `e2e/fixtures.ts`
3. `e2e/local-business-flow.spec.ts`
4. `packages/design-tokens/tokens.css`
5. `scripts/design-tokens.test.mjs`
6. `scripts/local-development.test.mjs`
7. `scripts/seed-local-test-accounts.mjs`
8. `src/App.test.tsx`
9. `src/app/CommunityApp.tsx`
10. `migrations/202609030001_set_accessible_community_blue_brand.up.sql`
11. `migrations/202609030001_set_accessible_community_blue_brand.down.sql`

另同步：

- `docs/handoff-phase10-2026-09-03.md`
- `docs/project-status.md`
- `docs/specs/current-web-optimization-plan.md`

父 Git 仓库其他未跟踪文件与项目不属于 Phase 10，禁止纳入提交。

## 7. 最终 Git 收口

Phase 10 已完成本地 closure commit，并在提交后重新执行只读核对：

- Phase 10 closure commit：`4f6da0a38bb6bff9d798b98c271bddd51b771443`
- commit message：`fix: complete phase 10 delivery closure`
- 提交边界：14 files / 365 insertions / 65 deletions
- `git diff --check -- daoyun`：PASS
- cached whitespace check：PASS
- 当前分支：`codex/daoyun-home-foundation`
- 相对 `origin/codex/daoyun-home-foundation`：**ahead 17**
- `daoyun` 工作树：**clean**；`git status` 仅剩父仓库原有未跟踪杂项
- 默认本地 runtime：**running**，API / Admin 请求持续返回 200；启动配置确认 `plugins_enabled=false`
- 未执行 push

至此 Phase 10 的代码、测试、浏览器、Rust、generated、文档与 Git 状态全部闭环。
