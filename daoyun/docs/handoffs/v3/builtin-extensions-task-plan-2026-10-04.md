# DYR-024 官方内置扩展解耦

状态：DONE。沿用已授权 V3 任务卡与 04 契约，先投票试点，再验证另外四项。

## 目标与契约
五项官方静态面板改为内置配置，成长奖励和第三方组件继续走 Wasm。新增 POST /api/v1/admin/plugins/builtins/{key}，仅允许固定五键，plugins.install、会话与 CSRF 校验；返回 200 标准 Plugin 封套，request_id 与头一致。幂等配置只返回现有 native 行，不覆盖 status/revision/配置；新行默认 disabled，必须显式走原 lifecycle/revision 启用。

Plugin 追加 execution（native/wasm）。plugins 追加 execution 默认 wasm。迁移仅标记五个官方键且完全匹配单一业务能力加 ui.panel、0.1.0、空 scopes/events 的历史记录。原 id/key/组件字节/hash/installed_by/业务引用全部保留，status 不变，执行方式变更增加 revision。混合能力与第三方记录保持 Wasm；活跃 lease/receipt 阻断转换。新内置行无组件字节；DB CHECK 限定 native 固定键/能力契约。原生记录禁止通用卸载，防止历史提供者丢失。

原生生命周期复用数据库事务、行锁与审计，跳过 Wasm 编译。运行时装配、UI contributions、任务认领和受控命令仅接受 wasm 行；不扩大宿主权限，不新增账本写入者。Native 原始权限/额度/收据/历史语义继续沿用服务端路径。补充安装不自动开启独立业务设置。

## 文件与实现顺序
1. apps/api/tests/plugins.rs RED；migrations 和 infrastructure 迁移/生命周期测试 RED→GREEN。
2. crates/infrastructure/src/plugins.rs 的固定安装入口与公共 DTO/OpenAPI；生成 TS，不手改生成物。
3. PluginAdminPanel 与 src/api/plugins.ts 替换五项下载/安装向导；真实原生设置保留，第三方安装器保留。
4. 隔离旧/新 API 兼容演练、真实桌面/手机业务与启停、五档截图，专项及全量检查、源码清单、交接。

## 代码风格与检查
Rust 原生入口复用 Database 事务；React named exports、语义 tokens、Lucide；UTF-8 读写。例如：await updatePluginStatus(plugin.id, status, plugin.revision, csrfToken)。测试框架沿用 SQLx/Axum、Vitest/Testing Library、Playwright，不新增依赖。

命令：pnpm exec vitest run --maxWorkers=2 --minWorkers=1；pnpm typecheck；pnpm build；pnpm exec tsc -p tsconfig.playwright.json --noEmit；cargo test --workspace -j1；cargo fmt --all -- --check；cargo clippy --workspace --all-targets -j1 -- -D warnings；实时 OpenAPI 生成类型一致性。

## 验收与回退
AC-024-01：旧官方投票真实历史迁移后 id/key/所有权/投票不变，旧 provider 和新写业务同一来源。
AC-024-02：升级 disabled 不启用、未安装不凭升级创建；五项新配置 disabled，独立模块设置不覆盖。
AC-024-03：旧组件保留时隔离演练可读写；出现无组件 native 新行，down/旧应用回退必须阻断，使用兼容候选或有 RPO 的隔离恢复。不删除历史来促成回退。

总是保留 dirty 改动/业务/审计/凭据/额度；只本机隔离库与新增 fixture。禁止生产迁移、部署、提交、依赖升级、不可逆删除；构建裁剪留 DYR-025。G3–G6 的测试不等于用户门禁接受。实体设备与辅助技术未运行必须显式记 NOT_RUN。

结果：三项 AC PASS；最终结果见 [内置模块交接](builtin-extensions-2026-10-04.md)。
